'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { categories, tweaks, presets } = require('../engine/tweaks');
const { TweakService, cpuProfile, presetTweakIds, filterForSystem } = require('../engine/service');
const tools = require('../engine/tools');

// レジストリとサービスをメモリ上で真似る偽の実行エンジン
function fakeMachine(initial = {}) {
  const reg = new Map(Object.entries(initial.reg || {}));
  const svcs = new Map(Object.entries(initial.svc || {}));
  const psState = new Map();
  const calls = [];
  const run = async (ops) => {
    calls.push(ops);
    return ops.map((op) => {
      const key = `${op.path}\\${op.name}`;
      switch (op.op) {
        case 'regGet':
          return reg.has(key) ? { ok: true, exists: true, ...reg.get(key) } : { ok: true, exists: false };
        case 'regSet':
          reg.set(key, { kind: op.kind, value: op.value });
          return { ok: true };
        case 'regDel':
          reg.delete(key);
          return { ok: true };
        case 'svcGet':
          return svcs.has(op.name) ? { ok: true, exists: true, start: svcs.get(op.name) } : { ok: true, exists: false };
        case 'svcSet':
          if (svcs.has(op.name)) svcs.set(op.name, op.start);
          return { ok: true };
        case 'ps': {
          // apply / revert / check / backup のコードを文字列で見分ける
          const owner = tweaks.find((t) => t.actions.some((a) => a.t === 'ps' && [a.apply, a.revert, a.check, a.backup].includes(op.code)));
          if (!owner) return { ok: true, value: null };
          const a = owner.actions.find((x) => x.t === 'ps');
          if (op.code === a.apply) psState.set(owner.id, true);
          if (op.code === a.revert) psState.set(owner.id, false);
          if (op.code === a.check) return { ok: true, value: psState.get(owner.id) === true };
          if (op.code === a.backup) return { ok: true, value: 'old-value' };
          return { ok: true, value: null };
        }
        default:
          return { ok: false, error: 'unknown op' };
      }
    });
  };
  return { run, reg, svcs, psState, calls };
}

function memStore() {
  let data = null;
  return { load: () => data, save: (d) => (data = JSON.parse(JSON.stringify(d))) };
}

test('設定の定義が正しい形をしている', () => {
  const ids = new Set();
  const catIds = new Set(categories.map((c) => c.id));
  for (const t of tweaks) {
    assert.ok(!ids.has(t.id), `id が重複: ${t.id}`);
    ids.add(t.id);
    assert.ok(catIds.has(t.cat), `不明なカテゴリ: ${t.id}`);
    assert.ok(['low', 'mid', 'high'].includes(t.risk), t.id);
    assert.ok(['none', 'logoff', 'reboot'].includes(t.reboot), t.id);
    assert.ok(t.title && t.desc, t.id);
    assert.ok(t.actions.length > 0, t.id);
    for (const a of t.actions) {
      if (a.t === 'reg') {
        assert.match(a.path, /^HK(CU|LM)\\[^\\]/, `${t.id}: ${a.path}`);
        assert.ok(!a.path.endsWith('\\'), t.id);
        assert.ok(['DWord', 'QWord', 'String', 'Binary', 'MultiString'].includes(a.kind), t.id);
        if (a.kind === 'DWord') {
          assert.ok(Number.isInteger(a.value) && a.value >= 0 && a.value <= 0xffffffff, `${t.id}: DWORD の範囲外`);
          assert.ok(a.def === null || (Number.isInteger(a.def) && a.def >= 0 && a.def <= 0xffffffff), `${t.id}: def の範囲外`);
        }
        if (a.kind === 'String') assert.strictEqual(typeof a.value, 'string', t.id);
        if (a.kind === 'Binary') assert.match(a.value, /^([0-9a-f]{2})+$/i, t.id);
        assert.ok(a.def !== undefined, `${t.id}: def（戻す値）が無い`);
      } else if (a.t === 'svc') {
        assert.match(a.name, /^[A-Za-z0-9_]+$/, t.id);
        assert.ok(['auto', 'delayed-auto', 'demand', 'disabled'].includes(a.start), t.id);
        assert.ok(['auto', 'delayed-auto', 'demand', 'disabled'].includes(a.def), t.id);
      } else {
        assert.strictEqual(a.t, 'ps', t.id);
        assert.ok(a.apply && a.revert, `${t.id}: apply と revert が必要`);
      }
    }
  }
});

