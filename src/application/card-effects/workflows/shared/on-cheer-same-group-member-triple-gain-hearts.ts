import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  getCardGroupIdentityKeys,
  type GroupIdentityKey,
} from '../../../../shared/utils/card-identity.js';
import {
  N_PR_023_AUTO_ON_CHEER_SAME_GROUP_MEMBER_THREE_GAIN_PINK_GREEN_HEART_ABILITY_ID,
  S_PR_040_AUTO_ON_CHEER_SAME_GROUP_MEMBER_THREE_GAIN_PINK_GREEN_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

const ABILITY_IDS = [
  N_PR_023_AUTO_ON_CHEER_SAME_GROUP_MEMBER_THREE_GAIN_PINK_GREEN_HEART_ABILITY_ID,
  S_PR_040_AUTO_ON_CHEER_SAME_GROUP_MEMBER_THREE_GAIN_PINK_GREEN_HEART_ABILITY_ID,
] as const;

const GAINED_HEARTS = [
  { color: HeartColor.PINK, count: 1 },
  { color: HeartColor.GREEN, count: 1 },
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerOnCheerSameGroupMemberTripleGainHeartsWorkflowHandlers(): void {
  for (const abilityId of ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      resolveOnCheerSameGroupMemberTripleGainHearts(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOnCheerSameGroupMemberTripleGainHearts(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return finishWithoutTurnUse(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'SOURCE_NOT_ON_STAGE', sourceSlot }
    );
  }

  const cheerEvent = getLatestOwnNormalCheerEventByIds(game, player.id, ability.eventIds);
  if (!cheerEvent) {
    return finishWithoutTurnUse(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'NO_MATCHING_OWN_NORMAL_CHEER_EVENT', sourceSlot }
    );
  }

  const groupMemberIds = new Map<GroupIdentityKey, Set<string>>();
  for (const cardId of new Set(cheerEvent.revealedCardIds)) {
    const card = getCardById(game, cardId);
    if (!card || card.ownerId !== player.id || !isMemberCardData(card.data)) {
      continue;
    }
    for (const groupKey of getCardGroupIdentityKeys(card.data)) {
      const memberIds = groupMemberIds.get(groupKey) ?? new Set<string>();
      memberIds.add(card.instanceId);
      groupMemberIds.set(groupKey, memberIds);
    }
  }

  const groupCounts = Object.fromEntries(
    [...groupMemberIds.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([groupKey, memberIds]) => [groupKey, memberIds.size])
  );
  const qualifyingGroupKeys = [...groupMemberIds.entries()]
    .filter(([, memberIds]) => memberIds.size >= 3)
    .map(([groupKey]) => groupKey)
    .sort();
  const qualifyingGroupKeySet = new Set(qualifyingGroupKeys);
  const matchingMemberCardIds = [
    ...new Set(
      [...groupMemberIds.entries()]
        .filter(([groupKey]) => qualifyingGroupKeySet.has(groupKey))
        .flatMap(([, memberIds]) => [...memberIds])
    ),
  ];
  const conditionMet = qualifyingGroupKeys.length > 0;

  let state = removePendingAbility(game, ability.id);
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  let gainedHearts: readonly { readonly color: HeartColor; readonly count: number }[] = [];
  if (conditionMet) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: GAINED_HEARTS,
    });
    if (heartResult) {
      state = heartResult.gameState;
      gainedHearts = heartResult.heartBonus;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'COUNT_SAME_GROUP_REVEALED_MEMBERS_GAIN_PINK_GREEN_HEARTS',
      cheerEventId: cheerEvent.eventId,
      revealedCardIds: cheerEvent.revealedCardIds,
      matchingMemberCardIds,
      groupCounts,
      qualifyingGroupKeys,
      conditionMet,
      gainedHearts,
    }),
    orderedResolution
  );
}

function finishWithoutTurnUse(
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
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}
