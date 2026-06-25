import { describe, expect, it } from 'vitest';
import {
  GameCommandType,
  type ConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import {
  createGameState,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';
import {
  buildMatchDecisionRecordsForCommand,
  buildMatchDecisionRecordsForStateTransition,
} from '../../src/server/services/match-decision-records';

function createMember(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    cardText: `${name} 的效果文本`,
  };
}

function createLive(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
    cardText: `${name} 的 LIVE 文本`,
  };
}

function createCard(instanceId: string, data: CardInstance['data'], ownerId = 'p1'): CardInstance {
  return {
    instanceId,
    ownerId,
    data,
  };
}

function createState(
  activeEffect: ActiveEffectState | null,
  pendingAbilities: readonly PendingAbilityState[] = []
): GameState {
  const base = createGameState('match-decision-1', 'p1', 'Alpha', 'p2', 'Beta');
  const sourceCard = createCard('source-card', createMember('PL!HS-bp1-006-P', '藤岛 慈'));
  const otherSourceCard = createCard(
    'other-source-card',
    createMember('PL!HS-bp6-004-R', '百生 吟子')
  );
  const candidateCard = createCard('candidate-card', createMember('PL!HS-bp1-004-P', '夕雾缀理'));
  const liveCard = createCard('live-card', createLive('PL!-sd1-019-SD', 'START:DASH!!'));
  const successLiveCard = createCard(
    'success-live-card',
    createLive('PL!HS-bp2-022-L+', 'アオクハルカ')
  );

  return {
    ...base,
    cardRegistry: new Map([
      [sourceCard.instanceId, sourceCard],
      [otherSourceCard.instanceId, otherSourceCard],
      [candidateCard.instanceId, candidateCard],
      [liveCard.instanceId, liveCard],
      [successLiveCard.instanceId, successLiveCard],
    ]),
    players: [
      {
        ...base.players[0],
        memberSlots: {
          ...base.players[0].memberSlots,
          slots: {
            ...base.players[0].memberSlots.slots,
            [SlotPosition.LEFT]: sourceCard.instanceId,
            [SlotPosition.CENTER]: otherSourceCard.instanceId,
          },
        },
        hand: {
          ...base.players[0].hand,
          cardIds: [liveCard.instanceId],
        },
        liveZone: {
          ...base.players[0].liveZone,
          cardIds: [successLiveCard.instanceId],
        },
        waitingRoom: {
          ...base.players[0].waitingRoom,
          cardIds: [candidateCard.instanceId],
        },
      },
      base.players[1],
    ],
    activeEffect,
    pendingAbilities,
  };
}

function createEffect(overrides: Partial<ActiveEffectState> = {}): ActiveEffectState {
  return {
    id: 'effect-1',
    abilityId: 'pl-hs-bp1-006-live-start-heart',
    sourceCardId: 'source-card',
    controllerId: 'p1',
    effectText: '可以将 1 张手牌放置入休息室；获得 Heart。',
    stepId: 'select-card',
    stepText: '请选择要放置入休息室的卡牌',
    awaitingPlayerId: 'p1',
    selectableCardIds: ['candidate-card'],
    selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    selectableCardMode: 'SINGLE',
    canSkipSelection: true,
    metadata: {
      rawRuntimeOnly: '不应被 replay 决策记录复制',
    },
    ...overrides,
  };
}

function createPendingAbility(overrides: Partial<PendingAbilityState> = {}): PendingAbilityState {
  return {
    id: 'pending-a',
    abilityId: 'ability-a',
    sourceCardId: 'source-card',
    controllerId: 'p1',
    mandatory: false,
    timingId: 'ON_LIVE_START',
    eventIds: ['event-a'],
    sourceSlot: SlotPosition.LEFT,
    ...overrides,
  };
}

function createAbilityOrderSelectionEffect(
  pendingAbilities: readonly PendingAbilityState[]
): ActiveEffectState {
  return {
    id: 'system:select-pending-card-effect:ON_LIVE_START:p1',
    abilityId: 'system:select-pending-card-effect',
    sourceCardId: pendingAbilities[0]?.sourceCardId ?? 'source-card',
    controllerId: 'p1',
    effectText: '请选择下一个要发动的效果。也可以选择“顺序发动”，按当前队列顺序依次处理。',
    stepId: 'SELECT_NEXT_PENDING_ABILITY',
    stepText: '选择下一个待处理效果',
    awaitingPlayerId: 'p1',
    selectableCardIds: pendingAbilities.map((ability) => ability.sourceCardId),
    canResolveInOrder: true,
    metadata: {
      pendingAbilityIds: pendingAbilities.map((ability) => ability.id),
    },
  };
}

