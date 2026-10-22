// Local, one-shot Codex App Server client. No threads, prompts or login RPCs.
import {spawn} from 'node:child_process';
import path from 'node:path';

export class QuotaError extends Error {
  constructor(code, stage = '') { super(code); this.code = code; this.stage = stage; }
}
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const text = v => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) : '';
function alias(v, ...keys) {
  const found = keys.filter(k => Object.hasOwn(v, k) && v[k] !== undefined);
  if (found.some(k => JSON.stringify(v[k]) !== JSON.stringify(v[found[0]]))) throw new QuotaError('QUOTA_DATA_INVALID');
  return found.length ? v[found[0]] : undefined;
}
export function windowLabel(minutes) {
  if (minutes === 10080) return '每周额度';
  if (minutes === 300) return '5 小时额度';
  return minutes % 1440 === 0 ? `${minutes / 1440} 天额度` : minutes % 60 === 0 ? `${minutes / 60} 小时额度` : `${minutes} 分钟额度`;
}
// WHALE_RIN_PROJECT_V5: credits are units returned by Codex, never API currency or earned resets.
export function normalizeCredits(value, at=Date.now()) {
  if(value==null)return null;
  if(!record(value))return {balance:null,unlimited:false,hasCredits:null,status:'invalid',observedAt:at};
  let hasCredits;
  try{hasCredits=alias(value,'hasCredits','has_credits');}catch{return {balance:null,unlimited:false,hasCredits:null,status:'invalid',observedAt:at};}
  const unlimited=value.unlimited===true;
  let balance=value.balance;
  if(typeof balance==='number'&&finite(balance)&&balance>=0&&balance<=Number.MAX_SAFE_INTEGER)balance=String(balance);
  const valid=typeof balance==='string'&&balance.length<=80&&/^\d+(?:\.\d+)?$/.test(balance.trim());
  return {balance:valid?balance.trim():null,unlimited,hasCredits:typeof hasCredits==='boolean'?hasCredits:null,
    status:unlimited?'unlimited':valid?'ok':balance==null?'unavailable':'invalid',observedAt:at};
}

