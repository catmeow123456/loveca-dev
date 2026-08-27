#!/usr/bin/env node
/* global Headers, console, fetch */

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { hashCurrentPassword } from './lib/current-password-hash.mjs';

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
const shouldSeedAdminDeck = process.env.TEST_SEED_ADMIN_DECKS !== '0';
const shouldSeedRankedSeason = process.env.TEST_SEED_RANKED_SEASON !== '0';
const shouldSeedThemeSeason = process.env.TEST_SEED_THEME_SEASON !== '0';
const rankedSeasonKey = process.env.TEST_RANKED_SEASON_KEY ?? 'test-ranked-season';
const rankedSeasonName = process.env.TEST_RANKED_SEASON_NAME ?? '测试赛季';
const rankedSeasonTimeZone = process.env.TEST_RANKED_SEASON_TIME_ZONE ?? 'Asia/Shanghai';
const themeSeasonKey = process.env.TEST_THEME_SEASON_KEY ?? 'test-theme-season';
const themeSeasonName = process.env.TEST_THEME_SEASON_NAME ?? '测试主题赛季';
const themeSeasonTimeZone = process.env.TEST_THEME_SEASON_TIME_ZONE ?? 'Asia/Shanghai';
const themeDeckFixtures = [
  {
    path: resolveFromRoot('assets/decks/decklog-1Y9J3S.yaml'),
    deckKey: 'decklog-1y9j3s',
    decklogId: '1Y9J3S',
  },
  {
    path: resolveFromRoot('assets/decks/decklog-222H9S.yaml'),
    deckKey: 'decklog-222h9s',
    decklogId: '222H9S',
  },
  {
    path: resolveFromRoot('assets/decks/decklog-1YWYS4.yaml'),
    deckKey: 'decklog-1ywys4',
    decklogId: '1YWYS4',
  },
  {
    path: resolveFromRoot('assets/decks/decklog-N33A0.yaml'),
    deckKey: 'decklog-n33a0',
    decklogId: 'N33A0',
  },
];

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

async function readDeckConfig(deckPath = adminDeckPath) {
  const deck = parseYaml(await readFile(deckPath, 'utf8'));
  if (!deck || typeof deck !== 'object') {
    throw new Error(`Deck YAML is not an object: ${deckPath}`);
  }

  assertEntryList(deck.main_deck?.members, 'main_deck.members');
  assertEntryList(deck.main_deck?.lives, 'main_deck.lives');
  assertEntryList(deck.energy_deck, 'energy_deck');

  return deck;
}

function toApiDeckPayload(deck, options = {}) {
  const name = options.name ?? deck.player_name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Deck YAML must provide player_name or TEST_ADMIN_DECK_NAME must be set');
  }

  return {
    name,
    description:
      typeof deck.description === 'string' && deck.description.length > 0
        ? deck.description
        : (options.descriptionFallback ?? deckDescriptionFallback),
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
    const passwordHash = await hashCurrentPassword(adminPassword);
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
  let savedDeck;

  if (existingDeck) {
    const { payload } = await requestJson(`/decks/${existingDeck.id}`, {
      method: 'PUT',
      token,
      body: deckPayload,
    });
    savedDeck = payload?.data;
    log(`updated admin deck: ${deckPayload.name}`);
  } else {
    const { payload } = await requestJson('/decks', {
      method: 'POST',
      allowedStatuses: [201],
      token,
      body: deckPayload,
    });
    savedDeck = payload?.data;
    log(`created admin deck: ${deckPayload.name}`);
  }

  if (typeof savedDeck?.id !== 'string') {
    throw new Error(`Saved admin deck is missing an id: ${deckPayload.name}`);
  }
  return savedDeck;
}

function createRankedSeasonSchedule() {
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() - 1);
  const scheduledEndsAt = new Date(startsAt);
  scheduledEndsAt.setUTCFullYear(scheduledEndsAt.getUTCFullYear() + 1);
  const finalizingDeadlineAt = new Date(scheduledEndsAt);
  finalizingDeadlineAt.setUTCDate(finalizingDeadlineAt.getUTCDate() + 7);
  return { startsAt, scheduledEndsAt, finalizingDeadlineAt };
}

