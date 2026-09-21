import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,makeContext} from '../core.mjs';
import {auditContext,auditDraft} from '../audit.mjs';

const ok=value=>({draft:'',facts:'',style:'',questions:[],changes:[],evidence:[],...value});
const FACTS='2024년 알림 지연을 줄였습니다.';
const USER_DRAFT='저는 알림 지연을 줄였습니다.';

function fixture() {
  const state=emptyState();
  state.sources=[{id:'a',title:'SECRET_TITLE',content:'SECRET_RAW',facts:FACTS,style:'SECRET_STYLE_RULES',example:'SECRET_STYLE_EXAMPLE',basis:'SECRET_BASIS',usage:'both',status:'reference',verifiedAt:new Date().toISOString()}];
  state.memories=[{id:'m',rule:'SECRET_PREFERENCE',enabled:true,scope:'global'}];
  state.corrections=[{id:'c1',wrong:'수상했습니다',right:'수상하지 않았습니다',basis:'본인 확인'},{id:'c2',wrong:'창업했습니다',right:'창업한 적이 없습니다',basis:'본인 확인'}];
  return makeContext(state,{question:'협업 경험을 쓰세요',limit:800,sourceIds:['a'],draft:USER_DRAFT,additionalFacts:'팀 4명과 진행했습니다.',company:'회사',role:'서버',instructions:'SECRET_INSTRUCTIONS'});
}
const candidate=()=>({draft:'저는 알림 지연을 줄였고 처음으로 수상했습니다. 그때 무척 뿌듯했습니다.',facts:'SECRET_CANDIDATE_FACTS',style:'SECRET_CANDIDATE_STYLE',questions:['제출 기한을 알려 주세요.'],changes:['문장을 다듬었습니다.'],evidence:[{claim:'수상',sourceId:'a',quote:'SECRET_CANDIDATE_QUOTE'}]});

test('검증 요청에는 승인된 사실만 담고 말투·선호·후보의 부가 정보를 보내지 않는다',async()=>{
  const context=fixture(),prompts=[];
  const runAI=async prompt=>{prompts.push(prompt);return ok({draft:USER_DRAFT,evidence:[{claim:'지연 감소',sourceId:'a',quote:'알림 지연을 줄였습니다'}]});};
  await auditDraft(candidate(),context,runAI);
  assert.equal(prompts.length,1);
  assert.doesNotMatch(prompts[0],/SECRET_/);
  assert.match(prompts[0],/알림 지연을 줄였습니다/);
  assert.match(prompts[0],/팀 4명과 진행했습니다/);
  const input=auditContext(context,candidate());
  assert.deepEqual(Object.keys(input).sort(),['additionalFacts','candidateDraft','corrections','draft','limit','question','sources'].sort());
  assert.deepEqual(input.sources,[{id:'a',facts:FACTS}]);
  assert.deepEqual(input.corrections.map(c=>c.wrong),['수상했습니다','창업했습니다']);
  assert.equal(input.limit,800);
});

test('후보 초안은 검증 대상일 뿐 근거가 아니고 사용자 원래 초안만 draft 출처가 된다',async()=>{
  const context=fixture();
  const input=auditContext(context,candidate());
  assert.equal(input.draft,USER_DRAFT);
  assert.notEqual(input.candidateDraft,input.draft);
  const grounded=await auditDraft(candidate(),context,async()=>ok({draft:USER_DRAFT,changes:['근거 없는 수상과 감정을 삭제했습니다.'],evidence:[{claim:'지연 감소',sourceId:'draft',quote:'알림 지연을 줄였습니다'}]}));
  assert.equal(grounded.factReview.status,'reviewed');
  const fromCandidate=await auditDraft(candidate(),context,async()=>ok({draft:'처음으로 수상했습니다.',evidence:[{claim:'수상',sourceId:'draft',quote:'처음으로 수상했습니다'}]}));
  assert.equal(fromCandidate.factReview.status,'blocked');
  assert.equal(fromCandidate.draft,'');
  assert.deepEqual(fromCandidate.evidence.map(e=>e.verified),[false]);
});

