import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { clearInspectionCards, inspectBottomCards } from '../../../effects/look-top.js';
import { S_BP7_010_ON_ENTER_LOOK_BOTTOM_ONE_OPTIONAL_DECK_FOURTH_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  moveInspectedCardsToDeckTopAndBottom,
  moveInspectedCardToDeckPositionFromTop,
} from '../../runtime/inspection-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const CHOOSE_DECK_DESTINATION_STEP_ID = 'S_BP7_010_CHOOSE_BOTTOM_CARD_DESTINATION';
const PLACE_FOURTH_FROM_TOP_OPTION_ID = 'place-fourth-from-top';
const KEEP_AT_BOTTOM_OPTION_ID = 'keep-at-bottom';
const DECK_POSITION_FROM_TOP = 4;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp7010ChikaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP7_010_ON_ENTER_LOOK_BOTTOM_ONE_OPTIONAL_DECK_FOURTH_ABILITY_ID,
    (game, ability, options, context) =>
      startChikaBottomInspection(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_010_ON_ENTER_LOOK_BOTTOM_ONE_OPTIONAL_DECK_FOURTH_ABILITY_ID,
    CHOOSE_DECK_DESTINATION_STEP_ID,
    (game, input, context) =>
      finishChikaBottomInspection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startChikaBottomInspection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const stateWithoutPending = removePendingAbility(game, ability.id);
  const inspection = inspectBottomCards(stateWithoutPending, player.id, {
    count: 1,
    viewerPlayerId: player.id,
  });
  const inspectedCardId = inspection?.inspectedCardIds[0] ?? null;
  if (!inspection || !inspectedCardId) {
    const cleanState = inspection
      ? clearInspectionCards(inspection.gameState, inspection.inspectedCardIds)
      : stateWithoutPending;
    return continuePendingCardEffects(
      addAction(cleanState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot,
        step: 'NO_BOTTOM_CARD_TO_INSPECT',
      }),
      orderedResolution
    );
  }

  return startPendingActiveEffect(inspection.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_DECK_DESTINATION_STEP_ID,
      stepText: '检视了自己卡组底的1张卡。可以将其放置于卡组顶第4张处。',
      awaitingPlayerId: player.id,
      inspectionCardIds: [inspectedCardId],
      selectableOptions: [
        { id: PLACE_FOURTH_FROM_TOP_OPTION_ID, label: '放置于卡组顶第4张' },
        { id: KEEP_AT_BOTTOM_OPTION_ID, label: '不放置' },
      ],
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: PLACE_FOURTH_FROM_TOP_OPTION_ID,
            text: '将检视的卡放置于卡组顶第4张。',
          },
          {
            id: KEEP_AT_BOTTOM_OPTION_ID,
            text: '不放置，将检视的卡保留在卡组底。',
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        sourceZone: ZoneType.MAIN_DECK,
        positionFromTop: DECK_POSITION_FROM_TOP,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_LOOK_BOTTOM_ONE_OPTIONAL_DECK_FOURTH',
      inspectedCardCount: 1,
    },
  });
}

function finishChikaBottomInspection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getExpectedEffect(game);
  if (
    !effect ||
    !selectedOptionId ||
    ![PLACE_FOURTH_FROM_TOP_OPTION_ID, KEEP_AT_BOTTOM_OPTION_ID].includes(selectedOptionId) ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const inspectedCardId =
    effect.inspectionCardIds?.length === 1 ? effect.inspectionCardIds[0] : null;
  const inspectedCard = inspectedCardId ? getCardById(game, inspectedCardId) : null;
  if (
    !player ||
    !inspectedCardId ||
    !inspectedCard ||
    inspectedCard.ownerId !== player.id ||
    game.inspectionContext?.ownerPlayerId !== player.id ||
    game.inspectionContext.sourceZone !== ZoneType.MAIN_DECK ||
    game.inspectionZone.cardIds.length !== 1 ||
    game.inspectionZone.cardIds[0] !== inspectedCardId ||
    player.mainDeck.cardIds.includes(inspectedCardId)
  ) {
    return game;
  }

  if (selectedOptionId === KEEP_AT_BOTTOM_OPTION_ID) {
    const restoreResult = moveInspectedCardsToDeckTopAndBottom(
      game,
      player.id,
      [inspectedCardId],
      [],
      [inspectedCardId]
    );
    if (!restoreResult) return game;
    return finishAndContinue(
      restoreResult.gameState,
      effect,
      player.id,
      continuePendingCardEffects,
      'KEEP_INSPECTED_CARD_AT_DECK_BOTTOM',
      {
        movedCardId: inspectedCardId,
        positionFromTop: null,
        insertIndex: Math.max(
          0,
          (getPlayerById(restoreResult.gameState, player.id)?.mainDeck.cardIds.length ?? 1) - 1
        ),
      }
    );
  }

  const moveResult = moveInspectedCardToDeckPositionFromTop(
    game,
    player.id,
    inspectedCardId,
    DECK_POSITION_FROM_TOP
  );
  if (!moveResult) return game;
  return finishAndContinue(
    moveResult.gameState,
    effect,
    player.id,
    continuePendingCardEffects,
    'PLACE_INSPECTED_CARD_AT_DECK_FOURTH',
    {
      movedCardId: moveResult.movedCardId,
      positionFromTop: moveResult.positionFromTop,
      insertIndex: moveResult.insertIndex,
    }
  );
}

function getExpectedEffect(game: GameState): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === S_BP7_010_ON_ENTER_LOOK_BOTTOM_ONE_OPTIONAL_DECK_FOURTH_ABILITY_ID &&
    effect.stepId === CHOOSE_DECK_DESTINATION_STEP_ID
    ? effect
    : null;
}

function finishAndContinue(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
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
