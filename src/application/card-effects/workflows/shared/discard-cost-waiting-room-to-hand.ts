import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, GamePhase, HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  N_SD1_005_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID,
  N_SD1_007_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  PL_PR_003_ACTIVATED_DISCARD_TWO_RECOVER_YELLOW_THREE_LIVE_ABILITY_ID,
  PL_PR_004_ACTIVATED_DISCARD_TWO_RECOVER_PINK_THREE_LIVE_ABILITY_ID,
  PL_N_BP1_008_ACTIVATED_DISCARD_MEMBER_RECOVER_LOWER_COST_MEMBER_ABILITY_ID,
  S_SD1_007_ACTIVATED_DISCARD_RECOVER_SCORE_AQOURS_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import {
  and,
  groupAliasIs,
  groupIs,
  hasScoreBladeHeart,
  liveRequiresPrintedHeartColorAtLeast,
  typeIs,
  type CardSelector,
} from '../../../effects/card-selectors.js';
import { successLiveScoreAtLeast } from '../../../effects/conditions.js';
import { type EffectCostDefinition } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { finishWaitingRoomToHandWorkflow } from './waiting-room-to-hand.js';

const SELECT_WAITING_ROOM_CARD_STEP_ID = 'SELECT_WAITING_ROOM_CARD';
const BP4_002_SELECT_DISCARD_STEP_ID = 'BP4_002_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID = 'BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE';
const S_SD1_007_SELECT_DISCARD_STEP_ID = 'S_SD1_007_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const S_SD1_007_SELECT_WAITING_ROOM_SCORE_AQOURS_LIVE_STEP_ID =
  'S_SD1_007_SELECT_WAITING_ROOM_SCORE_AQOURS_LIVE';
const PL_PR_003_SELECT_DISCARD_STEP_ID = 'PL_PR_003_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const PL_PR_003_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'PL_PR_003_SELECT_WAITING_ROOM_YELLOW_THREE_LIVE';
const PL_PR_004_SELECT_DISCARD_STEP_ID = 'PL_PR_004_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const PL_PR_004_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'PL_PR_004_SELECT_WAITING_ROOM_PINK_THREE_LIVE';
const PL_N_BP1_008_SELECT_DISCARD_MEMBER_STEP_ID =
  'PL_N_BP1_008_SELECT_HAND_MEMBER_TO_DISCARD';
const PL_N_BP1_008_SELECT_LOWER_COST_MEMBER_STEP_ID =
  'PL_N_BP1_008_SELECT_WAITING_ROOM_LOWER_COST_MEMBER';
const N_SD1_005_SELECT_DISCARD_STEP_ID = 'N_SD1_005_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const N_SD1_005_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'N_SD1_005_SELECT_WAITING_ROOM_NIJIGASAKI_MEMBER';
const N_SD1_007_SELECT_DISCARD_STEP_ID = 'N_SD1_007_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const N_SD1_007_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'N_SD1_007_SELECT_WAITING_ROOM_NIJIGASAKI_LIVE';

type RecoveryRule =
  | { readonly kind: 'STATIC_SELECTOR'; readonly selector: CardSelector }
  | { readonly kind: 'LOWER_PRINTED_COST_THAN_DISCARDED_MEMBER' };

interface DiscardCostWaitingRoomToHandWorkflowConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly discardStepId: string;
  readonly recoveryStepId: string;
  readonly discardCount: number;
  readonly discardSelector?: CardSelector;
  readonly discardStepText?: string;
  readonly discardSelectionLabel?: string;
  readonly recoveryRule: RecoveryRule;
  readonly recoveryStepText: string;
  readonly recoverySelectionLabel?: string;
  readonly recoveryConfirmSelectionLabel?: string;
  readonly canActivate?: (game: GameState, playerId: string) => boolean;
  readonly recoverySelectionRequiredWhenHasTargets?: boolean;
  readonly finishWhenNoRecoveryTargets?: boolean;
  readonly recordUseAfterDiscard?: boolean;
  readonly revalidateSourceBeforeDiscard?: boolean;
  readonly canDeclineDiscardSelection?: boolean;
}

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const BP4_002_DISCARD_RECOVER_WORKFLOW: DiscardCostWaitingRoomToHandWorkflowConfig = {
  abilityId: BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  expectedBaseCardCodes: ['PL!-bp4-002'],
  discardStepId: BP4_002_SELECT_DISCARD_STEP_ID,
  recoveryStepId: BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
  discardCount: 2,
  recoveryRule: { kind: 'STATIC_SELECTOR', selector: and(typeIs(CardType.LIVE), groupIs("μ's")) },
  recoveryStepText: "请选择自己的休息室中1张『μ's』的LIVE卡加入手牌。",
  canActivate: (game, playerId) => successLiveScoreAtLeast(game, playerId, 6),
  recoverySelectionRequiredWhenHasTargets: true,
};

