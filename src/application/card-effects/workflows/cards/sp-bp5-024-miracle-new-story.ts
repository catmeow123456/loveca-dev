import { isLiveCardData, isMemberCardData, type HeartIcon } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { getPositionMovedStageMemberIdsMatching } from '../../../effects/conditions.js';
import { SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const CHOOSE_HEART_STEP_ID = 'SP_BP5_024_CHOOSE_HEART';

const HEART_OPTIONS: readonly {
  readonly id: string;
  readonly label: string;
  readonly color: HeartColor;
}[] = [
  { id: 'pink', label: '选择[桃ハート]', color: HeartColor.PINK },
  { id: 'red', label: '选择[赤ハート]', color: HeartColor.RED },
  { id: 'purple', label: '选择[紫ハート]', color: HeartColor.PURPLE },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5024MiracleNewStoryWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID,
    (game, ability, options, context) =>
      startChooseHeartForMovedMembers(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID,
    CHOOSE_HEART_STEP_ID,
    (game, input, context) =>
      finishChooseHeartForMovedMembers(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startChooseHeartForMovedMembers(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (!sourceIsCurrentBp5024Live(game, player.id, ability.sourceCardId)) {
    return consumePendingNoTargets(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_IN_LIVE_ZONE',
    });
  }

  const movedMemberCardIds = getMovedStageMemberCardIds(game, player.id);
  if (movedMemberCardIds.length === 0) {
    return consumePendingNoTargets(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_MOVED_STAGE_MEMBERS',
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_HEART_STEP_ID,
      stepText: '请选择要让本回合移动过的成员获得的 Heart。',
      awaitingPlayerId: player.id,
      selectableOptions: HEART_OPTIONS.map((option) => ({
        id: option.id,
        label: option.label,
      })),
      metadata: {
        orderedResolution,
        movedMemberCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_HEART_FOR_MOVED_MEMBERS',
      movedMemberCardIds,
    },
  });
}

function finishChooseHeartForMovedMembers(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID ||
    effect.stepId !== CHOOSE_HEART_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const selectedOption = HEART_OPTIONS.find((option) => option.id === selectedOptionId);
  if (!player || !selectedOption) {
    return game;
  }

  let state: GameState = { ...game, activeEffect: null };
  if (!sourceIsCurrentBp5024Live(state, player.id, effect.sourceCardId)) {
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SOURCE_NOT_IN_LIVE_ZONE_AFTER_CHOICE',
        selectedHeartColor: selectedOption.color,
        movedMemberCardIds: [],
        modifiedMemberCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  const movedMemberCardIds = getMovedStageMemberCardIds(state, player.id);
  const hearts: readonly HeartIcon[] = [{ color: selectedOption.color, count: 1 }];
  const modifiedMemberCardIds: string[] = [];
  for (const memberCardId of movedMemberCardIds) {
    const modifierResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts,
    });
    if (modifierResult) {
      state = modifierResult.gameState;
      modifiedMemberCardIds.push(memberCardId);
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'CHOOSE_HEART_FOR_MOVED_MEMBERS',
      selectedHeartColor: selectedOption.color,
      movedMemberCardIds,
      modifiedMemberCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingNoTargets(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (!player) {
    return continuePendingCardEffects(stateWithoutPending, orderedResolution);
  }
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
      movedMemberCardIds: [],
      modifiedMemberCardIds: [],
    }),
    orderedResolution
  );
}

function getMovedStageMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getPositionMovedStageMemberIdsMatching(game, playerId, (card) => {
    const currentCard = getCardById(game, card.instanceId);
    return currentCard !== null && isMemberCardData(currentCard.data);
  });
}

function sourceIsCurrentBp5024Live(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    !!player &&
    !!sourceCard &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-024') &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}