describe('match decision records P2', () => {
  it('记录起动声明与 activeEffect opened 的稳定语义字段，不复制 raw activeEffect metadata', () => {
    const afterState = createState(createEffect());

    const records = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: createState(null),
      afterState,
      command: {
        type: GameCommandType.ACTIVATE_ABILITY,
        playerId: 'p1',
        cardId: 'source-card',
        abilityId: 'pl-hs-bp1-006-live-start-heart',
        timestamp: 1_000,
      },
      commandSucceeded: true,
      submittedCommandSeq: 3,
      getSeatForPlayer: (playerId) => (playerId === 'p1' ? 'FIRST' : null),
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      decisionType: 'ACTIVATE_ABILITY_SUBMITTED',
      status: 'SUBMITTED',
      submittedCommandSeq: 3,
      sourceCardObjectId: 'source-card',
      sourceBaseCardCode: 'PL!HS-bp1-006',
      sourceZone: 'MEMBER_SLOT',
      sourceSlot: 'LEFT',
      abilityId: 'pl-hs-bp1-006-live-start-heart',
      stepId: 'activate-ability',
      submission: {
        commandType: 'ACTIVATE_ABILITY',
        selectedCardId: 'source-card',
      },
    });

    expect(records[1]).toMatchObject({
      decisionType: 'ACTIVE_EFFECT_OPENED',
      status: 'OPENED',
      decisionSchemaVersion: 1,
      playerId: 'p1',
      waitingSeat: 'FIRST',
      sourceCardObjectId: 'source-card',
      sourceCardCode: 'PL!HS-bp1-006-P',
      sourceBaseCardCode: 'PL!HS-bp1-006',
      sourceZone: 'MEMBER_SLOT',
      sourceSlot: 'LEFT',
      abilityId: 'pl-hs-bp1-006-live-start-heart',
      stepId: 'select-card',
      minSelect: 0,
      maxSelect: 1,
      canSkip: true,
      visibleContextSummary: {
        selectableCardCount: 1,
        hasPrivateCandidates: true,
      },
      visibleCandidates: [
        {
          cardId: 'candidate-card',
          cardCode: 'PL!HS-bp1-004-P',
          baseCardCode: 'PL!HS-bp1-004',
          name: '夕雾缀理',
        },
      ],
      transitionSemantics: 'STRUCTURED',
    });
    expect(JSON.stringify(records)).not.toContain('rawRuntimeOnly');
    expect(JSON.stringify(records)).not.toContain('activeEffect');
  });

  it('记录换牌、LIVE 设置与成功 LIVE 选择命令决策', () => {
    const state = createState(null);
    const getSeatForPlayer = (playerId: string | null | undefined) =>
      playerId === 'p1' ? 'FIRST' : null;

    const mulligan = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: state,
      afterState: state,
      command: {
        type: GameCommandType.MULLIGAN,
        playerId: 'p1',
        cardIdsToMulligan: ['live-card'],
        timestamp: 3_000,
      },
      commandSucceeded: true,
      submittedCommandSeq: 8,
      getSeatForPlayer,
    });
    expect(mulligan).toEqual([
      expect.objectContaining({
        decisionType: 'MULLIGAN_SUBMITTED',
        waitingSeat: 'FIRST',
        visibleCandidates: [
          {
            cardId: 'live-card',
            cardCode: 'PL!-sd1-019-SD',
            baseCardCode: 'PL!-sd1-019',
            name: 'START:DASH!!',
          },
        ],
        submission: {
          commandType: 'MULLIGAN',
          selectedCardIds: ['live-card'],
        },
      }),
    ]);
    expect(mulligan[0]?.visibleContextSummary).toMatchObject({
      selectableCardCount: 1,
      hasPrivateCandidates: true,
    });

    const setLive = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: state,
      afterState: state,
      command: {
        type: GameCommandType.SET_LIVE_CARD,
        playerId: 'p1',
        cardId: 'live-card',
        faceDown: true,
        timestamp: 4_000,
      },
      commandSucceeded: true,
      submittedCommandSeq: 9,
      getSeatForPlayer,
    });
    expect(setLive[0]).toMatchObject({
      decisionType: 'SET_LIVE_CARD_SUBMITTED',
      sourceCardObjectId: 'live-card',
      sourceBaseCardCode: 'PL!-sd1-019',
      sourceZone: 'HAND',
      submission: {
        commandType: 'SET_LIVE_CARD',
        selectedCardId: 'live-card',
        faceDown: true,
      },
    });

    const selectSuccess = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: state,
      afterState: state,
      command: {
        type: GameCommandType.SELECT_SUCCESS_LIVE,
        playerId: 'p1',
        cardId: 'success-live-card',
        timestamp: 5_000,
      },
      commandSucceeded: true,
      submittedCommandSeq: 10,
      getSeatForPlayer,
    });
    expect(selectSuccess[0]).toMatchObject({
      decisionType: 'SELECT_SUCCESS_LIVE_SUBMITTED',
      sourceCardObjectId: 'success-live-card',
      sourceBaseCardCode: 'PL!HS-bp2-022',
      sourceZone: 'LIVE_ZONE',
      submission: {
        commandType: 'SELECT_SUCCESS_LIVE',
        selectedCardId: 'success-live-card',
      },
    });
  });

  it('记录 CONFIRM_EFFECT_STEP submission，并在进入下一步骤时追加 opened 记录', () => {
    const beforeEffect = createEffect();
    const nextEffect = createEffect({
      stepId: 'confirm-reveal',
      stepText: '公开所选卡牌',
      selectableCardIds: [],
      canSkipSelection: false,
    });
    const command: ConfirmEffectStepCommand = {
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: 'p1',
      effectId: beforeEffect.id,
      selectedCardId: 'candidate-card',
      selectedNumber: 3,
      stageFormationMoveHistory: [
        { cardId: 'member-b', toSlot: SlotPosition.LEFT },
        { cardId: 'member-c', toSlot: SlotPosition.LEFT },
      ],
      stageFormationPlacements: [
        { cardId: 'member-a', toSlot: SlotPosition.RIGHT },
        { cardId: 'member-b', toSlot: SlotPosition.CENTER },
        { cardId: 'member-c', toSlot: SlotPosition.LEFT },
      ],
      timestamp: 2_000,
    };

    const records = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: createState(beforeEffect),
      afterState: createState(nextEffect),
      command,
      commandSucceeded: true,
      submittedCommandSeq: 7,
      getSeatForPlayer: (playerId) => (playerId === 'p1' ? 'FIRST' : null),
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      decisionType: 'ACTIVE_EFFECT_SUBMITTED',
      status: 'SUBMITTED',
      submittedCommandSeq: 7,
      submission: {
        selectedCardId: 'candidate-card',
        selectedNumber: 3,
        stageFormationMoveHistory: [
          { cardId: 'member-b', toSlot: SlotPosition.LEFT },
          { cardId: 'member-c', toSlot: SlotPosition.LEFT },
        ],
        stageFormationPlacements: [
          { cardId: 'member-a', toSlot: SlotPosition.RIGHT },
          { cardId: 'member-b', toSlot: SlotPosition.CENTER },
          { cardId: 'member-c', toSlot: SlotPosition.LEFT },
        ],
        skipped: false,
      },
      resultSummary: '进入效果步骤：confirm-reveal',
    });
    expect(records[1]).toMatchObject({
      decisionType: 'ACTIVE_EFFECT_OPENED',
      status: 'OPENED',
      stepId: 'confirm-reveal',
      stepText: '公开所选卡牌',
    });
  });

  it('同一 activeEffect step 重复发生时，decisionId 使用发生序列避免去重吞记录', () => {
    const effect = createEffect();
    const getSeatForPlayer = (playerId: string | null | undefined) =>
      playerId === 'p1' ? 'FIRST' : null;

    const firstSubmitted = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: createState(effect),
      afterState: createState(effect),
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        playerId: 'p1',
        effectId: effect.id,
        selectedCardId: 'candidate-card',
        timestamp: 9_000,
      },
      commandSucceeded: true,
      submittedCommandSeq: 21,
      getSeatForPlayer,
    });
    const secondSubmitted = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: createState(effect),
      afterState: createState(effect),
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        playerId: 'p1',
        effectId: effect.id,
        selectedCardId: 'candidate-card',
        timestamp: 9_100,
      },
      commandSucceeded: true,
      submittedCommandSeq: 22,
      getSeatForPlayer,
    });

    expect(firstSubmitted).toHaveLength(1);
    expect(secondSubmitted).toHaveLength(1);
    expect(firstSubmitted[0]?.decisionId).not.toBe(secondSubmitted[0]?.decisionId);
    expect(firstSubmitted[0]?.decisionId).toContain('cmd-seq-21');
    expect(secondSubmitted[0]?.decisionId).toContain('cmd-seq-22');

    const firstOpenedState = {
      ...createState(effect),
      actionSequence: 30,
      eventSequence: 40,
    };
    const secondOpenedState = {
      ...createState(effect),
      actionSequence: 31,
      eventSequence: 41,
    };
    const firstOpened = buildMatchDecisionRecordsForStateTransition({
      matchId: 'match-decision-1',
      beforeState: createState(null),
      afterState: firstOpenedState,
      getSeatForPlayer,
    });
    const secondOpened = buildMatchDecisionRecordsForStateTransition({
      matchId: 'match-decision-1',
      beforeState: createState(null),
      afterState: secondOpenedState,
      getSeatForPlayer,
    });

    expect(firstOpened).toHaveLength(1);
    expect(secondOpened).toHaveLength(1);
    expect(firstOpened[0]?.decisionId).not.toBe(secondOpened[0]?.decisionId);
    expect(firstOpened[0]?.decisionId).toContain('state-action-30-event-40');
    expect(secondOpened[0]?.decisionId).toContain('state-action-31-event-41');
  });

  it('记录同一时点待处理能力顺序选择的候选来源与选中能力', () => {
    const pendingAbilities = [
      createPendingAbility(),
      createPendingAbility({
        id: 'pending-b',
        abilityId: 'ability-b',
        sourceCardId: 'other-source-card',
        eventIds: ['event-b', 'event-a'],
        sourceSlot: SlotPosition.CENTER,
      }),
    ];
    const orderSelectionEffect = createAbilityOrderSelectionEffect(pendingAbilities);
    const getSeatForPlayer = (playerId: string | null | undefined) =>
      playerId === 'p1' ? 'FIRST' : null;

    const openedRecords = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: createState(null, pendingAbilities),
      afterState: createState(orderSelectionEffect, pendingAbilities),
      command: {
        type: GameCommandType.END_PHASE,
        playerId: 'p1',
        timestamp: 6_000,
      },
      commandSucceeded: true,
      submittedCommandSeq: 11,
      getSeatForPlayer,
    });
    expect(openedRecords).toHaveLength(1);
    expect(openedRecords[0]).toMatchObject({
      decisionType: 'ACTIVE_EFFECT_OPENED',
      status: 'OPENED',
      sourceType: 'PENDING_ABILITY_ORDER',
      abilityId: 'system:select-pending-card-effect',
      eventIds: ['event-a', 'event-b'],
      stepId: 'SELECT_NEXT_PENDING_ABILITY',
      visibleCandidates: [
        {
          cardId: 'source-card',
          cardCode: 'PL!HS-bp1-006-P',
          baseCardCode: 'PL!HS-bp1-006',
          name: '藤岛 慈',
        },
        {
          cardId: 'other-source-card',
          cardCode: 'PL!HS-bp6-004-R',
          baseCardCode: 'PL!HS-bp6-004',
          name: '百生 吟子',
        },
      ],
    });
    expect(openedRecords[0]?.visibleContextSummary).toMatchObject({
      selectableCardCount: 2,
      selectableOptionCount: 2,
    });

    const submittedRecords = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: createState(orderSelectionEffect, pendingAbilities),
      afterState: createState(null, pendingAbilities),
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        playerId: 'p1',
        effectId: orderSelectionEffect.id,
        selectedCardId: 'other-source-card',
        timestamp: 7_000,
      },
      commandSucceeded: true,
      submittedCommandSeq: 12,
      getSeatForPlayer,
    });
    expect(submittedRecords).toHaveLength(1);
    expect(submittedRecords[0]).toMatchObject({
      decisionType: 'PENDING_ABILITY_ORDER_SUBMITTED',
      status: 'SUBMITTED',
      sourceType: 'PENDING_ABILITY_ORDER',
      sourceCardObjectId: 'other-source-card',
      sourceBaseCardCode: 'PL!HS-bp6-004',
      sourceZone: 'MEMBER_SLOT',
      sourceSlot: 'CENTER',
      abilityId: 'ability-b',
      eventIds: ['event-a', 'event-b'],
      submittedCommandSeq: 12,
      resultSummary: '选择待处理能力：ability-b',
    });
    expect(submittedRecords[0]?.submission).toMatchObject({
      commandType: 'CONFIRM_EFFECT_STEP',
      selectedCardId: 'other-source-card',
      selectedPendingAbilityId: 'pending-b',
      skipped: false,
    });

    const resolveInOrderRecords = buildMatchDecisionRecordsForCommand({
      matchId: 'match-decision-1',
      beforeState: createState(orderSelectionEffect, pendingAbilities),
      afterState: createState(null, pendingAbilities),
      command: {
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        playerId: 'p1',
        effectId: orderSelectionEffect.id,
        resolveInOrder: true,
        timestamp: 8_000,
      },
      commandSucceeded: true,
      submittedCommandSeq: 13,
      getSeatForPlayer,
    });
    expect(resolveInOrderRecords[0]).toMatchObject({
      decisionType: 'PENDING_ABILITY_ORDER_SUBMITTED',
      sourceCardObjectId: 'source-card',
      abilityId: 'ability-a',
      resultSummary: '按当前队列顺序发动：ability-a',
    });
    expect(resolveInOrderRecords[0]?.submission).toMatchObject({
      commandType: 'CONFIRM_EFFECT_STEP',
      selectedPendingAbilityId: 'pending-a',
      resolveInOrder: true,
      skipped: false,
    });
  });
});
