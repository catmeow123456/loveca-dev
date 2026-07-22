import { describe, expect, it } from 'vitest';
import {
  CardType,
  FaceState,
  GamePhase,
  GameMode,
  HeartColor,
  SlotPosition,
  SubPhase,
  ZoneType,
} from '../../src/shared/types/enums';
import { GameCommandType } from '../../src/application/game-commands';
import {
  createCardInstance,
  createDefaultCardState,
  createFaceDownCardState,
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type LiveModifierState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
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

function createTestLiveWithGroup(cardCode: string, name: string, groupNames: string): LiveCardData {
  return {
    ...createTestLive(cardCode, name),
    groupNames: [groupNames],
  };
}

function createTestEnergy(cardCode: string, name: string): EnergyCardData {
  return {
    cardCode,
    name,
    cardType: CardType.ENERGY,
  };
}

function createLanzhuHiddenLiveModifierState(): {
  readonly state: ReturnType<typeof createGameState>;
  readonly lanzhuId: string;
} {
  const lanzhu = createCardInstance(
    {
      cardCode: 'PL!N-bp1-012-SEC',
      name: '鐘 嵐珠',
      groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
      cardType: CardType.MEMBER,
      cost: 15,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    PLAYER1,
    'p1-lanzhu-hidden-live'
  );
  const liveCards = [
    createCardInstance(
      createTestLiveWithGroup(
        'PL!N-TEST-LIVE-001',
        '虹ヶ咲 Live',
        '虹ヶ咲学園スクールアイドル同好会'
      ),
      PLAYER1,
      'p1-lanzhu-nijigasaki-live'
    ),
    createCardInstance(
      createTestLiveWithGroup('PL!A-TEST-LIVE-001', 'Aqours Live', 'Aqours'),
      PLAYER1,
      'p1-lanzhu-aqours-live'
    ),
    createCardInstance(
      createTestLiveWithGroup('PL!L-TEST-LIVE-001', 'Liella Live', 'Liella!'),
      PLAYER1,
      'p1-lanzhu-liella-live'
    ),
  ];

  let state = createGameState('lanzhu-hidden-live-modifier', PLAYER1, '玩家1', PLAYER2, '玩家2');
  state = registerCards(state, [lanzhu, ...liveCards]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: lanzhu.instanceId,
      },
      cardStates: new Map([[lanzhu.instanceId, createDefaultCardState()]]),
    },
    liveZone: liveCards.reduce(
      (zone, live) => addCardToStatefulZone(zone, live.instanceId, createFaceDownCardState()),
      player.liveZone
    ),
  }));

  return { state, lanzhuId: lanzhu.instanceId };
}

function revealPlayerLiveZone(
  state: ReturnType<typeof createGameState>,
  playerId: string
): ReturnType<typeof createGameState> {
  return updatePlayer(state, playerId, (player) => {
    const cardStates = new Map(player.liveZone.cardStates);
    for (const cardId of player.liveZone.cardIds) {
      const currentState = cardStates.get(cardId) ?? createDefaultCardState();
      cardStates.set(cardId, { ...currentState, face: FaceState.FACE_UP });
    }
    return {
      ...player,
      liveZone: {
        ...player.liveZone,
        cardStates,
      },
    };
  });
}

function revealLiveCard(state: GameState, playerId: string, cardId: string): GameState {
  return updatePlayer(state, playerId, (player) => {
    const cardStates = new Map(player.liveZone.cardStates);
    const currentState = cardStates.get(cardId) ?? createDefaultCardState();
    cardStates.set(cardId, { ...currentState, face: FaceState.FACE_UP });
    return {
      ...player,
      liveZone: {
        ...player.liveZone,
        cardStates,
      },
    };
  });
}

function createHiddenLiveDependentMemberState(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly liveData: LiveCardData;
}): { readonly state: GameState; readonly sourceId: string; readonly liveId: string } {
  const source = createCardInstance(
    {
      ...createTestMember(options.sourceCardCode, options.sourceName),
      cost: options.sourceCardCode === 'PL!SP-bp5-012-N' ? 2 : 15,
    },
    PLAYER1,
    `${options.sourceCardCode}-hidden-source`
  );
  const live = createCardInstance(
    options.liveData,
    PLAYER1,
    `${options.sourceCardCode}-hidden-live`
  );
  let state = registerCards(
    createGameState(`${options.sourceCardCode}-visibility`, PLAYER1, '玩家1', PLAYER2, '玩家2'),
    [source, live]
  );
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: source.instanceId,
      },
      cardStates: new Map([[source.instanceId, createDefaultCardState()]]),
    },
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, createFaceDownCardState()),
  }));
  return { state, sourceId: source.instanceId, liveId: live.instanceId };
}

