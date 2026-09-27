import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AiBattlePresetLoader } from '../../src/server/ai-battle/presets';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import * as abilities from '../../src/application/card-effects/ability-ids';
import type { AnyCardData, CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { getActiveEnergyIds } from '../../src/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId } from '../../src/online/projector';
import { fromTransport } from '../../src/online/serde';
import {
  CardType,
  GameEndReason,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';
import {
  buildAiBattleDecision,
  materializeAiDecisionCommands,
  parseAiBattleResponse,
} from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { readFrozenWudouDeck } from '../helpers/ai-wudou-deck';
import { chooseAiTestSelection } from '../helpers/ai-battle-test-policy';
import { P1, P2, setup, stage, replaceHand, decision, submit } from '../helpers/ai-battle-fixture';

// No database or model access. Both production data providers must be injected below.
vi.mock('../../src/server/services/card-registry-service', () => ({
  getPublishedCardRegistry: () => {
    throw new Error('This test must use the designated frozen export');
  },
}));
vi.mock('../../src/server/services/deck-point-table-service', () => ({
  deckPointTableService: {
    getCurrentRules: () => {
      throw new Error('This test must use an explicit test point table');
    },
  },
}));

const cards = readFrozenWudouDeck().deck.mainDeck;
function card(base: string): AnyCardData {
  const found = cards.find((value) => value.cardCode.startsWith(`${base}-`));
  if (!found) throw new Error(`Missing 无豆虹 card: ${base}`);
  return found;
}
function pending(session: GameSession, sourceCardId: string, abilityId: string) {
  Object.assign(session.state!, {
    pendingAbilities: [
      {
        id: 'wudou-pending',
        sourceCardId,
        abilityId,
        controllerId: P1,
        mandatory: true,
        timingId: 'test-timing',
        eventIds: [],
      },
    ],
  });
  Object.assign(session.state!, resolvePendingCardEffects(session.state!).gameState);
}
function pick(session: GameSession, ids: readonly string[]) {
  const current = decision(session);
  return submit(session, current, {
    kind: 'CARDS',
    cardRefs: ids.map(
      (id) =>
        current.input.space.candidates.find(
          (candidate) => candidate.objectId === createPublicObjectId(id)
        )!.ref
    ),
  });
}
function advanceDisplays(f: ReturnType<typeof setup>) {
  for (let step = 0; step < 10; step++) {
    const queries = [P1, P2].map((id) =>
      buildAiBattleDecision(f.session.state!, id, f.session.getPlayerViewState(id)!)
    );
    const display = queries.find(
      (query) =>
        query.kind === 'DECISION' &&
        ['PUBLIC_DISPLAY', 'EFFECT_CONFIRM'].includes(query.decision.input.purpose)
    );
    if (display?.kind === 'DECISION') {
      const selection = getAiMechanicalSelection(display.decision)!;
      submit(f.session, display.decision, selection);
    } else if (queries.some((query) => query.kind === 'WAITING_FOR_TIME')) {
      f.advanceTime(10_000);
    } else return;
  }
  throw new Error('Public confirmation did not finish');
}
function liveSource(f: ReturnType<typeof setup>, base: string) {
  const player = f.session.state!.players[0];
  const [id] = player.mainDeck.cardIds;
  const registry = f.session.state!.cardRegistry as Map<string, CardInstance>;
  registry.set(id!, { ...registry.get(id!)!, data: card(base) });
  Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(1) });
  Object.assign(player.liveZone, { cardIds: [id!] });
  return id!;
}

