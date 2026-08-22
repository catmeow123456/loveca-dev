import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import {
  addHeartLiveModifierForSourceMember,
  isLiveAbilitySuppressed,
  suppressLiveAbility,
} from '../../../../domain/rules/live-modifiers.js';
import {
  CardType,
  HeartColor,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../ability-definition-types.js';
import { PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID } from '../../ability-ids.js';
import { getImplementedQueuedAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_OPPONENT_MEMBER_STEP_ID = 'PL_PB2_003_SELECT_OPPONENT_MEMBER';
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface OpponentStageMemberCandidate {
  readonly cardId: string;
  readonly slot: SlotPosition;
  readonly liveSuccessAbilityIds: readonly string[];
}

export function registerPlPb2003KotoriWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startPlPb2003KotoriLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_PB2_003_LIVE_START_SUPPRESS_OPPONENT_MEMBER_LIVE_SUCCESS_GAIN_YELLOW_HEART_ABILITY_ID,
    SELECT_OPPONENT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishOpponentMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startPlPb2003KotoriLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const targetCandidates = getOpponentStageMemberCandidates(game, ability.controllerId);
  if (!player || targetCandidates.length === 0) {
    return finishPendingAbility(game, ability, orderedResolution, continuePendingCardEffects, {
      step: player ? 'NO_OPPONENT_STAGE_MEMBER' : 'CONTROLLER_NOT_FOUND',
      targetMemberCardId: null,
      suppressedAbilityIds: [],
      heartApplied: false,
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_OPPONENT_MEMBER_STEP_ID,
      stepText: '请选择对方舞台上的1名成员，使其全部【LIVE成功时】能力直到LIVE结束时为止无效。',
      awaitingPlayerId: player.id,
      selectableCardIds: targetCandidates.map((candidate) => candidate.cardId),
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要使LIVE成功时能力无效的成员',
      confirmSelectionLabel: '使能力无效',
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_OPPONENT_MEMBER_LIVE_SUCCESS_SUPPRESSION',
      selectableCardIds: targetCandidates.map((candidate) => candidate.cardId),
    },
  });
}

function finishOpponentMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== SELECT_OPPONENT_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const currentCandidates = getOpponentStageMemberCandidates(game, effect.controllerId);
  const target = currentCandidates.find((candidate) => candidate.cardId === selectedCardId);
  if (!target) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'STALE_OPPONENT_MEMBER_NO_OP',
      targetMemberCardId: selectedCardId,
      currentTargetCardIds: currentCandidates.map((candidate) => candidate.cardId),
      suppressedAbilityIds: [],
      heartApplied: false,
    });
  }

  const newlySuppressedAbilityIds = [
    ...new Set(
      target.liveSuccessAbilityIds.filter(
        (abilityId) => !isLiveAbilitySuppressed(game, target.cardId, abilityId)
      )
    ),
  ];
  let state = game;
  for (const suppressedAbilityId of newlySuppressedAbilityIds) {
    state = suppressLiveAbility(state, {
      sourceCardId: target.cardId,
      suppressedAbilityId,
      abilityId: effect.abilityId,
    });
  }

  const heartResult =
    newlySuppressedAbilityIds.length > 0
      ? addHeartLiveModifierForSourceMember(state, {
          playerId: effect.controllerId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          hearts: [{ color: HeartColor.YELLOW, count: 1 }],
        })
      : null;

  return finishActiveEffect(heartResult?.gameState ?? state, continuePendingCardEffects, {
    step:
      newlySuppressedAbilityIds.length > 0
        ? 'SUPPRESS_LIVE_SUCCESS_ABILITIES'
        : 'NO_NEW_LIVE_SUCCESS_ABILITY_SUPPRESSED',
    targetMemberCardId: target.cardId,
    targetSlot: target.slot,
    liveSuccessAbilityIds: target.liveSuccessAbilityIds,
    suppressedAbilityIds: newlySuppressedAbilityIds,
    heartApplied: heartResult !== null,
    heartColor: HeartColor.YELLOW,
    heartBonus: heartResult ? 1 : 0,
  });
}

function getOpponentStageMemberCandidates(
  game: GameState,
  controllerId: string
): readonly OpponentStageMemberCandidate[] {
  const player = getPlayerById(game, controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!opponent) {
    return [];
  }

  return getStageMemberCardIdsMatching(game, opponent.id, typeIs(CardType.MEMBER)).flatMap(
    (cardId) => {
      const card = getCardById(game, cardId);
      const slot = findMemberSlot(opponent, cardId);
      if (!card || slot === null) {
        return [];
      }
      const liveSuccessAbilityIds = getImplementedQueuedAbilityDefinitionsForCardCode(
        card.data.cardCode,
        {
          category: CardAbilityCategory.LIVE_SUCCESS,
          sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
          triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
          ignoreRequiredSourceSlots: true,
        }
      ).map((definition) => definition.abilityId);
      return [{ cardId, slot, liveSuccessAbilityIds }];
    }
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
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
        ...payload,
      }
    ),
    orderedResolution
  );
}

function finishActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
