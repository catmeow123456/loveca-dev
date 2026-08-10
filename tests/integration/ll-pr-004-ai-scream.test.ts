import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardInstance,
  type MemberCardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { LL_PR_004_LIVE_START_OPPONENT_ANSWER_BRANCH_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { buildSolitaireOpponentEffectCommand } from '../../src/application/solitaire-effect-automation';
import {
  LL_PR_004_ANSWER_STEP_ID,
  LL_PR_004_CHOCOLATE_MINT_OPTION_ID,
  LL_PR_004_COOKIE_AND_CREAM_OPTION_ID,
  LL_PR_004_DISCARD_HAND_STEP_ID,
  LL_PR_004_OTHER_OPTION_ID,
  LL_PR_004_STRAWBERRY_FLAVOR_OPTION_ID,
  LL_PR_004_YOU_OPTION_ID,
  registerLlPr004AiScreamWorkflowHandlers,
} from '../../src/application/card-effects/workflows/cards/ll-pr-004-ai-scream';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';

const P1 = 'player1';
const P2 = 'player2';
const SOURCE_ID = 'll-pr-004-source';
const ABILITY_ID = LL_PR_004_LIVE_START_OPPONENT_ANSWER_BRANCH_ABILITY_ID;
const EFFECT_TEXT =
  '【LIVE开始时】询问对手喜欢什么。\n\n回答是薄荷巧克力或草莓味或曲奇奶油的场合，自己和对方分别将1张手牌放置入休息室。\n\n回答是你的场合，自己和对方分别抽1张卡。\n\n回答是其它的场合，LIVE结束时为止，存在于自己和对方舞台上的成员获得[ブレード]。';

registerLlPr004AiScreamWorkflowHandlers({ enqueueTriggeredCardEffects });

interface Scenario {
  readonly game: GameState;
  readonly source: LiveCardInstance;
  readonly p1Hand: MemberCardInstance;
  readonly p2Hand: MemberCardInstance;
  readonly p1Draw: MemberCardInstance;
  readonly p2Draw: MemberCardInstance;
  readonly p1StageIds: readonly string[];
  readonly p2StageIds: readonly string[];
  readonly belowStageId: string;
}

function liveCard(): LiveCardInstance {
  const data: LiveCardData = {
    cardCode: 'LL-PR-004-PR',
    name: '愛♡スクリ～ム！',
    groupNames: ['Love Live! Series'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 3,
      [HeartColor.RED]: 3,
      [HeartColor.GREEN]: 3,
    }),
  };
  return createCardInstance(data, P1, SOURCE_ID) as LiveCardInstance;
}

