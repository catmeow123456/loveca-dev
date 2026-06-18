import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
} from '../../ability-ids.js';
import type { EffectCostDefinition } from '../../../effects/effect-costs.js';
import { CARD_ABILITY_DEFINITIONS } from '../../definitions/index.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { discardOneHandCardToWaitingRoomForPlayer } from '../../runtime/actions.js';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
  type LookTopSelectToHandWorkflowConfig,
} from './look-top-select-to-hand.js';

const DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL = '请选择要放置入休息室的卡牌';
const DISCARD_HAND_TO_ACTIVATE_STEP_TEXT = '请选择要放置入休息室的手牌。也可以选择不发动此效果。';
const DECLINE_OPTION_LABEL = '不发动';
const DISCARD_LOOK_SELECT_DISCARD_STEP_ID = 'DISCARD_LOOK_SELECT_DISCARD';
const DISCARD_LOOK_SELECT_TAKE_STEP_ID = 'DISCARD_LOOK_SELECT_TAKE';
const DISCARD_LOOK_REVEAL_SELECTED_STEP_ID = 'DISCARD_LOOK_REVEAL_SELECTED';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface DiscardLookTopMetadata {
  readonly topCount: number;
  readonly memberOnly: boolean;
  readonly liveOnly: boolean;
  readonly selectionRequired: boolean;
  readonly revealSelectedBeforeHand: boolean;
  readonly orderedResolution: boolean;
}

export function registerDiscardLookTopSelectToHandWorkflowHandlers(): void {
  for (const abilityId of [
    GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
    BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  ]) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startDiscardLookTopSelectToHandWorkflow(game, ability, {
        orderedResolution: options.orderedResolution === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
      })
    );
    registerActiveEffectStepHandler(abilityId, DISCARD_LOOK_SELECT_DISCARD_STEP_ID, (game, input, context) =>
      input.selectedCardId
        ? startDiscardLookTopInspection(game, input.selectedCardId, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(abilityId, DISCARD_LOOK_SELECT_TAKE_STEP_ID, (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context
      )
    );
    registerActiveEffectStepHandler(abilityId, DISCARD_LOOK_REVEAL_SELECTED_STEP_ID, (game, _input, context) =>
      finishRevealedLookTopSelectToHandWorkflow(game, context)
    );
  }
}

function startDiscardLookTopSelectToHandWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution: boolean;
    readonly continuePendingCardEffects: ContinuePendingCardEffects;
  }
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (!player || !sourceCard) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => cardId !== ability.sourceCardId);
  const cardCode = sourceCard.data.cardCode;
  const selectableCardType = getDiscardLookTopSelectableCardType(cardCode);
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: true,
  };
  const metadata: DiscardLookTopMetadata = {
    topCount: getDiscardLookTopCount(cardCode),
    memberOnly: selectableCardType === 'MEMBER',
    liveOnly: selectableCardType === 'LIVE',
    selectionRequired: isDiscardLookTopSelectionRequired(cardCode),
    revealSelectedBeforeHand:
      cardCodeMatchesBase(cardCode, 'PL!-sd1-015') ||
      cardCodeMatchesBase(cardCode, 'PL!-bp3-010'),
    orderedResolution: options.orderedResolution,
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
        effectText: getDiscardLookTopEffectText(cardCode),
        stepId: DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
        stepText: DISCARD_HAND_TO_ACTIVATE_STEP_TEXT,
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL,
        canSkipSelection: true,
        skipSelectionLabel: DECLINE_OPTION_LABEL,
        metadata: {
          ...metadata,
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
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    }
  );
}

function startDiscardLookTopInspection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const metadata = getDiscardLookTopMetadata(effect.metadata);
  if (!metadata) {
    return game;
  }
  const discardResult = discardOneHandCardToWaitingRoomForPlayer(game, player.id, discardCardId, {
    candidateCardIds: effect.selectableCardIds ?? [],
  });
  if (!discardResult) {
    return game;
  }

  return startLookTopSelectToHandWorkflow(
    discardResult.gameState,
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    {
      ...createLookTopConfig(effect.effectText, metadata),
      startActionPayload: { discardCardId },
    },
    {
      orderedResolution: metadata.orderedResolution,
      continuePendingCardEffects,
    }
  );
}

