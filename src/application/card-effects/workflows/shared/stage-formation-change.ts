import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import {
  HS_BP2_006_ON_ENTER_STAGE_FORMATION_CHANGE_ABILITY_ID,
  SP_PB2_014_ON_ENTER_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID,
  SP_BP4_027_LIVE_SUCCESS_LIELLA_STAGE_FORMATION_CHANGE_ABILITY_ID,
  SP_PB2_050_LIVE_START_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID,
  SP_SD2_001_LIVE_START_DRAW_STAGE_FORMATION_CHANGE_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  rearrangeStageMembersByMoveHistoryAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import type {
  RearrangeStageMemberPlacement,
  StageFormationMoveHistoryEntry,
} from '../../../effects/member-state.js';

const STAGE_FORMATION_CHANGE_STEP_ID = 'STAGE_FORMATION_CHANGE';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

interface StageFormationChangeConfig {
  readonly abilityId: string;
  readonly condition: (game: GameState, playerId: string) => boolean;
  readonly preDrawCount?: number;
  readonly conditionLabel: string;
}

interface StageMemberEntry {
  readonly cardId: string;
  readonly slot: SlotPosition;
  readonly card: CardInstance;
}

const STAGE_FORMATION_CHANGE_CONFIGS: readonly StageFormationChangeConfig[] = [
  {
    abilityId: SP_PB2_014_ON_ENTER_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID,
    condition: hasOnlyFiveyncriseStageMembers,
    conditionLabel: 'ONLY_FIVEYNCRISE_STAGE_MEMBERS',
  },
  {
    abilityId: SP_PB2_050_LIVE_START_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID,
    condition: hasAtLeastTwoFiveyncriseStageMembers,
    conditionLabel: '5yncri5e_STAGE_MEMBER_COUNT_AT_LEAST_TWO',
  },
  {
    abilityId: SP_SD2_001_LIVE_START_DRAW_STAGE_FORMATION_CHANGE_ABILITY_ID,
    condition: hasStageMember,
    preDrawCount: 1,
    conditionLabel: 'HAS_STAGE_MEMBER_AFTER_DRAW',
  },
  {
    abilityId: SP_BP4_027_LIVE_SUCCESS_LIELLA_STAGE_FORMATION_CHANGE_ABILITY_ID,
    condition: hasOnlyLiellaStageMembers,
    conditionLabel: 'ONLY_LIELLA_STAGE_MEMBERS',
  },
  {
    abilityId: HS_BP2_006_ON_ENTER_STAGE_FORMATION_CHANGE_ABILITY_ID,
    condition: hasStageMember,
    conditionLabel: 'HAS_STAGE_MEMBER',
  },
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerStageFormationChangeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  for (const config of STAGE_FORMATION_CHANGE_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startStageFormationChangeWorkflow(game, ability, config, {
        orderedResolution: options.orderedResolution === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
      })
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      STAGE_FORMATION_CHANGE_STEP_ID,
      (game, input, context) =>
        finishStageFormationChangeWorkflow(
          game,
          input.stageFormationMoveHistory,
          input.stageFormationPlacements,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
    );
  }
}

function startStageFormationChangeWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: StageFormationChangeConfig,
  options: {
    readonly orderedResolution: boolean;
    readonly continuePendingCardEffects: ContinuePendingCardEffects;
  }
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const drawResult =
    config.preDrawCount !== undefined
      ? drawCardsForPlayer(game, player.id, config.preDrawCount)
      : null;
  const stateAfterDraw = drawResult?.gameState ?? game;
  const conditionMet = config.condition(stateAfterDraw, player.id);
  const stageMembers = conditionMet ? getStageMembers(stateAfterDraw, player.id) : [];

  if (!conditionMet || stageMembers.length === 0) {
    return finishWithoutFormationWindow(
      stateAfterDraw,
      ability,
      player.id,
      options.orderedResolution,
      options.continuePendingCardEffects,
      {
        conditionMet,
        conditionLabel: config.conditionLabel,
        drawnCardIds: drawResult?.drawnCardIds ?? [],
      }
    );
  }

  return startPendingActiveEffect(stateAfterDraw, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: STAGE_FORMATION_CHANGE_STEP_ID,
      stepText: '请选择自己的舞台成员最终所在区域。也可以选择不进行站位变换。',
      awaitingPlayerId: player.id,
      selectableOptions: undefined,
      stageFormation: createStageFormationState(stateAfterDraw, player.id),
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution,
        optional: true,
        conditionLabel: config.conditionLabel,
        drawnCardIds: drawResult?.drawnCardIds ?? [],
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_STAGE_FORMATION_CHANGE',
      optional: true,
      conditionLabel: config.conditionLabel,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      stageFormation: createStageFormationState(stateAfterDraw, player.id),
    },
  });
}

