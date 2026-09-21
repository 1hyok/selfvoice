import http from 'node:http';
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {emptyState} from '../core.mjs';
test('저장/재조회/충돌/외부 origin 차단/백업 검증',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'selfvoice-test-'));const port=14319;const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),SELFVOICE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.once('exit',()=>reject(new Error('server stopped')));});const base=`http://127.0.0.1:${port}`;let s=await (await fetch(base+'/api/state')).json();assert.equal(s.revision,0);
 s.drafts.push({id:'test',title:'가상 테스트',content:'원문'});let r=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});assert.equal(r.status,200);
 r=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});assert.equal(r.status,409);
 r=await fetch(base+'/api/state',{headers:{Origin:'https://example.com'}});assert.equal(r.status,403);
 const bad={...emptyState(),revision:1,sources:[{id:'x',content:42}]};r=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(bad)});assert.equal(r.status,400);
 assert.equal(JSON.parse(await readFile(path.join(dir,'workspace.json'),'utf8')).drafts[0].content,'원문');
 r=await fetch(base+'/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'write',question:'경험'})});assert.equal(r.status,400);
 let current=await (await fetch(base+'/api/state')).json();current.sources.push({id:'archive',title:'보관글',content:'옛 주장',usage:'facts'});
 r=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(current)});assert.equal(r.status,200);
 r=await fetch(base+'/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'write',question:'경험',sourceIds:['archive'],additionalFacts:'이번 사실'})});assert.equal(r.status,400);assert.match((await r.json()).error,/미확인/);
 current=await (await fetch(base+'/api/state')).json();current.sources[0].content='원문 덮어쓰기';r=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(current)});assert.equal(r.status,400);
 current=await (await fetch(base+'/api/state')).json();current.corrections.push({id:'c1',wrong:'폐기한 주장',right:'확인한 사실',basis:'기록'});r=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(current)});assert.equal(r.status,200);
 r=await fetch(base+'/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'revise',draft:'폐기한 주장을 넣었다'})});assert.equal(r.status,400);assert.match((await r.json()).error,/정정된 표현/);
 current=await (await fetch(base+'/api/state')).json();
 current.sources.push({id:'unicode',title:'경계 검증',content:'한글 원문🙂',usage:'facts',status:'archive'});
 const payload=Buffer.from(JSON.stringify(current));const split=payload.indexOf(Buffer.from('한글 원문'))+1;
 const code=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(payload.subarray(0,split));setTimeout(()=>req.end(payload.subarray(split)),30);});
 assert.equal(code,200);current=await (await fetch(base+'/api/state')).json();assert.equal(current.sources.find(x=>x.id==='unicode').content,'한글 원문🙂');
 r=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(current)});assert.equal(r.status,200);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
});
