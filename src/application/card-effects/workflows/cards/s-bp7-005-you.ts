import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, SlotPosition, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import type { CardAbilityDefinition } from '../../ability-definition-types.js';
import {
  S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
  S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { stackMemberCardBelowStageMember } from '../../runtime/actions.js';
import { getStageMemberDelegatableOnEnterDefinitions } from '../../runtime/delegatable-definitions.js';
import { startDelegatedAbilitySequence } from '../../runtime/delegated-ability-sequence.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const ENTER_SELECT_MEMBER = 'S_BP7_005_ENTER_SELECT_WAITING_MEMBER';
const ENTER_SELECT_HOST = 'S_BP7_005_ENTER_SELECT_STAGE_HOST';
const ACT_DISCARD_TWO = 'S_BP7_005_ACT_DISCARD_TWO';
const ACT_SELECT_OTHER = 'S_BP7_005_ACT_SELECT_OTHER_AQOURS';
const ACT_SELECT_SOURCE_ABILITY = 'S_BP7_005_ACT_SELECT_SOURCE_ON_ENTER';
const ACT_SELECT_TARGET_ABILITY = 'S_BP7_005_ACT_SELECT_TARGET_ON_ENTER';
const ACT_SELECT_ORDER = 'S_BP7_005_ACT_SELECT_DELEGATED_ORDER';
const SOURCE_FIRST = 'source-first';
const TARGET_FIRST = 'target-first';
const STAGE_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const memberSelector = typeIs(CardType.MEMBER);
const aqoursSelector = groupAliasIs('Aqours');

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp7005YouWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
    ENTER_SELECT_MEMBER,
    (game, input, context) =>
      selectOnEnterMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_005_ON_ENTER_STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER_ABILITY_ID,
    ENTER_SELECT_HOST,
    (game, input, context) =>
      finishOnEnterHost(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerActivatedAbilityHandler(
    S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
    (game, playerId, sourceCardId) => startActivated(game, playerId, sourceCardId)
  );
  registerActiveEffectStepHandler(
    S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
    ACT_DISCARD_TWO,
    (game, input, context) =>
      payDiscardTwo(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
    ACT_SELECT_OTHER,
    (game, input, context) =>
      selectOtherMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
    ACT_SELECT_SOURCE_ABILITY,
    (game, input, context) =>
      selectDelegatedAbility(
        game,
        input.selectedOptionId ?? null,
        true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
    ACT_SELECT_TARGET_ABILITY,
    (game, input, context) =>
      selectDelegatedAbility(
        game,
        input.selectedOptionId ?? null,
        false,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
    ACT_SELECT_ORDER,
    (game, input, context) =>
      startSelectedSequence(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        context.delegatePendingAbility
      )
  );
}

function startOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const candidates = player ? getWaitingMemberIds(game, player.id) : [];
  if (!player || candidates.length === 0) {
    return finishPendingNoop(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_WAITING_MEMBER'
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
      stepId: ENTER_SELECT_MEMBER,
      stepText: '请选择自己休息室中的1张成员卡。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidates,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置于成员下方的卡',
      confirmSelectionLabel: '选择放置对象',
      canSkipSelection: false,
      metadata: { orderedResolution },
    },
    actionPayload: { step: 'START_SELECT_WAITING_MEMBER', selectableCardIds: candidates },
  });
}

function selectOnEnterMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== ENTER_SELECT_MEMBER ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) return game;
  if (!getWaitingMemberIds(game, effect.controllerId).includes(selectedCardId)) {
    return finishActiveNoop(game, effect, continuePendingCardEffects, 'WAITING_MEMBER_STALE');
  }
  const hosts = getStageHosts(game, effect.controllerId);
  if (hosts.length === 0) {
    return finishActiveNoop(game, effect, continuePendingCardEffects, 'NO_STAGE_HOST');
  }
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: ENTER_SELECT_HOST,
        stepText: '请选择自己舞台上的1名成员，将所选休息室成员放置于其下方。',
        selectableCardIds: hosts.map((host) => host.cardId),
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择下方放置成员卡的成员',
        confirmSelectionLabel: '放置于成员下方',
        metadata: { ...effect.metadata, selectedWaitingMemberCardId: selectedCardId },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'SELECT_WAITING_MEMBER', selectedCardId }
  );
}

