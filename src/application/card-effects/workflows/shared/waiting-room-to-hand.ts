import { type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import {
  HONOKA_ON_ENTER_ABILITY_ID,
  HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
  KOTORI_ON_ENTER_ABILITY_ID,
  LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
  PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID,
  PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  and,
  costLte,
  groupIs,
  typeIs,
} from '../../../effects/card-selectors.js';
import { countSuccessfulLiveCards } from '../../../effects/conditions.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';

const SELECT_WAITING_ROOM_CARD_STEP_ID = 'SELECT_WAITING_ROOM_CARD';
const PL_S_PB1_001_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'PL_S_PB1_001_SELECT_WAITING_ROOM_LIVE';
const PR_018_SELECT_HIGH_SCORE_LIVE_STEP_ID =
  'PR_018_SELECT_HIGH_SCORE_LIVE_FROM_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export type WaitingRoomToHandCountRule =
  | {
      readonly exactCount: number;
      readonly minCount?: never;
      readonly maxCount?: never;
    }
  | {
      readonly exactCount?: never;
      readonly minCount: number;
      readonly maxCount: number;
    };

export interface WaitingRoomToHandAbilityContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
}

export interface WaitingRoomToHandWorkflowConfig {
  readonly ability: WaitingRoomToHandAbilityContext;
  readonly effectText: string;
  readonly stepId: string;
  readonly candidateBuilder: (game: GameState, playerId: string) => readonly string[];
  readonly countRule: WaitingRoomToHandCountRule;
  readonly optional: boolean;
  readonly orderedResolution: boolean;
  readonly stepText?: string;
  readonly selectionRequiredWhenHasTargets?: boolean;
  readonly canStart?: (game: GameState, playerId: string) => boolean;
  readonly conditionNotMetActionStep?: string;
  readonly noCandidatesActionStep?: string;
}

interface RegisteredWaitingRoomToHandWorkflowConfig
  extends Omit<WaitingRoomToHandWorkflowConfig, 'ability' | 'effectText' | 'orderedResolution'> {
  readonly abilityId: string;
}

const WAITING_ROOM_TO_HAND_WORKFLOWS: readonly RegisteredWaitingRoomToHandWorkflowConfig[] = [
  {
    abilityId: HONOKA_ON_ENTER_ABILITY_ID,
    stepId: SELECT_WAITING_ROOM_CARD_STEP_ID,
    candidateBuilder: (game, playerId) =>
      countSuccessfulLiveCards(game, playerId) >= 2
        ? selectWaitingRoomCardIds(game, playerId, typeIs(CardType.LIVE))
        : [],
    countRule: { minCount: 0, maxCount: 1 },
    optional: true,
  },
  {
    abilityId: KOTORI_ON_ENTER_ABILITY_ID,
    stepId: SELECT_WAITING_ROOM_CARD_STEP_ID,
    candidateBuilder: (game, playerId) =>
      selectWaitingRoomCardIds(
        game,
        playerId,
        and(typeIs(CardType.MEMBER), costLte(4), groupIs("μ's"))
      ),
    countRule: { minCount: 0, maxCount: 1 },
    optional: true,
  },
  {
    abilityId: LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
    stepId: SELECT_WAITING_ROOM_CARD_STEP_ID,
    candidateBuilder: (game, playerId) =>
      selectWaitingRoomCardIds(game, playerId, typeIs(CardType.MEMBER)),
    countRule: { minCount: 0, maxCount: 1 },
    optional: true,
  },
  {
    abilityId: HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
    stepId: SELECT_WAITING_ROOM_CARD_STEP_ID,
    candidateBuilder: (game, playerId) =>
      selectWaitingRoomCardIds(game, playerId, and(typeIs(CardType.MEMBER), costLte(2))),
    countRule: { minCount: 0, maxCount: 2 },
    optional: true,
  },
  {
    abilityId: PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID,
    stepId: PR_018_SELECT_HIGH_SCORE_LIVE_STEP_ID,
    stepText: '请选择自己的休息室中1张分数大于等于6的LIVE卡加入手牌。',
    candidateBuilder: (game, playerId) =>
      selectWaitingRoomCardIds(game, playerId, highScoreLiveCard),
    countRule: { minCount: 0, maxCount: 1 },
    optional: true,
    selectionRequiredWhenHasTargets: true,
  },
  {
    abilityId: PL_S_PB1_001_ON_ENTER_OPPONENT_HAND_TWO_MORE_RECOVER_LIVE_ABILITY_ID,
    stepId: PL_S_PB1_001_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    stepText: '请选择自己休息室中1张LIVE卡加入手牌。',
    canStart: opponentHasAtLeastTwoMoreHandCards,
    conditionNotMetActionStep: 'SKIP_OPPONENT_HAND_NOT_TWO_MORE',
    noCandidatesActionStep: 'NO_WAITING_ROOM_LIVE_TARGET',
    candidateBuilder: (game, playerId) =>
      selectWaitingRoomCardIds(game, playerId, typeIs(CardType.LIVE)),
    countRule: { minCount: 0, maxCount: 1 },
    optional: true,
    selectionRequiredWhenHasTargets: true,
  },
];

