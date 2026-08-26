import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createEndPhaseCommand,
  createMulliganCommand,
  createPlayMemberToSlotCommand,
  createSelectSuccessLiveCommand,
  createSetLiveCardCommand,
  createSubmitJudgmentCommand,
  createSubmitScoreCommand,
  GameCommandType,
  type GameCommand,
} from '../../application/game-commands.js';
import {
  ELI_ACTIVATED_ABILITY_ID,
  HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
} from '../../application/card-effects/ability-ids.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { CardDataRegistry } from '../../domain/card-data/loader.js';
import type { AnyCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import { GamePhase, OrientationState, SlotPosition, SubPhase } from '../../shared/types/enums.js';
import type {
  TutorialCheckpointBootstrapController,
  TutorialRuntimeScenarioDefinition,
  TutorialScenarioContext,
} from './tutorial-session-service.js';
import { TUTORIAL_CHECKPOINT_IDS } from '../../online/tutorial-types.js';

export const BASIC_LIVE_TUTORIAL_ID = 'basic-live-loop';
export const BASIC_LIVE_TUTORIAL_VERSION = '1.1.5';

export const BASIC_LIVE_TUTORIAL_ROLES = {
  MULLIGAN_CARD: 'opening-mulligan-card',
  MEMBER_CARD: 'tutorial-member-card',
  LIVE_CARD: 'tutorial-live-card',
  RELAY_MEMBER: 'tutorial-relay-member',
  EFFECT_LIVE_CARD: 'tutorial-effect-live-card',
  RECOVERY_MEMBER: 'tutorial-recovery-member',
  FINAL_LIVE_ONE: 'tutorial-final-live-one',
  FINAL_LIVE_TWO: 'tutorial-final-live-two',
  FINAL_LIVE_RISKY: 'tutorial-final-live-risky',
  CHECKPOINT_STAGE_MEMBER: 'tutorial-checkpoint-stage-member',
  OPPONENT_SET_CARD: 'opponent-set-card',
  OPPONENT_SECOND_MEMBER: 'opponent-second-member',
  OPPONENT_SECOND_LIVE: 'opponent-second-live',
  OPPONENT_RELAY_MEMBER: 'opponent-relay-member',
  OPPONENT_FINAL_RELAY_MEMBER: 'opponent-final-relay-member',
  OPPONENT_THIRD_MEMBER: 'opponent-third-member',
  OPPONENT_FINAL_SET_CARD: 'opponent-final-set-card',
} as const;

const PLAYER_MULLIGAN_CODE = 'PL!-sd1-013-SD';
const PLAYER_MEMBER_CODE = 'PL!HS-bp6-024-N';
const PLAYER_LIVE_CODE = 'PL!-bp4-026-L';
const PLAYER_CHEER_CODE = 'PL!-sd1-010-SD';
const PLAYER_RELAY_MEMBER_CODE = 'PL!N-bp3-024-N';
const PLAYER_EFFECT_LIVE_CODE = 'PL!HS-bp6-030-L';
const PLAYER_RECOVERY_MEMBER_CODE = 'PL!-sd1-002-SD';
const PLAYER_FINAL_LIVE_ONE_CODE = 'PL!HS-bp1-019-L';
const PLAYER_FINAL_LIVE_TWO_CODE = 'PL!-bp5-019-L';
const PLAYER_FINAL_LIVE_RISKY_CODE = 'PL!N-bp4-032-L';
const PLAYER_FINAL_CHEER_CODES = [
  'PL!-sd1-010-SD',
  'PL!-sd1-013-SD',
  'PL!-sd1-005-SD',
  'PL!-sd1-008-SD',
] as const;
const CHECKPOINT_STAGE_MEMBER_CODE = 'PL!-sd1-013-SD';
const PLAYER_SECOND_CHEER_CODES = ['PL!-sd1-010-SD', 'PL!-sd1-013-SD', 'PL!-sd1-003-SD'] as const;
const OPPONENT_MEMBER_CODE = 'PL!-sd1-010-SD';
const OPPONENT_SET_CARD_CODE = 'PL!HS-bp6-024-N';
const OPPONENT_CHEER_CODE = 'PL!-sd1-013-SD';
const OPPONENT_SECOND_MEMBER_CODE = 'PL!-sd1-005-SD';
const OPPONENT_SECOND_LIVE_CODE = 'PL!-sd1-021-SD';
const OPPONENT_RELAY_MEMBER_CODE = 'PL!-bp3-016-N';
const OPPONENT_FINAL_RELAY_MEMBER_CODE = 'PL!-sd1-014-SD';
const OPPONENT_THIRD_MEMBER_CODE = 'PL!-sd1-013-SD';
const OPPONENT_FINAL_SET_CARD_CODE = 'PL!-bp3-020-L';

const PLAYER_MAIN_DECK_ORDER_SEED = 0x4c4f5645;
const OPPONENT_MAIN_DECK_ORDER_SEED = 0x43415244;
const PLAYER_ENERGY_DECK_ORDER_SEED = 0x48454152;
const OPPONENT_ENERGY_DECK_ORDER_SEED = 0x54424541;

const STARTER_MAIN_DECK_COUNTS: Readonly<Record<string, number>> = {
  'PL!-sd1-001-SD': 4,
  'PL!-sd1-002-SD': 2,
  'PL!-sd1-003-SD': 4,
  'PL!-sd1-004-SD': 4,
  'PL!-sd1-005-SD': 2,
  'PL!-sd1-006-SD': 2,
  'PL!-sd1-007-SD': 2,
  'PL!-sd1-008-SD': 2,
  'PL!-sd1-009-SD': 2,
  'PL!-sd1-010-SD': 4,
  'PL!-sd1-011-SD': 2,
  'PL!-sd1-012-SD': 4,
  'PL!-sd1-013-SD': 4,
  'PL!-sd1-014-SD': 2,
  'PL!-sd1-015-SD': 2,
  'PL!-sd1-016-SD': 2,
  'PL!-sd1-017-SD': 2,
  'PL!-sd1-018-SD': 2,
  'PL!-sd1-019-SD': 4,
  'PL!-sd1-020-SD': 4,
  'PL!-sd1-021-SD': 2,
  'PL!-sd1-022-SD': 2,
};

const STARTER_ENERGY_DECK_COUNTS: Readonly<Record<string, number>> = {
  'PL!-sd1-023-P': 2,
  'PL!-sd1-024-P': 2,
  'PL!-sd1-025-P': 2,
  'PL!-sd1-026-P': 1,
  'PL!-sd1-027-P': 1,
  'PL!-sd1-028-P': 1,
  'PL!-sd1-029-P': 1,
  'PL!-sd1-030-P': 1,
  'PL!-sd1-031-P': 1,
};

function noOpShuffleDecisions(deckSize: number): number[] {
  return Array.from({ length: deckSize - 1 }, (_, index) => deckSize - 1 - index);
}

function buildDecisionTape(): readonly number[] {
  const initialShuffle = noOpShuffleDecisions(60);
  return [
    ...initialShuffle,
    ...initialShuffle,
    ...initialShuffle,
    ...initialShuffle,
    // 玩家换掉一张起手后：先补一张，再将选中的一张放回 54 张牌中洗牌。
    ...noOpShuffleDecisions(54),
  ];
}

function expandCounts(counts: Readonly<Record<string, number>>): string[] {
  return Object.entries(counts).flatMap(([cardCode, count]) =>
    Array.from({ length: count }, () => cardCode)
  );
}

function mixFixedCodes(cardCodes: readonly string[], seed: number): string[] {
  const mixed = [...cardCodes];
  let state = seed >>> 0;
  for (let index = mixed.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const swapIndex = state % (index + 1);
    [mixed[index], mixed[swapIndex]] = [mixed[swapIndex]!, mixed[index]!];
  }
  return mixed;
}

function takeCard(pool: string[], cardCode: string): string {
  const index = pool.indexOf(cardCode);
  if (index < 0) {
    throw new Error(`教程卡组缺少卡牌: ${cardCode}`);
  }
  return pool.splice(index, 1)[0]!;
}

function replaceCard(pool: string[], removedCode: string, addedCode: string): void {
  takeCard(pool, removedCode);
  pool.push(addedCode);
}

function placeReservedCardAt(
  pool: string[],
  ordered: string[],
  index: number,
  reservedCardCode: string
): void {
  while (ordered.length < index) {
    const filler = pool.shift();
    if (!filler) throw new Error('教程卡组顺序构造失败');
    ordered.push(filler);
  }
  ordered.push(reservedCardCode);
}

function buildOrderedPlayerCodes(): readonly string[] {
  const pool = mixFixedCodes(expandCounts(STARTER_MAIN_DECK_COUNTS), PLAYER_MAIN_DECK_ORDER_SEED);
  replaceCard(pool, 'PL!-sd1-010-SD', PLAYER_MEMBER_CODE);
  replaceCard(pool, 'PL!-sd1-020-SD', PLAYER_LIVE_CODE);
  replaceCard(pool, 'PL!-sd1-011-SD', PLAYER_RELAY_MEMBER_CODE);
  replaceCard(pool, 'PL!-sd1-019-SD', PLAYER_EFFECT_LIVE_CODE);
  replaceCard(pool, 'PL!-sd1-019-SD', PLAYER_FINAL_LIVE_ONE_CODE);
  replaceCard(pool, 'PL!-sd1-020-SD', PLAYER_FINAL_LIVE_TWO_CODE);
  replaceCard(pool, 'PL!-sd1-021-SD', PLAYER_FINAL_LIVE_RISKY_CODE);

  const ordered = [
    takeCard(pool, PLAYER_MULLIGAN_CODE),
    takeCard(pool, PLAYER_MEMBER_CODE),
    takeCard(pool, PLAYER_LIVE_CODE),
  ];
  const firstCheerCard = takeCard(pool, PLAYER_CHEER_CODE);
  const relayMember = takeCard(pool, PLAYER_RELAY_MEMBER_CODE);
  const effectLiveCard = takeCard(pool, PLAYER_EFFECT_LIVE_CODE);
  const secondCheerCards = PLAYER_SECOND_CHEER_CODES.map((cardCode) => takeCard(pool, cardCode));
  const recoveryMember = takeCard(pool, PLAYER_RECOVERY_MEMBER_CODE);
  const finalLiveCards = [
    takeCard(pool, PLAYER_FINAL_LIVE_ONE_CODE),
    takeCard(pool, PLAYER_FINAL_LIVE_TWO_CODE),
    takeCard(pool, PLAYER_FINAL_LIVE_RISKY_CODE),
  ];
  const checkpointStageMember = takeCard(pool, CHECKPOINT_STAGE_MEMBER_CODE);
  const finalCheerCards = PLAYER_FINAL_CHEER_CODES.map((cardCode) => takeCard(pool, cardCode));
  // 换牌补牌、首轮抽卡和 LIVE 设置抽卡会依次拿到三张终局候选 LIVE。
  finalLiveCards.forEach((cardCode, index) => {
    placeReservedCardAt(pool, ordered, 6 + index, cardCode);
  });
  // 起手 6 张、换牌补 1 张、抽卡阶段和 LIVE 设置各抽 1 张后，这张牌位于声援顶。
  placeReservedCardAt(pool, ordered, 9, firstCheerCard);
  // 第一轮结算后进入下一回合抽卡阶段时，抽到进阶教学的费用 9 成员。
  placeReservedCardAt(pool, ordered, 10, relayMember);
  // 换手成员的登场效果抽到特殊 LIVE；第二轮声援固定为三张不同牌，避免整齐成组。
  placeReservedCardAt(pool, ordered, 11, effectLiveCard);
  // 仅供第四章检查点用正式登场命令复现同色 Heart 舞台；完整流程仍走回收再登场。
  placeReservedCardAt(pool, ordered, 12, checkpointStageMember);
  secondCheerCards.forEach((cardCode, index) => {
    placeReservedCardAt(pool, ordered, 15 + index, cardCode);
  });
  // 第二轮结算后的第三回合抽卡，用于介绍费用 2 回收成员。
  placeReservedCardAt(pool, ordered, 18, recoveryMember);
  // 终局先因设置两张 LIVE 各补 1 张手牌；之后四张判心均提供 1 Heart，
  // 让成员 5 Heart + 4 BLADE = 9 的场攻教学与实际判定一致。
  finalCheerCards.forEach((cardCode, index) => {
    placeReservedCardAt(pool, ordered, 21 + index, cardCode);
  });
  return [...ordered, ...pool];
}

function buildOrderedOpponentCodes(): readonly string[] {
  const pool = mixFixedCodes(expandCounts(STARTER_MAIN_DECK_COUNTS), OPPONENT_MAIN_DECK_ORDER_SEED);
  replaceCard(pool, 'PL!-sd1-011-SD', OPPONENT_SET_CARD_CODE);
  replaceCard(pool, 'PL!-sd1-006-SD', OPPONENT_RELAY_MEMBER_CODE);
  replaceCard(pool, 'PL!-sd1-004-SD', OPPONENT_FINAL_SET_CARD_CODE);

  const ordered = [
    takeCard(pool, OPPONENT_MEMBER_CODE),
    takeCard(pool, OPPONENT_SET_CARD_CODE),
    takeCard(pool, OPPONENT_SECOND_MEMBER_CODE),
    takeCard(pool, OPPONENT_SECOND_LIVE_CODE),
    takeCard(pool, OPPONENT_THIRD_MEMBER_CODE),
  ];
  const finalSetCard = takeCard(pool, OPPONENT_FINAL_SET_CARD_CODE);
  const relayMember = takeCard(pool, OPPONENT_RELAY_MEMBER_CODE);
  const finalRelayMember = takeCard(pool, OPPONENT_FINAL_RELAY_MEMBER_CODE);
  replaceCard(pool, OPPONENT_FINAL_RELAY_MEMBER_CODE, 'PL!-sd1-006-SD');
  const cheerCard = takeCard(pool, OPPONENT_CHEER_CODE);
  placeReservedCardAt(pool, ordered, 5, finalSetCard);
  // 第一轮 LIVE 设置补牌时抽到，第二回合用于第一次换手强化中央。
  placeReservedCardAt(pool, ordered, 6, relayMember);
  // 第二回合抽卡时入手，保留到第三回合继续换手强化中央。
  placeReservedCardAt(pool, ordered, 7, finalRelayMember);
  // 起手 6 张、抽卡阶段和 LIVE 设置各抽 1 张后，这张牌位于声援顶。
  placeReservedCardAt(pool, ordered, 8, cheerCard);
  return [...ordered, ...pool];
}

function resolveCards(registry: CardDataRegistry, cardCodes: readonly string[]): AnyCardData[] {
  return cardCodes.map((cardCode) => {
    const card = registry.getByCode(cardCode);
    if (!card) throw new Error(`已发布卡池缺少教程卡牌: ${cardCode}`);
    return card;
  });
}

function buildDeck(
  registry: CardDataRegistry,
  mainDeckCodes: readonly string[],
  energyDeckOrderSeed: number
): DeckConfig {
  return {
    mainDeck: resolveCards(registry, mainDeckCodes),
    energyDeck: resolveCards(
      registry,
      mixFixedCodes(expandCounts(STARTER_ENERGY_DECK_COUNTS), energyDeckOrderSeed)
    ),
  };
}

function playerCenterMemberId(context: TutorialScenarioContext): string | null {
  return context.state.players[0].memberSlots.slots[SlotPosition.CENTER] ?? null;
}

function opponentCenterMemberId(context: TutorialScenarioContext): string | null {
  return context.state.players[1].memberSlots.slots[SlotPosition.CENTER] ?? null;
}

function firstCardIdByCode(state: GameState, playerIndex: 0 | 1, cardCode: string): string {
  const playerId = state.players[playerIndex].id;
  const card = [...state.cardRegistry.values()].find(
    (candidate) => candidate.ownerId === playerId && candidate.data.cardCode === cardCode
  );
  if (!card) throw new Error(`教程卡牌实例不存在: ${cardCode}`);
  return card.instanceId;
}

function commandMatchesPlayerMilestone(
  context: TutorialScenarioContext,
  command: GameCommand
): boolean {
  const state = context.state;
  const player = state.players[0];
  const mulliganCardId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.MULLIGAN_CARD];
  const memberCardId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.MEMBER_CARD];
  const liveCardId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD];
  const relayMemberId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.RELAY_MEMBER];
  const effectLiveCardId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD];
  const recoveryMemberId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.RECOVERY_MEMBER];
  const finalLiveOneId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_ONE];
  const finalLiveTwoId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO];
  const finalLiveRiskyId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_RISKY];
  const checkpointStageMemberId =
    context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.CHECKPOINT_STAGE_MEMBER];
  const protectedPlanningCardIds = new Set([
    effectLiveCardId,
    finalLiveOneId,
    finalLiveTwoId,
    finalLiveRiskyId,
    checkpointStageMemberId,
  ]);
  const hasCompletedBasicLive = player.successZone.cardIds.includes(liveCardId);
  const hasCompletedEffectLive = player.successZone.cardIds.includes(effectLiveCardId);

  if (
    state.activeEffect?.abilityId === MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID &&
    command.type === GameCommandType.CONFIRM_EFFECT_STEP &&
    command.effectId === state.activeEffect.id
  ) {
    const selected = command.selectedCardIds ?? [];
    return (
      selected.length === 2 &&
      new Set(selected).size === 2 &&
      selected.every((cardId) => !protectedPlanningCardIds.has(cardId)) &&
      selected.every(
        (cardId) =>
          state.activeEffect?.selectableCardIds?.includes(cardId) === true &&
          player.hand.cardIds.includes(cardId)
      )
    );
  }
  if (
    state.activeEffect?.abilityId === HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID &&
    command.type === GameCommandType.CONFIRM_EFFECT_STEP &&
    command.effectId === state.activeEffect.id
  ) {
    return (
      typeof command.selectedCardId === 'string' &&
      !protectedPlanningCardIds.has(command.selectedCardId) &&
      state.activeEffect.selectableCardIds?.includes(command.selectedCardId) === true &&
      player.hand.cardIds.includes(command.selectedCardId)
    );
  }
  if (
    state.activeEffect?.abilityId === ELI_ACTIVATED_ABILITY_ID &&
    command.type === GameCommandType.CONFIRM_EFFECT_STEP &&
    command.effectId === state.activeEffect.id
  ) {
    if (command.publicCardSelectionAutoAdvanceAt !== undefined) return true;
    return (
      command.selectedCardId === memberCardId &&
      state.activeEffect.selectableCardIds?.includes(memberCardId) === true
    );
  }

  if (state.currentPhase === GamePhase.MULLIGAN_PHASE) {
    return (
      command.type === GameCommandType.MULLIGAN &&
      command.cardIdsToMulligan.length === 1 &&
      command.cardIdsToMulligan[0] === mulliganCardId
    );
  }
  if (state.currentPhase === GamePhase.MAIN_PHASE && state.activePlayerIndex === 0) {
    if (hasCompletedEffectLive) {
      if (player.hand.cardIds.includes(recoveryMemberId)) {
        if (player.memberSlots.slots[SlotPosition.LEFT] === checkpointStageMemberId) {
          return command.type === GameCommandType.END_PHASE;
        }
        if (
          command.type === GameCommandType.PLAY_MEMBER_TO_SLOT &&
          command.cardId === checkpointStageMemberId &&
          command.targetSlot === SlotPosition.LEFT &&
          command.freePlay !== true
        ) {
          return true;
        }
        return (
          command.type === GameCommandType.PLAY_MEMBER_TO_SLOT &&
          command.cardId === recoveryMemberId &&
          command.targetSlot === SlotPosition.LEFT &&
          command.freePlay !== true
        );
      }
      if (player.memberSlots.slots[SlotPosition.LEFT] === recoveryMemberId) {
        return (
          command.type === GameCommandType.ACTIVATE_ABILITY &&
          command.cardId === recoveryMemberId &&
          command.abilityId === ELI_ACTIVATED_ABILITY_ID &&
          command.abilityInstanceId === undefined
        );
      }
      if (player.waitingRoom.cardIds.includes(recoveryMemberId)) {
        if (player.hand.cardIds.includes(memberCardId)) {
          return (
            command.type === GameCommandType.PLAY_MEMBER_TO_SLOT &&
            command.cardId === memberCardId &&
            command.targetSlot === SlotPosition.LEFT &&
            command.freePlay !== true
          );
        }
        return (
          player.memberSlots.slots[SlotPosition.LEFT] === memberCardId &&
          command.type === GameCommandType.END_PHASE
        );
      }
      return false;
    }
    if (hasCompletedBasicLive) {
      if (playerCenterMemberId(context) === relayMemberId) {
        return command.type === GameCommandType.END_PHASE;
      }
      return (
        command.type === GameCommandType.PLAY_MEMBER_TO_SLOT &&
        command.cardId === relayMemberId &&
        command.targetSlot === SlotPosition.CENTER &&
        command.freePlay !== true &&
        command.relayMode !== 'DOUBLE' &&
        (command.relayReplacementSlots?.length ?? 0) === 0
      );
    }
    if (playerCenterMemberId(context) !== memberCardId) {
      return (
        command.type === GameCommandType.PLAY_MEMBER_TO_SLOT &&
        command.cardId === memberCardId &&
        command.targetSlot === SlotPosition.CENTER &&
        command.freePlay !== true
      );
    }
    return command.type === GameCommandType.END_PHASE;
  }
  if (
    state.currentPhase === GamePhase.LIVE_SET_PHASE &&
    state.currentSubPhase === SubPhase.LIVE_SET_FIRST_PLAYER
  ) {
    if (hasCompletedBasicLive && hasCompletedEffectLive) {
      if (!player.liveZone.cardIds.includes(finalLiveOneId)) {
        return (
          command.type === GameCommandType.SET_LIVE_CARD &&
          command.cardId === finalLiveOneId &&
          command.faceDown === true
        );
      }
      if (!player.liveZone.cardIds.includes(finalLiveTwoId)) {
        return (
          command.type === GameCommandType.SET_LIVE_CARD &&
          command.cardId === finalLiveTwoId &&
          command.faceDown === true
        );
      }
      return (
        command.type === GameCommandType.CONFIRM_STEP &&
        command.subPhase === SubPhase.LIVE_SET_FIRST_PLAYER
      );
    }
    const tutorialLiveCardId = hasCompletedBasicLive ? effectLiveCardId : liveCardId;
    if (!player.liveZone.cardIds.includes(tutorialLiveCardId)) {
      return (
        command.type === GameCommandType.SET_LIVE_CARD &&
        command.cardId === tutorialLiveCardId &&
        command.faceDown === true
      );
    }
    return (
      command.type === GameCommandType.CONFIRM_STEP &&
      command.subPhase === SubPhase.LIVE_SET_FIRST_PLAYER
    );
  }
  if (
    state.currentPhase === GamePhase.PERFORMANCE_PHASE &&
    state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
    state.liveResolution.performingPlayerId === context.playerId
  ) {
    const performingLiveCardIds = player.liveZone.cardIds.filter((cardId) =>
      [liveCardId, effectLiveCardId, finalLiveOneId, finalLiveTwoId].includes(cardId)
    );
    if (performingLiveCardIds.some((cardId) => !state.liveResolution.liveResults.has(cardId))) {
      return command.type === GameCommandType.SUBMIT_JUDGMENT && command.judgmentResults.size === 0;
    }
    return (
      command.type === GameCommandType.CONFIRM_STEP &&
      command.subPhase === SubPhase.PERFORMANCE_JUDGMENT
    );
  }
  if (state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM) {
    return (
      !state.liveResolution.scoreConfirmedBy.includes(context.playerId) &&
      command.type === GameCommandType.SUBMIT_SCORE &&
      command.adjustedScore === undefined
    );
  }
  if (state.currentSubPhase === SubPhase.RESULT_ANIMATION) {
    return (
      command.type === GameCommandType.CONFIRM_STEP &&
      command.subPhase === SubPhase.RESULT_ANIMATION
    );
  }
  if (state.currentSubPhase === SubPhase.RESULT_SETTLEMENT) {
    if (hasCompletedBasicLive && hasCompletedEffectLive) {
      if (player.liveZone.cardIds.includes(finalLiveTwoId)) {
        return (
          command.type === GameCommandType.SELECT_SUCCESS_LIVE && command.cardId === finalLiveTwoId
        );
      }
      return (
        command.type === GameCommandType.CONFIRM_STEP &&
        command.subPhase === SubPhase.RESULT_SETTLEMENT
      );
    }
    const unsettledTutorialLiveCardId = player.liveZone.cardIds.find(
      (cardId) => cardId === liveCardId || cardId === effectLiveCardId
    );
    if (unsettledTutorialLiveCardId) {
      return (
        command.type === GameCommandType.SELECT_SUCCESS_LIVE &&
        command.cardId === unsettledTutorialLiveCardId
      );
    }
    return (
      command.type === GameCommandType.CONFIRM_STEP &&
      command.subPhase === SubPhase.RESULT_SETTLEMENT
    );
  }
  return false;
}

