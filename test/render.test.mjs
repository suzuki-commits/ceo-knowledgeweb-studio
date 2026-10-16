import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderBundle } from '../lib/render.mjs';

const sample = {
  person: {
    name: '青山 遥', company: '架空デモ株式会社', title: '代表取締役', tagline: '考えを、次の行動へ。',
    introduction: '組織と地域の対話を支える活動をしています。',
    story: [{year:'2024',title:'活動を開始',body:'提供資料で確認できた活動です。',sourceIds:['S1']}],
    strengths: [{title:'対話の設計',body:'異なる立場の意見を整理します。',sourceIds:['S1']}],
    activities: [{title:'公開対話',body:'地域の対話会を企画しています。',sourceIds:['S1']}],
    media: [{title:'地域誌インタビュー',body:'活動の背景を紹介しました。',sourceIds:['S1']}],
    speaking: [{title:'公開セッション',body:'対話設計について登壇しました。',sourceIds:['S1']}],
    community: [{title:'地域対話会',body:'異なる立場が集まる場です。',sourceIds:['S1']}],
    vision:'立場を越えて話せる場所を増やす。', contactUrl:''
  },
  analysis: {
    summary:'公開資料では、対話を軸にした一貫性が見られます。',
    characters:[{name:'編集者',description:'制作上の仮説です。',sourceIds:['S1']}],
    positioning:{entrance:'対話',proof:'活動記録',core:'共創'}, opportunities:[],
    audience:[{who:'企画担当者',need:'背景を理解したい',action:'活動を読む'}], conflicts:[]
  },
  concepts: [], facts:[{claim:'2024年に活動を開始',sourceIds:['S1']}], pendingQuestions:['正式な公開窓口'],
  proposal:{title:'青山 遥さんの公式な居場所をつくる。',lead:'確認できた事実をひとつにまとめます。',recommendation:'案01を軸に検討します。',nextSteps:['公開範囲を確認する']},
  sources:[{id:'S1',type:'text',label:'本人提供メモ',url:'',retrievedAt:'2026-10-16',text:'活動記録'}],
  visual:{assets:[
    {id:'gym_rapala',role:'portrait',file:'assets/gym_rapala.jpg',alt:'トレーニング中の青山 遥',width:1500,height:2000,subjectVerified:true,sourcePageUrl:'https://example.com/profile'},
    {id:'stage_award',role:'work',file:'assets/stage_award.jpg',alt:'ステージで登壇する青山 遥',width:1500,height:2000,subjectVerified:true},
    {id:'event_ai',role:'community',file:'assets/event_ai.jpg',alt:'AIイベントの参加者',width:1500,height:1125,subjectVerified:true},
    {id:'dinner_1',role:'community',file:'assets/dinner_1.jpg',alt:'会食の様子',width:2000,height:1500,subjectVerified:true},
    {id:'gym_nike',role:'sport',file:'assets/gym_nike.jpg',alt:'トレーニングを続ける姿',width:1500,height:2000,subjectVerified:true},
    {id:'media_catai',role:'brand',file:'assets/media_catai.jpg',alt:'メディア出演',width:1320,height:930,subjectVerified:true}
  ]},
  metadata:{provider:'demo',createdAt:'2026-10-16T00:00:00Z',inputName:'青山 遥'}
};

async function createBundle(brief=sample){const dir=await mkdtemp(path.join(tmpdir(),'ceo-site-render-'));await mkdir(path.join(dir,'assets'));for(const x of brief.visual?.assets||[])if(/^assets\/[\w.-]+$/.test(x.file))await writeFile(path.join(dir,x.file),Buffer.from([0xff,0xd8,0xff,0xd9]));await renderBundle(brief,dir);return dir}

