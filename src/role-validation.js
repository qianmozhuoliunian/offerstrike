// A role is a job or job direction, not an arbitrary search phrase. Local
// checks only reject malformed input; semantic uncertainty stays explicit.
export function validateRoleInput(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('请填写目标岗位，例如产品经理或前端开发');
  const role = value.trim();
  if (role.length > 100) throw Error('岗位名称不能超过 100 字');
  if (!/\p{L}/u.test(role)) throw Error('请输入职位或岗位方向，例如产品经理或前端开发');
  return role;
}

export function parseRoleJudgment(content) {
  let data;
  try { data = JSON.parse(content); } catch { throw Error('岗位判断结果不可用'); }
  if (!data || !['valid','invalid','uncertain'].includes(data.status)) throw Error('岗位判断结果不可用');
  return data.status;
}

// Validation is a cache for the currently selected role, not a replacement
// for historical data. Old backups omit it and are rechecked before search.
export function roleValidationStatus(db, role) {
  if (!role) return 'unset';
  try {
    const stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='role_validation'").get()?.value || 'null');
    if (stored?.role === role && ['valid','confirmed'].includes(stored.status)) return stored.status;
  } catch {}
  return 'unverified';
}

export function saveValidatedRole(db, role, status) {
  if (!['valid','confirmed'].includes(status)) throw Error('岗位尚未确认');
  db.exec('BEGIN');
  try {
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('role',?)").run(role);
    db.prepare("INSERT OR REPLACE INTO settings VALUES ('role_validation',?)").run(JSON.stringify({role,status}));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
