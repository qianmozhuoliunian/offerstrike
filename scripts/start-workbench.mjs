import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) {
  console.error('请先创建 .venv 并安装 backend/requirements.txt，完整步骤见 README。');
  process.exitCode = 1;
} else {
  const child = spawn(python, ['-u', '-m', 'backend.run', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', () => { console.error('Python 服务启动失败'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}