function describeExpectedPlayerAction(context: TutorialScenarioContext): string {
  const state = context.state;
  if (state.activeEffect?.abilityId === MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID) {
    return '请保留手牌中的 LIVE，在效果面板选择 2 张成员卡放入休息室并确认';
  }
  if (state.activeEffect?.abilityId === HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID) {
    return '请处理 LIVE 开始时能力，保留 LIVE 并选择 1 张成员卡放入休息室';
  }
  if (state.activeEffect?.abilityId === ELI_ACTIVATED_ABILITY_ID) {
    return '请从休息室选择费用 4「桂城 泉」加入手牌';
  }
  if (state.currentPhase === GamePhase.MULLIGAN_PHASE) return '请换掉教程指定的卡牌';
  if (state.currentPhase === GamePhase.MAIN_PHASE) {
    const liveCardId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD];
    const effectLiveCardId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD];
    if (state.players[0].successZone.cardIds.includes(effectLiveCardId)) {
      const recoveryMemberId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.RECOVERY_MEMBER];
      const memberCardId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.MEMBER_CARD];
      const player = state.players[0];
      if (player.memberSlots.slots[SlotPosition.LEFT] === recoveryMemberId) {
        return '请发动费用 2「绚濑绘里」的起动能力';
      }
      if (
        player.waitingRoom.cardIds.includes(recoveryMemberId) &&
        player.hand.cardIds.includes(memberCardId)
      ) {
        return '请用剩余 4 点能量让费用 4「桂城 泉」登场到左侧';
      }
      if (player.memberSlots.slots[SlotPosition.LEFT] === memberCardId) {
        return '请结束第三回合的主要阶段';
      }
      return '请让费用 2「绚濑绘里」登场到左侧';
    }
    if (state.players[0].successZone.cardIds.includes(liveCardId)) {
      const relayMemberId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.RELAY_MEMBER];
      if (playerCenterMemberId(context) === relayMemberId) return '请结束第二回合的主要阶段';
      return '请让指定的费用 9 成员换手登场到中央';
    }
    return playerCenterMemberId(context) ? '请结束自己的主要阶段' : '请让指定成员登场到中央';
  }
  if (state.currentSubPhase === SubPhase.LIVE_SET_FIRST_PLAYER) {
    const finalLiveOneId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_ONE];
    const finalLiveTwoId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO];
    if (
      state.players[0].successZone.cardIds.includes(
        context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
      )
    ) {
      if (!state.players[0].liveZone.cardIds.includes(finalLiveOneId)) {
        return '请先设置高亮的分数 1 LIVE';
      }
      if (!state.players[0].liveZone.cardIds.includes(finalLiveTwoId)) {
        return '请继续设置高亮的分数 2 LIVE';
      }
      return '请确认完成制胜 LIVE 配置';
    }
    return state.players[0].liveZone.cardIds.length > 0
      ? '请确认完成 LIVE 设置'
      : '请设置教程指定的 LIVE 卡';
  }
  if (state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) return '请确认规则计算的自动判定';
  if (state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM) return '请确认规则计算的分数';
  if (state.currentSubPhase === SubPhase.RESULT_ANIMATION) return '请确认本轮 LIVE 结果';
  if (state.currentSubPhase === SubPhase.RESULT_SETTLEMENT) return '请完成成功 LIVE 结算';
  return '对手正在行动，请等待教学继续';
}

