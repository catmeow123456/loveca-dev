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
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_N_SD2_026_LIVE_START_EFFECTIVE_BLADE_FOUR_TARGET_GAIN_RED_HEART_TWO_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { registerNSd2026FireBirdWorkflowHandlers } from '../../src/application/card-effects/workflows/cards/n-sd2-026-fire-bird';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const EFFECT_TEXT =
  '【LIVE开始时】存在于自己的舞台的1名持有的[ブレード]大于等于4的『虹咲』的成员，LIVE结束时为止，获得[赤ハート][赤ハート]。';

registerNSd2026FireBirdWorkflowHandlers();

function fireBird(): LiveCardData {
  return {
    cardCode: 'PL!N-sd2-026-P',
    name: 'Fire Bird',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.RED]: 2 }),
  };
}

function member(
  cardCode: string,
  blade: number,
  groupNames: readonly string[] = ['虹ヶ咲']
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: 'pending-fire-bird',
    abilityId: PL_N_SD2_026_LIVE_START_EFFECTIVE_BLADE_FOUR_TARGET_GAIN_RED_HEART_TWO_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['event-fire-bird'],
  };
}

function setup(options: {
  readonly ownMembers?: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
  readonly opponentMember?: ReturnType<typeof createCardInstance>;
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(fireBird(), P1, 'fire-bird');
  const ownMembers = Object.entries(options.ownMembers ?? {}) as [
    SlotPosition,
    ReturnType<typeof createCardInstance>,
  ][];
  let game = registerCards(createGameState('n-sd2-026', P1, 'P1', P2, 'P2'), [
    source,
    ...ownMembers.map(([, card]) => card),
    ...(options.opponentMember ? [options.opponentMember] : []),
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
    memberSlots: ownMembers.reduce(
      (slots, [slot, card]) =>
        placeCardInSlot(slots, slot, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  if (options.opponentMember) {
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        options.opponentMember!.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
  }
  return {
    game: { ...game, pendingAbilities: [pendingAbility(source.instanceId)] },
    source,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState, selectedCardId: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, selectedCardId);
}

function fireBirdModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId ===
        PL_N_SD2_026_LIVE_START_EFFECTIVE_BLADE_FOUR_TARGET_GAIN_RED_HEART_TWO_ABILITY_ID
  );
}

describe('PL!N-sd2-026-P 分数4「Fire Bird」', () => {
  it('safely consumes the pending when no legal target exists', () => {
    const lowBlade = createCardInstance(member('PL!N-test-low', 3), P1, 'low-blade');
    const started = start(setup({ ownMembers: { [SlotPosition.CENTER]: lowBlade } }).game);

    expect(started.activeEffect).toBeNull();
    expect(started.pendingAbilities).toEqual([]);
    expect(fireBirdModifiers(started)).toEqual([]);
  });

  it('opens one mandatory real selection window and filters by own stage, group, and effective BLADE', () => {
    const printedFour = createCardInstance(member('PL!N-test-four', 4), P1, 'printed-four');
    const modifiedToFour = createCardInstance(
      member('PL!N-test-modified', 3),
      P1,
      'modified-to-four'
    );
    const wrongGroup = createCardInstance(
      member('PL!S-test-four', 4, ['Aqours']),
      P1,
      'wrong-group'
    );
    const opponent = createCardInstance(member('PL!N-opponent-four', 8), P2, 'opponent');
    const scenario = setup({
      ownMembers: {
        [SlotPosition.LEFT]: printedFour,
        [SlotPosition.CENTER]: modifiedToFour,
        [SlotPosition.RIGHT]: wrongGroup,
      },
      opponentMember: opponent,
    });
    const withEffectiveBlade = addLiveModifier(scenario.game, {
      kind: 'BLADE',
      target: 'TARGET_MEMBER',
      playerId: P1,
      targetMemberCardId: modifiedToFour.instanceId,
      countDelta: 1,
      sourceCardId: 'test-blade-source',
      abilityId: 'test-effective-blade',
    });

    const started = start(withEffectiveBlade);

    expect(started.activeEffect).toMatchObject({
      effectText: EFFECT_TEXT,
      stepText: '请选择自己舞台上1名持有4个以上[BLADE]的『虹咲』成员获得[赤ハート][赤ハート]。',
      selectableCardIds: [printedFour.instanceId, modifiedToFour.instanceId],
      selectableCardMode: 'SINGLE',
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择获得[赤ハート][赤ハート]的成员',
      confirmSelectionLabel: '获得[赤ハート][赤ハート]',
      canSkipSelection: false,
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect?.selectableCardIds).not.toContain(wrongGroup.instanceId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(opponent.instanceId);
  });

  it('grants exactly two red Hearts to the chosen member and binds the modifier to the source LIVE and ability', () => {
    const target = createCardInstance(member('PL!N-test-target', 4), P1, 'target');
    const started = start(setup({ ownMembers: { [SlotPosition.CENTER]: target } }).game);
    const resolved = confirm(started, target.instanceId);

    expect(fireBirdModifiers(resolved)).toEqual([
      {
        kind: 'HEART',
        playerId: P1,
        target: 'TARGET_MEMBER',
        targetMemberCardId: target.instanceId,
        hearts: [createHeartIcon(HeartColor.RED, 2)],
        sourceCardId: 'fire-bird',
        abilityId:
          PL_N_SD2_026_LIVE_START_EFFECTIVE_BLADE_FOUR_TARGET_GAIN_RED_HEART_TWO_ABILITY_ID,
      },
    ]);
    expect(getMemberEffectiveHeartIcons(resolved, P1, target.instanceId)).toContainEqual(
      createHeartIcon(HeartColor.RED, 2)
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it.each(['source', 'target', 'effective-blade'] as const)(
    'safely consumes the effect without a modifier when the %s becomes stale before submit',
    (stalePart) => {
      const target = createCardInstance(member('PL!N-test-stale', 4), P1, 'stale-target');
      const scenario = setup({ ownMembers: { [SlotPosition.CENTER]: target } });
      let changed = start(scenario.game);
      if (stalePart === 'source') {
        changed = updatePlayer(changed, P1, (player) => ({
          ...player,
          liveZone: removeCardFromStatefulZone(player.liveZone, scenario.source.instanceId),
        }));
      } else if (stalePart === 'target') {
        changed = updatePlayer(changed, P1, (player) => ({
          ...player,
          memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
        }));
      } else {
        changed = addLiveModifier(changed, {
          kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
          playerId: P1,
          memberCardId: target.instanceId,
          count: 3,
          sourceCardId: 'test-blade-replacement',
          abilityId: 'test-blade-replacement',
        });
      }

      const resolved = confirm(changed, target.instanceId);

      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(fireBirdModifiers(resolved)).toEqual([]);
    }
  );

  it('rejects an ID that was not offered without advancing the effect', () => {
    const target = createCardInstance(member('PL!N-test-valid', 4), P1, 'valid-target');
    const started = start(setup({ ownMembers: { [SlotPosition.CENTER]: target } }).game);

    const rejected = confirm(started, 'not-selectable');

    expect(rejected).toBe(started);
    expect(rejected.activeEffect).not.toBeNull();
    expect(fireBirdModifiers(rejected)).toEqual([]);
  });

  it('safely consumes the pending when the source is no longer an own LIVE-zone card', () => {
    const target = createCardInstance(
      member('PL!N-test-source-invalid', 4),
      P1,
      'source-invalid-target'
    );
    const scenario = setup({ ownMembers: { [SlotPosition.CENTER]: target } });
    const sourceRemoved = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.source.instanceId),
    }));

    const started = start(sourceRemoved);

    expect(started.activeEffect).toBeNull();
    expect(started.pendingAbilities).toEqual([]);
    expect(fireBirdModifiers(started)).toEqual([]);
  });
});
