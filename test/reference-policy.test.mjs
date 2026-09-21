import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,validateState,makeContext,makePrompt,prepareState,guardOutput} from '../core.mjs';
const source=(overrides={})=>({id:'s1',title:'경험',content:'원문에만 있는 잘못된 주장',usage:'both',facts:'검증된 행동',style:'짧은 문장',example:'확인했습니다.',basis:'확인 기록',verifiedAt:'2026-09-21T00:00:00Z',status:'reference',...overrides});
test('기존 백업은 원문 보관 전용으로 읽고 원문과 연결된 선호도 전달하지 않는다',()=>{
 const s=emptyState();const old=source();delete old.status;s.sources=[old];s.memories=[{id:'m1',sourceId:'s1',enabled:true,scope:'global',rule:'원문을 흉내낸다'}];validateState(s);
 assert.equal(s.sources[0].status,'archive');const c=makeContext(s,{sourceIds:['s1']});assert.equal(c.sources.length,0);assert.equal(c.preferences.length,0);assert.ok(!makePrompt('write',c).includes(old.content));
});
test('승인된 정리본과 별도 예문만 AI에 전달한다',()=>{
 const s=emptyState();s.sources=[source()];validateState(s);const c=makeContext(s,{sourceIds:['s1']});assert.equal(c.sources[0].facts,'검증된 행동');assert.equal(c.sources[0].styleExample,'확인했습니다.');assert.ok(!JSON.stringify(c).includes(s.sources[0].content));
 s.sources[0].status='archive';assert.equal(makeContext(s,{sourceIds:['s1']}).sources.length,0);
});
test('근거와 확인일 없는 참조 승격을 거절한다',()=>{
 for(const field of ['basis','facts','verifiedAt']){const s=emptyState();s.sources=[source({[field]:''})];assert.throws(()=>validateState(s));}
});
test('정정 등록은 원문을 유지하고 오류가 있는 경험·말투를 참조 중지한다',()=>{
 const before=emptyState();before.sources=[source({example:'Room으로 캐시를 구현했다'})];
 const next=structuredClone(before);next.corrections=[{id:'c1',wrong:'Room으로 캐시를 구현했다',right:'Room을 사용하지 않았다',basis:'의존성 확인'}];prepareState(next,before);
 assert.equal(next.sources[0].status,'archive');assert.equal(next.sources[0].content,before.sources[0].content);assert.equal(makeContext(next,{sourceIds:['s1']}).sources.length,0);
 const edited=structuredClone(before);edited.sources[0].content='몰래 수정';assert.throws(()=>prepareState(edited,before));
});
test('정정된 문장을 추가한 AI 출력은 적용할 수 없고 대소문자·공백 우회를 막는다',()=>{
 const out=guardOutput({draft:'room 으로 캐시를 구현했다',questions:[],changes:[]},[{wrong:'Room으로 캐시를 구현했다',right:'사용하지 않음',basis:'코드'}]);assert.equal(out.draft,'');assert.ok(out.questions[0].includes('차단'));
});
test('저장한 자소서와 이력은 참조 자료로 자동 편입되지 않는다',()=>{
 const s=emptyState();s.drafts=[{id:'d1',title:'초안',content:'알려지지 않은 사실',history:[{content:'옛 오류',updatedAt:'2026-09-20'}]}];const c=makeContext(s,{});assert.equal(c.sources.length,0);assert.ok(!JSON.stringify(c).includes('옛 오류'));assert.ok(!JSON.stringify(c).includes('알려지지 않은 사실'));
});
