import {auditDraft} from './audit.mjs';
import http from 'node:http';
import {readFile,writeFile,mkdir,rename,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {emptyState,validateState,makeContext,makePrompt,outputSchema,verifyEvidence,text,prepareState,guardOutput,findCorrections,styleEvidence,conversationContext,conversationResult} from './core.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.SELFVOICE_DATA_DIR||path.join(root,'data');
const port=Number(process.env.PORT)||4317;
await mkdir(dataDir,{recursive:true,mode:0o700});
const file=path.join(dataDir,'workspace.json');
let state;try {state=validateState(JSON.parse(await readFile(file,'utf8')));} catch(e) {if(e.code!=='ENOENT') throw new Error('저장 파일을 읽을 수 없습니다. 원본을 보존하고 실행을 중단합니다.',{cause:e});state=emptyState();}
let writing=false,aiBusy=false;
async function save(next) {
  if(writing) throw new Error('다른 저장이 진행 중입니다. 다시 시도해 주세요.');
  writing=true;try {prepareState(next,state);const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(next,null,2),{mode:0o600});try{await copyFile(file,file+'.bak');}catch(e){if(e.code!=='ENOENT')throw e;}await rename(tmp,file);state=next;}finally{writing=false;}
}
function runAI(prompt) {
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.SELFVOICE_CLAUDE||'claude',['-p','--safe-mode','--tools','','--no-session-persistence','--model',process.env.SELFVOICE_MODEL||'opus','--effort','high','--output-format','json','--json-schema',JSON.stringify(outputSchema)],{cwd:dataDir,stdio:['pipe','pipe','pipe'],env:{...process.env,CLAUDECODE:undefined}});
  let out='',err='',finished=false;const finish=(e,v)=>{if(finished)return;finished=true;clearTimeout(timer);e?reject(e):resolve(v);};
  const timer=setTimeout(()=>{child.kill('SIGTERM');finish(new Error('AI 응답 시간이 초과됐습니다. 입력은 보존되어 있으니 다시 시도해 주세요.'));},240000);
  child.on('error',()=>finish(new Error('Claude Code를 실행할 수 없습니다. 설치와 로그인을 확인해 주세요.')));
  child.stdout.on('data',d=>{out+=d;if(out.length>1500000){child.kill();finish(new Error('AI 응답이 너무 큽니다.'));}});child.stderr.on('data',d=>{if(err.length<10000)err+=d;});
  child.on('close',code=>{if(finished)return;try{if(code!==0)throw new Error('AI 연결에 실패했습니다. Claude Code 로그인 또는 사용 한도를 확인해 주세요.');const envelope=JSON.parse(out);if(envelope.is_error)throw new Error('AI가 응답을 완료하지 못했습니다. 사용 한도와 연결 상태를 확인해 주세요.');let result=envelope.structured_output;if(!result){result=JSON.parse((envelope.result||'').replace(/^```json\s*|\s*```$/g,''));}for(const key of ['draft','facts','style'])if(typeof result[key]!=='string')throw new Error('AI 응답 형식이 올바르지 않습니다.');for(const key of ['questions','changes','evidence'])if(!Array.isArray(result[key]))throw new Error('AI 응답 형식이 올바르지 않습니다.');if(!result.questions.every(v=>typeof v==='string')||!result.changes.every(v=>typeof v==='string')||!result.evidence.every(e=>e&&['claim','sourceId','quote'].every(k=>typeof e[k]==='string')))throw new Error('AI 응답 형식이 올바르지 않습니다.');finish(null,result);}catch(e){finish(new Error(e.message||'AI 응답을 읽지 못했습니다.'));}});
  child.stdin.on('error',()=>{});child.stdin.end(prompt);
 });
}
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4500000){const e=new Error('입력이 너무 큽니다.');e.status=413;throw e;}chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('요청 형식이 올바르지 않습니다.');}}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
const server=http.createServer(async(req,res)=>{
 const host=req.headers.host;const allowed=`127.0.0.1:${port}`;
 if(host!==allowed&&host!==`localhost:${port}`){res.writeHead(403);return res.end('Forbidden');}
 if(req.headers.origin && ![`http://${allowed}`,`http://localhost:${port}`].includes(req.headers.origin)){res.writeHead(403);return res.end('Forbidden');}
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
 try{
  const url=new URL(req.url,`http://${allowed}`);
  if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{referencePolicy:2,busy:aiBusy});
  if(url.pathname==='/api/state'&&req.method==='GET')return json(res,200,state);
  if(url.pathname==='/api/state'&&req.method==='PUT') {if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'JSON 요청이 필요합니다.'});const next=await body(req);if(next.revision!==state.revision)return json(res,409,{error:'다른 창에서 자료가 변경됐습니다. 현재 글을 복사해 보관하고 새로고침해 주세요.'});next.revision=state.revision+1;await save(next);return json(res,200,{revision:state.revision});}
  if(url.pathname==='/api/ai'&&req.method==='POST'){
   if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'JSON 요청이 필요합니다.'});
   if(aiBusy)return json(res,409,{error:'AI가 다른 작업을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.'});
   const request=await body(req);if(!['analyze','write','revise','learn'].includes(request.mode))throw new Error('지원하지 않는 작업입니다.');
   if(request.mode==='learn'){const context=conversationContext(request);aiBusy=true;try{return json(res,200,conversationResult(await runAI(makePrompt('learn',context)),context));}finally{aiBusy=false;}}
   for(const key of ['sourceIds','styleSourceIds'])if(request[key]!==undefined&&(!Array.isArray(request[key])||!request[key].every(x=>typeof x==='string')))throw new Error('자료 목록이 올바르지 않습니다.');
   let context=makeContext(state,request);
   if(request.mode==='analyze'){if(!text(request.content).trim())throw new Error('분석할 글을 입력해 주세요.');context={...context,voices:[],preferences:[],draft:'',additionalFacts:'',question:'',company:'',role:'',instructions:'',sources:[{id:'input',title:'분석할 글',facts:text(request.content),styleExample:request.usage==='both'?text(request.content):undefined,styleEvidence:request.usage==='both'?styleEvidence(text(request.content)):undefined}]};}
   if(request.mode!=='analyze') {
    if((request.styleSourceIds||[]).some(id=>!context.voices.some(s=>s.id===id)))throw new Error('말투 자료가 미확인 또는 사용 중지 상태입니다. 다시 선택해 주세요.');
    const rejected=(request.sourceIds||[]).filter(id=>!context.sources.some(s=>s.id===id));
    if(rejected.length)throw new Error('선택한 자료에 미확인 또는 정정이 필요한 원문이 있습니다. 참조용 자료를 다시 선택해 주세요.');
    const hits=findCorrections(context.draft+' '+context.additionalFacts,state.corrections);
    if(hits.length)throw new Error('입력에 정정된 표현이 있습니다: '+hits.map(c=>c.wrong+' → '+c.right).join('; '));
   }
   if(request.mode==='write'&&(!context.question.trim()||(!context.sources.length&&!context.additionalFacts.trim())))throw new Error('문항과 참고 경험을 입력해 주세요.');
   if(request.mode==='revise'&&!context.draft.trim())throw new Error('다듬을 초안을 입력해 주세요.');
   aiBusy=true;try{const output=await runAI(makePrompt(request.mode,context));if(request.mode==='analyze')return json(res,200,verifyEvidence(output,context));const reviewed=await auditDraft(output,context,runAI);return json(res,200,verifyEvidence(guardOutput(reviewed,state.corrections),context));}finally{aiBusy=false;}
  }
  if(req.method==='GET'&&['/','/app.js','/style.css','/favicon.svg'].includes(url.pathname)){
   const name=url.pathname==='/'?'index.html':url.pathname.slice(1);const data=await readFile(path.join(root,'public',name));res.writeHead(200,{'Content-Type':({'html':'text/html','js':'text/javascript','css':'text/css','svg':'image/svg+xml'})[name.split('.').pop()]+'; charset=utf-8','Cache-Control':'no-cache'});return res.end(data);
  }
  json(res,404,{error:'페이지를 찾지 못했습니다.'});
 }catch(e){json(res,e.status||400,{error:e.message||'요청을 처리하지 못했습니다.'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Selfvoice ready: http://127.0.0.1:${port}`));
