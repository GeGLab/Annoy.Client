import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Electron 45 installs its binary on demand. electron-vite reads path.txt
// directly, so prepare it before invoking the development/preview commands.
const require = createRequire(import.meta.url);
try {
  require.resolve('electron/package.json');
} catch {
  // Production-only installs do not include the desktop development toolchain.
  process.exit(0);
}
const result = spawnSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' });
if (result.error) console.error('Não foi possível preparar o Electron:', result.error.message);
if (result.error || result.status !== 0) {
  console.error('Verifique a conexão e tente novamente: npm run electron:install');
  process.exit(result.status || 1);
}
