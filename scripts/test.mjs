import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../',import.meta.url));
const tests = readdirSync(join(root,'tests'),{recursive:true})
  .filter(path => path.endsWith('.test.js')).sort().map(path => join(root,'tests',path));
if (!tests.length) throw Error('没有找到测试文件');
const result = spawnSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