function createLookTopConfig(
  effectText: string,
  metadata: DiscardLookTopMetadata
): LookTopSelectToHandWorkflowConfig {
  return {
    effectText,
    topCount: metadata.topCount,
    selector: metadata.liveOnly
      ? (card) => isLiveCardData(card.data)
      : metadata.memberOnly
        ? (card) => isMemberCardData(card.data)
        : () => true,
    countRule: { minCount: 0, maxCount: 1 },
    selectionRequiredWhenHasTargets: metadata.selectionRequired,
    revealSelectedBeforeHand:
      metadata.revealSelectedBeforeHand && (metadata.memberOnly || metadata.liveOnly),
    selectStepId: DISCARD_LOOK_SELECT_TAKE_STEP_ID,
    revealStepId: DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
    selectStepText: metadata.liveOnly
      ? '请选择其中1张LIVE卡加入手牌，其余放置入休息室。'
      : metadata.memberOnly
        ? '请选择其中1张成员卡加入手牌，其余放置入休息室。'
        : '请选择其中1张卡加入手牌，其余放置入休息室。',
    noTargetStepText: metadata.liveOnly
      ? '没有可加入手牌的LIVE卡。确认后其余卡片放置入休息室。'
      : metadata.memberOnly
        ? '没有可加入手牌的成员卡。确认后其余卡片放置入休息室。'
        : '没有可加入手牌的卡片。确认后其余卡片放置入休息室。',
    selectionLabel: metadata.selectionRequired
      ? '请选择要加入手牌的卡牌'
      : metadata.liveOnly
        ? '请选择要加入手牌的LIVE卡'
        : '请选择要加入手牌的成员卡',
    confirmSelectionLabel: '加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: effectText,
    revealActionStep: 'REVEAL_SELECTED',
  };
}

function getDiscardLookTopMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): DiscardLookTopMetadata | null {
  const topCount = metadata?.topCount;
  if (typeof topCount !== 'number') {
    return null;
  }
  return {
    topCount,
    memberOnly: metadata?.memberOnly === true,
    liveOnly: metadata?.liveOnly === true,
    selectionRequired: metadata?.selectionRequired === true,
    revealSelectedBeforeHand: metadata?.revealSelectedBeforeHand === true,
    orderedResolution: metadata?.orderedResolution === true,
  };
}

function getDiscardLookTopCount(cardCode: string | undefined): number {
  if (cardCode && cardCodeMatchesBase(cardCode, 'PL!-sd1-015')) {
    return 5;
  }
  if (cardCode && cardCodeMatchesBase(cardCode, 'PL!-bp3-010')) {
    return 5;
  }
  return 3;
}

function getDiscardLookTopSelectableCardType(
  cardCode: string | undefined
): 'MEMBER' | 'LIVE' | null {
  if (cardCode && cardCodeMatchesBase(cardCode, 'PL!-sd1-015')) {
    return 'MEMBER';
  }
  if (cardCode && cardCodeMatchesBase(cardCode, 'PL!-bp3-010')) {
    return 'LIVE';
  }
  return null;
}

function isDiscardLookTopSelectionRequired(cardCode: string | undefined): boolean {
  if (!cardCode) {
    return false;
  }
  return [
    'PL!-sd1-011',
    'PL!-sd1-012',
    'PL!-sd1-016',
    'PL!HS-PR-001',
    'PL!HS-cl1-007',
    'PL!HS-pb1-011',
    'PL!N-PR-004',
    'PL!N-PR-006',
    'PL!N-PR-013',
    'PL!N-bp1-007',
    'PL!N-bp1-010',
    'PL!N-sd1-002',
    'PL!N-sd1-003',
  ].some((baseCardCode) => cardCodeMatchesBase(cardCode, baseCardCode));
}

function getDiscardLookTopEffectText(cardCode: string | undefined): string {
  if (!cardCode) {
    return getCardAbilityEffectText(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
  }
  if (
    ['PL!-sd1-011', 'PL!-sd1-012', 'PL!-sd1-016'].some((baseCardCode) =>
      cardCodeMatchesBase(cardCode, baseCardCode)
    )
  ) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡。将1张其中的卡片加入手牌，其余的卡片放置入休息室。';
  }
  if (cardCodeMatchesBase(cardCode, 'PL!-sd1-015')) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的5张卡。可以将1张其中的成员卡公开并加入手牌。其余的卡片放置入休息室。';
  }
  if (cardCodeMatchesBase(cardCode, 'PL!HS-PR-001')) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡，将1张加入手牌，其余放置入休息室。';
  }
  if (cardCodeMatchesBase(cardCode, 'PL!-bp3-010')) {
    return getCardAbilityEffectText(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
  }
  return getCardAbilityEffectText(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
}

function getCardAbilityEffectText(abilityId: string): string {
  const effectText = CARD_ABILITY_DEFINITIONS.find(
    (ability) => ability.abilityId === abilityId
  )?.effectText;
  if (!effectText || effectText.trim().length === 0) {
    throw new Error(`Missing card ability effect text for abilityId: ${abilityId}`);
  }
  return effectText;
}
