import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createDefaultCardState,
  createFaceDownCardState,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  collectLiveModifiers,
  getLiveCardRequirementModifiers,
} from '../../src/domain/rules/live-modifiers';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { PL_BP8_001_CONTINUOUS_SUCCESS_SCORE_SIX_LOW_SCORE_MUSE_LIVE_REQUIREMENT_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';

function member(code: string): MemberCardData {
  return {
    cardCode: code,
    name: '高坂穂乃果',
    cardType: CardType.MEMBER,
    groupNames: ['μ’s'],
    cost: 11,
    blade: 4,
    hearts: [],
  };
}
function live(code: string, score: number, group = 'μ’s'): LiveCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.LIVE,
    groupNames: [group],
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1, [HeartColor.GRAY]: 2 }),
  };
}
function setup(score = 6, code = 'PL!-bp8-001-R') {
  const source = createCardInstance(member(code), 'p1', 'honoka');
  const success = createCardInstance(live('SUCCESS', score), 'p1', 'success');
  const target = createCardInstance(live('LOW', 4), 'p1', 'low');
  const high = createCardInstance(live('HIGH', 5), 'p1', 'high');
  const other = createCardInstance(live('OTHER', 3, 'Aqours'), 'p1', 'other');
  const opponent = createCardInstance(live('OPPONENT', 4), 'p2', 'opponent');
  let game = registerCards(createGameState('honoka-requirement', 'p1', 'P1', 'p2', 'P2'), [
    source,
    success,
    target,
    high,
    other,
    opponent,
  ]);
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, source.instanceId),
    successZone: addCardToZone(p.successZone, success.instanceId),
    liveZone: [target, high, other].reduce(
      (z, c) => addCardToStatefulZone(z, c.instanceId, createFaceDownCardState()),
      p.liveZone
    ),
  }));
  game = updatePlayer(game, 'p2', (p) => ({
    ...p,
    liveZone: addCardToStatefulZone(p.liveZone, opponent.instanceId, createDefaultCardState()),
  }));
  return { game, source, success, target, high, other, opponent };
}
function reductions(game: ReturnType<typeof setup>['game']) {
  return collectLiveModifiers(game).filter((m) => m.abilityId === ABILITY);
}

describe('PL!-bp8-001 费用11「高坂穂乃果」 continuous requirements', () => {
  it.each(['R', 'P', 'SEC', 'R＋'])(
    'covers %s and only own printed-score-four-or-less μ’s LIVE cards',
    (rare) => {
      let { game, target, high } = setup(6, `PL!-bp8-001-${rare}`);
      game = addLiveModifier(game, {
        kind: 'SCORE',
        liveCardId: target.instanceId,
        sourceCardId: target.instanceId,
        abilityId: 'test:raise',
        countDelta: 2,
      });
      game = addLiveModifier(game, {
        kind: 'SCORE',
        liveCardId: high.instanceId,
        sourceCardId: high.instanceId,
        abilityId: 'test:lower',
        countDelta: -2,
      });
      expect(reductions(game)).toEqual([
        expect.objectContaining({
          kind: 'REQUIREMENT',
          liveCardId: target.instanceId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
        }),
      ]);
      expect(game.pendingAbilities).toEqual([]);
    }
  );

  it('uses the effect-specific success score query including bp8 Umi and requires six', () => {
    let { game } = setup(4);
    expect(reductions(game)).toEqual([]);
    const umi = createCardInstance(member('PL!-bp8-013-R'), 'p1', 'umi');
    game = registerCards(game, [umi]);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, umi.instanceId),
    }));
    expect(reductions(game)).toHaveLength(1);
    expect(reductions(setup(5).game)).toEqual([]);
  });

  it('stacks distinct stage copies and removes the contribution when each leaves stage', () => {
    let { game, target } = setup();
    const second = createCardInstance(member('PL!-bp8-001-P'), 'p1', 'second');
    game = registerCards(game, [second]);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, second.instanceId),
    }));
    expect(reductions(game)).toHaveLength(2);
    const requirement = applyHeartRequirementModifiers(
      target.data.requirements,
      getLiveCardRequirementModifiers(
        game.liveResolution,
        target.instanceId,
        collectLiveModifiers(game)
      )
    );
    expect(requirement.totalRequired).toBe(1);
    expect(requirement.colorRequirements.get(HeartColor.PINK)).toBe(1);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    expect(reductions(game)).toHaveLength(1);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT),
    }));
    expect(reductions(game)).toEqual([]);
  });

  it.each(['explicit', 'total-only'])(
    'reduces generic demand without touching specified colors: %s',
    (shape) => {
      const { game, target } = setup();
      const requirement =
        shape === 'explicit'
          ? target.data.requirements
          : { ...target.data.requirements, colorRequirements: new Map([[HeartColor.PINK, 1]]) };
      const result = applyHeartRequirementModifiers(
        requirement,
        getLiveCardRequirementModifiers(
          game.liveResolution,
          target.instanceId,
          collectLiveModifiers(game)
        )
      );
      expect(result.totalRequired).toBe(2);
      expect(result.colorRequirements.get(HeartColor.PINK)).toBe(1);
      expect(result.colorRequirements.get(HeartColor.RAINBOW)).toBe(1);
    }
  );

  it('hides requirement targets until all dependent LIVE cards are revealed', () => {
    let { game, target } = setup();
    const id = createPublicObjectId(target.instanceId);
    expect(projectPlayerViewState(game, 'p1').match.liveResult?.requirementModifiers[id]).toEqual([
      { color: HeartColor.RAINBOW, countDelta: -1 },
    ]);
    expect(
      projectPlayerViewState(game, 'p2').match.liveResult?.requirementModifiers[id]
    ).toBeUndefined();
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      liveZone: {
        ...p.liveZone,
        cardStates: new Map(p.liveZone.cardIds.map((cardId) => [cardId, createDefaultCardState()])),
      },
    }));
    expect(projectPlayerViewState(game, 'p2').match.liveResult?.requirementModifiers[id]).toEqual([
      { color: HeartColor.RAINBOW, countDelta: -1 },
    ]);
  });
});
