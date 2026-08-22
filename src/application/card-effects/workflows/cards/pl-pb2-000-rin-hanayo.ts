import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addPlayerScoreLiveModifierForTargetMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!-pb2-000';
const SELECT_MUSE_LIVE_STEP_ID = 'PL_PB2_000_SELECT_MUSE_LIVE_FROM_WAITING_ROOM';
const REQUIRED_RELAY_COST_TOTAL = 15;
const museLiveSelector = and(typeIs(CardType.LIVE), groupAliasIs("μ's"));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface RelayReplacementSnapshot {
  readonly cardId: string;
  readonly slot: SlotPosition;
  readonly effectiveCost: number;
}

export function registerPlPb2000RinHanayoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startPlPb2000RinHanayoOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID,
    SELECT_MUSE_LIVE_STEP_ID,
    (game, input, context) =>
      finishPlPb2000RinHanayoRecovery(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startPlPb2000RinHanayoOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const relayReplacements = parseRelayReplacementSnapshots(ability.metadata?.relayReplacements);
  const relayCheck = validateDoubleMuseRelay(game, player.id, relayReplacements);
  if (!relayCheck.ok) {
    return finishPendingWithoutRecovery(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'DOUBLE_MUSE_RELAY_CONDITION_NOT_MET',
        reason: relayCheck.reason,
        relayReplacements,
      },
      continuePendingCardEffects
    );
  }

  const relayEffectiveCostTotal = relayReplacements.reduce(
    (total, replacement) => total + replacement.effectiveCost,
    0
  );
  const selectableCardIds = selectWaitingRoomCardIds(game, player.id, museLiveSelector);
  if (selectableCardIds.length === 0) {
    const stateWithoutPending = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    const stateAfterGrant = grantTemporaryScoreIfEligible(
      stateWithoutPending,
      player.id,
      ability.sourceCardId,
      relayEffectiveCostTotal
    );
    return finishPendingWithoutRecovery(
      stateAfterGrant,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_MUSE_LIVE_TO_RECOVER',
        relayReplacements,
        relayEffectiveCostTotal,
        scoreGranted:
          stateAfterGrant.liveResolution.liveModifiers.length >
          stateWithoutPending.liveResolution.liveModifiers.length,
      },
      continuePendingCardEffects,
      true
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_MUSE_LIVE_STEP_ID,
        stepText: '请选择自己休息室中1张『μ’s』LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectionLabel: '选择要加入手牌的『μ’s』LIVE卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          relayReplacements,
          relayEffectiveCostTotal,
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
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_MUSE_LIVE_FROM_WAITING_ROOM',
      relayReplacements,
      relayEffectiveCostTotal,
      selectableCardIds,
    }
  );
}

