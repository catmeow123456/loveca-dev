import { addAction, getCardById, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { moveRevealedCheerCards, selectRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { S_BP3_002_LIVE_SUCCESS_HIGHER_SCORE_SELF_REVEALED_CHEER_TO_HAND_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler, type PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, maybeStartConfirmablePendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

const SELECT_MOVE_TO_HAND_STEP_ID = 'S_BP3_002_SELECT_MOVE_SELF_TO_HAND';
const MOVE_TO_HAND_OPTION_ID = 'MOVE_TO_HAND';
const BASE_CARD_CODE = 'PL!S-bp3-002';

type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp3002RikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP3_002_LIVE_SUCCESS_HIGHER_SCORE_SELF_REVEALED_CHEER_TO_HAND_ABILITY_ID,
    (game, ability, options, context) => startSBp3002Riko(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    S_BP3_002_LIVE_SUCCESS_HIGHER_SCORE_SELF_REVEALED_CHEER_TO_HAND_ABILITY_ID,
    SELECT_MOVE_TO_HAND_STEP_ID,
    (game, input, context) => finishSBp3002Riko(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
}

function getScoreComparison(game: GameState, playerId: string) {
  const opponent = game.players.find((player) => player.id !== playerId);
  const ownScore = game.liveResolution.playerScores.get(playerId) ?? 0;
  const opponentScore = opponent ? (game.liveResolution.playerScores.get(opponent.id) ?? 0) : 0;
  return { ownScore, opponentScore, conditionMet: ownScore > opponentScore };
}

function sourceIsCurrentRevealedCheer(game: GameState, ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>): boolean {
  const source = getCardById(game, ability.sourceCardId);
  return !!source && cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    source.ownerId === ability.controllerId &&
    selectRevealedCheerCardIds(game, ability.controllerId).includes(ability.sourceCardId);
}

function noOp(game: GameState, ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>, orderedResolution: boolean, continuePendingCardEffects: Continue, params: { readonly step: 'CONDITION_NOT_MET' | 'SOURCE_NOT_CURRENT_REVEALED_CHEER' | 'DECLINED_MOVE_TO_HAND'; readonly declined: boolean }) {
  const comparison = getScoreComparison(game, ability.controllerId);
  return continuePendingCardEffects(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, {
    pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
    ownScore: comparison.ownScore, opponentScore: comparison.opponentScore, conditionMet: comparison.conditionMet,
    declined: params.declined, movedCardIds: [], step: params.step,
  }), orderedResolution);
}

function startSBp3002Riko(game: GameState, ability: PendingAbilityState, options: PendingAbilityStarterOptions, continuePendingCardEffects: Continue): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const comparison = getScoreComparison(game, player.id);
  if (!sourceIsCurrentRevealedCheer(game, ability)) {
    return noOp(game, ability, options.orderedResolution === true, continuePendingCardEffects, {
      step: 'SOURCE_NOT_CURRENT_REVEALED_CHEER', declined: false,
    });
  }
  if (!comparison.conditionMet) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: `${getAbilityEffectText(ability.abilityId)}（当前LIVE合计分数为${comparison.ownScore}对${comparison.opponentScore}，未满足条件，此卡不加入手牌。）`,
      stepText: `当前LIVE合计分数为${comparison.ownScore}对${comparison.opponentScore}，未满足条件，此卡不加入手牌。`,
    });
    return confirmation ?? noOp(game, ability, options.orderedResolution === true, continuePendingCardEffects, {
      step: 'CONDITION_NOT_MET', declined: false,
    });
  }
  return addAction({
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId), stepId: SELECT_MOVE_TO_HAND_STEP_ID,
      stepText: '当前LIVE合计分数高于对方，可以将此卡加入手牌。', awaitingPlayerId: player.id,
      selectableOptions: [{ id: MOVE_TO_HAND_OPTION_ID, label: '加入手牌' }], canSkipSelection: true,
      skipSelectionLabel: '不加入', metadata: { orderedResolution: options.orderedResolution === true },
    },
  }, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step: 'START_OPTIONAL_MOVE_TO_HAND', ...comparison });
}

function finishSBp3002Riko(game: GameState, selectedOptionId: string | null, continuePendingCardEffects: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== S_BP3_002_LIVE_SUCCESS_HIGHER_SCORE_SELF_REVEALED_CHEER_TO_HAND_ABILITY_ID || effect.stepId !== SELECT_MOVE_TO_HAND_STEP_ID) return game;
  const ability = { id: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, controllerId: effect.controllerId };
  const ordered = effect.metadata?.orderedResolution === true;
  if (selectedOptionId === null) return noOp({ ...game, activeEffect: null }, ability, ordered, continuePendingCardEffects, { step: 'DECLINED_MOVE_TO_HAND', declined: true });
  if (selectedOptionId !== MOVE_TO_HAND_OPTION_ID) return game;
  const comparison = getScoreComparison(game, effect.controllerId);
  if (!sourceIsCurrentRevealedCheer(game, effect)) return noOp({ ...game, activeEffect: null }, ability, ordered, continuePendingCardEffects, { step: 'SOURCE_NOT_CURRENT_REVEALED_CHEER', declined: false });
  if (!comparison.conditionMet) return noOp({ ...game, activeEffect: null }, ability, ordered, continuePendingCardEffects, { step: 'CONDITION_NOT_MET', declined: false });
  const moved = moveRevealedCheerCards(game, effect.controllerId, [effect.sourceCardId], 'HAND');
  if (!moved) return noOp({ ...game, activeEffect: null }, ability, ordered, continuePendingCardEffects, { step: 'SOURCE_NOT_CURRENT_REVEALED_CHEER', declined: false });
  return continuePendingCardEffects(addAction({ ...moved.gameState, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    ownScore: comparison.ownScore, opponentScore: comparison.opponentScore, conditionMet: true, declined: false,
    movedCardIds: moved.movedCardIds, step: 'MOVE_SELF_TO_HAND',
  }), ordered);
}
