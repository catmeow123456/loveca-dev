import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import {
  PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
  PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import { registerCheerCardHeartColorReplacementWorkflowHandlers } from '../shared/cheer-card-heart-color-replacement.js';

const SCORE_BONUS = 1;
const VIVID_WORLD_HEART_REPLACEMENT_FROM_COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.PURPLE,
  HeartColor.RAINBOW,
] as const;
const COUNTED_HEART_COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;
const COUNTED_HEART_COLOR_SET = new Set<HeartColor>(COUNTED_HEART_COLORS);
const HEART_COLOR_LABELS: Record<HeartColor, string> = {
  [HeartColor.PINK]: '[桃ハート]',
  [HeartColor.RED]: '[赤ハート]',
  [HeartColor.YELLOW]: '[黄ハート]',
  [HeartColor.GREEN]: '[緑ハート]',
  [HeartColor.BLUE]: '[青ハート]',
  [HeartColor.PURPLE]: '[紫ハート]',
  [HeartColor.GRAY]: '[無色ハート]',
  [HeartColor.RAINBOW]: '[ALLハート]',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp4025VividWorldWorkflowHandlers(): void {
  registerCheerCardHeartColorReplacementWorkflowHandlers([
    {
      abilityId: PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
      fromColors: VIVID_WORLD_HEART_REPLACEMENT_FROM_COLORS,
      toColor: HeartColor.BLUE,
      actionStep: 'CHEER_HEART_COLORS_TO_BLUE',
      getConfirmationEffectText: (_game, ability, _context) =>
        getAbilityEffectText(ability.abilityId),
      getConfirmationStepText: () => '确认后结算此效果。',
    },
  ]);

  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveVividWorldLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getVividWorldLiveSuccessConfirmationConfig
  );
}

function resolveVividWorldLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const context = evaluateVividWorldLiveSuccess(game, ability);
  const stateWithoutPending = removePending(game, ability.id);
  let state = stateWithoutPending;

  if (player && context.conditionMet) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      liveCardId: ability.sourceCardId,
      countDelta: SCORE_BONUS,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    });
    state = refreshPlayerScoreDraft(state, player.id, SCORE_BONUS);
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: context.conditionMet ? 'NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE' : 'NO_OP',
      sourceInLiveZone: context.sourceInLiveZone,
      nijigasakiCheerMemberCardIds: context.nijigasakiCheerMemberCardIds,
      printedHeartColors: context.printedHeartColors,
      missingHeartColors: context.missingHeartColors,
      conditionMet: context.conditionMet,
      scoreBonus: context.conditionMet ? SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function getVividWorldLiveSuccessConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const context = evaluateVividWorldLiveSuccess(game, ability);
  const presentText = formatHeartColors(context.printedHeartColors);
  const missingText = formatHeartColors(context.missingHeartColors);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前本次声援公开的『虹ヶ咲』成员印刷Heart：${
      presentText || '无'
    }；缺少：${missingText || '无'}；${
      context.conditionMet ? '满足条件，确认后此LIVE[スコア]+1' : '未满足条件，确认后不增加[スコア]'
    }。）`,
    stepText: context.conditionMet ? '确认后此LIVE[スコア]+1。' : '确认后不增加[スコア]。',
  };
}

function evaluateVividWorldLiveSuccess(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceInLiveZone: boolean;
  readonly nijigasakiCheerMemberCardIds: readonly string[];
  readonly printedHeartColors: readonly HeartColor[];
  readonly missingHeartColors: readonly HeartColor[];
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return createEmptyContext(false);
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const nijigasakiCheerMemberCardIds = selectCurrentLiveRevealedCheerCardIds(game, player.id, {
    cardTypes: CardType.MEMBER,
    groupAliases: ['虹ヶ咲'],
    predicate: (card) => isMemberCardData(card.data),
  });
  const printedHeartColors = collectPrintedHeartColors(game, nijigasakiCheerMemberCardIds);
  const printedHeartColorSet = new Set(printedHeartColors);
  const missingHeartColors = COUNTED_HEART_COLORS.filter(
    (color) => !printedHeartColorSet.has(color)
  );
  return {
    sourceInLiveZone,
    nijigasakiCheerMemberCardIds,
    printedHeartColors,
    missingHeartColors,
    conditionMet: sourceInLiveZone && missingHeartColors.length === 0,
  };
}

function collectPrintedHeartColors(
  game: GameState,
  cardIds: readonly string[]
): readonly HeartColor[] {
  const colors = new Set<HeartColor>();
  for (const cardId of cardIds) {
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) {
      continue;
    }
    for (const heart of card.data.hearts) {
      if (heart.count > 0 && COUNTED_HEART_COLOR_SET.has(heart.color)) {
        colors.add(heart.color);
      }
    }
  }
  return COUNTED_HEART_COLORS.filter((color) => colors.has(color));
}

function createEmptyContext(
  sourceInLiveZone: boolean
): ReturnType<typeof evaluateVividWorldLiveSuccess> {
  return {
    sourceInLiveZone,
    nijigasakiCheerMemberCardIds: [],
    printedHeartColors: [],
    missingHeartColors: COUNTED_HEART_COLORS,
    conditionMet: false,
  };
}

function formatHeartColors(colors: readonly HeartColor[]): string {
  return colors.map((color) => HEART_COLOR_LABELS[color]).join('、');
}

function removePending(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
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
