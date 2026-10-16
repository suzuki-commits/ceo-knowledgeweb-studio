import path from 'node:path';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKETS=new Set(['proposal','sites','assets']);

export function resolveOutputPath(outputsRoot,rawPathname){
  if(typeof rawPathname!=='string'||!rawPathname.startsWith('/outputs/'))return null;
  let decoded;try{decoded=decodeURIComponent(rawPathname.slice('/outputs/'.length));}catch{return null;}
  if(decoded.includes('\\')||decoded.includes('\0'))return null;
  const parts=decoded.split('/');if(parts.length<3)return null;
  const [jobId,bucket,...rest]=parts;
  if(!UUID.test(jobId)||!BUCKETS.has(bucket)||rest.some(part=>!part||part==='.'||part==='..'))return null;
  return {root:path.join(outputsRoot,jobId,bucket),relativePath:rest.join('/')};
}
