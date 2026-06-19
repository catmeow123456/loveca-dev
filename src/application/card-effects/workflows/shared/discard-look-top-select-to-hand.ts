import {
  isLiveCardData,
  isMemberCardData,
  type CardInstance,
} from '../../../../domain/entities/card.js';
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
import { groupAliasIs, unitAliasIs } from '../../../effects/card-selectors.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
  type LookTopSelectToHandWorkflowConfig,
} from './look-top-select-to-hand.js';

const DISCARD_LOOK_SELECT_DISCARD_STEP_ID = 'DISCARD_LOOK_SELECT_DISCARD';
const DISCARD_LOOK_SELECT_TAKE_STEP_ID = 'DISCARD_LOOK_SELECT_TAKE';
const DISCARD_LOOK_REVEAL_SELECTED_STEP_ID = 'DISCARD_LOOK_REVEAL_SELECTED';
const HS_PR_DISCARD_LOOK_TOP_BASE_CARD_CODES = [
  'PL!HS-PR-001',
  'PL!HS-PR-002',
  'PL!HS-PR-005',
] as const;
const S_PR_DISCARD_LOOK_TOP_BASE_CARD_CODES = ['PL!S-PR-013', 'PL!S-PR-019'] as const;
const N_PB1_DISCARD_LOOK_TOP_TWO_BASE_CARD_CODES = ['PL!N-pb1-028', 'PL!N-pb1-035'] as const;
const DISCARD_LOOK_TOP_FIVE_MEMBER_BASE_CARD_CODES = ['PL!-sd1-015', 'PL!HS-bp2-010'] as const;
const DISCARD_LOOK_TOP_FOUR_MEMBER_BASE_CARD_CODES = ['PL!S-bp3-004'] as const;
const DISCARD_LOOK_TOP_FIVE_LIVE_BASE_CARD_CODES = [
  'PL!-bp3-010',
  'PL!HS-bp1-011',
  'PL!HS-bp6-022',
] as const;
const DISCARD_LOOK_TOP_ALIAS_CARD_CONFIGS = [
  { baseCardCode: 'PL!HS-bp1-009', alias: 'みらくらぱーく！', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!HS-pb1-018', alias: 'DOLLCHESTRA', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!SP-bp1-005', alias: 'Liella!', selectorKind: 'GROUP', topCount: 5 },
  { baseCardCode: 'PL!SP-pb1-015', alias: 'CatChu!', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!SP-pb1-016', alias: 'KALEIDOSCORE', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!SP-pb1-017', alias: '5yncri5e!', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!-pb1-016', alias: 'lilywhite', selectorKind: 'UNIT', topCount: 4 },
] as const;

type DiscardLookTopAliasSelectorKind = 'UNIT' | 'GROUP';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface DiscardLookTopMetadata {
  readonly topCount: number;
  readonly memberOnly: boolean;
  readonly liveOnly: boolean;
  readonly cardSelectorAlias?: string;
  readonly cardSelectorKind?: DiscardLookTopAliasSelectorKind;
  readonly selectionRequired: boolean;
  readonly revealSelectedBeforeHand: boolean;
  readonly orderedResolution: boolean;
}

export function registerDiscardLookTopSelectToHandWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
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
    registerActiveEffectStepHandler(
      abilityId,
      DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
      (game, input, context) =>
        input.selectedCardId
          ? startDiscardLookTopInspection(
              game,
              input.selectedCardId,
              context.continuePendingCardEffects,
              deps.enqueueTriggeredCardEffects
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
    registerActiveEffectStepHandler(
      abilityId,
      DISCARD_LOOK_SELECT_TAKE_STEP_ID,
      (game, input, context) =>
        resolveLookTopSelectToHandSelection(
          game,
          input.selectedCardId ?? null,
          input.selectedCardIds,
          context
        )
    );
    registerActiveEffectStepHandler(
      abilityId,
      DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
      (game, _input, context) => finishRevealedLookTopSelectToHandWorkflow(game, context)
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
  const aliasCardConfig = getDiscardLookTopAliasCardConfig(cardCode);
  const metadata: DiscardLookTopMetadata = {
    topCount: getDiscardLookTopCount(cardCode),
    memberOnly: selectableCardType === 'MEMBER',
    liveOnly: selectableCardType === 'LIVE',
    cardSelectorAlias: aliasCardConfig?.alias,
    cardSelectorKind: aliasCardConfig?.selectorKind,
    selectionRequired: isDiscardLookTopSelectionRequired(cardCode),
    revealSelectedBeforeHand:
      isDiscardLookTopMemberCard(cardCode) ||
      isDiscardLookTopFiveLiveCard(cardCode) ||
      aliasCardConfig !== undefined,
    orderedResolution: options.orderedResolution,
  };

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability,
        playerId: player.id,
        effectText: getDiscardLookTopEffectText(cardCode),
        stepId: DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution: options.orderedResolution,
        metadata: {
          ...metadata,
        },
      }),
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
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
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
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
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
    selector: createDiscardLookTopSelector(metadata),
    countRule: { minCount: 0, maxCount: 1 },
    selectionRequiredWhenHasTargets: metadata.selectionRequired,
    revealSelectedBeforeHand:
      metadata.revealSelectedBeforeHand &&
      (metadata.memberOnly || metadata.liveOnly || metadata.cardSelectorAlias !== undefined),
    selectStepId: DISCARD_LOOK_SELECT_TAKE_STEP_ID,
    revealStepId: DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
    selectStepText: metadata.liveOnly
      ? '请选择其中1张LIVE卡加入手牌，其余放置入休息室。'
      : metadata.memberOnly
        ? '请选择其中1张成员卡加入手牌，其余放置入休息室。'
        : metadata.cardSelectorAlias
          ? `请选择其中1张${metadata.cardSelectorAlias}的卡加入手牌，其余放置入休息室。`
          : '请选择其中1张卡加入手牌，其余放置入休息室。',
    noTargetStepText: metadata.liveOnly
      ? '没有可加入手牌的LIVE卡。确认后其余卡片放置入休息室。'
      : metadata.memberOnly
        ? '没有可加入手牌的成员卡。确认后其余卡片放置入休息室。'
        : metadata.cardSelectorAlias
          ? `没有可加入手牌的${metadata.cardSelectorAlias}的卡。确认后其余卡片放置入休息室。`
          : '没有可加入手牌的卡片。确认后其余卡片放置入休息室。',
    selectionLabel: metadata.selectionRequired
      ? '请选择要加入手牌的卡牌'
      : metadata.liveOnly
        ? '请选择要加入手牌的LIVE卡'
        : metadata.memberOnly
          ? '请选择要加入手牌的成员卡'
          : '请选择要加入手牌的卡牌',
    confirmSelectionLabel: '加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: effectText,
    revealActionStep: 'REVEAL_SELECTED',
  };
}

