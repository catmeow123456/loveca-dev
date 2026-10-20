import {
  addAction,
  getActivePlayer,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { HS_BP8_003_ON_ENTER_BOTH_DISCARD_TO_SIX_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardHandsToWaitingRoomAsBatchAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'HS_BP8_003_BOTH_PRIVATE_DISCARD_TO_SIX';
type Continue = (game: GameState, ordered: boolean) => GameState;
type Selections = Readonly<Record<string, readonly string[]>>;

export function registerHsBp8003RurinoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, runtime) => {
    const playerIds = [
      getActivePlayer(game).id,
      ...game.players
        .filter((player) => player.id !== getActivePlayer(game).id)
        .map((player) => player.id),
    ];
    const next = createNextPrompt(game, ability, playerIds, {}, options.orderedResolution === true);
    if (!next)
      return finish(
        game,
        ability,
        options.orderedResolution === true,
        runtime.continuePendingCardEffects
      );
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: next,
      actionPayload: {
        sourceCardId: ability.sourceCardId,
        step: 'START_BOTH_PRIVATE_DISCARD_TO_SIX',
      },
    });
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    STEP_ID,
    (game, input, runtime) => {
      const effect = game.activeEffect;
      if (!effect || effect.stepId !== STEP_ID || !effect.awaitingPlayerId) return game;
      const ids = input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
      const player = getPlayerById(game, effect.awaitingPlayerId);
      if (
        !player ||
        ids.length !== Math.max(0, player.hand.cardIds.length - 6) ||
        new Set(ids).size !== ids.length ||
        ids.some(
          (id) => !player.hand.cardIds.includes(id) || !effect.selectableCardIds?.includes(id)
        )
      )
        return game;
      const playerIds = (effect.metadata?.playerIds as readonly string[]) ?? [];
      const selections: Selections = {
        ...((effect.metadata?.discardSelections as Selections) ?? {}),
        [player.id]: [...ids],
      };
      // Both players commit their hidden choices before either hand is revealed or moved (1.3.4.2).
      // A previously submitted choice can become stale only through an external state change; restart it privately.
      const validSelections = Object.fromEntries(
        Object.entries(selections).filter(([id, chosen]) => {
          const current = getPlayerById(game, id);
          return (
            current &&
            chosen.length === Math.max(0, current.hand.cardIds.length - 6) &&
            chosen.every((cardId) => current.hand.cardIds.includes(cardId))
          );
        })
      );
      const next = createNextPrompt(
        game,
        effect,
        playerIds,
        validSelections,
        effect.metadata?.orderedResolution === true
      );
      if (next) return { ...game, activeEffect: next };
      const result = discardHandsToWaitingRoomAsBatchAndEnqueueTriggers(
        { ...game, activeEffect: null },
        playerIds.map((playerId) => ({
          playerId,
          selectedCardIds: validSelections[playerId] ?? [],
        })),
        deps.enqueueTriggeredCardEffects
      );
      if (!result) return game;
      const state = result.gameState;
      return finish(
        state,
        effect,
        effect.metadata?.orderedResolution === true,
        runtime.continuePendingCardEffects
      );
    },
    queryCardSelection
  );
}

function createNextPrompt(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'controllerId' | 'sourceCardId'>,
  playerIds: readonly string[],
  selections: Selections,
  orderedResolution: boolean
): ActiveEffectState | null {
  const player = playerIds
    .map((id) => getPlayerById(game, id))
    .find(
      (candidate) =>
        candidate && candidate.hand.cardIds.length > 6 && selections[candidate.id] === undefined
    );
  if (!player) return null;
  const count = player.hand.cardIds.length - 6;
  return {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ABILITY_ID),
    stepId: STEP_ID,
    stepText: `请选择${count}张自己的手牌。双方完成选择后，将所选卡片放置入休息室，使各自手牌变为6张。`,
    awaitingPlayerId: player.id,
    selectableCardIds: [...player.hand.cardIds],
    selectableCardMode: 'ORDERED_MULTI',
    minSelectableCards: count,
    maxSelectableCards: count,
    selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    canSkipSelection: false,
    selectionLabel: '选择要放置入休息室的手牌',
    confirmSelectionLabel: '选定弃置的手牌',
    metadata: { orderedResolution, playerIds: [...playerIds], discardSelections: selections },
  };
}

function finish(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'controllerId' | 'sourceCardId'>,
  ordered: boolean,
  continuation: Continue
): GameState {
  return continuation(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'BOTH_DISCARD_TO_SIX',
      }
    ),
    ordered
  );
}
