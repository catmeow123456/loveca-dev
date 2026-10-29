import { describe, expect, it } from 'vitest';
import { PL_BP8_025_LIVE_START_NICO_STRICT_ATTRIBUTE_LEADS_SCORE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { returnLiveZoneCardToHandForPlayer } from '../../src/application/card-effects/runtime/actions';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  getCardById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import {
  createEnterLiveZoneEvent,
  createEnterStageEvent,
} from '../../src/domain/events/game-events';
import { addLiveModifier, getLiveCardScoreModifier } from '../../src/domain/rules/live-modifiers';
import {
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  ZoneType,
} from '../../src/shared/types/enums';
import { member, P1, P2 } from '../helpers/modifier-workflow-fixtures';
import {
  confirmOctober29Live as confirm,
  october29LiveGame,
  queueOctober29Live as queue,
  resolveOctober29Live as resolve,
} from '../helpers/october-29-live-workflow';
import { createOctober29DraftCard } from '../helpers/october-29-draft-effects';

const nico = (hearts = 4, blade = 4, cost = 10, id = 'nico', name = '矢澤にこ') =>
  member('SYNTHETIC-NICO', id, P1, {
    name,
    hearts: [{ color: HeartColor.PINK, count: hearts }],
    blade,
    cost,
  });
const other = (hearts = 3, blade = 3, cost = 9, id = 'opponent') =>
  member('SYNTHETIC-OTHER', id, P2, {
    hearts: [{ color: HeartColor.RED, count: hearts }],
    blade,
    cost,
  });
const score = (game: GameState) => getLiveCardScoreModifier(game.liveResolution, 'source-live');

describe('PL!-bp8-025 分数7「日香风♡女子之道」', () => {
  it('combines continuous Hearts with current original HEART/BLADE replacements after the choice opens', () => {
    const ai = createOctober29DraftCard('PL!N-bp8-005', P1, 'ai');
    const { game } = october29LiveGame('PL!-bp8-025', [nico(1, 1, 1), ai], [other()]);
    let selection = resolve(queue(game));
    selection = addLiveModifier(selection, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: P1,
      memberCardId: 'nico',
      hearts: [{ color: HeartColor.RAINBOW, count: 7 }],
      sourceCardId: 'foreign',
      abilityId: 'replace-heart',
    });
    selection = addLiveModifier(selection, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P1,
      memberCardId: 'nico',
      count: 8,
      sourceCardId: 'foreign',
      abilityId: 'replace-blade',
    });
    selection = addLiveModifier(selection, {
      kind: 'MEMBER_COST_SET',
      playerId: P1,
      memberCardId: 'nico',
      setTo: 11,
      sourceCardId: 'foreign',
      abilityId: 'set-cost',
    });
    expect(score(confirm(selection, 'nico'))).toBe(3);
  });
  it.each([
    [3, 3, 9, 3],
    [4, 3, 9, 2],
    [4, 4, 9, 1],
    [4, 4, 10, 0],
    [5, 5, 11, 0],
  ])(
    'compares effective HEART/BLADE/cost strictly against every other member (%s,%s,%s)',
    (h, b, c, bonus) => {
      const { game } = october29LiveGame('PL!-bp8-025', [nico()], [other(h, b, c)]);
      const selection = resolve(queue(game));
      expect(selection.activeEffect).toMatchObject({
        abilityId: ABILITY,
        selectableCardIds: ['nico'],
        canSkipSelection: false,
      });
      expect(selection.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
      const state = confirm(selection, 'nico');
      expect(score(state)).toBe(bonus);
      expect(state.liveResolution.playerScores.get(P1)).toBe(7 + bonus);
      expect(state.pendingAbilities).toEqual([]);
      expect(state.activeEffect).toBeNull();
    }
  );

  it('uses current temporary/replaced attributes and compares waiting own members too', () => {
    let { game } = october29LiveGame(
      'PL!-bp8-025',
      [nico(1, 1, 1), member('SYN-OWN', 'own', P1, { hearts: [], blade: 0, cost: 0 })],
      [other(3, 3, 9)]
    );
    game = addLiveModifier(game, {
      kind: 'HEART',
      playerId: P1,
      target: 'TARGET_MEMBER',
      targetMemberCardId: 'nico',
      hearts: [{ color: HeartColor.GRAY, count: 3 }],
      sourceCardId: 'foreign',
      abilityId: 'synthetic-heart',
    });
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: P1,
      target: 'TARGET_MEMBER',
      targetMemberCardId: 'nico',
      countDelta: 3,
      sourceCardId: 'foreign',
      abilityId: 'synthetic-blade',
    });
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST_SET',
      playerId: P1,
      memberCardId: 'nico',
      setTo: 10,
      sourceCardId: 'foreign',
      abilityId: 'synthetic-cost',
    });
    let selection = resolve(queue(game));
    expect(score(confirm(selection, 'nico'))).toBe(3);
    // A waiting opponent still participates; no printed-stat or ACTIVE-only shortcut.
    selection = updatePlayer(selection, P2, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        cardStates: new Map(
          [...p.memberSlots.cardStates].map(([id, state]) => [
            id,
            { ...state, orientation: OrientationState.WAITING },
          ])
        ),
      },
    }));
    selection = addLiveModifier(selection, {
      kind: 'MEMBER_COST_SET',
      playerId: P2,
      memberCardId: 'opponent',
      setTo: 10,
      sourceCardId: 'foreign',
      abilityId: 'synthetic-cost',
    });
    expect(score(confirm(selection, 'nico'))).toBe(2);
  });

  it('accepts aliases and combination identities; the sole zero-stat member wins all three comparisons', () => {
    for (const name of ['矢泽日香（矢泽妮可）', '矢澤にこ&宮下愛']) {
      const { game } = october29LiveGame('PL!-bp8-025', [nico(0, 0, 0, 'nico', name)]);
      expect(score(confirm(resolve(queue(game)), 'nico'))).toBe(3);
    }
  });

  it('chooses among actual own Nico members and excludes other names, the opponent and memberBelow', () => {
    const first = nico(4, 4, 10),
      second = nico(2, 2, 5, 'nico-2', '妮可');
    let { game } = october29LiveGame('PL!-bp8-025', [first, second], [other()]);
    const selection = resolve(queue(game));
    expect(selection.activeEffect?.selectableCardIds).toEqual(['nico', 'nico-2']);
    expect(score(confirm(selection, 'nico-2'))).toBe(0);
    expect(confirm(selection, 'opponent')).toBe(selection);
    expect(confirm(selection)).toBe(selection);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        slots: { ...p.memberSlots.slots, [SlotPosition.LEFT]: null, [SlotPosition.CENTER]: null },
        memberBelow: { ...p.memberSlots.memberBelow, [SlotPosition.RIGHT]: ['nico', 'nico-2'] },
      },
    }));
    const state = resolve(queue(game));
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
  });

  it('rejects a selected member that left or re-entered before confirmation', () => {
    let { game } = october29LiveGame('PL!-bp8-025', [nico()], [other()]);
    const selection = resolve(queue(game));
    const reentered = emitGameEvent(
      selection,
      createEnterStageEvent('nico', ZoneType.WAITING_ROOM, SlotPosition.LEFT, P1, P1)
    );
    expect(score(confirm(reentered, 'nico'))).toBe(0);
    game = updatePlayer(selection, P1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        slots: { ...p.memberSlots.slots, [SlotPosition.LEFT]: null },
      },
    }));
    expect(score(confirm(game, 'nico'))).toBe(0);
  });

  it('does not grant to a LIVE that left or became a new rules object', () => {
    const { game } = october29LiveGame('PL!-bp8-025', [nico()]);
    const selection = resolve(queue(game));
    const left = returnLiveZoneCardToHandForPlayer(selection, P1, 'source-live')!.gameState;
    expect(score(confirm(left, 'nico'))).toBe(0);
    let back = updatePlayer(left, P1, (p) => ({
      ...p,
      liveZone: addCardToStatefulZone(p.liveZone, 'source-live', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));
    back = emitGameEvent(
      back,
      createEnterLiveZoneEvent('source-live', ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
    expect(score(confirm(back, 'nico'))).toBe(0);
  });

  it('has no extra confirmation in an ordered batch, yet keeps the actual target choice', () => {
    let { game } = october29LiveGame('PL!-bp8-025', [nico()]);
    const second = createCardInstance(
      { ...getCardById(game, 'source-live')!.data, cardCode: 'PL!-bp8-025-SECL' },
      P1,
      'second-live'
    );
    game = registerCards(game, [second]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      liveZone: addCardToStatefulZone(p.liveZone, 'second-live', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));
    const order = resolve(queue(game, false, ['source-live', 'second-live']));
    let state = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(state.activeEffect?.abilityId).toBe(ABILITY);
    state = confirm(state, 'nico');
    expect(state.activeEffect?.abilityId).toBe(ABILITY);
    state = confirm(state, 'nico');
    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.playerScores.get(P1)).toBe(13);
  });
});

import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