test('提案書、JSON、5案×8ページの完全な静的バンドルを生成する', async()=>{
  const dir=await createBundle();
  const required=['brief.json','sources.json','proposal/index.html','proposal/style.css','proposal/proposal.js'];
  for(let id=1;id<=5;id++) for(const file of ['index.html','story.html','work.html','media.html','speaking.html','community.html','vision.html','contact.html','style.css','site.js']) required.push(`sites/0${id}/${file}`);
  for(const file of required) assert.ok((await stat(path.join(dir,file))).size>20,`${file} should exist`);
  const result=await renderBundle(sample,dir);
  assert.equal(result.sites.length,5);
  assert.equal(result.proposalUrl,'proposal/index.html');
  assert.deepEqual(Object.keys(result.sites[0]),['id','name','label','url']);
  const proposalJs=await readFile(path.join(dir,'proposal/proposal.js'),'utf8');
  assert.doesNotThrow(()=>new Function(proposalJs));
});

test('全サイトの共通ナビが実ページを参照し、未設定問い合わせは未送信と表示する',async()=>{
  const dir=await createBundle();
  const index=await readFile(path.join(dir,'sites/01/index.html'),'utf8');
  for(const file of ['story.html','work.html','media.html','speaking.html','community.html','vision.html','contact.html']) assert.match(index,new RegExp(`href="${file}"`));
  const contact=await readFile(path.join(dir,'sites/01/contact.html'),'utf8');
  assert.match(contact,/サンプル・未送信/);
  assert.doesNotMatch(contact,/送信しました|お問い合わせありがとうございます/);
  const story=await readFile(path.join(dir,'sites/01/story.html'),'utf8');
  const sourceHref=story.match(/href="([^\"]+#source-S1)"/)?.[1];
  assert.ok(sourceHref);
  assert.equal(path.resolve(path.join(dir,'sites/01'),sourceHref.split('#')[0]),path.join(dir,'proposal/index.html'));
  const media=await readFile(path.join(dir,'sites/01/media.html'),'utf8');
  const speaking=await readFile(path.join(dir,'sites/01/speaking.html'),'utf8');
  assert.match(media,/地域誌インタビュー/); assert.match(speaking,/公開セッション/);
});

