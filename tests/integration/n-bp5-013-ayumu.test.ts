import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToZone,
  addEnergyBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP5_013_LIVE_START_ENERGY_BELOW_MEMBER_GAIN_PINK_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createPending(sourceCardId: string, sourceSlot: SlotPosition, suffix = '1') {
  return {
    id: `n-bp5-013-live-start-${suffix}`,
    abilityId: N_BP5_013_LIVE_START_ENERGY_BELOW_MEMBER_GAIN_PINK_HEART_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`live-start-${suffix}`],
    sourceSlot,
  };
}

function setupAyumuLiveStart(options: {
  readonly hasEnergyBelow: boolean;
  readonly removeSource?: boolean;
  readonly secondSource?: boolean;
}) {
  const source = createCardInstance(
    createMember('PL!N-bp5-013-N', '上原歩夢'),
    PLAYER1,
    'n-bp5-013-source'
  );
  const secondSource = createCardInstance(
    createMember('PL!N-bp5-013-N', '上原歩夢 2'),
    PLAYER1,
    'n-bp5-013-source-2'
  );
  const energy = createCardInstance(createEnergy('N-BP5-013-ENERGY'), PLAYER1, 'ayumu-energy');
  let game = createGameState('n-bp5-013-ayumu', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, secondSource, energy]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.secondSource) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (options.hasEnergyBelow) {
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, energy.instanceId);
    }
    if (options.removeSource) {
      memberSlots = removeCardFromSlot(memberSlots, SlotPosition.CENTER);
    }
    return {
      ...player,
      memberSlots,
      waitingRoom: options.removeSource
        ? addCardToZone(player.waitingRoom, source.instanceId)
        : player.waitingRoom,
    };
  });
  game = {
    ...game,
    pendingAbilities: [
      createPending(source.instanceId, SlotPosition.CENTER),
      ...(options.secondSource
        ? [createPending(secondSource.instanceId, SlotPosition.RIGHT, '2')]
        : []),
    ],
  };
  return { game, source, secondSource, energy };
}

function pinkHeartModifierCount(game: GameState, sourceCardId: string): number {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId ===
        N_BP5_013_LIVE_START_ENERGY_BELOW_MEMBER_GAIN_PINK_HEART_ABILITY_ID &&
      modifier.sourceCardId === sourceCardId
  ).length;
}

describe('PL!N-bp5-013 Ayumu live-start energyBelow Heart workflow', () => {
  it('opens manual confirm-only for a single pending ability and gains PINK Heart when a stage member has energyBelow', () => {
    const { game, source } = setupAyumuLiveStart({ hasEnergyBelow: true });
    const confirmation = resolvePendingCardEffects(game).gameState;

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.activeEffect?.effectText).toContain('当前自己的舞台有下方放有能量卡的成员');
    expect(confirmation.activeEffect?.effectText).toContain('此成员获得[桃ハート]');
    expect(confirmation.activeEffect?.effectText).not.toContain('确认后');

    const result = confirmIfConfirmOnly(confirmation, PLAYER1);
    expect(result.pendingAbilities).toEqual([]);
    expect(pinkHeartModifierCount(result, source.instanceId)).toBe(1);
    expect(getMemberEffectiveHeartIcons(result, PLAYER1, source.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });

  it('consumes the pending ability without Heart when no stage member has energyBelow', () => {
    const { game, source } = setupAyumuLiveStart({ hasEnergyBelow: false });
    const result = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState, PLAYER1);

    expect(result.pendingAbilities).toEqual([]);
    expect(pinkHeartModifierCount(result, source.instanceId)).toBe(0);
    expect(
      result.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'NO_ENERGY_BELOW_MEMBER'
      )
    ).toBe(true);
  });

  it('no-ops when the source leaves stage before resolution', () => {
    const { game, source } = setupAyumuLiveStart({
      hasEnergyBelow: true,
      removeSource: true,
    });
    const result = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState, PLAYER1);

    expect(result.pendingAbilities).toEqual([]);
    expect(pinkHeartModifierCount(result, source.instanceId)).toBe(0);
    expect(
      result.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });

  it('ordered resolution skips manual confirmation and resolves all same timing pending abilities', () => {
    const { game, source, secondSource } = setupAyumuLiveStart({
      hasEnergyBelow: true,
      secondSource: true,
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');

    const result = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(pinkHeartModifierCount(result, source.instanceId)).toBe(1);
    expect(pinkHeartModifierCount(result, secondSource.instanceId)).toBe(1);
  });
});
