import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
  S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(id: string, groupNames: readonly string[] = ['Aqours'], ownerId = P1) {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
  return createCardInstance(data, ownerId, id);
}

function live(id: string, groupNames: readonly string[] = ['Aqours']) {
  const data: LiveCardData = {
    cardCode: id,
    name: id,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
  return createCardInstance(data, P1, id);
}

function energy(id: string) {
  const data: EnergyCardData = {
    cardCode: id,
    name: id,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, P1, id);
}

function pending(abilityId: string, sourceCardId: string, id: string): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  abilityId: string,
  sourceCode: string,
  deckCards: readonly ReturnType<typeof member>[],
  waitingCards: readonly ReturnType<typeof member>[] = []
) {
  const source = member(sourceCode);
  let game = registerCards(createGameState('mill-bottom-heart', P1, 'P1', P2, 'P2'), [
    source,
    ...deckCards,
    ...waitingCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingCards.map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    pendingAbilities: [pending(abilityId, source.instanceId, 'pending')],
  };
  return { game, source };
}

function confirmSingle(game: GameState): GameState {
  const revealed = resolvePendingCardEffects(game).gameState;
  expect(revealed.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
  expect(revealed.activeEffect?.stepId).toContain('REVEAL_MILLED_BOTTOM');
  return confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id, null);
}

function heartModifiers(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'HEART' && modifier.abilityId === abilityId
  );
}

