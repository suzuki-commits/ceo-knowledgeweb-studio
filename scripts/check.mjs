import { spawn } from 'node:child_process';
const child=spawn(process.execPath,['--test','test/*.mjs'],{stdio:'inherit',shell:true,windowsHide:true});
child.on('exit',code=>process.exitCode=code??1);
