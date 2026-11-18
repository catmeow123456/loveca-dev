import { describe, expect, it } from 'vitest';
import {
  openHextechSelection,
  applyHextechCommand,
  validateHextechCommand,
} from '../../src/application/hextech/selection';
import { GameCommandType, type HextechCommand } from '../../src/application/game-commands';
import { createGameState, type GameState } from '../../src/domain/entities/game';
import {
  DARK_HEXTECH_RULES_VERSION,
  HEXTECH_RULES_VERSION,
  getHextechDefinition,
  getHextechDefinitions,
  type HextechId,
  type HextechPool,
} from '../../src/domain/hextech/catalog';
import { GamePhase } from '../../src/shared/types/enums';

function fixture(
  turn: number,
  pool: HextechPool = 'DARK',
  held: readonly HextechId[] = []
): GameState {
  return {
    ...createGameState('dark-draft', 'p1', '甲', 'p2', '乙'),
    isStarted: true,
    turnCount: turn,
    currentPhase: GamePhase.ACTIVE_PHASE,
    hextech: {
      rulesVersion: pool === 'DARK' ? DARK_HEXTECH_RULES_VERSION : HEXTECH_RULES_VERSION,
      owned: held.map((definitionId, index) => ({
        definitionId,
        instanceId: `held-${index}`,
        playerId: 'p1',
        acquiredTurn: index * 2 + 1,
      })),
      draft: { completedRounds: [1, 3, 5].indexOf(turn) },
    },
  };
}

function open(game: GameState, rarityRoll: number, seed = 0) {
  let first = true;
  return openHextechSelection(game, (max) => {
    if (first) {
      first = false;
      expect(rarityRoll).toBeLessThan(max);
      return rarityRoll;
    }
    return seed++ % max;
  });
}

function assertOffers(game: GameState) {
  const pending = game.hextech!.draft!.pending!;
  pending.offers.forEach((offer, index) => {
    const ids = offer.candidates.map((candidate) => candidate.definitionId);
    expect(new Set(ids).size).toBe(3);
    expect(new Set(ids.map((id) => getHextechDefinition(id)!.group))).toEqual(
      new Set(['DISRUPTION', 'DOUBLE_EDGED'])
    );
    for (const id of ids) {
      expect(getHextechDefinition(id)!.rarity).toBe(pending.rarity);
      expect(
        game.hextech!.owned.some(
          (entry) => entry.playerId === game.players[index].id && entry.definitionId === id
        )
      ).toBe(false);
      if (game.turnCount === 1)
        expect(['dark-position-mishap', 'dark-silent-column']).not.toContain(id);
    }
  });
}

