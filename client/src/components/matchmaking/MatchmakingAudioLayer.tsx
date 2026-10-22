import { useTextPresentation } from '@/lib/appPresentation';
import { useEffect, useMemo, useState } from 'react';
import {
  matchmakingAudioPlayer,
  resolveMatchmakingAudioState,
  resolveMatchmakingTrackUrls,
  type MatchmakingQueueStatus,
} from '@/lib/matchmakingAudio';
import { fetchMatchmakingBgmLibrary, type MatchmakingBgmTrack } from '@/lib/matchmakingBgmClient';
import { useCasualTableStore } from '@/store/casualTableStore';
import type { PublicTableStatusView } from '@game/online/public-table-types';
import { useRankedStore } from '@/store/rankedStore';
import { useThemeTableStore } from '@/store/themeTableStore';

export function MatchmakingAudioLayer({
  enabled: requestedEnabled,
  waitingMusicEnabled,
  matchFoundSoundEnabled,
  preferredTrackIds,
}: {
  enabled: boolean;
  waitingMusicEnabled: boolean;
  matchFoundSoundEnabled: boolean;
  preferredTrackIds: readonly string[] | null;
}) {
  const textOnly = useTextPresentation();
  const enabled = requestedEnabled && !textOnly;
  const casual = useCasualTableStore((state) => (state.hydrated ? state.status?.table : null));
  const publicTableStatus: PublicTableStatusView | null = casual
    ? {
        state:
          casual.state === 'WAITING'
            ? 'WAITING'
            : casual.state === 'RESERVED'
              ? 'PENDING_CONFIRMATION'
              : casual.state === 'BOOTSTRAPPING'
                ? 'CREATING_ROOM'
                : 'MATCHED',
        ticketId: casual.tableId,
        reservationId: casual.roundId,
        joinedAt: casual.waitingSince,
        deckName: casual.ownDeck?.name ?? null,
        confirmationExpiresAt: casual.confirmationExpiresAt,
        confirmed: false,
        roomCode: casual.roomCode,
        roomGeneration: casual.roomGeneration,
        message: null,
      }
    : null;
  const rankedStatus = useRankedStore((state) => state.overview?.queue ?? null);
  const themeTableStatus = useThemeTableStore((state) => state.overview?.queue ?? null);
  const [libraryTracks, setLibraryTracks] = useState<readonly MatchmakingBgmTrack[]>([]);

  const queues: readonly MatchmakingQueueStatus[] = [
    { kind: 'public-table', status: publicTableStatus },
    { kind: 'ranked', status: rankedStatus },
    { kind: 'theme-table', status: themeTableStatus },
  ];
  const { matchIdentity, waiting } = resolveMatchmakingAudioState(queues);
  const waitingTracks = useMemo(
    () => resolveMatchmakingTrackUrls(libraryTracks, preferredTrackIds),
    [libraryTracks, preferredTrackIds]
  );

  useEffect(() => {
    if (!enabled || !waiting || !waitingMusicEnabled) return;
    let active = true;
    void fetchMatchmakingBgmLibrary()
      .then((tracks) => {
        if (active) setLibraryTracks(tracks);
      })
      .catch(() => {
        // Audio is optional and must never block matchmaking.
        if (active) setLibraryTracks([]);
      });
    return () => {
      active = false;
    };
  }, [enabled, waiting, waitingMusicEnabled]);

  useEffect(() => {
    if (!enabled) {
      matchmakingAudioPlayer.reset();
      return;
    }
    if (matchIdentity) {
      if (matchFoundSoundEnabled) {
        matchmakingAudioPlayer.announceMatch(matchIdentity);
      } else {
        matchmakingAudioPlayer.reset();
      }
      return;
    }
    if (waiting && waitingMusicEnabled) {
      matchmakingAudioPlayer.startWaitingMusic(waitingTracks);
      return;
    }
    matchmakingAudioPlayer.stopWaitingMusic();
  }, [enabled, matchIdentity, waiting, waitingMusicEnabled, matchFoundSoundEnabled, waitingTracks]);

  useEffect(() => {
    if (!enabled || !waiting || !waitingMusicEnabled) return;
    const resumePlayback = () => matchmakingAudioPlayer.startWaitingMusic(waitingTracks);
    window.addEventListener('pointerdown', resumePlayback, true);
    window.addEventListener('keydown', resumePlayback, true);
    return () => {
      window.removeEventListener('pointerdown', resumePlayback, true);
      window.removeEventListener('keydown', resumePlayback, true);
    };
  }, [enabled, waiting, waitingMusicEnabled, waitingTracks]);

  useEffect(() => () => matchmakingAudioPlayer.reset(), []);

  return null;
}
