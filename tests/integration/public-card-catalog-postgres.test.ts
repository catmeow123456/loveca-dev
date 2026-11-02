import express from 'express';
import { Client } from 'pg';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/server/db/pool.js', () => ({ pool: { query: mocks.query } }));
import { cardsRouter } from '../../src/server/routes/cards.js';

// The connection only writes a temporary table, isolated from the application data.
describe.skipIf(process.env.RUN_LOCAL_POSTGRES !== '1')(
  'public catalog PostgreSQL projection',
  () => {
    const client = new Client({
      host: '127.0.0.1',
      port: 5432,
      database: 'loveca',
      user: 'loveca',
      password: 'loveca_dev',
      connectionTimeoutMillis: 5000,
    });
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
      await client.connect();
      await client.query(`CREATE TEMP TABLE cards (
      card_code text, card_type text, name_jp text, name_cn text,
      work_names text[], group_names text[], unit_name text, unit_name_raw text,
      cost integer, blade integer, hearts jsonb, blade_hearts jsonb, score integer,
      requirements jsonb, card_text_jp text, card_text_cn text, image_filename text,
      rare text, product text, product_code text, status text
    )`);
      await client.query(`INSERT INTO cards (card_code, card_type, hearts, requirements, status) VALUES
      ('json-null', 'ENERGY', 'null'::jsonb, 'null'::jsonb, 'PUBLISHED'),
      ('sql-null', 'ENERGY', NULL, NULL, 'PUBLISHED'),
      ('arrays', 'ENERGY', '[]'::jsonb, '[]'::jsonb, 'PUBLISHED'),
      ('draft', 'ENERGY', 'null'::jsonb, 'null'::jsonb, 'DRAFT')`);
      mocks.query.mockImplementation((sql: string) => client.query(sql));
      const app = express();
      app.use('/api/cards', cardsRouter);
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing server address');
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
      await client.end();
    });

    it('returns arrays for JSON null and SQL NULL without exposing drafts', async () => {
      const response = await fetch(`${baseUrl}/api/cards/published`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(
        body.data.cards.map(
          (card: { card_code: string; hearts: unknown; requirements: unknown }) => [
            card.card_code,
            card.hearts,
            card.requirements,
          ]
        )
      ).toEqual([
        ['arrays', [], []],
        ['json-null', [], []],
        ['sql-null', [], []],
      ]);
    });
  }
);
