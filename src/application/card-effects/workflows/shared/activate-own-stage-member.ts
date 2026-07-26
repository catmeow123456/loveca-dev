import type { ActiveEffectState, GameState } from '../../../../domain/entities/game.js';
import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, type SlotPosition } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs, type CardSelector } from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
  N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID,
  S_BP3_010_011_ON_ENTER_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface ActivateOwnStageMemberConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly sourceKind: 'OWN_STAGE_MEMBER' | 'OWN_LIVE_CARD' | 'ON_ENTER_SNAPSHOT';
  readonly sourceInvalidStep: string;
  readonly targetGroup?: {
    readonly alias: string;
    readonly displayName: string;
  };
  readonly mandatory: boolean;
}

const CONFIGS: readonly ActivateOwnStageMemberConfig[] = [
  {
    abilityId: BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
    stepId: 'BP3_001_LIVE_START_SELECT_MEMBER_TO_ACTIVE',
    sourceKind: 'OWN_STAGE_MEMBER',
    sourceInvalidStep: 'SOURCE_NOT_ON_STAGE',
    mandatory: false,
  },
  {
    abilityId: S_BP3_010_011_ON_ENTER_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
    stepId: 'S_BP3_010_011_ON_ENTER_SELECT_MEMBER_TO_ACTIVE',
    sourceKind: 'ON_ENTER_SNAPSHOT',
    sourceInvalidStep: 'SOURCE_NOT_REQUIRED_AFTER_ON_ENTER',
    mandatory: false,
  },
  {
    abilityId: N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID,
    stepId: 'N_SD2_025_LIVE_START_SELECT_MEMBER_TO_ACTIVE',
    sourceKind: 'OWN_LIVE_CARD',
    sourceInvalidStep: 'SOURCE_NOT_IN_OWN_LIVE_ZONE',
    targetGroup: {
      alias: '虹ヶ咲',
      displayName: '虹咲',
    },
    mandatory: true,
  },
];

const CONFIG_BY_ABILITY_ID = new Map(CONFIGS.map((config) => [config.abilityId, config]));

export function registerActivateOwnStageMemberWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startActivateOwnStageMember(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishActivateOwnStageMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startActivateOwnStageMember(
  game: GameState,
  ability: PendingAbilityState,
  config: ActivateOwnStageMemberConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const sourceSlot = getSourceMemberSlot(game, player.id, ability.sourceCardId);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (!isSourceValid(game, player.id, ability.sourceCardId, sourceSlot, config.sourceKind)) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: config.sourceInvalidStep,
      }),
      orderedResolution
    );
  }

  const targetGroupText = config.targetGroup ? `『${config.targetGroup.displayName}』` : '';
  const selector = getTargetSelector(config);
  const targetSelection = createStageMemberOrientationTargetSelection(stateWithoutPending, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: config.stepId,
    stepText: `${config.mandatory ? '请选择' : '可以选择'}自己舞台上的1名${targetGroupText}成员变为活跃状态。`,
    awaitingPlayerId: player.id,
    targetPlayerId: player.id,
    selector,
    targetOrientation: OrientationState.ACTIVE,
    selectionLabel: '选择要变为活跃状态的成员',
    orderedResolution,
    metadata: { sourceSlot },
  });

  if (targetSelection.activeEffect === null) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_WAITING_OWN_STAGE_MEMBER_TARGET',
        sourceSlot,
      }),
      orderedResolution
    );
  }

  const activeEffect: ActiveEffectState = {
    ...targetSelection.activeEffect,
    confirmSelectionLabel: '变为活跃状态',
    ...(config.mandatory
      ? {}
      : {
          canSkipSelection: true,
          skipSelectionLabel: '不发动',
        }),
  };
  return addAction({ ...stateWithoutPending, activeEffect }, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_SELECT_OWN_STAGE_MEMBER_TO_ACTIVE',
    sourceSlot,
    selectableCardIds: targetSelection.selectableCardIds,
  });
}

function finishActivateOwnStageMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  const config = effect ? CONFIG_BY_ABILITY_ID.get(effect.abilityId) : undefined;
  if (!effect || !config || effect.stepId !== config.stepId) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;

  const sourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  if (
    config.sourceKind === 'OWN_LIVE_CARD' &&
    !isSourceValid(game, player.id, effect.sourceCardId, sourceSlot, config.sourceKind)
  ) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: config.sourceInvalidStep,
        selectedCardId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (selectedCardId === null) {
    if (effect.canSkipSelection !== true) return game;
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_ACTIVATE_OWN_STAGE_MEMBER',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) return game;
  if (!getCurrentSelectableCardIds(game, player.id, config).includes(selectedCardId)) return game;

  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!targetMetadata || !orientationChange) return game;

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'ACTIVATE_OWN_STAGE_MEMBER',
          sourceSlot: effect.metadata?.sourceSlot,
          targetPlayerId: targetMetadata.targetPlayerId,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function getTargetSelector(config: ActivateOwnStageMemberConfig): CardSelector {
  return config.targetGroup
    ? and(typeIs(CardType.MEMBER), groupAliasIs(config.targetGroup.alias))
    : typeIs(CardType.MEMBER);
}

function getCurrentSelectableCardIds(
  game: GameState,
  playerId: string,
  config: ActivateOwnStageMemberConfig
): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(game, playerId, getTargetSelector(config)).filter(
    (cardId) => player?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.ACTIVE
  );
}

function isSourceValid(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  sourceSlot: SlotPosition | null,
  sourceKind: ActivateOwnStageMemberConfig['sourceKind']
): boolean {
  switch (sourceKind) {
    case 'OWN_STAGE_MEMBER':
      return sourceSlot !== null;
    case 'OWN_LIVE_CARD': {
      const player = getPlayerById(game, playerId);
      const sourceCard = getCardById(game, sourceCardId);
      return (
        player !== null &&
        sourceCard !== null &&
        sourceCard.ownerId === playerId &&
        isLiveCardData(sourceCard.data) &&
        player.liveZone.cardIds.includes(sourceCardId)
      );
    }
    case 'ON_ENTER_SNAPSHOT':
      return true;
  }
}