describe('无豆虹 curated deck integration', () => {
  it('loads the revised deck and its own handbook, preserving exact counts and mixed groups', async () => {
    const { registry, deck } = readFrozenWudouDeck();
    const loader = new AiBattlePresetLoader({
      getRegistry: async () => registry,
      getPointTable: async () => ({
        version: 'wudou-test-only',
        pointLimit: 9,
        effectiveFrom: '2026-09-09T00:00:00Z',
        entries: {},
      }),
    });
    expect((await loader.list()).find((entry) => entry.id === 'wudou-nijigasaki')).toMatchObject({
      name: '无豆虹',
      humanSelectable: true,
      defaultHandbookId: 'wudou-nijigasaki',
    });
    const loaded = await loader.load({
      humanPresetId: 'wudou-nijigasaki',
      aiPresetId: 'wudou-nijigasaki',
      handbookId: 'wudou-nijigasaki',
    });
    expect(loaded.human.deck).toEqual({ mainDeck: deck.mainDeck, energyDeck: deck.energyDeck });
    expect(loaded.ai.deck).toEqual(loaded.human.deck);
    expect(loaded.ai.deck).not.toBe(loaded.human.deck);
    expect(deck.mainDeck.filter((card) => card.cardType === CardType.MEMBER)).toHaveLength(48);
    expect(deck.mainDeck.filter((card) => card.cardType === CardType.LIVE)).toHaveLength(12);
    expect(deck.energyDeck).toHaveLength(12);
    expect(deck.energyDeck.every((card) => card.cardCode === 'LL-E-003-SD')).toBe(true);
    const reference = fromTransport<{
      presetId: string;
      cards: { count: number; card: AnyCardData }[];
    }>(JSON.parse(loaded.knowledge.ownDeck.content));
    expect(reference.presetId).toBe('wudou-nijigasaki');
    expect(reference.cards.reduce((sum, entry) => sum + entry.count, 0)).toBe(72);
    const byCode = new Map(reference.cards.map((entry) => [entry.card.cardCode, entry]));
    expect(byCode.get('PL!HS-bp6-001-R+')).toMatchObject({
      count: 4,
      card: { groupNames: ['蓮ノ空'] },
    });
    expect(byCode.get('PL!SP-bp7-018-N')).toMatchObject({
      count: 2,
      card: { groupNames: ['Liella!'] },
    });
    expect(byCode.get('PL!-bp5-222-R')?.card.groupNames).toEqual(['A-RISE']);
    expect(byCode.get('PL!N-bp7-025-L')?.count).toBe(3);
    expect(byCode.get('PL!N-bp5-026-L')?.count).toBe(2);
    const live = byCode.get('PL!N-bp7-026-L')!.card;
    expect(live.cardType).toBe(CardType.LIVE);
    if (live.cardType === CardType.LIVE) {
      expect(live.requirements.totalRequired).toBe(12);
      expect(live.requirements.colorRequirements.get(HeartColor.GREEN)).toBe(2);
    }
    expect(loaded.knowledge.handbook.content).toBe(
      await readFile('assets/ai-battle/handbooks/wudou-nijigasaki.md', 'utf8')
    );
    await expect(
      loader.load({
        humanPresetId: 'wudou-nijigasaki',
        aiPresetId: 'wudou-nijigasaki',
        handbookId: 'like-a-treasure',
      })
    ).rejects.toMatchObject({ code: 'AI_PRESET_INVALID' });
  });

  it.each([false, true])(
    'Emma exposes a pure ordered optional return and recovers only moved count (skip=%s)',
    (skip) => {
      const f = setup();
      const source = stage(f.session, card('PL!N-bp7-008') as MemberCardData, SlotPosition.CENTER);
      const ids = replaceHand(f.session, [
        card('PL!N-bp5-005'),
        card('PL!N-bp7-011'),
        card('PL!-sd1-005'),
      ]);
      const player = f.session.state!.players[0];
      Object.assign(player.hand, { cardIds: [] });
      Object.assign(player.waitingRoom, { cardIds: ids });
      Object.assign(player.energyZone, {
        cardStates: new Map(
          [...player.energyZone.cardStates].map(([id, state]) => [
            id,
            { ...state, orientation: OrientationState.WAITING },
          ])
        ),
      });
      pending(
        f.session,
        source,
        abilities.N_BP7_008_ON_ENTER_BOTTOM_UP_TO_FOUR_NO_BLADE_HEART_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID
      );
      const before = structuredClone(f.session.state!);
      const randomCalls = f.randomCalls();
      const current = decision(f.session);
      expect(f.session.state).toEqual(before);
      expect(f.randomCalls()).toBe(randomCalls);
      expect(current.input.space).toMatchObject({
        kind: 'CARDS',
        min: 0,
        max: 2,
        ordered: true,
        canSkip: true,
      });
      expect(current.input.space.candidates.map((candidate) => candidate.objectId)).toEqual(
        ids.slice(0, 2).map(createPublicObjectId)
      );
      expect(buildAiBattleDecision(f.session.state!, P2).kind).toBe('WAITING_FOR_PLAYER');
      const ref = current.input.space.candidates[0]!.ref;
      expect(() =>
        parseAiBattleResponse(
          current,
          JSON.stringify({ selection: { kind: 'CARDS', cardRefs: [ref, ref] } })
        )
      ).toThrow();
      pick(f.session, skip ? [] : [ids[1]!, ids[0]!]);
      advanceDisplays(f);
      const after = f.session.state!.players[0];
      expect(getActiveEnergyIds(after.energyZone)).toHaveLength(skip ? 0 : 2);
      if (skip) expect(after.waitingRoom.cardIds).toEqual(ids);
      else {
        expect(after.mainDeck.cardIds.slice(-2)).toEqual([ids[1], ids[0]]);
        expect(after.waitingRoom.cardIds).toEqual([ids[2]]);
      }
    }
  );

  it.each([false, true])(
    'Just Believe exposes optional discard then exact distinct targets in the existing workflow (skip=%s)',
    (skip) => {
      const f = setup();
      const targets = [
        stage(f.session, card('PL!N-bp7-008') as MemberCardData, SlotPosition.CENTER),
        stage(f.session, card('PL!N-bp7-006') as MemberCardData, SlotPosition.LEFT),
        stage(f.session, card('PL!N-PR-014') as MemberCardData, SlotPosition.RIGHT),
      ];
      const hand = replaceHand(f.session, [card('PL!-sd1-005'), card('PL!N-PR-012')]);
      const source = liveSource(f, 'PL!N-bp7-026');
      pending(
        f.session,
        source,
        abilities.N_BP7_026_LIVE_START_DISCARD_UP_TO_TWO_TARGET_NIJIGASAKI_GAIN_BLADE_ABILITY_ID
      );
      expect(decision(f.session).input.space).toMatchObject({
        kind: 'CARDS',
        min: 1,
        max: 2,
        canSkip: true,
      });
      pick(f.session, skip ? [] : hand);
      if (skip) {
        expect(f.session.state!.players[0].hand.cardIds).toEqual(hand);
        expect(f.session.state!.activeEffect).toBeNull();
        return;
      }
      const target = decision(f.session);
      expect(target.input.space).toMatchObject({ kind: 'CARDS', min: 2, max: 2, canSkip: false });
      expect(target.input.space.candidates.map((candidate) => candidate.objectId).sort()).toEqual(
        targets.map(createPublicObjectId).sort()
      );
      const ref = target.input.space.candidates[0]!.ref;
      for (const refs of [[], [ref], [ref, ref]])
        expect(() =>
          parseAiBattleResponse(
            target,
            JSON.stringify({ selection: { kind: 'CARDS', cardRefs: refs } })
          )
        ).toThrow();
      const blades = targets.map((id) => getMemberEffectiveBladeCount(f.session.state!, P1, id));
      pick(f.session, targets.slice(0, 2));
      expect(f.session.state!.players[0].hand.cardIds).toEqual([]);
      expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual(expect.arrayContaining(hand));
      expect(targets.map((id) => getMemberEffectiveBladeCount(f.session.state!, P1, id))).toEqual(
        blades.map((value, index) => value + (index < 2 ? 1 : 0))
      );
    }
  );

  it('new Colorful offers only visible Nijigasaki targets and applies one blade', () => {
    const f = setup();
    const target = stage(f.session, card('PL!N-bp7-008') as MemberCardData, SlotPosition.CENTER);
    const other = stage(f.session, card('PL!N-bp7-006') as MemberCardData, SlotPosition.RIGHT);
    stage(f.session, card('PL!HS-bp6-001') as MemberCardData, SlotPosition.LEFT);
    const source = liveSource(f, 'PL!N-bp7-025');
    pending(
      f.session,
      source,
      abilities.N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID
    );
    const current = decision(f.session);
    expect(current.input.space).toMatchObject({ kind: 'CARDS', min: 1, max: 1, canSkip: false });
    expect(current.input.space.candidates.map((candidate) => candidate.objectId).sort()).toEqual(
      [target, other].map(createPublicObjectId).sort()
    );
    const before = getMemberEffectiveBladeCount(f.session.state!, P1, target);
    pick(f.session, [target]);
    expect(getMemberEffectiveBladeCount(f.session.state!, P1, target)).toBe(before + 1);
  });

  it.each([
    ...new Map(
      readFrozenWudouDeck()
        .deck.mainDeck.filter((card): card is MemberCardData => card.cardType === CardType.MEMBER)
        .map((card) => [card.cardCode, card])
    ).values(),
  ])('queries MAIN with $cardCode without an unsupported activation', (card) => {
    const f = setup();
    stage(f.session, card, SlotPosition.CENTER);
    expect(buildAiBattleDecision(f.session.state!, P1).kind).toBe('DECISION');
  });

  it.each([1, 2])(
    'finishes a deterministic visible-decision mirror without a model (seed %i)',
    (seed) => {
      let now = 1000;
      let random = seed;
      const session = createGameSession({
        now: () => now,
        randomInt: (max) => {
          random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
          return random % max;
        },
      });
      session.createGame(`wudou-${seed}`, P1, 'Test 1', P2, 'Test 2');
      const { deck } = readFrozenWudouDeck();
      expect(session.initializeGame(deck, deck).success).toBe(true);
      for (let step = 0; step < 1600 && !session.state!.isEnded; step++) {
        const queries = [P1, P2].map((id) =>
          buildAiBattleDecision(session.state!, id, session.getPlayerViewState(id)!)
        );
        const unsupported = queries.find((query) => query.kind === 'UNSUPPORTED');
        expect(unsupported, JSON.stringify(unsupported)).toBeUndefined();
        const next = queries.find((query) => query.kind === 'DECISION');
        if (next?.kind === 'DECISION') {
          const selection =
            getAiMechanicalSelection(next.decision) ?? chooseAiTestSelection(next.decision.input);
          for (const command of materializeAiDecisionCommands(next.decision, selection, now)) {
            const result = session.executeCommand(command);
            expect(result.success, result.error).toBe(true);
          }
          now += 10;
        } else {
          const waiting = queries.find((query) => query.kind === 'WAITING_FOR_TIME');
          if (waiting?.kind !== 'WAITING_FOR_TIME') throw new Error(JSON.stringify(queries));
          now = waiting.deadlineAt;
        }
      }
      expect(session.state!.isEnded).toBe(true);
      expect([GameEndReason.VICTORY_CONDITION, GameEndReason.DRAW]).toContain(
        session.state!.endInfo?.reason
      );
    },
    30_000
  );
});