const DISCARD_COST_WAITING_ROOM_TO_HAND_WORKFLOWS: readonly DiscardCostWaitingRoomToHandWorkflowConfig[] = [
  BP4_002_DISCARD_RECOVER_WORKFLOW,
  {
    abilityId: PL_PR_003_ACTIVATED_DISCARD_TWO_RECOVER_YELLOW_THREE_LIVE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-PR-003'],
    discardStepId: PL_PR_003_SELECT_DISCARD_STEP_ID,
    recoveryStepId: PL_PR_003_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    discardCount: 2,
    recoveryRule: {
      kind: 'STATIC_SELECTOR',
      selector: and(
        typeIs(CardType.LIVE),
        liveRequiresPrintedHeartColorAtLeast(HeartColor.YELLOW, 3)
      ),
    },
    recoveryStepText:
      '请选择自己的休息室中1张必要HEART中含有大于等于3个[黄ハート]的LIVE卡加入手牌。',
    recoverySelectionLabel: '选择要加入手牌的LIVE卡',
    recoveryConfirmSelectionLabel: '加入手牌',
    recoverySelectionRequiredWhenHasTargets: true,
  },
  {
    abilityId: PL_PR_004_ACTIVATED_DISCARD_TWO_RECOVER_PINK_THREE_LIVE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-PR-004'],
    discardStepId: PL_PR_004_SELECT_DISCARD_STEP_ID,
    recoveryStepId: PL_PR_004_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    discardCount: 2,
    recoveryRule: {
      kind: 'STATIC_SELECTOR',
      selector: and(
        typeIs(CardType.LIVE),
        liveRequiresPrintedHeartColorAtLeast(HeartColor.PINK, 3)
      ),
    },
    recoveryStepText:
      '请选择自己的休息室中1张必要HEART中含有大于等于3个[桃ハート]的LIVE卡加入手牌。',
    recoverySelectionLabel: '选择要加入手牌的LIVE卡',
    recoveryConfirmSelectionLabel: '加入手牌',
    recoverySelectionRequiredWhenHasTargets: true,
  },
  {
    abilityId: S_SD1_007_ACTIVATED_DISCARD_RECOVER_SCORE_AQOURS_LIVE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!S-sd1-007'],
    discardStepId: S_SD1_007_SELECT_DISCARD_STEP_ID,
    recoveryStepId: S_SD1_007_SELECT_WAITING_ROOM_SCORE_AQOURS_LIVE_STEP_ID,
    discardCount: 2,
    recoveryRule: {
      kind: 'STATIC_SELECTOR',
      selector: and(typeIs(CardType.LIVE), groupAliasIs('Aqours'), hasScoreBladeHeart()),
    },
    recoveryStepText:
      '请选择自己的休息室中1张持有 SCORE 图标的『Aqours』LIVE卡加入手牌。',
    recoverySelectionRequiredWhenHasTargets: true,
  },
  {
    abilityId: PL_N_BP1_008_ACTIVATED_DISCARD_MEMBER_RECOVER_LOWER_COST_MEMBER_ABILITY_ID,
    expectedBaseCardCodes: ['PL!N-bp1-008'],
    discardStepId: PL_N_BP1_008_SELECT_DISCARD_MEMBER_STEP_ID,
    recoveryStepId: PL_N_BP1_008_SELECT_LOWER_COST_MEMBER_STEP_ID,
    discardCount: 1,
    discardSelector: typeIs(CardType.MEMBER),
    discardStepText: '请选择1张成员卡放置入休息室。',
    discardSelectionLabel: '选择要放置入休息室的成员卡',
    recoveryRule: { kind: 'LOWER_PRINTED_COST_THAN_DISCARDED_MEMBER' },
    recoveryStepText: '请选择自己的休息室中1张费用更低的成员卡加入手牌。',
    recoverySelectionLabel: '选择要加入手牌的成员卡',
    recoveryConfirmSelectionLabel: '加入手牌',
    recoverySelectionRequiredWhenHasTargets: true,
    finishWhenNoRecoveryTargets: true,
    recordUseAfterDiscard: true,
    revalidateSourceBeforeDiscard: true,
    canDeclineDiscardSelection: true,
  },
  {
    abilityId: N_SD1_005_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID,
    expectedBaseCardCodes: ['PL!N-sd1-005'],
    discardStepId: N_SD1_005_SELECT_DISCARD_STEP_ID,
    recoveryStepId: N_SD1_005_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    discardCount: 2,
    recoveryRule: {
      kind: 'STATIC_SELECTOR',
      selector: and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲')),
    },
    recoveryStepText: '请选择自己的休息室中1张『虹咲』的成员卡加入手牌。',
    recoverySelectionLabel: '选择要加入手牌的虹咲成员卡',
    recoveryConfirmSelectionLabel: '加入手牌',
    recoverySelectionRequiredWhenHasTargets: true,
    finishWhenNoRecoveryTargets: true,
  },
  {
    abilityId: N_SD1_007_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!N-sd1-007'],
    discardStepId: N_SD1_007_SELECT_DISCARD_STEP_ID,
    recoveryStepId: N_SD1_007_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    discardCount: 2,
    recoveryRule: {
      kind: 'STATIC_SELECTOR',
      selector: and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲')),
    },
    recoveryStepText: '请选择自己的休息室中1张『虹咲』的LIVE卡加入手牌。',
    recoverySelectionLabel: '选择要加入手牌的虹咲LIVE卡',
    recoveryConfirmSelectionLabel: '加入手牌',
    recoverySelectionRequiredWhenHasTargets: true,
    finishWhenNoRecoveryTargets: true,
  },
];

export function registerDiscardCostWaitingRoomToHandWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of DISCARD_COST_WAITING_ROOM_TO_HAND_WORKFLOWS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      startDiscardCostWaitingRoomToHandWorkflow(game, playerId, cardId, config)
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.discardStepId,
      (game, input, context) => {
        if (input.selectedCardId === null && config.canDeclineDiscardSelection) {
          return finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_COST',
          });
        }
        const selectedCardIds =
          input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : undefined);
        return selectedCardIds
          ? startDiscardCostWaitingRoomRecoveryAfterDiscard(
              game,
              selectedCardIds,
              config,
              deps.enqueueTriggeredCardEffects,
              context.continuePendingCardEffects
            )
          : game;
      }
    );
    registerActiveEffectStepHandler(config.abilityId, config.recoveryStepId, (game, input, context) =>
      finishConfiguredWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        config,
        context.continuePendingCardEffects
      )
    );
  }
}

function startDiscardCostWaitingRoomToHandWorkflow(
  game: GameState,
  playerId: string,
  cardId: string,
  config: DiscardCostWaitingRoomToHandWorkflowConfig
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const selectableDiscardCardIds =
    player?.hand.cardIds.filter((candidateId) => {
      const candidate = getCardById(game, candidateId);
      return candidate !== null && (!config.discardSelector || config.discardSelector(candidate));
    }) ?? [];
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !config.expectedBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    ) ||
    !isMemberCardData(sourceCard.data) ||
    !findMemberSlot(player, cardId) ||
    selectableDiscardCardIds.length < config.discardCount ||
    config.canActivate?.(game, player.id) === false
  ) {
    return game;
  }

  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: config.discardCount,
    maxCount: config.discardCount,
    optional: false,
  };
  const state = config.recordUseAfterDiscard
    ? game
    : recordAbilityUseForContext(game, player.id, {
        abilityId: config.abilityId,
        sourceCardId: cardId,
      });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.discardStepId,
        stepText: config.discardStepText ?? `请选择${config.discardCount}张手牌放置入休息室。`,
        awaitingPlayerId: player.id,
        selectableCardIds: selectableDiscardCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: config.discardCount === 1 ? 'SINGLE' : 'ORDERED_MULTI',
        minSelectableCards: config.discardCount,
        maxSelectableCards: config.discardCount,
        selectionLabel:
          config.discardSelectionLabel ?? `选择要放置入休息室的${config.discardCount}张手牌`,
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: config.canDeclineDiscardSelection === true,
        skipSelectionLabel: config.canDeclineDiscardSelection ? '不发动' : undefined,
        metadata: {
          effectCosts: [discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
          discardCount: config.discardCount,
          recoveryStepId: config.recoveryStepId,
          recoverySelectionRequiredWhenHasTargets:
            config.recoverySelectionRequiredWhenHasTargets === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: config.abilityId,
      sourceCardId: cardId,
      step: 'START_SELECT_DISCARD',
      discardCount: config.discardCount,
      selectableCardIds: selectableDiscardCardIds,
    }
  );
}

