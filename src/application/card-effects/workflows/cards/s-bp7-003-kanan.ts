import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { addMemberWaitProtectionUntilLiveEnd } from '../../../../domain/rules/member-wait-protections.js';
import { SlotPosition, ZoneType } from '../../../../shared/types/enums.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';
import { getOtherStageMemberSlotsWithGroupMember } from '../../../effects/member-position-targets.js';
import {
  S_BP7_003_LIVE_START_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID,
  S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID,
  S_BP7_003_ON_ENTER_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID,
} from '../../ability-ids.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const LOOK_TOP_STEP = 'S_BP7_003_LOOK_TOP_ONE_OPTIONAL_BOTTOM';
const CHOOSE_BRANCH_STEP = 'S_BP7_003_CHOOSE_EFFECT';
const CHOOSE_MOVE_SLOT_STEP = 'S_BP7_003_CHOOSE_POSITION_CHANGE_SLOT';
const PLACE_BOTTOM_OPTION = 'place-bottom';
const KEEP_TOP_OPTION = 'keep-top';
const PROTECT_OPTION = 'protect-aqours';
const MOVE_OPTION = 'position-change';
const TARGET_GROUPS = ['Aqours', 'SaintSnow'] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp7003KananWorkflowHandlers(deps: {
  readonly enqueueMemberSlotMovedCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  for (const abilityId of [
    S_BP7_003_ON_ENTER_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID,
    S_BP7_003_LIVE_START_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID,
  ]) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startLookTopOne(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, LOOK_TOP_STEP, (game, input, context) =>
      finishLookTopOne(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
    );
  }

  registerPendingAbilityStarterHandler(
    S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID,
    (game, ability, options) => startChooseEffect(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID,
    CHOOSE_BRANCH_STEP,
    (game, input, context) =>
      finishChooseEffect(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID,
    CHOOSE_MOVE_SLOT_STEP,
    (game, input, context) =>
      finishPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueMemberSlotMovedCardEffects
      )
  );
}

function startLookTopOne(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const stateWithoutPending = removePending(game, ability.id);
  const inspection = inspectTopCards(stateWithoutPending, player.id, {
    count: 1,
    viewerPlayerId: player.id,
  });
  const inspectedCardId = inspection?.inspectedCardIds[0] ?? null;
  if (!inspection || !inspectedCardId) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot,
        step: 'NO_TOP_CARD_TO_INSPECT',
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: LOOK_TOP_STEP,
        stepText: '查看卡组顶1张卡。可以将其放置于卡组底。',
        awaitingPlayerId: player.id,
        inspectionCardIds: [inspectedCardId],
        effectChoice: {
          mode: 'SINGLE',
          options: [
            { id: KEEP_TOP_OPTION, text: '将检视的卡保留在卡组顶。' },
            { id: PLACE_BOTTOM_OPTION, text: '将检视的卡放置于卡组底。' },
          ],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        confirmSelectionLabel: '确定',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          orderedResolution,
          sourceSlot: ability.sourceSlot,
          timingId: ability.timingId,
          eventIds: ability.eventIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_INSPECT_TOP_ONE_OPTIONAL_BOTTOM',
      inspectedCardIds: [inspectedCardId],
    }
  );
}

function finishLookTopOne(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== LOOK_TOP_STEP || !isLookTopAbility(effect.abilityId))
    return game;
  if (selectedOptionId !== KEEP_TOP_OPTION && selectedOptionId !== PLACE_BOTTOM_OPTION) return game;

  const cardId = effect.inspectionCardIds?.length === 1 ? effect.inspectionCardIds[0] : null;
  const player = getPlayerById(game, effect.controllerId);
  const card = cardId ? getCardById(game, cardId) : null;
  if (
    !player ||
    !cardId ||
    !card ||
    card.ownerId !== player.id ||
    game.inspectionContext?.ownerPlayerId !== player.id ||
    game.inspectionContext.sourceZone !== ZoneType.MAIN_DECK ||
    game.inspectionZone.cardIds.length !== 1 ||
    game.inspectionZone.cardIds[0] !== cardId ||
    player.mainDeck.cardIds.includes(cardId)
  ) {
    return game;
  }

  const placeBottom = selectedOptionId === PLACE_BOTTOM_OPTION;
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: placeBottom
        ? [...currentPlayer.mainDeck.cardIds, cardId]
        : [cardId, ...currentPlayer.mainDeck.cardIds],
    },
  }));
  state = clearInspectionCards(state, [cardId]);
  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: placeBottom ? 'PLACE_INSPECTED_CARD_AT_DECK_BOTTOM' : 'KEEP_INSPECTED_CARD_AT_DECK_TOP',
      inspectedCardId: cardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startChooseEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  const canMove =
    sourceSlot !== null &&
    getOtherStageMemberSlotsWithGroupMember(game, player.id, sourceSlot, TARGET_GROUPS).length > 0;
  const options = [
    {
      id: PROTECT_OPTION,
      label: '直到LIVE结束时，保护原本[BLADE]不超过3的『Aqours』成员',
    },
    ...(canMove
      ? [
          {
            id: MOVE_OPTION,
            label: '将此成员站位变换到有『Aqours』或『Saint Snow』成员的区域',
          },
        ]
      : []),
  ];

  return addAction(
    {
      ...removePending(game, ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: CHOOSE_BRANCH_STEP,
        stepText: '请从以下效果中选择1项。',
        awaitingPlayerId: player.id,
      selectableOptions: options,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          {
            id: PROTECT_OPTION,
            text: 'LIVE结束时为止，存在于自己的舞台的原本持有的[BLADE]数量小于等于3的『Aqours』成员，不会因对方的效果变为待机状态。',
          },
          {
            id: MOVE_OPTION,
            text: '将此成员站位变换至存在『Aqours』或『Saint Snow』成员的区域。',
            selectable: canMove,
          },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
        selectionLabel: '选择要结算的效果',
        confirmSelectionLabel: '结算所选效果',
        canSkipSelection: false,
        metadata: { orderedResolution, sourceSlot: ability.sourceSlot },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_EFFECT',
      selectableOptionIds: options.map((option) => option.id),
    }
  );
}