describe('LIVE_START bottom-mill all-match gain source-member Heart family', () => {
  it('enters the real ON_LIVE_START queue from the exact stage-member definition', () => {
    const scenario = setup(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
      'PL!S-bp7-015-N',
      [live('bottom-live')]
    );
    const game = { ...scenario.game, pendingAbilities: [] };
    const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START]);
    expect(queued.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
        sourceCardId: scenario.source.instanceId,
        controllerId: P1,
        timingId: TriggerCondition.ON_LIVE_START,
      }),
    ]);
  });

  it('publicly reveals PL!S-bp7-006-P 费用2「津岛善子」 bottom cards to both players before granting Heart', () => {
    const cards = [member('top'), member('aqours-a'), member('aqours-b'), member('aqours-c')];
    const { game } = setup(
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
      'PL!S-bp7-006-P',
      cards
    );
    const revealed = resolvePendingCardEffects(game).gameState;
    const movedCardIds = ['aqours-c', 'aqours-b', 'aqours-a'];
    expect(revealed.players[0].mainDeck.cardIds).toEqual(['top']);
    expect(revealed.players[0].waitingRoom.cardIds).toEqual(movedCardIds);
    expect(revealed.activeEffect?.revealedCardIds).toEqual(movedCardIds);
    expect(revealed.activeEffect?.stepText).toContain('这些卡均为『Aqours』成员卡');
    expect(revealed.liveResolution.liveModifiers).toEqual([]);
    for (const viewerId of [P1, P2]) {
      expect(projectPlayerViewState(revealed, viewerId).activeEffect?.revealedObjectIds).toEqual(
        movedCardIds.map(createPublicObjectId)
      );
    }
    const done = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    expect(
      heartModifiers(
        done,
        S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID
      )
    ).toHaveLength(1);
  });

  it('publicly reveals PL!S-bp7-015-N 费用5「津岛善子」 bottom LIVE before granting red Heart', () => {
    const scenario = setup(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
      'PL!S-bp7-015-N',
      [member('top'), live('bottom-live')]
    );
    const revealed = resolvePendingCardEffects(scenario.game).gameState;
    expect(revealed.players[0].waitingRoom.cardIds).toEqual(['bottom-live']);
    expect(revealed.activeEffect?.revealedCardIds).toEqual(['bottom-live']);
    expect(revealed.activeEffect?.stepText).toContain('这些卡均为LIVE卡');
    expect(
      heartModifiers(revealed, S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID)
    ).toEqual([]);
    const opponentView = projectPlayerViewState(revealed, P2);
    expect(opponentView.activeEffect?.revealedObjectIds).toEqual([
      createPublicObjectId('bottom-live'),
    ]);
    const done = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    expect(
      heartModifiers(done, S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID)
    ).toHaveLength(1);
  });

  it('PL!S-bp7-006-P 费用2「津岛善子」mills bottom three in order and gains green Heart only when all are Aqours members', () => {
    const cards = [member('top'), member('aqours-a'), member('aqours-b'), member('aqours-c')];
    const { game, source } = setup(
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
      'PL!S-bp7-006-P',
      cards
    );
    const done = confirmSingle(game);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['aqours-c', 'aqours-b', 'aqours-a']);
    expect(
      heartModifiers(
        done,
        S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID
      )
    ).toEqual([
      expect.objectContaining({
        target: 'SOURCE_MEMBER',
        playerId: P1,
        sourceCardId: source.instanceId,
        hearts: [{ color: HeartColor.GREEN, count: 1 }],
      }),
    ]);
    expect(done.liveResolution.playerHeartBonuses.size).toBe(0);
  });

  it.each([
    ['non-Aqours member', member('other-member', ['虹ヶ咲'])],
    ['Aqours LIVE', live('aqours-live')],
    ['non-member card', live('other-live', ['虹ヶ咲'])],
  ])('does not reward when bottom three contain %s', (_label, mismatch) => {
    const cards = [member('top'), member('aqours-a'), member('aqours-b'), mismatch];
    const { game } = setup(
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
      'PL!S-bp7-006-P',
      cards
    );
    const done = confirmSingle(game);
    expect(
      heartModifiers(
        done,
        S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('does not reward the three-card ability when zero cards can actually move', () => {
    const empty = setup(
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
      'PL!S-bp7-006-P',
      []
    );
    const emptyDone = confirmSingle(empty.game);
    expect(
      heartModifiers(
        emptyDone,
        S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('PL!S-bp7-015-N 费用5「津岛善子」gains red Heart for a bottom LIVE and not for a member', () => {
    const liveScenario = setup(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
      'PL!S-bp7-015-N',
      [member('top'), live('bottom-live')]
    );
    const liveDone = confirmSingle(liveScenario.game);
    expect(
      heartModifiers(liveDone, S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID)
    ).toEqual([
      expect.objectContaining({
        target: 'SOURCE_MEMBER',
        sourceCardId: liveScenario.source.instanceId,
        hearts: [{ color: HeartColor.RED, count: 1 }],
      }),
    ]);

    const memberScenario = setup(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
      'PL!S-bp7-015-N',
      [member('bottom-member')]
    );
    expect(
      heartModifiers(
        confirmSingle(memberScenario.game),
        S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID
      )
    ).toEqual([]);

    const energyScenario = setup(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
      'PL!S-bp7-015-N',
      [energy('bottom-energy')]
    );
    expect(
      heartModifiers(
        confirmSingle(energyScenario.game),
        S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('judges the actual post-refresh moved cards and expires source-member Hearts at LIVE end', () => {
    const greenScenario = setup(
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
      'PL!S-bp7-006-P',
      [member('initial-bottom')],
      [member('refresh-a'), member('refresh-b')]
    );
    const greenDone = confirmSingle(greenScenario.game);
    expect(
      heartModifiers(
        greenDone,
        S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID
      )
    ).toHaveLength(1);

    const redScenario = setup(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
      'PL!S-bp7-015-N',
      [],
      [live('refresh-live')]
    );
    const redDone = confirmSingle(redScenario.game);
    expect(
      heartModifiers(redDone, S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID)
    ).toHaveLength(1);
    const finalized = new GameService().finalizeLiveResult(redDone);
    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });

  it('uses adjacent LIVE_START source-validity semantics and resolves no-op after the source leaves stage', () => {
    const scenario = setup(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
      'PL!S-bp7-015-N',
      [live('bottom-live')]
    );
    const game = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const done = resolvePendingCardEffects(game).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].mainDeck.cardIds).toEqual(['bottom-live']);
    expect(
      heartModifiers(done, S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID)
    ).toEqual([]);
  });

  it('ordered batch preserves order while pausing on each public bottom-card reveal', () => {
    const sourceA = member('PL!S-bp7-006-P');
    const sourceB = member('PL!S-bp7-015-N');
    const cards = [
      member('top'),
      live('live-bottom'),
      member('aqours-b'),
      member('aqours-c'),
      member('aqours-d'),
    ];
    let game = registerCards(createGameState('ordered-bottom-mill', P1, 'P1', P2, 'P2'), [
      sourceA,
      sourceB,
      ...cards,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sourceA.instanceId),
        SlotPosition.LEFT,
        sourceB.instanceId
      ),
      mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    }));
    game = {
      ...game,
      pendingAbilities: [
        pending(
          S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
          sourceA.instanceId,
          'a'
        ),
        pending(
          S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
          sourceB.instanceId,
          'b'
        ),
      ],
    };
    const order = resolvePendingCardEffects(game).gameState;
    expect(order.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const firstReveal = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      null,
      null,
      true
    );
    expect(firstReveal.activeEffect?.abilityId).toBe(
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(firstReveal.activeEffect?.revealedCardIds).toEqual(['aqours-d', 'aqours-c', 'aqours-b']);
    const secondReveal = confirmActiveEffectStep(firstReveal, P1, firstReveal.activeEffect!.id);
    expect(secondReveal.activeEffect?.abilityId).toBe(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID
    );
    expect(secondReveal.activeEffect?.revealedCardIds).toEqual(['live-bottom']);
    const done = confirmActiveEffectStep(secondReveal, P1, secondReveal.activeEffect!.id);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toHaveLength(4);
  });

  it('manual selection from a multi-pending pool opens the public reveal directly without a confirm-only double popup', () => {
    const sourceA = member('PL!S-bp7-006-P');
    const sourceB = member('PL!S-bp7-015-N');
    const bottomLive = live('bottom-live');
    const remainingCards = [
      member('top'),
      member('aqours-a'),
      member('aqours-b'),
      member('aqours-c'),
    ];
    let game = registerCards(createGameState('manual-bottom-mill', P1, 'P1', P2, 'P2'), [
      sourceA,
      sourceB,
      ...remainingCards,
      bottomLive,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sourceA.instanceId),
        SlotPosition.LEFT,
        sourceB.instanceId
      ),
      mainDeck: {
        ...player.mainDeck,
        cardIds: [...remainingCards.map((card) => card.instanceId), bottomLive.instanceId],
      },
    }));
    game = {
      ...game,
      pendingAbilities: [
        pending(
          S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
          sourceA.instanceId,
          'a'
        ),
        pending(
          S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
          sourceB.instanceId,
          'b'
        ),
      ],
    };
    const order = resolvePendingCardEffects(game).gameState;
    const reveal = confirmActiveEffectStep(order, P1, order.activeEffect!.id, sourceB.instanceId);
    expect(reveal.activeEffect?.abilityId).toBe(
      S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID
    );
    expect(reveal.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(reveal.activeEffect?.revealedCardIds).toEqual(['bottom-live']);
    expect(reveal.players[0].waitingRoom.cardIds).toEqual(['bottom-live']);
    expect(
      heartModifiers(reveal, S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID)
    ).toEqual([]);
    const afterConfirmation = confirmActiveEffectStep(reveal, P1, reveal.activeEffect!.id, null);
    expect(afterConfirmation.activeEffect?.abilityId).toBe(
      S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(afterConfirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(afterConfirmation.activeEffect?.revealedCardIds).toEqual([
      'aqours-c',
      'aqours-b',
      'aqours-a',
    ]);
    expect(afterConfirmation.players[0].mainDeck.cardIds).toEqual(['top']);
    expect(afterConfirmation.players[0].waitingRoom.cardIds).toEqual([
      'bottom-live',
      'aqours-c',
      'aqours-b',
      'aqours-a',
    ]);
    expect(
      afterConfirmation.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID &&
          Array.isArray(action.payload.movedCardIds) &&
          action.payload.movedCardIds.includes('bottom-live')
      )
    ).toBe(true);
  });

  it('stops an ordered batch and rebuilds the live pending pool when bottom mill creates a new pending', () => {
    const sourceA = member('PL!S-bp7-015-N');
    const sourceB = member('PL!S-bp7-006-P');
    const listener = member('PL!SP-bp5-005-R');
    const cards = [
      member('top'),
      member('aqours-a'),
      member('aqours-b'),
      member('aqours-c'),
      live('bottom-live'),
    ];
    let game = registerCards(
      createGameState('ordered-bottom-mill-new-pending', P1, 'P1', P2, 'P2'),
      [sourceA, sourceB, listener, ...cards]
    );
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sourceA.instanceId),
          SlotPosition.LEFT,
          sourceB.instanceId
        ),
        SlotPosition.RIGHT,
        listener.instanceId
      ),
      mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    }));
    game = {
      ...game,
      pendingAbilities: [
        pending(
          S_BP7_015_LIVE_START_MILL_BOTTOM_ONE_LIVE_GAIN_RED_HEART_ABILITY_ID,
          sourceA.instanceId,
          'a'
        ),
        pending(
          S_BP7_006_LIVE_START_MILL_BOTTOM_THREE_ALL_AQOURS_MEMBERS_GAIN_GREEN_HEART_ABILITY_ID,
          sourceB.instanceId,
          'b'
        ),
      ],
    };
    const order = resolvePendingCardEffects(game).gameState;
    const reveal = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(reveal.activeEffect?.revealedCardIds).toEqual(['bottom-live']);
    const reopened = confirmActiveEffectStep(reveal, P1, reveal.activeEffect!.id);
    expect(reopened.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(reopened.pendingAbilities.map((ability) => ability.id)).toContain('b');
    expect(
      reopened.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(true);
  });
});
