import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_031_AUTO_OWN_LIVE_SUCCESS_MILL_RECOVER_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
  N_BP7_031_LIVE_SUCCESS_MILL_TOP_THREE_ABILITY_ID,
  PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
  SP_BP7_026_LIVE_START_RETURN_ONE_ENERGY_REN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
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
import {
  createEnterWaitingRoomEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { CardType, HeartColor, TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'like-a-treasure';
const LIVE_SUCCESS_ABILITY_ID = N_BP7_031_LIVE_SUCCESS_MILL_TOP_THREE_ABILITY_ID;
const AUTO_ABILITY_ID =
  N_BP7_031_AUTO_OWN_LIVE_SUCCESS_MILL_RECOVER_NIJIGASAKI_LIVE_SCORE_ABILITY_ID;

function live(cardCode: string, name = cardCode, group = '虹ヶ咲', score = 1): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [group],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function member(cardCode: string, group = '虹ヶ咲'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [group],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup(options: { readonly sourceCode?: string } = {}) {
  const source = createCardInstance(
    live(options.sourceCode ?? 'PL!N-bp7-031-L', 'Like a Treasure', '虹ヶ咲', 5),
    P1,
    SOURCE_ID
  );
  const nijiLive = createCardInstance(live('PL!N-test-live', '虹咲LIVE'), P1, 'niji-live');
  const nijiMember = createCardInstance(member('PL!N-test-member'), P1, 'niji-member');
  const aqoursLive = createCardInstance(
    live('PL!S-test-live', 'Aqours LIVE', 'Aqours'),
    P1,
    'aqours-live'
  );
  const unrelatedNijiLive = createCardInstance(
    live('PL!N-unrelated-live', '无关虹咲LIVE'),
    P1,
    'unrelated-niji-live'
  );
  const deckBottom = createCardInstance(member('PL!N-deck-bottom'), P1, 'deck-bottom');
  let game = registerCards(createGameState('n-bp7-031', P1, 'P1', P2, 'P2'), [
    source,
    nijiLive,
    nijiMember,
    aqoursLive,
    unrelatedNijiLive,
    deckBottom,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: { ...player.liveZone, cardIds: [source.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [
        nijiLive.instanceId,
        nijiMember.instanceId,
        aqoursLive.instanceId,
        deckBottom.instanceId,
      ],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [unrelatedNijiLive.instanceId],
    },
  }));
  return {
    game,
    source,
    nijiLive,
    nijiMember,
    aqoursLive,
    unrelatedNijiLive,
    deckBottom,
  };
}

function pendingAuto(
  movedCardIds: readonly string[],
  id = 'like-a-treasure-auto'
): PendingAbilityState {
  return {
    id,
    abilityId: AUTO_ABILITY_ID,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_WAITING_ROOM,
    eventIds: [`${id}-event`],
    metadata: {
      movedCardIds,
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      causedByPlayerId: P1,
      causedByAbilityId: LIVE_SUCCESS_ABILITY_ID,
    },
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function abilityUses(game: GameState) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === AUTO_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  );
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === AUTO_ABILITY_ID
  );
}

function enqueueWaitingRoomEvent(
  game: GameState,
  movedCardIds: readonly string[],
  options: {
    readonly ownerId?: string;
    readonly controllerId?: string;
    readonly causedByPlayerId?: string;
    readonly causedByAbilityId?: string;
    readonly withCause?: boolean;
  } = {}
): GameState {
  const ownerId = options.ownerId ?? P1;
  const controllerId = options.controllerId ?? P1;
  const event = createEnterWaitingRoomEvent(
    movedCardIds,
    ZoneType.MAIN_DECK,
    ownerId,
    controllerId,
    options.withCause === false
      ? undefined
      : {
          kind: 'CARD_EFFECT',
          playerId: options.causedByPlayerId ?? P1,
          sourceCardId: SOURCE_ID,
          abilityId: options.causedByAbilityId ?? LIVE_SUCCESS_ABILITY_ID,
          pendingAbilityId: 'cause-pending',
        }
  );
  return enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
    enterWaitingRoomEvents: [event],
  });
}

