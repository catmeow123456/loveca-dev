import { createHash } from 'node:crypto';
import { getBaseCardCode, normalizeCardCode } from '../../shared/utils/card-code.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

export type RankedDeckObservationSeat = 'FIRST' | 'SECOND';

export interface RankedDeckObservationCard {
  readonly baseCardCode: string;
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: 'MEMBER' | 'LIVE';
  readonly count: number;
  readonly imageFilename?: string;
}

export interface RankedDeckObservationFact {
  readonly seasonId: string;
  readonly matchId: string;
  readonly seat: RankedDeckObservationSeat;
  readonly userId: string;
  readonly deckFingerprint: string;
  readonly mainDeckCards: readonly RankedDeckObservationCard[];
  readonly observedAt: Date;
}

export interface BuildRankedDeckObservationInput {
  readonly seasonId: string;
  readonly matchId: string;
  readonly seat: RankedDeckObservationSeat;
  readonly userId: string;
  readonly mainDeck: unknown;
  readonly cardSummaries: unknown;
  readonly observedAt: Date | string;
}

export interface CaptureRankedDeckObservationsInput {
  readonly seasonId: string;
  readonly matchId: string;
  readonly firstUserId: string;
  readonly secondUserId: string;
}

export interface RankedDeckObservationQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface RankedDeckObservationQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<RankedDeckObservationQueryResult<T>>;
}

interface DeckSnapshotRow {
  readonly seat: string;
  readonly user_id: string;
  readonly main_deck: unknown;
  readonly card_summaries: unknown;
  readonly started_at: Date | string;
}

interface PersistedObservationRow {
  readonly season_id: string;
  readonly match_id: string;
  readonly seat: string;
  readonly user_id: string;
  readonly deck_fingerprint: string;
  readonly main_deck_cards: unknown;
  readonly observed_at: Date | string;
}

interface CardSummary {
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: 'MEMBER' | 'LIVE';
  readonly imageFilename?: string;
}

interface CardGroup {
  readonly baseCardCode: string;
  count: number;
  readonly summariesByCardCode: Map<string, CardSummary>;
}

const RANKED_MAIN_DECK_CARD_COUNT = 60;
const RANKED_OBSERVATION_SEATS: readonly RankedDeckObservationSeat[] = ['FIRST', 'SECOND'];

export class RankedDeckObservationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RankedDeckObservationServiceError';
  }
}

/**
 * Builds the long-lived, minimum ranked deck fact from a replay deck snapshot.
 * Rarity variants are deliberately collapsed to their shared base card code.
 */
export function buildRankedDeckObservation(
  input: BuildRankedDeckObservationInput
): RankedDeckObservationFact {
  const mainDeck = readMainDeck(input.mainDeck);
  const summaries = readCardSummaries(input.cardSummaries);
  const groups = new Map<string, CardGroup>();

  for (const rawCardCode of mainDeck) {
    const cardCode = normalizeCardCode(rawCardCode);
    const summary = readSummaryForCard(summaries, rawCardCode, cardCode);
    const baseCardCode = getBaseCardCode(cardCode);
    const group = groups.get(baseCardCode) ?? {
      baseCardCode,
      count: 0,
      summariesByCardCode: new Map<string, CardSummary>(),
    };
    group.count += 1;
    group.summariesByCardCode.set(cardCode, summary);
    groups.set(baseCardCode, group);
  }

  const mainDeckCards = [...groups.values()]
    .sort((left, right) => compareCardCodes(left.baseCardCode, right.baseCardCode))
    .map(toObservationCard);
  const fingerprintInput = mainDeckCards.map(({ baseCardCode, count }) => ({
    baseCardCode,
    count,
  }));

  return {
    seasonId: requireNonEmpty(input.seasonId, 'seasonId'),
    matchId: requireNonEmpty(input.matchId, 'matchId'),
    seat: input.seat,
    userId: requireNonEmpty(input.userId, 'userId'),
    deckFingerprint: `sha256:${createHash('sha256')
      .update(stableJsonStringify(fingerprintInput))
      .digest('hex')}`,
    mainDeckCards,
    observedAt: requireDate(input.observedAt),
  };
}

