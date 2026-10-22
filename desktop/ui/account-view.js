(() => {
  'use strict';
  const validMode = value => value === 'api' || value === 'subscription';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  function windowText(item) {
    const used = number(item.usedPercent);
    return used === null ? '额度比例未知' : `已用 ${used.toFixed(1)}% · 剩余 ${Math.max(0, 100 - used).toFixed(1)}%${item.stale ? '（历史读数，待更新）' : ''}`;
  }
  function tokenText(value) { const n = number(value); return n === null ? '暂无记录' : n.toLocaleString() + ' token'; }
  function quotaLabel(item) { return item.label || (item.windowDurationMins === 300 ? '5 小时额度' : item.windowDurationMins === 10080 ? '每周额度' : '额度窗口'); }
  function noticeText(value) {
    if (!value || value.notify === false) return '';
    if (value.failureKind === 'high-demand') return '挤不进去...';
    return number(value.tokens) === null ? '本轮 token 暂无记录' : '本轮本机已观测：' + tokenText(value.tokens);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { validMode, windowText, tokenText, noticeText, quotaLabel };
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const key = 'dshw-account-view';
  let mode = 'api', card = null, content = null, root = null, generation = 0, switching = false, latestNotice = null;
  let modeButtons = [], status = null, modeRevision = 0;
  try { const saved = localStorage.getItem(key); if (validMode(saved)) mode = saved; } catch {}
  function text(parent, tag, value) { const el = document.createElement(tag); el.textContent = value; parent.append(el); return el; }
  function date(value) { if (!value) return '未知'; const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : '未知'; }

  // WHALE_SESSION_CARD_V3: the widget has no verified foreground thread id.
  let selectedSession = '';
  try { selectedSession = localStorage.getItem('whale-session-card-selection-v3') || ''; } catch {}
  const exactTokens = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : '—';
  function cachePercent(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return '—';
    if (value < 100 && value >= 99.95) return '>99.9%';
    return value.toFixed(1) + '%';
  }
  function shortTime(value) {
    return Number.isFinite(value) && value > 0 ? new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '—';
  }
  function quotaSummary(parent, sub) {
    const source = sub.source === 'official-rpc' ? 'Codex 官方主动查询' : sub.source === 'local-snapshot' ? '本地快照' : '等待查询';
    text(parent, 'small', '来源：' + source);
    if (Number.isFinite(sub.observedAt)) text(parent, 'small', '更新：' + date(sub.observedAt));
    // Retain only an actionable status, never the removed explanatory paragraphs.
    if (sub.errorCode) {
      const labels = { RPC_TIMEOUT:'查询超时', RATE_LIMITED:'稍后重试', AUTH_REQUIRED:'需要登录', ACCOUNT_CHANGED:'账号已切换，请刷新' };
      text(parent, 'small', (labels[sub.errorCode] || '本次查询失败') + (sub.available ? '，保留上次结果' : ''));
    }
  }
  // WHALE_RIN_PROJECT_V5: labels are read from Desktop's saved project metadata.
  function sessionTable(parent, data) {
    const area=text(parent,'section','');area.className='whale-session-card';
    const render=()=>{
      area.replaceChildren();
      const rows=Array.isArray(data.sessions)?data.sessions:[];
      const item=selectedSession?rows.find(s=>s.sessionId===selectedSession):rows[0];
      const heading=text(area,'div','');heading.className='whale-session-heading';text(heading,'strong','统计对象');
      const select=document.createElement('select');select.setAttribute('aria-label','选择项目或会话');
      text(select,'option','最近活跃项目 / 会话').value='';
      const projects=rows.filter(s=>s.kind==='project'),sessions=rows.filter(s=>s.kind!=='project');
      const names=new Map();for(const p of projects)names.set(p.projectName,(names.get(p.projectName)||0)+1);
      if(projects.length){const g=text(select,'optgroup','');g.label='项目汇总';for(const p of projects){
        text(g,'option',p.projectName+(names.get(p.projectName)>1?' · '+p.projectId.slice(-5):'')).value=p.sessionId;
      }}
      if(sessions.length){const g=text(select,'optgroup','');g.label='单独会话';for(const r of sessions){
        text(g,'option',(r.projectName||'未关联项目')+' · '+r.sessionId.slice(0,8)).value=r.sessionId;
      }}
      if(selectedSession&&!item)text(select,'option','所选对象暂未读到').value=selectedSession;
      select.value=selectedSession;select.title=item?.projectName||'选择项目或会话';
      select.onchange=()=>{selectedSession=select.value;try{localStorage.setItem('whale-session-card-selection-v3',selectedSession);}catch{}
        window.dispatchEvent(new Event('rin-session-selected'));render();position();window.WhaleRendering?.presentFor(150);};heading.append(select);
      const title=text(area,'strong',(item?.projectName||'未关联项目')+(item?.kind==='project'?' · 项目用量':' · 会话用量'));
      title.className='rin-v5-project-title';
      const t=item?.tokens||{},table=text(area,'table','');table.className='whale-session-table';table.setAttribute('aria-label','项目或会话 Tokens 与缓存命中率');
      const body=text(table,'tbody','');
      for(const [key,label,value] of [['total','累计 Tokens',exactTokens(t.total)],['input','输入 Tokens',exactTokens(t.input)],
        ['cachedInput','其中缓存命中',exactTokens(t.cachedInput)],['output','输出 Tokens',exactTokens(t.output)],['cacheHitPercent','缓存命中率',cachePercent(t.cacheHitPercent)]]){
        const tr=text(body,'tr','');tr.dataset.metric=key;text(tr,'th',label).scope='row';text(tr,'td',value);
      }
      const meta=text(area,'small','');meta.className='whale-session-meta';
      if(!item)meta.textContent='暂无记录';
      else if(item.kind==='project'){
        meta.textContent='已读 '+item.includedSessions+' 个主会话'+(item.partial?' · 部分记录':'');
        meta.title='项目内已读取的非分叉主会话累计快照之和'+(item.excludedForks?'；'+item.excludedForks+' 个分叉会话单列，未重复并入':'')+(item.partial?'；有记录缺失或达到读取上限':'');
      }else{meta.textContent=item.sessionId.slice(0,8)+' · '+shortTime(item.observedAt)+(item.isFork?' · 分叉会话':'');}
      if(item?.projectIndexStatus&&item.projectIndexStatus!=='ok')text(area,'small','项目名暂未读到');
      else if(item?.projectMatch==='ambiguous')text(area,'small','项目归属待确认');
    };render();
  }

  function close() { generation++; card?.remove(); card = content = null; }
  function position() {
    if (!card) return;
    const anchor = (root || document).querySelector('.dshwv-img') || document.querySelector('.dshwv-img');
    if (!anchor) return;
    const bounds = anchor.getBoundingClientRect(), width = card.offsetWidth || 280, height = card.offsetHeight || 220;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, bounds.right - width)) + 'px';
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, bounds.top - height - 10 >= 8 ? bounds.top - height - 10 : bounds.bottom + 10)) + 'px';
    if(card.style.left!==left)card.style.left=left;
    if(card.style.top!==top)card.style.top=top;
  }
  function updateButtons() { for (const button of modeButtons) { button.disabled = switching; button.setAttribute('aria-pressed', String(button.dataset.mode === mode)); } for(const el of document.querySelectorAll('[data-account-api]'))el.hidden=mode==='subscription';
    document.documentElement.dataset.accountMode = mode;
    for (const el of document.querySelectorAll('.whale-mode-description')) el.textContent = mode === 'subscription' ? '查看订阅额度、会话 Tokens 与缓存命中率' : '查看当前 API 余额与消费记录';
    for (const el of document.querySelectorAll('.whale-mode-open')) el.textContent = mode === 'subscription' ? '查看订阅额度 →' : '配置 API 余额 →';
  }
  function followCard(ownCard) {
    if (card !== ownCard) return;
    position(); window.requestAnimationFrame(() => followCard(ownCard));
  }
  function commit(next) {
    mode = next; try { localStorage.setItem(key, mode); } catch {}
    close(); latestNotice = null; updateButtons();
    window.dispatchEvent(new CustomEvent('whale-account-view', { detail: { mode } }));
  }
  async function setMode(next) {
    if (!validMode(next) || switching) return false;
    modeRevision++; switching = true; updateButtons(); if (status) status.textContent = '正在保存…';
    try {
      const response = await fetch('/api/display-mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) });
      if (!response.ok) throw Error('切换失败，请重试');
      const result = await response.json();
      if (result.ok === false || (result.mode || result.displayMode) !== next) throw Error('模式未保存，请重试');
      commit(next); if (status) status.textContent = next === 'subscription' ? '已切换。点击下方按钮查看额度。' : '已切换为 API 余额模式。'; return true;
    } catch (e) { if (status) status.textContent = e.message || '切换失败，请重试'; return false; }
    finally { switching = false; updateButtons(); }
  }
  async function refresh() {
    if (mode !== 'subscription' || !card) return;
    const own = ++generation;
    let loading = content.querySelector('[data-quota-loading]');
    if (!loading) { loading = text(content, 'small', ''); loading.dataset.quotaLoading = '1'; }
    loading.textContent = '刷新中…'; position();
    try {
      const data = window.WhaleRinUiV4 ? await window.WhaleRinUiV4.readInsights() : await fetch('/api/insights', { cache: 'no-store' }).then(async response => { if (!response.ok) throw Error('暂时无法读取订阅快照'); return response.json(); }); if (own !== generation || !card) return;
      content.replaceChildren(); const sub = data.subscription || {};
      // WHALE_LOCAL_SUBSCRIPTION_COMPAT_V1
      quotaSummary(content, sub);
      if (!sub.available) text(content, 'p', '暂无可用额度');
      else {
        if (!(sub.windows || []).length) text(content, 'p', '暂无可用额度窗口');
        for (const item of sub.windows || []) {
          const section = text(content, 'section', ''); text(section, 'strong', quotaLabel(item)); text(section, 'p', windowText(item));
          const used = number(item.usedPercent);
          if (used !== null) { const meter = document.createElement('progress'); meter.max = 100; meter.value = Math.min(100, used); meter.setAttribute('aria-label', item.label || '已用额度'); section.append(meter); }
          text(section, 'small', '重置：' + date(item.resetsAt));
        }
      }
      text(content,'p',window.WhaleRinUiV4?.creditText(sub.credits)||'剩余余额：未返回');
      sessionTable(content, data); position();
    } catch (e) { if (own === generation && content) { const hint = content.querySelector('[data-quota-loading]') || text(content, 'small', ''); hint.textContent = '界面刷新失败，以上为上次显示，请稍后重试。'; position(); } }
  }
  function toggleBubble(anchorRoot) {
    if (mode !== 'subscription') return false;
    if (card) { close(); return true; }
    root = anchorRoot?.querySelector ? anchorRoot : document;
    card = document.createElement('section'); card.className = 'whale-account-card'; card.setAttribute('aria-label', '会员订阅额度');
    const header = text(card, 'div', ''); header.className = 'whale-account-header'; text(header, 'strong', '会员订阅额度');
    const closeButton = text(header, 'button', '关闭'); closeButton.onclick = close;
    content = text(card, 'div', ''); const refreshButton = text(card, 'button', '刷新'); refreshButton.onclick = refresh;
    document.body.append(card); followCard(card); refresh(); return true;
  }
  function notice(value) {
    if (mode !== 'subscription') return;
    latestNotice = value;
    const message = noticeText(value);
    if (message && !window.WhaleRinUiV4?.showTurnNotice(value)) window.whaleToast?.(message);
    if (card) refresh();
  }
  function init() {
    const style = document.createElement('style'); style.textContent = `.whale-account-card{position:fixed;z-index:2147483646;width:280px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;box-sizing:border-box;padding:14px;border:1px solid #9fcbd5;border-radius:16px;background:#f6fdff;color:#173d48;box-shadow:0 8px 26px #163f4433;font:13px/1.5 system-ui;pointer-events:auto}.whale-account-card p{margin:8px 0}.whale-account-card small{display:block;color:#496873}.whale-account-card progress{width:100%;accent-color:#258b9c}.whale-account-header{display:flex;justify-content:space-between;align-items:center}.whale-account-card button,.whale-account-menu button{cursor:pointer;border:1px solid #9fcbd5;border-radius:8px;padding:5px 9px;background:#fff;color:#173d48}.whale-account-menu{font:12px/1.5 system-ui;padding:5px}.whale-account-menu summary{cursor:pointer}.whale-account-menu button[aria-pressed=true]{background:#237f91;color:white}.whale-account-menu small{display:block;max-width:230px;margin-top:5px}`; style.textContent += ".whale-account-card{width:304px;font-family:\"Segoe UI\",\"Microsoft YaHei\",\"Noto Sans CJK SC\",system-ui,sans-serif}.whale-session-card{margin-top:12px;padding-top:10px;border-top:1px solid #d4e7eb}.whale-session-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}.whale-session-heading select{max-width:65%;min-width:0;border:1px solid #bbd8df;border-radius:7px;padding:4px 5px;color:inherit;background:#fff;font:inherit}.whale-session-table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}.whale-session-table th,.whale-session-table td{padding:5px 0;border:0;font-size:13px;line-height:1.4}.whale-session-table th{font-weight:400;text-align:left}.whale-session-table td{text-align:right;white-space:nowrap}.whale-session-table tr:first-child th,.whale-session-table tr:first-child td,.whale-session-table tr:last-child td{font-weight:700}.whale-session-table tr:nth-child(3) th{padding-left:10px;color:#496873}.whale-session-table tr:last-child th,.whale-session-table tr:last-child td{padding-top:7px;border-top:1px solid #e1eef1}.whale-session-meta{margin:6px 0 2px;font-size:11px}.whale-account-card>div>small{line-height:1.45}.whale-account-header{margin-bottom:6px}"; document.head.append(style);
    const menu = document.querySelector('.dshwv-menu');
    if (menu) {
      const details = text(menu, 'section', ''); details.className = 'whale-account-menu'; text(details, 'strong', '小鲸鱼 · 控制面板'); menu.prepend(details);
      const row = text(details, 'div', ''); row.setAttribute('role', 'group'); row.setAttribute('aria-label', '额度展示模式');
      for (const [value, label] of [['api', 'API 余额'], ['subscription', 'Codex 订阅']]) { const button = text(row, 'button', label); button.dataset.mode = value; button.onclick = () => setMode(value); modeButtons.push(button); }
      text(details, 'p', '').className = 'whale-mode-description';
      const open = text(details, 'button', ''); open.className = 'whale-mode-open'; open.onclick = () => window.dispatchEvent(new Event(mode === 'subscription' ? 'whale-open-insights' : 'whale-open-settings'));
      status = text(details, 'small', '切换展示模式，不修改登录账号。'); status.setAttribute('role', 'status'); updateButtons();
      const view = menu.querySelector('.dshwv-menuview');
      if (view) {
        const rows = [...view.children];
        const groups = ['外观与位置', '声音与气泡', '用量与资源'].map(label => {
          const group = document.createElement('details'); group.className = 'whale-menu-group';
          text(group, 'summary', label); view.append(group); return group;
        });
        groups[0].open = true;
        for (const child of rows) {
          if (child.classList.contains('dshwv-menu-sep')) { child.remove(); continue; }
          const label = child.textContent;
          const index = /音效|音量|气泡|消耗提示|声音/.test(label) ? 1 : /币种|汇率|资源|工坊|API|额度|峰谷/.test(label) ? 2 : 0;
          groups[index].append(child);
        }
      }
    }
    const initialRevision = modeRevision;
    fetch('/api/display-mode', { cache: 'no-store' }).then(async response => { if (!response.ok) return; const data = await response.json(); const next = data.mode || data.displayMode; if (validMode(next) && !switching && modeRevision === initialRevision) commit(next); }).catch(() => {});
    window.addEventListener('resize', position);
    // WHALE_OFFICIAL_QUOTA_V2: no background polling when this quota card is closed.
    setInterval(() => { if (card && mode === 'subscription' && !document.hidden) refresh(); }, 60000);
    window.addEventListener('whale-mode-changing', close);
  }
  window.WhaleAccountView = { get mode() { return mode; }, get selectedSession() { return selectedSession; }, hasSessionCardV3: true, toggleBubble, refresh, notice, close, setMode, quotaLabel };
  // Deferred scripts run at readyState=interactive before the widget creates its menu.
  if (document.readyState !== 'complete') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();

/* WHALE_RIN_BUBBLE_V4
 * UI integration for the user's v1+v2+v3 Whale build. MIT.
 * DSH bubble SVG and staggered transition timings: MeteorNOX / Yang-huai406.
 * See SOURCE-NOTICES.txt. No changes to the role image or native press handler.
 */
;(() => {
  'use strict';
  const ID = 'whale-rin-project-v5';
  const STORE = 'dshw-rin-ui-v4';
  // WHALE_RIN_PROJECT_V5: local edition 2026-10-19, no live content feed.
  let DEFAULT_QUOTES = ['你忙你的，凛在这里。'];
  fetch('/theme/quotes.json').then(r => r.json()).then(items => {
    if (Array.isArray(items)) { const valid=items.filter(x=>typeof x==='string'&&x.trim()).slice(0,512); if(valid.length)DEFAULT_QUOTES=valid; }
  }).catch(()=>{});
  const LEGACY_QUOTES = ["哼，又来戳我啦？", "你忙你的，凛在这里。", "耳朵不许一直戳啦。", "看完额度，也看看我嘛。", "嗯？我可没有在打瞌睡。", "慢慢来，我陪着你。"];
  const DEFAULTS = { strip: true, gap: 8, bottom: 4, width: 238, flow: true, builtins: true, quotes: [], bubbleIdleSeconds: 30, turnNoticeSeconds: 5 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const count = v => Number.isSafeInteger(v) && v >= 0;
  function cleanSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const n = (k, lo, hi) => finite(r[k]) ? clamp(Math.round(r[k]), lo, hi) : DEFAULTS[k];
    let quotes=Array.isArray(r.quotes)?[...new Set(r.quotes.filter(x=>typeof x==='string').map(x=>x.replace(/[\x00-\x1f\x7f]/g,' ').trim()).filter(Boolean).map(x=>[...x].slice(0,48).join('')))].slice(0,200):[];
    if(quotes.length===LEGACY_QUOTES.length&&quotes.every((x,i)=>x===LEGACY_QUOTES[i]))quotes=[];
    return {strip:r.strip!==false,gap:n('gap',4,1000),bottom:n('bottom',0,1000),width:n('width',160,360),
      flow:r.flow!==false,builtins:r.builtins!==false,quotes,
      bubbleIdleSeconds:n('bubbleIdleSeconds',1,600),turnNoticeSeconds:n('turnNoticeSeconds',1,600)};
  }

  function compactTokens(value) {
    if (!count(value)) return '—';
    const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (let i = 0; i < units.length; i++) {
      const [factor, suffix] = units[i];
      if (value >= factor) {
        const v = Math.round(value / factor * 10) / 10;
        if (v >= 1000 && i > 0) return (v / 1000).toFixed(1) + units[i - 1][1];
        return v.toFixed(1) + suffix;
      }
    }
    return String(value);
  }
  function percent(value) {
    if (!finite(value) || value < 0 || value > 100) return '—';
    if (value < 100 && value >= 99.95) return '>99.9%';
    return value.toFixed(1) + '%';
  }
  function turnNoticeText(notice) {
    if (!notice || notice.notify === false) return '';
    if (notice.failureKind === 'high-demand') return '挤不进去...';
    const label = notice.completionKind === 'cancelled' ? '本轮已取消' : notice.completionKind === 'failed' ? '本轮未完成' : '本轮消耗';
    return count(notice.tokens) ? label + '：' + compactTokens(notice.tokens) + 'token' : label + ' · token 暂无记录';
  }
  function selectSession(data, selected = '') {
    const rows = Array.isArray(data?.sessions) ? data.sessions : [];
    return (selected ? rows.find(s => s && s.sessionId === selected) : rows[0]) || null;
  }
  function stripReading(data, selected) {
    const session = selectSession(data, selected), t = session?.tokens;
    const total = count(t?.total) ? t.total : null;
    const cache = count(t?.input) && t.input > 0 && count(t?.cachedInput) && t.cachedInput <= t.input
      ? 100 * t.cachedInput / t.input : null;
    return { session, total, cache, text: compactTokens(total) + ' tok · 缓存 ' + percent(cache) };
  }
  function pickQuota(sub) {
    // Prefer the weekly Codex/account window. Do not combine unrelated buckets.
    const rows = (Array.isArray(sub?.windows) ? sub.windows : []).filter(w =>
      w && finite(w.usedPercent) && w.usedPercent >= 0 && finite(w.windowDurationMins) && w.windowDurationMins > 0);
    const account = rows.filter(w => !w.limitId || w.limitId === 'codex');
    const source = account;
    return source.find(w => w.windowDurationMins === 10080) || null;
  }
  function quotaReading(sub, now = Date.now()) {
    const w = sub?.available === false ? null : pickQuota(sub);
    if (!w) return {text:'剩余周额度：未返回',stale:!!sub?.credits&&(!!sub.errorCode||!finite(sub.observedAt)||now-sub.observedAt>120000),window:null};
    const remaining = clamp(100 - w.usedPercent, 0, 100);
    const stale = !!w.stale || !!sub.errorCode || !finite(sub.observedAt) || now - sub.observedAt > 120000 ||
      (finite(w.resetsAt) && w.resetsAt <= now);
    return { text: '剩余周额度：' + remaining.toFixed(1) + '%', stale, window: w };
  }
  function chooseQuote(quotes, last, random = Math.random) {
    const choices = quotes.length > 1 ? quotes.filter(q => q !== last) : quotes;
    const usable = choices.length ? choices : DEFAULT_QUOTES;
    return usable[clamp(Math.floor(random() * usable.length), 0, usable.length - 1)];
  }
  function creditText(credits) {
    if(credits?.unlimited===true)return '剩余余额：不限额';
    const value=credits?.balance;
    if(typeof value!=='string'||value.length>80||!/^\d+(?:\.\d+)?$/.test(value))return '剩余余额：未返回';
    const [a,b]=value.split('.');const integer=a.replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
   return '剩余余额：' + Number(value).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }
  function createQuoteBag(random=Math.random,history=[]) {
    let bag=[],signature='',recent=history.filter(x=>typeof x==='string').slice(-12);
    return {next(lines){
      const pool=[...new Set(lines.length?lines:DEFAULT_QUOTES)],key=JSON.stringify(pool);
      if(key!==signature){signature=key;bag=[];}
      if(!bag.length){bag=[...pool];for(let i=bag.length-1;i>0;i--){const j=clamp(Math.floor(random()*(i+1)),0,i);[bag[i],bag[j]]=[bag[j],bag[i]];}}
      let at=bag.findIndex(x=>!recent.includes(x));if(at<0)at=bag.findIndex(x=>x!==recent.at(-1));if(at<0)at=0;
      const result=bag.splice(at,1)[0];recent.push(result);recent=recent.slice(-Math.min(12,Math.max(1,pool.length-1)));return result;
    },history(){return [...recent];}};
  }
  function mergeSessions(full, local) {
    if (!local || (full && finite(full.sessionReadAt) && full.sessionReadAt > (local.sessionReadAt || 0))) return full || {};
    return { ...(full || {}), sessions: local.sessions || [], sessionReadAt: local.sessionReadAt || null,
      sessionListLimited: !!local.sessionListLimited };
  }
  function stripPosition(pet, viewport, size, opts, mirrored = false) {
    const pad = 6, gap = opts.gap;
    const leftRoom = Math.max(0, pet.left - gap - pad), rightRoom = Math.max(0, viewport.width - pet.right - gap - pad);
    const right = mirrored ? rightRoom >= 150 || rightRoom >= leftRoom : leftRoom < 150 && rightRoom > leftRoom;
    const room = right ? rightRoom : leftRoom;
    const width = Math.min(size.width, opts.width, room);
    if (width < 150 || viewport.height < size.height + 8) return null;
    return { left: clamp(right ? pet.right + gap : pet.left - gap - width, pad, viewport.width - width - pad),
      top: clamp(viewport.height - opts.bottom - size.height, pad, viewport.height - size.height), width, compact: width < 205 };
  }
  // Exact path, ellipses, stroke and viewBox of the original Whale thought bubble.
  const SVG = '<svg viewBox="0 0 1026 700" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path class="dshwv-bshape" fill="#FFFFFF" stroke="#203170" stroke-width="18" stroke-linejoin="round" stroke-linecap="round" d="M 827 248 A 373 232 0 1 0 81 246 A 373 232 0 0 0 301 465 A 57 32 10 0 0 413 484 A 373 232 0 0 0 827 248 Z"/>' +
    '<ellipse class="dshwv-b1" cx="352" cy="561" rx="37.5" ry="26" fill="#FFFFFF" stroke="#203170" stroke-width="18"/>' +
    '<ellipse class="dshwv-b2" cx="442" cy="646" rx="24.5" ry="18" fill="#FFFFFF" stroke="#203170" stroke-width="18"/></svg>';
  const CSS = `
.rin-v4-bubble.dshwv-pop{position:fixed;z-index:20002;pointer-events:none;user-select:none;--dshw-base:320px;width:var(--dshw-base);height:auto;aspect-ratio:1026/700}
.rin-v4-bubble[hidden],.rin-v4-strip[hidden]{display:none!important}
.rin-v4-bubble>svg{overflow:visible}
.rin-v4-bubble.rin-v4-mirror>svg{transform:scaleX(-1)}
.rin-v4-bubble .rin-v4-content{position:absolute;left:44.25%;top:35.7%;width:60%;height:53%;transform:translate(-50%,-50%);box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0;transition:opacity .16s ease;pointer-events:none}
.rin-v4-bubble.rin-v4-mirror .rin-v4-content{left:55.75%}
.rin-v4-bubble.dshwv-pop-open .rin-v4-content{opacity:1;transition:opacity .16s ease .36s}
.rin-v4-content .rin-v4-message{all:unset;display:block;box-sizing:border-box;width:100%;max-width:100%;text-align:center;color:#60406f;font:700 19px/1.35 "Segoe UI","Microsoft YaHei",system-ui,sans-serif;cursor:pointer;white-space:normal;overflow-wrap:anywhere;pointer-events:none}
.rin-v4-bubble.dshwv-pop-open:not([inert]) .rin-v4-message{pointer-events:auto}
.rin-v4-message:focus-visible{outline:2px solid #8e73bd;outline-offset:3px;border-radius:7px}
/* WHALE_RIN_TEXT_FLOW_V41: animate the glyph fill, not just the underline. */
@supports ((-webkit-background-clip:text) or (background-clip:text)){
.rin-v4-bubble[data-text-flow=true]:not([data-state=error]) .rin-v4-message{background-image:linear-gradient(90deg,#463049 0%,#70459c 24%,#a55b9c 49%,#8352b3 74%,#463049 100%);background-size:200% 100%;background-repeat:repeat;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;text-shadow:none;animation:rin-v41-text-flow 3.6s linear infinite}
.rin-v4-bubble:not(.dshwv-pop-open) .rin-v4-message{animation-play-state:paused}
}
@keyframes rin-v41-text-flow{from{background-position:0% 50%}to{background-position:200% 50%}}
@media(prefers-reduced-motion:reduce){.rin-v4-bubble .rin-v4-message{animation:none!important;background-position:45% 50%}}
@media(forced-colors:active){.rin-v4-bubble .rin-v4-message{background-image:none!important;color:ButtonText!important;-webkit-text-fill-color:ButtonText!important;animation:none!important}}
.rin-v4-flow{width:66%;max-width:140px;height:3px;flex:none;border-radius:10px;opacity:.85;background:linear-gradient(90deg,#463049 0%,#70459c 24%,#a55b9c 49%,#8352b3 74%,#463049 100%);background-size:200% 100%;animation:rin-v4-flow 3.6s linear infinite}
.rin-v4-bubble:not(.dshwv-pop-open) .rin-v4-flow{animation-play-state:paused}
.rin-v4-bubble[data-state=loading] .rin-v4-flow{animation-duration:1.3s}
.rin-v4-bubble[data-stale=true] .rin-v4-flow{opacity:.55}
.rin-v4-stale{position:absolute;right:4px;bottom:2px;width:5px;height:5px;border-radius:50%;background:#be914e;pointer-events:none}
.rin-v4-stale[hidden],.rin-v4-flow[hidden]{display:none!important}
@keyframes rin-v4-flow{from{background-position:0 0}to{background-position:200% 0}}
.rin-v4-strip{all:unset;position:fixed;z-index:20001;display:flex;align-items:center;justify-content:center;gap:5px;height:21px;padding:0 7px;box-sizing:border-box;border-radius:7px;color:#60687a;background:rgba(255,255,255,.28);font:11px/21px "Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;pointer-events:auto;user-select:none;overflow:hidden;text-overflow:ellipsis;box-shadow:none}
.rin-v4-strip:hover,.rin-v4-strip:focus-visible{background:rgba(237,234,249,.95);color:#574b80;outline:1px solid rgba(146,129,177,.45)}
.rin-v4-strip[data-compact=true]{font-size:10px;gap:3px;padding:0 4px}
.rin-v4-strip .rin-v4-scope{font-size:10px;opacity:.7}
.rin-v4-strip[data-compact=true] .rin-v4-scope{display:none}
.rin-v4-strip[data-error=true]{text-decoration:underline dotted;text-underline-offset:3px}
.rin-v4-settings.rin-v4-settings{max-width:min(400px,calc(100vw - 24px));width:360px;box-sizing:border-box;max-height:calc(100vh - 24px);overflow:auto;border:1px solid #b9add0;border-radius:14px;padding:16px;background:#fdfbff;color:#44395b;font:13px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.rin-v4-settings.rin-v4-settings::backdrop{background:transparent}
.rin-v4-settings.rin-v4-settings h3{font-size:16px;margin:0 0 12px}
.rin-v4-settings.rin-v4-settings label{display:block;margin:9px 0}
.rin-v4-settings.rin-v4-settings input[type=checkbox]{appearance:auto;width:15px;height:15px;padding:0;margin:0 7px 0 0;vertical-align:middle;accent-color:#8b78b2}
.rin-v4-settings.rin-v4-settings input[type=number]{width:72px;margin-left:10px;padding:3px}
.rin-v4-settings.rin-v4-settings textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:100px;font:inherit;border:1px solid #cfc4de;border-radius:6px;padding:6px;background:white;color:inherit}
.rin-v4-settings.rin-v4-settings .rin-v4-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.rin-v4-settings.rin-v4-settings button{font:inherit;padding:5px 9px;border:1px solid #b9add0;border-radius:7px;background:#fff;color:#574b80;cursor:pointer}
.rin-v4-settings.rin-v4-settings small{display:block;color:#746885}
@media(prefers-reduced-motion:reduce){.rin-v4-bubble .rin-v4-flow{animation:none!important}.rin-v4-bubble .dshwv-bshape,.rin-v4-bubble .dshwv-b1,.rin-v4-bubble .dshwv-b2,.rin-v4-bubble .rin-v4-content{transition:none!important}}

/* WHALE_RIN_PROJECT_V5: no underline, separate weekly and balance text. */
.rin-v4-bubble .rin-v4-flow{display:none!important}
.rin-v4-bubble .rin-v4-content{gap:7px;width:64%;}
.rin-v4-content .rin-v5-balance{display:block;max-width:100%;font:500 13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:#705080;pointer-events:none;}
.rin-v4-content .rin-v5-balance[hidden]{display:none!important}
.rin-v5-project-title{display:block;overflow-wrap:anywhere;margin:5px 0;color:#614478;font-size:13px}
.rin-v4-strip .rin-v4-scope{max-width:90px;min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rin-v4-strip>span:last-child{flex:0 0 auto}
.rin-v4-strip[data-compact=true] .rin-v4-scope{display:inline;max-width:42px}
.rin-v4-bubble[data-text-flow=true]:not([data-state=error]) .rin-v5-balance{background-image:linear-gradient(90deg,#463049 0%,#70459c 24%,#a55b9c 49%,#8352b3 74%,#463049 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:rin-v41-text-flow 3.6s linear infinite}
.rin-v4-bubble:not(.dshwv-pop-open) .rin-v5-balance{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.rin-v4-bubble .rin-v5-balance{animation:none!important}}
@media(forced-colors:active){.rin-v4-bubble .rin-v5-balance{background:none!important;color:ButtonText!important;-webkit-text-fill-color:ButtonText!important}}
`;
  const pure = { ID, cleanSettings, compactTokens, turnNoticeText, percent, selectSession, stripReading, pickQuota,
    quotaReading, chooseQuote, creditText, createQuoteBag, DEFAULT_QUOTES, mergeSessions, stripPosition, SVG, CSS };
  if (typeof module !== 'undefined' && module.exports) module.exports = { ...module.exports, ...pure };
  if (typeof document === 'undefined' || typeof window === 'undefined' || window.WhaleRinUiV4) return;

  let options = cleanSettings(null);
  try { options = cleanSettings(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch {}
  let bubble = null, strip = null, pet = null, root = null, account = null;
  let message = null, balanceText = null, staleDot = null, scopeLabel = null, stripValue = null;
  let state = 'closed', lastQuote = '', generation = 0, modeEpoch = 0, closeTimer = null, autoCloseTimer = null;
  let quoteHistory=[];try{quoteHistory=JSON.parse(localStorage.getItem('dshw-rin-quote-history-v5')||'[]');}catch{}
  const quoteBag=createQuoteBag(Math.random,Array.isArray(quoteHistory)?quoteHistory:[]);
  const quotePool=()=>{const p=[...(options.builtins?DEFAULT_QUOTES:[]),...options.quotes];return p.length?p:['凛在这里。'];};
  let fullData = null, localData = null, fullPending = null, localPending = null, localError = false;
  let lastFullAt = -Infinity, lastLocalAt = -Infinity, frame = 0, disposed = false, settingsDialog = null;
  let lastGeometry = '', poll = null, turnTimer = null, resizeObserver = null, placementObserver = null, offFrame = null;
  const listeners = [], controllers = new Set();
  const listen = (target, type, handler, opts) => { target.addEventListener(type, handler, opts); listeners.push(() => target.removeEventListener(type, handler, opts)); };
  const node = (parent, tag, value, cls) => { const e = document.createElement(tag); if (value) e.textContent = value; if (cls) e.className = cls; parent.append(e); return e; };
  const time = t => finite(t) ? new Date(t).toLocaleString() : '未知';
  const active = () => !disposed && account?.mode === 'subscription' && !document.hidden;
  function selected() { return account?.selectedSession || ''; }
  function present(ms = 0) { window.WhaleRendering?.presentFor(ms); }
  function invalidate() { present(120); window.dispatchEvent(new Event('whale-shape-request')); window.dispatchEvent(new Event('whale-interaction-geometry')); }
  function saved() { try { localStorage.setItem(STORE, JSON.stringify(options)); window.dispatchEvent(new Event('whale-position-committed')); } catch {} }
  async function jsonRequest(url) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 35000); controllers.add(controller);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw Error('UI_REQUEST_FAILED');
      const data = await response.json();
      if (!data || typeof data !== 'object' || data.ok === false) throw Error('UI_REQUEST_FAILED');
      return data;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function readInsights(force = true) {
    if (fullPending) return fullPending.promise;
    if (!force && fullData && Date.now() - lastFullAt < 15000) return mergeSessions(fullData, localData);
    const epoch = modeEpoch, job = { promise: null };
    job.promise = jsonRequest('/api/insights').then(data => {
      if (disposed || epoch !== modeEpoch) throw Error('VIEW_CHANGED');
      fullData = data; lastFullAt = Date.now();
      if (data.subscription?.errorCode === 'ACCOUNT_CHANGED' || data.subscription?.errorCode === 'API_LOGIN') fullData = data;
      if (Array.isArray(data.sessions) && (!localData || (data.sessionReadAt || 0) >= (localData.sessionReadAt || 0))) {
        localData = { sessions: data.sessions, sessionReadAt: data.sessionReadAt, sessionListLimited: data.sessionListLimited }; localError = false;
      }
      updateStrip(); return mergeSessions(fullData, localData);
    }).finally(() => { if (fullPending === job) fullPending = null; });
    fullPending = job; return job.promise;
  }
  async function readLocal(force = false) {
    if (!active()) return;
    if (localPending) return localPending.promise;
    if (!force && Date.now() - lastLocalAt < 10000) return;
    const epoch = modeEpoch, job = { promise: null }; lastLocalAt = Date.now();
    job.promise = jsonRequest('/api/insights/local').then(data => {
      if (disposed || epoch !== modeEpoch) return;
      if (data.error) { localError = true; return; }
      if (!Array.isArray(data.sessions)) throw Error('LOCAL_DATA_INVALID');
      if (!localData || (data.sessionReadAt || 0) >= (localData.sessionReadAt || 0) || !data.sessions.length) localData = data;
      localError = false;
    }).catch(() => { if (epoch === modeEpoch) localError = true; })
      .finally(() => { if (localPending === job) localPending = null; if (epoch === modeEpoch) updateStrip(); });
    localPending = job; return job.promise;
  }
  function updateStrip() {
    if (!strip) return;
    const r = stripReading(mergeSessions(fullData, localData), selected());
    scopeLabel.textContent=r.session?.projectName||(selected()?'锁定会话':'近活跃');stripValue.textContent=r.text;
    const identity = r.session ? (r.session.projectName||'未关联项目')+' · '+r.session.sessionId + ' · ' + time(r.session.observedAt) : selected() ? '所选会话暂未读到' : '等待会话用量';
    strip.title = (r.session?.kind==='project'?'项目汇总：':selected()?'已锁定会话：':'最近活跃会话：') + identity + '\n点击打开完整统计及会话选择' +
      (localError ? '\n本次更新失败，显示上次读数' : '')+(r.session?.partial?'\n部分记录，详见统计卡片':'');
    strip.dataset.error = String(localError||r.session?.partial);
    strip.setAttribute('aria-label', (selected() ? '锁定会话 ' : '最近活跃会话 ') + r.text + '，点击查看详情');
    schedulePosition(); present(80);
  }
  function stablePetRect() {
    if (!root || !pet) return null;
    const r = root.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0) || !pet.checkVisibility({ visibilityProperty: true })) return null;
    const protectedRect = window.WhaleRendering?.petInteraction?.protectedBounds(pet, root);
    if (protectedRect) return protectedRect;
    let x = 0, y = 0, p = pet;
    for (let depth = 0; p && p !== root && depth < 8; depth++) { x += p.offsetLeft; y += p.offsetTop; p = p.offsetParent; }
    if (p !== root || !root.offsetWidth || !root.offsetHeight) return pet.getBoundingClientRect();
    const sx = r.width / root.offsetWidth, sy = r.height / root.offsetHeight;
    const width = pet.offsetWidth * sx, height = pet.offsetHeight * sy;
    const left = root.classList.contains('dshwv-left') ? r.right - (x + pet.offsetWidth) * sx : r.left + x * sx;
    const top = r.top + y * sy;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }
  function put(el, field, value) { if (el.style[field] !== value) el.style[field] = value; }
  function hidden(el, value) { if (el && el.hidden !== value) el.hidden = value; }
  let fittedMessage = '';
  function fitMessage(width) {
    if (!message || !message.parentElement?.clientHeight) return;
    const key=[message.textContent,balanceText?.textContent,balanceText?.hidden,width,options.flow].join('|');
    if (key === fittedMessage) return;
    fittedMessage = key;
    const box = message.parentElement;
    const room=box.clientHeight-(balanceText&&!balanceText.hidden?balanceText.scrollHeight+7:0)-4;
    const fits = size => {
      put(message, 'fontSize', size.toFixed(2) + 'px');
      return message.scrollHeight <= room + .5 && message.scrollWidth <= box.clientWidth + .5;
    };
    const high = clamp(width * .063, 16, 23);
    if (fits(high)) return;
    let low = 10, upper = high;
    for (let i = 0; i < 9; i++) { const middle = (low + upper) / 2; if (fits(middle)) low = middle; else upper = middle; }
    fits(low);
  }
  function position() {
    frame = 0; if (disposed || !strip) return;
    const r = stablePetRect(), mirrored = root?.classList.contains('dshwv-left');
    if (!r || !active()) { hidden(strip, true); hidden(bubble, true); return; }
    const view = { width: innerWidth, height: innerHeight };
    const s = stripPosition(r, view, { width: options.width, height: 21 }, options, mirrored);
    hidden(strip, !options.strip || !s);
    if (s) { put(strip, 'left', Math.round(s.left) + 'px'); put(strip, 'top', Math.round(s.top) + 'px'); put(strip, 'width', Math.floor(s.width) + 'px'); strip.dataset.compact = String(s.compact); }
    if (bubble && (state !== 'closed' || closeTimer !== null)) {
      hidden(bubble, false);
      // Reuse the original root placement/proportions. Clamp only at viewport edges.
      const rootRect = root.getBoundingClientRect();
      const width = Math.min(clamp(rootRect.width, 285, 410), innerWidth - 12, (innerHeight - 12) * 1026 / 700);
      const height = width * 700 / 1026;
      const left = clamp(mirrored ? r.left : r.right - width, 6, Math.max(6, innerWidth - width - 6));
      const top = clamp(r.bottom - width, 6, Math.max(6, innerHeight - height - 6));
      put(bubble, 'left', Math.round(left) + 'px'); put(bubble, 'top', Math.round(top) + 'px');
      const px = Math.round(width) + 'px'; if (bubble.style.getPropertyValue('--dshw-base') !== px) bubble.style.setProperty('--dshw-base', px);
      bubble.classList.toggle('rin-v4-mirror', mirrored);
      fitMessage(width);
    }
    const next = [strip.hidden, strip.style.cssText, bubble?.hidden, bubble?.style.cssText, mirrored].join('|');
    if (next !== lastGeometry) { lastGeometry = next; present(); }
  }
  function schedulePosition() { if (!frame && !disposed) frame = requestAnimationFrame(position); }
  function showQuota(sub) {
    const result=quotaReading(sub);bubble.dataset.state='quota';message.textContent=result.text;balanceText.textContent=creditText(sub?.credits);balanceText.title=balanceText.textContent;balanceText.hidden=false;
    staleDot.hidden = !result.stale; bubble.dataset.stale = String(result.stale);
    bubble.title = (result.window?.label || '订阅额度') + '\n更新：' + time(sub?.observedAt) +
      (result.stale ? '\n上次读数，等待更新' : '') + (sub?.errorCode ? '\n' + sub.errorCode : '') + '\n点击换台词；右键刷新；再点凛收起';
    message.setAttribute('aria-label', result.text + (result.stale ? '，历史读数' : '') + '；点击换台词'); schedulePosition();present(180);
  }
  async function refreshBubble() {
    if (!active() || state === 'closed') return;
    const ticket = ++generation; state = 'quota'; bubble.dataset.state = 'loading'; bubble.dataset.stale = 'false';
    balanceText.hidden=true; message.textContent = '我在帮你看嘛'; message.setAttribute('aria-label', '我在帮你看嘛，正在查询额度；点击可切换台词'); staleDot.hidden = true;
    bubble.title = '正在读取订阅额度；点击换台词；再点凛收起';
    try { const data = await readInsights(true); if (ticket === generation && state === 'quota' && active()) showQuota(data.subscription); }
    catch (e) { if (ticket === generation && state === 'quota' && active()) { bubble.dataset.state = 'error'; message.textContent = '刷新失败，点此重试'; bubble.title = '右键也可重试；再点凛收起'; present(180); } }
  }
  function closeBubble() {
    if (!bubble) return; generation++; state = 'closed'; bubble.classList.remove('dshwv-pop-open'); bubble.inert = true;
    clearTimeout(autoCloseTimer); autoCloseTimer = null;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeTimer = null; if (state === 'closed') { bubble.hidden = true; invalidate(); } }, 550);
    present(600);
  }
  function armAutoClose(seconds = options.bubbleIdleSeconds) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(closeBubble, seconds * 1000);
  }
  function openBubble(nextState) {
    clearTimeout(closeTimer); closeTimer = null; state = nextState; bubble.hidden = false; bubble.inert = false;
    position(); void bubble.getBoundingClientRect(); bubble.classList.add('dshwv-pop-open'); present(650); invalidate();
  }
  function toggleBubble(anchorRoot) {
    if (account?.mode !== 'subscription') return false;
    if (anchorRoot?.querySelector && anchorRoot.querySelector('.dshwv-img')) { root = anchorRoot; pet = anchorRoot.querySelector('.dshwv-img'); }
    if (!bubble) return false;
    if (state !== 'closed') { closeBubble(); return true; }
    account.close(); openBubble('quota'); armAutoClose();
    void refreshBubble(); return true;
  }
  function showTurnNotice(notice) {
    const text = turnNoticeText(notice);
    if (!text || !active() || !bubble || settingsDialog?.open) return false;
    // An in-flight quota response must not overwrite the completed turn.
    generation++; openBubble('turn'); bubble.dataset.state = 'turn'; bubble.dataset.stale = 'false';
    balanceText.hidden = true; staleDot.hidden = true; message.textContent = text;
    const exact = count(notice.tokens) ? (notice.partial ? '本轮已观测（统计不完整）：' : '本轮本机已观测：') + notice.tokens.toLocaleString() + ' token' : text;
    message.setAttribute('aria-label', exact + '；点击换台词');
    bubble.title = exact + (notice.conversationRef ? '\n会话：' + notice.conversationRef : '') + '\n点击换台词；再点凛收起';
    armAutoClose(options.turnNoticeSeconds); schedulePosition(); present(180); return true;
  }
  function nextQuote() {
    if (state === 'closed') return;
    armAutoClose();
    if (bubble.dataset.state === 'error') { void refreshBubble(); return; }
    generation++; state = 'quotes'; bubble.dataset.state = 'quotes'; bubble.dataset.stale = 'false'; staleDot.hidden = true;
    balanceText.hidden=true;lastQuote=quoteBag.next(quotePool());message.textContent=lastQuote;try{localStorage.setItem('dshw-rin-quote-history-v5',JSON.stringify(quoteBag.history()));}catch{}
    message.setAttribute('aria-label', lastQuote + '；点击换一句'); bubble.title = '点击换一句；右键查看额度；再点凛收起';
    schedulePosition();present(180);
  }
  function openDetails() {
    closeBubble();
    if (account?.mode !== 'subscription') return;
    originalToggle.call(account, root); present(250);
  }
  let originalToggle = null;
  function settings() {
    if (settingsDialog?.isConnected) { settingsDialog.focus(); return; }
    closeBubble(); const d = document.createElement('dialog'); d.className = 'rin-v4-settings'; settingsDialog = d;
    node(d, 'h3', '凛 · 气泡与底栏');
    const check = (name, label, value) => { const l = node(d, 'label'); const i = node(l, 'input'); i.type = 'checkbox'; i.checked = value; i.dataset.setting = name; l.append(document.createTextNode(' ' + label)); return i; };
    const bar = check('strip', '显示底部项目 / 会话统计条', options.strip), motion = check('flow', '气泡文字流光（凛·紫藤配色）', options.flow);
    const builtins=check('builtins','启用内置台词库（2026.10版）',options.builtins);
    const num = (name, label, value, min, max) => { const l = node(d, 'label', label); const i = node(l, 'input'); i.type = 'number'; i.min = min; i.max = max; i.step = 1; i.value = value; i.dataset.setting = name; return i; };
    const gap = num('gap', '与凛的水平间距', options.gap, 4, 1000), bottom = num('bottom', '距窗口底边', options.bottom, 0, 1000), width = num('width', '统计条宽度', options.width, 160, 360);
    node(d, 'small', '单位为界面像素。默认放在凛旁边的底部空白处；位置有偏差时调整这三项。');
    const idle = num('bubbleIdleSeconds', '普通气泡：未点击后收起（秒）', options.bubbleIdleSeconds, 1, 600);
    const turn = num('turnNoticeSeconds', '本轮消耗提示：显示时长（秒）', options.turnNoticeSeconds, 1, 600);
    node(d, 'small', '可设 1–600 秒。点击气泡会重新计时；点击完成提示可继续看台词，随后按普通气泡时间收起。');
    node(d, 'label', '自定义台词（每行一句，与内置库一起轮换）'); const quotes = node(d, 'textarea'); quotes.value = options.quotes.join('\n'); quotes.maxLength = 15000; quotes.setAttribute('aria-label', '随机台词，每行一句');
    const actions = node(d, 'div', '', 'rin-v4-actions'); const reset = node(actions, 'button', '恢复默认'), cancel = node(actions, 'button', '取消'), save = node(actions, 'button', '保存');
    reset.onclick = () => { bar.checked = true; motion.checked = true; gap.value = 8; bottom.value = 4; width.value = 238; quotes.value='';builtins.checked=true; idle.value = DEFAULTS.bubbleIdleSeconds; turn.value = DEFAULTS.turnNoticeSeconds; };
    cancel.onclick = () => d.close();
    save.onclick = () => {
      options = cleanSettings({ strip: bar.checked, flow: motion.checked, gap: Number(gap.value), bottom: Number(bottom.value), width: Number(width.value), builtins:builtins.checked,quotes: quotes.value.split(/\r?\n/), bubbleIdleSeconds: Number(idle.value), turnNoticeSeconds: Number(turn.value) });
      saved(); bubble.dataset.textFlow = String(options.flow); d.close(); updateStrip(); void readLocal(true);
    };
    d.addEventListener('close', () => { d.remove(); settingsDialog = null; invalidate(); }, { once: true });
    document.body.append(d); d.showModal(); invalidate();
  }
  function init() {
    account = window.WhaleAccountView; pet = document.querySelector('.dshwv-img'); root = pet?.closest('.dshwv-root');
    if (!account || !root || !pet || !account.hasSessionCardV3) return;
    originalToggle = account.toggleBubble;
    const style = node(document.head, 'style'); style.id = 'rin-v4-style'; style.textContent = CSS;
    bubble = node(document.body, 'div', '', 'dshwv-pop rin-v4-bubble'); bubble.hidden = true; bubble.inert = true; bubble.innerHTML = SVG; bubble.dataset.textFlow = String(options.flow);
    const content = node(bubble, 'div', '', 'rin-v4-content'); message = node(content, 'button', '', 'rin-v4-message'); message.type = 'button';
    balanceText=node(content,'span','','rin-v5-balance');balanceText.hidden=true;
    staleDot = node(content, 'span', '', 'rin-v4-stale'); staleDot.hidden = true;
    // All click targets belong to the bubble; never a viewport-sized input layer.
    listen(bubble, 'click', e => { e.stopPropagation(); nextQuote(); });
    listen(bubble, 'contextmenu', e => { e.preventDefault(); e.stopPropagation(); armAutoClose(); void refreshBubble(); });
    strip = node(document.body, 'button', '', 'rin-v4-strip'); strip.type = 'button'; strip.hidden = true;
    scopeLabel = node(strip, 'span', '', 'rin-v4-scope'); stripValue = node(strip, 'span');
    listen(strip, 'click', e => { e.stopPropagation(); openDetails(); });
    listen(strip, 'contextmenu', e => { e.preventDefault(); e.stopPropagation(); settings(); });
    account.toggleBubble = toggleBubble;
    const menu = document.querySelector('.dshwv-menuview');
    if (menu) { const row = node(menu, 'div', '', 'dshwv-menu-row'); const b = node(row, 'button', '凛 · 气泡与底栏', 'dshwv-sound'); b.type = 'button'; b.onclick = settings; }
    listen(window, 'rin-session-selected', () => { updateStrip(); void readLocal(); });
    listen(window, 'whale-account-view', () => {
      ++modeEpoch; ++generation; fullData = localData = null; fullPending = localPending = null; lastFullAt = lastLocalAt = -Infinity; closeBubble(); updateStrip(); void readLocal(true);
    });
    listen(window, 'whale-mode-changing', closeBubble);
    listen(window, 'whale-desktop-mode', () => { closeBubble(); schedulePosition(); });
    listen(window, 'resize', schedulePosition);
    listen(window, 'whale-position-committed', schedulePosition);
    listen(document, 'visibilitychange', () => { if (document.hidden) closeBubble(); else { schedulePosition(); void readLocal(true); } });
    listen(document, 'keydown', e => { if (e.key === 'Escape' && !e.isComposing && state !== 'closed') closeBubble(); });
    listen(window, 'whale-turn-notice', () => { clearTimeout(turnTimer); turnTimer = setTimeout(() => { if (active()) void readLocal(true); }, 1500); });
    resizeObserver = new ResizeObserver(schedulePosition); resizeObserver.observe(root); resizeObserver.observe(pet);
    placementObserver = new MutationObserver(schedulePosition);
    placementObserver.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
    if (root.parentElement) placementObserver.observe(root.parentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    offFrame = window.WhaleRendering?.onFrame(schedulePosition);
    poll = setInterval(() => {
      if (!active()) return;
      if (options.strip) void readLocal();
      if (state === 'quota' && Date.now() - lastFullAt >= 60000) void refreshBubble();
    }, 30000);
    updateStrip(); void readLocal(true);
    listen(window, 'beforeunload', dispose);
  }
  function dispose() {
    if (disposed) return; disposed = true; generation++; modeEpoch++;
    for (const controller of controllers) controller.abort(); controllers.clear();
    clearInterval(poll); clearTimeout(turnTimer); clearTimeout(closeTimer); clearTimeout(autoCloseTimer); cancelAnimationFrame(frame);
    offFrame?.(); resizeObserver?.disconnect(); placementObserver?.disconnect(); for (const off of listeners.splice(0)) off();
    if (account && originalToggle && account.toggleBubble === toggleBubble) account.toggleBubble = originalToggle;
    bubble?.remove(); strip?.remove(); settingsDialog?.remove(); document.getElementById('rin-v4-style')?.remove();
  }
  window.WhaleRinUiV4 = { version: ID, creditText, readInsights, readLocal, openDetails, settings, closeBubble, showTurnNotice, dispose,
    status: () => ({ state, officialRequestPending: !!fullPending, localRequestPending: !!localPending,
      stripVisible: !!strip && !strip.hidden, localError }),
    // Non-sensitive snapshots aid offline regression without exposing config/auth.
    get viewData() { return mergeSessions(fullData, localData); } };
  if (document.readyState === 'loading' || document.readyState === 'interactive') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
