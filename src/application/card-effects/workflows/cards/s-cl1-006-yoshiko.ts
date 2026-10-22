import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { S_CL1_006_LIVE_START_BOTTOM_HAND_GAIN_TWO_BLADE_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import {
  addBladeLiveModifierForSourceMember,
  moveHandCardToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const SELECT = 'S_CL1_006_SELECT_HAND_TO_BOTTOM';
type Continue = (game: GameState, ordered: boolean) => GameState;
function handCandidates(game: GameState, playerId: string) {
  return (getPlayerById(game, playerId)?.hand.cardIds ?? []).filter(
    (id) => getCardById(game, id)?.ownerId === playerId
  );
}
export function registerSCl1006YoshikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY, (game, ability, options, context) =>
    start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY,
    SELECT,
    (game, input, context) =>
      finish(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
    queryCardSelection
  );
}
function start(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: Continue
): GameState {
  const candidates = handCandidates(game, ability.controllerId);
  if (candidates.length === 0)
    return next(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        ability.controllerId,
        {
          abilityId: ABILITY,
          sourceCardId: ability.sourceCardId,
          pendingAbilityId: ability.id,
          step: 'NO_HAND_TO_BOTTOM',
        }
      ),
      ordered
    );
  return startPendingActiveEffect(game, {
    ability,
    playerId: ability.controllerId,
    activeEffect: {
      id: ability.id,
      abilityId: ABILITY,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ABILITY),
      stepId: SELECT,
      stepText:
        '可以将1张手牌放置于卡组底。若如此做，LIVE结束时为止，此成员获得[ブレード][ブレード]。',
      awaitingPlayerId: ability.controllerId,
      selectableCardIds: candidates,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择放置于卡组底的手牌',
      confirmSelectionLabel: '放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution: ordered },
    },
    actionPayload: { step: 'START_SELECT_HAND_CARD' },
  });
}
function finish(game: GameState, selectedId: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY || effect.stepId !== SELECT) return game;
  if (selectedId === null)
    return finishSkippedActiveEffect(game, next, { step: 'DECLINE_BOTTOM_HAND' });
  if (
    !effect.selectableCardIds?.includes(selectedId) ||
    !handCandidates(game, effect.controllerId).includes(selectedId)
  )
    return game;
  const moved = moveHandCardToDeckBottomForPlayer(game, effect.controllerId, selectedId, {
    candidateCardIds: effect.selectableCardIds ?? [],
  });
  if (!moved) return game;
  const paid = recordPayCostAction(moved.gameState, effect.controllerId, {
    abilityId: ABILITY,
    sourceCardId: effect.sourceCardId,
    movedToMainDeckCardIds: [selectedId],
    destination: 'BOTTOM',
  });
  const bonus = isCurrentStageMemberAbilitySource(paid, effect)
    ? addBladeLiveModifierForSourceMember(paid, {
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY,
        amount: 2,
      })
    : null;
  return next(
    addAction(
      { ...(bonus?.gameState ?? paid), activeEffect: null },
      'RESOLVE_ABILITY',
      effect.controllerId,
      {
        abilityId: ABILITY,
        sourceCardId: effect.sourceCardId,
        pendingAbilityId: effect.id,
        step: 'BOTTOM_HAND_GAIN_BLADE',
        bottomedCardId: selectedId,
        bladeBonus: bonus ? 2 : 0,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}
