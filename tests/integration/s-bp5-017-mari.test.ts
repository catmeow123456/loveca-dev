import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { addHeartLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
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

function createMember(cardCode: string, name: string, blueHearts = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, blueHearts)],
  };
}

function createLive(cardCode: string, name: string, blueRequirement: number): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: blueRequirement }),
  };
}

function runLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function setupMariState(options: {
  readonly sources?: readonly ReturnType<typeof createCardInstance>[];
  readonly liveCards: readonly ReturnType<typeof createCardInstance>[];
  readonly mutateBeforeLiveStart?: (
    game: GameState,
    sources: readonly ReturnType<typeof createCardInstance>[]
  ) => GameState;
}): {
  readonly game: GameState;
  readonly sources: readonly ReturnType<typeof createCardInstance>[];
} {
  const sources =
    options.sources ??
    [
      createCardInstance(
        createMember('PL!S-bp5-017-N', '小原鞠莉'),
        PLAYER1,
        'mari-source'
      ),
    ];
  let game = createGameState('s-bp5-017-mari', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...sources, ...options.liveCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];
    let memberSlots = player.memberSlots;
    for (const [index, source] of sources.entries()) {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    const liveZone = options.liveCards.reduce(
      (zone, live) =>
        addCardToStatefulZone(zone, live.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.liveZone
    );
    return { ...player, memberSlots, liveZone };
  });
  game = options.mutateBeforeLiveStart?.(game, sources) ?? game;
  return { game, sources };
}

describe('PL!S-bp5-017-N Mari live-start workflow', () => {
  it('opens a realtime confirm-only bridge and gains blue Heart from LIVE-zone requirements', () => {
    const liveCards = [
      createCardInstance(
        createLive('PL!S-test-live-blue-2-a', 'Blue 2 A', 2),
        PLAYER1,
        'mari-live-a'
      ),
      createCardInstance(
        createLive('PL!S-test-live-blue-2-b', 'Blue 2 B', 2),
        PLAYER1,
        'mari-live-b'
      ),
    ];
    const { game, sources } = setupMariState({ liveCards });

    const preview = runLiveStart(game);

    expect(preview.activeEffect).toMatchObject({
      abilityId: S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID,
      sourceCardId: sources[0]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('必要[青ハート]合计4');
    expect(preview.activeEffect?.effectText).toContain('实际获得[青ハート]');
    expect(
      preview.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId === S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID
      )
    ).toBe(false);

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
      sourceCardId: sources[0]!.instanceId,
      abilityId: S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID,
    });
  });

  it('does not count member Heart or temporary gained Heart toward the LIVE requirement total', () => {
    const liveCards = [
      createCardInstance(
        createLive('PL!S-test-live-blue-3', 'Blue 3', 3),
        PLAYER1,
        'mari-live-blue-3'
      ),
    ];
    const { game, sources } = setupMariState({
      liveCards,
      mutateBeforeLiveStart: (state, [source]) =>
        addHeartLiveModifierForMember(state, {
          playerId: PLAYER1,
          memberCardId: source!.instanceId,
          sourceCardId: source!.instanceId,
          abilityId: 'test:temporary-blue-heart',
          hearts: [{ color: HeartColor.BLUE, count: 5 }],
        })!.gameState,
    });

    const preview = runLiveStart(game);
    expect(preview.activeEffect?.effectText).toContain('必要[青ハート]合计3');
    expect(preview.activeEffect?.effectText).toContain('实际不获得[青ハート]');
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(
      resolved.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId === S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID
      )
    ).toBe(false);
  });

  it('rechecks source liveness after the confirm-only bridge before applying blue Heart', () => {
    const liveCards = [
      createCardInstance(
        createLive('PL!S-test-live-blue-4', 'Blue 4', 4),
        PLAYER1,
        'mari-live-blue-4'
      ),
    ];
    const { game, sources } = setupMariState({ liveCards });
    const preview = runLiveStart(game);
    const sourceLeft = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));

    const resolved = confirmActiveEffectStep(sourceLeft, PLAYER1, sourceLeft.activeEffect!.id);

    expect(
      resolved.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId === S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID
      )
    ).toBe(false);
    expect(
      resolved.actionHistory
        .filter(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId ===
              S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID
        )
        .at(-1)?.payload
    ).toMatchObject({
      sourceOnStage: false,
      blueRequirementTotal: 4,
      conditionMet: false,
      heartBonus: [],
    });
    expect(sources[0]).toBeDefined();
  });

  it('auto-resolves multiple pending Mari abilities in order without confirm-only bridges', () => {
    const sources = [
      createCardInstance(
        createMember('PL!S-bp5-017-N', '小原鞠莉 A'),
        PLAYER1,
        'mari-source-a'
      ),
      createCardInstance(
        createMember('PL!S-bp5-017-N', '小原鞠莉 B'),
        PLAYER1,
        'mari-source-b'
      ),
    ];
    const liveCards = [
      createCardInstance(
        createLive('PL!S-test-live-blue-4-order', 'Blue 4', 4),
        PLAYER1,
        'mari-live-order'
      ),
    ];
    const { game } = setupMariState({ sources, liveCards });
    const orderSelection = runLiveStart(game);

    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    for (const source of sources) {
      expect(resolved.liveResolution.liveModifiers).toContainEqual({
        kind: 'HEART',
        playerId: PLAYER1,
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.BLUE, count: 1 }],
        sourceCardId: source.instanceId,
        abilityId: S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID,
      });
    }
  });

  it('shows a confirm-only bridge when manually selecting one of multiple pending Mari abilities', () => {
    const sources = [
      createCardInstance(
        createMember('PL!S-bp5-017-N', '小原鞠莉 A'),
        PLAYER1,
        'mari-manual-source-a'
      ),
      createCardInstance(
        createMember('PL!S-bp5-017-N', '小原鞠莉 B'),
        PLAYER1,
        'mari-manual-source-b'
      ),
    ];
    const liveCards = [
      createCardInstance(
        createLive('PL!S-test-live-blue-4-manual', 'Blue 4', 4),
        PLAYER1,
        'mari-live-manual'
      ),
    ];
    const { game } = setupMariState({ sources, liveCards });
    const orderSelection = runLiveStart(game);

    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      sources[1]!.instanceId
    );

    expect(preview.activeEffect).toMatchObject({
      sourceCardId: sources[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(
      preview.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.sourceCardId === sources[1]!.instanceId &&
          modifier.abilityId === S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID
      )
    ).toBe(false);
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
      sourceCardId: sources[1]!.instanceId,
      abilityId: S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID,
    });
  });
});
