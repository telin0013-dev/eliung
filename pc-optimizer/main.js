'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { categories, tweaks, presets } = require('./engine/tweaks');
const { createRunner } = require('./engine/runner');
const { TweakService, cpuProfile, presetTweakIds, filterForSystem } = require('./engine/service');
const tools = require('./engine/tools');

const run = createRunner();
const SMOKE = process.argv.includes('--smoke-test');
// CI の VM には GPU が無いので、スモークテストのときだけソフトウェア描画にする
if (SMOKE) app.disableHardwareAcceleration();
let win;
let service;
let sysInfoCache;

function createStore() {
  const file = path.join(app.getPath('userData'), 'hexatune-state.json');
  return {
    file,
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
  };
}

// 画面に渡すのは表示用の情報だけ（PowerShell のコードは渡さない）
function tweakMeta(t) {
  return {
    id: t.id, cat: t.cat, title: t.title, desc: t.desc, detail: t.detail || '', risk: t.risk, reboot: t.reboot,
    actions: t.actions.map((a) => {
      if (a.t === 'reg') return { t: 'reg', text: `${a.path}\\${a.name} = ${a.kind === 'DWord' ? '0x' + (a.value >>> 0).toString(16) : a.value}` };
      if (a.t === 'svc') return { t: 'svc', text: `サービス ${a.name} → ${a.start}` };
      return { t: 'ps', text: 'PowerShell / コマンドで設定' };
    }),
  };
}

async function getSysInfo() {
  if (!sysInfoCache) {
    const info = await tools.systemInfo(run);
    info.profile = cpuProfile(info.cpu);
    sysInfoCache = info;
  }
  return sysInfoCache;
}

function presetPlan(presetId, sys) {
  const ids = presetTweakIds(presets, presetId);
  return filterForSystem(tweaks, ids, sys);
}

function sendProgress(data) {
  if (win && !win.isDestroyed()) win.webContents.send('progress', data);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
}

