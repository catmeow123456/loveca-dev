import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!-bp3-009';
const SELECT_HEART_COLOR_STEP_ID = 'PL_BP3_009_SELECT_HEART_COLOR';

const HEART_OPTIONS = [
  { id: 'PINK', label: '[桃ハート]', color: HeartColor.PINK },
  { id: 'YELLOW', label: '[黄ハート]', color: HeartColor.YELLOW },
  { id: 'PURPLE', label: '[紫ハート]', color: HeartColor.PURPLE },
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3009NicoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerActivatedAbilityHandler(
    PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
    (game, playerId, cardId) => startActivatedChooseHeart(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
    SELECT_HEART_COLOR_STEP_ID,
    (game, input, context) =>
      finishActivatedChooseHeart(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startActivatedChooseHeart(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const source = getValidActivatedSource(game, playerId, cardId);
  if (!source || source.orientation !== OrientationState.ACTIVE) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'PAY_COST', playerId, {
          abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot: source.sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  const stateAfterUse = recordAbilityUseForContext(stateWithTriggers.gameState, playerId, {
    abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...stateAfterUse,
      activeEffect: {
        id: `${PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID}:${cardId}:turn-${stateAfterUse.turnCount}:action-${stateAfterUse.actionHistory.length}`,
        abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(
          PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID
        ),
        stepId: SELECT_HEART_COLOR_STEP_ID,
        stepText: '请选择1种Heart。LIVE结束时为止，此成员获得1个选择的Heart。',
        awaitingPlayerId: playerId,
        selectableOptions: HEART_OPTIONS.map((option) => ({
          id: option.id,
          label: option.label,
        })),
        confirmSelectionLabel: '选择Heart',
        canSkipSelection: false,
        metadata: { sourceSlot: source.sourceSlot },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot: source.sourceSlot,
      step: 'START_SELECT_HEART_COLOR',
    }
  );
}

function finishActivatedChooseHeart(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const option = HEART_OPTIONS.find((candidate) => candidate.id === selectedOptionId);
  if (
    !effect ||
    effect.abilityId !== PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_HEART_COLOR_STEP_ID ||
    !option
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_SOURCE_NOT_ON_STAGE',
        selectedHeartColor: option.color,
        heartBonus: [],
      }),
      false
    );
  }

  const heartResult = addHeartLiveModifierForMember(game, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    memberCardId: effect.sourceCardId,
    hearts: [{ color: option.color, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: sourceSlot,
      step: 'GAIN_SELECTED_HEART',
      selectedHeartColor: option.color,
      heartBonus: heartResult.heartBonus,
    }),
    false
  );
}

function getValidActivatedSource(
  game: GameState,
  playerId: string,
  cardId: string
): { readonly sourceSlot: SlotPosition; readonly orientation: OrientationState } | null {
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState?.orientation === undefined
  ) {
    return null;
  }
  return { sourceSlot, orientation: sourceState.orientation };
}
