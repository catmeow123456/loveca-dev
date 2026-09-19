import { describe, expect, it } from 'vitest';
import type { GameSession } from '../../src/application/game-session';
import { GameCommandType } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import * as abilities from '../../src/application/card-effects/ability-ids';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import type { AnyCardData, CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { getActiveEnergyIds } from '../../src/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId } from '../../src/online/projector';
import { OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
import {
  buildAiBattleDecision,
  parseAiBattleResponse,
  type AiDecision,
} from '../../src/server/ai-battle/decision';
import {
  getAiFallbackSelection,
  getAiMechanicalSelection,
} from '../../src/server/ai-battle/policy';
import { readFrozenGreenHasunosoraDeck } from '../helpers/ai-curated-decks';
import { P1, P2, setup, stage, replaceHand, decision, submit } from '../helpers/ai-battle-fixture';

const cards = readFrozenGreenHasunosoraDeck().deck.mainDeck;
function card(base: string) {
  const found = cards.find((card) => card.cardCode.startsWith(`PL!HS-${base}-`));
  if (!found) throw Error(base);
  return found;
}
function member(base: string) {
  return card(base) as MemberCardData;
}
function top(session: GameSession, data: AnyCardData[]) {
  const game = session.state!;
  const ids = game.players[0].mainDeck.cardIds.slice(0, data.length);
  data.forEach((value, i) =>
    (game.cardRegistry as Map<string, CardInstance>).set(ids[i]!, {
      ...game.cardRegistry.get(ids[i]!)!,
      data: value,
    })
  );
  return ids;
}
function waiting(session: GameSession, data: AnyCardData[]) {
  const ids = top(session, data);
  const player = session.state!.players[0];
  Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(ids.length) });
  Object.assign(player.waitingRoom, { cardIds: [...player.waitingRoom.cardIds, ...ids] });
  return ids;
}
function pending(session: GameSession, sourceCardId: string, abilityId: string) {
  Object.assign(session.state!, {
    pendingAbilities: [
      {
        id: 'green-pending',
        sourceCardId,
        abilityId,
        controllerId: P1,
        mandatory: true,
        timingId: 'green-timing',
        eventIds: [],
      },
    ],
  });
  Object.assign(session.state!, resolvePendingCardEffects(session.state!).gameState);
}
function pick(session: GameSession, ids: string[]) {
  const current = decision(session);
  submit(session, current, {
    kind: 'CARDS',
    cardRefs: ids.map(
      (id) =>
        current.input.space.candidates.find((c) => c.objectId === createPublicObjectId(id))!.ref
    ),
  });
}
function advanceDisplays(fixture: ReturnType<typeof setup>, playerId = P1) {
  for (let i = 0; i < 5; i++) {
    const query = buildAiBattleDecision(
      fixture.session.state!,
      playerId,
      fixture.session.getPlayerViewState(playerId)!
    );
    if (query.kind === 'WAITING_FOR_TIME') {
      fixture.advanceTime(10_000);
      continue;
    }
    if (
      query.kind === 'DECISION' &&
      ['PUBLIC_DISPLAY', 'EFFECT_CONFIRM'].includes(query.decision.input.purpose)
    ) {
      submit(fixture.session, query.decision, getAiMechanicalSelection(query.decision)!);
      continue;
    }
    return;
  }
  throw Error('Display did not finish');
}
function activation(
  session: GameSession,
  abilityId: string
): { current: AiDecision; ref: string } | undefined {
  const current = decision(session);
  const candidate = current.input.space.candidates.find((c) => {
    const command = current.toCommand({ kind: 'ACTION', actionRef: c.ref }, 0);
    return command.type === GameCommandType.ACTIVATE_ABILITY && command.abilityId === abilityId;
  });
  return candidate ? { current, ref: candidate.ref } : undefined;
}
function activate(session: GameSession, abilityId: string) {
  const action = activation(session, abilityId);
  expect(action).toBeDefined();
  submit(session, action!.current, { kind: 'ACTION', actionRef: action!.ref });
}

