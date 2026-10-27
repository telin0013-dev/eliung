'use strict';

// 設定のオン・オフ以外の機能（システム情報、クリーンアップ、DNS、ゲームの優先度、復元ポイント）。

async function ps(run, code) {
  const [r] = await run([{ op: 'ps', code }]);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const psString = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function isAdmin(run) {
  return ps(run, '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)');
}

async function systemInfo(run) {
  const json = await ps(run, `
$os = Get-CimInstance Win32_OperatingSystem
$cv = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic Display|Remote' } | ForEach-Object { $_.Name })
$disks = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { @{ name = $_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; sizeGB = [math]::Round($_.Size / 1GB) } })
$ver = if ($cv.DisplayVersion) { $cv.DisplayVersion } else { $cv.ReleaseId }
@{
  os = $os.Caption.Trim(); version = $ver; build = "$($cv.CurrentBuild).$($cv.UBR)"
  cpu = $cpu.Name.Trim(); cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors
  gpus = $gpus; ramGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1); disks = $disks
  bootTime = $os.LastBootUpTime.ToString('o')
} | ConvertTo-Json -Depth 4 -Compress`);
  const info = JSON.parse(json);
  // Get-PhysicalDisk の MediaType は HDD / SSD / Unspecified
  info.hasHdd = (info.disks || []).some((d) => d.media === 'HDD');
  return info;
}

// ───────── クリーンアップ ─────────
const cleanupTargets = [
  { id: 'user-temp', title: 'ユーザーの一時ファイル', desc: '%TEMP% に残ったアプリの一時ファイル', dir: '$env:TEMP' },
  { id: 'win-temp', title: 'Windowsの一時ファイル', desc: 'C:\\Windows\\Temp', dir: '"$env:SystemRoot\\Temp"' },
  { id: 'wu-cache', title: 'Windows Update のダウンロードキャッシュ', desc: 'インストール済みの更新プログラムのファイル', dir: '"$env:SystemRoot\\SoftwareDistribution\\Download"' },
  { id: 'crash-dumps', title: 'クラッシュダンプ', desc: 'アプリが異常終了したときの記録ファイル', dir: '"$env:LOCALAPPDATA\\CrashDumps"' },
  { id: 'dx-cache', title: 'DirectX シェーダーキャッシュ', desc: '削除するとゲームの初回起動時に再生成されます（一時的にカクつくことがあります）', dir: '"$env:LOCALAPPDATA\\D3DSCache"' },
  { id: 'nv-cache', title: 'NVIDIA シェーダーキャッシュ', desc: 'DXCache / GLCache。削除すると初回起動時に再生成されます', dir: '"$env:LOCALAPPDATA\\NVIDIA\\DXCache", "$env:LOCALAPPDATA\\NVIDIA\\GLCache"' },
  { id: 'recycle', title: 'ごみ箱', desc: 'すべてのドライブのごみ箱を空にします', special: 'recycle' },
];

function sizeCode(t) {
  if (t.special === 'recycle') {
    return "$s = 0; (New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $s += [long]$_.ExtendedProperty('Size') }; $s";
  }
  return `$s = 0; foreach ($d in @(${t.dir})) { if (Test-Path -LiteralPath $d) { $m = Get-ChildItem -LiteralPath $d -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum; if ($m.Sum) { $s += $m.Sum } } }; [long]$s`;
}

function cleanCode(t) {
  if (t.special === 'recycle') return 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue';
  // 使用中のファイルは消せないので飛ばす
  return `foreach ($d in @(${t.dir})) { if (Test-Path -LiteralPath $d) { Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue } }`;
}

async function cleanupScan(run) {
  const res = await run(cleanupTargets.map((t) => ({ op: 'ps', code: sizeCode(t) })));
  return cleanupTargets.map((t, i) => ({
    id: t.id, title: t.title, desc: t.desc,
    bytes: res[i].ok ? Number(res[i].value) || 0 : 0,
    error: res[i].ok ? null : res[i].error,
  }));
}

async function cleanupRun(run, ids) {
  const targets = cleanupTargets.filter((t) => ids.includes(t.id));
  const ops = [];
  for (const t of targets) ops.push({ op: 'ps', code: sizeCode(t) }, { op: 'ps', code: cleanCode(t) }, { op: 'ps', code: sizeCode(t) });
  const res = await run(ops);
  return targets.map((t, i) => {
    const [before, clean, after] = res.slice(i * 3, i * 3 + 3);
    const freed = before.ok && after.ok ? Math.max(0, Number(before.value) - Number(after.value)) : 0;
    return { id: t.id, freed, remaining: after.ok ? Number(after.value) : 0, error: clean.ok ? null : clean.error };
  });
}

// ───────── ネットワーク ─────────
const dnsProviders = {
  auto: { title: '自動（プロバイダー）', servers: null },
  cloudflare: { title: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'] },
  google: { title: 'Google Public DNS', servers: ['8.8.8.8', '8.8.4.4'] },
  quad9: { title: 'Quad9', servers: ['9.9.9.9', '149.112.112.112'] },
};

async function networkAdapters(run) {
  const json = await ps(run, `
@(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | ForEach-Object {
  $dns = @((Get-DnsClientServerAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
  @{ index = $_.ifIndex; name = $_.Name; desc = $_.InterfaceDescription; speed = $_.LinkSpeed; dns = $dns }
}) | ConvertTo-Json -Depth 3 -Compress`);
  if (!json) return [];
  return [].concat(JSON.parse(json));
}

async function setDns(run, index, provider) {
  const p = dnsProviders[provider];
  if (!p || !Number.isInteger(index)) throw new Error('DNS の指定が正しくありません');
  const code = p.servers
    ? `Set-DnsClientServerAddress -InterfaceIndex ${index} -ServerAddresses ${p.servers.map(psString).join(',')}`
    : `Set-DnsClientServerAddress -InterfaceIndex ${index} -ResetServerAddresses`;
  await ps(run, code + '; Clear-DnsClientCache');
}

async function flushDns(run) {
  await ps(run, 'Clear-DnsClientCache');
}

async function pingTest(run, host) {
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error('ホスト名が正しくありません');
  const json = await ps(run, `
$r = @(Test-Connection -ComputerName ${psString(host)} -Count 4 -ErrorAction SilentlyContinue)
@{ sent = 4; received = $r.Count; avg = if ($r.Count) { [math]::Round(($r | Measure-Object ResponseTime -Average).Average, 1) } else { $null }; min = if ($r.Count) { ($r | Measure-Object ResponseTime -Minimum).Minimum } else { $null }; max = if ($r.Count) { ($r | Measure-Object ResponseTime -Maximum).Maximum } else { $null } } | ConvertTo-Json -Compress`);
  return JSON.parse(json);
}

// ───────── ゲームごとのCPU優先度（IFEO PerfOptions）─────────
const IFEO = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options';
const priorityClasses = { high: 3, abovenormal: 6, normal: 2 };

function validExe(exe) {
  return /^[\w\-. ()]{1,120}\.exe$/i.test(exe) && !exe.includes('..');
}

async function gameList(run) {
  const json = await ps(run, `
@(Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options' -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Join-Path $_.PSPath 'PerfOptions'
  if (Test-Path $p) { $v = (Get-ItemProperty $p -ErrorAction SilentlyContinue).CpuPriorityClass; if ($v) { @{ exe = $_.PSChildName; cpu = [int]$v } } }
}) | ConvertTo-Json -Compress`);
  if (!json) return [];
  return [].concat(JSON.parse(json));
}

async function gameSet(run, exe, priority) {
  if (!validExe(exe)) throw new Error('実行ファイル名（〇〇.exe）を入力してください');
  const v = priorityClasses[priority];
  if (!v) throw new Error('優先度の指定が正しくありません');
  const [r] = await run([{ op: 'regSet', path: `${IFEO}\\${exe}\\PerfOptions`, name: 'CpuPriorityClass', kind: 'DWord', value: v }]);
  if (!r.ok) throw new Error(r.error);
}

async function gameRemove(run, exe) {
  if (!validExe(exe)) throw new Error('実行ファイル名が正しくありません');
  // PerfOptions の値だけ消す。IFEO の他の設定（デバッガ指定など）は触らない。
  await ps(run, `
$k = Join-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options' ${psString(exe)}
$p = Join-Path $k 'PerfOptions'
if (Test-Path $p) {
  Remove-ItemProperty $p -Name CpuPriorityClass -ErrorAction SilentlyContinue
  if (-not (Get-Item $p).Property -and -not (Get-ChildItem $p)) { Remove-Item $p }
  if (-not (Get-Item $k).Property -and -not (Get-ChildItem $k)) { Remove-Item $k }
}`);
}

// ───────── 復元ポイント ─────────
// Windows は既定で 24 時間に1つしか復元ポイントを作らないため、一時的に頻度の制限を外して作る。
async function createRestorePoint(run, description) {
  return ps(run, `
$key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore'
if (-not (Get-Command Checkpoint-Computer -ErrorAction SilentlyContinue) -or -not (Test-Path $key)) { throw 'この Windows はシステムの復元に対応していません' }
$old = (Get-ItemProperty $key -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency
New-ItemProperty $key -Name SystemRestorePointCreationFrequency -PropertyType DWord -Value 0 -Force | Out-Null
try {
  Checkpoint-Computer -Description ${psString(description)} -RestorePointType MODIFY_SETTINGS -WarningVariable w -WarningAction SilentlyContinue
} catch {
  throw "復元ポイントを作成できませんでした。システムの保護（Cドライブ）が無効になっている可能性があります。（$($_.Exception.Message)）"
} finally {
  if ($null -eq $old) { Remove-ItemProperty $key -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue }
  else { New-ItemProperty $key -Name SystemRestorePointCreationFrequency -PropertyType DWord -Value $old -Force | Out-Null }
}
if ($w) { "warning: $w" } else { 'ok' }`);
}

module.exports = {
  isAdmin, systemInfo, cleanupTargets, cleanupScan, cleanupRun,
  dnsProviders, networkAdapters, setDns, flushDns, pingTest,
  gameList, gameSet, gameRemove, validExe, createRestorePoint,
};
