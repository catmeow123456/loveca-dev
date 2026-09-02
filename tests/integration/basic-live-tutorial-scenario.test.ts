import { describe, expect, it } from 'vitest';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createEndPhaseCommand,
  createMulliganCommand,
  createPlayMemberToSlotCommand,
  createSelectSuccessLiveCommand,
  createSetLiveCardCommand,
  createSubmitJudgmentCommand,
  createSubmitScoreCommand,
} from '../../src/application/game-commands';
import {
  HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { CardDataRegistry } from '../../src/domain/card-data/loader';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import {
  BASIC_LIVE_TUTORIAL_ID,
  BASIC_LIVE_TUTORIAL_ROLES,
  BASIC_LIVE_TUTORIAL_VERSION,
  createBasicLiveTutorialScenario,
} from '../../src/server/services/basic-live-tutorial-scenario';
import { TutorialSessionService } from '../../src/server/services/tutorial-session-service';
import { TUTORIAL_CHECKPOINT_IDS } from '../../src/online/tutorial-types';
import {
  BladeHeartEffect,
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';

function member(
  cardCode: string,
  hearts = [createHeartIcon(HeartColor.PINK, 1)],
  bladeHeart = HeartColor.PINK,
  cost = 4,
  blade = 1
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost,
    blade,
    hearts,
    bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: bladeHeart }],
  };
}

function live(
  cardCode: string,
  requirements: Record<string, number>,
  score = 1,
  totalRequired?: number
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement(requirements, totalRequired),
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function buildRegistry(): CardDataRegistry {
  const registry = new CardDataRegistry();
  const cards: AnyCardData[] = [];
  for (let number = 1; number <= 18; number += 1) {
    const cardCode = `PL!-sd1-${String(number).padStart(3, '0')}-SD`;
    cards.push(
      member(
        cardCode,
        cardCode === 'PL!-sd1-010-SD'
          ? [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.YELLOW, 1)]
          : cardCode === 'PL!-sd1-013-SD'
            ? [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.PURPLE, 1)]
            : cardCode === 'PL!-sd1-014-SD'
              ? [
                  createHeartIcon(HeartColor.PINK, 2),
                  createHeartIcon(HeartColor.YELLOW, 1),
                  createHeartIcon(HeartColor.PURPLE, 1),
                ]
              : undefined,
        cardCode === 'PL!-sd1-010-SD' ? HeartColor.YELLOW : HeartColor.PINK,
        cardCode === 'PL!-sd1-002-SD' || cardCode === 'PL!-sd1-005-SD'
          ? 2
          : cardCode === 'PL!-sd1-014-SD'
            ? 9
            : 4,
        cardCode === 'PL!-sd1-014-SD' ? 3 : 1
      )
    );
  }
  cards.push(
    live('PL!-sd1-019-SD', { [HeartColor.PINK]: 1 }),
    live('PL!-sd1-020-SD', { [HeartColor.PINK]: 2 }, 2),
    live(
      'PL!-sd1-021-SD',
      {
        [HeartColor.PINK]: 1,
        [HeartColor.YELLOW]: 1,
        [HeartColor.PURPLE]: 1,
      },
      3,
      7
    ),
    live('PL!-sd1-022-SD', { [HeartColor.PINK]: 4 }, 4),
    member(
      'PL!HS-bp6-024-N',
      [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.PURPLE, 1)],
      HeartColor.PURPLE
    ),
    member(
      'PL!N-bp3-024-N',
      [
        createHeartIcon(HeartColor.PINK, 1),
        createHeartIcon(HeartColor.YELLOW, 1),
        createHeartIcon(HeartColor.GREEN, 1),
      ],
      HeartColor.PINK,
      9,
      3
    ),
    member(
      'PL!-bp3-016-N',
      [createHeartIcon(HeartColor.PINK, 2), createHeartIcon(HeartColor.PURPLE, 1)],
      HeartColor.PURPLE,
      7,
      2
    ),
    live(
      'PL!-bp4-026-L',
      {
        [HeartColor.YELLOW]: 1,
        [HeartColor.PURPLE]: 1,
      },
      1,
      3
    ),
    live('PL!HS-bp1-019-L', {}, 1, 4),
    live('PL!-bp3-020-L', { [HeartColor.PINK]: 1, [HeartColor.PURPLE]: 1 }, 2, 5),
    live('PL!-bp5-019-L', { [HeartColor.YELLOW]: 1, [HeartColor.PURPLE]: 1 }, 2, 5),
    live(
      'PL!N-bp4-032-L',
      {
        [HeartColor.PINK]: 1,
        [HeartColor.RED]: 1,
        [HeartColor.BLUE]: 1,
      },
      3,
      7
    ),
    live('PL!HS-bp6-030-L', { [HeartColor.PINK]: 1, [HeartColor.GREEN]: 1 }, 1, 1)
  );
  for (let number = 23; number <= 31; number += 1) {
    cards.push(energy(`PL!-sd1-${String(number).padStart(3, '0')}-P`));
  }
  registry.load(cards);
  return registry;
}

