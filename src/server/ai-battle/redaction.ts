import { toTransport } from '../../online/serde.js';

const secretField =
  /^(?:authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|cookie|set-cookie|password|secret)$/i;

/** Redaction happens before evidence enters the store, including provider error text. */
export function redactAiText(
  text: string,
  secrets: readonly string[] = []
): { text: string; count: number } {
  let count = 0;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const variant of new Set([
      secret,
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
    ])) {
      const pieces = text.split(variant);
      count += pieces.length - 1;
      text = pieces.join('[REDACTED]');
    }
  }
  text = text.replace(
    /("(?:authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|cookie|set-cookie|password|secret)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
    (_match, prefix: string) => {
      count++;
      return `${prefix}"[REDACTED]"`;
    }
  );
  text = text.replace(
    /\b(Authorization\s*:\s*(?:Bearer\s+)?|(?:API[_ -]?Key|session[_ -]?token)\s*[=:]\s*)[^\s,;"}]+/gi,
    (_match, prefix: string) => {
      count++;
      return `${prefix}[REDACTED]`;
    }
  );
  return { text, count };
}

export function serializeAiEvidence(value: unknown): { text: string; count: number } {
  let count = 0;
  const serialized = JSON.stringify(value, (key, entry: unknown) => {
    if (secretField.test(key)) {
      count++;
      return '[REDACTED]';
    }
    if (entry instanceof Map) return toTransport(entry);
    if (typeof entry === 'string') {
      const redacted = redactAiText(entry);
      count += redacted.count;
      return redacted.text;
    }
    return entry;
  });
  if (serialized === undefined) throw new Error('Missing evidence payload');
  return { text: serialized, count };
}
