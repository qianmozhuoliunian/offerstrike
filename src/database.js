const SCHEMA_VERSION = 3;

export function migrateDatabase(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > SCHEMA_VERSION) throw Error('数据库版本高于当前程序，请使用更新版本打开');
  if (version === SCHEMA_VERSION) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL, question TEXT NOT NULL, role TEXT NOT NULL, created TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, feedback TEXT NOT NULL, role TEXT NOT NULL, created TEXT NOT NULL);`);
    initializeQuestions(db);
    initializeWorkspace(db);
    db.exec('PRAGMA user_version = '+SCHEMA_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function initializeQuestions(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created TEXT NOT NULL
  );`);
  if (!db.prepare('PRAGMA table_info(questions)').all().some(column => column.name === 'note')) {
    db.exec("ALTER TABLE questions ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS question_topics (
    kind TEXT NOT NULL, question_id TEXT NOT NULL, topic TEXT NOT NULL,
    PRIMARY KEY (kind, question_id)
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS question_evidence (
    question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
    evidence TEXT NOT NULL,
    confirmed_text TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE
  );`);
}

export function initializeWorkspace(db) {
  const sourceColumns = db.prepare('PRAGMA table_info(sources)').all().map(column => column.name);
  if (!sourceColumns.includes('interview_date')) db.exec("ALTER TABLE sources ADD COLUMN interview_date TEXT NOT NULL DEFAULT ''");
  const questionColumns = db.prepare('PRAGMA table_info(questions)').all().map(column => column.name);
  if (!questionColumns.includes('note')) db.exec("ALTER TABLE questions ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS job_profiles (role TEXT PRIMARY KEY, jd TEXT NOT NULL, confirmed_requirements TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS drafts (role TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS debriefs (id TEXT PRIMARY KEY, role TEXT NOT NULL, company TEXT NOT NULL, interview_date TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, notes TEXT NOT NULL, include_in_library INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempt_assessments (attempt_id TEXT PRIMARY KEY, rating TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempt_details (attempt_id TEXT PRIMARY KEY, follow_up TEXT NOT NULL DEFAULT '', parent_attempt_id TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS draft_contexts (role TEXT PRIMARY KEY, parent_attempt_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempt_question_links (attempt_id TEXT PRIMARY KEY, kind TEXT NOT NULL, question_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS draft_question_links (role TEXT PRIMARY KEY, kind TEXT NOT NULL, question_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dialogue_origins (attempt_id TEXT PRIMARY KEY, origin TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dialogue_summaries (attempt_id TEXT PRIMARY KEY, summary TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dialogue_coaching (attempt_id TEXT PRIMARY KEY, focus TEXT NOT NULL, evidence TEXT NOT NULL, next_step TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dialogue_requests (request_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempt_ability_evaluations (
      attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
      evaluation TEXT NOT NULL CHECK(json_valid(evaluation))
    );
    CREATE TABLE IF NOT EXISTS training_tasks (
      id TEXT PRIMARY KEY, role TEXT NOT NULL, request_id TEXT NOT NULL,
      topic TEXT NOT NULL, point TEXT NOT NULL, topics TEXT NOT NULL CHECK(json_valid(topics)),
      status TEXT NOT NULL CHECK(status IN ('proposed','searching','review','ready','completed','failed','cancelled')),
      reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, started_at INTEGER,
      result TEXT CHECK(result IS NULL OR json_valid(result)),
      candidate_id TEXT, question_id TEXT, attempt_id TEXT,
      UNIQUE(role,request_id)
    );
    CREATE INDEX IF NOT EXISTS training_tasks_role ON training_tasks(role,created_at);
    CREATE INDEX IF NOT EXISTS training_tasks_question ON training_tasks(role,question_id,status);`);
}
