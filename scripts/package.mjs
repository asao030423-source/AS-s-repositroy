import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const windows=process.platform==='win32';
const result=spawnSync(windows?'py':'python3',[
  ...(windows?['-3']:[]),fileURLToPath(new URL('./build-release.py',import.meta.url)),...process.argv.slice(2),
],{stdio:'inherit',windowsHide:true});
if(result.error)console.error('打包需要 Python 3.10+；Windows 安装时请包含 Python Launcher（py）。');
process.exitCode=result.status??1;
