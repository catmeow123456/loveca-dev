import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, cardNameAliasIs, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { memberOriginalHeartLte } from '../../../effects/stage-targets.js';
import {
  PL_PB2_042_AUTO_ON_CHEER_BIBI_NAMES_WAIT_OPPONENT_ABILITY_ID,
  S_CL1_004_AUTO_ON_CHEER_TWO_LIVES_WAIT_OPPONENT_ORIGINAL_HEART_FOUR_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getPendingAbilitySourceLifecycleId,
  getStageMemberLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const names = ['绚濑绘里', '西木野真姬', '矢泽妮可'] as const;
const nameSelectors = names.map(cardNameAliasIs);
const bibiMember = and(typeIs(CardType.MEMBER), unitAliasIs('BiBi'));
const originalHeartAtMostFour = memberOriginalHeartLte(4);
type Continue = (game: GameState, ordered: boolean) => GameState;
type Source = PendingAbilityState | ActiveEffectState;

interface OnCheerConditionResult {
  readonly met: boolean;
  readonly statusText: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

interface OnCheerConditionalWaitConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly isValidSource: (game: GameState, ability: PendingAbilityState) => boolean;
  readonly evaluateCondition: (game: GameState, playerId: string) => OnCheerConditionResult;
}

const WORKFLOWS: readonly OnCheerConditionalWaitConfig[] = [
  {
    abilityId: PL_PB2_042_AUTO_ON_CHEER_BIBI_NAMES_WAIT_OPPONENT_ABILITY_ID,
    stepId: 'PL_PB2_042_SELECT_OPPONENT_LOW_ORIGINAL_HEART_MEMBER',
    isValidSource: (game, ability) => {
      const source = getCardById(game, ability.sourceCardId);
      return (
        source !== null &&
        source.ownerId === ability.controllerId &&
        isLiveCardData(source.data) &&
        cardCodeMatchesBase(source.data.cardCode, 'PL!-pb2-042')
      );
    },
    evaluateCondition: (game, playerId) => {
      const condition = evaluatePsychicFireCondition(game, playerId);
      return { met: condition.met, statusText: getPsychicFireNoActionText(condition) };
    },
  },
  {
    abilityId: S_CL1_004_AUTO_ON_CHEER_TWO_LIVES_WAIT_OPPONENT_ORIGINAL_HEART_FOUR_ABILITY_ID,
    stepId: 'S_CL1_004_SELECT_OPPONENT_LOW_ORIGINAL_HEART_MEMBER',
    isValidSource: (game, ability) => {
      const source = getCardById(game, ability.sourceCardId);
      return (
        source !== null &&
        source.ownerId === ability.controllerId &&
        isMemberCardData(source.data) &&
        cardCodeMatchesBase(source.data.cardCode, 'PL!S-cl1-004') &&
        ability.sourceSlot === SlotPosition.CENTER
      );
    },
    evaluateCondition: (game, playerId) => {
      const liveCardIds = selectCurrentLiveRevealedCheerCardIds(game, playerId, {
        cardTypes: CardType.LIVE,
      });
      const met = liveCardIds.length >= 2;
      return {
        met,
        statusText: `（当前LIVE因自己的声援公开的LIVE卡有${liveCardIds.length}张，${met ? '条件满足，但没有可选择的对方成员' : '未达到2张'}，本次没有成员变为待机状态。）`,
        payload: { matchingLiveCardIds: liveCardIds, matchingLiveCount: liveCardIds.length },
      };
    },
  },
];

export function registerOnCheerConditionalWaitOpponentOriginalHeartWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  for (const config of WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, pending, options, context) => {
      const ordered = options.orderedResolution === true;
      if (!config.isValidSource(game, pending))
        return finish(game, pending, ordered, context.continuePendingCardEffects, 'INVALID_SOURCE');
      const cheerEvent = getLatestOwnNormalCheerEventByIds(
        game,
        pending.controllerId,
        pending.eventIds
      );
      if (!cheerEvent)
        return finish(
          game,
          pending,
          ordered,
          context.continuePendingCardEffects,
          'NO_OWN_NORMAL_CHEER_EVENT'
        );

      // 触发来源身份保持不变；已诱发后离开来源区域或重登不改绑次数。
      const ability = {
        ...pending,
        sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, pending),
      };
      const condition = config.evaluateCondition(game, ability.controllerId);
      const selection = condition.met
        ? createTargetSelection(game, ability, ordered, config)
        : null;
      if (!selection) {
        const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
          game,
          ability,
          {
            ...options,
            confirmBeforeResolution: options.confirmBeforeResolution === true || !ordered,
          },
          {
            effectText: `${getAbilityEffectText(config.abilityId)}\n\n${condition.statusText}`,
            stepText: '确认后结算此效果，本次没有成员变为待机状态。',
          }
        );
        if (confirmation) return confirmation;
      }

      const state = recordAbilityUseForContext(game, ability.controllerId, {
        abilityId: config.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: ability.sourceLifecycleId,
        pendingAbilityId: ability.id,
      });
      if (!selection)
        return finish(
          state,
          ability,
          ordered,
          context.continuePendingCardEffects,
          condition.met ? 'NO_LEGAL_TARGET' : 'CONDITION_NOT_MET'
        );
      return startPendingActiveEffect(state, {
        ability,
        playerId: ability.controllerId,
        activeEffect: selection,
        actionPayload: {
          sourceCardId: ability.sourceCardId,
          step: 'SELECT_OPPONENT_LOW_ORIGINAL_HEART_MEMBER',
          cheerEventId: cheerEvent.eventId,
          selectableCardIds: selection.selectableCardIds,
          ...condition.payload,
        },
      });
    });

    registerActiveEffectStepHandler(
      config.abilityId,
      config.stepId,
      (game, input, context) => {
        const effect = game.activeEffect!;
        const ordered = effect.metadata?.orderedResolution === true;
        const selection = createTargetSelection(game, asPending(effect), ordered, config);
        if (!selection)
          return finish(
            game,
            effect,
            ordered,
            context.continuePendingCardEffects,
            'NO_LEGAL_TARGET'
          );
        const target = input.selectedCardId;
        if (!target || input.selectedOptionId != null || input.selectedCardIds != null) return game;
        if (!effect.selectableCardIds?.includes(target)) return game;
        const targetLifecycleIds = effect.metadata?.targetLifecycleIds as
          Readonly<Record<string, string>> | undefined;
        if (
          !selection.selectableCardIds?.includes(target) ||
          targetLifecycleIds?.[target] !== getStageMemberLifecycleId(game, target)
        )
          return { ...game, activeEffect: selection };
        const change = resolveStageMemberOrientationTargetSelection(game, effect, target);
        if (!change?.changed) return { ...game, activeEffect: selection };
        const result = enqueueMemberStateChangedTriggersFromOrientationResult(
          game,
          change,
          deps.enqueueTriggeredCardEffects,
          {
            prepareGameStateBeforeEnqueue: (state, orientation, events) =>
              addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
                pendingAbilityId: effect.id,
                abilityId: config.abilityId,
                sourceCardId: effect.sourceCardId,
                sourceLifecycleId: effect.sourceLifecycleId,
                step: 'WAIT_OPPONENT_LOW_ORIGINAL_HEART_MEMBER',
                targetCardId: target,
                previousOrientation: orientation.previousOrientation,
                nextOrientation: orientation.nextOrientation,
                memberStateChangedEventIds: events.map((event) => event.eventId),
              }),
          }
        );
        return context.continuePendingCardEffects(result.gameState, ordered);
      },
      queryCardSelection
    );
  }
}

