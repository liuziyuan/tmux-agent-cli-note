#!/usr/bin/env node
'use strict';

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { App } from '../src/app';

// ── CLI 命令分发 ──
const args = process.argv.slice(2);

if (args[0] === '-v' || args[0] === '--version') {
  const pkgPath = path.join(__dirname, '../../package.json');
  const version: string = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  console.log(`v${version}`);
  process.exit(0);
}

if (args[0] === '-h' || args[0] === '--help') {
  console.log(`Usage: note [command]

Commands:
  update    Update to latest version

Options:
  -h, --help     Show help
  -v, --version  Show version`);
  process.exit(0);
}

if (args[0] === 'update') {
  const packageName = 'tmux-agent-cli-note';
  const pkgPath = path.join(__dirname, '../../package.json');
  const currentVersion: string = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;

  console.log(`Current version: v${currentVersion}`);

  let latestVersion: string;
  try {
    latestVersion = execSync(`npm view ${packageName} version`, { encoding: 'utf8' }).trim();
  } catch {
    console.error('Failed to check latest version. Please check your network connection.');
    process.exit(1);
  }

  if (currentVersion === latestVersion) {
    console.log('Already up to date.');
    process.exit(0);
  }

  console.log(`Updating to v${latestVersion}...`);
  try {
    execSync(`npm install -g ${packageName}@latest`, { stdio: 'inherit' });
  } catch {
    process.exit(1);
  }

  console.log(`Done. Updated to v${latestVersion}`);
  process.exit(0);
}

// ── 未知命令提示 ──
if (args.length > 0) {
  console.log(`Unknown command: ${args[0]}`);
  console.log('Use `note -h` for help.');
  process.exit(1);
}

// ── 正常启动（需要 tmux） ──
if (!process.env.TMUX) {
  process.stderr.write('Error: note must be run inside tmux.\n');
  process.exit(1);
}

const dir = process.cwd();
const app = new App(dir);
app.run();
