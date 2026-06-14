import { describe, expect, it } from 'vitest';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';
import { GameCommandType } from '../../src/application/game-commands';
import {
  createCardInstance,
  createFaceDownCardState,
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import type { PlayerViewState } from '../../src/online/types';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createTestMember(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createTestLive(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createTestEnergy(cardCode: string, name: string): EnergyCardData {
  return {
    cardCode,
    name,
    cardType: CardType.ENERGY,
  };
}

function createProjectedState() {
  const p1HandCard = createCardInstance(
    createTestMember('MEM-001', 'P1 手牌成员'),
    PLAYER1,
    'p1-hand'
  );
  const p2HandCard = createCardInstance(
    createTestMember('MEM-002', 'P2 手牌成员'),
    PLAYER2,
    'p2-hand'
  );
  const p1LiveCard = createCardInstance(createTestLive('LIV-001', '盖放 Live'), PLAYER1, 'p1-live');
  const p1MainDeckCard = createCardInstance(
    createTestMember('MEM-003', 'P1 主卡组成员'),
    PLAYER1,
    'p1-main'
  );
  const p1WaitingRoomCard = createCardInstance(
    createTestMember('MEM-005', 'P1 休息室成员'),
    PLAYER1,
    'p1-waiting'
  );
  const p2MainDeckCard = createCardInstance(
    createTestMember('MEM-004', 'P2 主卡组成员'),
    PLAYER2,
    'p2-main'
  );
  const p1EnergyDeckCard = createCardInstance(
    createTestEnergy('ENE-001', 'P1 能量'),
    PLAYER1,
    'p1-energy'
  );
  const p2EnergyDeckCard = createCardInstance(
    createTestEnergy('ENE-002', 'P2 能量'),
    PLAYER2,
    'p2-energy'
  );

  let state = createGameState('view-test', PLAYER1, '玩家1', PLAYER2, '玩家2');
  state = registerCards(state, [
    p1HandCard,
    p2HandCard,
    p1LiveCard,
    p1MainDeckCard,
    p1WaitingRoomCard,
    p2MainDeckCard,
    p1EnergyDeckCard,
    p2EnergyDeckCard,
  ]);

  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: addCardToZone(player.hand, p1HandCard.instanceId),
    mainDeck: addCardToZone(player.mainDeck, p1MainDeckCard.instanceId),
    energyDeck: addCardToZone(player.energyDeck, p1EnergyDeckCard.instanceId),
    waitingRoom: addCardToZone(player.waitingRoom, p1WaitingRoomCard.instanceId),
    liveZone: addCardToStatefulZone(
      player.liveZone,
      p1LiveCard.instanceId,
      createFaceDownCardState()
    ),
  }));

  state = updatePlayer(state, PLAYER2, (player) => ({
    ...player,
    hand: addCardToZone(player.hand, p2HandCard.instanceId),
    mainDeck: addCardToZone(player.mainDeck, p2MainDeckCard.instanceId),
    energyDeck: addCardToZone(player.energyDeck, p2EnergyDeckCard.instanceId),
  }));

  return {
    state,
    p1HandCard,
    p2HandCard,
    p1LiveCard,
    p1MainDeckCard,
    p1WaitingRoomCard,
    p2MainDeckCard,
  };
}

function getCommandHint(view: PlayerViewState, command: GameCommandType) {
  return view.permissions.availableCommands.find((hint) => hint.command === command) ?? null;
}

function hasEnabledCommand(view: PlayerViewState, command: GameCommandType): boolean {
  return getCommandHint(view, command)?.enabled === true;
}