test('全生成HTMLのローカルhrefとsrcが実在する',async()=>{
  const dir=await createBundle();
  const htmlFiles=['proposal/index.html'];
  for(let id=1;id<=5;id++) for(const file of ['index.html','story.html','work.html','media.html','speaking.html','community.html','vision.html','contact.html']) htmlFiles.push(`sites/0${id}/${file}`);
  const missing=[];
  for(const relative of htmlFiles){
    const html=await readFile(path.join(dir,relative),'utf8');
    for(const match of html.matchAll(/(?:href|src)="([^\"]+)"/g)){
      const target=match[1];
      if(!target||target.startsWith('#')||/^(?:https?:|data:|mailto:|tel:)/.test(target))continue;
      const filePath=path.resolve(path.dirname(path.join(dir,relative)),target.split(/[?#]/)[0]);
      try{assert.ok((await stat(filePath)).isFile())}catch{missing.push(`${relative} -> ${target}`)}
    }
  }
  assert.deepEqual(missing,[]);
});

test('提案書が5案ライブ比較、本人写真、事実確認、出典、成果非保証を備える',async()=>{
  const dir=await createBundle(); const html=await readFile(path.join(dir,'proposal/index.html'),'utf8');
  for(const id of ['top','concepts','facts','sources']) assert.match(html,new RegExp(`id="${id}"`));
  assert.equal((html.match(/data-preview=/g)||[]).length,5); assert.match(html,/<iframe/); assert.match(html,/assets\/gym_rapala.jpg/);
  assert.match(html,/成果を保証するものではありません/); assert.match(html,/本人提供メモ/); assert.match(html,/公開前の確認/);
  assert.match(html,/id="insight"/); assert.match(html,/正式な公開窓口/); assert.match(html,/proposal-lightbox/); assert.match(html,/本人確認済み/);
  assert.match(html,/<script src="proposal\.js" defer><\/script>/); assert.doesNotMatch(html,/<script>(?!\s*\{)/);
  assert.doesNotMatch(html,/KnowledgeWEB|60万円|30万円|水畑/);
});

test('入力値をHTMLエスケープし危険な連絡先URLをリンクにしない',async()=>{
  const malicious=structuredClone(sample); malicious.person.name='<img src=x onerror=alert(1)>'; malicious.person.introduction='<script>alert(1)</script>'; malicious.person.contactUrl='javascript:alert(1)';
  const dir=await createBundle(malicious); const home=await readFile(path.join(dir,'sites/01/index.html'),'utf8'); const contact=await readFile(path.join(dir,'sites/01/contact.html'),'utf8');
  assert.doesNotMatch(home,/<img src=x|<script>alert/); assert.match(home,/&lt;img/); assert.doesNotMatch(contact,/href="javascript:/); assert.match(contact,/サンプル・未送信/);
  assert.doesNotMatch(home,/<\/script><script>/);
});

test('全8ページにnoindex、説明、確認値だけのPerson JSON-LDを出力する',async()=>{
  const dir=await createBundle();
  for(const file of ['index.html','story.html','work.html','media.html','speaking.html','community.html','vision.html','contact.html']){
    const html=await readFile(path.join(dir,'sites/01',file),'utf8');
    assert.match(html,/<meta name="robots" content="noindex,nofollow">/);
    assert.match(html,/<meta name="description" content="[^"]+">/);
    const raw=html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
    assert.ok(raw,`${file} has JSON-LD`); const json=JSON.parse(raw);
    assert.equal(json['@type'],'Person'); assert.equal(json.name,'青山 遥'); assert.equal(json.jobTitle,'代表取締役'); assert.equal(json.worksFor.name,'架空デモ株式会社'); assert.equal(json.url,undefined);
  }
});

test('5案は配色だけでなくレイアウトとヒーロー表現が異なる',async()=>{
  const dir=await createBundle(); const css=[];
  for(let id=1;id<=5;id++) css.push(await readFile(path.join(dir,`sites/0${id}/style.css`),'utf8'));
  assert.equal(new Set(css).size,5);
  assert.match(css[2],/\.table-lead\{padding:48px/); assert.match(css[3],/\.run-word\{display:none/); assert.match(css[4],/\.motion-lead\{height:330px/);
  const homes=[]; for(let id=1;id<=5;id++) homes.push(await readFile(path.join(dir,`sites/0${id}/index.html`),'utf8'));
  assert.match(homes[0],/action/); assert.match(homes[1],/field-hero/); assert.match(homes[2],/mosaic/); assert.match(homes[3],/run-hero/); assert.match(homes[4],/triptych/);
  for(const html of homes){assert.ok((html.match(/<img /g)||[]).length>=1);assert.match(html,/site\.js/)}
});

test('素材パスのトラバーサルを拒否し、制作メモを公開本文から除外する',async()=>{
  const brief=structuredClone(sample);brief.visual.assets.push({id:'bad',file:'assets/../secret.jpg',alt:'bad'});brief.person.story[0].body='S01では編集上この資料に記載されている。';
  const dir=await createBundle(brief);const html=await readFile(path.join(dir,'sites/01/story.html'),'utf8');
  assert.doesNotMatch(html,/secret\.jpg|S01では|編集上|この資料に/);
});

test('本人確認のない画像を人物ヒーローへ流用しない',async()=>{
  const brief=structuredClone(sample);brief.visual.assets=brief.visual.assets.map(x=>({...x,subjectVerified:false}));
  const dir=await createBundle(brief);const home=await readFile(path.join(dir,'sites/01/index.html'),'utf8');
  assert.match(home,/hero-photo crop-face fallback/);assert.doesNotMatch(home,/hero-photo crop-face"><button/);
});

test('相対outDirを拒否する',async()=>{await assert.rejects(()=>renderBundle(sample,'relative-output'),/absolute path/)});
