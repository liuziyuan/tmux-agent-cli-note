#!/usr/bin/env node
'use strict';

import * as path from 'path';
import { App } from '../src/app';

if (!process.env.TMUX) {
  process.stderr.write('Error: note must be run inside tmux.\n');
  process.exit(1);
}

const dir = process.cwd();
const app = new App(dir);
app.run();
