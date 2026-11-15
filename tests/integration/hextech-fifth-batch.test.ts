import { describe, it, expect, vi } from 'vitest';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  GameCommandType,
  createMulliganCommand,
  createEndPhaseCommand,
  createOpenInspectionCommand,
  type GameCommand,
} from '../../src/application/game-commands';
import { acquireHextech, acquireHextechBatch } from '../../src/application/hextech/acquire';
import { getHextechActivation, getHextechSearch } from '../../src/application/hextech/abilities';
import { HEXTECH_DEFINITIONS, type HextechId } from '../../src/domain/hextech/catalog';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  getPlayerLiveScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  GamePhase,
  OrientationState,
  SlotPosition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { OnlineMatchService } from '../../src/server/services/online-match-service';

const member: MemberCardData = {
  cardCode: 'QA-M',
  name: '测试成员',
  cardType: CardType.MEMBER,
  cost: 1,
  blade: 1,
  hearts: [],
};
const song: LiveCardData = {
  cardCode: 'QA-L',
  name: '测试曲',
  cardType: CardType.LIVE,
  score: 3,
  requirements: createHeartRequirement({ GRAY: 1 }),
};
const deck = {
  mainDeck: [
    ...Array.from({ length: 48 }, () => member),
    ...Array.from({ length: 12 }, () => song),
  ],
  energyDeck: Array.from({ length: 12 }, () => ({
    cardCode: 'QA-E',
    name: '能量',
    cardType: CardType.ENERGY as const,
  })),
};
function execute(session: GameSession, command: GameCommand) {
  const result = session.executeCommand(command);
  expect(result.success, result.error).toBe(true);
  return session.state!;
}
function begin(first: readonly HextechId[] = [], second: readonly HextechId[] = []) {
  const session = createGameSession({ randomInt: (max) => max - 1 });
  session.createGame('fifth', 'p1', '甲', 'p2', '乙', [first, second]);
  expect(session.initializeGame(deck, deck).success).toBe(true);
  execute(session, createMulliganCommand('p1', []));
  execute(session, createMulliganCommand('p2', []));
  return session;
}
function ability(
  playerId: string,
  instanceId: string,
  selectedCardIds: readonly string[],
  search = false
) {
  return {
    type: search ? GameCommandType.RESOLVE_HEXTECH_SEARCH : GameCommandType.ACTIVATE_HEXTECH,
    playerId,
    instanceId,
    selectedCardIds,
    timestamp: 1,
  } as const;
}
function restore(session: GameSession, game: GameState) {
  session.restoreRuntimeState({
    authorityState: rehydrateAuthorityGameState(
      serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    ),
    currentPublicSeq: 0,
  });
}

