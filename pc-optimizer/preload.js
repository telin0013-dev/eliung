'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  init: call('app:init'),
  sysInfo: call('sys:info'),
  usage: call('sys:usage'),
  status: call('tweak:status'),
  apply: call('tweak:apply'),
  revert: call('tweak:revert'),
  presetPlan: call('preset:plan'),
  presetApply: call('preset:apply'),
  presetRevert: call('preset:revert'),
  backupList: call('backup:list'),
  revertAll: call('backup:revertAll'),
  exportBackup: call('backup:export'),
  createRestorePoint: call('restore:create'),
  cleanupScan: call('cleanup:scan'),
  cleanupRun: call('cleanup:run'),
  netAdapters: call('net:adapters'),
  dnsProviders: call('net:dnsProviders'),
  setDns: call('net:setDns'),
  flushDns: call('net:flushDns'),
  ping: call('net:ping'),
  gameList: call('game:list'),
  gameSet: call('game:set'),
  gameRemove: call('game:remove'),
  setSetting: call('settings:set'),
  open: call('shell:open'),
  reboot: call('shell:reboot'),
  relaunchAdmin: call('app:relaunchAdmin'),
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, d) => fn(d)),
  onWinState: (fn) => ipcRenderer.on('win:state', (_e, d) => fn(d)),
});
