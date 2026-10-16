import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrief } from '../lib/schema.mjs';
import { generateBrief, classifyCodexFailure } from '../lib/generator.mjs';

test('demo output is explicit, complete, and schema-valid', async()=>{
  const brief=await generateBrief({provider:'demo',personName:'ignored',company:'',title:''},[]);
  assert.equal(brief.person.name,'青山 遥'); assert.equal(brief.person.company,'架空デモ'); assert.equal(brief.concepts.length,5);
  assert.deepEqual(brief.concepts.map(x=>x.id),['01','02','03','04','05']); assert.match(brief.person.introduction,/架空デモ/); assert.doesNotThrow(()=>validateBrief(brief));
});

test('brief validator rejects a citation to a missing source', async()=>{
  const brief=await generateBrief({provider:'demo',personName:'ignored',company:'',title:''},[]); brief.facts=[{claim:'unsupported',sourceIds:['S99']}];
  assert.throws(()=>validateBrief(brief),/unknown source/);
});

test('Codex errors are classified without exposing raw diagnostics',()=>{
  assert.match(classifyCodexFailure('Error: failed to initialize in-process app-server client: Access is denied at C:\\secret',1),/runtime directory/);
  assert.match(classifyCodexFailure('error: unknown feature unified_exec',1),/safety flag/);
  assert.match(classifyCodexFailure('ERROR: 401 not logged in token=secret',1),/not authenticated/);
  assert.doesNotMatch(classifyCodexFailure('ERROR: 401 not logged in token=secret',1),/secret/);
  assert.match(classifyCodexFailure("prompt mentions JSON schema\nERROR: model 'x' is not supported when using Codex with a ChatGPT account",1),/model is unavailable/);
  assert.doesNotMatch(classifyCodexFailure('prompt says model unsupported\nERROR: unrelated failure',1),/model is unavailable/);
});
