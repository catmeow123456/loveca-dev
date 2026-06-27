import { createHeartIcon } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_PB1_006_SELECT_OTHER_MIRACRA_SLOT_STEP_ID =
  'HS_PB1_006_SELECT_OTHER_MIRACRA_SLOT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const miraCraMember = and(typeIs(CardType.MEMBER), unitAliasIs('Mira-Cra Park!'));

export function registerHsPb1006HimeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1006HimeLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID,
    HS_PB1_006_SELECT_OTHER_MIRACRA_SLOT_STEP_ID,
    (game, input, context) =>
      input.selectedSlot
        ? finishHsPb1006HimeLiveStart(
            game,
            input.selectedSlot,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startHsPb1006HimeLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? (ability.sourceSlot ?? getSourceMemberSlot(game, player.id, ability.sourceCardId))
    : null;
  if (!player || !sourceSlot) {
    return game;
  }

  const selectableSlots = getOtherMiraCraOccupiedSlots(game, player.id, ability.sourceCardId);
  if (selectableSlots.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OTHER_MIRACRA_SLOT',
        sourceSlot,
        selectableSlots,
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID
      ),
      stepId: HS_PB1_006_SELECT_OTHER_MIRACRA_SLOT_STEP_ID,
      stepText: '请选择要移动到的其他 Mira-Cra 成员所在区域。',
      awaitingPlayerId: player.id,
      selectableSlots,
      selectionLabel: '选择区域',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_OTHER_MIRACRA_SLOT',
      sourceSlot,
      selectableSlots,
    },
  });
}

function finishHsPb1006HimeLiveStart(
  game: GameState,
  selectedSlot: SlotPosition,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !==
      HS_PB1_006_LIVE_START_POSITION_CHANGE_TO_OTHER_MIRACRA_GAIN_HEART_BLADE_ABILITY_ID ||
    effect.stepId !== HS_PB1_006_SELECT_OTHER_MIRACRA_SLOT_STEP_ID ||
    !isSlotPosition(selectedSlot) ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const sourceSlot = getSlotPosition(effect.metadata?.sourceSlot);
  if (!sourceSlot || selectedSlot === sourceSlot) {
    return game;
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    effect.sourceCardId,
    selectedSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) => {
        const stateWithAction = addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'MOVE_TO_OTHER_MIRACRA_SLOT_GAIN_HEART_BLADE',
            fromSlot: result.fromSlot,
            toSlot: result.toSlot,
            swappedCardId: result.swappedCardId,
          }
        );
        const heartResult = addHeartLiveModifierForMember(stateWithAction, {
          playerId: player.id,
          memberCardId: effect.sourceCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          hearts: [createHeartIcon(HeartColor.PINK, 1)],
        });
        if (!heartResult) {
          return stateWithAction;
        }
        const bladeResult = addBladeLiveModifierForSourceMember(heartResult.gameState, {
          playerId: player.id,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          amount: 1,
        });
        return bladeResult?.gameState ?? heartResult.gameState;
      },
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function getOtherMiraCraOccupiedSlots(
  game: GameState,
  playerId: string,
  sourceCardId: string
): SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return MEMBER_SLOT_ORDER.filter((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId || cardId === sourceCardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && miraCraMember(card);
  });
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

function isSlotPosition(value: unknown): value is SlotPosition {
  return MEMBER_SLOT_ORDER.includes(value as SlotPosition);
}

function getSlotPosition(value: unknown): SlotPosition | null {
  return isSlotPosition(value) ? value : null;
}
