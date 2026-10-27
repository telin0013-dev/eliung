'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENGINE = fs.readFileSync(path.join(__dirname, 'engine.ps1'), 'utf8');

// 標準入力を UTF-8 で全部読み、スクリプトブロックとして実行するだけの起動用コマンド。
// スクリプトを一時ファイルに置かないので、管理者権限で動くスクリプトを他のプロセスに差し替えられない。
const BOOTSTRAP = [
  '$ms = New-Object IO.MemoryStream',
  '[Console]::OpenStandardInput().CopyTo($ms)',
  '$s = [Text.Encoding]::UTF8.GetString($ms.ToArray())',
  '. ([scriptblock]::Create($s))',
].join('; ');

function powershellPath() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function runOnce(ops, timeoutMs) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(BOOTSTRAP, 'utf16le').toString('base64');
    const child = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true },
    );
    const out = [];
    const err = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PowerShell の応答がありません（タイムアウト）'));
    }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('utf8');
      const m = text.match(/<<<HT_JSON>>>([\s\S]*)<<<HT_END>>>/);
      if (!m) {
        const detail = (Buffer.concat(err).toString('utf8') || text).trim().slice(0, 500);
        reject(new Error('PowerShell の実行に失敗しました: ' + detail));
        return;
      }
      resolve(JSON.parse(m[1]));
    });
    const job = Buffer.from(JSON.stringify(ops), 'utf8').toString('base64');
    child.stdin.end(`$JobB64 = '${job}'\n${ENGINE}`, 'utf8');
  });
}

// PowerShell の呼び出しは1つずつ順番に行う（同じ値を同時に書き換えないように）。
function createRunner({ timeoutMs = 120000 } = {}) {
  let queue = Promise.resolve();
  return function run(ops) {
    if (ops.length === 0) return Promise.resolve([]);
    const p = queue.then(() => runOnce(ops, timeoutMs));
    queue = p.catch(() => {});
    return p;
  };
}

module.exports = { createRunner };
