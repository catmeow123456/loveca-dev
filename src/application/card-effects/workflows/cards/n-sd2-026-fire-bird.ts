import { createHeartIcon, isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForTargetMember,
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { PL_N_SD2_026_LIVE_START_EFFECTIVE_BLADE_FOUR_TARGET_GAIN_RED_HEART_TWO_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';

const SELECT_FIRE_BIRD_TARGET_STEP_ID = 'PL_N_SD2_026_SELECT_FIRE_BIRD_TARGET';
const RED_HEART_TWO_COPY = '[赤ハート][赤ハート]';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNSd2026FireBirdWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_SD2_026_LIVE_START_EFFECTIVE_BLADE_FOUR_TARGET_GAIN_RED_HEART_TWO_ABILITY_ID,
    (game, ability, options, context) =>
      startFireBirdTargetSelection(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_SD2_026_LIVE_START_EFFECTIVE_BLADE_FOUR_TARGET_GAIN_RED_HEART_TWO_ABILITY_ID,
    SELECT_FIRE_BIRD_TARGET_STEP_ID,
    (game, input, context) =>
      finishFireBirdTargetSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startFireBirdTargetSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (!isOwnLiveZoneSource(game, player.id, ability.sourceCardId)) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LIVE_NO_LONGER_VALID'
    );
  }

  const selectableCardIds = getFireBirdTargetMemberIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_EFFECTIVE_BLADE_FOUR_NIJIGASAKI_TARGET'
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
      stepId: SELECT_FIRE_BIRD_TARGET_STEP_ID,
      stepText: `请选择自己舞台上1名持有4个以上[BLADE]的『虹咲』成员获得${RED_HEART_TWO_COPY}。`,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardMode: 'SINGLE',
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: `选择获得${RED_HEART_TWO_COPY}的成员`,
      confirmSelectionLabel: `获得${RED_HEART_TWO_COPY}`,
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_EFFECTIVE_BLADE_FOUR_NIJIGASAKI_MEMBER',
      selectableCardIds,
    },
  });
}

function finishFireBirdTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_SD2_026_LIVE_START_EFFECTIVE_BLADE_FOUR_TARGET_GAIN_RED_HEART_TWO_ABILITY_ID ||
    effect.stepId !== SELECT_FIRE_BIRD_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !isOwnLiveZoneSource(game, player.id, effect.sourceCardId) ||
    !getFireBirdTargetMemberIds(game, player.id).includes(selectedCardId)
  ) {
    return finishActiveEffectNoOp(
      game,
      effect,
      player?.id ?? effect.controllerId,
      continuePendingCardEffects,
      'STALE_OR_INVALID_FIRE_BIRD_SELECTION',
      selectedCardId
    );
  }

  const heartResult = addHeartLiveModifierForTargetMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      targetMemberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [createHeartIcon(HeartColor.RED, 2)],
    }
  );
  if (!heartResult) {
    return finishActiveEffectNoOp(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'TARGET_MEMBER_HEART_MODIFIER_UNAVAILABLE',
      selectedCardId
    );
  }

  return continuePendingCardEffects(
    addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_MEMBER_GAIN_TWO_RED_HEARTS',
      targetMemberCardId: selectedCardId,
      heartBonus: heartResult.heartBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getFireBirdTargetMemberIds(game: GameState, playerId: string): readonly string[] {
  const liveModifiers = collectLiveModifiers(game);
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'))
  ).filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card?.ownerId === playerId &&
      getMemberEffectiveBladeCount(game, playerId, cardId, liveModifiers) >= 4
    );
  });
}

function isOwnLiveZoneSource(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player !== null &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
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
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
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
  step: string,
  selectedCardId: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      selectedCardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}
