import { describe, expect, it } from 'vitest';
import {
  createConfirmStepCommand,
  createEndPhaseCommand,
  createMoveOwnedCardToZoneCommand,
  createMoveTableCardCommand,
  createPlayMemberToSlotCommand,
  createSetLiveCardCommand,
  createSubmitJudgmentCommand,
  createSubmitScoreCommand,
  createTapMemberCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import {
  CardType,
  GamePhase,
  GameMode,
  HeartColor,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

describe('规则模式玩家命令防火墙', () => {
  it('客户端伪造 freePlay 也不能在 Live、判定或结算阶段登场', () => {
    const session = createInitializedSession();
    const memberId = findOwnedCardId(session.state!, CardType.MEMBER);

    for (const [phase, subPhase] of [
      [GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_PLAYER],
      [GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_JUDGMENT],
      [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SETTLEMENT],
    ] as const) {
      forceWindow(session.state!, phase, subPhase);
      const result = session.executeCommand(
        createPlayMemberToSlotCommand(P1, memberId, SlotPosition.LEFT, { freePlay: true })
      );
      expect(result.success, `${phase}/${subPhase}`).toBe(false);
      expect(result.error).toContain('主要阶段');
    }
  });

  it('只允许在主要阶段的 NONE 子阶段结束阶段', () => {
    const session = createInitializedSession();

    for (const [phase, subPhase] of [
      [GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_PLAYER],
      [GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_JUDGMENT],
      [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SETTLEMENT],
    ] as const) {
      forceWindow(session.state!, phase, subPhase);
      const result = session.executeCommand(createEndPhaseCommand(P1));
      expect(result.success, `${phase}/${subPhase}`).toBe(false);
      expect(result.error).toContain('主要阶段');
    }
  });

  it('规则模式拒绝手动整理和 Live 设置阶段明置载荷', () => {
    const session = createInitializedSession();
    forceWindow(session.state!, GamePhase.MAIN_PHASE, SubPhase.NONE);
    const manual = session.executeCommand(
      createTapMemberCommand(P1, 'forged-member', SlotPosition.LEFT)
    );
    expect(manual.success).toBe(false);
    expect(manual.error).toContain('规则模式');

    const liveId = findOwnedCardId(session.state!, CardType.LIVE);
    forceCardIntoHand(session.state!, P1, liveId);
    forceWindow(session.state!, GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_PLAYER);
    const faceUp = session.executeCommand(createSetLiveCardCommand(P1, liveId, false));
    expect(faceUp.success).toBe(false);
    expect(faceUp.error).toContain('里侧');
  });

  it('判定、分数和自动子阶段拒绝伪造的直接确认与载荷覆写', () => {
    const session = createInitializedSession();
    const liveId = findOwnedCardId(session.state!, CardType.LIVE);
    forceLiveZoneCard(session.state!, P1, liveId);
    forceWindow(session.state!, GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_JUDGMENT);

    const directConfirm = session.executeCommand(
      createConfirmStepCommand(P1, SubPhase.PERFORMANCE_JUDGMENT)
    );
    expect(directConfirm.success).toBe(false);
    expect(directConfirm.error).toContain('先提交');

    const overriddenJudgment = session.executeCommand(
      createSubmitJudgmentCommand(P1, new Map([[liveId, true]]))
    );
    expect(overriddenJudgment.success).toBe(false);
    expect(overriddenJudgment.error).toContain('自动判定');

    forceWindow(session.state!, GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SCORE_CONFIRM);
    (session.state!.liveResolution.playerScores as Map<string, number>).set(P1, 3);
    const directScoreConfirm = session.executeCommand(
      createConfirmStepCommand(P1, SubPhase.RESULT_SCORE_CONFIRM)
    );
    expect(directScoreConfirm.success).toBe(false);
    expect(directScoreConfirm.error).toContain('分数确认');
    const overriddenScore = session.executeCommand(createSubmitScoreCommand(P1, 4));
    expect(overriddenScore.success).toBe(false);
    expect(overriddenScore.error).toContain('不能手动修改');

    forceWindow(session.state!, GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_DRAW);
    const automatic = session.executeCommand(
      createConfirmStepCommand(P1, SubPhase.LIVE_SET_FIRST_DRAW)
    );
    expect(automatic.success).toBe(false);
    expect(automatic.error).toContain('不能由玩家手动确认');
  });

  it('advancePhase 不再绕过 pending 效果与命令策略', () => {
    const session = createInitializedSession();
    forceWindow(session.state!, GamePhase.MAIN_PHASE, SubPhase.NONE);
    (session.state as unknown as { activeEffect: GameState['activeEffect'] }).activeEffect = {
      id: 'effect',
      abilityId: 'ability',
      sourceCardId: 'source',
      controllerId: P1,
      effectText: '效果',
      stepId: 'STEP',
      stepText: '请确认',
      awaitingPlayerId: P1,
    };

    const result = session.advancePhase(P1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('卡牌效果');
  });

  it('FREE 手动从非舞台登场的成员在切回 RULES 后仍锁定当前区域', () => {
    const session = createInitializedSession();
    forceWindow(session.state!, GamePhase.MAIN_PHASE, SubPhase.NONE);
    const player = session.state!.players[0];
    const memberIds = player.hand.cardIds.filter(
      (cardId) => session.state!.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberIds.length).toBeGreaterThanOrEqual(2);
    const [manualMemberId, incomingMemberId] = memberIds as [string, string, ...string[]];
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== manualMemberId);
    player.waitingRoom.cardIds = [...player.waitingRoom.cardIds, manualMemberId];

    session.setManualOperationMode('FREE');
    const moved = session.executeCommand(
      createMoveTableCardCommand(P1, manualMemberId, ZoneType.WAITING_ROOM, ZoneType.MEMBER_SLOT, {
        targetSlot: SlotPosition.LEFT,
      })
    );
    expect(moved.success, moved.error).toBe(true);
    expect(session.state!.players[0].movedToStageThisTurn).toContain(manualMemberId);

    const ownedMemberId = session.state!.players[0].mainDeck.cardIds.find(
      (cardId) => session.state!.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    )!;
    const movedOwned = session.executeCommand(
      createMoveOwnedCardToZoneCommand(
        P1,
        ownedMemberId,
        ZoneType.MAIN_DECK,
        ZoneType.MEMBER_SLOT,
        { targetSlot: SlotPosition.CENTER }
      )
    );
    expect(movedOwned.success, movedOwned.error).toBe(true);
    expect(session.state!.players[0].movedToStageThisTurn).toContain(ownedMemberId);

    session.setManualOperationMode('RULES');
    const blocked = session.executeCommand(
      createPlayMemberToSlotCommand(P1, incomingMemberId, SlotPosition.LEFT)
    );
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('本回合刚登场');
  });

  it('有合法候选时联机 RULES 必须选1张成功 Live，本地调试、对墙打与 FREE 可 skip', () => {
    const live = createCardInstance(createLiveCard('SUCCESS-LIVE'), P1, 'success-live');
    let game = registerCards(createGameState('success-skip', P1, 'P1', P2, 'P2'), [live]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      isStarted: true,
      manualOperationMode: 'RULES',
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map([[live.instanceId, true]]),
        liveWinnerIds: [P1],
      },
    };
    const session = createGameSession();
    session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });

    const skip = session.executeCommand(
      createConfirmStepCommand(P1, SubPhase.RESULT_SETTLEMENT, {
        skipSuccessLiveSelection: true,
      })
    );
    expect(skip.success).toBe(false);
    expect(skip.error).toContain('必须选择1张');
    const rulesView = session.getPlayerViewState(P1)!;
    expect(rulesView.match.liveResult?.successLiveSelection?.canSkipToWaitingRoom).toBe(false);
    expect(
      rulesView.permissions.availableCommands.find(
        (hint) => hint.command === GameCommandType.SELECT_SUCCESS_LIVE
      )?.params?.canSkipSuccessLiveSelection
    ).toBe(false);

    const localDebugSession = createGameSession({ allowRulesModeSuccessLiveSkip: true });
    localDebugSession.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    const localDebugView = localDebugSession.getPlayerViewState(P1)!;
    expect(localDebugView.match.liveResult?.successLiveSelection?.canSkipToWaitingRoom).toBe(true);
    expect(
      localDebugView.permissions.availableCommands.find(
        (hint) => hint.command === GameCommandType.SELECT_SUCCESS_LIVE
      )?.params?.canSkipSuccessLiveSelection
    ).toBe(true);
    const localDebugSkip = localDebugSession.executeCommand(
      createConfirmStepCommand(P1, SubPhase.RESULT_SETTLEMENT, {
        skipSuccessLiveSelection: true,
      })
    );
    expect(localDebugSkip.success, localDebugSkip.error).toBe(true);

    const solitaireSession = createGameSession({ gameMode: GameMode.SOLITAIRE });
    solitaireSession.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    expect(
      solitaireSession.getPlayerViewState(P1)?.match.liveResult?.successLiveSelection
        ?.canSkipToWaitingRoom
    ).toBe(true);
    const solitaireSkip = solitaireSession.executeCommand(
      createConfirmStepCommand(P1, SubPhase.RESULT_SETTLEMENT, {
        skipSuccessLiveSelection: true,
      })
    );
    expect(solitaireSkip.success, solitaireSkip.error).toBe(true);

    const freeSession = createGameSession();
    freeSession.restoreRuntimeState({
      authorityState: { ...game, manualOperationMode: 'FREE' },
      currentPublicSeq: 0,
    });
    const freeSkip = freeSession.executeCommand(
      createConfirmStepCommand(P1, SubPhase.RESULT_SETTLEMENT, {
        skipSuccessLiveSelection: true,
      })
    );
    expect(freeSkip.success, freeSkip.error).toBe(true);
  });
});