test('검증이 고친 초안이 후보를 대체하고 질문·변경 기록을 함께 남긴다',async()=>{
  const context=fixture();
  const corrected='저는 2024년 알림 지연을 줄였습니다. 팀 4명과 진행했습니다.';
  const result=await auditDraft(candidate(),context,async()=>ok({draft:corrected,questions:['수상 사실을 확인할 자료가 있나요?'],changes:['근거가 없는 수상과 감정 표현을 삭제했습니다.'],evidence:[{claim:'지연 감소',sourceId:'a',quote:'알림 지연을 줄였습니다'},{claim:'팀 규모',sourceId:'additional',quote:'팀 4명'}]}));
  assert.equal(result.draft,corrected);
  assert.equal(result.factReview.status,'reviewed');
  assert.equal(result.factReview.reason,'edited');
  assert.equal(result.factReview.draftChanged,true);
  assert.equal(result.factReview.verifiedClaims,2);
  assert.ok(result.questions.includes('제출 기한을 알려 주세요.'));
  assert.ok(result.questions.includes('수상 사실을 확인할 자료가 있나요?'));
  assert.ok(result.changes.includes('문장을 다듬었습니다.'));
  assert.ok(result.changes.includes('근거가 없는 수상과 감정 표현을 삭제했습니다.'));
  assert.equal(result.facts,'SECRET_CANDIDATE_FACTS');
  assert.ok(!/검증 완료|보증/.test(result.factReview.message));
  assert.deepEqual(['draft','facts','style','questions','changes','evidence','factReview'].filter(k=>!(k in result)),[]);
});

test('검증 호출이 실패하면 오류를 전달하고 검증하지 않은 후보를 돌려주지 않는다',async()=>{
  const context=fixture();
  await assert.rejects(()=>auditDraft(candidate(),context,async()=>{throw new Error('AI 연결에 실패했습니다.');}),/AI 연결에 실패했습니다/);
  await assert.rejects(()=>auditDraft(candidate(),context,async()=>({draft:'응답',facts:''})),/사실 검증 응답 형식/);
});

test('초안이 비어 있으면 AI를 부르지 않고 건너뛴 것으로 표시한다',async()=>{
  let calls=0;
  const result=await auditDraft({...candidate(),draft:'  '},fixture(),async()=>{calls++;return ok({});});
  assert.equal(calls,0);
  assert.equal(result.factReview.status,'skipped');
  assert.deepEqual(result.questions,['제출 기한을 알려 주세요.']);
  assert.equal(result.draft,'  ');
  assert.equal(result.draft.trim(),'');
});

test('근거가 없거나 인용이 원문과 다르면 초안을 차단하고 이유를 남긴다',async()=>{
  const context=fixture();
  const noEvidence=await auditDraft(candidate(),context,async()=>ok({draft:'저는 알림 지연을 줄였습니다.'}));
  assert.equal(noEvidence.draft,'');
  assert.equal(noEvidence.factReview.reason,'no-evidence');
  assert.ok(noEvidence.questions.some(q=>q.includes('원문 근거가 없어')));
  const badQuote=await auditDraft(candidate(),context,async()=>ok({draft:'저는 알림 지연을 30% 줄였습니다.',evidence:[{claim:'지연 감소',sourceId:'a',quote:'알림 지연을 줄였습니다'},{claim:'감소 폭',sourceId:'a',quote:'30% 줄였습니다'}]}));
  assert.equal(badQuote.draft,'');
  assert.equal(badQuote.factReview.status,'blocked');
  assert.equal(badQuote.factReview.reason,'invalid-evidence');
  assert.deepEqual(badQuote.evidence.map(e=>e.verified),[true,false]);
  assert.deepEqual(badQuote.factReview.invalidEvidence.map(e=>e.quote),['30% 줄였습니다']);
  assert.ok(badQuote.questions.some(q=>q.includes('30% 줄였습니다')));
});

test('근거가 있는 초안은 표현을 그대로 유지한다',async()=>{
  const context=fixture();
  const grounded={...candidate(),draft:'알림 지연, 그게 문제였습니다. 팀 4명과 함께 2024년에 지연을 줄였습니다.'};
  const result=await auditDraft(grounded,context,async()=>ok({draft:grounded.draft,evidence:[{claim:'지연 감소',sourceId:'a',quote:'알림 지연을 줄였습니다'},{claim:'팀 규모',sourceId:'additional',quote:'팀 4명'}]}));
  assert.equal(result.draft,grounded.draft);
  assert.equal(result.factReview.status,'reviewed');
  assert.equal(result.factReview.reason,'unchanged');
  assert.equal(result.factReview.draftChanged,false);
});
