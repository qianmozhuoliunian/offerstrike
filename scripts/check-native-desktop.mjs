import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const data = mkdtempSync(path.join(tmpdir(), 'offerstrike-desktop-'));
for (const phase of ['write', 'read', 'packaged']) {
  const code = await new Promise((resolve, reject) => {
    const process = spawn(require('electron'), ['scripts/check-native-desktop.cjs'], {
      env: { ...globalThis.process.env, OFFERSTRIKE_SMOKE_APPDATA: data, OFFERSTRIKE_SMOKE_PHASE: phase === 'packaged' ? 'read' : phase,
        OFFERSTRIKE_SMOKE_PACKAGED: phase === 'packaged' ? '1' : '0',
        AI_API_KEY: 'synthetic-inherited-must-not-pass', AI_MODEL: 'inherited-model' },
      stdio: 'inherit', windowsHide: true,
    });
    process.on('error', reject); process.on('exit', resolve);
  });
  if (code !== 0) { process.exitCode = code ?? 1; break; }
}
