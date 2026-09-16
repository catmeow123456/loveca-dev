import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import {
  MAKI_ON_ENTER_ABILITY_ID,
  PL_PB2_014_ON_ENTER_REVEAL_LILY_WHITE_LIVE_SWAP_SUCCESS_CARD_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  revealHandCardForActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  placeHandLiveCardInSuccessZoneForPlayer,
  returnSuccessZoneCardToHandForPlayer,
} from '../../runtime/success-zone.js';
import { and, typeIs, unitAliasIs, type CardSelector } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { startSuccessZoneReplacementEffect } from '../cards/pl-bp6-024-sakkaku-crossroads.js';

// 旧能力的持久化 step identity 保持不变；文件和注册 ownership 已晋升为 shared family。
export const MAKI_SELECT_HAND_LIVE_STEP_ID = 'MAKI_SELECT_HAND_LIVE';
export const MAKI_SELECT_SUCCESS_LIVE_STEP_ID = 'MAKI_SELECT_SUCCESS_LIVE';
const AFTER_REVEAL_STEP_ID = 'REVEAL_HAND_LIVE_SWAP_AFTER_REVEAL';

interface SwapConfig {
  readonly abilityId: string;
  readonly handSelector: CardSelector;
  readonly handStepId: string;
  readonly successStepId: string;
  readonly revealSelectionLabel: string;
}
const CONFIGS: readonly SwapConfig[] = [
  {
    abilityId: MAKI_ON_ENTER_ABILITY_ID,
    handSelector: typeIs(CardType.LIVE),
    handStepId: MAKI_SELECT_HAND_LIVE_STEP_ID,
    successStepId: MAKI_SELECT_SUCCESS_LIVE_STEP_ID,
    revealSelectionLabel: '请选择要公开的手牌LIVE卡',
  },
  {
    abilityId: PL_PB2_014_ON_ENTER_REVEAL_LILY_WHITE_LIVE_SWAP_SUCCESS_CARD_ABILITY_ID,
    handSelector: and(typeIs(CardType.LIVE), unitAliasIs('lily white')),
    handStepId: 'PL_PB2_014_SELECT_HAND_LIVE',
    successStepId: 'PL_PB2_014_SELECT_SUCCESS_CARD',
    revealSelectionLabel: '请选择要公开的手牌『lily white』LIVE卡',
  },
];
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerRevealHandLiveSwapSuccessCardWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startSelection(game, ability, options.orderedResolution === true, config)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.handStepId,
      (game, input, context) =>
        input.selectedCardId
          ? revealHandLive(game, input.selectedCardId, config)
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects),
      queryCardSelection
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      AFTER_REVEAL_STEP_ID,
      (game, _input, context) =>
        selectSuccessCardAfterReveal(game, config, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.successStepId,
      (game, input, context) =>
        input.selectedCardId
          ? finishSwap(game, input.selectedCardId, context.continuePendingCardEffects)
          : game,
      queryCardSelection
    );
  }
}

function startSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: SwapConfig
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  // 公开是可选费用。后续没有成功区目标或公开卡不能进入成功区，均不妨碍合法公开。
  const selectableCardIds = getCardIdsInZoneMatching(
    game,
    player.id,
    ZoneType.HAND,
    (card) => card.ownerId === player.id && config.handSelector(card)
  );
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.handStepId,
      stepText: getAbilityEffectText(config.abilityId),
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: config.revealSelectionLabel,
      confirmSelectionLabel: '公开',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      pendingAbilityId: ability.id,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HAND_LIVE',
      selectableCardIds,
    },
  });
}

function revealHandLive(game: GameState, handLiveCardId: string, config: SwapConfig): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    !getCardIdsInZoneMatching(
      game,
      effect.controllerId,
      ZoneType.HAND,
      (card) => card.ownerId === effect.controllerId && config.handSelector(card)
    ).includes(handLiveCardId)
  )
    return game;
  return revealHandCardForActiveEffect(game, {
    effect,
    playerId: effect.controllerId,
    selectedCardId: handLiveCardId,
    nextStepId: AFTER_REVEAL_STEP_ID,
    nextStepText:
      '已公开1张手牌LIVE卡。展示结束后，选择成功LIVE卡区的1张卡片加入手牌，再放置所公开的卡片。',
    metadata: { handLiveCardId },
    actionStep: 'REVEAL_HAND_LIVE',
    actionPayload: { handLiveCardId },
  });
}

function selectSuccessCardAfterReveal(
  game: GameState,
  config: SwapConfig,
  continuePending: Continue
): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  const selectableCardIds = getCardIdsInZoneMatching(
    game,
    effect.controllerId,
    ZoneType.SUCCESS_ZONE,
    (card) => card.ownerId === effect.controllerId
  );
  if (selectableCardIds.length === 0) return finishSkippedActiveEffect(game, continuePending);
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: config.successStepId,
      stepText: '请选择成功LIVE卡区的1张卡片加入手牌。如此做时，将所公开的卡片放置入成功LIVE卡区。',
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择要加入手牌的成功LIVE卡区卡片',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
    },
  };
}

function finishSwap(
  game: GameState,
  successLiveCardId: string,
  continuePending: Continue
): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(successLiveCardId)) return game;
  const handLiveCardId =
    typeof effect.metadata?.handLiveCardId === 'string' ? effect.metadata.handLiveCardId : null;
  if (handLiveCardId === null) return finishSkippedActiveEffect(game, continuePending);
  let state = returnSuccessZoneCardToHandForPlayer(game, effect.controllerId, successLiveCardId);
  if (state === null) return finishSkippedActiveEffect(game, continuePending);
  // “如此做时”依赖实际回手；回手已经发生，不受后续卡离开手牌或成功区禁入反向影响。
  const replacementState = startSuccessZoneReplacementEffect(state, {
    controllerId: effect.controllerId,
    originalCardId: handLiveCardId,
    origin: 'HAND_LIVE_SUCCESS_CARD_SWAP',
    successLiveCardId,
  });
  if (replacementState !== null) return replacementState;
  state =
    placeHandLiveCardInSuccessZoneForPlayer(state, effect.controllerId, handLiveCardId) ?? state;
  return continuePending(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      handLiveCardId,
      successLiveCardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}
