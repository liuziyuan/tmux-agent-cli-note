'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Note, NotePreview, NotesFile } from './types';

export class Store {
  public readonly dir: string;
  private readonly noteDir: string;
  private readonly noteFile: string;

  constructor(dir: string) {
    this.dir = dir;
    this.noteDir = path.join(dir, '.note');
    this.noteFile = path.join(this.noteDir, 'notes.json');
  }

  private _ensureDir(): void {
    if (!fs.existsSync(this.noteDir)) {
      fs.mkdirSync(this.noteDir, { recursive: true });
    }
  }

  private load(): NotesFile {
    this._ensureDir();
    try {
      const raw = fs.readFileSync(this.noteFile, 'utf8');
      return JSON.parse(raw) as NotesFile;
    } catch {
      return { directory: this.dir, notes: [] };
    }
  }

  private save(data: NotesFile): void {
    this._ensureDir();
    fs.writeFileSync(this.noteFile, JSON.stringify(data, null, 2), 'utf8');
  }

  createNote(content: string = ''): Note {
    const data = this.load();
    const note: Note = {
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

  updateNote(id: string, content: string): Note | null {
    const data = this.load();
    const note = data.notes.find(n => n.id === id);
    if (!note) return null;
    note.content = content;
    note.updatedAt = new Date().toISOString();
    this.save(data);
    return note;
  }

  markSent(id: string): Note | null {
    const data = this.load();
    const note = data.notes.find(n => n.id === id);
    if (!note) return null;
    note.sentAt = new Date().toISOString();
    this.save(data);
    return note;
  }

  deleteNote(id: string): void {
    const data = this.load();
    data.notes = data.notes.filter(n => n.id !== id);
    this.save(data);
  }

  getNote(id: string): Note | null {
    const data = this.load();
    return data.notes.find(n => n.id === id) ?? null;
  }

  listNotes(): NotePreview[] {
    const data = this.load();
    return data.notes.map(n => ({
      id: n.id,
      preview: n.content.split('\n')[0].slice(0, 60),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      sentAt: n.sentAt,
    }));
  }

  hasNotes(): boolean {
    return this.listNotes().length > 0;
  }
}

export default Store;
