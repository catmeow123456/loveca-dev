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
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { PL_N_PB1_039_LIVE_START_EXACT_PINK_REQUIREMENT_TARGET_PURPLE_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { projectPlayerViewState } from '../../src/online/projector';
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

function stellarStream(): LiveCardData {
  return {
    cardCode: 'PL!N-pb1-039-L',
    name: 'Stellar Stream',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 4,
      [HeartColor.PURPLE]: 4,
      [HeartColor.RAINBOW]: 6,
    }),
  };
}

function phoenix(): LiveCardData {
  return {
    cardCode: 'PL!N-pb1-038-L',
    name: 'PHOENIX',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 3,
      [HeartColor.RED]: 1,
      [HeartColor.PURPLE]: 1,
      [HeartColor.RAINBOW]: 2,
    }),
  };
}

function member(
  cardCode: string,
  name: string,
  hearts: readonly HeartColor[],
  groupNames: readonly string[] = ['虹ヶ咲']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: hearts.map((color) => createHeartIcon(color, 1)),
  };
}

function setup(options: {
  readonly ownMembers: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
  readonly opponentMember?: ReturnType<typeof createCardInstance>;
  readonly conditionLives?: readonly ReturnType<typeof createCardInstance>[];
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly conditionLives: readonly ReturnType<typeof createCardInstance>[];
} {
  const source = createCardInstance(stellarStream(), P1, 'stellar-stream');
  const conditionLives = options.conditionLives ?? [];
  const ownMembers = Object.entries(options.ownMembers) as [
    SlotPosition,
    ReturnType<typeof createCardInstance>,
  ][];
  let game = registerCards(createGameState('n-pb1-039', P1, 'P1', P2, 'P2'), [
    source,
    ...conditionLives,
    ...ownMembers.map(([, card]) => card),
    ...(options.opponentMember ? [options.opponentMember] : []),
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
    successZone: conditionLives.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.successZone
    ),
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
  return { game, source, conditionLives };
}

function start(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function confirm(game: GameState, targetId: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, targetId);
}

function stellarModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId ===
        PL_N_PB1_039_LIVE_START_EXACT_PINK_REQUIREMENT_TARGET_PURPLE_HEART_ABILITY_ID
  );
}