async function seedRankedSeason(token) {
  if (!shouldSeedRankedSeason) {
    log('skipping test ranked season seed');
    return;
  }

  const { payload: environmentPayload } = await requestJson('/admin/ranked/environment', { token });
  const algorithm = environmentPayload?.data?.algorithms?.find(
    (candidate) => candidate?.status === 'FORMAL'
  );
  if (!algorithm?.algorithmVersion || !algorithm?.config) {
    throw new Error('No formal ranked algorithm is available for the test season');
  }

  const { payload: seasonsPayload } = await requestJson('/admin/ranked/seasons', { token });
  let season = seasonsPayload?.data?.find((candidate) => candidate?.seasonKey === rankedSeasonKey);
  if (!season) {
    const { startsAt, scheduledEndsAt, finalizingDeadlineAt } = createRankedSeasonSchedule();
    const { payload } = await requestJson('/admin/ranked/seasons', {
      method: 'POST',
      allowedStatuses: [201],
      token,
      body: {
        seasonKey: rankedSeasonKey,
        name: rankedSeasonName,
        platformTimeZone: rankedSeasonTimeZone,
        openWindows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 1440 }],
        startsAt: startsAt.toISOString(),
        scheduledEndsAt: scheduledEndsAt.toISOString(),
        finalizingDeadlineAt: finalizingDeadlineAt.toISOString(),
        ratingAlgorithmVersion: algorithm.algorithmVersion,
        softReset: {
          mode: algorithm.config.softResetMode,
          center: algorithm.config.softResetCenter,
          retention: algorithm.config.softResetRetention,
          minimumDeviation: algorithm.config.softResetMinimumDeviation,
        },
        leaderboardMinimumMatchCount: algorithm.config.placementMatchCount,
      },
    });
    season = payload?.data;
    log(`created test ranked season: ${rankedSeasonKey}`);
  }

  if (!season?.id) {
    throw new Error(`Test ranked season response is missing an id: ${rankedSeasonKey}`);
  }
  if (season.lifecycle === 'DRAFT') {
    const { payload } = await requestJson(`/admin/ranked/seasons/${season.id}/activate`, {
      method: 'POST',
      token,
    });
    season = payload?.data;
    log(`activated test ranked season: ${rankedSeasonKey}`);
  }
  if (season?.lifecycle !== 'ACTIVE') {
    throw new Error(`Test ranked season is not active: ${rankedSeasonKey}`);
  }
  if (season.queueAdmission !== 'OPEN') {
    await requestJson(`/admin/ranked/seasons/${season.id}/admission`, {
      method: 'PUT',
      token,
      body: { admission: 'OPEN' },
    });
    log(`opened test ranked season matchmaking: ${rankedSeasonKey}`);
  }
}

function createThemeSeasonPayload() {
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() - 1);
  const endsAt = new Date(startsAt);
  endsAt.setUTCFullYear(endsAt.getUTCFullYear() + 1);
  return {
    versionKey: themeSeasonKey,
    name: themeSeasonName,
    platformTimeZone: themeSeasonTimeZone,
    openWindows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 1440 }],
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    scheduleLabel: '每天全天开放（测试环境）',
    summary: '使用四副 DeckLog 示例预组进行主题对战。',
    announcement: '本主题季使用平台提供的示例预组，记录本期胜负，不计入赛季排位。',
    deckChoiceCount: 3,
    evaluationPolicy: {
      minimumCompletedMatchesPerPair: 20,
      minimumCompletionRate: 0.8,
      maximumExceptionRate: 0.05,
      maximumExposureDeviation: 0.1,
      maximumMedianWaitSeconds: 180,
      winRateLowerBound: 0.35,
      winRateUpperBound: 0.65,
      baselineWindowLabel: '测试环境初始化基线',
    },
  };
}

