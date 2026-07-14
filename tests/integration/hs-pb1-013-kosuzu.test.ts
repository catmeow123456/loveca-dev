import { describe, expect, it } from 'vitest';
import type { LiveModifierState, GameState } from '../../src/domain/entities/game';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
  HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, cost: number, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createSource(cardCode = 'PL!HS-pb1-013-R'): MemberCardData {
  return {
    ...createMember(cardCode, 9, '徒町小鈴'),
    hearts: [createHeartIcon(HeartColor.BLUE, 2)],
  };
}

function createSessionFromState(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('hs-pb1-013-kosuzu-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function confirm(
  session: ReturnType<typeof createGameSession>,
  options: {
    readonly selectedCardIds?: readonly string[];
    readonly resolveInOrder?: boolean;
  } = {}
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      options.resolveInOrder,
      undefined,
      options.selectedCardIds
    )
  );
}

function confirmIfConfirmOnly(state: GameState): GameState {
  if (state.activeEffect?.metadata?.confirmOnlyPendingAbility !== true) {
    return state;
  }
  const session = createSessionFromState(state);
  expect(confirm(session).success).toBe(true);
  return session.state!;
}

function liveStartPending(sourceCardId: string, id = 'pb1-013-live-start') {
  return {
    id,
    abilityId: HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['manual-live-start'],
  };
}

function liveSuccessPending(sourceCardId: string, id = 'pb1-013-live-success') {
  return {
    id,
    abilityId: HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['manual-live-success'],
  };
}

function setupArrange(options: {
  readonly deckCount: number;
  readonly sourceCardCode?: string;
  readonly appendLiveSuccessPending?: boolean;
}): { readonly state: GameState; readonly sourceId: string; readonly deckCardIds: readonly string[]; readonly drawCardId: string } {
  const source = createCardInstance(
    createSource(options.sourceCardCode ?? 'PL!HS-pb1-013-R'),
    PLAYER1,
    'kosuzu-source'
  );
  const deckCards = Array.from({ length: options.deckCount }, (_, index) =>
    createCardInstance(createMember(`PL!HS-pb1-013-deck-${index}`, 1), PLAYER1, `deck-${index}`)
  );
  const drawCard = createCardInstance(createMember('PL!HS-pb1-013-draw', 1), PLAYER1, 'draw');
  const higher = createCardInstance(createMember('PL!HS-pb1-013-higher', 10), PLAYER1, 'higher');

  let game = createGameState('hs-pb1-013-arrange', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...deckCards, drawCard, higher]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: [
        ...deckCards.map((card) => card.instanceId),
        ...(options.appendLiveSuccessPending ? [drawCard.instanceId] : []),
      ],
    },
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.CENTER,
      higher.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));

  return {
    state: {
      ...game,
      pendingAbilities: [
        liveStartPending(source.instanceId),
        ...(options.appendLiveSuccessPending ? [liveSuccessPending(source.instanceId)] : []),
      ],
    },
    sourceId: source.instanceId,
    deckCardIds: deckCards.map((card) => card.instanceId),
    drawCardId: drawCard.instanceId,
  };
}