function bootstrapFoundationsRound(controller: TutorialCheckpointBootstrapController): void {
  let context = controller.getContext();
  const playerId = context.playerId;
  const mulliganId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.MULLIGAN_CARD];
  const memberId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.MEMBER_CARD];
  const liveId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD];

  controller.executePlayerCommand(createMulliganCommand(playerId, [mulliganId]));
  controller.advanceScriptUntilBlocked();
  controller.executePlayerCommand(
    createPlayMemberToSlotCommand(playerId, memberId, SlotPosition.CENTER)
  );
  controller.executePlayerCommand(createEndPhaseCommand(playerId));
  controller.advanceScriptUntilBlocked();
  controller.executePlayerCommand(createSetLiveCardCommand(playerId, liveId, true));
  controller.executePlayerCommand(
    createConfirmStepCommand(playerId, SubPhase.LIVE_SET_FIRST_PLAYER)
  );
  controller.advanceScriptUntilBlocked();
  controller.executePlayerCommand(createSubmitJudgmentCommand(playerId, new Map()));
  controller.executePlayerCommand(
    createConfirmStepCommand(playerId, SubPhase.PERFORMANCE_JUDGMENT)
  );
  controller.advanceScriptUntilBlocked();
  controller.executePlayerCommand(createSubmitScoreCommand(playerId));
  controller.executePlayerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_ANIMATION));
  controller.executePlayerCommand(createSelectSuccessLiveCommand(playerId, liveId));
  controller.executePlayerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_SETTLEMENT));

  context = controller.getContext();
  if (
    context.state.turnCount !== 2 ||
    context.state.currentPhase !== GamePhase.MAIN_PHASE ||
    context.state.activePlayerIndex !== 0
  ) {
    throw new Error('基础教程检查点未进入第二回合主要阶段');
  }
}

