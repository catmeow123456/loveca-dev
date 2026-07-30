import { describe, expect, it } from 'vitest';
import {
  derivePhaseAnnouncement,
  type PhaseAnnouncementSnapshot,
} from '../../client/src/lib/phaseAnnouncement';
import { GamePhase } from '../../src/shared/types/enums';

function snapshot(
  phase: GamePhase,
  options: Partial<PhaseAnnouncementSnapshot> = {}
): PhaseAnnouncementSnapshot {
  return {
    matchId: 'match-1',
    phase,
    activeSeat: 'FIRST',
    turnCount: 1,
    ...options,
  };
}

describe('phase announcement', () => {
  it('首次取得对局状态或切换对局时只建立基线', () => {
    expect(derivePhaseAnnouncement(null, snapshot(GamePhase.MAIN_PHASE))).toBeNull();
    expect(
      derivePhaseAnnouncement(
        snapshot(GamePhase.DRAW_PHASE),
        snapshot(GamePhase.MAIN_PHASE, { matchId: 'match-2' })
      )
    ).toBeNull();
  });

  it('进入主要阶段时生成带行动玩家的完整报幕', () => {
    const announcement = derivePhaseAnnouncement(
      snapshot(GamePhase.DRAW_PHASE),
      snapshot(GamePhase.MAIN_PHASE),
      { activePlayerName: '测试玩家' }
    );

    expect(announcement).toMatchObject({
      phase: GamePhase.MAIN_PHASE,
      tone: 'MAIN',
      variant: 'PHASE_START',
      title: '主要阶段',
      detail: '测试玩家可以让成员登场或发动起动效果',
    });
  });

  it('自动阶段被快照折叠后仍能识别另一位玩家的主要阶段', () => {
    const announcement = derivePhaseAnnouncement(
      snapshot(GamePhase.MAIN_PHASE, { activeSeat: 'FIRST' }),
      snapshot(GamePhase.MAIN_PHASE, { activeSeat: 'SECOND' }),
      { activePlayerName: '后攻玩家' }
    );

    expect(announcement).toMatchObject({
      tone: 'MAIN',
      variant: 'PHASE_START',
      title: '主要阶段',
    });
    expect(announcement?.id).toContain('SECOND');
  });

  it('区分 LIVE 设置开始和阶段内行动权交接', () => {
    const phaseStart = derivePhaseAnnouncement(
      snapshot(GamePhase.MAIN_PHASE, { activeSeat: 'SECOND' }),
      snapshot(GamePhase.LIVE_SET_PHASE, { activeSeat: 'FIRST' })
    );
    const handoff = derivePhaseAnnouncement(
      snapshot(GamePhase.LIVE_SET_PHASE, { activeSeat: 'FIRST' }),
      snapshot(GamePhase.LIVE_SET_PHASE, { activeSeat: 'SECOND' }),
      { activePlayerName: '后攻玩家' }
    );

    expect(phaseStart).toMatchObject({
      tone: 'LIVE_SET',
      variant: 'PHASE_START',
      title: 'LIVE 设置',
    });
    expect(handoff).toMatchObject({
      tone: 'LIVE_SET',
      variant: 'HANDOFF',
      title: '轮到后攻玩家盖放 LIVE',
    });
  });

  it('区分 LIVE 开始和双方表演交接', () => {
    const phaseStart = derivePhaseAnnouncement(
      snapshot(GamePhase.LIVE_SET_PHASE, { activeSeat: 'SECOND' }),
      snapshot(GamePhase.PERFORMANCE_PHASE, { activeSeat: 'FIRST' })
    );
    const handoff = derivePhaseAnnouncement(
      snapshot(GamePhase.PERFORMANCE_PHASE, { activeSeat: 'FIRST' }),
      snapshot(GamePhase.PERFORMANCE_PHASE, { activeSeat: 'SECOND' }),
      { activePlayerName: '后攻玩家' }
    );

    expect(phaseStart).toMatchObject({
      tone: 'LIVE_START',
      variant: 'PHASE_START',
      title: 'LIVE 开始',
    });
    expect(handoff).toMatchObject({
      tone: 'LIVE_START',
      variant: 'HANDOFF',
      title: '后攻玩家开始表演',
    });
  });

  it('普通子阶段变化和无关阶段不重复生成报幕', () => {
    expect(
      derivePhaseAnnouncement(
        snapshot(GamePhase.LIVE_SET_PHASE),
        snapshot(GamePhase.LIVE_SET_PHASE)
      )
    ).toBeNull();
    expect(
      derivePhaseAnnouncement(snapshot(GamePhase.ACTIVE_PHASE), snapshot(GamePhase.ENERGY_PHASE))
    ).toBeNull();
  });
});