describe('黑暗池分轮概率与混合候选', () => {
  it.each([
    [1, [55, 35, 10]],
    [3, [25, 50, 25]],
    [5, [1, 1, 1]],
  ] as const)('第%i回合穷举随机区间得到银金彩权重%j', (turn, weights) => {
    const counts = { SILVER: 0, GOLD: 0, PRISMATIC: 0 };
    for (let roll = 0; roll < weights.reduce((a, b) => a + b, 0); roll++) {
      const state = open(fixture(turn), roll);
      counts[state.hextech!.draft!.pending!.rarity]++;
      assertOffers(state);
    }
    expect(Object.values(counts)).toEqual(weights);
  });

  it('普通池三轮仍为各1/3，原有候选随机调用不变', () => {
    for (const turn of [1, 3, 5]) {
      for (const [roll, rarity] of ['SILVER', 'GOLD', 'PRISMATIC'].entries()) {
        const calls: number[] = [];
        const state = openHextechSelection(fixture(turn, 'NORMAL'), (max) => {
          calls.push(max);
          return calls.length === 1 ? roll : 0;
        });
        expect(state.hextech!.draft!.pending!.rarity).toBe(rarity);
        expect(calls).toHaveLength(7);
        expect(calls[0]).toBe(3);
      }
    }
  });

  it('已有两项彩色时第三轮仍可出彩，不限制彩色轮数', () => {
    const state = open(fixture(5, 'DARK', ['dark-first-slot-mute', 'dark-bet-on-victory']), 2);
    expect(state.hextech!.draft!.pending!.rarity).toBe('PRISMATIC');
    assertOffers(state);
  });

  it.each([1, 3, 5])('普通池第%i回合初选与重抽遵守掀桌入池时点', (turn) => {
    const initialIds = new Set<string>();
    const rerollIds = new Set<string>();
    const expected = getHextechDefinitions('NORMAL')
      .filter((entry) => entry.rarity === 'PRISMATIC' && (turn !== 1 || entry.id !== 'table-flip'))
      .map((entry) => entry.id);
    // Cover every initial first pick and every replacement index for both players and all slots.
    for (let seed = 0; seed < 8; seed++) {
      const state = open(fixture(turn, 'NORMAL'), 2, seed);
      for (const [index, player] of state.players.entries()) {
        const candidates = state.hextech!.draft!.pending!.offers[index].candidates;
        for (const candidate of candidates) initialIds.add(candidate.definitionId);
        for (const slot of [0, 1, 2]) {
          for (let roll = 0; roll < 8; roll++) {
            const command: HextechCommand = {
              type: GameCommandType.REROLL_HEXTECH,
              playerId: player.id,
              selectionTurn: turn,
              slot,
              expectedDefinitionId: candidates[slot].definitionId,
              timestamp: 0,
            };
            expect(validateHextechCommand(state, command)).toBeNull();
            const next = applyHextechCommand(state, command, (max) => roll % max);
            const replacement = next.hextech!.draft!.pending!.offers[index].candidates[slot];
            expect(replacement.definitionId).not.toBe(candidates[slot].definitionId);
            rerollIds.add(replacement.definitionId);
          }
        }
      }
    }
    expect(initialIds).toEqual(new Set(expected));
    expect(rerollIds).toEqual(new Set(expected));
  });

  it.each([
    ['SILVER', 0, 0, 'dark-position-mishap'],
    ['PRISMATIC', 99, 99, 'dark-silent-column'],
  ] as const)(
    '%s首轮及重抽排除无目标取得项，第三轮恢复',
    (rarity, firstRoll, laterRoll, excluded) => {
      const laterIds = new Set<string>();
      const slotGroups = [new Set<string>(), new Set<string>(), new Set<string>()];
      for (let seed = 0; seed < 60; seed++) {
        let state = open(fixture(1), firstRoll, seed);
        expect(state.hextech!.draft!.pending!.rarity).toBe(rarity);
        assertOffers(state);
        state.hextech!.draft!.pending!.offers[0].candidates.forEach((candidate, slot) =>
          slotGroups[slot].add(getHextechDefinition(candidate.definitionId)!.group!)
        );
        for (const playerId of ['p1', 'p2']) {
          for (const slot of [0, 1, 2]) {
            const index = playerId === 'p1' ? 0 : 1;
            const old = state.hextech!.draft!.pending!.offers[index].candidates[slot];
            const command: HextechCommand = {
              type: GameCommandType.REROLL_HEXTECH,
              playerId,
              selectionTurn: 1,
              slot,
              expectedDefinitionId: old.definitionId,
              timestamp: 0,
            };
            expect(validateHextechCommand(state, command)).toBeNull();
            state = applyHextechCommand(state, command, (max) => seed % max);
            assertOffers(state);
          }
        }
        const later = open(fixture(3), laterRoll, seed);
        later.hextech!.draft!.pending!.offers.forEach((offer) =>
          offer.candidates.forEach((candidate) => laterIds.add(candidate.definitionId))
        );
      }
      expect(laterIds.has(excluded)).toBe(true);
      for (const groups of slotGroups)
        expect(groups).toEqual(new Set(['DISRUPTION', 'DOUBLE_EDGED']));
    }
  );

  it.each(['SILVER', 'GOLD', 'PRISMATIC'] as const)(
    '%s已持有两项时，六种重抽顺序均保留两类且不重复',
    (rarity) => {
      const entries = getHextechDefinitions('DARK').filter((entry) => entry.rarity === rarity);
      const orders = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ];
      for (let first = 0; first < entries.length - 1; first++) {
        for (let second = first + 1; second < entries.length; second++) {
          for (const order of orders) {
            let state = open(
              fixture(5, 'DARK', [entries[first].id, entries[second].id]),
              ['SILVER', 'GOLD', 'PRISMATIC'].indexOf(rarity),
              first + second
            );
            assertOffers(state);
            for (const slot of order) {
              const before = state.hextech!.draft!.pending!.offers[0];
              const command: HextechCommand = {
                type: GameCommandType.REROLL_HEXTECH,
                playerId: 'p1',
                selectionTurn: 5,
                slot,
                expectedDefinitionId: before.candidates[slot].definitionId,
                timestamp: 0,
              };
              state = applyHextechCommand(state, command, (max) => max - 1);
              assertOffers(state);
              const after = state.hextech!.draft!.pending!.offers[0];
              expect(after.candidates[slot].definitionId).not.toBe(command.expectedDefinitionId);
              expect(after.candidates.filter((_, i) => i !== slot)).toEqual(
                before.candidates.filter((_, i) => i !== slot)
              );
              expect(
                validateHextechCommand(state, {
                  ...command,
                  expectedDefinitionId: after.candidates[slot].definitionId,
                })
              ).toContain('已经重抽');
            }
          }
        }
      }
    }
  );
});
