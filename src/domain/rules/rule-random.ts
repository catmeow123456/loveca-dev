export const RULE_RANDOM_FACT_SCHEMA_VERSION = 'loveca.rule-random-fact/v1' as const;
export const RULE_RANDOM_SOURCE_SCHEMA_VERSION = 'loveca.rule-random-source/v1' as const;

export type RuleRandomPurpose =
  | 'INITIAL_MAIN_DECK_PRE_SHUFFLE'
  | 'INITIAL_MAIN_DECK_SHUFFLE'
  | 'MULLIGAN_MAIN_DECK_SHUFFLE'
  | 'DECK_REFRESH_SHUFFLE'
  | 'CARD_EFFECT_HAND_TO_DECK_BOTTOM_SHUFFLE'
  | 'CARD_EFFECT_WAITING_ROOM_TO_DECK_BOTTOM_SHUFFLE'
  | 'ZONE_SHUFFLE';

export interface RuleRandomFact {
  readonly schemaVersion: typeof RULE_RANDOM_FACT_SCHEMA_VERSION;
  readonly sequence: number;
  readonly purpose: RuleRandomPurpose;
  readonly upperBound: number;
  readonly result: number;
}

export interface RuleRandomSource {
  readonly schemaVersion: typeof RULE_RANDOM_SOURCE_SCHEMA_VERSION;
  readonly kind: 'SECURE' | 'SEEDED' | 'REPLAY';
  nextInt(upperBound: number, purpose: RuleRandomPurpose): number;
  assertComplete?(): void;
}

export interface RuleRandomFactRecorder extends RuleRandomSource {
  getFacts(): readonly RuleRandomFact[];
  drainPendingFacts(): readonly RuleRandomFact[];
  assertReplayComplete(): void;
}

let activeRuleRandomSource: RuleRandomSource | null = null;
const defaultSecureSource = createSecureRuleRandomSource();

export function withRuleRandomSource<T>(source: RuleRandomSource, operation: () => T): T {
  const previous = activeRuleRandomSource;
  activeRuleRandomSource = source;
  try {
    return operation();
  } finally {
    activeRuleRandomSource = previous;
  }
}

export function nextRuleRandomInt(
  upperBound: number,
  purpose: RuleRandomPurpose = 'ZONE_SHUFFLE'
): number {
  return (activeRuleRandomSource ?? defaultSecureSource).nextInt(upperBound, purpose);
}

export function shuffleWithRuleRandom<T>(
  values: readonly T[],
  purpose: RuleRandomPurpose = 'ZONE_SHUFFLE'
): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = nextRuleRandomInt(index + 1, purpose);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function createSecureRuleRandomSource(): RuleRandomSource {
  return {
    schemaVersion: RULE_RANDOM_SOURCE_SCHEMA_VERSION,
    kind: 'SECURE',
    nextInt(upperBound) {
      assertUpperBound(upperBound);
      const maxUint32Range = 0x1_0000_0000;
      const acceptedRange = Math.floor(maxUint32Range / upperBound) * upperBound;
      const buffer = new Uint32Array(1);
      do {
        globalThis.crypto.getRandomValues(buffer);
      } while (buffer[0]! >= acceptedRange);
      return buffer[0]! % upperBound;
    },
  };
}

export function createSeededRuleRandomSource(seed: string | number): RuleRandomSource {
  let state = hashSeed(String(seed));
  return {
    schemaVersion: RULE_RANDOM_SOURCE_SCHEMA_VERSION,
    kind: 'SEEDED',
    nextInt(upperBound) {
      assertUpperBound(upperBound);
      state = nextMulberry32State(state);
      return Math.floor((state / 0x1_0000_0000) * upperBound);
    },
  };
}

export function createReplayRuleRandomSource(
  expectedFacts: readonly RuleRandomFact[]
): RuleRandomSource & { assertComplete(): void } {
  let cursor = 0;
  return {
    schemaVersion: RULE_RANDOM_SOURCE_SCHEMA_VERSION,
    kind: 'REPLAY',
    nextInt(upperBound, purpose) {
      assertUpperBound(upperBound);
      const expected = expectedFacts[cursor];
      if (!expected) {
        throw new Error(`规则随机事实已耗尽：请求 ${purpose} upperBound=${String(upperBound)}`);
      }
      if (
        expected.schemaVersion !== RULE_RANDOM_FACT_SCHEMA_VERSION ||
        expected.sequence !== cursor + 1 ||
        expected.purpose !== purpose ||
        expected.upperBound !== upperBound ||
        !Number.isSafeInteger(expected.result) ||
        expected.result < 0 ||
        expected.result >= upperBound
      ) {
        throw new Error(
          `规则随机事实不匹配：sequence=${String(cursor + 1)}，请求 ${purpose}/${String(
            upperBound
          )}，记录为 ${expected.purpose}/${String(expected.upperBound)}/${String(expected.result)}`
        );
      }
      cursor += 1;
      return expected.result;
    },
    assertComplete() {
      if (cursor !== expectedFacts.length) {
        throw new Error(
          `规则随机事实尚未消费完毕：已消费 ${String(cursor)}，总计 ${String(expectedFacts.length)}`
        );
      }
    },
  };
}

export function createRuleRandomFactRecorder(source: RuleRandomSource): RuleRandomFactRecorder {
  const facts: RuleRandomFact[] = [];
  let pendingStart = 0;
  return {
    schemaVersion: RULE_RANDOM_SOURCE_SCHEMA_VERSION,
    kind: source.kind,
    nextInt(upperBound, purpose) {
      const result = source.nextInt(upperBound, purpose);
      assertRandomResult(result, upperBound);
      facts.push({
        schemaVersion: RULE_RANDOM_FACT_SCHEMA_VERSION,
        sequence: facts.length + 1,
        purpose,
        upperBound,
        result,
      });
      return result;
    },
    getFacts() {
      return facts.map((fact) => ({ ...fact }));
    },
    drainPendingFacts() {
      const pending = facts.slice(pendingStart).map((fact) => ({ ...fact }));
      pendingStart = facts.length;
      return pending;
    },
    assertReplayComplete() {
      source.assertComplete?.();
    },
  };
}

function assertUpperBound(upperBound: number): void {
  if (!Number.isSafeInteger(upperBound) || upperBound <= 0 || upperBound > 0x1_0000_0000) {
    throw new Error(`规则随机上界必须是 1..2^32 的安全整数：${String(upperBound)}`);
  }
}

function assertRandomResult(result: number, upperBound: number): void {
  if (!Number.isSafeInteger(result) || result < 0 || result >= upperBound) {
    throw new Error(
      `规则随机源返回越界结果：result=${String(result)} upperBound=${String(upperBound)}`
    );
  }
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function nextMulberry32State(previous: number): number {
  let value = (previous + 0x6d2b79f5) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return (value ^ (value >>> 14)) >>> 0;
}
