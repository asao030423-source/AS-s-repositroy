// WHALE_SESSION_CARD_V3
// Bounded per-session cumulative snapshots, called inside the existing insights worker.
// No additional watcher, model request, or foreground-window inference.
import fs from 'node:fs';
// WHALE_RIN_PROJECT_V5: read-only Desktop project-label compatibility adapter.
// Paths are used locally for matching; public rows contain only labels and opaque IDs.
import path from 'node:path';
import crypto from 'node:crypto';
const label = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,100) : '';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => crypto.createHash('sha256').update(value).digest('hex').slice(0,24);
export function normalPath(value) {
  if(typeof value !== 'string' || !value || value.length>4096 || /[\x00-\x1f]/.test(value))return null;
  const windows=/^[A-Za-z]:[\\/]/.test(value)||/^\\\\/.test(value)||/^\/\//.test(value);
  const api=windows?path.win32:path.posix;
  if(!api.isAbsolute(value))return null;
  let normalized=api.normalize(value).replaceAll('\\','/');
  if(windows)normalized=normalized.toLowerCase();
  normalized=normalized.replace(/\/+$/,'');
  return normalized || '/';
}
const under=(value,root)=>value===root||value.startsWith(root==='/'?'/':root+'/');
export function parseProjectState(state) {
  if(!object(state))return {status:'unrecognized',format:null,projects:[],hints:{}};
  const projects=[];
  const push=(key,name,roots,source)=>{
    const paths=[...new Set(roots.map(normalPath).filter(Boolean))];
    if(!paths.length)return;
    const pretty=label(name)||label(String(roots[0]).replaceAll('\\','/').replace(/\/$/,'').split('/').pop())||'未命名项目';
    projects.push({id:'project_'+digest(source+'\0'+key),name:pretty,roots:paths,labelSource:label(name)?'desktop-label':'desktop-root',sourceKey:key});
  };
  let format;
  if(object(state['local-projects'])) {
    format='local-projects';
    for(const [id,p] of Object.entries(state['local-projects']).slice(0,1024)) {
      if(object(p)&&Array.isArray(p.rootPaths))push(id,p.name,p.rootPaths.slice(0,64),'modern');
    }
  }else if(Array.isArray(state['electron-saved-workspace-roots'])) {
    format='workspace-roots';
    const rawLabels=object(state['electron-workspace-root-labels'])?state['electron-workspace-root-labels']:{};
    const labels=new Map(Object.entries(rawLabels).map(([k,v])=>[normalPath(k),v]));
    const seen=new Set();
    for(const root of state['electron-saved-workspace-roots'].slice(0,1024)) {
      const normalized=normalPath(root);if(!normalized||seen.has(normalized))continue;seen.add(normalized);
      push(normalized,labels.get(normalized),[root],'legacy');
    }
  }else return {status:'unrecognized',format:null,projects:[],hints:{}};
  const order=Array.isArray(state['project-order'])?state['project-order']:[];
  const rank=p=>{let n=order.indexOf(p.sourceKey);if(n<0)n=order.findIndex(x=>p.roots.includes(normalPath(x)));return n<0?1e9:n;};
  projects.sort((a,b)=>rank(a)-rank(b));
  const hints={};
  if(object(state['thread-workspace-root-hints']))for(const [id,root] of Object.entries(state['thread-workspace-root-hints']).slice(0,20000)) {
    if(idOK(id)&&normalPath(root))hints[id]=normalPath(root);
  }
  return {status:'ok',format,projects,hints};
}
export function readProjectIndex(codexHome) {
  if(!codexHome)return {status:'unavailable',format:null,projects:[],hints:{}};
  let fd;
  try {
    const file=path.join(codexHome,'.codex-global-state.json');
    if(fs.lstatSync(file).isSymbolicLink())throw Error('link');
    fd=fs.openSync(file,'r');const stat=fs.fstatSync(fd),limit=16*1024*1024;
    if(!stat.isFile()||stat.size>limit)throw Error('size');
    const bytes=Buffer.alloc(stat.size);let n=0;
    while(n<bytes.length){const r=fs.readSync(fd,bytes,n,bytes.length-n,n);if(!r)break;n+=r;}
    return parseProjectState(JSON.parse(bytes.subarray(0,n).toString('utf8').replace(/^\uFEFF/,'')));
  }catch{return {status:'unavailable',format:null,projects:[],hints:{}};}
  finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
export function matchProject(meta,index) {
  const select=value=>{
    if(!value)return {project:null,ambiguous:false};
    const matches=index.projects.flatMap(p=>p.roots.filter(root=>under(value,root)).map(root=>({p,length:root.length})));
    if(!matches.length)return {project:null,ambiguous:false};
    const max=Math.max(...matches.map(x=>x.length));const chosen=[...new Set(matches.filter(x=>x.length===max).map(x=>x.p))];
    return {project:chosen.length===1?chosen[0]:null,ambiguous:chosen.length>1};
  };
  const hint=index.hints[meta.id??meta.session_id];
  const hinted=select(hint);if(hinted.project||hinted.ambiguous)return {...hinted,method:'thread-hint'};
  return {...select(normalPath(meta.cwd)),method:'cwd'};
}
export function attachProject(meta,index) {
  const match=matchProject(meta,index),p=match.project;
  return {projectId:p?.id??null,projectName:p?.name??null,projectLabelSource:p?.labelSource??null,
    projectMatch:p?match.method:match.ambiguous?'ambiguous':'unmatched',projectIndexStatus:index.status};
}
export function aggregateProjects(rows,index,{partial=false}={}) {
  return index.projects.map(project=>{
    const assigned=rows.filter(s=>s.projectId===project.id);
    const included=assigned.filter(s=>!s.isFork&&s.tokens);
    const excludedForks=assigned.filter(s=>s.isFork).length;
    const missing=assigned.filter(s=>!s.isFork&&!s.tokens).length;
    const sum=key=>{let n=0;for(const s of included){const v=s.tokens[key];if(!Number.isSafeInteger(v)||v<0||!Number.isSafeInteger(n+v))return null;n+=v;}return n;};
    const input=sum('input'),output=sum('output'),cachedInput=sum('cachedInput');
    const total=input!==null&&output!==null&&Number.isSafeInteger(input+output)?input+output:null;
    const tokens=included.length&&total!==null?{input,output,total,cachedInput,cacheHitPercent:input>0&&cachedInput!==null?100*cachedInput/input:null}:null;
    const activityAt=Math.max(0,...assigned.map(s=>s.activityAt||0));
    return {kind:'project',sessionId:project.id,projectId:project.id,projectName:project.name,
      projectLabelSource:project.labelSource,projectIndexStatus:index.status,activityAt,observedAt:activityAt||null,
      status:tokens?'ok':'no-usage',tokens,sessionCount:assigned.length,includedSessions:included.length,
      excludedForks,partial:partial||missing>0||excludedForks>0,partialReason:excludedForks?'fork-excluded':missing?'missing-counters':partial?'scan-limited':null};
  });
}


const safe = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idOK = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const when = value => { const n = Date.parse(value); return Number.isFinite(n) ? n : null; };

export function sessionNumbers(raw) {
  if (!record(raw)) return null;
  const input = safe(raw.input_tokens), output = safe(raw.output_tokens);
  if (input === null || output === null || !Number.isSafeInteger(input + output)) return null;
  let cachedInput = safe(raw.cached_input_tokens);
  if (cachedInput !== null && cachedInput > input) cachedInput = null;
  return { input, output, total: input + output, cachedInput,
    cacheHitPercent: input > 0 && cachedInput !== null ? cachedInput / input * 100 : null };
}
export function isChildSession(meta) {
  return meta?.source === 'subagent' ||
    (record(meta?.source) && Object.hasOwn(meta.source, 'subagent')) ||
    (Number.isSafeInteger(meta?.subagent_history_start_ordinal) && meta.subagent_history_start_ordinal > 0);
}
function parse(line) { try { return JSON.parse(line.replace(/^\uFEFF/, '')); } catch { return null; } }

/** Read only complete JSON records in a bounded head/tail window. */
export function readSessionCard(file, { now = Date.now(), budget = { remaining: 32 * 1024 * 1024 },
  headBytes = 64 * 1024, chunkBytes = 128 * 1024, maxTailBytes = 4 * 1024 * 1024, projectIndex = {status:'unavailable',projects:[],hints:{}} } = {}) {
  let fd;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return null;
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || budget.remaining <= 0) return null;
    function read(offset, length) {
      length = Math.max(0, Math.min(length, budget.remaining));
      if (!length) return Buffer.alloc(0);
      const buffer = Buffer.alloc(length); let count = 0;
      while (count < length) { const n = fs.readSync(fd, buffer, count, length - count, offset + count); if (!n) break; count += n; }
      budget.remaining -= count;
      return buffer.subarray(0, count);
    }
    const head = read(0, Math.min(headBytes, stat.size));
    const firstEnd = head.indexOf(10);
    if (firstEnd === -1 && head.length < stat.size) return null;
    const first = parse(head.subarray(0, firstEnd === -1 ? head.length : firstEnd).toString('utf8'));
    if (first?.type !== 'session_meta' || !record(first.payload)) return null;
    const meta = first.payload, sessionId = meta.id ?? meta.session_id;
    if (!idOK(sessionId)) return null;
    if(isChildSession(meta))return {kind:'child-skip',sessionId};
    const created = when(meta.timestamp ?? first.timestamp);
    const createdAt = created !== null && created <= now + 60000 ? created : null;
    const base = { kind:'session', ...attachProject(meta,projectIndex), sessionId, activityAt: createdAt ?? 0, observedAt: null,
      isFork: !!meta.forked_from_id, status: 'no-usage', tokens: null };
    const inspect = (buffer, offset) => {
      let content = buffer.toString('utf8');
      if (offset > 0) {
        const previous = read(offset - 1, 1);
        if (previous.length !== 1 || previous[0] !== 10) {
          const p = content.indexOf('\n'); if (p === -1) return null; content = content.slice(p + 1);
        }
      }
      const lines = content.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"token_count"')) continue;
        const item = parse(lines[i]), p = item?.payload;
        if (item?.type !== 'event_msg' || p?.type !== 'token_count') continue;
        const at = when(item.timestamp);
        if (at === null || at > now + 60000 || (base.isFork && createdAt !== null && at < createdAt)) continue;
        // Quota-only notifications with null info do not erase a previous counter.
        if (!p.info || p.info.total_token_usage == null) continue;
        const tokens = sessionNumbers(p.info.total_token_usage);
        return { ...base, activityAt: Math.max(base.activityAt, at), observedAt: at,
          status: tokens ? 'ok' : 'invalid-counters', tokens };
      }
      return null;
    };
    if (head.length === stat.size) return inspect(head, 0) ?? base;
    let tail = Buffer.alloc(0), start = stat.size;
    while (tail.length < maxTailBytes && start > 0 && budget.remaining > 0) {
      const n = Math.min(chunkBytes, start, maxTailBytes - tail.length, budget.remaining);
      const part = read(start - n, n); if (part.length !== n) break;
      start -= n; tail = Buffer.concat([part, tail]);
      const found = inspect(tail, start); if (found) return found;
    }
    // There may be older counters outside the bounded tail. Never call them zero.
    return { ...base, status: start > 0 ? 'outside-read-window' : 'no-usage' };
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

