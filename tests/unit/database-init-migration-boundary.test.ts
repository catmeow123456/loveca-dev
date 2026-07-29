import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('database initialization and migration boundary', () => {
  it('does not precreate tables owned by non-idempotent incremental migrations', () => {
    const initSql = readFileSync('docker/init.sql', 'utf8');
    const initializedTables = new Set(
      [...initSql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?([a-z_]+)/gi)].map(
        (match) => match[1]
      )
    );
    const conflictingTables = readdirSync('drizzle')
      .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName) && !fileName.startsWith('0000_'))
      .flatMap((fileName) => {
        const migrationSql = readFileSync(`drizzle/${fileName}`, 'utf8');
        return [...migrationSql.matchAll(/CREATE TABLE\s+"([^"]+)"/g)]
          .map((match) => match[1])
          .filter((tableName) => initializedTables.has(tableName))
          .map((tableName) => `${fileName}:${tableName}`);
      });

    expect(conflictingTables).toEqual([]);
  });
});
