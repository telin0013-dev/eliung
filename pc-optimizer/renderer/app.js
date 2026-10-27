'use strict';

(() => {
  const api = window.api;
  const $ = (sel, el = document) => el.querySelector(sel);
  const main = $('#main');

  const S = {
    init: null,
    sys: null,
    states: {},
    busy: new Set(),
    open: new Set(),
    page: 'home',
    cat: null,
    reboot: null, // null | 'logoff' | 'reboot'
    cleanup: null,
    adapters: null,
    games: null,
  };

  const NAV = [
    { id: 'home', icon: 'home', label: 'ホーム' },
    { id: 'basic', icon: 'sliders', label: '基本設定' },
    { id: 'game', icon: 'gamepad', label: 'ゲーム' },
    { id: 'network', icon: 'wifi', label: 'ネットワーク' },
    { id: 'cleanup', icon: 'broom', label: 'クリーンアップ' },
    { id: 'backup', icon: 'archive', label: 'バックアップ・復元' },
    { id: 'settings', icon: 'gear', label: '設定' },
  ];

  const REBOOT_LABEL = { logoff: 'サインアウトで反映', reboot: '再起動で反映' };
  const GAME_SUGGEST = ['VALORANT-Win64-Shipping.exe', 'FortniteClient-Win64-Shipping.exe', 'cs2.exe', 'r5apex_dx12.exe', 'Overwatch.exe', 'javaw.exe'];

  // ───────── ユーティリティ ─────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  async function call(name, ...args) {
    const r = await api[name](...args);
    if (!r || !r.ok) throw new Error((r && r.error) || '不明なエラー');
    return r.data;
  }

  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
  }

  function fmtUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return (d ? `${d}日 ` : '') + `${h}時間 ${m}分`;
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function toast(kind, title, sub) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `${icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16)}<div><div>${esc(title)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'err' ? 8000 : 4000);
  }

  function modal({ title, desc = '', content = '', buttons, left = '' }) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
        <header><h3>${esc(title)}</h3>${desc ? `<p>${desc}</p>` : ''}</header>
        ${content ? `<div class="content">${content}</div>` : ''}
        <footer>${left ? `<div class="left">${left}</div>` : ''}${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</footer>
      </div>`;
      const close = (v) => {
        ov.remove();
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(null);
      };
      ov.addEventListener('click', (e) => {
        const b = e.target.closest('footer button');
        if (b) close({ value: buttons[b.dataset.i].value, el: ov });
        else if (e.target === ov) close(null);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
    });
  }

  function progressOverlay(title) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal"><div class="progress">
      <div class="spinner"></div>
      <h3 style="margin:16px 0 0;font-size:15px">${esc(title)}</h3>
      <div class="track"><div class="fill" style="width:0%"></div></div>
      <div class="now">準備しています…</div>
    </div></div>`;
    document.body.appendChild(ov);
    return {
      update(d) {
        if (d.phase === 'restore') $('.now', ov).textContent = d.text;
        if (d.total) {
          $('.fill', ov).style.width = `${Math.round((d.done / d.total) * 100)}%`;
          $('.now', ov).textContent = `${d.done + 1} / ${d.total}　${d.text}`;
        }
      },
      close: () => ov.remove(),
    };
  }
  let progress = null;
  api.onProgress((d) => progress && progress.update(d));

  function markReboot(kind) {
    if (kind === 'none') return;
    if (S.reboot !== 'reboot') S.reboot = kind;
    const pill = $('#rebootPill');
    pill.classList.add('show');
    $('span', pill).textContent = S.reboot === 'reboot' ? '再起動で反映される変更があります' : 'サインアウトか再起動で反映される変更があります';
  }

  // ───────── データ ─────────
  const tweakById = (id) => S.init.tweaks.find((t) => t.id === id);
  const visibleTweaks = (cat) => S.init.tweaks.filter((t) => t.cat === cat && (t.risk !== 'high' || S.init.settings.showAdvanced));
  const appliedIn = (list) => list.filter((t) => S.states[t.id] === 'on').length;

  async function refreshStates(ids) {
    try {
      Object.assign(S.states, await call('status', ids));
    } catch (e) {
      toast('err', '設定の状態を読み取れませんでした', e.message);
    }
  }

  // ───────── 部品 ─────────
  function pageHead(ic, title, desc, right = '') {
    return `<div class="page-head"><div class="hicon">${icon(ic, 18)}</div><div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${right ? `<div class="right">${right}</div>` : ''}</div>`;
  }

  function adminBanner() {
    if (S.init.isAdmin) return '';
    return `<div class="admin-banner show">${icon('alert', 18)}<div class="grow"><b>管理者権限がありません。</b>HKLM やサービスの設定を変更するには、管理者として起動し直してください。</div><button class="btn sm danger" data-act="relaunch">管理者として再起動</button></div>`;
  }

  function tweakRow(t) {
    const st = S.states[t.id];
    const busy = S.busy.has(t.id) || st === undefined;
    const on = st === 'on';
    const tags = [];
    if (t.reboot !== 'none') tags.push(`<span class="tag reboot">${REBOOT_LABEL[t.reboot]}</span>`);
    if (t.risk === 'mid') tags.push('<span class="tag mid">注意</span>');
    if (t.risk === 'high') tags.push('<span class="tag high">上級者向け</span>');
    if (st === 'partial') tags.push('<span class="tag partial">一部適用</span>');
    if (st === 'unavailable') tags.push('<span class="tag na">この環境では利用不可</span>');
    if (st === 'error') tags.push('<span class="tag err">状態を取得できません</span>');
    const actions = t.actions.map((a) => `<code>${esc(a.text)}</code>`).join('');
    return `<div class="trow ${S.open.has(t.id) ? 'open' : ''}" data-row="${t.id}">
      <div class="top">
        <div class="txt">
          <div class="ttl">${esc(t.title)}<button class="expand" data-act="expand" data-id="${t.id}" title="詳細">${icon('chevronDown', 14)}</button>${tags.join('')}</div>
          <div class="desc">${esc(t.desc)}</div>
        </div>
        <div class="sw ${on ? 'on' : ''} ${busy ? 'busy' : ''}">
          <span class="lbl">${on ? 'ON' : 'OFF'}</span>
          <button class="toggle" role="switch" aria-checked="${on}" aria-label="${esc(t.title)}" data-act="toggle" data-id="${t.id}" ${st === 'unavailable' ? 'disabled' : ''}></button>
        </div>
      </div>
      <div class="more">${t.detail ? `<div style="margin-bottom:8px">${esc(t.detail)}</div>` : ''}<div>変更する内容:</div>${actions}</div>
    </div>`;
  }

  function updateRow(id) {
    const el = main.querySelector(`[data-row="${id}"]`);
    if (el) el.outerHTML = tweakRow(tweakById(id));
  }

  function tweakList(list) {
    if (!list.length) return '<div class="empty">表示できる設定はありません</div>';
    return `<div class="tlist">${list.map(tweakRow).join('')}</div>`;
  }

  // ───────── ページ ─────────
  const pages = {};

  pages.home = () => {
    const sys = S.sys;
    const all = S.init.tweaks.filter((t) => t.risk !== 'high');
    const cats = S.init.categories.filter((c) => !c.hidden).concat(S.init.categories.filter((c) => c.hidden));
    const sysKv = sys
      ? `<dl class="kv">
          <dt>OS</dt><dd>${esc(sys.os)} ${esc(sys.version || '')}（ビルド ${esc(sys.build)}）</dd>
          <dt>CPU</dt><dd>${esc(sys.cpu)}（${sys.cores}コア / ${sys.threads}スレッド）</dd>
          <dt>GPU</dt><dd>${esc((sys.gpus || []).join(' / ') || '不明')}</dd>
          <dt>メモリ</dt><dd>${sys.ramGB} GB</dd>
          <dt>ストレージ</dt><dd>${(sys.disks || []).map((d) => `${esc(d.media || '?')} ${d.sizeGB}GB`).join('、') || '不明'}</dd>
          <dt>推奨設定</dt><dd class="accent">${esc(sys.profile.label)}</dd>
        </dl>`
      : '<div class="loading"><div class="spinner"></div>システム情報を取得しています…</div>';
    return `<div class="page">
      ${pageHead('home', 'ダッシュボード', 'システムの状態と最適化の進み具合')}
      ${adminBanner()}
      <div class="dash">
        <div class="panel"><div class="panel-title">${icon('info', 16)}システム情報</div>${sysKv}</div>
        <div class="panel">
          <div class="panel-title">${icon('activity', 16)}リアルタイム</div>
          <div class="gauges">${gauge('gCpu', 'CPU')}${gauge('gMem', 'メモリ')}</div>
          <div class="muted small" style="text-align:center;margin-top:10px" id="uptime"></div>
        </div>
        <div class="panel full">
          <div class="panel-title">${icon('rocket', 16)}最適化の状況</div>
          <div class="score"><b>${appliedIn(all)}</b><span class="muted">/ ${all.length} 項目を適用中</span></div>
          <div class="bars">${cats.map((c) => {
            const list = S.init.tweaks.filter((t) => t.cat === c.id && t.risk !== 'high');
            const n = appliedIn(list);
            return `<div class="bar"><span>${esc(c.title)}</span><div class="track"><div class="fill" style="width:${list.length ? (n / list.length) * 100 : 0}%"></div></div><span class="n">${n}/${list.length}</span></div>`;
          }).join('')}</div>
        </div>
        <div class="panel full">
          <div class="panel-title">${icon('bolt', 16)}クイックアクション</div>
          <div class="quick">
            <button data-act="nav" data-page="auto">${icon('bolt', 20)}<b>自動推奨設定</b><span>このPCに合わせたプリセットを一括で適用</span></button>
            <button data-act="nav" data-page="cleanup">${icon('broom', 20)}<b>クリーンアップ</b><span>一時ファイルやキャッシュを削除して空き容量を増やす</span></button>
            <button data-act="restorePoint">${icon('archive', 20)}<b>復元ポイントを作成</b><span>いつでも今の状態に戻せるようにする</span></button>
          </div>
        </div>
      </div>
    </div>`;
  };

  function gauge(id, label) {
    const c = 2 * Math.PI * 46;
    return `<div class="gauge" id="${id}">
      <svg width="112" height="112"><circle class="bg" cx="56" cy="56" r="46" fill="none" stroke-width="9"/>
      <circle class="fg" cx="56" cy="56" r="46" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg>
      <div class="val"><b>--</b><span>${label}</span></div>
    </div>`;
  }

  function setGauge(id, pct, sub) {
    const el = document.getElementById(id);
    if (!el) return;
    const c = 2 * Math.PI * 46;
    $('.fg', el).setAttribute('stroke-dashoffset', String(c * (1 - pct / 100)));
    $('.val b', el).textContent = `${pct}%`;
    if (sub) $('.val span', el).textContent = sub;
  }

  async function tickUsage() {
    if (S.page !== 'home' || !document.getElementById('gCpu')) return;
    try {
      const u = await call('usage');
      setGauge('gCpu', u.cpu, 'CPU');
      setGauge('gMem', Math.round((u.memUsed / u.memTotal) * 100), `${(u.memUsed / 1024 ** 3).toFixed(1)} / ${(u.memTotal / 1024 ** 3).toFixed(1)} GB`);
      const up = document.getElementById('uptime');
      if (up) up.textContent = `起動してからの時間: ${fmtUptime(u.uptime)}`;
    } catch {
      /* 次の周期で再試行 */
    }
  }
  setInterval(tickUsage, 1500);

  pages.basic = () => {
    const cats = S.init.categories.filter((c) => !c.hidden);
    return `<div class="page">
      ${pageHead('monitor', '基本設定', 'システムの基本的な設定とパフォーマンスの最適化')}
      ${adminBanner()}
      <div class="grid">${cats.map((c) => {
        const list = visibleTweaks(c.id);
        return `<button class="cat-card" data-act="cat" data-cat="${c.id}">
          <span class="count"><b>${appliedIn(list)}</b> / ${list.length}</span>
          <div class="cicon">${icon(c.icon, 20)}</div><h3>${esc(c.title)}</h3><p>${esc(c.desc)}</p>
        </button>`;
      }).join('')}</div>
    </div>`;
  };

  pages.cat = () => {
    const c = S.init.categories.find((x) => x.id === S.cat);
    const list = visibleTweaks(c.id);
    const hiddenCount = S.init.tweaks.filter((t) => t.cat === c.id).length - list.length;
    return `<div class="page narrow">
      <button class="back" data-act="nav" data-page="basic">${icon('chevronLeft', 14)}基本設定に戻る</button>
      ${pageHead(c.icon, c.title, c.desc, `<button class="btn sm" data-act="catAll" data-cat="${c.id}" data-on="1">すべてON</button><button class="btn sm ghost" data-act="catAll" data-cat="${c.id}" data-on="0">すべてOFF</button>`)}
      ${adminBanner()}
      <h2 class="section">${esc(c.title.replace(/設定$/, ''))}の設定</h2>
      ${tweakList(list)}
      ${hiddenCount ? `<div class="note">${icon('info', 16)}<span class="grow">上級者向けの設定が ${hiddenCount} 件あります。「設定」→「上級者向け設定を表示」で表示できます。</span></div>` : ''}
    </div>`;
  };

  pages.game = () => {
    const games = S.games;
    const gameRows = games === null
      ? '<div class="loading"><div class="spinner"></div></div>'
      : games.length === 0
        ? '<div class="empty">まだ登録されていません</div>'
        : `<div class="list">${games.map((g) => `<div class="item">${icon('gamepad', 18)}<div class="grow"><b>${esc(g.exe)}</b><div class="sub">CPU優先度: ${g.cpu === 3 ? '高' : g.cpu === 6 ? '通常以上' : g.cpu === 2 ? '通常' : g.cpu}</div></div><button class="btn sm ghost" data-act="gameRemove" data-exe="${esc(g.exe)}">${icon('trash', 14)}解除</button></div>`).join('')}</div>`;
    return `<div class="page narrow">
      ${pageHead('gamepad', 'ゲーム最適化', 'ゲーム中のフレームレートと遅延に関わる設定')}
      ${adminBanner()}
      ${tweakList(visibleTweaks('game'))}
      <div class="note">${icon('info', 16)}<span class="grow">GPUスケジューリングやMPOの設定は「基本設定 → DirectX &amp; DXGKrnl」にあります。</span><button class="btn sm" data-act="cat" data-cat="directx">開く</button></div>
      <h2 class="section">ゲームごとのCPU優先度</h2>
      <div class="panel">
        <div class="muted small" style="line-height:1.6;margin-bottom:12px">指定したゲームを起動したとき、Windows が自動でプロセスの優先度を上げます（Image File Execution Options の PerfOptions）。一部のアンチチートは優先度の変更を無視します。</div>
        <div class="row">
          <input class="input" id="gameExe" placeholder="例: VALORANT-Win64-Shipping.exe" style="flex:1;min-width:240px">
          <select id="gamePrio"><option value="high">高</option><option value="abovenormal">通常以上</option></select>
          <button class="btn primary" data-act="gameAdd">${icon('plus', 14)}追加</button>
        </div>
        <div class="chips">${GAME_SUGGEST.map((g) => `<button class="chip" data-act="gameFill" data-exe="${g}">${g}</button>`).join('')}</div>
        <div style="margin-top:14px">${gameRows}</div>
      </div>
    </div>`;
  };

  pages.network = () => {
    const ad = S.adapters;
    let dnsPanel;
    if (ad === null) dnsPanel = '<div class="loading"><div class="spinner"></div></div>';
    else if (!ad.length) dnsPanel = '<div class="empty">接続中のネットワークアダプターが見つかりません</div>';
    else {
      dnsPanel = `<div class="list">${ad.map((a) => `<div class="item">${icon('wifi', 18)}
        <div class="grow"><b>${esc(a.name)}</b><div class="sub">${esc(a.desc)}・${esc(a.speed)}・DNS: ${esc((a.dns || []).join(', ') || '自動')}</div></div>
        <select data-dns="${a.index}">
          <option value="">DNSを変更…</option>
          <option value="cloudflare">Cloudflare（1.1.1.1）</option>
          <option value="google">Google（8.8.8.8）</option>
          <option value="quad9">Quad9（9.9.9.9）</option>
          <option value="auto">自動（プロバイダー）に戻す</option>
        </select></div>`).join('')}</div>`;
    }
    return `<div class="page narrow">
      ${pageHead('wifi', 'ネットワーク', 'TCPの遅延とDNSの設定')}
      ${adminBanner()}
      ${tweakList(visibleTweaks('network'))}
      <h2 class="section">DNS</h2>
      <div class="panel">${dnsPanel}
        <div class="row" style="margin-top:12px"><button class="btn sm" data-act="flushDns">${icon('refresh', 14)}DNSキャッシュをクリア</button></div>
      </div>
      <h2 class="section">Ping テスト</h2>
      <div class="panel">
        <div class="row">
          <input class="input" id="pingHost" value="1.1.1.1" style="width:240px">
          <button class="btn" data-act="ping">${icon('activity', 14)}計測（4回）</button>
          <span class="muted" id="pingResult"></span>
        </div>
      </div>
    </div>`;
  };

  pages.cleanup = () => {
    const c = S.cleanup;
    let body;
    if (c === null) body = '<div class="empty">「スキャン」を押すと、削除できるファイルの容量を調べます</div>';
    else if (c === 'loading') body = '<div class="loading"><div class="spinner"></div>スキャンしています…</div>';
    else {
      const total = c.reduce((s, x) => s + x.bytes, 0);
      body = `<div class="list">${c.map((x) => `<label class="item"><input type="checkbox" data-clean="${x.id}" ${x.bytes > 0 && x.id !== 'dx-cache' && x.id !== 'nv-cache' ? 'checked' : ''}>
        <div class="grow"><b>${esc(x.title)}</b><div class="sub">${esc(x.desc)}${x.error ? `（読み取りエラー: ${esc(x.error)}）` : ''}</div></div>
        <span class="size">${fmtBytes(x.bytes)}</span></label>`).join('')}</div>
        <div class="row" style="margin-top:14px;justify-content:space-between"><span class="muted">合計 <b style="color:var(--accent-2)">${fmtBytes(total)}</b></span>
        <button class="btn primary" data-act="cleanRun">${icon('trash', 14)}選択した項目を削除</button></div>`;
    }
    return `<div class="page narrow">
      ${pageHead('broom', 'クリーンアップ', '一時ファイルやキャッシュを削除して空き容量を増やします', `<button class="btn" data-act="cleanScan">${icon('refresh', 14)}スキャン</button>`)}
      ${adminBanner()}
      <div class="panel">${body}</div>
      <div class="note">${icon('info', 16)}<span class="grow">使用中のファイルは削除されずに残ります。シェーダーキャッシュは消すとゲームの初回起動時に再生成され、一時的にカクつくことがあるため、初期状態では選択していません。</span></div>
    </div>`;
  };

  pages.backup = () => {
    const b = S.backupData;
    const applied = !b
      ? '<div class="loading"><div class="spinner"></div></div>'
      : b.backups.length === 0
        ? '<div class="empty">このアプリで適用中の設定はありません</div>'
        : `<div class="list">${b.backups.map((x) => `<div class="item"><div class="grow"><b>${esc(x.title)}</b><div class="sub">適用: ${fmtTime(x.at)}</div></div><button class="btn sm ghost" data-act="revertOne" data-id="${x.id}">${icon('undo', 14)}元に戻す</button></div>`).join('')}</div>`;
    const log = !b || b.log.length === 0
      ? '<div class="empty">履歴はありません</div>'
      : `<div class="list log">${b.log.map((l) => `<div class="item"><time>${fmtTime(l.at)}</time><span class="tag ${l.ok ? 'ok' : 'err'}">${{ apply: '適用', revert: '復元', preset: 'プリセット' }[l.type] || l.type}</span><span class="grow">${esc(l.title)}${l.errors && l.errors.length ? `<div class="sub" style="color:var(--danger)">${esc(l.errors.join(' / '))}</div>` : ''}</span></div>`).join('')}</div>`;
    return `<div class="page narrow">
      ${pageHead('archive', 'バックアップ・復元', '変更前の値はすべて記録しているので、いつでも元に戻せます')}
      ${adminBanner()}
      <div class="panel">
        <div class="panel-title">${icon('shield', 16)}システムの復元ポイント</div>
        <div class="muted small" style="line-height:1.6">Windows 標準の復元ポイントです。万一 Windows が正常に起動しなくなった場合も、セーフモードや回復環境から戻せます。</div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" data-act="restorePoint">${icon('plus', 14)}復元ポイントを作成</button>
          <button class="btn" data-act="open" data-target="rstrui">システムの復元を開く</button>
          <button class="btn ghost" data-act="open" data-target="sysprotect">システムの保護の設定</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">${icon('undo', 16)}適用中の設定<span style="margin-left:auto" class="row">
          <button class="btn sm ghost" data-act="exportBackup">${icon('download', 14)}書き出し</button>
          <button class="btn sm danger" data-act="revertAll" ${b && b.backups.length ? '' : 'disabled'}>すべて元に戻す</button></span></div>
        ${applied}
      </div>
      <div class="panel">
        <div class="panel-title">${icon('clock', 16)}操作の履歴</div>
        ${log}
      </div>
    </div>`;
  };

  pages.settings = () => {
    const st = S.init.settings;
    const sw = (key, on) => `<div class="sw ${on ? 'on' : ''}"><span class="lbl">${on ? 'ON' : 'OFF'}</span><button class="toggle" role="switch" aria-checked="${on}" data-act="setting" data-key="${key}"></button></div>`;
    return `<div class="page narrow">
      ${pageHead('gear', '設定', 'アプリの動作に関する設定')}
      <div class="panel">
        <div class="setting-row"><div class="grow"><b>プリセット適用前に復元ポイントを作成</b><div class="sub">自動推奨設定を適用する前に、Windows の復元ポイントを自動で作ります。</div></div>${sw('autoRestorePoint', st.autoRestorePoint !== false)}</div>
        <div class="setting-row"><div class="grow"><b>上級者向け設定を表示</b><div class="sub">印刷サービスの無効化など、影響の大きい設定も一覧に表示します。</div></div>${sw('showAdvanced', !!st.showAdvanced)}</div>
      </div>
      <div class="panel">
        <div class="panel-title">${icon('info', 16)}このアプリについて</div>
        <dl class="kv">
          <dt>アプリ</dt><dd>HexaTune ${esc(S.init.version)}</dd>
          <dt>権限</dt><dd>${S.init.isAdmin ? '管理者として実行中' : '標準ユーザー（一部の設定は変更できません）'}</dd>
          <dt>設定項目</dt><dd>${S.init.tweaks.length} 項目</dd>
        </dl>
        <div class="muted small" style="line-height:1.7;margin-top:12px">
          変更内容はすべてレジストリ・サービス・標準コマンド（powercfg / bcdedit / fsutil 相当）で行い、適用前の値を記録します。
          効果の大きさはPCの構成やゲームによって変わります。体感が悪くなった設定は個別にオフにしてください。
        </div>
      </div>
    </div>`;
  };

  pages.auto = () => {
    const sys = S.sys;
    const allBackups = S.backupData ? new Set(S.backupData.backups.map((b) => b.id)) : new Set();
    return `<div class="page narrow">
      ${pageHead('bolt', '自動推奨設定', 'お使いのシステムに最適な設定を自動で適用します')}
      ${adminBanner()}
      <div class="panel info-card">
        <div class="badge-ic">${icon('info', 18)}</div>
        <div>
          <div class="panel-title" style="margin-bottom:8px">システム情報</div>
          ${sys ? `<dl class="kv">
            <dt>OS:</dt><dd>${esc(sys.os)} ${esc(sys.version || '')}</dd>
            <dt>CPU:</dt><dd>${esc(sys.cpu)}</dd>
            <dt>メモリ:</dt><dd>${sys.ramGB} GB${sys.hasHdd ? '（HDD あり）' : ''}</dd>
            <dt>推奨設定:</dt><dd class="accent">${esc(sys.profile.label)}</dd>
          </dl>` : '<div class="muted">取得しています…</div>'}
        </div>
      </div>
      <div style="margin-top:14px">
      ${S.init.presets.map((p) => {
        const n = (S.plans && S.plans[p.id]) ? S.plans[p.id].include.length : null;
        const appliedCount = S.plans && S.plans[p.id] ? S.plans[p.id].include.filter((id) => allBackups.has(id)).length : 0;
        return `<div class="preset">
          <div class="body">
            <h3>${esc(p.title)}${p.badge ? `<span class="tag ${p.id === 'lowlatency' ? 'latency' : 'mid'}">${p.id === 'lowlatency' ? icon('alert', 11) : ''}${esc(p.badge)}</span>` : ''}${appliedCount ? `<span class="tag ok">${appliedCount}項目 適用中</span>` : ''}</h3>
            <p>${esc(p.desc)}</p>
            <div class="file">プリセット: <code>presets/${esc(p.id)}</code>${n !== null ? `<span>このPCで適用する設定: ${n} 項目</span>` : ''}</div>
          </div>
          <div class="actions">
            <button class="btn lg" data-act="presetApply" data-id="${p.id}">最適化 ${icon('chevronRight', 14)}</button>
            ${appliedCount ? `<button class="btn sm ghost" data-act="presetRevert" data-id="${p.id}">${icon('undo', 13)}元に戻す</button>` : ''}
          </div>
        </div>`;
      }).join('')}
      </div>
      <div class="note">${icon('info', 16)}<span class="grow">設定の適用には管理者権限が必要です。設定を適用後、最大限の効果を得るためにシステムの再起動を推奨します。</span></div>
    </div>`;
  };

  // ───────── 描画 ─────────
  function renderNav() {
    const btn = (n) => `<button class="navbtn ${S.page === n.id || (n.id === 'basic' && S.page === 'cat') ? 'active' : ''}" data-act="nav" data-page="${n.id}" aria-label="${n.label}">${icon(n.icon, 18)}<span class="tip">${n.label}</span></button>`;
    $('#nav').innerHTML = NAV.map(btn).join('');
    $('#navBottom').innerHTML = btn({ id: 'auto', icon: 'bolt', label: '自動推奨設定' });
  }

  function render() {
    renderNav();
    const keep = main.scrollTop;
    main.innerHTML = pages[S.page]();
    main.scrollTop = keep;
  }

  async function go(page, extra = {}) {
    const same = S.page === page && S.cat === (extra.cat || null);
    S.page = page;
    S.cat = extra.cat || null;
    if (!same) main.scrollTop = 0;
    render();
    if (page === 'home') tickUsage();
    if (page === 'game') {
      S.games = await call('gameList').catch(() => []);
      if (S.page === 'game') render();
    }
    if (page === 'network' && S.adapters === null) {
      S.adapters = await call('netAdapters').catch(() => []);
      if (S.page === 'network') render();
    }
    if (page === 'backup' || page === 'auto') {
      S.backupData = await call('backupList').catch(() => null);
      if (page === 'auto' && !S.plans) {
        S.plans = {};
        for (const p of S.init.presets) S.plans[p.id] = await call('presetPlan', p.id).catch(() => null);
      }
      if (S.page === page) render();
    }
  }

  // ───────── 操作 ─────────
  async function toggleTweak(id) {
    if (S.busy.has(id) || S.states[id] === undefined) return;
    const t = tweakById(id);
    const on = S.states[id] === 'on';
    S.busy.add(id);
    updateRow(id);
    try {
      const r = await call(on ? 'revert' : 'apply', id);
      S.states[id] = r.state;
      if (r.ok) {
        toast('ok', `${t.title}`, `${on ? '元に戻しました' : '適用しました'}${t.reboot !== 'none' ? `（${REBOOT_LABEL[t.reboot]}されます）` : ''}`);
        markReboot(t.reboot);
      } else {
        toast('err', `${t.title} を${on ? '元に戻せません' : '適用できません'}でした`, r.errors.join(' / '));
      }
    } catch (e) {
      toast('err', '処理に失敗しました', e.message);
    } finally {
      S.busy.delete(id);
      updateRow(id);
    }
  }

  async function catAll(cat, turnOn) {
    const list = visibleTweaks(cat).filter((t) => (turnOn ? S.states[t.id] !== 'on' && S.states[t.id] !== 'unavailable' : S.states[t.id] === 'on'));
    for (const t of list) await toggleTweak(t.id);
  }

  async function presetApply(id) {
    const p = S.init.presets.find((x) => x.id === id);
    let plan;
    try {
      plan = await call('presetPlan', id);
    } catch (e) {
      toast('err', 'プリセットを読み込めませんでした', e.message);
      return;
    }
    const items = plan.include.map((tid) => {
      const t = tweakById(tid);
      return `<li>${icon('check', 14)}<span>${esc(t.title)}</span>${t.reboot !== 'none' ? `<span class="why muted">${REBOOT_LABEL[t.reboot]}</span>` : ''}</li>`;
    });
    const skipped = plan.skipped.map((s) => `<li class="skip">${icon('minus', 14)}<span>${esc(tweakById(s.id).title)}</span><span class="why">${esc(s.reason)}</span></li>`);
    const rp = S.init.settings.autoRestorePoint !== false;
    const res = await modal({
      title: `${p.title} を適用`,
      desc: `次の ${plan.include.length} 項目を適用します。変更前の値は記録され、「元に戻す」でいつでも戻せます。`,
      content: `<ul class="plan-list">${items.join('')}${skipped.join('')}</ul>`,
      left: `<label class="row" style="gap:6px"><input type="checkbox" id="rpCheck" ${rp ? 'checked' : ''}>先に復元ポイントを作成</label>`,
      buttons: [{ label: 'キャンセル', cls: 'ghost', value: false }, { label: '適用する', cls: 'primary', value: true }],
    });
    if (!res || !res.value) return;
    const wantRp = $('#rpCheck', res.el).checked;
    if (wantRp !== rp) S.init.settings = await call('setSetting', 'autoRestorePoint', wantRp);

    progress = progressOverlay(`${p.title} を適用しています`);
    let out;
    try {
      out = await call('presetApply', id);
    } catch (e) {
      progress.close();
      progress = null;
      toast('err', '適用に失敗しました', e.message);
      return;
    }
    progress.close();
    progress = null;
    for (const r of out.results) S.states[r.id] = r.state;
    const okN = out.results.filter((r) => r.ok).length;
    const failed = out.results.filter((r) => !r.ok);
    const needReboot = out.results.some((r) => r.ok && r.reboot === 'reboot');
    out.results.forEach((r) => r.ok && markReboot(r.reboot));
    let rpText = '';
    if (out.restorePoint) {
      rpText = String(out.restorePoint).startsWith('error') ? `<p style="color:var(--warn)">復元ポイント: ${esc(out.restorePoint.replace(/^error: /, ''))}</p>` : '<p>復元ポイントを作成しました。</p>';
    }
    const r2 = await modal({
      title: failed.length ? '一部の設定を適用できませんでした' : '最適化が完了しました',
      desc: `${okN} 項目を適用しました。${needReboot ? '効果を反映するにはPCを再起動してください。' : ''}`,
      content: `${rpText}${failed.length ? `<ul class="plan-list">${failed.map((f) => `<li class="skip">${icon('alert', 14)}<span>${esc(tweakById(f.id).title)}</span><span class="why" style="color:var(--danger)">${esc(f.errors.join(' / '))}</span></li>`).join('')}</ul>` : ''}`,
      buttons: needReboot ? [{ label: 'あとで', cls: 'ghost', value: false }, { label: '今すぐ再起動', cls: 'primary', value: 'reboot' }] : [{ label: 'OK', cls: 'primary', value: false }],
    });
    if (r2 && r2.value === 'reboot') await call('reboot');
    S.plans = null;
    go('auto');
  }

  async function revertMany(fnName, arg, label) {
    const ok = await modal({ title: label, desc: 'このアプリで適用した設定を、適用前の値に戻します。', buttons: [{ label: 'キャンセル', cls: 'ghost', value: false }, { label: '元に戻す', cls: 'danger', value: true }] });
    if (!ok || !ok.value) return;
    progress = progressOverlay('元に戻しています');
    try {
      const out = await call(fnName, arg);
      for (const r of out.results) {
        S.states[r.id] = r.state;
        if (r.ok) markReboot(r.reboot);
      }
      const failed = out.results.filter((r) => !r.ok);
      if (failed.length) toast('err', `${failed.length} 項目を戻せませんでした`, failed.map((f) => tweakById(f.id).title).join('、'));
      else toast('ok', `${out.results.length} 項目を元に戻しました`);
    } catch (e) {
      toast('err', '元に戻せませんでした', e.message);
    } finally {
      progress.close();
      progress = null;
    }
    go(S.page, { cat: S.cat });
  }

  async function createRestorePoint(btn) {
    if (btn) btn.disabled = true;
    toast('info', '復元ポイントを作成しています…', '数十秒かかることがあります');
    try {
      const r = await call('createRestorePoint');
      if (String(r).startsWith('warning')) toast('err', '復元ポイントは作成されませんでした', r.replace(/^warning: /, ''));
      else toast('ok', '復元ポイントを作成しました');
    } catch (e) {
      toast('err', '復元ポイントを作成できませんでした', e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const actions = {
    nav: (el) => go(el.dataset.page),
    cat: (el) => go('cat', { cat: el.dataset.cat }),
    expand: (el) => {
      const id = el.dataset.id;
      if (S.open.has(id)) S.open.delete(id);
      else S.open.add(id);
      el.closest('.trow').classList.toggle('open');
    },
    toggle: (el) => toggleTweak(el.dataset.id),
    catAll: (el) => catAll(el.dataset.cat, el.dataset.on === '1'),
    relaunch: () => call('relaunchAdmin'),
    restorePoint: (el) => createRestorePoint(el),
    open: (el) => call('open', el.dataset.target).catch((e) => toast('err', '開けませんでした', e.message)),
    presetApply: (el) => presetApply(el.dataset.id),
    presetRevert: (el) => revertMany('presetRevert', el.dataset.id, 'このプリセットの設定を元に戻しますか？'),
    revertAll: () => revertMany('revertAll', undefined, 'すべての設定を元に戻しますか？'),
    revertOne: async (el) => {
      el.disabled = true;
      try {
        const r = await call('revert', el.dataset.id);
        S.states[r.id] = r.state;
        if (r.ok) {
          toast('ok', '元に戻しました', tweakById(r.id).title);
          markReboot(r.reboot);
        } else toast('err', '元に戻せませんでした', r.errors.join(' / '));
      } catch (e) {
        toast('err', '元に戻せませんでした', e.message);
      }
      go('backup');
    },
    exportBackup: async () => {
      try {
        const f = await call('exportBackup');
        if (f) toast('ok', 'バックアップを書き出しました', f);
      } catch (e) {
        toast('err', '書き出せませんでした', e.message);
      }
    },
    setting: async (el) => {
      const key = el.dataset.key;
      const cur = key === 'autoRestorePoint' ? S.init.settings[key] !== false : !!S.init.settings[key];
      S.init.settings = await call('setSetting', key, !cur);
      render();
    },
    cleanScan: async () => {
      S.cleanup = 'loading';
      render();
      try {
        S.cleanup = await call('cleanupScan');
      } catch (e) {
        S.cleanup = null;
        toast('err', 'スキャンできませんでした', e.message);
      }
      if (S.page === 'cleanup') render();
    },
    cleanRun: async (el) => {
      const ids = [...main.querySelectorAll('[data-clean]:checked')].map((c) => c.dataset.clean);
      if (!ids.length) return toast('info', '削除する項目を選んでください');
      el.disabled = true;
      try {
        const res = await call('cleanupRun', ids);
        const freed = res.reduce((s, r) => s + r.freed, 0);
        toast('ok', `${fmtBytes(freed)} を削除しました`, res.some((r) => r.remaining > 0) ? '使用中のファイルは残っています' : '');
        S.cleanup = await call('cleanupScan');
      } catch (e) {
        toast('err', '削除できませんでした', e.message);
      }
      if (S.page === 'cleanup') render();
    },
    flushDns: async () => {
      try {
        await call('flushDns');
        toast('ok', 'DNSキャッシュをクリアしました');
      } catch (e) {
        toast('err', 'クリアできませんでした', e.message);
      }
    },
    ping: async (el) => {
      const host = $('#pingHost').value.trim();
      const out = $('#pingResult');
      el.disabled = true;
      out.textContent = '計測しています…';
      try {
        const r = await call('ping', host);
        out.textContent = r.received ? `平均 ${r.avg} ms（最小 ${r.min} / 最大 ${r.max}）・応答 ${r.received}/${r.sent}` : '応答がありません';
      } catch (e) {
        out.textContent = e.message;
      }
      el.disabled = false;
    },
    gameFill: (el) => {
      $('#gameExe').value = el.dataset.exe;
    },
    gameAdd: async () => {
      const exe = $('#gameExe').value.trim();
      try {
        await call('gameSet', exe, $('#gamePrio').value);
        toast('ok', `${exe} を登録しました`, '次にゲームを起動したときから反映されます');
        S.games = await call('gameList');
        render();
      } catch (e) {
        toast('err', '登録できませんでした', e.message);
      }
    },
    gameRemove: async (el) => {
      try {
        await call('gameRemove', el.dataset.exe);
        S.games = await call('gameList');
        render();
      } catch (e) {
        toast('err', '解除できませんでした', e.message);
      }
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
  });

  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-dns]');
    if (!sel || !sel.value) return;
    const provider = sel.value;
    sel.disabled = true;
    try {
      await call('setDns', Number(sel.dataset.dns), provider);
      toast('ok', 'DNSを変更しました');
      S.adapters = await call('netAdapters');
    } catch (err) {
      toast('err', 'DNSを変更できませんでした', err.message);
    }
    if (S.page === 'network') render();
  });

  // ───────── 起動 ─────────
  function setupChrome() {
    $('#logo').innerHTML = icon('bolt', 22);
    $('#wMin').innerHTML = icon('minus', 14);
    $('#wMax').innerHTML = icon('square', 12);
    $('#wClose').innerHTML = icon('x', 14);
    $('#wMin').onclick = () => api.minimize();
    $('#wMax').onclick = () => api.maximize();
    $('#wClose').onclick = () => api.close();
    api.onWinState((s) => {
      $('#wMax').innerHTML = icon(s.maximized ? 'squares' : 'square', 12);
    });
    $('#rebootNow').onclick = async () => {
      const r = await modal({ title: '今すぐ再起動しますか？', desc: '開いているアプリを保存してから再起動してください。5秒後に再起動します。', buttons: [{ label: 'キャンセル', cls: 'ghost', value: false }, { label: '再起動', cls: 'primary', value: true }] });
      if (r && r.value) call('reboot');
    };
  }

  async function start() {
    setupChrome();
    main.innerHTML = '<div class="loading" style="height:100%">' + '<div class="spinner"></div>読み込んでいます…</div>';
    try {
      S.init = await call('init');
    } catch (e) {
      main.innerHTML = `<div class="page"><div class="note warn">${icon('alert', 16)}<span class="grow">起動に失敗しました: ${esc(e.message)}</span></div></div>`;
      return;
    }
    render();
    tickUsage();
    call('sysInfo')
      .then((s) => {
        S.sys = s;
        if (S.page === 'home' || S.page === 'auto') render();
      })
      .catch((e) => toast('err', 'システム情報を取得できませんでした', e.message));
    await refreshStates();
    if (S.page !== 'cleanup') render();
  }

  start();
})();
