import {
  isMemberCardData,
  type CardInstance,
  type HeartIcon,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { SlotPosition, type HeartColor } from '../../../../shared/types/enums.js';
import { cardNameAliasIs } from '../../../effects/card-selectors.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import { N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveInspectedCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const REVEAL_COUNT = 4;
const SELECT_REVEALED_KASUMI_STEP_ID = 'N_BP5_029_SELECT_REVEALED_KASUMI_CARD';
const SELECT_STAGE_KASUMI_STEP_ID = 'N_BP5_029_SELECT_STAGE_KASUMI_TARGET';
const KASUMI_SELECTOR = cardNameAliasIs('中須かすみ');

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface RegisterNBp5029MutekikyuBelieverWorkflowHandlersDeps {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}

interface MutekikyuNoOpOptions {
  readonly playerId: string;
  readonly ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId'>;
  readonly orderedResolution: boolean;
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
  readonly step: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export function registerNBp5029MutekikyuBelieverWorkflowHandlers(
  deps: RegisterNBp5029MutekikyuBelieverWorkflowHandlersDeps
): void {
  registerPendingAbilityStarterHandler(
    N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID,
    (game, ability, options, context) =>
      startMutekikyuBeliever(
        game,
        ability,
        options,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerActiveEffectStepHandler(
    N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID,
    SELECT_REVEALED_KASUMI_STEP_ID,
    (game, input, context) =>
      finishRevealedKasumiSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerActiveEffectStepHandler(
    N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID,
    SELECT_STAGE_KASUMI_STEP_ID,
    (game, input, context) =>
      finishStageKasumiSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startMutekikyuBeliever(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceInLiveZone = isOwnLiveCardInLiveZone(game, player.id, ability.sourceCardId);
  const stageKasumiCardIds = getStageKasumiMemberCardIds(game, player.id);
  if (!sourceInLiveZone || stageKasumiCardIds.length === 0) {
    return resolveNoOp(game, {
      playerId: player.id,
      ability,
      orderedResolution: options.orderedResolution === true,
      continuePendingCardEffects,
      step: sourceInLiveZone ? 'NO_STAGE_KASUMI' : 'SOURCE_NOT_IN_LIVE_ZONE',
      payload: {
        sourceInLiveZone,
        stageKasumiCount: stageKasumiCardIds.length,
      },
    });
  }

  const inspection = inspectTopCards(game, player.id, {
    count: REVEAL_COUNT,
    reveal: true,
    selectablePredicate: isKasumiCard,
  });
  if (!inspection || inspection.inspectedCardIds.length === 0) {
    return resolveNoOp(game, {
      playerId: player.id,
      ability,
      orderedResolution: options.orderedResolution === true,
      continuePendingCardEffects,
      step: 'NO_DECK_CARDS_TO_REVEAL',
      payload: {
        sourceInLiveZone,
        stageKasumiCount: stageKasumiCardIds.length,
      },
    });
  }

  if (inspection.selectableCardIds.length === 0) {
    const activeEffect: ActiveEffectState = {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_REVEALED_KASUMI_STEP_ID,
      stepText: '公开卡中没有「中須かすみ」卡。公开的卡全部放置入休息室。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspection.inspectedCardIds,
      revealedCardIds: inspection.inspectedCardIds,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '公开的卡',
      skipSelectionLabel: '确定',
      canSkipSelection: true,
      metadata: {
        orderedResolution: options.orderedResolution === true,
        revealedCount: inspection.inspectedCardIds.length,
        stageKasumiCount: stageKasumiCardIds.length,
        noRevealedKasumiCard: true,
      },
    };

    return startPendingActiveEffect(inspection.gameState, {
      ability,
      activeEffect,
      playerId: player.id,
      actionPayload: {
        sourceCardId: ability.sourceCardId,
        step: 'START_REVEAL_NO_KASUMI_CARD',
        inspectedCardIds: inspection.inspectedCardIds,
        selectableCardIds: [],
      },
    });
  }

  const effectText = getAbilityEffectText(ability.abilityId);
  const activeEffect: ActiveEffectState = {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    effectText,
    stepId: SELECT_REVEALED_KASUMI_STEP_ID,
    stepText: '请选择公开卡中的1张「中須かすみ」卡。公开的卡会全部放置入休息室。',
    awaitingPlayerId: player.id,
    inspectionCardIds: inspection.inspectedCardIds,
    revealedCardIds: inspection.inspectedCardIds,
    selectableCardIds: inspection.selectableCardIds,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: 'SINGLE',
    selectionLabel: '选择公开的「中須かすみ」卡',
    confirmSelectionLabel: '确定',
    canSkipSelection: false,
    metadata: {
      orderedResolution: options.orderedResolution === true,
      revealedCount: inspection.inspectedCardIds.length,
      stageKasumiCount: stageKasumiCardIds.length,
    },
  };

  return startPendingActiveEffect(inspection.gameState, {
    ability,
    activeEffect,
    playerId: player.id,
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_REVEALED_KASUMI_CARD',
      inspectedCardIds: inspection.inspectedCardIds,
      selectableCardIds: inspection.selectableCardIds,
    },
  });
}

function finishRevealedKasumiSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getActiveMutekikyuEffect(game, SELECT_REVEALED_KASUMI_STEP_ID);
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = getActiveInspectionCardIds(game, effect);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  const stageKasumiCardIds = getStageKasumiMemberCardIds(game, player.id);
  const sourceInLiveZone = isOwnLiveCardInLiveZone(game, player.id, effect.sourceCardId);
  if (effect.selectableCardIds?.length === 0) {
    return moveInspectionAndFinishWithoutHeart(game, {
      playerId: player.id,
      effect,
      inspectedCardIds,
      step: 'NO_REVEALED_KASUMI_CARD',
      orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
      payload: {
        sourceInLiveZone,
        stageKasumiCount: stageKasumiCardIds.length,
        selectedRevealedKasumiCardId: null,
      },
    });
  }
  if (
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !game.inspectionZone.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  if (
    !sourceInLiveZone ||
    stageKasumiCardIds.length === 0 ||
    !isKasumiCardId(game, selectedCardId)
  ) {
    return moveInspectionAndFinishWithoutHeart(game, {
      playerId: player.id,
      effect,
      inspectedCardIds,
      step: !sourceInLiveZone
        ? 'SOURCE_NOT_IN_LIVE_ZONE_AFTER_REVEAL'
        : stageKasumiCardIds.length === 0
          ? 'NO_STAGE_KASUMI_AFTER_REVEAL'
          : 'INVALID_REVEALED_KASUMI_SELECTION',
      orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
      payload: {
        selectedRevealedKasumiCardId: selectedCardId,
        sourceInLiveZone,
        stageKasumiCount: stageKasumiCardIds.length,
      },
    });
  }

  const heartColors = getUniquePrintedHeartColors(game, selectedCardId);
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_STAGE_KASUMI_STEP_ID,
        stepText: '请选择自己舞台上的1名「中須かすみ」。其获得所选卡持有颜色的Heart。',
        selectableCardIds: stageKasumiCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得Heart的「中須かすみ」',
        confirmSelectionLabel: '赋予Heart',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedRevealedKasumiCardId: selectedCardId,
          selectedHeartColors: heartColors,
          stageKasumiCount: stageKasumiCardIds.length,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_REVEALED_KASUMI_CARD',
      selectedRevealedKasumiCardId: selectedCardId,
      selectedHeartColors: heartColors,
      stageKasumiCardIds,
    }
  );
}

function finishStageKasumiSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getActiveMutekikyuEffect(game, SELECT_STAGE_KASUMI_STEP_ID);
  if (!effect || selectedCardId === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = getActiveInspectionCardIds(game, effect);
  const selectedRevealedKasumiCardId =
    typeof effect.metadata?.selectedRevealedKasumiCardId === 'string'
      ? effect.metadata.selectedRevealedKasumiCardId
      : null;
  const orderedResolution = effect.metadata?.orderedResolution === true;
  const sourceInLiveZone = isOwnLiveCardInLiveZone(game, player.id, effect.sourceCardId);
  const targetStillOnStage =
    effect.selectableCardIds?.includes(selectedCardId) === true &&
    getStageKasumiMemberCardIds(game, player.id).includes(selectedCardId);
  if (!sourceInLiveZone || !targetStillOnStage || selectedRevealedKasumiCardId === null) {
    return moveInspectionAndFinishWithoutHeart(game, {
      playerId: player.id,
      effect,
      inspectedCardIds,
      step: !sourceInLiveZone
        ? 'SOURCE_NOT_IN_LIVE_ZONE_AFTER_SELECTION'
        : 'NO_STAGE_KASUMI_TARGET_AFTER_SELECTION',
      orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
      payload: {
        selectedRevealedKasumiCardId,
        selectedStageKasumiCardId: selectedCardId,
        sourceInLiveZone,
        targetStillOnStage,
      },
    });
  }

  const selectedHeartColors = getUniquePrintedHeartColors(game, selectedRevealedKasumiCardId);
  const moveResult = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    inspectedCardIds,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  let state: GameState = {
    ...moveResult.gameState,
    activeEffect: null,
  };
  if (selectedHeartColors.length > 0) {
    const modifierResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: selectedHeartColors.map((color) => ({ color, count: 1 })),
    });
    if (modifierResult) {
      state = modifierResult.gameState;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'GRANT_KASUMI_HEARTS_FROM_REVEALED_CARD',
      selectedRevealedKasumiCardId,
      selectedStageKasumiCardId: selectedCardId,
      selectedHeartColors,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    orderedResolution
  );
}

function resolveNoOp(game: GameState, options: MutekikyuNoOpOptions): GameState {
  return options.continuePendingCardEffects(
    addAction(removePendingAbility(game, options.ability.id), 'RESOLVE_ABILITY', options.playerId, {
      pendingAbilityId: options.ability.id,
      abilityId: options.ability.abilityId,
      sourceCardId: options.ability.sourceCardId,
      step: options.step,
      ...options.payload,
    }),
    options.orderedResolution
  );
}

function moveInspectionAndFinishWithoutHeart(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly effect: ActiveEffectState;
    readonly inspectedCardIds: readonly string[];
    readonly step: string;
    readonly orderedResolution: boolean;
    readonly continuePendingCardEffects: ContinuePendingCardEffects;
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
    readonly payload?: Readonly<Record<string, unknown>>;
  }
): GameState {
  const moveResult = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
    game,
    options.playerId,
    options.inspectedCardIds,
    options.enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  return options.continuePendingCardEffects(
    addAction(
      {
        ...moveResult.gameState,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      options.playerId,
      {
        pendingAbilityId: options.effect.id,
        abilityId: options.effect.abilityId,
        sourceCardId: options.effect.sourceCardId,
        step: options.step,
        inspectedCardIds: options.inspectedCardIds,
        waitingRoomCardIds: moveResult.waitingRoomCardIds,
        ...options.payload,
      }
    ),
    options.orderedResolution
  );
}

function getActiveMutekikyuEffect(
  game: GameState,
  stepId: string
): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID ||
    effect.stepId !== stepId
  ) {
    return null;
  }
  return effect;
}

function getActiveInspectionCardIds(
  game: GameState,
  effect: ActiveEffectState
): readonly string[] {
  const effectInspectionCardIds = effect.inspectionCardIds ?? [];
  return effectInspectionCardIds.filter((cardId) => game.inspectionZone.cardIds.includes(cardId));
}

function isOwnLiveCardInLiveZone(game: GameState, playerId: string, liveCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return player?.liveZone.cardIds.includes(liveCardId) === true;
}

function getStageKasumiMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return Object.values(SlotPosition).flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    return isKasumiCardId(game, cardId) ? [cardId] : [];
  });
}

function isKasumiCard(card: CardInstance): boolean {
  return KASUMI_SELECTOR(card);
}

function isKasumiCardId(game: GameState, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return card !== null && isKasumiCard(card);
}

function getUniquePrintedHeartColors(game: GameState, cardId: string): readonly HeartColor[] {
  const card = getCardById(game, cardId);
  if (!card || !isMemberCardData(card.data)) {
    return [];
  }

  const colors = new Set<HeartColor>();
  for (const heart of card.data.hearts) {
    if (hasPrintedHeart(heart)) {
      colors.add(heart.color);
    }
  }
  return [...colors];
}

function hasPrintedHeart(heart: HeartIcon): boolean {
  return heart.count > 0;
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== pendingAbilityId),
  };
}
