import {
  PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID,
  PL_S_PB1_019_LIVE_START_AQOURS_RED_HEART_SUPPRESS_SUCCESS_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { openHextechSelection, applyHextechCommand } from '../../src/application/hextech/selection';
import { getHextechDefinition } from '../../src/domain/hextech/catalog';
import { getHextechDrawPhaseBonus } from '../../src/domain/hextech/bonuses';
import {
  getLiveCardScoreModifier,
  getLiveCardRequirementModifiers,
} from '../../src/domain/rules/live-modifiers';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import { tapEnergy } from '../../src/domain/entities/zone';
import { getDarkHextechTargets } from '../../src/application/hextech/dark-abilities';
import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  GameCommandType,
  createMulliganCommand,
  type GameCommand,
} from '../../src/application/game-commands';
import { acquireHextechBatch } from '../../src/application/hextech/acquire';
import {
  canPayDarkHextech,
  enqueueDarkHextechLiveStart,
  startDarkHextechAbility,
  finishDarkHextechAbilityStep,
} from '../../src/application/hextech/dark-abilities';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import { appendTriggeredAbility } from '../../src/application/card-effects/runtime/enqueue-pending-ability';
import { returnStageMemberToHandAndEnqueueTriggers } from '../../src/application/card-effects/runtime/return-stage-member-to-hand';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  emitGameEvent,
  type GameState,
  type HextechActiveEffectState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  placeCardInSlot,
  addCardToStatefulZone,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import { createLiveStartEvent, createEnterStageEvent } from '../../src/domain/events/game-events';
import { DARK_HEXTECH_DEFINITIONS } from '../../src/domain/hextech/dark-catalog';
import { DARK_HEXTECH_RULES_VERSION, type HextechId } from '../../src/domain/hextech/catalog';
import { getStageMemberLifecycleId } from '../../src/domain/rules/card-lifecycle';
import {
  freezeDarkLiveSlots,
  isCardAbilitySuppressedByDarkHextech as muted,
  clearDarkHextechUntilLiveEnd,
  getDarkLockedColumns,
} from '../../src/domain/hextech/suppression';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
  getEffectivePerformanceCheerCount,
  getPlayerLiveScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  HeartColor,
  GamePhase,
  SubPhase,
  SlotPosition,
  OrientationState,
  ZoneType,
} from '../../src/shared/types/enums';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';

const member: MemberCardData = {
  cardCode: 'TEST-M',
  name: '测试成员',
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 3,
  hearts: [{ color: HeartColor.GRAY, count: 2 }],
};
const song: LiveCardData = {
  cardCode: 'TEST-L',
  name: '测试LIVE',
  cardType: CardType.LIVE,
  score: 3,
  requirements: createHeartRequirement({ [HeartColor.GRAY]: 3 }),
};
const deck: DeckConfig = {
  mainDeck: Array.from({ length: 60 }, () => member),
  energyDeck: Array.from({ length: 12 }, () => ({
    cardCode: 'TEST-E',
    name: '能量',
    cardType: CardType.ENERGY,
  })),
};
const owned = (definitionId: HextechId, playerId = 'p1') => ({
  definitionId,
  playerId,
  instanceId: `${playerId}:${definitionId}`,
  acquiredTurn: 1,
});
function fixture(ids: readonly HextechId[] = []): GameState {
  let state = {
    ...createGameState('dark', 'p1', '甲', 'p2', '乙'),
    isStarted: true,
    turnCount: 1,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    hextech: { rulesVersion: DARK_HEXTECH_RULES_VERSION, owned: ids.map((id) => owned(id)) },
  } as GameState;
  for (const playerId of ['p1', 'p2']) {
    const cards = [
      ...['left', 'center', 'right'].map((slot) =>
        createCardInstance(member, playerId, `${playerId}-${slot}`)
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        createCardInstance(member, playerId, `${playerId}-hand-${i}`)
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        createCardInstance(member, playerId, `${playerId}-deck-${i}`)
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        createCardInstance(
          { cardCode: 'E', name: '能量', cardType: CardType.ENERGY },
          playerId,
          `${playerId}-energy-${i}`
        )
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        createCardInstance(song, playerId, `${playerId}-live-${i}`)
      ),
    ];
    state = registerCards(state, cards);
    state = updatePlayer(state, playerId, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, `${playerId}-left`),
          SlotPosition.CENTER,
          `${playerId}-center`
        ),
        SlotPosition.RIGHT,
        `${playerId}-right`
      ),
      hand: {
        ...player.hand,
        cardIds: cards
          .filter((card) => card.instanceId.includes('-hand-'))
          .map((card) => card.instanceId),
      },
      mainDeck: {
        ...player.mainDeck,
        cardIds: cards
          .filter((card) => card.instanceId.includes('-deck-'))
          .map((card) => card.instanceId),
      },
      energyZone: cards
        .filter((card) => card.instanceId.includes('-energy-'))
        .reduce((zone, card) => addCardToStatefulZone(zone, card.instanceId), player.energyZone),
      liveZone: addCardToStatefulZone(player.liveZone, `${playerId}-live-0`),
    }));
  }
  return state;
}
const roundTrip = (game: GameState) =>
  rehydrateAuthorityGameState(
    serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
  );
