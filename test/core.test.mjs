import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,makeContext,makePrompt,validateState,verifyEvidence} from '../core.mjs';
test('선택한 경험만 전송하고 경험 전용 글에서 말투를 추출하지 않는다',()=>{
 const state=emptyState();state.sources=[{id:'a',title:'A',usage:'facts',status:'reference',content:'원문 A',facts:'확인된 사실 A'},{id:'b',title:'B',usage:'both',content:'비선택 개인 자료'}];
 const c=makeContext(state,{sourceIds:['a']});assert.equal(c.sources.length,1);assert.equal(c.sources[0].styleExample,undefined);assert.ok(!makePrompt('write',c).includes('비선택 개인 자료'));
});
test('다른 회사/문항과 다른 문서의 수정 기록은 적용되지 않으며 전후 원문을 재전송하지 않는다',()=>{
 const state=emptyState();const context={company:'A',role:'개발',question:'경험'};state.memories=[{id:'1',enabled:true,scope:'global',rule:'짧게 쓴다',before:'비공개 옛 경험',after:'비공개 새 경험'},{id:'2',enabled:true,scope:'draft',draftId:'d',context,rule:'A 전용'},{id:'3',enabled:false,scope:'global',rule:'꺼진 규칙'}];
 let c=makeContext(state,{draftId:'d',...context});assert.deepEqual(c.preferences.map(x=>x.rule),['짧게 쓴다','A 전용']);
 c=makeContext(state,{draftId:'d',...context,company:'B'});assert.deepEqual(c.preferences,[{rule:'짧게 쓴다'}]);assert.ok(!makePrompt('write',c).includes('비공개'));
});
test('근거가 실제 입력에 있을 때만 인용 일치를 표시한다',()=>{
 const out=verifyEvidence({evidence:[{sourceId:'a',quote:'개선',claim:'개선함'},{sourceId:'a',quote:'50%',claim:'50% 개선'},{sourceId:'fake',quote:'개선',claim:'개선함'}]},{sources:[{id:'a',facts:'문제를 개선했습니다.'}],additionalFacts:'',draft:''});assert.deepEqual(out.evidence.map(e=>e.verified),[true,false,false]);
});
test('백업의 중복 ID와 주입 가능한 ID를 거부한다',()=>{
 const s=emptyState();s.sources=[{id:'" onclick="',title:'x',content:'x',usage:'facts'}];assert.throws(()=>validateState(s));s.sources=[{id:'a',title:'x',content:'x',usage:'facts'},{id:'a',title:'x',content:'x',usage:'facts'}];assert.throws(()=>validateState(s));assert.equal(validateState(emptyState()).version,1);
});

import {styleEvidence,conversationContext,conversationResult} from '../core.mjs';
test('예문의 문장 길이 변화를 관찰하고 빈 예문은 생략한다',()=>{
 assert.equal(styleEvidence(''),undefined);
 const e=styleEvidence('짧다. 이유와 대조를 설명하는 문장은 길게 이어진다.');
 assert.equal(e.sentenceCount,2);assert.ok(e.max>e.min*3);
});
test('대화에서 사용자 발언만 근거로 인정하고 자동 저장하지 않는다',()=>{
 assert.throws(()=>conversationContext({origin:'codex',userCorrection:''}));
 const context=conversationContext({origin:'claude',userCorrection:'이번 문장만 나눠 줘.',assistantBefore:'모든 문장은 짧게'});
 const result={draft:'오염',facts:'오염',style:'모든 문장은 짧게',questions:[],evidence:[{sourceId:'assistant',quote:'모든 문장은 짧게',claim:'짧게'}]};
 assert.equal(conversationResult(result,context).style,'');
 result.evidence=[{sourceId:'user',quote:'없는 발언',claim:'짧게'}];assert.equal(conversationResult(result,context).style,'');
 result.style='이번 문장만 나눈다';result.evidence=[{sourceId:'user',quote:'이번 문장만',claim:'이번 글'}];
 const accepted=conversationResult(result,context);assert.equal(accepted.style,result.style);assert.equal(accepted.draft,'');
 const state=emptyState();state.memories=[{id:'m',rule:accepted.style,scope:'draft',enabled:true,draftId:'d',context:{company:'a',role:'b',question:'c'},provenance:{origin:'claude',userCorrection:context.userCorrection,quote:'이번 문장만'}}];
 validateState(state);assert.equal(makeContext(state,{draftId:'other'}).preferences.length,0);
 const prompt=makePrompt('write',makeContext(state,{draftId:'d',company:'a',role:'b',question:'c'}));assert.ok(!prompt.includes(context.userCorrection));
 state.memories[0].provenance.quote='AI 발언';assert.throws(()=>validateState(state));
});
