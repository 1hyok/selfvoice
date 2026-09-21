import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
if(!process.argv[2])throw new Error('가져올 원문 폴더를 인자로 지정해 주세요.');
const root=path.resolve(process.argv[2]);
const base='http://127.0.0.1:4317';
const health=await fetch(base+'/api/health').then(r=>r.json());
if(health.referencePolicy!==2)throw new Error('원문·참조 분리 서버가 필요합니다.');
const state=await fetch(base+'/api/state').then(r=>r.json());
const names=(await readdir(root)).filter(n=>(n.startsWith('지원서_')&&n.endsWith('.md'))||['자기소개서_아카이브.md','자소서_소재_App_Architecture.md'].includes(n));
const imported=[];
for(const name of names){
 const content=await readFile(path.join(root,name),'utf8');
 const digest=createHash('sha256').update(name+'\n'+content).digest('hex');
 const id='archive-'+digest.slice(0,32);
 if(state.sources.some(s=>s.id===id))continue;
 state.sources.push({id,title:name.replace(/\.md$/,''),origin:name,content,status:'archive',usage:'facts',facts:'',basis:'',style:'',example:'',verifiedAt:'',updatedAt:new Date().toISOString()});
 imported.push(id);
}
if(imported.length){
 const response=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
 if(!response.ok)throw new Error(await response.text());
}
const saved=await fetch(base+'/api/state').then(r=>r.json());
if(!imported.every(id=>saved.sources.some(s=>s.id===id&&s.status==='archive')))throw new Error('저장 결과 확인 실패');
console.log(JSON.stringify({added:imported.length,archives:saved.sources.length,references:saved.sources.filter(s=>s.status==='reference').length}));