function createDiscardLookTopSelector(
  metadata: DiscardLookTopMetadata
): (card: CardInstance) => boolean {
  if (metadata.liveOnly) {
    return (card) => isLiveCardData(card.data);
  }
  if (metadata.memberOnly) {
    return (card) => isMemberCardData(card.data);
  }
  if (metadata.cardSelectorAlias && metadata.cardSelectorKind === 'GROUP') {
    return groupAliasIs(metadata.cardSelectorAlias);
  }
  if (metadata.cardSelectorAlias && metadata.cardSelectorKind === 'UNIT') {
    return unitAliasIs(metadata.cardSelectorAlias);
  }
  return () => true;
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
    cardSelectorAlias:
      typeof metadata?.cardSelectorAlias === 'string' ? metadata.cardSelectorAlias : undefined,
    cardSelectorKind: getDiscardLookTopAliasSelectorKind(metadata?.cardSelectorKind),
    selectionRequired: metadata?.selectionRequired === true,
    revealSelectedBeforeHand: metadata?.revealSelectedBeforeHand === true,
    orderedResolution: metadata?.orderedResolution === true,
  };
}

function getDiscardLookTopAliasSelectorKind(
  value: unknown
): DiscardLookTopAliasSelectorKind | undefined {
  return value === 'UNIT' || value === 'GROUP' ? value : undefined;
}

function getDiscardLookTopCount(cardCode: string | undefined): number {
  if (
    cardCode &&
    N_PB1_DISCARD_LOOK_TOP_TWO_BASE_CARD_CODES.some((baseCardCode) =>
      cardCodeMatchesBase(cardCode, baseCardCode)
    )
  ) {
    return 2;
  }
  if (isDiscardLookTopFourMemberCard(cardCode)) {
    return 4;
  }
  if (isDiscardLookTopFiveMemberCard(cardCode)) {
    return 5;
  }
  if (isDiscardLookTopFiveLiveCard(cardCode)) {
    return 5;
  }
  const aliasCardConfig = getDiscardLookTopAliasCardConfig(cardCode);
  if (aliasCardConfig) {
    return aliasCardConfig.topCount;
  }
  return 3;
}

