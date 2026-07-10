import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForMember,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, SlotPosition } from '../../../../shared/types/enums.js';
import { getCardGroupIdentityKeys } from '../../../../shared/utils/card-identity.js';
import {
  LL_BP5_002_LIVE_START_THREE_DIFFERENT_GROUPS_CENTER_ALL_HEART_ABILITY_ID,
  LL_BP5_002_LIVE_SUCCESS_RECOVER_DIFFERENT_GROUP_CARD_ABILITY_ID,
} from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { createWaitingRoomToHandEffectState } from '../../../effects/zone-selection.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const SELECT_DIFFERENT_GROUP_WAITING_ROOM_CARD_STEP_ID =
  'SELECT_DIFFERENT_GROUP_WAITING_ROOM_CARD';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerLlBp5002BringTheLoveWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    LL_BP5_002_LIVE_START_THREE_DIFFERENT_GROUPS_CENTER_ALL_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBringTheLoveLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getBringTheLoveLiveStartConfirmationConfig
  );
  registerPendingAbilityStarterHandler(
    LL_BP5_002_LIVE_SUCCESS_RECOVER_DIFFERENT_GROUP_CARD_ABILITY_ID,
    (game, ability, options, context) =>
      startBringTheLoveLiveSuccessSelection(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    LL_BP5_002_LIVE_SUCCESS_RECOVER_DIFFERENT_GROUP_CARD_ABILITY_ID,
    SELECT_DIFFERENT_GROUP_WAITING_ROOM_CARD_STEP_ID,
    (game, input, context) =>
      finishBringTheLoveLiveSuccessSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function resolveBringTheLoveLiveStart(
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

  const condition = evaluateDifferentGroupStageCondition(game, player.id);
  const centerMemberCardId = player.memberSlots.slots[SlotPosition.CENTER] ?? null;
  const centerAllHeartCount =
    centerMemberCardId === null
      ? 0
      : getMemberEffectiveHeartIcons(game, player.id, centerMemberCardId).filter(
          (heart) => heart.color === HeartColor.RAINBOW
        ).length;
  const conditionMet = condition.conditionMet && centerMemberCardId !== null;
  const stateWithoutPending = removePending(game, ability.id);
  const heartResult = conditionMet
    ? addHeartLiveModifierForMember(stateWithoutPending, {
        playerId: player.id,
        memberCardId: centerMemberCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      })
    : null;
  const stateAfterModifier = heartResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'CENTER_GAIN_ALL_HEART' : 'CONDITION_NOT_MET',
      stageMemberCardIds: condition.stageMemberCardIds,
      matchedDifferentGroupMemberCardIds: condition.matchedMemberCardIds,
      centerMemberCardId,
      centerAllHeartCountBefore: centerAllHeartCount,
      conditionMet,
      heartBonus: heartResult?.heartBonus ?? [],
    }),
    orderedResolution
  );
}

function startBringTheLoveLiveSuccessSelection(
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

  const selectableCardIds = selectDifferentGroupWaitingRoomCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consumePending(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_DIFFERENT_GROUP_WAITING_ROOM_TARGET',
      { selectableCardIds }
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_DIFFERENT_GROUP_WAITING_ROOM_CARD_STEP_ID,
        stepText:
          '请选择自己休息室中1张与自己舞台所有成员团体名都不同的卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectionLabel: '请选择要加入手牌的卡牌',
        confirmSelectionLabel: '加入手牌',
        zoneSelection: {
          source: 'WAITING_ROOM',
          destination: 'HAND',
          minCount: 1,
          maxCount: 1,
          optional: false,
        },
        metadata: {
          orderedResolution,
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DIFFERENT_GROUP_WAITING_ROOM_CARD',
      selectableCardIds,
    }
  );
}

function finishBringTheLoveLiveSuccessSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== LL_BP5_002_LIVE_SUCCESS_RECOVER_DIFFERENT_GROUP_CARD_ABILITY_ID ||
    effect.stepId !== SELECT_DIFFERENT_GROUP_WAITING_ROOM_CARD_STEP_ID ||
    selectedCardId === null
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const currentCandidateIds = selectDifferentGroupWaitingRoomCardIds(game, player.id);
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: currentCandidateIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const state = {
    ...recoveryResult.gameState,
    activeEffect: null,
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId,
      selectedCardIds: recoveryResult.movedCardIds,
      currentCandidateIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getBringTheLoveLiveStartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const condition = player
    ? evaluateDifferentGroupStageCondition(game, player.id)
    : {
        conditionMet: false,
        stageMemberCardIds: [],
        matchedMemberCardIds: [],
      };
  const centerMemberCardId = player?.memberSlots.slots[SlotPosition.CENTER] ?? null;
  const willGainAllHeart = condition.conditionMet && centerMemberCardId !== null;
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前舞台成员 ${condition.stageMemberCardIds.length}名，互不相同团体成员 ${condition.matchedMemberCardIds.length}名，${
      centerMemberCardId ? '有中心成员' : '无中心成员'
    }；${willGainAllHeart ? '满足条件，确认后中心成员获得[ALLハート]' : '未满足条件，确认后不获得[ALLハート]'}。）`,
    stepText: willGainAllHeart
      ? '确认后中心成员获得[ALLハート]。'
      : '确认后不增加中心成员Heart。',
  };
}

function evaluateDifferentGroupStageCondition(
  game: GameState,
  playerId: string
): {
  readonly conditionMet: boolean;
  readonly stageMemberCardIds: readonly string[];
  readonly matchedMemberCardIds: readonly string[];
} {
  const stageMembers = collectStageMemberGroupContexts(game, playerId);
  const matchedMemberCardIds = findThreePairwiseDifferentGroupMembers(stageMembers);
  return {
    conditionMet: matchedMemberCardIds.length >= 3,
    stageMemberCardIds: stageMembers.map((member) => member.cardId),
    matchedMemberCardIds,
  };
}

function selectDifferentGroupWaitingRoomCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  const stageGroupKeys = new Set(collectStageMemberGroupContexts(game, playerId).flatMap((member) => member.groupKeys));
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    if (!card || card.ownerId !== player.id) {
      return false;
    }
    const cardGroupKeys = getCardGroupIdentityKeys(card.data);
    return cardGroupKeys.length > 0 && cardGroupKeys.every((key) => !stageGroupKeys.has(key));
  });
}

function collectStageMemberGroupContexts(
  game: GameState,
  playerId: string
): readonly {
  readonly cardId: string;
  readonly groupKeys: readonly string[];
}[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return Object.values(player.memberSlots.slots).flatMap((cardId) => {
    if (cardId === null) {
      return [];
    }
    const card = getCardById(game, cardId);
    if (!card || card.ownerId !== player.id || !isMemberCardData(card.data)) {
      return [];
    }
    const groupKeys = getCardGroupIdentityKeys(card.data);
    return groupKeys.length > 0 ? [{ cardId, groupKeys }] : [];
  });
}

function findThreePairwiseDifferentGroupMembers(
  members: readonly {
    readonly cardId: string;
    readonly groupKeys: readonly string[];
  }[]
): readonly string[] {
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      for (let k = j + 1; k < members.length; k += 1) {
        const selected = [members[i], members[j], members[k]];
        if (selected.every((member): member is NonNullable<typeof member> => member !== undefined) && arePairwiseDisjoint(selected)) {
          return selected.map((member) => member.cardId);
        }
      }
    }
  }
  return [];
}

function arePairwiseDisjoint(
  members: readonly {
    readonly groupKeys: readonly string[];
  }[]
): boolean {
  const seen = new Set<string>();
  for (const member of members) {
    for (const key of member.groupKeys) {
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
    }
  }
  return true;
}

function consumePending(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction(removePending(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      ...payload,
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