const keep = (game: GameState) => game;
function choose(game: GameState, ids: readonly string[] = [], skip = false): GameState {
  return finishDarkHextechAbilityStep(
    game,
    game.activeEffect as HextechActiveEffectState,
    skip ? null : undefined,
    ids,
    keep
  );
}
function activate(
  game: GameState,
  id: HextechId,
  selections: readonly (readonly string[])[]
): GameState {
  let state = startDarkHextechAbility(game, `p1:${id}`);
  for (const ids of selections) state = choose(state, ids);
  return choose(state);
}

describe('黑暗海克斯规则与真实来源', () => {
  it('24项，每档4项干扰和4项双刃剑；沉默支付2能量弃1', () => {
    expect(DARK_HEXTECH_DEFINITIONS).toHaveLength(24);
    for (const rarity of ['SILVER', 'GOLD', 'PRISMATIC'])
      for (const group of ['DISRUPTION', 'DOUBLE_EDGED'])
        expect(
          DARK_HEXTECH_DEFINITIONS.filter(
            (entry) => entry.rarity === rarity && entry.group === group
          )
        ).toHaveLength(4);
    expect(
      DARK_HEXTECH_DEFINITIONS.find((entry) => entry.id === 'dark-silent-spotlight')
    ).toMatchObject({ activation: { energy: 2, discard: 1 } });
  });
  it('取消不扣资源/次数，原子支付后双时点共享额度', () => {
    const initial = fixture(['dark-silent-spotlight']);
    let state = startDarkHextechAbility(initial, 'p1:dark-silent-spotlight');
    state = choose(state, ['p2-center']);
    state = choose(state, ['p1-hand-0']);
    const cancelled = choose(state, [], true);
    expect(cancelled.players).toEqual(initial.players);
    expect(cancelled.hextech?.uses).toBeUndefined();
    state = activate(initial, 'dark-silent-spotlight', [
      ['p2-center'],
      ['p1-hand-0'],
      ['p1-energy-0', 'p1-energy-1'],
    ]);
    expect(state.players[0].hand.cardIds).toHaveLength(7);
    expect(
      [...state.players[0].energyZone.cardStates.values()].filter(
        (card) => card.orientation === OrientationState.WAITING
      )
    ).toHaveLength(2);
    expect(muted(state, 'p2-center')).toBe(true);
    expect(canPayDarkHextech(state, 'p1:dark-silent-spotlight')).toBe(false);
    expect(
      enqueueDarkHextechLiveStart(state, [createLiveStartEvent('p1', [])]).pendingAbilities
    ).toHaveLength(0);
    expect(muted(clearDarkHextechUntilLiveEnd(state), 'p2-center')).toBe(false);
  });
  it('陈旧横置目标使整个支付取消，换位不清除沉默', () => {
    let state = startDarkHextechAbility(fixture(['dark-borrowed-rest']), 'p1:dark-borrowed-rest');
    state = choose(state, ['p2-center']);
    state = choose(state, ['p1-left']);
    state = updatePlayer(state, 'p2', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set('p2-center', {
          ...player.memberSlots.cardStates.get('p2-center')!,
          orientation: OrientationState.WAITING,
        }),
      },
    }));
    state = choose(state);
    expect(state.hextech?.uses).toBeUndefined();
    expect(state.players[0].memberSlots.cardStates.get('p1-left')?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });
  it('LIVE开始进入普通队列，真实海克斯来源、可选择顺序、放弃保留次数', () => {
    let state = fixture(['dark-sit-down', 'dark-burning-stage']);
    state = {
      ...state,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    };
    state = enqueueDarkHextechLiveStart(state, [createLiveStartEvent('p1', ['p1-live-0'])]);
    expect(state.pendingAbilities).toHaveLength(2);
    expect(state.pendingAbilities.every((entry) => entry.sourceCardId === undefined)).toBe(true);
    state = resolvePendingCardEffects(state).gameState;
    expect(state.activeEffect?.canResolveInOrder).toBe(true);
    expect(state.activeEffect?.selectableOptions).toHaveLength(2);
    const option = state.activeEffect!.selectableOptions![0].id;
    state = confirmActiveEffectStep(
      state,
      'p1',
      state.activeEffect!.id,
      undefined,
      undefined,
      false,
      option
    );
    expect(state.activeEffect?.stepId).toBe('HEXTECH_TARGET');
    state = confirmActiveEffectStep(state, 'p1', state.activeEffect!.id, null);
    expect(state.hextech?.uses).toBeUndefined();
    expect(state.activeEffect?.abilityId).toBe('hextech:dark-burning-stage');
  });
  it('纵列左右镜像，保留基础棒，来源自己其他能力被封但封锁不会自我抵消', () => {
    let state = fixture(['dark-silent-column']);
    state = {
      ...state,
      hextech: {
        ...state.hextech!,
        columnLocks: [
          {
            sourceInstanceId: 'p1:dark-silent-column',
            playerId: 'p1',
            memberCardId: 'p1-right',
            lifecycleId: getStageMemberLifecycleId(state, 'p1-right'),
          },
        ],
      },
    };
    expect(getDarkLockedColumns(state, 'p2')).toEqual([SlotPosition.LEFT]);
    expect(['p1-right', 'p2-left', 'p2-live-0'].map((id) => muted(state, id))).toEqual([
      true,
      true,
      true,
    ]);
    expect(['p2-right', 'p1-left', 'p1-live-0'].map((id) => muted(state, id))).toEqual([
      false,
      false,
      false,
    ]);
    expect(getMemberEffectiveBladeCount(state, 'p1', 'p1-right')).toBe(3);
    state = {
      ...state,
      hextech: {
        ...state.hextech!,
        owned: [...state.hextech!.owned, owned('dark-silent-spotlight', 'p2')],
        silencedMembers: [
          {
            sourceInstanceId: 'p2:dark-silent-spotlight',
            playerId: 'p1',
            memberCardId: 'p1-right',
            lifecycleId: getStageMemberLifecycleId(state, 'p1-right'),
            turn: 1,
          },
        ],
      },
    };
    expect(muted(state, 'p2-left')).toBe(false);
    expect(muted(state, 'p1-right')).toBe(true);
    expect(muted(clearDarkHextechUntilLiveEnd(state), 'p2-left')).toBe(true);
  });
  it('离场后纵列封锁消失，同一卡再次登场不继承', () => {
    let state = fixture(['dark-silent-column']);
    state = {
      ...state,
      hextech: {
        ...state.hextech!,
        columnLocks: [
          {
            sourceInstanceId: 'p1:dark-silent-column',
            playerId: 'p1',
            memberCardId: 'p1-right',
            lifecycleId: getStageMemberLifecycleId(state, 'p1-right'),
          },
        ],
      },
    };
    state = returnStageMemberToHandAndEnqueueTriggers(
      state,
      'p1',
      'p1-right',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(muted(state, 'p2-left')).toBe(false);
    state = updatePlayer(state, 'p1', (player) => ({
      ...player,
      hand: removeCardFromZone(player.hand, 'p1-right'),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, 'p1-right'),
    }));
    state = emitGameEvent(
      state,
      createEnterStageEvent('p1-right', SlotPosition.RIGHT, 'p1', 'p1', ZoneType.HAND)
    );
    expect(muted(state, 'p2-left')).toBe(false);
  });
  it('第一格成员被清理后不会封到后续歌曲，成功区也不被封锁', () => {
    let state = fixture(['dark-first-slot-mute']);
    state = updatePlayer(state, 'p2', (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: ['p2-hand-0', 'p2-live-0'] },
    }));
    state = freezeDarkLiveSlots(state, 'p2');
    state = updatePlayer(state, 'p2', (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: ['p2-live-0'] },
    }));
    expect(muted(state, 'p2-live-0')).toBe(false);
    const direct = fixture(['dark-first-slot-mute']);
    expect(muted(direct, 'p2-live-0')).toBe(true);
    state = updatePlayer(direct, 'p2', (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
      successZone: { ...player.successZone, cardIds: ['p2-live-0'] },
    }));
    expect(muted(state, 'p2-live-0')).toBe(false);
  });
  it('沉默只阻止后续入队，不撤销已入队与已结算加成', () => {
    const ability: PendingAbilityState = {
      id: 'queued',
      abilityId: 'test',
      sourceCardId: 'p2-center',
      controllerId: 'p2',
      mandatory: true,
      timingId: 'test',
      eventIds: [],
    };
    const base = fixture(['dark-silent-spotlight']);
    let state = {
      ...base,
      pendingAbilities: [ability],
      liveResolution: {
        ...base.liveResolution,
        liveModifiers: [
          {
            kind: 'BLADE' as const,
            target: 'TARGET_MEMBER' as const,
            playerId: 'p2',
            targetMemberCardId: 'p2-center',
            sourceCardId: 'p2-center',
            abilityId: 'resolved',
            countDelta: 4,
          },
        ],
      },
    };
    state = activate(state, 'dark-silent-spotlight', [
      ['p2-center'],
      ['p1-hand-0'],
      ['p1-energy-0', 'p1-energy-1'],
    ]) as typeof state;
    expect(appendTriggeredAbility(state, { ...ability, id: 'later' })).toEqual([ability]);
    expect(getMemberEffectiveBladeCount(state, 'p2', 'p2-center')).toBe(7);
  });
  it('强制返场检查待机与印刷9费并正确支付', () => {
    let state = fixture(['dark-forced-encore']);
    expect(canPayDarkHextech(state, 'p1:dark-forced-encore')).toBe(false);
    state = updatePlayer(state, 'p2', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set('p2-center', {
          ...player.memberSlots.cardStates.get('p2-center')!,
          orientation: OrientationState.WAITING,
        }),
      },
    }));
    state = activate(state, 'dark-forced-encore', [
      ['p2-center'],
      ['p1-hand-0', 'p1-hand-1'],
      ['p1-energy-0', 'p1-energy-1'],
    ]);
    expect(state.players[1].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(state.players[1].hand.cardIds).toContain('p2-center');
    expect(state.players[0].hand.cardIds).toHaveLength(6);
  });
});

