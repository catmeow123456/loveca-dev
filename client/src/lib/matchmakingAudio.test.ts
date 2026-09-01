import { describe, expect, it, vi } from 'vitest';
import {
  MATCH_FOUND_SOUND,
  MatchmakingAudioPlayer,
  resolveMatchmakingAudioState,
  resolveMatchmakingTrackUrls,
  type MatchmakingQueueKind,
} from './matchmakingAudio';
import type {
  PublicTablePlayerState,
  PublicTableStatusView,
} from '@game/online/public-table-types';

const TEST_TRACKS = ['/music/first.mp3', '/music/second.mp3', '/music/third.mp3'] as const;

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
  it('uses the administrator default subset when the user inherits defaults', () => {
    expect(resolveMatchmakingTrackUrls(selectionTracks(), null)).toEqual([
      '/music/first.mp3',
      '/music/third.mp3',
    ]);
  });

  it('uses only current tracks from a user custom subset', () => {
    expect(resolveMatchmakingTrackUrls(selectionTracks(), ['track-2', 'deleted-track'])).toEqual([
      '/music/second.mp3',
    ]);
  });

  it('keeps waiting silent for an explicitly empty custom subset', () => {
    expect(resolveMatchmakingTrackUrls(selectionTracks(), [])).toEqual([]);
  });

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

    player.startWaitingMusic(TEST_TRACKS);
    player.startWaitingMusic(TEST_TRACKS);

    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      source: TEST_TRACKS[1],
      loop: true,
      preload: 'auto',
      volume: 0.32,
    });
    expect(channels[0].play).toHaveBeenCalledTimes(2);
  });

  it('stops waiting music and announces each reservation only once', () => {
    const { channels, player } = createPlayer();
    player.startWaitingMusic(TEST_TRACKS);

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
    player.startWaitingMusic(TEST_TRACKS);
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

    expect(() => player.startWaitingMusic(TEST_TRACKS)).not.toThrow();
    await rejection.catch(() => undefined);
  });

  it('stays silent when the managed library is empty', () => {
    const { channels, player } = createPlayer();

    player.startWaitingMusic([]);

    expect(channels).toHaveLength(0);
  });
});

function selectionTracks() {
  return [
    { id: 'track-1', audioUrl: '/music/first.mp3', defaultSelected: true },
    { id: 'track-2', audioUrl: '/music/second.mp3', defaultSelected: false },
    { id: 'track-3', audioUrl: '/music/third.mp3', defaultSelected: true },
  ] as const;
}

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