test('プリセットは存在する設定だけを参照する', () => {
  const ids = new Set(tweaks.map((t) => t.id));
  for (const p of presets) {
    for (const id of presetTweakIds(presets, p.id)) assert.ok(ids.has(id), `${p.id}: ${id}`);
    assert.strictEqual(new Set(presetTweakIds(presets, p.id)).size, presetTweakIds(presets, p.id).length, p.id);
  }
  // 上級者向け（risk: high）はプリセットに入れない
  for (const p of presets) {
    for (const id of presetTweakIds(presets, p.id)) assert.notStrictEqual(tweaks.find((t) => t.id === id).risk, 'high', id);
  }
  // 電源プランは USB サスペンドより先に適用する（プランごとの設定のため）
  for (const p of presets) {
    const ids = presetTweakIds(presets, p.id);
    if (ids.includes('pwr-usbsuspend')) assert.ok(ids.indexOf('pwr-highperf') < ids.indexOf('pwr-usbsuspend'), p.id);
  }
});

test('SystemResponsiveness は有効な最小値の 10（10 未満は 20 扱い）', () => {
  const a = tweaks.find((t) => t.id === 'sys-responsiveness').actions[0];
  assert.strictEqual(a.value, 10);
});

test('レジストリ: 適用すると on、元に戻すと元の値に戻る', async () => {
  const m = fakeMachine({ reg: { 'HKCU\\Control Panel\\Desktop\\MenuShowDelay': { kind: 'String', value: '200' } } });
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  assert.strictEqual((await s.status(['sys-menudelay']))['sys-menudelay'], 'off');
  const r = await s.apply('sys-menudelay');
  assert.ok(r.ok);
  assert.strictEqual(r.state, 'on');
  assert.strictEqual(m.reg.get('HKCU\\Control Panel\\Desktop\\MenuShowDelay').value, '0');
  const r2 = await s.revert('sys-menudelay');
  assert.strictEqual(r2.state, 'off');
  // 既定値の 400 ではなく、適用前に入っていた 200 に戻る
  assert.strictEqual(m.reg.get('HKCU\\Control Panel\\Desktop\\MenuShowDelay').value, '200');
  assert.strictEqual(s.data.backups['sys-menudelay'], undefined);
});

test('レジストリ: 元々無かった値は戻すときに削除する', async () => {
  const m = fakeMachine();
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  await s.apply('pwr-throttling');
  assert.ok(m.reg.has('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling\\PowerThrottlingOff'));
  await s.revert('pwr-throttling');
  assert.ok(!m.reg.has('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling\\PowerThrottlingOff'));
});

test('2回適用しても最初の値を覚えている', async () => {
  const m = fakeMachine({ reg: { 'HKCU\\Control Panel\\Desktop\\MenuShowDelay': { kind: 'String', value: '123' } } });
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  await s.apply('sys-menudelay');
  await s.apply('sys-menudelay');
  await s.revert('sys-menudelay');
  assert.strictEqual(m.reg.get('HKCU\\Control Panel\\Desktop\\MenuShowDelay').value, '123');
});

test('バックアップが無いときは Windows 既定値に戻す', async () => {
  const m = fakeMachine({ reg: { 'HKCU\\Control Panel\\Desktop\\MenuShowDelay': { kind: 'String', value: '0' } } });
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  assert.strictEqual((await s.status(['sys-menudelay']))['sys-menudelay'], 'on');
  await s.revert('sys-menudelay');
  assert.strictEqual(m.reg.get('HKCU\\Control Panel\\Desktop\\MenuShowDelay').value, '400');
});

