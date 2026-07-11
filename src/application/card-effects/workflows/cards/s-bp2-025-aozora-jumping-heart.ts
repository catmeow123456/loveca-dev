import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID;
const SELECT_MEMBER_STEP_ID = 'S_BP2_025_SELECT_MEMBER_BLADE_TARGET';
const BLADE_BONUS = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp2025AozoraJumpingHeartWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startAozoraJumpingHeartLiveStart(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_MEMBER_STEP_ID, (game, input, context) =>
    finishAozoraJumpingHeartMemberSelection(
      game,
      input.selectedCardId ?? null,
      context.continuePendingCardEffects
    )
  );
}

function startAozoraJumpingHeartLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = removePendingAbility(game, ability.id);
  if (!isSourceOwnLive(stateWithoutPending, player.id, ability.sourceCardId)) {
    return continueNoOp(stateWithoutPending, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_IN_LIVE_ZONE',
    });
  }

  if (player.successZone.cardIds.length < 2) {
    return continueNoOp(stateWithoutPending, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SUCCESS_LIVE_COUNT_BELOW_TWO',
      successLiveCount: player.successZone.cardIds.length,
    });
  }

  const targetMemberCardIds = getOwnStageMemberCardIds(stateWithoutPending, player.id);
  if (targetMemberCardIds.length === 0) {
    return continueNoOp(stateWithoutPending, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_STAGE_MEMBER_TARGET',
    });
  }

  if (targetMemberCardIds.length === 1) {
    return applyBladeAndContinue(
      stateWithoutPending,
      ability,
      player.id,
      targetMemberCardIds[0],
      orderedResolution,
      continuePendingCardEffects,
      'AUTO_TARGET_MEMBER_GAIN_TWO_BLADE'
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_MEMBER_STEP_ID,
        stepText: '请选择自己舞台上的1名成员获得[BLADE][BLADE]。',
        awaitingPlayerId: player.id,
        selectableCardIds: targetMemberCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得[BLADE][BLADE]的成员',
        confirmSelectionLabel: '获得[BLADE][BLADE]',
        canSkipSelection: false,
        metadata: { orderedResolution },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_MEMBER_BLADE_TARGET',
      selectableCardIds: targetMemberCardIds,
    }
  );
}

function finishAozoraJumpingHeartMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_MEMBER_STEP_ID) {
    return game;
  }
  if (selectedCardId === null || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const currentTargetMemberCardIds = player ? getOwnStageMemberCardIds(game, player.id) : [];
  const validSelection =
    player !== null &&
    currentTargetMemberCardIds.includes(selectedCardId) &&
    isSourceOwnLive(game, player.id, effect.sourceCardId) &&
    player.successZone.cardIds.length >= 2;

  if (!player || !validSelection) {
    return finishSelectionWithoutBlade(game, effect, player?.id ?? effect.controllerId, continuePendingCardEffects, {
      step: 'STALE_OR_INVALID_MEMBER_SELECTION',
      selectedCardId,
      selectableCardIds: currentTargetMemberCardIds,
    });
  }

  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: BLADE_BONUS,
  });
  if (!bladeResult) {
    return finishSelectionWithoutBlade(game, effect, player.id, continuePendingCardEffects, {
      step: 'TARGET_MEMBER_NO_LONGER_VALID',
      selectedCardId,
    });
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_MEMBER_GAIN_TWO_BLADE',
      targetMemberCardId: selectedCardId,
      bladeBonus: BLADE_BONUS,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function applyBladeAndContinue(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  targetMemberCardId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId,
    sourceCardId: targetMemberCardId,
    abilityId: ability.abilityId,
    amount: BLADE_BONUS,
  });
  if (!bladeResult) {
    return continueNoOp(game, ability, playerId, orderedResolution, continuePendingCardEffects, {
      step: 'TARGET_MEMBER_NO_LONGER_VALID',
      targetMemberCardId,
    });
  }
  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      targetMemberCardId,
      bladeBonus: BLADE_BONUS,
    }),
    orderedResolution
  );
}

function continueNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(game, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function finishSelectionWithoutBlade(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isSourceOwnLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player !== null &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function getOwnStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER));
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
