import { describe, expect, it } from 'vitest';
import type { BladeHeartItem, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP2_015_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_PURPLE_HEART_ABILITY_ID,
  SP_BP2_020_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_RED_HEART_ABILITY_ID,
  SP_BP2_021_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_YELLOW_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

const CONFIGS = [
  {
    cardCode: 'PL!SP-bp2-015-N',
    abilityId: SP_BP2_015_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_PURPLE_HEART_ABILITY_ID,
    color: HeartColor.PURPLE,
    slot: SlotPosition.LEFT,
  },
  {
    cardCode: 'PL!SP-bp2-020-N',
    abilityId: SP_BP2_020_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_RED_HEART_ABILITY_ID,
    color: HeartColor.RED,
    slot: SlotPosition.CENTER,
  },
  {
    cardCode: 'PL!SP-bp2-021-N',
    abilityId: SP_BP2_021_AUTO_ON_CHEER_NO_BLADE_HEART_GAIN_YELLOW_HEART_ABILITY_ID,
    color: HeartColor.YELLOW,
    slot: SlotPosition.RIGHT,
  },
] as const;

function member(cardCode: string, bladeHearts: readonly BladeHeartItem[] = []): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
    bladeHearts,
  };
}

function placeSource(game: GameState, cardId: string, slot: SlotPosition): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function createPending(
  abilityId: string,
  sourceCardId: string,
  eventId: string
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${eventId}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_CHEER,
    eventIds: [eventId],
  };
}

