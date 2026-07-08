import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { getPositionMovedStageMemberIdsMatching } from '../../../effects/conditions.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import {
  S_BP5_022_LIVE_START_MOVED_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
  S_BP5_022_LIVE_SUCCESS_MORE_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp5022SelfControlWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    S_BP5_022_LIVE_START_MOVED_STAGE_MEMBERS_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSBp5022SelfControlLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLiveStartConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    S_BP5_022_LIVE_SUCCESS_MORE_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSBp5022SelfControlLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLiveSuccessConfirmationConfig
  );
}

function getLiveStartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const evaluation = evaluateLiveStartTargets(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（本回合移动过且仍在自己舞台的成员 ${
      evaluation.targetMemberCardIds.length
    }名，${
      evaluation.conditionMet
        ? `实际有${evaluation.targetMemberCardIds.length}名成员获得[BLADE]`
        : '未满足条件，不获得[BLADE]'
    }）`,
  };
}

function resolveSBp5022SelfControlLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const evaluation = evaluateLiveStartTargets(game, ability);
  let state = removePendingAbility(game, ability.id);
  const appliedTargetMemberCardIds: string[] = [];
  if (evaluation.conditionMet) {
    for (const targetMemberCardId of evaluation.targetMemberCardIds) {
      const bladeResult = addBladeLiveModifierForSourceMember(state, {
        playerId: player.id,
        sourceCardId: targetMemberCardId,
        abilityId: ability.abilityId,
        amount: 1,
      });
      if (!bladeResult) {
        continue;
      }
      state = bladeResult.gameState;
      appliedTargetMemberCardIds.push(targetMemberCardId);
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: evaluation.conditionMet ? 'MOVED_STAGE_MEMBERS_GAIN_BLADE' : 'CONDITION_NOT_MET',
      sourceIsCurrentLive: evaluation.sourceIsCurrentLive,
      targetMemberCardIds: evaluation.targetMemberCardIds,
      appliedTargetMemberCardIds,
      targetCount: evaluation.targetMemberCardIds.length,
      bladeBonusPerMember: 1,
    }),
    orderedResolution
  );
}

function getLiveSuccessConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const evaluation = evaluateLiveSuccessCheerLiveCounts(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（自己声援公开LIVE ${
      evaluation.ownCheerLiveCount
    }张，对方声援公开LIVE ${evaluation.opponentCheerLiveCount}张，${
      evaluation.conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'
    }）`,
  };
}

function resolveSBp5022SelfControlLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const evaluation = evaluateLiveSuccessCheerLiveCounts(game, ability);
  const stateWithoutPending = removePendingAbility(game, ability.id);
  const stateAfterModifier = evaluation.conditionMet
    ? addLiveModifier(stateWithoutPending, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: 1,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;
  const stateAfterScoreRefresh = evaluation.conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, 1)
    : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: evaluation.conditionMet ? 'MORE_CHEER_LIVE_THIS_LIVE_SCORE' : 'CONDITION_NOT_MET',
      sourceIsCurrentLive: evaluation.sourceIsCurrentLive,
      ownCheerLiveCardIds: evaluation.ownCheerLiveCardIds,
      opponentCheerLiveCardIds: evaluation.opponentCheerLiveCardIds,
      ownCheerLiveCount: evaluation.ownCheerLiveCount,
      opponentCheerLiveCount: evaluation.opponentCheerLiveCount,
      scoreBonus: evaluation.conditionMet ? 1 : 0,
    }),
    orderedResolution
  );
}

function evaluateLiveStartTargets(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceIsCurrentLive: boolean;
  readonly targetMemberCardIds: readonly string[];
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceIsCurrentLive = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const targetMemberCardIds = sourceIsCurrentLive
    ? getPositionMovedStageMemberIdsMatching(game, ability.controllerId, (card) =>
        isMemberCardData(card.data)
      )
    : [];
  return {
    sourceIsCurrentLive,
    targetMemberCardIds,
    conditionMet: sourceIsCurrentLive && targetMemberCardIds.length > 0,
  };
}

function evaluateLiveSuccessCheerLiveCounts(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceIsCurrentLive: boolean;
  readonly ownCheerLiveCardIds: readonly string[];
  readonly opponentCheerLiveCardIds: readonly string[];
  readonly ownCheerLiveCount: number;
  readonly opponentCheerLiveCount: number;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId) ?? null;
  const sourceIsCurrentLive = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const ownCheerLiveCardIds = player
    ? selectCurrentLiveRevealedCheerCardIds(game, player.id, { cardTypes: CardType.LIVE })
    : [];
  const opponentCheerLiveCardIds = opponent
    ? selectCurrentLiveRevealedCheerCardIds(game, opponent.id, { cardTypes: CardType.LIVE })
    : [];
  return {
    sourceIsCurrentLive,
    ownCheerLiveCardIds,
    opponentCheerLiveCardIds,
    ownCheerLiveCount: ownCheerLiveCardIds.length,
    opponentCheerLiveCount: opponentCheerLiveCardIds.length,
    conditionMet:
      sourceIsCurrentLive && ownCheerLiveCardIds.length > opponentCheerLiveCardIds.length,
  };
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
