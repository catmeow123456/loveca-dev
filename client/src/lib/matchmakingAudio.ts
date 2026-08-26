import type { PublicTableStatusView } from '@game/online/public-table-types';

export const MATCHMAKING_MUSIC_TRACKS = [
  '/music/event-2-theme.mp3',
  '/music/event-menu-theme.mp3',
  '/music/intro-theme.mp3',
] as const;

export const MATCH_FOUND_SOUND = '/music/music-start.mp3';

const WAITING_MUSIC_VOLUME = 0.32;
const MATCH_FOUND_VOLUME = 0.82;
const MATCH_FOUND_STATES = new Set(['PENDING_CONFIRMATION', 'CONFIRMED', 'CREATING_ROOM']);

export type MatchmakingQueueKind = 'public-table' | 'ranked' | 'theme-table';

export interface MatchmakingQueueStatus {
  readonly kind: MatchmakingQueueKind;
  readonly status: PublicTableStatusView | null;
}

export interface MatchmakingAudioState {
  readonly waiting: boolean;
  readonly matchIdentity: string | null;
}

interface MatchmakingAudioChannel {
  currentTime: number;
  loop: boolean;
  preload: string;
  volume: number;
  pause: () => void;
  play: () => Promise<void> | void;
}

interface MatchmakingAudioPlayerOptions {
  readonly createAudio?: (source: string) => MatchmakingAudioChannel;
  readonly random?: () => number;
}

export function resolveMatchmakingAudioState(
  queues: readonly MatchmakingQueueStatus[]
): MatchmakingAudioState {
  const foundQueue = queues.find(
    ({ status }) => status !== null && MATCH_FOUND_STATES.has(status.state)
  );
  const matchIdentity = foundQueue ? buildMatchIdentity(foundQueue) : null;
  return {
    matchIdentity,
    waiting: !matchIdentity && queues.some(({ status }) => status?.state === 'WAITING'),
  };
}

export class MatchmakingAudioPlayer {
  private readonly createAudio: (source: string) => MatchmakingAudioChannel;
  private readonly random: () => number;
  private waitingMusic: MatchmakingAudioChannel | null = null;
  private matchFoundSound: MatchmakingAudioChannel | null = null;
  private announcedMatchIdentity: string | null = null;

  constructor(options: MatchmakingAudioPlayerOptions = {}) {
    this.createAudio =
      options.createAudio ??
      ((source) => {
        return new Audio(source);
      });
    this.random = options.random ?? Math.random;
  }

  startWaitingMusic(): void {
    if (!this.waitingMusic) {
      this.stopMatchFoundSound();
      const trackIndex = Math.min(
        MATCHMAKING_MUSIC_TRACKS.length - 1,
        Math.max(0, Math.floor(this.random() * MATCHMAKING_MUSIC_TRACKS.length))
      );
      const audio = this.createAudio(MATCHMAKING_MUSIC_TRACKS[trackIndex]);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = WAITING_MUSIC_VOLUME;
      this.waitingMusic = audio;
    }

    playSafely(this.waitingMusic);
  }

  stopWaitingMusic(): void {
    stopAndRewind(this.waitingMusic);
    this.waitingMusic = null;
  }

  announceMatch(matchIdentity: string): void {
    if (this.announcedMatchIdentity === matchIdentity) {
      return;
    }
    this.announcedMatchIdentity = matchIdentity;
    this.stopWaitingMusic();
    this.stopMatchFoundSound();

    const audio = this.createAudio(MATCH_FOUND_SOUND);
    audio.loop = false;
    audio.preload = 'auto';
    audio.volume = MATCH_FOUND_VOLUME;
    this.matchFoundSound = audio;
    playSafely(audio);
  }

  reset(): void {
    this.stopWaitingMusic();
    this.stopMatchFoundSound();
    this.announcedMatchIdentity = null;
  }

  private stopMatchFoundSound(): void {
    stopAndRewind(this.matchFoundSound);
    this.matchFoundSound = null;
  }
}

function playSafely(audio: MatchmakingAudioChannel): void {
  try {
    const result = audio.play();
    if (result) {
      void result.catch(() => undefined);
    }
  } catch {
    // Browsers may block playback until the next user interaction.
  }
}

function stopAndRewind(audio: MatchmakingAudioChannel | null): void {
  if (!audio) return;
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // Some browsers reject seeking before media metadata is available.
  }
}

function buildMatchIdentity({ kind, status }: MatchmakingQueueStatus): string {
  if (!status) return kind;
  return [
    kind,
    status.reservationId ?? status.ticketId ?? 'unknown',
    status.confirmationExpiresAt ?? 'unknown',
  ].join(':');
}

export const matchmakingAudioPlayer = new MatchmakingAudioPlayer();
