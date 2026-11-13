const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('offerPilotDesktop',{
  serviceStatus:()=>ipcRenderer.invoke('services:status'),
  saveServices:values=>ipcRenderer.invoke('services:save',values),
  restart:()=>ipcRenderer.invoke('services:restart'),
  onClose:handler=>ipcRenderer.once('lifecycle:flush',async()=>{
    try {await handler();} finally {ipcRenderer.send('lifecycle:flushed');}
  })
});
