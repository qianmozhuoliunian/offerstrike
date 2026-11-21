import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase } from '../../src/database.js';
import { listSources } from '../../src/questions.js';
import { exportData } from '../../src/workspace.js';
import { readFileSync } from 'node:fs';
import { importData } from '../../src/import-data.js';

const [mode, path] = process.argv.slice(2);
const db = new DatabaseSync(path);
try {
  migrateDatabase(db);
  if (mode === 'seed') {
    db.prepare('INSERT INTO settings VALUES (?,?)').run('role', '旧版岗位');
    db.prepare('INSERT INTO sources (id,title,url,date,type,question,role,created) VALUES (?,?,?,?,?,?,?,?)')
      .run('legacy-source', '兼容性合成样本', 'https://example.com/original', '', '博主整理', '搜索摘要，尚待核对', '旧版岗位', '2026-11-01T00:00:00.000Z');
    db.prepare('INSERT INTO questions (id,source_id,text,created,note) VALUES (?,?,?,?,?)')
      .run('legacy-question', 'legacy-source', '如何评估检索质量？', '2026-11-01T00:00:00.000Z', '旧版笔记');
    db.prepare('INSERT INTO question_topics VALUES (?,?,?)').run('source', 'legacy-question', 'RAG');
    db.prepare('INSERT INTO question_evidence VALUES (?,?,?,?)')
      .run('legacy-question', '面试官问：如何评估检索质量？', '如何评估检索质量？', 'test-evidence-request');
    db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?)')
      .run('legacy-attempt', '如何评估检索质量？', '兼容测试的合成回答', '旧版点评', '旧版岗位', '2026-11-01T00:00:00.000Z');
    db.prepare('INSERT INTO attempt_ability_evaluations VALUES (?,?)')
      .run('legacy-attempt', JSON.stringify({ topic: 'RAG', unverified: ['召回评估'] }));
  } else if (mode === 'import') {
    importData(db, JSON.parse(readFileSync(process.argv[4], 'utf8')), true);
    console.log(JSON.stringify(exportData(db)));
  } else if (mode === 'inspect') {
    console.log(JSON.stringify({ sources: listSources(db), backup: exportData(db) }));
  } else if (mode === 'schema') {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    console.log(JSON.stringify(Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`PRAGMA table_info(${name})`).all()]))));
  } else throw Error('Unknown compatibility check');
} finally {
  db.close();
}
