'use strict';

// 各設定（tweak）の定義。
//
// actions の種類:
//   reg … レジストリ値。value を書き込む。def は「バックアップが無いときに戻す値」（Windows 既定値）。
//         def が null なら既定では値が存在しないので、戻すときは削除する。
//   svc … サービスのスタートアップの種類。start / def は
//         'auto' | 'delayed-auto' | 'demand' | 'disabled'。
//   ps  … PowerShell。apply / revert / check（真偽を返す）/ backup（文字列を返す）。
//         revert では $backup にバックアップした値（無ければ $null）が入る。
//
// reboot: 'none' | 'logoff'（サインアウトで反映）| 'reboot'（再起動で反映）
// risk:   'low' | 'mid' | 'high'（high は「上級者向け設定を表示」をオンにしたときだけ出す）

const HKCU = 'HKCU\\';
const HKLM = 'HKLM\\';
const CDM = HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager';
const EXPLORER_ADV = HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced';
const DESKTOP = HKCU + 'Control Panel\\Desktop';
const FS = HKLM + 'SYSTEM\\CurrentControlSet\\Control\\FileSystem';
const MM = HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management';
const SYSPROFILE = HKLM + 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';
const GAMES_TASK = SYSPROFILE + '\\Tasks\\Games';
const GAMECONFIG = HKCU + 'System\\GameConfigStore';
const GFX = HKLM + 'SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers';

const dword = (path, name, value, def) => ({ t: 'reg', path, name, kind: 'DWord', value, def });
const str = (path, name, value, def) => ({ t: 'reg', path, name, kind: 'String', value, def });
const svc = (name, start, def) => ({ t: 'svc', name, start, def });

const USB_SUSPEND = '2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226';
const HIGH_PERF = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';

const categories = [
  { id: 'windows', title: 'Windows設定', desc: 'Windowsシステムの詳細な設定', icon: 'monitor' },
  { id: 'boot', title: 'システムブート設定', desc: 'Windowsの起動時の動作とカーネル設定', icon: 'cpu' },
  { id: 'fs', title: 'ファイルシステム設定', desc: 'NTFSファイルシステムのパフォーマンス最適化', icon: 'drive' },
  { id: 'memory', title: 'メモリ管理設定', desc: 'システムメモリの管理と最適化', icon: 'database' },
  { id: 'power', title: '電源管理設定', desc: '電源管理とパフォーマンスの最適化', icon: 'battery' },
  { id: 'system', title: 'システム最適化設定', desc: 'システムレベルの最適化と応答性の向上', icon: 'gear' },
  { id: 'resource', title: 'リソースポリシー設定', desc: 'CPU・メモリ・プロセスのリソース管理を最適化', icon: 'layers' },
  { id: 'privacy', title: 'プライバシー設定', desc: 'Windowsのプライバシーとデータ収集の制御', icon: 'shield' },
  { id: 'directx', title: 'DirectX & DXGKrnl', desc: 'DirectXとグラフィックスカーネルの最適化', icon: 'cube' },
  { id: 'services', title: 'サービス最適化', desc: '不要なWindowsサービスを無効化', icon: 'server' },
  { id: 'input', title: '入力デバイス最適化', desc: 'キーボード・マウス・USBデバイスのレスポンスと精度を向上', icon: 'mouse' },
  // 以下は基本設定のグリッドには出さず、専用ページで使う
  { id: 'game', title: 'ゲーム', desc: 'ゲーム向けの設定', icon: 'gamepad', hidden: true },
  { id: 'network', title: 'ネットワーク', desc: 'ネットワークの遅延と帯域の設定', icon: 'wifi', hidden: true },
];

