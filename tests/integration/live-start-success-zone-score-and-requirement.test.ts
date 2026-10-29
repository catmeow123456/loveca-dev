import { describe, expect, it } from 'vitest';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import {
  HS_BP8_023_LIVE_START_EDELNOTE_SUCCESS_SCORE_REQUIREMENT_ABILITY_ID as EDEL,
  PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID as SONG,
} from '../../src/application/card-effects/ability-ids';
import { returnLiveZoneCardToHandForPlayer } from '../../src/application/card-effects/runtime/actions';
import { createCardInstance, type LiveCardData } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  getCardById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { createEnterLiveZoneEvent } from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getLiveCardRequirementModifiers,
  getLiveCardScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import { LiveResolver } from '../../src/domain/rules/live-resolver';
import { HeartPool } from '../../src/domain/value-objects/heart';
import { FaceState, HeartColor, OrientationState, ZoneType } from '../../src/shared/types/enums';
import {
  createOctober29DraftCard,
  getOctober29LiveData,
} from '../helpers/october-29-draft-effects';
import { liveZone, member, P1, P2 } from '../helpers/modifier-workflow-fixtures';
import {
  confirmOctober29Live as confirm,
  october29LiveGame,
  queueOctober29Live as queue,
  resolveOctober29Live as resolve,
} from '../helpers/october-29-live-workflow';

function withSuccess(game: GameState, count: number, unitName = '「EdelNote」') {
  const cards = Array.from({ length: count }, (_, i) =>
    member(`SYN-SUCCESS-${i}`, `success-${i}`, P1, { unitName })
  );
  return updatePlayer(registerCards(game, cards), P1, (p) => ({
    ...p,
    successZone: { ...p.successZone, cardIds: cards.map((c) => c.instanceId) },
  }));
}
function requirement(game: GameState) {
  const data = getCardById(game, 'source-live')!.data as LiveCardData;
  return applyHeartRequirementModifiers(
    data.requirements,
    getLiveCardRequirementModifiers(game.liveResolution, 'source-live')
  );
}