describe('green Hasunosora effect decisions use authority commands', () => {
  it.each([false, true])('optional leave-stage recovery preserves each group (skip=%s)', (skip) => {
    const f = setup();
    const source = waiting(f.session, [card('bp6-017')])[0]!;
    const targets = waiting(f.session, [card('sd1-012'), card('PR-014'), card('bp2-022')]);
    const hand = replaceHand(f.session, [card('sd1-012')]);
    pending(f.session, source, abilities.HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID);
    if (skip) {
      submit(f.session, decision(f.session), { kind: 'CARDS', cardRefs: [] });
      expect(f.session.state!.players[0].hand.cardIds).toEqual(hand);
      expect(f.session.state!.activeEffect).toBeNull();
      return;
    }
    pick(f.session, hand);
    const current = decision(f.session);
    expect(current.input.space).toMatchObject({
      kind: 'CARDS',
      min: 0,
      max: 2,
      canSkip: true,
      groups: [
        { min: 0, max: 1 },
        { min: 0, max: 1 },
      ],
    });
    const badRefs = targets
      .slice(0, 2)
      .map(
        (id) =>
          current.input.space.candidates.find((c) => c.objectId === createPublicObjectId(id))!.ref
      );
    expect(() =>
      parseAiBattleResponse(
        current,
        JSON.stringify({ selection: { kind: 'CARDS', cardRefs: badRefs } })
      )
    ).toThrow('grouped');
    const before = f.session.state;
    expect(
      f.session.executeCommand({
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        playerId: P1,
        timestamp: 1000,
        effectId: before!.activeEffect!.id,
        selectedCardIds: targets.slice(0, 2),
      }).success
    ).toBe(false);
    expect(f.session.state).toBe(before);
    pick(f.session, [targets[0]!, targets[2]!]);
    expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(targets)
    );
    advanceDisplays(f, P2);
    expect(f.session.state!.players[0].hand.cardIds).toEqual([targets[0], targets[2]]);
    expect(f.session.state!.activeEffect).toBeNull();
  });

  it.each([false, true])(
    'discard two followed by required available recovery groups (missing member=%s)',
    (missingMember) => {
      const f = setup();
      const source = stage(f.session, member('pb1-020'), SlotPosition.LEFT);
      const targets = waiting(f.session, [
        card('bp2-022'),
        card('bp5-019'),
        card('cl1-009'),
        ...(missingMember ? [] : [card('sd1-012'), card('PR-014')]),
      ]);
      const hand = replaceHand(f.session, [card('bp6-027'), card('bp2-022'), card('bp5-019')]);
      pending(
        f.session,
        source,
        abilities.HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID
      );
      const discard = decision(f.session);
      expect(discard.input.space).toMatchObject({ min: 2, max: 2, canSkip: true });
      const ref = discard.input.space.candidates[0]!.ref;
      for (const refs of [[ref], [ref, ref]])
        expect(() =>
          parseAiBattleResponse(
            discard,
            JSON.stringify({ selection: { kind: 'CARDS', cardRefs: refs } })
          )
        ).toThrow();
      pick(f.session, hand.slice(0, 2));
      const recovery = decision(f.session);
      expect(recovery.input.space).toMatchObject({
        min: missingMember ? 1 : 2,
        max: missingMember ? 1 : 2,
        canSkip: false,
      });
      const choice = getAiFallbackSelection(recovery);
      const command = recovery.toCommand(choice, 1000);
      expect(command.type).toBe(GameCommandType.CONFIRM_EFFECT_STEP);
      if (command.type !== GameCommandType.CONFIRM_EFFECT_STEP) throw Error('Wrong command');
      expect(command.selectedCardIds).toHaveLength(missingMember ? 1 : 2);
      expect(command.selectedCardIds).toContain(targets[0]);
      if (!missingMember) expect(command.selectedCardIds).toContain(targets[3]);
      submit(f.session, recovery, choice);
      advanceDisplays(f);
      expect(f.session.state!.players[0].hand.cardIds).toEqual([
        hand[2],
        ...command.selectedCardIds!,
      ]);
      expect(f.session.state!.activeEffect).toBeNull();
    }
  );

  it('pays two energy, privately chooses the hand LIVE, publicly reveals and recovers its matching name', () => {
    const f = setup();
    stage(f.session, member('bp5-001'), SlotPosition.LEFT);
    const hand = replaceHand(f.session, [card('bp2-022'), card('bp5-019')]);
    const [target] = waiting(f.session, [card('bp2-022')]);
    const energyBefore = getActiveEnergyIds(f.session.state!.players[0].energyZone).length;
    const ability =
      abilities.HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID;
    activate(f.session, ability);
    expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toHaveLength(
      energyBefore - 2
    );
    expect(decision(f.session).input.space.candidates.map((c) => c.objectId)).toEqual([
      createPublicObjectId(hand[0]!),
    ]);
    expect(
      f.session.getPlayerViewState(P2)!.objects[createPublicObjectId(hand[0]!)]?.frontInfo
    ).toBeUndefined();
    pick(f.session, [hand[0]!]);
    expect(f.session.getPlayerViewState(P2)!.objects[createPublicObjectId(hand[0]!)]?.surface).toBe(
      'FRONT'
    );
    advanceDisplays(f);
    pick(f.session, [target!]);
    advanceDisplays(f, P2);
    expect(f.session.state!.players[0].hand.cardIds).toEqual([...hand, target]);
    expect(activation(f.session, ability)).toBeUndefined();
  });

  it.each(['bp5-001', 'bp1-003', 'bp1-002'])(
    'queries activation resources without mutation: %s',
    (base) => {
      const f = setup();
      stage(f.session, member(base), SlotPosition.LEFT);
      replaceHand(f.session, [card('bp2-022')]);
      waiting(f.session, [card('bp2-022'), card('sd1-012')]);
      const before = globalThis.structuredClone(f.session.state);
      const count = f.randomCalls();
      const active = decision(f.session).input.space.candidates.filter((c) =>
        c.description.startsWith('起动')
      );
      expect(active.length).toBeGreaterThan(0);
      expect(f.session.state).toEqual(before);
      expect(f.randomCalls()).toBe(count);
      for (const state of f.session.state!.players[0].energyZone.cardStates.values())
        Object.assign(state, { orientation: OrientationState.WAITING });
      expect(
        decision(f.session).input.space.candidates.filter((c) => c.description.startsWith('起动'))
      ).toEqual([]);
    }
  );

  it('recovers a low-cost member for one energy and enforces the per-turn limit', () => {
    const f = setup();
    stage(f.session, member('bp1-003'), SlotPosition.LEFT);
    const [target] = waiting(f.session, [card('sd1-012'), card('bp5-001')]);
    const ability = abilities.HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID;
    const energy = getActiveEnergyIds(f.session.state!.players[0].energyZone).length;
    activate(f.session, ability);
    expect(decision(f.session).input.space.candidates.map((c) => c.objectId)).toEqual([
      createPublicObjectId(target!),
    ]);
    pick(f.session, [target!]);
    advanceDisplays(f);
    expect(f.session.state!.players[0].hand.cardIds).toContain(target);
    expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toHaveLength(energy - 1);
    expect(activation(f.session, ability)).toBeUndefined();
  });

  it('replaces the source with a chosen waiting-room member in the original slot and continues its on-enter effect', () => {
    const f = setup();
    const source = stage(f.session, member('bp1-002'), SlotPosition.RIGHT);
    const [target] = waiting(f.session, [card('bp6-001')]);
    const topIds = top(f.session, [card('sd1-012'), card('bp2-022'), card('PR-014')]);
    activate(
      f.session,
      abilities.HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
    );
    expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(source);
    expect(decision(f.session).input.space.candidates.map((c) => c.objectId)).toEqual(
      expect.arrayContaining([createPublicObjectId(source), createPublicObjectId(target!)])
    );
    pick(f.session, [target!]);
    expect(f.session.state!.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(target);
    expect(
      f.session.state!.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE && event.cardInstanceId === target
      )
    ).toBe(true);
    advanceDisplays(f);
    const arrange = decision(f.session);
    expect(arrange.input.space).toMatchObject({ min: 1, max: 1, canSkip: false });
    pick(f.session, [topIds[1]!]);
    expect(f.session.state!.players[0].mainDeck.cardIds[0]).toBe(topIds[1]);
    expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([topIds[0], topIds[2]])
    );
    expect(f.session.state!.activeEffect).toBeNull();
  });

  it.each([0, 1, 3])(
    'moves %s non-blade cheer cards and adds the same number of new cheers only after public display',
    (count) => {
      const f = setup();
      const [source] = top(f.session, [card('bp6-027')]);
      const player = f.session.state!.players[0];
      Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(1) });
      Object.assign(player.liveZone, { cardIds: [source] });
      top(f.session, [card('sd1-001'), card('sd1-006'), card('bp1-002'), card('sd1-012')]);
      const cheer = revealCheerCardsFromMainDeck(f.session.state!, P1, 4);
      Object.assign(f.session.state!, cheer.gameState);
      const newTop = top(f.session, [card('sd1-012'), card('PR-014'), card('sd1-009')]);
      pending(f.session, source!, abilities.HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID);
      const current = decision(f.session);
      expect(current.input.space.candidates.map((c) => c.objectId)).toEqual(
        cheer.cheerCardIds.slice(0, 3).map(createPublicObjectId)
      );
      expect(current.input.space).toMatchObject({ min: 0, max: 3, canSkip: true });
      const ids = cheer.cheerCardIds.slice(0, count);
      pick(f.session, [...ids]);
      if (count) {
        expect(f.session.state!.resolutionZone.cardIds).toEqual(cheer.cheerCardIds);
        advanceDisplays(f, P2);
      }
      expect(f.session.state!.resolutionZone.cardIds).toEqual([
        ...cheer.cheerCardIds.slice(count),
        ...newTop.slice(0, count),
      ]);
      expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual(expect.arrayContaining(ids));
      const additional = f.session.state!.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_CHEER && 'additional' in event && event.additional
      );
      expect(additional).toHaveLength(count ? 1 : 0);
      expect(f.session.state!.activeEffect).toBeNull();
      expect(f.session.state!.pendingAbilities).toEqual([]);
    }
  );

  it.each(['bp5-001', 'bp1-003'])(
    'does not offer recovery without a matching target: %s',
    (base) => {
      const f = setup();
      stage(f.session, member(base), SlotPosition.LEFT);
      replaceHand(f.session, [card('bp2-022')]);
      waiting(f.session, [card('bp5-019'), card('sd1-006')]);
      expect(
        decision(f.session).input.space.candidates.filter((c) => c.description.startsWith('起动'))
      ).toEqual([]);
    }
  );

  it.each(['bp6-001', 'cl1-009'])(
    'moves only current revealed cheer cards to the declared destination: %s',
    (base) => {
      const f = setup();
      const source =
        base === 'bp6-001'
          ? stage(f.session, member(base), SlotPosition.LEFT)
          : waiting(f.session, [card(base)])[0]!;
      top(f.session, [card('sd1-012'), card('PR-014'), card('sd1-001')]);
      const cheer = revealCheerCardsFromMainDeck(f.session.state!, P1, 3);
      Object.assign(f.session.state!, cheer.gameState);
      pending(
        f.session,
        source,
        base === 'bp6-001'
          ? abilities.HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID
          : abilities.HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID
      );
      const current = decision(f.session);
      expect(current.input.space.candidates.map((c) => c.objectId)).toEqual(
        (base === 'bp6-001'
          ? cheer.cheerCardIds
          : [cheer.cheerCardIds[0]!, cheer.cheerCardIds[2]!]
        ).map(createPublicObjectId)
      );
      const target = cheer.cheerCardIds[0]!;
      pick(f.session, [target]);
      expect(f.session.state!.resolutionZone.cardIds).toContain(target);
      advanceDisplays(f);
      expect(f.session.state!.resolutionZone.cardIds).not.toContain(target);
      if (base === 'bp6-001') expect(f.session.state!.players[0].mainDeck.cardIds[0]).toBe(target);
      else expect(f.session.state!.players[0].hand.cardIds).toContain(target);
      expect(f.session.state!.activeEffect).toBeNull();
    }
  );

  it('pays source orientation and discard before privately looking and revealing just the selected member', () => {
    const f = setup();
    const source = stage(f.session, member('bp5-008'), SlotPosition.LEFT);
    const hand = replaceHand(f.session, [card('sd1-012')]);
    const topIds = top(f.session, [
      card('sd1-006'),
      card('PR-014'),
      card('bp2-022'),
      card('bp1-003'),
      card('bp5-019'),
    ]);
    pending(f.session, source, abilities.HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID);
    pick(f.session, hand);
    expect(f.session.state!.players[0].memberSlots.cardStates.get(source)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(hand[0]);
    expect(decision(f.session).input.space.candidates.map((c) => c.objectId)).toEqual(
      [topIds[0]!, topIds[3]!].map(createPublicObjectId)
    );
    const other = f.session.getPlayerViewState(P2)!;
    for (const id of topIds)
      expect(other.objects[createPublicObjectId(id)]?.frontInfo).toBeUndefined();
    pick(f.session, [topIds[3]!]);
    advanceDisplays(f);
    expect(f.session.state!.players[0].hand.cardIds).toEqual([topIds[3]]);
    expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(topIds.filter((id) => id !== topIds[3]))
    );
    expect(f.session.state!.inspectionZone.cardIds).toEqual([]);
  });

  it('pays LIVE-start energy for effective BLADE through option references', () => {
    const f = setup();
    const source = stage(f.session, member('sd1-006'), SlotPosition.LEFT);
    const before = getMemberEffectiveBladeCount(f.session.state!, P1, source);
    pending(f.session, source, abilities.HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID);
    const current = decision(f.session);
    const choice = current.input.space.candidates.find((c) => !c.description.includes('不发动'))!;
    submit(f.session, current, { kind: 'ACTION', actionRef: choice.ref });
    expect(getMemberEffectiveBladeCount(f.session.state!, P1, source)).toBe(before + 2);
    expect(getActiveEnergyIds(f.session.state!.players[0].energyZone)).toHaveLength(2);
  });
});
