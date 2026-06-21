import { HeartColor, SlotPosition } from '../../shared/types/enums.js';
import { isLiveCardData, isMemberCardData, type HeartIcon } from '../entities/card.js';
import type {
  GameState,
  LiveModifierState,
  LiveRequirementModifierState,
  LiveResolutionState,
} from '../entities/game.js';
import { getCardById } from '../entities/game.js';
import { getAllMemberCardIds } from '../entities/zone.js';
import { getBaseCardCode, normalizeCardCode } from '../../shared/utils/card-code.js';
import { cardBelongsToGroup } from '../../shared/utils/card-identity.js';
import { toPlayerLocalSlotForControllerPerspective } from '../../shared/utils/slot-perspective.js';
import { hasMemberPositionMovedThisTurn } from './member-turn-state.js';
import { successLiveScoreAtLeast } from './success-live-score.js';

type ScoreModifierState = Extract<LiveModifierState, { readonly kind: 'SCORE' }>;
type HeartModifierState = Extract<LiveModifierState, { readonly kind: 'HEART' }>;
type BladeModifierState = Extract<LiveModifierState, { readonly kind: 'BLADE' }>;
type RequirementModifierState = Extract<LiveModifierState, { readonly kind: 'REQUIREMENT' }>;

type LiveModifierCompatibilityProjection = Pick<
  LiveResolutionState,
  | 'playerScoreBonuses'
  | 'playerHeartBonuses'
  | 'liveRequirementReductions'
  | 'liveRequirementModifiers'
>;

export interface LiveModifierMatch {
  readonly kind?: LiveModifierState['kind'];
  readonly playerId?: string;
  readonly liveCardId?: string;
  readonly sourceCardId?: string;
  readonly targetMemberCardId?: string;
  readonly abilityId?: string;
}

interface ContinuousLiveModifierContext {
  readonly game: GameState;
  readonly playerId: string;
  readonly sourceCardId: string;
  readonly successLiveCount: number;
}

interface ContinuousLiveModifierDefinition {
  readonly cardCodes?: readonly string[];
  readonly baseCardCodes?: readonly string[];
  readonly collect: (context: ContinuousLiveModifierContext) => readonly LiveModifierState[];
}

interface SuccessZoneContinuousLiveModifierDefinition extends ContinuousLiveModifierDefinition {
  readonly nonStackingAbilityId?: string;
}

export interface HeartLiveModifierForMemberOptions {
  readonly playerId: string;
  readonly memberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
  readonly hearts: readonly HeartIcon[];
}

export interface AddHeartLiveModifierForMemberResult {
  readonly gameState: GameState;
  readonly modifier: HeartModifierState;
  readonly heartBonus: readonly HeartIcon[];
}

