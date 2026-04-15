'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Config, CursorStyle } from './types';

const CONFIG_FILENAME = '.note-config.json';

const DEFAULT_CONFIG: Config = {
  cursor: {
    insertStyle: 'after',
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

  return config;
}