describe('PL!N-pb1-039 Stellar Stream', () => {
  it('consumes the pending without opening a selection when no external exact-pink LIVE exists', () => {
    const target = createCardInstance(
      member('PL!N-target', '朝香果林', [HeartColor.PURPLE]),
      P1,
      'no-condition-target'
    );
    const started = start(setup({ ownMembers: { [SlotPosition.CENTER]: target } }).game);
    expect(started.activeEffect).toBeNull();
    expect(started.pendingAbilities).toEqual([]);
    expect(stellarModifiers(started)).toEqual([]);
  });

  it('consumes the pending without a modifier when the condition holds but no legal purple-Heart member exists', () => {
    const target = createCardInstance(
      member('PL!N-target', '上原歩夢', [HeartColor.PINK]),
      P1,
      'no-legal-target'
    );
    const match = createCardInstance(phoenix(), P1, 'phoenix-no-legal-target');
    const started = start(
      setup({
        ownMembers: { [SlotPosition.CENTER]: target },
        conditionLives: [match],
      }).game
    );
    expect(started.activeEffect).toBeNull();
    expect(started.pendingAbilities).toEqual([]);
    expect(stellarModifiers(started)).toEqual([]);
  });

  it('keeps a real selection window with one legal target and grants exactly four purple Hearts only to it', () => {
    const target = createCardInstance(
      member('PL!N-target', '朝香果林', [HeartColor.PURPLE]),
      P1,
      'target'
    );
    const other = createCardInstance(
      member('PL!N-other', '上原歩夢', [HeartColor.PINK]),
      P1,
      'other'
    );
    const started = start(
      setup({
        ownMembers: { [SlotPosition.LEFT]: target, [SlotPosition.RIGHT]: other },
        conditionLives: [createCardInstance(phoenix(), P1, 'phoenix-single-target')],
      }).game
    );
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_PB1_039_LIVE_START_EXACT_PINK_REQUIREMENT_TARGET_PURPLE_HEART_ABILITY_ID,
      selectableCardIds: [target.instanceId],
      selectionLabel: '选择要获得[紫ハート][紫ハート][紫ハート][紫ハート]的成员',
      confirmSelectionLabel: '获得[紫ハート][紫ハート][紫ハート][紫ハート]',
      canSkipSelection: false,
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    const resolved = confirm(started, target.instanceId);
    expect(stellarModifiers(resolved)).toEqual([
      {
        kind: 'HEART',
        playerId: P1,
        target: 'TARGET_MEMBER',
        targetMemberCardId: target.instanceId,
        hearts: [createHeartIcon(HeartColor.PURPLE, 4)],
        sourceCardId: 'stellar-stream',
        abilityId: PL_N_PB1_039_LIVE_START_EXACT_PINK_REQUIREMENT_TARGET_PURPLE_HEART_ABILITY_ID,
      },
    ]);
    expect(getMemberEffectiveHeartIcons(resolved, P1, target.instanceId)).toContainEqual(
      createHeartIcon(HeartColor.PURPLE, 4)
    );
    expect(getMemberEffectiveHeartIcons(resolved, P1, other.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('preserves the player choice among multiple legal members and rejects wrong group, no-purple, LIVE, and opponent candidates', () => {
    const first = createCardInstance(
      member('PL!N-first', '朝香果林', [HeartColor.PURPLE]),
      P1,
      'first'
    );
    const chosen = createCardInstance(
      member('PL!N-chosen', '天王寺璃奈', [HeartColor.PURPLE]),
      P1,
      'chosen'
    );
    const wrongGroup = createCardInstance(
      member('PL!S-wrong', '津島善子', [HeartColor.PURPLE], ['Aqours']),
      P1,
      'wrong-group'
    );
    const noPurple = createCardInstance(
      member('PL!N-no-purple', '上原歩夢', [HeartColor.PINK]),
      P1,
      'no-purple'
    );
    const opponent = createCardInstance(
      member('PL!N-opponent', '三船栞子', [HeartColor.PURPLE]),
      P2,
      'opponent'
    );
    const scenario = setup({
      ownMembers: {
        [SlotPosition.LEFT]: first,
        [SlotPosition.CENTER]: chosen,
        [SlotPosition.RIGHT]: wrongGroup,
      },
      opponentMember: opponent,
      conditionLives: [createCardInstance(phoenix(), P1, 'phoenix-multiple-targets')],
    });
    const withNoPurpleRegistered = registerCards(scenario.game, [noPurple]);
    const started = start(withNoPurpleRegistered);
    expect(started.activeEffect?.selectableCardIds).toEqual([first.instanceId, chosen.instanceId]);
    expect(started.activeEffect?.selectableCardIds).not.toContain(wrongGroup.instanceId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(noPurple.instanceId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.source.instanceId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(opponent.instanceId);

    const opponentView = projectPlayerViewState(started, P2);
    expect(opponentView.activeEffect).not.toHaveProperty('selectableCardIds');
    expect(opponentView.activeEffect?.selectableObjectIds).toEqual([
      `obj_${first.instanceId}`,
      `obj_${chosen.instanceId}`,
    ]);

    const resolved = confirm(started, chosen.instanceId);
    expect(stellarModifiers(resolved)).toEqual([
      expect.objectContaining({ targetMemberCardId: chosen.instanceId }),
    ]);
  });

  it.each(['source', 'target', 'target-heart', 'condition'] as const)(
    'safely consumes and clears selection when the %s becomes stale before submit',
    (stalePart) => {
      const target = createCardInstance(
        member('PL!N-target', '朝香果林', [HeartColor.PURPLE]),
        P1,
        'stale-target'
      );
      const scenario = setup({
        ownMembers: { [SlotPosition.CENTER]: target },
        conditionLives: [createCardInstance(phoenix(), P1, 'phoenix-stale')],
      });
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
      } else if (stalePart === 'target-heart') {
        changed = addLiveModifier(changed, {
          kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
          playerId: P1,
          memberCardId: target.instanceId,
          color: HeartColor.PINK,
          sourceCardId: 'target-heart-change',
          abilityId: 'target-heart-change',
        });
      } else {
        changed = addLiveModifier(changed, {
          kind: 'REQUIREMENT',
          liveCardId: scenario.conditionLives[0]!.instanceId,
          modifiers: [{ color: HeartColor.PINK, countDelta: 1 }],
          sourceCardId: 'condition-change',
          abilityId: 'condition-change',
        });
      }
      const resolved = confirm(changed, target.instanceId);
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(stellarModifiers(resolved)).toEqual([]);
    }
  );
});
