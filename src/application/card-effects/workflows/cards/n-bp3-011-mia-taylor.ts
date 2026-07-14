import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
  getMemberOriginalBladeCount,
} from '../../../../domain/rules/live-modifiers.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import { CardType } from '../../../../shared/types/enums.js';
import { cardNameAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_N_BP3_011_ON_ENTER_COMPARE_OPPONENT_MEMBER_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_OPPONENT_MEMBER_STEP_ID = 'PL_N_BP3_011_SELECT_OPPONENT_MEMBER_TO_COMPARE';
const miaName = cardNameAliasIs('ミア・テイラー');
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3011MiaTaylorWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_011_ON_ENTER_COMPARE_OPPONENT_MEMBER_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_011_ON_ENTER_COMPARE_OPPONENT_MEMBER_GAIN_BLADE_ABILITY_ID,
    SELECT_OPPONENT_MEMBER_STEP_ID,
    (game, input, context) =>
      finish(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const targets = player ? getLegalTargets(game, player.id, ability.sourceCardId) : [];
  if (!player || !isOwnMainStageMember(game, player.id, ability.sourceCardId) || targets.length === 0) {
    return consume(game, ability, orderedResolution, continuePendingCardEffects, 'NO_LEGAL_TARGET');
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
      stepText: '请选择对方舞台上1名「米娅·泰勒」以外的成员进行比较。',
      awaitingPlayerId: player.id,
      selectableCardIds: targets,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要与此成员比较的对方成员',
      confirmSelectionLabel: '进行比较',
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_SELECT_OPPONENT_MEMBER', selectableCardIds: targets },
  });
}

function finish(
  game: GameState,
  targetCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.stepId !== SELECT_OPPONENT_MEMBER_STEP_ID || !player || !targetCardId ||
      effect.selectableCardIds?.includes(targetCardId) !== true) return game;
  const opponent = game.players.find((candidate) => candidate.id !== player.id);
  const legalTargets = getLegalTargets(game, player.id, effect.sourceCardId);
  if (!opponent || !isOwnMainStageMember(game, player.id, effect.sourceCardId) ||
      !legalTargets.includes(targetCardId)) {
    return consumeActive(game, effect, player.id, continuePendingCardEffects, 'SOURCE_OR_TARGET_INVALID');
  }

  const modifiers = collectLiveModifiers(game);
  const sourceColors = new Set(
    getMemberEffectiveHeartIcons(game, player.id, effect.sourceCardId, modifiers)
      .filter((heart) => heart.count > 0).map((heart) => heart.color)
  );
  const heartMatches = getMemberEffectiveHeartIcons(game, opponent.id, targetCardId, modifiers)
    .some((heart) => heart.count > 0 && sourceColors.has(heart.color));
  const costMatches = getMemberEffectiveCost(game, player.id, effect.sourceCardId) ===
    getMemberEffectiveCost(game, opponent.id, targetCardId);
  const originalBladeMatches = getMemberOriginalBladeCount(game, player.id, effect.sourceCardId, modifiers) ===
    getMemberOriginalBladeCount(game, opponent.id, targetCardId, modifiers);
  const bladeBonus = Number(heartMatches) + Number(costMatches) + Number(originalBladeMatches);
  const stateWithoutEffect = { ...game, activeEffect: null };
  const result = bladeBonus > 0
    ? addBladeLiveModifierForSourceMember(stateWithoutEffect, {
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        amount: bladeBonus,
      })
    : null;
  const resolved = result?.gameState ?? stateWithoutEffect;
  return continuePendingCardEffects(
    addAction(resolved, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'COMPARE_OPPONENT_MEMBER_GAIN_BLADE',
      targetMemberCardId: targetCardId,
      heartMatches,
      costMatches,
      originalBladeMatches,
      bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumeActive(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  return continuePendingCardEffects(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
    pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    step: 'NO_OP_COMPARE_OPPONENT_MEMBER', reason,
  }), effect.metadata?.orderedResolution === true);
}

function getLegalTargets(game: GameState, playerId: string, sourceCardId: string): readonly string[] {
  if (!isOwnMainStageMember(game, playerId, sourceCardId)) return [];
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  if (!opponent) return [];
  return getStageMemberCardIdsMatching(game, opponent.id, typeIs(CardType.MEMBER))
    .filter((cardId) => {
      const card = getCardById(game, cardId);
      return card ? !miaName(card) : false;
    });
}

function isOwnMainStageMember(game: GameState, playerId: string, cardId: string): boolean {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).includes(cardId);
}

function consume(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  const state = { ...game, pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id) };
  return continuePendingCardEffects(addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
    pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
    step: 'NO_OP_COMPARE_OPPONENT_MEMBER', reason,
  }), orderedResolution);
}
