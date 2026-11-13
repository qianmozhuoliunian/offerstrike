import {access,copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';

const path=name=>new URL(name,import.meta.url);
const out=path('../dist/demo/');
await mkdir(out,{recursive:true});
for(const [from,to] of [
  ['../demo/demo.js','demo.js'],['../demo/demo.css','demo.css'],
  ['../src/recommendation.js','recommendation.js'],['../public/assets/interview-study-illustration.png','illustration.png']
]) await copyFile(path(from),new URL(to,out));
const html=await readFile(path('../demo/index.html'),'utf8');
const withDownload=process.argv.includes('--desktop-download');
if(withDownload) await access(new URL('desktop/OfferPilot-Setup.exe',out)).catch(()=>{throw Error('请先把 Windows 安装包放在 dist/demo/desktop/OfferPilot-Setup.exe');});
await writeFile(new URL('index.html',out),withDownload?html.replace('<html lang="zh-CN">','<html lang="zh-CN" data-desktop-download>'):html);
console.log('静态体验站：dist/demo/');
