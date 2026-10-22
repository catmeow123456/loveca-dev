import { entranceCards } from '@game/shared/card-entrance';
import { cardCodeMatchesBase } from '@game/shared/utils/card-code';
import { entranceTimeline } from '@/lib/cardEntranceTimeline';

/** SEC-derived art and choreography; every printing of this base card is enabled. */
export const RINA_SEC_CODE = 'PL!N-bp8-009-SEC';
export type RinaSecScene = 'entrance' | 'live';
export const supportsRinaSec = (code: string) => cardCodeMatchesBase(code, entranceCards.rina);
export const rinaSecTiming = {
  portraitAt: 640,
  entrance: 640 + entranceTimeline.total,
  live: 2520,
  oldCueAt: 200,
  oldLeaveAt: 500,
  oldArriveAt: 1000,
  newCueAt: 1140,
  newLeaveAt: 1540,
  newArriveAt: 2110,
  reduced: 240,
} as const;
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const progress = (time: number, start: number, end: number) =>
  clamp((time - start) / (end - start));
export const smooth = (n: number) => n * n * (3 - 2 * n);
export const easeOut = (n: number) => 1 - (1 - n) ** 3;
export function rinaSecDuration(scene: RinaSecScene, reduced: boolean) {
  return reduced ? rinaSecTiming.reduced : rinaSecTiming[scene];
}
export function rinaSecFrame(scene: RinaSecScene, time: number, reduced: boolean) {
  const end = rinaSecDuration(scene, reduced);
  const elapsed = Math.max(0, Math.min(end, time));
  const contact = rinaSecTiming.portraitAt + entranceTimeline.landingAt + entranceTimeline.flight;
  return {
    elapsed,
    finished: time >= end,
    portraitTime: elapsed - rinaSecTiming.portraitAt,
    memberVisible: scene === 'live' || reduced || elapsed >= contact,
    newLiveVisible: scene === 'live' && elapsed >= (reduced ? end : rinaSecTiming.newArriveAt),
    oldLiveVisible: scene !== 'live' || elapsed < (reduced ? end : rinaSecTiming.oldLeaveAt),
    phase:
      scene === 'entrance'
        ? reduced
          ? '璃奈登场'
          : elapsed < 640
            ? '璃奈板 · 连接'
            : elapsed < 2390
              ? '人物展示'
              : elapsed < contact
                ? '飞入舞台'
                : '落场'
        : reduced
          ? '换曲完成'
          : elapsed < rinaSecTiming.oldLeaveAt
            ? '璃奈板 · 发出切换信号'
            : elapsed < rinaSecTiming.newCueAt
              ? '旧 LIVE 完整收回'
              : elapsed < rinaSecTiming.newLeaveAt
                ? '璃奈板 · 点亮新曲节奏'
                : elapsed < rinaSecTiming.newArriveAt
                  ? '新 LIVE 完整入场'
                  : '璃奈板 · 连接成功',
  };
}
