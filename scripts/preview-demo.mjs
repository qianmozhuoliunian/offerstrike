import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { isAllowedRequest, setPrivateResponseHeaders } from '../src/request-security.js';

const files = new Map([
  ['/', ['index.html','text/html']],
  ['/index.html', ['index.html','text/html']],
  ['/demo.css', ['demo.css','text/css']],
  ['/demo.js', ['demo.js','text/javascript']],
  ['/recommendation.js', ['recommendation.js','text/javascript']],
  ['/illustration.png', ['illustration.png','image/png']]
]);
const dir = new URL('../dist/demo/', import.meta.url);
const port = Number(process.env.DEMO_PORT || 8090);
const hasInstaller = (await readFile(new URL('index.html',dir),'utf8')).includes('data-desktop-download');
if (hasInstaller) files.set('/desktop/OfferPilot-Setup.exe',['desktop/OfferPilot-Setup.exe','application/octet-stream']);
const server = createServer(async (req,res) => {
  setPrivateResponseHeaders(res,{demo:true});
  if (!isAllowedRequest(req,server.address().port)) return res.writeHead(403).end('Forbidden');
  const file = files.get(req.url.split('?')[0]);
  if (!file || !['GET','HEAD'].includes(req.method)) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const path = new URL(file[0],dir);
    const info = await stat(path);
    res.writeHead(200,{'content-type':file[1] + (file[1].startsWith('text/')?'; charset=utf-8':''),'content-length':info.size});
    if (req.method==='HEAD') res.end();
    else await pipeline(createReadStream(path),res);
  } catch {
    if (!res.headersSent) res.writeHead(500).end('Build the demo first');
  }
});
server.listen(port,'127.0.0.1',function() {
  console.log(`公开体验预览：http://127.0.0.1:${this.address().port}`);
});
