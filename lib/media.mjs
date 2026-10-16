import path from 'node:path';
import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { fetchPublicImage } from './input.mjs';

const MAX=4*1024*1024;
const roles=new Set(['portrait','work','community','sport','brand','context']);

export function inspectImage(data, claimed='') {
  if(!Buffer.isBuffer(data)||!data.length||data.length>MAX)throw new Error('Photo must be between 1 byte and 4 MB');
  let type,width=0,height=0,ext;
  if(data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){type='image/png';ext='.png';width=data.readUInt32BE(16);height=data.readUInt32BE(20);}
  else if(data.length>=12&&data.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))){type='image/jpeg';ext='.jpg';for(let i=2;i+9<data.length;){if(data[i]!==0xff){i++;continue;}const marker=data[i+1],len=data.readUInt16BE(i+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=data.readUInt16BE(i+5);width=data.readUInt16BE(i+7);break;}if(len<2)break;i+=2+len;}}
  else if(data.length>=30&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'){type='image/webp';ext='.webp';const kind=data.subarray(12,16).toString();if(kind==='VP8X'){width=1+data.readUIntLE(24,3);height=1+data.readUIntLE(27,3);}else if(kind==='VP8 '&&data.length>=30){width=data.readUInt16LE(26)&0x3fff;height=data.readUInt16LE(28)&0x3fff;}else if(kind==='VP8L'&&data.length>=25){const bits=data.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>14)&0x3fff)+1;}}
  else throw new Error('Only JPEG, PNG, or WebP photos are allowed');
  if(claimed){const declared=String(claimed).toLowerCase().split(';')[0].trim();if(!declared.match(/^image\/(jpeg|png|webp)$/)||declared!==type)throw new Error('Photo MIME type does not match its image data');}
  if(!width||!height||width>20000||height>20000)throw new Error('Photo dimensions could not be validated');
  return {type,ext,width,height};
}

const safeId=(s,i)=>`${String(s||'photo').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'photo'}-${i+1}`;
const nameMatch=(candidate,personName)=>{const name=String(personName||'').replace(/[\s　]+/g,'').toLowerCase();if(name.length<2)return false;return `${candidate.alt||''} ${candidate.context||''}`.replace(/[\s　]+/g,'').toLowerCase().includes(name);};
const inferredRole=(candidate,verified)=>{const text=`${candidate.alt||''} ${candidate.context||''} ${candidate.url||''}`.toLowerCase();if(/集合|会食|イベント|コミュニティ|community|event|dinner/.test(text))return 'community';if(/登壇|授賞|講演|stage|award|speaking/.test(text))return 'work';if(/トレーニング|マラソン|ランニング|スポーツ|gym|sport|trail/.test(text))return 'sport';if(/youtube|番組|メディア|media|出演/.test(text))return 'brand';return verified?'portrait':'context';};

export async function prepareVisualAssets(input,sources,outDir) {
  const dir=path.join(outDir,'assets');await mkdir(dir,{recursive:true});const assets=[],notes=[];
  for(const [i,photo] of (input.photos||[]).entries()){
    const data=Buffer.from(photo.base64,'base64'),info=inspectImage(data,photo.mime||'');const id=safeId(path.parse(photo.name).name,i),file=`assets/${id}${info.ext}`;
    await writeFile(path.join(outDir,...file.split('/')),data,{mode:0o600});assets.push({id,file,role:roles.has(photo.role)?photo.role:'context',alt:String(photo.alt||`${input.personName||'人物'}の提供写真`).slice(0,240),caption:String(photo.caption||'ユーザー提供写真').slice(0,300),sourceUrl:'',sourcePageUrl:'',subjectVerified:photo.role==='portrait',width:info.width,height:info.height});
  }
  let remoteIndex=assets.length;
  for(const source of sources.filter(s=>s.type==='url'))for(const candidate of (source.imageCandidates||[]).slice(0,20)){
    if(assets.some(a=>a.sourceUrl===candidate.url))continue;
    try{const fetched=await fetchPublicImage(candidate.url);if(!/^image\/(jpeg|png|webp)(?:;|$)/i.test(fetched.contentType))continue;const info=inspectImage(fetched.data,fetched.contentType);if(info.width<300||info.height<180)continue;const verified=nameMatch(candidate,input.personName),role=inferredRole(candidate,verified),id=safeId(`web-${new URL(source.url).hostname}`,remoteIndex++),file=`assets/${id}${info.ext}`;await writeFile(path.join(outDir,...file.split('/')),fetched.data,{mode:0o600});assets.push({id,file,role,alt:String(candidate.alt||`${new URL(source.url).hostname}の掲載画像`).slice(0,240),caption:verified?'本人名とともに公開ページへ掲載されている写真':'公開ページの掲載写真',sourceUrl:fetched.url,sourcePageUrl:source.url,subjectVerified:verified,width:info.width,height:info.height});}catch{/* unsafe, oversized, or non-image candidates are skipped */}
    if(assets.length>=12)break;
  }
  if((input.urls||[]).some(u=>/facebook\.com|fb\.com/i.test(u))&&!sources.some(s=>/facebook\.com|fb\.com/i.test(s.url)&&s.imageCandidates?.length))notes.push('Facebookなどログインが必要なページの写真は取得済みと扱いません。使用する写真をアップロードしてください。');
  return {version:1,accent:'#FFD23F',assets,notes};
}

export async function installManifestAssets(manifestPath,sourceDir,outDir){const manifest=JSON.parse(await readFile(manifestPath,'utf8')),assets=[],ids=new Set();await mkdir(path.join(outDir,'assets'),{recursive:true});for(const item of (manifest.assets||[])){const source=path.resolve(sourceDir,String(item.filename||'')),rel=path.relative(path.resolve(sourceDir),source);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Manifest asset path is unsafe');const id=String(item.id||'');if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)||ids.has(id))throw new Error('Manifest asset id is unsafe or duplicated');ids.add(id);const data=await readFile(source),info=inspectImage(data),file=`assets/${id}${info.ext}`;await copyFile(source,path.join(outDir,...file.split('/')));assets.push({id,file,role:roles.has(item.role)?item.role:'context',alt:String(item.alt||''),caption:String(item.caption||''),sourceUrl:String(item.sourceUrl||''),sourcePageUrl:String(item.sourcePageUrl||''),subjectVerified:Boolean(item.subjectVerified),width:info.width,height:info.height});}return {version:1,accent:'#FFD23F',assets,notes:[]};}
