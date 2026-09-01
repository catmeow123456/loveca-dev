import { useEffect, useMemo, useState } from 'react';
import {
  matchmakingAudioPlayer,
  resolveMatchmakingAudioState,
  resolveMatchmakingTrackUrls,
  type MatchmakingQueueStatus,
} from '@/lib/matchmakingAudio';
import { fetchMatchmakingBgmLibrary, type MatchmakingBgmTrack } from '@/lib/matchmakingBgmClient';
import { usePublicTableStore } from '@/store/publicTableStore';
import { useRankedStore } from '@/store/rankedStore';
import { useThemeTableStore } from '@/store/themeTableStore';

export function MatchmakingAudioLayer({
  enabled,
  waitingMusicEnabled,
  matchFoundSoundEnabled,
  preferredTrackIds,
}: {
  enabled: boolean;
  waitingMusicEnabled: boolean;
  matchFoundSoundEnabled: boolean;
  preferredTrackIds: readonly string[] | null;
}) {
  const publicTableStatus = usePublicTableStore((state) => (state.hydrated ? state.status : null));
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
    if (!enabled || !waitingMusicEnabled) return;
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