function finishOnEnterHost(
  game: GameState,
  hostCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const selectedMemberCardId = getStringMetadata(effect, 'selectedWaitingMemberCardId');
  if (!effect || effect.stepId !== ENTER_SELECT_HOST || !hostCardId || !selectedMemberCardId) return game;
  const host = getStageHosts(game, effect.controllerId).find((candidate) => candidate.cardId === hostCardId);
  const selectedStillValid = getWaitingMemberIds(game, effect.controllerId).includes(selectedMemberCardId);
  const result = host && selectedStillValid
    ? stackMemberCardBelowStageMember(game, {
        playerId: effect.controllerId,
        sourceZone: ZoneType.WAITING_ROOM,
        movedCardId: selectedMemberCardId,
        hostCardId,
        targetSlot: host.slot,
      })
    : null;
  return continuePendingCardEffects(
    addAction({ ...(result?.gameState ?? game), activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: result ? 'STACK_WAITING_MEMBER_BELOW_STAGE_MEMBER' : 'SELECTED_MEMBER_OR_HOST_STALE',
      stackedCardId: result?.movedCardId ?? null,
      hostCardId,
      targetSlot: host?.slot ?? null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startActivated(game: GameState, playerId: string, sourceCardId: string): GameState {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  const sourceDefinitions = getStageOnEnterDefinitions(game, playerId, sourceCardId);
  const targets = getOtherDelegatableAqoursMembers(game, playerId, sourceCardId);
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !source ||
    source.ownerId !== playerId ||
    source.data.cardCode !== 'PL!S-bp7-005-SEC' ||
    player.memberSlots.slots[SlotPosition.CENTER] !== sourceCardId ||
    player.hand.cardIds.length < 2 ||
    sourceDefinitions.length === 0 ||
    targets.length === 0
  ) return game;

  return {
    ...game,
    activeEffect: {
      id: `${S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
      abilityId: S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID,
      sourceCardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID),
      stepId: ACT_DISCARD_TWO,
      stepText: '请选择2张手牌放置入休息室。',
      awaitingPlayerId: playerId,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      selectionLabel: '选择要放置入休息室的卡',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: false,
    },
  };
}

function payDiscardTwo(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== ACT_DISCARD_TWO || selectedCardIds.length !== 2) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player || player.memberSlots.slots[SlotPosition.CENTER] !== effect.sourceCardId) return game;
  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardIds,
    { count: 2, candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;
  let state = recordAbilityUseForContext(discardResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  state = recordPayCostAction(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedCardIds: discardResult.discardedCardIds,
  });
  const targets = getOtherDelegatableAqoursMembers(state, player.id, effect.sourceCardId);
  if (targets.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAID_NO_OTHER_DELEGATABLE_AQOURS_MEMBER',
        discardedCardIds: discardResult.discardedCardIds,
      }),
      false
    );
  }
  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: ACT_SELECT_OTHER,
        stepText: '请选择自己舞台上的另1名拥有可发动【登场】能力的『Aqours』成员。',
        selectableCardIds: targets.map((target) => target.cardId),
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectionLabel: '选择另一名Aqours成员',
        confirmSelectionLabel: '选择能力',
        metadata: { discardedCardIds: discardResult.discardedCardIds },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'PAY_DISCARD_TWO', discardedCardIds: discardResult.discardedCardIds }
  );
}

function selectOtherMember(
  game: GameState,
  targetCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== ACT_SELECT_OTHER || !targetCardId || effect.selectableCardIds?.includes(targetCardId) !== true) return game;
  const target = getOtherDelegatableAqoursMembers(game, effect.controllerId, effect.sourceCardId)
    .find((candidate) => candidate.cardId === targetCardId);
  const sourceDefinitions = getStageOnEnterDefinitions(game, effect.controllerId, effect.sourceCardId);
  if (!target || sourceDefinitions.length === 0) {
    return finishActiveNoop(game, effect, continuePendingCardEffects, 'PAID_TARGET_OR_SOURCE_ABILITY_STALE');
  }
  const nextEffect = {
    ...effect,
    metadata: {
      ...effect.metadata,
      targetCardId,
      sourceAbilityIds: sourceDefinitions.map((definition) => definition.abilityId),
      targetAbilityIds: target.definitions.map((definition) => definition.abilityId),
    },
  };
  return advanceAbilitySelection(game, nextEffect);
}

function selectDelegatedAbility(
  game: GameState,
  abilityId: string | null,
  sourceSelection: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const expectedStep = sourceSelection ? ACT_SELECT_SOURCE_ABILITY : ACT_SELECT_TARGET_ABILITY;
  if (!effect || effect.stepId !== expectedStep || !abilityId) return game;
  const sourceDefinitions = getStageOnEnterDefinitions(game, effect.controllerId, effect.sourceCardId);
  const targetCardId = getStringMetadata(effect, 'targetCardId');
  const targetDefinitions = targetCardId
    ? getStageOnEnterDefinitions(game, effect.controllerId, targetCardId)
    : [];
  const definitions = sourceSelection ? sourceDefinitions : targetDefinitions;
  if (!definitions.some((definition) => definition.abilityId === abilityId)) {
    return finishActiveNoop(game, effect, continuePendingCardEffects, 'PAID_SELECTED_ABILITY_STALE');
  }
  const nextEffect: ActiveEffectState = {
    ...effect,
    metadata: {
      ...effect.metadata,
      ...(sourceSelection
        ? { selectedSourceAbilityId: abilityId }
        : { selectedTargetAbilityId: abilityId }),
    },
  };
  return advanceAbilitySelection(game, nextEffect);
}

function advanceAbilitySelection(game: GameState, effect: ActiveEffectState): GameState {
  const sourceDefinitions = getStageOnEnterDefinitions(game, effect.controllerId, effect.sourceCardId);
  const targetCardId = getStringMetadata(effect, 'targetCardId');
  const targetDefinitions = targetCardId
    ? getStageOnEnterDefinitions(game, effect.controllerId, targetCardId)
    : [];
  let selectedSourceAbilityId = getStringMetadata(effect, 'selectedSourceAbilityId');
  let selectedTargetAbilityId = getStringMetadata(effect, 'selectedTargetAbilityId');
  if (!selectedSourceAbilityId && sourceDefinitions.length === 1) selectedSourceAbilityId = sourceDefinitions[0].abilityId;
  if (!selectedTargetAbilityId && targetDefinitions.length === 1) selectedTargetAbilityId = targetDefinitions[0].abilityId;

  let stepId = ACT_SELECT_ORDER;
  let stepText = '请选择两项【登场】能力的处理顺序。';
  let selectableOptions = [
    { id: SOURCE_FIRST, label: '先发动此成员的【登场】能力' },
    { id: TARGET_FIRST, label: '先发动另一名成员的【登场】能力' },
  ];
  if (!selectedSourceAbilityId) {
    stepId = ACT_SELECT_SOURCE_ABILITY;
    stepText = '请选择此成员要发动的1项【登场】能力。';
    selectableOptions = sourceDefinitions.map(toAbilityOption);
  } else if (!selectedTargetAbilityId) {
    stepId = ACT_SELECT_TARGET_ABILITY;
    stepText = '请选择另一名成员要发动的1项【登场】能力。';
    selectableOptions = targetDefinitions.map(toAbilityOption);
  }
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId,
        stepText,
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: stepId === ACT_SELECT_ORDER ? '选择处理顺序' : '选择要发动的能力',
        confirmSelectionLabel: stepId === ACT_SELECT_ORDER ? '按此顺序发动' : '发动',
        selectableOptions,
        canSkipSelection: false,
        metadata: { ...effect.metadata, selectedSourceAbilityId, selectedTargetAbilityId },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'ADVANCE_DELEGATED_ABILITY_SELECTION', nextStepId: stepId }
  );
}

function startSelectedSequence(
  game: GameState,
  order: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  delegatePendingAbility: Parameters<typeof startDelegatedAbilitySequence>[2]
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== ACT_SELECT_ORDER || (order !== SOURCE_FIRST && order !== TARGET_FIRST)) return game;
  const targetCardId = getStringMetadata(effect, 'targetCardId');
  const sourceAbilityId = getStringMetadata(effect, 'selectedSourceAbilityId');
  const targetAbilityId = getStringMetadata(effect, 'selectedTargetAbilityId');
  const sourceSlot = getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId);
  const targetSlot = targetCardId ? getSourceMemberSlot(game, effect.controllerId, targetCardId) : null;
  if (!targetCardId || !sourceAbilityId || !targetAbilityId || sourceSlot === null || targetSlot === null) {
    return finishActiveNoop(game, effect, continuePendingCardEffects, 'PAID_SEQUENCE_SELECTION_STALE');
  }
  const sourceAbility = createSyntheticOnEnter(effect, effect.sourceCardId, sourceSlot, sourceAbilityId);
  const targetAbility = createSyntheticOnEnter(effect, targetCardId, targetSlot, targetAbilityId);
  const abilities = order === SOURCE_FIRST ? [sourceAbility, targetAbility] : [targetAbility, sourceAbility];
  const state = addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'START_DELEGATED_ON_ENTER_SEQUENCE',
    discardedCardIds: effect.metadata?.discardedCardIds,
    targetCardId,
    delegatedAbilityIds: abilities.map((ability) => ability.abilityId),
    delegatedSourceCardIds: abilities.map((ability) => ability.sourceCardId),
  });
  return startDelegatedAbilitySequence(
    state,
    {
      id: `you-on-enter-sequence:${effect.id}`,
      controllerId: effect.controllerId,
      parentAbilityId: effect.abilityId,
      parentSourceCardId: effect.sourceCardId,
      parentEffectId: effect.id,
      orderedResolution: false,
      abilities,
    },
    delegatePendingAbility
  );
}

function createSyntheticOnEnter(
  effect: ActiveEffectState,
  sourceCardId: string,
  sourceSlot: SlotPosition,
  abilityId: string
): PendingAbilityState {
  return {
    id: `you:${effect.id}:${sourceCardId}:${abilityId}`,
    abilityId,
    sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`delegated-on-enter:${effect.id}:${sourceCardId}:${abilityId}`],
    sourceSlot,
    metadata: {
      delegatedByAbilityId: effect.abilityId,
      delegatedBySourceCardId: effect.sourceCardId,
      delegatedOnEnterFromStage: true,
      noEnterStageEvent: true,
    },
  };
}

function getStageOnEnterDefinitions(
  game: GameState,
  playerId: string,
  cardId: string
): readonly CardAbilityDefinition[] {
  const slot = getSourceMemberSlot(game, playerId, cardId);
  const card = getCardById(game, cardId);
  if (!card || slot === null) return [];
  return getStageMemberDelegatableOnEnterDefinitions(card.data.cardCode, slot);
}

function getOtherDelegatableAqoursMembers(game: GameState, playerId: string, sourceCardId: string) {
  return getStageHosts(game, playerId).flatMap((host) => {
    if (host.cardId === sourceCardId) return [];
    const card = getCardById(game, host.cardId);
    const definitions = getStageOnEnterDefinitions(game, playerId, host.cardId);
    return card && aqoursSelector(card) && definitions.length > 0 ? [{ ...host, definitions }] : [];
  });
}

function getStageHosts(game: GameState, playerId: string) {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId && card?.ownerId === playerId && isMemberCardData(card.data) ? [{ cardId, slot }] : [];
  });
}

function getWaitingMemberIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return player?.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return !!card && card.ownerId === playerId && memberSelector(card);
  }) ?? [];
}

function finishPendingNoop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
    }),
    orderedResolution
  );
}

function finishActiveNoop(
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
      discardedCardIds: effect.metadata?.discardedCardIds,
    }),
    false
  );
}

function getStringMetadata(effect: ActiveEffectState | null, key: string): string | null {
  const value = effect?.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function toAbilityOption(definition: CardAbilityDefinition) {
  return { id: definition.abilityId, label: `发动：${definition.effectText}` };
}
