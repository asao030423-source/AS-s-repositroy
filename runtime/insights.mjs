// WHALE_SESSION_CARD_V3
// WHALE_OFFICIAL_QUOTA_V2
import {createLiveQuotaService} from './quota-live.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {pricingSchedule} from './pricing-schedule.mjs';
// WHALE_LOCAL_SUBSCRIPTION_COMPAT_V1
// Only this specific address failure permits a local, non-network usage context.
// No endpoint is invented, no credentials are forwarded, and API resolve() is unchanged.
function localUsageContext(config) {
  try { return config.resolve(); }
  catch (error) {
    if (error?.message !== '当前 Codex 服务商缺少 API 地址；不会回退到其他服务商') throw error;
    const setting = config.load();
    if (setting.connectionMode !== 'follow') throw error;
    return { setting, id: 'local-login-snapshot', key: null,
      accountId: 'local-login-snapshot', localSubscriptionOnly: true };
  }
}
function compatibleLocalLogin(auth) {
  const apiKey = typeof auth?.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.trim();
  if (apiKey) return false;
  if (auth?.auth_mode === 'chatgpt') return true;
  return auth?.auth_mode == null && typeof auth?.tokens?.access_token === 'string'
    && auth.tokens.access_token.trim().length > 0;
}

function createSnapshotInsightsService(config) {
  let cache=null,pending=null,lastKey='',worker=null,closed=false;
  function view() {
    const c=localUsageContext(config), monitored=c.setting.monitorSessions !== false;
    let auth={},authChangedAt=0,authSize=0;
    try{const file=path.join(config.codexHome,'auth.json'),stat=fs.statSync(file);authChangedAt=stat.mtimeMs;authSize=stat.size;if(stat.size<1024*1024)auth=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const subscribed=c.localSubscriptionOnly === true ? compatibleLocalLogin(auth) :
      !c.key && c.id==='openai' && (auth.auth_mode==='chatgpt' || !!auth.tokens?.access_token);
    // Re-login/rotation, including within the same account, establishes a new
    // observation boundary. Never include the credential itself in the cache key.
    const key=crypto.createHash('sha256').update(JSON.stringify([c.accountId,auth.tokens?.account_id||'',
      monitored,subscribed,auth.auth_mode||'',authChangedAt,authSize])).digest('hex');
    return {c,monitored,subscribed,authChangedAt,key};
  }
  async function get() {
    const now=Date.now(), {c,monitored,subscribed,authChangedAt,key}=view(), pricing=pricingSchedule(c,now);
    if(lastKey!==key){cache=null;lastKey=key;}
    if(!monitored || closed)return {ok:true,pricing,subscription:{available:false,windows:[],reason:'本机会话观测已关闭'},tokens:null};
    if(!cache || now-cache.at>30000){
      if(!pending || pending.key!==key) {
        void worker?.terminate();
        const job={key,promise:null};
        job.promise=new Promise(resolve=>{
        worker=new Worker(new URL('./insights-worker.mjs',import.meta.url),{workerData:{codexHome:config.codexHome,now,quotaAfterMs:authChangedAt}});
        const current=worker;let finished=false;
        const done=data=>{if(finished)return;finished=true;clearTimeout(timeout);void current.terminate();if(worker===current)worker=null;resolve(data);};
        const timeout=setTimeout(()=>done({error:'observation-timeout'}),8000);timeout.unref();
        current.once('message',done);current.once('error',()=>done({error:'local-observation-unavailable'}));current.once('exit',()=>done({error:'local-observation-unavailable'}));
        }).finally(()=>{if(pending===job)pending=null;});
        pending=job;
      }
      const data=await pending.promise;
      if (closed || key!==lastKey || key!==view().key) return {ok:true,pricing,tokens:null,
        subscription:{available:false,windows:[],observedAt:null,reason:'连接已变更，请刷新订阅额度'}};
      cache={at:now,data};
    }
    const data=cache?.data||{},at=Date.now();
    const windows=subscribed ? (data.windows||[]).filter(w=>Number.isFinite(w.observedAt) && w.observedAt>=authChangedAt)
      .map(w=>({...w,stale:at-w.observedAt>15*60000 || !Number.isFinite(w.resetsAt) || w.resetsAt<=at})) : [];
    const observedAt=windows.length ? Math.max(...windows.map(w=>w.observedAt)) : null;
    return {ok:true,pricing,tokens:data.tokens||null,sessions:data.sessions||[],sessionReadAt:data.sessionReadAt||null,sessionListLimited:data.sessionListLimited===true,subscription:{available:windows.length>0,windows,observedAt,
      scopeNote:c.localSubscriptionOnly === true ? '本地订阅兼容模式：读取 CODEX_HOME 下的登录记录与额度快照。当前会话的 API 服务商未验证；这不是实时账号查询。' : '',
      reason:!subscribed?'当前连接不是可识别的 ChatGPT 订阅登录':windows.length?'来自本机会话的官方额度快照；不能换算为固定 token 配额':'尚未观测到订阅额度快照，请在订阅登录下使用 Codex 后刷新'},error:data.error||null};
  }
  return {get,close(){closed=true;void worker?.terminate();worker=null;cache=null;}};
}

export function createInsightsService(config) {
  // WHALE_RIN_BUBBLE_V4: one local scanner/cache shared by the strip and official quota view.
  const snapshot = createSnapshotInsightsService(config);
  const live = createLiveQuotaService(config, snapshot);
  return { ...live, getLocal: () => snapshot.get() };
}
