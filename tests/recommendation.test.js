import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendFromHistory } from '../src/recommendation.js';

const now=new Date('2026-11-10T12:00:00.000Z');
const question=(text,role='产品') => ({role,text,sourceTitle:'来源甲',sourceUrl:'https://example.com/a'});
const attempt=(question,created,rating,role='产品',id='a') => ({question,created,rating,role,id});
const recommend=(candidates,attempts=[]) => recommendFromHistory({role:'产品',candidates,attempts,now});

test('prioritizes a due revisit and explains timing without guessing ability', () => {
  const result=recommend([question('题一'),question('题二')],[attempt('题一','2026-11-07T12:00:00Z','revisit')]);
  assert.equal(result.text,'题一');
  assert.equal(result.reason,'你标记为需要再练');
  assert.match(result.reasonDetails,/3 天前练习过/);
  assert.equal(result.practiceCount,1);
  assert.equal(result.selfAssessment,'revisit');
});

test('an unpracticed question is selected before a just-practiced revisit', () => {
  const result=recommend([question('题一'),question('题二')],[attempt('题一','2026-11-10T11:30:00Z','revisit')]);
  assert.equal(result.text,'题二');
  assert.equal(result.reason,'尚未练习');
  assert.match(result.reasonDetails,/不代表不会/);
  assert.equal(result.selfAssessment,'unassessed');
});

test('latest self-assessment wins and unassessed remains unknown', () => {
  const records=[attempt('题一','2026-11-01T12:00:00Z','revisit','产品','a'),attempt('题一','2026-11-08T12:00:00Z',null,'产品','b')];
  const result=recommend([question('题一')],records);
  assert.equal(result.practiceCount,2);
  assert.equal(result.reason,'练习后尚未自评');
  assert.equal(result.selfAssessment,'unassessed');
  assert.match(result.reasonDetails,/2 天前.*2 次/);
});

test('due items of the same kind prefer fewer prior practices, then the older one', () => {
  const candidates=[question('题一'),question('题二'),question('题三')];
  const records=[attempt('题一','2026-10-01','revisit','产品','1'),attempt('题一','2026-10-02','revisit','产品','2'),attempt('题二','2026-10-10','revisit','产品','3'),attempt('题三','2026-10-03','revisit','产品','4')];
  assert.equal(recommend(candidates,records).text,'题三');
});

test('keeps independent source traces and topics for the same exact question', () => {
  const candidates=[{...question('同一题'),sourceId:'a',sourceDate:'2026-08-01',sourceType:'真实面经（自述）',topic:'指标'},
    {...question('同一题'),sourceId:'b',sourceTitle:'来源乙',sourceUrl:'https://example.com/b',sourceType:'博主整理',topic:'分析'},
    {...question('同一题'),sourceId:'a',topic:'指标'}];
  const result=recommend(candidates);
  assert.deepEqual(result.sources.map(s=>s.title),['来源甲','来源乙']);
  assert.equal(result.sources[0].date,'2026-08-01');
  assert.deepEqual(result.topics,['指标','分析']);
  assert.equal(result.sourceUrl,'https://example.com/a');
});

test('separates roles and handles absent or invalid practice dates conservatively', () => {
  assert.equal(recommend([question('题一','运营')]),null);
  const result=recommend([question('题一')],[attempt('题一','not-a-date','revisit','产品'),attempt('题一','2026-01-01','comfortable','运营')]);
  assert.match(result.reasonDetails,/时间未知/);
  assert.equal(result.practiceCount,1);
  assert.equal(result.selfAssessment,'revisit');
  assert.equal(result.availability,'unknown');
});

test('a recently practiced only question is offered as an early repeat, not a new question', () => {
  const result=recommendFromHistory({role:'产品',candidates:[question('题一')],attempts:[attempt('题一','2026-11-10T11:30:00Z','revisit')],excludeText:'题一',now});
  assert.equal(result.text,'题一');
  assert.equal(result.availability,'early');
  assert.equal(result.sameAsCurrent,true);
  assert.match(result.reasonDetails,/建议间隔 1 天/);
});

test('a different eligible question is chosen before repeating the current one', () => {
  const candidates=[question('当前题'),question('另一题')];
  const records=[attempt('当前题','2026-11-01T12:00:00Z','revisit')];
  const result=recommendFromHistory({role:'产品',candidates,attempts:records,excludeText:'当前题',now});
  assert.equal(result.text,'另一题');
  assert.equal(result.availability,'new');
  assert.equal(result.sameAsCurrent,false);
});

test('when all candidates are early, the suggestion remains explicitly early', () => {
  const result=recommendFromHistory({role:'产品',candidates:[question('题一'),question('题二')],attempts:[attempt('题一','2026-11-10T11:00:00Z','comfortable','产品','1'),attempt('题二','2026-11-10T10:00:00Z','revisit','产品','2')],excludeText:'题一',now});
  assert.equal(result.text,'题一');
  assert.equal(result.availability,'early');
  assert.equal(result.sameAsCurrent,true);
});
