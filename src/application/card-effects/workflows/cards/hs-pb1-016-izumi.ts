import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForMember,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { HS_PB1_016_ON_ENTER_TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_PURPLE_HEART_TARGET_STEP_ID = 'HS_PB1_016_SELECT_PURPLE_HEART_TARGET';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1016IzumiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_016_ON_ENTER_TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1016OnEnterPurpleHeartTarget(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_016_ON_ENTER_TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART_ABILITY_ID,
    SELECT_PURPLE_HEART_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsPb1016PurpleHeartTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1016OnEnterPurpleHeartTarget(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = getPurpleHeartTargetMemberIds(game, player.id, ability.sourceCardId);
  if (selectableCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      { step: 'NO_PURPLE_HEART_TARGET', selectableCardIds },
      continuePendingCardEffects
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
      stepId: SELECT_PURPLE_HEART_TARGET_STEP_ID,
      stepText: '请选择自己舞台上此成员以外、持有[紫ハート]的1名成员获得[紫ハート]。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardMode: 'SINGLE',
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择获得[紫ハート]的成员',
      confirmSelectionLabel: '获得[紫ハート]',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_PURPLE_HEART_TARGET',
      selectableCardIds,
    },
  });
}

function finishHsPb1016PurpleHeartTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_016_ON_ENTER_TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_PURPLE_HEART_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !getPurpleHeartTargetMemberIds(game, player.id, effect.sourceCardId).includes(selectedCardId)
  ) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(game, {
    playerId: player.id,
    memberCardId: selectedCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [{ color: HeartColor.PURPLE, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_PURPLE_HEART_MEMBER_GAIN_PURPLE_HEART',
      targetMemberCardId: selectedCardId,
      heartBonus: heartResult.heartBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
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

function getPurpleHeartTargetMemberIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    const card = cardId ? getCardById(game, cardId) : null;
    return (
      cardId !== null &&
      cardId !== sourceCardId &&
      card !== null &&
      card.ownerId === playerId &&
      getMemberEffectiveHeartIcons(game, playerId, cardId).some(
        (heart) => heart.color === HeartColor.PURPLE && heart.count > 0
      )
    );
  });
}
