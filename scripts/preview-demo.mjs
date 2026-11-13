import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

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
createServer(async (req,res) => {
  const file = files.get(req.url.split('?')[0]);
  if (!file || !['GET','HEAD'].includes(req.method)) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const contents = await readFile(new URL(file[0],dir));
    res.writeHead(200,{'content-type':file[1] + (file[1].startsWith('text/')?'; charset=utf-8':'')});
    res.end(req.method==='HEAD' ? undefined : contents);
  } catch {
    res.writeHead(500).end('Build the demo first');
  }
}).listen(port,'127.0.0.1',function() {
  console.log(`公开体验预览：http://127.0.0.1:${this.address().port}`);
});
