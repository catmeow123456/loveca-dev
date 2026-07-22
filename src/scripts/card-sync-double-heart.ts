export interface BladeHeartSyncTargetItem {
  readonly effect: 'HEART' | 'DRAW' | 'SCORE';
  readonly heartColor?: string;
}

/**
 * CloudBase / Loveca Excel use `double` for the BP7 double colorless Blade Heart.
 * One source token resolves to two separate gray Heart effects because the runtime
 * Blade Heart model represents one gained Heart per item.
 */
export function appendDoubleGrayBladeHearts(
  target: BladeHeartSyncTargetItem[],
  rawToken: unknown,
  count: number = 1
): boolean {
  if (typeof rawToken !== 'string' || rawToken.trim().toLowerCase() !== 'double') {
    return false;
  }

  for (let index = 0; index < count * 2; index++) {
    target.push({ effect: 'HEART', heartColor: 'GRAY' });
  }
  return true;
}
