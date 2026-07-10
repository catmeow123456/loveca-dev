import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { CardInstance } from '../../../../domain/entities/card.js';
import {
  HS_SD1_014_ON_ENTER_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
  S_SD1_002_ON_ENTER_DISCARD_RECOVER_AQOURS_CARD_ABILITY_ID,
  SP_PB2_015_ON_ENTER_DISCARD_RECOVER_CATCHU_CARD_ABILITY_ID,
  SP_PB2_019_ON_ENTER_DISCARD_RECOVER_FIVEYNCRISE_CARD_ABILITY_ID,
  SP_PB2_021_ON_ENTER_DISCARD_RECOVER_KALEIDOSCORE_CARD_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { groupAliasIs, unitAliasIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { finishWaitingRoomToHandWorkflow } from './waiting-room-to-hand.js';

const SP_PB2_015_SELECT_DISCARD_STEP_ID = 'SP_PB2_015_SELECT_DISCARD_FOR_CATCHU_RECOVERY';
const SP_PB2_015_SELECT_RECOVERY_STEP_ID = 'SP_PB2_015_SELECT_CATCHU_CARD_FROM_WAITING_ROOM';
const SP_PB2_019_SELECT_DISCARD_STEP_ID = 'SP_PB2_019_SELECT_DISCARD_FOR_FIVEYNCRISE_RECOVERY';
const SP_PB2_019_SELECT_RECOVERY_STEP_ID =
  'SP_PB2_019_SELECT_FIVEYNCRISE_CARD_FROM_WAITING_ROOM';
const SP_PB2_021_SELECT_DISCARD_STEP_ID =
  'SP_PB2_021_SELECT_DISCARD_FOR_KALEIDOSCORE_RECOVERY';
const SP_PB2_021_SELECT_RECOVERY_STEP_ID =
  'SP_PB2_021_SELECT_KALEIDOSCORE_CARD_FROM_WAITING_ROOM';
const S_SD1_002_SELECT_DISCARD_STEP_ID = 'S_SD1_002_SELECT_DISCARD_FOR_AQOURS_RECOVERY';
const S_SD1_002_SELECT_RECOVERY_STEP_ID = 'S_SD1_002_SELECT_AQOURS_CARD_FROM_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface OnEnterDiscardRecoverUnitCardConfig {
  readonly abilityId: string;
  readonly recoveryLabel: string;
  readonly recoverySelector: (card: CardInstance) => boolean;
  readonly discardStepId: string;
  readonly recoveryStepId: string;
  readonly discardActionStep: string;
  readonly recoveryActionStep: string;
  readonly recoveryStepText: string;
}

const ON_ENTER_DISCARD_RECOVER_UNIT_CARD_WORKFLOWS: readonly OnEnterDiscardRecoverUnitCardConfig[] =
  [
    {
      abilityId: SP_PB2_015_ON_ENTER_DISCARD_RECOVER_CATCHU_CARD_ABILITY_ID,
      recoveryLabel: 'CatChu!',
      recoverySelector: unitAliasIs('CatChu!'),
      discardStepId: SP_PB2_015_SELECT_DISCARD_STEP_ID,
      recoveryStepId: SP_PB2_015_SELECT_RECOVERY_STEP_ID,
      discardActionStep: 'START_SELECT_DISCARD_FOR_CATCHU_RECOVERY',
      recoveryActionStep: 'DISCARD_SELECT_CATCHU_CARD',
      recoveryStepText: '请选择自己的休息室中1张『CatChu!』卡加入手牌。',
    },
    {
      abilityId: SP_PB2_019_ON_ENTER_DISCARD_RECOVER_FIVEYNCRISE_CARD_ABILITY_ID,
      recoveryLabel: '5yncri5e!',
      recoverySelector: unitAliasIs('5yncri5e!'),
      discardStepId: SP_PB2_019_SELECT_DISCARD_STEP_ID,
      recoveryStepId: SP_PB2_019_SELECT_RECOVERY_STEP_ID,
      discardActionStep: 'START_SELECT_DISCARD_FOR_FIVEYNCRISE_RECOVERY',
      recoveryActionStep: 'DISCARD_SELECT_FIVEYNCRISE_CARD',
      recoveryStepText: '请选择自己的休息室中1张『5yncri5e!』卡加入手牌。',
    },
    {
      abilityId: SP_PB2_021_ON_ENTER_DISCARD_RECOVER_KALEIDOSCORE_CARD_ABILITY_ID,
      recoveryLabel: 'KALEIDOSCORE',
      recoverySelector: unitAliasIs('KALEIDOSCORE'),
      discardStepId: SP_PB2_021_SELECT_DISCARD_STEP_ID,
      recoveryStepId: SP_PB2_021_SELECT_RECOVERY_STEP_ID,
      discardActionStep: 'START_SELECT_DISCARD_FOR_KALEIDOSCORE_RECOVERY',
      recoveryActionStep: 'DISCARD_SELECT_KALEIDOSCORE_CARD',
      recoveryStepText: '请选择自己的休息室中1张『KALEIDOSCORE』卡加入手牌。',
    },
    {
      abilityId: S_SD1_002_ON_ENTER_DISCARD_RECOVER_AQOURS_CARD_ABILITY_ID,
      recoveryLabel: 'Aqours',
      recoverySelector: groupAliasIs('Aqours'),
      discardStepId: S_SD1_002_SELECT_DISCARD_STEP_ID,
      recoveryStepId: S_SD1_002_SELECT_RECOVERY_STEP_ID,
      discardActionStep: 'START_SELECT_DISCARD_FOR_AQOURS_RECOVERY',
      recoveryActionStep: 'DISCARD_SELECT_AQOURS_CARD',
      recoveryStepText: '请选择自己的休息室中1张『Aqours』卡加入手牌。',
    },
    {
      abilityId: HS_SD1_014_ON_ENTER_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
      recoveryLabel: '蓮ノ空',
      recoverySelector: groupAliasIs('蓮ノ空'),
      discardStepId: 'HS_SD1_014_SELECT_DISCARD_FOR_HASUNOSORA_RECOVERY',
      recoveryStepId: 'HS_SD1_014_SELECT_HASUNOSORA_CARD_FROM_WAITING_ROOM',
      discardActionStep: 'START_SELECT_DISCARD_FOR_HASUNOSORA_RECOVERY',
      recoveryActionStep: 'DISCARD_SELECT_HASUNOSORA_CARD',
      recoveryStepText: '请选择自己的休息室中1张『莲之空』卡加入手牌。',
    },
  ];

export function registerOnEnterDiscardRecoverUnitCardWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of ON_ENTER_DISCARD_RECOVER_UNIT_CARD_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startOnEnterDiscardRecoverUnitCard(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.discardStepId, (game, input, context) =>
      input.selectedCardId
        ? finishDiscardForUnitRecovery(
            game,
            input.selectedCardId,
            config,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(config.abilityId, config.recoveryStepId, (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
    );
  }
}

function startOnEnterDiscardRecoverUnitCard(
  game: GameState,
  ability: PendingAbilityState,
  config: OnEnterDiscardRecoverUnitCardConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.hand.cardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OP_DISCARD_RECOVER_UNIT_CARD',
        reason: 'NO_HAND',
        recoveryLabel: config.recoveryLabel,
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.discardStepId,
      stepText: `请选择1张手牌放置入休息室。也可以选择不发动此效果。`,
      selectionLabel: '选择要放置入休息室的手牌',
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: {
        recoveryLabel: config.recoveryLabel,
        recoveryStepId: config.recoveryStepId,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: config.discardActionStep,
      recoveryLabel: config.recoveryLabel,
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishDiscardForUnitRecovery(
  game: GameState,
  selectedCardId: string,
  config: OnEnterDiscardRecoverUnitCardConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.discardStepId ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
    recoveryLabel: config.recoveryLabel,
  });
  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterCost,
    player.id,
    config.recoverySelector
  );

  if (selectableCardIds.length === 0) {
    return finishActiveEffect(
      {
        ...stateAfterCost,
        activeEffect: effect,
      },
      continuePendingCardEffects,
      {
        step: 'DISCARD_RECOVER_UNIT_CARD_NO_TARGET',
        recoveryLabel: config.recoveryLabel,
        discardedCardId: discardResult.discardedCardIds[0] ?? selectedCardId,
        discardedCardIds: discardResult.discardedCardIds,
        selectableCardIds,
        selectedCardIds: [],
      }
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: config.recoveryStepId,
        stepText: config.recoveryStepText,
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          ...effect.metadata,
          orderedResolution: effect.metadata?.orderedResolution === true,
          recoveryLabel: config.recoveryLabel,
          discardedHandCardIds: discardResult.discardedCardIds,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.recoveryActionStep,
      recoveryLabel: config.recoveryLabel,
      discardedCardId: discardResult.discardedCardIds[0] ?? selectedCardId,
      discardedCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
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
