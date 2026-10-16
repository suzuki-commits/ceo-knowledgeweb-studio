import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { resolveOutputPath } from '../lib/output-path.mjs';

const job='123e4567-e89b-42d3-a456-426614174000';
const within=(root,target)=>{const rel=path.relative(root,target);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);};
async function serve(res,outputs,pathname){const output=resolveOutputPath(outputs,pathname);if(!output){res.writeHead(404);return res.end('missing');}const target=path.resolve(output.root,output.relativePath);if(!within(output.root,target)){res.writeHead(404);return res.end('missing');}try{const s=await stat(target);if(!s.isFile())throw new Error();const data=await readFile(target);res.writeHead(200);res.end(data);}catch{res.writeHead(404);res.end('missing');}}

test('HTTP output route serves bucket files and blocks encoded bucket traversal',async t=>{const root=await mkdtemp(path.join(tmpdir(),'output-route-')),jobRoot=path.join(root,job);await mkdir(path.join(jobRoot,'assets'),{recursive:true});await writeFile(path.join(jobRoot,'assets','photo.jpg'),'fixture-image');await writeFile(path.join(jobRoot,'input.json'),'FIXTURE_SECRET_MARKER');const server=http.createServer((req,res)=>serve(res,root,new URL(req.url,'http://fixture').pathname));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;try{let good;try{good=await fetch(`http://127.0.0.1:${port}/outputs/${job}/assets/photo.jpg`);}catch(error){if(error.cause?.code==='EACCES'){t.skip('sandbox blocks loopback HTTP');return;}throw error;}assert.equal(good.status,200);assert.equal(await good.text(),'fixture-image');for(const attack of [`/outputs/${job}/sites/%2e%2e%2finput.json`,`/outputs/${job}/assets/%2e%2e%2finput.json`,`/outputs/${job}/proposal/%2e%2e%5cinput.json`]){const response=await fetch(`http://127.0.0.1:${port}${attack}`);assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/FIXTURE_SECRET_MARKER/);}}finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}});