function bootstrapLiveEffectsRound(controller: TutorialCheckpointBootstrapController): void {
  bootstrapFoundationsRound(controller);
  let context = controller.getContext();
  const playerId = context.playerId;
  const relayMemberId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.RELAY_MEMBER];
  const effectLiveCardId = context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD];

  controller.executePlayerCommand(
    createPlayMemberToSlotCommand(playerId, relayMemberId, SlotPosition.CENTER)
  );
  context = controller.getContext();
  const relayEffect = context.state.activeEffect;
  if (relayEffect?.abilityId !== MEMBER_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID) {
    throw new Error('换手登场能力没有进入预期处理步骤');
  }
  const relayDiscardIds = (relayEffect.selectableCardIds ?? [])
    .filter((cardId) => cardId !== effectLiveCardId)
    .slice(0, 2);
  if (relayDiscardIds.length !== 2) throw new Error('换手登场能力缺少可弃置手牌');
  controller.executePlayerCommand(
    createConfirmEffectStepCommand(
      playerId,
      relayEffect.id,
      undefined,
      undefined,
      undefined,
      undefined,
      relayDiscardIds
    )
  );
  controller.executePlayerCommand(createEndPhaseCommand(playerId));
  controller.advanceScriptUntilBlocked();
  controller.executePlayerCommand(createSetLiveCardCommand(playerId, effectLiveCardId, true));
  controller.executePlayerCommand(
    createConfirmStepCommand(playerId, SubPhase.LIVE_SET_FIRST_PLAYER)
  );
  controller.advanceScriptUntilBlocked();

  context = controller.getContext();
  const liveStartEffect = context.state.activeEffect;
  if (liveStartEffect?.abilityId !== HS_BP6_030_LIVE_START_DRAW_ONE_DISCARD_ONE_ABILITY_ID) {
    throw new Error('LIVE 开始能力没有进入预期处理步骤');
  }
  const liveStartDiscardId = liveStartEffect.selectableCardIds?.[0];
  if (!liveStartDiscardId) throw new Error('LIVE 开始能力缺少可弃置手牌');
  controller.executePlayerCommand(
    createConfirmEffectStepCommand(playerId, liveStartEffect.id, liveStartDiscardId)
  );
  controller.advanceScriptUntilBlocked();
  controller.executePlayerCommand(createSubmitJudgmentCommand(playerId, new Map()));
  controller.executePlayerCommand(
    createConfirmStepCommand(playerId, SubPhase.PERFORMANCE_JUDGMENT)
  );
  controller.advanceScriptUntilBlocked();
  controller.executePlayerCommand(createSubmitScoreCommand(playerId));
  controller.executePlayerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_ANIMATION));
  controller.executePlayerCommand(createSelectSuccessLiveCommand(playerId, effectLiveCardId));
  controller.executePlayerCommand(createConfirmStepCommand(playerId, SubPhase.RESULT_SETTLEMENT));

  context = controller.getContext();
  if (
    context.state.turnCount !== 3 ||
    context.state.currentPhase !== GamePhase.MAIN_PHASE ||
    context.state.activePlayerIndex !== 0
  ) {
    throw new Error('进阶教程检查点未进入第三回合主要阶段');
  }
}

