import {execFileSync} from 'node:child_process';
import {lstatSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

// Read-only and deliberately narrow: this is a guardrail, not a privacy audit.
const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
  encoding:'utf8', maxBuffer:128 * 1024 * 1024, stdio:['pipe', 'pipe', 'pipe']
});
const failures = new Set();
const patterns = [
  ['provider key', /\b(?:sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}|tvly-[A-Za-z0-9_-]{20,})\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['local access link', /#access=[a-f0-9]{64}\b/i]
];

function checkPath(path, scope) {
  if (/(^|\/)(?:\.env(?:\..*)?|services\.enc.*|interview-data[^/]*\.json)$/i.test(path) && path !== '.env.example' ||
      /(^|\/)(?:data|node_modules|\.venv|dist|test-results|playwright-report)\//i.test(path) ||
      /\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$|\.(?:log|pem|key)$/i.test(path)) {
    failures.add(`${scope}: excluded file ${path}`);
  }
}
function checkContent(content, label) {
  if (content.includes('\0')) return; // Images and other binaries need manual review.
  for (const [name, pattern] of patterns) if (pattern.test(content)) failures.add(`${label}: ${name}`);
}

try {
  const root = git('rev-parse','--show-toplevel').trim();
  process.chdir(root);
  const paths = git('ls-files','-z','--cached','--others','--exclude-standard').split('\0').filter(Boolean);
  for (const path of new Set(paths)) {
    checkPath(path, 'working tree');
    let stat;
    try { stat = lstatSync(resolve(root,path)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) { failures.add(`working tree: review symbolic link ${path}`); continue; }
    if (stat.isFile()) checkContent(readFileSync(path,'utf8'),`working tree ${path}`);
  }
  // Include staged blobs: a clean working file must not hide a secret in the index.
  const index = git('ls-files','--stage','-z').split('\0').filter(Boolean);
  const blobs = new Map();
  for (const entry of index) {
    const [,hash,stage,path] = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry).slice(1);
    if (stage !== '0') failures.add(`index: unresolved conflict ${path}`);
    blobs.set(hash,`index ${path}`);
  }
  const shallow = git('rev-parse','--is-shallow-repository').trim() === 'true';
  if (shallow) failures.add('history: shallow clone; fetch full history before a release check');
  const objects = git('rev-list','--objects','--all').split('\n').filter(Boolean);
  for (const entry of objects) {
    const space = entry.indexOf(' ');
    if (space < 0) continue;
    const hash = entry.slice(0,space), path = entry.slice(space+1);
    checkPath(path, 'history');
    if (git('cat-file','-t',hash).trim() === 'blob') blobs.set(hash,`history ${path} (${hash.slice(0,8)})`);
  }
  for (const [hash,label] of blobs) checkContent(git('cat-file','blob',hash),label);
  checkContent(git('log','--all','--format=%B%n%an <%ae>%n%cn <%ce>'),'commit metadata');
  if (failures.size) {
    console.error('Release check failed (matching values are never printed):');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`Release check passed: ${new Set(paths).size} files and ${blobs.size} staged/history blobs.`);
    console.log('Manually review personal text, images and build artifacts before publishing.');
  }
} catch {
  console.error('Release check could not finish. Run inside a Git checkout with readable files and complete history.');
  process.exitCode = 1;
}
