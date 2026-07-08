import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const checkOnly = process.argv.includes('--check');
const electronDir = path.join(root, 'node_modules', 'electron');
const runtimeDir = path.join(root, '.hermes-runtime');
const electronCache = path.join(runtimeDir, 'electron-cache');

function platformPath() {
  if (process.platform === 'darwin') return 'Electron.app/Contents/MacOS/Electron';
  if (process.platform === 'win32') return 'electron.exe';
  return 'electron';
}

function electronPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return null;
  }
}

function electronArtifactName() {
  const version = electronPackageVersion();
  if (!version) return null;

  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  return `electron-v${version}-${platform}-${arch}.zip`;
}

function expectedChecksum(artifactName) {
  try {
    const checksums = JSON.parse(fs.readFileSync(path.join(electronDir, 'checksums.json'), 'utf8'));
    return checksums[artifactName] || null;
  } catch {
    return null;
  }
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function findCachedElectronZip() {
  const artifactName = electronArtifactName();
  if (!artifactName) return null;

  const expected = expectedChecksum(artifactName);
  const candidates = walkFiles(electronCache).filter((file) => path.basename(file) === artifactName);
  for (const candidate of candidates) {
    if (!expected || sha256(candidate) === expected) {
      return candidate;
    }
  }

  return null;
}

function commandExists(command) {
  const result = spawnSync('/bin/sh', ['-c', `command -v ${command}`], { stdio: 'ignore' });
  return result.status === 0;
}

function nativeExtract(zipPath) {
  const distDir = path.join(electronDir, 'dist');
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  let result;
  if (process.platform === 'darwin' && commandExists('ditto')) {
    result = spawnSync('ditto', ['-x', '-k', zipPath, distDir], { stdio: 'inherit' });
  } else if (commandExists('unzip')) {
    result = spawnSync('unzip', ['-q', zipPath, '-d', distDir], { stdio: 'inherit' });
  } else {
    return false;
  }

  if (result.status !== 0) return false;

  const exe = path.join(electronDir, 'dist', platformPath());
  if (fs.existsSync(exe)) {
    fs.chmodSync(exe, 0o755);
  }
  return true;
}

function writePathFile() {
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath());
}

function runtimeReady() {
  const exe = path.join(electronDir, 'dist', platformPath());
  if (!fs.existsSync(exe)) return false;

  const version = electronPackageVersion();
  if (version) {
    const versionFile = path.join(electronDir, 'dist', 'version');
    if (!fs.existsSync(versionFile)) return false;
    const distVersion = fs.readFileSync(versionFile, 'utf8').trim().replace(/^v/, '');
    if (distVersion !== version) return false;
  }

  if (process.platform === 'darwin') {
    const framework = path.join(
      electronDir,
      'dist',
      'Electron.app',
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Electron Framework',
    );
    const resources = path.join(electronDir, 'dist', 'Electron.app', 'Contents', 'Resources');
    if (!fs.existsSync(framework) || !fs.existsSync(resources)) return false;
  }

  return true;
}

function finish(message, code) {
  if (code === 0) {
    console.log(message);
    process.exit(0);
  }

  console.warn(message);
  process.exit(strict || checkOnly ? code : 0);
}

if (!fs.existsSync(electronDir)) {
  finish('Electron package is not installed yet.', 1);
}

if (runtimeReady()) {
  writePathFile();
  finish('Electron runtime is ready.', 0);
}

if (checkOnly) {
  finish('Electron runtime is incomplete.', 1);
}

console.log('Repairing Electron runtime...');
fs.rmSync(path.join(electronDir, 'path.txt'), { force: true });
fs.mkdirSync(electronCache, { recursive: true });

const electronMirror = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
const electronCacheDir = process.env.electron_config_cache || electronCache;
console.log(`Electron mirror: ${electronMirror}`);
console.log(`Electron cache: ${electronCacheDir}`);

const cachedZip = findCachedElectronZip();
if (cachedZip) {
  console.log(`Extracting cached Electron zip with native tool: ${cachedZip}`);
  if (nativeExtract(cachedZip) && runtimeReady()) {
    writePathFile();
    finish('Electron runtime repaired from cache.', 0);
  }
}

fs.rmSync(path.join(electronDir, 'dist'), { recursive: true, force: true });
const installScript = path.join(electronDir, 'install.js');
const result = spawnSync(process.execPath, [installScript], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_MIRROR: electronMirror,
    electron_config_cache: electronCacheDir,
    force_no_cache: process.env.force_no_cache || 'true',
  },
});

if (result.status !== 0) {
  finish('Electron runtime repair failed while downloading Electron.', 1);
}

if (runtimeReady()) {
  writePathFile();
  finish('Electron runtime repaired.', 0);
}

const downloadedZip = findCachedElectronZip();
if (downloadedZip) {
  console.log(`Electron installer extraction was incomplete; retrying with native tool: ${downloadedZip}`);
  if (nativeExtract(downloadedZip) && runtimeReady()) {
    writePathFile();
    finish('Electron runtime repaired with native extractor.', 0);
  }
}

finish('Electron runtime repair finished, but required macOS framework files are still missing.', 1);
