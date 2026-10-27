'use strict';

// Windows 実機（GitHub Actions の使い捨て VM）で、すべての設定を実際に適用→元に戻すテスト。
// 自分の PC では実行しないこと（設定が一時的に変わる）。CI の windows-latest で管理者として動く。
//   node test/windows-smoke.js

const { tweaks } = require('../engine/tweaks');
const { createRunner } = require('../engine/runner');
const { TweakService, cpuProfile } = require('../engine/service');
const tools = require('../engine/tools');

if (process.platform !== 'win32') {
  console.log('Windows 以外では実行しません');
  process.exit(0);
}

const run = createRunner();
const failures = [];
// 仮想マシンでは使えない機能なので、失敗しても許容するもの
const VM_LIMITS = [['復元 pwr-hibernate', /not supported|サポートされていません/i]];
const fail = (what, detail) => {
  if (VM_LIMITS.some(([w, re]) => w === what && re.test(detail))) {
    console.log(`  VM  ${what}: ${detail}（仮想マシンでは休止状態が使えないため許容）`);
    return;
  }
  failures.push(`${what}: ${detail}`);
  console.log(`  NG  ${what}: ${detail}`);
};

async function parseCheck() {
  // すべての PowerShell 片を構文解析する（実行しない分岐も含めて確かめるため）
  const snippets = [];
  for (const t of tweaks) {
    for (const a of t.actions) {
      if (a.t !== 'ps') continue;
      for (const k of ['apply', 'revert', 'check', 'backup']) if (a[k]) snippets.push([`${t.id}.${k}`, a[k]]);
    }
  }
  // コード片は Base64 で渡し、PowerShell 側で戻してから解析する
  const ops = snippets.map(([, code]) => ({
    op: 'ps',
    code: `$src = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(code, 'utf8').toString('base64')}')); $e = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$null, [ref]$e); [string](($e | ForEach-Object { $_.Message }) -join ' / ')`,
  }));
  const res = await run(ops);
  console.log(`構文チェック: ${snippets.length} 件`);
  res.forEach((r, i) => {
    if (!r.ok) fail(`構文 ${snippets[i][0]}`, r.error);
    else if (r.value) fail(`構文 ${snippets[i][0]}`, r.value);
  });
}

async function main() {
  console.log('管理者:', await tools.isAdmin(run));
  const info = await tools.systemInfo(run);
  console.log('システム:', JSON.stringify(info));
  console.log('プロファイル:', JSON.stringify(cpuProfile(info.cpu)));

  await parseCheck();

  let data = null;
  const store = { load: () => data, save: (d) => (data = d) };
  const service = new TweakService({ run, store, tweaks });
  const before = await service.status();
  console.log('初期状態:', JSON.stringify(before));
  for (const [id, st] of Object.entries(before)) if (st === 'error') fail(`状態 ${id}`, '読み取りエラー');

  console.log('\n適用 → 元に戻す:');
  for (const t of tweaks) {
    if (before[t.id] === 'unavailable') {
      console.log(`  --  ${t.id}（この環境では利用不可）`);
      continue;
    }
    try {
      const a = await service.apply(t.id);
      if (!a.ok) {
        fail(`適用 ${t.id}`, a.errors.join(' / '));
        continue;
      }
      if (a.state !== 'on') fail(`適用 ${t.id}`, `適用後の状態が ${a.state}`);
      const r = await service.revert(t.id);
      if (!r.ok) fail(`復元 ${t.id}`, r.errors.join(' / '));
      else if (before[t.id] !== 'on' && r.state === 'on') fail(`復元 ${t.id}`, '元に戻した後も on のまま');
      else if (before[t.id] !== r.state && !(before[t.id] === 'partial' && r.state === 'off')) {
        console.log(`  ??  ${t.id}: 初期 ${before[t.id]} → 復元後 ${r.state}`);
      }
      if (a.ok && a.state === 'on' && r.ok) console.log(`  OK  ${t.id}`);
    } catch (e) {
      fail(`例外 ${t.id}`, e.message);
    }
  }

  console.log('\nツール:');
  const scan = await tools.cleanupScan(run);
  console.log('  クリーンアップ:', scan.map((s) => `${s.id}=${s.bytes}${s.error ? '(err ' + s.error + ')' : ''}`).join(', '));
  const adapters = await tools.networkAdapters(run);
  console.log('  アダプター:', JSON.stringify(adapters));
  await tools.flushDns(run);
  console.log('  ping:', JSON.stringify(await tools.pingTest(run, '127.0.0.1')));
  await tools.gameSet(run, 'hexatune-test.exe', 'high');
  const games = await tools.gameList(run);
  if (!games.some((g) => g.exe === 'hexatune-test.exe' && g.cpu === 3)) fail('ゲーム優先度', JSON.stringify(games));
  await tools.gameRemove(run, 'hexatune-test.exe');
  if ((await tools.gameList(run)).some((g) => g.exe === 'hexatune-test.exe')) fail('ゲーム優先度の解除', '残っている');
  else console.log('  OK  ゲーム優先度の登録と解除');
  try {
    console.log('  復元ポイント:', await tools.createRestorePoint(run, 'HexaTune CI'));
  } catch (e) {
    // Windows Server には Checkpoint-Computer が無いので、ここは情報表示だけにする
    console.log('  復元ポイント（Server では非対応）:', e.message);
  }

  console.log(`\n失敗: ${failures.length} 件`);
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
