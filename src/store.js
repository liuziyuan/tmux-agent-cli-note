'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dir) {
    this.dir = dir;
    this.noteDir = path.join(dir, '.note');
    this.noteFile = path.join(this.noteDir, 'notes.json');
  }

  _ensureDir() {
    if (!fs.existsSync(this.noteDir)) {
      fs.mkdirSync(this.noteDir, { recursive: true });
    }
  }

  load() {
    try {
      const raw = fs.readFileSync(this.noteFile, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { directory: this.dir, notes: [] };
    }
  }

  save(data) {
    this._ensureDir();
    fs.writeFileSync(this.noteFile, JSON.stringify(data, null, 2), 'utf-8');
  }

  createNote(content = '') {
    const data = this.load();
    const note = {
      id: crypto.randomBytes(3).toString('hex'),
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sentAt: null,
    };
    data.notes.unshift(note);
    this.save(data);
    return note;
  }

  updateNote(id, content) {
    const data = this.load();
    const note = data.notes.find(n => n.id === id);
    if (note) {
      note.content = content;
      note.updatedAt = new Date().toISOString();
      this.save(data);
    }
    return note;
  }

  markSent(id) {
    const data = this.load();
    const note = data.notes.find(n => n.id === id);
    if (note) {
      note.sentAt = new Date().toISOString();
      this.save(data);
    }
    return note;
  }

  deleteNote(id) {
    const data = this.load();
    data.notes = data.notes.filter(n => n.id !== id);
    this.save(data);
  }

  getNote(id) {
    const data = this.load();
    return data.notes.find(n => n.id === id) || null;
  }

  listNotes() {
    const data = this.load();
    return data.notes.map(n => ({
      id: n.id,
      preview: n.content.replace(/\n/g, ' ').slice(0, 60),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      sentAt: n.sentAt,
    }));
  }

  hasNotes() {
    const data = this.load();
    return data.notes.length > 0;
  }
}

module.exports = Store;
