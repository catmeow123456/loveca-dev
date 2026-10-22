import { cardCodeMatchesBase } from '@game/shared/utils/card-code';

export const HONOKA_MEMORY_BASE = 'PL!-pb2-001';
export const supportsHonokaMemory = (code: string) => cardCodeMatchesBase(code, HONOKA_MEMORY_BASE);
export interface MemoryCardFace {
  objectId: string;
  code: string;
  name: string;
  image: string;
  landscape: boolean;
}
/** Public presentation data only. Eligibility and rewards must come from the resolved workflow. */
export interface HonokaMemoryCue {
  id: string;
  source: MemoryCardFace;
  memories: readonly MemoryCardFace[];
  scoreGranted: boolean;
  heartGranted: boolean;
  recoveryReady: boolean;
  recovered?: MemoryCardFace;
  part: 'rewards' | 'recovery';
}
export interface MemoryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MemoryLayout {
  sourceSide?: 'self' | 'opponent';
  board: MemoryRect;
  member: MemoryRect;
  success: MemoryRect;
  live: MemoryRect;
  waiting: MemoryRect;
  hand: MemoryRect;
}
export const memoryTiming = { rewards: 1400, recovery: 1000, reduced: 420 } as const;
export const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const progress = (t: number, start: number, duration: number) =>
  clamp((t - start) / duration);
export const smooth = (p: number) => p * p * (3 - 2 * p);
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export const center = (r: MemoryRect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
export function memoryDuration(cue: HonokaMemoryCue, reduced: boolean) {
  return reduced ? memoryTiming.reduced : memoryTiming[cue.part];
}
export function hasMemoryPresentation(cue: HonokaMemoryCue) {
  return (
    supportsHonokaMemory(cue.source.code) &&
    (cue.part === 'recovery'
      ? !!cue.recovered
      : cue.scoreGranted || cue.heartGranted || cue.recoveryReady)
  );
}
