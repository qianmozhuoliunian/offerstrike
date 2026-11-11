import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeWorkspace, saveProfile, getProfile, saveDraft, getDraft, saveDebrief, setDebriefLibrary, setQuestionNote, exportData, setInterviewDate, setAssessment, recommendQuestion } from '../src/workspace.js';
import { importData } from '../src/import-data.js';
import { initializeQuestions, addQuestion, listSources } from '../src/questions.js';
import { validateSource, validateDate } from '../src/core.js';

function oldDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE sources (id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL,date TEXT NOT NULL,type TEXT NOT NULL,question TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE attempts (id TEXT PRIMARY KEY,question TEXT NOT NULL,answer TEXT NOT NULL,feedback TEXT NOT NULL,role TEXT NOT NULL,created TEXT NOT NULL);
    INSERT INTO sources VALUES ('s','来源','https://example.org','','来源未知','旧摘要','产品','2026-01-01');`);
  initializeQuestions(db);
  initializeWorkspace(db);
  return db;
}

test('old data and source questions survive repeat migration, with independent note and interview date', () => {
  const db=oldDatabase(); initializeWorkspace(db);
  const q=addQuestion(db,'s','题目');
  setQuestionNote(db,'s',q.id,'我的笔记');
  const item=listSources(db)[0];
  assert.equal(item.legacy_question,'旧摘要'); assert.equal(item.interview_date,'');
  assert.equal(item.questions[0].note,'我的笔记');
  assert.throws(() => setQuestionNote(db,'wrong',q.id,'a'), /不存在/);
  assert.equal(validateDate('2024-02-29'), '2024-02-29');
  assert.throws(() => validateDate('2025-02-29'), /日期/);
  assert.throws(() => validateSource({title:'x',url:'https://example.com',date:'2026-02-31'}), /日期/);
  assert.throws(() => validateSource({title:'x',url:'https://example.com',interview_date:'2026-13-01'}), /日期/);
  assert.equal(validateSource({title:'x',url:'https://example.com',date:'2026-02-01',interview_date:'2026-01-30'}).interview_date,'2026-01-30');
  setInterviewDate(db,'s','2026-01-15');
  assert.equal(listSources(db)[0].interview_date,'2026-01-15');
  assert.throws(() => setInterviewDate(db,'s','2026-02-30'), /日期/);
  assert.equal(listSources(db)[0].interview_date,'2026-01-15');
  setInterviewDate(db,'s',''); assert.equal(listSources(db)[0].interview_date,'');
  assert.throws(() => setInterviewDate(db,'missing',''), /来源不存在/);
  db.close();
});

test('profiles and drafts are isolated per role, and personal interview questions require confirmation', () => {
  const db=oldDatabase();
  saveProfile(db,'产品','私密 JD','确认要求'); saveProfile(db,'工程师','另一个 JD','要求二');
  assert.equal(getProfile(db,'产品').confirmed_requirements,'确认要求');
  saveDraft(db,'产品','问题一','回答一'); saveDraft(db,'工程师','问题二','回答二');
  assert.equal(getDraft(db,'产品').answer,'回答一');
  saveDraft(db,'产品','  原样保留','文本末尾 ');
  assert.equal(getDraft(db,'产品').answer,'文本末尾 ');
  const item=saveDebrief(db,{role:'产品',company:'公司',interview_date:'2026-01-02',question:'真实问题',answer:'回答',notes:'笔记',include_in_library:false});
  assert.equal(item.include_in_library,0);
  assert.equal(setDebriefLibrary(db,item.id,true).include_in_library,1);
  assert.throws(() => saveDebrief(db,{question:'题',interview_date:'2026-02-31'}), /日期/);
  db.close();
});

test('JSON export contains all attempts, notes and drafts without environment secrets', () => {
  const db=oldDatabase();
  const insert=db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)');
  for(let i=0;i<35;i++) insert.run(String(i),'题','答','评','产品',String(i));
  saveProfile(db,'产品','jd','要求'); saveDraft(db,'产品','题','草稿');
  const q=addQuestion(db,'s','题'); setQuestionNote(db,'s',q.id,'备注');
  process.env.AI_API_KEY='test-export-secret';
  db.prepare('INSERT INTO settings VALUES (?,?)').run('some_api_key','stored-secret');
  const data=exportData(db);
  assert.equal(data.attempts.length,35); assert.equal(data.drafts[0].answer,'草稿');
  assert.equal(data.sources[0].questions[0].note,'备注');
  assert.ok(!JSON.stringify(data).includes('test-export-secret'));
  assert.ok(!JSON.stringify(data).includes('stored-secret'));
  delete process.env.AI_API_KEY; db.close();
});

test('recommendations use explicit self-assessment and only the current role', () => {
  const db=oldDatabase();
  const first=addQuestion(db,'s','题一'); addQuestion(db,'s','题二');
  db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)').run('a','题一','回答','点评','产品','2026-01-01');
  db.prepare('INSERT INTO attempt_question_links VALUES (?,?,?)').run('a','source',first.id);
  assert.equal(recommendQuestion(db,'产品').text,'题二');
  setAssessment(db,'a','revisit');
  assert.equal(recommendQuestion(db,'产品').text,'题一');
  assert.equal(recommendQuestion(db,'产品').reason,'你标记为需要再练');
  assert.equal(recommendQuestion(db,'工程师'),null);
  setAssessment(db,'a','unassessed');
  assert.equal(recommendQuestion(db,'产品').text,'题二');
  assert.throws(()=>setAssessment(db,'a','mastered'),/无效/);
  db.close();
});

test('backup preview and merge preserve existing data and reject invalid input atomically', () => {
  const original=oldDatabase();
  saveProfile(original,'产品','JD','要求'); saveDraft(original,'产品','问题','草稿');
  const q=addQuestion(original,'s','题目'); setQuestionNote(original,'s',q.id,'笔记');
  original.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)').run('a','题目','回答','点评','产品','2026-01-01');
  original.prepare('INSERT INTO attempt_details VALUES (?,?,?)').run('a','继续追问？','');
  saveDraft(original,'产品','继续追问？','追问草稿','a');
  setAssessment(original,'a','revisit');
  const backup=exportData(original);
  const destination=oldDatabase();
  saveProfile(destination,'产品','已有 JD','已有要求');
  const before=exportData(destination);
  const preview=importData(destination,backup,false);
  assert.ok(preview.新增 > 0); assert.deepEqual(exportData(destination).profiles,before.profiles);
  assert.deepEqual(importData(destination,backup,true),preview);
  assert.equal(getProfile(destination,'产品').jd,'已有 JD');
  assert.equal(getDraft(destination,'产品').answer,'追问草稿');
  assert.equal(getDraft(destination,'产品').parent_attempt_id,'a');
  assert.equal(listSources(destination)[0].questions[0].note,'笔记');
  assert.equal(destination.prepare('SELECT rating FROM attempt_assessments WHERE attempt_id=?').get('a').rating,'revisit');
  assert.equal(importData(destination,backup,true).新增,0);
  const invalid=structuredClone(backup); invalid.debriefs=[{id:'bad',role:'产品',company:'',interview_date:'2026-02-31',question:'题',answer:'',notes:'',include_in_library:0,created:'now'}];
  const withoutTimestamp=data=>{const {exported_at,...rest}=data;return rest;};
  const beforeInvalid=withoutTimestamp(exportData(destination));
  assert.throws(()=>importData(destination,invalid,true),/日期/);
  assert.deepEqual(withoutTimestamp(exportData(destination)),beforeInvalid);
  original.close(); destination.close();
});

test('backups restore long source and review fields saved by older versions', () => {
  const original=oldDatabase();
  const title='标题'.repeat(600), role='岗位'.repeat(60);
  const question='问题'.repeat(5100), answer='回答'.repeat(15500);
  original.prepare('UPDATE sources SET title=?, role=? WHERE id=?').run(title,role,'s');
  original.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)').run('legacy',question,answer,'点评',role,'2026-01-01');
  const backup=exportData(original);
  const destination=oldDatabase();
  destination.prepare('DELETE FROM sources WHERE id=?').run('s');
  const preview=importData(destination,backup,false);
  assert.ok(preview.新增>0);
  assert.deepEqual(importData(destination,backup,true),preview);
  const restoredSource=listSources(destination).find(source=>source.id==='s');
  assert.equal(restoredSource.title,title);
  assert.equal(restoredSource.role,role);
  const restoredAttempt=destination.prepare('SELECT question,answer,role FROM attempts WHERE id=?').get('legacy');
  assert.equal(restoredAttempt.question,question);
  assert.equal(restoredAttempt.answer,answer);
  assert.equal(restoredAttempt.role,role);
  original.close(); destination.close();
});