describe('重写剧本的共享处理与网络快照', () => {
  it.each([
    [0, 0],
    [3, 3],
    [8, 3],
    [3, 8],
    [8, 8],
  ])('手牌 %i/%i：取得者先弃，双方弃完才抽', (first, second) => {
    let state = fixture();
    state = updatePlayer(state, 'p1', (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: player.hand.cardIds.slice(0, first) },
    }));
    state = updatePlayer(state, 'p2', (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: player.hand.cardIds.slice(0, second) },
    }));
    state = acquireHextechBatch(state, [owned('dark-rewrite-script')], () => 0).gameState;
    while (state.activeEffect) {
      const effect = state.activeEffect;
      const chooser = effect.awaitingPlayerId!;
      const other = chooser === 'p1' ? 'p2' : 'p1';
      const privateIds = effect.selectableCardIds!;
      const own = projectPlayerViewState(state, chooser);
      const opponent = projectPlayerViewState(state, other);
      expect(own.activeEffect?.selectableObjectIds).toHaveLength(privateIds.length);
      expect(opponent.activeEffect?.selectableObjectIds ?? []).toHaveLength(0);
      expect(state.players.map((player) => player.mainDeck.cardIds.length)).toEqual([15, 15]);
      state = roundTrip(state);
      state = confirmActiveEffectStep(
        state,
        chooser,
        effect.id,
        undefined,
        undefined,
        undefined,
        undefined,
        privateIds.slice(0, effect.minSelectableCards)
      );
    }
    expect(state.players.map((player) => player.hand.cardIds.length)).toEqual([
      Math.min(first, 3) + 3,
      Math.min(second, 3) + 3,
    ]);
    expect(state.players.map((player) => player.mainDeck.cardIds.length)).toEqual([12, 12]);
    expect(state.hextech?.pendingAcquisition).toBeUndefined();
  });
  it('本地开局双方同时取得，完成整份后再处理对方的份；重连继续且不重抽', () => {
    const session = createGameSession({ randomInt: () => 0 });
    session.createGame('reset', 'p1', '甲', 'p2', '乙', [
      ['dark-rewrite-script'],
      ['dark-rewrite-script'],
    ]);
    expect(session.initializeGame(deck, deck).success).toBe(true);
    for (const id of ['p1', 'p2'])
      expect(session.executeCommand(createMulliganCommand(id, [])).success).toBe(true);
    const actors: string[] = [];
    for (let i = 0; session.state!.activeEffect && i < 6; i++) {
      const state = session.state!;
      const effect = state.activeEffect!;
      actors.push(effect.awaitingPlayerId!);
      session.restoreRuntimeState({ authorityState: roundTrip(state), currentPublicSeq: 0 });
      const command: GameCommand = {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        playerId: effect.awaitingPlayerId!,
        effectId: effect.id,
        selectedCardIds: effect.selectableCardIds!.slice(0, effect.minSelectableCards),
        timestamp: i,
      };
      const result = session.executeCommand(command);
      expect(result.success, result.error).toBe(true);
    }
    expect(actors).toEqual(['p1', 'p2', 'p2', 'p1']);
    expect(session.state!.hextech!.acquisitionQueue).toBeUndefined();
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players.map((player) => player.hand.cardIds.length)).toEqual([7, 6]);
  });
});

