import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getPositionMovedStageMemberIdsMatching } from '../../../../domain/rules/member-turn-state.js';
import {
  addLiveModifier,
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { LL_BP5_001_LIVE_SUCCESS_CHEER_LIVE_OR_STAGE_HEARTS_OR_MOVED_SCORE_ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const SCORE_BONUS = 1;
const COUNTED_HEART_COLORS = new Set<HeartColor>([
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
]);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLlBp5001LiveWithASmileWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    LL_BP5_001_LIVE_SUCCESS_CHEER_LIVE_OR_STAGE_HEARTS_OR_MOVED_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveWithASmile(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLiveWithASmileConfirmationConfig
  );
}

function resolveLiveWithASmile(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !player.liveZone.cardIds.includes(ability.sourceCardId)) {
    return consumePending(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_LIVE_NOT_IN_LIVE_ZONE'
    );
  }

  const conditions = evaluateLiveWithASmileConditions(game, player.id);
  let state = removePending(game, ability.id);
  if (conditions.conditionMet) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      liveCardId: ability.sourceCardId,
      countDelta: SCORE_BONUS,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    });
    state = refreshPlayerScoreDraft(state, player.id, SCORE_BONUS);
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditions.conditionMet ? 'APPLY_SCORE_BONUS' : 'CONDITION_NOT_MET',
      scoreBonus: conditions.conditionMet ? SCORE_BONUS : 0,
      cheerLiveCardIds: conditions.cheerLiveCardIds,
      cheerLiveCount: conditions.cheerLiveCount,
      stageHeartColors: conditions.stageHeartColors,
      stageHeartColorCount: conditions.stageHeartColorCount,
      movedMemberCardIds: conditions.movedMemberCardIds,
      hasTwoCheerLiveCards: conditions.hasTwoCheerLiveCards,
      hasFiveStageHeartColors: conditions.hasFiveStageHeartColors,
      hasMovedStageMember: conditions.hasMovedStageMember,
    }),
    orderedResolution
  );
}

function getLiveWithASmileConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const conditions = player
    ? evaluateLiveWithASmileConditions(game, player.id)
    : createEmptyConditions();
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己声援公开LIVE ${conditions.cheerLiveCount}张，舞台成员Heart颜色 ${conditions.stageHeartColorCount}种，本回合区域移动成员 ${conditions.movedMemberCardIds.length}名；${
      conditions.conditionMet ? '满足条件，确认后此LIVE[スコア]+1' : '未满足条件，确认后不增加[スコア]'
    }。）`,
    stepText: conditions.conditionMet ? '确认后此LIVE[スコア]+1。' : '确认后不增加[スコア]。',
  };
}

function evaluateLiveWithASmileConditions(
  game: GameState,
  playerId: string
): {
  readonly cheerLiveCardIds: readonly string[];
  readonly cheerLiveCount: number;
  readonly stageHeartColors: readonly HeartColor[];
  readonly stageHeartColorCount: number;
  readonly movedMemberCardIds: readonly string[];
  readonly hasTwoCheerLiveCards: boolean;
  readonly hasFiveStageHeartColors: boolean;
  readonly hasMovedStageMember: boolean;
  readonly conditionMet: boolean;
} {
  const cheerLiveCardIds = selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    cardTypes: CardType.LIVE,
    predicate: (card) => isLiveCardData(card.data),
  });
  const stageHeartColors = collectStageHeartColors(game, playerId);
  const movedMemberCardIds = getPositionMovedStageMemberIdsMatching(game, playerId, () => true);
  const hasTwoCheerLiveCards = cheerLiveCardIds.length >= 2;
  const hasFiveStageHeartColors = stageHeartColors.length >= 5;
  const hasMovedStageMember = movedMemberCardIds.length > 0;

  return {
    cheerLiveCardIds,
    cheerLiveCount: cheerLiveCardIds.length,
    stageHeartColors,
    stageHeartColorCount: stageHeartColors.length,
    movedMemberCardIds,
    hasTwoCheerLiveCards,
    hasFiveStageHeartColors,
    hasMovedStageMember,
    conditionMet: hasTwoCheerLiveCards || hasFiveStageHeartColors || hasMovedStageMember,
  };
}

function collectStageHeartColors(game: GameState, playerId: string): readonly HeartColor[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  const liveModifiers = collectLiveModifiers(game);
  const colors = new Set<HeartColor>();
  for (const memberCardId of Object.values(player.memberSlots.slots)) {
    if (memberCardId === null || getCardById(game, memberCardId) === null) {
      continue;
    }
    for (const heart of getMemberEffectiveHeartIcons(game, player.id, memberCardId, liveModifiers)) {
      if (COUNTED_HEART_COLORS.has(heart.color)) {
        colors.add(heart.color);
      }
    }
  }
  return [...colors].sort();
}

function createEmptyConditions(): ReturnType<typeof evaluateLiveWithASmileConditions> {
  return {
    cheerLiveCardIds: [],
    cheerLiveCount: 0,
    stageHeartColors: [],
    stageHeartColorCount: 0,
    movedMemberCardIds: [],
    hasTwoCheerLiveCards: false,
    hasFiveStageHeartColors: false,
    hasMovedStageMember: false,
    conditionMet: false,
  };
}

function consumePending(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(removePending(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
    }),
    orderedResolution
  );
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
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