function finishPlPb2000RinHanayoRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getRinHanayoEffect(game);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || !selectedCardId) {
    return game;
  }

  const currentCandidates = selectWaitingRoomCardIds(game, player.id, museLiveSelector);
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !currentCandidates.includes(selectedCardId)
  ) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishStaleRecovery(game, effect, player.id, selectedCardId, continuePendingCardEffects)
      : game;
  }

  const relayReplacements = parseRelayReplacementSnapshots(effect.metadata?.relayReplacements);
  const relayCheck = validateDoubleMuseRelay(game, player.id, relayReplacements);
  const relayEffectiveCostTotal = numberValue(effect.metadata?.relayEffectiveCostTotal);
  if (
    !relayCheck.ok ||
    relayEffectiveCostTotal === null ||
    relayEffectiveCostTotal !==
      relayReplacements.reduce((total, replacement) => total + replacement.effectiveCost, 0)
  ) {
    return game;
  }

  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds ?? [],
    exactCount: 1,
  });
  if (!recovery) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finishStaleRecovery(game, effect, player.id, selectedCardId, continuePendingCardEffects)
      : game;
  }

  const stateWithoutEffect = { ...recovery.gameState, activeEffect: null };
  const stateAfterGrant = grantTemporaryScoreIfEligible(
    stateWithoutEffect,
    player.id,
    effect.sourceCardId,
    relayEffectiveCostTotal
  );
  const scoreGranted =
    stateAfterGrant.liveResolution.liveModifiers.length >
    stateWithoutEffect.liveResolution.liveModifiers.length;
  return continuePendingCardEffects(
    addAction(stateAfterGrant, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_MUSE_LIVE_AND_CHECK_RELAY_COST_TOTAL',
      selectedCardId: recovery.movedCardIds[0] ?? null,
      relayReplacements,
      relayEffectiveCostTotal,
      scoreGranted,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishStaleRecovery(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const relayReplacements = parseRelayReplacementSnapshots(effect.metadata?.relayReplacements);
  const relayEffectiveCostTotal = numberValue(effect.metadata?.relayEffectiveCostTotal);
  const relaySnapshotValid =
    validateDoubleMuseRelay(game, playerId, relayReplacements).ok &&
    relayEffectiveCostTotal !== null &&
    relayEffectiveCostTotal ===
      relayReplacements.reduce((total, replacement) => total + replacement.effectiveCost, 0);
  const stateWithoutEffect = { ...game, activeEffect: null };
  const stateAfterGrant = relaySnapshotValid
    ? grantTemporaryScoreIfEligible(
        stateWithoutEffect,
        playerId,
        effect.sourceCardId,
        relayEffectiveCostTotal
      )
    : stateWithoutEffect;
  const scoreGranted =
    stateAfterGrant.liveResolution.liveModifiers.length >
    stateWithoutEffect.liveResolution.liveModifiers.length;
  return continuePendingCardEffects(
    addAction(stateAfterGrant, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECTED_MUSE_LIVE_LEFT_WAITING_ROOM',
      selectedCardId,
      movedCardIds: [],
      relayReplacements,
      relayEffectiveCostTotal,
      relaySnapshotValid,
      scoreGranted,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function grantTemporaryScoreIfEligible(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  relayEffectiveCostTotal: number
): GameState {
  if (
    relayEffectiveCostTotal !== REQUIRED_RELAY_COST_TOTAL ||
    !isValidSourceOnStage(game, playerId, sourceCardId)
  ) {
    return game;
  }
  const result = addPlayerScoreLiveModifierForTargetMember(game, {
    playerId,
    targetMemberCardId: sourceCardId,
    sourceCardId,
    abilityId: PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID,
    countDelta: 1,
  });
  return result ? refreshPlayerScoreDraft(result.gameState, playerId, 1) : game;
}

function finishPendingWithoutRecovery(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  pendingAlreadyRemoved = false
): GameState {
  const state = pendingAlreadyRemoved
    ? game
    : {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function validateDoubleMuseRelay(
  game: GameState,
  playerId: string,
  relayReplacements: readonly RelayReplacementSnapshot[]
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (
    relayReplacements.length !== 2 ||
    new Set(relayReplacements.map((replacement) => replacement.cardId)).size !== 2 ||
    new Set(relayReplacements.map((replacement) => replacement.slot)).size !== 2
  ) {
    return { ok: false, reason: 'NOT_EXACTLY_TWO_RELAY_REPLACEMENTS' };
  }
  const allMuseMembers = relayReplacements.every((replacement) => {
    const card = getCardById(game, replacement.cardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      isMemberCardData(card.data) &&
      groupAliasIs("μ's")(card)
    );
  });
  return allMuseMembers ? { ok: true } : { ok: false, reason: 'REPLACEMENT_NOT_OWN_MUSE_MEMBER' };
}

function parseRelayReplacementSnapshots(value: unknown): readonly RelayReplacementSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): RelayReplacementSnapshot[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    const cardId = typeof candidate.cardId === 'string' ? candidate.cardId : null;
    const slot = slotValue(candidate.slot);
    const effectiveCost = numberValue(candidate.effectiveCost);
    return cardId && slot !== null && effectiveCost !== null
      ? [{ cardId, slot, effectiveCost }]
      : [];
  });
}

function getRinHanayoEffect(game: GameState): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID &&
    effect.stepId === SELECT_MUSE_LIVE_STEP_ID
    ? effect
    : null;
}

function isValidSourceOnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return Boolean(
    player &&
    source &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    Object.values(player.memberSlots.slots).includes(sourceCardId)
  );
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function slotValue(value: unknown): SlotPosition | null {
  return value === SlotPosition.LEFT ||
    value === SlotPosition.CENTER ||
    value === SlotPosition.RIGHT
    ? value
    : null;
}
