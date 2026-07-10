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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { parseCardEffectText } from '../../client/src/lib/cardEffectTokens';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function aozoraJumpingHeart(): LiveCardData {
  return {
    cardCode: 'PL!S-bp2-025-L',
    name: '青空Jumping Heart',
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pending(sourceCardId: string, idSuffix = 'first'): PendingAbilityState {
  return {
    id: `${S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID}:${idSuffix}`,
    abilityId: S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
  };
}

function setup(options: {
  readonly ownSuccessCount?: number;
  readonly ownMembers?: readonly SlotPosition[];
  readonly opponentMembers?: readonly SlotPosition[];
  readonly includeContinuationPending?: boolean;
} = {}) {
  const source = createCardInstance(aozoraJumpingHeart(), PLAYER1, 'aozora');
  const ownSuccess = Array.from({ length: options.ownSuccessCount ?? 2 }, (_, index) =>
    createCardInstance(live(`PL!S-success-${index}`), PLAYER1, `success-${index}`)
  );
  const ownMembers = (options.ownMembers ?? [SlotPosition.LEFT, SlotPosition.RIGHT]).map((slot) => ({
    slot,
    card: createCardInstance(member(`PL!S-own-${slot}`), PLAYER1, `own-${slot}`),
  }));
  const opponentMembers = (options.opponentMembers ?? [SlotPosition.CENTER]).map((slot) => ({
    slot,
    card: createCardInstance(member(`PL!S-opponent-${slot}`), PLAYER2, `opponent-${slot}`),
  }));
  let game = registerCards(createGameState('s-bp2-025', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    ...ownSuccess,
    ...ownMembers.map(({ card }) => card),
    ...opponentMembers.map(({ card }) => card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: [source.instanceId],
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    successZone: ownSuccess.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
    memberSlots: ownMembers.reduce(
      (slots, { slot, card }) =>
        placeCardInSlot(slots, slot, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: opponentMembers.reduce(
      (slots, { slot, card }) =>
        placeCardInSlot(slots, slot, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  const pendingAbilities = [pending(source.instanceId)];
  if (options.includeContinuationPending) {
    pendingAbilities.push(pending('missing-live-source', 'continuation'));
  }
  return {
    game: { ...game, pendingAbilities },
    sourceId: source.instanceId,
    ownMemberIds: ownMembers.map(({ card }) => card.instanceId),
    opponentMemberIds: opponentMembers.map(({ card }) => card.instanceId),
  };
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.abilityId === S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
  );
}

describe('PL!S-bp2-025-L 青空Jumping Heart', () => {
  it('consumes insufficient-success pending without opening a target window', () => {
    const scenario = setup({ ownSuccessCount: 1 });
    const resolved = resolvePendingCardEffects(scenario.game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(bladeModifiers(resolved)).toEqual([]);
  });

  it('continues later pending abilities when the queue resolves in order', () => {
    const scenario = setup({ ownSuccessCount: 1, includeContinuationPending: true });
    const orderSelection = resolvePendingCardEffects(scenario.game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('opens one real target-selection window for multiple own stage members, with no confirm-only bridge', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
      selectableCardIds: scenario.ownMemberIds,
      stepText: '请选择自己舞台上的1名成员获得[BLADE][BLADE]。',
      selectionLabel: '选择获得[BLADE][BLADE]的成员',
      confirmSelectionLabel: '获得[BLADE][BLADE]',
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(bladeModifiers(started)).toEqual([]);
  });

  it('adds BLADE +2 only to the legally selected own stage member', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.ownMemberIds[1],
      null,
      false,
      null
    );

    expect(resolved.activeEffect).toBeNull();
    expect(bladeModifiers(resolved)).toEqual([
      expect.objectContaining({
        playerId: PLAYER1,
        sourceCardId: scenario.ownMemberIds[1],
        countDelta: 2,
      }),
    ]);
  });

  it('keeps the mandatory target window open for null, an opponent, or any unlisted client input', () => {
    for (const inputKind of ['NULL', 'OPPONENT', 'UNLISTED'] as const) {
      const scenario = setup();
      const started = resolvePendingCardEffects(scenario.game).gameState;
      const selectedCardId =
        inputKind === 'NULL'
          ? null
          : inputKind === 'OPPONENT'
            ? scenario.opponentMemberIds[0]
            : 'not-a-selectable-member';
      const resolved = confirmActiveEffectStep(
        started,
        PLAYER1,
        started.activeEffect!.id,
        selectedCardId,
        null,
        false,
        null
      );

      expect(resolved.activeEffect).toBe(started.activeEffect);
      expect(resolved.pendingAbilities).toEqual(started.pendingAbilities);
      expect(bladeModifiers(resolved)).toEqual([]);
    }
  });

  it('clears the window and continues safely for an originally legal own target that has left the stage', () => {
    const staleScenario = setup();
    const staleStarted = resolvePendingCardEffects(staleScenario.game).gameState;
    const staleState = updatePlayer(staleStarted, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, null),
    }));
    const staleResolved = confirmActiveEffectStep(
      staleState,
      PLAYER1,
      staleState.activeEffect!.id,
      staleScenario.ownMemberIds[0],
      null,
      false,
      null
    );
    expect(staleResolved.activeEffect).toBeNull();
    expect(bladeModifiers(staleResolved)).toEqual([]);
  });

  it('clears the window and continues safely when the source LIVE has left its owner\'s LIVE zone', () => {
    const sourceStaleScenario = setup();
    const sourceStaleStarted = resolvePendingCardEffects(sourceStaleScenario.game).gameState;
    const sourceStaleState = updatePlayer(sourceStaleStarted, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const sourceStaleResolved = confirmActiveEffectStep(
      sourceStaleState,
      PLAYER1,
      sourceStaleState.activeEffect!.id,
      sourceStaleScenario.ownMemberIds[0],
      null,
      false,
      null
    );
    expect(sourceStaleResolved.activeEffect).toBeNull();
    expect(bladeModifiers(sourceStaleResolved)).toEqual([]);
  });

  it('clears the window and continues safely when the success-LIVE condition becomes false', () => {
    const successCountStaleScenario = setup();
    const successCountStaleStarted = resolvePendingCardEffects(successCountStaleScenario.game).gameState;
    const successCountStaleState = updatePlayer(successCountStaleStarted, PLAYER1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: player.successZone.cardIds.slice(1) },
    }));
    const successCountStaleResolved = confirmActiveEffectStep(
      successCountStaleState,
      PLAYER1,
      successCountStaleState.activeEffect!.id,
      successCountStaleScenario.ownMemberIds[0],
      null,
      false,
      null
    );
    expect(successCountStaleResolved.activeEffect).toBeNull();
    expect(bladeModifiers(successCountStaleResolved)).toEqual([]);
  });

  it('safely no-ops when no own stage member exists or the source LIVE has left the own LIVE zone', () => {
    const noTarget = setup({ ownMembers: [] });
    const noTargetResolved = resolvePendingCardEffects(noTarget.game).gameState;
    expect(noTargetResolved.activeEffect).toBeNull();
    expect(noTargetResolved.pendingAbilities).toEqual([]);
    expect(bladeModifiers(noTargetResolved)).toEqual([]);

    const sourceLeft = setup();
    const sourceLeftState = updatePlayer(sourceLeft.game, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const sourceLeftResolved = resolvePendingCardEffects(sourceLeftState).gameState;
    expect(sourceLeftResolved.activeEffect).toBeNull();
    expect(sourceLeftResolved.pendingAbilities).toEqual([]);
    expect(bladeModifiers(sourceLeftResolved)).toEqual([]);
  });

  it('uses the Excel-backed Chinese effect text and only mapped BLADE tokens', () => {
    const definition = getCardAbilityDefinitionsForCardCode('PL!S-bp2-025-L').find(
      (ability) =>
        ability.abilityId === S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
    );
    expect(definition?.effectText).toBe(
      '【LIVE开始时】自己的成功LIVE卡区的卡片大于等于2张的场合，LIVE结束时为止，存在于自己的舞台的成员1名获得[BLADE][BLADE]。'
    );
    expect(parseCardEffectText(definition!.effectText).filter((part) => part.kind === 'blade')).toHaveLength(2);
  });
});
