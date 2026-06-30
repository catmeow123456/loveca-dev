import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../../ability-definition-types.js';
import {
  SP_PB2_046_CONTINUOUS_PREVENT_STAGE_MEMBER_LIVE_START_ABILITY_ID,
  SP_PB2_046_LIVE_SUCCESS_STAGE_MEMBER_LIVE_START_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { getCardAbilityDefinitionsForCardCode } from '../../definitions/lookup.js';
import { registerLiveStartSuppressionGate } from '../../runtime/live-start-suppression-gates.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartConfirmablePendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

export function registerSpPb2046ButterflyWingWorkflowHandlers(): void {
  registerLiveStartSuppressionGate(
    SP_PB2_046_CONTINUOUS_PREVENT_STAGE_MEMBER_LIVE_START_ABILITY_ID,
    (context) => {
      if (context.sourceZone !== CardAbilitySourceZone.STAGE_MEMBER) {
        return false;
      }
      return context.liveCardIds.some((cardId) => {
        const card = getCardById(context.game, cardId);
        return (
          card?.ownerId === context.performingPlayerId &&
          cardCodeMatchesBase(card.data.cardCode, 'PL!SP-pb2-046')
        );
      });
    }
  );
  registerPendingAbilityStarterHandler(
    SP_PB2_046_LIVE_SUCCESS_STAGE_MEMBER_LIVE_START_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolveSpPb2046ButterflyWingLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolveSpPb2046ButterflyWingLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const checkedMembers = STAGE_SLOTS.map((slot) => {
    const memberCardId = player.memberSlots.slots[slot];
    const memberCard = memberCardId ? getCardById(game, memberCardId) : null;
    const liveStartAbilityIds =
      memberCard && memberCard.ownerId === player.id
        ? getStageMemberLiveStartAbilityDefinitions(memberCard.data.cardCode, slot).map(
            (definition) => definition.abilityId
          )
        : [];
    return {
      slot,
      memberCardId,
      liveStartAbilityIds,
      hasLiveStartAbility: liveStartAbilityIds.length > 0,
    };
  });
  const liveStartMemberCardIds = checkedMembers
    .filter((member) => member.hasLiveStartAbility && member.memberCardId !== null)
    .map((member) => member.memberCardId as string);
  const conditionMet = liveStartMemberCardIds.length > 0;
  const scoreBonus = conditionMet ? 1 : 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterModifier = conditionMet
    ? addLiveModifier(stateWithoutPending, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: scoreBonus,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus)
    : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'STAGE_MEMBER_LIVE_START_THIS_LIVE_SCORE',
      checkedMembers,
      liveStartMemberCardIds,
      conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function getStageMemberLiveStartAbilityDefinitions(
  cardCode: string,
  sourceSlot: SlotPosition
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode).filter(
    (definition) =>
      definition.category === CardAbilityCategory.LIVE_START &&
      definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
      definition.triggerCondition === TriggerCondition.ON_LIVE_START &&
      definition.queued &&
      definition.implemented &&
      doesSourceSlotSatisfyAbility(definition, sourceSlot)
  );
}

function doesSourceSlotSatisfyAbility(
  ability: CardAbilityDefinition,
  sourceSlot: SlotPosition
): boolean {
  return (
    ability.requiredSourceSlots === undefined ||
    ability.requiredSourceSlots.length === 0 ||
    ability.requiredSourceSlots.includes(sourceSlot)
  );
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