/**
 * Captures both seats inside the caller's ranked registration transaction.
 * A conflicting idempotent retry is rejected instead of overwriting history.
 */
export async function captureRankedDeckObservations(
  client: RankedDeckObservationQueryClient,
  input: CaptureRankedDeckObservationsInput
): Promise<readonly RankedDeckObservationFact[]> {
  const snapshotResult = await client.query<DeckSnapshotRow>(
    `SELECT
       snapshot.seat,
       snapshot.user_id,
       snapshot.main_deck,
       snapshot.card_summaries,
       record.started_at
     FROM match_deck_snapshots AS snapshot
     JOIN match_records AS record ON record.match_id = snapshot.match_id
     WHERE snapshot.match_id = $1
     ORDER BY snapshot.seat ASC`,
    [input.matchId]
  );
  const rowsBySeat = new Map(snapshotResult.rows.map((row) => [row.seat, row]));
  if (
    snapshotResult.rows.length !== RANKED_OBSERVATION_SEATS.length ||
    rowsBySeat.size !== RANKED_OBSERVATION_SEATS.length
  ) {
    throw observationError(
      'RANKED_DECK_SNAPSHOTS_INVALID',
      '排位对局必须包含两席唯一的完整卡组快照'
    );
  }

  const expectedUsers: Readonly<Record<RankedDeckObservationSeat, string>> = {
    FIRST: input.firstUserId,
    SECOND: input.secondUserId,
  };
  const facts = RANKED_OBSERVATION_SEATS.map((seat) => {
    const row = rowsBySeat.get(seat);
    if (!row || row.user_id !== expectedUsers[seat]) {
      throw observationError(
        'RANKED_DECK_SNAPSHOTS_INVALID',
        `排位对局 ${seat} 席卡组快照与已绑定参与者不一致`
      );
    }
    return buildRankedDeckObservation({
      seasonId: input.seasonId,
      matchId: input.matchId,
      seat,
      userId: row.user_id,
      mainDeck: row.main_deck,
      cardSummaries: row.card_summaries,
      observedAt: row.started_at,
    });
  });

  for (const fact of facts) {
    const inserted = await client.query<PersistedObservationRow>(
      `INSERT INTO ranked_deck_observations (
         season_id,
         match_id,
         seat,
         user_id,
         deck_fingerprint,
         main_deck_cards,
         observed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (match_id, seat) DO NOTHING
       RETURNING
         season_id,
         match_id,
         seat,
         user_id,
         deck_fingerprint,
         main_deck_cards,
         observed_at`,
      [
        fact.seasonId,
        fact.matchId,
        fact.seat,
        fact.userId,
        fact.deckFingerprint,
        stableJsonStringify(fact.mainDeckCards),
        fact.observedAt,
      ]
    );
    const persisted =
      inserted.rows[0] ?? (await loadExistingObservation(client, fact.matchId, fact.seat));
    assertObservationMatches(persisted, fact);
  }

  return facts;
}

async function loadExistingObservation(
  client: RankedDeckObservationQueryClient,
  matchId: string,
  seat: RankedDeckObservationSeat
): Promise<PersistedObservationRow | undefined> {
  const result = await client.query<PersistedObservationRow>(
    `SELECT
       season_id,
       match_id,
       seat,
       user_id,
       deck_fingerprint,
       main_deck_cards,
       observed_at
     FROM ranked_deck_observations
     WHERE match_id = $1
       AND seat = $2`,
    [matchId, seat]
  );
  return result.rows[0];
}

function assertObservationMatches(
  row: PersistedObservationRow | undefined,
  fact: RankedDeckObservationFact
): void {
  if (
    !row ||
    row.season_id !== fact.seasonId ||
    row.match_id !== fact.matchId ||
    row.seat !== fact.seat ||
    row.user_id !== fact.userId ||
    row.deck_fingerprint !== fact.deckFingerprint ||
    stableJsonStringify(row.main_deck_cards) !== stableJsonStringify(fact.mainDeckCards) ||
    requireDate(row.observed_at).getTime() !== fact.observedAt.getTime()
  ) {
    throw observationError(
      'RANKED_DECK_OBSERVATION_CONFLICT',
      `排位对局 ${fact.matchId} ${fact.seat} 席的卡组观察记录与本次捕获不一致`
    );
  }
}

