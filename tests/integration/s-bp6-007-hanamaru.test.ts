import { describe, expect, it } from 'vitest';
import type { MemberCardData, LiveCardData } from '../../src/domain/entities/card';
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
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  getCardAbilityDefinitions,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP6_007_LIVE_START_PAY_ENERGY_OR_DISCARD_GRANT_AQOURS_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const ABILITY_ID = S_BP6_007_LIVE_START_PAY_ENERGY_OR_DISCARD_GRANT_AQOURS_SCORE_ABILITY_ID;

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `${ABILITY_ID}:${sourceCardId}:pending`,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`${ABILITY_ID}:event`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function prepareGame(options: {
  readonly ownSuccessCount?: number;
  readonly opponentSuccessCount?: number;
  readonly ownEnergyCount?: number;
  readonly handCount?: number;
} = {}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly aqoursLeft: ReturnType<typeof createCardInstance>;
  readonly aqoursRight: ReturnType<typeof createCardInstance>;
  readonly nonAqours: ReturnType<typeof createCardInstance>;
  readonly opponentMember: ReturnType<typeof createCardInstance>;
  readonly offStageAqours: ReturnType<typeof createCardInstance>;
  readonly energyCards: readonly ReturnType<typeof createCardInstance>[];
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
} {
  const source = createCardInstance(
    createMemberCard('PL!S-bp6-007-P', { name: '国木田花丸', cost: 11 }),
    PLAYER1,
    'hanamaru-source'
  );
  const aqoursLeft = createCardInstance(createMemberCard('PL!S-target-left'), PLAYER1, 'aqours-left');
  const aqoursRight = createCardInstance(
    createMemberCard('PL!S-target-right'),
    PLAYER1,
    'aqours-right'
  );
  const nonAqours = createCardInstance(
    createMemberCard('PL!SP-non-aqours', { groupNames: ['Liella!'] }),
    PLAYER1,
    'non-aqours'
  );
  const opponentMember = createCardInstance(
    createMemberCard('PL!S-opponent-member'),
    PLAYER2,
    'opponent-member'
  );
  const offStageAqours = createCardInstance(
    createMemberCard('PL!S-off-stage-aqours'),
    PLAYER1,
    'off-stage-aqours'
  );
  const energyCards = Array.from({ length: options.ownEnergyCount ?? 2 }, (_unused, index) =>
    createCardInstance(createMemberCard(`PL!S-energy-${index}`), PLAYER1, `energy-${index}`)
  );
  const handCards = Array.from({ length: options.handCount ?? 2 }, (_unused, index) =>
    createCardInstance(createMemberCard(`PL!S-hand-${index}`), PLAYER1, `hand-${index}`)
  );
  const ownSuccessLives = Array.from({ length: options.ownSuccessCount ?? 0 }, (_unused, index) =>
    createCardInstance(createLiveCard(`PL!S-own-success-${index}`), PLAYER1, `own-success-${index}`)
  );
  const opponentSuccessLives = Array.from(
    { length: options.opponentSuccessCount ?? 2 },
    (_unused, index) =>
      createCardInstance(
        createLiveCard(`PL!S-opponent-success-${index}`),
        PLAYER2,
        `opponent-success-${index}`
      )
  );

  let game = registerCards(createGameState('s-bp6-007', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    aqoursLeft,
    aqoursRight,
    nonAqours,
    opponentMember,
    offStageAqours,
    ...energyCards,
    ...handCards,
    ...ownSuccessLives,
    ...opponentSuccessLives,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        aqoursLeft.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      SlotPosition.RIGHT,
      aqoursRight.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
    hand: {
      ...player.hand,
      cardIds: [...handCards.map((card) => card.instanceId), offStageAqours.instanceId],
    },
    energyZone: energyCards.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    successZone: ownSuccessLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentMember.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    successZone: opponentSuccessLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));

  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
        playerScores: new Map([[PLAYER1, 5]]),
      },
      pendingAbilities: [createPendingAbility(source.instanceId)],
    },
    source,
    aqoursLeft,
    aqoursRight,
    nonAqours,
    opponentMember,
    offStageAqours,
    energyCards,
    handCards,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseOption(game: GameState, optionId: string | null): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    optionId === null ? null : undefined,
    undefined,
    undefined,
    optionId
  );
}

function chooseCards(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  );
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ABILITY_ID
  );
}

