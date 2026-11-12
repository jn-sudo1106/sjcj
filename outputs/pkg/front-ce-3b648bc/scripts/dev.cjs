// npm run dev 可从仓库根目录或 app 执行。优先当前 Node；旧 Node 环境复用已安装的兼容运行时。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const app = path.resolve(__dirname, '../app');
// --backend <name> 是本项目自己的开关（npm run test 用它连 test 环境），不能透给 Vite；
// vite.config.ts 读 VITE_BACKEND_ENV 决定各代理默认目标。显式 VITE_API_PROXY_TARGET 仍优先。
const argv = process.argv.slice(2);
const backendEnv = (() => {
  const index = argv.findIndex(arg => arg === '--backend' || arg.startsWith('--backend='));
  if (index < 0) return '';
  const arg = argv[index];
  const value = arg.includes('=') ? arg.split('=')[1] : argv[index + 1];
  if (!value) {
    console.error('--backend 需要跟环境名：local（默认，本机 9999）或 test（test 环境 186）');
    process.exit(1);
  }
  argv.splice(index, arg.includes('=') ? 1 : 2);
  return value;
})();
const supported = version => {
  const [major, minor] = version.replace(/^v/, '').trim().split('.').map(Number);
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
};
const executable = process.platform === 'win32' ? 'node.exe' : 'node';
const candidates = [
  process.env.CE_NODE_EXECUTABLE,
  process.execPath,
  ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, executable)),
  // Codex 本机运行时是可选候选；其他机器使用正常安装的 Node 或 CE_NODE_EXECUTABLE。
  path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin', executable),
].filter(Boolean);
const node = [...new Set(candidates)].find(file => {
  if (!fs.existsSync(file)) return false;
  const result = spawnSync(file, ['--version'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 && supported(result.stdout);
});
if (!node) {
  console.error('启动需要 Node.js 20.19+、22.12+ 或 24。请升级 Node，或将 CE_NODE_EXECUTABLE 指向已安装的兼容 node 可执行文件。');
  process.exit(1);
}
const env = { ...process.env, PATH: path.dirname(node) + path.delimiter + process.env.PATH };
if (backendEnv) env.VITE_BACKEND_ENV = backendEnv;
const vite = path.join(app, 'node_modules/vite/bin/vite.js');
if (!fs.existsSync(vite)) {
  const npm = process.env.npm_execpath;
  if (!npm || !fs.existsSync(npm)) {
    console.error('依赖未安装，请先在 app 目录运行 npm ci。');
    process.exit(1);
  }
  console.log('首次启动：安装 app/package-lock.json 锁定的依赖…');
  const install = spawnSync(node, [npm, 'ci', '--no-audit', '--no-fund'], { cwd: app, env, stdio: 'inherit', windowsHide: true });
  if (install.status !== 0) process.exit(install.status || 1);
}
if (node !== process.execPath) console.log(`当前 Node ${process.version} 不满足要求，使用 ${node}`);
const child = spawn(node, [vite, ...argv], { cwd: app, env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