describe('黑暗池条件、数值与反制边界', () => {
  it.each([
    ['dark-solo-exam', 'p2', 1, 2, 0],
    ['dark-solo-exam', 'p2', 2, 0, 0],
    ['dark-multi-song-tax', 'p2', 1, 0, 0],
    ['dark-multi-song-tax', 'p2', 2, 0, -1],
    ['dark-double-exam', 'p2', 2, 1, 0],
    ['dark-high-pressure-cheer', 'p1', 2, 2, 0],
    ['dark-lower-the-bar', 'p1', 2, -2, -1],
    ['dark-greed-contract', 'p1', 1, 1, 0],
  ] as const)(
    '%s 对 %s 的 %i 首歌曲需求变动 %i、总分变动 %i',
    (id, playerId, count, gray, score) => {
      let state = fixture([id]);
      state = updatePlayer(state, playerId, (player) => ({
        ...player,
        liveZone: {
          ...player.liveZone,
          cardIds: Array.from({ length: count }, (_, i) => `${playerId}-live-${i}`),
        },
      }));
      const modifiers = collectLiveModifiers(state);
      expect(getPlayerLiveScoreModifier(state.liveResolution, playerId, modifiers)).toBe(score);
      for (const cardId of state.players.find((player) => player.id === playerId)!.liveZone
        .cardIds) {
        expect(
          getLiveCardRequirementModifiers(state.liveResolution, cardId, modifiers).reduce(
            (sum, item) => sum + item.countDelta,
            0
          )
        ).toBe(gray);
      }
    }
  );
  it('孤注一曲加在该曲分数，双曲失效；储备检查可通过支付能量规避', () => {
    let state = fixture(['dark-all-in-song', 'dark-reserve-inspection']);
    let modifiers = collectLiveModifiers(state);
    expect(getLiveCardScoreModifier(state.liveResolution, 'p1-live-0', modifiers)).toBe(3);
    expect(getPlayerLiveScoreModifier(state.liveResolution, 'p1', modifiers)).toBe(0);
    expect(getPlayerLiveScoreModifier(state.liveResolution, 'p2', modifiers)).toBe(-2);
    state = updatePlayer(state, 'p1', (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: ['p1-live-0', 'p1-live-1'] },
    }));
    state = updatePlayer(state, 'p2', (player) => ({
      ...player,
      energyZone: ['p2-energy-0', 'p2-energy-1'].reduce(
        (zone, id) => tapEnergy(zone, id),
        player.energyZone
      ),
    }));
    modifiers = collectLiveModifiers(state);
    expect(getLiveCardScoreModifier(state.liveResolution, 'p1-live-0', modifiers)).toBe(0);
    expect(getPlayerLiveScoreModifier(state.liveResolution, 'p2', modifiers)).toBe(0);
  });
  it('三轮均抽同档也足够；每格重抽不出现自己已持有或本轮其他候选', () => {
    let state = fixture();
    state = {
      ...state,
      currentPhase: GamePhase.ACTIVE_PHASE,
      hextech: { ...state.hextech!, draft: { completedRounds: 0 } },
    };
    for (const turn of [1, 3, 5]) {
      state = openHextechSelection(
        { ...state, turnCount: turn, currentPhase: GamePhase.ACTIVE_PHASE },
        () => 0
      );
      for (const player of state.players) {
        for (const slot of [0, 1, 2]) {
          const offer = state.hextech!.draft!.pending!.offers[state.players.indexOf(player)];
          state = applyHextechCommand(
            state,
            {
              type: GameCommandType.REROLL_HEXTECH,
              playerId: player.id,
              selectionTurn: turn,
              slot,
              expectedDefinitionId: offer.candidates[slot].definitionId,
              timestamp: 0,
            },
            () => 0
          );
          const next = state.hextech!.draft!.pending!.offers[state.players.indexOf(player)];
          expect(new Set(next.candidates.map((entry) => entry.definitionId)).size).toBe(3);
          expect(
            next.candidates.every(
              (candidate) =>
                !state.hextech!.owned.some(
                  (entry) =>
                    entry.playerId === player.id && entry.definitionId === candidate.definitionId
                )
            )
          ).toBe(true);
        }
        const candidate =
          state.hextech!.draft!.pending!.offers[state.players.indexOf(player)].candidates[0];
        state = applyHextechCommand(
          state,
          {
            type: GameCommandType.SELECT_HEXTECH,
            playerId: player.id,
            selectionTurn: turn,
            slot: 0,
            expectedDefinitionId: candidate.definitionId,
            timestamp: 0,
          },
          () => 0
        );
      }
      state = roundTrip(state);
    }
    expect(state.hextech!.owned).toHaveLength(6);
  });
  it('支付步骤之间离场再登场也视为陈旧目标，不支付费用', () => {
    let state = startDarkHextechAbility(
      fixture(['dark-silent-spotlight']),
      'p1:dark-silent-spotlight'
    );
    state = choose(state, ['p2-center']);
    state = choose(state, ['p1-hand-0']);
    state = choose(state, ['p1-energy-0', 'p1-energy-1']);
    state = emitGameEvent(
      state,
      createEnterStageEvent('p2-center', SlotPosition.CENTER, 'p2', 'p2', ZoneType.HAND)
    );
    state = choose(state);
    expect(state.hextech?.uses).toBeUndefined();
    expect(state.players[0].hand.cardIds).toHaveLength(8);
  });
  it('LIVE开始无目标或资源仍可入队，先结算其他能力后再选择；对方LIVE不触发', () => {
    let state = fixture(['dark-forced-encore']);
    expect(canPayDarkHextech(state, 'p1:dark-forced-encore')).toBe(false);
    expect(
      enqueueDarkHextechLiveStart(state, [createLiveStartEvent('p2', [])]).pendingAbilities
    ).toHaveLength(0);
    state = enqueueDarkHextechLiveStart(state, [createLiveStartEvent('p1', [])]);
    expect(state.pendingAbilities).toHaveLength(1);
  });
  it('暗海克斯横置遵守他来源保护，目标印刷费用不受降费绕过', () => {
    let state = fixture(['dark-sit-down', 'dark-forced-encore']);
    const card = state.cardRegistry.get('p2-center')!;
    state = registerCards(state, [
      { ...card, data: { ...member, cost: 10, groupNames: ['Aqours'] } },
    ]);
    state = registerCards(state, [
      { ...state.cardRegistry.get('p2-left')!, data: { ...member, groupNames: ['Aqours'] } },
    ]);
    state = addMemberWaitProtectionUntilLiveEnd(state, {
      affectedPlayerId: 'p2',
      sourceCardId: 'protect',
      abilityId: 'protect',
    });
    const targets = getDarkHextechTargets(
      state,
      'p1',
      'p1:dark-sit-down',
      getHextechDefinition('dark-sit-down')!.activation!
    );
    expect(targets).not.toContain('p2-center');
    expect(targets).not.toContain('p2-left');
    expect(targets).toContain('p2-right');
    state = updatePlayer(state, 'p2', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set('p2-center', {
          ...player.memberSlots.cardStates.get('p2-center')!,
          orientation: OrientationState.WAITING,
        }),
      },
    }));
    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST_SET',
            playerId: 'p2',
            memberCardId: 'p2-center',
            setTo: 1,
            sourceCardId: 'discount',
            abilityId: 'discount',
          },
        ],
      },
    };
    expect(canPayDarkHextech(state, 'p1:dark-forced-encore')).toBe(false);
  });
  it('贪欲立即抽5且从下回合加抽；彩色双刃剑的数值与支付可独立对照', () => {
    let greed = acquireHextechBatch(fixture(), [owned('dark-greed-contract')], () => 0).gameState;
    expect(greed.players[0].hand.cardIds).toHaveLength(13);
    expect(getHextechDrawPhaseBonus(greed, 'p1')).toBe(0);
    greed = { ...greed, turnCount: 2 };
    expect(getHextechDrawPhaseBonus(greed, 'p1')).toBe(1);
    const burned = activate(fixture(['dark-burning-stage']), 'dark-burning-stage', [
      ['p1-hand-0', 'p1-hand-1'],
    ]);
    expect(burned.players[0].hand.cardIds).toHaveLength(6);
    expect(getEffectivePerformanceCheerCount(burned, 'p1', 9)).toBe(15);
    expect(
      getPlayerLiveScoreModifier(burned.liveResolution, 'p1', collectLiveModifiers(burned))
    ).toBe(3);
    const bet = fixture(['dark-bet-on-victory']);
    expect(getEffectivePerformanceCheerCount(bet, 'p1', 9)).toBe(6);
    expect(getPlayerLiveScoreModifier(bet.liveResolution, 'p1', collectLiveModifiers(bet))).toBe(3);
  });
});

