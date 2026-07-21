import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SlotPosition, ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { SP_PB2_005_ON_ENTER_RELAY_STACK_REPLACED_LIELLA_MEMBER_BELOW_ABILITY_ID } from '../../ability-ids.js';
import { stackMemberCardBelowStageMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_RELAY_REPLACEMENT_STEP_ID = 'SP_PB2_005_SELECT_RELAY_REPLACEMENT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2005RenWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_005_ON_ENTER_RELAY_STACK_REPLACED_LIELLA_MEMBER_BELOW_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb2005RenOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_005_ON_ENTER_RELAY_STACK_REPLACED_LIELLA_MEMBER_BELOW_ABILITY_ID,
    SELECT_RELAY_REPLACEMENT_STEP_ID,
    (game, input, context) =>
      finishSelectedRelayReplacement(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpPb2005RenOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  if (!sourceSlot) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'RELAY_STACK_REPLACEMENT_NOOP',
        conditionMet: false,
        reason: 'SOURCE_NOT_ON_STAGE',
      },
      continuePendingCardEffects
    );
  }

  const relayReplacementCardIds = getRelayReplacementCardIds(ability.metadata?.relayReplacements);
  const validReplacementCardIds = getValidLiellaRelayReplacementCardIds(
    game,
    player.id,
    relayReplacementCardIds
  );
  if (validReplacementCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'RELAY_STACK_REPLACEMENT_NOOP',
        conditionMet: false,
        reason: relayReplacementCardIds.length === 0 ? 'NO_RELAY_METADATA' : 'NO_VALID_REPLACEMENT',
        sourceSlot,
        relayReplacementCardIds,
        validReplacementCardIds,
      },
      continuePendingCardEffects
    );
  }

  if (validReplacementCardIds.length === 1) {
    return stackSelectedReplacementAndFinish(
      game,
      ability,
      player.id,
      sourceSlot,
      validReplacementCardIds[0],
      orderedResolution,
      relayReplacementCardIds,
      validReplacementCardIds,
      continuePendingCardEffects
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_RELAY_REPLACEMENT_STEP_ID,
        stepText: '请选择1张因此换手放置入休息室的『Liella!』成员卡。',
        awaitingPlayerId: player.id,
        selectableCardIds: validReplacementCardIds,
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择要放置到此成员下方的成员',
        confirmSelectionLabel: '放置到下方',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          sourceSlot,
          relayReplacementCardIds,
          validReplacementCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_RELAY_REPLACEMENT_TO_STACK',
      sourceSlot,
      relayReplacementCardIds,
      validReplacementCardIds,
    }
  );
}

function finishSelectedRelayReplacement(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_005_ON_ENTER_RELAY_STACK_REPLACED_LIELLA_MEMBER_BELOW_ABILITY_ID ||
    effect.stepId !== SELECT_RELAY_REPLACEMENT_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot) {
    return game;
  }

  const ability: PendingAbilityState = {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: effect.abilityId,
    eventIds: [],
  };
  return stackSelectedReplacementAndFinish(
    { ...game, activeEffect: null },
    ability,
    player.id,
    sourceSlot,
    selectedCardId,
    effect.metadata?.orderedResolution === true,
    getStringArray(effect.metadata?.relayReplacementCardIds),
    getStringArray(effect.metadata?.validReplacementCardIds),
    continuePendingCardEffects
  );
}

function stackSelectedReplacementAndFinish(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  sourceSlot: SlotPosition,
  selectedCardId: string,
  orderedResolution: boolean,
  relayReplacementCardIds: readonly string[],
  validReplacementCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stackResult = stackMemberCardBelowStageMember(game, {
    playerId,
    sourceZone: ZoneType.WAITING_ROOM,
    movedCardId: selectedCardId,
    hostCardId: ability.sourceCardId,
    targetSlot: sourceSlot,
  });
  if (!stackResult) {
    return finishPendingAbility(
      game,
      ability,
      playerId,
      orderedResolution,
      {
        step: 'RELAY_STACK_REPLACEMENT_NOOP',
        conditionMet: false,
        reason: 'STACK_FAILED',
        sourceSlot,
        relayReplacementCardIds,
        validReplacementCardIds,
        selectedCardId,
      },
      continuePendingCardEffects
    );
  }

  return finishPendingAbility(
    stackResult.gameState,
    ability,
    playerId,
    orderedResolution,
    {
      step: 'RELAY_STACK_REPLACEMENT_BELOW',
      conditionMet: true,
      sourceSlot,
      relayReplacementCardIds,
      validReplacementCardIds,
      selectedCardId,
      stackedCardId: stackResult.movedCardId,
    },
    continuePendingCardEffects
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getValidLiellaRelayReplacementCardIds(
  game: GameState,
  playerId: string,
  relayReplacementCardIds: readonly string[]
): readonly string[] {
  const player = getPlayerById(game, playerId);
  const isLiella = groupAliasIs('Liella!');
  if (!player) {
    return [];
  }
  return relayReplacementCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      player.waitingRoom.cardIds.includes(cardId) &&
      isMemberCardData(card.data) &&
      isLiella(card)
    );
  });
}

function getRelayReplacementCardIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const cardId = (entry as { readonly cardId?: unknown }).cardId;
    return typeof cardId === 'string' ? [cardId] : [];
  });
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