function finishChooseEffect(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID ||
    effect.stepId !== CHOOSE_BRANCH_STEP ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  if (selectedOptionId === PROTECT_OPTION) {
    const state = addMemberWaitProtectionUntilLiveEnd(game, {
      affectedPlayerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
    return finishActiveEffect(
      state,
      effect,
      continuePendingCardEffects,
      'ESTABLISH_WAIT_PROTECTION'
    );
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? findMemberSlot(player, effect.sourceCardId) : null;
  const targetSlots =
    player && sourceSlot !== null
      ? getOtherStageMemberSlotsWithGroupMember(game, player.id, sourceSlot, TARGET_GROUPS)
      : [];
  if (targetSlots.length === 0) {
    return finishActiveEffect(
      game,
      effect,
      continuePendingCardEffects,
      'POSITION_CHANGE_NO_LONGER_LEGAL'
    );
  }
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: CHOOSE_MOVE_SLOT_STEP,
        stepText: '请选择此成员站位变换后的区域。',
        effectChoice: undefined,
        selectableOptions: undefined,
        selectableSlots: targetSlots,
        selectionLabel: '选择移动后的区域',
        confirmSelectionLabel: '站位变换',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_POSITION_CHANGE_TARGET',
      selectableSlots: targetSlots,
    }
  );
}

function finishPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueMemberSlotMovedCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_003_ON_ENTER_CHOOSE_WAIT_PROTECTION_OR_POSITION_CHANGE_ABILITY_ID ||
    effect.stepId !== CHOOSE_MOVE_SLOT_STEP ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? findMemberSlot(player, effect.sourceCardId) : null;
  const legalTargets =
    player && sourceSlot !== null
      ? getOtherStageMemberSlotsWithGroupMember(game, player.id, sourceSlot, TARGET_GROUPS)
      : [];
  if (!player || sourceSlot === null || !legalTargets.includes(selectedSlot)) {
    return finishActiveEffect(
      game,
      effect,
      continuePendingCardEffects,
      'POSITION_CHANGE_TARGET_STALE'
    );
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    effect.sourceCardId,
    selectedSlot,
    enqueueMemberSlotMovedCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        selectionPlayerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'POSITION_CHANGE',
          fromSlot: result.fromSlot,
          toSlot: result.toSlot,
          swappedCardId: result.swappedCardId,
        }),
    }
  );
  if (!moveResult) {
    return finishActiveEffect(game, effect, continuePendingCardEffects, 'POSITION_CHANGE_NOOP');
  }
  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishActiveEffect(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}

function isLookTopAbility(abilityId: string): boolean {
  return (
    abilityId === S_BP7_003_ON_ENTER_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID ||
    abilityId === S_BP7_003_LIVE_START_LOOK_TOP_ONE_OPTIONAL_BOTTOM_ABILITY_ID
  );
}