describe('同局面彩色效果对照：真实 LIVE 判定、零额外判心', () => {
  it.each([
    ['dark-first-slot-mute', 'p2', 3, 3],
    ['dark-forced-encore', 'p2', 3, 0],
    ['dark-silent-spotlight', 'p2', 3, 3],
    ['dark-greed-contract', 'p1', 3, 3],
    ['dark-burning-stage', 'p1', 6, 0],
    ['dark-bet-on-victory', 'p1', 6, 6],
    ['dark-silent-column', 'p2', 3, 3],
    ['dark-farewell-gift', 'p1', 5, 5],
  ] as const)('%s（%s）：3灰心歌得%i／5灰心歌得%i', (id, performer, loose, tight) => {
    for (const [requirement, expected] of [
      [3, loose],
      [5, tight],
    ]) {
      let state = fixture([id]);
      state = registerCards(state, [
        {
          ...state.cardRegistry.get(`${performer}-live-0`)!,
          data: {
            ...song,
            requirements: createHeartRequirement({ [HeartColor.GRAY]: requirement }),
          },
        },
      ]);
      if (id === 'dark-forced-encore') {
        state = updatePlayer(state, 'p2', (player) => ({
          ...player,
          memberSlots: {
            ...player.memberSlots,
            cardStates: new Map(player.memberSlots.cardStates).set('p2-center', {
              ...player.memberSlots.cardStates.get('p2-center')!,
              orientation: OrientationState.WAITING,
            }),
          },
        }));
        state = activate(state, id, [
          ['p2-center'],
          ['p1-hand-0', 'p1-hand-1'],
          ['p1-energy-0', 'p1-energy-1'],
        ]);
      } else if (id === 'dark-silent-spotlight')
        state = activate(state, id, [['p2-center'], ['p1-hand-0'], ['p1-energy-0', 'p1-energy-1']]);
      else if (id === 'dark-burning-stage')
        state = activate(state, id, [['p1-hand-0', 'p1-hand-1']]);
      else if (id === 'dark-farewell-gift') state = activate(state, id, [['p1-center']]);
      else if (id === 'dark-silent-column')
        state = {
          ...state,
          hextech: {
            ...state.hextech!,
            columnLocks: [
              {
                sourceInstanceId: 'p1:dark-silent-column',
                playerId: 'p1',
                memberCardId: 'p1-right',
                lifecycleId: getStageMemberLifecycleId(state, 'p1-right'),
              },
            ],
          },
        };
      state = {
        ...state,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        activePlayerIndex: performer === 'p1' ? 0 : 1,
        liveResolution: { ...state.liveResolution, performingPlayerId: performer, isInLive: true },
      };
      const result = new GameService().processAction(state, {
        type: 'CONFIRM_JUDGMENT',
        playerId: performer,
        timestamp: 1,
        judgmentResults: new Map(),
      });
      expect(result.success, result.error).toBe(true);
      expect(result.gameState.liveResolution.playerScores.get(performer)).toBe(expected);
    }
  });
});

