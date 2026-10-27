'use strict';

// ブラウザでそのまま開いたとき（Electron の preload が無いとき）用のデモ API。
// 実際の PC は一切変更しない。画面の確認用。
(() => {
  if (window.api) return;
  const { categories, tweaks, presets } = window.module.exports;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (data) => ({ ok: true, data });
  const states = {};
  const backups = {};
  const log = [];
  tweaks.forEach((t, i) => {
    states[t.id] = i % 5 === 0 ? 'on' : 'off';
    if (states[t.id] === 'on') backups[t.id] = { at: new Date(Date.now() - i * 3600e3).toISOString() };
  });
  states['svc-fax'] = 'unavailable';
  const settings = { autoRestorePoint: true, showAdvanced: false };
  const sys = {
    os: 'Microsoft Windows 10 Home', version: '22H2', build: '19045.6456',
    cpu: 'AMD Ryzen 5 5500', cores: 6, threads: 12,
    gpus: ['NVIDIA GeForce RTX 2080'], ramGB: 15.9, hasHdd: true,
    disks: [{ media: 'SSD', sizeGB: 256 }, { media: 'HDD', sizeGB: 500 }],
    profile: { id: 'amd-ryzen', label: 'AMD Ryzen向け', hybrid: false },
  };
  const games = [{ exe: 'VALORANT-Win64-Shipping.exe', cpu: 3 }];
  let progressFn = () => {};

  const meta = (t) => ({
    id: t.id, cat: t.cat, title: t.title, desc: t.desc, detail: t.detail || '', risk: t.risk, reboot: t.reboot,
    actions: t.actions.map((a) => ({
      t: a.t,
      text: a.t === 'reg' ? `${a.path}\\${a.name} = ${a.kind === 'DWord' ? '0x' + (a.value >>> 0).toString(16) : a.value}` : a.t === 'svc' ? `サービス ${a.name} → ${a.start}` : 'PowerShell / コマンドで設定',
    })),
  });

  function plan(id) {
    const p = presets.find((x) => x.id === id);
    const base = p.extends ? plan(p.extends).all : [];
    const all = [...base, ...p.tweaks.filter((x) => !base.includes(x))];
    const include = [];
    const skipped = [];
    for (const tid of all) {
      const t = tweaks.find((x) => x.id === tid);
      if (t.minRamGB && sys.ramGB < t.minRamGB - 0.5) skipped.push({ id: tid, reason: `メモリが ${t.minRamGB}GB 未満のため` });
      else if (t.ssdOnly && sys.hasHdd) skipped.push({ id: tid, reason: 'HDD を使っているため' });
      else include.push(tid);
    }
    return { all, include, skipped };
  }

  async function setState(id, on) {
    await wait(350);
    const t = tweaks.find((x) => x.id === id);
    states[id] = on ? 'on' : 'off';
    if (on) backups[id] = backups[id] || { at: new Date().toISOString() };
    else delete backups[id];
    log.unshift({ at: new Date().toISOString(), type: on ? 'apply' : 'revert', id, title: t.title, ok: true, errors: [] });
    return { id, ok: true, errors: [], state: states[id], reboot: t.reboot };
  }

  let cpu = 18;
  window.api = {
    init: async () => ok({ version: 'demo', categories, tweaks: tweaks.map(meta), presets: presets.map(({ id, title, badge, desc, target }) => ({ id, title, badge, desc, target: target || null })), settings, isAdmin: true }),
    diagnose: async () => {
      await wait(600);
      // XL2420T を HDMI でつないだ想定（60Hz までしか選べない）
      return ok({ items: [
        { kind: 'memory', status: 'warn', title: 'メモリの速度', value: 'DDR4-2666（8GB + 8GB）', advice: 'Ryzen 5000 シリーズの公式対応は DDR4-3200 です。BIOS（OC Tweaker → DRAM Configuration）で XMP を有効にしてください。メモリ自体の定格が 2666 の場合は XMP では上がりません（手動で上げるか、3200 のメモリに交換）。' },
        { kind: 'display', status: 'ok', title: 'G2422C（メイン）', value: '1920×1080 180Hz（この接続での最大 180Hz）', advice: 'MSI G2422C は DisplayPort 1.2a・HDMI 2.0b のどちらでも 180Hz。RTX 2080 で G-SYNC Compatible（可変リフレッシュレート）を使うなら DisplayPort で接続してください。' },
        { kind: 'display', status: 'warn', title: 'XL2420T', value: '1920×1080 60Hz（この接続での最大 60Hz）', advice: 'このモニターは 120Hz まで出せますが、今の接続では 60Hz までしか選べません。BenQ XL2420T で 120Hz を出すには DisplayPort か DVI-DL で接続する必要があります（HDMI では 60Hz まで）。' },
      ] });
    },
    sysInfo: async () => (await wait(400), ok(sys)),
    usage: async () => {
      cpu = Math.max(3, Math.min(95, cpu + Math.round((Math.random() - 0.5) * 14)));
      return ok({ cpu, memUsed: 7.4 * 1024 ** 3, memTotal: 15.9 * 1024 ** 3, uptime: 3 * 3600 + 1240 });
    },
    status: async (ids) => (await wait(300), ok(ids ? Object.fromEntries(ids.map((i) => [i, states[i]])) : { ...states })),
    apply: async (id) => ok(await setState(id, true)),
    revert: async (id) => ok(await setState(id, false)),
    presetPlan: async (id) => {
      const { include, skipped } = plan(id);
      return ok({ include, skipped });
    },
    presetApply: async (id) => {
      const { include, skipped } = plan(id);
      progressFn({ phase: 'restore', text: '復元ポイントを作成しています…' });
      await wait(600);
      const results = [];
      for (const [i, tid] of include.entries()) {
        progressFn({ phase: 'apply', done: i, total: include.length, text: tweaks.find((t) => t.id === tid).title });
        results.push(await setState(tid, true));
      }
      return ok({ results, skipped, restorePoint: 'ok' });
    },
    presetRevert: async (id) => {
      const ids = plan(id).include.filter((t) => backups[t]);
      const results = [];
      for (const tid of ids) results.push(await setState(tid, false));
      return ok({ results });
    },
    backupList: async () => ok({ backups: Object.entries(backups).map(([id, b]) => ({ id, at: b.at, title: tweaks.find((t) => t.id === id).title })), log: log.slice(0, 100), file: '(demo)' }),
    revertAll: async () => {
      const results = [];
      for (const id of Object.keys(backups)) results.push(await setState(id, false));
      return ok({ results });
    },
    exportBackup: async () => ok(null),
    createRestorePoint: async () => (await wait(800), ok('ok')),
    cleanupScan: async () => (await wait(700), ok([
      { id: 'user-temp', title: 'ユーザーの一時ファイル', desc: '%TEMP% に残ったアプリの一時ファイル', bytes: 1.84 * 1024 ** 3 },
      { id: 'win-temp', title: 'Windowsの一時ファイル', desc: 'C:\\Windows\\Temp', bytes: 212 * 1024 ** 2 },
      { id: 'wu-cache', title: 'Windows Update のダウンロードキャッシュ', desc: 'インストール済みの更新プログラムのファイル', bytes: 3.1 * 1024 ** 3 },
      { id: 'crash-dumps', title: 'クラッシュダンプ', desc: 'アプリが異常終了したときの記録ファイル', bytes: 48 * 1024 ** 2 },
      { id: 'dx-cache', title: 'DirectX シェーダーキャッシュ', desc: '削除するとゲームの初回起動時に再生成されます（一時的にカクつくことがあります）', bytes: 640 * 1024 ** 2 },
      { id: 'nv-cache', title: 'NVIDIA シェーダーキャッシュ', desc: 'DXCache / GLCache。削除すると初回起動時に再生成されます', bytes: 1.2 * 1024 ** 3 },
      { id: 'recycle', title: 'ごみ箱', desc: 'すべてのドライブのごみ箱を空にします', bytes: 0 },
    ])),
    cleanupRun: async (ids) => (await wait(900), ok(ids.map((id) => ({ id, freed: 300 * 1024 ** 2, remaining: 0 })))),
    netAdapters: async () => (await wait(300), ok([{ index: 12, name: 'イーサネット', desc: 'Realtek PCIe GbE Family Controller', speed: '1 Gbps', dns: ['192.168.1.1'] }])),
    setDns: async () => (await wait(300), ok(null)),
    flushDns: async () => ok(null),
    ping: async () => (await wait(900), ok({ sent: 4, received: 4, avg: 9.5, min: 8, max: 12 })),
    gameList: async () => ok(games.slice()),
    gameSet: async (exe, p) => {
      if (!/\.exe$/i.test(exe)) return { ok: false, error: '実行ファイル名（〇〇.exe）を入力してください' };
      games.push({ exe, cpu: p === 'high' ? 3 : 6 });
      return ok(null);
    },
    gameRemove: async (exe) => {
      games.splice(games.findIndex((g) => g.exe === exe), 1);
      return ok(null);
    },
    setSetting: async (k, v) => ((settings[k] = v), ok({ ...settings })),
    open: async () => ok(null),
    reboot: async () => ok(null),
    relaunchAdmin: async () => ok(null),
    minimize() {},
    maximize() {},
    close() {},
    onProgress: (fn) => (progressFn = fn),
    onWinState() {},
  };
})();
