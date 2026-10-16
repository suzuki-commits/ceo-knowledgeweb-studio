import http from 'node:http';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt=promisify(scryptCallback),ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REMOTE_HOST='ceo-knowledgeweb.autopilot-note.com',COOKIE='ceo_studio_session',MAX_BODY=64*1024*1024,LOGIN_MAX=8192,TTL=12*60*60*1000;
const LOCAL_HOSTS=new Set(['127.0.0.1:8830','localhost:8830']);
const UI=new Set(['/','/index.html','/styles.css','/media.css','/app.js','/favicon.svg']);
const LOGIN_CSS=':root{font-family:"Yu Gothic UI",Meiryo,sans-serif;color:#071b35;background:#f5f8fc}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:linear-gradient(145deg,#f8fbff,#e8f2fb)}main{width:min(440px,100%);background:#fff;border:1px solid #d8e2ee;box-shadow:0 24px 70px #071b351c;padding:clamp(30px,7vw,54px)}.mark{display:grid;place-items:center;width:48px;height:48px;background:#ffd23f;font-weight:900;margin-bottom:28px}small{font:700 10px ui-monospace;letter-spacing:.15em;color:#1689e9}h1{font-size:30px;margin:10px 0 12px}p{color:#617187;line-height:1.8;font-size:13px}label{display:block;font-weight:700;font-size:13px;margin-top:28px}input{display:block;width:100%;margin:9px 0 14px;padding:14px;border:1px solid #bac9d8;font:inherit}button{width:100%;border:0;background:#071b35;color:#fff;padding:15px;font:700 14px inherit;cursor:pointer}button:hover{background:#1689e9}.note{margin-top:20px;padding-top:18px;border-top:1px solid #d8e2ee;font-size:11px}pre{white-space:pre-wrap;word-break:break-all;background:#f5f8fc;padding:14px;border-left:4px solid #ffd23f}a{color:#076dbf}';
const loopback=value=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(String(value||'').toLowerCase());
const securityHeaders=styleNonce=>({'cache-control':'no-store, private','content-security-policy':`default-src 'self'; frame-src 'self'; img-src 'self' blob: data:; style-src 'self'${styleNonce?` 'nonce-${styleNonce}'`:''}; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`,'referrer-policy':'same-origin','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN'});
const send=(res,status,body,type='text/plain; charset=utf-8',extra={})=>{const data=Buffer.from(body);res.writeHead(status,{'content-type':type,'content-length':data.length,...securityHeaders(),...extra});res.end(data);};
const json=(res,status,value,extra={})=>send(res,status,JSON.stringify(value),'application/json; charset=utf-8',extra);
const htmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cookies=req=>Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2));
const clientIp=req=>String(req.headers['cf-connecting-ip']||req.socket.remoteAddress||'unknown').slice(0,100);
const expectedOrigin=host=>LOCAL_HOSTS.has(host)?`http://${host}`:`https://${REMOTE_HOST}`;
const isMutating=(method)=>!['GET','HEAD','OPTIONS'].includes(method);

function allowedProxyPath(rawPath,method){
  let decoded;try{decoded=decodeURIComponent(rawPath);}catch{return false;}
  if(decoded.includes('\\')||decoded.split('/').some(x=>x==='..'||x==='.'))return false;
  if(UI.has(decoded))return method==='GET'||method==='HEAD';
  if(decoded==='/api/health'||decoded==='/api/jobs')return method==='GET'||(decoded==='/api/jobs'&&method==='POST');
  if(/^\/api\/jobs\/[0-9a-f-]+(?:\/download|\/cancel)?$/.test(decoded))return ['GET','POST'].includes(method);
  return /^\/outputs\/[0-9a-f-]+\/(?:proposal|sites|assets)\/.+/.test(decoded)&&(method==='GET'||method==='HEAD');
}

