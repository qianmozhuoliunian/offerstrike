import {copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateResponseHeaders} from '../src/request-security.js';

const source = name => fileURLToPath(new URL(name,import.meta.url));
const dist = source('../dist');
const out = join(dist,'demo');
const withDownload = process.argv.includes('--desktop-download');

await mkdir(dist,{recursive:true});
if ((await lstat(dist)).isSymbolicLink()) throw Error('dist 不能是链接');

// Publish only generated content. Check an old tree before touching it.
async function checkTree(dir) {
  const info = await lstat(dir).catch(error=>{if(error.code!=='ENOENT') throw error;});
  if (!info) return false;
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('演示产物目录无效');
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    const path = join(dir,entry.name);
    if (entry.isSymbolicLink()) throw Error('演示产物目录不能包含链接');
    if (entry.isDirectory()) await checkTree(path);
  }
  return true;
}

const hadPrevious = await checkTree(out);
const stageRoot = await mkdtemp(join(dist,'.demo-build-'));
const stage = join(stageRoot,'next'), previous = join(stageRoot,'previous');
let previousMoved = false;
try {
  await mkdir(stage);
  for (const [from,to] of [
    ['../demo/demo.js','demo.js'],['../demo/demo.css','demo.css'],
    ['../src/recommendation.js','recommendation.js'],['../public/assets/interview-study-illustration.png','illustration.png']
  ]) await copyFile(source(from),join(stage,to));

  let html = await readFile(source('../demo/index.html'),'utf8');
  if (withDownload) {
    const installer = join(dist,'windows','OfferPilot-Setup.exe');
    const info = await lstat(installer).catch(()=>null);
    if (!info?.isFile() || info.isSymbolicLink()) throw Error('请先运行 npm run desktop:build 生成 Windows 安装包');
    await mkdir(join(stage,'desktop'));
    await copyFile(installer,join(stage,'desktop','OfferPilot-Setup.exe'));
    html = html.replace('<html lang="zh-CN">','<html lang="zh-CN" data-desktop-download>');
  }
  await writeFile(join(stage,'index.html'),html);
  const headers = Object.entries(privateResponseHeaders({demo:true})).map(([k,v])=>`  ${k}: ${v}`);
  await writeFile(join(stage,'_headers'),['/*',...headers,''].join('\n'));
  if (hadPrevious) {await rename(out,previous);previousMoved=true;}
  try { await rename(stage,out); }
  catch (error) {
    if (previousMoved) {await rename(previous,out);previousMoved=false;}
    throw error;
  }
  previousMoved=false;
} finally {
  if (!previousMoved) await rm(stageRoot,{recursive:true,force:true});
}
console.log('静态体验站：dist/demo/');
