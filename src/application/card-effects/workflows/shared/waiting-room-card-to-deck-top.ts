import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { CardInstance } from '../../../../domain/entities/card.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  N_BP7_011_LIVE_SUCCESS_NIJIGASAKI_WAITING_CARD_TO_DECK_TOP_ABILITY_ID,
  PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
} from '../../ability-ids.js';
import { moveWaitingRoomCardsToDeckTopAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_ROOM_CARD_TO_DECK_TOP_STEP_ID =
  'SELECT_WAITING_ROOM_CARD_TO_DECK_TOP';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface WaitingRoomCardToDeckTopConfig {
  readonly abilityId: string;
  readonly selector: (card: CardInstance) => boolean;
  readonly stepText: string;
}

const isNijigasakiCard = groupAliasIs('虹ヶ咲');
const CONFIGS: readonly WaitingRoomCardToDeckTopConfig[] = [
  {
    abilityId: PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
    selector: () => true,
    stepText: '可以选择自己休息室至多1张卡放置于卡组顶。',
  },
  {
    abilityId: N_BP7_011_LIVE_SUCCESS_NIJIGASAKI_WAITING_CARD_TO_DECK_TOP_ABILITY_ID,
    selector: isNijigasakiCard,
    stepText: '可以选择自己休息室1张『虹咲』卡放置于卡组顶。',
  },
] as const;

export function registerWaitingRoomCardToDeckTopWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startWaitingRoomCardToDeckTop(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_WAITING_ROOM_CARD_TO_DECK_TOP_STEP_ID,
      (game, input, context) =>
        finishWaitingRoomCardToDeckTopSelection(
          game,
          input.selectedCardId ?? null,
          context.continuePendingCardEffects
        )
    );
  }
}

function startWaitingRoomCardToDeckTop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const config = getConfig(ability.abilityId);
  if (!player || !config) return game;

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const selectableCardIds = player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && config.selector(card);
  });
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_WAITING_ROOM_CARD',
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_WAITING_ROOM_CARD_TO_DECK_TOP_STEP_ID,
        stepText: config.stepText,
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要放置于卡组顶的卡',
        confirmSelectionLabel: '放置于卡组顶',
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          publicCardSelectionConfirmation: { destination: 'MAIN_DECK_TOP' },
          orderedResolution,
          sourceZone: ZoneType.WAITING_ROOM,
          destination: ZoneType.MAIN_DECK,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_WAITING_ROOM_CARD_TO_DECK_TOP',
      selectableCardIds,
    }
  );
}

function finishWaitingRoomCardToDeckTopSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    !getConfig(effect.abilityId) ||
    effect.stepId !== SELECT_WAITING_ROOM_CARD_TO_DECK_TOP_STEP_ID
  ) return game;

  const player = getPlayerById(game, effect.controllerId);
  const config = getConfig(effect.abilityId);
  if (!player || !config) return game;

  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_WAITING_ROOM_CARD_TO_DECK_TOP',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const selectedCard = getCardById(game, selectedCardId);
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !selectedCard ||
    selectedCard.ownerId !== player.id ||
    !player.waitingRoom.cardIds.includes(selectedCardId) ||
    !config.selector(selectedCard)
  ) return game;

  const moveResult = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds,
    minCount: 1,
    maxCount: 1,
    cause: {
      kind: 'CARD_EFFECT',
      playerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
  });
  if (!moveResult) return game;

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'WAITING_ROOM_CARD_TO_DECK_TOP',
      selectedCardId,
      movedCardIds: moveResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getConfig(abilityId: string): WaitingRoomCardToDeckTopConfig | undefined {
  return CONFIGS.find((config) => config.abilityId === abilityId);
}