const CONTINUOUS_LIVE_MODIFIER_DEFINITIONS: readonly ContinuousLiveModifierDefinition[] = [
  {
    baseCardCodes: ['PL!-sd1-001'],
    collect: ({ playerId, sourceCardId, successLiveCount }) =>
      successLiveCount > 0
        ? [
            {
              kind: 'BLADE',
              playerId,
              countDelta: successLiveCount,
              sourceCardId,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!-bp5-008'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!successLiveScoreAtLeast(game, playerId, 6)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: BP5_008_CONTINUOUS_SUCCESS_SCORE_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 2 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!-bp4-002'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!hasLiveWithoutLiveStartOrSuccessAbility(game, playerId)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: BP4_002_CONTINUOUS_LIVE_WITHOUT_TIMING_PURPLE_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.PURPLE, count: 2 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!-bp5-003'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!hasAtLeastDifferentNamedStageMembers(game, playerId, 3)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: BP5_003_CONTINUOUS_THREE_DIFFERENT_NAMES_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!SP-bp5-012'],
    collect: ({ game, playerId, sourceCardId }) => {
      if (!hasLiellaLiveWithRequirementTotalAtLeast(game, playerId, 8)) {
        return [];
      }
      const modifier = createHeartLiveModifierForMember(game, {
        playerId,
        memberCardId: sourceCardId,
        sourceCardId,
        abilityId: SP_BP5_012_CONTINUOUS_LIELLA_LIVE_REQUIREMENT_EIGHT_YELLOW_HEART_ABILITY_ID,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      });
      return modifier ? [modifier] : [];
    },
  },
  {
    baseCardCodes: ['PL!HS-bp1-003'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasThreeDifferentHasunosoraMembersOnStage(game, playerId)
        ? [
            {
              kind: 'SCORE',
              playerId,
              countDelta: 1,
              sourceCardId,
              abilityId: HS_BP1_003_CONTINUOUS_SCORE_ABILITY_ID,
            },
          ]
        : [],
  },
  {
    baseCardCodes: ['PL!HS-pb1-014'],
    collect: ({ game, playerId, sourceCardId }) =>
      collectPb1014FrontHighCostHeartModifier(game, playerId, sourceCardId),
  },
  {
    baseCardCodes: ['PL!N-pb1-004'],
    collect: ({ game, playerId, sourceCardId }) =>
      hasMemberPositionMovedThisTurn(game, playerId, sourceCardId)
        ? []
        : [
            {
              kind: 'BLADE',
              playerId,
              countDelta: 2,
              sourceCardId,
              abilityId: KARIN_CONTINUOUS_NOT_MOVED_BLADE_ABILITY_ID,
            },
          ],
  },
];

const SUCCESS_ZONE_CONTINUOUS_LIVE_MODIFIER_DEFINITIONS: readonly SuccessZoneContinuousLiveModifierDefinition[] =
  [
    {
      baseCardCodes: ['PL!-bp6-022'],
      nonStackingAbilityId: 'PL!-bp6-022:continuous-success-zone-muse-live-requirement',
      collect: ({ game, playerId, sourceCardId }) =>
        collectDreaminGoGoRequirementModifiers(game, playerId, sourceCardId),
    },
  ];

const MEMBER_SLOT_ORDER: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];
const HS_BP1_003_CONTINUOUS_SCORE_ABILITY_ID =
  'PL!HS-bp1-003-SEC:continuous-three-different-hasunosora-score';
const BP5_008_CONTINUOUS_SUCCESS_SCORE_YELLOW_HEART_ABILITY_ID =
  'PL!-bp5-008:continuous-success-score-yellow-heart';
const BP4_002_CONTINUOUS_LIVE_WITHOUT_TIMING_PURPLE_HEART_ABILITY_ID =
  'PL!-bp4-002:continuous-live-without-timing-purple-heart';
const BP5_003_CONTINUOUS_THREE_DIFFERENT_NAMES_YELLOW_HEART_ABILITY_ID =
  'PL!-bp5-003:continuous-three-different-names-yellow-heart';
const SP_BP5_012_CONTINUOUS_LIELLA_LIVE_REQUIREMENT_EIGHT_YELLOW_HEART_ABILITY_ID =
  'PL!SP-bp5-012:continuous-liella-live-requirement-eight-yellow-heart';
const BP6_022_CONTINUOUS_SUCCESS_ZONE_MUSE_LIVE_REQUIREMENT_ABILITY_ID =
  'PL!-bp6-022:continuous-success-zone-muse-live-requirement';
const KARIN_CONTINUOUS_NOT_MOVED_BLADE_ABILITY_ID =
  'PL!N-pb1-004:continuous-not-position-moved-gain-two-blade';
const HS_PB1_014_CONTINUOUS_FRONT_HIGH_COST_PINK_HEART_ABILITY_ID =
  'PL!HS-pb1-014-R:continuous-front-high-cost-pink-heart';

function getScoreModifiers(
  playerId: string,
  liveModifiers: readonly LiveModifierState[]
): ScoreModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is ScoreModifierState =>
      modifier.kind === 'SCORE' && modifier.playerId === playerId
  );
}

function getHeartModifiers(
  playerId: string,
  liveModifiers: readonly LiveModifierState[]
): HeartModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is HeartModifierState =>
      modifier.kind === 'HEART' &&
      getHeartModifierTarget(modifier) === 'PLAYER' &&
      modifier.playerId === playerId
  );
}

function getBladeModifiers(
  playerId: string,
  liveModifiers: readonly LiveModifierState[]
): BladeModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is BladeModifierState =>
      modifier.kind === 'BLADE' && modifier.playerId === playerId
  );
}