test('一部だけ変わっているときは partial', async () => {
  const m = fakeMachine({ reg: { 'HKCU\\Control Panel\\Mouse\\MouseSpeed': { kind: 'String', value: '0' } } });
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  assert.strictEqual((await s.status(['win-mouseaccel']))['win-mouseaccel'], 'partial');
});

test('DWORD の 0xFFFFFFFF を正しく比較する', async () => {
  const m = fakeMachine();
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  await s.apply('net-throttling');
  const v = m.reg.get('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\NetworkThrottlingIndex');
  assert.strictEqual(v.value, 0xffffffff);
  assert.strictEqual((await s.status(['net-throttling']))['net-throttling'], 'on');
});

test('サービス: 元のスタートアップの種類に戻す', async () => {
  const m = fakeMachine({ svc: { DiagTrack: 'delayed-auto' } });
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  await s.apply('svc-diagtrack');
  assert.strictEqual(m.svcs.get('DiagTrack'), 'disabled');
  assert.strictEqual((await s.status(['svc-diagtrack']))['svc-diagtrack'], 'on');
  await s.revert('svc-diagtrack');
  assert.strictEqual(m.svcs.get('DiagTrack'), 'delayed-auto');
});

test('サービス: 存在しないサービスは利用不可', async () => {
  const m = fakeMachine();
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  assert.strictEqual((await s.status(['svc-fax']))['svc-fax'], 'unavailable');
});

test('PowerShell: バックアップした値を revert に渡す', async () => {
  const m = fakeMachine();
  const s = new TweakService({ run: m.run, store: memStore(), tweaks });
  await s.apply('pwr-highperf');
  assert.strictEqual((await s.status(['pwr-highperf']))['pwr-highperf'], 'on');
  await s.revert('pwr-highperf');
  const revertOp = m.calls.flat().find((o) => o.op === 'ps' && o.code === tweaks.find((t) => t.id === 'pwr-highperf').actions[0].revert);
  assert.strictEqual(revertOp.backup, 'old-value');
});

test('書き込みに失敗したらバックアップを残す', async () => {
  const m = fakeMachine();
  const failing = async (ops) => (ops.some((o) => o.op === 'regDel') ? ops.map(() => ({ ok: false, error: 'アクセスが拒否されました' })) : m.run(ops));
  const s = new TweakService({ run: failing, store: memStore(), tweaks });
  await s.apply('pwr-throttling');
  const r = await s.revert('pwr-throttling');
  assert.ok(!r.ok);
  assert.deepStrictEqual(r.errors, ['アクセスが拒否されました']);
  assert.ok(s.data.backups['pwr-throttling']);
});

test('CPU 名から推奨プロファイルを判定する', () => {
  assert.strictEqual(cpuProfile('Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz').label, 'Intel 11世代以下向け');
  assert.strictEqual(cpuProfile('11th Gen Intel(R) Core(TM) i5-11400F @ 2.60GHz').label, 'Intel 11世代以下向け');
  assert.strictEqual(cpuProfile('12th Gen Intel(R) Core(TM) i5-12400F').hybrid, true);
  assert.strictEqual(cpuProfile('13th Gen Intel(R) Core(TM) i7-13700K').label, 'Intel 12世代以降向け');
  assert.strictEqual(cpuProfile('Intel(R) Core(TM) Ultra 7 155H').hybrid, true);
  assert.strictEqual(cpuProfile('AMD Ryzen 5 3400G with Radeon Vega Graphics').label, 'AMD Ryzen向け');
  assert.strictEqual(cpuProfile('AMD Ryzen 5 5500').label, 'AMD Ryzen向け');
});

