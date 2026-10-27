'use strict';

// 設定の状態判定・バックアップ・適用・復元。
// run(ops) は PowerShell エンジンへの命令列を受け取り、結果の配列を返す関数（テストでは偽物を渡す）。
// store は { load(), save(data) } を持つ永続化オブジェクト。

const SVC_RANK = { auto: 0, 'delayed-auto': 0, demand: 1, disabled: 2 };

function sameValue(kind, actual, expected) {
  if (kind === 'DWord' || kind === 'QWord') return Number(actual) === Number(expected);
  if (kind === 'Binary') return String(actual).toLowerCase() === String(expected).toLowerCase();
  if (kind === 'MultiString') return JSON.stringify([].concat(actual)) === JSON.stringify([].concat(expected));
  return String(actual) === String(expected);
}

// 読み取り命令。ps の check / backup は使うときだけ。
function readOp(a, purpose) {
  if (a.t === 'reg') return { op: 'regGet', path: a.path, name: a.name };
  if (a.t === 'svc') return { op: 'svcGet', name: a.name };
  const code = purpose === 'backup' ? a.backup : a.check;
  return code ? { op: 'ps', code } : null;
}

function actionMatches(a, r, backedUp) {
  if (a.t === 'reg') return !!r && r.ok && r.exists && sameValue(a.kind, r.value, a.value);
  if (a.t === 'svc') {
    if (!r || !r.ok) return false;
    if (!r.exists) return null; // サービスが無い → 判定対象外
    return SVC_RANK[r.start] !== undefined && SVC_RANK[r.start] >= SVC_RANK[a.start];
  }
  if (!a.check) return backedUp;
  return !!r && r.ok && r.value === true;
}

class TweakService {
  constructor({ run, store, tweaks }) {
    this.run = run;
    this.store = store;
    this.tweaks = new Map(tweaks.map((t) => [t.id, t]));
    this.data = Object.assign({ backups: {}, log: [], settings: {} }, store.load() || {});
  }

  save() {
    this.store.save(this.data);
  }

  addLog(entry) {
    this.data.log.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    this.data.log.length = Math.min(this.data.log.length, 200);
  }

  get(id) {
    const t = this.tweaks.get(id);
    if (!t) throw new Error('不明な設定です: ' + id);
    return t;
  }

  // ids の状態をまとめて読む。{ id: 'on' | 'off' | 'partial' | 'unavailable' | 'error' }
  async status(ids = [...this.tweaks.keys()]) {
    const ops = [];
    const index = [];
    for (const id of ids) {
      const t = this.get(id);
      t.actions.forEach((a, i) => {
        const op = readOp(a, 'check');
        if (op) {
          index.push([id, i]);
          ops.push(op);
        }
      });
    }
    const res = await this.run(ops);
    const byTweak = {};
    index.forEach(([id, i], k) => {
      (byTweak[id] = byTweak[id] || {})[i] = res[k];
    });
    const out = {};
    for (const id of ids) {
      const t = this.get(id);
      const backedUp = !!this.data.backups[id];
      const rs = byTweak[id] || {};
      if (Object.values(rs).some((r) => r && !r.ok)) {
        out[id] = 'error';
        continue;
      }
      const m = t.actions.map((a, i) => actionMatches(a, rs[i], backedUp)).filter((x) => x !== null);
      if (m.length === 0) out[id] = 'unavailable';
      else if (m.every(Boolean)) out[id] = 'on';
      else if (m.some(Boolean)) out[id] = 'partial';
      else out[id] = 'off';
    }
    return out;
  }

  // 適用前の値を記録する。すでに記録があればそれを残す（最初の値に戻せるように）。
  async backup(id) {
    const t = this.get(id);
    const prev = this.data.backups[id];
    const ops = [];
    const idx = [];
    t.actions.forEach((a, i) => {
      if (prev && prev.actions[i] !== undefined) return;
      const op = a.t === 'ps' ? (a.backup ? readOp(a, 'backup') : null) : readOp(a);
      if (op) {
        idx.push(i);
        ops.push(op);
      }
    });
    const res = await this.run(ops);
    const actions = prev ? Object.assign({}, prev.actions) : {};
    idx.forEach((i, k) => {
      const r = res[k];
      if (!r.ok) throw new Error(`現在の値を読み取れませんでした: ${r.error}`);
      const a = t.actions[i];
      if (a.t === 'reg') actions[i] = r.exists ? { exists: true, kind: r.kind, value: r.value } : { exists: false };
      else if (a.t === 'svc') actions[i] = r.exists ? { exists: true, start: r.start } : { exists: false };
      else actions[i] = { value: r.value };
    });
    t.actions.forEach((a, i) => {
      if (a.t === 'ps' && !a.backup && actions[i] === undefined) actions[i] = { value: null };
    });
    this.data.backups[id] = { at: prev ? prev.at : new Date().toISOString(), actions };
    this.save();
  }