describe('PL!N-bp7-031-L 分数5「Like a Treasure」', () => {
  it('mills the top three on real LIVE_SUCCESS and preserves one grouped causal event', () => {
    const scenario = setup();
    const successEvent = createLiveSuccessEvent(P1, [SOURCE_ID], 5);
    let game = enqueueTriggeredCardEffects(scenario.game, [TriggerCondition.ON_LIVE_SUCCESS], {
      liveSuccessEvents: [successEvent],
    });
    game = resolve(game);
    expect(game.activeEffect).toMatchObject({
      abilityId: LIVE_SUCCESS_ABILITY_ID,
      stepId: 'N_BP7_031_REVEAL_MILLED_TOP_THREE',
      revealedCardIds: [
        scenario.nijiLive.instanceId,
        scenario.nijiMember.instanceId,
        scenario.aqoursLive.instanceId,
      ],
    });
    const millEvent = game.eventLog
      .map((entry) => entry.event)
      .find(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      );
    expect(millEvent).toMatchObject({
      cardInstanceIds: [
        scenario.nijiLive.instanceId,
        scenario.nijiMember.instanceId,
        scenario.aqoursLive.instanceId,
      ],
      ownerId: P1,
      controllerId: P1,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: SOURCE_ID,
        abilityId: LIVE_SUCCESS_ABILITY_ID,
      },
    });
    expect(
      game.pendingAbilities.find((ability) => ability.abilityId === AUTO_ABILITY_ID)?.metadata
    ).toMatchObject({
      movedCardIds: [
        scenario.nijiLive.instanceId,
        scenario.nijiMember.instanceId,
        scenario.aqoursLive.instanceId,
      ],
      causedByPlayerId: P1,
      causedBySourceCardId: SOURCE_ID,
      causedByAbilityId: LIVE_SUCCESS_ABILITY_ID,
    });

    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id);
    game = resolve(game);
    expect(game.activeEffect).toMatchObject({
      abilityId: AUTO_ABILITY_ID,
      selectableCardIds: [scenario.nijiLive.instanceId],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
  });

  it('selects only a Nijigasaki LIVE from the exact moved set and ignores unrelated waiting cards', () => {
    const scenario = setup();
    const gameWithMovedCards = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [
          scenario.nijiLive.instanceId,
          scenario.nijiMember.instanceId,
          scenario.aqoursLive.instanceId,
          scenario.unrelatedNijiLive.instanceId,
        ],
      },
    }));
    const game = resolve({
      ...gameWithMovedCards,
      pendingAbilities: [
        pendingAuto([
          scenario.nijiLive.instanceId,
          scenario.nijiMember.instanceId,
          scenario.aqoursLive.instanceId,
        ]),
      ],
    });
    expect(game.activeEffect).toMatchObject({
      selectableCardIds: [scenario.nijiLive.instanceId],
      confirmSelectionLabel: '加入手牌',
      metadata: {
        publicCardSelectionConfirmation: { destination: 'HAND' },
      },
    });
  });

  it('reveals the public choice to both players before moving it, then recovers and scores once', () => {
    const scenario = setup();
    const waiting = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [scenario.nijiLive.instanceId],
      },
    }));
    let game = resolve({
      ...waiting,
      pendingAbilities: [pendingAuto([scenario.nijiLive.instanceId])],
    });
    const effectId = game.activeEffect!.id;
    game = confirmActiveEffectStep(game, P1, effectId, scenario.nijiLive.instanceId);
    expect(game.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [scenario.nijiLive.instanceId],
    });
    expect(game.players[0].waitingRoom.cardIds).toContain(scenario.nijiLive.instanceId);
    expect(game.players[0].hand.cardIds).not.toContain(scenario.nijiLive.instanceId);
    expect(scoreModifiers(game)).toEqual([]);
    expect(abilityUses(game)).toEqual([]);
    const publicId = createPublicObjectId(scenario.nijiLive.instanceId);
    expect(projectPlayerViewState(game, P1).activeEffect?.revealedObjectIds).toEqual([publicId]);
    expect(projectPlayerViewState(game, P2).activeEffect?.revealedObjectIds).toEqual([publicId]);

    game = confirmActiveEffectStep(game, P1, effectId);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].waitingRoom.cardIds).not.toContain(scenario.nijiLive.instanceId);
    expect(game.players[0].hand.cardIds).toContain(scenario.nijiLive.instanceId);
    expect(abilityUses(game)).toHaveLength(1);
    expect(scoreModifiers(game)).toEqual([
      expect.objectContaining({
        playerId: P1,
        liveCardId: SOURCE_ID,
        sourceCardId: SOURCE_ID,
        abilityId: AUTO_ABILITY_ID,
        countDelta: 1,
      }),
    ]);
    expect(game.liveResolution.playerScores.get(P1)).toBe(1);
  });

  it('does not consume the turn use when declined and permits a later valid trigger', () => {
    const scenario = setup();
    let game = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [scenario.nijiLive.instanceId, scenario.unrelatedNijiLive.instanceId],
      },
    }));
    game = resolve({
      ...game,
      pendingAbilities: [pendingAuto([scenario.nijiLive.instanceId], 'first-auto')],
    });
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, null);
    expect(game.activeEffect).toBeNull();
    expect(abilityUses(game)).toEqual([]);

    game = resolve(enqueueWaitingRoomEvent(game, [scenario.unrelatedNijiLive.instanceId]));
    expect(game.activeEffect?.selectableCardIds).toEqual([scenario.unrelatedNijiLive.instanceId]);
    game = confirmActiveEffectStepThroughPublicReveal(
      game,
      P1,
      game.activeEffect!.id,
      scenario.unrelatedNijiLive.instanceId
    );
    expect(abilityUses(game)).toHaveLength(1);
    expect(game.liveResolution.playerScores.get(P1)).toBe(1);
  });

  it('blocks later triggers in the same turn only after a successful recovery', () => {
    const scenario = setup();
    let game = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [scenario.nijiLive.instanceId, scenario.unrelatedNijiLive.instanceId],
      },
    }));
    game = resolve(enqueueWaitingRoomEvent(game, [scenario.nijiLive.instanceId]));
    game = confirmActiveEffectStepThroughPublicReveal(
      game,
      P1,
      game.activeEffect!.id,
      scenario.nijiLive.instanceId
    );
    const afterSecond = enqueueWaitingRoomEvent(game, [scenario.unrelatedNijiLive.instanceId]);
    expect(afterSecond.pendingAbilities).toEqual([]);
    expect(abilityUses(afterSecond)).toHaveLength(1);
    expect(scoreModifiers(afterSecond)).toHaveLength(1);
  });

  it.each([
    ['missing cause', { withCause: false }],
    [
      'non-LIVE_SUCCESS cause',
      {
        causedByAbilityId:
          SP_BP7_026_LIVE_START_RETURN_ONE_ENERGY_REN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      },
    ],
    ['opponent cause', { causedByPlayerId: P2 }],
    ['foreign owner', { ownerId: P2 }],
  ] as const)('does not enqueue for %s', (_label, options) => {
    const scenario = setup();
    const game = enqueueWaitingRoomEvent(scenario.game, [scenario.nijiLive.instanceId], options);
    expect(game.pendingAbilities).toEqual([]);
  });

  it('enqueues from the LIVE zone only for an own LIVE_SUCCESS ability cause', () => {
    const scenario = setup();
    const game = enqueueWaitingRoomEvent(scenario.game, [scenario.nijiLive.instanceId]);
    expect(game.pendingAbilities).toHaveLength(1);
    expect(game.pendingAbilities[0]).toMatchObject({
      abilityId: AUTO_ABILITY_ID,
      sourceCardId: SOURCE_ID,
      controllerId: P1,
      timingId: TriggerCondition.ON_ENTER_WAITING_ROOM,
    });
    expect(game.pendingAbilities[0]?.metadata).toMatchObject({
      movedCardIds: [scenario.nijiLive.instanceId],
      causedByPlayerId: P1,
      causedByAbilityId: LIVE_SUCCESS_ABILITY_ID,
      causedByPendingAbilityId: 'cause-pending',
    });
  });

  it('accepts another implemented own LIVE_SUCCESS ability as the causal source', () => {
    const scenario = setup();
    const game = enqueueWaitingRoomEvent(scenario.game, [scenario.nijiLive.instanceId], {
      causedByAbilityId:
        PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
    });
    expect(game.pendingAbilities).toHaveLength(1);
    expect(game.pendingAbilities[0]).toMatchObject({
      abilityId: AUTO_ABILITY_ID,
    });
    expect(game.pendingAbilities[0]?.metadata).toMatchObject({
      causedByAbilityId:
        PL_N_BP4_011_LIVE_SUCCESS_MILL_FIVE_RECOVER_DISTINCT_NIJIGASAKI_LIVE_ABILITY_ID,
    });
  });

  it('finishes without use or score when the revealed target or source becomes stale', () => {
    const scenario = setup();
    let game = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [scenario.nijiLive.instanceId],
      },
    }));
    game = resolve({
      ...game,
      pendingAbilities: [pendingAuto([scenario.nijiLive.instanceId])],
    });
    const effectId = game.activeEffect!.id;
    game = confirmActiveEffectStep(game, P1, effectId, scenario.nijiLive.instanceId);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: [scenario.nijiLive.instanceId] },
    }));
    game = confirmActiveEffectStep(game, P1, effectId);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).not.toContain(scenario.nijiLive.instanceId);
    expect(abilityUses(game)).toEqual([]);
    expect(scoreModifiers(game)).toEqual([]);
    expect(game.liveResolution.playerScores.get(P1) ?? 0).toBe(0);
  });

  it('consumes an invalid exact source and an empty moved set without spending the turn use', () => {
    const invalidSource = setup({ sourceCode: 'PL!N-bp7-031-P' });
    const deckBefore = invalidSource.game.players[0].mainDeck.cardIds;
    let game = resolve({
      ...invalidSource.game,
      pendingAbilities: [
        {
          id: 'invalid-live-success-source',
          abilityId: LIVE_SUCCESS_ABILITY_ID,
          sourceCardId: SOURCE_ID,
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_SUCCESS,
          eventIds: ['invalid-live-success-event'],
        },
      ],
    });
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(game.players[0].mainDeck.cardIds).toEqual(deckBefore);
    expect(
      game.actionHistory.find(
        (action) =>
          action.payload.abilityId === LIVE_SUCCESS_ABILITY_ID &&
          action.payload.step === 'SOURCE_INVALID_OR_NOT_IN_LIVE_ZONE'
      )
    ).toBeDefined();

    game = resolve({
      ...invalidSource.game,
      pendingAbilities: [pendingAuto([invalidSource.nijiLive.instanceId])],
    });
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(abilityUses(game)).toEqual([]);

    const scenario = setup();
    game = resolve({
      ...scenario.game,
      pendingAbilities: [pendingAuto([scenario.nijiLive.instanceId])],
    });
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(abilityUses(game)).toEqual([]);
  });
});
