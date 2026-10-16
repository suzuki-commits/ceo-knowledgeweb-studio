import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path'; import { tmpdir } from 'node:os';
import { makeZip } from '../lib/zip.mjs';

test('ZIP includes local assets and excludes input.json',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'zip-test-'));try{await mkdir(path.join(dir,'sites','01'),{recursive:true});await mkdir(path.join(dir,'assets'),{recursive:true});await writeFile(path.join(dir,'sites','01','index.html'),'hello');await writeFile(path.join(dir,'assets','portrait.jpg'),'image');await writeFile(path.join(dir,'input.json'),'secret');const zip=await makeZip(dir);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);assert.equal(zip.readUInt16LE(zip.length-12),2);assert.match(zip.toString('utf8'),/assets\/portrait.jpg/);assert.doesNotMatch(zip.toString('utf8'),/input.json/);}finally{await rm(dir,{recursive:true,force:true});}});
