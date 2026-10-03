import { describe, expect, it } from 'vitest';
import { readAiModelRequestTimeoutMs } from '../../src/server/ai-battle/request-timeout';
import { createAiModelConfig } from '../../src/server/ai-battle/model-client';

describe('AI model request deadline deployment configuration', () => {
  it.each([undefined, '0'])('has no implicit deadline for %s', (raw) => {
    expect(
      readAiModelRequestTimeoutMs({ AI_BATTLE_MODEL_REQUEST_TIMEOUT_MS: raw })
    ).toBeUndefined();
  });

  it.each(['1', '300000', '2147483647'])('preserves the explicit deadline %s', (raw) => {
    expect(readAiModelRequestTimeoutMs({ AI_BATTLE_MODEL_REQUEST_TIMEOUT_MS: raw })).toBe(
      Number(raw)
    );
  });

  it.each(['', '-1', '1.5', 'NaN', 'Infinity', '300ms', '01', '2147483648', '9007199254740992'])(
    'rejects an invalid or overflowing timer %s',
    (raw) => {
      expect(() =>
        readAiModelRequestTimeoutMs({ AI_BATTLE_MODEL_REQUEST_TIMEOUT_MS: raw })
      ).toThrow('AI_BATTLE_MODEL_REQUEST_TIMEOUT_MS');
    }
  );

  it.each([false, true])('keeps the deadline independent of thinking (%s)', (thinking) => {
    const upstream = { baseUrl: 'https://api.example.com/v1', apiKey: 'test-key' };
    expect(
      createAiModelConfig(upstream, 'qwen3.8-flash', thinking, {}).requestTimeoutMs
    ).toBeUndefined();
    expect(
      createAiModelConfig(upstream, 'qwen3.8-flash', thinking, {
        AI_BATTLE_MODEL_REQUEST_TIMEOUT_MS: '300000',
      }).requestTimeoutMs
    ).toBe(300_000);
  });
});
