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
import { CardType, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import {
  BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  PL_N_BP3_012_ON_ENTER_DISCARD_LOOK_TOP_NIJIGASAKI_CARD_ABILITY_ID,
  PL_BP5_014_ON_ENTER_DISCARD_LOOK_TOP_BLUE_OR_PURPLE_HEART_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  and,
  groupAliasIs,
  liveRequiresPrintedHeartColorAtLeast,
  memberHasHeartColor,
  memberHasPrintedHeartColorAtLeast,
  or,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
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
const S_BP2_005_RED_GREEN_BLUE_HEART_MEMBER_BASE_CARD_CODE = 'PL!S-bp2-005';
const PL_BP5_014_BLUE_OR_PURPLE_HEART_MEMBER_BASE_CARD_CODE = 'PL!-bp5-014';
const DISCARD_LOOK_TOP_PRINTED_HEART_COUNT_CARD_CONFIGS: readonly {
  readonly baseCardCode: string;
  readonly heartColor: HeartColor;
  readonly heartLabel: string;
}[] = [
  { baseCardCode: 'PL!S-pb1-013', heartColor: HeartColor.GREEN, heartLabel: '[緑ハート]' },
  { baseCardCode: 'PL!S-pb1-014', heartColor: HeartColor.RED, heartLabel: '[赤ハート]' },
  { baseCardCode: 'PL!S-pb1-015', heartColor: HeartColor.BLUE, heartLabel: '[青ハート]' },
] as const;
const DISCARD_LOOK_TOP_FIVE_LIVE_BASE_CARD_CODES = [
  'PL!-bp3-010',
  'PL!HS-bp1-011',
  'PL!HS-bp6-022',
] as const;
const DISCARD_LOOK_TOP_ALIAS_CARD_CONFIGS: readonly {
  readonly baseCardCode: string;
  readonly alias: string;
  readonly selectorKind: DiscardLookTopAliasSelectorKind;
  readonly topCount: number;
  readonly memberOnly?: boolean;
  readonly effectTextAbilityId?: string;
}[] = [
  { baseCardCode: 'PL!HS-bp1-009', alias: 'みらくらぱーく！', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!HS-pb1-018', alias: 'DOLLCHESTRA', selectorKind: 'UNIT', topCount: 5 },
  {
    baseCardCode: 'PL!S-bp3-009',
    alias: 'Aqours',
    selectorKind: 'GROUP',
    topCount: 6,
    memberOnly: true,
  },
  {
    baseCardCode: 'PL!-bp6-004',
    alias: "μ's",
    selectorKind: 'GROUP',
    topCount: 5,
    memberOnly: true,
  },
  { baseCardCode: 'PL!SP-bp1-005', alias: 'Liella!', selectorKind: 'GROUP', topCount: 5 },
  {
    baseCardCode: 'PL!SP-bp2-007',
    alias: 'Liella!',
    selectorKind: 'GROUP',
    topCount: 5,
    memberOnly: true,
  },
  {
    baseCardCode: 'PL!SP-pb2-017',
    alias: 'Liella!',
    selectorKind: 'GROUP',
    topCount: 5,
    memberOnly: true,
  },
  { baseCardCode: 'PL!SP-pb1-015', alias: 'CatChu!', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!SP-pb1-016', alias: 'KALEIDOSCORE', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!SP-pb1-017', alias: '5yncri5e!', selectorKind: 'UNIT', topCount: 5 },
  { baseCardCode: 'PL!-pb1-016', alias: 'lilywhite', selectorKind: 'UNIT', topCount: 4 },
  {
    baseCardCode: 'PL!N-bp3-012',
    alias: '虹ヶ咲',
    selectorKind: 'GROUP',
    topCount: 4,
    memberOnly: false,
    effectTextAbilityId: PL_N_BP3_012_ON_ENTER_DISCARD_LOOK_TOP_NIJIGASAKI_CARD_ABILITY_ID,
  },
] as const;

type DiscardLookTopAliasSelectorKind = 'UNIT' | 'GROUP';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface DiscardLookTopMetadata {
  readonly topCount: number;
  readonly memberOnly: boolean;
  readonly liveOnly: boolean;
  readonly cardSelectorAlias?: string;
  readonly cardSelectorKind?: DiscardLookTopAliasSelectorKind;
  readonly redGreenBlueHeartMemberOnly: boolean;
  readonly blueOrPurpleHeartMemberOnly: boolean;
  readonly printedHeartCountColor?: HeartColor;
  readonly printedHeartCountLabel?: string;
  readonly maxSelectCount: number;
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
    PL_N_BP3_012_ON_ENTER_DISCARD_LOOK_TOP_NIJIGASAKI_CARD_ABILITY_ID,
    PL_BP5_014_ON_ENTER_DISCARD_LOOK_TOP_BLUE_OR_PURPLE_HEART_MEMBER_ABILITY_ID,
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
          {
            continuePendingCardEffects: context.continuePendingCardEffects,
            enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
          }
        )
    );
    registerActiveEffectStepHandler(
      abilityId,
      DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
      (game, _input, context) =>
        finishRevealedLookTopSelectToHandWorkflow(game, {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        })
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
  const printedHeartCountConfig = getDiscardLookTopPrintedHeartCountCardConfig(cardCode);
  const metadata: DiscardLookTopMetadata = {
    topCount: getDiscardLookTopCount(cardCode),
    memberOnly: selectableCardType === 'MEMBER' || aliasCardConfig?.memberOnly === true,
    liveOnly: selectableCardType === 'LIVE',
    cardSelectorAlias: aliasCardConfig?.alias,
    cardSelectorKind: aliasCardConfig?.selectorKind,
    redGreenBlueHeartMemberOnly: isSBp2005RedGreenBlueHeartMemberCard(cardCode),
    printedHeartCountColor: printedHeartCountConfig?.heartColor,
    printedHeartCountLabel: printedHeartCountConfig?.heartLabel,
    blueOrPurpleHeartMemberOnly: isPlBp5014BlueOrPurpleHeartMemberCard(cardCode),
    maxSelectCount: getDiscardLookTopMaxSelectCount(cardCode),
    selectionRequired: isDiscardLookTopSelectionRequired(cardCode),
    revealSelectedBeforeHand:
      isDiscardLookTopMemberCard(cardCode) ||
      isDiscardLookTopFiveLiveCard(cardCode) ||
      isSBp2005RedGreenBlueHeartMemberCard(cardCode) ||
      isPlBp5014BlueOrPurpleHeartMemberCard(cardCode) ||
      printedHeartCountConfig !== undefined ||
      aliasCardConfig !== undefined,
    orderedResolution: options.orderedResolution,
  };

  if (selectableCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      options.orderedResolution,
      {
        step: 'NO_OP_DISCARD_LOOK_TOP',
        reason: 'NO_HAND',
        topCount: metadata.topCount,
        cardSelectorAlias: metadata.cardSelectorAlias,
        cardSelectorKind: metadata.cardSelectorKind,
        memberOnly: metadata.memberOnly,
        liveOnly: metadata.liveOnly,
      },
      options.continuePendingCardEffects
    );
  }

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
        selectionLabel: cardCodeMatchesBase(cardCode, 'PL!S-bp3-009')
          ? '选择要放置入休息室的卡'
          : undefined,
        confirmSelectionLabel: cardCodeMatchesBase(cardCode, 'PL!S-bp3-009')
          ? '放置入休息室'
          : undefined,
        skipSelectionLabel: cardCodeMatchesBase(cardCode, 'PL!S-bp3-009') ? '不发动' : undefined,
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
      publicEffectSummaryContext: {
        effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
        discardedCostCardIds: [discardCardId],
        inspectSourceZone: ZoneType.MAIN_DECK,
        requestedInspectCount: metadata.topCount,
      },
    },
    {
      orderedResolution: metadata.orderedResolution,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
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
    countRule: { minCount: 0, maxCount: metadata.maxSelectCount },
    selectionRequiredWhenHasTargets: metadata.selectionRequired,
    revealSelectedBeforeHand:
      metadata.revealSelectedBeforeHand &&
      (metadata.memberOnly ||
        metadata.liveOnly ||
        metadata.redGreenBlueHeartMemberOnly ||
        metadata.blueOrPurpleHeartMemberOnly ||
        metadata.printedHeartCountColor !== undefined ||
        metadata.cardSelectorAlias !== undefined),
    selectStepId: DISCARD_LOOK_SELECT_TAKE_STEP_ID,
    revealStepId: DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
    selectStepText: metadata.printedHeartCountLabel
      ? `请选择至多1张持有2个以上${metadata.printedHeartCountLabel}的成员卡，或必要Heart包含2个以上${metadata.printedHeartCountLabel}的LIVE卡，公开并加入手牌。其余放置入休息室。`
      : metadata.blueOrPurpleHeartMemberOnly
      ? '请选择至多1张持有[青ハート]或[紫ハート]的成员卡公开并加入手牌。其余放置入休息室。'
      : metadata.redGreenBlueHeartMemberOnly
      ? '请选择至多3张持有赤/绿/蓝 HEART 的成员卡公开并加入手牌。其余放置入休息室。'
      : metadata.liveOnly
        ? '请选择其中1张LIVE卡加入手牌，其余放置入休息室。'
        : metadata.cardSelectorAlias && metadata.memberOnly
          ? metadata.cardSelectorAlias === 'Aqours'
            ? '请选择至多1张Aqours成员卡公开并加入手牌，其余放置入休息室。'
            : `请选择其中1张${metadata.cardSelectorAlias}的成员卡加入手牌，其余放置入休息室。`
          : metadata.cardSelectorAlias
            ? `请选择其中1张${metadata.cardSelectorAlias}的卡加入手牌，其余放置入休息室。`
            : metadata.memberOnly
              ? '请选择其中1张成员卡加入手牌，其余放置入休息室。'
              : '请选择其中1张卡加入手牌，其余放置入休息室。',
    noTargetStepText: metadata.printedHeartCountLabel
      ? `没有可加入手牌的持有2个以上${metadata.printedHeartCountLabel}的成员卡或必要Heart包含2个以上${metadata.printedHeartCountLabel}的LIVE卡。确认后其余卡片放置入休息室。`
      : metadata.blueOrPurpleHeartMemberOnly
      ? '没有可加入手牌的持有[青ハート]或[紫ハート]的成员卡。确认后其余卡片放置入休息室。'
      : metadata.redGreenBlueHeartMemberOnly
      ? '没有可加入手牌的持有赤/绿/蓝 HEART 的成员卡。确认后其余卡片放置入休息室。'
      : metadata.liveOnly
        ? '没有可加入手牌的LIVE卡。确认后其余卡片放置入休息室。'
        : metadata.cardSelectorAlias && metadata.memberOnly
          ? `没有可加入手牌的${metadata.cardSelectorAlias}成员卡。确认后其余卡片放置入休息室。`
          : metadata.cardSelectorAlias
            ? `没有可加入手牌的${metadata.cardSelectorAlias}的卡。确认后其余卡片放置入休息室。`
            : metadata.memberOnly
              ? '没有可加入手牌的成员卡。确认后其余卡片放置入休息室。'
              : '没有可加入手牌的卡片。确认后其余卡片放置入休息室。',
    selectionLabel: metadata.selectionRequired
      ? '请选择要加入手牌的卡牌'
      : metadata.printedHeartCountLabel
      ? `请选择要公开并加入手牌的${metadata.printedHeartCountLabel}条件卡`
      : metadata.blueOrPurpleHeartMemberOnly
        ? '请选择要公开并加入手牌的青/紫 Heart 成员卡'
      : metadata.redGreenBlueHeartMemberOnly
        ? '请选择要公开并加入手牌的赤/绿/蓝 HEART 成员卡'
        : metadata.liveOnly
          ? '请选择要加入手牌的LIVE卡'
          : metadata.cardSelectorAlias && metadata.memberOnly
            ? metadata.cardSelectorAlias === 'Aqours'
              ? '选择要公开并加入手牌的卡'
              : `请选择要加入手牌的${metadata.cardSelectorAlias}成员卡`
            : metadata.memberOnly
              ? '请选择要加入手牌的成员卡'
              : '请选择要加入手牌的卡牌',
    confirmSelectionLabel:
      metadata.cardSelectorAlias === 'Aqours' && metadata.memberOnly
        ? '公开并加入手牌'
        : '加入手牌',
    skipSelectionLabel:
      metadata.cardSelectorAlias === 'Aqours' && metadata.memberOnly
        ? '全部放置入休息室'
        : '不加入',
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
  if (metadata.redGreenBlueHeartMemberOnly) {
    return and(
      typeIs(CardType.MEMBER),
      or(
        memberHasHeartColor(HeartColor.RED),
        memberHasHeartColor(HeartColor.GREEN),
        memberHasHeartColor(HeartColor.BLUE)
      )
    );
  }
  if (metadata.blueOrPurpleHeartMemberOnly) {
    return and(
      typeIs(CardType.MEMBER),
      or(memberHasHeartColor(HeartColor.BLUE), memberHasHeartColor(HeartColor.PURPLE))
    );
  }
  if (metadata.printedHeartCountColor) {
    return or(
      memberHasPrintedHeartColorAtLeast(metadata.printedHeartCountColor, 2),
      liveRequiresPrintedHeartColorAtLeast(metadata.printedHeartCountColor, 2)
    );
  }
  if (metadata.cardSelectorAlias && metadata.cardSelectorKind === 'GROUP') {
    return metadata.memberOnly
      ? and(typeIs(CardType.MEMBER), groupAliasIs(metadata.cardSelectorAlias))
      : groupAliasIs(metadata.cardSelectorAlias);
  }
  if (metadata.cardSelectorAlias && metadata.cardSelectorKind === 'UNIT') {
    return metadata.memberOnly
      ? and(typeIs(CardType.MEMBER), unitAliasIs(metadata.cardSelectorAlias))
      : unitAliasIs(metadata.cardSelectorAlias);
  }
  if (metadata.memberOnly) {
    return (card) => isMemberCardData(card.data);
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
    redGreenBlueHeartMemberOnly: metadata?.redGreenBlueHeartMemberOnly === true,
    blueOrPurpleHeartMemberOnly: metadata?.blueOrPurpleHeartMemberOnly === true,
    printedHeartCountColor: getHeartColorFromMetadata(metadata?.printedHeartCountColor),
    printedHeartCountLabel:
      typeof metadata?.printedHeartCountLabel === 'string'
        ? metadata.printedHeartCountLabel
        : undefined,
    maxSelectCount: getDiscardLookTopMaxSelectCountFromMetadata(metadata?.maxSelectCount),
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

function getHeartColorFromMetadata(value: unknown): HeartColor | undefined {
  return Object.values(HeartColor).includes(value as HeartColor) ? (value as HeartColor) : undefined;
}

function getDiscardLookTopMaxSelectCount(cardCode: string | undefined): number {
  return isSBp2005RedGreenBlueHeartMemberCard(cardCode) ? 3 : 1;
}

function getDiscardLookTopMaxSelectCountFromMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
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
  if (isSBp2005RedGreenBlueHeartMemberCard(cardCode)) {
    return 7;
  }
  if (isPlBp5014BlueOrPurpleHeartMemberCard(cardCode)) {
    return 4;
  }
  if (getDiscardLookTopPrintedHeartCountCardConfig(cardCode)) {
    return 4;
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
  if (isSBp2005RedGreenBlueHeartMemberCard(cardCode)) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的7张卡。可以将至多3张其中的持有[赤ハート]或[緑ハート]或[青ハート]的成员卡公开并加入手牌。其余的卡片放置入休息室。';
  }
  if (isPlBp5014BlueOrPurpleHeartMemberCard(cardCode)) {
    return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的4张卡。可以将1张其中持有[青ハート]或[紫ハート]的成员卡公开并加入手牌。其余的卡片放置入休息室。';
  }
  const printedHeartCountConfig = getDiscardLookTopPrintedHeartCountCardConfig(cardCode);
  if (printedHeartCountConfig) {
    return `【登场】可以将1张手牌放置入休息室：检视自己卡组顶的4张卡。可以将1张其中的持有2个以上${printedHeartCountConfig.heartLabel}的成员卡，或必要Heart包含2个以上${printedHeartCountConfig.heartLabel}的LIVE卡公开并加入手牌。其余的卡片放置入休息室。`;
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
    if (aliasCardConfig.effectTextAbilityId) {
      return getAbilityEffectText(aliasCardConfig.effectTextAbilityId);
    }
    const topCount = getDiscardLookTopCount(cardCode);
    if (aliasCardConfig.memberOnly === true) {
      if (cardCodeMatchesBase(cardCode, 'PL!S-bp3-009')) {
        return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的6张卡。可以将1张其中的『Aqours』的成员卡公开并加入手牌。其余的卡片放置入休息室。';
      }
      return `【登场】可以将1张手牌放置入休息室：检视自己卡组顶的${topCount}张卡。可以将1张其中的『${aliasCardConfig.alias}』成员卡公开并加入手牌。其余的卡片放置入休息室。`;
    }
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

function isSBp2005RedGreenBlueHeartMemberCard(cardCode: string | undefined): boolean {
  return (
    cardCode !== undefined &&
    cardCodeMatchesBase(cardCode, S_BP2_005_RED_GREEN_BLUE_HEART_MEMBER_BASE_CARD_CODE)
  );
}

function isPlBp5014BlueOrPurpleHeartMemberCard(cardCode: string | undefined): boolean {
  return (
    cardCode !== undefined &&
    cardCodeMatchesBase(cardCode, PL_BP5_014_BLUE_OR_PURPLE_HEART_MEMBER_BASE_CARD_CODE)
  );
}

function getDiscardLookTopPrintedHeartCountCardConfig(
  cardCode: string | undefined
): (typeof DISCARD_LOOK_TOP_PRINTED_HEART_COUNT_CARD_CONFIGS)[number] | undefined {
  if (!cardCode) {
    return undefined;
  }
  return DISCARD_LOOK_TOP_PRINTED_HEART_COUNT_CARD_CONFIGS.find(({ baseCardCode }) =>
    cardCodeMatchesBase(cardCode, baseCardCode)
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

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}