function member(ownerId: string, instanceId: string): MemberCardInstance {
  const data: MemberCardData = {
    cardCode: `LL-PR-004-${instanceId}`,
    name: instanceId,
    groupNames: ['Love Live! Series'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, ownerId, instanceId) as MemberCardInstance;
}

function pending(): PendingAbilityState {
  return {
    id: `${ABILITY_ID}:pending`,
    abilityId: ABILITY_ID,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['ll-pr-004-live-start'],
  };
}

function setup(
  options: {
    readonly sourceInLiveZone?: boolean;
    readonly p1HasHand?: boolean;
    readonly p2HasHand?: boolean;
  } = {}
): Scenario {
  const source = liveCard();
  const p1Hand = member(P1, 'p1-hand');
  const p2Hand = member(P2, 'p2-hand');
  const p1Draw = member(P1, 'p1-draw');
  const p2Draw = member(P2, 'p2-draw');
  const p1Stage = [member(P1, 'p1-left'), member(P1, 'p1-center')];
  const p2Stage = [member(P2, 'p2-center'), member(P2, 'p2-right')];
  const belowStage = member(P1, 'p1-below');
  const cards = [source, p1Hand, p2Hand, p1Draw, p2Draw, ...p1Stage, ...p2Stage, belowStage];

  let game = registerCards(createGameState('ll-pr-004-ai-scream', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      SlotPosition.LEFT,
      p1Stage[0]!.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, p1Stage[1]!.instanceId, {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, belowStage.instanceId);
    return {
      ...player,
      liveZone:
        options.sourceInLiveZone === false
          ? player.liveZone
          : addCardToZone(player.liveZone, source.instanceId),
      hand:
        options.p1HasHand === false ? player.hand : addCardToZone(player.hand, p1Hand.instanceId),
      mainDeck: addCardToZone(player.mainDeck, p1Draw.instanceId),
      memberSlots,
    };
  });
  game = updatePlayer(game, P2, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      p2Stage[0]!.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, p2Stage[1]!.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    return {
      ...player,
      hand:
        options.p2HasHand === false ? player.hand : addCardToZone(player.hand, p2Hand.instanceId),
      mainDeck: addCardToZone(player.mainDeck, p2Draw.instanceId),
      memberSlots,
    };
  });
  game = {
    ...game,
    pendingAbilities: [pending()],
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: P1,
      playerScores: new Map([[P1, 3]]),
    },
  };

  return {
    game,
    source,
    p1Hand,
    p2Hand,
    p1Draw,
    p2Draw,
    p1StageIds: p1Stage.map((card) => card.instanceId),
    p2StageIds: p2Stage.map((card) => card.instanceId),
    belowStageId: belowStage.instanceId,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function discloseAnswer(game: GameState, optionId: string, playerId = P2): GameState {
  return confirmActiveEffectStep(
    game,
    playerId,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [optionId]
  );
}

function answer(game: GameState, optionId: string): GameState {
  return continuePublicEffectChoiceForTest(discloseAnswer(game, optionId), P2);
}

function chooseHandCard(game: GameState, playerId: string, cardId: string): GameState {
  return confirmActiveEffectStep(game, playerId, game.activeEffect!.id, cardId);
}

describe('LL-PR-004-PR 「愛♡スクリ～ム！」', () => {
  it('按基础编号注册完整卡文，并由对手从五个固定公开回答中选择', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('LL-PR-004-PR');
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      abilityId: ABILITY_ID,
      baseCardCodes: ['LL-PR-004'],
      triggerCondition: TriggerCondition.ON_LIVE_START,
      effectText: EFFECT_TEXT,
    });

    const waiting = start(setup().game);
    expect(waiting.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      stepId: LL_PR_004_ANSWER_STEP_ID,
      effectText: EFFECT_TEXT,
      stepText: '请选择对“喜欢什么？”的回答。',
      awaitingPlayerId: P2,
      selectionLabel: '选择回答',
      canSkipSelection: false,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: LL_PR_004_CHOCOLATE_MINT_OPTION_ID, text: '薄荷巧克力' },
          { id: LL_PR_004_STRAWBERRY_FLAVOR_OPTION_ID, text: '草莓味' },
          { id: LL_PR_004_COOKIE_AND_CREAM_OPTION_ID, text: '曲奇奶油' },
          { id: LL_PR_004_YOU_OPTION_ID, text: '你' },
          { id: LL_PR_004_OTHER_OPTION_ID, text: '其他' },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      metadata: {
        solitaireOpponentEffectChoiceOptionId: LL_PR_004_OTHER_OPTION_ID,
      },
    });
    expect(projectPlayerViewState(waiting, P1).activeEffect?.effectChoice?.options).toHaveLength(5);
    expect(projectPlayerViewState(waiting, P2).activeEffect?.effectChoice?.options).toHaveLength(5);
    expect(buildSolitaireOpponentEffectCommand(waiting, P2, 1_000)).toMatchObject({
      playerId: P2,
      effectId: waiting.activeEffect?.id,
      selectedOptionId: LL_PR_004_OTHER_OPTION_ID,
    });
  });

  it('对手选择后先向双方公开答案，恢复后才执行真实分支', () => {
    const scenario = setup();
    const waiting = start(scenario.game);
    const disclosed = discloseAnswer(waiting, LL_PR_004_YOU_OPTION_ID);

    expect(disclosed.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      awaitingPlayerId: P2,
      effectChoice: { selectedOptionIds: [LL_PR_004_YOU_OPTION_ID] },
    });
    expect(disclosed.players[0].hand.cardIds).toEqual([scenario.p1Hand.instanceId]);
    expect(disclosed.players[1].hand.cardIds).toEqual([scenario.p2Hand.instanceId]);
    for (const playerId of [P1, P2]) {
      expect(projectPlayerViewState(disclosed, playerId).activeEffect?.effectChoice).toMatchObject({
        selectedOptionIds: [LL_PR_004_YOU_OPTION_ID],
      });
    }

    const resolved = continuePublicEffectChoiceForTest(disclosed, P2);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual([
      scenario.p1Hand.instanceId,
      scenario.p1Draw.instanceId,
    ]);
    expect(resolved.players[1].hand.cardIds).toEqual([
      scenario.p2Hand.instanceId,
      scenario.p2Draw.instanceId,
    ]);
  });

  it.each([
    LL_PR_004_CHOCOLATE_MINT_OPTION_ID,
    LL_PR_004_STRAWBERRY_FLAVOR_OPTION_ID,
    LL_PR_004_COOKIE_AND_CREAM_OPTION_ID,
  ])('回答 %s 时按控制者、对手顺序各弃1张自己的手牌并派发入休息室事件', (optionId) => {
    const scenario = setup();
    const p1Discard = answer(start(scenario.game), optionId);
    expect(p1Discard.activeEffect).toMatchObject({
      stepId: LL_PR_004_DISCARD_HAND_STEP_ID,
      awaitingPlayerId: P1,
      selectableCardIds: [scenario.p1Hand.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
    });

    const p2Discard = chooseHandCard(p1Discard, P1, scenario.p1Hand.instanceId);
    expect(p2Discard.activeEffect).toMatchObject({
      stepId: LL_PR_004_DISCARD_HAND_STEP_ID,
      awaitingPlayerId: P2,
      selectableCardIds: [scenario.p2Hand.instanceId],
    });

    const resolved = chooseHandCard(p2Discard, P2, scenario.p2Hand.instanceId);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([scenario.p1Hand.instanceId]);
    expect(resolved.players[1].waitingRoom.cardIds).toEqual([scenario.p2Hand.instanceId]);
    const handDiscardEvents = resolved.eventLog.filter(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        entry.event.fromZone === ZoneType.HAND
    );
    expect(handDiscardEvents).toHaveLength(2);
    expect(handDiscardEvents[0]?.event).toMatchObject({
      ownerId: P1,
      cardInstanceIds: [scenario.p1Hand.instanceId],
    });
    expect(handDiscardEvents[1]?.event).toMatchObject({
      ownerId: P2,
      cardInstanceIds: [scenario.p2Hand.instanceId],
    });
  });

  it('某方没有手牌时仅跳过该方，不阻止另一方弃牌', () => {
    const scenario = setup({ p1HasHand: false });
    const p2Discard = answer(start(scenario.game), LL_PR_004_CHOCOLATE_MINT_OPTION_ID);
    expect(p2Discard.activeEffect).toMatchObject({
      stepId: LL_PR_004_DISCARD_HAND_STEP_ID,
      awaitingPlayerId: P2,
      selectableCardIds: [scenario.p2Hand.instanceId],
    });

    const resolved = chooseHandCard(p2Discard, P2, scenario.p2Hand.instanceId);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([]);
    expect(resolved.players[1].waitingRoom.cardIds).toEqual([scenario.p2Hand.instanceId]);
    expect(
      resolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'EACH_PLAYER_DISCARD_HAND'
      )?.payload.discardedCardIdsByPlayer
    ).toEqual({ [P1]: [], [P2]: [scenario.p2Hand.instanceId] });
  });

  it('双方都没有手牌时直接完成口味分支', () => {
    const scenario = setup({ p1HasHand: false, p2HasHand: false });
    const resolved = answer(start(scenario.game), LL_PR_004_COOKIE_AND_CREAM_OPTION_ID);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'EACH_PLAYER_DISCARD_HAND'
      )?.payload.discardedCardIdsByPlayer
    ).toEqual({ [P1]: [], [P2]: [] });
  });

  it('回答“其他”时双方舞台顶层成员分别获得 BLADE +1，不覆盖成员下方的卡', () => {
    const scenario = setup();
    const resolved = answer(start(scenario.game), LL_PR_004_OTHER_OPTION_ID);
    const expectedTargetIds = [...scenario.p1StageIds, ...scenario.p2StageIds];
    const modifiers = resolved.liveResolution.liveModifiers.filter(
      (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === ABILITY_ID
    );

    expect(resolved.activeEffect).toBeNull();
    expect(modifiers).toHaveLength(expectedTargetIds.length);
    for (const targetMemberCardId of expectedTargetIds) {
      expect(
        modifiers.find(
          (modifier) =>
            modifier.kind === 'BLADE' &&
            modifier.target === 'TARGET_MEMBER' &&
            modifier.targetMemberCardId === targetMemberCardId
        )
      ).toMatchObject({
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        sourceCardId: SOURCE_ID,
        targetMemberCardId,
        countDelta: 1,
      });
    }
    for (const targetMemberCardId of scenario.p1StageIds) {
      expect(getMemberEffectiveBladeCount(resolved, P1, targetMemberCardId)).toBe(2);
    }
    for (const targetMemberCardId of scenario.p2StageIds) {
      expect(getMemberEffectiveBladeCount(resolved, P2, targetMemberCardId)).toBe(2);
    }
    expect(getMemberEffectiveBladeCount(resolved, P1, scenario.belowStageId)).toBe(1);
  });

  it('来源 LIVE 不在控制者 LIVE 区时消费 pending 且不打开回答窗口', () => {
    const scenario = setup({ sourceInLiveZone: false });
    const resolved = start(scenario.game);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'SOURCE_LIVE_NOT_IN_LIVE_ZONE'
      )
    ).toBe(true);
  });

  it('非对手提交或未知回答不会改变窗口与游戏状态', () => {
    const waiting = start(setup().game);
    const wrongPlayer = discloseAnswer(waiting, LL_PR_004_YOU_OPTION_ID, P1);
    expect(wrongPlayer).toBe(waiting);

    const unknownAnswer = discloseAnswer(waiting, 'free-text-answer');
    expect(unknownAnswer).toBe(waiting);
    expect(unknownAnswer.activeEffect?.stepId).toBe(LL_PR_004_ANSWER_STEP_ID);
  });

  it('在多 pending 顺序发动时保留 ordered continuation', () => {
    const scenario = setup();
    const first = scenario.game.pendingAbilities[0]!;
    const ordering = start({
      ...scenario.game,
      pendingAbilities: [first, { ...first, id: `${first.id}:second` }],
    });
    expect(ordering.activeEffect?.canResolveInOrder).toBe(true);

    const answering = confirmActiveEffectStep(
      ordering,
      P1,
      ordering.activeEffect!.id,
      null,
      null,
      true
    );
    expect(answering.activeEffect).toMatchObject({
      id: first.id,
      stepId: LL_PR_004_ANSWER_STEP_ID,
      metadata: { orderedResolution: true },
    });
    const disclosed = discloseAnswer(answering, LL_PR_004_YOU_OPTION_ID);
    const continued = continuePublicEffectChoiceForTest(disclosed, P2);
    expect(continued.activeEffect).toMatchObject({
      id: `${first.id}:second`,
      stepId: LL_PR_004_ANSWER_STEP_ID,
      metadata: { orderedResolution: true },
    });
  });
});