function readMainDeck(value: unknown): readonly string[] {
  const cards: readonly unknown[] = Array.isArray(value) ? value : [];
  if (
    !Array.isArray(value) ||
    cards.length !== RANKED_MAIN_DECK_CARD_COUNT ||
    cards.some((cardCode) => typeof cardCode !== 'string' || cardCode.trim().length === 0)
  ) {
    throw observationError(
      'RANKED_MAIN_DECK_INVALID',
      `排位卡组快照必须包含 ${RANKED_MAIN_DECK_CARD_COUNT} 张有效主卡组卡牌`
    );
  }
  return cards.map((cardCode) => cardCode as string);
}

function readCardSummaries(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw observationError('RANKED_CARD_SUMMARIES_INVALID', '排位卡组快照缺少有效的卡牌摘要');
  }
  return value as Readonly<Record<string, unknown>>;
}

function readSummaryForCard(
  summaries: Readonly<Record<string, unknown>>,
  rawCardCode: string,
  cardCode: string
): CardSummary {
  const raw = summaries[rawCardCode] ?? summaries[cardCode];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw observationError(
      'RANKED_CARD_SUMMARY_MISSING',
      `排位卡组快照缺少卡牌 ${cardCode} 的摘要`
    );
  }
  const record = raw as Readonly<Record<string, unknown>>;
  const summaryCardCode = readRequiredString(record.cardCode, `${cardCode}.cardCode`);
  const name = readRequiredString(record.name, `${cardCode}.name`);
  const cardType = record.cardType;
  if (
    normalizeCardCode(summaryCardCode) !== cardCode ||
    (cardType !== 'MEMBER' && cardType !== 'LIVE')
  ) {
    throw observationError(
      'RANKED_CARD_SUMMARY_INVALID',
      `排位卡组快照中卡牌 ${cardCode} 的摘要不一致或类型无效`
    );
  }
  const imageFilename = record.imageFilename;
  if (imageFilename !== undefined && (typeof imageFilename !== 'string' || !imageFilename.trim())) {
    throw observationError(
      'RANKED_CARD_SUMMARY_INVALID',
      `排位卡组快照中卡牌 ${cardCode} 的图片文件名无效`
    );
  }
  return {
    cardCode,
    name,
    cardType,
    ...(typeof imageFilename === 'string' ? { imageFilename: imageFilename.trim() } : {}),
  };
}

function toObservationCard(group: CardGroup): RankedDeckObservationCard {
  const cardCodes = [...group.summariesByCardCode.keys()].sort(compareCardCodes);
  const cardCode = cardCodes[0];
  const representative = cardCode ? group.summariesByCardCode.get(cardCode) : undefined;
  if (!representative) {
    throw observationError('RANKED_CARD_SUMMARY_MISSING', '排位卡组快照缺少代表卡牌摘要');
  }
  for (const summary of group.summariesByCardCode.values()) {
    if (summary.name !== representative.name || summary.cardType !== representative.cardType) {
      throw observationError(
        'RANKED_CARD_SUMMARY_INVALID',
        `基础编号 ${group.baseCardCode} 的不同罕度摘要不一致`
      );
    }
  }
  return {
    baseCardCode: group.baseCardCode,
    cardCode: representative.cardCode,
    name: representative.name,
    cardType: representative.cardType,
    count: group.count,
    ...(representative.imageFilename ? { imageFilename: representative.imageFilename } : {}),
  };
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw observationError('RANKED_CARD_SUMMARY_INVALID', `排位卡组快照的 ${field} 无效`);
  }
  return value.trim();
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw observationError('RANKED_DECK_OBSERVATION_INVALID', `${field} 不能为空`);
  }
  return value;
}

function requireDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw observationError('RANKED_DECK_OBSERVATION_INVALID', '排位卡组观察时间无效');
  }
  return date;
}

function compareCardCodes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function observationError(code: string, message: string): RankedDeckObservationServiceError {
  return new RankedDeckObservationServiceError(code, message);
}
