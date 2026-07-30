import type { Seat } from '@game/online';
import { GamePhase } from '@game/shared/types/enums';

export type PhaseAnnouncementTone = 'MAIN' | 'LIVE_SET' | 'LIVE_START';
export type PhaseAnnouncementVariant = 'PHASE_START' | 'HANDOFF';

export interface PhaseAnnouncementSnapshot {
  readonly matchId: string;
  readonly phase: GamePhase;
  readonly activeSeat: Seat | null;
  readonly turnCount: number;
}

export interface PhaseAnnouncementCopy {
  readonly id: string;
  readonly phase: GamePhase;
  readonly tone: PhaseAnnouncementTone;
  readonly variant: PhaseAnnouncementVariant;
  readonly title: string;
  readonly detail: string;
}

interface PhaseAnnouncementContext {
  readonly activePlayerName?: string | null;
}

function getActivePlayerLabel(context: PhaseAnnouncementContext): string {
  return context.activePlayerName?.trim() || '当前玩家';
}

function createAnnouncement(
  snapshot: PhaseAnnouncementSnapshot,
  copy: Omit<PhaseAnnouncementCopy, 'id' | 'phase'>
): PhaseAnnouncementCopy {
  return {
    ...copy,
    id: [
      snapshot.matchId,
      snapshot.turnCount,
      snapshot.phase,
      snapshot.activeSeat ?? 'SHARED',
      copy.variant,
    ].join(':'),
    phase: snapshot.phase,
  };
}

export function derivePhaseAnnouncement(
  previous: PhaseAnnouncementSnapshot | null,
  current: PhaseAnnouncementSnapshot,
  context: PhaseAnnouncementContext = {}
): PhaseAnnouncementCopy | null {
  if (!previous || previous.matchId !== current.matchId) {
    return null;
  }

  const activePlayerChanged = previous.activeSeat !== current.activeSeat;
  const activePlayerLabel = getActivePlayerLabel(context);

  if (
    current.phase === GamePhase.MAIN_PHASE &&
    (previous.phase !== GamePhase.MAIN_PHASE || activePlayerChanged)
  ) {
    return createAnnouncement(current, {
      tone: 'MAIN',
      variant: 'PHASE_START',
      title: '主要阶段',
      detail: `${activePlayerLabel}可以让成员登场或发动起动效果`,
    });
  }

  if (current.phase === GamePhase.LIVE_SET_PHASE) {
    if (previous.phase !== GamePhase.LIVE_SET_PHASE) {
      return createAnnouncement(current, {
        tone: 'LIVE_SET',
        variant: 'PHASE_START',
        title: 'LIVE 设置',
        detail: '双方依次从手牌盖放 LIVE 卡',
      });
    }

    if (activePlayerChanged) {
      return createAnnouncement(current, {
        tone: 'LIVE_SET',
        variant: 'HANDOFF',
        title: `轮到${activePlayerLabel}盖放 LIVE`,
        detail: 'LIVE 设置继续',
      });
    }
  }

  if (current.phase === GamePhase.PERFORMANCE_PHASE) {
    if (previous.phase !== GamePhase.PERFORMANCE_PHASE) {
      return createAnnouncement(current, {
        tone: 'LIVE_START',
        variant: 'PHASE_START',
        title: 'LIVE 开始',
        detail: '翻开 LIVE，处理 LIVE 开始时效果',
      });
    }

    if (activePlayerChanged) {
      return createAnnouncement(current, {
        tone: 'LIVE_START',
        variant: 'HANDOFF',
        title: `${activePlayerLabel}开始表演`,
        detail: '继续处理 LIVE 与判定',
      });
    }
  }

  return null;
}
