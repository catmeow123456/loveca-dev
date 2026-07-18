import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
  type ZoneCardPredicate,
} from '../../../effects/zone-selection.js';
import {
  BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
  PL_N_BP1_009_ON_ENTER_OPTIONAL_DISCARD_MILL_TWO_RECOVER_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import { createOptionalDiscardHandToWaitingRoomActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from './waiting-room-to-hand.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface DiscardMillTopRecoverMemberConfig {
  readonly abilityId: string;
  readonly millCount: number;
  readonly recoverSelector: ZoneCardPredicate;
  readonly recoverTargetDescription: string;
  readonly validateSourceStillOnStage: boolean;
  readonly discardStepId: string;
  readonly recoverStepId: string;
  readonly millActionStep: string;
  readonly noTargetActionStep: string;
}

const CONFIGS: readonly DiscardMillTopRecoverMemberConfig[] = [
  {
    abilityId: BP5_010_LIVE_START_DISCARD_MILL_RECOVER_ARISE_MEMBER_ABILITY_ID,
    millCount: 3,
    recoverSelector: and(typeIs(CardType.MEMBER), groupAliasIs('A-RISE')),
    recoverTargetDescription: '『A-RISE』成员卡',
    validateSourceStillOnStage: true,
    discardStepId: 'BP5_010_SELECT_HAND_CARD_TO_DISCARD',
    recoverStepId: 'BP5_010_SELECT_ARISE_MEMBER_FROM_WAITING_ROOM',
    millActionStep: 'MILL_TOP_THREE',
    noTargetActionStep: 'NO_ARISE_MEMBER_TARGET',
  },
  {
    abilityId: PL_N_BP1_009_ON_ENTER_OPTIONAL_DISCARD_MILL_TWO_RECOVER_MEMBER_ABILITY_ID,
    millCount: 2,
    recoverSelector: typeIs(CardType.MEMBER),
    recoverTargetDescription: '成员卡',
    validateSourceStillOnStage: false,
    discardStepId: 'PL_N_BP1_009_SELECT_HAND_CARD_TO_DISCARD',
    recoverStepId: 'PL_N_BP1_009_SELECT_MEMBER_FROM_WAITING_ROOM',
    millActionStep: 'MILL_TOP_TWO',
    noTargetActionStep: 'NO_MEMBER_TARGET',
  },
];

export function registerDiscardMillTopRecoverMemberWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startDiscardMillTopRecoverMember(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.discardStepId, (game, input, context) =>
      input.selectedCardId
        ? finishDiscardMillTopRecoverMember(
            game,
            input.selectedCardId,
            config,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishWithoutPayment(game, config, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(config.abilityId, config.recoverStepId, (game, input, context) => {
      const effect = game.activeEffect;
      const currentCandidateCardIds = effect
        ? selectWaitingRoomCardIds(game, effect.controllerId, config.recoverSelector)
        : [];
      return finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        { currentCandidateCardIds }
      );
    });
  }
}

function startDiscardMillTopRecoverMember(
  game: GameState,
  ability: PendingAbilityState,
  config: DiscardMillTopRecoverMemberConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  if (
    !player ||
    player.hand.cardIds.length === 0 ||
    (config.validateSourceStillOnStage && sourceSlot === null)
  ) {
    return consumePendingWithoutEffect(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      player?.hand.cardIds.length === 0 ? 'NO_HAND_TO_DISCARD' : 'SOURCE_NOT_ON_STAGE',
      { sourceSlot }
    );
  }

  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.discardStepId,
      stepText: `可以将1张手牌放置入休息室。如此做的话，将卡组顶${config.millCount}张放置入休息室，之后回收1张${config.recoverTargetDescription}。`,
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: { sourceSlot, millCount: config.millCount },
    }),
  };
}

function finishWithoutPayment(
  game: GameState,
  config: DiscardMillTopRecoverMemberConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.discardStepId) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'DECLINE_DISCARD_COST',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishDiscardMillTopRecoverMember(
  game: GameState,
  discardCardId: string,
  config: DiscardMillTopRecoverMemberConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.discardStepId ||
    effect.selectableCardIds?.includes(discardCardId) !== true ||
    !player?.hand.cardIds.includes(discardCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    stateAfterCost,
    player.id,
    config.millCount,
    enqueueTriggeredCardEffects
  );
  if (!millResult) return game;

  const stateAfterMill = addAction(millResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    step: config.millActionStep,
    discardedHandCardIds: discardResult.discardedCardIds,
    milledCardIds: millResult.movedCardIds,
    refreshCount: millResult.refreshCount,
  });
  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterMill,
    player.id,
    config.recoverSelector
  );
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterMill, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: config.noTargetActionStep,
        discardedHandCardIds: discardResult.discardedCardIds,
        milledCardIds: millResult.movedCardIds,
        refreshCount: millResult.refreshCount,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...stateAfterMill,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: effect.effectText,
      stepId: config.recoverStepId,
      stepText: `请选择自己休息室1张${config.recoverTargetDescription}加入手牌。`,
      selectionLabel: '选择要加入手牌的成员卡',
      confirmSelectionLabel: '加入手牌',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        sourceSlot: effect.metadata?.sourceSlot,
        discardedHandCardIds: discardResult.discardedCardIds,
        milledCardIds: millResult.movedCardIds,
        refreshCount: millResult.refreshCount,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

function consumePendingWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
        ...payload,
      }
    ),
    orderedResolution
  );
}