function createOpponentLiveRequirementVisibilityState(options: {
  readonly sourceCardCode: 'PL!SP-bp2-010-R+' | 'PL!S-bp5-010-N' | 'PL!S-bp5-011-N';
  readonly heartColor: HeartColor;
  readonly heartCount: number;
}): { readonly state: GameState; readonly targetLiveId: string } {
  const source = createCardInstance(
    {
      cardCode: options.sourceCardCode,
      name:
        options.sourceCardCode === 'PL!S-bp5-010-N'
          ? '高海千歌'
          : options.sourceCardCode === 'PL!S-bp5-011-N'
            ? '櫻内梨子'
            : 'ウィーン・マルガレーテ',
      cardType: CardType.MEMBER,
      cost: options.sourceCardCode.startsWith('PL!S-') ? 4 : 15,
      blade: 1,
      hearts: [createHeartIcon(options.heartColor, options.heartCount)],
    },
    PLAYER1,
    `${options.sourceCardCode}-requirement-source`
  );
  const targetLive = createCardInstance(
    createTestLive('PL!TEST-OPPONENT-HIDDEN-LIVE', '对方盖放LIVE'),
    PLAYER2,
    `${options.sourceCardCode}-opponent-live`
  );
  let state = registerCards(
    createGameState(
      `${options.sourceCardCode}-opponent-visibility`,
      PLAYER1,
      '玩家1',
      PLAYER2,
      '玩家2'
    ),
    [source, targetLive]
  );
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: source.instanceId,
      },
      cardStates: new Map([[source.instanceId, createDefaultCardState()]]),
    },
  }));
  state = updatePlayer(state, PLAYER2, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(
      player.liveZone,
      targetLive.instanceId,
      createFaceDownCardState()
    ),
  }));
  return { state, targetLiveId: targetLive.instanceId };
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
  state = { ...state, manualOperationMode: 'FREE' };

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
  it('projects numericInput max for active effect number entry', () => {
    const { state } = createProjectedState();
    const view = projectPlayerViewState(
      {
        ...state,
        activeEffect: {
          id: 'numeric-effect',
          abilityId: 'test:numeric-input-max',
          sourceCardId: 'p1-live-card',
          controllerId: PLAYER1,
          effectText: '测试数字输入',
          stepId: 'CHOOSE_NUMBER',
          stepText: '选择数字',
          awaitingPlayerId: PLAYER1,
          numericInput: {
            min: 0,
            max: 4,
            integerOnly: true,
            label: '选择数量',
            placeholder: '0',
            confirmLabel: '确认',
          },
        },
      },
      PLAYER1
    );

    expect(view.activeEffect?.numericInput).toMatchObject({
      min: 0,
      max: 4,
      integerOnly: true,
      label: '选择数量',
    });
  });

  it('projects TARGET_MEMBER Heart modifiers into staged member frontInfo for judgment preview', () => {
    let { state } = createProjectedState();
    const sourceMember = createCardInstance(
      createTestMember('PL!HS-bp5-003-AR', '大泽瑠璃乃'),
      PLAYER1,
      'p1-rurino'
    );
    const targetMember = createCardInstance(
      createTestMember('PL!-bp5-005-AR', '星空凛'),
      PLAYER1,
      'p1-target-muse'
    );
    state = registerCards(state, [sourceMember, targetMember]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: targetMember.instanceId,
          [SlotPosition.CENTER]: sourceMember.instanceId,
        },
        cardStates: new Map([
          [targetMember.instanceId, createDefaultCardState()],
          [sourceMember.instanceId, createDefaultCardState()],
        ]),
      },
    }));
    state = addLiveModifier(state, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: targetMember.instanceId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      sourceCardId: sourceMember.instanceId,
      abilityId: 'PL!HS-bp5-003:live-start-discard-same-group-member-heart',
    });

    const view = projectPlayerViewState(state, PLAYER1);
    const targetObject = view.objects[createPublicObjectId(targetMember.instanceId)];

    expect(targetObject?.frontInfo?.cardType).toBe(CardType.MEMBER);
    expect(targetObject?.frontInfo?.hearts).toEqual([
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.PINK, count: 1 },
    ]);
    expect(targetObject?.frontInfo?.modifierDelta).toEqual({
      heartDeltas: [{ color: HeartColor.PINK, count: 1 }],
    });
    expect(view.match.liveResult?.heartBonuses.FIRST).toEqual([]);
  });

  it('projects SOURCE_MEMBER Heart modifier deltas on the source staged member only', () => {
    let { state } = createProjectedState();
    const sourceMember = createCardInstance(
      createTestMember('MEM-SOURCE-HEART', '加心成员'),
      PLAYER1,
      'p1-source-heart'
    );
    state = registerCards(state, [sourceMember]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: sourceMember.instanceId,
        },
        cardStates: new Map([[sourceMember.instanceId, createDefaultCardState()]]),
      },
    }));
    state = addLiveModifier(state, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
      sourceCardId: sourceMember.instanceId,
      abilityId: 'test-source-member-heart',
    });

    const view = projectPlayerViewState(state, PLAYER1);
    const sourceObject = view.objects[createPublicObjectId(sourceMember.instanceId)];

    expect(sourceObject?.frontInfo?.hearts).toEqual([
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.BLUE, count: 1 },
    ]);
    expect(sourceObject?.frontInfo?.modifierDelta).toEqual({
      heartDeltas: [{ color: HeartColor.BLUE, count: 1 }],
    });
  });

  it('projects original Heart replacement as signed modifier deltas', () => {
    let { state } = createProjectedState();
    const member = createCardInstance(
      {
        ...createTestMember('PL!N-bp3-014-R', '中须霞'),
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      },
      PLAYER1,
      'p1-original-heart-replacement'
    );
    state = registerCards(state, [member]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: member.instanceId,
        },
        cardStates: new Map([[member.instanceId, createDefaultCardState()]]),
      },
    }));
    state = addLiveModifier(state, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: PLAYER1,
      memberCardId: member.instanceId,
      color: HeartColor.GREEN,
      sourceCardId: member.instanceId,
      abilityId: 'PL!N-bp3-014:live-start-replace-original-heart-color',
    });

    const view = projectPlayerViewState(state, PLAYER1);
    const memberObject = view.objects[createPublicObjectId(member.instanceId)];

    expect(memberObject?.frontInfo?.hearts).toEqual([{ color: HeartColor.GREEN, count: 1 }]);
    expect(memberObject?.frontInfo?.modifierDelta?.heartDeltas).toHaveLength(2);
    expect(memberObject?.frontInfo?.modifierDelta?.heartDeltas).toEqual(
      expect.arrayContaining([
        { color: HeartColor.GREEN, count: 1 },
        { color: HeartColor.YELLOW, count: -1 },
      ])
    );
  });

  it('projects BLADE modifier delta without changing printed card data', () => {
    let { state } = createProjectedState();
    const sourceMember = createCardInstance(
      createTestMember('MEM-SOURCE-BLADE', '加刃成员'),
      PLAYER1,
      'p1-source-blade'
    );
    state = registerCards(state, [sourceMember]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: sourceMember.instanceId,
        },
        cardStates: new Map([[sourceMember.instanceId, createDefaultCardState()]]),
      },
    }));
    state = addLiveModifier(state, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: sourceMember.instanceId,
      abilityId: 'test-source-member-blade',
    });

    const view = projectPlayerViewState(state, PLAYER1);
    const sourceObject = view.objects[createPublicObjectId(sourceMember.instanceId)];

    expect(sourceObject?.frontInfo?.modifierDelta).toEqual({ bladeDelta: 2 });
    expect(sourceObject?.frontInfo?.hearts).toEqual([{ color: HeartColor.PINK, count: 1 }]);
  });

  it('projects negative BLADE modifier delta on staged member frontInfo', () => {
    let { state } = createProjectedState();
    const sourceMember = createCardInstance(
      {
        ...createTestMember('MEM-SOURCE-NEGATIVE-BLADE', '减刃成员'),
        blade: 5,
      },
      PLAYER1,
      'p1-source-negative-blade'
    );
    state = registerCards(state, [sourceMember]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: sourceMember.instanceId,
        },
        cardStates: new Map([[sourceMember.instanceId, createDefaultCardState()]]),
      },
    }));
    state = addLiveModifier(state, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: PLAYER1,
      memberCardId: sourceMember.instanceId,
      count: 3,
      sourceCardId: sourceMember.instanceId,
      abilityId: 'test-source-member-original-blade-replacement',
    });

    const view = projectPlayerViewState(state, PLAYER1);
    const sourceObject = view.objects[createPublicObjectId(sourceMember.instanceId)];

    expect(sourceObject?.frontInfo?.modifierDelta).toEqual({ bladeDelta: -2 });
  });

  it('projects signed COST modifier deltas on staged member frontInfo', () => {
    let { state } = createProjectedState();
    const increasedCostMember = createCardInstance(
      createTestMember('MEM-COST-INCREASE', '费用上升成员'),
      PLAYER1,
      'p1-cost-increase'
    );
    const reducedCostMember = createCardInstance(
      createTestMember('MEM-COST-REDUCE', '费用下降成员'),
      PLAYER1,
      'p1-cost-reduce'
    );
    state = registerCards(state, [increasedCostMember, reducedCostMember]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: increasedCostMember.instanceId,
          [SlotPosition.CENTER]: reducedCostMember.instanceId,
        },
        cardStates: new Map([
          [increasedCostMember.instanceId, createDefaultCardState()],
          [reducedCostMember.instanceId, createDefaultCardState()],
        ]),
      },
    }));
    state = addLiveModifier(state, {
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: increasedCostMember.instanceId,
      countDelta: 3,
      sourceCardId: increasedCostMember.instanceId,
      abilityId: 'test-member-cost-increase',
    });
    state = addLiveModifier(state, {
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: reducedCostMember.instanceId,
      countDelta: -1,
      sourceCardId: reducedCostMember.instanceId,
      abilityId: 'test-member-cost-reduce',
    });

    const view = projectPlayerViewState(state, PLAYER1);
    const increasedCostObject = view.objects[createPublicObjectId(increasedCostMember.instanceId)];
    const reducedCostObject = view.objects[createPublicObjectId(reducedCostMember.instanceId)];

    expect(increasedCostObject?.frontInfo?.modifierDelta).toEqual({ costDelta: 3 });
    expect(reducedCostObject?.frontInfo?.modifierDelta).toEqual({ costDelta: -1 });
  });

  it('omits member modifier delta when staged member has no cost, BLADE, or Heart delta', () => {
    let { state } = createProjectedState();
    const member = createCardInstance(
      createTestMember('MEM-NO-MODIFIER', '无修正成员'),
      PLAYER1,
      'p1-no-modifier'
    );
    state = registerCards(state, [member]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: member.instanceId,
        },
        cardStates: new Map([[member.instanceId, createDefaultCardState()]]),
      },
    }));

    const view = projectPlayerViewState(state, PLAYER1);
    const memberObject = view.objects[createPublicObjectId(member.instanceId)];

    expect(memberObject?.frontInfo?.modifierDelta).toBeUndefined();
  });

  it('projects public staged member modifier deltas to opponent view without exposing hidden cards', () => {
    let { state, p1HandCard } = createProjectedState();
    const targetMember = createCardInstance(
      createTestMember('MEM-PUBLIC-DELTA', '公开修正成员'),
      PLAYER1,
      'p1-public-delta'
    );
    state = registerCards(state, [targetMember]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: targetMember.instanceId,
        },
        cardStates: new Map([[targetMember.instanceId, createDefaultCardState()]]),
      },
    }));
    state = addLiveModifier(state, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: targetMember.instanceId,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
      sourceCardId: 'test-public-delta-source',
      abilityId: 'test-public-delta',
    });

    const opponentView = projectPlayerViewState(state, PLAYER2);
    const targetObject = opponentView.objects[createPublicObjectId(targetMember.instanceId)];
    const hiddenHandObject = opponentView.objects[createPublicObjectId(p1HandCard.instanceId)];

    expect(targetObject?.frontInfo?.modifierDelta).toEqual({
      heartDeltas: [{ color: HeartColor.GREEN, count: 1 }],
    });
    expect(hiddenHandObject).toBeUndefined();
    expect(opponentView.table.zones.FIRST_HAND.objectIds).toBeUndefined();
  });

  it('hides PL!N-bp1-012 hidden live-zone dependent modifiers from opponent view until reveal', () => {
    let { state, lanzhuId } = createLanzhuHiddenLiveModifierState();
    const lanzhuObjectId = createPublicObjectId(lanzhuId);

    const ownerView = projectPlayerViewState(state, PLAYER1);
    const hiddenOpponentView = projectPlayerViewState(state, PLAYER2);

    expect(ownerView.objects[lanzhuObjectId]?.frontInfo?.modifierDelta).toEqual({
      bladeDelta: 2,
      heartDeltas: [{ color: HeartColor.RAINBOW, count: 2 }],
    });
    expect(ownerView.objects[lanzhuObjectId]?.frontInfo?.hearts).toEqual([
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.RAINBOW, count: 2 },
    ]);

    expect(hiddenOpponentView.objects[lanzhuObjectId]?.frontInfo?.modifierDelta).toBeUndefined();
    expect(hiddenOpponentView.objects[lanzhuObjectId]?.frontInfo?.hearts).toEqual([
      { color: HeartColor.PINK, count: 1 },
    ]);

    const firstLiveCardId = state.players[0]?.liveZone.cardIds[0];
    expect(firstLiveCardId).toBeDefined();
    state = revealLiveCard(state, PLAYER1, firstLiveCardId!);
    const partiallyRevealedOpponentView = projectPlayerViewState(state, PLAYER2);
    expect(
      partiallyRevealedOpponentView.objects[lanzhuObjectId]?.frontInfo?.modifierDelta
    ).toBeUndefined();

    state = revealPlayerLiveZone(state, PLAYER1);
    const revealedOpponentView = projectPlayerViewState(state, PLAYER2);

    expect(revealedOpponentView.objects[lanzhuObjectId]?.frontInfo?.modifierDelta).toEqual({
      bladeDelta: 2,
      heartDeltas: [{ color: HeartColor.RAINBOW, count: 2 }],
    });
  });

  it('keeps public modifiers visible when only hidden live-zone dependent modifiers are filtered', () => {
    let { state, lanzhuId } = createLanzhuHiddenLiveModifierState();
    state = addLiveModifier(state, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: lanzhuId,
      abilityId: 'test-public-blade-during-live-set',
    });

    const opponentView = projectPlayerViewState(state, PLAYER2);
    const lanzhuObject = opponentView.objects[createPublicObjectId(lanzhuId)];

    expect(lanzhuObject?.frontInfo?.modifierDelta).toEqual({ bladeDelta: 1 });
    expect(lanzhuObject?.frontInfo?.hearts).toEqual([{ color: HeartColor.PINK, count: 1 }]);
  });

  it.each([
    {
      label: 'PL!-bp4-002 费用15「绚濑绘里」',
      sourceCardCode: 'PL!-bp4-002-R+',
      sourceName: '絢瀬絵里',
      liveData: createTestLive('PL!TEST-NO-LIVE-TIMING', '无LIVE开始成功能力'),
      expectedHeart: { color: HeartColor.PURPLE, count: 2 },
    },
    {
      label: 'PL!N-pb1-007 费用15「优木雪菜」',
      sourceCardCode: 'PL!N-pb1-007-R',
      sourceName: '優木せつ菜',
      liveData: {
        ...createTestLive('PL!TEST-SIX-COLOR-REQUIREMENT', '六色必要Heart LIVE'),
        requirements: createHeartRequirement({
          [HeartColor.PINK]: 1,
          [HeartColor.RED]: 1,
          [HeartColor.YELLOW]: 1,
          [HeartColor.GREEN]: 1,
          [HeartColor.BLUE]: 1,
          [HeartColor.PURPLE]: 1,
        }),
      },
      expectedHeart: { color: HeartColor.RAINBOW, count: 1 },
    },
    {
      label: 'PL!SP-bp5-012-N 费用2「涩谷香音」',
      sourceCardCode: 'PL!SP-bp5-012-N',
      sourceName: '澁谷かのん',
      liveData: {
        ...createTestLiveWithGroup('PL!TEST-LIELLA-EIGHT', 'Liella! 8 Heart LIVE', 'Liella!'),
        requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 8 }),
      },
      expectedHeart: { color: HeartColor.YELLOW, count: 1 },
    },
  ])(
    'hides $label continuous member Hearts while its own LIVE contents are face down',
    (testCase) => {
      let { state, sourceId } = createHiddenLiveDependentMemberState(testCase);
      const sourceObjectId = createPublicObjectId(sourceId);

      expect(
        projectPlayerViewState(state, PLAYER1).objects[sourceObjectId]?.frontInfo?.modifierDelta
      ).toEqual({ heartDeltas: [testCase.expectedHeart] });
      expect(
        projectPlayerViewState(state, PLAYER2).objects[sourceObjectId]?.frontInfo?.modifierDelta
      ).toBeUndefined();

      state = revealPlayerLiveZone(state, PLAYER1);
      expect(
        projectPlayerViewState(state, PLAYER2).objects[sourceObjectId]?.frontInfo?.modifierDelta
      ).toEqual({ heartDeltas: [testCase.expectedHeart] });
    }
  );

  it('hides PL!SP-bp2-010 费用15「薇恩・玛格丽特」 requirement targets from the source controller, while the target owner and authority remain correct', () => {
    let { state, targetLiveId } = createOpponentLiveRequirementVisibilityState({
      sourceCardCode: 'PL!SP-bp2-010-R+',
      heartColor: HeartColor.PURPLE,
      heartCount: 1,
    });
    state = addLiveModifier(state, {
      kind: 'REQUIREMENT',
      liveCardId: targetLiveId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: 2 }],
      sourceCardId: 'public-requirement-source',
      abilityId: 'test-public-requirement',
    });
    const targetObjectId = createPublicObjectId(targetLiveId);

    expect(
      projectPlayerViewState(state, PLAYER1).match.liveResult?.requirementModifiers[targetObjectId]
    ).toEqual([{ color: HeartColor.RAINBOW, countDelta: 2 }]);
    expect(
      projectPlayerViewState(state, PLAYER2).match.liveResult?.requirementModifiers[targetObjectId]
    ).toEqual([
      { color: HeartColor.RAINBOW, countDelta: 2 },
      { color: HeartColor.RAINBOW, countDelta: 1 },
    ]);

    state = revealPlayerLiveZone(state, PLAYER2);
    expect(
      projectPlayerViewState(state, PLAYER1).match.liveResult?.requirementModifiers[targetObjectId]
    ).toEqual([
      { color: HeartColor.RAINBOW, countDelta: 2 },
      { color: HeartColor.RAINBOW, countDelta: 1 },
    ]);
  });

  it.each([
    ['PL!S-bp5-010-N' as const, HeartColor.RED, '费用4「高海千歌」'],
    ['PL!S-bp5-011-N' as const, HeartColor.BLUE, '费用4「樱内梨子」'],
  ])(
    'hides %s opponent-LIVE requirement selection from the source controller until reveal',
    (sourceCardCode, heartColor) => {
      let { state, targetLiveId } = createOpponentLiveRequirementVisibilityState({
        sourceCardCode,
        heartColor,
        heartCount: 5,
      });
      const targetObjectId = createPublicObjectId(targetLiveId);

      expect(
        projectPlayerViewState(state, PLAYER1).match.liveResult?.requirementModifiers[
          targetObjectId
        ]
      ).toBeUndefined();
      expect(
        projectPlayerViewState(state, PLAYER2).match.liveResult?.requirementModifiers[
          targetObjectId
        ]
      ).toEqual([{ color: HeartColor.RAINBOW, countDelta: 1 }]);

      state = revealPlayerLiveZone(state, PLAYER2);
      expect(
        projectPlayerViewState(state, PLAYER1).match.liveResult?.requirementModifiers[
          targetObjectId
        ]
      ).toEqual([{ color: HeartColor.RAINBOW, countDelta: 1 }]);
    }
  );

  it('keeps legacy player Heart bonuses in liveResult without mixing member Hearts', () => {
    let { state } = createProjectedState();
    const sourceMember = createCardInstance(
      createTestMember('PL!HS-bp5-003-AR', '大泽瑠璃乃'),
      PLAYER1,
      'p1-rurino'
    );
    const targetMember = createCardInstance(
      createTestMember('PL!-bp5-005-AR', '星空凛'),
      PLAYER1,
      'p1-target-muse'
    );
    state = registerCards(state, [sourceMember, targetMember]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: targetMember.instanceId,
          [SlotPosition.CENTER]: sourceMember.instanceId,
        },
        cardStates: new Map([
          [targetMember.instanceId, createDefaultCardState()],
          [sourceMember.instanceId, createDefaultCardState()],
        ]),
      },
    }));
    state = addLiveModifier(state, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: targetMember.instanceId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      sourceCardId: sourceMember.instanceId,
      abilityId: 'PL!HS-bp5-003:live-start-discard-same-group-member-heart',
    });
    state = addLiveModifier(state, {
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
      sourceCardId: 'legacy-player-heart-source',
      abilityId: 'legacy-player-heart',
    } as unknown as LiveModifierState);

    const view = projectPlayerViewState(state, PLAYER1);
    const targetObject = view.objects[createPublicObjectId(targetMember.instanceId)];

    expect(targetObject?.frontInfo?.hearts).toEqual([
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.PINK, count: 1 },
    ]);
    expect(view.match.liveResult?.heartBonuses.FIRST).toEqual([
      { color: HeartColor.GREEN, count: 1 },
    ]);
  });

  it("hides PL!-bp6-022-L 分数9「Dreamin' Go! Go!!」 requirement targets from the opponent until every dependent LIVE is revealed", () => {
    let { state } = createProjectedState();
    const dreamin = createCardInstance(
      {
        cardCode: 'PL!-bp6-022-L',
        name: "Dreamin' Go! Go!!",
        cardType: CardType.LIVE,
        score: 9,
        requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 5 }),
        groupNames: ["μ's"],
      },
      PLAYER1,
      'p1-dreamin-success'
    );
    const targetLive = createCardInstance(
      {
        cardCode: 'PL!-PROJECTED-LIVE',
        name: 'Projected μ’s Live',
        cardType: CardType.LIVE,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 3 }),
        groupNames: ["μ's"],
      },
      PLAYER1,
      'p1-projected-live'
    );
    const otherHiddenLive = createCardInstance(
      createTestLive('PL!-PROJECTED-OTHER-LIVE', '其他盖放LIVE'),
      PLAYER1,
      'p1-projected-other-live'
    );
    state = registerCards(state, [dreamin, targetLive, otherHiddenLive]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, dreamin.instanceId),
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, targetLive.instanceId, createFaceDownCardState()),
        otherHiddenLive.instanceId,
        createFaceDownCardState()
      ),
    }));

    const targetObjectId = createPublicObjectId(targetLive.instanceId);

    expect(
      projectPlayerViewState(state, PLAYER1).match.liveResult?.requirementModifiers[targetObjectId]
    ).toEqual([{ color: HeartColor.RAINBOW, countDelta: -2 }]);
    expect(
      projectPlayerViewState(state, PLAYER2).match.liveResult?.requirementModifiers[targetObjectId]
    ).toBeUndefined();

    state = revealLiveCard(state, PLAYER1, targetLive.instanceId);
    expect(
      projectPlayerViewState(state, PLAYER2).match.liveResult?.requirementModifiers[targetObjectId]
    ).toBeUndefined();

    state = revealPlayerLiveZone(state, PLAYER1);
    expect(
      projectPlayerViewState(state, PLAYER2).match.liveResult?.requirementModifiers[targetObjectId]
    ).toEqual([{ color: HeartColor.RAINBOW, countDelta: -2 }]);
  });

  it('uiHints 只表达 GameSession 规则自动化策略，不表达桌面本地模式', () => {
    const { state } = createProjectedState();

    const view = projectPlayerViewState(state, PLAYER1, { gameMode: GameMode.SOLITAIRE });

    expect(view.uiHints).toEqual({ gameMode: GameMode.SOLITAIRE });
    expect('isLocalMode' in (view.uiHints ?? {})).toBe(false);
  });

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

  it('检视区 viewer 与 owner 不同时，viewer 看正面且 owner 看背面', () => {
    const { state, p2MainDeckCard } = createProjectedState();
    const mutableState = state as unknown as {
      activeEffect: GameState['activeEffect'];
      inspectionZone: { cardIds: string[]; revealedCardIds: string[] };
      inspectionContext: {
        ownerPlayerId: string;
        viewerPlayerId?: string;
        sourceZone: ZoneType.MAIN_DECK;
      } | null;
    };
    mutableState.activeEffect = {
      id: 'cross-player-inspection',
      abilityId: 'test:cross-player-inspection',
      sourceCardId: 'source',
      controllerId: PLAYER1,
      effectText: '测试查看对方卡组',
      stepId: 'ARRANGE',
      stepText: '整理卡组顶',
      awaitingPlayerId: PLAYER1,
      inspectionCardIds: [p2MainDeckCard.instanceId],
      selectableCardIds: [p2MainDeckCard.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    };
    mutableState.inspectionZone.cardIds = [p2MainDeckCard.instanceId];
    mutableState.inspectionZone.revealedCardIds = [];
    mutableState.inspectionContext = {
      ownerPlayerId: PLAYER2,
      viewerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    };

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);
    const inspectionObjectId = createPublicObjectId(p2MainDeckCard.instanceId);

    expect(player1View.activeEffect?.selectableObjectIds).toEqual([inspectionObjectId]);
    expect(player1View.objects[inspectionObjectId]?.surface).toBe('FRONT');
    expect(player2View.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(player2View.objects[inspectionObjectId]?.surface).toBe('BACK');
    expect(player1View.match.window?.waitingSeats).toEqual(['FIRST']);
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
    expect(hasEnabledCommand(mainView, GameCommandType.ACTIVATE_ABILITY)).toBe(true);
    expect(getCommandHint(mainView, GameCommandType.ACTIVATE_ABILITY)?.scope?.zoneKeys).toEqual([
      'FIRST_HAND',
      'FIRST_MEMBER_LEFT',
      'FIRST_MEMBER_CENTER',
      'FIRST_MEMBER_RIGHT',
      'FIRST_WAITING_ROOM',
    ]);
    expect(hasEnabledCommand(mainView, GameCommandType.TAP_ENERGY)).toBe(true);
    expect(getCommandHint(mainView, GameCommandType.TAP_ENERGY)?.scope?.zoneKeys).toEqual([
      'FIRST_ENERGY_ZONE',
    ]);
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
    expect(hasEnabledCommand(liveSetView, GameCommandType.ACTIVATE_ABILITY)).toBe(false);
  });

  it('RULES 权限只投影当前语义操作，不暴露桌面手动 fallback', () => {
    const { state } = createProjectedState();
    const rulesState = {
      ...state,
      manualOperationMode: 'RULES' as const,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
      waitingPlayerId: null,
    };
    const activeView = projectPlayerViewState(rulesState, PLAYER1);
    expect(hasEnabledCommand(activeView, GameCommandType.PLAY_MEMBER_TO_SLOT)).toBe(true);
    expect(getCommandHint(activeView, GameCommandType.TAP_MEMBER)).toBeNull();
    expect(getCommandHint(activeView, GameCommandType.MOVE_TABLE_CARD)).toBeNull();
    expect(getCommandHint(activeView, GameCommandType.DRAW_CARD_TO_HAND)).toBeNull();

    const opponentView = projectPlayerViewState(rulesState, PLAYER2);
    expect(getCommandHint(opponentView, GameCommandType.PLAY_MEMBER_TO_SLOT)).toBeNull();
    expect(getCommandHint(opponentView, GameCommandType.OPEN_INSPECTION)).toBeNull();
  });

  it('RULES 在判定窗口只投影自动判定提交，不投影提前成功 Live 选择', () => {
    const { state } = createProjectedState();
    const rulesState = {
      ...state,
      manualOperationMode: 'RULES' as const,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      activePlayerIndex: 0,
      waitingPlayerId: null,
    };
    const view = projectPlayerViewState(rulesState, PLAYER1);
    expect(hasEnabledCommand(view, GameCommandType.SUBMIT_JUDGMENT)).toBe(true);
    expect(getCommandHint(view, GameCommandType.SELECT_SUCCESS_LIVE)).toBeNull();
    expect(getCommandHint(view, GameCommandType.CONFIRM_PERFORMANCE_OUTCOME)).toBeNull();
    expect(getCommandHint(view, GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE)).toBeNull();
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
    expect(hasEnabledCommand(mainOpponentView, GameCommandType.ACTIVATE_ABILITY)).toBe(false);
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
    expect(hasEnabledCommand(performanceView, GameCommandType.SUBMIT_JUDGMENT)).toBe(true);
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
    const { state, p1LiveCard } = createProjectedState();
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      waitingPlayerId: string | null;
      liveResolution: { liveWinnerIds: string[]; liveResults: Map<string, boolean> };
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_SETTLEMENT;
    mutableState.waitingPlayerId = null;
    mutableState.liveResolution.liveWinnerIds = [PLAYER1];
    mutableState.liveResolution.liveResults = new Map([[p1LiveCard.instanceId, true]]);

    const player1View = projectPlayerViewState(state, PLAYER1);
    const player2View = projectPlayerViewState(state, PLAYER2);

    expect(hasEnabledCommand(player1View, GameCommandType.SELECT_SUCCESS_LIVE)).toBe(true);
    expect(
      getCommandHint(player1View, GameCommandType.SELECT_SUCCESS_LIVE)?.scope?.objectIds
    ).toEqual([createPublicObjectId(p1LiveCard.instanceId)]);
    expect(hasEnabledCommand(player1View, GameCommandType.CONFIRM_STEP)).toBe(false);
    expect(getCommandHint(player1View, GameCommandType.CONFIRM_STEP)?.reason).toContain(
      '请先选择成功 Live'
    );
    expect(player1View.match.liveResult?.successLiveSelection?.candidateObjectIds).toEqual([
      createPublicObjectId(p1LiveCard.instanceId),
    ]);
    expect(player1View.match.liveResult?.successLiveSelection?.canSkipToWaitingRoom).toBe(true);
    const rulesView = projectPlayerViewState({ ...state, manualOperationMode: 'RULES' }, PLAYER1);
    expect(rulesView.match.liveResult?.successLiveSelection?.canSkipToWaitingRoom).toBe(false);
    expect(
      getCommandHint(rulesView, GameCommandType.SELECT_SUCCESS_LIVE)?.params
        ?.canSkipSuccessLiveSelection
    ).toBe(false);
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
