import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  addHeartLiveModifierForSourceMember,
  addLiveModifier,
  addMemberHeartColorSnapshot,
  getMemberEffectiveHeartIcons,
  getMemberOriginalHeartIcons,
  getMemberHeartContributionLifecycleId,
  removeStageMemberBoundLiveModifiers,
  replaceLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addEnergyBelowMember } from '../../src/domain/entities/zone';
import { CardType, HeartColor as H, SlotPosition, ZoneType } from '../../src/shared/types/enums';
import { P1, member, gameWith, stage } from '../helpers/modifier-workflow-fixtures';

function snapshot(game: GameState, id = 'conversion') {
  return addMemberHeartColorSnapshot(game, {
    playerId: P1,
    memberCardId: 'target',
    targetLifecycleId: getMemberHeartContributionLifecycleId(game, 'target'),
    fromColors: [H.RED, H.BLUE],
    toColor: H.PURPLE,
    sourceCardId: 'song',
    abilityId: 'test-snapshot',
    snapshotId: id,
  })!;
}
function count(game: GameState, color: H): number {
  return getMemberEffectiveHeartIcons(game, P1, 'target')
    .filter((heart) => heart.color === color)
    .reduce((total, heart) => total + heart.count, 0);
}
function setup(
  code = 'TARGET',
  hearts = [
    { color: H.RED, count: 2 },
    { color: H.BLUE, count: 1 },
    { color: H.PURPLE, count: 3 },
  ]
) {
  const target = member(code, 'target', P1, { hearts });
  return stage(gameWith([target]), [target]);
}

describe('fixed member Heart color contribution snapshot (current user ruling)', () => {
  it('converts original and existing member gains, leaving PLAYER Hearts and all later additions untouched', () => {
    let game = setup();
    game = addHeartLiveModifierForSourceMember(game, {
      playerId: P1,
      sourceCardId: 'target',
      abilityId: 'same-ability',
      hearts: [{ color: H.RED, count: 2 }],
    })!.gameState;
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'PLAYER',
      playerId: P1,
      hearts: [{ color: H.RED, count: 8 }],
    });
    const result = snapshot(game);
    expect(result.convertedHeartCount).toBe(5);
    expect(count(result.gameState, H.PURPLE)).toBe(8);
    expect(count(result.gameState, H.RED)).toBe(0);
    expect(getMemberOriginalHeartIcons(result.gameState, P1, 'target')).toEqual(
      getMemberOriginalHeartIcons(game, P1, 'target')
    );
    const after = addHeartLiveModifierForSourceMember(result.gameState, {
      playerId: P1,
      sourceCardId: 'target',
      abilityId: 'same-ability',
      hearts: [{ color: H.RED, count: 2 }],
    })!.gameState;
    expect(count(after, H.RED)).toBe(2);
    expect(count(after, H.PURPLE)).toBe(8);
  });
  it('does not convert Hearts introduced by a later original replacement', () => {
    const converted = snapshot(setup()).gameState;
    const after = replaceLiveModifier(
      converted,
      {
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
        playerId: P1,
        sourceCardId: 'later-song',
        abilityId: 'later-replacement',
      },
      {
        kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
        playerId: P1,
        memberCardId: 'target',
        color: H.RED,
        sourceCardId: 'later-song',
        abilityId: 'later-replacement',
      }
    );
    expect(count(after, H.RED)).toBe(6);
    expect(count(after, H.PURPLE)).toBe(0);
  });
  it('captures an existing original replacement by identity without overwriting original-Heart semantics', () => {
    const game = addLiveModifier(setup(), {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: P1,
      memberCardId: 'target',
      color: H.BLUE,
    });
    const converted = snapshot(game);
    expect(converted.convertedHeartCount).toBe(6);
    expect(getMemberOriginalHeartIcons(converted.gameState, P1, 'target')).toEqual([
      { color: H.BLUE, count: 6 },
    ]);
    expect(count(converted.gameState, H.PURPLE)).toBe(6);
  });
  it('caps continuous contributions at the captured quantity and removes their converted Hearts when they disappear', () => {
    let game = setup('PL!N-bp7-007-SEC', []);
    game = registerCards(
      game,
      Array.from({ length: 3 }, (_, i) =>
        createCardInstance(
          { cardCode: `ENERGY-${i}`, name: 'test energy', cardType: CardType.ENERGY },
          P1,
          `energy-${i}`
        )
      )
    );
    const setEnergyCount = (state: GameState, n: number) =>
      updatePlayer(state, P1, (player) => {
        let slots: typeof player.memberSlots = {
          ...player.memberSlots,
          energyBelow: { ...player.memberSlots.energyBelow, [SlotPosition.LEFT]: [] },
        };
        for (let i = 0; i < n; i++)
          slots = addEnergyBelowMember(slots, SlotPosition.LEFT, `energy-${i}`);
        return { ...player, memberSlots: slots };
      });
    game = setEnergyCount(game, 2);
    const converted = snapshot(game);
    expect(converted.convertedHeartCount).toBe(2);
    expect(count(converted.gameState, H.PURPLE)).toBe(2);
    const afterGain = setEnergyCount(converted.gameState, 3);
    expect(count(afterGain, H.PURPLE)).toBe(2);
    expect(count(afterGain, H.RED)).toBe(1);
    const afterLoss = setEnergyCount(afterGain, 0);
    expect(count(afterLoss, H.PURPLE)).toBe(0);
    expect(count(afterLoss, H.RED)).toBe(0);
  });
  it('does not count already converted purple Hearts again in a second snapshot', () => {
    let game = snapshot(setup()).gameState;
    game = addHeartLiveModifierForSourceMember(game, {
      abilityId: 'synthetic-heart-gain',
      playerId: P1,
      sourceCardId: 'target',
      hearts: [{ color: H.BLUE, count: 2 }],
    })!.gameState;
    const second = snapshot(game, 'second-conversion');
    expect(second.convertedHeartCount).toBe(2);
    expect(count(second.gameState, H.PURPLE)).toBe(8);
    expect(snapshot(second.gameState, 'third-conversion').convertedHeartCount).toBe(0);
  });
  it('binds the snapshot to the target rules object, and ordinary leave-stage cleanup removes it', () => {
    const game = snapshot(setup()).gameState;
    const reentered = emitGameEvent(
      game,
      createEnterStageEvent('target', ZoneType.WAITING_ROOM, SlotPosition.LEFT, P1, P1)
    );
    expect(count(reentered, H.RED)).toBe(2);
    expect(count(reentered, H.BLUE)).toBe(1);
    const cleaned = removeStageMemberBoundLiveModifiers(game, ['target']);
    expect(
      cleaned.liveResolution.liveModifiers.some(
        (item) => item.kind === 'MEMBER_HEART_COLOR_SNAPSHOT'
      )
    ).toBe(false);
    expect(count(cleaned, H.RED)).toBe(2);
  });
  it('keeps the effective-color query read-only', () => {
    const game = snapshot(setup()).gameState;
    const before = globalThis.structuredClone(game);
    getMemberEffectiveHeartIcons(game, P1, 'target');
    expect(game).toEqual(before);
  });
});
