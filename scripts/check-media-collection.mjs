import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { collectSources } from '../lib/input.mjs';
import { prepareVisualAssets } from '../lib/media.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),rawUrl=process.argv[2],label=process.argv[3]||'live-media-check';
if(!rawUrl)throw new Error('Usage: node scripts/check-media-collection.mjs <public-profile-url> [qa-label]');
const url=new URL(rawUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('A credential-free public HTTP(S) URL is required');
if(!/^[a-zA-Z0-9_-]{1,64}$/.test(label))throw new Error('QA label must use letters, numbers, hyphens, or underscores');
const outDir=path.resolve(root,'qa',label);if(path.dirname(outDir)!==path.resolve(root,'qa'))throw new Error('Unsafe QA output path');
await mkdir(outDir,{recursive:true});
const input={personName:'鈴木章裕',urls:[url.href],pdfs:[],photos:[],notes:'',provider:'codex'},collected=await collectSources(input),visual=await prepareVisualAssets(input,collected,outDir);
const manifest={checkedAt:new Date().toISOString(),sourcePageUrl:collected[0]?.url||url.href,candidateCount:collected[0]?.imageCandidates?.length||0,visual};
const manifestPath=path.join(outDir,'manifest.json');await writeFile(manifestPath,JSON.stringify(manifest,null,2));
const readback=JSON.parse(await readFile(manifestPath,'utf8'));
for(const asset of readback.visual.assets)await readFile(path.join(outDir,...asset.file.split('/')));
console.log(JSON.stringify({manifestPath,sourcePageUrl:readback.sourcePageUrl,candidateCount:readback.candidateCount,savedAssets:readback.visual.assets.length,roles:readback.visual.assets.map(x=>x.role),subjectVerified:readback.visual.assets.filter(x=>x.subjectVerified).length},null,2));
