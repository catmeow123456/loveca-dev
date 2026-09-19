import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  DeckConfigSchema,
  DeckLoader,
  type CardDataRegistry,
} from '../../domain/card-data/deck-loader.js';
import type { DeckConfig } from '../../application/game-service.js';
import type {
  DeckPointTableRules,
  DeckPointValidationFacts,
} from '../../domain/rules/deck-point-table.js';
import { validateDeckConfig } from '../../domain/rules/deck-construction.js';
import { toTransport } from '../../online/serde.js';
import { getPublishedCardRegistry } from '../services/card-registry-service.js';
import { deckPointTableService } from '../services/deck-point-table-service.js';
import type { AiBattlePresetChoice, AiBattlePresetInput } from '../../online/ai-battle-types.js';
export type { AiBattlePresetChoice, AiBattlePresetInput } from '../../online/ai-battle-types.js';

const handbookSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();
const presetSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    aiOnly: z.boolean().optional().default(false),
    deckPath: z.string().min(1),
    deckSha256: z.string().regex(/^[0-9a-f]{64}$/),
    defaultHandbookId: z.string().min(1),
    handbooks: z.array(handbookSchema).min(1),
  })
  .strict();
const catalogSchema = z
  .object({
    rules: z.string().min(1),
    tutorial: z.string().min(1),
    presets: z.array(presetSchema).min(1),
  })
  .strict();

export class AiBattleSetupError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 503
  ) {
    super(message);
    this.name = 'AiBattleSetupError';
  }
}

export interface AiKnowledgeMaterial {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly sha256: string;
  readonly content: string;
}

export interface AiFrozenPreset {
  readonly id: string;
  readonly name: string;
  readonly deck: DeckConfig;
  readonly pointValidation: DeckPointValidationFacts;
  readonly yaml: AiKnowledgeMaterial;
}

export interface AiFrozenKnowledge {
  readonly rules: AiKnowledgeMaterial;
  readonly tutorial: AiKnowledgeMaterial;
  readonly handbook: AiKnowledgeMaterial;
  /** Only the AI's complete deck is available to its model. */
  readonly ownDeck: AiKnowledgeMaterial;
}

interface PresetLoaderDeps {
  readonly root?: string;
  readonly getRegistry?: () => Promise<CardDataRegistry>;
  readonly getPointTable?: () => Promise<DeckPointTableRules>;
}

export class AiBattlePresetLoader {
  private readonly root: string;
  private readonly getRegistry: () => Promise<CardDataRegistry>;
  private readonly getPointTable: () => Promise<DeckPointTableRules>;

  constructor(deps: PresetLoaderDeps = {}) {
    this.root = deps.root ?? process.cwd();
    this.getRegistry = deps.getRegistry ?? (() => getPublishedCardRegistry(true));
    this.getPointTable = deps.getPointTable ?? (() => deckPointTableService.getCurrentRules());
  }

