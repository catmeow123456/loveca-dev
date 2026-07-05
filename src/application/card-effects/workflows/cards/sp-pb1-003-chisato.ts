import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { SP_PB1_003_ON_ENTER_ROTATE_BOTH_PLAYERS_STAGE_ABILITY_ID } from '../../ability-ids.js';
import {
  rearrangeStageMembersAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import type { RearrangeStageMemberPlacement } from '../../../effects/member-state.js';

const SLOT_ROTATION: Readonly<Record<SlotPosition, SlotPosition>> = {
  [SlotPosition.CENTER]: SlotPosition.LEFT,
  [SlotPosition.LEFT]: SlotPosition.RIGHT,
  [SlotPosition.RIGHT]: SlotPosition.CENTER,
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb1003ChisatoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PB1_003_ON_ENTER_ROTATE_BOTH_PLAYERS_STAGE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb1003ChisatoOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function resolveSpPb1003ChisatoOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const conditionMet = hasOnlyFiveyncriseStageMembers(stateWithoutPending, player.id);
  if (!conditionMet) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'ROTATE_STAGE_CONDITION_NOT_MET',
        conditionMet,
      }),
      orderedResolution
    );
  }

  const ownPlacements = createRotationPlacements(stateWithoutPending, player.id);
  const opponentId = stateWithoutPending.players.find((candidate) => candidate.id !== player.id)?.id;
  const opponentPlacements = opponentId
    ? createRotationPlacements(stateWithoutPending, opponentId)
    : [];
  let state = addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'ROTATE_BOTH_PLAYERS_STAGE',
    conditionMet,
    ownPlacements,
    opponentId: opponentId ?? null,
    opponentPlacements,
  });

  const ownRearrange = rearrangeStageMembersAndEnqueueTriggers(
    state,
    player.id,
    ownPlacements,
    enqueueTriggeredCardEffects,
    {
      cause: createCause(player.id, ability),
    }
  );
  state = ownRearrange?.gameState ?? state;

  if (opponentId) {
    const opponentRearrange = rearrangeStageMembersAndEnqueueTriggers(
      state,
      opponentId,
      opponentPlacements,
      enqueueTriggeredCardEffects,
      {
        cause: createCause(player.id, ability),
      }
    );
    state = opponentRearrange?.gameState ?? state;
  }

  return continuePendingCardEffects(state, orderedResolution);
}

function createRotationPlacements(
  game: GameState,
  playerId: string
): readonly RearrangeStageMemberPlacement[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return Object.values(SlotPosition).flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    return cardId ? [{ cardId, toSlot: SLOT_ROTATION[slot] }] : [];
  });
}

function hasOnlyFiveyncriseStageMembers(game: GameState, playerId: string): boolean {
  const members = getStageMemberCards(game, playerId);
  const isFiveyncrise = unitAliasIs('5yncri5e!');
  return members.length > 0 && members.every((member) => isFiveyncrise(member));
}

function getStageMemberCards(game: GameState, playerId: string): readonly CardInstance[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return Object.values(player.memberSlots.slots).flatMap((cardId) => {
    const card = cardId ? getCardById(game, cardId) : null;
    return card && isMemberCardData(card.data) ? [card] : [];
  });
}

function createCause(playerId: string, ability: PendingAbilityState) {
  return {
    kind: 'CARD_EFFECT' as const,
    playerId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    pendingAbilityId: ability.id,
  };
}
