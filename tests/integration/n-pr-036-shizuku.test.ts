import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_PR_036_LIVE_START_OTHER_NIJIGASAKI_YELLOW_HEART_ABILITY_ID as ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { LiveResolver } from '../../src/domain/rules/live-resolver';
import { HeartPool } from '../../src/domain/value-objects/heart';
import { stackMemberCardBelowStageMember } from '../../src/application/card-effects/runtime/actions';
import { GameService } from '../../src/application/game-service';
import {
  createCardInstance,
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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const TEXT =
  '【LIVE开始时】LIVE结束时为止，存在于自己的舞台的1名其他的『虹咲』的成员获得[黄ハート]。该成员的费用大于等于15的场合，再获得[黄ハート]。';
function member(cardCode: string, cost: number, group = '虹ヶ咲'): MemberCardData {
  return {
    cardCode,
    name: cardCode === 'PL!N-PR-036-PR' ? '樱坂雫' : cardCode,
    cardType: CardType.MEMBER,
    groupNames: [group],
    cost,
    blade: 1,
    hearts: [],
  };
}
function setup(cost = 14, delta = 0, sourceCode = 'PL!N-PR-036-PR') {
  const source = createCardInstance(member(sourceCode, 2), P1, 'shizuku');
  const target = createCardInstance(member('TARGET', cost), P1, 'target');
  const other = createCardInstance(member('OTHER', 20, 'Aqours'), P1, 'other');
  const opponent = createCardInstance(member('OPPONENT', 20), P2, 'opponent');
  let game = registerCards(createGameState('shizuku-test', P1, P1, P2, P2), [
    source,
    target,
    other,
    opponent,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    for (const [slot, id] of [
      [SlotPosition.CENTER, source.instanceId],
      [SlotPosition.LEFT, target.instanceId],
      [SlotPosition.RIGHT, other.instanceId],
    ] as const) {
      memberSlots = placeCardInSlot(memberSlots, slot, id, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P1,
      liveModifiers:
        delta === 0
          ? []
          : [
              {
                kind: 'MEMBER_COST',
                playerId: P1,
                memberCardId: target.instanceId,
                countDelta: delta,
                sourceCardId: source.instanceId,
                abilityId: 'test-cost',
              },
            ],
    },
  };
  return { game, source, target };
}
function start(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return resolvePendingCardEffects(result.gameState).gameState;
}
function choose(game: GameState, id?: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, id);
}
function yellow(game: GameState, id: string) {
  return getMemberEffectiveHeartIcons(game, P1, id)
    .filter((heart) => heart.color === HeartColor.YELLOW)
    .reduce((sum, heart) => sum + heart.count, 0);
}
function leave(game: GameState, id: string) {
  const result = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    game,
    P1,
    id,
    enqueueTriggeredCardEffects
  );
  expect(result).not.toBeNull();
  return result!.gameState;
}

describe('PL!N-PR-036 费用2 樱坂雫', () => {
  it.each(['PR', 'SEC', 'UNSEEN'])('registers complete text and all rarities: %s', (rare) => {
    const definition = getCardAbilityDefinitionsForCardCode(`PL!N-PR-036-${rare}`).find(
      (item) => item.abilityId === ABILITY_ID
    );
    expect(definition).toMatchObject({
      baseCardCodes: ['PL!N-PR-036'],
      queued: true,
      implemented: true,
      effectText: TEXT,
    });
    const started = start(setup(14, 0, `PL!N-PR-036-${rare}`).game);
    expect(started.activeEffect).toMatchObject({
      effectText: TEXT,
      selectableCardIds: ['target'],
      canSkipSelection: false,
      confirmSelectionLabel: '获得[黄ハート]',
    });
    expect(yellow(choose(started, 'target'), 'target')).toBe(1);
  });
  it.each([
    [14, 0, 1],
    [15, 0, 2],
    [14, 1, 2],
    [15, -1, 1],
  ])('uses effective cost %i with delta %i to grant %i Hearts', (cost, delta, count) => {
    const started = start(setup(cost, delta).game);
    const resolved = choose(started, 'target');
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(yellow(resolved, 'target')).toBe(count);
    expect(yellow(resolved, 'shizuku')).toBe(0);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: P1,
      sourceCardId: 'shizuku',
      targetMemberCardId: 'target',
      abilityId: ABILITY_ID,
      hearts: [{ color: HeartColor.YELLOW, count }],
    });
  });
  it('rejects skip, source, opponent and wrong-group choices without advancing', () => {
    const started = start(setup().game);
    for (const id of [undefined, 'shizuku', 'opponent', 'other', 'unknown']) {
      const rejected = choose(started, id);
      expect(rejected.activeEffect?.id).toBe(started.activeEffect?.id);
      expect(yellow(rejected, 'target')).toBe(0);
    }
  });
  it('rechecks cost at selection instead of using a window snapshot', () => {
    const started = start(setup(14).game);
    const changed: GameState = {
      ...started,
      liveResolution: {
        ...started.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: P1,
            memberCardId: 'target',
            countDelta: 1,
            sourceCardId: 'shizuku',
            abilityId: 'test-cost',
          },
        ],
      },
    };
    expect(yellow(choose(changed, 'target'), 'target')).toBe(2);
  });
  it('confirms no targets and ends when the target disappears', () => {
    const noTarget = start(leave(setup().game, 'target'));
    expect(noTarget.activeEffect?.effectText).toContain('没有可选择的其他');
    expect(choose(noTarget).activeEffect).toBeNull();
    for (const leaving of ['target']) {
      const started = start(setup().game);
      const resolved = choose(leave(started, leaving), 'target');
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(
        resolved.liveResolution.liveModifiers.filter(
          (modifier) => modifier.abilityId === ABILITY_ID
        )
      ).toEqual([]);
    }
  });
  it('resolves an already triggered ability even when its source leaves', () => {
    const started = start(setup(15).game);
    const resolved = choose(leave(started, 'shizuku'), 'target');
    expect(yellow(resolved, 'target')).toBe(2);
    expect(resolved.activeEffect).toBeNull();
  });
  it('does not grant the old selection to a target that left and reentered with the same id', () => {
    const started = start(setup(15).game);
    let changed = leave(started, 'target');
    changed = updatePlayer(changed, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'target', {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    changed = emitGameEvent(changed, {
      eventId: 'target-reenter',
      eventType: TriggerCondition.ON_ENTER_STAGE,
      timestamp: 1,
      cardInstanceId: 'target',
      fromZone: ZoneType.WAITING_ROOM,
      toZone: ZoneType.MEMBER_SLOT,
      toSlot: SlotPosition.LEFT,
      ownerId: P1,
      controllerId: P1,
    });
    const resolved = choose(changed, 'target');
    expect(yellow(resolved, 'target')).toBe(0);
    expect(resolved.activeEffect).toBeNull();
  });
  it('changes the actual LIVE result and removes the bonus when the target becomes a below card', () => {
    const initial = setup(15).game;
    const live: LiveCardData = {
      cardType: CardType.LIVE,
      cardCode: 'TEST-LIVE',
      name: 'test',
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 2 }),
    };
    const succeeds = (game: GameState) =>
      new LiveResolver().judgeSingleLive(
        'test-live',
        live,
        HeartPool.fromHeartIcons(getMemberEffectiveHeartIcons(game, P1, 'target'))
      ).isSuccess;
    expect(succeeds(initial)).toBe(false);
    const resolved = choose(start(initial), 'target');
    expect(succeeds(resolved)).toBe(true);
    const targetLeft = leave(resolved, 'target');
    const stacked = stackMemberCardBelowStageMember(targetLeft, {
      playerId: P1,
      sourceZone: ZoneType.WAITING_ROOM,
      movedCardId: 'target',
      hostCardId: 'shizuku',
      targetSlot: SlotPosition.CENTER,
    });
    expect(stacked).not.toBeNull();
    expect(succeeds(stacked!.gameState)).toBe(false);
    expect(yellow(stacked!.gameState, 'shizuku')).toBe(0);
  });
  it('keeps the target bonus when the source leaves and clears it when the target leaves/reenters', () => {
    const resolved = choose(start(setup(15).game), 'target');
    const sourceLeft = leave(resolved, 'shizuku');
    expect(yellow(sourceLeft, 'target')).toBe(2);
    const targetLeft = leave(sourceLeft, 'target');
    const reentered = updatePlayer(targetLeft, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== 'target'),
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'target', {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    expect(yellow(reentered, 'target')).toBe(0);
    expect(
      reentered.liveResolution.liveModifiers.filter((modifier) => modifier.abilityId === ABILITY_ID)
    ).toEqual([]);
  });
  it('returns to the common pending scheduler after the target resolves', () => {
    const started = start(setup().game);
    const withNext = {
      ...started,
      pendingAbilities: [
        {
          id: 'second-shizuku',
          abilityId: ABILITY_ID,
          sourceCardId: 'shizuku',
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: [],
        },
      ],
    };
    const next = choose(withNext, 'target');
    expect(yellow(next, 'target')).toBe(1);
    expect(next.activeEffect?.id).toBe('second-shizuku');
    const done = choose(next, 'target');
    expect(yellow(done, 'target')).toBe(2);
    expect(done.pendingAbilities).toEqual([]);
  });
});