test('システムに合わない設定を外す', () => {
  const ids = presetTweakIds(presets, 'performance');
  const hybrid = filterForSystem(tweaks, ids, { profile: { hybrid: true }, ramGB: 32, hasHdd: false });
  assert.ok(hybrid.skipped.some((s) => s.id === 'pwr-throttling'));
  const small = filterForSystem(tweaks, ids, { profile: { hybrid: false }, ramGB: 8, hasHdd: true });
  assert.ok(small.skipped.some((s) => s.id === 'mem-compression'));
  assert.ok(small.skipped.some((s) => s.id === 'svc-sysmain'));
  // 16GB 搭載で OS から 15.9GB に見える場合は 16GB として扱う
  const r16 = filterForSystem(tweaks, ids, { profile: { hybrid: false }, ramGB: 15.9, hasHdd: false });
  assert.ok(r16.include.includes('mem-compression'));
});

test('ゲームの実行ファイル名を検証する', () => {
  assert.ok(tools.validExe('VALORANT-Win64-Shipping.exe'));
  assert.ok(tools.validExe('cs2.exe'));
  assert.ok(!tools.validExe('..\\evil.exe'));
  assert.ok(!tools.validExe('a\\b.exe'));
  assert.ok(!tools.validExe("x'; Remove-Item C:\\ .exe"));
  assert.ok(!tools.validExe('game'));
});

test('専用プリセット: 今の構成（Ryzen 5 5500 / 16GB / HDD あり）で外れる設定が無い', () => {
  const p = presets.find((x) => x.id === 'mypc');
  assert.ok(p.target && p.target.cpu && p.target.gpu);
  const ids = presetTweakIds(presets, 'mypc');
  for (const id of presetTweakIds(presets, 'lowlatency')) assert.ok(ids.includes(id), id);
  assert.ok(ids.includes('pwr-hibernate'));
  assert.ok(!ids.includes('svc-sysmain'), 'HDD があるので SysMain は止めない');
  const r = filterForSystem(tweaks, ids, { profile: cpuProfile('AMD Ryzen 5 5500'), ramGB: 15.9, hasHdd: true });
  assert.deepStrictEqual(r.skipped, []);
});

test('PCのチェック: DDR4-2666 の Ryzen 5000 はメモリ速度を警告する', () => {
  const sys = { cpu: 'AMD Ryzen 5 5500' };
  const mem = [{ capacityGB: 8, configured: 2666, type: 26 }, { capacityGB: 8, configured: 2666, type: 26 }];
  const [m] = tools.assessDiagnosis({ memory: mem, displays: [] }, sys);
  assert.strictEqual(m.status, 'warn');
  assert.match(m.value, /DDR4-2666/);
  // 実クロック（半分の値）で返す BIOS でも同じ判定になる
  const half = tools.assessDiagnosis({ memory: mem.map((x) => ({ ...x, configured: 1333 })), displays: [] }, sys)[0];
  assert.match(half.value, /DDR4-2666/);
  const ok = tools.assessDiagnosis({ memory: mem.map((x) => ({ ...x, configured: 3200 })), displays: [] }, sys)[0];
  assert.strictEqual(ok.status, 'ok');
});

test('PCのチェック: モニターのリフレッシュレート', () => {
  const sys = { cpu: 'AMD Ryzen 5 5500' };
  const disp = (name, hz, maxHz, primary = false) => ({ name, hz, maxHz, width: 1920, height: 1080, primary });
  const a = tools.assessDiagnosis({ memory: [], displays: [
    disp('G2422C', 180, 180, true), // 正常
    disp('G2422C', 60, 180), // 選べるのに低いまま
    disp('XL2420T', 60, 60), // HDMI 接続で 60Hz までしか選べない
    disp('XL2420T', 120, 120),
    disp('Generic PnP Monitor', 60, 60), // 型番が分からないものは選べる最大で判定
  ] }, sys);
  assert.deepStrictEqual(a.map((x) => x.status), ['ok', 'warn', 'warn', 'ok', 'ok']);
  assert.match(a[0].title, /メイン/);
  assert.match(a[2].advice, /DisplayPort か DVI-DL/);
});
