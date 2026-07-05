import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updateLiveResolution,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import {
  addLiveModifier,
  getLiveCardScoreModifier,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
  N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID,
} from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const SCORE_BONUS = 1;
const SELECT_NIJIGASAKI_CARD_STEP_ID = 'N_BP5_026_SELECT_NIJIGASAKI_CARD_TO_HAND';
const TOKIMEKI_METADATA_KEY = 'nBp5026TokimekiRunners';
const SIX_HEART_COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5026TokimekiRunnersWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveTokimekiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getTokimekiLiveStartConfirmationConfig
  );

  registerPendingAbilityStarterHandler(
    N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID,
    (game, ability, options, context) =>
      startTokimekiLiveSuccessRecovery(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );

  registerActiveEffectStepHandler(
    N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID,
    SELECT_NIJIGASAKI_CARD_STEP_ID,
    (game, input, context) =>
      finishTokimekiLiveSuccessRecovery(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function getTokimekiLiveStartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const context = getTokimekiLiveStartContext(game, ability);
  const previewText = getTokimekiLiveStartPreviewText(context);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
    stepText: previewText,
  };
}

function resolveTokimekiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getTokimekiLiveStartContext(game, ability);
  let state = removePendingAbility(game, ability.id);
  if (context.conditionMet) {
    state = addScoreModifierAndRefresh(state, {
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      scoreBonus: SCORE_BONUS,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: context.conditionMet ? 'STAGE_SIX_HEARTS_THIS_LIVE_SCORE' : context.noOpStep,
      sourceInLiveZone: context.sourceInLiveZone,
      heartColorsPresent: context.heartColorsPresent,
      hasAllSixHearts: context.hasAllSixHearts,
      scoreBonus: context.conditionMet ? SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function startTokimekiLiveSuccessRecovery(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getTokimekiLiveSuccessContext(game, ability);
  if (!context.conditionMet || context.selectableCardIds.length === 0) {
    const noOpText = getTokimekiLiveSuccessNoOpText(context);
    const confirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options, {
      effectText: getTokimekiLiveSuccessNoOpEffectText(game, ability, context),
      stepText: noOpText,
    });
    if (confirmation) {
      return confirmation;
    }

    return continuePendingCardEffects(
      addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: context.noOpStep,
        sourceInLiveZone: context.sourceInLiveZone,
        currentScore: context.currentScore,
        selectableCardIds: context.selectableCardIds,
      }),
      options.orderedResolution === true
    );
  }

  const state: GameState = {
    ...removePendingAbility(game, ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_NIJIGASAKI_CARD_STEP_ID,
      stepText: '请选择自己的休息室1张『虹ヶ咲』卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds: context.selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择加入手牌的虹咲卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        [TOKIMEKI_METADATA_KEY]: true,
        orderedResolution: options.orderedResolution === true,
        recoveryCandidateCardIds: context.selectableCardIds,
        currentScore: context.currentScore,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_SELECT_NIJIGASAKI_CARD_TO_HAND',
    currentScore: context.currentScore,
    selectableCardIds: context.selectableCardIds,
  });
}

function finishTokimekiLiveSuccessRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID ||
    effect.stepId !== SELECT_NIJIGASAKI_CARD_STEP_ID ||
    effect.metadata?.[TOKIMEKI_METADATA_KEY] !== true ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const candidateCardIds = getStringArrayMetadata(effect, 'recoveryCandidateCardIds');
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_NIJIGASAKI_CARD',
      selectedCardId,
      movedCardIds: recoveryResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getTokimekiLiveStartContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceInLiveZone: boolean;
  readonly heartColorsPresent: readonly HeartColor[];
  readonly hasAllSixHearts: boolean;
  readonly conditionMet: boolean;
  readonly noOpStep: string;
} {
  const sourceInLiveZone = isSourceLiveCardInOwnLiveZone(game, ability.controllerId, ability.sourceCardId);
  const heartColorsPresent = collectOwnStageEffectiveHeartColors(game, ability.controllerId);
  const colorSet = new Set(heartColorsPresent);
  const hasAllSixHearts = SIX_HEART_COLORS.every((color) => colorSet.has(color));
  return {
    sourceInLiveZone,
    heartColorsPresent,
    hasAllSixHearts,
    conditionMet: sourceInLiveZone && hasAllSixHearts,
    noOpStep: !sourceInLiveZone ? 'SOURCE_NOT_IN_LIVE_ZONE' : 'STAGE_SIX_HEARTS_NOT_MET',
  };
}

function getTokimekiLiveSuccessContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceInLiveZone: boolean;
  readonly currentScore: number;
  readonly conditionMet: boolean;
  readonly selectableCardIds: readonly string[];
  readonly noOpStep: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  const sourceInLiveZone = isSourceLiveCardInOwnLiveZone(game, ability.controllerId, ability.sourceCardId);
  const printedScore =
    sourceCard && isLiveCardData(sourceCard.data) && sourceCard.ownerId === ability.controllerId
      ? sourceCard.data.score
      : 0;
  const currentScore =
    printedScore + getLiveCardScoreModifier(game.liveResolution, ability.sourceCardId);
  const conditionMet = sourceInLiveZone && currentScore === 3;
  const selectableCardIds =
    player && conditionMet
      ? selectWaitingRoomCardIds(game, player.id, groupAliasIs('虹ヶ咲'))
      : [];
  return {
    sourceInLiveZone,
    currentScore,
    conditionMet,
    selectableCardIds,
    noOpStep: !sourceInLiveZone
      ? 'SOURCE_NOT_IN_LIVE_ZONE'
      : currentScore === 3
        ? 'NO_NIJIGASAKI_CARD_IN_WAITING_ROOM'
        : 'LIVE_SCORE_NOT_THREE',
  };
}

function getTokimekiLiveSuccessNoOpEffectText(
  game: GameState,
  ability: PendingAbilityState,
  context = getTokimekiLiveSuccessContext(game, ability)
): string {
  return `${getAbilityEffectText(ability.abilityId)}（${getTokimekiLiveSuccessNoOpText(
    context
  )}）`;
}

function getTokimekiLiveStartPreviewText(
  context: ReturnType<typeof getTokimekiLiveStartContext>
): string {
  if (!context.sourceInLiveZone) {
    return '此LIVE已不在LIVE区，不增加分数。';
  }
  if (!context.hasAllSixHearts) {
    const presentColors = new Set(context.heartColorsPresent);
    const missingColors = SIX_HEART_COLORS.filter((color) => !presentColors.has(color));
    return `当前舞台尚未集齐六色Heart，缺少${formatHeartColors(missingColors)}。不增加分数。`;
  }
  return `当前舞台已集齐${formatHeartColors(SIX_HEART_COLORS)}。此LIVE分数+${SCORE_BONUS}。`;
}

function getTokimekiLiveSuccessNoOpText(
  context: ReturnType<typeof getTokimekiLiveSuccessContext>
): string {
  if (!context.sourceInLiveZone) {
    return '此LIVE已不在LIVE区，不回收。';
  }
  if (context.currentScore !== 3) {
    return `当前此LIVE分数为${context.currentScore}，不是3，不回收。`;
  }
  return '当前此LIVE分数为3，但休息室没有可加入手牌的『虹ヶ咲』卡，不回收。';
}

function formatHeartColors(colors: readonly HeartColor[]): string {
  return colors.map(formatHeartColor).join('、');
}

function formatHeartColor(color: HeartColor): string {
  switch (color) {
    case HeartColor.PINK:
      return '[桃ハート]';
    case HeartColor.RED:
      return '[赤ハート]';
    case HeartColor.YELLOW:
      return '[黄ハート]';
    case HeartColor.GREEN:
      return '[緑ハート]';
    case HeartColor.BLUE:
      return '[青ハート]';
    case HeartColor.PURPLE:
      return '[紫ハート]';
    case HeartColor.RAINBOW:
      return '[ALLハート]';
    default:
      return String(color);
  }
}

function collectOwnStageEffectiveHeartColors(game: GameState, playerId: string): readonly HeartColor[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const colors = new Set<HeartColor>();
  for (const memberCardId of getAllMemberCardIds(player.memberSlots)) {
    for (const heart of getMemberEffectiveHeartIcons(game, player.id, memberCardId)) {
      if (heart.count > 0) {
        colors.add(heart.color);
      }
    }
  }
  return [...colors];
}

function isSourceLiveCardInOwnLiveZone(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player?.liveZone.cardIds.includes(sourceCardId) === true &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    sourceCard.data.cardType === CardType.LIVE
  );
}

function addScoreModifierAndRefresh(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly abilityId: string;
    readonly scoreBonus: number;
  }
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId: options.playerId,
    countDelta: options.scoreBonus,
    liveCardId: options.sourceCardId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };
  return refreshPlayerScoreDraft(addLiveModifier(game, modifier), options.playerId, options.scoreBonus);
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  return updateLiveResolution(game, (liveResolution) => {
    const playerScores = new Map(liveResolution.playerScores);
    playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
    return { ...liveResolution, playerScores };
  });
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}

function getStringArrayMetadata(
  effect: NonNullable<GameState['activeEffect']>,
  key: string
): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string')
    ? value
    : [];
}
