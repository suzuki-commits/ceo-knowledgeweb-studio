import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateJobInput, fetchPublicText, extractPdf } from '../lib/input.mjs';
import { runPython } from '../lib/python-runtime.mjs';


test('job input enforces person and provider',()=>{
  assert.throws(()=>validateJobInput({provider:'codex'}),/personName|URL|PDF|text/);
  assert.throws(()=>validateJobInput({personName:'A',provider:'other'}),/provider/);
  assert.equal(validateJobInput({personName:' A ',provider:'codex'}).personName,'A');
  assert.equal(validateJobInput({personName:'',notes:'profile source',provider:'codex'}).personName,'');
});

test('job input keeps old payloads compatible and limits photo payloads',()=>{
  assert.deepEqual(validateJobInput({personName:'A',provider:'codex'}).photos,[]);
  assert.throws(()=>validateJobInput({personName:'A',photos:Array.from({length:6},()=>({name:'x.jpg',mime:'image/jpeg',role:'context',base64:''}))}),/5 photos/);
  assert.throws(()=>validateJobInput({personName:'A',photos:[{name:'x.jpg',mime:'image/jpeg',role:'logo',base64:''}]}),/role/);
  assert.throws(()=>validateJobInput({personName:'A',photos:[{name:'x.svg',mime:'image/svg+xml',role:'context',base64:''}]}),/MIME/);
});

test('URL fetch rejects loopback and private destinations before request',async()=>{
  await assert.rejects(fetchPublicText('http://127.0.0.1/private'),/Private|private|reserved/);
  await assert.rejects(fetchPublicText('http://[::1]/private'),/Private|private|reserved/);
  await assert.rejects(fetchPublicText('file:///etc/passwd'),/HTTP/);
});

test('URL fetch reads a real public HTTPS page when live network testing is enabled',{skip:process.env.LIVE_NETWORK_TEST!=='1'},async()=>{
  const page=await fetchPublicText('https://example.com/');
  assert.equal(page.url,'https://example.com/'); assert.match(page.text,/Example Domain/i);
});

test('PDF extractor reads text and rejects image-only-like blank PDFs',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'pdf-test-')); const good=path.join(dir,'good.pdf'),blank=path.join(dir,'blank.pdf');
  try{
    const script="from pypdf import PdfWriter\nimport sys\nfrom pypdf.generic import DecodedStreamObject,NameObject,DictionaryObject\nw=PdfWriter();w.add_blank_page(300,300);w.add_metadata({'/Title':'fixture'});w.write(sys.argv[2])\nw=PdfWriter();p=w.add_blank_page(300,300)\nfont=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})\np[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):w._add_object(font)})})\ns=DecodedStreamObject();s.set_data(b'BT /F1 12 Tf 20 250 Td (Verified sample PDF text for extraction) Tj ET');p[NameObject('/Contents')]=w._add_object(s)\nw.write(sys.argv[1])";
    await runPython(script,[good,blank]);
    const b64=(await readFile(good)).toString('base64'); assert.match(await extractPdf({name:'good.pdf',base64:b64}),/Verified sample/);
    await assert.rejects(extractPdf({name:'blank.pdf',base64:(await readFile(blank)).toString('base64')}),/OCR is not implemented/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('PDF extractor preserves Japanese UTF-8 text',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'pdf-ja-test-')),file=path.join(dir,'japanese.pdf');
  try{
    const script="from reportlab.pdfgen import canvas\nfrom reportlab.pdfbase import pdfmetrics\nfrom reportlab.pdfbase.cidfonts import UnicodeCIDFont\nimport sys\npdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))\nc=canvas.Canvas(sys.argv[1]);c.setFont('HeiseiKakuGo-W5',12);c.drawString(40,800,'青山遥の知識を対話と実践へつなぐ架空の活動プロフィールです');c.save()";
    await runPython(script,[file]);
    const text=await extractPdf({name:'japanese.pdf',base64:(await readFile(file)).toString('base64')});
    assert.match(text,/青山遥/); assert.match(text,/対話と実践/); assert.doesNotMatch(text,/�/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