describe('PlayerViewState projector', () => {
  it('activeEffect 私有候选卡仅投影给等待玩家，避免对手看到候选数量', () => {
    const { state, p1HandCard, p1WaitingRoomCard } = createProjectedState();
    state.activeEffect = {
      id: 'effect-private-hand',
      abilityId: 'TEST_PRIVATE_HAND',
      sourceCardId: p1WaitingRoomCard.instanceId,
      controllerId: PLAYER1,
      effectText: '公开1张手牌。',
      stepId: 'SELECT_HAND_CARD',
      stepText: '选择要公开的手牌。',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [p1HandCard.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要公开的手牌',
      confirmSelectionLabel: '公开',
      canSkipSelection: true,
      skipSelectionLabel: '不公开',
    };

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);
    const handObjectId = createPublicObjectId(p1HandCard.instanceId);

    expect(player1View.activeEffect?.selectableObjectIds).toEqual([handObjectId]);
    expect(player1View.activeEffect?.selectionLabel).toBe('选择要公开的手牌');
    expect(player1View.activeEffect?.canSkipSelection).toBe(true);
    expect(player1View.activeEffect?.skipSelectionLabel).toBe('不公开');

    expect(player2View.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(player2View.activeEffect?.selectionLabel).toBeUndefined();
    expect(player2View.activeEffect?.canSkipSelection).toBeUndefined();
    expect(player2View.activeEffect?.skipSelectionLabel).toBeUndefined();
  });

  it('activeEffect 未标记但候选牌对当前视角不可见时，也不投影候选数量', () => {
    const { state, p1HandCard, p1WaitingRoomCard } = createProjectedState();
    state.activeEffect = {
      id: 'effect-unmarked-hidden-hand',
      abilityId: 'TEST_UNMARKED_HIDDEN_HAND',
      sourceCardId: p1WaitingRoomCard.instanceId,
      controllerId: PLAYER1,
      effectText: '选择1张手牌。',
      stepId: 'SELECT_HAND_CARD',
      stepText: '选择1张手牌。',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [p1HandCard.instanceId],
      selectionLabel: '选择手牌',
    };

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);
    const handObjectId = createPublicObjectId(p1HandCard.instanceId);

    expect(player1View.activeEffect?.selectableObjectIds).toEqual([handObjectId]);
    expect(player2View.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(player2View.activeEffect?.selectionLabel).toBeUndefined();
  });

  it('activeEffect 公开区候选卡仍会投影给双方', () => {
    const { state, p1WaitingRoomCard } = createProjectedState();
    state.activeEffect = {
      id: 'effect-public-waiting-room',
      abilityId: 'TEST_PUBLIC_WAITING_ROOM',
      sourceCardId: p1WaitingRoomCard.instanceId,
      controllerId: PLAYER1,
      effectText: '选择休息室成员。',
      stepId: 'SELECT_WAITING_ROOM_CARD',
      stepText: '选择休息室成员。',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [p1WaitingRoomCard.instanceId],
      selectionLabel: '选择休息室成员',
    };

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);
    const waitingRoomObjectId = createPublicObjectId(p1WaitingRoomCard.instanceId);

    expect(player1View.activeEffect?.selectableObjectIds).toEqual([waitingRoomObjectId]);
    expect(player2View.activeEffect?.selectableObjectIds).toEqual([waitingRoomObjectId]);
    expect(player2View.activeEffect?.selectionLabel).toBe('选择休息室成员');
  });

  it('activeEffect 已公开的隐藏区卡牌会正面投影给双方，但不暴露原隐藏区列表', () => {
    const { state, p1HandCard, p1WaitingRoomCard } = createProjectedState();
    state.activeEffect = {
      id: 'effect-revealed-hand-card',
      abilityId: 'TEST_REVEALED_HAND_CARD',
      sourceCardId: p1WaitingRoomCard.instanceId,
      controllerId: PLAYER1,
      effectText: '公开1张手牌。',
      stepId: 'REVEAL_HAND_CARD',
      stepText: '已公开手牌。',
      awaitingPlayerId: PLAYER1,
      revealedCardIds: [p1HandCard.instanceId],
    };

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);
    const handObjectId = createPublicObjectId(p1HandCard.instanceId);

    expect(player1View.activeEffect?.revealedObjectIds).toEqual([handObjectId]);
    expect(player2View.activeEffect?.revealedObjectIds).toEqual([handObjectId]);
    expect(player2View.objects[handObjectId]?.surface).toBe('FRONT');
    expect(player2View.objects[handObjectId]?.publiclyRevealed).toBe(true);
    expect(player2View.objects[handObjectId]?.frontInfo?.cardCode).toBe('MEM-001');
    expect(player2View.table.zones.FIRST_HAND.objectIds).toBeUndefined();
  });

  it('保留对手隐藏区张数，但不投影对手手牌对象', () => {
    const { state, p1HandCard } = createProjectedState();

    const player1View = projectPlayerViewState(state, PLAYER1);
    const ownHandObjectId = createPublicObjectId(p1HandCard.instanceId);

    expect(player1View.table.zones.FIRST_HAND.count).toBe(1);
    expect(player1View.table.zones.FIRST_HAND.objectIds).toEqual([ownHandObjectId]);
    expect(player1View.objects[ownHandObjectId]?.surface).toBe('FRONT');

    expect(player1View.table.zones.SECOND_HAND.count).toBe(1);
    expect(player1View.table.zones.SECOND_HAND.objectIds).toBeUndefined();
  });

  it('对手视角中的隐藏私有区只保留摘要，不标记为可按顺序渲染', () => {
    const { state } = createProjectedState();

    const player1View = projectPlayerViewState(state, PLAYER1);

    expect(player1View.table.zones.FIRST_HAND.ordered).toBe(true);
    expect(player1View.table.zones.FIRST_MAIN_DECK.ordered).toBe(true);
    expect(player1View.table.zones.FIRST_ENERGY_DECK.ordered).toBe(true);

    expect(player1View.table.zones.SECOND_HAND.ordered).toBe(false);
    expect(player1View.table.zones.SECOND_MAIN_DECK.ordered).toBe(false);
    expect(player1View.table.zones.SECOND_ENERGY_DECK.ordered).toBe(false);
  });

  it('同一张盖放 Live 对拥有者显示 FRONT，对对手显示 BACK', () => {
    const { state, p1LiveCard } = createProjectedState();

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);
    const liveObjectId = createPublicObjectId(p1LiveCard.instanceId);

    expect(player1View.table.zones.FIRST_LIVE_ZONE.objectIds).toContain(liveObjectId);
    expect(player1View.objects[liveObjectId]?.surface).toBe('FRONT');
    expect(player1View.objects[liveObjectId]?.faceState).toBe(FaceState.FACE_DOWN);

    expect(player2View.table.zones.FIRST_LIVE_ZONE.objectIds).toContain(liveObjectId);
    expect(player2View.objects[liveObjectId]?.surface).toBe('BACK');
    expect(player2View.objects[liveObjectId]?.cardType).toBeUndefined();
    expect(player2View.objects[liveObjectId]?.faceState).toBe(FaceState.FACE_DOWN);
    expect(player2View.objects[liveObjectId]?.frontInfo).toBeUndefined();
  });

  it('检视区对象按座位拆分为 inspection zone，并对对手显示 BACK', () => {
    const { state, p1HandCard } = createProjectedState();
    const mutableState = state as unknown as {
      inspectionZone: { cardIds: string[]; revealedCardIds: string[] };
      inspectionContext: { ownerPlayerId: string; sourceZone: ZoneType.MAIN_DECK } | null;
    };
    mutableState.inspectionZone.cardIds = [p1HandCard.instanceId];
    mutableState.inspectionZone.revealedCardIds = [];
    mutableState.inspectionContext = {
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    };

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);
    const inspectionObjectId = createPublicObjectId(p1HandCard.instanceId);

    expect(player1View.table.zones.FIRST_INSPECTION_ZONE.objectIds).toEqual([inspectionObjectId]);
    expect(player1View.objects[inspectionObjectId]?.surface).toBe('FRONT');

    expect(player2View.table.zones.FIRST_INSPECTION_ZONE.objectIds).toEqual([inspectionObjectId]);
    expect(player2View.objects[inspectionObjectId]?.surface).toBe('BACK');
    expect(player2View.objects[inspectionObjectId]?.cardType).toBeUndefined();
    expect(player2View.objects[inspectionObjectId]?.frontInfo).toBeUndefined();
    expect(player1View.match.window?.windowType).toBe('INSPECTION');
    expect(player1View.match.window?.context?.sourceZone).toBe(ZoneType.MAIN_DECK);
    expect(hasEnabledCommand(player1View, GameCommandType.OPEN_INSPECTION)).toBe(true);
    expect(hasEnabledCommand(player1View, GameCommandType.MOVE_INSPECTED_CARD_TO_TOP)).toBe(true);
  });

  it('检视区已公开的对象对双方都显示 FRONT', () => {
    const { state, p1HandCard } = createProjectedState();
    const mutableState = state as unknown as {
      inspectionZone: { cardIds: string[]; revealedCardIds: string[] };
      inspectionContext: { ownerPlayerId: string; sourceZone: ZoneType.MAIN_DECK } | null;
    };
    mutableState.inspectionZone.cardIds = [p1HandCard.instanceId];
    mutableState.inspectionZone.revealedCardIds = [p1HandCard.instanceId];
    mutableState.inspectionContext = {
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    };

    const player2View = projectPlayerViewState(state, PLAYER2);
    const inspectionObjectId = createPublicObjectId(p1HandCard.instanceId);

    expect(player2View.objects[inspectionObjectId]?.surface).toBe('FRONT');
    expect(player2View.objects[inspectionObjectId]?.frontInfo?.cardCode).toBe('MEM-001');
  });

  it('解决区对象未翻开时对对手显示 BACK，翻开后显示 FRONT', () => {
    const { state, p1MainDeckCard } = createProjectedState();
    const mutableState = state as unknown as {
      resolutionZone: { cardIds: string[]; revealedCardIds: string[] };
    };
    const resolutionObjectId = createPublicObjectId(p1MainDeckCard.instanceId);

    mutableState.resolutionZone.cardIds = [p1MainDeckCard.instanceId];
    mutableState.resolutionZone.revealedCardIds = [];

    const hiddenOwnerView = projectPlayerViewState(state, PLAYER1);
    const hiddenOpponentView = projectPlayerViewState(state, PLAYER2);

    expect(hiddenOwnerView.objects[resolutionObjectId]?.surface).toBe('FRONT');
    expect(hiddenOpponentView.objects[resolutionObjectId]?.surface).toBe('BACK');
    expect(hiddenOpponentView.objects[resolutionObjectId]?.frontInfo).toBeUndefined();

    mutableState.resolutionZone.revealedCardIds = [p1MainDeckCard.instanceId];

    const revealedOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(revealedOpponentView.objects[resolutionObjectId]?.surface).toBe('FRONT');
    expect(revealedOpponentView.objects[resolutionObjectId]?.frontInfo?.cardCode).toBe('MEM-003');
  });

  it('RESULT_SCORE_CONFIRM 期间双方都应拥有分数确认权限', () => {
    const { state } = createProjectedState();
    state.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    state.currentSubPhase = SubPhase.RESULT_SCORE_CONFIRM;
    state.waitingPlayerId = null;

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);

    expect(player1View.permissions.availableCommands.some((hint) => hint.enabled)).toBe(true);
    expect(player2View.permissions.availableCommands.some((hint) => hint.enabled)).toBe(true);
    expect(hasEnabledCommand(player1View, GameCommandType.SUBMIT_SCORE)).toBe(true);
    expect(hasEnabledCommand(player2View, GameCommandType.SUBMIT_SCORE)).toBe(true);
    expect(getCommandHint(player1View, GameCommandType.SELECT_SUCCESS_LIVE)).toBeNull();
    expect(getCommandHint(player2View, GameCommandType.SELECT_SUCCESS_LIVE)).toBeNull();
    expect(player1View.match.window?.windowType).toBe('SIMULTANEOUS_COMMIT');
  });

  it('MAIN_PHASE 和 LIVE_SET_PHASE 的权限列表应暴露新增联机命令', () => {
    const { state } = createProjectedState();

    state.currentPhase = GamePhase.MAIN_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    state.waitingPlayerId = null;
    const mainView = projectPlayerViewState(state, PLAYER1);
    expect(hasEnabledCommand(mainView, GameCommandType.DRAW_ENERGY_TO_ZONE)).toBe(true);
    expect(hasEnabledCommand(mainView, GameCommandType.MOVE_OWNED_CARD_TO_ZONE)).toBe(true);
    expect(hasEnabledCommand(mainView, GameCommandType.MOVE_PUBLIC_CARD_TO_HAND)).toBe(true);
    expect(hasEnabledCommand(mainView, GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK)).toBe(true);

    state.currentPhase = GamePhase.LIVE_SET_PHASE;
    state.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    const liveSetView = projectPlayerViewState(state, PLAYER1);
    expect(hasEnabledCommand(liveSetView, GameCommandType.DRAW_ENERGY_TO_ZONE)).toBe(true);
    expect(hasEnabledCommand(liveSetView, GameCommandType.MOVE_PUBLIC_CARD_TO_HAND)).toBe(true);
    expect(hasEnabledCommand(liveSetView, GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK)).toBe(
      true
    );
  });

  it('主要阶段和表演阶段应向非当前回合玩家暴露 TAP_MEMBER', () => {
    const { state } = createProjectedState();

    state.currentPhase = GamePhase.MAIN_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    state.activePlayerIndex = 0;
    state.waitingPlayerId = null;

    const mainOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(mainOpponentView, GameCommandType.TAP_MEMBER)).toBe(true);

    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;

    const performanceOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(performanceOpponentView, GameCommandType.TAP_MEMBER)).toBe(true);
  });

  it('主阶段和 Live 大阶段应向非当前回合玩家暴露己方自由拖拽命令', () => {
    const { state } = createProjectedState();

    state.activePlayerIndex = 0;
    state.waitingPlayerId = null;

    state.currentPhase = GamePhase.MAIN_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    const mainOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(mainOpponentView, GameCommandType.MOVE_TABLE_CARD)).toBe(true);
    expect(hasEnabledCommand(mainOpponentView, GameCommandType.MOVE_OWNED_CARD_TO_ZONE)).toBe(true);
    expect(hasEnabledCommand(mainOpponentView, GameCommandType.PLAY_MEMBER_TO_SLOT)).toBe(true);
    expect(hasEnabledCommand(mainOpponentView, GameCommandType.OPEN_INSPECTION)).toBe(true);
    expect(hasEnabledCommand(mainOpponentView, GameCommandType.END_PHASE)).toBe(false);

    state.currentPhase = GamePhase.LIVE_SET_PHASE;
    state.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    const liveSetOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(liveSetOpponentView, GameCommandType.MOVE_TABLE_CARD)).toBe(true);
    expect(hasEnabledCommand(liveSetOpponentView, GameCommandType.PLAY_MEMBER_TO_SLOT)).toBe(true);

    state.currentSubPhase = SubPhase.LIVE_SET_FIRST_DRAW;
    const liveSetAutoDrawOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(liveSetAutoDrawOpponentView, GameCommandType.MOVE_TABLE_CARD)).toBe(
      false
    );
    const liveSetAutoDrawActiveView = projectPlayerViewState(state, PLAYER1);
    expect(hasEnabledCommand(liveSetAutoDrawActiveView, GameCommandType.MOVE_TABLE_CARD)).toBe(
      false
    );
    expect(hasEnabledCommand(liveSetAutoDrawActiveView, GameCommandType.PLAY_MEMBER_TO_SLOT)).toBe(
      false
    );

    // PERFORMANCE_REVEAL 是自动化子阶段（requiresUserAction: false），不属于自由拖拽窗口
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_REVEAL;
    const performanceRevealOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(performanceRevealOpponentView, GameCommandType.MOVE_TABLE_CARD)).toBe(
      false
    );
    expect(
      hasEnabledCommand(performanceRevealOpponentView, GameCommandType.PLAY_MEMBER_TO_SLOT)
    ).toBe(false);

    // PERFORMANCE_LIVE_START_EFFECTS 是自由拖拽子阶段
    state.currentSubPhase = SubPhase.PERFORMANCE_LIVE_START_EFFECTS;
    const performanceEffectOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(performanceEffectOpponentView, GameCommandType.MOVE_TABLE_CARD)).toBe(
      true
    );
    expect(
      hasEnabledCommand(performanceEffectOpponentView, GameCommandType.PLAY_MEMBER_TO_SLOT)
    ).toBe(true);

    state.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    state.currentSubPhase = SubPhase.RESULT_SCORE_CONFIRM;
    const liveResultOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(liveResultOpponentView, GameCommandType.MOVE_TABLE_CARD)).toBe(true);
    expect(hasEnabledCommand(liveResultOpponentView, GameCommandType.MOVE_OWNED_CARD_TO_ZONE)).toBe(
      true
    );
  });

  it('成功效果窗口应暴露自由拖拽所需的桌面操作权限', () => {
    const { state } = createProjectedState();

    state.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    state.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    state.waitingPlayerId = null;
    state.liveResolution.performingPlayerId = PLAYER1;

    const successEffectView = projectPlayerViewState(state, PLAYER1);

    expect(hasEnabledCommand(successEffectView, GameCommandType.MOVE_TABLE_CARD)).toBe(true);
    expect(hasEnabledCommand(successEffectView, GameCommandType.MOVE_PUBLIC_CARD_TO_HAND)).toBe(
      true
    );
    expect(
      hasEnabledCommand(successEffectView, GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK)
    ).toBe(true);
    expect(hasEnabledCommand(successEffectView, GameCommandType.DRAW_CARD_TO_HAND)).toBe(true);
    expect(hasEnabledCommand(successEffectView, GameCommandType.OPEN_INSPECTION)).toBe(true);
    expect(hasEnabledCommand(successEffectView, GameCommandType.REVEAL_CHEER_CARD)).toBe(true);
    expect(hasEnabledCommand(successEffectView, GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE)).toBe(
      true
    );
    expect(getCommandHint(successEffectView, GameCommandType.SELECT_SUCCESS_LIVE)).toBeNull();
    expect(hasEnabledCommand(successEffectView, GameCommandType.CONFIRM_STEP)).toBe(true);
  });

  it('表演开始时效果窗口应暴露自由拖拽所需的桌面操作权限', () => {
    const { state } = createProjectedState();

    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_LIVE_START_EFFECTS;
    state.waitingPlayerId = null;
    state.liveResolution.performingPlayerId = PLAYER1;

    const performanceStartView = projectPlayerViewState(state, PLAYER1);

    expect(hasEnabledCommand(performanceStartView, GameCommandType.MOVE_TABLE_CARD)).toBe(true);
    expect(hasEnabledCommand(performanceStartView, GameCommandType.MOVE_PUBLIC_CARD_TO_HAND)).toBe(
      true
    );
    expect(
      hasEnabledCommand(performanceStartView, GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK)
    ).toBe(true);
    expect(
      hasEnabledCommand(performanceStartView, GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM)
    ).toBe(true);
    expect(hasEnabledCommand(performanceStartView, GameCommandType.MOVE_OWNED_CARD_TO_ZONE)).toBe(
      true
    );
    expect(hasEnabledCommand(performanceStartView, GameCommandType.DRAW_ENERGY_TO_ZONE)).toBe(true);
    expect(hasEnabledCommand(performanceStartView, GameCommandType.CONFIRM_STEP)).toBe(true);
  });

  it('判定阶段的成功效果本地窗口应暴露自由拖拽、成功 Live 选择与判定提交通道', () => {
    const { state } = createProjectedState();

    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    state.waitingPlayerId = null;
    state.liveResolution.performingPlayerId = PLAYER1;

    const performanceView = projectPlayerViewState(state, PLAYER1);

    expect(hasEnabledCommand(performanceView, GameCommandType.MOVE_TABLE_CARD)).toBe(true);
    expect(hasEnabledCommand(performanceView, GameCommandType.PLAY_MEMBER_TO_SLOT)).toBe(true);
    expect(hasEnabledCommand(performanceView, GameCommandType.MOVE_PUBLIC_CARD_TO_HAND)).toBe(true);
    expect(
      hasEnabledCommand(performanceView, GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK)
    ).toBe(true);
    expect(hasEnabledCommand(performanceView, GameCommandType.SELECT_SUCCESS_LIVE)).toBe(true);
    expect(hasEnabledCommand(performanceView, GameCommandType.CONFIRM_PERFORMANCE_OUTCOME)).toBe(
      true
    );
  });

  it('应投影此 Live 卡分数修正，供判定窗口显示修正后的单卡分数', () => {
    const { state, p1LiveCard } = createProjectedState();
    state.liveResolution.liveModifiers = [
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        liveCardId: p1LiveCard.instanceId,
        countDelta: 1,
      },
    ];

    const view = projectPlayerViewState(state, PLAYER1);

    expect(
      view.match.liveResult?.liveCardScoreModifiers[createPublicObjectId(p1LiveCard.instanceId)]
    ).toBe(1);
  });

  it('应投影玩家 Live 合计分数修正，供判定窗口显示卡牌效果加分', () => {
    const { state } = createProjectedState();
    state.liveResolution.liveModifiers = [
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        sourceCardId: 'score-source',
      },
    ];

    const view = projectPlayerViewState(state, PLAYER1);

    expect(view.match.liveResult?.scoreModifiers.FIRST).toBe(1);
    expect(view.match.liveResult?.scoreModifiers.SECOND).toBe(0);
  });

  it('RESULT_SETTLEMENT 期间仅胜者拥有成功 Live 选择与结算确认权限', () => {
    const { state } = createProjectedState();
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      waitingPlayerId: string | null;
      liveResolution: { liveWinnerIds: string[] };
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_SETTLEMENT;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.liveWinnerIds = [PLAYER1];

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);

    expect(hasEnabledCommand(player1View, GameCommandType.SELECT_SUCCESS_LIVE)).toBe(true);
    expect(hasEnabledCommand(player1View, GameCommandType.CONFIRM_STEP)).toBe(true);
    expect(getCommandHint(player1View, GameCommandType.CONFIRM_STEP)?.reason).toBeUndefined();
    expect(hasEnabledCommand(player2View, GameCommandType.SELECT_SUCCESS_LIVE)).toBe(false);
    expect(getCommandHint(player2View, GameCommandType.SELECT_SUCCESS_LIVE)).toBeNull();
  });

  it('表演判定中打开检视后，仍保留应援与解决区操作权限', () => {
    const { state, p1MainDeckCard } = createProjectedState();
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      waitingPlayerId: string | null;
      inspectionZone: { cardIds: string[]; revealedCardIds: string[] };
      inspectionContext: { ownerPlayerId: string; sourceZone: ZoneType.MAIN_DECK } | null;
      liveResolution: { performingPlayerId: string | null };
    };
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.performingPlayerId = PLAYER1;
    mutableState.inspectionZone.cardIds = [p1MainDeckCard.instanceId];
    mutableState.inspectionZone.revealedCardIds = [];
    mutableState.inspectionContext = {
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    };

    const performanceInspectionView = projectPlayerViewState(state, PLAYER1);

    expect(performanceInspectionView.match.window?.windowType).toBe('INSPECTION');
    expect(hasEnabledCommand(performanceInspectionView, GameCommandType.OPEN_INSPECTION)).toBe(
      true
    );
    expect(hasEnabledCommand(performanceInspectionView, GameCommandType.REVEAL_CHEER_CARD)).toBe(
      true
    );
    expect(
      hasEnabledCommand(performanceInspectionView, GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE)
    ).toBe(true);
  });

  it('自由拖拽窗口期间非当前回合玩家应拥有 OPEN_INSPECTION 权限', () => {
    const { state } = createProjectedState();

    state.activePlayerIndex = 0;
    state.waitingPlayerId = null;

    // 主阶段
    state.currentPhase = GamePhase.MAIN_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    const mainOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(mainOpponentView, GameCommandType.OPEN_INSPECTION)).toBe(true);
    const mainActiveView = projectPlayerViewState(state, PLAYER1);
    expect(hasEnabledCommand(mainActiveView, GameCommandType.OPEN_INSPECTION)).toBe(true);

    // 表演阶段（自由拖拽子阶段）
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_LIVE_START_EFFECTS;
    const performanceOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(performanceOpponentView, GameCommandType.OPEN_INSPECTION)).toBe(true);

    // Live 设置阶段（自由拖拽子阶段）
    state.currentPhase = GamePhase.LIVE_SET_PHASE;
    state.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    const liveSetOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(liveSetOpponentView, GameCommandType.OPEN_INSPECTION)).toBe(true);

    // Live 结果阶段（成功效果子阶段）
    state.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    state.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    const liveResultOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(liveResultOpponentView, GameCommandType.OPEN_INSPECTION)).toBe(true);

    // 非自由拖拽窗口：抽卡阶段不应有检视权限
    state.currentPhase = GamePhase.DRAW_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    const drawPhaseView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(drawPhaseView, GameCommandType.OPEN_INSPECTION)).toBe(false);

    // 非自由拖拽窗口：RESULT_TURN_END 是自动化子阶段，不应有检视权限
    state.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    state.currentSubPhase = SubPhase.RESULT_TURN_END;
    const turnEndView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(turnEndView, GameCommandType.OPEN_INSPECTION)).toBe(false);

    // 非自由拖拽窗口：PERFORMANCE_REVEAL 是自动化子阶段，不应有检视权限
    state.currentPhase = GamePhase.PERFORMANCE_PHASE;
    state.currentSubPhase = SubPhase.PERFORMANCE_REVEAL;
    const revealView = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(revealView, GameCommandType.OPEN_INSPECTION)).toBe(false);
  });

  it('一方检视期间另一方不应看到 OPEN_INSPECTION 为可用', () => {
    const { state, p1HandCard } = createProjectedState();
    const mutableState = state as unknown as {
      inspectionZone: { cardIds: string[]; revealedCardIds: string[] };
      inspectionContext: { ownerPlayerId: string; sourceZone: ZoneType.MAIN_DECK } | null;
      activePlayerIndex: number;
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
    };
    mutableState.activePlayerIndex = 0;
    mutableState.currentPhase = GamePhase.MAIN_PHASE;
    mutableState.currentSubPhase = SubPhase.NONE;

    // PLAYER1 开启检视
    mutableState.inspectionZone.cardIds = [p1HandCard.instanceId];
    mutableState.inspectionZone.revealedCardIds = [];
    mutableState.inspectionContext = {
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    };

    // PLAYER2（非检视所有者）不应看到 OPEN_INSPECTION 为可用
    const player2View = projectPlayerViewState(state, PLAYER2);
    expect(hasEnabledCommand(player2View, GameCommandType.OPEN_INSPECTION)).toBe(false);

    // PLAYER1（检视所有者）应看到检视专用 OPEN_INSPECTION 提示
    const player1View = projectPlayerViewState(state, PLAYER1);
    expect(hasEnabledCommand(player1View, GameCommandType.OPEN_INSPECTION)).toBe(true);

    // PLAYER2 在检视期间仍可使用其他自由拖拽命令
    expect(hasEnabledCommand(player2View, GameCommandType.MOVE_TABLE_CARD)).toBe(true);
    expect(hasEnabledCommand(player2View, GameCommandType.TAP_MEMBER)).toBe(true);
  });
});
