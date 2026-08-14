import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import type { EnterWaitingRoomEvent, GameEvent } from '../../src/domain/events/game-events';
import {
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID,
  PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getActivatedAbilityUiConfig } from '../../src/application/card-effects/runtime/activated-ability-ui';
import { setMemberOrientation } from '../../src/application/effects/member-state';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const AUTO = PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID;
const ACTIVATED = PL_PR_023_ACTIVATED_WAIT_OWN_MEMBER_DISCARD_DRAW_ONE_ABILITY_ID;
const AUTO_TEXT =
  '【自动】【1回合3次】每当存在于自己或对方舞台上的成员变为待机状态时，LIVE结束时为止，获得[ブレード]。';
const ACTIVATED_TEXT =
  '【起动】【1回合1次】将1名成员变为待机状态，将1张手牌放置入休息室：抽1张卡。';

function member(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function isEnterWaitingRoomEvent(event: GameEvent): event is EnterWaitingRoomEvent {
  return event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM;
}

function setup(
  options: {
    readonly sourceOrientation?: OrientationState;
    readonly ownTargetOrientation?: OrientationState;
    readonly opponentOrientation?: OrientationState;
    readonly handCount?: number;
    readonly deckCount?: number;
    readonly waitingCount?: number;
  } = {}
) {
  const source = createCardInstance(member('PL!-PR-023-PR', '绚濑绘里', 11), P1, 'eli');
  const ownTarget = createCardInstance(member('OWN-TARGET', 'Own Target'), P1, 'own-target');
  const opponent = createCardInstance(member('OPPONENT-TARGET', 'Opponent Target'), P2, 'opponent');
  const hand = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(member(`HAND-${index}`), P1, `hand-${index}`)
  );
  const deck = Array.from({ length: options.deckCount ?? 1 }, (_, index) =>
    createCardInstance(member(`DECK-${index}`), P1, `deck-${index}`)
  );
  const waiting = Array.from({ length: options.waitingCount ?? 0 }, (_, index) =>
    createCardInstance(member(`WAITING-${index}`), P1, `waiting-${index}`)
  );
  let game = createGameState('pl-pr-023-eli', P1, 'P1', P2, 'P2');
  game = registerCards(game, [source, ownTarget, opponent, ...hand, ...deck, ...waiting]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waiting.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      ownTarget.instanceId,
      {
        orientation: options.ownTargetOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
      orientation: options.opponentOrientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { game, source, ownTarget, opponent, hand, deck, waiting };
}

function setOrientationWithoutEvent(
  game: GameState,
  playerId: string,
  cardId: string,
  orientation: OrientationState
): GameState {
  return updatePlayer(game, playerId, (player) => {
    const cardStates = new Map(player.memberSlots.cardStates);
    const current = cardStates.get(cardId);
    if (current) cardStates.set(cardId, { ...current, orientation });
    return { ...player, memberSlots: { ...player.memberSlots, cardStates } };
  });
}

function waitAndEnqueue(game: GameState, playerId: string, cardId: string): GameState {
  const result = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'RULE',
    rule: 'TEST_WAIT',
  });
  if (!result || !result.changed) return game;
  const event = result.gameState.eventLog.at(-1)?.event;
  if (!event || event.eventType !== TriggerCondition.ON_MEMBER_STATE_CHANGED) return game;
  return enqueueTriggeredCardEffects(result.gameState, [TriggerCondition.ON_MEMBER_STATE_CHANGED], {
    memberStateChangedEvents: [event],
  });
}

function activate(game: GameState, sourceCardId: string): GameState {
  return activateCardAbility(game, P1, sourceCardId, ACTIVATED);
}

function confirm(game: GameState, selectedCardId: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, selectedCardId);
}

