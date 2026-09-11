import type { AiDecisionInput } from './protocol.js';

const TEXT_KEYS = new Set(['cardText', 'cardTextCn', 'cardTextJp', 'effectText', 'text']);

/** Lossless wire normalization: exact front snapshots and repeated long text are sent once.
 * Effective and printed values with any difference retain different references, even for one code.
 * Candidate refs, ordering, object IDs and all legal/visibility facts remain intact.
 */
export function compactAiDecisionInput(input: AiDecisionInput): Record<string, unknown> {
  const textCounts = new Map<string, number>();
  const count = (value: unknown, key = ''): void => {
    if (typeof value === 'string' && TEXT_KEYS.has(key) && value.length >= 64)
      textCounts.set(value, (textCounts.get(value) ?? 0) + 1);
    else if (Array.isArray(value)) value.forEach((item) => count(item));
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([k, v]) => count(v, k));
  };
  count(input);
  const textRefs = new Map<string, string>();
  const frontRefs = new Map<string, string>();
  const texts: Record<string, string> = {};
  const cardFacts: Record<string, unknown> = {};
  const pack = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string' && TEXT_KEYS.has(key) && (textCounts.get(value) ?? 0) > 1) {
      let ref = textRefs.get(value);
      if (!ref) {
        ref = `t${textRefs.size + 1}`;
        textRefs.set(value, ref);
        texts[ref] = value;
      }
      return { textRef: ref };
    }
    if (Array.isArray(value)) return value.map((item) => pack(item));
    if (value && typeof value === 'object') {
      if (key === 'frontInfo') {
        const serialized = JSON.stringify(value);
        let ref = frontRefs.get(serialized);
        if (!ref) {
          ref = `f${frontRefs.size + 1}`;
          frontRefs.set(serialized, ref);
          cardFacts[ref] = pack(value);
        }
        return { cardFactsRef: ref };
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pack(v, k)]));
    }
    return value;
  };
  const compact = pack(input) as Record<string, unknown>;
  return {
    ...compact,
    ...(frontRefs.size ? { cardFacts } : {}),
    ...(textRefs.size ? { texts } : {}),
  };
}
