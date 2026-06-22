#!/usr/bin/env node

import bcrypt from 'bcrypt';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiBaseUrl =
  process.env.TEST_API_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3007'}/api`;
const databaseUrl = process.env.DATABASE_URL;
const adminUsername = process.env.TEST_ADMIN_USERNAME ?? 'test_admin';
const adminPassword = process.env.TEST_ADMIN_PASSWORD ?? 'test_admin_password';
const adminDisplayName = process.env.TEST_ADMIN_DISPLAY_NAME ?? '测试管理员';
const adminDeckPath = resolveFromRoot(
  process.env.TEST_ADMIN_DECK_PATH ?? 'assets/decks/绿莲-6弹ver.yaml'
);
const deckDescriptionFallback =
  process.env.TEST_ADMIN_DECK_DESCRIPTION ?? '莲之空绿莲 6 弹新人推荐卡组';
const loginRetryCount = Number(process.env.TEST_ADMIN_LOGIN_RETRIES ?? '5');
const loginRetryDelayMs = Number(process.env.TEST_ADMIN_LOGIN_RETRY_DELAY_MS ?? '1000');
const requestRetryCount = Number(process.env.TEST_API_REQUEST_RETRIES ?? '5');
const requestRetryDelayMs = Number(process.env.TEST_API_REQUEST_RETRY_DELAY_MS ?? '1000');

function log(message) {
  console.log(`[test-env-seed] ${message}`);
}

function resolveFromRoot(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.join(rootDir, inputPath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableFetchError(error) {
  const code = error?.cause?.code ?? error?.code;
  return (
    error instanceof TypeError ||
    code === 'UND_ERR_SOCKET' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE'
  );
}

function assertEntry(entry, sectionName) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`${sectionName} contains a non-object entry`);
  }
  if (typeof entry.card_code !== 'string' || entry.card_code.length === 0) {
    throw new Error(`${sectionName} contains an entry without card_code`);
  }
  if (!Number.isInteger(entry.count) || entry.count <= 0) {
    throw new Error(`${sectionName} contains invalid count for ${entry.card_code}`);
  }
}

function assertEntryList(value, sectionName) {
  if (!Array.isArray(value)) {
    throw new Error(`${sectionName} must be an array`);
  }
  for (const entry of value) {
    assertEntry(entry, sectionName);
  }
}

async function readDeckConfig() {
  const deck = parseYaml(await readFile(adminDeckPath, 'utf8'));
  if (!deck || typeof deck !== 'object') {
    throw new Error(`Deck YAML is not an object: ${adminDeckPath}`);
  }

  assertEntryList(deck.main_deck?.members, 'main_deck.members');
  assertEntryList(deck.main_deck?.lives, 'main_deck.lives');
  assertEntryList(deck.energy_deck, 'energy_deck');

  return deck;
}

function toApiDeckPayload(deck) {
  const name = process.env.TEST_ADMIN_DECK_NAME ?? deck.player_name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Deck YAML must provide player_name or TEST_ADMIN_DECK_NAME must be set');
  }

  return {
    name,
    description:
      typeof deck.description === 'string' && deck.description.length > 0
        ? deck.description
        : deckDescriptionFallback,
    main_deck: [
      ...deck.main_deck.members.map((entry) => ({
        card_code: entry.card_code,
        count: entry.count,
        card_type: 'MEMBER',
      })),
      ...deck.main_deck.lives.map((entry) => ({
        card_code: entry.card_code,
        count: entry.count,
        card_type: 'LIVE',
      })),
    ],
    energy_deck: deck.energy_deck.map((entry) => ({
      card_code: entry.card_code,
      count: entry.count,
    })),
    is_public: true,
  };
}

async function requestJson(endpoint, options = {}) {
  const { allowedStatuses = [200], token, body, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let lastError;
  for (let attempt = 1; attempt <= requestRetryCount; attempt++) {
    try {
      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        ...fetchOptions,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: text };
        }
      }

      if (!allowedStatuses.includes(response.status)) {
        const message = payload?.error?.message ?? payload?.raw ?? text ?? response.statusText;
        throw new Error(
          `${fetchOptions.method ?? 'GET'} ${endpoint} failed: HTTP ${response.status} ${message}`
        );
      }

      return { status: response.status, payload };
    } catch (error) {
      lastError = error;
      if (!isRetriableFetchError(error) || attempt >= requestRetryCount) {
        throw error;
      }

      log(
        `${fetchOptions.method ?? 'GET'} ${endpoint} failed before response, retrying (${attempt}/${requestRetryCount})`
      );
      await sleep(requestRetryDelayMs);
    }
  }

  throw lastError;
}

async function registerAdminUser() {
  const { status } = await requestJson('/auth/register', {
    method: 'POST',
    allowedStatuses: [201, 409],
    body: {
      username: adminUsername,
      password: adminPassword,
      displayName: adminDisplayName,
    },
  });

  if (status === 201) {
    log(`registered admin user: ${adminUsername}`);
  } else {
    log(`admin user already exists: ${adminUsername}`);
  }
}

async function ensureAdminCredentials() {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to promote the test admin user');
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const { rows } = await client.query(
      `UPDATE users u
       SET password_hash = $2, email_verified = true
       FROM profiles p
       WHERE p.id = u.id AND p.username = $1
       RETURNING u.id`,
      [adminUsername, passwordHash]
    );

    if (rows.length === 0) {
      throw new Error(`Cannot find registered admin user: ${adminUsername}`);
    }

    await client.query(
      `UPDATE profiles
       SET role = 'admin', display_name = $2, updated_at = now()
       WHERE username = $1`,
      [adminUsername, adminDisplayName]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  log(`ensured admin role and password for: ${adminUsername}`);
}

async function loginAdmin() {
  let lastError;

  for (let attempt = 1; attempt <= loginRetryCount; attempt++) {
    try {
      const { payload } = await requestJson('/auth/login', {
        method: 'POST',
        body: {
          usernameOrEmail: adminUsername,
          password: adminPassword,
        },
      });

      const token = payload?.data?.accessToken;
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('Login response did not include an access token');
      }

      return token;
    } catch (error) {
      lastError = error;
      if (attempt >= loginRetryCount) {
        break;
      }

      log(`admin login failed, retrying (${attempt}/${loginRetryCount})`);
      await sleep(loginRetryDelayMs);
    }
  }

  throw lastError;
}

async function upsertAdminDeck(token, deckPayload) {
  const { payload: decksPayload } = await requestJson('/decks', { token });
  const existingDeck = decksPayload?.data?.find((deck) => deck.name === deckPayload.name);

  if (existingDeck) {
    await requestJson(`/decks/${existingDeck.id}`, {
      method: 'PUT',
      token,
      body: deckPayload,
    });
    log(`updated admin deck: ${deckPayload.name}`);
  } else {
    await requestJson('/decks', {
      method: 'POST',
      allowedStatuses: [201],
      token,
      body: deckPayload,
    });
    log(`created admin deck: ${deckPayload.name}`);
  }
}

async function main() {
  const deckConfig = await readDeckConfig();
  const deckPayload = toApiDeckPayload(deckConfig);

  await registerAdminUser();
  await ensureAdminCredentials();
  const token = await loginAdmin();
  await upsertAdminDeck(token, deckPayload);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