function startDiscardCostWaitingRoomRecoveryAfterDiscard(
  game: GameState,
  selectedCardIds: readonly string[],
  config: DiscardCostWaitingRoomToHandWorkflowConfig,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceCard = getCardById(game, effect.sourceCardId);
  const discardCount =
    typeof effect.metadata?.discardCount === 'number' ? effect.metadata.discardCount : 0;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    (config.revalidateSourceBeforeDiscard &&
      (!sourceCard ||
        sourceCard.ownerId !== player.id ||
        !isMemberCardData(sourceCard.data) ||
        !findMemberSlot(player, effect.sourceCardId))) ||
    discardCount <= 0 ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== discardCount ||
    !uniqueSelectedCardIds.every(
      (selectedCardId) =>
        effect.selectableCardIds?.includes(selectedCardId) === true &&
        player.hand.cardIds.includes(selectedCardId) &&
        (() => {
          const selectedCard = getCardById(game, selectedCardId);
          return selectedCard !== null &&
            (!config.discardSelector || config.discardSelector(selectedCard));
        })()
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: discardCount,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const discardedMemberPrintedCost =
    config.recoveryRule.kind === 'LOWER_PRINTED_COST_THAN_DISCARDED_MEMBER'
      ? (() => {
          const discardedCard = getCardById(game, uniqueSelectedCardIds[0]!);
          return discardedCard && isMemberCardData(discardedCard.data)
            ? discardedCard.data.cost
            : null;
        })()
      : null;
  if (
    config.recoveryRule.kind === 'LOWER_PRINTED_COST_THAN_DISCARDED_MEMBER' &&
    discardedMemberPrintedCost === null
  ) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(
    discardResult.gameState,
    player.id,
    createRecoverySelector(player.id, config.recoveryRule, discardedMemberPrintedCost)
  );
  const payCostPayload = {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
    discardedMemberPrintedCost,
    selectableCardIds,
  };
  const stateAfterCostAndUse = config.recordUseAfterDiscard
    ? recordAbilityUseForContext(
        recordPayCostAction(discardResult.gameState, player.id, payCostPayload),
        player.id,
        { abilityId: config.abilityId, sourceCardId: effect.sourceCardId }
      )
    : config.finishWhenNoRecoveryTargets && selectableCardIds.length === 0
      ? recordPayCostAction(discardResult.gameState, player.id, payCostPayload)
      : discardResult.gameState;
  if (config.finishWhenNoRecoveryTargets && selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCostAndUse, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_HAND_NO_RECOVERY_TARGET',
        result: 'NO_RECOVERY_TARGET',
        discardedHandCardIds: discardResult.discardedCardIds,
        selectableCardIds,
      }),
      false
    );
  }
  const selectionRequired =
    effect.metadata?.recoverySelectionRequiredWhenHasTargets === true &&
    selectableCardIds.length > 0;
  const recoveryStepId =
    typeof effect.metadata?.recoveryStepId === 'string'
      ? effect.metadata.recoveryStepId
      : SELECT_WAITING_ROOM_CARD_STEP_ID;
  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: selectionRequired ? 1 : 0,
    optional: !selectionRequired,
  });

  const stateWithRecoveryEffect: GameState = {
      ...stateAfterCostAndUse,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: recoveryStepId,
        stepText: config.recoveryStepText,
        selectionLabel: config.recoverySelectionLabel,
        confirmSelectionLabel: config.recoveryConfirmSelectionLabel,
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          discardedHandCardIds: discardResult.discardedCardIds,
          discardedMemberPrintedCost,
        },
        zoneSelection,
      }),
    };
  return config.recordUseAfterDiscard
    ? stateWithRecoveryEffect
    : addAction(stateWithRecoveryEffect, 'PAY_COST', player.id, payCostPayload);
}

function createRecoverySelector(
  playerId: string,
  rule: RecoveryRule,
  discardedMemberPrintedCost: number | null
): CardSelector {
  return (card) => {
    if (card.ownerId !== playerId) return false;
    if (rule.kind === 'STATIC_SELECTOR') return rule.selector(card);
    return (
      discardedMemberPrintedCost !== null &&
      isMemberCardData(card.data) &&
      card.data.cost < discardedMemberPrintedCost
    );
  };
}

function finishConfiguredWaitingRoomToHandWorkflow(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  config: DiscardCostWaitingRoomToHandWorkflowConfig,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
): GameState {
  if (config.recoveryRule.kind === 'STATIC_SELECTOR') {
    return finishWaitingRoomToHandWorkflow(
      game,
      selectedCardId,
      selectedCardIds,
      continuePendingCardEffects
    );
  }
  const effect = game.activeEffect;
  const printedCost = effect?.metadata?.discardedMemberPrintedCost;
  if (!effect || typeof printedCost !== 'number') return game;
  const currentCandidates = selectWaitingRoomCardIds(
    game,
    effect.controllerId,
    createRecoverySelector(effect.controllerId, config.recoveryRule, printedCost)
  );
  const requestedIds = selectedCardIds ?? (selectedCardId ? [selectedCardId] : []);
  if (requestedIds.some((cardId) => !currentCandidates.includes(cardId))) return game;
  return finishWaitingRoomToHandWorkflow(
    { ...game, activeEffect: { ...effect, selectableCardIds: currentCandidates } },
    selectedCardId,
    selectedCardIds,
    continuePendingCardEffects
  );
}
