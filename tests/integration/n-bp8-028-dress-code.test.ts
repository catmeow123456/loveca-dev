import { describe, expect, it } from 'vitest';
import type { HeartIcon } from '../../src/domain/entities/card';
import { N_BP8_028_LIVE_START_MILL_MEMBER_STAGE_COLORS_REDUCE_REQUIREMENT_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { updatePlayer } from '../../src/domain/entities/game';
import { addCardToZone } from '../../src/domain/entities/zone';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import { getLiveCardRequirementModifiers } from '../../src/domain/rules/live-modifiers';
import { HeartColor as H, TriggerCondition } from '../../src/shared/types/enums';
import {
  P1,
  member,
  live,
  gameWith,
  stage,
  liveZone,
  start,
  sessionFor,
  confirm,
  advanceReveal,
} from '../helpers/modifier-workflow-fixtures';

function setup(hearts: readonly HeartIcon[], nonMember = false, empty = false) {
  const source = live('PL!N-bp8-028-L', 'source');
  const target = nonMember
    ? live('MILLED-LIVE', 'milled')
    : member('MILLED', 'milled', P1, { hearts });
  const stageMembers = [
    member('STAGE-1', 'stage-1', P1, {
      hearts: [
        { color: H.RED, count: 1 },
        { color: H.BLUE, count: 2 },
      ],
    }),
    member('STAGE-2', 'stage-2', P1, { hearts: [{ color: H.YELLOW, count: 1 }] }),
  ];
  let game = liveZone(stage(gameWith([source, target, ...stageMembers]), stageMembers), source);
  if (!empty)
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      mainDeck: addCardToZone(player.mainDeck, target.instanceId),
    }));
  const session = sessionFor(start(game, source, ABILITY));
  return { source, session };
}

describe('PL!N-bp8-028 分数4「Dress Code」', () => {
  it('still mills for an already triggered ability whose source left before it started', () => {
    const { session, source } = setup([{ color: H.RED, count: 2 }]);
    const sourceLeft = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const started = start({ ...sourceLeft, activeEffect: null }, source, ABILITY);
    (session as unknown as { authorityState: typeof started }).authorityState = started;
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.activeEffect!.revealedCardIds).toEqual(['milled']);
    expect(advanceReveal(session).success).toBe(true);
    expect(
      session.state!.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
    expect(
      getLiveCardRequirementModifiers(session.state!.liveResolution, source.instanceId)
    ).toEqual([]);
  });
  it('mills once and reduces only by the distinct positive colors of the milled MEMBER after the dwell', () => {
    const { session, source } = setup([
      { color: H.RED, count: 1 },
      { color: H.BLUE, count: 3 },
      { color: H.RED, count: 2 },
      { color: H.PURPLE, count: 0 },
    ]);
    expect(session.state!.activeEffect!.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(confirm(session, P1).success).toBe(true);
    expect(
      getLiveCardRequirementModifiers(session.state!.liveResolution, source.instanceId)
    ).toEqual([]);
    const events = session.state!.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(events).toHaveLength(1);
    expect(session.state!.activeEffect!.revealedCardIds).toEqual(['milled']);
    expect(advanceReveal(session).success).toBe(true);
    expect(
      getLiveCardRequirementModifiers(session.state!.liveResolution, source.instanceId)
    ).toEqual([{ color: H.RAINBOW, countDelta: -2 }]);
    const requirement = applyHeartRequirementModifiers(
      (source.data as import('../../src/domain/entities/card').LiveCardData).requirements,
      getLiveCardRequirementModifiers(session.state!.liveResolution, source.instanceId)
    );
    expect(requirement.colorRequirements.get(H.BLUE)).toBe(1);
    expect(requirement.totalRequired).toBe(9);
    expect(session.state!.activeEffect).toBeNull();
  });
  it.each([
    [
      [
        { color: H.RED, count: 1 },
        { color: H.PURPLE, count: 1 },
      ],
      false,
    ],
    [[], false],
    [[{ color: H.RED, count: 1 }], true],
  ] as const)('grants no partial coverage or non-MEMBER reduction', (hearts, nonMember) => {
    const { session, source } = setup(hearts, nonMember);
    expect(confirm(session, P1).success).toBe(true);
    expect(advanceReveal(session).success).toBe(true);
    expect(
      getLiveCardRequirementModifiers(session.state!.liveResolution, source.instanceId)
    ).toEqual([]);
  });
  it('does not fabricate a moved card or event for an empty main deck and waiting room', () => {
    const { session, source } = setup([], false, true);
    expect(confirm(session, P1).success).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(
      session.state!.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(0);
    expect(
      getLiveCardRequirementModifiers(session.state!.liveResolution, source.instanceId)
    ).toEqual([]);
  });
  it('retains the completed mill but grants no requirement reduction after its source LIVE leaves', () => {
    const { session, source } = setup([{ color: H.RED, count: 2 }]);
    expect(confirm(session, P1).success).toBe(true);
    const state = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    (session as unknown as { authorityState: typeof state }).authorityState = state;
    expect(advanceReveal(session).success).toBe(true);
    expect(
      session.state!.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
    expect(
      getLiveCardRequirementModifiers(session.state!.liveResolution, source.instanceId)
    ).toEqual([]);
  });
});