function bootstrapFinalPlanningRound(controller: TutorialCheckpointBootstrapController): void {
  bootstrapLiveEffectsRound(controller);
  let context = controller.getContext();
  const checkpointStageMemberId =
    context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.CHECKPOINT_STAGE_MEMBER];

  controller.executePlayerCommand(
    createPlayMemberToSlotCommand(context.playerId, checkpointStageMemberId, SlotPosition.LEFT)
  );
  controller.executePlayerCommand(createEndPhaseCommand(context.playerId));
  controller.advanceScriptUntilBlocked();

  context = controller.getContext();
  if (
    context.state.turnCount !== 3 ||
    context.state.currentPhase !== GamePhase.LIVE_SET_PHASE ||
    context.state.currentSubPhase !== SubPhase.LIVE_SET_FIRST_PLAYER
  ) {
    throw new Error('制胜 LIVE 检查点未进入第三回合 LIVE 设置阶段');
  }
}

export function createBasicLiveTutorialScenario(
  registry: CardDataRegistry
): TutorialRuntimeScenarioDefinition {
  return {
    id: BASIC_LIVE_TUTORIAL_ID,
    version: BASIC_LIVE_TUTORIAL_VERSION,
    playerName: '教程玩家',
    opponentName: '练习对手',
    playerDeck: buildDeck(registry, buildOrderedPlayerCodes(), PLAYER_ENERGY_DECK_ORDER_SEED),
    opponentDeck: buildDeck(registry, buildOrderedOpponentCodes(), OPPONENT_ENERGY_DECK_ORDER_SEED),
    randomTape: {
      version: 'basic-live-loop-rng-v2',
      decisions: buildDecisionTape(),
    },
    checkpoints: [
      {
        id: TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS,
        entryStepId: 'welcome',
        validateState: (context) =>
          context.state.currentPhase === GamePhase.MULLIGAN_PHASE
            ? null
            : '基础章节没有停在换牌阶段',
      },
      {
        id: TUTORIAL_CHECKPOINT_IDS.LIVE_EFFECTS,
        entryStepId: 'advanced-welcome',
        bootstrap: bootstrapFoundationsRound,
        validateState: (context) => {
          const player = context.state.players[0];
          return context.state.turnCount === 2 &&
            context.state.currentPhase === GamePhase.MAIN_PHASE &&
            context.state.activePlayerIndex === 0 &&
            player.successZone.cardIds.includes(
              context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]
            ) &&
            player.hand.cardIds.includes(
              context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.RELAY_MEMBER]
            )
            ? null
            : '换手与 LIVE 能力章节没有停在第二回合主要阶段';
        },
      },
      {
        id: TUTORIAL_CHECKPOINT_IDS.RECOVERY_LOOP,
        entryStepId: 'third-turn-arrival',
        bootstrap: bootstrapLiveEffectsRound,
        validateState: (context) => {
          const player = context.state.players[0];
          return context.state.turnCount === 3 &&
            context.state.currentPhase === GamePhase.MAIN_PHASE &&
            context.state.activePlayerIndex === 0 &&
            player.successZone.cardIds.includes(
              context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
            ) &&
            player.hand.cardIds.includes(
              context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.RECOVERY_MEMBER]
            )
            ? null
            : '回收与再登场章节没有停在第三回合主要阶段';
        },
      },
      {
        id: TUTORIAL_CHECKPOINT_IDS.FINISHING_LIVE,
        entryStepId: 'count-final-stage-hearts',
        bootstrap: bootstrapFinalPlanningRound,
        validateState: (context) => {
          const player = context.state.players[0];
          const finalLiveRoles = [
            BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_ONE,
            BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO,
            BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_RISKY,
          ];
          return context.state.turnCount === 3 &&
            context.state.currentPhase === GamePhase.LIVE_SET_PHASE &&
            context.state.currentSubPhase === SubPhase.LIVE_SET_FIRST_PLAYER &&
            player.successZone.cardIds.length === 2 &&
            finalLiveRoles.every((role) => player.hand.cardIds.includes(context.roleCardIds[role]))
            ? null
            : '制胜 LIVE 章节没有停在预期的 Heart 规划状态';
        },
      },
    ],
    objectRoles: {
      [BASIC_LIVE_TUTORIAL_ROLES.MULLIGAN_CARD]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_MULLIGAN_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.MEMBER_CARD]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_MEMBER_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_LIVE_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.RELAY_MEMBER]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_RELAY_MEMBER_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_EFFECT_LIVE_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.RECOVERY_MEMBER]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_RECOVERY_MEMBER_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_ONE]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_FINAL_LIVE_ONE_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_FINAL_LIVE_TWO_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_RISKY]: {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_FINAL_LIVE_RISKY_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.CHECKPOINT_STAGE_MEMBER]: {
        ownerSeat: 'FIRST',
        cardCode: CHECKPOINT_STAGE_MEMBER_CODE,
        occurrence: 1,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SET_CARD]: {
        ownerSeat: 'SECOND',
        cardCode: OPPONENT_SET_CARD_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_MEMBER]: {
        ownerSeat: 'SECOND',
        cardCode: OPPONENT_SECOND_MEMBER_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]: {
        ownerSeat: 'SECOND',
        cardCode: OPPONENT_SECOND_LIVE_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_RELAY_MEMBER]: {
        ownerSeat: 'SECOND',
        cardCode: OPPONENT_RELAY_MEMBER_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_RELAY_MEMBER]: {
        ownerSeat: 'SECOND',
        cardCode: OPPONENT_FINAL_RELAY_MEMBER_CODE,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_THIRD_MEMBER]: {
        ownerSeat: 'SECOND',
        cardCode: OPPONENT_THIRD_MEMBER_CODE,
        occurrence: 2,
      },
      [BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]: {
        ownerSeat: 'SECOND',
        cardCode: OPPONENT_FINAL_SET_CARD_CODE,
      },
    },
    validateInitialState: (context) => {
      const playerHand = context.state.players[0].hand.cardIds;
      const playerRoles = [
        BASIC_LIVE_TUTORIAL_ROLES.MULLIGAN_CARD,
        BASIC_LIVE_TUTORIAL_ROLES.MEMBER_CARD,
        BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD,
      ];
      if (!playerRoles.every((role) => playerHand.includes(context.roleCardIds[role]))) {
        return '教程关键卡牌没有进入预期起手';
      }
      const opponentOpeningRoles = [
        BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SET_CARD,
        BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_MEMBER,
        BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE,
        BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_THIRD_MEMBER,
        BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD,
      ];
      return opponentOpeningRoles.every((role) =>
        context.state.players[1].hand.cardIds.includes(context.roleCardIds[role])
      )
        ? null
        : '教程对手的关键卡牌没有进入预期起手';
    },
    validatePlayerCommand: (context, command) =>
      commandMatchesPlayerMilestone(context, command)
        ? null
        : describeExpectedPlayerAction(context),
    scriptActions: [
      {
        id: 'opponent-mulligan',
        isReady: (context) => context.state.mulliganCompletedPlayers.includes(context.playerId),
        isComplete: (context) => context.state.currentPhase !== GamePhase.MULLIGAN_PHASE,
        createCommand: (context) => createMulliganCommand(context.opponentId, []),
      },
      {
        id: 'opponent-play-member',
        isReady: (context) =>
          context.state.currentPhase === GamePhase.MAIN_PHASE &&
          context.state.activePlayerIndex === 1,
        isComplete: (context) => opponentCenterMemberId(context) !== null,
        createCommand: (context) =>
          createPlayMemberToSlotCommand(
            context.opponentId,
            firstCardIdByCode(context.state, 1, OPPONENT_MEMBER_CODE),
            SlotPosition.CENTER
          ),
      },
      {
        id: 'opponent-end-main',
        isReady: (context) =>
          context.state.currentPhase === GamePhase.MAIN_PHASE &&
          context.state.activePlayerIndex === 1 &&
          opponentCenterMemberId(context) !== null,
        isComplete: (context) =>
          context.state.currentPhase === GamePhase.LIVE_SET_PHASE ||
          context.state.currentPhase === GamePhase.PERFORMANCE_PHASE,
        createCommand: (context) => createEndPhaseCommand(context.opponentId),
      },
      {
        id: 'opponent-set-card',
        isReady: (context) => context.state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER,
        isComplete: (context) => context.state.players[1].liveZone.cardIds.length > 0,
        createCommand: (context) =>
          createSetLiveCardCommand(
            context.opponentId,
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SET_CARD],
            true
          ),
      },
      {
        id: 'opponent-confirm-live-set',
        isReady: (context) =>
          context.state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER &&
          context.state.players[1].liveZone.cardIds.length > 0,
        isComplete: (context) =>
          context.state.currentPhase !== GamePhase.LIVE_SET_PHASE ||
          context.state.currentSubPhase !== SubPhase.LIVE_SET_SECOND_PLAYER,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.LIVE_SET_SECOND_PLAYER),
      },
      {
        id: 'system-confirm-player-live-start-window',
        actorSeat: 'FIRST',
        isReady: (context) =>
          context.state.currentPhase === GamePhase.PERFORMANCE_PHASE &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS &&
          !context.state.liveResolution.liveResults.has(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]
          ),
        isComplete: (context) =>
          (context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
            context.state.liveResolution.performingPlayerId === context.playerId) ||
          context.state.currentPhase === GamePhase.LIVE_RESULT_PHASE,
        createCommand: (context) =>
          createConfirmStepCommand(context.playerId, SubPhase.PERFORMANCE_LIVE_START_EFFECTS),
      },
      {
        id: 'system-confirm-first-success-effects',
        actorSeat: 'FIRST',
        isReady: (context) =>
          context.state.currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS ||
          context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM ||
          context.state.currentSubPhase === SubPhase.RESULT_ANIMATION ||
          context.state.currentSubPhase === SubPhase.RESULT_SETTLEMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.playerId, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS),
      },
      {
        id: 'opponent-confirm-second-success-effects',
        isReady: (context) =>
          context.state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM ||
          context.state.currentSubPhase === SubPhase.RESULT_ANIMATION ||
          context.state.currentSubPhase === SubPhase.RESULT_SETTLEMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS),
      },
      {
        id: 'opponent-confirm-score',
        isReady: (context) => context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM,
        isComplete: (context) =>
          context.state.liveResolution.scoreConfirmedBy.includes(context.opponentId),
        createCommand: (context) => createSubmitScoreCommand(context.opponentId),
      },
      {
        id: 'opponent-relay-second-center',
        isReady: (context) =>
          context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]
          ) &&
          !context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) &&
          context.state.currentPhase === GamePhase.MAIN_PHASE &&
          context.state.activePlayerIndex === 1 &&
          context.state.players[1].memberSlots.slots[SlotPosition.CENTER] !==
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_RELAY_MEMBER],
        isComplete: (context) =>
          context.state.players[1].memberSlots.slots[SlotPosition.CENTER] ===
          context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_RELAY_MEMBER],
        createCommand: (context) =>
          createPlayMemberToSlotCommand(
            context.opponentId,
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_RELAY_MEMBER],
            SlotPosition.CENTER
          ),
      },
      {
        id: 'opponent-play-second-member',
        isReady: (context) =>
          context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]
          ) &&
          !context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) &&
          context.state.currentPhase === GamePhase.MAIN_PHASE &&
          context.state.activePlayerIndex === 1 &&
          context.state.players[1].memberSlots.slots[SlotPosition.CENTER] ===
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_RELAY_MEMBER],
        isComplete: (context) =>
          context.state.players[1].memberSlots.slots[SlotPosition.LEFT] ===
          context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_MEMBER],
        createCommand: (context) =>
          createPlayMemberToSlotCommand(
            context.opponentId,
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_MEMBER],
            SlotPosition.LEFT
          ),
      },
      {
        id: 'opponent-end-second-main',
        isReady: (context) =>
          context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]
          ) &&
          !context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) &&
          context.state.currentPhase === GamePhase.MAIN_PHASE &&
          context.state.activePlayerIndex === 1 &&
          context.state.players[1].memberSlots.slots[SlotPosition.CENTER] ===
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_RELAY_MEMBER] &&
          context.state.players[1].memberSlots.slots[SlotPosition.LEFT] ===
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_MEMBER],
        isComplete: (context) =>
          context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]
          ) &&
          context.state.turnCount >= 2 &&
          (context.state.currentPhase === GamePhase.LIVE_SET_PHASE ||
            context.state.currentPhase === GamePhase.PERFORMANCE_PHASE ||
            context.state.currentPhase === GamePhase.LIVE_RESULT_PHASE),
        createCommand: (context) => createEndPhaseCommand(context.opponentId),
      },
      {
        id: 'opponent-set-second-live',
        isReady: (context) =>
          context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.LIVE_CARD]
          ) &&
          context.state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER &&
          !context.state.players[1].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]
          ),
        isComplete: (context) =>
          context.state.players[1].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]
          ),
        createCommand: (context) =>
          createSetLiveCardCommand(
            context.opponentId,
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE],
            true
          ),
      },
      {
        id: 'opponent-confirm-second-live-set',
        isReady: (context) =>
          context.state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER &&
          context.state.players[1].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]
          ),
        isComplete: (context) =>
          context.state.currentPhase !== GamePhase.LIVE_SET_PHASE ||
          context.state.currentSubPhase !== SubPhase.LIVE_SET_SECOND_PLAYER,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.LIVE_SET_SECOND_PLAYER),
      },
      {
        id: 'system-confirm-second-live-start-window',
        actorSeat: 'FIRST',
        isReady: (context) =>
          context.state.players[0].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.players[0].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) &&
          (context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT ||
            context.state.currentPhase === GamePhase.LIVE_RESULT_PHASE),
        createCommand: (context) =>
          createConfirmStepCommand(context.playerId, SubPhase.PERFORMANCE_LIVE_START_EFFECTS),
      },
      {
        id: 'opponent-confirm-second-live-start-window',
        isReady: (context) =>
          context.state.currentPhase === GamePhase.PERFORMANCE_PHASE &&
          context.state.activePlayerIndex === 1 &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS &&
          context.state.players[1].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]
          ) &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.activePlayerIndex === 1 &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.PERFORMANCE_LIVE_START_EFFECTS),
      },
      {
        id: 'opponent-submit-second-judgment',
        isReady: (context) =>
          context.state.activePlayerIndex === 1 &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
          !context.state.liveResolution.liveResults.has(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]
          ),
        isComplete: (context) =>
          context.state.liveResolution.liveResults.has(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]
          ),
        createCommand: (context) => createSubmitJudgmentCommand(context.opponentId, new Map()),
      },
      {
        id: 'opponent-confirm-second-judgment',
        isReady: (context) =>
          context.state.activePlayerIndex === 1 &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
          context.state.liveResolution.liveResults.has(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_SECOND_LIVE]
          ),
        isComplete: (context) =>
          context.state.currentPhase !== GamePhase.PERFORMANCE_PHASE ||
          context.state.activePlayerIndex !== 1 ||
          context.state.currentSubPhase !== SubPhase.PERFORMANCE_JUDGMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.PERFORMANCE_JUDGMENT),
      },
      {
        id: 'system-confirm-second-round-first-success-effects',
        actorSeat: 'FIRST',
        isReady: (context) =>
          context.state.liveResolution.liveResults.get(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) === true &&
          context.state.currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.liveResolution.liveResults.get(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) === true &&
          (context.state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS ||
            context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM ||
            context.state.currentSubPhase === SubPhase.RESULT_ANIMATION ||
            context.state.currentSubPhase === SubPhase.RESULT_SETTLEMENT),
        createCommand: (context) =>
          createConfirmStepCommand(context.playerId, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS),
      },
      {
        id: 'opponent-confirm-second-round-success-effects',
        isReady: (context) =>
          context.state.liveResolution.liveResults.get(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) === true &&
          context.state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.liveResolution.liveResults.get(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) === true &&
          (context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM ||
            context.state.currentSubPhase === SubPhase.RESULT_ANIMATION ||
            context.state.currentSubPhase === SubPhase.RESULT_SETTLEMENT),
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS),
      },
      {
        id: 'opponent-confirm-second-round-score',
        isReady: (context) =>
          context.state.liveResolution.liveResults.get(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) === true && context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM,
        isComplete: (context) =>
          context.state.liveResolution.liveResults.get(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) === true && context.state.liveResolution.scoreConfirmedBy.includes(context.opponentId),
        createCommand: (context) => createSubmitScoreCommand(context.opponentId),
      },
      {
        id: 'opponent-relay-third-center',
        isReady: (context) =>
          context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) &&
          context.state.turnCount >= 3 &&
          context.state.currentPhase === GamePhase.MAIN_PHASE &&
          context.state.activePlayerIndex === 1 &&
          context.state.players[1].memberSlots.slots[SlotPosition.CENTER] !==
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_RELAY_MEMBER],
        isComplete: (context) =>
          context.state.players[1].memberSlots.slots[SlotPosition.CENTER] ===
          context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_RELAY_MEMBER],
        createCommand: (context) =>
          createPlayMemberToSlotCommand(
            context.opponentId,
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_RELAY_MEMBER],
            SlotPosition.CENTER
          ),
      },
      {
        id: 'opponent-play-third-member',
        isReady: (context) =>
          context.state.players[0].successZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.EFFECT_LIVE_CARD]
          ) &&
          context.state.turnCount >= 3 &&
          context.state.currentPhase === GamePhase.MAIN_PHASE &&
          context.state.activePlayerIndex === 1 &&
          context.state.players[1].memberSlots.slots[SlotPosition.CENTER] ===
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_RELAY_MEMBER],
        isComplete: (context) =>
          context.state.players[1].memberSlots.slots[SlotPosition.RIGHT] ===
          context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_THIRD_MEMBER],
        createCommand: (context) =>
          createPlayMemberToSlotCommand(
            context.opponentId,
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_THIRD_MEMBER],
            SlotPosition.RIGHT
          ),
      },
      {
        id: 'opponent-end-third-main',
        isReady: (context) =>
          context.state.currentPhase === GamePhase.MAIN_PHASE &&
          context.state.activePlayerIndex === 1 &&
          context.state.players[1].memberSlots.slots[SlotPosition.CENTER] ===
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_RELAY_MEMBER] &&
          context.state.players[1].memberSlots.slots[SlotPosition.RIGHT] ===
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_THIRD_MEMBER],
        isComplete: (context) =>
          context.state.currentPhase === GamePhase.LIVE_SET_PHASE ||
          context.state.currentPhase === GamePhase.PERFORMANCE_PHASE,
        createCommand: (context) => createEndPhaseCommand(context.opponentId),
      },
      {
        id: 'opponent-set-final-card',
        isReady: (context) => context.state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER,
        isComplete: (context) =>
          context.state.players[1].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]
          ),
        createCommand: (context) =>
          createSetLiveCardCommand(
            context.opponentId,
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD],
            true
          ),
      },
      {
        id: 'opponent-confirm-final-live-set',
        isReady: (context) =>
          context.state.currentSubPhase === SubPhase.LIVE_SET_SECOND_PLAYER &&
          context.state.players[1].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]
          ),
        isComplete: (context) =>
          context.state.currentPhase !== GamePhase.LIVE_SET_PHASE ||
          context.state.currentSubPhase !== SubPhase.LIVE_SET_SECOND_PLAYER,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.LIVE_SET_SECOND_PLAYER),
      },
      {
        id: 'system-confirm-final-live-start-window',
        actorSeat: 'FIRST',
        isReady: (context) =>
          context.state.currentPhase === GamePhase.PERFORMANCE_PHASE &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS &&
          context.state.liveResolution.performingPlayerId === context.playerId &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null &&
          context.state.players[0].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO]
          ),
        isComplete: (context) =>
          context.state.liveResolution.performingPlayerId === context.playerId &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.playerId, SubPhase.PERFORMANCE_LIVE_START_EFFECTS),
      },
      {
        id: 'opponent-confirm-final-live-start-window',
        isReady: (context) =>
          context.state.currentPhase === GamePhase.PERFORMANCE_PHASE &&
          context.state.activePlayerIndex === 1 &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS &&
          context.state.players[1].liveZone.cardIds.includes(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]
          ) &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.activePlayerIndex === 1 &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.PERFORMANCE_LIVE_START_EFFECTS),
      },
      {
        id: 'opponent-submit-final-judgment',
        isReady: (context) =>
          context.state.activePlayerIndex === 1 &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
          !context.state.liveResolution.liveResults.has(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]
          ),
        isComplete: (context) =>
          context.state.liveResolution.liveResults.has(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]
          ),
        createCommand: (context) => createSubmitJudgmentCommand(context.opponentId, new Map()),
      },
      {
        id: 'opponent-confirm-final-judgment',
        isReady: (context) =>
          context.state.activePlayerIndex === 1 &&
          context.state.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
          context.state.liveResolution.liveResults.has(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.OPPONENT_FINAL_SET_CARD]
          ),
        isComplete: (context) =>
          context.state.currentPhase !== GamePhase.PERFORMANCE_PHASE ||
          context.state.activePlayerIndex !== 1 ||
          context.state.currentSubPhase !== SubPhase.PERFORMANCE_JUDGMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.PERFORMANCE_JUDGMENT),
      },
      {
        id: 'system-confirm-final-first-success-effects',
        actorSeat: 'FIRST',
        isReady: (context) =>
          context.state.liveResolution.liveResults.get(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO]
          ) === true &&
          context.state.currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS ||
          context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM ||
          context.state.currentSubPhase === SubPhase.RESULT_ANIMATION ||
          context.state.currentSubPhase === SubPhase.RESULT_SETTLEMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.playerId, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS),
      },
      {
        id: 'opponent-confirm-final-success-effects',
        isReady: (context) =>
          context.state.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS &&
          context.state.pendingAbilities.length === 0 &&
          context.state.activeEffect === null,
        isComplete: (context) =>
          context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM ||
          context.state.currentSubPhase === SubPhase.RESULT_ANIMATION ||
          context.state.currentSubPhase === SubPhase.RESULT_SETTLEMENT,
        createCommand: (context) =>
          createConfirmStepCommand(context.opponentId, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS),
      },
      {
        id: 'opponent-confirm-final-score',
        isReady: (context) =>
          context.state.currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM &&
          context.state.liveResolution.liveResults.get(
            context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO]
          ) === true,
        isComplete: (context) =>
          context.state.liveResolution.scoreConfirmedBy.includes(context.opponentId),
        createCommand: (context) => createSubmitScoreCommand(context.opponentId),
      },
    ],
    isComplete: (context) => {
      return (
        context.state.currentPhase === GamePhase.GAME_END &&
        context.state.endInfo?.winnerId === context.playerId &&
        context.state.players[0].successZone.cardIds.includes(
          context.roleCardIds[BASIC_LIVE_TUTORIAL_ROLES.FINAL_LIVE_TWO]
        ) &&
        context.state.players[0].successZone.cardIds.length >= 3 &&
        context.state.activeEffect === null &&
        context.state.pendingAbilities.length === 0
      );
    },
  };
}