function createInitializedSession() {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('rules-firewall', P1, 'P1', P2, 'P2');
  expect(session.initializeGame(deck, deck).success).toBe(true);
  return session;
}

function forceWindow(state: GameState, phase: GamePhase, subPhase: SubPhase): void {
  const mutable = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutable.currentPhase = phase;
  mutable.currentSubPhase = subPhase;
  mutable.activePlayerIndex = 0;
  mutable.waitingPlayerId = null;
}

function findOwnedCardId(state: GameState, cardType: CardType): string {
  const card = [...state.cardRegistry.values()].find(
    (candidate) => candidate.ownerId === P1 && candidate.data.cardType === cardType
  );
  expect(card).toBeTruthy();
  return card!.instanceId;
}

function forceCardIntoHand(state: GameState, playerId: string, cardId: string): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  const handCardIds = player.hand.cardIds as string[];
  handCardIds.splice(0, handCardIds.length, cardId, ...handCardIds.filter((id) => id !== cardId));
  const mainDeckCardIds = player.mainDeck.cardIds as string[];
  mainDeckCardIds.splice(
    0,
    mainDeckCardIds.length,
    ...mainDeckCardIds.filter((id) => id !== cardId)
  );
}

function forceLiveZoneCard(state: GameState, playerId: string, cardId: string): void {
  forceCardIntoHand(state, playerId, cardId);
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  const handCardIds = player.hand.cardIds as string[];
  handCardIds.splice(0, handCardIds.length, ...handCardIds.filter((id) => id !== cardId));
  const liveCardIds = player.liveZone.cardIds as string[];
  liveCardIds.splice(0, liveCardIds.length, cardId);
}

function createDeck(): DeckConfig {
  const mainDeck: Array<MemberCardData | LiveCardData> = [];
  const energyDeck: EnergyCardData[] = [];
  for (let index = 0; index < 48; index += 1) {
    mainDeck.push(createMemberCard(`MEM-${index}`));
  }
  for (let index = 0; index < 12; index += 1) {
    mainDeck.push(createLiveCard(`LIVE-${index}`));
    energyDeck.push({
      cardCode: `ENERGY-${index}`,
      name: `Energy ${index}`,
      cardType: CardType.ENERGY,
    });
  }
  return { mainDeck, energyDeck };
}

function createMemberCard(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 99,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}