function setupLiveSuccess(options: {
  readonly ownCosts: readonly number[];
  readonly opponentCosts?: readonly number[];
  readonly sourceInStage?: boolean;
  readonly memberCostModifiers?: readonly { readonly memberId: string; readonly countDelta: number }[];
}): { readonly state: GameState; readonly sourceId: string; readonly drawCardId: string; readonly ownMemberIds: readonly string[] } {
  const source = createCardInstance(createSource(), PLAYER1, 'kosuzu-success-source');
  const ownMembers = options.ownCosts.map((cost, index) =>
    createCardInstance(createMember(`PL!HS-pb1-013-own-${index}`, cost), PLAYER1, `own-${index}`)
  );
  const opponentMembers = (options.opponentCosts ?? []).map((cost, index) =>
    createCardInstance(
      createMember(`PL!HS-pb1-013-opponent-${index}`, cost),
      PLAYER2,
      `opponent-${index}`
    )
  );
  const drawCard = createCardInstance(createMember('PL!HS-pb1-013-success-draw', 1), PLAYER1, 'success-draw');

  let game = createGameState('hs-pb1-013-live-success', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...ownMembers, ...opponentMembers, drawCard]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const withOwnMembers = ownMembers.reduce(
      (slots, member, index) =>
        placeCardInSlot(
          slots,
          index === 0 ? SlotPosition.CENTER : SlotPosition.RIGHT,
          member.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        ),
      options.sourceInStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          })
    );
    return {
      ...player,
      hand: { ...player.hand, cardIds: [] },
      waitingRoom:
        options.sourceInStage === false
          ? addCardToStatefulZone(player.waitingRoom, source.instanceId)
          : player.waitingRoom,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      memberSlots: withOwnMembers,
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: opponentMembers.reduce(
      (slots, member, index) =>
        placeCardInSlot(
          slots,
          index === 0 ? SlotPosition.LEFT : SlotPosition.CENTER,
          member.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        ),
      player.memberSlots
    ),
  }));

  const liveModifiers: readonly LiveModifierState[] = (options.memberCostModifiers ?? []).map(
    (modifier) => ({
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: modifier.memberId,
      countDelta: modifier.countDelta,
      sourceCardId: source.instanceId,
      abilityId: 'test-member-cost-modifier',
    })
  );

  return {
    state: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers,
      },
      pendingAbilities: [liveSuccessPending(source.instanceId)],
    },
    sourceId: source.instanceId,
    drawCardId: drawCard.instanceId,
    ownMemberIds: ownMembers.map((member) => member.instanceId),
  };
}

function resolveLiveSuccess(state: GameState): GameState {
  return confirmIfConfirmOnly(resolvePendingCardEffects(state).gameState);
}

