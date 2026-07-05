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
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID,
  HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
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

function createDreamBelievers(): LiveCardData {
  return {
    cardCode: 'PL!HS-bp5-017-L',
    name: 'Dream Believers（104期Ver.）',
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createAuroraFlower(): LiveCardData {
  return {
    cardCode: 'PL!HS-bp5-018-L',
    name: 'AURORA FLOWER',
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(): MemberCardData {
  return {
    cardCode: 'TEST-energy',
    name: 'Energy',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly unitName?: string;
  readonly groupNames?: readonly string[];
  readonly cost?: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames,
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupDreamBelievers(options: {
  readonly members: readonly {
    readonly id: string;
    readonly cardCode: string;
    readonly name: string;
    readonly unitName?: string;
    readonly groupNames?: readonly string[];
    readonly cost?: number;
  }[];
  readonly activeEnergyCount?: number;
  readonly waitingEnergyCount?: number;
  readonly initialScore?: number;
}): {
  readonly game: GameState;
  readonly liveId: string;
  readonly energyIds: readonly string[];
  readonly memberIds: readonly string[];
} {
  const live = createCardInstance(createDreamBelievers(), PLAYER1, 'dream-believers');
  const members = options.members.map((member) =>
    createCardInstance(
      createMember({
        cardCode: member.cardCode,
        name: member.name,
        groupNames: member.groupNames,
        unitName: member.unitName,
        cost: member.cost,
      }),
      PLAYER1,
      member.id
    )
  );
  const energyCount = (options.activeEnergyCount ?? 0) + (options.waitingEnergyCount ?? 0);
  const energyCards = Array.from({ length: energyCount }, (_, index) =>
    createCardInstance(createEnergy(), PLAYER1, `energy-${index}`)
  );
  let game = registerCards(createGameState('hs-bp5-017', PLAYER1, 'P1', PLAYER2, 'P2'), [
    live,
    ...members,
    ...energyCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const [index, member] of members.entries()) {
      memberSlots = placeCardInSlot(
        memberSlots,
        [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
        member.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
    }
    let energyZone = player.energyZone;
    for (const [index, energy] of energyCards.entries()) {
      energyZone = addCardToStatefulZone(energyZone, energy.instanceId, {
        orientation:
          index < (options.activeEnergyCount ?? 0)
            ? OrientationState.ACTIVE
            : OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots,
      energyZone,
    };
  });

  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[PLAYER1, options.initialScore ?? 3]]),
        performingPlayerId: PLAYER1,
      },
    },
    liveId: live.instanceId,
    energyIds: energyCards.map((energy) => energy.instanceId),
    memberIds: members.map((member) => member.instanceId),
  };
}

function withDreamBelieversPending(game: GameState, liveId: string): GameState {
  return {
    ...game,
    pendingAbilities: [
      ...game.pendingAbilities,
      {
        id: `${HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID}:${liveId}:pending`,
        abilityId: HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID,
        sourceCardId: liveId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: ['manual-live-start'],
      },
    ],
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirmOption(game: GameState, selectedOptionId: string): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    selectedOptionId
  );
}

function dreamScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function payCostActions(game: GameState) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'PAY_COST' &&
      action.payload.abilityId ===
        HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID
  );
}

const HASU_CERISE = {
  id: 'kaho',
  cardCode: 'PL!HS-bp1-001-R',
  name: '日野下花帆',
  groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
  unitName: 'スリーズブーケ',
  cost: 4,
};

const HASU_DOLLCHESTRA = {
  id: 'sayaka',
  cardCode: 'PL!HS-bp1-002-R',
  name: '村野さやか',
  groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
  unitName: 'DOLLCHESTRA',
  cost: 5,
};

const AQOURS_GUILTY_KISS = {
  id: 'yoshiko',
  cardCode: 'PL!S-bp1-001-R',
  name: '津島善子',
  groupNames: ['ラブライブ！サンシャイン!!'],
  unitName: 'Guilty Kiss',
  cost: 6,
};

describe('PL!HS-bp5-017 Dream Believers workflow', () => {
  it('pays one active energy and adds SCORE +1 when the different-unit condition is met', () => {
    const scenario = setupDreamBelievers({
      members: [HASU_CERISE, AQOURS_GUILTY_KISS],
      activeEnergyCount: 1,
      initialScore: 3,
    });

    let state = resolve(withDreamBelieversPending(scenario.game, scenario.liveId));
    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'pay',
      'decline',
    ]);
    expect(state.activeEffect?.effectText).toContain('【LIVE开始时】可以支付[E]');
    expect(state.activeEffect?.effectText).toContain('当前可匹配小队名各不相同成员 2名');
    expect(state.activeEffect?.effectText).toContain('满足条件，支付后此LIVE分数+1');
    state = confirmOption(state, 'pay');

    expect(payCostActions(state)).toHaveLength(1);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(dreamScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: scenario.liveId,
        sourceCardId: scenario.liveId,
        abilityId: HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
  });

  it('can be declined without paying or adding score', () => {
    const scenario = setupDreamBelievers({
      members: [HASU_CERISE, AQOURS_GUILTY_KISS],
      activeEnergyCount: 1,
    });

    const state = confirmOption(resolve(withDreamBelieversPending(scenario.game, scenario.liveId)), 'decline');

    expect(payCostActions(state)).toHaveLength(0);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(dreamScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('consumes the pending no-op when there is no active energy', () => {
    const scenario = setupDreamBelievers({
      members: [HASU_CERISE, AQOURS_GUILTY_KISS],
      waitingEnergyCount: 1,
    });

    const state = resolve(withDreamBelieversPending(scenario.game, scenario.liveId));

    expect(state.activeEffect).toBeNull();
    expect(payCostActions(state)).toHaveLength(0);
    expect(dreamScoreModifiers(state)).toEqual([]);
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('keeps the paid cost when the condition is not met after payment', () => {
    const scenario = setupDreamBelievers({
      members: [HASU_CERISE],
      activeEnergyCount: 1,
    });

    const preview = resolve(withDreamBelieversPending(scenario.game, scenario.liveId));
    expect(preview.activeEffect?.effectText).toContain('未满足条件，支付后不增加分数');
    const state = confirmOption(preview, 'pay');

    expect(payCostActions(state)).toHaveLength(1);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(dreamScoreModifiers(state)).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload.conditionMet).toBe(false);
  });

  it('does not meet the condition with two members from the same structured unit', () => {
    const scenario = setupDreamBelievers({
      members: [
        HASU_CERISE,
        {
          id: 'kaho-2',
          cardCode: 'PL!HS-bp1-010-R',
          name: '乙宗梢',
          groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
          unitName: 'Cerise Bouquet',
          cost: 5,
        },
      ],
      activeEnergyCount: 1,
    });

    const state = confirmOption(resolve(withDreamBelieversPending(scenario.game, scenario.liveId)), 'pay');

    expect(payCostActions(state)).toHaveLength(1);
    expect(dreamScoreModifiers(state)).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload.matchingStageMemberCardIds).toEqual([]);
  });

  it('meets the condition with one Hasunosora member and one non-Hasunosora member from another unit', () => {
    const scenario = setupDreamBelievers({
      members: [HASU_DOLLCHESTRA, AQOURS_GUILTY_KISS],
      activeEnergyCount: 1,
    });

    const state = confirmOption(resolve(withDreamBelieversPending(scenario.game, scenario.liveId)), 'pay');

    expect(dreamScoreModifiers(state)).toHaveLength(1);
    expect(state.actionHistory.at(-1)?.payload.conditionMet).toBe(true);
    expect(state.actionHistory.at(-1)?.payload.matchingStageMemberUnitNames).toEqual([
      'DOLLCHESTRA',
      'Guilty Kiss',
    ]);
  });

  it('covers FAQ Q212: Rurino plus LL-bp2-001-R+ does not satisfy because the LL card has no structured unitName', () => {
    const scenario = setupDreamBelievers({
      members: [
        {
          id: 'rurino',
          cardCode: 'PL!HS-bp1-005-P',
          name: '大沢瑠璃乃',
          groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
          unitName: 'みらくらぱーく!',
          cost: 9,
        },
        {
          id: 'll-bp2-001',
          cardCode: 'LL-bp2-001-R＋',
          name: '渡辺 曜&鬼塚夏美&大沢瑠璃乃',
          groupNames: [
            'ラブライブ！サンシャイン!!',
            'ラブライブ！スーパースター!!',
            '蓮ノ空女学院スクールアイドルクラブ',
          ],
          cost: 20,
        },
      ],
      activeEnergyCount: 1,
    });

    const state = confirmOption(resolve(withDreamBelieversPending(scenario.game, scenario.liveId)), 'pay');

    expect(payCostActions(state)).toHaveLength(1);
    expect(dreamScoreModifiers(state)).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload.conditionMet).toBe(false);
  });

  it('continues to the next pending ability after this payment resolves in order', () => {
    const dreamBelievers = createCardInstance(createDreamBelievers(), PLAYER1, 'dream-order');
    const auroraFlower = createCardInstance(createAuroraFlower(), PLAYER1, 'aurora-order');
    const energy = createCardInstance(createEnergy(), PLAYER1, 'energy-order');
    const members = [HASU_CERISE, HASU_DOLLCHESTRA, AQOURS_GUILTY_KISS].map((member) =>
      createCardInstance(createMember(member), PLAYER1, member.id)
    );
    let game = registerCards(createGameState('hs-bp5-017-order', PLAYER1, 'P1', PLAYER2, 'P2'), [
      dreamBelievers,
      auroraFlower,
      energy,
      ...members,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: [dreamBelievers, auroraFlower].reduce(
        (zone, live) =>
          addCardToStatefulZone(zone, live.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.liveZone
      ),
      energyZone: addCardToStatefulZone(player.energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: members.reduce(
        (slots, member, index) =>
          placeCardInSlot(
            slots,
            [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
            member.instanceId,
            {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }
          ),
        player.memberSlots
      ),
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[PLAYER1, 8]]),
        performingPlayerId: PLAYER1,
      },
      pendingAbilities: [
        {
          id: 'dream-order-pending',
          abilityId: HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID,
          sourceCardId: dreamBelievers.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['manual-live-start'],
        },
        {
          id: 'aurora-order-pending',
          abilityId: HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
          sourceCardId: auroraFlower.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['manual-live-start'],
        },
      ],
    };

    let state = resolve(game);
    expect(state.activeEffect?.canResolveInOrder).toBe(true);
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(state.activeEffect?.abilityId).toBe(
      HS_BP5_017_LIVE_START_PAY_ENERGY_DIFFERENT_UNITS_THIS_LIVE_SCORE_ABILITY_ID
    );
    state = confirmOption(state, 'pay');

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(dreamScoreModifiers(state)).toHaveLength(1);
    expect(
      state.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId ===
            HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(10);
  });
});
