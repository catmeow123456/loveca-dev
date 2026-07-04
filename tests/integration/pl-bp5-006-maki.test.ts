import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  BP5_006_LIVE_START_LIVE_ZONE_TWO_DRAW_ABILITY_ID,
  N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMaki(cardCode = 'PL!-bp5-006-AR'): MemberCardData {
  return {
    cardCode,
    name: '西木野真姫',
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupState(options: {
  readonly liveZoneCount: number;
  readonly deckCount?: number;
  readonly secondSource?: boolean;
  readonly includeRyouranLive?: boolean;
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly secondSource?: ReturnType<typeof createCardInstance>;
  readonly liveCards: readonly ReturnType<typeof createCardInstance>[];
  readonly drawCards: readonly ReturnType<typeof createCardInstance>[];
} {
  const source = createCardInstance(createMaki(), PLAYER1, 'p1-bp5-006-maki');
  const secondSource = options.secondSource
    ? createCardInstance(createMaki('PL!-bp5-006-R'), PLAYER1, 'p1-bp5-006-maki-second')
    : undefined;
  const liveCards = Array.from({ length: options.liveZoneCount }, (_, index) => {
    const cardCode =
      options.includeRyouranLive === true && index === 0
        ? 'PL!N-bp5-030-L'
        : `PL!-bp5-006-live-${index}`;
    return createCardInstance(createLive(cardCode), PLAYER1, `p1-live-${index}`);
  });
  const drawCards = Array.from({ length: options.deckCount ?? 1 }, (_, index) =>
    createCardInstance(
      createMember(`PL!-bp5-006-draw-${index}`, `Draw ${index}`),
      PLAYER1,
      `p1-draw-${index}`
    )
  );

  let game = createGameState('pl-bp5-006-maki', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...(secondSource ? [secondSource] : []),
    ...liveCards,
    ...drawCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    const memberSlotsWithSecond = secondSource
      ? placeCardInSlot(memberSlots, SlotPosition.RIGHT, secondSource.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        })
      : memberSlots;
    const liveZone = liveCards.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        }),
      player.liveZone
    );
    return {
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone,
      memberSlots: memberSlotsWithSecond,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
    },
  };

  return { game, source, secondSource, liveCards, drawCards };
}

function startLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function bp5006ResolvePayloads(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === BP5_006_LIVE_START_LIVE_ZONE_TWO_DRAW_ABILITY_ID
    )
    .map((action) => action.payload);
}

describe('PL!-bp5-006 Maki live-start workflow', () => {
  it('shows confirm-only first and draws one after confirmation when liveZone has at least two cards', () => {
    const { game, drawCards } = setupState({ liveZoneCount: 2, deckCount: 1 });

    const started = startLiveStart(game);

    expect(started.players[0].hand.cardIds).toEqual([]);
    expect(started.activeEffect).toMatchObject({
      abilityId: BP5_006_LIVE_START_LIVE_ZONE_TWO_DRAW_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(started.activeEffect?.effectText).toContain('当前LIVE区 2张');
    expect(started.activeEffect?.effectText).toContain('满足条件，抽1张');

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([drawCards[0].instanceId]);
    expect(bp5006ResolvePayloads(resolved).at(-1)).toMatchObject({
      step: 'LIVE_START_LIVE_ZONE_TWO_DRAW',
      liveZoneCardCount: 2,
      sourceOnStage: true,
      conditionMet: true,
      drawnCardIds: [drawCards[0].instanceId],
    });
  });

  it('consumes pending without drawing when liveZone has fewer than two cards', () => {
    const { game, source, liveCards } = setupState({
      liveZoneCount: 1,
      deckCount: 1,
      includeRyouranLive: true,
    });

    const started = startLiveStart(game);
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(bp5006ResolvePayloads(resolved).at(-1)).toMatchObject({
      liveZoneCardCount: 1,
      sourceOnStage: true,
      conditionMet: false,
      drawnCardIds: [],
    });
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: source.instanceId,
      sourceCardId: liveCards[0].instanceId,
      abilityId: N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
    });
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID &&
          action.payload.resolvedAbilityId === BP5_006_LIVE_START_LIVE_ZONE_TWO_DRAW_ABILITY_ID &&
          action.payload.targetMemberId === source.instanceId &&
          action.payload.step === 'RYOURAN_GAIN_ALL_HEART'
      )
    ).toBe(true);
  });

  it('resolves multiple pending abilities in order without extra confirm-only prompts', () => {
    const { game, drawCards } = setupState({
      liveZoneCount: 2,
      deckCount: 2,
      secondSource: true,
    });

    const started = startLiveStart(game);

    expect(started.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual(drawCards.map((card) => card.instanceId));
    expect(bp5006ResolvePayloads(resolved)).toHaveLength(2);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.payload?.abilityId === BP5_006_LIVE_START_LIVE_ZONE_TWO_DRAW_ABILITY_ID &&
          action.payload?.step === 'START_CONFIRM'
      )
    ).toBe(false);
  });

  it('safely no-ops when the source leaves the controller stage before confirmation', () => {
    const { game } = setupState({ liveZoneCount: 2, deckCount: 1 });

    const started = startLiveStart(game);
    const sourceGone = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = confirmActiveEffectStep(sourceGone, PLAYER1, sourceGone.activeEffect!.id);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(bp5006ResolvePayloads(resolved).at(-1)).toMatchObject({
      liveZoneCardCount: 2,
      sourceOnStage: false,
      conditionMet: true,
      drawnCardIds: [],
    });
  });
});