const tweaks = [
  // ───────── Windows設定 ─────────
  {
    id: 'win-notifications', cat: 'windows', risk: 'low', reboot: 'none',
    title: '通知を無効にする',
    desc: 'Windowsのトースト通知を無効にして、ゲーム中の割り込みを防ぎます',
    detail: 'アプリからのポップアップ通知（トースト）を表示しなくなります。通知センターの履歴にも残らなくなります。',
    actions: [dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications', 'ToastEnabled', 0, 1)],
  },
  {
    id: 'win-snap', cat: 'windows', risk: 'low', reboot: 'logoff',
    title: 'ウィンドウの自動整列を無効化',
    desc: 'ウィンドウを画面端にドラッグしたときの自動整列（スナップ）機能を無効にします',
    detail: '設定 → システム → マルチタスク の「ウィンドウのスナップ」と同じ設定です。',
    actions: [str(DESKTOP, 'WindowArrangementActive', '0', '1')],
  },
  {
    id: 'win-visualfx', cat: 'windows', risk: 'low', reboot: 'logoff',
    title: '縮小版を表示する、その他の視覚効果をオフ（パフォーマンス優先）',
    desc: 'アイコンの縮小版（サムネイル）表示は残し、アニメーションや影などの視覚効果を無効にします',
    detail: '「パフォーマンスオプション」の「パフォーマンスを優先する」相当（UserPreferencesMask）に、縮小版表示を残した構成です。フォントのスムージング（ClearType）は変更しません。',
    actions: [
      dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', 'VisualFXSetting', 3, 0),
      { t: 'reg', path: DESKTOP, name: 'UserPreferencesMask', kind: 'Binary', value: '9012038010000000', def: '9e1e078012000000' },
      dword(EXPLORER_ADV, 'IconsOnly', 0, 0),
      dword(EXPLORER_ADV, 'ListviewShadow', 0, 1),
    ],
  },
  {
    id: 'win-mouseaccel', cat: 'windows', risk: 'low', reboot: 'logoff',
    title: 'ポインターの精度を高めるを無効',
    desc: 'ポインター精度を高める設定を無効にし、マウス加速を無効にします',
    detail: 'マウスを動かした距離とカーソル移動量が比例するようになり、エイムの再現性が上がります。コントロールパネル → マウス → ポインターオプションの同名項目と同じです。',
    actions: [
      str(HKCU + 'Control Panel\\Mouse', 'MouseSpeed', '0', '1'),
      str(HKCU + 'Control Panel\\Mouse', 'MouseThreshold1', '0', '6'),
      str(HKCU + 'Control Panel\\Mouse', 'MouseThreshold2', '0', '10'),
    ],
  },
  {
    id: 'win-transparency', cat: 'windows', risk: 'low', reboot: 'none',
    title: '透過効果を無効にする',
    desc: 'タスクバーやスタートメニューの透過効果を無効にして、グラフィックス処理を軽減します',
    actions: [dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 0, 1)],
  },
  {
    id: 'win-animations', cat: 'windows', risk: 'low', reboot: 'logoff',
    title: 'アニメーションを無効にする',
    desc: 'ウィンドウの最小化・最大化やタスクバーのアニメーションを無効にします',
    actions: [
      str(DESKTOP + '\\WindowMetrics', 'MinAnimate', '0', '1'),
      dword(EXPLORER_ADV, 'TaskbarAnimations', 0, 1),
    ],
  },
  {
    id: 'win-contentdelivery', cat: 'windows', risk: 'low', reboot: 'none',
    title: 'Windowsの不要な機能を無効化',
    desc: 'おすすめアプリの自動インストール、スタートメニューの提案、ヒント表示を無効にします',
    detail: 'ContentDeliveryManager（コンテンツ配信）の自動インストール・提案・ヒントをオフにします。',
    actions: [
      dword(CDM, 'SilentInstalledAppsEnabled', 0, 1),
      dword(CDM, 'SystemPaneSuggestionsEnabled', 0, 1),
      dword(CDM, 'SoftLandingEnabled', 0, 1),
      dword(CDM, 'SubscribedContent-338388Enabled', 0, 1),
      dword(CDM, 'SubscribedContent-338389Enabled', 0, 1),
    ],
  },
  {
    id: 'win-explorer', cat: 'windows', risk: 'low', reboot: 'none',
    title: 'エクスプローラーの不要な機能を無効化',
    desc: 'クイックアクセスの「最近使用したファイル」「よく使用するフォルダー」の記録と表示を無効にします',
    actions: [
      dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer', 'ShowRecent', 0, 1),
      dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer', 'ShowFrequent', 0, 1),
      dword(EXPLORER_ADV, 'Start_TrackDocs', 0, 1),
    ],
  },

  // ───────── システムブート設定 ─────────
  {
    id: 'boot-startupdelay', cat: 'boot', risk: 'low', reboot: 'reboot',
    title: 'スタートアップアプリの起動遅延を無効化',
    desc: 'サインイン後にスタートアップアプリを遅らせて起動する待ち時間をなくします',
    actions: [dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize', 'StartupDelayInMSec', 0, null)],
  },
  {
    id: 'boot-fastboot', cat: 'boot', risk: 'low', reboot: 'reboot',
    title: '高速スタートアップを無効化',
    desc: 'シャットダウンのたびにカーネルを完全に終了させ、ドライバ更新やデュアルブートの不具合を防ぎます',
    detail: '起動は数秒遅くなることがあります。休止状態を無効にすると、この機能も使えなくなります。',
    actions: [dword(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power', 'HiberbootEnabled', 0, 1)],
  },
  {
    id: 'boot-dynamictick', cat: 'boot', risk: 'low', reboot: 'reboot',
    title: 'ダイナミックティックを無効化',
    desc: 'アイドル時にタイマー割り込みを止める省電力機能を無効にし、タイマー精度を安定させます',
    detail: 'bcdedit /set disabledynamictick yes を実行します。消費電力はわずかに増えます。戻すときは disabledynamictick の値を削除します。',
    actions: [{
      t: 'ps',
      apply: "bcdedit /set '{current}' disabledynamictick yes | Out-Null; if ($LASTEXITCODE) { throw 'bcdedit が失敗しました' }",
      revert: "bcdedit /deletevalue '{current}' disabledynamictick | Out-Null",
      check: "[bool]((bcdedit /enum '{current}' | Out-String) -match '(?im)^disabledynamictick\\s+(Yes|はい)')",
    }],
  },

  // ───────── ファイルシステム設定 ─────────
  {
    id: 'fs-8dot3', cat: 'fs', risk: 'low', reboot: 'reboot',
    title: '8.3形式の短いファイル名の作成を無効化',
    desc: 'MS-DOS互換の短いファイル名（PROGRA~1 など）を新しいファイルに作らなくなり、ファイル作成が軽くなります',
    detail: 'fsutil behavior set disable8dot3 1 と同じです。既存のファイルの短い名前は消えません。16ビット時代の古いアプリを使う場合はオフのままにしてください。',
    actions: [dword(FS, 'NtfsDisable8dot3NameCreation', 1, 2)],
  },
  {
    id: 'fs-lastaccess', cat: 'fs', risk: 'low', reboot: 'reboot',
    title: '最終アクセス日時の更新を無効化',
    desc: 'ファイルを開くたびに最終アクセス日時を書き込む処理を止め、ディスクへの書き込みを減らします',
    detail: 'fsutil behavior set disablelastaccess 1（ユーザー管理・更新無効 = 0x80000001）と同じです。最終アクセス日時を使うバックアップ・同期ソフトがある場合はオフにしてください。',
    actions: [dword(FS, 'NtfsDisableLastAccessUpdate', 0x80000001, 0x80000002)],
  },
  {
    id: 'fs-memoryusage', cat: 'fs', risk: 'low', reboot: 'reboot',
    title: 'NTFSのキャッシュ用メモリを増やす',
    desc: 'NTFSが使うページプールの上限を引き上げ、多数のファイルを扱うときの処理を速くします',
    detail: 'fsutil behavior set memoryusage 2 と同じです。メモリ 8GB 以上を推奨します。',
    actions: [dword(FS, 'NtfsMemoryUsage', 2, null)],
  },

  // ───────── メモリ管理設定 ─────────
  {
    id: 'mem-pagingexecutive', cat: 'memory', risk: 'low', reboot: 'reboot',
    title: 'カーネルをページングしない',
    desc: 'カーネルとドライバのコードをページファイルへ追い出さず、常にメモリ上に置きます',
    detail: 'DisablePagingExecutive=1。メモリ 8GB 以上を推奨します。',
    minRamGB: 8,
    actions: [dword(MM, 'DisablePagingExecutive', 1, 0)],
  },
  {
    id: 'mem-compression', cat: 'memory', risk: 'low', reboot: 'reboot',
    title: 'メモリ圧縮を無効化',
    desc: 'メモリ内容の圧縮・展開にかかるCPU負荷をなくします（メモリに余裕がある環境向け）',
    detail: 'Disable-MMAgent -MemoryCompression を実行します。メモリ 16GB 未満では逆に遅くなることがあるため、推奨設定では 16GB 以上のときだけ使います。',
    minRamGB: 16,
    actions: [{
      t: 'ps',
      apply: 'Disable-MMAgent -MemoryCompression',
      revert: 'Enable-MMAgent -MemoryCompression',
      check: '-not (Get-MMAgent).MemoryCompression',
    }],
  },
  {
    id: 'mem-svchostsplit', cat: 'memory', risk: 'low', reboot: 'reboot',
    title: 'svchost.exe の分割しきい値を搭載メモリに合わせる',
    desc: 'サービスホストのプロセス数を減らし、タスクマネージャーの行数とメモリの断片化を抑えます',
    detail: 'SvcHostSplitThresholdInKB を搭載メモリ容量（KB）に設定します。既定値は 3.5GB 相当（0x380000）です。',
    actions: [{
      t: 'ps',
      backup: "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control' -Name SvcHostSplitThresholdInKB -ErrorAction SilentlyContinue).SvcHostSplitThresholdInKB",
      apply: "$kb = [uint32][math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1KB); New-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control' -Name SvcHostSplitThresholdInKB -PropertyType DWord -Value ([BitConverter]::ToInt32([BitConverter]::GetBytes($kb), 0)) -Force | Out-Null",
      revert: "$v = if ($backup) { [uint32]$backup } else { [uint32]0x380000 }; New-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control' -Name SvcHostSplitThresholdInKB -PropertyType DWord -Value ([BitConverter]::ToInt32([BitConverter]::GetBytes($v), 0)) -Force | Out-Null",
      check: "$v = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control' -Name SvcHostSplitThresholdInKB -ErrorAction SilentlyContinue).SvcHostSplitThresholdInKB; $kb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1KB); [bool]($v -and [uint32]([BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$v), 0)) -ge $kb)",
    }],
  },

  // ───────── 電源管理設定 ─────────
  {
    id: 'pwr-highperf', cat: 'power', risk: 'low', reboot: 'none',
    title: '電源プランを「高パフォーマンス」にする',
    desc: 'CPUのクロック低下やコアパーキングを抑え、負荷がかかったときの立ち上がりを速くします',
    detail: 'ノートPCではバッテリーの持ちが短くなります。プランが見つからない環境では既定の高パフォーマンスプランを複製して作ります。戻すときは元のプランに切り替えます。',
    actions: [{
      t: 'ps',
      backup: "if ((powercfg /getactivescheme | Out-String) -match '([0-9a-fA-F-]{36})') { $Matches[1] }",
      apply: `powercfg /setactive ${HIGH_PERF} 2>$null | Out-Null
if ($LASTEXITCODE) { powercfg -duplicatescheme ${HIGH_PERF} ${HIGH_PERF} | Out-Null; powercfg /setactive ${HIGH_PERF} | Out-Null }
if ($LASTEXITCODE) { throw '高パフォーマンスプランを有効にできませんでした' }`,
      revert: `$g = if ($backup) { $backup } else { '${BALANCED}' }; powercfg /setactive $g | Out-Null`,
      check: `[bool]((powercfg /getactivescheme | Out-String) -match '${HIGH_PERF}')`,
    }],
  },
  {
    id: 'pwr-throttling', cat: 'power', risk: 'low', reboot: 'reboot',
    title: '電源調整（Power Throttling）を無効化',
    desc: 'バックグラウンドのプロセスを省電力コアや低クロックに追いやる仕組みを無効にします',
    detail: 'Intel 第12世代以降（Pコア/Eコアのハイブリッド構成）ではスレッドの割り当てに悪影響が出ることがあるため、推奨設定には含めません。',
    hybridUnsafe: true,
    actions: [dword(HKLM + 'SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', 'PowerThrottlingOff', 1, null)],
  },
  {
    id: 'pwr-hibernate', cat: 'power', risk: 'low', reboot: 'none',
    title: '休止状態を無効化',
    desc: 'hiberfil.sys を削除してCドライブの空きを増やします（搭載メモリの約4割の容量）',
    detail: 'powercfg /hibernate off を実行します。高速スタートアップも使えなくなります。ノートPCで休止状態を使う場合はオフのままにしてください。',
    actions: [{
      t: 'ps',
      apply: "powercfg /hibernate off | Out-Null; if ($LASTEXITCODE) { throw 'powercfg が失敗しました' }",
      revert: 'powercfg /hibernate on | Out-Null',
      check: "(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power' -Name HibernateEnabled -ErrorAction SilentlyContinue).HibernateEnabled -eq 0",
    }],
  },
  {
    id: 'pwr-usbsuspend', cat: 'power', risk: 'low', reboot: 'none',
    title: 'USBのセレクティブサスペンドを無効化',
    desc: 'USB機器（マウス・キーボード・DAC等）が省電力で休止し、反応が遅れたり切断されたりするのを防ぎます',
    detail: '現在の電源プランの「USB のセレクティブ サスペンドの設定」を AC・バッテリーとも無効にします。電源プランを切り替えたあとは、もう一度オンにしてください。',
    actions: [{
      t: 'ps',
      apply: `powercfg /setacvalueindex SCHEME_CURRENT ${USB_SUSPEND} 0 | Out-Null
powercfg /setdcvalueindex SCHEME_CURRENT ${USB_SUSPEND} 0 | Out-Null
powercfg /setactive SCHEME_CURRENT | Out-Null`,
      revert: `powercfg /setacvalueindex SCHEME_CURRENT ${USB_SUSPEND} 1 | Out-Null
powercfg /setdcvalueindex SCHEME_CURRENT ${USB_SUSPEND} 1 | Out-Null
powercfg /setactive SCHEME_CURRENT | Out-Null`,
      check: `$m = [regex]::Matches((powercfg /query SCHEME_CURRENT ${USB_SUSPEND} | Out-String), '0x[0-9a-fA-F]{8}'); $m.Count -ge 2 -and [Convert]::ToInt32($m[$m.Count - 2].Value, 16) -eq 0`,
    }],
  },

  // ───────── システム最適化設定 ─────────
  {
    id: 'sys-responsiveness', cat: 'system', risk: 'low', reboot: 'reboot',
    title: 'マルチメディア優先度を引き上げる（SystemResponsiveness）',
    desc: '低優先度タスク用に予約するCPU時間を 20% から 10% に減らし、ゲームや音声処理に回します',
    detail: 'Microsoft のドキュメントでは 10 未満の値は 20 として扱われるため、有効な最小値の 10 を設定します（0 にしても効果はありません）。',
    actions: [dword(SYSPROFILE, 'SystemResponsiveness', 10, 20)],
  },
  {
    id: 'sys-gamestask', cat: 'system', risk: 'low', reboot: 'reboot',
    title: 'MMCSS の Games タスクの優先度を上げる',
    desc: 'マルチメディアクラススケジューラーに「Games」として登録されたスレッドのCPU・I/O優先度を上げます',
    detail: 'Priority=6、Scheduling Category=High、SFIO Priority=High、GPU Priority=8。MMCSS に登録するゲームにだけ効きます。',
    actions: [
      dword(GAMES_TASK, 'GPU Priority', 8, 8),
      dword(GAMES_TASK, 'Priority', 6, 2),
      str(GAMES_TASK, 'Scheduling Category', 'High', 'Medium'),
      str(GAMES_TASK, 'SFIO Priority', 'High', 'Normal'),
    ],
  },
  {
    id: 'sys-menudelay', cat: 'system', risk: 'low', reboot: 'logoff',
    title: 'メニュー表示の待ち時間をなくす',
    desc: 'サブメニューにカーソルを合わせてから開くまでの待ち時間（既定 400ms）を 0 にします',
    actions: [str(DESKTOP, 'MenuShowDelay', '0', '400')],
  },
  {
    id: 'sys-shutdown', cat: 'system', risk: 'low', reboot: 'reboot',
    title: 'シャットダウン時の待ち時間を短縮',
    desc: '応答しないアプリやサービスの終了待ちを短くし、シャットダウンを速くします',
    detail: 'HungAppTimeout・WaitToKillAppTimeout を 3000ms、WaitToKillServiceTimeout を 3000ms にします。アプリを強制終了する AutoEndTasks は保存前のデータを失うおそれがあるため変更しません。',
    actions: [
      str(DESKTOP, 'HungAppTimeout', '3000', null),
      str(DESKTOP, 'WaitToKillAppTimeout', '3000', null),
      str(HKLM + 'SYSTEM\\CurrentControlSet\\Control', 'WaitToKillServiceTimeout', '3000', '5000'),
    ],
  },
  {
    id: 'sys-errorreport', cat: 'system', risk: 'low', reboot: 'none',
    title: 'Windowsエラー報告を無効化',
    desc: 'アプリがクラッシュしたときのレポート収集と送信を無効にします',
    actions: [dword(HKLM + 'SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting', 'Disabled', 1, null)],
  },

  // ───────── リソースポリシー設定 ─────────
  {
    id: 'res-bgapps', cat: 'resource', risk: 'low', reboot: 'logoff',
    title: 'バックグラウンドアプリを無効化',
    desc: 'ストアアプリ（UWP）がバックグラウンドで動き続けるのを止めます',
    detail: '設定 → プライバシー → バックグラウンドアプリ の全体スイッチと同じです（Windows 10）。',
    actions: [
      dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', 'GlobalUserDisabled', 1, 0),
      dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Search', 'BackgroundAppGlobalToggle', 0, null),
    ],
  },
  {
    id: 'res-edge', cat: 'resource', risk: 'low', reboot: 'none',
    title: 'Edgeの常駐を無効化',
    desc: 'Edgeを閉じたあともバックグラウンドで動き続ける機能と、起動ブーストを無効にします',
    detail: 'グループポリシー BackgroundModeEnabled=0、StartupBoostEnabled=0 を設定します。',
    actions: [
      dword(HKLM + 'SOFTWARE\\Policies\\Microsoft\\Edge', 'BackgroundModeEnabled', 0, null),
      dword(HKLM + 'SOFTWARE\\Policies\\Microsoft\\Edge', 'StartupBoostEnabled', 0, null),
    ],
  },
  {
    id: 'res-chrome', cat: 'resource', risk: 'low', reboot: 'none',
    title: 'Chromeの常駐を無効化',
    desc: 'Chromeを閉じたあともバックグラウンドアプリのために動き続けるのを止めます',
    detail: 'グループポリシー BackgroundModeEnabled=0 を設定します。chrome://policy に「管理対象」と表示されるようになります。',
    actions: [dword(HKLM + 'SOFTWARE\\Policies\\Google\\Chrome', 'BackgroundModeEnabled', 0, null)],
  },
  {
    id: 'res-deliveryopt', cat: 'resource', risk: 'low', reboot: 'none',
    title: '配信の最適化（P2P共有）を無効化',
    desc: 'Windows Update のデータを他のPCとアップロード・共有する機能を止め、回線と帯域を空けます',
    detail: 'グループポリシー DODownloadMode=0（HTTP のみ）。更新自体は通常どおり Microsoft のサーバーから受け取ります。',
    actions: [dword(HKLM + 'SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization', 'DODownloadMode', 0, null)],
  },

  // ───────── プライバシー設定 ─────────
  {
    id: 'prv-telemetry', cat: 'privacy', risk: 'low', reboot: 'reboot',
    title: '診断データ（テレメトリ）を最小にする',
    desc: 'Microsoft へ送る診断データを最小レベルに制限します',
    detail: 'グループポリシー AllowTelemetry=0。Home / Pro では 0 は「必須の診断データ」（1）として扱われます。',
    actions: [dword(HKLM + 'SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 0, null)],
  },
  {
    id: 'prv-adid', cat: 'privacy', risk: 'low', reboot: 'none',
    title: '広告IDを無効化',
    desc: 'アプリが広告IDを使ってパーソナライズ広告を表示するのを止めます',
    actions: [dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled', 0, 1)],
  },
  {
    id: 'prv-activity', cat: 'privacy', risk: 'low', reboot: 'reboot',
    title: 'アクティビティの履歴を無効化',
    desc: '開いたアプリやファイルの履歴（タイムライン）を記録・送信しないようにします',
    actions: [
      dword(HKLM + 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'EnableActivityFeed', 0, null),
      dword(HKLM + 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities', 0, null),
      dword(HKLM + 'SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'UploadUserActivities', 0, null),
    ],
  },
  {
    id: 'prv-websearch', cat: 'privacy', risk: 'low', reboot: 'logoff',
    title: 'スタートメニュー検索のWeb結果を無効化',
    desc: 'スタートメニューの検索に Bing の Web 検索結果を混ぜないようにし、検索を軽くします',
    actions: [
      dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled', 0, null),
      dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Search', 'CortanaConsent', 0, null),
      dword(HKCU + 'Software\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions', 1, null),
    ],
  },
  {
    id: 'prv-tailored', cat: 'privacy', risk: 'low', reboot: 'none',
    title: 'エクスペリエンスのカスタマイズを無効化',
    desc: '診断データを使ったヒントや広告、おすすめの表示を止めます',
    actions: [dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\Privacy', 'TailoredExperiencesWithDiagnosticDataEnabled', 0, null)],
  },
  {
    id: 'prv-feedback', cat: 'privacy', risk: 'low', reboot: 'none',
    title: 'フィードバックの要求を無効化',
    desc: 'Windows がフィードバックを求めるポップアップを表示しないようにします',
    actions: [dword(HKCU + 'Software\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod', 0, null)],
  },
  {
    id: 'prv-inking', cat: 'privacy', risk: 'low', reboot: 'logoff',
    title: '手書き・入力の個人用辞書の収集を無効化',
    desc: '手書きや入力の内容を収集して個人用辞書を作る機能を止めます',
    actions: [
      dword(HKCU + 'Software\\Microsoft\\InputPersonalization', 'RestrictImplicitInkCollection', 1, 0),
      dword(HKCU + 'Software\\Microsoft\\InputPersonalization', 'RestrictImplicitTextCollection', 1, 0),
    ],
  },

  // ───────── DirectX & DXGKrnl ─────────
  {
    id: 'dx-hags', cat: 'directx', risk: 'low', reboot: 'reboot',
    title: 'ハードウェアアクセラレータによるGPUスケジューリング',
    desc: 'GPUのメモリ管理とスケジューリングをGPU側で行い、CPU負荷と遅延を減らします',
    detail: 'Windows 10 2004 以降と対応GPU・ドライバ（NVIDIA GTX 10 シリーズ以降など）が必要です。効果はゲームやドライバによって差があるため、推奨設定には含めません。',
    actions: [dword(GFX, 'HwSchMode', 2, null)],
  },
  {
    id: 'dx-tdr', cat: 'directx', risk: 'low', reboot: 'reboot',
    title: 'GPUタイムアウト検出（TDR）の猶予を延ばす',
    desc: '重い処理でGPUの応答が遅れたときに、ドライバがリセットされて落ちるのを防ぎます',
    detail: 'TdrDelay を既定の 2 秒から 10 秒にします。GPUが本当にフリーズした場合は、復帰までの待ち時間が長くなります。',
    actions: [dword(GFX, 'TdrDelay', 10, null)],
  },
  {
    id: 'dx-mpo', cat: 'directx', risk: 'mid', reboot: 'reboot',
    title: 'マルチプレーンオーバーレイ（MPO）を無効化',
    desc: '画面のちらつき・カクつき・黒画面が出るときの対処用です（不具合が無ければ不要）',
    detail: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm の OverlayTestMode=5。NVIDIA がちらつき対策として案内している設定です。性能向上の設定ではありません。',
    actions: [dword(HKLM + 'SOFTWARE\\Microsoft\\Windows\\Dwm', 'OverlayTestMode', 5, null)],
  },

  // ───────── サービス最適化 ─────────
  {
    id: 'svc-diagtrack', cat: 'services', risk: 'low', reboot: 'none',
    title: 'Connected User Experiences and Telemetry',
    desc: '診断データを収集・送信するサービス（DiagTrack）を無効にします',
    actions: [svc('DiagTrack', 'disabled', 'auto')],
  },
  {
    id: 'svc-sysmain', cat: 'services', risk: 'mid', reboot: 'none',
    title: 'SysMain（旧 Superfetch）',
    desc: 'よく使うアプリを先読みするサービスを無効にし、バックグラウンドのディスク・メモリ使用を減らします',
    detail: 'HDD を使っている環境ではアプリの起動が遅くなることがあるため、推奨設定では HDD が無いときだけ無効にします。',
    ssdOnly: true,
    actions: [svc('SysMain', 'disabled', 'auto')],
  },
  {
    id: 'svc-wsearch', cat: 'services', risk: 'mid', reboot: 'none',
    title: 'Windows Search（インデックス作成）',
    desc: 'ファイル内容のインデックス作成を止め、バックグラウンドのディスク負荷を減らします',
    detail: 'スタートメニューやエクスプローラーでのファイル検索が遅くなり、Outlook のメール検索が使えなくなります。',
    actions: [svc('WSearch', 'disabled', 'delayed-auto')],
  },
  {
    id: 'svc-maps', cat: 'services', risk: 'low', reboot: 'none',
    title: 'Downloaded Maps Manager',
    desc: '「マップ」アプリのオフライン地図を管理するサービスを無効にします',
    actions: [svc('MapsBroker', 'disabled', 'delayed-auto')],
  },
  {
    id: 'svc-wap', cat: 'services', risk: 'low', reboot: 'none',
    title: 'WAP Push メッセージルーティング',
    desc: 'デバイス管理用のプッシュメッセージを中継するサービス（dmwappushservice）を無効にします',
    detail: '会社や学校の管理（Intune 等）に参加しているPCではオフのままにしてください。',
    actions: [svc('dmwappushservice', 'disabled', 'demand')],
  },
  {
    id: 'svc-retaildemo', cat: 'services', risk: 'low', reboot: 'none',
    title: 'Retail Demo Service',
    desc: '店頭展示用デモモードのサービスを無効にします',
    actions: [svc('RetailDemo', 'disabled', 'demand')],
  },
  {
    id: 'svc-wer', cat: 'services', risk: 'low', reboot: 'none',
    title: 'Windows Error Reporting Service',
    desc: 'エラーレポートの収集・送信サービスを無効にします',
    actions: [svc('WerSvc', 'disabled', 'demand')],
  },
  {
    id: 'svc-fax', cat: 'services', risk: 'low', reboot: 'none',
    title: 'Fax',
    desc: 'FAX の送受信サービスを無効にします（PC で FAX を使わない場合）',
    actions: [svc('Fax', 'disabled', 'demand')],
  },
  {
    id: 'svc-xbox', cat: 'services', risk: 'mid', reboot: 'none',
    title: 'Xbox Live 関連サービス',
    desc: 'Xbox Live の認証・セーブ同期・ネットワークサービスを無効にします',
    detail: 'Xbox アプリ、Game Pass、Microsoft Store 版のゲームを使う場合はオフのままにしてください。Xbox コントローラーの XboxGipSvc は変更しません。',
    actions: [
      svc('XblAuthManager', 'disabled', 'demand'),
      svc('XblGameSave', 'disabled', 'demand'),
      svc('XboxNetApiSvc', 'disabled', 'demand'),
    ],
  },
  {
    id: 'svc-spooler', cat: 'services', risk: 'high', reboot: 'none',
    title: 'Print Spooler（印刷）',
    desc: '印刷サービスを無効にします。プリンターやPDF出力が使えなくなります',
    detail: 'プリンター・「Microsoft Print to PDF」を一切使わない場合だけ無効にしてください。',
    actions: [svc('Spooler', 'disabled', 'auto')],
  },

  // ───────── 入力デバイス最適化 ─────────
  {
    id: 'in-stickykeys', cat: 'input', risk: 'low', reboot: 'logoff',
    title: '固定キー・フィルターキー・切り替えキーのショートカットを無効化',
    desc: 'Shift 5回押しなどでゲーム中に確認ダイアログが出るのを防ぎます',
    actions: [
      str(HKCU + 'Control Panel\\Accessibility\\StickyKeys', 'Flags', '506', '510'),
      str(HKCU + 'Control Panel\\Accessibility\\Keyboard Response', 'Flags', '122', '126'),
      str(HKCU + 'Control Panel\\Accessibility\\ToggleKeys', 'Flags', '58', '62'),
    ],
  },
  {
    id: 'in-keyrepeat', cat: 'input', risk: 'low', reboot: 'logoff',
    title: 'キーリピートを最速にする',
    desc: 'キーを押し続けたときに連続入力が始まるまでの待ち時間を最短にします',
    detail: 'KeyboardDelay=0（最短）、KeyboardSpeed=31（最速）。コントロールパネル → キーボード の設定と同じです。',
    actions: [
      str(HKCU + 'Control Panel\\Keyboard', 'KeyboardDelay', '0', '1'),
      str(HKCU + 'Control Panel\\Keyboard', 'KeyboardSpeed', '31', '31'),
    ],
  },
  {
    id: 'in-queuesize', cat: 'input', risk: 'mid', reboot: 'reboot',
    title: 'マウス・キーボードの入力バッファを縮小',
    desc: 'ドライバの入力キューを 100 から 50 に減らします',
    detail: 'MouseDataQueueSize / KeyboardDataQueueSize。体感できる効果があるかは検証結果が分かれています。小さくしすぎると入力の取りこぼしが起きるため、50 にとどめています。',
    actions: [
      dword(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters', 'MouseDataQueueSize', 50, null),
      dword(HKLM + 'SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters', 'KeyboardDataQueueSize', 50, null),
    ],
  },

  // ───────── ゲーム ─────────
  {
    id: 'game-mode', cat: 'game', risk: 'low', reboot: 'none',
    title: 'ゲームモードを有効にする',
    desc: 'ゲーム中にWindows Updateのドライバ自動インストールや通知を抑え、ゲームにリソースを優先します',
    actions: [
      dword(HKCU + 'Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 1, null),
      dword(HKCU + 'Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1, null),
    ],
  },
  {
    id: 'game-dvr', cat: 'game', risk: 'low', reboot: 'logoff',
    title: 'ゲームバーのバックグラウンド録画を無効化',
    desc: '「キャプチャ」のバックグラウンド録画（Game DVR）を止め、エンコード負荷をなくします',
    detail: 'Xbox Game Bar 自体は使えます。NVIDIA ShadowPlay など他の録画ソフトには影響しません。',
    actions: [
      dword(GAMECONFIG, 'GameDVR_Enabled', 0, 1),
      dword(HKCU + 'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', 'AppCaptureEnabled', 0, null),
    ],
  },
  {
    id: 'game-fso', cat: 'game', risk: 'low', reboot: 'logoff',
    title: '全画面表示の最適化を無効化',
    desc: '排他フルスクリーンのゲームが「ボーダーレス相当」で動く仕組みを止め、従来の排他モードで表示します',
    detail: '一部のDirectX 9〜11 のゲームで入力遅延が減ることがあります。Alt+Tab の切り替えは遅くなります。',
    actions: [
      dword(GAMECONFIG, 'GameDVR_FSEBehaviorMode', 2, null),
      dword(GAMECONFIG, 'GameDVR_HonorUserFSEBehaviorMode', 1, null),
      dword(GAMECONFIG, 'GameDVR_FSEBehavior', 2, null),
      dword(GAMECONFIG, 'GameDVR_DXGIHonorFSEWindowsCompatible', 1, null),
    ],
  },

  // ───────── ネットワーク ─────────
  {
    id: 'net-nagle', cat: 'network', risk: 'low', reboot: 'reboot',
    title: '遅延ACKを無効化（TcpAckFrequency）',
    desc: 'TCPの確認応答をまとめずにすぐ返し、TCPを使うゲームやチャットの応答を速くします',
    detail: '全ネットワークアダプターに TcpAckFrequency=1・TCPNoDelay=1 を設定します（Microsoft のサポート記事で案内されている値）。多くのFPSは UDP を使うため、効果が出ないゲームもあります。',
    actions: [{
      t: 'ps',
      apply: `Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces' | ForEach-Object {
  New-ItemProperty -Path $_.PSPath -Name TcpAckFrequency -PropertyType DWord -Value 1 -Force | Out-Null
  New-ItemProperty -Path $_.PSPath -Name TCPNoDelay -PropertyType DWord -Value 1 -Force | Out-Null
}`,
      revert: `Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces' | ForEach-Object {
  Remove-ItemProperty -Path $_.PSPath -Name TcpAckFrequency, TCPNoDelay -ErrorAction SilentlyContinue
}`,
      check: `$ifs = @(Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces' | Get-ItemProperty | Where-Object { $_.DhcpIPAddress -or ($_.IPAddress -and $_.IPAddress[0]) })
$ifs.Count -gt 0 -and -not ($ifs | Where-Object { $_.TcpAckFrequency -ne 1 })`,
    }],
  },
  {
    id: 'net-throttling', cat: 'network', risk: 'low', reboot: 'reboot',
    title: 'ネットワークスロットリングを無効化',
    desc: 'マルチメディア再生中にネットワーク処理を制限する仕組み（NetworkThrottlingIndex）を無効にします',
    actions: [dword(SYSPROFILE, 'NetworkThrottlingIndex', 0xFFFFFFFF, 10)],
  },
];

// 自動推奨設定のプリセット。上から順に適用する。
const presets = [
  {
    id: 'balanced',
    title: 'Middle Tweaks',
    badge: null,
    desc: 'バランスの取れた中間的な最適化設定を適用します。普段使いの快適さを保ったまま、不要な常駐と視覚効果を減らします。',
    tweaks: [
      'pwr-highperf', 'win-visualfx', 'win-transparency', 'win-animations', 'win-contentdelivery',
      'win-explorer', 'boot-startupdelay', 'sys-responsiveness', 'sys-gamestask', 'sys-menudelay',
      'res-bgapps', 'res-edge', 'res-deliveryopt', 'prv-adid', 'prv-tailored', 'prv-feedback',
      'prv-activity', 'game-mode', 'game-dvr', 'in-stickykeys', 'svc-diagtrack', 'svc-maps', 'svc-retaildemo',
    ],
  },
  {
    id: 'lowlatency',
    title: 'Low Latency',
    badge: 'Latency特化',
    desc: 'システムの応答速度を向上させる低遅延設定を適用します。VALORANTなどの軽いゲームでの使用を想定しています。',
    extends: 'balanced',
    tweaks: [
      'win-notifications', 'win-mouseaccel', 'boot-dynamictick', 'pwr-usbsuspend', 'pwr-throttling',
      'mem-pagingexecutive', 'game-fso', 'net-nagle', 'net-throttling',
    ],
  },
  {
    id: 'performance',
    title: 'Full Performance',
    badge: '上級者向け',
    desc: 'Low Latency に加えて、サービス・ファイルシステム・メモリまで踏み込んで最適化します。適用前に復元ポイントの作成をおすすめします。',
    extends: 'lowlatency',
    tweaks: [
      'mem-compression', 'mem-svchostsplit', 'fs-lastaccess', 'fs-8dot3', 'boot-fastboot',
      'prv-telemetry', 'prv-websearch', 'sys-errorreport', 'svc-sysmain', 'svc-wer', 'svc-wap', 'svc-fax',
    ],
  },
];

module.exports = { categories, tweaks, presets };
