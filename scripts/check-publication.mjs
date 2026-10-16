import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root=path.resolve('publish');
const allowed=new Set(['.html','.css','.js','.png','.jpg','.jpeg','.webp','.svg','.ico','.txt']);
const privateName=/(?:^|[._-])(output|input|upload|runtime|credential|secret|token|cookie|session|private|source)(?:[._-]|$)/i;
const sensitive=/(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|github_pat_|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{25,}|sk-[A-Za-z0-9_-]{20,}|authorization\s*:\s*bearer|password\s*[:=]|access[_-]?code\s*[:=])/i;

async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(full));else if(e.isFile())out.push(full);else throw new Error(`Unsupported entry: ${path.relative(root,full)}`)}return out}

const files=await walk(root);
if(!files.length)throw new Error('publish directory is empty');
const relative=files.map(f=>path.relative(root,f).replaceAll('\\','/'));
for(const file of relative){if(file.includes('..')||privateName.test(file))throw new Error(`Private-looking artifact: ${file}`);if(!allowed.has(path.extname(file).toLowerCase()))throw new Error(`Unexpected type: ${file}`)}

for(const file of files){
  const ext=path.extname(file).toLowerCase();
  if(!['.html','.css','.js','.svg','.txt'].includes(ext))continue;
  const body=await readFile(file,'utf8');
  if(sensitive.test(body))throw new Error(`Potential credential: ${path.relative(root,file)}`);
  if(ext==='.js')new vm.Script(body,{filename:file});
  if(ext==='.html')for(const m of body.matchAll(/(?:href|src)="([^"]+)"/g)){
    const ref=m[1];if(!ref||ref.startsWith('#')||/^(?:https?:|mailto:|tel:|data:)/i.test(ref))continue;
    const target=path.resolve(path.dirname(file),ref.split(/[?#]/)[0]);
    if(!target.startsWith(root+path.sep))throw new Error(`Reference escapes publish: ${ref}`);
    if(!(await stat(target)).isFile())throw new Error(`Missing asset: ${ref}`);
  }
}
console.log(`Publication check passed: ${relative.length} files, publish/ only.`);
