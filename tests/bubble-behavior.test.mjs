import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context={module:{exports:{}},fetch:async()=>({json:async()=>[]})};
vm.runInNewContext(fs.readFileSync(new URL('../desktop/ui/account-view.js',import.meta.url),'utf8'),context);
const {cleanSettings,compactTokens,turnNoticeText}=context.module.exports;

test('existing bubble settings gain editable timeouts without losing custom choices',()=>{
  const s=cleanSettings({strip:false,quotes:['我的台词'],gap:20});
  assert.equal(s.bubbleIdleSeconds,30);assert.equal(s.turnNoticeSeconds,5);
  assert.equal(s.strip,false);assert.equal(s.quotes[0],'我的台词');assert.equal(s.gap,20);
  const custom=cleanSettings({bubbleIdleSeconds:42,turnNoticeSeconds:8});
  assert.equal(custom.bubbleIdleSeconds,42);assert.equal(custom.turnNoticeSeconds,8);
  assert.equal(cleanSettings({bubbleIdleSeconds:0,turnNoticeSeconds:Infinity}).bubbleIdleSeconds,1);
  assert.equal(cleanSettings({turnNoticeSeconds:Infinity}).turnNoticeSeconds,5);
});

test('turn counts use K/M, carry rounding to the next unit and keep unknown distinct from zero',()=>{
  for(const [n,want] of [[0,'0'],[999,'999'],[12345,'12.3K'],[999950,'1.0M'],[1234567,'1.2M']])assert.equal(compactTokens(n),want);
  assert.equal(turnNoticeText({tokens:12345,completionKind:'success'}),'本轮消耗：12.3Ktoken');
  assert.match(turnNoticeText({tokens:null}),/暂无记录/);
  assert.equal(turnNoticeText({tokens:0}),'本轮消耗：0token');
  assert.equal(turnNoticeText({tokens:1200,partial:true}),'本轮消耗：1.2Ktoken');
  assert.match(turnNoticeText({tokens:1200,completionKind:'cancelled'}),/^本轮已取消/);
});
