import { HeartColor, SlotPosition } from '../../shared/types/enums.js';
import { isMemberCardData, type HeartIcon } from '../entities/card.js';
import type {
  GameState,
  LiveModifierState,
  LiveRequirementModifierState,
  LiveResolutionState,
} from '../entities/game.js';
import { getCardById } from '../entities/game.js';
import { getAllMemberCardIds } from '../entities/zone.js';
import { getBaseCardCode, normalizeCardCode } from '../../shared/utils/card-code.js';

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

const MEMBER_SLOT_ORDER: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];
const HS_BP1_003_CONTINUOUS_SCORE_ABILITY_ID =
  'PL!HS-bp1-003-SEC:continuous-three-different-hasunosora-score';
const KARIN_CONTINUOUS_NOT_MOVED_BLADE_ABILITY_ID =
  'PL!N-pb1-004:continuous-not-position-moved-gain-two-blade';

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
      modifier.kind === 'HEART' && modifier.playerId === playerId
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
  }

  return modifiers;
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
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return false;
  }

  const stagedCards = MEMBER_SLOT_ORDER.map((slot) => player.memberSlots.slots[slot]).map(
    (cardId) => (cardId ? getCardById(game, cardId) : null)
  );
  if (stagedCards.some((card) => card === null)) {
    return false;
  }

  const memberCards = stagedCards.filter(
    (card): card is NonNullable<(typeof stagedCards)[number]> =>
      card !== null && isHasunosoraMemberCard(card)
  );
  if (memberCards.length !== MEMBER_SLOT_ORDER.length) {
    return false;
  }

  return new Set(memberCards.map((card) => normalizeContinuousMemberName(card.data.name))).size ===
    MEMBER_SLOT_ORDER.length;
}

function isHasunosoraMemberCard(card: NonNullable<ReturnType<typeof getCardById>>): boolean {
  if (!isMemberCardData(card.data)) {
    return false;
  }

  const groupName = card.data.groupName?.trim();
  return (
    groupName === '莲之空' ||
    groupName === '蓮ノ空' ||
    normalizeCardCode(card.data.cardCode).startsWith('PL!HS-')
  );
}

function normalizeContinuousMemberName(name: string): string {
  return name.replace(/[\s　・･·]/g, '');
}

function hasMemberPositionMovedThisTurn(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return player?.positionMovedThisTurn.includes(sourceCardId) === true;
}

export function addLiveModifier(game: GameState, modifier: LiveModifierState): GameState {
  return setLiveModifiers(game, [...game.liveResolution.liveModifiers, modifier]);
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

    if (modifier.kind === 'HEART') {
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
