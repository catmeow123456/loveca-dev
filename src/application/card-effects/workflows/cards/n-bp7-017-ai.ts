import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromEnergyDeckBelowStageMember } from '../../../effects/energy-below.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_TARGET_STEP_ID = 'N_BP7_017_SELECT_NIJIGASAKI_MEMBER';
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7017AiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startNBp7017Ai(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID,
    SELECT_TARGET_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishNBp7017Ai(game, input.selectedCardId, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startNBp7017Ai(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const targetCardIds = getNijigasakiStageMemberCardIds(game, ability.controllerId);
  if (!player || player.energyDeck.cardIds.length === 0 || targetCardIds.length === 0) {
    return finishWithoutPlacement(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      player?.energyDeck.cardIds.length === 0 ? 'EMPTY_ENERGY_DECK' : 'NO_VALID_TARGET'
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
      stepId: SELECT_TARGET_STEP_ID,
      stepText: '请选择放置能量的成员。也可以选择不放置。',
      awaitingPlayerId: player.id,
      selectableCardIds: targetCardIds,
      selectionLabel: '选择放置能量的成员',
      confirmSelectionLabel: '放置能量',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_OPTIONAL_TARGET_SELECTION',
      selectableCardIds: targetCardIds,
    },
  });
}

function finishNBp7017Ai(
  game: GameState,
  targetCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_BP7_017_ON_ENTER_PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_TARGET_STEP_ID ||
    effect.selectableCardIds?.includes(targetCardId) !== true
  ) {
    return game;
  }
  const placement = placeEnergyFromEnergyDeckBelowStageMember(
    game,
    effect.controllerId,
    targetCardId,
    1
  );
  const state = { ...(placement?.gameState ?? game), activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: placement ? 'PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER' : 'STALE_TARGET_NO_OP',
      targetMemberCardId: targetCardId,
      targetSlot: placement?.targetSlot ?? null,
      placedEnergyCardIds: placement?.placedEnergyCardIds ?? [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishWithoutPlacement(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      placedEnergyCardIds: [],
    }),
    orderedResolution
  );
}

function getNijigasakiStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    (card) => typeIs(CardType.MEMBER)(card) && groupAliasIs('虹ヶ咲')(card)
  );
}