function finishStageFormationChangeWorkflow(
  game: GameState,
  moveHistory: readonly StageFormationMoveHistoryEntry[] | undefined,
  expectedPlacements: readonly RearrangeStageMemberPlacement[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (!moveHistory) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'STAGE_FORMATION_CHANGE_SKIPPED',
        drawnCardIds: effect.metadata?.drawnCardIds ?? [],
      }),
      orderedResolution
    );
  }

  if (!effect.stageFormation) {
    return game;
  }

  const rearrangeResult = rearrangeStageMembersByMoveHistoryAndEnqueueTriggers(
    game,
    player.id,
    moveHistory,
    enqueueTriggeredCardEffects,
    {
      expectedPlacements,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
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
            step: 'STAGE_FORMATION_CHANGE',
            moveHistory,
            placements: result.placements,
            finalSlots: result.finalSlots,
            rearrangedMembers: result.rearrangedMembers,
            drawnCardIds: effect.metadata?.drawnCardIds ?? [],
          }
        ),
    }
  );
  if (!rearrangeResult) {
    return game;
  }

  return continuePendingCardEffects(rearrangeResult.gameState, orderedResolution);
}

function finishWithoutFormationWindow(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  details: {
    readonly conditionMet: boolean;
    readonly conditionLabel: string;
    readonly drawnCardIds: readonly string[];
  }
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: details.conditionMet
        ? 'STAGE_FORMATION_CHANGE_NO_LAYOUT'
        : 'STAGE_FORMATION_CHANGE_CONDITION_NOT_MET',
      conditionMet: details.conditionMet,
      conditionLabel: details.conditionLabel,
      drawnCardIds: details.drawnCardIds,
    }),
    orderedResolution
  );
}

function createStageFormationState(game: GameState, playerId: string) {
  const player = getPlayerById(game, playerId);
  return {
    playerId,
    slots: MEMBER_SLOT_ORDER.map((slot) => ({
      slot,
      cardId: player?.memberSlots.slots[slot] ?? null,
      originalSlot: slot,
      energyBelowCount: player?.memberSlots.energyBelow[slot]?.length ?? 0,
      memberBelowCount: player?.memberSlots.memberBelow[slot]?.length ?? 0,
    })),
  };
}

function getStageMembers(game: GameState, playerId: string): readonly StageMemberEntry[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const members: StageMemberEntry[] = [];
  for (const slot of MEMBER_SLOT_ORDER) {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    if (cardId && card && isMemberCardData(card.data)) {
      members.push({ cardId, slot, card });
    }
  }
  return members;
}

function hasStageMember(game: GameState, playerId: string): boolean {
  return getStageMembers(game, playerId).length > 0;
}

function hasOnlyLiellaStageMembers(game: GameState, playerId: string): boolean {
  const members = getStageMembers(game, playerId);
  return members.length > 0 && members.every((member) => cardBelongsToGroup(member.card.data, 'Liella!'));
}

function hasAtLeastTwoFiveyncriseStageMembers(game: GameState, playerId: string): boolean {
  return (
    getStageMembers(game, playerId).filter((member) =>
      normalizeUnitName(member.card.data.unitName).includes('5yncri5e')
    ).length >= 2
  );
}

function hasOnlyFiveyncriseStageMembers(game: GameState, playerId: string): boolean {
  const members = getStageMembers(game, playerId);
  return (
    members.length > 0 &&
    members.every((member) => normalizeUnitName(member.card.data.unitName).includes('5yncri5e'))
  );
}

function normalizeUnitName(value: string | undefined): string {
  return value?.replace(/[『』「」'’\s　・･·]/g, '').replace(/！/g, '!').toLowerCase() ?? '';
}
