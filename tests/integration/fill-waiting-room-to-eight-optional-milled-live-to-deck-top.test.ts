import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { registerFillWaitingRoomToEightOptionalMilledLiveToDeckTopWorkflowHandlers } from '../../src/application/card-effects/workflows/shared/fill-waiting-room-to-eight-optional-milled-live-to-deck-top';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const ABILITY_ID = PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID;
const SOURCE_CARDS = [
  ['PL!HS-PR-036-PR', '大沢瑠璃乃'],
  ['PL!N-PR-032-PR', '優木せつ菜'],
  ['PL!S-PR-044-PR', '高海千歌'],
] as const;

registerFillWaitingRoomToEightOptionalMilledLiveToDeckTopWorkflowHandlers({
  enqueueTriggeredCardEffects,
});

function member(
  id: string,
  options: {
    readonly cardCode?: string;
    readonly name?: string;
    readonly ownerId?: string;
  } = {}
) {
  const data: MemberCardData = {
    cardCode: options.cardCode ?? `TEST-MEMBER-${id}`,
    name: options.name ?? id,
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, options.ownerId ?? P1, id);
}

function live(id: string) {
  const data: LiveCardData = {
    cardCode: `TEST-LIVE-${id}`,
    name: id,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
  return createCardInstance(data, P1, id);
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending:${sourceCardId}`,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event:${sourceCardId}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    readonly sourceCardCode?: string;
    readonly sourceName?: string;
    readonly waitingCards?: readonly ReturnType<typeof member>[];
    readonly deckCards?: readonly (ReturnType<typeof member> | ReturnType<typeof live>)[];
  } = {}
) {
  const source = member('source', {
    cardCode: options.sourceCardCode ?? SOURCE_CARDS[0][0],
    name: options.sourceName ?? SOURCE_CARDS[0][1],
  });
  const waitingCards =
    options.waitingCards ?? Array.from({ length: 5 }, (_, index) => member(`waiting-${index}`));
  const deckCards = options.deckCards ?? [
    live('milled-live-a'),
    member('milled-member'),
    live('milled-live-b'),
    member('deck-rest'),
  ];
  let game = registerCards(createGameState('fill-waiting-room-to-eight', P1, 'P1', P2, 'P2'), [
    source,
    ...waitingCards,
    ...deckCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  const ability = pending(source.instanceId);
  return {
    source,
    waitingCards,
    deckCards,
    game: resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState,
  };
}

function toSession(game: GameState) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('fill-waiting-room-to-eight-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('PR shared fill-waiting-room-to-eight workflow', () => {
  for (const [cardCode, name] of SOURCE_CARDS) {
    it(`${cardCode} 费用5「${name}」使用同一精确磨牌选择流程`, () => {
      const scenario = setup({ sourceCardCode: cardCode, sourceName: name });
      expect(scenario.game.activeEffect).toMatchObject({
        abilityId: ABILITY_ID,
        stepText: '可以从因此放置入休息室的卡片中，选择1张LIVE卡放置于卡组顶。',
        selectableCardIds: [scenario.deckCards[0]!.instanceId, scenario.deckCards[2]!.instanceId],
        selectionLabel: '选择要放置于卡组顶的LIVE卡',
        confirmSelectionLabel: '放置于卡组顶',
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          publicCardSelectionConfirmation: { destination: 'MAIN_DECK_TOP' },
          initialWaitingRoomCount: 5,
          fillCount: 3,
          milledCardIds: scenario.deckCards.slice(0, 3).map((card) => card.instanceId),
          refreshCount: 0,
        },
      });
      expect(scenario.game.players[0].waitingRoom.cardIds).toEqual([
        ...scenario.waitingCards.map((card) => card.instanceId),
        ...scenario.deckCards.slice(0, 3).map((card) => card.instanceId),
      ]);
      expect(scenario.game.players[0].mainDeck.cardIds).toEqual([
        scenario.deckCards[3]!.instanceId,
      ]);
    });
  }

  it('只公开并回顶本次实际磨下且仍在休息室的LIVE卡', () => {
    const scenario = setup();
    const selectedCardId = scenario.deckCards[2]!.instanceId;
    const { session, setNow } = toSession(scenario.game);
    const effectId = session.state!.activeEffect!.id;

    const selected = session.executeCommand(
      createConfirmEffectStepCommand(P1, effectId, selectedCardId)
    );
    expect(selected.success, selected.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [selectedCardId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(selectedCardId);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([scenario.deckCards[3]!.instanceId]);

    const publicObjectId = createPublicObjectId(selectedCardId);
    expect(
      projectPlayerViewState(session.state!, P1, { now: 10_000 }).activeEffect?.revealedObjectIds
    ).toEqual([publicObjectId]);
    expect(
      projectPlayerViewState(session.state!, P2, { now: 10_000 }).activeEffect?.revealedObjectIds
    ).toEqual([publicObjectId]);

    setNow(12_000);
    const advanced = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(selectedCardId);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(selectedCardId);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ABILITY_ID &&
          action.payload.step === 'MOVE_MILLED_LIVE_TO_DECK_TOP'
      )?.payload
    ).toMatchObject({
      selectedCardId,
      movedCardIds: [selectedCardId],
      fillCount: 3,
      refreshCount: 0,
    });
  });

  it('不选择时不创建空公开窗口，并经标准 continuation 结束', () => {
    const scenario = setup();
    const { session } = toSession(scenario.game);
    const beforeMainDeck = session.state!.players[0].mainDeck.cardIds;
    const skipped = session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id)
    );

    expect(skipped.success, skipped.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(beforeMainDeck);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ABILITY_ID &&
          action.payload.step === 'DECLINE_MILLED_LIVE_TO_DECK_TOP'
      )
    ).toBe(true);
  });

  it('拒绝既有休息室LIVE和本次磨下的非LIVE，且不推进效果', () => {
    const oldLive = live('old-waiting-live');
    const waitingCards = [
      oldLive,
      ...Array.from({ length: 4 }, (_, index) => member(`waiting-illegal-${index}`)),
    ];
    const scenario = setup({ waitingCards });
    const { session } = toSession(scenario.game);
    const effectId = session.state!.activeEffect!.id;
    const mainDeckBefore = session.state!.players[0].mainDeck.cardIds;

    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effectId, oldLive.instanceId))
        .success
    ).toBe(false);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, effectId, scenario.deckCards[1]!.instanceId)
      ).success
    ).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(effectId);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(mainDeckBefore);
  });

  it('公开后目标陈旧时整体不移动，并恢复原选择窗口', () => {
    const scenario = setup();
    const selectedCardId = scenario.deckCards[0]!.instanceId;
    const { session, setNow } = toSession(scenario.game);
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effectId, selectedCardId)).success
    ).toBe(true);

    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      P1,
      (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== selectedCardId),
        },
        hand: { ...player.hand, cardIds: [...player.hand.cardIds, selectedCardId] },
      })
    );
    const mainDeckBefore = session.state!.players[0].mainDeck.cardIds;
    setNow(12_000);

    const advanced = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      id: effectId,
      abilityId: ABILITY_ID,
      selectableCardIds: expect.arrayContaining([selectedCardId]),
    });
    expect(session.state?.players[0].hand.cardIds).toContain(selectedCardId);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(mainDeckBefore);
  });

  it('休息室已满8张时不磨牌、不产生事件并直接结束', () => {
    const waitingCards = Array.from({ length: 8 }, (_, index) => member(`waiting-full-${index}`));
    const deckCards = [live('untouched-live'), member('untouched-member')];
    const scenario = setup({ waitingCards, deckCards });

    expect(scenario.game.activeEffect).toBeNull();
    expect(scenario.game.pendingAbilities).toEqual([]);
    expect(scenario.game.players[0].waitingRoom.cardIds).toEqual(
      waitingCards.map((card) => card.instanceId)
    );
    expect(scenario.game.players[0].mainDeck.cardIds).toEqual(
      deckCards.map((card) => card.instanceId)
    );
    expect(
      scenario.game.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      )
    ).toHaveLength(0);
  });

  it('没有本次LIVE候选时保留固定磨牌结果并直接结束', () => {
    const deckCards = [
      member('member-only-a'),
      member('member-only-b'),
      member('member-only-c'),
      live('not-milled'),
    ];
    const scenario = setup({ deckCards });

    expect(scenario.game.activeEffect).toBeNull();
    expect(scenario.game.pendingAbilities).toEqual([]);
    expect(scenario.game.players[0].waitingRoom.cardIds.slice(-3)).toEqual(
      deckCards.slice(0, 3).map((card) => card.instanceId)
    );
    expect(
      scenario.game.eventLog
        .map(({ event }) => event)
        .filter(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.MAIN_DECK
        )
    ).toEqual([
      expect.objectContaining({
        cardInstanceIds: deckCards.slice(0, 3).map((card) => card.instanceId),
        cause: expect.objectContaining({
          kind: 'CARD_EFFECT',
          abilityId: ABILITY_ID,
          sourceCardId: scenario.source.instanceId,
        }),
      }),
    ]);
  });

  it('卡组更新后仍只处理初始差值一次，并以精确movedCardIds筛选当前候选', () => {
    const waitingCards = Array.from({ length: 5 }, (_, index) => live(`refresh-waiting-${index}`));
    const originalDeckCard = member('refresh-original-deck');
    const scenario = setup({
      waitingCards,
      deckCards: [originalDeckCard],
    });
    const event = scenario.game.eventLog
      .map(({ event }) => event)
      .find(
        (candidate) =>
          candidate.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          candidate.fromZone === ZoneType.MAIN_DECK
      );
    const movedCardIds = event && 'cardInstanceIds' in event ? (event.cardInstanceIds ?? []) : [];
    const currentWaitingRoomIds = scenario.game.players[0].waitingRoom.cardIds;
    const expectedSelectableIds = movedCardIds.filter(
      (cardId) =>
        currentWaitingRoomIds.includes(cardId) &&
        scenario.game.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(movedCardIds).toHaveLength(3);
    expect(scenario.game.players[0].waitingRoom.cardIds).toHaveLength(2);
    expect(scenario.game.activeEffect).toMatchObject({
      selectableCardIds: expectedSelectableIds,
      metadata: {
        initialWaitingRoomCount: 5,
        fillCount: 3,
        milledCardIds: movedCardIds,
        refreshCount: 1,
      },
    });
    expect(expectedSelectableIds.length).toBeGreaterThan(0);
  });
});
