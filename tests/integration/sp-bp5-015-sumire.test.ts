import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_BP5_015_ON_ENTER_CENTER_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
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

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp5-015-pending',
    abilityId: SP_BP5_015_ON_ENTER_CENTER_GAIN_TWO_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['on-enter'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(sourceSlot: SlotPosition = SlotPosition.CENTER): {
  readonly game: GameState;
  readonly sourceId: string;
} {
  const source = createCardInstance(
    member('PL!SP-bp5-015-N', '平安名すみれ'),
    PLAYER1,
    'sumire-source'
  );
  let game = createGameState('sp-bp5-015-sumire', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, sourceSlot, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    sourceId: source.instanceId,
  };
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === SP_BP5_015_ON_ENTER_CENTER_GAIN_TWO_BLADE_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!SP-bp5-015 Sumire center on-enter Blade workflow', () => {
  it('gains BLADE +2 when the source is still in CENTER on resolution', () => {
    const { game, sourceId } = setup();

    const resolved = resolvePendingCardEffects(game, false).gameState;

    expect(resolved.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sourceId)).toBe(3);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'CENTER_GAIN_TWO_BLADE',
      sourceStillCenter: true,
      bladeBonus: 2,
    });
  });

  it('safely no-ops when the source is no longer in CENTER on resolution', () => {
    const { game, sourceId } = setup(SlotPosition.LEFT);

    const resolved = resolvePendingCardEffects(game, false).gameState;

    expect(resolved.pendingAbilities).toEqual([]);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, sourceId)).toBe(1);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'SOURCE_NOT_CENTER',
      sourceStillCenter: false,
      bladeBonus: 0,
    });
  });
});
