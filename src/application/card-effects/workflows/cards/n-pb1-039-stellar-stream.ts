import {
  createHeartIcon,
  isLiveCardData,
  isMemberCardData,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { hasOwnSuccessOrCurrentLiveCardWithExactEffectiveRequiredHeartCount } from '../../../../domain/rules/live-card-effective-requirement.js';
import {
  createHeartLiveModifierForMember,
  getMemberEffectiveHeartIcons,
  replaceLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { PL_N_PB1_039_LIVE_START_EXACT_PINK_REQUIREMENT_TARGET_PURPLE_HEART_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_PURPLE_HEART_MEMBER_STEP_ID = 'PL_N_PB1_039_SELECT_PURPLE_HEART_MEMBER';
const PURPLE_HEART_COPY = '[紫ハート][紫ハート][紫ハート][紫ハート]';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNPb1039StellarStreamWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_PB1_039_LIVE_START_EXACT_PINK_REQUIREMENT_TARGET_PURPLE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startStellarStream(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_PB1_039_LIVE_START_EXACT_PINK_REQUIREMENT_TARGET_PURPLE_HEART_ABILITY_ID,
    SELECT_PURPLE_HEART_MEMBER_STEP_ID,
    (game, input, context) =>
      finishStellarStreamSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startStellarStream(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const conditionMet = stellarStreamConditionMatches(game, player.id, ability.sourceCardId);
  const selectableCardIds = conditionMet ? getStellarStreamTargetIds(game, player.id) : [];
  if (!conditionMet || selectableCardIds.length === 0) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: conditionMet ? 'NO_PURPLE_HEART_NIJIGASAKI_TARGET' : 'CONDITION_NOT_MET',
        selectableCardIds,
      }
    );
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
      stepId: SELECT_PURPLE_HEART_MEMBER_STEP_ID,
      stepText: `选择要获得${PURPLE_HEART_COPY}的成员。`,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: `选择要获得${PURPLE_HEART_COPY}的成员`,
      confirmSelectionLabel: `获得${PURPLE_HEART_COPY}`,
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_PURPLE_HEART_NIJIGASAKI_MEMBER',
      selectableCardIds,
    },
  });
}

function finishStellarStreamSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_PB1_039_LIVE_START_EXACT_PINK_REQUIREMENT_TARGET_PURPLE_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_PURPLE_HEART_MEMBER_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const selectionIsValid =
    player !== null &&
    stellarStreamConditionMatches(game, player.id, effect.sourceCardId) &&
    getStellarStreamTargetIds(game, player.id).includes(selectedCardId);
  if (!player || !selectionIsValid) {
    return finishActiveEffectNoOp(
      game,
      effect,
      player?.id ?? effect.controllerId,
      continuePendingCardEffects,
      { step: 'STALE_OR_INVALID_STELLAR_STREAM_SELECTION', selectedCardId }
    );
  }

  const modifier = createHeartLiveModifierForMember(game, {
    playerId: player.id,
    memberCardId: selectedCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [createHeartIcon(HeartColor.PURPLE, 4)],
  });
  if (!modifier) {
    return finishActiveEffectNoOp(game, effect, player.id, continuePendingCardEffects, {
      step: 'TARGET_MEMBER_NO_LONGER_VALID',
      selectedCardId,
    });
  }

  const stateWithModifier = replaceLiveModifier(
    game,
    {
      kind: 'HEART',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    modifier
  );
  return continuePendingCardEffects(
    addAction({ ...stateWithModifier, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_NIJIGASAKI_MEMBER_GAIN_FOUR_PURPLE_HEARTS',
      targetMemberCardId: selectedCardId,
      heartBonus: modifier.hearts,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function stellarStreamConditionMatches(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player !== null &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    player.liveZone.cardIds.includes(sourceCardId) &&
    hasOwnSuccessOrCurrentLiveCardWithExactEffectiveRequiredHeartCount(game, playerId, {
      group: '虹ヶ咲',
      heartColor: HeartColor.PINK,
      exactCount: 3,
    })
  );
}

function getStellarStreamTargetIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return getAllMemberCardIds(player.memberSlots).filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      isMemberCardData(card.data) &&
      cardBelongsToGroup(card.data, '虹ヶ咲') &&
      getMemberEffectiveHeartIcons(game, playerId, cardId).some(
        (heart) => heart.color === HeartColor.PURPLE && heart.count > 0
      )
    );
  });
}

function clearStellarStreamModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string
): GameState {
  return replaceLiveModifier(game, { kind: 'HEART', playerId, sourceCardId, abilityId }, null);
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = clearStellarStreamModifier(game, playerId, ability.sourceCardId, ability.abilityId);
  return continuePendingCardEffects(
    addAction(
      {
        ...state,
        pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
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

function finishActiveEffectNoOp(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = clearStellarStreamModifier(game, playerId, effect.sourceCardId, effect.abilityId);
  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
