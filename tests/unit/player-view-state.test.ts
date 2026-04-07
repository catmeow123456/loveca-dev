import { describe, expect, it } from 'vitest';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';
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
    p2MainDeckCard,
    p1EnergyDeckCard,
    p2EnergyDeckCard,
  ]);

  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: addCardToZone(player.hand, p1HandCard.instanceId),
    mainDeck: addCardToZone(player.mainDeck, p1MainDeckCard.instanceId),
    energyDeck: addCardToZone(player.energyDeck, p1EnergyDeckCard.instanceId),
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

  return { state, p1HandCard, p2HandCard, p1LiveCard, p1MainDeckCard, p2MainDeckCard };
}

describe('PlayerViewState projector', () => {
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
    expect(player1View.match.window?.type).toBe('INSPECTION');
    expect(player1View.permissions.availableActionTypes).toContain('MOVE_INSPECTED_CARD_TO_TOP');
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

  it('RESULT_SETTLEMENT 期间双方都应拥有分数确认权限', () => {
    const { state } = createProjectedState();
    state.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    state.currentSubPhase = SubPhase.RESULT_SETTLEMENT;
    state.waitingPlayerId = null;

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);

    expect(player1View.permissions.canAct).toBe(true);
    expect(player2View.permissions.canAct).toBe(true);
    expect(player1View.permissions.availableActionTypes).toContain('SUBMIT_SCORE');
    expect(player2View.permissions.availableActionTypes).toContain('SUBMIT_SCORE');
    expect(player1View.permissions.availableActionTypes).not.toContain('SELECT_SUCCESS_LIVE');
    expect(player2View.permissions.availableActionTypes).not.toContain('SELECT_SUCCESS_LIVE');
    expect(player1View.match.window?.type).toBe('RESULT');
  });

  it('MAIN_PHASE 和 LIVE_SET_PHASE 的权限列表应暴露新增联机命令', () => {
    const { state } = createProjectedState();

    state.currentPhase = GamePhase.MAIN_PHASE;
    state.currentSubPhase = SubPhase.NONE;
    state.waitingPlayerId = null;
    const mainView = projectPlayerViewState(state, PLAYER1);
    expect(mainView.permissions.availableActionTypes).toContain('DRAW_ENERGY_TO_ZONE');

    state.currentPhase = GamePhase.LIVE_SET_PHASE;
    state.currentSubPhase = SubPhase.LIVE_SET_FIRST_PLAYER;
    const liveSetView = projectPlayerViewState(state, PLAYER1);
    expect(liveSetView.permissions.availableActionTypes).toContain('MOVE_PUBLIC_CARD_TO_HAND');
  });
});
