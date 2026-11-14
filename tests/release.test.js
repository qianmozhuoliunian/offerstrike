import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
test('release guard rejects staged secrets, forbidden data and secrets deleted from history without printing values', () => {
  const dir = mkdtempSync(join(tmpdir(),'offerpilot-release-'));
  const git = (...args) => execFileSync('git',args,{cwd:dir,stdio:'pipe'});
  const check = () => spawnSync(process.execPath,[join(root,'scripts/check-release.mjs')],{cwd:dir,encoding:'utf8'});
  try {
    git('init'); git('config','user.name','Release test'); git('config','user.email','test@example.invalid');
    writeFileSync(join(dir,'.gitignore'),'.env\n');
    writeFileSync(join(dir,'.env'),'PRIVATE_LOCAL_VALUE=not-for-publishing\n');
    writeFileSync(join(dir,'.env.example'),'AI_API_KEY=\n');
    writeFileSync(join(dir,'notes.md'),'Public test notes');
    git('add','.'); git('commit','-m','Public fixture');
    assert.equal(check().status,0);

    const fake = 'sk-' + 'x'.repeat(36);
    writeFileSync(join(dir,'notes.md'),fake);
    git('add','notes.md');
    writeFileSync(join(dir,'notes.md'),'Clean working file');
    const staged = check();
    assert.equal(staged.status,1);
    assert.match(staged.stderr,/index notes.md: provider key/);
    assert.ok(!staged.stderr.includes(fake));
    git('commit','-m','Synthetic secret fixture');
    git('add','notes.md'); git('commit','-m','Remove fixture secret');
    assert.match(check().stderr,/history notes.md .*provider key/);

    git('add','-f','.env');
    const sensitive = check();
    assert.equal(sensitive.status,1);
    assert.match(sensitive.stderr,/excluded file .env/);
    assert.ok(!sensitive.stderr.includes('PRIVATE_LOCAL_VALUE'));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('demo build only publishes explicit static assets and replaces stale files', () => {
  const dir = mkdtempSync(join(tmpdir(),'offerpilot-demo-'));
  try {
    const files = ['scripts/build-demo.mjs','src/request-security.js','src/recommendation.js',
      'demo/index.html','demo/demo.js','demo/demo.css','public/assets/interview-study-illustration.png'];
    for (const file of files) {
      mkdirSync(dirname(join(dir,file)),{recursive:true});
      copyFileSync(join(root,file),join(dir,file));
    }
    writeFileSync(join(dir,'package.json'),' {"type":"module"}');
    writeFileSync(join(dir,'.env'),'LOCAL_FIXTURE=must-not-be-copied');
    mkdirSync(join(dir,'dist/demo'),{recursive:true});
    writeFileSync(join(dir,'dist/demo/stale.json'),'old fixture');
    execFileSync(process.execPath,['scripts/build-demo.mjs'],{cwd:dir,stdio:'pipe'});
    assert.deepEqual(readdirSync(join(dir,'dist/demo')).sort(),
      ['_headers','demo.css','demo.js','illustration.png','index.html','recommendation.js'].sort());
    assert.match(readFileSync(join(dir,'dist/demo/_headers'),'utf8'),/connect-src 'none'/);
    assert.doesNotMatch(readFileSync(join(dir,'dist/demo/index.html'),'utf8'),/data-desktop-download/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
