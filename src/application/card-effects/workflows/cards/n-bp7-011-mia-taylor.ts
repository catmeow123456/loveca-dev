import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { N_BP7_011_AUTO_DECK_TO_WAITING_DISCARD_ONE_RECOVER_SELF_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = N_BP7_011_AUTO_DECK_TO_WAITING_DISCARD_ONE_RECOVER_SELF_ABILITY_ID;
const BASE_CARD_CODE = 'PL!N-bp7-011';
const DISCARD_TO_RECOVER_SELF_STEP_ID = 'N_BP7_011_DISCARD_TO_RECOVER_SELF';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = Parameters<
  typeof discardOneHandCardToWaitingRoomAndEnqueueTriggers
>[4];

export function registerNBp7011MiaTaylorWorkflowHandlers(options: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, starterOptions, context) =>
    startDeckToWaitingRecovery(
      game,
      ability,
      starterOptions.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    DISCARD_TO_RECOVER_SELF_STEP_ID,
    (game, input, context) =>
      finishDeckToWaitingRecovery(
        game,
        input.selectedCardId ?? null,
        options.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startDeckToWaitingRecovery(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const movedCardIds = readStringArray(ability.metadata?.movedCardIds);
  if (
    !player ||
    !isRecoverableSource(game, player.id, ability.sourceCardId) ||
    !movedCardIds.includes(ability.sourceCardId) ||
    player.hand.cardIds.length === 0
  ) {
    return finishWithoutRecovery(
      removePendingAbility(game, ability.id),
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_LEGAL_DISCARD_OR_SOURCE'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      ...createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability,
        playerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: DISCARD_TO_RECOVER_SELF_STEP_ID,
        selectableCardIds: player.hand.cardIds,
        orderedResolution,
        metadata: {
          movedCardIds,
        },
      }),
      stepText: '可以将1张手牌放置入休息室。如此做时，将此卡从休息室加入手牌。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_DISCARD_TO_RECOVER_SELF',
      selectableCardIds: player.hand.cardIds,
      movedCardIds,
    },
  });
}

function finishDeckToWaitingRecovery(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== DISCARD_TO_RECOVER_SELF_STEP_ID
  ) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_DISCARD_TO_RECOVER_SELF',
      }),
      orderedResolution
    );
  }

  const player = getPlayerById(game, effect.controllerId);
  const movedCardIds = readStringArray(effect.metadata?.movedCardIds);
  if (
    !player ||
    !isRecoverableSource(game, player.id, effect.sourceCardId) ||
    !movedCardIds.includes(effect.sourceCardId) ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    discardResult.gameState,
    player.id,
    [effect.sourceCardId],
    {
      candidateCardIds: [effect.sourceCardId],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_ONE_AND_RECOVER_SELF',
      discardedCardId: selectedCardId,
      recoveredCardIds: recoveryResult.movedCardIds,
    }),
    orderedResolution
  );
}

function isRecoverableSource(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    player.waitingRoom.cardIds.includes(sourceCardId)
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

function finishWithoutRecovery(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  return continuePendingCardEffects(
    addAction(game, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'NO_OP',
      reason,
    }),
    orderedResolution
  );
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
