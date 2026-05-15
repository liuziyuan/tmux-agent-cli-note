#!/usr/bin/env node
'use strict';

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { App } from '../src/app';
import { setHooksBound } from '../src/config';

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
  update         Update to latest version
  setup-hooks    Install Claude Code hooks for session tracking

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

if (args[0] === 'setup-hooks') {
  // Resolve hook script path
  let hookScript: string | null = null;
  for (const rel of ['../hooks/set-agent-session-id.sh', '../../hooks/set-agent-session-id.sh']) {
    const candidate = path.resolve(__dirname, rel);
    if (fs.existsSync(candidate)) {
      hookScript = candidate;
      break;
    }
  }
  if (!hookScript) {
    console.error('Hook script not found. Reinstall the package.');
    process.exit(1);
  }

  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    settings = {};
  }
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, unknown[]>;
  if (!hooks.UserPromptSubmit) hooks.UserPromptSubmit = [];

  const command = `${hookScript} UserPromptSubmit`;
  const alreadyInstalled = hooks.UserPromptSubmit.some((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    if (!Array.isArray(e.hooks)) return false;
    return e.hooks.some((h: unknown) => {
      if (typeof h !== 'object' || h === null) return false;
      return (h as Record<string, unknown>).command === command;
    });
  });

  if (alreadyInstalled) {
    console.log('Hooks already installed.');
    setHooksBound('claude', true);
    process.exit(0);
  }

  hooks.UserPromptSubmit.push({
    matcher: '',
    hooks: [{ type: 'command', command, async: true }],
  });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  setHooksBound('claude', true);
  console.log('Hooks installed. Session tracking enabled.');
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
