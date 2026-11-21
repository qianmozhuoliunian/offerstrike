const {app,BrowserWindow,dialog,ipcMain,safeStorage,session,shell}=require('electron');
const {spawn}=require('node:child_process');
const net=require('node:net');
const {randomBytes}=require('node:crypto');
const {mkdir,readFile,writeFile,rename}=require('node:fs/promises');
const {mkdirSync}=require('node:fs');
const path=require('node:path');

// Keep the existing database and encrypted settings across the brand rename.
const legacyUserData=path.join(app.getPath('appData'),'OfferPilot');
mkdirSync(legacyUserData,{recursive:true});
app.setPath('userData',legacyUserData);
app.setName('OfferStrike');
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
async function launchBackend(token) {
  const env={...process.env};
  for(const key of [...keys,'RESEARCH_SERVICE_URL','RESEARCH_SERVICE_TOKEN','RESEARCH_COST_BUDGET','RESEARCH_LOG','NODE_OPTIONS']) delete env[key];
  Object.assign(env,config,{INTERVIEW_DATA_DIR:home(),INTERVIEW_DESKTOP_TOKEN:token});
  const listener=net.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  const root=path.join(__dirname,'..');
  const executable=app.isPackaged ? path.join(process.resourcesPath,'backend','OfferStrikeBackend.exe') : path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const args=[...(app.isPackaged?[]:['-u','-m','backend.run']),'--port',String(port)];
  const worker=spawn(executable,args,{env,cwd:app.isPackaged?process.resourcesPath:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child=worker;
  return new Promise((resolve,reject)=>{
    let ready=false;
    const timer=setTimeout(()=>{worker.kill();reject(Error('本机服务启动超时'));},20000);
    worker.once('error',()=>{clearTimeout(timer);reject(Error('无法启动 Python 服务，请检查运行环境或重新安装工作台'));});
    let output='';
    worker.stdout.on('data',chunk=>{
      output=(output+chunk.toString()).slice(-2048);
      const url=`http://127.0.0.1:${port}`;
      if(!output.includes(`OFFERSTRIKE_READY ${url}`) || ready) return;
      ready=true;clearTimeout(timer);resolve(url);
    });
    // Drain diagnostics without forwarding potentially private provider responses.
    worker.stderr.on('data',()=>{});
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
  window=new BrowserWindow({width:1320,height:900,minWidth:720,minHeight:600,title:'面试突击 · OfferStrike',icon:path.join(__dirname,'..','public','assets','offerstrike-icon.png'),
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