export function collectSessionCards(files, { now = Date.now(), maxFiles = 512, maxSessions = 256,
  maxBytes = 48 * 1024 * 1024, codexHome=null, scanLimited=false } = {}) {
  const projectIndex=readProjectIndex(codexHome);
  const budget = { remaining: maxBytes }, sessions = new Map(); let examined = 0, unreadable = 0;
  for (const entry of files.slice(0, maxFiles)) {
    if (budget.remaining <= 0) break;
    examined++;
    const value = readSessionCard(typeof entry === 'string' ? entry : entry.f, { now, budget, projectIndex });
    if (!value) {unreadable++;continue;}
    if(value.kind==='child-skip')continue;
    const old = sessions.get(value.sessionId);
    // Mirrors in sessions/archived_sessions are one session, not additive usage.
    if (!old || (value.observedAt ?? -1) > (old.observedAt ?? -1)) sessions.set(value.sessionId, value);
  }
  const ordered = [...sessions.values()].sort((a, b) => b.activityAt - a.activityAt || a.sessionId.localeCompare(b.sessionId));
  const limited=scanLimited||unreadable>0||examined<files.length||ordered.length>maxSessions;
  const projects=aggregateProjects(ordered,projectIndex,{partial:limited});
  const recent=ordered.slice(0,maxSessions);
  // Project totals are computed before the per-session dropdown cap.
  const latest=recent[0];
  const auto=latest?.projectId?projects.find(p=>p.projectId===latest.projectId):latest;
  const rows=[...(auto?[auto]:[]),...projects.filter(p=>p!==auto),...recent.filter(s=>s!==auto)];
  return { sessions:rows, sessionReadAt:now, sessionListLimited:limited };
}
