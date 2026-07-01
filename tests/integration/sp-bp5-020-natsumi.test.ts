import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import {
  SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
  SP_BP5_020_LIVE_SUCCESS_PAY_ENERGY_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, cost = 4): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setMainPhase(game: GameState): GameState {
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
  };
}

function setup(options: { readonly activeEnergyCount: number }): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly drawCardId: string;
  readonly energyIds: readonly string[];
} {
  const source = createCardInstance(member('PL!SP-bp5-020-N', 4), PLAYER1, 'natsumi-source');
  const drawCard = createCardInstance(member('PL!SP-test-draw', 2), PLAYER1, 'draw-card');
  const energies = Array.from({ length: 3 }, (_, index) =>
    createCardInstance(energy(`PL!E-${index}`), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('sp-bp5-020-natsumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, drawCard, ...energies]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: addCardToZone(player.mainDeck, drawCard.instanceId),
    energyZone: energies.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: index < options.activeEnergyCount ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { game: setMainPhase(game), sourceId: source.instanceId, drawCardId: drawCard.instanceId, energyIds: energies.map((card) => card.instanceId) };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp5-020-live-success',
    abilityId: SP_BP5_020_LIVE_SUCCESS_PAY_ENERGY_DRAW_ONE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
  };
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-bp5-020 Natsumi activated and LIVE success workflow', () => {
  it('activated ability pays two active energy and draws one', () => {
    const { game, sourceId, drawCardId, energyIds } = setup({ activeEnergyCount: 2 });
    const session = createGameSession();
    session.createGame('sp-bp5-020-activated', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;

    const result = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID
      )
    );

    expect(result.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toContain(drawCardId);
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(abilityUseCount(session.state!)).toBe(1);
  });

  it('activated ability does not record use when active energy is insufficient', () => {
    const { game, sourceId, energyIds } = setup({ activeEnergyCount: 1 });
    const session = createGameSession();
    session.createGame('sp-bp5-020-activated-insufficient', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;

    const result = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID
      )
    );

    expect(result.success).toBe(false);
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(abilityUseCount(session.state!)).toBe(0);
  });

  it('LIVE success ability pays one active energy and draws one', () => {
    const { game, sourceId, drawCardId, energyIds } = setup({ activeEnergyCount: 1 });
    const started = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pending(sourceId)],
    }).gameState;

    expect(started.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付1张能量' },
      { id: 'decline', label: '不发动' },
    ]);

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'pay'
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toContain(drawCardId);
    expect(resolved.players[0].energyZone.cardStates.get(energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('LIVE success ability safely declines or consumes with no active energy', () => {
    const payable = setup({ activeEnergyCount: 1 });
    const started = resolvePendingCardEffects({
      ...payable.game,
      pendingAbilities: [pending(payable.sourceId)],
    }).gameState;
    const declined = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'decline'
    );
    expect(declined.players[0].hand.cardIds).not.toContain(payable.drawCardId);
    expect(declined.pendingAbilities).toEqual([]);

    const noEnergy = setup({ activeEnergyCount: 0 });
    const consumed = resolvePendingCardEffects({
      ...noEnergy.game,
      pendingAbilities: [pending(noEnergy.sourceId)],
    }).gameState;
    expect(consumed.activeEffect).toBeNull();
    expect(consumed.pendingAbilities).toEqual([]);
    expect(consumed.players[0].hand.cardIds).not.toContain(noEnergy.drawCardId);
  });
});
