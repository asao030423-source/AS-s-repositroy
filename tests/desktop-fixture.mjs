import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {WhaleService} from '../runtime/service.mjs';
import {SessionParser} from '../runtime/session-monitor.mjs';

export function makeFixture(dataDir) {
  const codexHome=path.join(dataDir,'synthetic-codex');
  fs.mkdirSync(codexHome);
  // An API-mode synthetic login prevents this offline UI check from querying an account.
  fs.writeFileSync(path.join(codexHome,'auth.json'),JSON.stringify({auth_mode:'apikey'}));
  const fetchImpl=async()=>new Response('{}',{status:503});
  fs.writeFileSync(path.join(dataDir,'api-settings.json'),JSON.stringify({provider:'none'}));
  return {service:new WhaleService({dataDir,codexHome,env:{},fetchImpl}),monitor:false,autoRefresh:false,fetchImpl};
}

export async function verifyDesktop({app,window,dispatcher,errors,renderInfo,setHost,screen}) {
  const output=process.env.WHALE_DESKTOP_VERIFY_DIR;
  fs.mkdirSync(output,{recursive:true});
  try {
    let ready=false;
    for(let n=0;n<50&&!ready;n++) {
      ready=await window.webContents.executeJavaScript("document.title==='Codex Rin Companion' && [...document.images].some(i=>i.src.includes('/dsh-whale/image.png')&&i.complete&&i.naturalWidth>0)");
      if(!ready)await delay(100);
    }
    assert.equal(ready,true,'the real renderer must load the default character');
    const read=async route=>JSON.parse((await dispatcher.dispatch(route)).body);
    assert.equal((await read('/api/display-mode')).mode,'subscription');
    const quotes=await read('/theme/quotes.json');
    assert.ok(Array.isArray(quotes)&&quotes.length>0&&quotes.every(q=>typeof q==='string'));
    const media=await read('/dsh-whale/audio.json');
    assert.equal(media.fragments.length,0,'no upstream audio samples ship in the public package');
    assert.ok(media.groups.every(g=>g.press===''&&g.release===''));
    const pictures=await read('/dsh-whale/bubble-imgs.json');
    assert.deepEqual(pictures.images.map(i=>i.id),['rin_default']);
    assert.equal((await dispatcher.dispatch('/dsh-whale/sound/press.mp3')).status,204);
    const quota=await read('/api/quota');
    assert.equal(quota.subscription.errorCode,'API_LOGIN');
    assert.equal(Object.hasOwn(quota,'sessions'),false,'quota tool must not expose session details');
    await setHost({hostAlive:true,visible:true,window:'fixture',bounds:screen.getPrimaryDisplay().bounds});
    const evaluate=code=>window.webContents.executeJavaScript(code);
    const until=async code=>{
      for(let n=0;n<40;n++){if(await evaluate(code))return;await delay(100);}
      assert.fail('Renderer condition timed out: '+code);
    };
    for(let n=0;n<40&&!window.isVisible();n++)await delay(100);
    assert.equal(window.isVisible(),true,'wait for native window readiness before interaction');
    await evaluate("whaleDesktop.command('mode')");
    await until('!document.hidden && !!window.WhaleRinUiV4');
    const defaults=await evaluate(`(() => {
      WhaleRinUiV4.settings(); const d=document.querySelector('.rin-v4-settings');
      const idle=d.querySelector('[data-setting=bubbleIdleSeconds]'),turn=d.querySelector('[data-setting=turnNoticeSeconds]');
      const defaults=[Number(idle.value),Number(turn.value)];idle.value=2;turn.value=1;
      [...d.querySelectorAll('button')].find(b=>b.textContent==='保存').click();return defaults;
    })()`);
    assert.deepEqual(defaults,[30,5]);
    const loading=await evaluate(`(() => {
      WhaleAccountView.toggleBubble(document.querySelector('.dshwv-root'));
      return document.querySelector('.rin-v4-message').textContent;
    })()`);
    assert.equal(loading,'我在帮你看嘛');
    await delay(1200);
    await evaluate("document.querySelector('.rin-v4-message').click()");
    assert.equal(await evaluate('WhaleRinUiV4.status().state'),'quotes');
    await delay(1100);assert.equal(await evaluate('WhaleRinUiV4.status().state'),'quotes');
    await until("WhaleRinUiV4.status().state==='closed' && document.querySelector('.rin-v4-bubble').hidden");

    // A real parser -> ledger -> polling event, with only synthetic local data.
    await evaluate(`(() => {
      const original=window.fetch;window.fetch=(url,...args)=>url==='/api/insights'
        ? new Promise(resolve=>{window.finishFixtureQuota=()=>{window.fetch=original;resolve(new Response(JSON.stringify({ok:true,subscription:{available:false,windows:[]}})));};})
        : original(url,...args);
      WhaleAccountView.toggleBubble(document.querySelector('.dshwv-root'));
    })()`);
    const jobs=[];
    const parser=new SessionParser({id:'fixture-session',defaultModel:'fixture-model',
      onStart:m=>dispatcher.whale.beginTurn(m),onEnd:m=>jobs.push(dispatcher.whale.finishTurn(m))});
    const event=payload=>parser.accept({type:'event_msg',timestamp:new Date().toISOString(),payload});
    event({type:'task_started',turn_id:'fixture-turn'});
    event({type:'token_count',info:{total_token_usage:{input_tokens:12000,output_tokens:345}}});
    event({type:'task_complete',turn_id:'fixture-turn'});await Promise.all(jobs);
    await until("WhaleRinUiV4.status().state==='turn'");
    assert.equal(await evaluate("document.querySelector('.rin-v4-message').textContent"),'本轮消耗：12.3Ktoken');
    await evaluate('finishFixtureQuota()');await delay(100);
    assert.equal(await evaluate('WhaleRinUiV4.status().state'),'turn','late quota must not overwrite a turn notice');
    await until("WhaleRinUiV4.status().state==='closed' && document.querySelector('.rin-v4-bubble').hidden");
    await evaluate("WhaleAccountView.notice({tokens:1234567,completionKind:'success'})");
    await delay(600);await evaluate("document.querySelector('.rin-v4-message').click()");
    await delay(700);assert.equal(await evaluate('WhaleRinUiV4.status().state'),'quotes','clicking replaces the notification timeout');
    await evaluate('WhaleRinUiV4.closeBubble()');
    const reloaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));
    window.webContents.reload();await reloaded;
    await until('!!window.WhaleRinUiV4');await delay(1200);
    assert.equal(await evaluate('WhaleRinUiV4.status().state'),'closed','reload must not replay an old completion');
    assert.deepEqual(await evaluate(`(() => { const s=JSON.parse(localStorage.getItem('dshw-rin-ui-v4'));return [s.bubbleIdleSeconds,s.turnNoticeSeconds];})()`),[2,1]);
    assert.deepEqual(errors,[]);
    const report={ok:true,checks:['renderer-character','subscription-default','theme-quotes','quota-boundary','renderer-errors','bubble-idle-and-click-reset','turn-parser-to-bubble','late-quota-race','turn-timeout-and-click-reset','settings-reload-no-replay'],realAccount:false,windowShapeError:renderInfo().windowShapeError||null};
    fs.writeFileSync(path.join(output,'desktop-follow.json'),JSON.stringify(report,null,2));
    app.quit();
  }catch(error) {
    fs.writeFileSync(path.join(output,'desktop-follow.json'),JSON.stringify({ok:false,error:error.message}));
    app.exit(1);
  }
}
