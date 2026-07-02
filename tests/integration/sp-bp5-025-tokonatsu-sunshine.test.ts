import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { SP_BP5_025_LIVE_SUCCESS_PAY_ANY_ENERGY_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(cardCode = 'PL!SP-bp5-025-L'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp5-025-pending',
    abilityId: SP_BP5_025_LIVE_SUCCESS_PAY_ANY_ENERGY_THIS_LIVE_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
  };
}

function setup(activeEnergyCount: number): {
  readonly game: GameState;
  readonly liveId: string;
  readonly otherLiveId: string;
  readonly energyIds: readonly string[];
} {
  const sourceLive = createCardInstance(live(), PLAYER1, 'tokonatsu-sunshine');
  const otherLive = createCardInstance(live('PL!SP-other-live'), PLAYER1, 'other-live');
  const energies = Array.from({ length: 5 }, (_, index) =>
    createCardInstance(energy(`PL!E-${index}`), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('sp-bp5-025-tokonatsu-sunshine', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, otherLive, ...energies]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, sourceLive.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: energies.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: index < activeEnergyCount ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  game = {
    ...game,
    pendingAbilities: [pending(sourceLive.instanceId)],
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 6]]),
    },
  };
  return {
    game,
    liveId: sourceLive.instanceId,
    otherLiveId: otherLive.instanceId,
    energyIds: energies.map((card) => card.instanceId),
  };
}

function startSession(game: GameState): ReturnType<typeof createGameSession> {
  const started = resolvePendingCardEffects(game).gameState;
  const session = createGameSession();
  session.createGame('sp-bp5-025-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = started;
  return session;
}

function submitNumber(session: ReturnType<typeof createGameSession>, selectedNumber: number) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedNumber
    )
  );
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === SP_BP5_025_LIVE_SUCCESS_PAY_ANY_ENERGY_THIS_LIVE_SCORE_ABILITY_ID
  );
}

describe('PL!SP-bp5-025-L Tokonatsu Sunshine LIVE success workflow', () => {
  it('opens numericInput with max equal to current active energy count', () => {
    const session = startSession(setup(3).game);

    expect(session.state?.activeEffect?.numericInput).toMatchObject({
      min: 0,
      max: 3,
      integerOnly: true,
      label: '选择要支付的 [E] 数量',
    });
  });

  it('treats zero as no payment and consumes pending', () => {
    const scenario = setup(4);
    const session = startSession(scenario.game);

    expect(submitNumber(session, 0).success).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(scoreModifiers(session.state!)).toEqual([]);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('pays one to three energy without adding score', () => {
    const scenario = setup(3);
    const session = startSession(scenario.game);

    expect(submitNumber(session, 3).success).toBe(true);

    expect(
      scenario.energyIds.slice(0, 3).map((energyId) =>
        session.state?.players[0].energyZone.cardStates.get(energyId)?.orientation
      )
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING, OrientationState.WAITING]);
    expect(scoreModifiers(session.state!)).toEqual([]);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('pays four energy and adds SCORE +1 only to this LIVE', () => {
    const scenario = setup(5);
    const session = startSession(scenario.game);

    expect(submitNumber(session, 4).success).toBe(true);

    expect(scoreModifiers(session.state!)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: scenario.liveId,
        sourceCardId: scenario.liveId,
        abilityId: SP_BP5_025_LIVE_SUCCESS_PAY_ANY_ENERGY_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(scoreModifiers(session.state!).some((modifier) => modifier.liveCardId === scenario.otherLiveId)).toBe(
      false
    );
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(7);
  });

  it('rejects numeric input above max without paying or resolving', () => {
    const scenario = setup(3);
    const session = startSession(scenario.game);
    const effectId = session.state!.activeEffect!.id;

    const result = submitNumber(session, 4);

    expect(result.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(effectId);
    expect(session.state?.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(scoreModifiers(session.state!)).toEqual([]);
  });
});
