# HexaTune 実行エンジン
#
# runner.js が標準入力でこのスクリプトを渡し、先頭に $JobB64（命令列の JSON を Base64 にしたもの）を付ける。
# 命令ごとに try/catch し、結果の配列を JSON にしてマーカーで囲んで標準出力へ書く。
# 命令: regGet / regSet / regDel / svcGet / svcSet / ps

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$job = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($JobB64)) | ConvertFrom-Json

function Get-RegRoot([string]$path) {
    $i = $path.IndexOf('\')
    $hive = $path.Substring(0, $i)
    $sub = $path.Substring($i + 1)
    switch ($hive) {
        'HKCU' { return [Microsoft.Win32.Registry]::CurrentUser, $sub }
        'HKLM' { return [Microsoft.Win32.Registry]::LocalMachine, $sub }
        default { throw "未対応のハイブ: $hive" }
    }
}

function ConvertTo-Bytes([string]$hex) {
    $bytes = New-Object byte[] ($hex.Length / 2)
    for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
    return ,$bytes
}

function Read-Reg([string]$path, [string]$name) {
    $root, $sub = Get-RegRoot $path
    $key = $root.OpenSubKey($sub, $false)
    if ($null -eq $key) { return @{ exists = $false } }
    try {
        $v = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -eq $v) { return @{ exists = $false } }
        $kind = $key.GetValueKind($name).ToString()
        switch ($kind) {
            'DWord' { $v = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$v), 0) }
            'QWord' { $v = [BitConverter]::ToUInt64([BitConverter]::GetBytes([long]$v), 0) }
            'Binary' { $v = (($v | ForEach-Object { $_.ToString('x2') }) -join '') }
            'MultiString' { $v = @($v) }
        }
        return @{ exists = $true; kind = $kind; value = $v }
    } finally { $key.Close() }
}

function Write-Reg([string]$path, [string]$name, [string]$kind, $value) {
    $root, $sub = Get-RegRoot $path
    $key = $root.CreateSubKey($sub)
    try {
        switch ($kind) {
            'DWord' { $data = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$value), 0) }
            'QWord' { $data = [BitConverter]::ToInt64([BitConverter]::GetBytes([uint64]$value), 0) }
            'Binary' { $data = ConvertTo-Bytes ([string]$value) }
            'MultiString' { $data = [string[]]@($value) }
            default { $data = [string]$value }
        }
        $key.SetValue($name, $data, [Microsoft.Win32.RegistryValueKind]$kind)
    } finally { $key.Close() }
}

function Remove-Reg([string]$path, [string]$name) {
    $root, $sub = Get-RegRoot $path
    $key = $root.OpenSubKey($sub, $true)
    if ($null -eq $key) { return }
    try { $key.DeleteValue($name, $false) } finally { $key.Close() }
}

function Read-Svc([string]$name) {
    $r = Read-Reg "HKLM\SYSTEM\CurrentControlSet\Services\$name" 'Start'
    if (-not $r.exists) { return @{ exists = $false } }
    $start = switch ([int]$r.value) { 0 { 'boot' } 1 { 'system' } 2 { 'auto' } 3 { 'demand' } 4 { 'disabled' } default { 'unknown' } }
    if ($start -eq 'auto') {
        $d = Read-Reg "HKLM\SYSTEM\CurrentControlSet\Services\$name" 'DelayedAutostart'
        if ($d.exists -and [int]$d.value -eq 1) { $start = 'delayed-auto' }
    }
    return @{ exists = $true; start = $start }
}

function Write-Svc([string]$name, [string]$start) {
    if ($start -notin @('auto', 'delayed-auto', 'demand', 'disabled')) { throw "未対応のスタートアップの種類: $start" }
    if (-not (Read-Svc $name).exists) { return }
    $out = & sc.exe config $name start= $start 2>&1 | Out-String
    if ($LASTEXITCODE) { throw "sc.exe config $name が失敗しました: $($out.Trim())" }
    if ($start -eq 'disabled') { Stop-Service -Name $name -Force -ErrorAction SilentlyContinue }
    # 自動起動に戻したときは、再起動を待たずに起動しておく（他の設定が依存することがあるため）
    if ($start -in @('auto', 'delayed-auto')) { Start-Service -Name $name -ErrorAction SilentlyContinue }
}

function Invoke-Ps([string]$code, $backup) {
    $global:LASTEXITCODE = 0
    $sb = [scriptblock]::Create($code)
    $out = @(& $sb)
    if ($out.Count -eq 0) { return $null }
    $last = $out[$out.Count - 1]
    if ($last -is [bool] -or $last -is [string] -or $last -is [ValueType]) { return $last }
    return $out
}

$results = New-Object System.Collections.ArrayList
foreach ($op in $job) {
    try {
        $r = switch ($op.op) {
            'regGet' { Read-Reg $op.path $op.name }
            'regSet' { Write-Reg $op.path $op.name $op.kind $op.value; @{} }
            'regDel' { Remove-Reg $op.path $op.name; @{} }
            'svcGet' { Read-Svc $op.name }
            'svcSet' { Write-Svc $op.name $op.start; @{} }
            'ps' { @{ value = (Invoke-Ps $op.code $op.backup) } }
            default { throw "未対応の命令: $($op.op)" }
        }
        $r.ok = $true
        [void]$results.Add($r)
    } catch {
        [void]$results.Add(@{ ok = $false; error = $_.Exception.Message })
    }
}

$json = ConvertTo-Json -InputObject $results -Depth 8 -Compress
$bytes = [Text.Encoding]::UTF8.GetBytes("<<<HT_JSON>>>$json<<<HT_END>>>")
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Flush()
