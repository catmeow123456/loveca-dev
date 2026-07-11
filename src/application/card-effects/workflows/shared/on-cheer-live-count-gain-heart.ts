import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, TriggerCondition } from '../../../../shared/types/enums.js';
import {
  S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
  S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

interface OnCheerLiveCountGainHeartWorkflowConfig {
  readonly abilityId: string;
  readonly heartColor: HeartColor;
  readonly maxHeartCount: number;
  readonly minimumMatchingLiveCount: number;
  readonly conditionFailedConsumesTurnUse: boolean;
  readonly actionStep: string;
}

const ON_CHEER_LIVE_COUNT_GAIN_HEART_WORKFLOW_CONFIGS: readonly OnCheerLiveCountGainHeartWorkflowConfig[] = [
  {
    abilityId: S_SD1_001_AUTO_ON_CHEER_LIVE_COUNT_GAIN_RED_HEART_ABILITY_ID,
    heartColor: HeartColor.RED,
    maxHeartCount: 3,
    minimumMatchingLiveCount: 0,
    conditionFailedConsumesTurnUse: true,
    actionStep: 'COUNT_OWN_CHEER_LIVE_CARDS_GAIN_RED_HEART',
  },
  {
    abilityId: S_BP2_003_AUTO_ON_CHEER_LIVE_GAIN_GREEN_HEART_ABILITY_ID,
    heartColor: HeartColor.GREEN,
    maxHeartCount: 1,
    minimumMatchingLiveCount: 1,
    conditionFailedConsumesTurnUse: false,
    actionStep: 'OWN_CHEER_LIVE_CONDITION_GAIN_GREEN_HEART',
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerOnCheerLiveCountGainHeartWorkflowHandlers(): void {
  for (const config of ON_CHEER_LIVE_COUNT_GAIN_HEART_WORKFLOW_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveOnCheerLiveCountGainHeart(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOnCheerLiveCountGainHeart(
  game: GameState,
  ability: PendingAbilityState,
  config: OnCheerLiveCountGainHeartWorkflowConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return finishPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'SOURCE_NOT_ON_STAGE',
        sourceSlot,
      }
    );
  }

  const cheerEvent = getLatestOwnNormalCheerEventByIds(game, player.id, ability.eventIds);
  if (!cheerEvent) {
    return finishPendingAbility(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_MATCHING_OWN_NORMAL_CHEER_EVENT',
      sourceSlot,
    });
  }

  const matchingLiveCardIds = cheerEvent.revealedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && isLiveCardData(card.data);
  });
  const conditionMet = matchingLiveCardIds.length >= config.minimumMatchingLiveCount;
  const gainedHeartCount = conditionMet
    ? Math.min(matchingLiveCardIds.length, config.maxHeartCount)
    : 0;

  let state = removePendingAbility(game, ability.id);
  if (conditionMet || config.conditionFailedConsumesTurnUse) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
    });
  }

  if (gainedHeartCount > 0) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: config.heartColor, count: gainedHeartCount }],
    });
    if (heartResult) {
      state = heartResult.gameState;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: config.actionStep,
      cheerEventId: cheerEvent.eventId,
      revealedCardIds: cheerEvent.revealedCardIds,
      matchingLiveCardIds,
      conditionMet,
      gainedHearts: gainedHeartCount > 0 ? [{ color: config.heartColor, count: gainedHeartCount }] : [],
    }),
    orderedResolution
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
