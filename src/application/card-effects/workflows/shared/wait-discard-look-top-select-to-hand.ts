import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { queryCardSelection, queryConfirmSelection } from '../../runtime/selection-query.js';
import {
  HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  N_BP5_009_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  PL_BP5_002_ON_ENTER_WAIT_DISCARD_LOOK_TOP_HIGH_COST_MUSE_MEMBER_ABILITY_ID,
  PL_BP5_222_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ANY_CARD_ABILITY_ID,
  PL_PB2_026_ACTIVATED_WAIT_SELF_DISCARD_LOOK_TOP_PRINTEMPS_MEMBER_ABILITY_ID,
  SP_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  S_BP5_006_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
} from '../../ability-ids.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  and,
  costGte,
  groupAliasIs,
  type CardSelector,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import {
  payImmediateEffectCosts,
  type EffectCostDefinition,
} from '../../../effects/effect-costs.js';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

const DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL = '请选择要放置入休息室的卡牌';
const DISCARD_HAND_TO_ACTIVATE_STEP_TEXT = '请选择要放置入休息室的手牌。也可以选择不发动此效果。';
const DECLINE_OPTION_LABEL = '不发动';
const DISCARD_LOOK_SELECT_DISCARD_STEP_ID = 'DISCARD_LOOK_SELECT_DISCARD';
const DISCARD_LOOK_SELECT_TAKE_STEP_ID = 'DISCARD_LOOK_SELECT_TAKE';
const DISCARD_LOOK_REVEAL_SELECTED_STEP_ID = 'DISCARD_LOOK_REVEAL_SELECTED';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

interface WaitDiscardLookTopSelectToHandConfig {
  readonly abilityId: string;
  readonly activatedBaseCardCodes?: readonly string[];
  readonly topCount: number;
  readonly selector: CardSelector;
  readonly memberOnly?: boolean;
  readonly selectionRequiredWhenHasTargets?: boolean;
  readonly revealSelectedBeforeHand: boolean;
  readonly selectStepText: string;
  readonly noTargetStepText: string;
  readonly selectionLabel: string;
  readonly confirmSelectionLabel: string;
  readonly skipSelectionLabel?: string;
}

function createHighCostGroupMemberConfig(options: {
  readonly abilityId: string;
  readonly groupAlias: string;
  readonly groupLabel: string;
  readonly topCount: number;
  readonly costGte: number;
}): WaitDiscardLookTopSelectToHandConfig {
  return {
    abilityId: options.abilityId,
    topCount: options.topCount,
    selector: and(
      typeIs(CardType.MEMBER),
      costGte(options.costGte),
      groupAliasIs(options.groupAlias)
    ),
    memberOnly: true,
    revealSelectedBeforeHand: true,
    selectStepText: `请选择其中1张费用大于等于${options.costGte}的『${options.groupLabel}』成员卡公开并加入手牌，其余放置入休息室。`,
    noTargetStepText: `没有可加入手牌的费用大于等于${options.costGte}的『${options.groupLabel}』成员卡。确认后其余卡片放置入休息室。`,
    selectionLabel: '请选择要公开并加入手牌的成员卡',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
  };
}

