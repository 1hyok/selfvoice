import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';

test('HTTP AI 경로의 자료·범위 분리, 사용자 근거 검증 및 자동 저장 금지',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'selfvoice-ai-'));
 const fake=path.join(dir,'fake-ai.mjs'),capture=path.join(dir,'prompt.json');
 await writeFile(fake,`#!${process.execPath}\nimport {writeFileSync} from 'node:fs';let input='';for await(const c of process.stdin)input+=c;writeFileSync(${JSON.stringify(capture)},input);console.log(JSON.stringify({structured_output:{draft:'검증 응답',facts:'',style:'검증 후보',questions:[],changes:[],evidence:[{sourceId:'assistant',quote:'AI 제안',claim:'사용자 선호'}]}}));`,{mode:0o700});
 const port=14331,base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,[path.resolve('server.mjs')],{env:{...process.env,PORT:String(port),SELFVOICE_DATA_DIR:dir,SELFVOICE_CLAUDE:fake},stdio:['ignore','pipe','pipe']});
 const call=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 try{
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('server exited');})]);
  const state=(await call('/api/state')).body;
  state.sources=[{id:'ok',title:'approved',content:'SECRET_RAW',facts:'검증된 행동',usage:'facts',status:'reference',basis:'확인',verifiedAt:new Date().toISOString(),example:'SECRET_EXAMPLE'},{id:'old',title:'archive',content:'SECRET_ARCHIVE',usage:'facts',status:'archive'}];
  state.memories=[{id:'m',rule:'LOCAL_RULE',enabled:true,scope:'draft',draftId:'d',context:{company:'a',role:'b',question:'q'},before:'SECRET_BEFORE',after:'SECRET_AFTER'}];
  const put=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});assert.equal(put.status,200);
  const req={mode:'write',draftId:'d',company:'other',role:'b',question:'q',sourceIds:['ok']};
  assert.equal((await call('/api/ai',req)).status,200);
  let prompt=await readFile(capture,'utf8');assert.doesNotMatch(prompt,/SECRET_|LOCAL_RULE/);
  assert.equal((await call('/api/ai',{...req,company:'a'})).status,200);prompt=await readFile(capture,'utf8');assert.match(prompt,/LOCAL_RULE/);assert.doesNotMatch(prompt,/SECRET_/);
  const before=(await call('/api/state')).body;
  const learned=await call('/api/ai',{mode:'learn',origin:'codex',userCorrection:'이 문장만 고쳐',assistantBefore:'AI 제안'});
  assert.equal(learned.status,200);assert.equal(learned.body.style,'');assert.equal(learned.body.draft,'');assert.deepEqual((await call('/api/state')).body,before);
  prompt=await readFile(capture,'utf8');assert.doesNotMatch(prompt,/검증된 행동|LOCAL_RULE|SECRET_/);
  for(const request of [{mode:'learn',origin:'codex',userCorrection:''},{mode:'learn',origin:'unknown',userCorrection:'문장 수정'}])assert.equal((await call('/api/ai',request)).status,400);
 }finally{const ended=once(child,'exit');child.kill();await ended;await rm(dir,{recursive:true,force:true});}
});
