import { describe, expect, it } from 'vitest';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import type { ActiveEffectState, PendingAbilityState } from '../../src/domain/entities/game';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { addCardToStatefulZone, removeCardFromZone } from '../../src/domain/entities/zone';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { createManualMoveCardAction } from '../../src/application/actions';
import { ABILITY_ORDER_SELECTION_ID } from '../../src/application/card-effect-runner';
import {
  GameCommandType,
  createAttachEnergyToMemberCommand,
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createConfirmPerformanceOutcomeCommand,
  createDrawCardToHandCommand,
  createDrawEnergyToZoneCommand,
  createEndPhaseCommand,
  createFinishInspectionCommand,
  createFinishInspectionWithArrangementCommand,
  createMulliganCommand,
  createRevealInspectedCardCommand,
  createMoveInspectedCardToZoneCommand,
  createMoveInspectedCardToTopCommand,
  createMoveInspectedCardToBottomCommand,
  createMoveMemberToSlotCommand,
  createMoveOwnedCardToZoneCommand,
  createMovePublicCardToEnergyDeckCommand,
  createMoveResolutionCardToZoneCommand,
  createMovePublicCardToHandCommand,
  createMovePublicCardToWaitingRoomCommand,
  createMoveTableCardCommand,
  createRevealCheerCardCommand,
  createOpenInspectionCommand,
  createPlayMemberToSlotCommand,
  createReorderInspectedCardCommand,
  createReturnHandCardToTopCommand,
  createSetLiveCardCommand,
  createSelectSuccessLiveCommand,
  createSubmitJudgmentCommand,
  createSubmitScoreCommand,
  createTapEnergyCommand,
  createTapMemberCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createPublicObjectId } from '../../src/online/projector';
