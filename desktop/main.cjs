const {app,BrowserWindow,dialog,ipcMain,safeStorage,session,shell,utilityProcess}=require('electron');
const {randomBytes}=require('node:crypto');
const {mkdir,readFile,writeFile,rename}=require('node:fs/promises');
const path=require('node:path');

app.setName('OfferPilot');
const keys=['TAVILY_API_KEY','EXA_API_KEY','AI_API_KEY','AI_MODEL','AI_BASE_URL'];
const secrets=keys.slice(0,3);
const home=()=>path.join(app.getPath('userData'),'workbench');
const configFile=()=>path.join(home(),'services.enc');
let window, child, address, config={}, settingsBusy=false, quitting=false, finishClose;

async function readConfig(){
  let encrypted;
  try {encrypted=await readFile(configFile());}
  catch (error) {if(error.code==='ENOENT') return {};throw error;}
  const decrypted=await safeStorage.decryptStringAsync(encrypted);
  return JSON.parse(decrypted.result);
}
function launchBackend(token) {
  const env={...process.env};
  for(const key of [...keys,'RESEARCH_SERVICE_URL','RESEARCH_SERVICE_TOKEN','RESEARCH_COST_BUDGET','RESEARCH_LOG','NODE_OPTIONS']) delete env[key];
  Object.assign(env,config,{INTERVIEW_DATA_DIR:home(),INTERVIEW_DESKTOP_TOKEN:token});
  const worker=utilityProcess.fork(path.join(__dirname,'..','server.js'),[],{env,stdio:'ignore'});
  child=worker;
  return new Promise((resolve,reject)=>{
    let ready=false;
    const timer=setTimeout(()=>{worker.kill();reject(Error('本机服务启动超时'));},12000);
    worker.once('message',({url})=>{
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) { clearTimeout(timer);worker.kill();reject(Error('本机服务未返回有效地址'));return; }
      ready=true;clearTimeout(timer);resolve(url);
    });
    worker.once('exit',()=>{
      clearTimeout(timer);
      if(child===worker) child=null;
      if(!ready) reject(Error('本机服务未能启动'));
      else if(window && !window.isDestroyed() && !quitting) {
        dialog.showErrorBox('工作台服务已退出','请关闭窗口后重新打开工作台。');
      }
    });
  });
}
function trust(event) {
  if (!window || !event.senderFrame || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin!==address) throw Error('设置请求来源无效');
}
function publicConfig(){
  return {configured:Object.fromEntries(secrets.map(key=>[key,!!config[key]])),
    AI_MODEL:config.AI_MODEL||'',AI_BASE_URL:config.AI_BASE_URL||''};
}
ipcMain.handle('services:status',event=>{trust(event);return publicConfig();});
ipcMain.handle('services:save',async(event,values)=>{
  trust(event);
  if(settingsBusy) throw Error('正在保存，请稍后');
  settingsBusy=true;
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw Error('系统密钥存储不可用，未保存');
    const next={...config};
    for (const key of keys) {
      if (!Object.hasOwn(values,key)) continue;
      const value=values[key];
      if(typeof value!=='string' || value.length>2048 || /[\x00-\x1f]/.test(value)) throw Error('设置格式无效');
      if(value.trim()) next[key]=value.trim(); else delete next[key];
    }
    if(next.AI_BASE_URL) next.AI_BASE_URL=(await import('../src/ai-transport.js')).validateAiBase(next.AI_BASE_URL);
    const file=configFile();
    await writeFile(file+'.tmp',await safeStorage.encryptStringAsync(JSON.stringify(next)));
    await rename(file+'.tmp',file);
    config=next;
    return publicConfig();
  } finally {settingsBusy=false;}
});
ipcMain.handle('services:restart',event=>{
  trust(event);
  app.relaunch();
  setImmediate(()=>window?.close());
});
ipcMain.on('lifecycle:flushed',event=>{
  try {trust(event);} catch {return;}
  finishClose?.();
});

async function start() {
  await mkdir(home(),{recursive:true});
  try {config=await readConfig();}
  catch {dialog.showErrorBox('服务设置无法读取','本地资料仍然保留。可以在设置中重新配置搜索和 AI 服务。');}
  const token=randomBytes(32).toString('hex');
  address=await launchBackend(token);
  const isolated=session.fromPartition('offerpilot-window');
  isolated.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  isolated.webRequest.onBeforeSendHeaders({urls:[address+'/*']},(details,callback)=>{
    callback({requestHeaders:{...details.requestHeaders,'X-Interview-Desktop':token}});
  });
  window=new BrowserWindow({width:1320,height:900,minWidth:720,minHeight:600,title:'见面 · 面试准备工作台',
    autoHideMenuBar:true,webPreferences:{session:isolated,preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true,sandbox:true,nodeIntegration:false,webviewTag:false}});
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==address) event.preventDefault();});
  window.webContents.on('will-redirect',(event,url)=>{if(new URL(url).origin!==address) event.preventDefault();});
  window.webContents.setWindowOpenHandler(({url})=>{
    try {
      const parsed=new URL(url);
      if (['https:','http:'].includes(parsed.protocol) && !parsed.username && !parsed.password &&
          !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) void shell.openExternal(parsed.href).catch(()=>{});
    } catch {}
    return {action:'deny'};
  });
  let closeReady=false;
  window.on('close',event=>{
    if(closeReady || !child) return;
    event.preventDefault();
    if(finishClose) return;
    const timeout=setTimeout(()=>finishClose?.(),1800);
    finishClose=()=>{
      clearTimeout(timeout);
      finishClose=undefined;
      closeReady=true;
      if(!window.isDestroyed()) window.close();
    };
    window.webContents.send('lifecycle:flush');
  });
  await window.loadURL(address);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized()) window.restore();window.focus();}});
  app.whenReady().then(start).catch(error=>{dialog.showErrorBox('无法打开工作台',error.message);app.quit();});
  app.on('window-all-closed',()=>app.quit());
  app.on('will-quit',()=>{quitting=true;child?.kill();});
}
