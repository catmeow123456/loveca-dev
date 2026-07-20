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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  getLiveCardRequirementModifiers,
} from '../../src/domain/rules/live-modifiers';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
const STEP_ID = 'HS_BP2_019_SELECT_REQUIREMENT_PATTERN';

function bloom(cardCode = 'PL!HS-bp2-019-L'): LiveCardData {
  return {
    cardCode,
    name: 'Bloom the smile, Bloom the dream!',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 1,
      [HeartColor.GREEN]: 1,
      [HeartColor.BLUE]: 1,
      [HeartColor.RAINBOW]: 1,
    }),
  };
}

function member(cardCode: string, groupNames: readonly string[]): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function pending(id: string, sourceCardId: string): PendingAbilityState {
  return {
    id,
    abilityId: HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event-${id}`],
  };
}

function setup(options: {
  readonly testId: string;
  readonly hasunosoraMember?: boolean;
  readonly otherGroupMember?: boolean;
  readonly sourceInLiveZone?: boolean;
  readonly includeOtherLive?: boolean;
  readonly externalGenericPlusOne?: boolean;
}) {
  const source = createCardInstance(bloom(), PLAYER1, `${options.testId}-source`);
  const otherLive = options.includeOtherLive
    ? createCardInstance(bloom('PL!HS-other-live'), PLAYER1, `${options.testId}-other-live`)
    : null;
  const stageMember =
    options.hasunosoraMember === false && !options.otherGroupMember
      ? null
      : createCardInstance(
          member(
            `${options.testId}-member`,
            options.otherGroupMember
              ? ['虹ヶ咲学園スクールアイドル同好会']
              : ['蓮ノ空女学院スクールアイドルクラブ']
          ),
          PLAYER1,
          `${options.testId}-member`
        );
  let game = registerCards(createGameState(options.testId, PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    ...(otherLive ? [otherLive] : []),
    ...(stageMember ? [stageMember] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let liveZone = player.liveZone;
    if (options.sourceInLiveZone !== false) {
      liveZone = addCardToStatefulZone(liveZone, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (otherLive) {
      liveZone = addCardToStatefulZone(liveZone, otherLive.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone,
      memberSlots: stageMember
        ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, stageMember.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          })
        : player.memberSlots,
    };
  });
  if (options.externalGenericPlusOne) {
    game = addLiveModifier(game, {
      kind: 'REQUIREMENT',
      liveCardId: source.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: 1 }],
      sourceCardId: 'opponent-q127-source',
      abilityId: 'opponent-q127-generic-plus-one',
    });
  }
  return { game, source, otherLive, stageMember };
}

function start(game: GameState, sourceCardId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending(`pending-${sourceCardId}`, sourceCardId)],
  }).gameState;
}

function choose(game: GameState, optionId?: string, resolveInOrder = false): GameState {
  const effectId = game.activeEffect!.id;
  if (optionId === undefined) {
    return confirmActiveEffectStep(
      game,
      PLAYER1,
      effectId,
      null,
      undefined,
      resolveInOrder
    );
  }
  const publicChoice = confirmActiveEffectStep(
    game,
    PLAYER1,
    effectId,
    undefined,
    undefined,
    resolveInOrder,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [optionId]
  );
  return confirmActiveEffectStep(publicChoice, PLAYER1, effectId);
}

function effectiveRequirement(game: GameState, liveCardId: string, data: LiveCardData) {
  return applyHeartRequirementModifiers(
    data.requirements,
    getLiveCardRequirementModifiers(game.liveResolution, liveCardId)
  );
}

function requirementShape(requirement: ReturnType<typeof effectiveRequirement>) {
  return {
    pink: requirement.colorRequirements.get(HeartColor.PINK) ?? 0,
    green: requirement.colorRequirements.get(HeartColor.GREEN) ?? 0,
    blue: requirement.colorRequirements.get(HeartColor.BLUE) ?? 0,
    generic: requirement.colorRequirements.get(HeartColor.RAINBOW) ?? 0,
    total: requirement.totalRequired,
  };
}

describe('PL!HS-bp2-019 Bloom the smile, Bloom the dream!', () => {
  it('opens exactly three positive choices plus one skip control without confirm-only', () => {
    const { game, source } = setup({ testId: 'choices' });
    const state = start(game, source.instanceId);
    expect(state.activeEffect).toMatchObject({
      abilityId: HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID,
      stepId: STEP_ID,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: 'pink', text: '此LIVE成功所需的必要Heart变为[桃ハート][桃ハート][無ハート]。' },
          { id: 'green', text: '此LIVE成功所需的必要Heart变为[緑ハート][緑ハート][無ハート]。' },
          { id: 'blue', text: '此LIVE成功所需的必要Heart变为[青ハート][青ハート][無ハート]。' },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: true,
      skipSelectionLabel: '不改变必要Heart',
    });
    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(state.activeEffect?.effectChoice?.options).toHaveLength(3);
    expect(state.activeEffect?.effectChoice?.options.map((option) => option.text)).not.toContain(
      '不改变必要Heart'
    );
  });

  it.each([
    ['pink', { pink: 2, green: 0, blue: 0, generic: 1, total: 3 }],
    ['green', { pink: 0, green: 2, blue: 0, generic: 1, total: 3 }],
    ['blue', { pink: 0, green: 0, blue: 2, generic: 1, total: 3 }],
  ] as const)('changes the final requirement to the %s pattern', (optionId, expected) => {
    const { game, source } = setup({ testId: `pattern-${optionId}` });
    const resolved = choose(start(game, source.instanceId), optionId);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      requirementShape(effectiveRequirement(resolved, source.instanceId, source.data))
    ).toEqual(expected);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'REQUIREMENT',
        liveCardId: source.instanceId,
        sourceCardId: source.instanceId,
        abilityId: HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID,
      })
    );
  });

  it('skips without writing a requirement modifier', () => {
    const { game, source } = setup({ testId: 'skip' });
    const resolved = choose(start(game, source.instanceId));
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(
      requirementShape(effectiveRequirement(resolved, source.instanceId, source.data))
    ).toEqual({
      pink: 1,
      green: 1,
      blue: 1,
      generic: 1,
      total: 4,
    });
  });

  it.each([
    ['no stage member', { hasunosoraMember: false }],
    ['only non-Hasunosora member', { hasunosoraMember: false, otherGroupMember: true }],
    ['source outside live zone', { sourceInLiveZone: false }],
  ] as const)('consumes pending without opening choices for %s', (_label, options) => {
    const { game, source } = setup({ testId: `no-choice-${_label}`, ...options });
    const state = start(game, source.instanceId);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('keeps the choice window for an illegal option', () => {
    const { game, source } = setup({ testId: 'illegal-option' });
    const started = start(game, source.instanceId);
    const resolved = choose(started, 'purple');
    expect(resolved).toBe(started);
    expect(resolved.activeEffect?.stepId).toBe(STEP_ID);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('rechecks the condition and consumes without a modifier if the source leaves live zone', () => {
    const { game, source } = setup({ testId: 'source-leaves' });
    const started = start(game, source.instanceId);
    const withoutSource = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: player.liveZone.cardIds.filter((cardId) => cardId !== source.instanceId),
      },
    }));
    const resolved = choose(withoutSource, 'pink');
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('rechecks the condition and consumes without a modifier if the Hasunosora member leaves stage', () => {
    const { game, source } = setup({ testId: 'member-leaves' });
    const started = start(game, source.instanceId);
    const withoutMember = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    const resolved = choose(withoutMember, 'green');
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('stacks Q127 external generic +1 after the chosen pattern', () => {
    const { game, source } = setup({
      testId: 'q127',
      externalGenericPlusOne: true,
    });
    const resolved = choose(start(game, source.instanceId), 'pink');
    expect(
      requirementShape(effectiveRequirement(resolved, source.instanceId, source.data))
    ).toEqual({
      pink: 2,
      green: 0,
      blue: 0,
      generic: 2,
      total: 4,
    });
    expect(
      resolved.liveResolution.liveModifiers.filter(
        (modifier) => modifier.kind === 'REQUIREMENT' && modifier.liveCardId === source.instanceId
      )
    ).toHaveLength(2);
  });

  it('binds the modifier only to the source LIVE', () => {
    const { game, source, otherLive } = setup({
      testId: 'source-binding',
      includeOtherLive: true,
    });
    const resolved = choose(start(game, source.instanceId), 'green');
    expect(otherLive).not.toBeNull();
    expect(
      requirementShape(effectiveRequirement(resolved, source.instanceId, source.data))
    ).toEqual({
      pink: 0,
      green: 2,
      blue: 0,
      generic: 1,
      total: 3,
    });
    expect(
      requirementShape(effectiveRequirement(resolved, otherLive!.instanceId, otherLive!.data))
    ).toEqual({ pink: 1, green: 1, blue: 1, generic: 1, total: 4 });
  });

  it('keeps ordered resolution interactive and continues to the next pending choice', () => {
    const { game, source, otherLive } = setup({
      testId: 'ordered',
      includeOtherLive: true,
    });
    expect(otherLive).not.toBeNull();
    const orderSelection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending('ordered-first', source.instanceId),
        pending('ordered-second', otherLive!.instanceId),
      ],
    }).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const firstChoice = choose(orderSelection, undefined, true);
    expect(firstChoice.activeEffect).toMatchObject({
      stepId: STEP_ID,
      sourceCardId: source.instanceId,
    });
    const secondChoice = choose(firstChoice, 'pink');
    expect(secondChoice.activeEffect).toMatchObject({
      stepId: STEP_ID,
      sourceCardId: otherLive!.instanceId,
    });
    const resolved = choose(secondChoice, 'blue');
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      requirementShape(effectiveRequirement(resolved, source.instanceId, source.data)).pink
    ).toBe(2);
    expect(
      requirementShape(effectiveRequirement(resolved, otherLive!.instanceId, otherLive!.data)).blue
    ).toBe(2);
  });

  it('records the chosen pattern, actual requirement and condition member ids', () => {
    const { game, source, stageMember } = setup({ testId: 'payload' });
    const resolved = choose(start(game, source.instanceId), 'blue');
    const payload = resolved.actionHistory
      .filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP2_019_LIVE_START_CHOOSE_HASUNOSORA_REQUIREMENT_PATTERN_ABILITY_ID
      )
      .at(-1)?.payload;
    expect(payload).toMatchObject({
      chosenPattern: 'blue',
      chosenColor: HeartColor.BLUE,
      adjustedTotalRequired: 3,
      adjustedColorRequirements: {
        [HeartColor.BLUE]: 2,
        [HeartColor.RAINBOW]: 1,
      },
      hasunosoraMemberCardIds: [stageMember!.instanceId],
      hasunosoraMemberCount: 1,
    });
  });
});
