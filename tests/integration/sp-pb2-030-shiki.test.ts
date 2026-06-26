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
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_030_LIVE_START_CHOOSE_ORIGINAL_HEART_REPLACEMENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(): MemberCardData {
  return {
    cardCode: 'PL!SP-pb2-030-N',
    name: '若菜四季',
    groupName: 'Liella!',
    unitName: '5yncri5e!',
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function setupState(): { readonly game: GameState; readonly sourceId: string } {
  const source = createCardInstance(createMember(), PLAYER1, 'sp-pb2-030-source');
  let game = createGameState('sp-pb2-030-shiki', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));
  return { game, sourceId: source.instanceId };
}

function startAbility(game: GameState, sourceId: string, idSuffix = 'pending'): GameState {
  const pending: PendingAbilityState = {
    id: `sp-pb2-030-${idSuffix}`,
    abilityId: SP_PB2_030_LIVE_START_CHOOSE_ORIGINAL_HEART_REPLACEMENT_ABILITY_ID,
    sourceCardId: sourceId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`live-start-${idSuffix}`],
    sourceSlot: SlotPosition.CENTER,
  };
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending],
  }).gameState;
}

function chooseColor(game: GameState, color: HeartColor): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    color
  );
}

describe('PL!SP-pb2-030 Shiki original heart replacement', () => {
  it.each([HeartColor.RED, HeartColor.YELLOW, HeartColor.PURPLE])(
    'replaces the source member original hearts with %s',
    (color) => {
      const scenario = setupState();
      const started = startAbility(scenario.game, scenario.sourceId);

      expect(started.activeEffect?.selectableOptions).toEqual([
        { id: HeartColor.RED, label: '红Heart' },
        { id: HeartColor.YELLOW, label: '黄Heart' },
        { id: HeartColor.PURPLE, label: '紫Heart' },
      ]);

      const state = chooseColor(started, color);
      const replacement = state.liveResolution.liveModifiers.find(
        (modifier) =>
          modifier.kind === 'MEMBER_ORIGINAL_HEART_REPLACEMENT' &&
          modifier.abilityId ===
            SP_PB2_030_LIVE_START_CHOOSE_ORIGINAL_HEART_REPLACEMENT_ABILITY_ID
      );

      expect(replacement).toMatchObject({
        playerId: PLAYER1,
        memberCardId: scenario.sourceId,
        color,
        sourceCardId: scenario.sourceId,
      });
      expect(
        getMemberEffectiveHeartIcons(
          state,
          PLAYER1,
          scenario.sourceId,
          collectLiveModifiers(state)
        )
      ).toEqual([createHeartIcon(color, 2)]);
      expect(
        state.liveResolution.liveModifiers.some(
          (modifier) => modifier.kind === 'HEART' && modifier.target === 'PLAYER'
        )
      ).toBe(false);
    }
  );

  it('overwrites a previous replacement from the same source and ability', () => {
    const scenario = setupState();
    let state = chooseColor(startAbility(scenario.game, scenario.sourceId, 'first'), HeartColor.RED);

    state = chooseColor(startAbility(state, scenario.sourceId, 'second'), HeartColor.PURPLE);

    const replacements = state.liveResolution.liveModifiers.filter(
      (modifier) =>
        modifier.kind === 'MEMBER_ORIGINAL_HEART_REPLACEMENT' &&
        modifier.abilityId === SP_PB2_030_LIVE_START_CHOOSE_ORIGINAL_HEART_REPLACEMENT_ABILITY_ID
    );
    expect(replacements).toHaveLength(1);
    expect(replacements[0]).toMatchObject({ color: HeartColor.PURPLE });
  });
});
