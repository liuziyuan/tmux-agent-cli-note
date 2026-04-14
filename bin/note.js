#!/usr/bin/env node
'use strict';

if (!process.env.TMUX) {
  process.stderr.write('Error: note must be run inside tmux.\n');
  process.exit(1);
}

const path = require('path');
const App = require('../src/app');

const dir = process.cwd();
const app = new App(dir);
app.run();