it('已入队的元气全开成功时能力不会被后加的位置封麦追溯无效', () => {
  let state = fixture(['dark-first-slot-mute']);
  state = registerCards(state, [
    {
      ...state.cardRegistry.get('p2-live-0')!,
      data: { ...song, cardCode: 'PL!S-pb1-019', name: '元気全開DAY! DAY! DAY!' },
    },
  ]);
  state = updatePlayer(state, 'p1', (player) => ({
    ...player,
    energyZone: removeCardFromZone(player.energyZone, 'p1-energy-2'),
    energyDeck: { ...player.energyDeck, cardIds: ['p1-energy-2'] },
  }));
  state = {
    ...state,
    pendingAbilities: [
      {
        id: 'already-queued-live',
        sourceCardId: 'p2-live-0',
        abilityId: PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID,
        controllerId: 'p2',
        mandatory: true,
        timingId: 'ON_LIVE_SUCCESS',
        eventIds: [],
      },
    ],
  };
  expect(muted(state, 'p2-live-0')).toBe(true);
  state = resolvePendingCardEffects(state).gameState;
  expect(state.activeEffect?.abilityId).toBe(
    PL_S_PB1_019_LIVE_SUCCESS_PLACE_OPPONENT_WAITING_ENERGY_ABILITY_ID
  );
  state = confirmActiveEffectStep(state, 'p2', state.activeEffect!.id);
  expect(state.players[0].energyDeck.cardIds).toHaveLength(0);
  expect(state.players[0].energyZone.cardStates.get('p1-energy-2')?.orientation).toBe(
    OrientationState.WAITING
  );
});