function setupSingle(
  index: number,
  revealedBladeHearts: readonly BladeHeartItem[] = [],
  options: { ownerId?: string; revealedCount?: number; additional?: boolean } = {}
): { game: GameState; sourceId: string; revealedId: string; eventId: string } {
  const config = CONFIGS[index]!;
  const source = createCardInstance(member(config.cardCode), PLAYER1, `source-${index}`);
  const revealed = createCardInstance(
    member(`PL!SP-test-revealed-${index}`, revealedBladeHearts),
    options.ownerId ?? PLAYER1,
    `revealed-${index}`
  );
  let game = registerCards(createGameState(`no-blade-${index}`, PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    revealed,
  ]);
  game = placeSource(game, source.instanceId, config.slot);
  const revealedIds = options.revealedCount === 0 ? [] : [revealed.instanceId];
  const event = createCheerEvent(PLAYER1, revealedIds, revealedIds.length, {
    additional: options.additional,
  });
  game = emitGameEvent(game, event);
  game = {
    ...game,
    pendingAbilities: [createPending(config.abilityId, source.instanceId, event.eventId)],
  };
  return {
    game,
    sourceId: source.instanceId,
    revealedId: revealed.instanceId,
    eventId: event.eventId,
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function abilityUseCount(game: GameState, abilityId: string): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === abilityId &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('shared ON_CHEER no BLADE HEART gain Heart', () => {
  it.each(CONFIGS)('$cardCode gains only its configured source-member Heart', (config) => {
    const index = CONFIGS.indexOf(config);
    const scenario = setupSingle(index);
    const resolved = resolve(scenario.game);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.playerHeartBonuses).toEqual(new Map());
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: scenario.sourceId,
      abilityId: config.abilityId,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: config.color, count: 1 }],
    });
    expect(abilityUseCount(resolved, config.abilityId)).toBe(1);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: config.abilityId,
      eventId: scenario.eventId,
      revealedCardIds: [scenario.revealedId],
      conditionMet: true,
      gainedHearts: [{ color: config.color, count: 1 }],
    });
    expect(resolved.actionHistory.at(-1)?.payload).not.toHaveProperty('debugText');
  });

  it.each([
    {
      label: 'Heart',
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE }],
    },
    {
      label: 'ALL',
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
    },
    { label: 'SCORE', bladeHearts: [{ effect: BladeHeartEffect.SCORE }] },
    { label: 'DRAW', bladeHearts: [{ effect: BladeHeartEffect.DRAW }] },
  ] as const)('FAQ Q112: $label is any BLADE HEART and fails the condition', ({ bladeHearts }) => {
    const scenario = setupSingle(0, bladeHearts);
    const resolved = resolve(scenario.game);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(abilityUseCount(resolved, CONFIGS[0].abilityId)).toBe(1);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      eventId: scenario.eventId,
      revealedCardIds: [scenario.revealedId],
      conditionMet: false,
      gainedHearts: [],
    });
  });

  it('fails the whole condition when any one of multiple own revealed cards has a BLADE HEART', () => {
    const scenario = setupSingle(1);
    const bladeCard = createCardInstance(
      member('PL!SP-test-blade', [{ effect: BladeHeartEffect.DRAW }]),
      PLAYER1,
      'blade-card'
    );
    let game = registerCards(scenario.game, [bladeCard]);
    const event = createCheerEvent(PLAYER1, [scenario.revealedId, bladeCard.instanceId], 2);
    game = emitGameEvent(game, event);
    game = {
      ...game,
      pendingAbilities: [createPending(CONFIGS[1].abilityId, scenario.sourceId, event.eventId)],
    };
    const resolved = resolve(game);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      bladeHeartCardIds: [bladeCard.instanceId],
      conditionMet: false,
    });
  });

  it('uses CheerEvent facts after revealed cards leave resolutionZone', () => {
    const scenario = setupSingle(2);
    const movedAway = {
      ...scenario.game,
      resolutionZone: { ...scenario.game.resolutionZone, cardIds: [], revealedCardIds: [] },
    };
    const resolved = resolve(movedAway);
    expect(resolved.liveResolution.liveModifiers[0]).toMatchObject({
      sourceCardId: scenario.sourceId,
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
    });
  });

  it('FAQ Q113: no matching event or zero own revealed cards consumes pending without turn use', () => {
    const noEvent = setupSingle(0);
    const resolvedNoEvent = resolve({
      ...noEvent.game,
      eventLog: [],
    });
    expect(resolvedNoEvent.pendingAbilities).toEqual([]);
    expect(abilityUseCount(resolvedNoEvent, CONFIGS[0].abilityId)).toBe(0);
    expect(resolvedNoEvent.liveResolution.liveModifiers).toEqual([]);

    const zero = setupSingle(0, [], { revealedCount: 0 });
    const resolvedZero = resolve(zero.game);
    expect(abilityUseCount(resolvedZero, CONFIGS[0].abilityId)).toBe(0);
    expect(resolvedZero.liveResolution.liveModifiers).toEqual([]);

    const opponentOnly = setupSingle(0, [], { ownerId: PLAYER2 });
    const resolvedOpponentOnly = resolve(opponentOnly.game);
    expect(abilityUseCount(resolvedOpponentOnly, CONFIGS[0].abilityId)).toBe(0);
  });

  it('condition failure consumes turn1, and success also prevents a second normal cheer', () => {
    for (const bladeHearts of [[{ effect: BladeHeartEffect.SCORE }] as const, [] as const]) {
      const scenario = setupSingle(0, bladeHearts);
      let game = resolve(scenario.game);
      const second = createCheerEvent(PLAYER1, [scenario.revealedId], 1);
      game = emitGameEvent(game, second);
      game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_CHEER], {
        cheerEvents: [second],
      });
      expect(game.pendingAbilities).toEqual([]);
      expect(abilityUseCount(game, CONFIGS[0].abilityId)).toBe(1);
    }
  });

  it('additional cheer does not consume turn1, while legacy missing additional is normal', () => {
    const additional = setupSingle(0, [], { additional: true });
    const resolvedAdditional = resolve(additional.game);
    expect(abilityUseCount(resolvedAdditional, CONFIGS[0].abilityId)).toBe(0);
    expect(resolvedAdditional.liveResolution.liveModifiers).toEqual([]);

    const legacy = setupSingle(0);
    const legacyEvent = legacy.game.eventLog.at(-1)!.event;
    const eventWithoutAdditional = { ...legacyEvent } as Record<string, unknown>;
    delete eventWithoutAdditional.additional;
    const resolvedLegacy = resolve({
      ...legacy.game,
      eventLog: [{ event: eventWithoutAdditional as typeof legacyEvent }],
    });
    expect(abilityUseCount(resolvedLegacy, CONFIGS[0].abilityId)).toBe(1);
    expect(resolvedLegacy.liveResolution.liveModifiers).toHaveLength(1);
  });

  it('opponent cheer does not resolve as own cheer', () => {
    const scenario = setupSingle(0);
    const opponentEvent = createCheerEvent(PLAYER2, [scenario.revealedId], 1);
    let game = emitGameEvent(scenario.game, opponentEvent);
    game = {
      ...game,
      pendingAbilities: [
        createPending(CONFIGS[0].abilityId, scenario.sourceId, opponentEvent.eventId),
      ],
    };
    const resolved = resolve(game);
    expect(abilityUseCount(resolved, CONFIGS[0].abilityId)).toBe(0);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('source leaving before resolution consumes pending without modifier or turn use', () => {
    const scenario = setupSingle(0);
    const game = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, null),
    }));
    const resolved = resolve(game);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(abilityUseCount(resolved, CONFIGS[0].abilityId)).toBe(0);
  });

  it('multiple source instances resolve in order with separate colors and no activeEffect', () => {
    const sources = CONFIGS.map((config, index) =>
      createCardInstance(member(config.cardCode), PLAYER1, `multi-source-${index}`)
    );
    const revealed = createCardInstance(member('PL!SP-multi-revealed'), PLAYER1, 'multi-revealed');
    let game = registerCards(createGameState('multi', PLAYER1, 'P1', PLAYER2, 'P2'), [
      ...sources,
      revealed,
    ]);
    CONFIGS.forEach((config, index) => {
      game = placeSource(game, sources[index]!.instanceId, config.slot);
    });
    const event = createCheerEvent(PLAYER1, [revealed.instanceId], 1);
    game = emitGameEvent(game, event);
    game = {
      ...game,
      pendingAbilities: CONFIGS.map((config, index) =>
        createPending(config.abilityId, sources[index]!.instanceId, event.eventId)
      ),
    };
    const orderSelection = resolve(game);
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toHaveLength(3);
    CONFIGS.forEach((config, index) => {
      expect(resolved.liveResolution.liveModifiers).toContainEqual({
        kind: 'HEART',
        playerId: PLAYER1,
        sourceCardId: sources[index]!.instanceId,
        abilityId: config.abilityId,
        target: 'SOURCE_MEMBER',
        hearts: [{ color: config.color, count: 1 }],
      });
    });
  });
});
