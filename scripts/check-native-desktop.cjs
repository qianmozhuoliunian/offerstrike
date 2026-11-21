// Exercise the production desktop bootstrap with isolated data and synthetic keys.
const { app, BrowserWindow } = require('electron');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const data = process.env.OFFERSTRIKE_SMOKE_APPDATA;
if (!data) throw Error('Isolated test directory required');
app.setPath('appData', data);
if (process.env.OFFERSTRIKE_SMOKE_PACKAGED === '1') {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: path.resolve(__dirname, '../dist/windows/win-unpacked/resources') });
}
app.on('browser-window-created', (_event, window) => {
  window.hide();
  window.webContents.on('preload-error', (_event, _file, error) => console.error('Preload:', error.message));
});
require('../desktop/main.cjs');
let window;
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function until(code) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if (await evaluate(`Boolean(${code})`)) return; } catch {}
    await pause();
  }
  throw Error(`Desktop condition timed out: ${code}`);
}
async function click(text) {
  await evaluate(`void [...document.querySelectorAll('button')].find(item=>item.getClientRects().length && item.textContent.trim()===${JSON.stringify(text)}).click()`);
}
async function fill(id, text) {
  await evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
(async()=>{
  await app.whenReady();
  for(let i=0;i<200;i++) { window=BrowserWindow.getAllWindows()[0]; if(window) break; await pause(); }
  if(!window) throw Error('Desktop window missing');
  await until("document.querySelector('#target-role') && window.offerPilotDesktop");
  const phase=process.env.OFFERSTRIKE_SMOKE_PHASE;
  const origin=await evaluate('location.origin');
  assert.equal((await fetch(origin)).status,401);
  if(phase==='write') {
    // Desktop must ignore inherited keys and the repository .env.
    assert.equal(await evaluate("(async()=>{const s=await(await fetch('/api/workspace')).json();return s.aiConfigured;})()"),false);
    await fill('target-role','Python 开发工程师'); await click('保存目标岗位');
    await until("document.body.textContent.includes('确认目标岗位')"); await click('确认目标岗位');
    await until("document.body.textContent.includes('目标岗位已保存')");
    await click('单题练习');
    await fill('practice-question','桌面隔离测试问题'); await fill('practice-answer','合成离线回答');
    await click('仅保存作答'); await until("document.querySelectorAll('.dialogue-turn').length===1");
    await click('开始新题');
    await fill('practice-question','关闭保存测试题'); await fill('practice-answer','关闭前尚未提交的草稿');
    await evaluate("window.offerPilotDesktop.saveServices({AI_API_KEY:'synthetic-desktop-only',AI_MODEL:'synthetic-model',AI_BASE_URL:'https://api.deepseek.com'})");
    const encrypted=readFileSync(path.join(data,'OfferPilot/workbench/services.enc'));
    assert.equal(encrypted.includes(Buffer.from('synthetic-desktop-only')),false);
  } else {
    const configured=await evaluate('window.offerPilotDesktop.serviceStatus()');
    assert.equal(configured.configured.AI_API_KEY,true);
    assert.equal(configured.AI_MODEL,'synthetic-model');
    await click('单题练习');
    await until("document.querySelector('#practice-answer')?.value==='关闭前尚未提交的草稿'");
    assert.equal(await evaluate("document.querySelector('.practice-history').textContent.includes('桌面隔离测试问题')"),true);
  }
  console.log(JSON.stringify({passed:true,desktop:process.env.OFFERSTRIKE_SMOKE_PACKAGED==='1'?'packaged backend':phase,checks:phase==='write'?['native Python startup','desktop authentication','environment isolation','offline save','encrypted service configuration','close flush']:['encrypted configuration restored','draft restored','history restored']}));
  window.close();
})().catch(async error=>{
  console.error(error.message);
  if(window && !window.isDestroyed()) console.error(await evaluate("JSON.stringify({origin:location.origin,desktop:typeof window.offerPilotDesktop,text:document.body?.textContent.slice(0,500)})").catch(()=>''));
  app.once('will-quit',()=>app.exit(1)); app.quit();
});