async function readBody(req,limit){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('request too large'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
export function secureHtmlResponse(html,nonce=randomBytes(18).toString('base64url')){return {html:String(html).replace(/<style\b(?![^>]*\bnonce=)/gi,`<style nonce="${nonce}"`),headers:securityHeaders(nonce),nonce};}
function defaultUpstream({method,path:requestPath,headers,body},res){return new Promise((resolve,reject)=>{const upstream=http.request({host:'127.0.0.1',port:8826,method,path:requestPath,headers},response=>{const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>16*1024*1024){upstream.destroy(new Error('Upstream response exceeds 16 MB'));return;}chunks.push(chunk);});response.on('end',()=>{let data=Buffer.concat(chunks);const responseHeaders={...response.headers};delete responseHeaders['set-cookie'];delete responseHeaders['content-length'];delete responseHeaders['content-encoding'];const type=String(responseHeaders['content-type']||'').toLowerCase();if(type.includes('text/html')){const secured=secureHtmlResponse(data.toString('utf8'));data=Buffer.from(secured.html);Object.assign(responseHeaders,secured.headers);}else Object.assign(responseHeaders,securityHeaders());responseHeaders['content-length']=String(data.length);res.writeHead(response.statusCode||502,responseHeaders);res.end(data);resolve();});});upstream.on('error',reject);if(body.length)upstream.write(body);upstream.end();});}

