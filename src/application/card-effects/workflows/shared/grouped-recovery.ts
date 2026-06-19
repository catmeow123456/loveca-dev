import {
  addAction,
  getPlayerById,
  type GameActionType,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import {
  BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID,
  HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID,
  HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  type GroupedSelectionRule,
  validateGroupedCardSelection,
} from '../../runtime/grouped-selection.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  and,
  groupAliasIs,
  liveRequiresHeartColor,
  memberHasHeartColor,
  type CardSelector,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import { countCardsInZoneMatching, getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';

const DECLINE_OPTION_LABEL = '不发动';
const DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL = '请选择要放置入休息室的卡牌';
const DISCARD_HAND_TO_ACTIVATE_STEP_TEXT = '请选择要放置入休息室的手牌。也可以选择不发动此效果。';
const HS_BP6_017_SELECT_DISCARD_STEP_ID = 'HS_BP6_017_SELECT_DISCARD_FOR_RECOVERY';
const HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID =
  'HS_BP6_017_SELECT_LIVE_AND_MEMBER_FROM_WAITING_ROOM';
const HS_PB1_020_SELECT_DISCARD_STEP_ID = 'HS_PB1_020_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const HS_PB1_020_SELECT_WAITING_ROOM_CARDS_STEP_ID =
  'HS_PB1_020_SELECT_CERISE_MEMBER_AND_HASUNOSORA_LIVE';
const BP6_005_SELECT_DISCARD_STEP_ID = 'BP6_005_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS_STEP_ID =
  'BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface RecoveryGroupConfig {
  readonly key: string;
  readonly selector: CardSelector;
  readonly requiredIfAvailable: boolean;
  readonly payloadField: string;
}

interface GroupedRecoveryWorkflowConfig {
  readonly abilityId: string;
  readonly discardStepId: string;
  readonly recoveryStepId: string;
  readonly discardCount: 1 | 2;
  readonly startActionStep: string;
  readonly recoveryActionStep: string;
  readonly discardActionType: GameActionType;
  readonly discardActionStep?: string;
  readonly noTargetActionStep?: string;
  readonly recoveryStepText: string;
  readonly selectionLabel: string;
  readonly confirmSelectionLabel: string;
  readonly skipRecoveryLabel?: string;
  readonly groups: readonly RecoveryGroupConfig[];
  readonly precondition?: (
    game: GameState,
    ability: PendingAbilityState,
    playerId: string
  ) =>
    | { readonly ok: true; readonly metadata?: Readonly<Record<string, unknown>> }
    | {
        readonly ok: false;
        readonly step: string;
        readonly payload?: Readonly<Record<string, unknown>>;
      };
}

const liveGroup = typeIs(CardType.LIVE);
const memberGroup = typeIs(CardType.MEMBER);
const ceriseBouquetMember = and(typeIs(CardType.MEMBER), unitAliasIs('Cerise Bouquet'));
const hasunosoraLive = and(typeIs(CardType.LIVE), groupAliasIs('蓮ノ空'));
const yellowHeartMember = memberHasHeartColor(HeartColor.YELLOW);
const yellowRequirementLive = liveRequiresHeartColor(HeartColor.YELLOW);

const GROUPED_RECOVERY_CONFIGS: readonly GroupedRecoveryWorkflowConfig[] = [
  {
    abilityId: HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID,
    discardStepId: HS_BP6_017_SELECT_DISCARD_STEP_ID,
    recoveryStepId: HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID,
    discardCount: 1,
    startActionStep: 'START_SELECT_DISCARD',
    recoveryActionStep: 'RECOVER_LIVE_AND_MEMBER',
    discardActionType: 'RESOLVE_ABILITY',
    discardActionStep: 'DISCARD_HAND_CARD',
    recoveryStepText: '请选择休息室中的 LIVE 卡和成员卡至多各1张加入手牌。也可以不选择。',
    selectionLabel: '选择要加入手牌的 LIVE / 成员',
    confirmSelectionLabel: '加入手牌',
    skipRecoveryLabel: '不加入',
    groups: [
      { key: 'live', selector: liveGroup, requiredIfAvailable: false, payloadField: 'liveCardIds' },
      {
        key: 'member',
        selector: memberGroup,
        requiredIfAvailable: false,
        payloadField: 'memberCardIds',
      },
    ],
  },
  {
    abilityId: HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
    discardStepId: HS_PB1_020_SELECT_DISCARD_STEP_ID,
    recoveryStepId: HS_PB1_020_SELECT_WAITING_ROOM_CARDS_STEP_ID,
    discardCount: 2,
    startActionStep: 'START_SELECT_DISCARD_TWO',
    recoveryActionStep: 'RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE',
    discardActionType: 'PAY_COST',
    noTargetActionStep: 'DISCARD_TWO_NO_RECOVERY_TARGET',
    recoveryStepText: '请选择休息室中的1张『Cerise Bouquet』成员卡和1张『莲之空』LIVE卡加入手牌。',
    selectionLabel: '选择要加入手牌的 Cerise Bouquet 成员 / 莲之空 LIVE',
    confirmSelectionLabel: '加入手牌',
    groups: [
      {
        key: 'ceriseMember',
        selector: ceriseBouquetMember,
        requiredIfAvailable: true,
        payloadField: 'ceriseMemberCardIds',
      },
      {
        key: 'hasunosoraLive',
        selector: hasunosoraLive,
        requiredIfAvailable: true,
        payloadField: 'hasunosoraLiveCardIds',
      },
    ],
    precondition: (game, _ability, playerId) => {
      const player = getPlayerById(game, playerId);
      const waitingRoomLiveCount = countCardsInZoneMatching(
        game,
        playerId,
        ZoneType.WAITING_ROOM,
        typeIs(CardType.LIVE)
      );
      if (!player || waitingRoomLiveCount < 3 || player.hand.cardIds.length < 2) {
        return {
          ok: false,
          step: waitingRoomLiveCount < 3 ? 'CONDITION_NOT_MET' : 'NOT_ENOUGH_HAND_TO_DISCARD',
          payload: {
            waitingRoomLiveCount,
            handCount: player?.hand.cardIds.length ?? 0,
          },
        };
      }
      return {
        ok: true,
        metadata: { waitingRoomLiveCount },
      };
    },
  },
  {
    abilityId: BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID,
    discardStepId: BP6_005_SELECT_DISCARD_STEP_ID,
    recoveryStepId: BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS_STEP_ID,
    discardCount: 2,
    startActionStep: 'START_SELECT_DISCARD_TWO',
    recoveryActionStep: 'RECOVER_YELLOW_HEART_MEMBER_AND_LIVE',
    discardActionType: 'PAY_COST',
    recoveryStepText:
      '请选择休息室中至多1张持有黄Heart的成员，与至多1张必要Heart中含黄Heart的LIVE加入手牌。',
    selectionLabel: '选择要加入手牌的黄Heart成员 / 黄必要Heart LIVE',
    confirmSelectionLabel: '加入手牌',
    skipRecoveryLabel: '不加入',
    groups: [
      {
        key: 'yellowHeartMember',
        selector: yellowHeartMember,
        requiredIfAvailable: false,
        payloadField: 'yellowHeartMemberCardIds',
      },
      {
        key: 'yellowRequirementLive',
        selector: yellowRequirementLive,
        requiredIfAvailable: false,
        payloadField: 'yellowRequirementLiveCardIds',
      },
    ],
    precondition: (game, _ability, playerId) => {
      const player = getPlayerById(game, playerId);
      if (!player || player.hand.cardIds.length < 2) {
        return {
          ok: false,
          step: 'SKIP_NOT_ENOUGH_HAND_TO_DISCARD',
        };
      }
      return { ok: true };
    },
  },
];

export function registerGroupedRecoveryWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of GROUPED_RECOVERY_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startGroupedRecoveryWorkflow(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.discardStepId,
      (game, input, context) => {
        const selectedCardIds = getDiscardSelectionInput(input, config);
        return selectedCardIds.length > 0
          ? startGroupedRecoveryAfterDiscard(
              game,
              selectedCardIds,
              config,
              context.continuePendingCardEffects,
              deps.enqueueTriggeredCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects);
      }
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.recoveryStepId,
      (game, input, context) =>
        finishGroupedRecoveryWorkflow(
          game,
          input.selectedCardIds ?? [],
          config,
          context.continuePendingCardEffects
        )
    );
  }
}

function startGroupedRecoveryWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: GroupedRecoveryWorkflowConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const precondition = config.precondition?.(game, ability, player.id);
  if (precondition?.ok === false) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: precondition.step,
        ...precondition.payload,
      }),
      orderedResolution
    );
  }

  const discardCost = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM' as const,
    minCount: config.discardCount,
    maxCount: config.discardCount,
    optional: true,
  };

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.discardStepId,
        stepText: getDiscardStepText(config),
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: config.discardCount === 2 ? 'ORDERED_MULTI' : undefined,
        minSelectableCards: config.discardCount === 2 ? 2 : undefined,
        maxSelectableCards: config.discardCount === 2 ? 2 : undefined,
        selectionLabel: getDiscardSelectionLabel(config),
        confirmSelectionLabel: config.discardCount === 2 ? '放置入休息室' : undefined,
        canSkipSelection: true,
        skipSelectionLabel: DECLINE_OPTION_LABEL,
        metadata: {
          ...precondition?.metadata,
          orderedResolution,
          effectCosts: [discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.startActionStep,
      ...precondition?.metadata,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function startGroupedRecoveryAfterDiscard(
  game: GameState,
  selectedCardIds: readonly string[],
  config: GroupedRecoveryWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.discardStepId) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== config.discardCount ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult =
    config.discardCount === 1
      ? discardOneHandCardToWaitingRoomAndEnqueueTriggers(
          game,
          player.id,
          uniqueSelectedCardIds[0]!,
          {
            candidateCardIds: effect.selectableCardIds ?? [],
          },
          enqueueTriggeredCardEffects
        )
      : discardHandCardsToWaitingRoomAndEnqueueTriggers(
          game,
          player.id,
          uniqueSelectedCardIds,
          {
            count: 2,
            candidateCardIds: effect.selectableCardIds ?? [],
          },
          enqueueTriggeredCardEffects
        );
  if (!discardResult) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(discardResult.gameState, player.id, (card) =>
    config.groups.some((group) => group.selector(card))
  );
  const requiredGroupKeys = config.groups
    .filter(
      (group) =>
        group.requiredIfAvailable &&
        selectableCardIds.some((cardId) => {
          const card = discardResult.gameState.cardRegistry.get(cardId);
          return card ? group.selector(card) : false;
        })
    )
    .map((group) => group.key);
  const requiredRecoveryCount = requiredGroupKeys.length;

  if (selectableCardIds.length === 0 && config.noTargetActionStep) {
    return continuePendingCardEffects(
      addAction({ ...discardResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: config.noTargetActionStep,
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const minSelectableCards = requiredRecoveryCount;
  const maxSelectableCards =
    requiredRecoveryCount > 0
      ? requiredRecoveryCount
      : Math.min(config.groups.length, selectableCardIds.length);

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: {
        ...effect,
        stepId: config.recoveryStepId,
        stepText: config.recoveryStepText,
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards,
        maxSelectableCards,
        selectionLabel: config.selectionLabel,
        confirmSelectionLabel: config.confirmSelectionLabel,
        canSkipSelection: requiredRecoveryCount === 0,
        skipSelectionLabel: requiredRecoveryCount === 0 ? config.skipRecoveryLabel : undefined,
        metadata: {
          ...effect.metadata,
          discardCardId: discardResult.discardedCardIds[0],
          discardedHandCardIds: discardResult.discardedCardIds,
          requiredRecoveryCount,
          requiredGroupKeys,
        },
      },
    },
    config.discardActionType,
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...(config.discardCount === 1
        ? { discardCardId: discardResult.discardedCardIds[0] }
        : { discardedHandCardIds: discardResult.discardedCardIds }),
      ...(config.discardActionStep ? { step: config.discardActionStep } : {}),
      selectableCardIds,
      ...(requiredRecoveryCount > 0 ? { requiredRecoveryCount } : {}),
    }
  );
}

function finishGroupedRecoveryWorkflow(
  game: GameState,
  selectedCardIds: readonly string[],
  config: GroupedRecoveryWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.recoveryStepId) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length < (effect.minSelectableCards ?? 0) ||
    uniqueSelectedCardIds.length > (effect.maxSelectableCards ?? config.groups.length) ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const requiredGroupKeys = getStringArrayMetadata(effect.metadata?.requiredGroupKeys);
  const validation = validateGroupedCardSelection(
    game,
    uniqueSelectedCardIds,
    config.groups.map(
      (group): GroupedSelectionRule => ({
        key: group.key,
        selector: group.selector,
        minCount: requiredGroupKeys.includes(group.key) ? 1 : 0,
        maxCount: 1,
      })
    )
  );
  if (!validation) {
    return game;
  }

  const exactCount =
    typeof effect.metadata?.requiredRecoveryCount === 'number' &&
    effect.metadata.requiredRecoveryCount > 0
      ? effect.metadata.requiredRecoveryCount
      : null;
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    validation.selectedCardIds,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      ...(exactCount !== null
        ? { exactCount }
        : {
            minCount: effect.minSelectableCards ?? 0,
            maxCount: effect.maxSelectableCards ?? config.groups.length,
          }),
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const groupPayload = Object.fromEntries(
    config.groups.map((group) => [
      group.payloadField,
      (validation.groupCardIds[group.key] ?? []).filter((cardId) =>
        recoveryResult.movedCardIds.includes(cardId)
      ),
    ])
  );
  const state = { ...recoveryResult.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.recoveryActionStep,
      selectedCardIds: recoveryResult.movedCardIds,
      ...groupPayload,
      ...(config.discardCount === 1
        ? {}
        : { discardedHandCardIds: effect.metadata?.discardedHandCardIds ?? [] }),
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getDiscardSelectionInput(
  input: { readonly selectedCardId?: string | null; readonly selectedCardIds?: readonly string[] },
  config: GroupedRecoveryWorkflowConfig
): readonly string[] {
  return config.discardCount === 1
    ? input.selectedCardId
      ? [input.selectedCardId]
      : []
    : (input.selectedCardIds ?? []);
}

function getDiscardStepText(config: GroupedRecoveryWorkflowConfig): string {
  if (config.discardCount === 1) {
    return DISCARD_HAND_TO_ACTIVATE_STEP_TEXT;
  }
  if (config.abilityId === BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID) {
    return '可以将2张手牌放置入休息室。如此做的场合，从休息室按黄Heart条件至多各回收1张。';
  }
  return '请选择2张手牌放置入休息室。也可以不发动。';
}

function getDiscardSelectionLabel(config: GroupedRecoveryWorkflowConfig): string {
  return config.discardCount === 1
    ? DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL
    : '选择要放置入休息室的2张手牌';
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
