import {createCodexLocator} from '../runtime/codex-location.mjs';
import {readOfficialQuota} from '../runtime/quota-rpc.mjs';
import {CODEX_HOME,VERSION} from '../runtime/paths.mjs';

const locator=createCodexLocator();
try {
  const executable=await locator.resolve();
  const result={ok:true,version:VERSION,connection:locator.status(),liveQuery:false};
  if(process.argv.includes('--live')) {
    const sample=await readOfficialQuota({executable,codexHome:CODEX_HOME});
    Object.assign(result,{liveQuery:true,observedAt:new Date(sample.observedAt).toISOString(),windowCount:sample.windows.length});
  }
  console.log(JSON.stringify(result,null,2));
}catch(error){console.log(JSON.stringify({ok:false,errorCode:error.code||'DIAGNOSTIC_FAILED'},null,2));process.exitCode=1;}