function getRequirementModifiers(
  liveCardId: string,
  liveModifiers: readonly LiveModifierState[]
): RequirementModifierState[] {
  return liveModifiers.filter(
    (modifier): modifier is RequirementModifierState =>
      modifier.kind === 'REQUIREMENT' && modifier.liveCardId === liveCardId
  );
}

export function collectLiveModifiers(game: GameState): readonly LiveModifierState[] {
  return [...game.liveResolution.liveModifiers, ...collectContinuousLiveModifiers(game)];
}

function collectContinuousLiveModifiers(game: GameState): readonly LiveModifierState[] {
  const modifiers: LiveModifierState[] = [];

  for (const player of game.players) {
    const successLiveCount = player.successZone.cardIds.length;

    for (const cardId of getAllMemberCardIds(player.memberSlots)) {
      const card = getCardById(game, cardId);
      if (!card) {
        continue;
      }

      for (const definition of CONTINUOUS_LIVE_MODIFIER_DEFINITIONS) {
        if (!doesContinuousDefinitionMatchCardCode(definition, card.data.cardCode)) {
          continue;
        }

        modifiers.push(
          ...definition.collect({
            game,
            playerId: player.id,
            sourceCardId: cardId,
            successLiveCount,
          })
        );
      }
    }

    const appliedNonStackingAbilityIds = new Set<string>();
    for (const cardId of player.successZone.cardIds) {
      const card = getCardById(game, cardId);
      if (!card || !isLiveCardData(card.data)) {
        continue;
      }

      for (const definition of SUCCESS_ZONE_CONTINUOUS_LIVE_MODIFIER_DEFINITIONS) {
        if (!doesContinuousDefinitionMatchCardCode(definition, card.data.cardCode)) {
          continue;
        }
        if (
          definition.nonStackingAbilityId !== undefined &&
          appliedNonStackingAbilityIds.has(definition.nonStackingAbilityId)
        ) {
          continue;
        }

        modifiers.push(
          ...definition.collect({
            game,
            playerId: player.id,
            sourceCardId: cardId,
            successLiveCount,
          })
        );

        if (definition.nonStackingAbilityId !== undefined) {
          appliedNonStackingAbilityIds.add(definition.nonStackingAbilityId);
        }
      }
    }
  }

  return modifiers;
}

function collectDreaminGoGoRequirementModifiers(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return [];
  }

  return player.liveZone.cardIds.flatMap((liveCardId) => {
    const card = getCardById(game, liveCardId);
    if (
      !card ||
      !isLiveCardData(card.data) ||
      card.data.score < 5 ||
      !cardBelongsToGroup(card.data, "μ's")
    ) {
      return [];
    }

    return [
      {
        kind: 'REQUIREMENT' as const,
        liveCardId,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
        sourceCardId,
        abilityId: BP6_022_CONTINUOUS_SUCCESS_ZONE_MUSE_LIVE_REQUIREMENT_ABILITY_ID,
      },
    ];
  });
}

function hasLiveWithoutLiveStartOrSuccessAbility(game: GameState, playerId: string): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  return player.liveZone.cardIds.some((liveCardId) => {
    const card = getCardById(game, liveCardId);
    return (
      card !== null &&
      isLiveCardData(card.data) &&
      !liveHasLiveStartOrSuccessAbility(card.data.cardText)
    );
  });
}

function hasLiellaLiveWithRequirementTotalAtLeast(
  game: GameState,
  playerId: string,
  minRequirementTotal: number
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  return player.liveZone.cardIds.some((liveCardId) => {
    const card = getCardById(game, liveCardId);
    return (
      card !== null &&
      isLiveCardData(card.data) &&
      cardBelongsToGroup(card.data, 'Liella!') &&
      card.data.requirements.totalRequired >= minRequirementTotal
    );
  });
}

function liveHasLiveStartOrSuccessAbility(cardText: string | undefined): boolean {
  if (!cardText) {
    return false;
  }

  return (
    cardText.includes('【LIVE开始时】') ||
    cardText.includes('【LIVE開始時】') ||
    cardText.includes('【LIVE成功时】') ||
    cardText.includes('【LIVE成功時】') ||
    cardText.includes('{{live_start.png|ライブ開始時}}') ||
    cardText.includes('{{live_success.png|ライブ成功時}}') ||
    cardText.includes('ライブ開始時') ||
    cardText.includes('ライブ成功時')
  );
}

