import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const result = spawnSync(python, ['-m', 'PyInstaller', '--noconfirm', '--onedir', '--name', 'OfferStrikeBackend',
  '--distpath', 'dist/python', '--workpath', 'dist/python-build', '--specpath', 'dist', '--paths', root,
  '--add-data', `${path.join(root,'backend/schema.sql')}:backend`, '--add-data', `${path.join(root,'dist/vue')}:dist/vue`,
  '--add-data', `${path.join(root,'src/research/skills')}:src/research/skills`, '--collect-data', 'certifi',
  '--hidden-import', 'uvicorn.logging', '--hidden-import', 'uvicorn.loops.auto',
  '--hidden-import', 'uvicorn.protocols.http.h11_impl', '--hidden-import', 'uvicorn.lifespan.on',
  'backend/desktop_entry.py'], { cwd: root, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const notices = spawnSync(python, ['-m', 'backend.bundle_licenses', 'dist/python/OfferStrikeBackend'], { cwd: root, stdio: 'inherit', windowsHide: true });
  process.exitCode = notices.status ?? 1;
}
