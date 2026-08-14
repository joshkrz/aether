import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from './createDatabase.ts';

const temporaryDirectories: string[] = [];

const createTemporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'aether-database-'));
  temporaryDirectories.push(directory);
  return join(directory, 'aether.sqlite');
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('createDatabase', () => {
  it('opens SQLite with the required safety and concurrency settings', () => {
    const database = createDatabase(createTemporaryDatabasePath());

    expect(database.client.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    });
    expect(database.client.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'wal',
    });
    expect(database.client.prepare('PRAGMA synchronous').get()).toEqual({
      synchronous: 1,
    });
    expect(database.client.prepare('PRAGMA busy_timeout').get()).toEqual({
      timeout: 5_000,
    });

    database.close();
    expect(database.client.isOpen).toBe(false);
  });
});
