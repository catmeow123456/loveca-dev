import { AiBattleSetupError } from './presets.js';

/** Deployment opt-in; absent or zero means requests wait until completion or cancellation. */
export function readAiModelRequestTimeoutMs(
  env: Readonly<Record<string, string | undefined>> = process.env
): number | undefined {
  const raw = env.AI_BATTLE_MODEL_REQUEST_TIMEOUT_MS;
  if (raw === undefined || raw === '0') return undefined;
  const milliseconds = Number(raw);
  // Node timers overflow beyond this range and would otherwise fire after roughly 1 ms.
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(milliseconds) || milliseconds > 2 ** 31 - 1)
    throw new AiBattleSetupError(
      'AI_MODEL_CONFIG_INVALID',
      'AI_BATTLE_MODEL_REQUEST_TIMEOUT_MS 必须是 0 或 Node 定时器范围内的正整数毫秒'
    );
  return milliseconds;
}