describe('第五批：海克斯取得连锁和起动', () => {
  it('正式服务鉴权、快照恢复与观战不泄漏检索候选，双方检索依次完成才继续', async () => {
    const service = new OnlineMatchService({ recorder: null, randomInt: (max) => max - 1 });
    const participant = (userId: string) => ({
      userId,
      displayName: userId,
      deck,
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
    });
    const match = await service.createMatch({
      roomCode: 'FIFTH1',
      casualRuleMode: 'UNLIMITED',
      first: participant('u1'),
      second: participant('u2'),
    });
    await service.executeCommand(match.matchId, 'u1', createMulliganCommand('u1', []));
    await service.executeCommand(match.matchId, 'u2', createMulliganCommand('u2', []));
    const [first, second] = match.session.state!.players.map((p) => p.id);
    const enabled = {
      ...match.session.state!,
      hextech: { rulesVersion: 'HEXTECH_V1' as const, owned: [] },
    };
    const state = acquireHextechBatch(
      enabled,
      [
        { playerId: first, definitionId: 'crazy-for-live', instanceId: 'first-search' },
        { playerId: second, definitionId: 'crazy-for-live', instanceId: 'second-search' },
      ],
      () => 0
    ).gameState;
    restore(match.session, state);
    const link = service.createRoomCodePlayerViewSpectatorLink(
      match.matchId,
      'FIRST',
      ['FIRST', 'SECOND'],
      'generation'
    )!;
    const spectator = await service.joinSpectatorLink(link.token, { clientId: 'spectator' });
    expect(spectator.snapshot).toHaveProperty('playerViewState.match.hextech.pendingSearch');
    expect(JSON.stringify(spectator.snapshot)).not.toContain('candidates');
    const search = getHextechSearch(state)!;
    const command = {
      ...ability(first, 'first-search', search.candidates.slice(0, search.count), true),
      idempotencyKey: 'first-once',
    };
    expect(await service.executeCommand(match.matchId, 'outsider', command)).toBeNull();
    expect((await service.executeCommand(match.matchId, 'u2', command))!.success).toBe(false);
    expect((await service.executeCommand(match.matchId, 'u1', command))!.success).toBe(true);
    expect(getHextechSearch(match.session.state!)!.source.playerId).toBe(second);
    const secondSearch = getHextechSearch(match.session.state!)!;
    const secondCommand = ability(
      second,
      'second-search',
      secondSearch.candidates.slice(0, secondSearch.count),
      true
    );
    expect((await service.executeCommand(match.matchId, 'u2', secondCommand))!.success).toBe(true);
    expect(match.session.state!.hextech!.pendingSearch).toBeUndefined();
    expect((await service.executeCommand(match.matchId, 'u1', command))!.success).toBe(true);
  });

  it('质变保留本身，金到彩连锁使用同一权威随机源并只执行一次取得收益', () => {
    const session = begin();
    const base = session.state!;
    const gold = HEXTECH_DEFINITIONS.filter((d) => d.rarity === 'GOLD');
    const prism = HEXTECH_DEFINITIONS.filter((d) => d.rarity === 'PRISMATIC');
    const random = vi
      .fn()
      .mockReturnValueOnce(gold.findIndex((d) => d.id === 'upgrade-prismatic'))
      .mockReturnValueOnce(prism.findIndex((d) => d.id === 'pot-of-greatest-greed'));
    const result = acquireHextech(base, 'p1', 'upgrade-gold', 'root', random);
    expect(result.success).toBe(true);
    expect(result.gameState.hextech!.owned.map((o) => [o.definitionId, o.instanceId])).toEqual([
      ['upgrade-gold', 'root'],
      ['upgrade-prismatic', 'root:upgrade'],
      ['pot-of-greatest-greed', 'root:upgrade:upgrade'],
    ]);
    expect(result.gameState.players[0].hand.cardIds.length).toBe(
      base.players[0].hand.cardIds.length + 4
    );
    expect(random).toHaveBeenCalledTimes(2);
    restore(session, result.gameState);
    expect(acquireHextech(session.state!, 'p1', 'upgrade-gold', 'root', random).success).toBe(
      false
    );
    expect(random).toHaveBeenCalledTimes(2);
  });

  it('我为歌狂在开局取得后暂停，拒绝越权和无效检索，恢复后可继续且不重复弃牌', () => {
    const session = begin(['crazy-for-live']);
    const before = session.state!;
    const search = getHextechSearch(before)!;
    expect(before.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
    expect(before.players[0].hand.cardIds).toHaveLength(0);
    expect(before.players[0].waitingRoom.cardIds).toHaveLength(6);
    expect(search.count).toBe(6);
    expect(session.executeCommand(createEndPhaseCommand('p1')).success).toBe(false);
    expect(
      session.executeCommand(
        ability('p2', search.source.instanceId, search.candidates.slice(0, 6), true)
      ).success
    ).toBe(false);
    expect(
      session.executeCommand(
        ability('p1', search.source.instanceId, [search.candidates[0], search.candidates[0]], true)
      ).success
    ).toBe(false);
    restore(session, before);
    const command = {
      ...ability('p1', search.source.instanceId, search.candidates.slice(0, 6), true),
      idempotencyKey: 'search-once',
    };
    const after = execute(session, command);
    expect(after.currentPhase).toBe(GamePhase.MAIN_PHASE);
    expect(after.players[0].hand.cardIds).toHaveLength(7);
    expect(
      search.candidates.slice(0, 6).every((id) => after.players[0].hand.cardIds.includes(id))
    ).toBe(true);
    expect(after.hextech!.pendingSearch).toBeUndefined();
    expect(execute(session, command).players[0].hand.cardIds).toEqual(
      after.players[0].hand.cardIds
    );
    expect(session.undoLastStep().success).toBe(false);
  });

  it('双方同时取得时先公开全部持有，按先攻顺序完成检索后才执行后续取得收益', () => {
    const session = begin();
    const initial = session.state!;
    const result = acquireHextechBatch(
      initial,
      [
        { playerId: 'p1', definitionId: 'crazy-for-live', instanceId: 'first' },
        { playerId: 'p2', definitionId: 'pot-of-greed', instanceId: 'second' },
      ],
      () => 0
    );
    expect(result.success).toBe(true);
    expect(result.gameState.hextech!.owned).toHaveLength(2);
    expect(result.gameState.players[1].hand.cardIds).toEqual(initial.players[1].hand.cardIds);
    restore(session, result.gameState);
    const search = getHextechSearch(session.state!)!;
    const after = execute(
      session,
      ability('p1', 'first', search.candidates.slice(0, search.count), true)
    );
    expect(after.players[1].hand.cardIds.length).toBe(initial.players[1].hand.cardIds.length + 2);
    expect(after.hextech!.acquisitionQueue).toBeUndefined();
  });

  it('检索不足时尽量执行，可从休息室取得，候选按中性顺序只向本人公开', () => {
    const session = begin(['crazy-for-live']);
    let state = session.state!;
    const liveIds = getHextechSearch(state)!.candidates;
    state = updatePlayer(state, 'p1', (p) => ({
      ...p,
      mainDeck: {
        ...p.mainDeck,
        cardIds: p.mainDeck.cardIds.filter((id) => !liveIds.includes(id)),
      },
      waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, liveIds[0]] },
    }));
    restore(session, state);
    const own = projectPlayerViewState(session.state!, 'p1').match.hextech!.pendingSearch!;
    const other = projectPlayerViewState(session.state!, 'p2').match.hextech!.pendingSearch!;
    expect(own.requiredCount).toBe(1);
    expect(own.candidates).toHaveLength(1);
    expect(other.candidates).toBeUndefined();
    expect(other.requiredCount).toBeUndefined();
    const after = execute(session, ability('p1', own.instanceId, [liveIds[0]], true));
    expect(after.players[0].hand.cardIds).toContain(liveIds[0]);
  });

  it('没有检索候选时仍可确认继续，损坏的取得队列与来源不能复水', () => {
    const session = begin(['crazy-for-live']);
    let state = updatePlayer(session.state!, 'p1', (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: [] },
    }));
    restore(session, state);
    const search = getHextechSearch(session.state!)!;
    expect(search.count).toBe(0);
    expect(
      execute(session, ability('p1', search.source.instanceId, [], true)).hextech!.pendingSearch
    ).toBeUndefined();
    state = { ...state, hextech: { ...state.hextech!, acquisitionQueue: ['unknown'] } };
    expect(() => restore(session, state)).toThrow();
  });

  it('会玩拒绝空弃、越权、阶段外和重复卡，部分弃等量抽，全弃额外抽，实例分别限次', () => {
    const session = begin(['well-played']);
    let state = session.state!;
    const instance = state.hextech!.owned[0].instanceId;
    expect(session.executeCommand(ability('p1', instance, [])).success).toBe(false);
    expect(
      session.executeCommand(ability('p2', instance, [state.players[0].hand.cardIds[0]])).success
    ).toBe(false);
    expect(
      session.executeCommand(
        ability('p1', instance, [
          state.players[0].hand.cardIds[0],
          state.players[0].hand.cardIds[0],
        ])
      ).success
    ).toBe(false);
    const before = state.players[0].hand.cardIds.length;
    state = execute(session, {
      ...ability('p1', instance, state.players[0].hand.cardIds.slice(0, 2)),
      idempotencyKey: 'discard',
    });
    expect(state.players[0].hand.cardIds).toHaveLength(before);
    expect(state.players[0].waitingRoom.cardIds).toHaveLength(2);
    expect(getHextechActivation(state, 'p1', instance)).toBeNull();
    restore(session, state);
    expect(
      session.executeCommand(ability('p1', instance, [state.players[0].hand.cardIds[0]])).success
    ).toBe(false);
    const granted = acquireHextech(state, 'p1', 'well-played', 'second-copy').gameState;
    restore(session, granted);
    state = execute(session, ability('p1', 'second-copy', granted.players[0].hand.cardIds));
    expect(state.players[0].hand.cardIds).toHaveLength(before + 1);
    restore(session, { ...state, turnCount: 2 });
    expect(getHextechActivation(session.state!, 'p1', instance)).not.toBeNull();
  });

  it('空手、非主要阶段和检视中不能发动会玩，拒绝命令不会占用次数', () => {
    const session = begin(['well-played']);
    const initial = session.state!;
    const instance = initial.hextech!.owned[0].instanceId;
    const selected = initial.players[0].hand.cardIds.slice(0, 1);
    const empty = updatePlayer(initial, 'p1', (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, ...p.hand.cardIds] },
      hand: { ...p.hand, cardIds: [] },
    }));
    restore(session, empty);
    expect(getHextechActivation(session.state!, 'p1', instance)).toBeNull();
    expect(session.executeCommand(ability('p1', instance, [])).success).toBe(false);
    restore(session, { ...initial, currentPhase: GamePhase.DRAW_PHASE });
    expect(session.executeCommand(ability('p1', instance, selected)).success).toBe(false);
    restore(session, initial);
    expect(session.setManualOperationMode('FREE').success).toBe(true);
    execute(session, createOpenInspectionCommand('p1', ZoneType.MAIN_DECK, 1));
    expect(session.executeCommand(ability('p1', instance, selected)).success).toBe(false);
    restore(session, initial);
    expect(getHextechActivation(session.state!, 'p1', instance)).not.toBeNull();
    execute(session, ability('p1', instance, selected));
  });

  it('好好睡的待机命令产生真实事件并动态检查彼方，普通模式无加成', () => {
    const session = begin(['sleep-well']);
    let state = registerCards(session.state!, [
      createCardInstance({ ...member, name: '近江 彼方' }, 'p1', 'kanata'),
    ]);
    state = updatePlayer(state, 'p1', (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'kanata'),
    }));
    restore(session, state);
    const instance = state.hextech!.owned[0].instanceId;
    expect(
      getPlayerLiveScoreModifier(state.liveResolution, 'p1', collectLiveModifiers(state))
    ).toBe(0);
    state = execute(session, ability('p1', instance, ['kanata']));
    expect(state.players[0].memberSlots.cardStates.get('kanata')!.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      getPlayerLiveScoreModifier(state.liveResolution, 'p1', collectLiveModifiers(state))
    ).toBe(2);
    expect(
      state.eventLog.some(({ event }) => 'cause' in event && event.cause?.kind === 'HEXTECH_EFFECT')
    ).toBe(true);
    expect(
      getPlayerLiveScoreModifier(
        state.liveResolution,
        'p1',
        collectLiveModifiers({ ...state, hextech: undefined })
      )
    ).toBe(0);
  });
});