export function registerWaitingRoomToHandWorkflowHandlers(): void {
  for (const config of WAITING_ROOM_TO_HAND_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) => {
      const player = getPlayerById(game, ability.controllerId);
      if (!player) {
        return game;
      }
      const orderedResolution = options.orderedResolution === true;
      if (config.canStart && !config.canStart(game, player.id)) {
        return consumeWaitingRoomToHandPending(
          game,
          ability,
          player.id,
          orderedResolution,
          context.continuePendingCardEffects,
          config.conditionNotMetActionStep ?? 'SKIP_CONDITION_NOT_MET'
        );
      }
      const selectableCardIds = config.candidateBuilder(game, player.id);
      if (selectableCardIds.length === 0 && config.noCandidatesActionStep) {
        return consumeWaitingRoomToHandPending(
          game,
          ability,
          player.id,
          orderedResolution,
          context.continuePendingCardEffects,
          config.noCandidatesActionStep,
          { selectableCardIds }
        );
      }

      return startWaitingRoomToHandWorkflow(game, {
        ability,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.stepId,
        stepText: config.stepText,
        candidateBuilder: () => selectableCardIds,
        countRule: config.countRule,
        optional: config.optional,
        selectionRequiredWhenHasTargets: config.selectionRequiredWhenHasTargets,
        orderedResolution,
      });
    });
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
    );
  }
}

export function startWaitingRoomToHandWorkflow(
  game: GameState,
  config: WaitingRoomToHandWorkflowConfig
): GameState {
  const player = getPlayerById(game, config.ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = config.candidateBuilder(game, player.id);
  const countRule = resolveEffectiveCountRule(
    config.countRule,
    config.selectionRequiredWhenHasTargets === true && selectableCardIds.length > 0
  );

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
      activeEffect: createWaitingRoomToHandEffectState({
        id: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        controllerId: config.ability.controllerId,
        effectText: config.effectText,
        stepId: config.stepId,
        stepText: config.stepText,
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          orderedResolution: config.orderedResolution,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: getMinCount(countRule),
          maxCount: getMaxCount(countRule),
          optional: getMinCount(countRule) === 0 && config.optional,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      step: 'START_SELECT_WAITING_ROOM_CARD',
      selectableCardIds,
    }
  );
}

function consumeWaitingRoomToHandPending(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
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
      step,
      ...payload,
    }),
    orderedResolution
  );
}

export function finishWaitingRoomToHandWorkflow(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedSelections =
    Array.isArray(selectedCardIds) && selectedCardIds.length > 0 ? selectedCardIds : [];
  const selectedCardIdsToMove =
    orderedSelections.length > 0
      ? orderedSelections
      : selectedCardId !== null
        ? [selectedCardId]
        : [];
  const zoneSelection = getZoneSelectionConfig(effect);
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    selectedCardIdsToMove,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      minCount: zoneSelection.minCount,
      maxCount: zoneSelection.maxCount,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const state = {
    ...recoveryResult.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveEffectiveCountRule(
  countRule: WaitingRoomToHandCountRule,
  selectionRequiredWhenHasTargets: boolean
): WaitingRoomToHandCountRule {
  if (!selectionRequiredWhenHasTargets || countRule.exactCount !== undefined) {
    return countRule;
  }
  return {
    minCount: Math.max(1, countRule.minCount),
    maxCount: countRule.maxCount,
  };
}

function getMinCount(countRule: WaitingRoomToHandCountRule): number {
  return countRule.exactCount ?? countRule.minCount;
}

function getMaxCount(countRule: WaitingRoomToHandCountRule): number {
  return countRule.exactCount ?? countRule.maxCount;
}

function highScoreLiveCard(card: CardInstance): boolean {
  const score = (card.data as { readonly score?: unknown }).score;
  return typeIs(CardType.LIVE)(card) && typeof score === 'number' && score >= 6;
}

function opponentHasAtLeastTwoMoreHandCards(game: GameState, playerId: string): boolean {
  const player = getPlayerById(game, playerId);
  const opponent = getOpponent(game, playerId);
  return !!player && !!opponent && opponent.hand.cardIds.length >= player.hand.cardIds.length + 2;
}