function doesContinuousDefinitionMatchCardCode(
  definition: ContinuousLiveModifierDefinition,
  cardCode: string
): boolean {
  const normalizedCardCode = normalizeCardCode(cardCode);
  const baseCardCode = getBaseCardCode(normalizedCardCode);
  return (
    definition.cardCodes?.map(normalizeCardCode).includes(normalizedCardCode) === true ||
    definition.baseCardCodes?.map(normalizeCardCode).includes(baseCardCode) === true
  );
}

function hasThreeDifferentHasunosoraMembersOnStage(game: GameState, playerId: string): boolean {
  return hasAtLeastDifferentNamedStageMembers(game, playerId, 3, isHasunosoraMemberCard);
}

function collectPb1014FrontHighCostHeartModifier(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly LiveModifierState[] {
  const player = game.players.find((candidate) => candidate.id === playerId);
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  if (!player || !opponent) {
    return [];
  }

  const sourceSlot = MEMBER_SLOT_ORDER.find(
    (slot) => player.memberSlots.slots[slot] === sourceCardId
  );
  if (!sourceSlot) {
    return [];
  }

  const sourceCard = getCardById(game, sourceCardId);
  const opponentSlot = toPlayerLocalSlotForControllerPerspective(sourceSlot, playerId, opponent.id);
  const opponentCardId = opponent.memberSlots.slots[opponentSlot];
  const opponentCard = opponentCardId ? getCardById(game, opponentCardId) : null;
  if (
    !sourceCard ||
    !opponentCard ||
    !isMemberCardData(sourceCard.data) ||
    !isMemberCardData(opponentCard.data) ||
    opponentCard.data.cost <= sourceCard.data.cost
  ) {
    return [];
  }

  const modifier = createHeartLiveModifierForMember(game, {
    playerId,
    memberCardId: sourceCardId,
    sourceCardId,
    abilityId: HS_PB1_014_CONTINUOUS_FRONT_HIGH_COST_PINK_HEART_ABILITY_ID,
    hearts: [{ color: HeartColor.PINK, count: 1 }],
  });
  return modifier ? [modifier] : [];
}

function hasAtLeastDifferentNamedStageMembers(
  game: GameState,
  playerId: string,
  minCount: number,
  predicate: (card: NonNullable<ReturnType<typeof getCardById>>) => boolean = isMemberCard
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  const names = MEMBER_SLOT_ORDER.map((slot) => player.memberSlots.slots[slot])
    .map((cardId) => (cardId ? getCardById(game, cardId) : null))
    .filter(
      (card): card is NonNullable<ReturnType<typeof getCardById>> =>
        card !== null && isMemberCard(card) && predicate(card)
    )
    .map((card) => normalizeContinuousMemberName(card.data.name));

  return new Set(names).size >= minCount;
}

function isMemberCard(card: NonNullable<ReturnType<typeof getCardById>>): boolean {
  return isMemberCardData(card.data);
}

function isHasunosoraMemberCard(card: NonNullable<ReturnType<typeof getCardById>>): boolean {
  return isMemberCardData(card.data) && cardBelongsToGroup(card.data, '蓮ノ空');
}

function normalizeContinuousMemberName(name: string): string {
  return name.replace(/[\s　・･·]/g, '');
}

export function addLiveModifier(game: GameState, modifier: LiveModifierState): GameState {
  return setLiveModifiers(game, [...game.liveResolution.liveModifiers, modifier]);
}

export function createHeartLiveModifierForMember(
  game: GameState,
  options: HeartLiveModifierForMemberOptions
): HeartModifierState | null {
  const memberCard = getCardById(game, options.memberCardId);
  if (
    !memberCard ||
    memberCard.ownerId !== options.playerId ||
    !isMemberCardData(memberCard.data) ||
    options.hearts.length === 0 ||
    options.hearts.some((heart) => !(heart.count > 0))
  ) {
    return null;
  }

  const baseModifier = {
    kind: 'HEART' as const,
    playerId: options.playerId,
    hearts: options.hearts,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };

  return options.memberCardId === options.sourceCardId
    ? {
        ...baseModifier,
        target: 'SOURCE_MEMBER',
      }
    : {
        ...baseModifier,
        target: 'TARGET_MEMBER',
        targetMemberCardId: options.memberCardId,
      };
}

export function addHeartLiveModifierForMember(
  game: GameState,
  options: HeartLiveModifierForMemberOptions
): AddHeartLiveModifierForMemberResult | null {
  const modifier = createHeartLiveModifierForMember(game, options);
  if (!modifier) {
    return null;
  }

  return {
    gameState: addLiveModifier(game, modifier),
    modifier,
    heartBonus: options.hearts,
  };
}

export function replaceLiveModifier(
  game: GameState,
  match: LiveModifierMatch,
  replacement: LiveModifierState | null
): GameState {
  const liveModifiers = game.liveResolution.liveModifiers.filter(
    (modifier) => !matchesLiveModifier(modifier, match)
  );
  return setLiveModifiers(
    game,
    replacement === null ? liveModifiers : [...liveModifiers, replacement]
  );
}

function setLiveModifiers(game: GameState, liveModifiers: readonly LiveModifierState[]): GameState {
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      ...projectLiveModifierCompatibility(liveModifiers),
      liveModifiers,
    },
  };
}

