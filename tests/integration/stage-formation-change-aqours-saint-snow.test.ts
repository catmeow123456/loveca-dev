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
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP7_012_ON_ENTER_ONLY_AQOURS_OR_SAINT_SNOW_STAGE_FORMATION_CHANGE_SAINT_SNOW_MOVED_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY =
  S_BP7_012_ON_ENTER_ONLY_AQOURS_OR_SAINT_SNOW_STAGE_FORMATION_CHANGE_SAINT_SNOW_MOVED_GAIN_TWO_BLADE_ABILITY_ID;
const EFFECT_TEXT =
  '【登场】自己的舞台上仅存在『Aqours』或『Saint Snow』的成员的场合，可以进行队列变换。因该效果将『Saint Snow』的成员移动的场合，LIVE结束时为止，获得[ブレード][ブレード]。';

function member(cardCode: string, name: string, groupName: string, instanceId: string) {
  return createCardInstance<MemberCardData>(
    {
      cardCode,
      name,
      groupNames: [groupName],
      cardType: CardType.MEMBER,
      cost: cardCode.startsWith('PL!S-bp7-012') ? 17 : 4,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    },
    P1,
    instanceId
  );
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 's-bp7-012-pending',
    abilityId: ABILITY,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['s-bp7-012-on-enter'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: { readonly otherGroup?: string } = {}) {
  const source = member('PL!S-bp7-012-N', '松浦果南', 'Aqours!', 'kanan-source');
  const saintSnow = member('TEST-SAINT-SNOW', '鹿角聖良', 'Saint Snow', 'saint-snow-member');
  const other = member('TEST-OTHER', '高海千歌', options.otherGroup ?? 'Aqours!', 'other-member');
  let game = registerCards(createGameState('s-bp7-012', P1, 'P1', P2, 'P2'), [
    source,
    saintSnow,
    other,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, saintSnow.instanceId),
        SlotPosition.CENTER,
        source.instanceId
      ),
      SlotPosition.RIGHT,
      other.instanceId
    ),
  }));
  return { game, source, saintSnow, other };
}

function start(game: GameState, sourceCardId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(sourceCardId)],
  }).gameState;
}

function confirmFormation(
  game: GameState,
  moveHistory?: readonly { readonly cardId: string; readonly toSlot: SlotPosition }[]
): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    moveHistory
  );
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === ABILITY
  );
}

describe('Aqours / Saint Snow stage-formation family: PL!S-bp7-012 费用17「松浦果南」', () => {
  it('uses the corrected full player-visible text and base-scoped definition', () => {
    const definition = findCardAbilityDefinitionById(ABILITY);
    expect(definition).toMatchObject({
      baseCardCodes: ['PL!S-bp7-012'],
      implemented: true,
      effectText: EFFECT_TEXT,
    });
  });

  it('opens only for an all-Aqours-or-Saint-Snow stage and rewards a real Saint Snow move', () => {
    const scenario = setup();
    let state = start(scenario.game, scenario.source.instanceId);
    expect(state.activeEffect).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: scenario.source.instanceId,
      effectText: EFFECT_TEXT,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    state = confirmFormation(state, [
      { cardId: scenario.saintSnow.instanceId, toSlot: SlotPosition.CENTER },
    ]);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.source.instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.saintSnow.instanceId
    );
    expect(bladeModifiers(state)).toEqual([
      expect.objectContaining({
        kind: 'BLADE',
        target: 'SOURCE_MEMBER',
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY,
        countDelta: 2,
      }),
    ]);
    expect(
      state.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          event.cause?.kind === 'CARD_EFFECT' &&
          event.cause.abilityId === ABILITY
      )
    ).toHaveLength(2);
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'STAGE_FORMATION_CHANGE'
      )?.payload
    ).toMatchObject({
      movedRewardMemberCardIds: [scenario.saintSnow.instanceId],
      bladeBonus: 2,
    });
  });

  it('does not reward when only Aqours members actually move', () => {
    const scenario = setup();
    let state = start(scenario.game, scenario.source.instanceId);
    state = confirmFormation(state, [
      { cardId: scenario.source.instanceId, toSlot: SlotPosition.RIGHT },
    ]);

    expect(state.activeEffect).toBeNull();
    expect(bladeModifiers(state)).toEqual([]);
    expect(
      state.actionHistory.find(
        (action) => action.payload.abilityId === ABILITY && action.payload.bladeBonus === 0
      )?.payload.movedRewardMemberCardIds
    ).toEqual([]);
  });

  it('treats same-slot move history as no layout change and grants no reward', () => {
    const scenario = setup();
    let state = start(scenario.game, scenario.source.instanceId);
    state = confirmFormation(state, [
      { cardId: scenario.source.instanceId, toSlot: SlotPosition.CENTER },
    ]);

    expect(state.activeEffect).toBeNull();
    expect(bladeModifiers(state)).toEqual([]);
    expect(
      state.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          event.cause?.abilityId === ABILITY
      )
    ).toEqual([]);
  });

  it('does not open when any own stage member belongs to neither allowed group', () => {
    const scenario = setup({ otherGroup: "μ's" });
    const state = start(scenario.game, scenario.source.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(bladeModifiers(state)).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'STAGE_FORMATION_CHANGE_CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('declines without moving or rewarding', () => {
    const scenario = setup();
    const state = confirmFormation(start(scenario.game, scenario.source.instanceId));

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].positionMovedThisTurn).toEqual([]);
    expect(bladeModifiers(state)).toEqual([]);
  });

  it('keeps the real move and continuation when the source becomes stale, but grants no Blade', () => {
    const scenario = setup();
    let state = start(scenario.game, scenario.source.instanceId);
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));

    state = confirmFormation(state, [
      { cardId: scenario.saintSnow.instanceId, toSlot: SlotPosition.RIGHT },
    ]);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      scenario.saintSnow.instanceId
    );
    expect(bladeModifiers(state)).toEqual([]);
  });
});