describe('LIVE start success-zone score and requirement family', () => {
  it.each([0, 1, 2])(
    'EdelinieN counts %s owned matching cards of any type and changes only this LIVE',
    (count) => {
      let { game } = october29LiveGame('PL!HS-bp8-023');
      game = withSuccess(game, count);
      const wrongUnit = member('SYN-WRONG-UNIT', 'wrong-unit', P1, {
        unitName: 'DOLLCHESTRA',
        cardText: 'Edel Note',
      });
      const wrongOwner = member('SYN-WRONG-OWNER', 'wrong-owner', P2, { unitName: '「EdelNote」' });
      const offZone = member('SYN-OFF-ZONE', 'off-zone', P1, { unitName: '「EdelNote」' });
      game = registerCards(game, [wrongUnit, wrongOwner, offZone]);
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        successZone: {
          ...p.successZone,
          cardIds: [
            ...p.successZone.cardIds,
            ...p.successZone.cardIds,
            'wrong-unit',
            'wrong-owner',
          ],
        },
      }));
      const preview = resolve(queue(game));
      expect(preview.activeEffect).toMatchObject({
        abilityId: EDEL,
        metadata: { confirmOnlyPendingAbility: true },
      });
      expect(getLiveCardScoreModifier(preview.liveResolution, 'source-live')).toBe(0);
      const state = confirm(preview);
      expect(getLiveCardScoreModifier(state.liveResolution, 'source-live')).toBe(count * 3);
      expect(state.liveResolution.playerScores.get(P1)).toBe(3 + count * 3);
      expect(requirement(state).colorRequirements.get(HeartColor.PURPLE)).toBe(4 + count * 3);
      expect(requirement(state).colorRequirements.get(HeartColor.RAINBOW)).toBe(2 + count * 3);
      expect(requirement(state).totalRequired).toBe(6 + count * 6);
      const live = { ...getOctober29LiveData('PL!HS-bp8-023'), requirements: requirement(state) };
      const pool = HeartPool.fromHeartIcons([
        { color: HeartColor.PURPLE, count: 4 + count * 3 },
        { color: HeartColor.GRAY, count: 2 + count * 3 },
      ]);
      expect(new LiveResolver().judgeSingleLive('source-live', live, pool).isSuccess).toBe(true);
      expect(state.pendingAbilities).toEqual([]);
      expect(state.activeEffect).toBeNull();
    }
  );

  it('preserves outside modifiers and reevaluates current successful cards after preview', () => {
    let { game } = october29LiveGame('PL!HS-bp8-023');
    game = withSuccess(game, 2);
    game = addLiveModifier(game, {
      kind: 'REQUIREMENT',
      liveCardId: 'source-live',
      sourceCardId: 'other',
      abilityId: 'other-requirement',
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: 1 }],
    });
    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: 'source-live',
      sourceCardId: 'other',
      abilityId: 'other-score',
      countDelta: 2,
    });
    const preview = resolve(queue(game));
    const changed = updatePlayer(preview, P1, (p) => ({
      ...p,
      successZone: { ...p.successZone, cardIds: ['success-1'] },
    }));
    const state = confirm(changed);
    expect(getLiveCardScoreModifier(state.liveResolution, 'source-live')).toBe(5);
    expect(requirement(state).colorRequirements.get(HeartColor.RAINBOW)).toBe(6);
    expect(
      state.liveResolution.liveModifiers.filter((m) => m.abilityId?.startsWith('other-'))
    ).toHaveLength(2);
    expect(confirmActiveEffectStep(state, P1, preview.activeEffect!.id)).toBe(state);
  });

  it('does not write score or requirements to a left, face-down, or re-entered LIVE', () => {
    const { game } = october29LiveGame('PL!HS-bp8-023');
    const preview = resolve(queue(withSuccess(game, 1)));
    const left = returnLiveZoneCardToHandForPlayer(preview, P1, 'source-live')!.gameState;
    let reentered = liveZone(left, getCardById(left, 'source-live')!);
    reentered = emitGameEvent(
      reentered,
      createEnterLiveZoneEvent('source-live', ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
    const down = updatePlayer(preview, P1, (p) => ({
      ...p,
      liveZone: {
        ...p.liveZone,
        cardStates: new Map([
          ['source-live', { face: FaceState.FACE_DOWN, orientation: OrientationState.ACTIVE }],
        ]),
      },
    }));
    for (const candidate of [left, reentered, down]) {
      const state = confirm(candidate);
      expect(getLiveCardScoreModifier(state.liveResolution, 'source-live')).toBe(0);
      expect(getLiveCardRequirementModifiers(state.liveResolution, 'source-live')).toEqual([]);
      expect(state.pendingAbilities).toEqual([]);
    }
  });

  it.each(['PL!-bp5-022-L', 'PL!-bp5-022-SRL'])(
    'keeps the migrated old card %s score+2 and four requirement colors per success card',
    (code) => {
      const { game } = october29LiveGame(code);
      const state = confirm(resolve(queue(withSuccess(game, 2, 'Other unit'))));
      expect(getLiveCardScoreModifier(state.liveResolution, 'source-live')).toBe(4);
      expect(state.liveResolution.playerScores.get(P1)).toBe(9);
      expect(requirement(state).totalRequired).toBe(20);
      expect(getLiveCardRequirementModifiers(state.liveResolution, 'source-live')).toEqual([
        { color: HeartColor.PINK, countDelta: 2 },
        { color: HeartColor.YELLOW, countDelta: 2 },
        { color: HeartColor.PURPLE, countDelta: 2 },
        { color: HeartColor.RAINBOW, countDelta: 2 },
      ]);
    }
  );

  it('resolves an ordered mixed-family batch without more confirmations and manual selection with one confirmation', () => {
    let { game } = october29LiveGame('PL!HS-bp8-023');
    const old = createOctober29DraftCard('PL!-bp5-022', P1, 'old');
    game = liveZone(registerCards(withSuccess(game, 1), [old]), old);
    const order = resolve(queue(game, false, ['source-live', 'old']));
    const manual = confirm(order, 'old');
    expect(manual.activeEffect?.abilityId).toBe(SONG);
    expect(manual.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    const manualDone = confirm(manual);
    expect(getLiveCardScoreModifier(manualDone.liveResolution, 'old')).toBe(2);
    const all = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(all.activeEffect).toBeNull();
    expect(all.pendingAbilities).toEqual([]);
    expect(getLiveCardScoreModifier(all.liveResolution, 'source-live')).toBe(3);
    expect(getLiveCardScoreModifier(all.liveResolution, 'old')).toBe(2);
  });
});