const WAIT_DISCARD_LOOK_TOP_WORKFLOWS: readonly WaitDiscardLookTopSelectToHandConfig[] = [
  createHighCostGroupMemberConfig({
    abilityId: HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
    groupAlias: '蓮ノ空',
    groupLabel: '莲之空',
    topCount: 5,
    costGte: 9,
  }),
  createHighCostGroupMemberConfig({
    abilityId: S_BP5_006_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
    groupAlias: 'Aqours',
    groupLabel: 'Aqours',
    topCount: 5,
    costGte: 9,
  }),
  createHighCostGroupMemberConfig({
    abilityId: SP_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
    groupAlias: 'Liella!',
    groupLabel: 'Liella!',
    topCount: 5,
    costGte: 9,
  }),
  createHighCostGroupMemberConfig({
    abilityId: N_BP5_009_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
    groupAlias: '虹ヶ咲',
    groupLabel: '虹ヶ咲',
    topCount: 5,
    costGte: 9,
  }),
  createHighCostGroupMemberConfig({
    abilityId: PL_BP5_002_ON_ENTER_WAIT_DISCARD_LOOK_TOP_HIGH_COST_MUSE_MEMBER_ABILITY_ID,
    groupAlias: "μ's",
    groupLabel: "μ's",
    topCount: 5,
    costGte: 9,
  }),
  {
    abilityId: PL_BP5_222_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ANY_CARD_ABILITY_ID,
    topCount: 3,
    selector: () => true,
    selectionRequiredWhenHasTargets: true,
    revealSelectedBeforeHand: false,
    selectStepText: '请选择其中1张卡加入手牌，其余放置入休息室。',
    noTargetStepText: '没有可加入手牌的卡片。确认后其余卡片放置入休息室。',
    selectionLabel: '请选择要加入手牌的卡牌',
    confirmSelectionLabel: '加入手牌',
  },
  {
    abilityId: PL_PB2_026_ACTIVATED_WAIT_SELF_DISCARD_LOOK_TOP_PRINTEMPS_MEMBER_ABILITY_ID,
    activatedBaseCardCodes: ['PL!-pb2-026'],
    topCount: 3,
    selector: and(typeIs(CardType.MEMBER), unitAliasIs('Printemps')),
    memberOnly: true,
    revealSelectedBeforeHand: true,
    selectStepText: '请选择其中1张『Printemps』的成员卡公开并加入手牌，其余放置入休息室。',
    noTargetStepText: '没有可加入手牌的『Printemps』的成员卡。确认后其余卡片放置入休息室。',
    selectionLabel: '请选择要公开并加入手牌的成员卡',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '全部放置入休息室',
  },
];

export function registerWaitDiscardLookTopSelectToHandWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const config of WAIT_DISCARD_LOOK_TOP_WORKFLOWS) {
    if (config.activatedBaseCardCodes) {
      registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) => {
        if (
          game.activeEffect ||
          game.currentPhase !== GamePhase.MAIN_PHASE ||
          game.players[game.activePlayerIndex]?.id !== playerId ||
          !hasActivatedSource(game, playerId, cardId, config) ||
          !getPlayerById(game, playerId)?.hand.cardIds.length
        ) {
          return game;
        }
        return startWaitDiscardLookTopSelectToHand(
          game,
          {
            id: `${config.abilityId}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
            abilityId: config.abilityId,
            sourceCardId: cardId,
            controllerId: playerId,
          },
          config,
          false
        );
      });
    } else {
      registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
        startWaitDiscardLookTopSelectToHand(
          game,
          ability,
          config,
          options.orderedResolution === true
        )
      );
    }
    registerActiveEffectStepHandler(
      config.abilityId,
      DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
      (game, input, context) =>
        input.selectedCardId
          ? startInspectionAfterWaitDiscardCost(
              game,
              input.selectedCardId,
              config,
              context.continuePendingCardEffects,
              deps.enqueueTriggeredCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects),
      queryCardSelection
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      DISCARD_LOOK_SELECT_TAKE_STEP_ID,
      (game, input, context) =>
        resolveLookTopSelectToHandSelection(
          game,
          input.selectedCardId ?? null,
          input.selectedCardIds,
          {
            continuePendingCardEffects: context.continuePendingCardEffects,
            enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
          }
        ),
      queryCardSelection
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
      (game, _input, context) =>
        finishRevealedLookTopSelectToHandWorkflow(game, {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }),
      queryConfirmSelection
    );
  }
}

function hasActivatedSource(
  game: GameState,
  playerId: string,
  cardId: string,
  config: WaitDiscardLookTopSelectToHandConfig
): boolean {
  const card = getCardById(game, cardId);
  return (
    !!card &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    config.activatedBaseCardCodes?.some((baseCode) =>
      cardCodeMatchesBase(card.data.cardCode, baseCode)
    ) === true &&
    getSourceMemberSlot(game, playerId, cardId) !== null &&
    getPlayerById(game, playerId)?.memberSlots.cardStates.get(cardId)?.orientation ===
      OrientationState.ACTIVE
  );
}

function startWaitDiscardLookTopSelectToHand(
  game: GameState,
  ability: {
    readonly id: string;
    readonly abilityId: string;
    readonly sourceCardId: string;
    readonly controllerId: string;
  },
  config: WaitDiscardLookTopSelectToHandConfig,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId);
  const sourceState = player.memberSlots.cardStates.get(ability.sourceCardId);
  const canWaitSource = sourceSlot !== null && sourceState?.orientation === OrientationState.ACTIVE;
  const selectableCardIds = canWaitSource ? [...player.hand.cardIds] : [];
  const sourceWaitCost: EffectCostDefinition = {
    kind: 'SET_SOURCE_MEMBER_ORIENTATION',
    orientation: OrientationState.WAITING,
  };
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: true,
  };

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
        stepText: DISCARD_HAND_TO_ACTIVATE_STEP_TEXT,
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL,
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: true,
        skipSelectionLabel: DECLINE_OPTION_LABEL,
        metadata: {
          orderedResolution,
          topCount: config.topCount,
          memberOnly: config.memberOnly === true,
          selectionRequired: false,
          revealSelectedBeforeHand: config.revealSelectedBeforeHand,
          sourceSlot,
          effectCosts: [sourceWaitCost, discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
      sourceSlot,
    }
  );
}

function startInspectionAfterWaitDiscardCost(
  game: GameState,
  discardCardId: string,
  config: WaitDiscardLookTopSelectToHandConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    !effect.selectableCardIds?.includes(discardCardId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }
  if (
    config.activatedBaseCardCodes &&
    !hasActivatedSource(game, player.id, effect.sourceCardId, config)
  ) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects);
  }

  const sourceWaitPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
  ]);
  if (!sourceWaitPayment) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects);
  }
  const sourceWaitWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    sourceWaitPayment,
    enqueueTriggeredCardEffects
  );
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    sourceWaitWithTriggers.gameState,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: sourceWaitPayment.sourceSlot,
    orientedMemberCardIds: sourceWaitPayment.orientedMemberCardIds,
    discardedHandCardIds: discardResult.discardedCardIds,
    memberStateChangedEventIds: sourceWaitWithTriggers.memberStateChangedEvents.map(
      (event) => event.eventId
    ),
  });
  if (config.activatedBaseCardCodes) {
    stateAfterCost = recordAbilityUseForContext(stateAfterCost, player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    });
  }

  return startLookTopSelectToHandWorkflow(
    stateAfterCost,
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    {
      effectText: getAbilityEffectText(config.abilityId),
      topCount: config.topCount,
      selector: config.selector,
      countRule: { minCount: 0, maxCount: 1 },
      revealSelectedBeforeHand: config.revealSelectedBeforeHand,
      selectionRequiredWhenHasTargets: config.selectionRequiredWhenHasTargets,
      selectStepId: DISCARD_LOOK_SELECT_TAKE_STEP_ID,
      revealStepId: DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
      selectStepText: config.selectStepText,
      noTargetStepText: config.noTargetStepText,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: config.confirmSelectionLabel,
      skipSelectionLabel: config.skipSelectionLabel,
      revealStepText: getAbilityEffectText(config.abilityId),
      revealActionStep: 'REVEAL_SELECTED',
      startActionPayload: { discardCardId },
      publicEffectSummaryContext: {
        effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
        sourceActionLabel: config.activatedBaseCardCodes ? '起动' : '登场',
        discardedCostCardIds: [discardCardId],
        inspectSourceZone: ZoneType.MAIN_DECK,
        requestedInspectCount: config.topCount,
        sourceOrientationCost: 'WAITING',
      },
    },
    {
      orderedResolution: effect.metadata?.orderedResolution === true,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
    }
  );
}
