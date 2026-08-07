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
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_SD2_013_LIVE_START_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  N_SD2_019_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  N_SD2_019_ON_ENTER_GAIN_BLUE_HEART_ABILITY_ID,
  N_SD2_021_ON_ENTER_WAIT_OPPONENT_COST_FOUR_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
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
const SD2_013_EFFECT_TEXT =
  '【登场】/【LIVE开始时】自己的舞台上仅存在『虹咲』的成员的场合，将存在于对方的舞台的1名原本持有的[ブレード]的数量小于等于2的成员变为待机状态。';
const SD2_021_EFFECT_TEXT =
  '【登场】将存在于对方的舞台的1名费用小于等于4的成员变为待机状态。   (待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。)';

function member(options: {
  readonly cardCode: string;
  readonly name?: string;
  readonly groups?: readonly string[];
  readonly cost?: number;
  readonly blade?: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name ?? options.cardCode,
    groupNames: options.groups ?? ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 5,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function pending(options: {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly timingId: TriggerCondition;
  readonly sourceSlot?: SlotPosition;
}): PendingAbilityState {
  return {
    id: options.id,
    abilityId: options.abilityId,
    sourceCardId: options.sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: options.timingId,
    eventIds: [`${options.id}:event`],
    sourceSlot: options.sourceSlot,
  };
}

function putOnStage(
  game: GameState,
  playerId: string,
  cardId: string,
  slot: SlotPosition,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function latestPayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

describe('PL!N-sd2 opponent-wait-target family', () => {
  it.each([
    [
      N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
      TriggerCondition.ON_ENTER_STAGE,
    ],
    [
      N_SD2_013_LIVE_START_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
      TriggerCondition.ON_LIVE_START,
    ],
  ])(
    'waits only an originally BLADE<=2 active opponent member for %s when the nonempty own stage is all Nijigasaki',
    (abilityId, timingId) => {
      const source = createCardInstance(
        member({ cardCode: 'PL!N-sd2-013-SD2', name: '上原歩夢' }),
        PLAYER1,
        'ayumu'
      );
      const ally = createCardInstance(
        member({ cardCode: 'PL!N-test-ally', name: '朝香果林' }),
        PLAYER1,
        'ally'
      );
      const legal = createCardInstance(
        member({ cardCode: 'opponent-blade-two', blade: 2 }),
        PLAYER2,
        'legal'
      );
      const waiting = createCardInstance(
        member({ cardCode: 'opponent-blade-one-waiting', blade: 1 }),
        PLAYER2,
        'waiting'
      );
      const highBlade = createCardInstance(
        member({ cardCode: 'opponent-blade-three', blade: 3 }),
        PLAYER2,
        'high-blade'
      );
      let game = createGameState(`sd2-013-${timingId}`, PLAYER1, 'P1', PLAYER2, 'P2');
      game = registerCards(game, [source, ally, legal, waiting, highBlade]);
      game = putOnStage(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
      game = putOnStage(game, PLAYER1, ally.instanceId, SlotPosition.LEFT);
      game = putOnStage(game, PLAYER2, legal.instanceId, SlotPosition.LEFT);
      game = putOnStage(
        game,
        PLAYER2,
        waiting.instanceId,
        SlotPosition.CENTER,
        OrientationState.WAITING
      );
      game = putOnStage(game, PLAYER2, highBlade.instanceId, SlotPosition.RIGHT);
      game = {
        ...game,
        pendingAbilities: [
          pending({
            id: `pending-${timingId}`,
            abilityId,
            sourceCardId: source.instanceId,
            timingId,
            sourceSlot: SlotPosition.CENTER,
          }),
        ],
      };

      const preview = resolvePendingCardEffects(game).gameState;
      expect(preview.activeEffect).toMatchObject({
        abilityId,
        effectText: SD2_013_EFFECT_TEXT,
        selectableCardIds: [legal.instanceId],
        selectionLabel: '选择对方舞台上原本[BLADE]小于等于2的成员',
        confirmSelectionLabel: '变为待机状态',
      });
      const resolved = confirmActiveEffectStep(
        preview,
        PLAYER1,
        preview.activeEffect!.id,
        legal.instanceId
      );
      expect(resolved.players[1].memberSlots.cardStates.get(legal.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(resolved.eventLog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: expect.objectContaining({
              eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
              cardInstanceId: legal.instanceId,
            }),
          }),
        ])
      );
    }
  );

  it('treats an empty current stage as failing PL!N-sd2-013 even when the pending source slot was captured', () => {
    const source = createCardInstance(
      member({ cardCode: 'PL!N-sd2-013-SD2', name: '上原歩夢' }),
      PLAYER1,
      'ayumu-left-stage'
    );
    const target = createCardInstance(
      member({ cardCode: 'opponent-blade-two', blade: 2 }),
      PLAYER2,
      'target'
    );
    let game = createGameState('sd2-013-empty-stage', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, target]);
    game = putOnStage(game, PLAYER2, target.instanceId, SlotPosition.CENTER);
    game = {
      ...game,
      pendingAbilities: [
        pending({
          id: 'empty-stage-pending',
          abilityId: N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
          sourceCardId: source.instanceId,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
        }),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(latestPayload(resolved, game.pendingAbilities[0]!.abilityId)).toMatchObject({
      step: 'SKIP_CONDITION_NOT_MET',
      sourceSlot: SlotPosition.CENTER,
      ownStageMemberCardIds: [],
      allOwnStageMembersMatchGroup: false,
    });
  });

  it('rechecks the current stage group condition and does not rely on the source still occupying its captured slot', () => {
    const source = createCardInstance(
      member({ cardCode: 'PL!N-sd2-013-SD2', name: '上原歩夢' }),
      PLAYER1,
      'ayumu-left-stage'
    );
    const ally = createCardInstance(
      member({ cardCode: 'PL!N-test-ally', name: '朝香果林' }),
      PLAYER1,
      'ally-remains'
    );
    const target = createCardInstance(
      member({ cardCode: 'opponent-blade-two', blade: 2 }),
      PLAYER2,
      'target'
    );
    let game = createGameState('sd2-013-source-snapshot', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, ally, target]);
    game = putOnStage(game, PLAYER1, ally.instanceId, SlotPosition.LEFT);
    game = putOnStage(game, PLAYER2, target.instanceId, SlotPosition.CENTER);
    game = {
      ...game,
      pendingAbilities: [
        pending({
          id: 'source-snapshot-pending',
          abilityId: N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
          sourceCardId: source.instanceId,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
        }),
      ],
    };

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
  });

  it('fails PL!N-sd2-013 when any current own stage member is not Nijigasaki', () => {
    const source = createCardInstance(
      member({ cardCode: 'PL!N-sd2-013-SD2', name: '上原歩夢' }),
      PLAYER1,
      'ayumu'
    );
    const aqours = createCardInstance(
      member({ cardCode: 'aqours', groups: ['Aqours'] }),
      PLAYER1,
      'aqours'
    );
    let game = createGameState('sd2-013-mixed-stage', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, aqours]);
    game = putOnStage(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
    game = putOnStage(game, PLAYER1, aqours.instanceId, SlotPosition.LEFT);
    game = {
      ...game,
      pendingAbilities: [
        pending({
          id: 'mixed-stage-pending',
          abilityId: N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
          sourceCardId: source.instanceId,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
        }),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(latestPayload(resolved, game.pendingAbilities[0]!.abilityId)).toMatchObject({
      step: 'SKIP_CONDITION_NOT_MET',
      allOwnStageMembersMatchGroup: false,
    });
  });

  it('selects only an active opponent cost<=2 member for PL!N-sd2-019', () => {
    const abilityId = N_SD2_019_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID;
    const timingId = TriggerCondition.ON_LIVE_START;
    const effectText =
      '【LIVE开始时】将存在于对方的舞台的1名费用小于等于2的成员变为待机状态。';
    const source = createCardInstance(
      member({ cardCode: 'PL!N-sd2-019-SD2' }),
      PLAYER1,
      'source'
    );
    const legal = createCardInstance(
      member({ cardCode: 'cost-two', cost: 2 }),
      PLAYER2,
      'cost-two'
    );
    const highCost = createCardInstance(
      member({ cardCode: 'cost-three', cost: 3 }),
      PLAYER2,
      'cost-three'
    );
    let game = createGameState(`sd2-cost-two-${abilityId}`, PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, legal, highCost]);
    game = putOnStage(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
    game = putOnStage(game, PLAYER2, legal.instanceId, SlotPosition.LEFT);
    game = putOnStage(game, PLAYER2, highCost.instanceId, SlotPosition.RIGHT);
    game = {
      ...game,
      pendingAbilities: [
        pending({
          id: `pending-${abilityId}`,
          abilityId,
          sourceCardId: source.instanceId,
          timingId,
          sourceSlot: SlotPosition.CENTER,
        }),
      ],
    };

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect).toMatchObject({
      abilityId,
      effectText,
      selectableCardIds: [legal.instanceId],
      selectionLabel: '选择对方舞台上费用小于等于2的成员',
      confirmSelectionLabel: '变为待机状态',
    });
    const resolved = confirmActiveEffectStep(
      preview,
      PLAYER1,
      preview.activeEffect!.id,
      legal.instanceId
    );
    expect(resolved.players[1].memberSlots.cardStates.get(legal.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('lets PL!N-sd2-021 wait a cost-four target but excludes a cost-five target', () => {
    const source = createCardInstance(
      member({ cardCode: 'PL!N-sd2-021-SD2' }),
      PLAYER1,
      'rina-source'
    );
    const legal = createCardInstance(
      member({ cardCode: 'cost-four', cost: 4 }),
      PLAYER2,
      'cost-four'
    );
    const tooExpensive = createCardInstance(
      member({ cardCode: 'cost-five', cost: 5 }),
      PLAYER2,
      'cost-five'
    );
    let game = createGameState('sd2-021-cost-four', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, legal, tooExpensive]);
    game = putOnStage(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
    game = putOnStage(game, PLAYER2, legal.instanceId, SlotPosition.LEFT);
    game = putOnStage(game, PLAYER2, tooExpensive.instanceId, SlotPosition.RIGHT);
    game = {
      ...game,
      pendingAbilities: [
        pending({
          id: 'pending-sd2-021-cost-four',
          abilityId: N_SD2_021_ON_ENTER_WAIT_OPPONENT_COST_FOUR_MEMBER_ABILITY_ID,
          sourceCardId: source.instanceId,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
        }),
      ],
    };

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect).toMatchObject({
      abilityId: N_SD2_021_ON_ENTER_WAIT_OPPONENT_COST_FOUR_MEMBER_ABILITY_ID,
      effectText: SD2_021_EFFECT_TEXT,
      selectableCardIds: [legal.instanceId],
      selectionLabel: '选择对方舞台上费用小于等于4的成员',
      confirmSelectionLabel: '变为待机状态',
    });

    const resolved = confirmActiveEffectStep(
      preview,
      PLAYER1,
      preview.activeEffect!.id,
      legal.instanceId
    );
    expect(resolved.players[1].memberSlots.cardStates.get(legal.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolved.players[1].memberSlots.cardStates.get(tooExpensive.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('revalidates the PL!N-sd2-021 cost-four selector when the target is submitted', () => {
    const source = createCardInstance(
      member({ cardCode: 'PL!N-sd2-021-SD2' }),
      PLAYER1,
      'rina-recheck-source'
    );
    const target = createCardInstance(
      member({ cardCode: 'cost-four', cost: 4 }),
      PLAYER2,
      'cost-four-recheck'
    );
    let game = createGameState('sd2-021-recheck', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, target]);
    game = putOnStage(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
    game = putOnStage(game, PLAYER2, target.instanceId, SlotPosition.CENTER);
    game = {
      ...game,
      pendingAbilities: [
        pending({
          id: 'pending-sd2-021-recheck',
          abilityId: N_SD2_021_ON_ENTER_WAIT_OPPONENT_COST_FOUR_MEMBER_ABILITY_ID,
          sourceCardId: source.instanceId,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
        }),
      ],
    };

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    const staleCardRegistry = new Map(preview.cardRegistry);
    staleCardRegistry.set(target.instanceId, {
      ...target,
      data: {
        ...target.data,
        cost: 5,
      } as MemberCardData,
    });
    const stale = {
      ...preview,
      cardRegistry: staleCardRegistry,
    };

    const rejected = confirmActiveEffectStep(
      stale,
      PLAYER1,
      stale.activeEffect!.id,
      target.instanceId
    );
    expect(rejected.activeEffect).toEqual(stale.activeEffect);
    expect(rejected.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });
});

describe('PL!N-sd2-019-SD2 费用4「优木雪菜」登场 Heart', () => {
  it('adds a SOURCE_MEMBER blue Heart and uses the manual-selection confirmation bridge', () => {
    const first = createCardInstance(
      member({ cardCode: 'PL!N-sd2-019-SD2', name: '優木せつ菜' }),
      PLAYER1,
      'setsuna-first'
    );
    const second = createCardInstance(
      member({ cardCode: 'PL!N-sd2-019-SEC', name: '優木せつ菜' }),
      PLAYER1,
      'setsuna-second'
    );
    let game = createGameState('sd2-019-heart', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [first, second]);
    game = putOnStage(game, PLAYER1, first.instanceId, SlotPosition.LEFT);
    game = putOnStage(game, PLAYER1, second.instanceId, SlotPosition.RIGHT);
    game = {
      ...game,
      pendingAbilities: [
        pending({
          id: 'setsuna-first-pending',
          abilityId: N_SD2_019_ON_ENTER_GAIN_BLUE_HEART_ABILITY_ID,
          sourceCardId: first.instanceId,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.LEFT,
        }),
        pending({
          id: 'setsuna-second-pending',
          abilityId: N_SD2_019_ON_ENTER_GAIN_BLUE_HEART_ABILITY_ID,
          sourceCardId: second.instanceId,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.RIGHT,
        }),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    const confirmation = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      first.instanceId
    );
    expect(confirmation.activeEffect).toMatchObject({
      abilityId: N_SD2_019_ON_ENTER_GAIN_BLUE_HEART_ABILITY_ID,
      effectText: '【登场】LIVE结束时为止，获得[青ハート]。',
      metadata: { confirmOnlyPendingAbility: true },
    });

    const resolved = confirmActiveEffectStep(confirmation, PLAYER1, confirmation.activeEffect!.id);
    expect(
      getMemberEffectiveHeartIcons(resolved, PLAYER1, first.instanceId)
        .filter((heart) => heart.color === HeartColor.BLUE)
        .reduce((sum, heart) => sum + heart.count, 0)
    ).toBe(2);
    expect(latestPayload(resolved, N_SD2_019_ON_ENTER_GAIN_BLUE_HEART_ABILITY_ID)).toMatchObject({
      step: 'ON_ENTER_SOURCE_MEMBER_GAIN_BLUE_HEART',
      heartColor: HeartColor.BLUE,
      heartBonus: 1,
      heartApplied: true,
    });
  });
});
