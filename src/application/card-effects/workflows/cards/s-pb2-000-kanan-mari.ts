import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberEntryAtTriggerThisTurn } from '../../../effects/relay-entry-provenance.js';
import { S_PB2_000_LIVE_START_DOUBLE_AQOURS_RELAY_STACK_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  createWaitingRoomLiveToDeckTopEffect,
  finishWaitingRoomLiveToDeckTopSelection,
  selectWaitingRoomLiveToDeckTopCandidates,
  type WaitingRoomLiveToDeckTopConfig,
} from '../shared/waiting-room-live-to-deck-top.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
const config: WaitingRoomLiveToDeckTopConfig = {
  abilityId: S_PB2_000_LIVE_START_DOUBLE_AQOURS_RELAY_STACK_LIVE_ABILITY_ID,
  groupAlias: 'Aqours',
  maxCount: 2,
  stepId: 'S_PB2_000_SELECT_AQOURS_LIVE_TO_DECK_TOP',
  stepText: '请从自己休息室中选择至多2张『Aqours』LIVE卡，按选择顺序放置于卡组顶。',
  skipStep: 'SKIP_STACK_AQOURS_LIVE',
  moveStep: 'STACK_AQOURS_LIVE_TO_DECK_TOP',
};
const aqoursMember = and(typeIs(CardType.MEMBER), groupAliasIs('Aqours'));

export function registerSPb2000KananMariWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
    startLiveSelection(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
    finishWaitingRoomLiveToDeckTopSelection(
      game,
      input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
      config,
      context.continuePendingCardEffects
    )
  );
}

function startLiveSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const entry = getStageMemberEntryAtTriggerThisTurn(
    game,
    ability.sourceCardId,
    player.id,
    ability.eventIds
  );
  const replacements = entry?.relayReplacements ?? [];
  const conditionMet =
    replacements.length === 2 &&
    new Set(replacements.map(({ cardId }) => cardId)).size === 2 &&
    new Set(replacements.map(({ slot }) => slot)).size === 2 &&
    replacements.every(({ cardId }) => {
      const card = getCardById(game, cardId);
      return card?.ownerId === player.id && aqoursMember(card);
    });
  const candidates = selectWaitingRoomLiveToDeckTopCandidates(game, player.id, config.groupAlias);
  if (!conditionMet || candidates.length === 0) {
    const resultText = conditionMet
      ? '本回合与2名『Aqours』成员换手登场，但休息室没有可选择的『Aqours』LIVE卡，实际不放置卡片'
      : '本回合未与2名『Aqours』成员换手登场，条件未满足，实际不放置卡片';
    const confirmation =
      options.orderedResolution === true
        ? null
        : maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
            effectText: `${getAbilityEffectText(ability.abilityId)}（${resultText}。）`,
            stepText: conditionMet
              ? '没有可选择的『Aqours』LIVE卡，确认后不放置卡片。'
              : '本回合双人『Aqours』换手条件未满足，确认后不放置卡片。',
          });
    if (confirmation) return confirmation;
    return continuePendingCardEffects(
      addAction(
        { ...game, pendingAbilities: game.pendingAbilities.filter(({ id }) => id !== ability.id) },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: conditionMet ? 'NO_AQOURS_LIVE_TARGET' : 'DOUBLE_AQOURS_RELAY_CONDITION_NOT_MET',
          conditionMet,
          relayEntryEventId: entry?.eventId,
          relayReplacements: replacements,
        }
      ),
      options.orderedResolution === true
    );
  }
  const baseEffect: ActiveEffectState = {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: player.id,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: config.stepId,
    stepText: config.stepText,
    awaitingPlayerId: player.id,
    metadata: {
      orderedResolution: options.orderedResolution === true,
    },
  };
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createWaitingRoomLiveToDeckTopEffect(baseEffect, candidates, config),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_AQOURS_LIVE_TO_DECK_TOP',
      conditionMet,
      relayEntryEventId: entry!.eventId,
      relayReplacements: replacements,
      candidateCardIds: candidates,
    },
  });
}
