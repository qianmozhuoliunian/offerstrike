// Exercise the built Vue application against a fresh, native FastAPI service.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'offerstrike-vue-'));
const outputDir = path.join(root, 'data', 'vue-fastapi-smoke');
let backend;
let window;
let exitCode = 0;

const pause = () => new Promise(resolve => setTimeout(resolve, 100));

async function availablePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function startBackend(port) {
  const python = process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
  backend = spawn(python, ['-u', '-m', 'backend.tests.ui_server', '--port', String(port), '--data-dir', dataDir], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('FastAPI startup timed out')), 15000);
    backend.on('error', reject);
    backend.on('exit', code => reject(Error(`FastAPI exited with ${code}`)));
    backend.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#access=[a-f0-9]{64}/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
  });
}

const evaluate = code => window.webContents.executeJavaScript(code, true);

async function until(code) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evaluate(code)) return;
    await pause();
  }
  throw Error(`UI condition timed out: ${code}`);
}

async function fill(id, value) {
  await evaluate(`(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    if (!input) throw Error('Input not found');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function click(text) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)} && item.getClientRects().length);
    if (!button || button.disabled) throw Error('Button unavailable');
    button.click();
  })()`);
}

async function run() {
  await app.whenReady();
  const port = await availablePort();
  const url = await startBackend(port);
  const errors = [];
  window = new BrowserWindow({ width: 1280, height: 900, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  window.webContents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`http://127.0.0.1:${port}/`) });
  });
  // The URL is printed before Uvicorn starts listening.
  for (let count = 0; count < 40; count++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch { await pause(); }
  }
  await window.loadURL(url);
  await until("document.querySelector('#target-role') !== null");
  await fill('target-role', 'AI Agent 开发实习');
  await click('保存目标岗位');
  await until("document.body.textContent.includes('确认目标岗位')");
  await click('确认目标岗位');
  await until("document.body.textContent.includes('目标岗位已保存')");
  await fill('jd', '设计检索增强生成应用，评估检索质量。');
  await fill('requirements', 'RAG 检索评估');
  await click('保存岗位要求');
  await until("document.body.textContent.includes('岗位要求已保存')");
  await until("document.querySelector('#jd')?.value.includes('评估检索质量') && !document.querySelector('#jd').disabled");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, 'job-desktop.png'), (await window.webContents.capturePage()).toPNG());
  await click('找面经');
  await fill('research-topic', '缓存');
  await fill('research-range', 'all');
  await evaluate("document.querySelector('.research-form input[type=checkbox]').click()");
  await click('搜索并提题');
  await until("document.querySelectorAll('.candidate-card').length === 1");
  assert.equal(await evaluate("document.querySelector('.candidate-card button').disabled"), true);
  await evaluate("document.querySelector('.candidate-card input[type=checkbox]').click()");
  await click('确认加入题库');
  await until("document.querySelector('.candidate-card').textContent.includes('已保存原文证据')");
  await evaluate("document.querySelector('.candidate-card').scrollIntoView({block:'center'})");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  writeFileSync(path.join(outputDir, 'research-desktop.png'), (await window.webContents.capturePage()).toPNG());
  await click('开始练习');
  await until("document.querySelector('#practice-question')?.value.includes('缓存淘汰策略')");
  await fill('practice-answer', '缓存用于减少重复读取数据库。');
  await click('提交并点评');
  await until("document.querySelectorAll('.dialogue-turn').length === 1");
  assert.equal(await evaluate("document.querySelector('.ability-evaluation').textContent.includes('本轮遗漏')"), true);
  await click('结束本题并总结');
  await until("document.querySelector('.dialogue-summary')?.textContent.includes('淘汰策略仍待验证')");
  await evaluate("document.querySelector('.dialogue-summary').scrollIntoView({block:'center'})");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  writeFileSync(path.join(outputDir, 'practice-desktop.png'), (await window.webContents.capturePage()).toPNG());
  await click('备战计划');
  await until("[...document.querySelectorAll('.career-task')].some(item => item.textContent.includes('本轮') || item.textContent.includes('遗漏'))");
  await evaluate("window.scrollTo(0,0)");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  writeFileSync(path.join(outputDir, 'career-desktop.png'), (await window.webContents.capturePage()).toPNG());
  await click('创建补题任务');
  await until("document.querySelector('.task-banner')?.textContent.includes('等待确认')");
  assert.equal(await evaluate("document.querySelector('#research-topic').disabled"), true);
  await click('取消补题任务');
  await until("document.querySelector('.task-banner')?.textContent.includes('此任务已取消')");
  await evaluate("window.scrollTo(0,0)");
  await evaluate("document.querySelector('nav button').click()");
  await click('＋ 添加来源');
  await fill('source-title', '界面验收合成来源 <img src=x onerror=alert(1)>');
  await fill('source-url', 'https://example.com/synthetic-interview');
  await fill('source-question', '如何评估 RAG 的检索质量？');
  await click('保存来源');
  await until("document.querySelectorAll('.question-card').length === 2");
  assert.equal(await evaluate("document.querySelector('.source-heading img') === null"), true);
  await click('编辑题目');
  const questionId = await evaluate("document.querySelector('.question-card textarea').id.slice('question-'.length)");
  await fill(`topic-${questionId}`, 'RAG 检索评估');
  await fill(`note-${questionId}`, '按查询构建标注集，分别衡量召回与排序效果。');
  await click('保存题目');
  await until("document.querySelector('.topic')?.textContent === 'RAG 检索评估'");
  await window.loadURL(`http://127.0.0.1:${port}/`);
  await until("document.querySelectorAll('.question-card').length === 2");
  await evaluate("document.querySelector('nav button').click()");
  assert.equal(await evaluate("location.hash"), '');
  await fill('library-search', 'RAG');
  assert.equal(await evaluate("document.querySelectorAll('.question-card').length"), 1);
  await fill('library-search', '无匹配关键词');
  await until("document.body.textContent.includes('没有找到匹配的资料')");
  await fill('library-search', '');
  await until("document.querySelectorAll('.question-card').length === 2");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  writeFileSync(path.join(outputDir, 'library-desktop.png'), (await window.webContents.capturePage()).toPNG());
  window.setContentSize(390, 844);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  writeFileSync(path.join(outputDir, 'library-mobile.png'), (await window.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  await evaluate("void (window.confirm = () => true)");
  await click('删除题目');
  await until("document.querySelectorAll('.question-card').length === 1");
  await click('删除来源');
  await until("document.querySelectorAll('.source-card').length === 1");
  await click('面试复盘');
  await fill('debrief-company', '界面验收合成公司');
  await fill('debrief-question', '面试中如何设计缓存淘汰策略？');
  await evaluate("document.querySelector('#debrief-title').parentElement.parentElement.parentElement.querySelector('input[type=checkbox]').click()");
  await click('保存复盘');
  await until("document.body.textContent.includes('面试复盘已保存')");
  await evaluate("document.querySelector('nav button').click()");
  await until("document.querySelector('.personal-library input') !== null");
  const personalId=await evaluate("document.querySelector('.personal-library input').id");
  await fill(personalId,'缓存'); await click('保存主题');
  await until("document.body.textContent.includes('复盘题主题已保存')");
  await click('面试复盘');
  await click('练习这道题');
  await until("document.querySelector('#practice-question')?.value.startsWith('面试中')");
  // Add one synthetic library question through the same public API used by the UI.
  await evaluate(`(async()=>{
    const headers={'content-type':'application/json','x-offerpilot-access':sessionStorage.getItem('offerstrike-vue-access')};
    await fetch('/api/sources',{method:'POST',headers,body:JSON.stringify({title:'模拟第三题合成来源',url:'https://example.com/mock',role:'AI Agent 开发实习',question:'系统中如何设计缓存淘汰策略？'})});
  })()`);
  await click('开始 3 题模拟');
  const mockQuestions = [];
  for(let index=1;index<=3;index++) {
    await until(`document.querySelector('.mock-controls')?.textContent.includes('第 ${index} / 3 题')`);
    mockQuestions.push(await evaluate("document.querySelector('#practice-question').value"));
    await fill('practice-answer','缓存用于减少重复读取数据库。');
    await click('提交并点评');
    await until("document.querySelectorAll('.dialogue-turn').length === 1");
    await click('结束本题并总结');
    await until("document.querySelector('.dialogue-summary') !== null");
    await click(index===3?'完成三题模拟':'进入下一题');
  }
  assert.equal(new Set(mockQuestions).size,3);
  await until("document.querySelector('.mock-controls')?.textContent.includes('三题模拟已完成')");
  await click('备战计划');
  await evaluate("document.querySelector('.resume-evidence').open=true");
  await fill('resume-text','我使用 Python 开发工具');
  assert.equal(await evaluate("document.querySelector('.resume-evidence button').disabled"),true);
  await evaluate("document.querySelector('.resume-evidence input[type=checkbox]').click()");
  await click('提取能力线索');
  await until("document.querySelector('.resume-evidence blockquote')?.textContent.includes('使用 Python 开发工具')");
  await click('设置与备份');
  await evaluate(`(async()=>{
    const access=sessionStorage.getItem('offerstrike-vue-access');
    const backup=await(await fetch('/api/export',{headers:{'x-offerpilot-access':access}})).json();
    const files=new DataTransfer(); files.items.add(new File([JSON.stringify(backup)],'synthetic-backup.json',{type:'application/json'}));
    const input=document.querySelector('input[type=file]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await until("document.body.textContent.includes('预计新增 0 项')");
  await click('确认合并备份');
  await until("document.body.textContent.includes('备份已合并')");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: [
    'role confirmation', 'profile save', 'source and question save', 'text escaping',
    'atomic question edit', 'refresh authentication', 'library filter', '390px overflow', 'browser console',
    'question deletion', 'source deletion',
    'research search and manual confirmation',
    'confirmed question practice', 'structured answer evidence', 'dialogue summary',
    'updated career recommendation', 'research task creation', 'research task cancellation',
    'personal debrief practice', 'three distinct mock questions and stop', 'resume consent and literal evidence', 'backup preview and merge',
  ], screenshots: outputDir }));
}

run().catch(error => {
  console.error(error.message);
  exitCode = 1;
}).finally(() => {
  if (window && !window.isDestroyed()) window.destroy();
  if (backend) backend.kill();
  app.exit(exitCode);
});
