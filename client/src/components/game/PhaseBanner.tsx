import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  derivePhaseAnnouncement,
  type PhaseAnnouncementCopy,
  type PhaseAnnouncementSnapshot,
  type PhaseAnnouncementTone,
} from '@/lib/phaseAnnouncement';
import { useGameStore } from '@/store/gameStore';
import { GamePhase } from '@game/shared/types/enums';

export const PhaseBanner = memo(function PhaseBanner() {
  const showLegacyBanner = useGameStore((s) => s.ui.showPhaseBanner);
  const legacyBannerText = useGameStore((s) => s.ui.phaseBannerText);
  const matchView = useGameStore((s) => s.playerViewState?.match ?? null);
  const replaySession = useGameStore((s) => s.replaySession);
  const reduceMotion = useReducedMotion() === true;
  const previousSnapshotRef = useRef<PhaseAnnouncementSnapshot | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [phaseAnnouncement, setPhaseAnnouncement] = useState<PhaseAnnouncementCopy | null>(null);

  useEffect(() => {
    if (!matchView) {
      previousSnapshotRef.current = null;
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setPhaseAnnouncement(null);
      return;
    }

    const currentSnapshot: PhaseAnnouncementSnapshot = {
      matchId: matchView.matchId,
      phase: matchView.phase as GamePhase,
      activeSeat: matchView.activeSeat,
      turnCount: matchView.turnCount,
    };
    const previousSnapshot = previousSnapshotRef.current;
    previousSnapshotRef.current = currentSnapshot;

    if (replaySession) {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setPhaseAnnouncement(null);
      return;
    }

    const activePlayerName = matchView.activeSeat
      ? matchView.participants[matchView.activeSeat]?.name
      : null;
    const nextAnnouncement = derivePhaseAnnouncement(previousSnapshot, currentSnapshot, {
      activePlayerName,
    });
    if (!nextAnnouncement) {
      return;
    }

    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    setPhaseAnnouncement(nextAnnouncement);
    hideTimerRef.current = window.setTimeout(
      () => {
        setPhaseAnnouncement(null);
        hideTimerRef.current = null;
      },
      nextAnnouncement.variant === 'HANDOFF' ? 900 : 1150
    );
  }, [
    matchView?.activeSeat,
    matchView?.matchId,
    matchView?.participants,
    matchView?.phase,
    matchView?.turnCount,
    replaySession,
  ]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const legacyAnnouncement = useMemo<PhaseAnnouncementCopy | null>(() => {
    if (!showLegacyBanner || !legacyBannerText) {
      return null;
    }

    return {
      id: `legacy:${legacyBannerText}`,
      phase: GamePhase.SETUP,
      tone: 'LIVE_START',
      variant: 'PHASE_START',
      title: legacyBannerText,
      detail: '',
    };
  }, [legacyBannerText, showLegacyBanner]);
  const announcement = legacyAnnouncement ?? phaseAnnouncement;
  const activePlayerName =
    matchView?.activeSeat && matchView.participants[matchView.activeSeat]?.name;
  const eyebrow = announcement
    ? announcement.variant === 'HANDOFF'
      ? '行动权交接'
      : matchView
        ? `T${matchView.turnCount} · ${activePlayerName ? `${activePlayerName}行动` : '共同阶段'}`
        : '对局提示'
    : '';
  const tone = announcement ? PHASE_TONES[announcement.tone] : PHASE_TONES.LIVE_START;

  return (
    <AnimatePresence mode="wait">
      {announcement && (
        <motion.div
          key={announcement.id}
          data-phase-announcement
          data-phase={announcement.phase}
          data-variant={announcement.variant}
          className={cn(
            'pointer-events-none fixed inset-x-0 top-[30%] z-[var(--z-phase-banner)] flex -translate-y-1/2 items-center justify-center px-3 sm:top-[34%] sm:px-6',
            announcement.variant === 'HANDOFF' ? 'sm:top-[28%]' : ''
          )}
          role="status"
          aria-live="polite"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -9, scale: 0.995 }}
          transition={{
            duration: reduceMotion ? 0.08 : announcement.variant === 'HANDOFF' ? 0.16 : 0.2,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <div
            className={cn(
              'flex w-full items-center gap-2 sm:gap-4',
              announcement.variant === 'HANDOFF' ? 'max-w-[560px]' : 'max-w-[760px]'
            )}
          >
            <div
              className={cn('h-px min-w-4 flex-1 bg-gradient-to-r from-transparent', tone.rail)}
              aria-hidden="true"
            />
            <div
              className={cn(
                'relative overflow-hidden border bg-[color:color-mix(in_srgb,var(--bg-frosted)_91%,transparent)] text-center shadow-[var(--shadow-lg)] backdrop-blur-xl',
                tone.border,
                tone.glow,
                announcement.variant === 'HANDOFF'
                  ? 'min-w-0 rounded-xl px-5 py-2.5 sm:px-8'
                  : 'w-[min(86vw,500px)] rounded-2xl px-6 py-4 sm:px-10 sm:py-5'
              )}
            >
              <div
                className={cn(
                  'absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-current to-transparent',
                  tone.text
                )}
                aria-hidden="true"
              />
              <p
                className={cn(
                  'font-mono text-[9px] font-bold uppercase tracking-[0.22em] sm:text-[10px]',
                  tone.text
                )}
              >
                {eyebrow}
              </p>
              <h1
                className={cn(
                  'mt-1 font-black text-[var(--text-primary)]',
                  announcement.variant === 'HANDOFF'
                    ? 'text-base tracking-[0.06em] sm:text-lg'
                    : 'text-2xl tracking-[0.12em] sm:text-3xl'
                )}
              >
                {announcement.title}
              </h1>
              {announcement.detail && (
                <p className="mt-1 text-[10px] font-medium tracking-[0.02em] text-[var(--text-secondary)] sm:text-xs">
                  {announcement.detail}
                </p>
              )}
            </div>
            <div
              className={cn('h-px min-w-4 flex-1 bg-gradient-to-l from-transparent', tone.rail)}
              aria-hidden="true"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

const PHASE_TONES: Record<
  PhaseAnnouncementTone,
  {
    readonly border: string;
    readonly glow: string;
    readonly rail: string;
    readonly text: string;
  }
> = {
  MAIN: {
    border: 'border-cyan-300/35',
    glow: 'shadow-[0_14px_48px_-24px_rgba(34,211,238,0.72)]',
    rail: 'to-cyan-300/70',
    text: 'text-cyan-300',
  },
  LIVE_SET: {
    border: 'border-amber-300/40',
    glow: 'shadow-[0_14px_48px_-24px_rgba(251,191,36,0.72)]',
    rail: 'to-amber-300/75',
    text: 'text-amber-300',
  },
  LIVE_START: {
    border: 'border-rose-300/40',
    glow: 'shadow-[0_14px_52px_-22px_rgba(251,113,133,0.76)]',
    rail: 'to-rose-300/75',
    text: 'text-rose-300',
  },
};

export default PhaseBanner;
