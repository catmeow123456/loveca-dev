import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import {
  and,
  groupAliasIs,
  hasBladeHeart,
  or,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID } from '../../ability-ids.js';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

const SELECT_DISCARD_STEP_ID = 'SP_BP5_013_SELECT_DISCARD';
const SELECT_TAKE_STEP_ID = 'SP_BP5_013_SELECT_SUNNYPASSION_OR_BLADE_HEART_LIELLA';
const REVEAL_SELECTED_STEP_ID = 'SP_BP5_013_REVEAL_SELECTED_MEMBER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5013KekeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp5013KekeOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishDiscardCostAndStartInspection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID,
    SELECT_TAKE_STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID,
    REVEAL_SELECTED_STEP_ID,
    (game, _input, context) =>
      finishRevealedLookTopSelectToHandWorkflow(game, {
        continuePendingCardEffects: context.continuePendingCardEffects,
        enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
      })
  );
}

function startSpBp5013KekeOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.hand.cardIds.length === 0) {
    return consumePendingNoop(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_OP_DISCARD_LOOK_TOP_NO_HAND',
        reason: 'NO_HAND',
      }
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      selectableCardIds: [...player.hand.cardIds],
      orderedResolution,
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishDiscardCostAndStartInspection(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
  });

  return startLookTopSelectToHandWorkflow(
    stateAfterCost,
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    {
      effectText: getAbilityEffectText(effect.abilityId),
      topCount: 5,
      selector: selectableMember,
      countRule: { minCount: 0, maxCount: 1 },
      revealSelectedBeforeHand: true,
      selectStepId: SELECT_TAKE_STEP_ID,
      revealStepId: REVEAL_SELECTED_STEP_ID,
      selectStepText:
        '请选择至多1张『SunnyPassion』成员卡或持有 BLADE HEART 的『Liella!』成员卡公开并加入手牌。也可以不加入。',
      noTargetStepText:
        '没有可加入手牌的『SunnyPassion』成员卡或持有 BLADE HEART 的『Liella!』成员卡。确认后其余卡片放置入休息室。',
      selectionLabel: '选择要公开并加入手牌的成员卡',
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '不加入',
      revealStepText: getAbilityEffectText(effect.abilityId),
      revealActionStep: 'REVEAL_SELECTED',
      startActionPayload: { discardCardId: selectedCardId },
    },
    {
      orderedResolution: effect.metadata?.orderedResolution === true,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
    }
  );
}

function consumePendingNoop(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

const selectableMember = and(
  typeIs(CardType.MEMBER),
  or(unitAliasIs('SunnyPassion'), and(groupAliasIs('Liella!'), hasBladeHeart()))
);