function rawObjectId(value: string | undefined): string {
  expect(value).toBeTruthy();
  return value!.replace(/^obj_/, '');
}

function printedStageAttack(state: GameState, playerIndex: number): number {
  return Object.values(state.players[playerIndex]!.memberSlots.slots).reduce((total, cardId) => {
    if (!cardId) return total;
    const card = state.cardRegistry.get(cardId)?.data;
    if (!card || card.cardType !== CardType.MEMBER) {
      throw new Error(`舞台成员不存在: ${cardId}`);
    }
    const memberCard = card as MemberCardData;
    return (
      total + memberCard.blade + memberCard.hearts.reduce((sum, heart) => sum + heart.count, 0)
    );
  }, 0);
}

describe('三回合连续新手教程私密场景', () => {
  it.each([
    {
      checkpointId: TUTORIAL_CHECKPOINT_IDS.LIVE_EFFECTS,
      entryStepId: 'advanced-welcome',
      turnCount: 2,
      visibleRole: BASIC_LIVE_TUTORIAL_ROLES.RELAY_MEMBER,
      phase: GamePhase.MAIN_PHASE,
      subPhase: SubPhase.NONE,
    },
    {
      checkpointId: TUTORIAL_CHECKPOINT_IDS.RECOVERY_LOOP,
      entryStepId: 'third-turn-arrival',
      turnCount: 3,
      visibleRole: BASIC_LIVE_TUTORIAL_ROLES.RECOVERY_MEMBER,
      phase: GamePhase.MAIN_PHASE,
      subPhase: SubPhase.NONE,
    },
    {
      checkpointId: TUTORIAL_CHECKPOINT_IDS.FINISHING_LIVE,
      entryStepId: 'count-final-stage-hearts',
      turnCount: 3,
      visibleRole: BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO,
      phase: GamePhase.LIVE_SET_PHASE,
      subPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
    },
  ])(
    '可从 $checkpointId 建立真实的回合检查点',
    ({ checkpointId, entryStepId, turnCount, visibleRole, phase, subPhase }) => {
      const service = new TutorialSessionService({
        scenarios: [createBasicLiveTutorialScenario(buildRegistry())],
        idGenerator: () => `checkpoint-${checkpointId}`,
        now: () => 20_000,
      });
      const snapshot = service.createSession({
        participantKey: `guest-${checkpointId}`,
        scenarioId: BASIC_LIVE_TUTORIAL_ID,
        scenarioVersion: BASIC_LIVE_TUTORIAL_VERSION,
        checkpointId,
      });

      expect(snapshot.checkpointId).toBe(checkpointId);
      expect(snapshot.entryStepId).toBe(entryStepId);
      expect(snapshot.status).toBe('ACTIVE');
      expect(snapshot.playerViewState.match.phase).toBe(phase);
      expect(snapshot.playerViewState.match.subPhase).toBe(subPhase);
      expect(snapshot.playerViewState.match.activeSeat).toBe('FIRST');
      expect(snapshot.playerViewState.match.turnCount).toBe(turnCount);
      expect(snapshot.objectBindings[visibleRole]).toBeTruthy();
      expect(snapshot.acceptedCommands).toEqual([]);
    }
  );

  it('在同一局完成基础 LIVE、换手、LIVE 开始能力、回收再登场与制胜规划', () => {
    let now = 10_000;
    const service = new TutorialSessionService({
      scenarios: [createBasicLiveTutorialScenario(buildRegistry())],
      idGenerator: () => 'basic-live-test',
      now: () => now,
    });
    const participantKey = 'guest-basic-live';
    let snapshot = service.createSession({
      participantKey,
      scenarioId: BASIC_LIVE_TUTORIAL_ID,
      scenarioVersion: BASIC_LIVE_TUTORIAL_VERSION,
      checkpointId: TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS,
    });
    const runId = snapshot.runId;
    const playerId = snapshot.playerViewState.match.participants.FIRST.id;
    const opponentId = snapshot.playerViewState.match.participants.SECOND.id;
    const mulliganId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.MULLIGAN_CARD]
    );
    const memberId = rawObjectId(snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.MEMBER_CARD]);
    const liveId = rawObjectId(snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]);
    const record = (
      service as unknown as {
        sessions: Map<string, { session: { state: GameState } }>;
      }
    ).sessions.get(runId)!;
    const state = () => record.session.state;
    const playerCommand = (
      command: Parameters<typeof service.executePlayerCommand>[0]['command']
    ) => {
      snapshot = service.executePlayerCommand({
        runId,
        participantKey,
        expectedSeq: snapshot.playerViewState.match.seq,
        command,
      }).snapshot;
    };
    const drainScript = () => {
      for (let index = 0; index < 20; index += 1) {
        const result = service.advanceScript({
          runId,
          participantKey,
          expectedSeq: snapshot.playerViewState.match.seq,
        });
        snapshot = result.snapshot;
        if (!result.advanced || snapshot.status !== 'ACTIVE') return;
      }
      throw new Error('教程脚本没有在预期步数内停下');
    };

    expect(snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SET_CARD]).toBeUndefined();
    const openingCardCodes = state().players[0].hand.cardIds.map(
      (cardId) => state().cardRegistry.get(cardId)!.data.cardCode
    );
    expect(new Set(openingCardCodes).size).toBeGreaterThanOrEqual(4);

    playerCommand(createMulliganCommand(playerId, [mulliganId]));
    drainScript();
    playerCommand(createPlayMemberToSlotCommand(playerId, memberId, SlotPosition.CENTER));
    playerCommand(createEndPhaseCommand(playerId));
    drainScript();
    playerCommand(createSetLiveCardCommand(playerId, liveId, true));
    playerCommand(createConfirmStepCommand(playerId, SubPhase.LIVE_SET_FIRST_PLAYER));
    drainScript();
    playerCommand(createSubmitJudgmentCommand(playerId, new Map()));
    playerCommand(createConfirmStepCommand(playerId, SubPhase.PERFORMANCE_JUDGMENT));
    drainScript();

    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);
    expect(state().liveResolution.liveResults.get(liveId)).toBe(true);
    const opponentSetCardId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SET_CARD]
    );
    expect(snapshot.playerViewState.table.zones.SECOND_WAITING_ROOM.objectIds).toContain(
      `obj_${opponentSetCardId}`
    );

    playerCommand(createSubmitScoreCommand(playerId));
    playerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_ANIMATION));
    playerCommand(createSelectSuccessLiveCommand(playerId, liveId));
    playerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_SETTLEMENT));

    expect(snapshot.status).toBe('ACTIVE');
    expect(snapshot.runId).toBe(runId);
    expect(snapshot.playerViewState.match.turnCount).toBe(2);
    expect(snapshot.playerViewState.match.phase).toBe(GamePhase.MAIN_PHASE);
    const relayMemberId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.RELAY_MEMBER]
    );
    expect(state().players[0].hand.cardIds).toContain(relayMemberId);

    playerCommand(createPlayMemberToSlotCommand(playerId, relayMemberId, SlotPosition.CENTER));
    expect(state().activeEffect?.abilityId).toBe(MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID);
    const effectLiveCardId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
    );
    const relayDiscardIds = state()
      .activeEffect!.selectableCardIds!.filter((cardId) => cardId !== effectLiveCardId)
      .slice(0, 2);
    playerCommand(
      createConfirmEffectStepCommand(
        playerId,
        state().activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        relayDiscardIds
      )
    );
    expect(state().players[0].hand.cardIds).toContain(effectLiveCardId);
    expect(state().players[0].waitingRoom.cardIds).toContain(memberId);

    playerCommand(createEndPhaseCommand(playerId));
    drainScript();
    expect(snapshot.playerViewState.match.phase).toBe(GamePhase.LIVE_SET_PHASE);
    const opponentRelayMemberId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_RELAY_MEMBER]
    );
    const opponentSecondMemberId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_MEMBER]
    );
    expect(state().players[1].memberSlots.slots[SlotPosition.CENTER]).toBe(opponentRelayMemberId);
    expect(state().players[1].memberSlots.slots[SlotPosition.LEFT]).toBe(opponentSecondMemberId);
    expect(printedStageAttack(state(), 1)).toBe(7);
    expect(
      [...state().players[1].energyZone.cardStates.values()].filter(
        (cardState) => cardState.orientation === 'WAITING'
      )
    ).toHaveLength(5);
    playerCommand(createSetLiveCardCommand(playerId, effectLiveCardId, true));
    playerCommand(createConfirmStepCommand(playerId, SubPhase.LIVE_SET_FIRST_PLAYER));
    const opponentSecondSetResult = service.advanceScript({
      runId,
      participantKey,
      expectedSeq: snapshot.playerViewState.match.seq,
    });
    expect(opponentSecondSetResult.advanced).toBe(true);
    snapshot = opponentSecondSetResult.snapshot;

    const opponentSecondLiveId = state().players[1].liveZone.cardIds.find(
      (cardId) => state().cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-021-SD'
    );
    expect(opponentSecondLiveId).toBeTruthy();
    expect(snapshot.playerViewState.match.phase).toBe(GamePhase.LIVE_SET_PHASE);
    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.LIVE_SET_SECOND_PLAYER);
    expect(snapshot.playerViewState.table.zones.SECOND_LIVE_ZONE.count).toBe(1);
    expect(snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]).toBeUndefined();

    const opponentSecondConfirmResult = service.advanceScript({
      runId,
      participantKey,
      expectedSeq: snapshot.playerViewState.match.seq,
    });
    expect(opponentSecondConfirmResult.advanced).toBe(true);
    snapshot = opponentSecondConfirmResult.snapshot;
    drainScript();
    expect(state().players[1].liveZone.cardIds).toContain(opponentSecondLiveId!);
    expect(state().activeEffect?.abilityId).toBe(
      HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    const liveStartDiscardId = state().activeEffect!.selectableCardIds![0]!;
    playerCommand(
      createConfirmEffectStepCommand(playerId, state().activeEffect!.id, liveStartDiscardId)
    );
    drainScript();
    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);

    playerCommand(createSubmitJudgmentCommand(playerId, new Map()));
    playerCommand(createConfirmStepCommand(playerId, SubPhase.PERFORMANCE_JUDGMENT));
    const opponentLiveStartResult = service.advanceScript({
      runId,
      participantKey,
      expectedSeq: snapshot.playerViewState.match.seq,
    });
    expect(opponentLiveStartResult.advanced).toBe(true);
    snapshot = opponentLiveStartResult.snapshot;
    expect(snapshot.playerViewState.match.activeSeat).toBe('SECOND');
    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);
    expect(
      rawObjectId(snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE])
    ).toBe(opponentSecondLiveId);
    drainScript();
    expect(state().liveResolution.liveResults.get(effectLiveCardId)).toBe(true);
    expect(state().liveResolution.liveResults.get(opponentSecondLiveId!)).toBe(false);
    expect(state().players[1].waitingRoom.cardIds).toContain(opponentSecondLiveId!);
    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);

    playerCommand(createSubmitScoreCommand(playerId));
    playerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_ANIMATION));
    playerCommand(createSelectSuccessLiveCommand(playerId, effectLiveCardId));
    playerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_SETTLEMENT));

    expect(snapshot.status).toBe('ACTIVE');
    expect(snapshot.runId).toBe(runId);
    expect(snapshot.playerViewState.match.turnCount).toBe(3);
    expect(snapshot.playerViewState.match.phase).toBe(GamePhase.MAIN_PHASE);
    const recoveryMemberId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.RECOVERY_MEMBER]
    );
    expect(state().players[0].hand.cardIds).toContain(recoveryMemberId);

    playerCommand(createPlayMemberToSlotCommand(playerId, recoveryMemberId, SlotPosition.LEFT));
    playerCommand(
      createActivateAbilityCommand(playerId, recoveryMemberId, PB1_019_ACTIVATED_ABILITY_ID)
    );
    expect(state().activeEffect?.abilityId).toBe(PB1_019_ACTIVATED_ABILITY_ID);
    expect(state().activeEffect?.selectableCardIds).toContain(memberId);

    playerCommand(createConfirmEffectStepCommand(playerId, state().activeEffect!.id, memberId));
    const publicSelectionAdvanceAt = state().activeEffect?.publicCardSelectionAutoAdvanceAt;
    expect(publicSelectionAdvanceAt).toBeTypeOf('number');
    now = publicSelectionAdvanceAt!;
    playerCommand({
      ...createConfirmEffectStepCommand(playerId, state().activeEffect!.id),
      publicCardSelectionAutoAdvanceAt: publicSelectionAdvanceAt,
    });

    expect(snapshot.status).toBe('ACTIVE');
    expect(snapshot.runId).toBe(runId);
    expect(state().players[0].hand.cardIds).toContain(memberId);
    expect(state().players[0].waitingRoom.cardIds).toContain(recoveryMemberId);
    expect(state().activeEffect).toBeNull();

    playerCommand(createPlayMemberToSlotCommand(playerId, memberId, SlotPosition.LEFT));
    expect(state().players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(memberId);
    expect(
      [...state().players[0].energyZone.cardStates.values()].filter(
        (cardState) => cardState.orientation === 'WAITING'
      )
    ).toHaveLength(6);

    playerCommand(createEndPhaseCommand(playerId));
    drainScript();
    const opponentThirdMemberId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_THIRD_MEMBER]
    );
    const opponentFinalRelayMemberId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_RELAY_MEMBER]
    );
    expect(snapshot.status).toBe('ACTIVE');
    expect(state().players[1].memberSlots.slots[SlotPosition.CENTER]).toBe(
      opponentFinalRelayMemberId
    );
    expect(state().players[1].memberSlots.slots[SlotPosition.RIGHT]).toBe(opponentThirdMemberId);
    expect(printedStageAttack(state(), 1)).toBe(12);
    expect(
      [...state().players[1].energyZone.cardStates.values()].filter(
        (cardState) => cardState.orientation === 'WAITING'
      )
    ).toHaveLength(6);
    expect(snapshot.playerViewState.match.phase).toBe(GamePhase.LIVE_SET_PHASE);
    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.LIVE_SET_FIRST_PLAYER);

    const finalLiveOneId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_ONE]
    );
    const finalLiveTwoId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO]
    );
    const finalLiveRiskyId = rawObjectId(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_RISKY]
    );
    expect(state().players[0].hand.cardIds).toEqual(
      expect.arrayContaining([finalLiveOneId, finalLiveTwoId, finalLiveRiskyId])
    );

    playerCommand(createSetLiveCardCommand(playerId, finalLiveOneId, true));
    playerCommand(createSetLiveCardCommand(playerId, finalLiveTwoId, true));
    expect(state().players[0].hand.cardIds).toContain(finalLiveRiskyId);
    playerCommand(createConfirmStepCommand(playerId, SubPhase.LIVE_SET_FIRST_PLAYER));
    const opponentFinalSetResult = service.advanceScript({
      runId,
      participantKey,
      expectedSeq: snapshot.playerViewState.match.seq,
    });
    expect(opponentFinalSetResult.advanced).toBe(true);
    snapshot = opponentFinalSetResult.snapshot;

    const opponentFinalLiveId = state().players[1].liveZone.cardIds.find(
      (cardId) => state().cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp3-020-L'
    )!;
    expect(state().players[1].liveZone.cardIds).toContain(opponentFinalLiveId);
    expect(snapshot.playerViewState.match.phase).toBe(GamePhase.LIVE_SET_PHASE);
    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.LIVE_SET_SECOND_PLAYER);
    expect(snapshot.playerViewState.table.zones.SECOND_LIVE_ZONE.count).toBe(1);
    expect(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]
    ).toBeUndefined();

    const opponentFinalConfirmResult = service.advanceScript({
      runId,
      participantKey,
      expectedSeq: snapshot.playerViewState.match.seq,
    });
    expect(opponentFinalConfirmResult.advanced).toBe(true);
    snapshot = opponentFinalConfirmResult.snapshot;
    drainScript();

    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);
    expect(snapshot.playerViewState.match.activeSeat).toBe('FIRST');
    expect(state().players[0].liveZone.cardIds).toEqual([finalLiveOneId, finalLiveTwoId]);
    expect(
      snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]
    ).toBeUndefined();
    expect(
      state().liveResolution.firstPlayerCheerCardIds.map(
        (cardId) => state().cardRegistry.get(cardId)!.data.cardCode
      )
    ).toEqual(['PL!-sd1-010-SD', 'PL!-sd1-013-SD', 'PL!-sd1-005-SD', 'PL!-sd1-008-SD']);

    playerCommand(createSubmitJudgmentCommand(playerId, new Map()));
    expect(state().liveResolution.liveResults.get(finalLiveOneId)).toBe(true);
    expect(state().liveResolution.liveResults.get(finalLiveTwoId)).toBe(true);
    playerCommand(createConfirmStepCommand(playerId, SubPhase.PERFORMANCE_JUDGMENT));
    drainScript();

    expect(snapshot.playerViewState.match.subPhase).toBe(SubPhase.RESULT_SCORE_CONFIRM);
    expect(
      rawObjectId(snapshot.objectBindings[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD])
    ).toBe(opponentFinalLiveId);
    expect(state().liveResolution.liveResults.get(opponentFinalLiveId)).toBe(true);
    expect(state().liveResolution.playerScores.get(playerId)).toBe(3);
    expect(state().liveResolution.playerScores.get(opponentId)).toBe(2);
    playerCommand(createSubmitScoreCommand(playerId));
    expect(state().liveResolution.liveWinnerIds).toEqual([playerId]);
    playerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_ANIMATION));
    playerCommand(createSelectSuccessLiveCommand(playerId, finalLiveTwoId));

    expect(snapshot.status).toBe('COMPLETED');
    expect(snapshot.playerViewState.match.phase).toBe(GamePhase.GAME_END);
    expect(state().endInfo?.winnerId).toBe(playerId);
    expect(state().players[0].successZone.cardIds).toContain(finalLiveTwoId);
    expect(state().players[0].successZone.cardIds).toHaveLength(3);
    expect(state().players[0].liveZone.cardIds).toContain(finalLiveOneId);
    expect(state().players[0].hand.cardIds).toContain(finalLiveRiskyId);
    expect(snapshot.acceptedCommands.length).toBeGreaterThan(28);
  });
});