export function assertBasicLiveTutorialResult(state: GameState): string | null {
  const player = state.players[0];
  const opponent = state.players[1];
  const playerLiveId = firstCardIdByCode(state, 0, PLAYER_LIVE_CODE);
  if (!player.successZone.cardIds.includes(playerLiveId)) return '指定 LIVE 未进入成功区';
  if (opponent.successZone.cardIds.length > 0) return '脚本对手不应获得成功 LIVE';
  if (state.currentPhase !== GamePhase.GAME_END || state.endInfo?.winnerId !== player.id) {
    return '第三张成功 LIVE 没有触发教程玩家胜利';
  }
  if (player.successZone.cardIds.length < 3) return '成功 LIVE 数量未达到 3 张';
  const center = player.memberSlots.slots[SlotPosition.CENTER];
  if (!center) return '教程成员未保留在中央舞台';
  const left = player.memberSlots.slots[SlotPosition.LEFT];
  if (!left || state.cardRegistry.get(left)?.data.cardCode !== PLAYER_MEMBER_CODE) {
    return '回收的费用 4 成员没有重新登场到左侧';
  }
  const energyWaitingCount = [...player.energyZone.cardStates.values()].filter(
    (cardState) => cardState.orientation === OrientationState.WAITING
  ).length;
  return energyWaitingCount === 6 ? null : '第三回合的 6 点能量没有按费用 2 加费用 4 支付';
}
