import test from 'node:test';
import assert from 'node:assert/strict';
import {createCodexLocator} from '../runtime/codex-location.mjs';

test('a removed runtime is rediscovered after an application update',async()=>{
  let files=['old'],scans=0;
  const locator=createCodexLocator({discover:async()=>{scans++;return files;},inspect:async file=>files.includes(file)});
  assert.equal(await locator.resolve(),'old');
  files=['new'];
  assert.equal(await locator.resolve(),'new');
  assert.equal(scans,2);
});

test('discovery does not select an unverified executable',async()=>{
  const locator=createCodexLocator({discover:async()=>['untrusted','official'],inspect:async file=>file==='official'});
  assert.equal(await locator.resolve(),'official');
});

test('a failing executable can be invalidated without changing Codex configuration',async()=>{
  let files=['old','new'];
  const locator=createCodexLocator({discover:async()=>files,inspect:async()=>true});
  assert.equal(await locator.resolve(),'old');
  locator.invalidate('old');files=['new'];
  assert.equal(await locator.resolve(),'new');
});
