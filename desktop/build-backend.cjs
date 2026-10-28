const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const result = spawnSync(process.env.GZW_PYTHON || 'python', [
  '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'gzw-map-server',
  '--distpath', path.join(root, 'build', 'backend'), '--workpath', path.join(root, 'build', 'pyinstaller'),
  '--specpath', path.join(root, 'build'), path.join(root, 'server.py'),
], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
