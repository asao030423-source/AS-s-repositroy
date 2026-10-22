// Official quota first; bounded refresh, account-scoped cache and snapshot fallback.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {readOfficialQuota, QuotaError} from './quota-rpc.mjs';
import {createCodexLocator} from './codex-location.mjs';
const CACHE_FILE = 'quota-active-last-good-v2.json';
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
function json(file) { if (fs.statSync(file).size > 1024 * 1024) throw new Error('too-large'); return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); }
/** Identity partition only, never an authentication validator; raw tokens are not retained. */
export function accountScope(home) {
  try {
    const auth = json(path.join(home,'auth.json'));
    if (auth.auth_mode && !['chatgpt','chatgptAuthTokens'].includes(auth.auth_mode)) return {key:null,blocked:true};
    if (!auth.auth_mode && typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.trim()) return {key:null,blocked:true};
    const access = auth.tokens?.access_token;
    if (typeof access !== 'string' || !access.trim()) return {key:null,blocked:false};
    let claim = {};
    try { const t=auth.tokens?.id_token || access; claim=JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString('utf8')); } catch {}
    const account = auth.tokens?.account_id || claim['https://api.openai.com/auth']?.chatgpt_account_id;
    const user = claim.sub || claim['https://api.openai.com/auth']?.chatgpt_user_id;
    const identity = account ? ['account',account,user||''] : ['token',hash(access)];
    return {key:hash(JSON.stringify([path.resolve(home),...identity])),blocked:false};
  } catch { return {key:null,blocked:false}; }
}
function readStored(config, scope, now) {
  if (!scope.key) return null;
  try {
    const v=json(path.join(config.dataDir,CACHE_FILE));
    if(v.version!==2 || v.scope!==scope.key || !Array.isArray(v.value?.windows) || v.value.windows.length>128 || !Number.isFinite(v.value.observedAt) || v.value.observedAt>now+60000 || now-v.value.observedAt>8*86400000) return null;
    for(const w of v.value.windows) if(!Number.isFinite(w.usedPercent)||w.usedPercent<0||!Number.isFinite(w.windowDurationMins)||w.windowDurationMins<=0||!(w.resetsAt===null||Number.isFinite(w.resetsAt)))return null;
    return v.value;
  } catch{return null;}
}
function store(config, scope, value) {
  if(!scope.key)return;
  const file=path.join(config.dataDir,CACHE_FILE), temp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try { fs.mkdirSync(config.dataDir,{recursive:true});fs.writeFileSync(temp,JSON.stringify({version:2,scope:scope.key,value}),{flag:'wx',mode:0o600});fs.renameSync(temp,file); }
  catch {} finally {try{fs.unlinkSync(temp);}catch{}}
}
export const errorText = code => ({
  RPC_TIMEOUT:'官方查询超时，保留上次结果',AUTH_REQUIRED:'官方查询需要有效的 ChatGPT 登录',RATE_LIMITED:'官方接口暂时限流，稍后重试',
  CLI_NOT_CONFIGURED:'尚未定位可用的 Codex CLI',CLI_PATH_INVALID:'Codex CLI 路径无效',CLI_START_FAILED:'Codex CLI 启动失败',
  CLI_CONFIG_REJECTED:'官方 CLI 未接受当前配置',CLI_EXITED_EARLY:'查询进程提前退出',RPC_NOT_SUPPORTED:'当前 CLI 不支持额度查询',
  QUOTA_DATA_INVALID:'官方返回格式未识别',QUOTA_DATA_MISSING:'官方未返回可识别的额度结构',QUOTA_BUCKET_CONFLICT:'额度类别标识不一致',
  ACCOUNT_CHANGED:'查询期间登录账号发生变化，请重新刷新',API_LOGIN:'当前本地登录不是 ChatGPT 订阅登录',RPC_REQUEST_FAILED:'官方额度查询暂时失败',
  RPC_PIPE_FAILED:'额度查询进程连接中断',REQUEST_CANCELLED:'查询已取消',RPC_OUTPUT_TOO_LARGE:'查询返回超出处理上限',
  CLI_NOT_FOUND:'未找到可验证的官方 Codex 程序，请打开或更新 ChatGPT 桌面应用',
  CLI_DISCOVERY_FAILED:'暂时无法检测 Codex 程序，请稍后刷新',CLI_PLATFORM_UNSUPPORTED:'此版本的自动额度检测支持 Windows'
}[code] || '额度查询暂时失败');
export function createLiveQuotaService(config,snapshot,{request=readOfficialQuota,clock=Date.now,monotonicClock=()=>performance.now(),scopeRead=accountScope,locator=createCodexLocator()}={}) {
  let scope={key:null,blocked:false}, scoped=false, lastGood=null, pending=null, closed=false, controller=null;
  let lastAttempt=-Infinity,lastAttemptMono=-Infinity,retryMono=0,failures=0,errorCode='',fallback={},generation=0;
  function syncScope() {
    const next=scopeRead(config.codexHome);
    if(!scoped || next.key!==scope.key || next.blocked!==scope.blocked){
      controller?.abort();generation++;scope=next;scoped=true;lastGood=readStored(config,scope,clock());
      lastAttempt=-Infinity;lastAttemptMono=-Infinity;retryMono=0;failures=0;errorCode='';fallback={};
    }
    return generation;
  }
  function build() {
    const now=clock();
    const retryMs=Math.max(0,retryMono-monotonicClock()),retryAt=retryMs?now+retryMs:0;
    // Without a stable identity, a failed future read must not reuse old-account results.
    const cached=lastGood && (scope.key || !errorCode) ? lastGood : null;
    const local=!cached&&!scope.blocked&&scope.key&&fallback.subscription?.available ? fallback.subscription : null;
    const chosen=cached||local;
    const source=cached?'official-rpc':local?'local-snapshot':'unavailable';
    const windows=Array.isArray(chosen?.windows)?chosen.windows.map(w=>({...w,
      stale:source!=='official-rpc'||!!errorCode||now-(chosen.observedAt||w.observedAt||0)>120000||(chosen.observedAt||0)>now+60000||w.resetsAt==null||w.resetsAt<=now})):[];
    const observedAt=chosen?.observedAt||null;
    // WHALE_RIN_PROJECT_V5: balances stay in the same account-scoped snapshot.
    const credits=cached?.credits||null;
    let note=source==='official-rpc'?'来源：Codex 官方主动查询。':source==='local-snapshot'?'来源：本地历史快照，主动查询未成功。':'尚未取得官方额度。';
    if(observedAt)note+=' 数据时间：'+new Date(observedAt).toLocaleString()+'。';
    if(errorCode)note+=' '+errorText(errorCode)+'。';
    if(now<retryAt&&errorCode)note+=' 重试等待约 '+Math.ceil((retryAt-now)/1000)+' 秒。';
    note+=' 查看 CODEX_HOME 对应登录账号，不代表第三方 API 钱包；无返回的额度窗口不补零。';
    return {...fallback,ok:true,subscription:{available:windows.length>0,windows,credits,observedAt,source,planType:cached?.planType||'',
      lastAttemptAt:Number.isFinite(lastAttempt)?lastAttempt:null,lastSuccessAt:cached?.observedAt||null,
      errorCode:errorCode||null,nextRetryAt:retryAt||null,scopeNote:note,
      reason:windows.length?note:errorCode?errorText(errorCode):'官方本次没有返回额度窗口。'},error:errorCode||null};
  }
  async function get(){
    if(closed)return {ok:true,subscription:{available:false,windows:[],reason:'挂件正在退出'},tokens:null};
    const mine=syncScope();
    if(scope.blocked){errorCode='API_LOGIN';return build();}
    if(pending?.generation===mine)return pending.promise;
    if(monotonicClock()<retryMono||monotonicClock()-lastAttemptMono<15000)return build();
    lastAttempt=clock();lastAttemptMono=monotonicClock();controller=new AbortController();const ownController=controller, capturedKey=scope.key;
    const job={generation:mine,promise:null};
    job.promise=(async()=>{
      // Local token scans are independent. Errors here never block the official quota result.
      const localJob=Promise.resolve().then(()=>snapshot.get()).catch(()=>({tokens:null}));
      let value=null, failure='';
      try{
        const executable=await locator.resolve();
        try{value=await request({executable,codexHome:config.codexHome,signal:ownController.signal});}
        catch(error){
          if(!['CLI_START_FAILED','CLI_EXITED_EARLY','RPC_NOT_SUPPORTED'].includes(error?.code))throw error;
          locator.invalidate(executable);
          let replacement;try{replacement=await locator.resolve({exclude:[executable]});}catch{throw error;}
          value=await request({executable:replacement,codexHome:config.codexHome,signal:ownController.signal});
        }
      }catch(e){failure=e instanceof QuotaError?e.code:'RPC_REQUEST_FAILED';}
      const local=await localJob;
      const current=scopeRead(config.codexHome);
      if(closed)return {ok:true,subscription:{available:false,windows:[],reason:'挂件正在退出'},tokens:null};
      if(generation!==mine||current.key!==capturedKey||current.blocked!==scope.blocked){syncScope();return {ok:true,subscription:{available:false,windows:[],errorCode:'ACCOUNT_CHANGED',reason:errorText('ACCOUNT_CHANGED')},tokens:null};}
      fallback=local;
      if(value){lastGood=value;errorCode='';failures=0;retryMono=0;store(config,scope,value);}
      else{errorCode=failure;failures++;retryMono=monotonicClock()+Math.min(300000,(failure==='RATE_LIMITED'?120000:30000)*2**Math.min(failures-1,4));}
      return build();
    })().finally(()=>{if(pending===job)pending=null;});
    pending=job;return job.promise;
  }
  return {get,status(){return {connection:locator.status(),errorCode:errorCode||null,lastSuccessAt:lastGood?.observedAt||null};},close(){closed=true;generation++;controller?.abort();snapshot.close();}};
}
