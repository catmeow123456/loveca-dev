import {
  addAction,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { didPlayerPerformAndFailLiveInPreviousCompletedTurn } from '../../../effects/previous-completed-turn-live-result.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_PR_022_ON_ENTER_PREVIOUS_OPPONENT_LIVE_FAILED_ASK_EMMA_PUNCH_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifiersForTargetMembers } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = N_PR_022_ON_ENTER_PREVIOUS_OPPONENT_LIVE_FAILED_ASK_EMMA_PUNCH_BLADE_ABILITY_ID;
const CHOOSE_WHETHER_TO_ASK_STEP_ID = 'N_PR_022_CHOOSE_WHETHER_TO_ASK';
const OPPONENT_ANSWER_STEP_ID = 'N_PR_022_OPPONENT_ANSWER';
const CONFIRM_EMMA_PUNCH_STEP_ID = 'N_PR_022_CONFIRM_EMMA_PUNCH';
const ASK_OPPONENT_OPTION_ID = 'ask-opponent';
const DO_NOT_ASK_OPTION_ID = 'do-not-ask';
const PLEASE_OPTION_ID = 'please';
const OTHER_ANSWER_OPTION_ID = 'other-answer';
const EMMA_PUNCH_OPTION_ID = 'emma-punch';
const BLADE_BONUS = 1;

const WHETHER_TO_ASK_OPTIONS = [
  { id: ASK_OPPONENT_OPTION_ID, text: '询问对手' },
  { id: DO_NOT_ASK_OPTION_ID, text: '不询问' },
] as const;

const OPPONENT_ANSWER_OPTIONS = [
  { id: PLEASE_OPTION_ID, text: '拜托了' },
  { id: OTHER_ANSWER_OPTION_ID, text: '其他回答' },
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNPr022EmmaVerdeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startEmmaPunchQuestion(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    CHOOSE_WHETHER_TO_ASK_STEP_ID,
    (game, input, context) =>
      resolveWhetherToAsk(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, OPPONENT_ANSWER_STEP_ID, (game, input, context) =>
    resolveOpponentAnswer(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, CONFIRM_EMMA_PUNCH_STEP_ID, (game, input, context) =>
    resolveEmmaPunch(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
}

function startEmmaPunchQuestion(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = getOpponent(game, ability.controllerId);
  if (
    !player ||
    !opponent ||
    !didPlayerPerformAndFailLiveInPreviousCompletedTurn(game, opponent.id)
  ) {
    return finishPendingWithoutBlade(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'PREVIOUS_OPPONENT_LIVE_FAILED_CONDITION_NOT_MET'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_WHETHER_TO_ASK_STEP_ID,
      stepText: '可以询问对手是否要被艾玛拳打。',
      awaitingPlayerId: player.id,
      effectChoice: {
        mode: 'SINGLE',
        options: WHETHER_TO_ASK_OPTIONS,
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: '选择是否询问对手',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: {
        orderedResolution,
        solitaireOpponentEffectChoiceOptionId: ASK_OPPONENT_OPTION_ID,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      opponentId: opponent.id,
      step: 'START_CHOOSE_WHETHER_TO_ASK',
    },
  });
}

function resolveWhetherToAsk(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(game, CHOOSE_WHETHER_TO_ASK_STEP_ID);
  if (!effect) return game;
  if (selectedOptionId === DO_NOT_ASK_OPTION_ID) {
    return finishActiveEffectWithoutBlade(
      game,
      effect,
      continuePendingCardEffects,
      'DECLINED_TO_ASK'
    );
  }
  if (selectedOptionId !== ASK_OPPONENT_OPTION_ID) return game;

  const opponent = getOpponent(game, effect.controllerId);
  if (!opponent) {
    return finishActiveEffectWithoutBlade(
      game,
      effect,
      continuePendingCardEffects,
      'OPPONENT_NOT_FOUND'
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: OPPONENT_ANSWER_STEP_ID,
        stepText: '请选择对“是否要被艾玛拳打”的回答。',
        awaitingPlayerId: opponent.id,
        effectChoice: {
          mode: 'SINGLE',
          options: OPPONENT_ANSWER_OPTIONS,
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectionLabel: '选择回答',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          solitaireOpponentEffectChoiceOptionId: PLEASE_OPTION_ID,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      opponentId: opponent.id,
      step: 'ASK_OPPONENT_ABOUT_EMMA_PUNCH',
    }
  );
}

function resolveOpponentAnswer(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(game, OPPONENT_ANSWER_STEP_ID);
  if (!effect) return game;
  const selectedOption = OPPONENT_ANSWER_OPTIONS.find((option) => option.id === selectedOptionId);
  if (!selectedOption) return game;

  if (selectedOption.id === OTHER_ANSWER_OPTION_ID) {
    return finishActiveEffectWithoutBlade(
      game,
      effect,
      continuePendingCardEffects,
      'OPPONENT_OTHER_ANSWER',
      { opponentAnswer: selectedOption.text }
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: CONFIRM_EMMA_PUNCH_STEP_ID,
        stepText: '请以温柔和爱意对对方使用艾玛拳。',
        awaitingPlayerId: effect.controllerId,
        effectChoice: {
          mode: 'SINGLE',
          options: [{ id: EMMA_PUNCH_OPTION_ID, text: '使用艾玛拳' }],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectionLabel: '使用艾玛拳',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          opponentAnswer: selectedOption.text,
          solitaireOpponentEffectChoiceOptionId: EMMA_PUNCH_OPTION_ID,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'OPPONENT_ANSWERED_PLEASE',
      opponentAnswer: selectedOption.text,
    }
  );
}

function resolveEmmaPunch(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(game, CONFIRM_EMMA_PUNCH_STEP_ID);
  if (!effect || selectedOptionId !== EMMA_PUNCH_OPTION_ID) return game;

  const opponent = getOpponent(game, effect.controllerId);
  const targetMemberCardIds = opponent
    ? getStageMemberCardIdsMatching(game, opponent.id, typeIs(CardType.MEMBER))
    : [];
  const stateWithoutActiveEffect: GameState = { ...game, activeEffect: null };
  const bladeResult = addBladeLiveModifiersForTargetMembers(stateWithoutActiveEffect, {
    targets: opponent
      ? targetMemberCardIds.map((targetMemberCardId) => ({
          playerId: opponent.id,
          targetMemberCardId,
        }))
      : [],
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: BLADE_BONUS,
  });
  const state = bladeResult?.gameState ?? stateWithoutActiveEffect;
  const appliedTargetMemberCardIds = bladeResult?.targetMemberCardIds ?? [];

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      opponentId: opponent?.id ?? null,
      step: 'USE_EMMA_PUNCH_GAIN_BLADE',
      opponentAnswer: effect.metadata?.opponentAnswer,
      targetMemberCardIds,
      appliedTargetMemberCardIds,
      bladeBonusPerMember: bladeResult?.bladeBonusPerMember ?? 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getActiveEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === ABILITY_ID && effect.stepId === stepId ? effect : null;
}

function finishPendingWithoutBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
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
        appliedTargetMemberCardIds: [],
      }
    ),
    orderedResolution
  );
}

function finishActiveEffectWithoutBlade(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      appliedTargetMemberCardIds: [],
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