async function seedThemeSeason(token) {
  if (!shouldSeedThemeSeason) {
    log('skipping test theme season seed');
    return;
  }

  const sourceDecks = [];
  for (const fixture of themeDeckFixtures) {
    const deckConfig = await readDeckConfig(fixture.path);
    const savedDeck = await upsertAdminDeck(
      token,
      toApiDeckPayload(deckConfig, {
        descriptionFallback: `DeckLog ${fixture.decklogId} 测试主题预组`,
      })
    );
    sourceDecks.push({ fixture, deckConfig, savedDeck });
  }

  const draftPayload = createThemeSeasonPayload();
  const { payload: eventsPayload } = await requestJson('/admin/theme-table/events', { token });
  let theme = eventsPayload?.data?.find((candidate) => candidate?.versionKey === themeSeasonKey);
  if (!theme) {
    const { payload } = await requestJson('/admin/theme-table/events', {
      method: 'POST',
      allowedStatuses: [201],
      token,
      body: draftPayload,
    });
    theme = payload?.data;
    log(`created test theme season: ${themeSeasonKey}`);
  } else if (theme.lifecycle === 'DRAFT') {
    const { payload } = await requestJson(`/admin/theme-table/events/${theme.id}/draft`, {
      method: 'PUT',
      token,
      body: draftPayload,
    });
    theme = payload?.data;
    log(`updated test theme season draft: ${themeSeasonKey}`);
  }

  if (!theme?.id) {
    throw new Error(`Test theme season response is missing an id: ${themeSeasonKey}`);
  }
  if (theme.lifecycle === 'CLOSED') {
    throw new Error(
      `Test theme season is closed; reset test data or choose a new TEST_THEME_SEASON_KEY: ${themeSeasonKey}`
    );
  }

  const existingDeckKeys = new Set((theme.decks ?? []).map((deck) => deck.deckKey));
  if (theme.lifecycle === 'DRAFT') {
    for (const { fixture, deckConfig, savedDeck } of sourceDecks) {
      if (existingDeckKeys.has(fixture.deckKey)) {
        continue;
      }
      await requestJson(`/admin/theme-table/events/${theme.id}/decks`, {
        method: 'POST',
        allowedStatuses: [201],
        token,
        body: {
          sourceType: 'CLOUD',
          sourceDeckId: savedDeck.id,
          deckKey: fixture.deckKey,
          displayName: deckConfig.player_name,
          playStyleTags: ['DeckLog示例'],
          difficulty: 'INTERMEDIATE',
          sourceLabel: `DeckLog ${fixture.decklogId}`,
          sourceUrl: `https://decklog.bushiroad.com/view/${fixture.decklogId}`,
          reviewNote: 'pnpm test-env:start 本地测试预组',
        },
      });
      existingDeckKeys.add(fixture.deckKey);
      log(`added test theme deck: ${deckConfig.player_name}`);
    }
  }

  const missingDeckKeys = themeDeckFixtures
    .map((fixture) => fixture.deckKey)
    .filter((deckKey) => !existingDeckKeys.has(deckKey));
  if (missingDeckKeys.length > 0) {
    throw new Error(
      `Published test theme season is missing DeckLog fixtures: ${missingDeckKeys.join(', ')}`
    );
  }

  if (theme.lifecycle === 'DRAFT') {
    const { payload } = await requestJson(`/admin/theme-table/events/${theme.id}/activate`, {
      method: 'POST',
      token,
    });
    theme = payload?.data;
    log(`activated test theme season: ${themeSeasonKey}`);
  } else if (theme.lifecycle === 'PAUSED') {
    const { payload } = await requestJson(`/admin/theme-table/events/${theme.id}/resume`, {
      method: 'POST',
      token,
    });
    theme = payload?.data;
    log(`resumed test theme season: ${themeSeasonKey}`);
  }

  if (theme?.lifecycle !== 'ACTIVE') {
    throw new Error(`Test theme season is not active: ${themeSeasonKey}`);
  }
}

async function main() {
  await registerAdminUser();
  await ensureAdminCredentials();
  const token = await loginAdmin();
  if (shouldSeedAdminDeck) {
    const deckConfig = await readDeckConfig();
    await upsertAdminDeck(
      token,
      toApiDeckPayload(deckConfig, {
        name: process.env.TEST_ADMIN_DECK_NAME ?? deckConfig.player_name,
      })
    );
  } else {
    log('skipping test admin deck seed');
  }
  await seedRankedSeason(token);
  await seedThemeSeason(token);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
