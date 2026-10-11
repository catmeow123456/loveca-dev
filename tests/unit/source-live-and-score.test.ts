import { describe, expect, it } from 'vitest';
import { N_BP8_030_LIVE_SUCCESS_MILL_FIVE_GAIN_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getAbilitySourceLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { replaceSourceLiveCardScoreModifierAndRefresh } from '../../src/application/card-effects/runtime/live-card-score';
import { isCurrentLiveCardAbilitySource } from '../../src/application/card-effects/runtime/source-live';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { createEnterLiveZoneEvent } from '../../src/domain/events/game-events';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'source-live';
const context = {
  abilityId: N_BP8_030_LIVE_SUCCESS_MILL_FIVE_GAIN_SCORE_ABILITY_ID,
  controllerId: P1,
  sourceCardId: SOURCE_ID,
};

function setup(ownerId = P1): GameState {
  const sourceData: LiveCardData = {
    cardCode: 'PL!N-bp8-030-L',
    name: 'Stay',
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 6 }),
  };
  const source = createCardInstance(sourceData, ownerId, SOURCE_ID);
  let game = registerCards(createGameState('source-live-and-score', P1, 'P1', P2, 'P2'), [source]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, SOURCE_ID, {
      face: FaceState.FACE_UP,
      orientation: OrientationState.ACTIVE,
    }),
  }));
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([
        [P1, 6],
        [P2, 4],
      ]),
      liveResults: new Map([[P1, true]]),
    },
  };
}

describe('current LIVE ability source query', () => {
  it('accepts an own face-up LIVE and rejects another owner, controller, zone, or face', () => {
    const game = setup();
    expect(isCurrentLiveCardAbilitySource(game, context)).toBe(true);
    expect(isCurrentLiveCardAbilitySource(setup(P2), context)).toBe(false);
    expect(isCurrentLiveCardAbilitySource(game, { ...context, controllerId: P2 })).toBe(false);
    expect(isCurrentLiveCardAbilitySource(game, { ...context, sourceCardId: 'missing' })).toBe(
      false
    );
    const memberData: MemberCardData = {
      cardCode: 'PL!N-test-member',
      name: '成员',
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK)],
    };
    expect(
      isCurrentLiveCardAbilitySource(
        registerCards(game, [createCardInstance(memberData, P1, SOURCE_ID)]),
        context
      )
    ).toBe(false);
    expect(
      isCurrentLiveCardAbilitySource(
        updatePlayer(game, P1, (player) => ({
          ...player,
          liveZone: { ...player.liveZone, cardIds: [] },
          successZone: { ...player.successZone, cardIds: [SOURCE_ID] },
        })),
        context
      )
    ).toBe(false);
    expect(
      isCurrentLiveCardAbilitySource(
        updatePlayer(game, P1, (player) => ({
          ...player,
          liveZone: {
            ...player.liveZone,
            cardStates: new Map([
              [SOURCE_ID, { face: FaceState.FACE_DOWN, orientation: OrientationState.ACTIVE }],
            ]),
          },
        })),
        context
      )
    ).toBe(false);
  });

  it('preserves the captured object on LIVE-to-LIVE movement and rejects cross-zone re-entry', () => {
    let game = emitGameEvent(
      setup(),
      createEnterLiveZoneEvent(SOURCE_ID, ZoneType.WAITING_ROOM, P1, P1, FaceState.FACE_UP)
    );
    const sourceLifecycleId = getAbilitySourceLifecycleId(game, context.abilityId, SOURCE_ID);
    const captured = { ...context, sourceLifecycleId };
    game = emitGameEvent(
      game,
      createEnterLiveZoneEvent(SOURCE_ID, ZoneType.LIVE_ZONE, P1, P1, FaceState.FACE_UP)
    );
    expect(isCurrentLiveCardAbilitySource(game, captured)).toBe(true);
    game = emitGameEvent(
      game,
      createEnterLiveZoneEvent(SOURCE_ID, ZoneType.HAND, P1, P1, FaceState.FACE_UP)
    );
    expect(isCurrentLiveCardAbilitySource(game, captured)).toBe(false);
    expect(isCurrentLiveCardAbilitySource(game, context)).toBe(true);
  });
});

describe('source LIVE score replacement and judged-score delta', () => {
  it('adds once, replaces by delta, and removes only this ability bonus', () => {
    let game = setup();
    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: P1,
      countDelta: 2,
      sourceCardId: SOURCE_ID,
      abilityId: 'player-reward',
    });
    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: 'other-live',
      sourceCardId: SOURCE_ID,
      abilityId: context.abilityId,
      countDelta: 3,
    });
    const unrelatedModifiers = game.liveResolution.liveModifiers;
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([
          [P1, 11],
          [P2, 4],
        ]),
      },
    };
    const originalResults = game.liveResolution.liveResults;
    game = replaceSourceLiveCardScoreModifierAndRefresh(game, context, 1);
    expect(game.liveResolution.playerScores.get(P1)).toBe(12);
    expect(game.liveResolution.playerScores.get(P2)).toBe(4);
    expect(game.liveResolution.liveModifiers).toHaveLength(3);
    expect(game.liveResolution.liveModifiers.at(-1)).toMatchObject({
      kind: 'SCORE',
      playerId: P1,
      liveCardId: SOURCE_ID,
      sourceCardId: SOURCE_ID,
      abilityId: context.abilityId,
      countDelta: 1,
    });
    game = replaceSourceLiveCardScoreModifierAndRefresh(game, context, 1);
    expect(game.liveResolution.playerScores.get(P1)).toBe(12);
    expect(game.liveResolution.liveModifiers).toHaveLength(3);
    game = replaceSourceLiveCardScoreModifierAndRefresh(game, context, 2);
    expect(game.liveResolution.playerScores.get(P1)).toBe(13);
    game = replaceSourceLiveCardScoreModifierAndRefresh(game, context, 0);
    expect(game.liveResolution.playerScores.get(P1)).toBe(11);
    expect(game.liveResolution.liveModifiers).toEqual(unrelatedModifiers);
    expect(game.liveResolution.liveResults).toBe(originalResults);
    expect(game.actionHistory).toEqual([]);
    expect(game.pendingAbilities).toEqual([]);
  });
});
