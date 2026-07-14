import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getOpponent,
  getPlayerById,
  updateLiveResolution,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import { PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveInspectedCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const CONFIRM_REVEALED_CARDS_STEP_ID = 'PL_BP3_022_CONFIRM_REVEALED_CARDS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3022YumeNoTobiraWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startYumeNoTobiraLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID,
    CONFIRM_REVEALED_CARDS_STEP_ID,
    (game, _input, context) =>
      finishYumeNoTobiraReveal(
        game,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startYumeNoTobiraLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (!player.liveZone.cardIds.includes(ability.sourceCardId)) {
    return consumePending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_IN_LIVE_ZONE',
      stageMemberCount: countBothStageMembers(game, player.id),
    });
  }

  const stageMemberCount = countBothStageMembers(game, player.id);
  if (stageMemberCount === 0) {
    return consumePending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_STAGE_MEMBERS',
      stageMemberCount,
    });
  }

  const inspection = inspectTopCards(game, player.id, {
    count: stageMemberCount,
    reveal: true,
  });
  if (!inspection || inspection.inspectedCardIds.length === 0) {
    return consumePending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_DECK_CARDS_TO_REVEAL',
      stageMemberCount,
    });
  }

  return startPendingActiveEffect(inspection.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CONFIRM_REVEALED_CARDS_STEP_ID,
      stepText: `已公开${inspection.inspectedCardIds.length}张卡片。确认后将这些卡片放置入休息室，并按其中LIVE卡的数量增加分数。`,
      awaitingPlayerId: player.id,
      inspectionCardIds: inspection.inspectedCardIds,
      revealedCardIds: inspection.inspectedCardIds,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '公开的卡片',
      confirmSelectionLabel: '确认公开结果',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        stageMemberCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_REVEAL_TOP_PER_STAGE_MEMBER',
      stageMemberCount,
      revealedCardIds: inspection.inspectedCardIds,
    },
  });
}

function finishYumeNoTobiraReveal(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_022_LIVE_START_REVEAL_PER_STAGE_MEMBER_GAIN_LIVE_SCORE_ABILITY_ID ||
    effect.stepId !== CONFIRM_REVEALED_CARDS_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const revealedCardIds = effect.inspectionCardIds ?? [];
  if (
    !player ||
    revealedCardIds.length === 0 ||
    revealedCardIds.some((cardId) => !game.inspectionZone.cardIds.includes(cardId))
  ) {
    return game;
  }

  const revealedLiveCardIds = revealedCardIds.filter((cardId) => {
    const card = game.cardRegistry.get(cardId);
    return card !== undefined && isLiveCardData(card.data);
  });
  const moveResult = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
    { ...game, activeEffect: null },
    player.id,
    revealedCardIds,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  const sourceInLiveZone =
    getPlayerById(moveResult.gameState, player.id)?.liveZone.cardIds.includes(effect.sourceCardId) === true;
  const scoreUpdate = replaceSourceScoreModifier(moveResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    scoreBonus: sourceInLiveZone ? revealedLiveCardIds.length : 0,
  });

  return continuePendingCardEffects(
    addAction(scoreUpdate.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: sourceInLiveZone ? 'REVEAL_LIVE_CARDS_GAIN_SCORE' : 'SOURCE_LEFT_LIVE_ZONE',
      stageMemberCount: effect.metadata?.stageMemberCount,
      revealedCardIds,
      revealedLiveCardIds,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
      sourceInLiveZone,
      scoreBonus: scoreUpdate.scoreDelta,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function countBothStageMembers(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  const opponent = getOpponent(game, playerId);
  return (
    (player ? getAllMemberCardIds(player.memberSlots).length : 0) +
    (opponent ? getAllMemberCardIds(opponent.memberSlots).length : 0)
  );
}

function replaceSourceScoreModifier(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly abilityId: string;
    readonly scoreBonus: number;
  }
): { readonly gameState: GameState; readonly scoreDelta: number } {
  const matchingModifiers = game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.playerId === options.playerId &&
      modifier.liveCardId === options.sourceCardId &&
      modifier.sourceCardId === options.sourceCardId &&
      modifier.abilityId === options.abilityId
  );
  const previousScoreBonus = matchingModifiers.reduce(
    (total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0),
    0
  );
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null =
    options.scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: options.playerId,
          countDelta: options.scoreBonus,
          liveCardId: options.sourceCardId,
          sourceCardId: options.sourceCardId,
          abilityId: options.abilityId,
        }
      : null;
  const stateWithModifier = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: options.playerId,
      liveCardId: options.sourceCardId,
      sourceCardId: options.sourceCardId,
      abilityId: options.abilityId,
    },
    replacement
  );
  const scoreDelta = options.scoreBonus - previousScoreBonus;
  return {
    gameState:
      scoreDelta === 0
        ? stateWithModifier
        : updateLiveResolution(stateWithModifier, (liveResolution) => {
            const playerScores = new Map(liveResolution.playerScores);
            playerScores.set(
              options.playerId,
              (playerScores.get(options.playerId) ?? 0) + scoreDelta
            );
            return { ...liveResolution, playerScores };
          }),
    scoreDelta,
  };
}

function consumePending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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
      ...payload,
    }),
    orderedResolution
  );
}
