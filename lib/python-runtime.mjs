import { spawn } from 'node:child_process';

export function toWslPath(value){const text=String(value);if(process.platform!=='win32')return text;const match=text.match(/^([a-zA-Z]):[\\/](.*)$/);if(!match)throw new Error('WSL Python requires an absolute Windows drive path');return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\','/')}`;}

export function runPython(script,args=[],{timeout=20000}={}){
  const executable=process.platform==='win32'?'wsl.exe':'python3',commandArgs=process.platform==='win32'?['--exec','python3','-c',script,...args.map(toWslPath)]:['-c',script,...args];
  return new Promise((resolve,reject)=>{const child=spawn(executable,commandArgs,{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}}),out=[],err=[];let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};const timer=setTimeout(()=>{child.kill();finish(new Error('WSL Python execution timed out'));},timeout);child.stdout.on('data',x=>out.push(x));child.stderr.on('data',x=>err.push(x));child.on('error',error=>finish(new Error(`WSL Python is unavailable: ${error.message}`)));child.on('close',code=>code===0?finish(null,Buffer.concat(out).toString('utf8')):finish(new Error(`WSL Python failed (${code}): ${Buffer.concat(err).toString('utf8').slice(0,300)}`)));});
}
