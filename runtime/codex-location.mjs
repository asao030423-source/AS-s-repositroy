import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {QuotaError} from './quota-rpc.mjs';

const exec=promisify(execFile);
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
// PowerShell 7's inherited module path is incompatible with Windows PowerShell.
const psEnv={...process.env,PSModulePath:path.join(path.dirname(powershell),'Modules')};
const verified=new Map();

export async function discoverCodexExecutables() {
  if(process.platform!=='win32')throw new QuotaError('CLI_PLATFORM_UNSUPPORTED');
  try {
    // These are ordinary read-only Windows commands; no execution-policy change is needed.
    const query="$paths=@(Get-Process -Name codex -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path); $packages=@(Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue); foreach($p in $packages){$paths+=Join-Path $p.InstallLocation 'app\\resources\\codex.exe'}; ConvertTo-Json -InputObject @($paths) -Compress";
    const {stdout}=await exec(powershell,['-NoProfile','-NonInteractive','-Command',query],{env:psEnv,windowsHide:true,timeout:10000,maxBuffer:128*1024});
    const found=JSON.parse(stdout.replace(/^\uFEFF/,''));
    const bins=path.join(process.env.LOCALAPPDATA||'', 'OpenAI','Codex','bin');
    let folders=[];try{folders=await fs.readdir(bins,{withFileTypes:true});}catch{}
    const installed=await Promise.all(folders.filter(f=>f.isDirectory()).slice(0,32).map(async f=>{
      const file=path.join(bins,f.name,'codex.exe');try{return {file,mtime:(await fs.stat(file)).mtimeMs};}catch{return null;}
    }));
    installed.sort((a,b)=>(b?.mtime||0)-(a?.mtime||0));
    return [...new Set([process.env.RIN_CODEX_EXECUTABLE,...(Array.isArray(found)?found:[found]),...installed.map(x=>x?.file)].filter(x=>typeof x==='string'&&path.isAbsolute(x)))];
  }catch(error){if(error instanceof QuotaError)throw error;throw new QuotaError('CLI_DISCOVERY_FAILED');}
}

// Revalidate a replacement binary, not every quota request. Do not execute a PATH lookalike.
export async function inspectCodexExecutable(file) {
  if(!path.isAbsolute(file)||path.basename(file).toLowerCase()!=='codex.exe')return false;
  let stat;try{stat=await fs.stat(file);}catch{return false;}
  if(!stat.isFile())return false;
  const fingerprint=`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  if(verified.get(file)===fingerprint)return true;
  const script="$s=Get-AuthenticodeSignature -LiteralPath $env:RIN_CODEX_CANDIDATE; if($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match '\\bOpenAI\\b'){Write-Output 'verified'}";
  try {
    const {stdout}=await exec(powershell,['-NoProfile','-NonInteractive','-Command',script],{env:{...psEnv,RIN_CODEX_CANDIDATE:file},windowsHide:true,timeout:10000,maxBuffer:8192});
    if(stdout.trim()!=='verified')return false;
    verified.set(file,fingerprint);return true;
  }catch{return false;}
}

export function createCodexLocator({discover=discoverCodexExecutables,inspect=inspectCodexExecutable}={}) {
  let selected=null,state='not-checked';
  return {
    async resolve({exclude=[]}={}) {
      if(selected&&!exclude.includes(selected)&&await inspect(selected))return selected;
      selected=null;state='searching';
      let candidates;
      try{candidates=await discover();}catch(error){state='unavailable';throw error;}
      for(const file of candidates.slice(0,32)) {
        if(exclude.includes(file)||!await inspect(file))continue;
        selected=file;state='ready';return file;
      }
      state='unavailable';throw new QuotaError('CLI_NOT_FOUND');
    },
    invalidate(file){if(file==null||file===selected){selected=null;state='not-checked';}},
    status(){return {state,source:'installed-official-codex'};},
  };
}
