'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config, CursorStyle, AgentHooks } from './types';

const CONFIG_FILENAME = '.note-config.json';

const DEFAULT_CONFIG: Config = {
  cursor: {
    insertStyle: 'after',
  },
  hooks: {
    claude: { bound: null },
  },
};

function isValidCursorStyle(value: unknown): value is CursorStyle {
  return value === 'on' || value === 'after';
}

export function loadConfig(): Config {
  const filePath = path.join(os.homedir(), CONFIG_FILENAME);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ...DEFAULT_CONFIG };
  }

  const config = { ...DEFAULT_CONFIG };
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.cursor === 'object' && obj.cursor !== null) {
    const cursor = obj.cursor as Record<string, unknown>;
    if (isValidCursorStyle(cursor.insertStyle)) {
      config.cursor.insertStyle = cursor.insertStyle;
    }
  }
  if (typeof obj.hooks === 'object' && obj.hooks !== null) {
    const hooks = obj.hooks as Record<string, unknown>;
    // Support legacy flat format: { hooks: { bound: true } }
    if ('bound' in hooks && !('claude' in hooks)) {
      config.hooks.claude.bound = (hooks.bound === true || hooks.bound === false) ? hooks.bound : null;
    } else if (typeof hooks.claude === 'object' && hooks.claude !== null) {
      const claude = hooks.claude as Record<string, unknown>;
      if (claude.bound === true || claude.bound === false || claude.bound === null) {
        config.hooks.claude.bound = claude.bound as boolean | null;
      }
    }
  }

  return config;
}

export function saveConfig(config: Config): void {
  const filePath = path.join(os.homedir(), CONFIG_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

export function isHooksBound(): boolean | null {
  return loadConfig().hooks.claude.bound;
}

export function setHooksBound(agent: string, value: boolean): void {
  const config = loadConfig();
  const entry = (config.hooks as Record<string, AgentHooks>)[agent];
  if (entry) {
    entry.bound = value;
  }
  saveConfig(config);
}
