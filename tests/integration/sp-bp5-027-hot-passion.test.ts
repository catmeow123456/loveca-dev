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
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP5_027_LIVE_SUCCESS_PLACE_WAITING_ENERGY_OPPONENT_DRAW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(): LiveCardData {
  return {
    cardCode: 'PL!SP-bp5-027-L',
    name: 'HOT PASSION!!',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp5-027-live-success',
    abilityId: SP_BP5_027_LIVE_SUCCESS_PLACE_WAITING_ENERGY_OPPONENT_DRAW_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
  };
}

function setup(options: { readonly energyDeckCount: number; readonly sourceInLiveZone?: boolean }) {
  const sourceLive = createCardInstance(live(), PLAYER1, 'hot-passion');
  const energyCards = Array.from({ length: options.energyDeckCount }, (_, index) =>
    createCardInstance(energy(`PL!E-${index}`), PLAYER1, `energy-${index}`)
  );
  const opponentDraw = createCardInstance(member('PL!SP-test-opponent-draw'), PLAYER2, 'opponent-draw');
  let game = createGameState('sp-bp5-027-hot-passion', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, ...energyCards, opponentDraw]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, sourceLive.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    energyDeck: energyCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyDeck
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    mainDeck: addCardToZone(player.mainDeck, opponentDraw.instanceId),
  }));
  return {
    game: { ...game, pendingAbilities: [pending(sourceLive.instanceId)] },
    sourceLiveId: sourceLive.instanceId,
    energyIds: energyCards.map((card) => card.instanceId),
    opponentDrawId: opponentDraw.instanceId,
  };
}

describe('PL!SP-bp5-027 HOT PASSION!! live-success workflow', () => {
  it('places one waiting energy and only then lets the opponent draw one', () => {
    const scenario = setup({ energyDeckCount: 1 });
    const started = resolvePendingCardEffects(scenario.game).gameState;
    expect(started.activeEffect?.selectableOptions).toEqual([
      { id: 'place', label: '放置1张待机能量' },
    ]);
    expect(started.activeEffect?.canSkipSelection).toBe(true);
    expect(started.activeEffect?.skipSelectionLabel).toBe('不发动');

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'place'
    );

    expect(resolved.players[0].energyDeck.cardIds).toEqual([]);
    expect(resolved.players[0].energyZone.cardIds).toContain(scenario.energyIds[0]);
    expect(resolved.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolved.players[1].hand.cardIds).toContain(scenario.opponentDrawId);
  });

  it('decline, empty energy deck, or stale source consume without placing or drawing', () => {
    const declinedScenario = setup({ energyDeckCount: 1 });
    const started = resolvePendingCardEffects(declinedScenario.game).gameState;
    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(declined.players[0].energyZone.cardIds).toEqual([]);
    expect(declined.players[1].hand.cardIds).not.toContain(declinedScenario.opponentDrawId);

    const empty = resolvePendingCardEffects(setup({ energyDeckCount: 0 }).game).gameState;
    expect(empty.activeEffect).toBeNull();
    expect(empty.pendingAbilities).toEqual([]);

    const stale = resolvePendingCardEffects(
      setup({ energyDeckCount: 1, sourceInLiveZone: false }).game
    ).gameState;
    expect(stale.activeEffect).toBeNull();
    expect(stale.players[0].energyZone.cardIds).toEqual([]);
  });
});
