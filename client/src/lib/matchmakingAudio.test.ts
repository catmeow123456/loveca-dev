import { describe, expect, it, vi } from 'vitest';
import {
  MATCH_FOUND_SOUND,
  MATCHMAKING_MUSIC_TRACKS,
  MatchmakingAudioPlayer,
  resolveMatchmakingAudioState,
  type MatchmakingQueueKind,
} from './matchmakingAudio';
import type {
  PublicTablePlayerState,
  PublicTableStatusView,
} from '@game/online/public-table-types';

class FakeAudio {
  currentTime = 12;
  loop = false;
  preload = '';
  volume = 1;
  readonly pause = vi.fn();
  readonly play = vi.fn(async () => undefined);

  constructor(readonly source: string) {}
}

function createPlayer(random = 0) {
  const channels: FakeAudio[] = [];
  const player = new MatchmakingAudioPlayer({
    random: () => random,
    createAudio: (source) => {
      const audio = new FakeAudio(source);
      channels.push(audio);
      return audio;
    },
  });
  return { channels, player };
}

describe('MatchmakingAudioPlayer', () => {
  it.each<MatchmakingQueueKind>(['public-table', 'ranked', 'theme-table'])(
    'recognizes %s as a waiting queue',
    (kind) => {
      expect(
        resolveMatchmakingAudioState([{ kind, status: createQueueStatus('WAITING') }])
      ).toEqual({ waiting: true, matchIdentity: null });
    }
  );

  it('uses the reservation identity to announce a found match ahead of stale waiting state', () => {
    expect(
      resolveMatchmakingAudioState([
        { kind: 'public-table', status: createQueueStatus('WAITING') },
        {
          kind: 'ranked',
          status: createQueueStatus('PENDING_CONFIRMATION', 'reservation-1'),
        },
      ])
    ).toEqual({
      waiting: false,
      matchIdentity: 'ranked:reservation-1:2000',
    });
  });

  it('loops one of the waiting tracks without creating overlapping channels', () => {
    const { channels, player } = createPlayer(0.5);

    player.startWaitingMusic();
    player.startWaitingMusic();

    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      source: MATCHMAKING_MUSIC_TRACKS[1],
      loop: true,
      preload: 'auto',
      volume: 0.32,
    });
    expect(channels[0].play).toHaveBeenCalledTimes(2);
  });

  it('stops waiting music and announces each reservation only once', () => {
    const { channels, player } = createPlayer();
    player.startWaitingMusic();

    player.announceMatch('ranked:reservation-1');
    player.announceMatch('ranked:reservation-1');

    expect(channels).toHaveLength(2);
    expect(channels[0].pause).toHaveBeenCalledOnce();
    expect(channels[0].currentTime).toBe(0);
    expect(channels[1]).toMatchObject({
      source: MATCH_FOUND_SOUND,
      loop: false,
      preload: 'auto',
      volume: 0.82,
    });
    expect(channels[1].play).toHaveBeenCalledOnce();
  });

  it('cleans up both channels and allows a later match to be announced again', () => {
    const { channels, player } = createPlayer();
    player.startWaitingMusic();
    player.announceMatch('theme-table:reservation-1');

    player.reset();
    player.announceMatch('theme-table:reservation-1');

    expect(channels).toHaveLength(3);
    expect(channels[1].pause).toHaveBeenCalledOnce();
    expect(channels[2].source).toBe(MATCH_FOUND_SOUND);
    expect(channels[2].play).toHaveBeenCalledOnce();
  });

  it('does not surface a rejected browser autoplay promise', async () => {
    const rejection = Promise.reject(new Error('NotAllowedError'));
    const player = new MatchmakingAudioPlayer({
      createAudio: () => ({
        currentTime: 0,
        loop: false,
        preload: '',
        volume: 1,
        pause: vi.fn(),
        play: () => rejection,
      }),
    });

    expect(() => player.startWaitingMusic()).not.toThrow();
    await rejection.catch(() => undefined);
  });
});

function createQueueStatus(
  state: PublicTablePlayerState,
  reservationId: string | null = null
): PublicTableStatusView {
  return {
    state,
    ticketId: 'ticket-1',
    joinedAt: 1000,
    deckName: '测试卡组',
    reservationId,
    confirmationExpiresAt: reservationId ? 2000 : null,
    confirmed: state === 'CONFIRMED' || state === 'CREATING_ROOM' || state === 'MATCHED',
    roomCode: state === 'MATCHED' ? 'ABC123' : null,
    roomGeneration: state === 'MATCHED' ? 'generation-1' : null,
    message: null,
  };
}
