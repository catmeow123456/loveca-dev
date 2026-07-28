import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  moveAllEnergyBelowMemberToEnergyZoneByCardEffect,
  type EnqueueTriggeredCardEffectsForEnergyBelowPlacement,
} from '../../../effects/energy-below.js';
import { N_BP7_029_LIVE_SUCCESS_RETURN_ENERGY_BELOW_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = N_BP7_029_LIVE_SUCCESS_RETURN_ENERGY_BELOW_SCORE_ABILITY_ID;
const BASE_CARD_CODE = 'PL!N-bp7-029';
const SELECT_MEMBER_STEP_ID = 'N_BP7_029_SELECT_MEMBER_WITH_ENERGY_BELOW';
const STAGE_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7029BurnWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnergyBelowPlacement;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startMemberSelection(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_MEMBER_STEP_ID, (game, input, context) =>
    finishMemberSelection(
      game,
      input.selectedCardId ?? null,
      deps.enqueueTriggeredCardEffects,
      context.continuePendingCardEffects
    )
  );
}

function startMemberSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean; readonly skipManualConfirmation?: boolean },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const targetSnapshots = getTargetEnergySnapshots(game, player.id);
  const targetMemberCardIds = Object.keys(targetSnapshots);
  if (targetMemberCardIds.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      stepText: '确认后结算此效果。',
    });
    if (confirmation) return confirmation;
    return finishPending(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      {
        step: 'NO_MEMBER_WITH_ENERGY_BELOW',
        selectedMemberCardId: null,
        movedEnergyCardIds: [],
        energyCountAfterMove: player.energyZone.cardIds.length,
        scoreBonus: 0,
      }
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_MEMBER_STEP_ID,
      stepText: '可以选择自己舞台上1名下方有能量的成员，将其下方所有能量以待机状态放置于能量区。',
      awaitingPlayerId: player.id,
      selectableCardIds: targetMemberCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要将下方能量放置入能量区的成员',
      confirmSelectionLabel: '放置于能量区',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution === true,
        targetEnergyCardIdsByMember: targetSnapshots,
      },
    },
    actionPayload: {
      step: 'START_SELECT_MEMBER_WITH_ENERGY_BELOW',
      targetMemberCardIds,
    },
  });
}

function finishMemberSelection(
  game: GameState,
  selectedMemberCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnergyBelowPlacement,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_MEMBER_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (selectedMemberCardId === null) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'DECLINE_RETURN_ENERGY_BELOW',
      selectedMemberCardId: null,
      movedEnergyCardIds: [],
      energyCountAfterMove: player.energyZone.cardIds.length,
      scoreBonus: 0,
    });
  }
  if (effect.selectableCardIds?.includes(selectedMemberCardId) !== true) {
    return game;
  }

  const expectedEnergyCardIds = getTargetSnapshot(
    effect.metadata?.targetEnergyCardIdsByMember,
    selectedMemberCardId
  );
  if (
    expectedEnergyCardIds.length === 0 ||
    !isValidSourceLive(game, player.id, effect.sourceCardId)
  ) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'SOURCE_OR_TARGET_STALE',
      selectedMemberCardId,
      movedEnergyCardIds: [],
      energyCountAfterMove: player.energyZone.cardIds.length,
      scoreBonus: 0,
    });
  }

  const movement = moveAllEnergyBelowMemberToEnergyZoneByCardEffect(game, {
    playerId: player.id,
    targetMemberCardId: selectedMemberCardId,
    expectedEnergyCardIds,
    cause: {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
    enqueueTriggeredCardEffects,
  });
  if (!movement) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'SOURCE_OR_TARGET_STALE',
      selectedMemberCardId,
      movedEnergyCardIds: [],
      energyCountAfterMove: player.energyZone.cardIds.length,
      scoreBonus: 0,
    });
  }

  const statePlayer = getPlayerById(movement.gameState, player.id);
  const energyCountAfterMove = statePlayer?.energyZone.cardIds.length ?? 0;
  const sourceStillValid = isValidSourceLive(movement.gameState, player.id, effect.sourceCardId);
  const scoreBonus =
    movement.movedEnergyCardIds.length >= 1 && energyCountAfterMove >= 10 && sourceStillValid
      ? 1
      : 0;
  const previousScoreBonus = getExistingScoreBonus(movement.gameState, effect);
  const replacement: LiveModifierState | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: player.id,
          countDelta: scoreBonus,
          liveCardId: effect.sourceCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null;
  let state = replaceLiveModifier(
    movement.gameState,
    {
      kind: 'SCORE',
      playerId: player.id,
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    replacement
  );
  state = refreshPlayerScoreDraft(state, player.id, scoreBonus - previousScoreBonus);

  return finishEffect(state, effect, continuePendingCardEffects, {
    step: 'RETURN_ENERGY_BELOW_TO_ENERGY_ZONE',
    selectedMemberCardId,
    movedEnergyCardIds: movement.movedEnergyCardIds,
    energyPlacedEventId: movement.energyPlacedEvent.eventId,
    energyCountAfterMove,
    scoreBonus,
    scoreDelta: scoreBonus - previousScoreBonus,
  });
}

function getTargetEnergySnapshots(
  game: GameState,
  playerId: string
): Readonly<Record<string, readonly string[]>> {
  const player = getPlayerById(game, playerId);
  if (!player) return {};
  const result: Record<string, readonly string[]> = {};
  for (const slot of STAGE_SLOTS) {
    const memberCardId = player.memberSlots.slots[slot];
    const member = memberCardId ? getCardById(game, memberCardId) : null;
    const energyCardIds = player.memberSlots.energyBelow[slot] ?? [];
    if (
      memberCardId &&
      member &&
      member.ownerId === player.id &&
      isMemberCardData(member.data) &&
      energyCardIds.length > 0
    ) {
      result[memberCardId] = [...energyCardIds];
    }
  }
  return result;
}

function getTargetSnapshot(value: unknown, targetMemberCardId: string): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const target = (value as Record<string, unknown>)[targetMemberCardId];
  return Array.isArray(target)
    ? target.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === player.id &&
    isLiveCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function getExistingScoreBonus(
  game: GameState,
  effect: Pick<ActiveEffectState, 'controllerId' | 'sourceCardId' | 'abilityId'>
): number {
  return game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.playerId === effect.controllerId &&
        modifier.liveCardId === effect.sourceCardId &&
        modifier.sourceCardId === effect.sourceCardId &&
        modifier.abilityId === effect.abilityId
    )
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreDelta: number): GameState {
  if (scoreDelta === 0) return game;
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreDelta);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function finishPending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
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

function finishEffect(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
