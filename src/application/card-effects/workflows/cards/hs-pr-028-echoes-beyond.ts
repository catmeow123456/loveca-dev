import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  collectLiveModifiers,
  memberHasMoreEffectiveHeartsThanPrinted,
} from '../../../../domain/rules/live-modifiers.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { HS_PR_028_LIVE_SUCCESS_EXTRA_EFFECTIVE_HEART_MEMBER_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export function registerHsPr028EchoesBeyondWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    HS_PR_028_LIVE_SUCCESS_EXTRA_EFFECTIVE_HEART_MEMBER_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsPr028EchoesBeyond(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getConfirmationConfig
  );
}

function getConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string; readonly stepText: string } {
  const resolution = evaluateDrawCondition(game, ability);
  const realtimeText = resolution.conditionMet
    ? `当前舞台有${resolution.matchingMemberIds.length}名成员的HEART数量多于原本数量，满足条件，${resolution.canDraw ? '实际抽1张' : '实际不抽牌'}。`
    : '当前舞台没有HEART数量多于原本数量的成员，未满足条件，实际不抽牌。';
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${realtimeText}）`,
    stepText: '确认当前条件并结算此效果。',
  };
}

function resolveHsPr028EchoesBeyond(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const resolution = evaluateDrawCondition(game, ability);
  const drawResult = resolution.canDraw ? drawCardsForPlayer(game, player.id, 1) : null;
  const state = {
    ...(drawResult?.gameState ?? game),
    pendingAbilities: (drawResult?.gameState ?? game).pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CHECK_EXTRA_EFFECTIVE_HEART_MEMBER_DRAW_ONE',
      matchingMemberIds: resolution.matchingMemberIds,
      matchingMemberCount: resolution.matchingMemberIds.length,
      conditionMet: resolution.conditionMet,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function evaluateDrawCondition(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly matchingMemberIds: readonly string[];
  readonly conditionMet: boolean;
  readonly canDraw: boolean;
} {
  const matchingMemberIds = getMatchingMemberIds(game, ability.controllerId);
  const conditionMet = matchingMemberIds.length > 0;
  return {
    matchingMemberIds,
    conditionMet,
    canDraw:
      conditionMet &&
      isCurrentOwnedLiveSource(game, ability.controllerId, ability.sourceCardId),
  };
}

function getMatchingMemberIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  const liveModifiers = collectLiveModifiers(game);
  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    return cardId && memberHasMoreEffectiveHeartsThanPrinted(game, playerId, cardId, liveModifiers)
      ? [cardId]
      : [];
  });
}

function isCurrentOwnedLiveSource(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return Boolean(
    player &&
      sourceCard &&
      sourceCard.ownerId === playerId &&
      isLiveCardData(sourceCard.data) &&
      player.liveZone.cardIds.includes(sourceCardId)
  );
}
