import { useEffect } from 'react';
import {
  matchmakingAudioPlayer,
  resolveMatchmakingAudioState,
  type MatchmakingQueueStatus,
} from '@/lib/matchmakingAudio';
import { usePublicTableStore } from '@/store/publicTableStore';
import { useRankedStore } from '@/store/rankedStore';
import { useThemeTableStore } from '@/store/themeTableStore';

export function MatchmakingAudioLayer({ enabled }: { enabled: boolean }) {
  const publicTableStatus = usePublicTableStore((state) => (state.hydrated ? state.status : null));
  const rankedStatus = useRankedStore((state) => state.overview?.queue ?? null);
  const themeTableStatus = useThemeTableStore((state) => state.overview?.queue ?? null);

  const queues: readonly MatchmakingQueueStatus[] = [
    { kind: 'public-table', status: publicTableStatus },
    { kind: 'ranked', status: rankedStatus },
    { kind: 'theme-table', status: themeTableStatus },
  ];
  const { matchIdentity, waiting } = resolveMatchmakingAudioState(queues);

  useEffect(() => {
    if (!enabled) {
      matchmakingAudioPlayer.reset();
      return;
    }
    if (matchIdentity) {
      matchmakingAudioPlayer.announceMatch(matchIdentity);
      return;
    }
    if (waiting) {
      matchmakingAudioPlayer.startWaitingMusic();
      return;
    }
    matchmakingAudioPlayer.stopWaitingMusic();
  }, [enabled, matchIdentity, waiting]);

  useEffect(() => {
    if (!enabled || !waiting) return;
    const resumePlayback = () => matchmakingAudioPlayer.startWaitingMusic();
    window.addEventListener('pointerdown', resumePlayback, true);
    window.addEventListener('keydown', resumePlayback, true);
    return () => {
      window.removeEventListener('pointerdown', resumePlayback, true);
      window.removeEventListener('keydown', resumePlayback, true);
    };
  }, [enabled, waiting]);

  useEffect(() => () => matchmakingAudioPlayer.reset(), []);

  return null;
}
