import type { PoolClient } from 'pg';
import { getBaseCardCode } from '../../shared/utils/card-code.js';
import type {
  DeckArchetypeRuleConditions,
  DeckCardInput,
  DeckCardType,
} from './deck-classifier-engine.js';

interface CardCatalogRow {
  readonly card_code: string;
  readonly card_type: DeckCardType;
}

export type DeckClassifierCardCatalog = ReadonlyMap<string, DeckCardType>;

export async function loadDeckClassifierCardCatalog(
  client: Pick<PoolClient, 'query'>
): Promise<DeckClassifierCardCatalog> {
  const result = await client.query<CardCatalogRow>(
    `SELECT card_code, card_type
       FROM cards
      WHERE card_type IN ('MEMBER', 'LIVE')
      ORDER BY card_code`
  );
  return buildDeckClassifierCardCatalog(result.rows);
}

export function buildDeckClassifierCardCatalog(
  rows: readonly CardCatalogRow[]
): DeckClassifierCardCatalog {
  const catalog = new Map<string, DeckCardType>();
  for (const row of rows) {
    const baseCardCode = getBaseCardCode(row.card_code.trim());
    const priorType = catalog.get(baseCardCode);
    if (priorType && priorType !== row.card_type) {
      throw new Error(
        `卡牌目录中的基础编号 ${baseCardCode} 同时存在 ${priorType} 与 ${row.card_type} 类型`
      );
    }
    catalog.set(baseCardCode, row.card_type);
  }
  return catalog;
}

export function assertTemplateCardsInCatalog(
  cards: readonly DeckCardInput[],
  catalog: DeckClassifierCardCatalog,
  label: string
): void {
  for (const card of cards) {
    const baseCardCode = readBaseCardCode(card, label);
    assertCardReference(catalog, baseCardCode, card.cardType, label);
  }
}

export function assertRuleConditionsInCatalog(
  conditions: DeckArchetypeRuleConditions,
  catalog: DeckClassifierCardCatalog,
  label: string
): void {
  for (const [sectionName, constraints] of [
    ['全部包含', conditions.includeAll],
    ['任一包含', conditions.includeAny],
    ['禁止包含', conditions.forbidAny],
  ] as const) {
    constraints?.forEach((constraint, index) => {
      const itemLabel = `${label}的${sectionName}条件第 ${index + 1} 项`;
      assertCardReference(
        catalog,
        normalizeBaseCardCode(constraint.baseCardCode, itemLabel),
        constraint.cardType,
        itemLabel
      );
    });
  }
  conditions.countSums?.forEach((constraint, index) => {
    constraint.baseCardCodes.forEach((cardCode, cardIndex) => {
      const itemLabel = `${label}的合计条件第 ${index + 1} 项第 ${cardIndex + 1} 个卡号`;
      assertCardReference(
        catalog,
        normalizeBaseCardCode(cardCode, itemLabel),
        constraint.cardType,
        itemLabel
      );
    });
  });
}

function readBaseCardCode(card: DeckCardInput, label: string): string {
  const supplied = card.baseCardCode?.trim();
  const fullCardCode = card.cardCode?.trim();
  const value = supplied || fullCardCode;
  if (!value) throw new Error(`${label}包含空卡号`);
  return getBaseCardCode(value);
}

function normalizeBaseCardCode(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return getBaseCardCode(normalized);
}

function assertCardReference(
  catalog: DeckClassifierCardCatalog,
  baseCardCode: string,
  declaredType: DeckCardType | undefined,
  label: string
): void {
  const actualType = catalog.get(baseCardCode);
  if (!actualType) {
    throw new Error(`${label}引用的基础编号 ${baseCardCode} 不存在于卡牌目录`);
  }
  if (declaredType && actualType !== declaredType) {
    throw new Error(
      `${label}引用的基础编号 ${baseCardCode} 类型错误：填写为 ${declaredType}，卡牌目录为 ${actualType}`
    );
  }
}
