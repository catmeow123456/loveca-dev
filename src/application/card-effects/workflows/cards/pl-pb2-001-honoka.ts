import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForSourceMember,
  addPlayerScoreLiveModifierForTargetMember,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  groupAliasIs,
  hasAllBladeHeart,
  hasDrawBladeHeart,
  hasScoreBladeHeart,
} from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = PL_PB2_001_LIVE_START_SUCCESS_MUSE_ICON_REWARDS_ABILITY_ID;
const BASE_CARD_CODE = 'PL!-pb2-001';
const SELECT_MUSE_CARD_STEP_ID = 'PL_PB2_001_SELECT_MUSE_CARD_FROM_WAITING_ROOM';
const museCardSelector = groupAliasIs("μ's");

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb2001HonokaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startHonokaLiveStart(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_MUSE_CARD_STEP_ID, (game, input, context) =>
    finishMuseCardRecovery(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function startHonokaLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution?: boolean;
    readonly manualConfirmation?: boolean;
    readonly confirmBeforeResolution?: boolean;
    readonly skipManualConfirmation?: boolean;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const evaluation = evaluateHonoka(game, ability);
  const needsRecoverySelection =
    evaluation.sourceOnStage &&
    evaluation.hasDrawIcon &&
    evaluation.recoveryCandidateCardIds.length > 0;
  if (!needsRecoverySelection) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: getConfirmationEffectText(ability, evaluation),
      stepText: '确认后结算此效果。',
    });
    if (confirmation) {
      return confirmation;
    }
  }

  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const rewards = applyImmediateRewards(stateWithoutPending, ability, evaluation);
  if (!needsRecoverySelection) {
    return continuePendingCardEffects(
      addAction(rewards.gameState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SUCCESS_MUSE_ICON_REWARDS',
        ...evaluation,
        scoreGranted: rewards.scoreGranted,
        heartGranted: rewards.heartGranted,
        recoveredCardIds: [],
      }),
      options.orderedResolution === true
    );
  }

  return addAction(
    {
      ...rewards.gameState,
      activeEffect: {
        ...createWaitingRoomToHandEffectState({
          id: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          controllerId: player.id,
          effectText: getAbilityEffectText(ability.abilityId),
          stepId: SELECT_MUSE_CARD_STEP_ID,
          stepText: '请选择自己休息室中1张『μ’s』卡加入手牌。',
          awaitingPlayerId: player.id,
          selectableCardIds: evaluation.recoveryCandidateCardIds,
          selectionLabel: '选择要加入手牌的『μ’s』卡',
          confirmSelectionLabel: '加入手牌',
          canSkipSelection: false,
          metadata: {
            orderedResolution: options.orderedResolution === true,
            scoreGranted: rewards.scoreGranted,
            heartGranted: rewards.heartGranted,
            successMuseCardIds: evaluation.successMuseCardIds,
            hasScoreIcon: evaluation.hasScoreIcon,
            hasAllBladeIcon: evaluation.hasAllBladeIcon,
            hasDrawIcon: evaluation.hasDrawIcon,
          },
          zoneSelection: createWaitingRoomToHandSelectionConfig({
            minCount: 1,
            maxCount: 1,
            optional: false,
          }),
        }),
        selectableCardVisibility: 'PUBLIC',
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_MUSE_CARD_FROM_WAITING_ROOM',
      selectableCardIds: evaluation.recoveryCandidateCardIds,
      scoreGranted: rewards.scoreGranted,
      heartGranted: rewards.heartGranted,
    }
  );
}

function finishMuseCardRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== SELECT_MUSE_CARD_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const currentCandidates = selectWaitingRoomCardIds(game, player.id, museCardSelector);
  if (!currentCandidates.includes(selectedCardId)) {
    return game;
  }
  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds ?? [],
    exactCount: 1,
  });
  if (!recovery) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...recovery.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SUCCESS_MUSE_ICON_REWARDS_AND_RECOVER',
      successMuseCardIds: getStringArray(effect.metadata?.successMuseCardIds),
      hasScoreIcon: effect.metadata?.hasScoreIcon === true,
      hasAllBladeIcon: effect.metadata?.hasAllBladeIcon === true,
      hasDrawIcon: effect.metadata?.hasDrawIcon === true,
      scoreGranted: effect.metadata?.scoreGranted === true,
      heartGranted: effect.metadata?.heartGranted === true,
      recoveredCardIds: recovery.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function evaluateHonoka(game: GameState, ability: PendingAbilityState) {
  const player = getPlayerById(game, ability.controllerId);
  const sourceOnStage = isValidSourceOnStage(game, ability.controllerId, ability.sourceCardId);
  const successMuseCardIds =
    player?.successZone.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && card.ownerId === player.id && museCardSelector(card);
    }) ?? [];
  const cards = successMuseCardIds
    .map((cardId) => getCardById(game, cardId))
    .filter((card): card is NonNullable<typeof card> => card !== null);
  return {
    sourceOnStage,
    successMuseCardIds,
    hasScoreIcon: cards.some(hasScoreBladeHeart()),
    hasAllBladeIcon: cards.some(hasAllBladeHeart()),
    hasDrawIcon: cards.some(hasDrawBladeHeart()),
    recoveryCandidateCardIds:
      player === null ? [] : selectWaitingRoomCardIds(game, player.id, museCardSelector),
  };
}

function applyImmediateRewards(
  game: GameState,
  ability: PendingAbilityState,
  evaluation: ReturnType<typeof evaluateHonoka>
): {
  readonly gameState: GameState;
  readonly scoreGranted: boolean;
  readonly heartGranted: boolean;
} {
  if (!evaluation.sourceOnStage) {
    return { gameState: game, scoreGranted: false, heartGranted: false };
  }

  let state = game;
  let scoreGranted = false;
  let heartGranted = false;
  if (evaluation.hasScoreIcon) {
    const score = addPlayerScoreLiveModifierForTargetMember(state, {
      playerId: ability.controllerId,
      targetMemberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      countDelta: 1,
    });
    if (score) {
      state = refreshPlayerScoreDraft(score.gameState, ability.controllerId, 1);
      scoreGranted = true;
    }
  }
  if (evaluation.hasAllBladeIcon) {
    const heart = addHeartLiveModifierForSourceMember(state, {
      playerId: ability.controllerId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
    });
    if (heart) {
      state = heart.gameState;
      heartGranted = true;
    }
  }
  return { gameState: state, scoreGranted, heartGranted };
}

function getConfirmationEffectText(
  ability: PendingAbilityState,
  evaluation: ReturnType<typeof evaluateHonoka>
): string {
  const result = [
    evaluation.hasScoreIcon ? 'LIVE合计分数+1' : null,
    evaluation.hasAllBladeIcon ? '获得[ALLハート]' : null,
    evaluation.hasDrawIcon && evaluation.recoveryCandidateCardIds.length === 0
      ? '没有可加入手牌的『μ’s』卡'
      : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join('、');
  return `${getAbilityEffectText(ability.abilityId)}（当前成功LIVE卡区有${
    evaluation.successMuseCardIds.length
  }张『μ’s』卡；[スコア]${evaluation.hasScoreIcon ? '存在' : '不存在'}、[ALLハート]${
    evaluation.hasAllBladeIcon ? '存在' : '不存在'
  }、[ドロー]${evaluation.hasDrawIcon ? '存在' : '不存在'}；实际${
    evaluation.sourceOnStage && result ? result : '不产生效果'
  }。）`;
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

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