it('海克斯与卡牌同一LIVE开始队列，可先选卡牌再处理海克斯', () => {
  let state = fixture(['dark-sit-down']);
  const cardAbility = PL_S_PB1_019_LIVE_START_AQOURS_RED_HEART_SUPPRESS_SUCCESS_ABILITY_ID;
  state = registerCards(state, [
    {
      ...state.cardRegistry.get('p1-live-0')!,
      data: { ...song, cardCode: 'PL!S-pb1-019', name: '元気全開DAY! DAY! DAY!' },
    },
  ]);
  state = {
    ...state,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    pendingAbilities: [
      {
        id: 'card-first',
        sourceCardId: 'p1-live-0',
        abilityId: cardAbility,
        controllerId: 'p1',
        mandatory: true,
        timingId: 'ON_LIVE_START',
        eventIds: [],
      },
    ],
  };
  state = enqueueDarkHextechLiveStart(state, [createLiveStartEvent('p1', ['p1-live-0'])]);
  state = resolvePendingCardEffects(state).gameState;
  expect(state.activeEffect?.selectableOptions?.map((entry) => entry.id)).toContain('card-first');
  expect(state.activeEffect?.selectableOptions).toHaveLength(2);
  state = confirmActiveEffectStep(
    state,
    'p1',
    state.activeEffect!.id,
    undefined,
    undefined,
    false,
    'card-first'
  );
  expect(state.activeEffect?.abilityId).toBe(cardAbility);
  state = confirmActiveEffectStep(state, 'p1', state.activeEffect!.id);
  expect(state.activeEffect?.sourceHextechInstanceId).toBe('p1:dark-sit-down');
  state = confirmActiveEffectStep(state, 'p1', state.activeEffect!.id, null);
  expect(state.activeEffect).toBeNull();
  expect(state.hextech?.uses).toBeUndefined();
});