export function projectLiveModifierCompatibility(
  liveModifiers: readonly LiveModifierState[]
): LiveModifierCompatibilityProjection {
  const playerScoreBonuses = new Map<string, number>();
  const playerHeartBonuses = new Map<string, HeartIcon[]>();
  const liveRequirementReductions = new Map<string, number>();
  const liveRequirementModifiers = new Map<string, LiveRequirementModifierState[]>();

  for (const modifier of liveModifiers) {
    if (modifier.kind === 'SCORE') {
      playerScoreBonuses.set(
        modifier.playerId,
        (playerScoreBonuses.get(modifier.playerId) ?? 0) + modifier.countDelta
      );
      continue;
    }

    if (modifier.kind === 'HEART' && getHeartModifierTarget(modifier) === 'PLAYER') {
      playerHeartBonuses.set(modifier.playerId, [
        ...(playerHeartBonuses.get(modifier.playerId) ?? []),
        ...modifier.hearts,
      ]);
      continue;
    }

    if (modifier.kind === 'REQUIREMENT') {
      liveRequirementModifiers.set(modifier.liveCardId, [
        ...(liveRequirementModifiers.get(modifier.liveCardId) ?? []),
        ...modifier.modifiers,
      ]);

      const genericReduction = modifier.modifiers
        .filter(
          (requirementModifier) =>
            requirementModifier.color === HeartColor.RAINBOW && requirementModifier.countDelta < 0
        )
        .reduce((total, requirementModifier) => total - requirementModifier.countDelta, 0);
      if (genericReduction > 0) {
        liveRequirementReductions.set(
          modifier.liveCardId,
          (liveRequirementReductions.get(modifier.liveCardId) ?? 0) + genericReduction
        );
      }
    }
  }

  return {
    playerScoreBonuses,
    playerHeartBonuses,
    liveRequirementReductions,
    liveRequirementModifiers,
  };
}

function matchesLiveModifier(modifier: LiveModifierState, match: LiveModifierMatch): boolean {
  if (match.kind !== undefined && modifier.kind !== match.kind) {
    return false;
  }

  if (match.playerId !== undefined) {
    if (!('playerId' in modifier) || modifier.playerId !== match.playerId) {
      return false;
    }
  }

  if (match.liveCardId !== undefined) {
    if (!('liveCardId' in modifier) || modifier.liveCardId !== match.liveCardId) {
      return false;
    }
  }

  if (match.sourceCardId !== undefined && modifier.sourceCardId !== match.sourceCardId) {
    return false;
  }

  if (match.targetMemberCardId !== undefined) {
    if (
      !('targetMemberCardId' in modifier) ||
      modifier.targetMemberCardId !== match.targetMemberCardId
    ) {
      return false;
    }
  }

  if (match.abilityId !== undefined && modifier.abilityId !== match.abilityId) {
    return false;
  }

  return true;
}

