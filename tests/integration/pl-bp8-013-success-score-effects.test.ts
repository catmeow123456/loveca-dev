import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
  BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID,
  BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID,
  PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID,
  PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID,
  PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID,
  PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID,
  PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
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
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { sumSuccessfulLiveScore } from '../../src/domain/rules/success-live-score';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const P1 = 'p1';
const P2 = 'p2';

function memberData(code: string): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost: 2,
    groupNames: ["μ's"],
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup(sourceCode: string, successScore: number, sourceIsLive = false) {
  const source = createCardInstance(
    sourceIsLive
      ? {
          cardCode: sourceCode,
          name: sourceCode,
          cardType: CardType.LIVE,
          score: 4,
          groupNames: ["μ's"],
          requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
        }
      : memberData(sourceCode),
    P1,
    'source'
  );
  const umi = createCardInstance(memberData('PL!-bp8-013-UNSEEN'), P1, 'umi');
  const successLive = createCardInstance(
    {
      cardCode: 'SUCCESS-LIVE',
      name: 'Success',
      cardType: CardType.LIVE,
      score: successScore,
      requirements: createHeartRequirement({}),
    },
    P1,
    'success-live'
  );
  const waitingLive = createCardInstance(
    {
      cardCode: 'WAITING-LIVE',
      name: 'Waiting',
      cardType: CardType.LIVE,
      score: 1,
      groupNames: ["μ's"],
      requirements: createHeartRequirement({}),
    },
    P1,
    'waiting-live'
  );
  const deckCards = Array.from({ length: 5 }, (_, i) =>
    createCardInstance(memberData(`DECK-${i}`), P1, `deck-${i}`)
  );
  const handCards = Array.from({ length: 2 }, (_, i) =>
    createCardInstance(memberData(`HAND-${i}`), P1, `hand-${i}`)
  );
  const energies = Array.from({ length: 3 }, (_, i) =>
    createCardInstance(
      {
        cardCode: `ENERGY-${i}`,
        name: `Energy ${i}`,
        cardType: CardType.ENERGY,
      },
      P1,
      `energy-${i}`
    )
  );
  let game = registerCards(createGameState(`umi-${sourceCode}`, P1, 'P1', P2, 'P2'), [
    source,
    umi,
    successLive,
    waitingLive,
    ...deckCards,
    ...handCards,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: sourceIsLive
      ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, umi.instanceId)
      : placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, umi.instanceId),
          SlotPosition.CENTER,
          source.instanceId
        ),
    successZone: { ...player.successZone, cardIds: [successLive.instanceId] },
    liveZone: { ...player.liveZone, cardIds: sourceIsLive ? [source.instanceId] : [] },
    mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: [waitingLive.instanceId] },
    energyDeck: { ...player.energyDeck, cardIds: [energies[2]!.instanceId] },
    energyZone: energies
      .slice(0, 2)
      .reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, { orientation: OrientationState.WAITING }),
        player.energyZone
      ),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  return { game, source, umi, successLive, waitingLive, deckCards, handCards, energies };
}

function pending(
  abilityId: string,
  timingId = TriggerCondition.ON_ENTER_STAGE
): PendingAbilityState {
  return {
    id: 'test-pending',
    abilityId,
    sourceCardId: 'source',
    controllerId: P1,
    mandatory: true,
    timingId,
    sourceSlot: SlotPosition.CENTER,
    eventIds: ['test-event'],
  };
}

function resolve(game: GameState, abilityId: string, timingId = TriggerCondition.ON_ENTER_STAGE) {
  return confirmIfConfirmOnly(
    resolvePendingCardEffects({ ...game, pendingAbilities: [pending(abilityId, timingId)] })
      .gameState,
    P1
  );
}

function payload(game: GameState, abilityId: string) {
  return game.actionHistory.findLast(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId
  )?.payload;
}

function withoutUmi(game: GameState) {
  return updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
  }));
}

function confirmSelection(game: GameState, selectedCardId: string | null) {
  expect(game.activeEffect).not.toBeNull();
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    P1,
    game.activeEffect!.id,
    selectedCardId
  );
}