function evaluatePsychicFireCondition(game: GameState, playerId: string) {
  const memberIds = selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    cardTypes: CardType.MEMBER,
  });
  const presentNames = names.filter((_name, index) =>
    memberIds.some((id) => {
      const card = getCardById(game, id);
      return card !== null && nameSelectors[index]!(card);
    })
  );
  const player = getPlayerById(game, playerId);
  const centerId = player?.memberSlots.slots[SlotPosition.CENTER];
  const center = centerId ? getCardById(game, centerId) : null;
  const centerIsBibi = center !== null && center.ownerId === playerId && bibiMember(center);
  const centerCost = centerIsBibi
    ? getMemberEffectiveCost(game, playerId, center.instanceId)
    : null;
  return {
    presentNames,
    centerCost,
    met: presentNames.length === names.length && centerCost !== null && centerCost >= 11,
  };
}

function getPsychicFireNoActionText(
  condition: ReturnType<typeof evaluatePsychicFireCondition>
): string {
  const missing = names.filter((name) => !condition.presentNames.includes(name));
  const cheerText =
    missing.length === 0
      ? '本次声援公开的成员卡已包含三个指定姓名'
      : `本次声援公开的成员卡尚缺${missing.map((name) => `「${name}」`).join('、')}`;
  const centerText =
    condition.centerCost === null
      ? '当前自己的中央区域没有『BiBi』成员'
      : `当前自己中央区域的『BiBi』成员费用为${condition.centerCost}`;
  const result = condition.met
    ? '条件满足，但没有可选择的对方成员，本次没有成员变为待机状态'
    : '条件不满足，本次没有成员变为待机状态';
  return `（${cheerText}；${centerText}。${result}。）`;
}

function createTargetSelection(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  config: OnCheerConditionalWaitConfig
): ActiveEffectState | null {
  const opponent = getOpponent(game, ability.controllerId);
  if (!opponent) return null;
  const selection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(config.abilityId),
    stepId: config.stepId,
    stepText: '请选择对方舞台上1名原本持有的HEART数量小于等于4的活跃成员变为待机状态。',
    awaitingPlayerId: ability.controllerId,
    targetPlayerId: opponent.id,
    selector: typeIs(CardType.MEMBER),
    statePredicate: (state, playerId, id) =>
      getPlayerById(state, playerId)?.memberSlots.cardStates.get(id)?.orientation ===
        OrientationState.ACTIVE && originalHeartAtMostFour(state, playerId, id),
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择要变为待机状态的对方成员',
    confirmSelectionLabel: '变为待机状态',
    orderedResolution: ordered,
    metadata: { eventIds: ability.eventIds },
  }).activeEffect;
  return selection
    ? {
        ...selection,
        sourceLifecycleId: ability.sourceLifecycleId,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        canSkipSelection: false,
        metadata: {
          ...selection.metadata,
          targetLifecycleIds: Object.fromEntries(
            (selection.selectableCardIds ?? []).map((id) => [
              id,
              getStageMemberLifecycleId(game, id),
            ])
          ),
        },
      }
    : null;
}

function asPending(effect: ActiveEffectState): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_CHEER,
    eventIds: Array.isArray(effect.metadata?.eventIds) ? effect.metadata.eventIds : [],
  };
}

function finish(
  game: GameState,
  source: Source,
  ordered: boolean,
  continuation: Continue,
  step: string
): GameState {
  return continuation(
    addAction(
      {
        ...game,
        activeEffect: game.activeEffect?.id === source.id ? null : game.activeEffect,
        pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== source.id),
      },
      'RESOLVE_ABILITY',
      source.controllerId,
      {
        pendingAbilityId: source.id,
        abilityId: source.abilityId,
        sourceCardId: source.sourceCardId,
        sourceLifecycleId: source.sourceLifecycleId,
        step,
      }
    ),
    ordered
  );
}