function getDiscardLookTopSelectableCardType(
  cardCode: string | undefined
): 'MEMBER' | 'LIVE' | null {
  if (isDiscardLookTopMemberCard(cardCode)) {
    return 'MEMBER';
  }
  if (isDiscardLookTopFiveLiveCard(cardCode)) {
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
    ...HS_PR_DISCARD_LOOK_TOP_BASE_CARD_CODES,
    ...S_PR_DISCARD_LOOK_TOP_BASE_CARD_CODES,
    ...N_PB1_DISCARD_LOOK_TOP_TWO_BASE_CARD_CODES,
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
    return getAbilityEffectText(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
  }
  if (
    ['PL!-sd1-011', 'PL!-sd1-012', 'PL!-sd1-016'].some((baseCardCode) =>
      cardCodeMatchesBase(cardCode, baseCardCode)
    )
  ) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡。将1张其中的卡片加入手牌，其余的卡片放置入休息室。';
  }
  if (isDiscardLookTopFiveMemberCard(cardCode)) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的5张卡。可以将1张其中的成员卡公开并加入手牌。其余的卡片放置入休息室。';
  }
  if (isDiscardLookTopFourMemberCard(cardCode)) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的4张卡。可以将1张其中的成员卡公开并加入手牌。其余的卡片放置入休息室。';
  }
  if (
    [...HS_PR_DISCARD_LOOK_TOP_BASE_CARD_CODES, ...S_PR_DISCARD_LOOK_TOP_BASE_CARD_CODES].some(
      (baseCardCode) => cardCodeMatchesBase(cardCode, baseCardCode)
    )
  ) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡，将1张加入手牌，其余放置入休息室。';
  }
  if (
    N_PB1_DISCARD_LOOK_TOP_TWO_BASE_CARD_CODES.some((baseCardCode) =>
      cardCodeMatchesBase(cardCode, baseCardCode)
    )
  ) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的2张卡。将1张其中的卡片加入手牌，其余的卡片放置入休息室。';
  }
  if (isDiscardLookTopFiveLiveCard(cardCode)) {
    return getAbilityEffectText(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
  }
  const aliasCardConfig = getDiscardLookTopAliasCardConfig(cardCode);
  if (aliasCardConfig) {
    const topCount = getDiscardLookTopCount(cardCode);
    return `【登场】可以将1张手牌放置入休息室：检视自己卡组顶的${topCount}张卡。可以将1张其中的${aliasCardConfig.alias}的卡公开并加入手牌。其余的卡片放置入休息室。`;
  }
  return getAbilityEffectText(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
}

function isDiscardLookTopFiveLiveCard(cardCode: string | undefined): boolean {
  return (
    cardCode !== undefined &&
    DISCARD_LOOK_TOP_FIVE_LIVE_BASE_CARD_CODES.some((baseCardCode) =>
      cardCodeMatchesBase(cardCode, baseCardCode)
    )
  );
}

function isDiscardLookTopMemberCard(cardCode: string | undefined): boolean {
  return isDiscardLookTopFiveMemberCard(cardCode) || isDiscardLookTopFourMemberCard(cardCode);
}

function isDiscardLookTopFiveMemberCard(cardCode: string | undefined): boolean {
  return (
    cardCode !== undefined &&
    DISCARD_LOOK_TOP_FIVE_MEMBER_BASE_CARD_CODES.some((baseCardCode) =>
      cardCodeMatchesBase(cardCode, baseCardCode)
    )
  );
}

function isDiscardLookTopFourMemberCard(cardCode: string | undefined): boolean {
  return (
    cardCode !== undefined &&
    DISCARD_LOOK_TOP_FOUR_MEMBER_BASE_CARD_CODES.some((baseCardCode) =>
      cardCodeMatchesBase(cardCode, baseCardCode)
    )
  );
}

function getDiscardLookTopAliasCardConfig(
  cardCode: string | undefined
): (typeof DISCARD_LOOK_TOP_ALIAS_CARD_CONFIGS)[number] | undefined {
  if (!cardCode) {
    return undefined;
  }
  return DISCARD_LOOK_TOP_ALIAS_CARD_CONFIGS.find(({ baseCardCode }) =>
    cardCodeMatchesBase(cardCode, baseCardCode)
  );
}