describe('PL!S-bp6-007 国木田花丸 LIVE_START workflow', () => {
  it('matches P/R through baseCardCodes in classification', () => {
    for (const cardCode of ['PL!S-bp6-007-P', 'PL!S-bp6-007-R']) {
      const ability = getCardAbilityDefinitions(cardCode).find(
        (definition) => definition.abilityId === ABILITY_ID
      );
      expect(ability).toMatchObject({
        baseCardCodes: ['PL!S-bp6-007'],
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
      });
    }
  });

  it('pays [E][E], selects two Aqours stage members, adds two SCORE modifiers, and refreshes playerScores', () => {
    const { game, aqoursLeft, aqoursRight, energyCards } = prepareGame();

    const selectingCost = start(game);
    const selectingTargets = chooseOption(selectingCost, 'pay-energy');
    const resolved = chooseCards(selectingTargets, [aqoursLeft.instanceId, aqoursRight.instanceId]);

    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.players[0].energyZone.cardStates.get(energyCards[0]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      resolved.players[0].energyZone.cardStates.get(energyCards[1]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(scoreModifiers(resolved)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: aqoursLeft.instanceId,
        abilityId: ABILITY_ID,
      },
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: aqoursRight.instanceId,
        abilityId: ABILITY_ID,
      },
    ]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7);
  });

  it('discards two hand cards through the trigger-enqueue helper before selecting targets', () => {
    const { game, handCards, aqoursLeft } = prepareGame();

    const selectingDiscard = chooseOption(start(game), 'discard-hand');
    const selectingTargets = chooseCards(selectingDiscard, [
      handCards[0]!.instanceId,
      handCards[1]!.instanceId,
    ]);
    const resolved = chooseCards(selectingTargets, [aqoursLeft.instanceId]);

    expect(resolved.players[0].hand.cardIds).not.toContain(handCards[0]!.instanceId);
    expect(resolved.players[0].hand.cardIds).not.toContain(handCards[1]!.instanceId);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([
      handCards[0]!.instanceId,
      handCards[1]!.instanceId,
    ]);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          'cardInstanceIds' in entry.event &&
          entry.event.cardInstanceIds?.includes(handCards[0]!.instanceId) === true &&
          entry.event.cardInstanceIds?.includes(handCards[1]!.instanceId) === true
      )
    ).toBe(true);
    expect(scoreModifiers(resolved)).toHaveLength(1);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('keeps paid cost but does not score when the success-zone condition is not met', () => {
    const { game, energyCards } = prepareGame({ ownSuccessCount: 1, opponentSuccessCount: 2 });

    const resolved = chooseOption(start(game), 'pay-energy');

    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.players[0].energyZone.cardStates.get(energyCards[0]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(scoreModifiers(resolved)).toHaveLength(0);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('declines without paying cost or adding score', () => {
    const { game, energyCards } = prepareGame();

    const resolved = chooseOption(start(game), null);

    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.players[0].energyZone.cardStates.get(energyCards[0]!.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(scoreModifiers(resolved)).toHaveLength(0);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('filters targets to own stage Aqours members only', () => {
    const { game, source, aqoursLeft, nonAqours, opponentMember, offStageAqours } = prepareGame();
    const withNonAqoursOnStage = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, nonAqours.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    const selectingTargets = chooseOption(start(withNonAqoursOnStage), 'pay-energy');

    expect(selectingTargets.activeEffect?.selectableCardIds).toEqual([
      aqoursLeft.instanceId,
      source.instanceId,
    ]);
    expect(selectingTargets.activeEffect?.selectableCardIds).not.toContain(nonAqours.instanceId);
    expect(selectingTargets.activeEffect?.selectableCardIds).not.toContain(opponentMember.instanceId);
    expect(selectingTargets.activeEffect?.selectableCardIds).not.toContain(offStageAqours.instanceId);
  });

  it('allows selecting zero, one, or two targets and rejects more than two or invalid targets', () => {
    const zero = chooseCards(chooseOption(start(prepareGame().game), 'pay-energy'), []);
    expect(zero.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(scoreModifiers(zero)).toHaveLength(0);

    const oneSetup = prepareGame();
    const one = chooseCards(chooseOption(start(oneSetup.game), 'pay-energy'), [
      oneSetup.aqoursLeft.instanceId,
    ]);
    expect(one.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(scoreModifiers(one)).toHaveLength(1);

    const twoSetup = prepareGame();
    const selectingTwo = chooseOption(start(twoSetup.game), 'pay-energy');
    const unchangedForTooMany = chooseCards(selectingTwo, [
      twoSetup.aqoursLeft.instanceId,
      twoSetup.aqoursRight.instanceId,
      twoSetup.source.instanceId,
    ]);
    expect(unchangedForTooMany).toBe(selectingTwo);

    const invalidSetup = prepareGame();
    const selectingInvalid = chooseOption(start(invalidSetup.game), 'pay-energy');
    const unchangedForInvalid = chooseCards(selectingInvalid, [
      invalidSetup.aqoursLeft.instanceId,
      invalidSetup.offStageAqours.instanceId,
    ]);
    expect(unchangedForInvalid).toBe(selectingInvalid);
  });
});
