import { mkdtemp, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AiBattlePresetLoader } from '../../src/server/ai-battle/presets';
import { CardDataRegistry } from '../../src/domain/card-data/loader';
import type { DeckPointTableRules } from '../../src/domain/rules/deck-point-table';
import {
  readFrozenBluePurpleDeck,
  readFrozenGreenHasunosoraDeck,
  readFrozenLikeATreasureDeck,
  readFrozenMuseDeck,
} from '../helpers/ai-curated-decks';
import { createGameSession } from '../../src/application/game-session';
import { DecisionTapeRandomSource } from '../../src/shared/random-source';
import {
  BladeHeartEffect,
  CardType,
  GameEndReason,
  HeartColor,
} from '../../src/shared/types/enums';
import { fromTransport } from '../../src/online/serde';
import type { AnyCardData } from '../../src/domain/entities/card';
import {
  buildAiBattleDecision,
  materializeAiDecisionCommands,
} from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { chooseAiTestSelection } from '../helpers/ai-battle-test-policy';

const choice = {
  humanPresetId: 'muse-starter',
  aiPresetId: 'muse-starter',
  handbookId: 'muse-balanced',
};
const roots: string[] = [];
const pointTable: DeckPointTableRules = {
  version: 'test-current',
  pointLimit: 9,
  effectiveFrom: '2026-09-09T00:00:00Z',
  entries: {},
};

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'loveca-ai-presets-'));
  roots.push(root);
  await mkdir(path.join(root, 'assets/decks'), { recursive: true });
  await Promise.all([
    cp('assets/ai-battle', path.join(root, 'assets/ai-battle'), { recursive: true }),
    cp('assets/decks/缪预组.yaml', path.join(root, 'assets/decks/缪预组.yaml')),
    cp('assets/decks/绿莲-6弹ver.yaml', path.join(root, 'assets/decks/绿莲-6弹ver.yaml')),
    cp('assets/decks/蓝紫.yaml', path.join(root, 'assets/decks/蓝紫.yaml')),
    cp('assets/decks/Like a Treasure.yaml', path.join(root, 'assets/decks/Like a Treasure.yaml')),
  ]);
  const registry = new CardDataRegistry();
  const deck = readFrozenMuseDeck().deck;
  const green = readFrozenGreenHasunosoraDeck().deck;
  const bluePurple = readFrozenBluePurpleDeck().deck;
  const treasure = readFrozenLikeATreasureDeck().deck;
  registry.load([
    ...deck.mainDeck,
    ...deck.energyDeck,
    ...green.mainDeck,
    ...green.energyDeck,
    ...bluePurple.mainDeck,
    ...bluePurple.energyDeck,
    ...treasure.mainDeck,
    ...treasure.energyDeck,
  ]);
  const loader = new AiBattlePresetLoader({
    root,
    getRegistry: () => Promise.resolve(registry),
    getPointTable: () => Promise.resolve(pointTable),
  });
  return { root, loader, registry };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AI curated deck and frozen knowledge loading', () => {
  it.each(['human', 'ai', 'both'])(
    'loads Like a Treasure for %s without mixing the opponent deck or handbook',
    async (side) => {
      const { loader } = await fixture();
      const aiTreasure = side !== 'human';
      expect((await loader.list()).find((preset) => preset.id === 'like-a-treasure')).toMatchObject(
        {
          name: 'Like a Treasure',
          humanSelectable: true,
          defaultHandbookId: 'like-a-treasure',
        }
      );
      const loaded = await loader.load({
        humanPresetId: side !== 'ai' ? 'like-a-treasure' : choice.humanPresetId,
        aiPresetId: aiTreasure ? 'like-a-treasure' : choice.aiPresetId,
        handbookId: aiTreasure ? 'like-a-treasure' : choice.handbookId,
      });
      const treasure = side === 'ai' ? loaded.ai : loaded.human;
      const expected = readFrozenLikeATreasureDeck().deck;
      expect(treasure.deck).toEqual({
        mainDeck: expected.mainDeck,
        energyDeck: expected.energyDeck,
      });
      expect(
        treasure.deck.mainDeck.filter((card) => card.cardType === CardType.MEMBER)
      ).toHaveLength(48);
      expect(treasure.deck.mainDeck.filter((card) => card.cardType === CardType.LIVE)).toHaveLength(
        12
      );
      expect(treasure.deck.energyDeck).toHaveLength(12);
      expect(
        treasure.deck.mainDeck.find((card) => card.cardCode === 'PL!HS-PR-021-RM')?.groupNames
      ).toEqual(['蓮ノ空']);
      const reference = fromTransport<{
        presetId: string;
        cards: { count: number; card: AnyCardData }[];
      }>(JSON.parse(loaded.knowledge.ownDeck.content));
      expect(reference.presetId).toBe(loaded.ai.id);
      expect(reference.cards.reduce((sum, entry) => sum + entry.count, 0)).toBe(72);
      expect(loaded.knowledge.handbook.id).toBe(aiTreasure ? 'like-a-treasure' : 'muse-balanced');
      if (aiTreasure) {
        expect(loaded.knowledge.handbook.content).toBe(
          await readFile('assets/ai-battle/handbooks/like-a-treasure.md', 'utf8')
        );
        const live = reference.cards.find(({ card }) => card.cardCode === 'PL!N-bp7-031-L')!.card;
        if (live.cardType !== CardType.LIVE) throw new Error('Missing Treasure LIVE');
        expect(live.requirements.colorRequirements.get(HeartColor.PINK)).toBe(2);
        expect(live.requirements.colorRequirements.get(HeartColor.YELLOW)).toBe(2);
        expect(live.requirements.colorRequirements.get(HeartColor.GREEN)).toBe(2);
      }
      const session = createGameSession();
      session.createGame('treasure-preset', 'human', 'Human', 'ai', 'AI');
      expect(session.initializeGame(loaded.human.deck, loaded.ai.deck).success).toBe(true);
    }
  );

  it('adds a different composition through catalog and handbook files and completes the existing decision flow', async () => {
    const { root, loader } = await fixture();
    const original = await readFile(path.join(root, 'assets/decks/缪预组.yaml'), 'utf8');
    const yaml = original
      .replace(
        'card_code: PL!-sd1-001-SD\n      count: 4',
        'card_code: PL!-sd1-001-SD\n      count: 3'
      )
      .replace(
        'card_code: PL!-sd1-005-SD\n      count: 2',
        'card_code: PL!-sd1-005-SD\n      count: 3'
      );
    await writeFile(path.join(root, 'assets/decks/muse-test-composition.yaml'), yaml);
    await writeFile(
      path.join(root, 'assets/ai-battle/handbooks/test-composition.md'),
      '# 测试构筑\n复用既有选择类型；多一张低费用成员，优先建立舞台。'
    );
    const catalogPath = path.join(root, 'assets/ai-battle/catalog.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as { presets: unknown[] };
    catalog.presets.push({
      id: 'muse-test-composition',
      name: "μ's 构成扩展测试",
      deckPath: 'assets/decks/muse-test-composition.yaml',
      deckSha256: createHash('sha256').update(yaml).digest('hex'),
      defaultHandbookId: 'test-composition',
      handbooks: [
        {
          id: 'test-composition',
          name: '构成扩展测试',
          path: 'assets/ai-battle/handbooks/test-composition.md',
        },
      ],
    });
    await writeFile(catalogPath, JSON.stringify(catalog));
    const loaded = await loader.load({
      ...choice,
      aiPresetId: 'muse-test-composition',
      handbookId: 'test-composition',
    });
    expect(
      loaded.ai.deck.mainDeck.filter((card) => card.cardCode === 'PL!-sd1-001-SD')
    ).toHaveLength(3);
    expect(
      loaded.ai.deck.mainDeck.filter((card) => card.cardCode === 'PL!-sd1-005-SD')
    ).toHaveLength(3);
    expect(loaded.ai.deck.mainDeck).toHaveLength(60);
    expect(loaded.ai.deck).not.toEqual(loaded.human.deck);
    expect(loaded.knowledge.handbook.id).toBe('test-composition');
    expect((await loader.list()).map((preset) => preset.id)).toContain('muse-test-composition');
    let seed = 0x12345678;
    const random = new DecisionTapeRandomSource(
      'ai-config-extension-v1',
      Array.from({ length: 20_000 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
      })
    );
    let now = 1000;
    const session = createGameSession({ randomInt: random.nextInt, now: () => now });
    session.createGame('config-extension', 'human', 'Human', 'ai', 'AI');
    expect(session.initializeGame(loaded.human.deck, loaded.ai.deck).success).toBe(true);
    const purposes = new Set<string>();
    for (let step = 0; step < 1500 && !session.state!.isEnded; step++) {
      const queries = ['human', 'ai'].map((id) =>
        buildAiBattleDecision(session.state!, id, session.getPlayerViewState(id)!)
      );
      const query = queries.find((item) => item.kind === 'DECISION');
      if (query?.kind === 'DECISION') {
        purposes.add(query.decision.input.purpose);
        const selected =
          getAiMechanicalSelection(query.decision) ?? chooseAiTestSelection(query.decision.input);
        for (const command of materializeAiDecisionCommands(query.decision, selected, now)) {
          const result = session.executeCommand(command);
          expect(result.success, result.error).toBe(true);
        }
        now += 10;
      } else {
        const waiting = queries.find((item) => item.kind === 'WAITING_FOR_TIME');
        if (waiting?.kind !== 'WAITING_FOR_TIME') throw new Error(JSON.stringify(queries));
        now = waiting.deadlineAt;
      }
    }
    expect(session.state!.isEnded).toBe(true);
    expect([GameEndReason.VICTORY_CONDITION, GameEndReason.DRAW]).toContain(
      session.state!.endInfo?.reason
    );
    expect([...purposes]).toEqual(
      expect.arrayContaining(['MULLIGAN', 'MAIN', 'EFFECT', 'LIVE_SET', 'SUCCESS_LIVE'])
    );
  }, 30_000);

  it.each(['human', 'ai', 'both'])(
    'loads green Hasunosora for %s with its own frozen knowledge',
    async (side) => {
      const { loader } = await fixture();
      const greenId = 'green-hasunosora-bp6';
      const aiGreen = side !== 'human';
      const loaded = await loader.load({
        humanPresetId: side !== 'ai' ? greenId : 'muse-starter',
        aiPresetId: aiGreen ? greenId : 'muse-starter',
        handbookId: aiGreen ? 'green-hasunosora-recovery' : 'muse-balanced',
      });
      const expected = readFrozenGreenHasunosoraDeck().deck;
      expect((side === 'ai' ? loaded.ai : loaded.human).deck).toEqual({
        mainDeck: expected.mainDeck,
        energyDeck: expected.energyDeck,
      });
      expect(loaded.ai.deck.mainDeck).toHaveLength(60);
      expect(loaded.ai.deck.energyDeck).toHaveLength(12);
      const reference = fromTransport<{ cards: { count: number; card: AnyCardData }[] }>(
        JSON.parse(loaded.knowledge.ownDeck.content)
      );
      expect(reference.cards.reduce((sum, entry) => sum + entry.count, 0)).toBe(72);
      expect(
        reference.cards.every(({ card }) => card.cardCode.startsWith(aiGreen ? 'PL!HS-' : 'PL!-'))
      ).toBe(true);
      for (const { card } of reference.cards) {
        if (card.cardType === CardType.LIVE)
          expect(card.requirements.colorRequirements.size).toBeGreaterThan(0);
      }
      expect(loaded.knowledge.handbook.id).toBe(
        aiGreen ? 'green-hasunosora-recovery' : 'muse-balanced'
      );
      expect((await loader.list()).map((preset) => preset.id)).toContain(greenId);
    }
  );

  it('loads the original 60/12 deck, current PT facts and complete per-card counts', async () => {
    const { loader } = await fixture();
    const loaded = await loader.load(choice);
    expect(loaded.ai.deck.mainDeck).toHaveLength(60);
    expect(loaded.ai.deck.energyDeck).toHaveLength(12);
    expect(loaded.ai.pointValidation).toEqual({
      pointTableVersion: pointTable.version,
      pointTotal: 0,
      pointLimit: 9,
    });
    expect(loaded.ai.deck).toEqual(loaded.human.deck);
    expect(loaded.ai.deck).not.toBe(loaded.human.deck);
    const reference = JSON.parse(loaded.knowledge.ownDeck.content) as {
      cards: { count: number }[];
    };
    expect(reference.cards.reduce((sum, entry) => sum + entry.count, 0)).toBe(72);
    expect(reference.cards).toHaveLength(31);
    expect(loaded.knowledge.handbook.id).toBe('muse-balanced');
    expect((await loader.list())[0]?.handbooks.map((book) => book.id)).toEqual([
      'muse-balanced',
      'muse-tempo',
    ]);
    expect(JSON.stringify(await loader.list())).not.toContain('assets/');
  });

  it('offers the blue-purple deck only to AI and preserves its over-limit PT facts', async () => {
    const { root, registry } = await fixture();
    const loader = new AiBattlePresetLoader({
      root,
      getRegistry: () => Promise.resolve(registry),
      getPointTable: () =>
        Promise.resolve({
          ...pointTable,
          entries: {
            'PL!N-bp1-003': 4,
            'PL!N-bp4-030': 1,
            'PL!SP-sd1-019': 1,
          },
        }),
    });
    const bluePurpleId = 'blue-purple-nijigasaki';
    const catalog = await loader.list();
    expect(catalog.find((preset) => preset.id === bluePurpleId)).toMatchObject({
      name: '蓝紫',
      humanSelectable: false,
      defaultHandbookId: 'blue-purple-nijigasaki-tempo',
    });

    const loaded = await loader.load({
      humanPresetId: 'muse-starter',
      aiPresetId: bluePurpleId,
      handbookId: 'blue-purple-nijigasaki-tempo',
    });
    const expected = readFrozenBluePurpleDeck().deck;
    expect(loaded.ai.deck).toEqual({
      mainDeck: expected.mainDeck,
      energyDeck: expected.energyDeck,
    });
    expect(loaded.ai.pointValidation).toEqual({
      pointTableVersion: pointTable.version,
      pointTotal: 20,
      pointLimit: 9,
    });
    const handbook = await readFile(
      path.join(root, 'assets/ai-battle/handbooks/blue-purple-nijigasaki-tempo.md'),
      'utf8'
    );
    expect(loaded.knowledge.handbook.content).toBe(handbook);
    expect(loaded.knowledge.handbook.sha256).toBe(
      createHash('sha256').update(handbook).digest('hex')
    );
    const memberCostDistribution = loaded.ai.deck.mainDeck.reduce<Record<number, number>>(
      (counts, card) => {
        if (card.cardType === CardType.MEMBER) counts[card.cost] = (counts[card.cost] ?? 0) + 1;
        return counts;
      },
      {}
    );
    expect(memberCostDistribution).toEqual({ 2: 14, 4: 9, 10: 6, 11: 12, 13: 2, 15: 4, 20: 1 });
    const bladeHeartDistribution = loaded.ai.deck.mainDeck
      .flatMap((card) => card.bladeHearts ?? [])
      .filter((item) => item.effect === BladeHeartEffect.HEART)
      .reduce<Record<string, number>>((counts, item) => {
        const key = item.heartColor ?? 'UNKNOWN';
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {});
    expect(bladeHeartDistribution).toEqual({
      [HeartColor.BLUE]: 18,
      [HeartColor.PURPLE]: 15,
      [HeartColor.PINK]: 2,
      [HeartColor.YELLOW]: 8,
      [HeartColor.GREEN]: 4,
      [HeartColor.RAINBOW]: 9,
    });
    expect(
      loaded.ai.deck.mainDeck.filter(
        (card) => !card.bladeHearts?.some((item) => item.effect === BladeHeartEffect.HEART)
      )
    ).toHaveLength(4);
    const session = createGameSession();
    session.createGame('blue-purple-ai', 'human', 'Human', 'ai', 'AI');
    expect(session.initializeGame(loaded.human.deck, loaded.ai.deck).success).toBe(true);
    await expect(
      loader.load({
        humanPresetId: bluePurpleId,
        aiPresetId: 'muse-starter',
        handbookId: 'muse-balanced',
      })
    ).rejects.toMatchObject({ code: 'AI_PRESET_AI_ONLY', statusCode: 400 });
  });

  it('preserves each LIVE colour requirement in the frozen model reference', async () => {
    const { loader } = await fixture();
    const loaded = await loader.load(choice);
    const reference = fromTransport<{ cards: { count: number; card: AnyCardData }[] }>(
      JSON.parse(loaded.knowledge.ownDeck.content)
    );
    const lives = loaded.ai.deck.mainDeck.filter((card) => card.cardType === CardType.LIVE);
    expect(lives.length).toBeGreaterThan(0);
    for (const live of lives) {
      const frozen = reference.cards.find((entry) => entry.card.cardCode === live.cardCode)?.card;
      expect(frozen?.cardType).toBe(CardType.LIVE);
      if (frozen?.cardType !== CardType.LIVE) throw new Error('Missing LIVE reference');
      expect(frozen.requirements).toEqual(live.requirements);
      expect(frozen.requirements.colorRequirements.size).toBeGreaterThan(0);
    }
  });

  it.each([
    { ...choice, aiPresetId: '../../outside' },
    { ...choice, humanPresetId: 'unregistered' },
    { ...choice, handbookId: 'assets/ai-battle/rules.md' },
  ])('rejects unregistered request identifiers: %j', async (input) => {
    const { loader } = await fixture();
    await expect(loader.load(input)).rejects.toMatchObject({
      code: 'AI_PRESET_INVALID',
      statusCode: 400,
    });
  });

  it('rejects a changed deck before it can become an apparently certified preset', async () => {
    const { root, loader } = await fixture();
    const file = path.join(root, 'assets/decks/缪预组.yaml');
    await writeFile(file, `${await readFile(file, 'utf8')}\n# changed\n`);
    await expect(loader.load(choice)).rejects.toMatchObject({ code: 'AI_PRESET_CHANGED' });
  });

  it('revalidates the current card registry and PT table rather than trusting YAML counts alone', async () => {
    const { root } = await fixture();
    const missingCards = new AiBattlePresetLoader({
      root,
      getRegistry: () => Promise.resolve(new CardDataRegistry()),
      getPointTable: () => Promise.resolve(pointTable),
    });
    await expect(missingCards.load(choice)).rejects.toMatchObject({ code: 'AI_DECK_UNAVAILABLE' });
    const registry = new CardDataRegistry();
    const deck = readFrozenMuseDeck().deck;
    registry.load([...deck.mainDeck, ...deck.energyDeck]);
    const changedPt = new AiBattlePresetLoader({
      root,
      getRegistry: () => Promise.resolve(registry),
      getPointTable: () => Promise.resolve({ ...pointTable, entries: { 'PL!-sd1-001': 3 } }),
    });
    await expect(changedPt.load(choice)).rejects.toMatchObject({ code: 'AI_DECK_UNAVAILABLE' });
  });

  it('keeps old knowledge and cards detached when files and the registry change', async () => {
    const { root, loader, registry } = await fixture();
    const first = await loader.load(choice);
    const before = globalThis.structuredClone(first);
    const file = path.join(root, 'assets/ai-battle/handbooks/muse-balanced.md');
    await writeFile(file, '第二版手册，改为测试新的策略偏好。');
    const second = await loader.load(choice);
    expect(second.knowledge.handbook.sha256).not.toBe(first.knowledge.handbook.sha256);
    expect(first).toEqual(before);
    registry.load([]);
    expect(first).toEqual(before);
  });
});