  async apply(id) {
    const t = this.get(id);
    await this.backup(id);
    const ops = t.actions.map((a) => {
      if (a.t === 'reg') return { op: 'regSet', path: a.path, name: a.name, kind: a.kind, value: a.value };
      if (a.t === 'svc') return { op: 'svcSet', name: a.name, start: a.start };
      return { op: 'ps', code: a.apply };
    });
    const res = await this.run(ops);
    const errors = res.filter((r) => !r.ok).map((r) => r.error);
    this.addLog({ type: 'apply', id, title: t.title, ok: errors.length === 0, errors });
    this.save();
    const state = (await this.status([id]))[id];
    return { id, ok: errors.length === 0, errors, state, reboot: t.reboot };
  }

  async revert(id) {
    const t = this.get(id);
    const b = this.data.backups[id];
    const ops = t.actions.map((a, i) => {
      const prev = b && b.actions[i];
      if (a.t === 'reg') {
        if (prev) {
          return prev.exists
            ? { op: 'regSet', path: a.path, name: a.name, kind: prev.kind, value: prev.value }
            : { op: 'regDel', path: a.path, name: a.name };
        }
        return a.def === null || a.def === undefined
          ? { op: 'regDel', path: a.path, name: a.name }
          : { op: 'regSet', path: a.path, name: a.name, kind: a.kind, value: a.def };
      }
      if (a.t === 'svc') {
        const start = prev && prev.exists ? prev.start : a.def;
        return { op: 'svcSet', name: a.name, start };
      }
      return { op: 'ps', code: a.revert, backup: prev ? prev.value : null };
    });
    const res = await this.run(ops);
    const errors = res.filter((r) => !r.ok).map((r) => r.error);
    if (errors.length === 0) delete this.data.backups[id];
    this.addLog({ type: 'revert', id, title: t.title, ok: errors.length === 0, errors });
    this.save();
    const state = (await this.status([id]))[id];
    return { id, ok: errors.length === 0, errors, state, reboot: t.reboot };
  }
}

// CPU 名から推奨設定のプロファイルを決める。
function cpuProfile(cpuName) {
  const name = String(cpuName || '');
  if (/Core\(TM\)\s+Ultra|Core Ultra/i.test(name)) return { id: 'intel-hybrid', label: 'Intel Core Ultra向け', hybrid: true };
  const m = name.match(/\bi[3579]-(\d{4,5})/i);
  if (m) {
    const n = m[1];
    const gen = n.length === 5 ? Number(n.slice(0, 2)) : Number(n[0]);
    if (gen >= 12) return { id: 'intel-hybrid', label: 'Intel 12世代以降向け', hybrid: true, gen };
    return { id: 'intel-legacy', label: 'Intel 11世代以下向け', hybrid: false, gen };
  }
  if (/Intel/i.test(name)) return { id: 'intel-legacy', label: 'Intel向け', hybrid: false };
  if (/Ryzen|Threadripper/i.test(name)) return { id: 'amd-ryzen', label: 'AMD Ryzen向け', hybrid: false };
  if (/AMD/i.test(name)) return { id: 'amd', label: 'AMD向け', hybrid: false };
  return { id: 'generic', label: '汎用', hybrid: false };
}

// プリセットに含まれる設定を、継承をたどって順番どおりに並べる。
function presetTweakIds(presets, presetId) {
  const p = presets.find((x) => x.id === presetId);
  if (!p) throw new Error('不明なプリセットです: ' + presetId);
  const base = p.extends ? presetTweakIds(presets, p.extends) : [];
  return [...base, ...p.tweaks.filter((id) => !base.includes(id))];
}

// システムに合わない設定を外す。{ include: [...], skipped: [{ id, reason }] }
function filterForSystem(tweakList, ids, sys) {
  const byId = new Map(tweakList.map((t) => [t.id, t]));
  const include = [];
  const skipped = [];
  for (const id of ids) {
    const t = byId.get(id);
    if (t.hybridUnsafe && sys.profile && sys.profile.hybrid) skipped.push({ id, reason: 'ハイブリッドCPU（Pコア/Eコア）では逆効果になるため' });
    else if (t.minRamGB && sys.ramGB && sys.ramGB < t.minRamGB - 0.5) skipped.push({ id, reason: `メモリが ${t.minRamGB}GB 未満のため` });
    else if (t.ssdOnly && sys.hasHdd) skipped.push({ id, reason: 'HDD を使っているため' });
    else include.push(id);
  }
  return { include, skipped };
}

module.exports = { TweakService, cpuProfile, presetTweakIds, filterForSystem, sameValue };
