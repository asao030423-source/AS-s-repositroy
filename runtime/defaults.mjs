import fs from 'node:fs';
import path from 'node:path';
import {writeJson} from './paths.mjs';

// First launch only. Existing settings always win.
export function ensureDefaults(dataDir) {
  for(const [name,value] of Object.entries({
    'display-mode.json':{version:1,mode:'subscription'},
    'ui-state.json':{'dshw-account-view':'subscription'},
  })) {
    const file=path.join(dataDir,name);
    if(!fs.existsSync(file))writeJson(file,value);
  }
}
