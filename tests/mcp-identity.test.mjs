import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('the published MCP entry starts our local adapter and advertises Rin tools',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../.mcp.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(manifest.mcpServers),['rin']);
  assert.deepEqual(manifest.mcpServers.rin,{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/runtime/mcp.mjs']});
  const requests=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
    {jsonrpc:'2.0',id:2,method:'tools/list'}];
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../runtime/mcp.mjs',import.meta.url))],
    {input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',windowsHide:true,timeout:5000});
  assert.equal(result.status,0,result.stderr);
  const replies=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(replies.find(r=>r.id===1).result.serverInfo.name,'codex-rin-companion');
  assert.deepEqual(replies.find(r=>r.id===2).result.tools.map(t=>t.name).sort(),['rin_balance','rin_open','rin_quota','rin_status','rin_usage']);
});