export async function createRemoteGateway({accessCode,clock=()=>Date.now(),requestUpstream=defaultUpstream,testOnlyMaxBody}={}){
  if(typeof accessCode!=='string'||accessCode.length<24)throw new Error('A strong access code is required');
  const maxBody=testOnlyMaxBody??MAX_BODY;if(!Number.isSafeInteger(maxBody)||maxBody<1||maxBody>MAX_BODY)throw new Error('Invalid body limit');
  const salt=randomBytes(16),expected=await scrypt(accessCode,salt,32),sessions=new Map(),ipAttempts=new Map(),globalAttempts=[];
  const validSession=req=>{const token=cookies(req)[COOKIE];if(!token)return false;const expiry=sessions.get(token);if(!expiry||expiry<=clock()){sessions.delete(token);return false;}return true;};
  const rateLimited=ip=>{const now=clock(),windowStart=now-15*60*1000,recent=(ipAttempts.get(ip)||[]).filter(x=>x>windowStart);ipAttempts.set(ip,recent);while(globalAttempts[0]<=windowStart)globalAttempts.shift();return recent.length>=5||globalAttempts.length>=50;};
  const recordFailure=ip=>{const now=clock();ipAttempts.set(ip,[...(ipAttempts.get(ip)||[]),now]);globalAttempts.push(now);};
  const server=http.createServer(async(req,res)=>{try{
    const host=String(req.headers.host||'').toLowerCase(),localHost=LOCAL_HOSTS.has(host),remoteHost=host===REMOTE_HOST;if(!localHost&&!remoteHost)return json(res,403,{error:'Invalid Host header'});
    const url=new URL(req.url,`${localHost?'http':'https'}://${host}`),pathname=url.pathname,externalProxyHeaders=['cf-ray','cf-connecting-ip','cf-visitor'].some(h=>req.headers[h]);
    if(req.method==='GET'&&pathname==='/healthz')return json(res,200,{ok:true,service:'ceo-studio-gateway'});
    if(req.method==='GET'&&pathname==='/login.css')return send(res,200,LOGIN_CSS,'text/css; charset=utf-8');
    if(pathname==='/local/access'){
      if(req.method!=='GET'||!localHost||!loopback(req.socket.remoteAddress)||externalProxyHeaders)return json(res,404,{error:'Not found'});
      return send(res,200,`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/login.css"><title>CEO Studio 接続情報</title><main><div class="mark">CS</div><small>LOCAL ACCESS</small><h1>接続情報</h1><p>公開URL: <a href="https://${REMOTE_HOST}/">https://${REMOTE_HOST}/</a></p><p>アクセスコード</p><pre>${htmlEscape(accessCode)}</pre><p class="note">この画面とコードを第三者へ共有しないでください。</p></main></html>`,'text/html; charset=utf-8');
    }
    if(pathname==='/login'&&req.method==='GET')return send(res,200,'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/login.css"><title>CEO Studio ログイン</title><main><div class="mark">CS</div><small>SECURE REMOTE ACCESS</small><h1>CEO Studio</h1><p>外出先から人物サイトの5案と提案書を生成できます。</p><form method="post" action="/login"><label>アクセスコード<input name="code" type="password" autocomplete="current-password" required></label><button type="submit">ログイン</button></form><p class="note">生成にはStudio PCとCodexが稼働している必要があります。</p></main></html>','text/html; charset=utf-8');
    if(pathname==='/login'&&req.method==='POST'){
      if(req.headers.origin!==expectedOrigin(host))return json(res,403,{error:'Origin rejected'});const ip=clientIp(req);if(rateLimited(ip))return json(res,429,{error:'Too many attempts'},{'retry-after':'900'});
      const body=await readBody(req,LOGIN_MAX),type=String(req.headers['content-type']||'').split(';')[0],isForm=type==='application/x-www-form-urlencoded';let supplied='';if(isForm)supplied=new URLSearchParams(body.toString('utf8')).get('code')||'';else if(type==='application/json'){try{supplied=JSON.parse(body.toString('utf8')).code||'';}catch{return json(res,400,{error:'Invalid login payload'});}}else return json(res,415,{error:'Unsupported content type'});
      const actual=await scrypt(String(supplied),salt,32),ok=actual.length===expected.length&&timingSafeEqual(actual,expected);if(!ok){recordFailure(ip);return isForm?send(res,401,'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/login.css"><title>ログインできません</title><main><div class="mark">CS</div><h1>ログインできません</h1><p>アクセスコードを確認して、もう一度入力してください。</p><p><a href="/login">ログインへ戻る</a></p></main></html>','text/html; charset=utf-8'):json(res,401,{error:'Invalid access code'});}ipAttempts.delete(ip);const token=randomBytes(32).toString('base64url');sessions.set(token,clock()+TTL);const cookie={'set-cookie':`${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${remoteHost?'; Secure':''}`};return isForm?send(res,303,'','text/plain; charset=utf-8',{...cookie,location:'/'}):json(res,200,{ok:true},cookie);
    }
    if(pathname==='/logout'&&req.method==='POST'){
      if(req.headers.origin!==expectedOrigin(host))return json(res,403,{error:'Origin rejected'});const token=cookies(req)[COOKIE];if(token)sessions.delete(token);return json(res,200,{ok:true},{'set-cookie':`${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${remoteHost?'; Secure':''}`});
    }
    if(!validSession(req))return pathname.startsWith('/api/')||pathname.startsWith('/outputs/')?json(res,401,{error:'Authentication required'}):send(res,302,'', 'text/plain; charset=utf-8', {location:'/login'});
    if(!allowedProxyPath(pathname,req.method))return json(res,404,{error:'Not found'});
    if(isMutating(req.method)&&req.headers.origin!==expectedOrigin(host))return json(res,403,{error:'Origin rejected'});
    const declared=Number(req.headers['content-length']||0);if(!Number.isFinite(declared)||declared>maxBody)return json(res,413,{error:'Request exceeds 64 MB'});const body=await readBody(req,maxBody);
    const headers={};for(const name of ['accept','accept-language','content-type'])if(req.headers[name])headers[name]=req.headers[name];headers.host='127.0.0.1:8826';if(isMutating(req.method))headers.origin='http://127.0.0.1:8826';if(body.length)headers['content-length']=String(body.length);
    await requestUpstream({method:req.method,path:req.url,headers,body},res);
  }catch(error){if(!res.headersSent)json(res,error.status||502,{error:error.status===413?'Request exceeds allowed size':'Gateway request failed'});else res.destroy();}});
  return server;
}

async function readDpapiCode(){return await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','remote-auth-store.ps1'),'-Mode','get'],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});const out=[],err=[];child.stdout.on('data',x=>out.push(x));child.stderr.on('data',x=>err.push(x));child.on('error',reject);child.on('close',code=>code===0?resolve(Buffer.concat(out).toString('utf8').trim()):reject(new Error(`DPAPI credential load failed (${code}): ${Buffer.concat(err).toString('utf8').slice(0,200)}`)));});}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const accessCode=process.platform==='win32'?await readDpapiCode():process.env.CEO_STUDIO_ACCESS_CODE;if(!accessCode)throw new Error('CEO_STUDIO_ACCESS_CODE is required outside Windows');const server=await createRemoteGateway({accessCode});server.listen(8830,'127.0.0.1',()=>console.log('CEO Studio remote gateway listening on http://127.0.0.1:8830'));}