  async list(): Promise<readonly AiBattlePresetChoice[]> {
    const catalog = await this.catalog();
    return catalog.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      humanSelectable: !preset.aiOnly,
      defaultHandbookId: preset.defaultHandbookId,
      handbooks: preset.handbooks.map(({ id, name }) => ({ id, name })),
    }));
  }

  async load(input: AiBattlePresetInput): Promise<{
    readonly human: AiFrozenPreset;
    readonly ai: AiFrozenPreset;
    readonly knowledge: AiFrozenKnowledge;
  }> {
    const catalog = await this.catalog();
    const humanPreset = catalog.presets.find((preset) => preset.id === input.humanPresetId);
    const aiPreset = catalog.presets.find((preset) => preset.id === input.aiPresetId);
    const handbook = aiPreset?.handbooks.find((book) => book.id === input.handbookId);
    if (!humanPreset || !aiPreset || !handbook) {
      throw new AiBattleSetupError('AI_PRESET_INVALID', '请选择登记过的构筑及其关联手册', 400);
    }
    if (humanPreset.aiOnly) {
      throw new AiBattleSetupError('AI_PRESET_AI_ONLY', '该构筑仅允许 AI 使用', 400);
    }
    const [registry, pointTable, rules, tutorial, book] = await Promise.all([
      this.getRegistry(),
      this.getPointTable(),
      this.material('rules', '规则说明', catalog.rules),
      this.material('tutorial', '操作教程', catalog.tutorial),
      this.material(handbook.id, handbook.name, handbook.path),
    ]);
    const human = await this.preset(humanPreset, registry, pointTable, true);
    const ai =
      humanPreset.id === aiPreset.id
        ? globalThis.structuredClone(human)
        : await this.preset(aiPreset, registry, pointTable, false);
    const cardCounts = new Map<string, { count: number; card: DeckConfig['mainDeck'][number] }>();
    for (const card of [...ai.deck.mainDeck, ...ai.deck.energyDeck]) {
      const previous = cardCounts.get(card.cardCode);
      cardCounts.set(card.cardCode, { card, count: (previous?.count ?? 0) + 1 });
    }
    const content = JSON.stringify(
      toTransport({
        presetId: ai.id,
        name: ai.name,
        cards: [...cardCounts.values()],
      })
    );
    return {
      human,
      ai,
      knowledge: {
        rules,
        tutorial,
        handbook: book,
        ownDeck: {
          id: `deck:${ai.id}`,
          title: `${ai.name}卡牌参考`,
          source: 'PUBLISHED_CARDS_SNAPSHOT',
          content,
          sha256: sha256(content),
        },
      },
    };
  }

  private async catalog() {
    const material = await this.material(
      'catalog',
      '精选构筑登记',
      'assets/ai-battle/catalog.json'
    );
    const catalog = catalogSchema.parse(JSON.parse(material.content));
    if (
      new Set(catalog.presets.map((preset) => preset.id)).size !== catalog.presets.length ||
      catalog.presets.some(
        (preset) =>
          !preset.handbooks.some((book) => book.id === preset.defaultHandbookId) ||
          new Set(preset.handbooks.map((book) => book.id)).size !== preset.handbooks.length
      )
    )
      throw new AiBattleSetupError('AI_CATALOG_INVALID', '精选构筑或手册登记重复、关联缺失');
    return catalog;
  }

  private async preset(
    config: z.infer<typeof presetSchema>,
    registry: CardDataRegistry,
    pointTable: DeckPointTableRules,
    enforcePointLimit: boolean
  ): Promise<AiFrozenPreset> {
    const yaml = await this.material(`yaml:${config.id}`, config.name, config.deckPath);
    if (yaml.sha256 !== config.deckSha256)
      throw new AiBattleSetupError(
        'AI_PRESET_CHANGED',
        '构筑文件与已验证版本不符，请先完成构筑验证'
      );
    const deckConfig = DeckConfigSchema.parse(parseYaml(yaml.content));
    const pointValidation = validateDeckConfig(deckConfig, pointTable);
    const validation = enforcePointLimit
      ? pointValidation
      : validateDeckConfig(deckConfig, {
          ...pointTable,
          pointLimit: Math.max(pointTable.pointLimit, pointValidation.stats.pointTotal),
        });
    const loaded = new DeckLoader(registry).loadFromConfig(deckConfig);
    if (!validation.valid || !loaded.success || !loaded.deck || loaded.warnings.length) {
      throw new AiBattleSetupError(
        'AI_DECK_UNAVAILABLE',
        [...validation.errors, ...loaded.errors, ...loaded.warnings].join('；')
      );
    }
    return {
      id: config.id,
      name: config.name,
      yaml,
      deck: globalThis.structuredClone({
        mainDeck: loaded.deck.mainDeck,
        energyDeck: loaded.deck.energyDeck,
      }),
      pointValidation: {
        pointTableVersion: pointTable.version,
        pointTotal: pointValidation.stats.pointTotal,
        pointLimit: pointTable.pointLimit,
      },
    };
  }

  private async material(id: string, title: string, source: string): Promise<AiKnowledgeMaterial> {
    // Paths come exclusively from the repository catalog, never from a request body.
    const filename = path.resolve(this.root, source);
    if (!filename.startsWith(`${path.resolve(this.root, 'assets')}${path.sep}`))
      throw new AiBattleSetupError('AI_ASSET_PATH_INVALID', 'AI 材料路径必须位于 assets');
    const content = await readFile(filename, 'utf8');
    if (!content.trim()) throw new AiBattleSetupError('AI_ASSET_EMPTY', 'AI 材料不能为空');
    return { id, title, source, content, sha256: sha256(content) };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