describe('PL!HS-pb1-013 Kosuzu workflows', () => {
  it.each([
    { name: 'selects none', selectedIndexes: [], expectedTopIndexes: [], expectedWaitIndexes: [0, 1] },
    { name: 'selects one', selectedIndexes: [1], expectedTopIndexes: [1], expectedWaitIndexes: [0] },
    {
      name: 'selects two in chosen order',
      selectedIndexes: [1, 0],
      expectedTopIndexes: [1, 0],
      expectedWaitIndexes: [],
    },
  ])('LIVE start arrange $name', ({ selectedIndexes, expectedTopIndexes, expectedWaitIndexes }) => {
    const { state, deckCardIds } = setupArrange({ deckCount: 2 });
    const session = createSessionFromState(resolvePendingCardEffects(state).gameState);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(deckCardIds);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID &&
          action.payload.step === 'START_INSPECTION'
      )?.payload.publicEffectSummary
    ).toMatchObject({
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'STARTED',
      sourceActionLabel: 'LIVE开始',
      requestedInspectCount: 2,
      actualInspectedCount: 2,
    });

    expect(
      confirm(session, { selectedCardIds: selectedIndexes.map((index) => deckCardIds[index]!) })
        .success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds.slice(0, expectedTopIndexes.length)).toEqual(
      expectedTopIndexes.map((index) => deckCardIds[index]!)
    );
    const expectedWaitingRoomCardIds = expectedWaitIndexes.map((index) => deckCardIds[index]!);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expectedWaitingRoomCardIds
    );
    const enterWaitingRoomEvents = session.state!.eventLog.filter(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        entry.event.fromZone === ZoneType.MAIN_DECK &&
        expectedWaitingRoomCardIds.every((cardId) =>
          entry.event.cardInstanceIds?.includes(cardId)
        )
    );
    expect(enterWaitingRoomEvents.length).toBe(expectedWaitingRoomCardIds.length > 0 ? 1 : 0);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID &&
          action.payload.step === 'FINISH'
      )?.payload.publicEffectSummary
    ).toMatchObject({
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'COMPLETED',
      sourceActionLabel: 'LIVE开始',
      selectedCardIds: expectedTopIndexes.map((index) => deckCardIds[index]!),
      waitingRoomCardIds: expectedWaitIndexes.map((index) => deckCardIds[index]!),
    });
  });

  it('LIVE start arrange handles fewer than two cards and an empty main deck', () => {
    const oneCard = setupArrange({ deckCount: 1 });
    const oneCardSession = createSessionFromState(resolvePendingCardEffects(oneCard.state).gameState);

    expect(oneCardSession.state?.activeEffect?.inspectionCardIds).toEqual(oneCard.deckCardIds);
    expect(confirm(oneCardSession, { selectedCardIds: [] }).success).toBe(true);
    expect(oneCardSession.state?.players[0].waitingRoom.cardIds).toEqual(oneCard.deckCardIds);

    const emptyDeck = setupArrange({ deckCount: 0 });
    const emptyResolved = confirmIfConfirmOnly(resolvePendingCardEffects({
      ...emptyDeck.state,
      players: emptyDeck.state.players.map((player) =>
        player.id === PLAYER1
          ? { ...player, mainDeck: { ...player.mainDeck, cardIds: [] } }
          : player
      ),
    }).gameState);

    expect(emptyResolved.activeEffect).toBeNull();
    expect(emptyResolved.pendingAbilities).toEqual([]);
    expect(emptyResolved.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      emptyResolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          Array.isArray(action.payload.inspectedCardIds) &&
          action.payload.inspectedCardIds.length === 0
      )
    ).toBe(true);
  });

  it('continues pending effects after LIVE start arrange finishes', () => {
    const { state, deckCardIds, drawCardId } = setupArrange({
      deckCount: 2,
      appendLiveSuccessPending: true,
    });
    const session = createSessionFromState(resolvePendingCardEffects(state).gameState);

    if (session.state?.activeEffect?.abilityId === 'system:select-pending-card-effect') {
      const arrange = session.state.pendingAbilities.find(
        (ability) => ability.abilityId === HS_PB1_013_LIVE_START_LOOK_TOP_TWO_ARRANGE_ABILITY_ID
      );
      expect(arrange).toBeTruthy();
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            session.state.activeEffect.id,
            undefined,
            undefined,
            false,
            arrange!.id
          )
        ).success
      ).toBe(true);
    }

    expect(confirm(session, { selectedCardIds: [deckCardIds[0]!] }).success).toBe(true);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID,
      stepId: 'CONFIRM_ONLY_EFFECT',
    });
    expect(confirm(session).success).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([deckCardIds[0]!]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.includes(deckCardIds[0]!)
      )
    ).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([drawCardId]);
  });

  it('LIVE success draws one when own stage has a higher effective cost member', () => {
    const { state, drawCardId, ownMemberIds } = setupLiveSuccess({ ownCosts: [10] });
    const resolved = resolveLiveSuccess(state);

    expect(resolved.players[0].hand.cardIds).toEqual([drawCardId]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.higherCostMemberIds) &&
          action.payload.higherCostMemberIds.includes(ownMemberIds[0]!) &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.includes(drawCardId)
      )
    ).toBe(true);
  });

  it.each([
    { name: 'same cost', ownCosts: [9], opponentCosts: [] },
    { name: 'lower cost', ownCosts: [8], opponentCosts: [] },
    { name: 'only opponent higher cost', ownCosts: [8], opponentCosts: [20] },
  ])('LIVE success does not draw for $name', ({ ownCosts, opponentCosts }) => {
    const { state, drawCardId } = setupLiveSuccess({ ownCosts, opponentCosts });
    const resolved = resolveLiveSuccess(state);

    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([drawCardId]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });

  it('LIVE success uses effective cost modifiers for the higher-cost comparison', () => {
    const initial = setupLiveSuccess({ ownCosts: [8] });
    const state = {
      ...initial.state,
      liveResolution: {
        ...initial.state.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: PLAYER1,
            memberCardId: initial.ownMemberIds[0]!,
            countDelta: 2,
            sourceCardId: initial.sourceId,
            abilityId: 'test-member-cost-modifier',
          },
        ],
      },
    };
    const resolved = resolveLiveSuccess(state);

    expect(resolved.players[0].hand.cardIds).toEqual([initial.drawCardId]);
  });

  it('LIVE success consumes pending as no-op when the source is not on stage', () => {
    const { state, drawCardId } = setupLiveSuccess({
      ownCosts: [20],
      sourceInStage: false,
    });
    const resolved = resolveLiveSuccess(state);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([drawCardId]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_013_LIVE_SUCCESS_HIGHER_COST_STAGE_MEMBER_DRAW_ABILITY_ID &&
          action.payload.sourceOnStage === false &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });
});
