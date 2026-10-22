import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLiveQuotaService} from '../runtime/quota-live.mjs';
import {QuotaError} from '../runtime/quota-rpc.mjs';

function fixture(t,request) {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'rin-quota-'));
  t.after(()=>fs.rmSync(dataDir,{recursive:true,force:true}));
  const time={wall:1800000000000,mono:0},identity={key:'synthetic-account-a',blocked:false};
  const service=createLiveQuotaService({dataDir,codexHome:dataDir},{get:async()=>({tokens:null}),close(){}},{
    request,clock:()=>time.wall,monotonicClock:()=>time.mono,scopeRead:()=>({...identity}),
    locator:{resolve:async()=>process.execPath,invalidate(){},status:()=>({state:'ready'})},
  });
  t.after(()=>service.close());
  return {service,time,identity};
}
const sample=at=>({windows:[{limitId:'codex',windowDurationMins:10080,usedPercent:24,remainingPercent:76,resetsAt:at+86400000,observedAt:at}],credits:null,observedAt:at,source:'official-rpc'});

test('retry scheduling survives a backward wall-clock adjustment',async t=>{
  let calls=0;
  const f=fixture(t,async()=>{calls++;throw new QuotaError('RPC_REQUEST_FAILED');});
  await f.service.get();
  f.time.wall-=3600000;f.time.mono+=31000;
  await f.service.get();
  assert.equal(calls,2,'elapsed time, not a corrected calendar clock, must release retry backoff');
});

test('offline refresh retains the real sample and explicitly marks it stale',async t=>{
  let fail=false;
  const f=fixture(t,async()=>{if(fail)throw new QuotaError('RPC_REQUEST_FAILED');return sample(f.time.wall);});
  const first=await f.service.get();fail=true;f.time.wall+=61000;f.time.mono+=61000;
  const next=await f.service.get();
  assert.equal(next.subscription.windows[0].usedPercent,24);
  assert.equal(next.subscription.observedAt,first.subscription.observedAt);
  assert.equal(next.subscription.windows[0].stale,true);
  assert.equal(next.subscription.errorCode,'RPC_REQUEST_FAILED');
});

test('an account change during a request never exposes the previous account result',async t=>{
  let resolve;
  const f=fixture(t,()=>new Promise(r=>{resolve=r;}));
  const pending=f.service.get();
  while(!resolve)await new Promise(r=>setImmediate(r));
  f.identity.key='synthetic-account-b';resolve(sample(f.time.wall));
  const result=await pending;
  assert.equal(result.subscription.errorCode,'ACCOUNT_CHANGED');
  assert.deepEqual(result.subscription.windows,[]);
});