describe('PL!-bp8-013 cost 2 Umi through existing card-effect workflows', () => {
  it('lets an entering member draw at the boosted threshold and records the reference value', () => {
    const { game, deckCards } = setup('PL!-bp4-016-P', 1);
    const resolved = resolve(game, PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID);
    expect(resolved.players[0]!.hand.cardIds).toContain(deckCards[0]!.instanceId);
    expect(
      payload(resolved, PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID)
    ).toMatchObject({ successLiveScore: 3 });
    expect(sumSuccessfulLiveScore(resolved, P1)).toBe(1);
    const noBonus = resolve(
      withoutUmi(game),
      PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID
    );
    expect(noBonus.players[0]!.hand.cardIds).not.toContain(deckCards[0]!.instanceId);
    expect(
      payload(noBonus, PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID)
    ).toMatchObject({ successLiveScore: 1, step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET' });
  });

  it('uses the boosted reference for energy placement and waiting-energy activation', () => {
    const rin = setup('PL!-bp5-005-AR', 4);
    const placed = resolve(rin.game, BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID);
    expect(placed.players[0]!.energyDeck.cardIds).toEqual([]);
    expect(
      placed.players[0]!.energyZone.cardStates.get(rin.energies[2]!.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      payload(placed, BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID)
    ).toMatchObject({ successLiveScore: 6, conditionMet: true });
    const maki = setup('PL!-bp4-004-N', 4);
    const activated = resolve(
      maki.game,
      PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID
    );
    expect(
      maki.energies
        .slice(0, 2)
        .map(
          (card) => activated.players[0]!.energyZone.cardStates.get(card.instanceId)?.orientation
        )
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(
      payload(activated, PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID)
    ).toMatchObject({ successLiveScore: 6, requiredSuccessLiveScore: 6 });
  });

  it('opens successful-score recovery and private inspection, then completes their existing paths', () => {
    const umiRecovery = setup('PL!-bp6-013-N', 4);
    const recovery = resolve(
      umiRecovery.game,
      BP6_013_ON_ENTER_RECOVER_MUSE_LIVE_IF_SUCCESS_SCORE_SIX_ABILITY_ID
    );
    expect(recovery.activeEffect?.selectableCardIds).toEqual([umiRecovery.waitingLive.instanceId]);
    const recovered = confirmSelection(recovery, umiRecovery.waitingLive.instanceId);
    expect(recovered.players[0]!.hand.cardIds).toContain(umiRecovery.waitingLive.instanceId);
    expect(recovered.activeEffect).toBeNull();
    const eli = setup('PL!-bp4-006-N', 1);
    const inspection = resolve(
      eli.game,
      PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID
    );
    expect(inspection.activeEffect?.selectableCardIds).toEqual(
      eli.deckCards.map((card) => card.instanceId)
    );
    const inspected = confirmSelection(inspection, null);
    expect(inspected.players[0]!.waitingRoom.cardIds).toEqual(
      expect.arrayContaining(eli.deckCards.map((card) => card.instanceId))
    );
    expect(inspected.activeEffect).toBeNull();
  });

  it('also disables the at-most-one success-score condition and logs the boosted reference', () => {
    const { game } = setup('PL!-bp4-007-P', 1);
    const base = resolve(
      withoutUmi(game),
      PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID
    );
    expect(base.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        abilityId: PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID,
        kind: 'SCORE',
      })
    );
    const boosted = resolve(
      game,
      PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID
    );
    expect(boosted.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        abilityId: PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID,
      })
    );
    expect(
      payload(
        boosted,
        PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID
      )
    ).toMatchObject({ successfulLiveScore: 3, successfulLiveCardCount: 1, conditionMet: false });
    expect(
      payload(
        boosted,
        PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID
      )?.resultText
    ).toContain('合计为3');
  });

  it('uses the boosted score for activation permission and completes discard/recovery', () => {
    const { game, handCards, waitingLive } = setup('PL!-bp4-002-P', 4);
    const denied = activateCardAbility(
      withoutUmi(game),
      P1,
      'source',
      BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
    );
    expect(denied.activeEffect).toBeNull();
    const started = activateCardAbility(
      game,
      P1,
      'source',
      BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
    );
    expect(started.activeEffect?.abilityId).toBe(
      BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
    );
    const paid = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      handCards.map((card) => card.instanceId)
    );
    expect(paid.activeEffect?.selectableCardIds).toContain(waitingLive.instanceId);
    const recovered = confirmSelection(paid, waitingLive.instanceId);
    expect(recovered.players[0]!.hand.cardIds).toEqual([waitingLive.instanceId]);
    expect(recovered.activeEffect).toBeNull();
  });

  it('continues the card-effect reference after its source paid the self-sacrifice cost', () => {
    const { game, waitingLive, energies } = setup('PL!-PR-017-PR', 7);
    const started = activateCardAbility(
      game,
      P1,
      'source',
      PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID
    );
    expect(started.players[0]!.waitingRoom.cardIds).toContain('source');
    expect(started.players[0]!.memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    const finished = confirmSelection(started, waitingLive.instanceId);
    expect(finished.players[0]!.hand.cardIds).toContain(waitingLive.instanceId);
    expect(
      energies
        .slice(0, 2)
        .map((card) => finished.players[0]!.energyZone.cardStates.get(card.instanceId)?.orientation)
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(
      payload(finished, PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID)
    ).toMatchObject({ conditionValue: 9, successLiveScore: 9, conditionMet: true });
    expect(finished.activeEffect).toBeNull();
  });

  it('shows the same referenced total in LIVE-start confirmation and final modifiers', () => {
    const { game } = setup('PL!-bp4-021-L', 7, true);
    const started = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    }).gameState;
    expect(started.activeEffect?.effectText).toContain('成功LIVE分数合计 9');
    const finished = confirmIfConfirmOnly(started, P1);
    expect(
      payload(finished, BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID)
    ).toMatchObject({ successLiveScore: 9, requirementReduction: 1, scoreBonus: 1 });
    expect(finished.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'SCORE', liveCardId: 'source', countDelta: 1 }),
        expect.objectContaining({
          kind: 'REQUIREMENT',
          liveCardId: 'source',
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
        }),
      ])
    );
    expect(sumSuccessfulLiveScore(finished, P1)).toBe(7);
  });

  it('rechecks the card-effect reference when Umi leaves before the pending confirmation', () => {
    const { game } = setup('PL!-bp4-021-L', 7, true);
    const started = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    }).gameState;
    expect(started.activeEffect?.effectText).toContain('成功LIVE分数合计 9');
    const finished = confirmIfConfirmOnly(withoutUmi(started), P1);
    expect(
      payload(finished, BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID)
    ).toMatchObject({ successLiveScore: 7, requirementReduction: 1, scoreBonus: 0 });
    expect(finished.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        abilityId: BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
      })
    );
  });
});
