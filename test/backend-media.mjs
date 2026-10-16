import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inspectImage, prepareVisualAssets, installManifestAssets } from '../lib/media.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64');

test('photo validation uses magic bytes and dimensions',()=>{
  assert.deepEqual(inspectImage(png,'image/png'),{type:'image/png',ext:'.png',width:1,height:1});
  assert.throws(()=>inspectImage(Buffer.from('<svg/>'),'image/svg+xml'),/JPEG, PNG, or WebP/);
  assert.throws(()=>inspectImage(png,'image/jpeg'),/MIME/);
});

test('uploaded photos become local visual assets',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'media-test-'));try{const visual=await prepareVisualAssets({personName:'人物',photos:[{name:'portrait.png',mime:'image/png',role:'portrait',base64:png.toString('base64')}]},[],dir);assert.equal(visual.assets.length,1);assert.equal(visual.assets[0].subjectVerified,true);assert.equal((await readFile(path.join(dir,visual.assets[0].file))).length,png.length);}finally{await rm(dir,{recursive:true,force:true});}});

test('manifest installer rejects traversal through actual source lookup',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'manifest-test-'));try{const manifest=path.join(dir,'manifest.json');await import('node:fs/promises').then(fs=>fs.writeFile(manifest,JSON.stringify({assets:[{id:'x',filename:'../outside.png',role:'context'}]})));await assert.rejects(installManifestAssets(manifest,path.join(dir,'source'),path.join(dir,'out')));}finally{await rm(dir,{recursive:true,force:true});}});

test('manifest installer preserves safe IDs for caption mapping',async()=>{const dir=await mkdtemp(path.join(tmpdir(),'manifest-id-test-'));try{const source=path.join(dir,'source'),manifest=path.join(dir,'manifest.json');await import('node:fs/promises').then(async fs=>{await fs.mkdir(source);await fs.writeFile(path.join(source,'photo.png'),png);await fs.writeFile(manifest,JSON.stringify({assets:[{id:'suzuki-portrait-photo',filename:'photo.png',role:'portrait',caption:'editorial'}]}));});const visual=await installManifestAssets(manifest,source,path.join(dir,'out'));assert.equal(visual.assets[0].id,'suzuki-portrait-photo');assert.equal(visual.assets[0].file,'assets/suzuki-portrait-photo.png');}finally{await rm(dir,{recursive:true,force:true});}});