describe('PL!-PR-023-PR 费用11「绚濑绘里」', () => {
  it('keeps both player-visible ability paragraphs exact and reuses activatedUi.text', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('PL!-PR-023-UNSEEN');
    expect(definitions.find((definition) => definition.abilityId === AUTO)).toMatchObject({
      baseCardCodes: ['PL!-PR-023'],
      perTurnLimit: 3,
      effectText: AUTO_TEXT,
    });
    expect(definitions.find((definition) => definition.abilityId === ACTIVATED)).toMatchObject({
      baseCardCodes: ['PL!-PR-023'],
      perTurnLimit: 1,
      effectText: ACTIVATED_TEXT,
    });
    expect(getActivatedAbilityUiConfig('PL!-PR-023-PR')?.text).toBe(ACTIVATED_TEXT);
  });

  it('triggers for either player real ACTIVE -> WAITING changes and stops at three uses', () => {
    const scenario = setup();
    let game = waitAndEnqueue(scenario.game, P1, scenario.ownTarget.instanceId);
    game = resolvePendingCardEffects(game).gameState;
    expect(getMemberEffectiveBladeCount(game, P1, scenario.source.instanceId)).toBe(2);

    game = setOrientationWithoutEvent(
      game,
      P2,
      scenario.opponent.instanceId,
      OrientationState.ACTIVE
    );
    game = waitAndEnqueue(game, P2, scenario.opponent.instanceId);
    game = resolvePendingCardEffects(game).gameState;
    expect(getMemberEffectiveBladeCount(game, P1, scenario.source.instanceId)).toBe(3);

    for (let use = 3; use <= 4; use += 1) {
      game = setOrientationWithoutEvent(
        game,
        P1,
        scenario.ownTarget.instanceId,
        OrientationState.ACTIVE
      );
      game = waitAndEnqueue(game, P1, scenario.ownTarget.instanceId);
      if (use === 3) {
        expect(game.pendingAbilities.filter((ability) => ability.abilityId === AUTO)).toHaveLength(
          1
        );
        game = resolvePendingCardEffects(game).gameState;
      } else {
        expect(game.pendingAbilities.filter((ability) => ability.abilityId === AUTO)).toHaveLength(
          0
        );
      }
    }
    expect(getMemberEffectiveBladeCount(game, P1, scenario.source.instanceId)).toBe(4);
    expect(
      game.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === AUTO &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(3);
  });

  it('does not enqueue for a non-change and consumes a real pending as no-op after the source leaves', () => {
    const scenario = setup({ ownTargetOrientation: OrientationState.WAITING });
    const unchanged = setMemberOrientation(
      scenario.game,
      P1,
      scenario.ownTarget.instanceId,
      OrientationState.WAITING
    );
    expect(unchanged?.changed).toBe(false);
    expect(unchanged?.gameState.eventLog).toEqual(scenario.game.eventLog);

    let game = setOrientationWithoutEvent(
      scenario.game,
      P1,
      scenario.ownTarget.instanceId,
      OrientationState.ACTIVE
    );
    game = waitAndEnqueue(game, P1, scenario.ownTarget.instanceId);
    expect(game.pendingAbilities.some((ability) => ability.abilityId === AUTO)).toBe(true);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, scenario.source.instanceId),
    }));
    game = resolvePendingCardEffects(game).gameState;
    expect(game.pendingAbilities).toEqual([]);
    expect(game.liveResolution.liveModifiers).toEqual([]);
    expect(
      game.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === AUTO &&
          action.payload.step === 'SOURCE_NOT_ON_STAGE_NO_OP'
      )
    ).toBe(true);
  });

  it('allows a WAITING source to pay with another own ACTIVE member, then discards and draws', () => {
    const scenario = setup({ sourceOrientation: OrientationState.WAITING });
    let game = activate(scenario.game, scenario.source.instanceId);
    expect(game.activeEffect).toMatchObject({
      abilityId: ACTIVATED,
      effectText: ACTIVATED_TEXT,
      stepId: 'PL_PR_023_SELECT_OWN_ACTIVE_MEMBER_TO_WAIT',
      selectableCardIds: [scenario.ownTarget.instanceId],
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
    });
    game = confirm(game, scenario.ownTarget.instanceId);
    expect(game.activeEffect).toMatchObject({
      stepId: 'PL_PR_023_SELECT_HAND_CARD_TO_DISCARD',
      selectableCardIds: [scenario.hand[0]!.instanceId],
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
    });
    game = confirm(game, scenario.hand[0]!.instanceId);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([scenario.deck[0]!.instanceId]);
    expect(
      game.eventLog.some(
        ({ event }) =>
          isEnterWaitingRoomEvent(event) &&
          event.cardInstanceIds?.includes(scenario.hand[0]!.instanceId)
      )
    ).toBe(true);
    expect(
      game.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      game.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ACTIVATED &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
    expect(activate(game, scenario.source.instanceId)).toBe(game);
  });

  it('can wait itself as cost, queues its AUTO, and continues it after discard and draw', () => {
    const scenario = setup();
    let game = activate(scenario.game, scenario.source.instanceId);
    expect(game.activeEffect?.selectableCardIds).toEqual([
      scenario.ownTarget.instanceId,
      scenario.source.instanceId,
    ]);
    game = confirm(game, scenario.source.instanceId);
    expect(game.pendingAbilities).toContainEqual(
      expect.objectContaining({ abilityId: AUTO, sourceCardId: scenario.source.instanceId })
    );
    expect(
      game.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          event.cardInstanceId === scenario.source.instanceId &&
          event.previousOrientation === OrientationState.ACTIVE &&
          event.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
    game = confirm(game, scenario.hand[0]!.instanceId);
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveBladeCount(game, P1, scenario.source.instanceId)).toBe(2);
    expect(
      game.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ACTIVATED &&
          action.payload.step === 'WAIT_OWN_MEMBER_DISCARD_DRAW_ONE'
      )?.sequence
    ).toBeLessThan(
      game.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === AUTO &&
          action.payload.step === 'MEMBER_WAITED_GAIN_ONE_BLADE'
      )!.sequence
    );
  });

  it('never offers the opponent or WAITING members as the activated wait cost', () => {
    const scenario = setup({ ownTargetOrientation: OrientationState.WAITING });
    let game = activate(scenario.game, scenario.source.instanceId);
    expect(game.activeEffect?.selectableCardIds).toEqual([scenario.source.instanceId]);
    const beforeIllegal = game;
    game = confirm(game, scenario.opponent.instanceId);
    expect(game).toBe(beforeIllegal);
    game = confirm(game, scenario.ownTarget.instanceId);
    expect(game).toBe(beforeIllegal);
  });

  it('does not start without a hand card or an own ACTIVE member and pays no partial cost', () => {
    const noHand = setup({ handCount: 0 });
    expect(activate(noHand.game, noHand.source.instanceId)).toBe(noHand.game);
    expect(
      noHand.game.players[0].memberSlots.cardStates.get(noHand.source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);

    const noActive = setup({
      sourceOrientation: OrientationState.WAITING,
      ownTargetOrientation: OrientationState.WAITING,
    });
    expect(activate(noActive.game, noActive.source.instanceId)).toBe(noActive.game);
    expect(noActive.game.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('refreshes a stale discard choice and does not record the use until a current hand card pays', () => {
    const scenario = setup({ sourceOrientation: OrientationState.WAITING, handCount: 2 });
    let game = confirm(
      activate(scenario.game, scenario.source.instanceId),
      scenario.ownTarget.instanceId
    );
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: removeCardFromZone(player.hand, scenario.hand[0]!.instanceId),
      waitingRoom: addCardToZone(player.waitingRoom, scenario.hand[0]!.instanceId),
    }));
    const refreshed = confirm(game, scenario.hand[0]!.instanceId);
    expect(refreshed.activeEffect?.selectableCardIds).toEqual([scenario.hand[1]!.instanceId]);
    expect(
      refreshed.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ACTIVATED &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
    const done = confirm(refreshed, scenario.hand[1]!.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].mainDeck.cardIds).toEqual(
      expect.arrayContaining(scenario.hand.map((card) => card.instanceId))
    );
  });

  it('draws across refresh when the deck is empty and preserves both paid costs', () => {
    const scenario = setup({ sourceOrientation: OrientationState.WAITING, deckCount: 0 });
    let game = confirm(
      activate(scenario.game, scenario.source.instanceId),
      scenario.ownTarget.instanceId
    );
    game = confirm(game, scenario.hand[0]!.instanceId);
    expect(
      game.players[0].memberSlots.cardStates.get(scenario.ownTarget.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(game.players[0].hand.cardIds).toEqual([scenario.hand[0]!.instanceId]);
    expect(
      game.actionHistory.some(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      )
    ).toBe(true);
    expect(
      game.eventLog.some(
        ({ event }) =>
          isEnterWaitingRoomEvent(event) &&
          event.cardInstanceIds?.includes(scenario.hand[0]!.instanceId)
      )
    ).toBe(true);
  });
});