import { fromTransport, toTransport } from '../../src/online/serde';
import type { PublicEvent, PublicZoneRef } from '../../src/online/types';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createTestMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createTestLiveCard(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `能量 ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createTestDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let i = 0; i < 48; i++) {
    mainDeck.push(createTestMemberCard(`MEM-${i}`, `成员 ${i}`));
  }

  for (let i = 0; i < 12; i++) {
    mainDeck.push(createTestLiveCard(`LIVE-${i}`, `Live ${i}`));
    energyDeck.push(createTestEnergyCard(`ENE-${i}`));
  }

  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(
  session: ReturnType<typeof createGameSession>,
  activePlayerIndex = 0
): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = activePlayerIndex;
  state.waitingPlayerId = null;
}

function expectNoDuplicateCardMoveEvents(events: readonly PublicEvent[]): void {
  const seenSeqByKey = new Map<string, number>();

  for (const event of events) {
    if (event.type !== 'CardMovedPublic' && event.type !== 'CardRevealedAndMoved') {
      continue;
    }
    if (!event.card) {
      continue;
    }

    const key = [
      event.card.publicObjectId,
      formatMoveDedupeZone(event.from),
      formatMoveDedupeZone(event.to),
    ].join('|');
    const previousSeq = seenSeqByKey.get(key);
    if (previousSeq !== undefined) {
      throw new Error(`重复公开移动事件: ${key} firstSeq=${previousSeq} duplicateSeq=${event.seq}`);
    }
    seenSeqByKey.set(key, event.seq);
  }
}

function formatMoveDedupeZone(ref?: PublicZoneRef): string {
  if (!ref) {
    return 'NONE';
  }

  return [ref.zone, ref.ownerSeat ?? '', ref.slot ?? ''].join(':');
}

function getEnabledCommand(
  view: ReturnType<ReturnType<typeof createGameSession>['getPlayerViewState']>,
  command: GameCommandType
) {
  return view?.permissions.availableCommands.find(
    (hint) => hint.command === command && hint.enabled
  );
}

function installNonInspectionActiveEffect(
  session: ReturnType<typeof createGameSession>
): { activeEffect: ActiveEffectState; sourceCardId: string } {
  const sourceCardId = session.state?.players[0].hand.cardIds[0];
  expect(sourceCardId).toBeTruthy();

  const pendingAbility: PendingAbilityState = {
    id: 'pending-non-inspection-effect',
    abilityId: 'test:non-inspection-effect',
    sourceCardId: sourceCardId!,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: 'test:timing',
    eventIds: [],
  };
  const activeEffect: ActiveEffectState = {
    id: 'effect-non-inspection',
    abilityId: ABILITY_ORDER_SELECTION_ID,
    sourceCardId: sourceCardId!,
    controllerId: PLAYER1,
    effectText: '测试非检视卡牌效果',
    stepId: 'SELECT_PENDING_EFFECT',
    stepText: '选择要处理的效果',
    awaitingPlayerId: PLAYER1,
    selectableCardIds: [sourceCardId!],
    metadata: {
      pendingAbilityIds: [pendingAbility.id],
    },
  };

  const state = session.state as unknown as {
    activeEffect: ActiveEffectState | null;
    pendingAbilities: PendingAbilityState[];
  };
  state.pendingAbilities = [pendingAbility];
  state.activeEffect = activeEffect;

  return { activeEffect, sourceCardId: sourceCardId! };
}

describe('GameSession command pipeline', () => {
  it('按检视命令打开检视区、移动卡牌并产出公共事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-1', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const topCardId = session.state?.players[0].mainDeck.cardIds[0];
    expect(topCardId).toBeTruthy();

    const openSeq = session.getCurrentPublicEventSeq();
    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );

    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toContain(topCardId);

    const openEvents = session.getPublicEventsSince(openSeq);
    expect(
      openEvents.some(
        (event) =>
          event.type === 'CardsInspectedSummary' &&
          event.actorSeat === 'FIRST' &&
          event.sourceZone === ZoneType.MAIN_DECK &&
          event.count === 1
      )
    ).toBe(true);
    expect(
      openEvents.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card === undefined &&
          event.count === 1 &&
          event.from?.zone === ZoneType.MAIN_DECK &&
          event.to?.zone === 'INSPECTION_ZONE'
      )
    ).toBe(true);

    const moveSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMoveInspectedCardToZoneCommand(PLAYER1, topCardId!, ZoneType.HAND)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).not.toContain(topCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(topCardId);

    const moveEvents = session.getPublicEventsSince(moveSeq);
    expect(
      moveEvents.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card === undefined &&
          event.count === 1 &&
          event.from?.zone === 'INSPECTION_ZONE' &&
          event.to?.zone === ZoneType.HAND
      )
    ).toBe(true);

    const finishSeq = session.getCurrentPublicEventSeq();
    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER1));

    expect(finishResult.success).toBe(true);

    const finishEvents = session.getPublicEventsSince(finishSeq);
    expect(
      finishEvents.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.actorSeat === 'FIRST' &&
          event.declarationType === 'INSPECTION_FINISHED' &&
          event.publicValue === 0
      )
    ).toBe(true);
  });

  it('主卡组检视数量不足但总张数足够时，会先卡更再打开检视区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-refresh-inspection', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state as unknown as {
      players: Array<{
        mainDeck: { cardIds: string[] };
        waitingRoom: { cardIds: string[] };
      }>;
    };
    const [topA, topB, refreshCard] = state.players[0].mainDeck.cardIds.slice(0, 3);
    state.players[0].mainDeck = {
      ...state.players[0].mainDeck,
      cardIds: [topA, topB],
    };
    state.players[0].waitingRoom = {
      ...state.players[0].waitingRoom,
      cardIds: [refreshCard],
    };

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 3)
    );

    expect(result.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([topA, topB, refreshCard]);

    const events = session.getPublicEventsSince(beforeSeq);
    const deckRefreshIndex = events.findIndex((event) => event.type === 'DeckRefreshed');
    const inspectedSummaryIndex = events.findIndex(
      (event) => event.type === 'CardsInspectedSummary'
    );

    expect(deckRefreshIndex).toBeGreaterThanOrEqual(0);
    expect(inspectedSummaryIndex).toBeGreaterThan(deckRefreshIndex);
  });

  it('检视区重排会更新检视顺序并产出同区公共移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-2', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const firstTopCardId = session.state?.players[0].mainDeck.cardIds[0];
    const secondTopCardId = session.state?.players[0].mainDeck.cardIds[1];
    expect(firstTopCardId).toBeTruthy();
    expect(secondTopCardId).toBeTruthy();

    session.executeCommand(createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 2));
    expect(session.state?.inspectionZone.cardIds.slice(0, 2)).toEqual([
      firstTopCardId,
      secondTopCardId,
    ]);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const reorderResult = session.executeCommand(
      createReorderInspectedCardCommand(PLAYER1, secondTopCardId!, 0)
    );

    expect(reorderResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds.slice(0, 2)).toEqual([
      secondTopCardId,
      firstTopCardId,
    ]);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card === undefined &&
          event.count === 1 &&
          event.from?.zone === 'INSPECTION_ZONE' &&
          event.to?.zone === 'INSPECTION_ZONE' &&
          event.from?.index === 1 &&
          event.to?.index === 0
      )
    ).toBe(true);
  });

  it('可用批量整理命令一次性按当前顺序关闭检视区并放回来源卡组顶', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-inspection-batch-top', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const [firstTopCardId, secondTopCardId, thirdTopCardId] =
      session.state?.players[0].mainDeck.cardIds.slice(0, 3) ?? [];
    expect(firstTopCardId).toBeTruthy();
    expect(secondTopCardId).toBeTruthy();
    expect(thirdTopCardId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 3)
    );
    expect(openResult.success).toBe(true);

    const firstView = session.getPlayerViewState(PLAYER1);
    expect(
      firstView?.permissions.availableCommands.some(
        (hint) => hint.command === GameCommandType.FINISH_INSPECTION_WITH_ARRANGEMENT
      )
    ).toBe(true);

    const arrangedCardIds = [thirdTopCardId!, firstTopCardId!, secondTopCardId!];
    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createFinishInspectionWithArrangementCommand(
        PLAYER1,
        arrangedCardIds,
        ZoneType.MAIN_DECK,
        'TOP'
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds.slice(0, 3)).toEqual(arrangedCardIds);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.filter(
        (event) =>
          event.type === 'CardMovedPublic' && event.from?.zone === 'INSPECTION_ZONE'
      )
    ).toHaveLength(3);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.declarationType === 'INSPECTION_FINISHED'
      )
    ).toBe(true);
  });

  it('activeEffect 卡效控制检视区时不投影通用检视整理命令', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-active-effect-inspection-hints',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const inspectedCardIds = session.state?.players[0].mainDeck.cardIds.slice(0, 2) ?? [];
    const sourceCardId = session.state?.players[0].hand.cardIds[0];
    expect(inspectedCardIds).toHaveLength(2);
    expect(sourceCardId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 2)
    );
    expect(openResult.success).toBe(true);

    const state = session.state as unknown as {
      activeEffect: {
        id: string;
        abilityId: string;
        sourceCardId: string;
        controllerId: string;
        effectText: string;
        stepId: string;
        stepText: string;
        awaitingPlayerId: string | null;
        inspectionCardIds?: readonly string[];
        selectableCardIds?: readonly string[];
        selectableCardMode?: 'SINGLE' | 'ORDERED_MULTI';
        minSelectableCards?: number;
        maxSelectableCards?: number;
      } | null;
    };
    state.activeEffect = {
      id: 'effect-active-inspection',
      abilityId: 'test:active-effect-inspection',
      sourceCardId: sourceCardId!,
      controllerId: PLAYER1,
      effectText: '测试卡效检视',
      stepId: 'SELECT_INSPECTED_CARD',
      stepText: '选择 1 张检视区卡牌',
      awaitingPlayerId: PLAYER1,
      inspectionCardIds: inspectedCardIds,
      selectableCardIds: inspectedCardIds,
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 1,
      maxSelectableCards: 1,
    };

    const view = session.getPlayerViewState(PLAYER1);
    const commands = view?.permissions.availableCommands.map((hint) => hint.command) ?? [];
    const blockedCommands = [
      GameCommandType.OPEN_INSPECTION,
      GameCommandType.REVEAL_INSPECTED_CARD,
      GameCommandType.MOVE_INSPECTED_CARD_TO_TOP,
      GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM,
      GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE,
      GameCommandType.MOVE_CARD_TO_INSPECTION,
      GameCommandType.REORDER_INSPECTED_CARD,
      GameCommandType.FINISH_INSPECTION_WITH_ARRANGEMENT,
      GameCommandType.FINISH_INSPECTION,
    ];

    expect(view?.match.window?.windowType).toBe('INSPECTION');
    expect(view?.match.window?.context?.activeEffectId).toBe('effect-active-inspection');
    for (const command of blockedCommands) {
      expect(commands).not.toContain(command);
    }
    expect(
      view?.permissions.availableCommands.some(
        (hint) => hint.command === GameCommandType.CONFIRM_EFFECT_STEP && hint.enabled
      )
    ).toBe(true);
  });

  it('activeEffect 处理期间拒绝双方玩家打开普通检视区且保留效果状态', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-active-effect-block-open-inspection',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const { activeEffect, sourceCardId } = installNonInspectionActiveEffect(session);
    const player1MainDeckBefore = [...session.state!.players[0].mainDeck.cardIds];
    const player2MainDeckBefore = [...session.state!.players[1].mainDeck.cardIds];

    const player1OpenResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );

    expect(player1OpenResult.success).toBe(false);
    expect(player1OpenResult.error).toContain('当前正在处理卡牌效果，不能打开普通检视区');
    expect(session.state?.activeEffect).toMatchObject({
      id: activeEffect.id,
      abilityId: activeEffect.abilityId,
    });
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(player1MainDeckBefore);
    expect(session.state?.players[1].mainDeck.cardIds).toEqual(player2MainDeckBefore);

    const player2OpenResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER2, ZoneType.MAIN_DECK, 1)
    );

    expect(player2OpenResult.success).toBe(false);
    expect(player2OpenResult.error).toContain('当前正在处理卡牌效果，不能打开普通检视区');
    expect(session.state?.activeEffect).toMatchObject({
      id: activeEffect.id,
      abilityId: activeEffect.abilityId,
    });
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(player1MainDeckBefore);
    expect(session.state?.players[1].mainDeck.cardIds).toEqual(player2MainDeckBefore);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffect.id, sourceCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('activeEffect 存在时双方视图不投影普通 OPEN_INSPECTION 但等待玩家保留效果确认命令', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-active-effect-open-inspection-hints',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);
    installNonInspectionActiveEffect(session);

    const player1View = session.getPlayerViewState(PLAYER1);
    const player2View = session.getPlayerViewState(PLAYER2);
    const player1Commands =
      player1View?.permissions.availableCommands.map((hint) => hint.command) ?? [];
    const player2Commands =
      player2View?.permissions.availableCommands.map((hint) => hint.command) ?? [];

    expect(player1Commands).not.toContain(GameCommandType.OPEN_INSPECTION);
    expect(player2Commands).not.toContain(GameCommandType.OPEN_INSPECTION);
    expect(
      player1View?.permissions.availableCommands.some(
        (hint) => hint.command === GameCommandType.CONFIRM_EFFECT_STEP && hint.enabled
      )
    ).toBe(true);
  });

  it('activeEffect 存在且普通检视已打开时检视 owner 视图不投影普通 OPEN_INSPECTION', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-active-effect-existing-inspection-owner-hints',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER1);
    expect(session.state?.inspectionZone.cardIds).toHaveLength(1);

    installNonInspectionActiveEffect(session);

    const view = session.getPlayerViewState(PLAYER1);
    const commands = view?.permissions.availableCommands.map((hint) => hint.command) ?? [];

    expect(view?.match.window?.windowType).toBe('INSPECTION');
    expect(view?.match.window?.context?.activeEffectId).toBe('effect-non-inspection');
    expect(commands).not.toContain(GameCommandType.OPEN_INSPECTION);
    expect(commands).toContain(GameCommandType.MOVE_INSPECTED_CARD_TO_TOP);
    expect(commands).toContain(GameCommandType.FINISH_INSPECTION);
    expect(
      view?.permissions.availableCommands.some(
        (hint) => hint.command === GameCommandType.CONFIRM_EFFECT_STEP && hint.enabled
      )
    ).toBe(true);
  });

  it('批量整理可以一次性将所有检视牌放入休息室并拒绝遗漏或非法卡牌', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-inspection-batch-waiting-room',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const inspectedCardIds = session.state?.players[0].mainDeck.cardIds.slice(0, 2) ?? [];
    expect(inspectedCardIds).toHaveLength(2);
    const outsiderCardId = session.state?.players[0].hand.cardIds[0];
    expect(outsiderCardId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 2)
    );
    expect(openResult.success).toBe(true);

    const missingCardResult = session.executeCommand(
      createFinishInspectionWithArrangementCommand(
        PLAYER1,
        [inspectedCardIds[0]!],
        ZoneType.WAITING_ROOM
      )
    );
    expect(missingCardResult.success).toBe(false);
    expect(missingCardResult.error).toContain('所有剩余卡牌');

    const outsiderResult = session.executeCommand(
      createFinishInspectionWithArrangementCommand(
        PLAYER1,
        [inspectedCardIds[0]!, outsiderCardId!],
        ZoneType.WAITING_ROOM
      )
    );
    expect(outsiderResult.success).toBe(false);
    expect(outsiderResult.error).toContain('不属于当前检视流程');

    const result = session.executeCommand(
      createFinishInspectionWithArrangementCommand(
        PLAYER1,
        inspectedCardIds,
        ZoneType.WAITING_ROOM
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds.slice(-2)).toEqual(inspectedCardIds);
  });

  it('成员卡从手牌进成员区时不能绕过专用登场命令', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-member-play-guard', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const memberCardId = session.state?.players[0].hand.cardIds.find((cardId) => {
      const card = session.state?.cardRegistry.get(cardId);
      return card?.data.cardType === CardType.MEMBER;
    });
    expect(memberCardId).toBeTruthy();

    const result = session.executeCommand(
      createMoveOwnedCardToZoneCommand(
        PLAYER1,
        memberCardId!,
        ZoneType.HAND,
        ZoneType.MEMBER_SLOT,
        {
          targetSlot: SlotPosition.CENTER,
        }
      )
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('专用登场命令');
  });

  it('检视区仍有未处理卡牌时不能结束检视流程', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-inspection-finish-guard',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toHaveLength(1);

    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER1));

    expect(finishResult.success).toBe(false);
    expect(finishResult.error).toBe('检视区仍有未处理的卡牌');
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER1);
    expect(session.state?.inspectionZone.cardIds).toHaveLength(1);
  });

  it('从能量卡组打开检视后，回顶和回底会回到原来源区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-energy-inspection', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const firstEnergyId = session.state?.players[0].energyDeck.cardIds[0];
    const secondEnergyId = session.state?.players[0].energyDeck.cardIds[1];
    expect(firstEnergyId).toBeTruthy();
    expect(secondEnergyId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.ENERGY_DECK, 2)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionContext?.sourceZone).toBe(ZoneType.ENERGY_DECK);

    const topResult = session.executeCommand(
      createMoveInspectedCardToTopCommand(PLAYER1, firstEnergyId!)
    );
    expect(topResult.success).toBe(true);
    expect(session.state?.players[0].energyDeck.cardIds[0]).toBe(firstEnergyId);

    const bottomResult = session.executeCommand(
      createMoveInspectedCardToBottomCommand(PLAYER1, secondEnergyId!)
    );
    expect(bottomResult.success).toBe(true);
    expect(session.state?.players[0].energyDeck.cardIds.at(-1)).toBe(secondEnergyId);
  });

  it('进行中的检视流程只允许从同一来源区追加', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-inspection-same-source', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const openMainDeckResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openMainDeckResult.success).toBe(true);
    expect(session.state?.inspectionContext?.sourceZone).toBe(ZoneType.MAIN_DECK);

    const appendEnergyDeckResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.ENERGY_DECK, 1)
    );
    expect(appendEnergyDeckResult.success).toBe(false);
    expect(appendEnergyDeckResult.error).toContain('同一来源区');
  });

  it('检视流程进行中时会拒绝非检视命令，并要求清空后才能结束', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-inspection-guard', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const inspectedCardId = session.state?.players[0].mainDeck.cardIds[0];
    const handCardId = session.state?.players[0].hand.cardIds[0];
    expect(inspectedCardId).toBeTruthy();
    expect(handCardId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);

    const endPhaseResult = session.executeCommand(createEndPhaseCommand(PLAYER1));
    expect(endPhaseResult.success).toBe(false);
    expect(endPhaseResult.error).toContain('检视流程');

    const prematureFinishResult = session.executeCommand(createFinishInspectionCommand(PLAYER1));
    expect(prematureFinishResult.success).toBe(false);
    expect(prematureFinishResult.error).toContain('未处理');

    const outsiderResult = session.executeCommand(
      createReturnHandCardToTopCommand(PLAYER2, handCardId!)
    );
    expect(outsiderResult.success).toBe(false);
    // PLAYER2 尝试操作 PLAYER1 的手牌，所有权校验先行拒绝
    expect(outsiderResult.error).toContain('手牌');

    const moveResult = session.executeCommand(
      createMoveInspectedCardToZoneCommand(PLAYER1, inspectedCardId!, ZoneType.HAND)
    );
    expect(moveResult.success).toBe(true);

    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER1));
    expect(finishResult.success).toBe(true);
    expect(session.state?.inspectionContext).toBeNull();
  });

  it('检视区中的牌可以被公开，并让对手看到 FRONT', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-inspection-reveal', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const inspectedCardId = session.state?.players[0].mainDeck.cardIds[0];
    expect(inspectedCardId).toBeTruthy();

    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const revealResult = session.executeCommand(
      createRevealInspectedCardCommand(PLAYER1, inspectedCardId!)
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(inspectedCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardRevealed' &&
          event.actorSeat === 'FIRST' &&
          event.reason === 'INSPECTION_REVEAL' &&
          event.card.publicObjectId === createPublicObjectId(inspectedCardId!)
      )
    ).toBe(true);

    const opponentView = session.getPlayerViewState(PLAYER2);
    const inspectionObjectId = createPublicObjectId(inspectedCardId!);
    expect(opponentView?.objects[inspectionObjectId]?.surface).toBe('FRONT');
    expect(opponentView?.objects[inspectionObjectId]?.frontInfo?.cardCode).toBeDefined();
  });

  it('翻开应援牌会进入解决区并产出 CardRevealed', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-3', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
    };
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    state.activePlayerIndex = 0;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createRevealCheerCardCommand(PLAYER1));
    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.to?.zone === ZoneType.RESOLUTION_ZONE &&
          event.card === undefined &&
          event.count === 1
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'CardRevealed' &&
          event.actorSeat === 'FIRST' &&
          event.reason === 'CHEER_REVEAL' &&
          event.card.cardCode !== undefined
      )
    ).toBe(true);
    expect(session.state?.resolutionZone.revealedCardIds).toHaveLength(1);
  });

  it('进入演出阶段时系统自动翻开 Live 会产出系统公开事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-performance-reveal', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      liveSetCompletedPlayers: string[];
    };
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      liveZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        },
      ],
    ]);

    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
    mutableState.activePlayerIndex = 0;
    mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.advancePhase();
    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardRevealed' &&
          event.source === 'SYSTEM' &&
          event.reason === 'PERFORMANCE_REVEAL' &&
          event.card.publicObjectId === createPublicObjectId(liveCardId!)
      )
    ).toBe(true);
  });

  it('系统自动补能量到公开能量区时会产出公开移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-system-draw-energy', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const topEnergyCardId = session.state?.players[0].energyDeck.cardIds[0];
    expect(topEnergyCardId).toBeTruthy();

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    state.currentPhase = GamePhase.ACTIVE_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    state.activePlayerIndex = 0;
    state.waitingPlayerId = null;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.advancePhase();
    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.source === 'SYSTEM' &&
          event.card?.publicObjectId === createPublicObjectId(topEnergyCardId!) &&
          event.from?.zone === ZoneType.ENERGY_DECK &&
          event.from?.index === 0 &&
          event.to?.zone === ZoneType.ENERGY_ZONE
      )
    ).toBe(true);
  });

  it('主阶段允许用专用命令把能量卡组顶牌放到能量区，并拒绝跨边界万能移动', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-draw-energy-to-zone', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const topEnergyCardId = session.state?.players[0].energyDeck.cardIds[0];
    expect(topEnergyCardId).toBeTruthy();

    const genericMoveResult = session.executeCommand(
      createMoveTableCardCommand(
        PLAYER1,
        topEnergyCardId!,
        ZoneType.ENERGY_DECK,
        ZoneType.ENERGY_ZONE
      )
    );
    expect(genericMoveResult.success).toBe(false);
    expect(genericMoveResult.error).toContain('专用命令');

    const beforeSeq = session.getCurrentPublicEventSeq();
    const drawEnergyResult = session.executeCommand(
      createDrawEnergyToZoneCommand(PLAYER1, topEnergyCardId!)
    );

    expect(drawEnergyResult.success).toBe(true);
    expect(session.state?.players[0].energyDeck.cardIds).not.toContain(topEnergyCardId);
    expect(session.state?.players[0].energyZone.cardIds).toContain(topEnergyCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expectNoDuplicateCardMoveEvents(events);
    expect(
      events.filter(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(topEnergyCardId!) &&
          event.from?.zone === ZoneType.ENERGY_DECK &&
          event.to?.zone === ZoneType.ENERGY_ZONE
      )
    ).toHaveLength(1);
  });

  it('能量区中的能量可以通过专用命令随时拖回能量卡组', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-energy-zone-to-deck', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const energyCardId = session.state?.players[0].energyZone.cardIds[0];
    expect(energyCardId).toBeTruthy();

    const genericMoveResult = session.executeCommand(
      createMoveTableCardCommand(PLAYER1, energyCardId!, ZoneType.ENERGY_ZONE, ZoneType.ENERGY_DECK)
    );
    expect(genericMoveResult.success).toBe(false);
    expect(genericMoveResult.error).toContain('专用命令');

    const beforeSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMovePublicCardToEnergyDeckCommand(PLAYER1, energyCardId!, ZoneType.ENERGY_ZONE)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.players[0].energyZone.cardIds).not.toContain(energyCardId);
    expect(session.state?.players[0].energyDeck.cardIds[0]).toBe(energyCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expectNoDuplicateCardMoveEvents(events);
    expect(
      events.filter(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(energyCardId!) &&
          event.from?.zone === ZoneType.ENERGY_ZONE &&
          event.to?.zone === ZoneType.ENERGY_DECK
      )
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.from?.zone === ZoneType.ENERGY_ZONE &&
          event.to?.zone === ZoneType.ENERGY_ZONE
      )
    ).toHaveLength(0);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.declarationType === 'MOVE_PUBLIC_CARD_TO_ENERGY_DECK'
      )
    ).toBe(true);
  });

  it('Live 放置阶段也允许把能量卡组顶牌放到能量区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-live-set-draw-energy', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    state.currentPhase = GamePhase.LIVE_SET_PHASE;
    state.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    state.activePlayerIndex = 0;
    state.waitingPlayerId = null;

    const topEnergyCardId = session.state?.players[0].energyDeck.cardIds[0];
    expect(topEnergyCardId).toBeTruthy();

    const result = session.executeCommand(createDrawEnergyToZoneCommand(PLAYER1, topEnergyCardId!));

    expect(result.success).toBe(true);
    expect(session.state?.players[0].energyDeck.cardIds).not.toContain(topEnergyCardId);
    expect(session.state?.players[0].energyZone.cardIds).toContain(topEnergyCardId);
  });

  it('Live 放置阶段允许把己方 Live 回手，判定阶段本地成功效果窗口也允许继续回手调整', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-live-return', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    const player = state.players[0];
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        },
      ],
    ]);

    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const returnResult = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER1, liveCardId!, ZoneType.LIVE_ZONE)
    );
    expect(returnResult.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(liveCardId);

    const nextPlayer = session.state!.players[0];
    nextPlayer.hand.cardIds = nextPlayer.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    nextPlayer.liveZone.cardIds = [liveCardId!];
    nextPlayer.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        },
      ],
    ]);

    const blockedPhaseState = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      liveResolution: { performingPlayerId: string | null };
    };
    blockedPhaseState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    blockedPhaseState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    blockedPhaseState.liveResolution.performingPlayerId = PLAYER1;

    const blockedResult = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER1, liveCardId!, ZoneType.LIVE_ZONE)
    );
    expect(blockedResult.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain(liveCardId);
  });

  it('序列化后的 MOVE_OWNED_CARD_TO_ZONE 命令仍可在联机管线中执行', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-owned-zone-transport', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const cardId = session.state?.players[0].mainDeck.cardIds[0];
    expect(cardId).toBeTruthy();

    const serializedCommand = toTransport(
      createMoveOwnedCardToZoneCommand(PLAYER1, cardId!, ZoneType.MAIN_DECK, ZoneType.HAND)
    );
    const command =
      fromTransport<ReturnType<typeof createMoveOwnedCardToZoneCommand>>(serializedCommand);

    const result = session.executeCommand(command);

    expect(result.success).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds).not.toContain(cardId);
    expect(session.state?.players[0].hand.cardIds).toContain(cardId);
  });

  it('表演开始时效果窗口允许把己方 Live 回手调整', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-performance-live-start-return',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
      liveResolution: { performingPlayerId: string | null };
    };
    const player = state.players[0];
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        },
      ],
    ]);

    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_LIVE_START_EFFECTS;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.performingPlayerId = PLAYER1;

    const result = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER1, liveCardId!, ZoneType.LIVE_ZONE)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(liveCardId);
  });

  it('序列化后的 MOVE_PUBLIC_CARD_TO_HAND 命令仍可在表演阶段执行', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-public-hand-transport', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
      liveResolution: { performingPlayerId: string | null };
    };
    const player = state.players[0];
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        },
      ],
    ]);

    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.performingPlayerId = PLAYER1;

    const serializedCommand = toTransport(
      createMovePublicCardToHandCommand(PLAYER1, liveCardId!, ZoneType.LIVE_ZONE)
    );
    const command =
      fromTransport<ReturnType<typeof createMovePublicCardToHandCommand>>(serializedCommand);

    const result = session.executeCommand(command);

    expect(result.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(liveCardId);
  });

  it('解决区命令可在 Live 判定阶段处理应援牌', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-resolution-move', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
    };
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    state.activePlayerIndex = 0;

    const revealResult = session.executeCommand(createRevealCheerCardCommand(PLAYER1));
    expect(revealResult.success).toBe(true);

    const resolutionCardId = session.state?.resolutionZone.cardIds[0];
    expect(resolutionCardId).toBeTruthy();

    const beforeSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMoveResolutionCardToZoneCommand(PLAYER1, resolutionCardId!, ZoneType.WAITING_ROOM)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.resolutionZone.cardIds).not.toContain(resolutionCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(resolutionCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(resolutionCardId!) &&
          event.from?.zone === ZoneType.RESOLUTION_ZONE &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
  });

  it('表演判定中开启检视后仍可翻开应援牌，且不影响检视区内容', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-performance-inspection-cheer',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    state.activePlayerIndex = 0;
    state.waitingPlayerId = null;

    const openInspectionResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openInspectionResult.success).toBe(true);

    const inspectedCardId = session.state?.inspectionZone.cardIds[0];
    expect(inspectedCardId).toBeTruthy();

    const ownerViewDuringInspection = session.getPlayerViewState(PLAYER1);
    const opponentViewDuringInspection = session.getPlayerViewState(PLAYER2);
    expect(
      ownerViewDuringInspection?.permissions.availableCommands.some(
        (hint) => hint.command === 'REVEAL_CHEER_CARD' && hint.enabled
      )
    ).toBe(true);
    expect(ownerViewDuringInspection?.match.window?.windowType).toBe('INSPECTION');
    expect(opponentViewDuringInspection?.match.window?.windowType).toBe('INSPECTION');
    expect(opponentViewDuringInspection?.table.zones.FIRST_INSPECTION_ZONE.count).toBe(1);

    const revealCheerResult = session.executeCommand(createRevealCheerCardCommand(PLAYER1));
    expect(revealCheerResult.success).toBe(true);

    expect(session.state?.inspectionZone.cardIds).toEqual([inspectedCardId!]);
    expect(session.state?.resolutionZone.cardIds).toHaveLength(1);
    expect(session.state?.resolutionZone.cardIds[0]).not.toBe(inspectedCardId);
    expect(session.state?.resolutionZone.revealedCardIds).toEqual(
      session.state?.resolutionZone.cardIds
    );
  });

  it('确认 Live 失败会清空应援区与 Live 区到休息室', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-4', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      resolutionZone: { cardIds: string[]; revealedCardIds: string[] };
    };
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.activePlayerIndex = 0;

    const player = state.players[0] as unknown as {
      mainDeck: { cardIds: string[] };
      hand: { cardIds: string[] };
      liveZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    const resolutionCardId = player.mainDeck.cardIds.find((cardId) => cardId !== liveCardId);

    expect(resolutionCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== resolutionCardId && cardId !== liveCardId
    );
    player.hand.cardIds = player.hand.cardIds.filter(
      (cardId) => cardId !== resolutionCardId && cardId !== liveCardId
    );
    mutableState.resolutionZone.cardIds = [resolutionCardId!];
    mutableState.resolutionZone.revealedCardIds = [resolutionCardId!];
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        },
      ],
    ]);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createConfirmPerformanceOutcomeCommand(PLAYER1, false));
    expect(result.success).toBe(true);

    expect(session.state?.resolutionZone.cardIds).not.toContain(resolutionCardId);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(resolutionCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(liveCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.actorSeat === 'FIRST' &&
          event.declarationType === 'PERFORMANCE_FAILED'
      )
    ).toBe(true);
  });

  it('桌面移动命令只处理公开区之间的移动，抽卡与放回顶部走专用命令', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-5', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    forceMainPhaseForPlayer(session);

    const drawResult = session.executeCommand(createDrawCardToHandCommand(PLAYER1));
    expect(drawResult.success).toBe(true);

    const returnedCardId = session.state?.players[0].hand.cardIds.at(-1);
    expect(returnedCardId).toBeTruthy();

    const returnResult = session.executeCommand(
      createReturnHandCardToTopCommand(PLAYER1, returnedCardId!)
    );
    expect(returnResult.success).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(returnedCardId);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
    };
    const publicCardId = player.hand.cardIds[0];
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== publicCardId);
    player.waitingRoom.cardIds = [publicCardId!];
    expect(publicCardId).toBeTruthy();

    const beforeSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMoveTableCardCommand(
        PLAYER1,
        publicCardId!,
        ZoneType.WAITING_ROOM,
        ZoneType.SUCCESS_ZONE
      )
    );
    expect(moveResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(publicCardId);
    expect(session.state?.players[0].successZone.cardIds).toContain(publicCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(publicCardId!) &&
          event.from?.zone === ZoneType.WAITING_ROOM &&
          event.to?.zone === ZoneType.SUCCESS_ZONE
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.actorSeat === 'FIRST' &&
          event.declarationType === 'TABLE_CARD_MOVED'
      )
    ).toBe(true);
  });

  it('成员槽位换位命令会移动成员并产出带 slot 的公共事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-6', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const memberCardId = player.hand.cardIds[0];
    expect(memberCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== memberCardId);
    player.memberSlots.slots[SlotPosition.LEFT] = memberCardId!;
    player.memberSlots.slots[SlotPosition.CENTER] = null;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createMoveMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.LEFT, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(memberCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.from?.slot === SlotPosition.LEFT &&
          event.to?.zone === ZoneType.MEMBER_SLOT &&
          event.to?.slot === SlotPosition.CENTER
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'MEMBER_MOVED_TO_SLOT'
      )
    ).toBe(true);
  });

  it('能量附着命令会把能量移到成员下方并产出成员槽位公共事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-7', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      energyZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        energyBelow: Record<SlotPosition, string[]>;
      };
    };

    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardId = player.energyZone.cardIds[0];
    expect(memberCardId).toBeTruthy();
    expect(energyCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== memberCardId);
    player.memberSlots.slots[SlotPosition.CENTER] = memberCardId!;
    player.memberSlots.energyBelow[SlotPosition.CENTER] = [];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createAttachEnergyToMemberCommand(
        PLAYER1,
        energyCardId!,
        ZoneType.ENERGY_ZONE,
        SlotPosition.CENTER
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].energyZone.cardIds).not.toContain(energyCardId);
    expect(session.state?.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toContain(
      energyCardId
    );

    const events = session.getPublicEventsSince(beforeSeq);
    const moveEvent = events.find(
      (event) =>
        event.type === 'CardMovedPublic' &&
        event.from?.zone === ZoneType.ENERGY_ZONE &&
        event.to?.zone === ZoneType.MEMBER_SLOT &&
        event.to?.slot === SlotPosition.CENTER
    );
    expect(moveEvent).toBeTruthy();
    expect(moveEvent?.to?.overlayIndex).toBe(0);
    expect(moveEvent?.card?.cardCode).toBe(state.cardRegistry.get(energyCardId!)?.data.cardCode);
    expect(moveEvent?.card && 'cardType' in moveEvent.card).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'ENERGY_ATTACHED_TO_MEMBER'
      )
    ).toBe(true);
  });

  it('成员登场命令会从手牌进入成员区，并在换手时把原成员送去休息室', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-8', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const enteringCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const existingStageCardId = [...player.hand.cardIds, ...state.players[0].mainDeck.cardIds].find(
      (cardId) =>
        cardId !== enteringCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(enteringCardId).toBeTruthy();
    expect(existingStageCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== existingStageCardId);
    state.players[0].mainDeck.cardIds = state.players[0].mainDeck.cardIds.filter(
      (cardId) => cardId !== existingStageCardId
    );
    player.memberSlots.slots[SlotPosition.CENTER] = existingStageCardId!;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, enteringCardId!, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(enteringCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(enteringCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(existingStageCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(existingStageCardId!) &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'CardRevealedAndMoved' &&
          event.card?.publicObjectId === createPublicObjectId(enteringCardId!) &&
          event.from?.zone === ZoneType.HAND &&
          event.to?.zone === ZoneType.MEMBER_SLOT &&
          event.to?.slot === SlotPosition.CENTER &&
          event.card?.cardCode === state.cardRegistry.get(enteringCardId!)?.data.cardCode &&
          event.reason === 'PLAY_MEMBER'
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(enteringCardId!) &&
          event.from?.zone === ZoneType.HAND &&
          event.to?.zone === ZoneType.MEMBER_SLOT
      )
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'PLAY_MEMBER_TO_SLOT'
      )
    ).toBe(true);
  });

  it('成员登场到已有 memberBelow 的槽位时仍正常换手并清理下方成员', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-special-member-relay', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        memberBelow: Record<SlotPosition, string[]>;
      };
    };

    const memberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const [enteringCardId, specialMemberId, belowMemberId] = memberCardIds;

    expect(enteringCardId).toBeTruthy();
    expect(specialMemberId).toBeTruthy();
    expect(belowMemberId).toBeTruthy();

    const specialMember = state.cardRegistry.get(specialMemberId!) as unknown as {
      data: MemberCardData;
    };
    specialMember.data = {
      ...specialMember.data,
      cardCode: 'PL!HS-pb1-002-R',
      name: '村野さやか',
    };

    player.hand.cardIds = player.hand.cardIds.filter(
      (cardId) => cardId !== specialMemberId && cardId !== belowMemberId
    );
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== specialMemberId && cardId !== belowMemberId
    );
    player.memberSlots.slots[SlotPosition.CENTER] = specialMemberId!;
    player.memberSlots.memberBelow[SlotPosition.CENTER] = [belowMemberId!];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, enteringCardId!, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(enteringCardId);
    expect(session.state?.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(specialMemberId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(belowMemberId);
    expect(session.state?.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).not.toContain(
      enteringCardId
    );

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(specialMemberId!) &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.from?.slot === SlotPosition.CENTER &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(belowMemberId!) &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.from?.slot === SlotPosition.CENTER &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
  });

  it('恶意夹带旧版压人字段也不能通过普通移动命令手动压人', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-reject-legacy-member-below-payload',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        memberBelow: Record<SlotPosition, string[]>;
      };
    };

    let memberCardIds = player.hand.cardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    if (memberCardIds.length < 2) {
      const additionalMemberIds = player.mainDeck.cardIds
        .filter((cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER)
        .slice(0, 2 - memberCardIds.length);
      const additionalMemberIdSet = new Set(additionalMemberIds);
      player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
        (cardId) => !additionalMemberIdSet.has(cardId)
      );
      player.hand.cardIds = [...player.hand.cardIds, ...additionalMemberIds];
      memberCardIds = [...memberCardIds, ...additionalMemberIds];
    }
    const [stackingCardId, specialHostId] = memberCardIds;

    expect(stackingCardId).toBeTruthy();
    expect(specialHostId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter(
      (cardId) => cardId !== specialHostId
    );
    player.memberSlots.slots[SlotPosition.RIGHT] = specialHostId!;
    player.memberSlots.memberBelow[SlotPosition.RIGHT] = [];

    const specialHost = state.cardRegistry.get(specialHostId!) as unknown as {
      data: MemberCardData;
    };
    specialHost.data = {
      ...specialHost.data,
      cardCode: 'PL!HS-pb1-002-R',
      name: '村野さやか',
    };

    const legacyPayload = {
      ...createMoveOwnedCardToZoneCommand(
        PLAYER1,
        stackingCardId!,
        ZoneType.HAND,
        ZoneType.MEMBER_SLOT,
        { targetSlot: SlotPosition.RIGHT }
      ),
      ['as' + 'MemberBelow']: true,
    };
    const result = session.executeCommand(legacyPayload);
    expect(result.success).toBe(false);
    expect(result.error).toContain('专用登场命令');
    expect(session.state?.players[0].hand.cardIds).toContain(stackingCardId);
    expect(session.state?.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual([]);
  });

  it('成员登场命令可用 freePlay 标记作为自由拖拽兜底跳过费用', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-free-play-member', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(memberCardId).toBeTruthy();
    player.energyZone.cardIds = [];
    player.energyZone.cardStates = new Map();

    const normalResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER)
    );
    expect(normalResult.success).toBe(false);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBeNull();

    const freePlayResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(freePlayResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(memberCardId);
    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
  });

  it('切换能量状态命令会更新能量朝向并产出公开声明', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-energy-toggle', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const energyCardId = state.players[0].energyZone.cardIds[0];
    expect(energyCardId).toBeTruthy();

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createTapEnergyCommand(PLAYER1, energyCardId!));

    expect(result.success).toBe(true);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardId!)?.orientation).toBe(
      OrientationState.WAITING
    );

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.declarationType === 'ENERGY_STATE_TOGGLED' &&
          event.publicValue === energyCardId
      )
    ).toBe(true);
  });

  it('主要阶段和表演阶段允许非当前回合玩家切换自己的成员为待机状态', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-cross-turn-tap-member', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const player2 = state.players[1] as unknown as {
      hand: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
        energyBelow: Record<SlotPosition, string[]>;
      };
    };
    const memberCardId = player2.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(memberCardId).toBeTruthy();

    player2.hand.cardIds = player2.hand.cardIds.filter((cardId) => cardId !== memberCardId);
    player2.memberSlots.slots[SlotPosition.LEFT] = memberCardId!;
    player2.memberSlots.energyBelow[SlotPosition.LEFT] = [];
    player2.memberSlots.cardStates = new Map([
      [
        memberCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        },
      ],
    ]);

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    mutableState.currentPhase = GamePhase.MAIN_PHASE;
    mutableState.currentSubPhase = SubPhase.NONE;

    const mainPhaseResult = session.executeCommand(
      createTapMemberCommand(PLAYER2, memberCardId!, SlotPosition.LEFT)
    );
    expect(mainPhaseResult.success).toBe(true);
    expect(session.state?.players[1].memberSlots.cardStates.get(memberCardId!)?.orientation).toBe(
      OrientationState.WAITING
    );

    const refreshedPlayer2 = session.state!.players[1] as unknown as {
      memberSlots: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    refreshedPlayer2.memberSlots.cardStates = new Map([
      [
        memberCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        },
      ],
    ]);

    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;

    const performancePhaseResult = session.executeCommand(
      createTapMemberCommand(PLAYER2, memberCardId!, SlotPosition.LEFT)
    );
    expect(performancePhaseResult.success).toBe(true);
    expect(session.state?.players[1].memberSlots.cardStates.get(memberCardId!)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('主阶段和 Live 大阶段允许非当前回合玩家整理自己的桌面', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-cross-turn-free-drag', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session, 0);

    const player2 = session.state!.players[1];
    const memberCardIds = player2.hand.cardIds.filter(
      (cardId) => session.state!.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberCardIds.length).toBeGreaterThanOrEqual(2);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER2, memberCardIds[0], SlotPosition.LEFT)
    );
    expect(playResult.success).toBe(true);
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.LEFT]).toBe(memberCardIds[0]);

    const moveToWaitingResult = session.executeCommand(
      createMoveOwnedCardToZoneCommand(
        PLAYER2,
        memberCardIds[1],
        ZoneType.HAND,
        ZoneType.WAITING_ROOM
      )
    );
    expect(moveToWaitingResult.success).toBe(true);
    expect(session.state?.players[1].waitingRoom.cardIds).toContain(memberCardIds[1]);

    const mutableState = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_SCORE_CONFIRM;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const returnResult = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER2, memberCardIds[1], ZoneType.WAITING_ROOM)
    );
    expect(returnResult.success).toBe(true);
    expect(session.state?.players[1].hand.cardIds).toContain(memberCardIds[1]);
  });

  it('自由拖拽窗口期间非当前回合玩家可打开检视区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-non-active-inspection',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session, 0);

    const player2 = session.state!.players[1];
    expect(player2.mainDeck.cardIds.length).toBeGreaterThan(0);

    const topCardId = player2.mainDeck.cardIds[0];
    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER2, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toContain(topCardId);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER2);

    const moveResult = session.executeCommand(
      createMoveInspectedCardToTopCommand(PLAYER2, topCardId)
    );
    expect(moveResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).not.toContain(topCardId);

    const finishResult = session.executeCommand(
      createFinishInspectionCommand(PLAYER2)
    );
    expect(finishResult.success).toBe(true);
  });

  it('Live 设置阶段自由拖拽子阶段中非当前回合玩家可打开检视区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-live-set-inspection',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const player2 = session.state!.players[1];
    expect(player2.mainDeck.cardIds.length).toBeGreaterThan(0);

    const topCardId = player2.mainDeck.cardIds[0];
    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER2, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toContain(topCardId);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER2);

    const moveResult = session.executeCommand(
      createMoveInspectedCardToTopCommand(PLAYER2, topCardId)
    );
    expect(moveResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).not.toContain(topCardId);

    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER2));
    expect(finishResult.success).toBe(true);
  });

  it('表演阶段非回合玩家可打开检视区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-performance-inspection',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_LIVE_START_EFFECTS;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const player2 = session.state!.players[1];
    expect(player2.mainDeck.cardIds.length).toBeGreaterThan(0);

    const topCardId = player2.mainDeck.cardIds[0];
    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER2, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toContain(topCardId);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER2);

    const moveResult = session.executeCommand(
      createMoveInspectedCardToTopCommand(PLAYER2, topCardId)
    );
    expect(moveResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).not.toContain(topCardId);

    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER2));
    expect(finishResult.success).toBe(true);
  });

  it('Live 结果阶段非回合玩家可打开检视区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-live-result-inspection',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_SCORE_CONFIRM;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const player2 = session.state!.players[1];
    expect(player2.mainDeck.cardIds.length).toBeGreaterThan(0);

    const topCardId = player2.mainDeck.cardIds[0];
    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER2, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toContain(topCardId);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER2);

    const moveResult = session.executeCommand(
      createMoveInspectedCardToTopCommand(PLAYER2, topCardId)
    );
    expect(moveResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).not.toContain(topCardId);

    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER2));
    expect(finishResult.success).toBe(true);
  });

  it('非自由拖拽窗口阶段拒绝 OPEN_INSPECTION 命令', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-inspection-rejected',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };

    // 抽卡阶段不是自由拖拽窗口
    mutableState.currentPhase = GamePhase.DRAW_PHASE;
    mutableState.currentSubPhase = SubPhase.NONE;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = PLAYER1;

    const result = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('当前不是可检视阶段');

    // 能量阶段也不是自由拖拽窗口
    mutableState.currentPhase = GamePhase.ENERGY_PHASE;
    mutableState.currentSubPhase = SubPhase.NONE;
    const energyResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(energyResult.success).toBe(false);
    expect(energyResult.error).toContain('当前不是可检视阶段');

    // RESULT_TURN_END 是自动化子阶段，也不属于自由拖拽窗口
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_TURN_END;
    const turnEndResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(turnEndResult.success).toBe(false);
    expect(turnEndResult.error).toContain('当前不是可检视阶段');

    // PERFORMANCE_REVEAL 是自动化子阶段，也不属于自由拖拽窗口
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_REVEAL;
    const revealResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(revealResult.success).toBe(false);
    expect(revealResult.error).toContain('当前不是可检视阶段');
  });

  it('一方检视期间另一方可自由拖拽操作但不可并发检视', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-inspection-concurrent-free-drag',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session, 0);

    // 玩家1 开启检视
    const player1 = session.state!.players[0];
    const topCardId = player1.mainDeck.cardIds[0];
    const openResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER1, ZoneType.MAIN_DECK, 1)
    );
    expect(openResult.success).toBe(true);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER1);

    // 玩家2（非检视所有者）可以自由拖拽——手牌卡放回主卡组顶
    const player2 = session.state!.players[1];
    const handCardId2 = player2.hand.cardIds[0];
    expect(handCardId2).toBeTruthy();
    const freeDragResult = session.executeCommand(
      createReturnHandCardToTopCommand(PLAYER2, handCardId2!)
    );
    expect(freeDragResult.success).toBe(true);

    // 玩家2 不能开启自己的检视（并发检视不支持）
    const concurrentInspectionResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER2, ZoneType.MAIN_DECK, 1)
    );
    expect(concurrentInspectionResult.success).toBe(false);
    expect(concurrentInspectionResult.error).toContain('对方正在检视');

    // 玩家2 也不能操作玩家1的检视命令
    const revealResult = session.executeCommand(
      createRevealInspectedCardCommand(PLAYER2, topCardId!)
    );
    expect(revealResult.success).toBe(false);
    expect(revealResult.error).toContain('当前正在等待检视玩家完成操作');

    // 玩家1 仍可操作检视命令
    const moveResult = session.executeCommand(
      createMoveInspectedCardToTopCommand(PLAYER1, topCardId!)
    );
    expect(moveResult.success).toBe(true);

    // 玩家1 完成检视后，玩家2 可以开启自己的检视
    const finishResult = session.executeCommand(createFinishInspectionCommand(PLAYER1));
    expect(finishResult.success).toBe(true);

    const p2OpenResult = session.executeCommand(
      createOpenInspectionCommand(PLAYER2, ZoneType.MAIN_DECK, 1)
    );
    expect(p2OpenResult.success).toBe(true);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER2);
  });

  it('非自由整理窗口仍允许 Live 卡桌面豁免移动', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-live-desk-exempt-outside-window',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    const player = state.players[0];
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    mutableState.currentPhase = GamePhase.DRAW_PHASE;
    mutableState.currentSubPhase = SubPhase.NONE;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const result = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER1, liveCardId!, ZoneType.LIVE_ZONE)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(liveCardId);
  });

  it('成功 Live 选择命令会把 Live 卡移入成功区并产出公共移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-9', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      liveZone: { cardIds: string[] };
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const mutableState = state as unknown as {
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      liveResolution: { liveWinnerIds: string[]; liveResults: Map<string, boolean> };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    mutableState.currentSubPhase = SubPhase.RESULT_SETTLEMENT;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution.liveWinnerIds = [PLAYER1];
    mutableState.liveResolution.liveResults = new Map([[liveCardId!, true]]);

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createSelectSuccessLiveCommand(PLAYER1, liveCardId!));

    expect(result.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].successZone.cardIds).toContain(liveCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(liveCardId!) &&
          event.from?.zone === ZoneType.LIVE_ZONE &&
          event.to?.zone === ZoneType.SUCCESS_ZONE
      )
    ).toBe(true);
  });

  it('判定阶段点击 Live 成功后的本地效果窗口允许成员从手牌登场', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-performance-success-play-member',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
      liveResolution: { performingPlayerId: string | null };
    };
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.performingPlayerId = PLAYER1;

    const memberCardId = state.players[0].hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberCardId).toBeTruthy();

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.LEFT)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(memberCardId);
  });

  it('判定阶段点击 Live 成功后的本地效果窗口允许把 Live 提前移入成功区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-performance-success-select-live',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
      liveResolution: { performingPlayerId: string | null };
    };
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.performingPlayerId = PLAYER1;

    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    expect(liveCardId).toBeTruthy();

    const player = state.players[0];
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = [liveCardId!];
    player.liveZone.cardStates = new Map([
      [
        liveCardId!,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        },
      ],
    ]);

    const result = session.executeCommand(createSelectSuccessLiveCommand(PLAYER1, liveCardId!));

    expect(result.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].successZone.cardIds).toContain(liveCardId);
    expect(session.state?.liveResolution.liveResults.get(liveCardId!)).toBe(true);
  });

  it('成功效果窗口允许己方成员从手牌拖到成员区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-success-effect-play-member',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
      liveResolution: { performingPlayerId: string | null };
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.performingPlayerId = PLAYER1;

    const memberCardId = state.players[0].hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberCardId).toBeTruthy();

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.LEFT)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).not.toContain(memberCardId);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(memberCardId);
  });

  it('成功效果窗口允许公开区卡牌回手', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-success-effect-bounce', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
      liveResolution: { performingPlayerId: string | null };
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.performingPlayerId = PLAYER1;

    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    expect(liveCardId).toBeTruthy();

    const player = state.players[0];
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== liveCardId);
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.successZone.cardIds = [liveCardId!];

    const result = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER1, liveCardId!, ZoneType.SUCCESS_ZONE)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].successZone.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(liveCardId);
  });

  it('公开区进入休息室命令会发出公开移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-10', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      successZone: { cardIds: string[] };
      hand: { cardIds: string[] };
    };
    const publicCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(publicCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== publicCardId);
    player.successZone.cardIds = [publicCardId!];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(PLAYER1, publicCardId!, ZoneType.SUCCESS_ZONE)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].successZone.cardIds).not.toContain(publicCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(publicCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    const moveEvent = events.find(
      (event) =>
        event.type === 'CardMovedPublic' &&
        event.card?.publicObjectId === createPublicObjectId(publicCardId!) &&
        event.from?.zone === ZoneType.SUCCESS_ZONE &&
        event.to?.zone === ZoneType.WAITING_ROOM
    );
    expect(moveEvent).toBeTruthy();
    expect(moveEvent?.card?.cardCode).toBe(state.cardRegistry.get(publicCardId!)?.data.cardCode);
    expect(moveEvent?.card && 'name' in moveEvent.card).toBe(false);
    expect(moveEvent?.card && 'cardType' in moveEvent.card).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' &&
          event.declarationType === 'MOVE_PUBLIC_CARD_TO_WAITING_ROOM'
      )
    ).toBe(true);
  });

  it('公开区主成员进入休息室时会将下方成员一并送去休息室并发出公开移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-member-below-to-waiting', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        memberBelow: Record<SlotPosition, string[]>;
      };
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const memberCardIds = [...player.hand.cardIds, ...player.mainDeck.cardIds].filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const [stageMemberId, belowMemberId] = memberCardIds;

    expect(stageMemberId).toBeTruthy();
    expect(belowMemberId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter(
      (cardId) => cardId !== stageMemberId && cardId !== belowMemberId
    );
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
      (cardId) => cardId !== stageMemberId && cardId !== belowMemberId
    );
    player.memberSlots.slots[SlotPosition.LEFT] = stageMemberId!;
    player.memberSlots.memberBelow[SlotPosition.LEFT] = [belowMemberId!];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        stageMemberId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.LEFT
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].memberSlots.memberBelow[SlotPosition.LEFT]).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(stageMemberId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(belowMemberId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(stageMemberId!) &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.from?.slot === SlotPosition.LEFT &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(belowMemberId!) &&
          event.from?.zone === ZoneType.MEMBER_SLOT &&
          event.from?.slot === SlotPosition.LEFT &&
          event.to?.zone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
  });

  it('公开区进入手牌命令会发出进入私有区的公共移动事件', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-public-to-hand', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      memberSlots: { slots: Record<SlotPosition, string | null> };
      hand: { cardIds: string[] };
    };
    const publicCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(publicCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== publicCardId);
    player.memberSlots.slots[SlotPosition.LEFT] = publicCardId!;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createMovePublicCardToHandCommand(
        PLAYER1,
        publicCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.LEFT
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(publicCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    const moveEvent = events.find(
      (event) =>
        event.type === 'CardMovedPublic' &&
        event.card?.publicObjectId === createPublicObjectId(publicCardId!) &&
        event.from?.zone === ZoneType.MEMBER_SLOT &&
        event.from?.slot === SlotPosition.LEFT &&
        event.to?.zone === ZoneType.HAND
    );
    expect(moveEvent).toBeTruthy();
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'MOVE_PUBLIC_CARD_TO_HAND'
      )
    ).toBe(true);
  });

  it('休息室中的己方公开牌可以通过专用回手命令进入手牌', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-waiting-room-to-hand', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    forceMainPhaseForPlayer(session);
    const player = state.players[0] as unknown as {
      waitingRoom: { cardIds: string[] };
      hand: { cardIds: string[] };
    };
    const publicCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(publicCardId).toBeTruthy();

    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== publicCardId);
    player.waitingRoom.cardIds = [publicCardId!];

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(
      createMovePublicCardToHandCommand(PLAYER1, publicCardId!, ZoneType.WAITING_ROOM)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(publicCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(publicCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(publicCardId!) &&
          event.from?.zone === ZoneType.WAITING_ROOM &&
          event.to?.zone === ZoneType.HAND
      )
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'PlayerDeclared' && event.declarationType === 'MOVE_PUBLIC_CARD_TO_HAND'
      )
    ).toBe(true);
  });

  it('判定应援区中的己方牌可以通过专用命令进入手牌', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-resolution-to-hand', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
    };
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    state.activePlayerIndex = 0;

    const revealResult = session.executeCommand(createRevealCheerCardCommand(PLAYER1));
    expect(revealResult.success).toBe(true);

    const resolutionCardId = session.state?.resolutionZone.cardIds[0];
    expect(resolutionCardId).toBeTruthy();

    const beforeSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMoveResolutionCardToZoneCommand(PLAYER1, resolutionCardId!, ZoneType.HAND)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.resolutionZone.cardIds).not.toContain(resolutionCardId);
    expect(session.state?.players[0].hand.cardIds).toContain(resolutionCardId);

    const events = session.getPublicEventsSince(beforeSeq);
    expect(
      events.some(
        (event) =>
          event.type === 'CardMovedPublic' &&
          event.card?.publicObjectId === createPublicObjectId(resolutionCardId!) &&
          event.from?.zone === ZoneType.RESOLUTION_ZONE &&
          event.to?.zone === ZoneType.HAND
      )
    ).toBe(true);
  });

  it('错误 seat 在非当前操作时机提交命令会被拒绝', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-11', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const player2HandCardId = session.state?.players[1].hand.cardIds[0];
    expect(player2HandCardId).toBeTruthy();

    const mulliganResult = session.executeCommand(createMulliganCommand(PLAYER2, []));
    expect(mulliganResult.success).toBe(false);
    expect(mulliganResult.error).toContain('当前不是该玩家的操作时机');

    const setLiveResult = session.executeCommand(
      createSetLiveCardCommand(PLAYER2, player2HandCardId!, true)
    );
    expect(setLiveResult.success).toBe(false);
    expect(setLiveResult.error).toContain('当前不是该玩家的操作时机');
  });

  it('公开拖拽命令不允许直接跨公开/隐藏边界', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-12', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const handCardId = session.state?.players[0].hand.cardIds[0];
    expect(handCardId).toBeTruthy();

    const result = session.executeCommand(
      createMoveTableCardCommand(PLAYER1, handCardId!, ZoneType.HAND, ZoneType.WAITING_ROOM)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('跨公开/隐藏边界的移动必须使用专用命令');
  });

  it('主要阶段命令在非主要阶段会被拒绝', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-main-phase-guard', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const memberCardId = session.state?.players[0].hand.cardIds.find(
      (cardId) => session.state?.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberCardId).toBeTruthy();

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.LEFT)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('当前不是可自由整理阶段');
  });

  it('普通移动命令不允许把手牌成员卡放入 Live 区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-main-phase-member-to-live',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const memberCardId = session.state?.players[0].hand.cardIds.find(
      (cardId) => session.state?.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    expect(memberCardId).toBeTruthy();

    const result = session.executeCommand(
      createMoveOwnedCardToZoneCommand(PLAYER1, memberCardId!, ZoneType.HAND, ZoneType.LIVE_ZONE)
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('只有 LIVE 卡可以自由拖入 Live 区');
  });

  it('自由拖拽窗口可将手牌 Live 卡正面放入 Live 区', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-free-drag-live-card-to-live',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = [liveCardId!, ...player.hand.cardIds.filter((id) => id !== liveCardId)];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);

    const result = session.executeCommand(
      createMoveOwnedCardToZoneCommand(PLAYER1, liveCardId!, ZoneType.HAND, ZoneType.LIVE_ZONE)
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).not.toContain(liveCardId);
    expect(session.state?.players[0].liveZone.cardIds).toContain(liveCardId);
    expect(session.state?.players[0].liveZone.cardStates.get(liveCardId!)?.face).toBe(
      FaceState.FACE_UP
    );
  });

  it('Live 设置阶段手牌放入 Live 区必须走专用放置命令', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-live-set-hand-to-live-special-command',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    if (!player.hand.cardIds.includes(liveCardId!)) {
      player.hand.cardIds = [liveCardId!, ...player.hand.cardIds];
    }
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const ordinaryMoveResult = session.executeCommand(
      createMoveOwnedCardToZoneCommand(PLAYER1, liveCardId!, ZoneType.HAND, ZoneType.LIVE_ZONE)
    );

    expect(ordinaryMoveResult.success).toBe(false);
    expect(ordinaryMoveResult.error).toContain(
      'Live 设置阶段手牌放入 Live 区必须使用 Live 放置命令'
    );
    expect(session.state?.players[0].hand.cardIds).toContain(liveCardId);

    const setLiveResult = session.executeCommand(
      createSetLiveCardCommand(PLAYER1, liveCardId!, true)
    );

    expect(setLiveResult.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).toContain(liveCardId);
  });

  it('表演判定阶段自由拖入 Live 区的手牌 Live 卡参与判定结果', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-performance-dragged-live-joins-judgment',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = [liveCardId!, ...player.hand.cardIds.filter((id) => id !== liveCardId)];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = player.liveZone.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const moveResult = session.executeCommand(
      createMoveOwnedCardToZoneCommand(PLAYER1, liveCardId!, ZoneType.HAND, ZoneType.LIVE_ZONE)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardStates.get(liveCardId!)?.face).toBe(
      FaceState.FACE_UP
    );

    const confirmResult = session.executeCommand(
      createConfirmPerformanceOutcomeCommand(PLAYER1, true)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.liveResolution.liveResults.get(liveCardId!)).toBe(true);
  });

  it('接受自动判定应先提交空判定草案，再确认判定子阶段推进', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame(
      'online-command-accept-automatic-judgment-sequence',
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    player.hand.cardIds = [liveCardId!, ...player.hand.cardIds.filter((id) => id !== liveCardId)];
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    player.liveZone.cardIds = player.liveZone.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const moveResult = session.executeCommand(
      createMoveOwnedCardToZoneCommand(PLAYER1, liveCardId!, ZoneType.HAND, ZoneType.LIVE_ZONE)
    );
    expect(moveResult.success).toBe(true);

    const submitResult = session.executeCommand(
      createSubmitJudgmentCommand(PLAYER1, new Map())
    );
    expect(submitResult.success).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);
    expect(session.state?.liveResolution.liveResults.has(liveCardId!)).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmStepCommand(PLAYER1, SubPhase.PERFORMANCE_JUDGMENT)
    );
    expect(confirmResult.success).toBe(true);
    expect(session.state?.currentSubPhase).not.toBe(SubPhase.PERFORMANCE_JUDGMENT);
  });

  it('非开放阶段拒绝普通桌面整理命令和底层手动移动动作', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-free-drag-closed-phase', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session, 0);

    const energyCardId = session.state?.players[0].energyDeck.cardIds[0];
    expect(energyCardId).toBeTruthy();
    const drawEnergyResult = session.executeCommand(
      createDrawEnergyToZoneCommand(PLAYER1, energyCardId!)
    );
    expect(drawEnergyResult.success).toBe(true);

    const mutableState = session.state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
    };
    mutableState.currentPhase = GamePhase.DRAW_PHASE;
    mutableState.currentSubPhase = SubPhase.NONE;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;

    const tapResult = session.executeCommand(createTapEnergyCommand(PLAYER1, energyCardId!));
    expect(tapResult.success).toBe(false);
    expect(tapResult.error).toContain('当前不是可自由整理阶段');

    const handCardId = session.state?.players[0].hand.cardIds[0];
    expect(handCardId).toBeTruthy();
    const serviceResult = new GameService().processAction(
      session.state!,
      createManualMoveCardAction(PLAYER1, handCardId!, ZoneType.HAND, ZoneType.WAITING_ROOM)
    );
    expect(serviceResult.success).toBe(false);
    expect(serviceResult.error).toContain('当前不是可自由整理阶段');

    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.currentSubPhase = SubPhase.LIVE_SET_FIRST_DRAW;

    const liveSetAutoDrawTapResult = session.executeCommand(
      createTapEnergyCommand(PLAYER1, energyCardId!)
    );
    expect(liveSetAutoDrawTapResult.success).toBe(false);
    expect(liveSetAutoDrawTapResult.error).toContain('当前不是可自由整理阶段');

    const liveSetAutoDrawServiceResult = new GameService().processAction(
      session.state!,
      createManualMoveCardAction(PLAYER1, handCardId!, ZoneType.HAND, ZoneType.WAITING_ROOM)
    );
    expect(liveSetAutoDrawServiceResult.success).toBe(false);
    expect(liveSetAutoDrawServiceResult.error).toContain('当前不是可自由整理阶段');
  });

  it('明置 Live 会产出 CardRevealedAndMoved，盖放 Live 仍只产出背面移动', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-face-up-live', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      activePlayerIndex: number;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    if (!player.hand.cardIds.includes(liveCardId!)) {
      player.hand.cardIds = [liveCardId!, ...player.hand.cardIds];
    }
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.activePlayerIndex = 0;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createSetLiveCardCommand(PLAYER1, liveCardId!, false));

    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    const revealAndMoveEvent = events.find(
      (event) =>
        event.type === 'CardRevealedAndMoved' &&
        event.card.publicObjectId === createPublicObjectId(liveCardId!) &&
        event.from?.zone === ZoneType.HAND &&
        event.to?.zone === ZoneType.LIVE_ZONE
    );
    expect(revealAndMoveEvent).toBeTruthy();
    expect(revealAndMoveEvent?.card.cardCode).toBe(
      state.cardRegistry.get(liveCardId!)?.data.cardCode
    );
    expect(revealAndMoveEvent?.reason).toBe('SET_LIVE_CARD');
  });

  it('盖放 Live 的公开移动事件不会泄露牌面信息', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-face-down-live', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      activePlayerIndex: number;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;

    expect(liveCardId).toBeTruthy();

    if (!player.hand.cardIds.includes(liveCardId!)) {
      player.hand.cardIds = [liveCardId!, ...player.hand.cardIds];
    }
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.activePlayerIndex = 0;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const result = session.executeCommand(createSetLiveCardCommand(PLAYER1, liveCardId!, true));

    expect(result.success).toBe(true);

    const events = session.getPublicEventsSince(beforeSeq);
    const moveEvent = events.find(
      (event) =>
        event.type === 'CardMovedPublic' &&
        event.card === undefined &&
        event.count === 1 &&
        event.to?.zone === ZoneType.LIVE_ZONE
    );
    expect(moveEvent).toBeTruthy();
    expect(moveEvent?.card).toBeUndefined();
  });

  it('平分双胜者时切到另一玩家视角仍可确认胜者动画', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-live-tie-double-winner', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const p1LiveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    const p2LiveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER2 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    expect(p1LiveCardId).toBeTruthy();
    expect(p2LiveCardId).toBeTruthy();

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      activePlayerIndex: number;
      waitingPlayerId: string | null;
      players: Array<{
        hand: typeof state.players[number]['hand'];
        mainDeck: typeof state.players[number]['mainDeck'];
        liveZone: typeof state.players[number]['liveZone'];
      }>;
      liveResolution: typeof state.liveResolution;
    };
    const p1 = mutableState.players[0]!;
    const p2 = mutableState.players[1]!;
    p1.hand = removeCardFromZone(p1.hand, p1LiveCardId!) as typeof p1.hand;
    p1.mainDeck = removeCardFromZone(p1.mainDeck, p1LiveCardId!) as typeof p1.mainDeck;
    p1.liveZone = addCardToStatefulZone(p1.liveZone, p1LiveCardId!);
    p2.hand = removeCardFromZone(p2.hand, p2LiveCardId!) as typeof p2.hand;
    p2.mainDeck = removeCardFromZone(p2.mainDeck, p2LiveCardId!) as typeof p2.mainDeck;
    p2.liveZone = addCardToStatefulZone(p2.liveZone, p2LiveCardId!);
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_SCORE_CONFIRM;
    mutableState.activePlayerIndex = 0;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution = {
      ...mutableState.liveResolution,
      liveResults: new Map([
        [p1LiveCardId!, true],
        [p2LiveCardId!, true],
      ]),
      playerScores: new Map([
        [PLAYER1, 3],
        [PLAYER2, 3],
      ]),
      scoreConfirmedBy: [],
      liveWinnerIds: [],
      animationConfirmedBy: [],
      successCardMovedBy: [],
      settlementConfirmedBy: [],
    };

    const p1Score = session.executeCommand(createSubmitScoreCommand(PLAYER1, 3));
    expect(p1Score.success, p1Score.error).toBe(true);
    const p2Score = session.executeCommand(createSubmitScoreCommand(PLAYER2, 3));
    expect(p2Score.success, p2Score.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_ANIMATION);

    const p1AnimationView = session.getPlayerViewState(PLAYER1);
    expect(p1AnimationView?.match.window?.windowType).toBe('RESULT_ANIMATION');
    expect(p1AnimationView?.match.liveResult?.winnerSeats).toEqual(['FIRST', 'SECOND']);
    expect(getEnabledCommand(p1AnimationView, GameCommandType.CONFIRM_STEP)).toBeTruthy();

    const p1AnimationConfirm = session.executeCommand(
      createConfirmStepCommand(PLAYER1, SubPhase.RESULT_ANIMATION)
    );
    expect(p1AnimationConfirm.success, p1AnimationConfirm.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_ANIMATION);
    expect(session.state?.liveResolution.animationConfirmedBy).toEqual([PLAYER1]);
    expect(getEnabledCommand(session.getPlayerViewState(PLAYER1), GameCommandType.CONFIRM_STEP)).toBeUndefined();

    const p2AnimationView = session.getPlayerViewState(PLAYER2);
    const p2ConfirmHint = getEnabledCommand(p2AnimationView, GameCommandType.CONFIRM_STEP);
    expect(p2AnimationView?.match.viewerSeat).toBe('SECOND');
    expect(p2AnimationView?.match.window?.windowType).toBe('RESULT_ANIMATION');
    expect(p2ConfirmHint?.params?.subPhase).toBe(SubPhase.RESULT_ANIMATION);

    const p2AnimationConfirm = session.executeCommand(
      createConfirmStepCommand(PLAYER2, SubPhase.RESULT_ANIMATION)
    );
    expect(p2AnimationConfirm.success, p2AnimationConfirm.error).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.RESULT_SETTLEMENT);
  });

  it('常用基础命令会通过命令层落到既有动作处理', () => {
    const session = createGameSession();
    const deck = createTestDeck();

    session.createGame('online-command-13', PLAYER1, '玩家1', PLAYER2, '玩家2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      activePlayerIndex: number;
    };
    const player = state.players[0] as (typeof state.players)[0] & {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
    };
    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = [...state.cardRegistry.values()].find(
      (card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.LIVE
    )?.instanceId;
    expect(memberCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    if (!player.hand.cardIds.includes(liveCardId!)) {
      player.hand.cardIds = [liveCardId!, ...player.hand.cardIds];
    }
    player.mainDeck.cardIds = player.mainDeck.cardIds.filter((cardId) => cardId !== liveCardId);
    mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
    mutableState.activePlayerIndex = 0;

    const setLiveResult = session.executeCommand(
      createSetLiveCardCommand(PLAYER1, liveCardId!, true)
    );
    expect(setLiveResult.success).toBe(true);
    expect(session.state?.players[0].liveZone.cardIds).toContain(liveCardId);

    forceMainPhaseForPlayer(session);
    const playMemberResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.LEFT)
    );
    expect(playMemberResult.success).toBe(true);

    const tapResult = session.executeCommand(
      createTapMemberCommand(PLAYER1, memberCardId!, SlotPosition.LEFT)
    );
    expect(tapResult.success).toBe(true);

    const endPhaseResult = session.executeCommand(createEndPhaseCommand(PLAYER1));
    expect(endPhaseResult.success).toBe(true);
  });
});