function registerIpc() {
  handle('app:init', async () => ({
    version: app.getVersion(),
    categories,
    tweaks: tweaks.map(tweakMeta),
    presets: presets.map((p) => ({ id: p.id, title: p.title, badge: p.badge, desc: p.desc, target: p.target || null })),
    settings: service.data.settings,
    isAdmin: await tools.isAdmin(run),
  }));
  handle('sys:info', getSysInfo);
  handle('sys:usage', () => usage());
  handle('sys:diagnose', async () => {
    const [diag, sys] = await Promise.all([tools.diagnose(run), getSysInfo()]);
    return { items: tools.assessDiagnosis(diag, sys), raw: diag };
  });
  handle('tweak:status', (ids) => service.status(ids));
  handle('tweak:apply', (id) => service.apply(id));
  handle('tweak:revert', (id) => service.revert(id));

  handle('preset:plan', async (id) => {
    const sys = await getSysInfo();
    return presetPlan(id, sys);
  });
  handle('preset:apply', async (id) => {
    const sys = await getSysInfo();
    const plan = presetPlan(id, sys);
    let restorePoint = null;
    if (service.data.settings.autoRestorePoint !== false) {
      sendProgress({ phase: 'restore', text: '復元ポイントを作成しています…' });
      try {
        restorePoint = await tools.createRestorePoint(run, `HexaTune: ${id} を適用する前`);
      } catch (e) {
        restorePoint = 'error: ' + e.message;
      }
    }
    const results = [];
    for (const [i, tid] of plan.include.entries()) {
      sendProgress({ phase: 'apply', done: i, total: plan.include.length, text: tweaks.find((t) => t.id === tid).title });
      results.push(await service.apply(tid));
    }
    sendProgress({ phase: 'done' });
    service.addLog({ type: 'preset', id, title: presets.find((p) => p.id === id).title, ok: results.every((r) => r.ok), errors: [] });
    service.save();
    return { results, skipped: plan.skipped, restorePoint };
  });
  handle('preset:revert', async (id) => {
    const ids = presetTweakIds(presets, id).filter((t) => service.data.backups[t]).reverse();
    const results = [];
    for (const [i, tid] of ids.entries()) {
      sendProgress({ phase: 'revert', done: i, total: ids.length, text: tweaks.find((t) => t.id === tid).title });
      results.push(await service.revert(tid));
    }
    sendProgress({ phase: 'done' });
    return { results };
  });

  handle('backup:list', () => ({
    backups: Object.entries(service.data.backups).map(([id, b]) => ({ id, at: b.at, title: (tweaks.find((t) => t.id === id) || {}).title || id })),
    log: service.data.log.slice(0, 100),
    file: service.store.file,
  }));
  handle('backup:revertAll', async () => {
    const ids = Object.keys(service.data.backups).reverse();
    const results = [];
    for (const [i, id] of ids.entries()) {
      sendProgress({ phase: 'revert', done: i, total: ids.length, text: tweaks.find((t) => t.id === id).title });
      results.push(await service.revert(id));
    }
    sendProgress({ phase: 'done' });
    return { results };
  });
  handle('backup:export', async () => {
    const r = await dialog.showSaveDialog(win, {
      title: 'バックアップを書き出す',
      defaultPath: `hexatune-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(service.data, null, 2));
    return r.filePath;
  });
  handle('restore:create', () => tools.createRestorePoint(run, 'HexaTune: 手動で作成'));

  handle('cleanup:scan', () => tools.cleanupScan(run));
  handle('cleanup:run', (ids) => tools.cleanupRun(run, ids));

  handle('net:adapters', () => tools.networkAdapters(run));
  handle('net:dnsProviders', () => tools.dnsProviders);
  handle('net:setDns', (index, provider) => tools.setDns(run, index, provider));
  handle('net:flushDns', () => tools.flushDns(run));
  handle('net:ping', (host) => tools.pingTest(run, host));

  handle('game:list', () => tools.gameList(run));
  handle('game:set', (exe, priority) => tools.gameSet(run, exe, priority));
  handle('game:remove', (exe) => tools.gameRemove(run, exe));

  handle('settings:set', (key, value) => {
    if (!['autoRestorePoint', 'showAdvanced'].includes(key)) throw new Error('不明な設定です');
    service.data.settings[key] = !!value;
    service.save();
    return service.data.settings;
  });

  // 開けるのは決め打ちの Windows ツールだけ
  const openTargets = {
    rstrui: ['rstrui.exe'],
    sysprotect: ['SystemPropertiesProtection.exe'],
    services: ['mmc.exe', 'services.msc'],
    power: ['control.exe', 'powercfg.cpl'],
    graphics: ['explorer.exe', 'ms-settings:display-advancedgraphics'],
    display: ['explorer.exe', 'ms-settings:display-advanced'],
  };
  handle('shell:open', (target) => {
    const cmd = openTargets[target];
    if (!cmd) throw new Error('不明な対象です');
    spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore' }).unref();
  });
  handle('shell:reboot', () => {
    spawn('shutdown.exe', ['/r', '/t', '5'], { detached: true, stdio: 'ignore' }).unref();
  });
  handle('app:relaunchAdmin', () => {
    // 開発時（electron .）はアプリのフォルダを絶対パスで渡し直す
    const argv = app.isPackaged ? process.argv.slice(1) : [app.getAppPath(), ...process.argv.slice(2)];
    const args = argv.map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
    const code = `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' ${args ? `-ArgumentList ${args}` : ''} -Verb RunAs`;
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
  });

  ipcMain.on('win:minimize', () => win.minimize());
  ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('win:close', () => win.close());
}

// CPU 使用率は os.cpus() の差分から計算する（PowerShell を呼ばない）
let lastCpu = os.cpus();
function usage() {
  const now = os.cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i] ? lastCpu[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const d = (k) => c.times[k] - p[k];
    idle += d('idle');
    total += d('user') + d('nice') + d('sys') + d('idle') + d('irq');
  });
  lastCpu = now;
  const totalMem = os.totalmem();
  return {
    cpu: total > 0 ? Math.round((1 - idle / total) * 100) : 0,
    memUsed: totalMem - os.freemem(),
    memTotal: totalMem,
    uptime: os.uptime(),
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1000,
    minHeight: 640,
    frame: false,
    backgroundColor: '#050d22',
    title: 'HexaTune',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  // 外部リンクは既定のブラウザで開き、アプリ内では遷移させない
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (SMOKE) smokeTest();
}

// CI 用: 各画面を開いてスクリーンショットを保存し、画面のエラーがあれば終了コード 1 で終わる。
// 設定の変更は一切しない。
async function smokeTest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const outDir = process.env.HEXATUNE_SMOKE_DIR || app.getPath('temp');
  const errors = [];
  win.webContents.on('console-message', (e, level, message) => {
    const lvl = e && e.level !== undefined ? e.level : level;
    const msg = e && e.message !== undefined ? e.message : message;
    if (lvl === 'error' || lvl === 3) errors.push(msg);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('renderer gone: ' + d.reason));
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
  };
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await wait(15000);
  const steps = [
    ['home', "document.querySelector('[data-page=home]').click()"],
    ['basic', "document.querySelector('[data-page=basic]').click()"],
    ['windows', "document.querySelector('[data-cat=windows]').click()"],
    ['services', "document.querySelector('[data-page=basic]').click(); document.querySelector('[data-cat=services]').click()"],
    ['auto', "document.querySelector('[data-page=auto]').click()"],
    ['game', "document.querySelector('[data-page=game]').click()"],
    ['network', "document.querySelector('[data-page=network]').click()"],
    ['cleanup', "document.querySelector('[data-page=cleanup]').click(); document.querySelector('[data-act=cleanScan]').click()"],
    ['backup', "document.querySelector('[data-page=backup]').click()"],
    ['settings', "document.querySelector('[data-page=settings]').click()"],
  ];
  try {
    for (const [name, code] of steps) {
      await js(code);
      await wait(name === 'auto' || name === 'cleanup' ? 12000 : 5000);
      await shot(name);
      const text = await js('document.querySelector("#main").innerText');
      console.log(`[smoke] ${name}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  } catch (e) {
    errors.push(String(e && e.message ? e.message : e));
  }
  console.log('[smoke] errors: ' + JSON.stringify(errors));
  app.exit(errors.length ? 1 : 0);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    service = new TweakService({ run, store: createStore(), tweaks });
    registerIpc();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