export function normalizeQuota(payload, at = Date.now()) {
  if (!record(payload) || !finite(at)) throw new QuotaError('QUOTA_DATA_INVALID');
  const map = alias(payload, 'rateLimitsByLimitId', 'rate_limits_by_limit_id');
  const single = alias(payload, 'rateLimits', 'rate_limits');
  let entries;
  if (map != null) {
    if (!record(map) || Object.keys(map).length > 64) throw new QuotaError('QUOTA_DATA_INVALID');
    entries = Object.entries(map);
  }
  if (!entries?.length) {
    if (!record(single)) throw new QuotaError('QUOTA_DATA_MISSING');
    entries = [[alias(single, 'limitId', 'limit_id') || 'codex', single]];
  }
  const windows = []; let plan = '', credits=null;
  for (const [mapId, bucket] of entries) {
    if (!record(bucket) || typeof mapId !== 'string' || !mapId || mapId.length > 128) throw new QuotaError('QUOTA_DATA_INVALID');
    if (!Object.hasOwn(bucket, 'primary') && !Object.hasOwn(bucket, 'secondary')) throw new QuotaError('QUOTA_DATA_INVALID');
    const explicit = alias(bucket, 'limitId', 'limit_id');
    if (explicit != null && explicit !== mapId) throw new QuotaError('QUOTA_BUCKET_CONFLICT');
    const id = text(mapId), name = text(alias(bucket, 'limitName', 'limit_name'));
    if(id==='codex')credits=normalizeCredits(bucket.credits,at);
    if (id === 'codex' || !plan) plan = text(alias(bucket, 'planType', 'plan_type'));
    for (const slot of ['primary', 'secondary']) {
      const w = bucket[slot];
      if (w == null) continue;
      if (!record(w)) throw new QuotaError('QUOTA_DATA_INVALID');
      const used = alias(w, 'usedPercent', 'used_percent');
      const mins = alias(w, 'windowDurationMins', 'window_duration_mins', 'window_minutes', 'windowMinutes');
      const reset = alias(w, 'resetsAt', 'resets_at');
      if (!finite(used) || used < 0 || used > 1000000 || !finite(mins) || mins <= 0 || mins > 52560000) throw new QuotaError('QUOTA_DATA_INVALID');
      if (reset != null && (!finite(reset) || reset <= 0 || reset * 1000 > 8640000000000000)) throw new QuotaError('QUOTA_DATA_INVALID');
      const resetsAt = reset == null ? null : reset * 1000;
      windows.push({ limitId: id, limitName: name, slot, windowDurationMins: mins,
        label: (id === 'codex' ? '' : (name || id) + ' · ') + windowLabel(mins),
        usedPercent: used, remainingPercent: Math.max(0, 100 - used), resetsAt,
        observedAt: at, stale: resetsAt == null || resetsAt <= at, source: 'official-rpc' });
    }
  }
  windows.sort((a, b) => (a.limitId === 'codex' ? -1 : 0) - (b.limitId === 'codex' ? -1 : 0) || a.limitId.localeCompare(b.limitId) || a.windowDurationMins - b.windowDurationMins);
  return { windows, credits, observedAt: at, planType: plan, source: 'official-rpc' };
}
function rpcError(error, stage) {
  const msg = String(error?.message || '');
  if (error?.code === -32601) return new QuotaError('RPC_NOT_SUPPORTED', stage);
  if (/401|403|unauth|not.logged|sign.in|authenticat|chatgpt.auth|access.token/i.test(msg)) return new QuotaError('AUTH_REQUIRED', stage);
  if (/429|too.many|overloaded|rate.limit/i.test(msg)) return new QuotaError('RATE_LIMITED', stage);
  return new QuotaError('RPC_REQUEST_FAILED', stage);
}
/** Starts and terminates only its own direct executable. stderr never leaves this process. */
export function readOfficialQuota({ executable, codexHome, timeoutMs = 20000, signal, spawnImpl = spawn, prefixArgs = [], env = process.env }) {
  if (!path.isAbsolute(executable || '') || !path.isAbsolute(codexHome || '')) return Promise.reject(new QuotaError('CLI_PATH_INVALID'));
  return new Promise((resolve, reject) => {
    let child, settled = false, exited = false, stage = 'startup', input = '', bytes = 0, stderr = '', deadline;
    const cleanupOwned = () => {
      if (!child || exited || child.exitCode != null || child.signalCode != null) return;
      try { child.stdin.end(); } catch {}
      const timer = setTimeout(() => {
        if (exited || child.exitCode != null || child.signalCode != null) return;
        if (process.platform === 'win32' && child.pid) {
          // Kill this owned tree only, never all Codex processes or processes by name.
          const killer = spawn(path.join(env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore', shell:false});
          killer.on('error', () => { try { child.kill(); } catch {} });
          killer.unref();
        } else {
          try { child.kill('SIGTERM'); } catch {}
          const hard = setTimeout(() => { if (!exited) { try { child.kill('SIGKILL'); } catch {} } }, 500);
          hard.unref();
        }
      }, 500);
      timer.unref();
    };
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(deadline); signal?.removeEventListener('abort', abort);
      cleanupOwned(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new QuotaError('REQUEST_CANCELLED', stage));
    const send = object => { try { child.stdin.write(JSON.stringify(object) + '\n'); } catch { finish(new QuotaError('RPC_PIPE_FAILED', stage)); } };
    if (signal?.aborted) { reject(new QuotaError('REQUEST_CANCELLED', stage)); return; }
    try {
      // This override belongs to this read-only helper process, not config.toml.
      // Its quota source is the existing ChatGPT login, never a third-party wallet.
      child = spawnImpl(executable, [...prefixArgs, '-c', 'model_provider="openai"', 'app-server'], {
        cwd: codexHome, env: {...env, CODEX_HOME: codexHome}, windowsHide: true, shell: false,
        stdio: ['pipe', 'pipe', 'pipe'] });
      child.on('exit', () => { exited = true; });
      child.on('error', () => finish(new QuotaError('CLI_START_FAILED', stage)));
      child.on('close', () => {
        exited = true;
        if (!settled) finish(new QuotaError(/config|toml|provider/i.test(stderr) ? 'CLI_CONFIG_REJECTED' : 'CLI_EXITED_EARLY', stage));
      });
      child.stdin.on('error', () => finish(new QuotaError('RPC_PIPE_FAILED', stage)));
      child.stderr.setEncoding('utf8'); child.stderr.on('data', s => { if (stderr.length < 32768) stderr += s.slice(0, 32768 - stderr.length); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk); input += chunk;
        if (bytes > 2 * 1024 * 1024 || input.length > 1024 * 1024) { finish(new QuotaError('RPC_OUTPUT_TOO_LARGE', stage)); return; }
        let index;
        while (!settled && (index = input.indexOf('\n')) >= 0) {
          const line = input.slice(0, index).trim(); input = input.slice(index + 1);
          if (!line) continue;
          let msg; try { msg = JSON.parse(line); } catch { continue; }
          if (!record(msg)) continue;
          if (Object.hasOwn(msg, 'id') && msg.method) {
            // No approvals, token refresh delegation, tools or executable requests.
            send({id:msg.id,error:{code:-32601,message:'Quota client supports read-only responses only'}}); continue;
          }
          if (msg.id === 1 && stage === 'initialize') {
            if (msg.error) { finish(rpcError(msg.error, stage)); return; }
            if (!Object.hasOwn(msg, 'result')) continue;
            stage = 'rateLimits';
            send({method:'initialized',params:{}});
            send({method:'account/rateLimits/read',id:2});
          } else if (msg.id === 2 && stage === 'rateLimits') {
            if (msg.error) { finish(rpcError(msg.error, stage)); return; }
            try { finish(null, normalizeQuota(msg.result)); } catch (e) { finish(e instanceof QuotaError ? e : new QuotaError('QUOTA_DATA_INVALID', stage)); }
          }
        }
      });
      deadline = setTimeout(() => finish(new QuotaError('RPC_TIMEOUT', stage)), timeoutMs);
      signal?.addEventListener('abort', abort, {once:true});
      stage = 'initialize';
      send({method:'initialize',id:1,params:{clientInfo:{name:'whale_quota_local',title:'Local Whale Quota',version:'2.0.0'}}});
    } catch { finish(new QuotaError('CLI_START_FAILED', stage)); }
  });
}
