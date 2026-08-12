import type { DeckConfig } from '../../application/game-service.js';
import type {
  AnyCardData,
  BladeHeartItem,
  HeartIcon,
  HeartRequirement,
} from '../../domain/entities/card.js';
import { CardType } from '../../shared/types/enums.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import type { AiBattlePhaseZeroDeckKey } from './phase-zero-baseline.js';

export const AI_DECK_KNOWLEDGE_SCHEMA_VERSION = AI_BATTLE_PROTOCOL_VERSIONS.knowledge.deckKnowledge;

export interface AiDeckCardKnowledge {
  readonly cardCode: string;
  readonly name: string;
  readonly nameJp?: string;
  readonly cardType: CardType;
  readonly count: number;
  readonly deckSection: 'MAIN_DECK' | 'ENERGY_DECK';
  readonly works: readonly string[];
  readonly groups: readonly string[];
  readonly unit?: string;
  readonly effectText: string;
  readonly cost?: number;
  readonly blade?: number;
  readonly hearts?: readonly {
    readonly color: string;
    readonly count: number;
  }[];
  readonly score?: number;
  readonly requiredHearts?: {
    readonly colors: Readonly<Record<string, number>>;
    readonly total: number;
  };
  readonly bladeHearts?: readonly {
    readonly effect: string;
    readonly heartColor?: string;
  }[];
}

export interface AiDeckKnowledge {
  readonly schemaVersion: typeof AI_DECK_KNOWLEDGE_SCHEMA_VERSION;
  readonly deckKey: AiBattlePhaseZeroDeckKey;
  readonly contentHash: string;
  readonly mainDeckCount: number;
  readonly energyDeckCount: number;
  /**
   * One entry per card code and deck section. Duplicate copies are collapsed
   * into count, so the model learns exact composition without deck order.
   */
  readonly cards: readonly AiDeckCardKnowledge[];
}

export function buildAiDeckKnowledge(input: {
  readonly deckKey: AiBattlePhaseZeroDeckKey;
  readonly contentHash: string;
  readonly deck: DeckConfig;
}): AiDeckKnowledge {
  return {
    schemaVersion: AI_DECK_KNOWLEDGE_SCHEMA_VERSION,
    deckKey: input.deckKey,
    contentHash: input.contentHash,
    mainDeckCount: input.deck.mainDeck.length,
    energyDeckCount: input.deck.energyDeck.length,
    cards: [
      ...collapseDeckSection(input.deck.mainDeck, 'MAIN_DECK'),
      ...collapseDeckSection(input.deck.energyDeck, 'ENERGY_DECK'),
    ],
  };
}

function collapseDeckSection(
  cards: readonly AnyCardData[],
  deckSection: AiDeckCardKnowledge['deckSection']
): readonly AiDeckCardKnowledge[] {
  const grouped = new Map<string, { readonly card: AnyCardData; count: number }>();
  for (const card of cards) {
    const current = grouped.get(card.cardCode);
    if (current) {
      current.count += 1;
    } else {
      grouped.set(card.cardCode, { card, count: 1 });
    }
  }
  return [...grouped.values()]
    .sort((left, right) => left.card.cardCode.localeCompare(right.card.cardCode))
    .map(({ card, count }) => toDeckCardKnowledge(card, count, deckSection));
}

function toDeckCardKnowledge(
  card: AnyCardData,
  count: number,
  deckSection: AiDeckCardKnowledge['deckSection']
): AiDeckCardKnowledge {
  const common = {
    cardCode: card.cardCode,
    name: card.nameCn || card.name,
    ...(card.nameJp ? { nameJp: card.nameJp } : {}),
    cardType: card.cardType,
    count,
    deckSection,
    works: [...(card.workNames ?? [])],
    groups: [...(card.groupNames ?? [])],
    ...(card.unitName || card.unitNameRaw ? { unit: card.unitName || card.unitNameRaw } : {}),
    effectText: card.cardTextCn || card.cardTextJp || card.cardText || '-',
  } as const;

  switch (card.cardType) {
    case CardType.MEMBER:
      return {
        ...common,
        cost: card.cost,
        blade: card.blade,
        hearts: cloneHearts(card.hearts),
        ...(card.bladeHearts ? { bladeHearts: cloneBladeHearts(card.bladeHearts) } : {}),
      };
    case CardType.LIVE:
      return {
        ...common,
        score: card.score,
        requiredHearts: cloneHeartRequirement(card.requirements),
        ...(card.bladeHearts ? { bladeHearts: cloneBladeHearts(card.bladeHearts) } : {}),
      };
    case CardType.ENERGY:
      return common;
  }
}

function cloneHearts(hearts: readonly HeartIcon[]) {
  return hearts.map((heart) => ({ color: String(heart.color), count: heart.count }));
}

function cloneBladeHearts(bladeHearts: readonly BladeHeartItem[]) {
  return bladeHearts.map((item) => ({
    effect: String(item.effect),
    ...(item.heartColor ? { heartColor: String(item.heartColor) } : {}),
  }));
}

function cloneHeartRequirement(requirements: HeartRequirement) {
  return {
    colors: Object.fromEntries(
      [...requirements.colorRequirements.entries()]
        .sort(([left], [right]) => String(left).localeCompare(String(right)))
        .map(([color, count]) => [String(color), count])
    ),
    total: requirements.totalRequired,
  };
}