export function getPlayerLiveScoreModifier(
  liveResolution: LiveResolutionState,
  playerId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): number {
  const modifiers = getScoreModifiers(playerId, liveModifiers);
  if (modifiers.length > 0) {
    return modifiers
      .filter((modifier) => modifier.liveCardId === undefined)
      .reduce((total, modifier) => total + modifier.countDelta, 0);
  }
  return liveResolution.playerScoreBonuses.get(playerId) ?? 0;
}

export function getLiveCardScoreModifier(
  liveResolution: LiveResolutionState,
  liveCardId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): number {
  return liveModifiers
    .filter(
      (modifier): modifier is ScoreModifierState =>
        modifier.kind === 'SCORE' && modifier.liveCardId === liveCardId
    )
    .reduce((total, modifier) => total + modifier.countDelta, 0);
}

export function getPlayerLiveHeartModifiers(
  liveResolution: LiveResolutionState,
  playerId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): readonly HeartIcon[] {
  const modifiers = getHeartModifiers(playerId, liveModifiers);
  if (modifiers.length > 0) {
    return modifiers.flatMap((modifier) => modifier.hearts);
  }
  return liveResolution.playerHeartBonuses.get(playerId) ?? [];
}

export function getPlayerLiveBladeModifier(
  liveResolution: LiveResolutionState,
  playerId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): number {
  return getBladeModifiers(playerId, liveModifiers).reduce(
    (total, modifier) => total + modifier.countDelta,
    0
  );
}

export function getMemberEffectiveBladeCount(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  liveModifiers: readonly LiveModifierState[] = collectLiveModifiers(game)
): number {
  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard || !isMemberCardData(sourceCard.data)) {
    return 0;
  }

  const modifierBladeCount = getBladeModifiers(playerId, liveModifiers)
    .filter((modifier) => modifier.sourceCardId === sourceCardId)
    .reduce((total, modifier) => total + modifier.countDelta, 0);

  return Math.max(0, sourceCard.data.blade + modifierBladeCount);
}

export function getMemberEffectiveHeartIcons(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  liveModifiers: readonly LiveModifierState[] = collectLiveModifiers(game)
): readonly HeartIcon[] {
  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard || !isMemberCardData(sourceCard.data)) {
    return [];
  }

  const modifierHearts = liveModifiers
    .filter(
      (modifier): modifier is HeartModifierState =>
        modifier.kind === 'HEART' &&
        modifier.playerId === playerId &&
        ((getHeartModifierTarget(modifier) === 'SOURCE_MEMBER' &&
          modifier.sourceCardId === sourceCardId) ||
          (getHeartModifierTarget(modifier) === 'TARGET_MEMBER' &&
            getHeartModifierTargetMemberCardId(modifier) === sourceCardId))
    )
    .flatMap((modifier) => modifier.hearts);

  return [...sourceCard.data.hearts, ...modifierHearts];
}

function getHeartModifierTarget(modifier: HeartModifierState): HeartModifierState['target'] {
  return (
    (modifier as { readonly target?: HeartModifierState['target'] }).target ?? 'PLAYER'
  );
}

function getHeartModifierTargetMemberCardId(modifier: HeartModifierState): string | undefined {
  return (modifier as { readonly targetMemberCardId?: string }).targetMemberCardId;
}

export function getLiveCardRequirementModifiers(
  liveResolution: LiveResolutionState,
  liveCardId: string,
  liveModifiers: readonly LiveModifierState[] = liveResolution.liveModifiers
): readonly LiveRequirementModifierState[] {
  const modifiers = getRequirementModifiers(liveCardId, liveModifiers);
  if (modifiers.length > 0) {
    return modifiers.flatMap((modifier) => modifier.modifiers);
  }

  const legacyModifiers = liveResolution.liveRequirementModifiers.get(liveCardId) ?? [];
  if (legacyModifiers.length > 0) {
    return legacyModifiers;
  }

  const legacyReduction = liveResolution.liveRequirementReductions.get(liveCardId) ?? 0;
  return legacyReduction > 0 ? [{ color: HeartColor.RAINBOW, countDelta: -legacyReduction }] : [];
}
