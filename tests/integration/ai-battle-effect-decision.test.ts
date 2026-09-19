import { describe, expect, it } from 'vitest';
import type { GameSession } from '../../src/application/game-session';
import { GameCommandType } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  PL_N_BP3_009_LIVE_START_BOTTOM_TWO_WAITING_MEMBERS_COST_SUM_REWARD_ABILITY_ID,
  START_DASH_LIVE_SUCCESS_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import type { PendingAbilityState } from '../../src/domain/entities/game';
import type { AnyCardData, CardInstance, LiveCardData } from '../../src/domain/entities/card';
import { createHeartRequirement } from '../../src/domain/entities/card';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
  getPlayerLiveScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId } from '../../src/online/projector';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';
import {
  buildAiBattleDecision,
  parseAiBattleResponse,
  type AiDecision,
} from '../../src/server/ai-battle/decision';
import {
  getAiFallbackSelection,
  getAiMechanicalSelection,
} from '../../src/server/ai-battle/policy';
import {
  P1,
  P2,
  setup,
  decision,
  submit,
  replaceHand,
  stage,
  member,
} from '../helpers/ai-battle-fixture';

function live(code = 'LIVE-TEST'): LiveCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.LIVE,
    score: 1,
    groupNames: ["μ's"],
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function putOnTop(session: GameSession, cards: readonly AnyCardData[]) {
  const game = session.state!;
  const ids = game.players[0].mainDeck.cardIds.slice(0, cards.length);
  cards.forEach((data, index) => {
    const id = ids[index]!;
    (game.cardRegistry as Map<string, CardInstance>).set(id, {
      ...game.cardRegistry.get(id)!,
      data,
    });
  });
  return ids;
}

function play(session: GameSession, sourceId: string) {
  const current = decision(session);
  const action = current.input.space.candidates.find(
    (candidate) =>
      candidate.objectId === createPublicObjectId(sourceId) &&
      candidate.targetSlot === SlotPosition.LEFT
  )!;
  submit(session, current, { kind: 'ACTION', actionRef: action.ref });
}

function pending(session: GameSession, sourceCardId: string, abilityId: string, ids = ['pending']) {
  const abilities: PendingAbilityState[] = ids.map((id) => ({
    id,
    sourceCardId,
    abilityId,
    controllerId: P1,
    mandatory: true,
    timingId: 'test-timing',
    eventIds: [id],
  }));
  Object.assign(session.state!, { pendingAbilities: abilities });
  Object.assign(session.state!, resolvePendingCardEffects(session.state!).gameState);
}

function chooseCard(session: GameSession, current: AiDecision, index: number) {
  return submit(session, current, {
    kind: 'CARDS',
    cardRefs: [current.input.space.candidates[index]!.ref],
  });
}

describe('AI effect selections through the normal command pipeline', () => {
  it('accepts a card selection with neutral optional command fields', () => {
    const { session } = setup();
    stage(session, member('old', 9), SlotPosition.LEFT);
    const [source] = replaceHand(session, [member('PL!-sd1-004-SD', 11)]);
    const [target] = putOnTop(session, [live()]);
    play(session, source!);
    const effect = session.state!.activeEffect!;
    expect(effect.selectableCardIds).toContain(target);
    const before = session.state;
    const conflicting = session.executeCommand({
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: P1,
      timestamp: 1000,
      effectId: effect.id,
      selectedCardId: target!,
      selectedOptionId: 'unrelated-option',
    });
    expect(conflicting.success).toBe(false);
    expect(session.state).toBe(before);
    const result = session.executeCommand({
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: P1,
      timestamp: 1000,
      effectId: effect.id,
      selectedCardId: target!,
      selectedSlot: null,
      selectedOptionId: null,
      resolveInOrder: false,
    });
    expect(result.success, result.error).toBe(true);
    expect(session.state!.inspectionZone.revealedCardIds).toContain(target);
    expect(session.state!.players[0].hand.cardIds).not.toContain(target);
  });

  it('keeps an empty optional inspection executable and moves every inspected card to waiting', () => {
    const { session } = setup();
    stage(session, member('old', 9), SlotPosition.LEFT);
    const [source] = replaceHand(session, [member('PL!-sd1-004-SD', 11)]);
    const top = putOnTop(
      session,
      Array.from({ length: 5 }, (_, i) => member(`NO-TARGET-${i}`))
    );
    play(session, source!);
    const current = decision(session);
    expect(current.input.space.candidates).toEqual([]);
    submit(session, current, getAiFallbackSelection(current));
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.inspectionZone.cardIds).toEqual([]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(expect.arrayContaining(top));
  });

  it.each([0, 1])(
    'reveals the hand LIVE before replacing success LIVE option %s',
    (targetIndex) => {
      const { session, advanceTime } = setup();
      stage(session, member('old', 7), SlotPosition.LEFT);
      const [source, handLive] = replaceHand(session, [
        member('PL!-sd1-006-SD', 9),
        live('NEW-LIVE'),
      ]);
      const success = putOnTop(session, [live('SUCCESS-A'), live('SUCCESS-B')]);
      const player = session.state!.players[0];
      Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(2) });
      Object.assign(player.successZone, { cardIds: success });
      play(session, source!);
      const reveal = decision(session);
      expect(getAiMechanicalSelection(reveal)).toBeNull();
      chooseCard(session, reveal, 0);
      const gate = buildAiBattleDecision(session.state!, P1, session.getPlayerViewState(P1)!);
      if (gate.kind !== 'WAITING_FOR_TIME') throw new Error('Expected hand reveal dwell');
      expect(session.state!.players[0].hand.cardIds).toContain(handLive);
      expect(session.state!.players[0].successZone.cardIds).toEqual(success);
      advanceTime(gate.deadlineAt - 1000);
      const display = decision(session);
      submit(session, display, getAiMechanicalSelection(display)!);
      const replace = decision(session);
      expect(replace.input.space).toMatchObject({ kind: 'CARDS', canSkip: false });
      expect(replace.input.space.candidates.map((candidate) => candidate.objectId)).toEqual(
        success.map(createPublicObjectId)
      );
      chooseCard(session, replace, targetIndex);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[0].hand.cardIds).toEqual([success[targetIndex]]);
      expect(session.state!.players[0].successZone.cardIds).toEqual([
        success[1 - targetIndex],
        handLive,
      ]);
    }
  );

  it.each([false, true])(
    'keeps optional one-card payment strategic and resolves mandatory take (pay=%s)',
    (pay) => {
      const { session } = setup();
      stage(session, member('old', 2), SlotPosition.LEFT);
      const [source, discard] = replaceHand(session, [member('PL!-sd1-011-SD', 4), member()]);
      play(session, source!);
      const cost = decision(session);
      expect(cost.input.space).toMatchObject({ kind: 'CARDS', canSkip: true, min: 1, max: 1 });
      expect(cost.input.space.candidates).toHaveLength(1);
      expect(getAiMechanicalSelection(cost)).toBeNull();
      const top = session.state!.players[0].mainDeck.cardIds.slice(0, 3);
      if (!pay) {
        submit(session, cost, getAiFallbackSelection(cost));
        expect(session.state!.players[0].hand.cardIds).toContain(discard);
        expect(session.state!.players[0].mainDeck.cardIds.slice(0, 3)).toEqual(top);
        expect(session.state!.activeEffect).toBeNull();
        return;
      }
      chooseCard(session, cost, 0);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(discard);
      const take = decision(session);
      expect(take.input.space).toMatchObject({ kind: 'CARDS', canSkip: false, min: 1, max: 1 });
      expect(take.input.space.candidates.map((card) => card.objectId)).toEqual(
        top.map(createPublicObjectId)
      );
      expect(() =>
        parseAiBattleResponse(take, JSON.stringify({ selection: { kind: 'CARDS', cardRefs: [] } }))
      ).toThrow();
      // The shared contract also rejects the same incomplete command at normal execution.
      expect(
        session.executeCommand({
          type: GameCommandType.CONFIRM_EFFECT_STEP,
          playerId: P1,
          effectId: session.state!.activeEffect!.id,
          timestamp: 1000,
        }).success
      ).toBe(false);
      chooseCard(session, take, 1);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.inspectionZone.cardIds).toEqual([]);
      expect(session.state!.players[0].hand.cardIds).toEqual([top[1]]);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining([discard, top[0], top[2]])
      );
    }
  );

  it.each([P1, P2])(
    'privately inspects, reveals only the choice, then %s advances the dwell',
    (advancer) => {
      const { session, advanceTime, randomCalls } = setup();
      stage(session, member('old', 9), SlotPosition.LEFT);
      const [source] = replaceHand(session, [member('PL!-sd1-004-SD', 11)]);
      const top = putOnTop(session, [
        live('TARGET-1'),
        member('PRIVATE-1'),
        live('TARGET-2'),
        member('PRIVATE-2'),
        member('PRIVATE-3'),
      ]);
      play(session, source!);
      const before = globalThis.structuredClone(session.state!);
      const calls = randomCalls();
      const current = decision(session);
      expect(current.input.space.candidates.map((card) => card.objectId)).toEqual(
        [top[0], top[2]].map((id) => createPublicObjectId(id!))
      );
      expect(getAiMechanicalSelection(current)).toBeNull();
      expect(getAiFallbackSelection(current)).toEqual({ kind: 'CARDS', cardRefs: [] });
      expect(session.state).toEqual(before);
      expect(randomCalls()).toBe(calls);
      expect(buildAiBattleDecision(session.state!, P2, session.getPlayerViewState(P2)!).kind).toBe(
        'WAITING_FOR_PLAYER'
      );
      for (const id of top)
        expect(
          session.getPlayerViewState(P2)!.objects[createPublicObjectId(id)]?.frontInfo
        ).toBeUndefined();
      chooseCard(session, current, 1);
      expect(session.state!.players[0].hand.cardIds).not.toContain(top[2]);
      expect(session.state!.inspectionZone.revealedCardIds).toEqual([top[2]]);
      for (const id of top) {
        const face = session.getPlayerViewState(P2)!.objects[createPublicObjectId(id)]?.frontInfo;
        if (id === top[2]) expect(face?.cardCode).toBe('TARGET-2');
        else expect(face).toBeUndefined();
      }
      const gate = buildAiBattleDecision(
        session.state!,
        advancer,
        session.getPlayerViewState(advancer)!
      );
      expect(gate.kind).toBe('WAITING_FOR_TIME');
      if (gate.kind !== 'WAITING_FOR_TIME') throw new Error('Expected dwell');
      advanceTime(gate.deadlineAt - 1000);
      const advance = decision(session, advancer);
      const command = submit(session, advance, getAiMechanicalSelection(advance)!);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.inspectionZone.cardIds).toEqual([]);
      expect(session.state!.players[0].hand.cardIds).toEqual([top[2]]);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining(top.filter((id) => id !== top[2]))
      );
      expect(session.executeCommand(command).success).toBe(false);
    }
  );

  it.each([HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE])(
    'pays first, offers the full fixed-color set and applies %s after public display',
    (color) => {
      const { session, advanceTime } = setup();
      const source = stage(session, member('PL!-sd1-003-SD', 13), SlotPosition.CENTER);
      const [discard] = replaceHand(session, [member()]);
      pending(session, source, KOTORI_LIVE_START_HEART_ABILITY_ID);
      chooseCard(session, decision(session), 0);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(discard);
      const current = decision(session);
      const choices = current.input.space.candidates.map((candidate) =>
        current.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000)
      );
      expect(
        choices.map((command) =>
          command.type === GameCommandType.CONFIRM_EFFECT_STEP
            ? command.selectedEffectOptionIds
            : undefined
        )
      ).toEqual([[HeartColor.PINK], [HeartColor.YELLOW], [HeartColor.PURPLE]]);
      expect(getAiMechanicalSelection(current)).toBeNull();
      const index = [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE].indexOf(color);
      submit(session, current, {
        kind: 'ACTION',
        actionRef: current.input.space.candidates[index]!.ref,
      });
      expect(session.state!.liveResolution.liveModifiers).toEqual([]);
      const gate = buildAiBattleDecision(session.state!, P2, session.getPlayerViewState(P2)!);
      if (gate.kind !== 'WAITING_FOR_TIME') throw new Error('Expected public effect choice');
      advanceTime(gate.deadlineAt - 1000);
      const advance = decision(session, P2);
      submit(session, advance, getAiMechanicalSelection(advance)!);
      expect(session.state!.activeEffect).toBeNull();
      const hearts = getMemberEffectiveHeartIcons(
        session.state!,
        P1,
        source,
        collectLiveModifiers(session.state!)
      );
      expect(
        hearts.filter((heart) => heart.color === color).reduce((sum, heart) => sum + heart.count, 0)
      ).toBe(color === HeartColor.PINK ? 2 : 1);
    }
  );

  it.each([HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE])(
    'offers BP3 success-count Heart choices to AI and applies %s after public display',
    (color) => {
      const { session, advanceTime } = setup();
      const source = stage(session, member('PL!-bp3-012-N', 2), SlotPosition.LEFT);
      const [successLive] = putOnTop(session, [live('SUCCESS-LIVE')]);
      const player = session.state!.players[0];
      Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(1) });
      Object.assign(player.successZone, { cardIds: [successLive] });
      pending(
        session,
        source,
        BP3_LIVE_START_SUCCESS_COUNT_CHOOSE_PINK_YELLOW_PURPLE_HEART_ABILITY_ID
      );

      const current = decision(session);
      expect(current.input.purpose).toBe('EFFECT');
      expect(
        current.input.space.candidates.map((candidate) =>
          current.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000)
        )
      ).toEqual([
        expect.objectContaining({ selectedEffectOptionIds: [HeartColor.PINK] }),
        expect.objectContaining({ selectedEffectOptionIds: [HeartColor.YELLOW] }),
        expect.objectContaining({ selectedEffectOptionIds: [HeartColor.PURPLE] }),
      ]);

      const selected =
        current.input.space.candidates[
          [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE].indexOf(color)
        ]!;
      submit(session, current, { kind: 'ACTION', actionRef: selected.ref });
      const gate = buildAiBattleDecision(session.state!, P2, session.getPlayerViewState(P2)!);
      if (gate.kind !== 'WAITING_FOR_TIME') throw new Error('Expected public effect choice');
      advanceTime(gate.deadlineAt - 1000);
      const advance = decision(session, P2);
      submit(session, advance, getAiMechanicalSelection(advance)!);

      expect(session.state!.activeEffect).toBeNull();
      expect(
        getMemberEffectiveHeartIcons(
          session.state!,
          P1,
          source,
          collectLiveModifiers(session.state!)
        )
      ).toContainEqual({ color, count: 1 });
    }
  );

  it('lets AI optionally discard and publicly recover a Nijigasaki LIVE', () => {
    const { session, advanceTime } = setup();
    const source = stage(session, member('PL!N-bp5-022-N', 9), SlotPosition.CENTER);
    const [discard] = replaceHand(session, [member('DISCARD-MEMBER')]);
    const [target] = putOnTop(session, [{ ...live('NIJIGASAKI-LIVE'), groupNames: ['虹ヶ咲'] }]);
    const player = session.state!.players[0];
    Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(1) });
    Object.assign(player.waitingRoom, { cardIds: [target] });
    pending(session, source, N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID);

    const discardDecision = decision(session);
    expect(discardDecision.input.space).toMatchObject({
      kind: 'CARDS',
      min: 1,
      max: 1,
      canSkip: true,
    });
    chooseCard(session, discardDecision, 0);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(discard);

    const recoveryDecision = decision(session);
    expect(recoveryDecision.input.space).toMatchObject({
      kind: 'CARDS',
      min: 1,
      max: 1,
      canSkip: false,
    });
    expect(recoveryDecision.input.space.candidates.map((candidate) => candidate.objectId)).toEqual([
      createPublicObjectId(target!),
    ]);
    chooseCard(session, recoveryDecision, 0);

    const gate = buildAiBattleDecision(session.state!, P2, session.getPlayerViewState(P2)!);
    if (gate.kind !== 'WAITING_FOR_TIME') throw new Error('Expected public recovery display');
    advanceTime(gate.deadlineAt - 1000);
    const advance = decision(session, P2);
    submit(session, advance, getAiMechanicalSelection(advance)!);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toEqual([target]);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual([discard]);
  });

  it.each([
    { rarity: 'R＋', costs: [2, 4], draws: 1, hearts: 0, score: 0 },
    { rarity: 'P', costs: [4, 4], draws: 0, hearts: 1, score: 0 },
    { rarity: 'P＋', costs: [10, 15], draws: 0, hearts: 0, score: 1 },
    { rarity: 'SEC', costs: [2, 2], draws: 0, hearts: 0, score: 0 },
  ])(
    'lets AI order two waiting members for Rina $rarity, costs $costs, then resolves after display',
    ({ rarity, costs, draws, hearts, score }) => {
      const { session, advanceTime, randomCalls } = setup();
      const source = stage(session, member(`PL!N-bp3-009-${rarity}`, 10), SlotPosition.CENTER);
      const waiting = putOnTop(session, [
        member('PAYMENT-A', costs[0]),
        member('PAYMENT-B', costs[1]),
        member('UNSELECTED-MEMBER', 9),
        live('NOT-A-MEMBER'),
      ]);
      const player = session.state!.players[0];
      Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(waiting.length) });
      Object.assign(player.waitingRoom, { cardIds: waiting });
      pending(
        session,
        source,
        PL_N_BP3_009_LIVE_START_BOTTOM_TWO_WAITING_MEMBERS_COST_SUM_REWARD_ABILITY_ID
      );

      const before = globalThis.structuredClone(session.state!);
      const calls = randomCalls();
      const current = decision(session);
      expect(current.input.purpose).toBe('EFFECT');
      expect(current.input.space).toMatchObject({
        kind: 'CARDS',
        min: 2,
        max: 2,
        ordered: true,
        canSkip: true,
      });
      expect(current.input.space.candidates.map((candidate) => candidate.objectId)).toEqual(
        waiting.slice(0, 3).map(createPublicObjectId)
      );
      expect(getAiMechanicalSelection(current)).toBeNull();
      expect(session.state).toEqual(before);
      expect(randomCalls()).toBe(calls);
      const refs = current.input.space.candidates.map((candidate) => candidate.ref);
      for (const cardRefs of [[refs[0]], [refs[0], refs[0]], refs, [refs[0], 'unknown']]) {
        expect(() =>
          parseAiBattleResponse(
            current,
            JSON.stringify({
              selection: { kind: 'CARDS', cardRefs },
            })
          )
        ).toThrow();
      }
      const invalid = session.executeCommand({
        type: GameCommandType.CONFIRM_EFFECT_STEP,
        playerId: P1,
        timestamp: 1000,
        effectId: session.state!.activeEffect!.id,
        selectedCardIds: [waiting[0]!],
      });
      expect(invalid.success).toBe(false);
      expect(session.state).toEqual(before);

      const selectedIds = [waiting[1]!, waiting[0]!];
      const command = submit(session, current, {
        kind: 'CARDS',
        cardRefs: [refs[1]!, refs[0]!],
      });
      expect(command).toMatchObject({ selectedCardIds: selectedIds });
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(waiting);
      expect(session.state!.players[0].mainDeck.cardIds).toEqual(
        before.players[0].mainDeck.cardIds
      );
      expect(session.state!.players[0].hand.cardIds).toEqual(before.players[0].hand.cardIds);
      expect(session.state!.liveResolution.liveModifiers).toEqual([]);
      expect(session.getPlayerViewState(P2)!.activeEffect?.revealedObjectIds).toEqual(
        selectedIds.map(createPublicObjectId)
      );
      const gate = buildAiBattleDecision(session.state!, P2, session.getPlayerViewState(P2)!);
      if (gate.kind !== 'WAITING_FOR_TIME') throw new Error('Expected public bottom-deck display');
      advanceTime(gate.deadlineAt - 1000);
      const advance = decision(session, P2);
      submit(session, advance, getAiMechanicalSelection(advance)!);

      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.pendingAbilities).toEqual([]);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(waiting.slice(2));
      expect(session.state!.players[0].mainDeck.cardIds.slice(-2)).toEqual(selectedIds);
      expect(session.state!.players[0].hand.cardIds).toHaveLength(
        before.players[0].hand.cardIds.length + draws
      );
      const modifiers = collectLiveModifiers(session.state!);
      expect(
        getMemberEffectiveHeartIcons(session.state!, P1, source, modifiers)
          .filter((heart) => heart.color === HeartColor.RAINBOW)
          .reduce((sum, heart) => sum + heart.count, 0)
      ).toBe(hearts);
      expect(getPlayerLiveScoreModifier(session.state!.liveResolution, P1, modifiers)).toBe(score);
      expect(session.executeCommand(command).success).toBe(false);
    }
  );

  it('lets AI decline Rina even with exactly two eligible members', () => {
    const { session } = setup();
    const source = stage(session, member('PL!N-bp3-009-R＋', 10), SlotPosition.CENTER);
    const waiting = putOnTop(session, [member('PAYMENT-A', 2), member('PAYMENT-B', 4)]);
    const player = session.state!.players[0];
    Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(waiting.length) });
    Object.assign(player.waitingRoom, { cardIds: waiting });
    pending(
      session,
      source,
      PL_N_BP3_009_LIVE_START_BOTTOM_TWO_WAITING_MEMBERS_COST_SUM_REWARD_ABILITY_ID
    );
    const before = globalThis.structuredClone(session.state!);
    const current = decision(session);
    expect(current.input.space.candidates).toHaveLength(2);
    expect(getAiMechanicalSelection(current)).toBeNull();
    submit(session, current, getAiFallbackSelection(current));
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0].waitingRoom).toEqual(before.players[0].waitingRoom);
    expect(session.state!.players[0].mainDeck).toEqual(before.players[0].mainDeck);
    expect(session.state!.players[0].hand).toEqual(before.players[0].hand);
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
  });

  it('retains each pending instance on the same source and confirms before resolving the selected one', () => {
    for (const index of [0, 1]) {
      const { session } = setup();
      const source = stage(session, member('PL!-sd1-009-SD', 15), SlotPosition.LEFT);
      const waiting = putOnTop(
        session,
        Array.from({ length: 25 }, (_, i) => ({ ...member(`MUSE-${i}`), groupNames: ["μ's"] }))
      );
      Object.assign(session.state!.players[0].mainDeck, {
        cardIds: session.state!.players[0].mainDeck.cardIds.slice(25),
      });
      Object.assign(session.state!.players[0].waitingRoom, { cardIds: waiting });
      pending(session, source, NICO_LIVE_START_SCORE_ABILITY_ID, [
        'first-pending',
        'second-pending',
      ]);
      const current = decision(session);
      expect(current.input.purpose).toBe('PENDING_ORDER');
      expect(current.input.space.candidates).toHaveLength(3);
      const selected = current.input.space.candidates[index]!;
      const top = session.state!.players[0].mainDeck.cardIds.slice(0, 5);
      const command = submit(session, current, { kind: 'ACTION', actionRef: selected.ref });
      expect(command).toMatchObject({
        selectedOptionId: index === 0 ? 'first-pending' : 'second-pending',
      });
      expect(session.state!.players[0].mainDeck.cardIds.slice(0, 5)).toEqual(top);
      const confirm = decision(session);
      expect(confirm.input.purpose).toBe('EFFECT_CONFIRM');
      submit(session, confirm, getAiMechanicalSelection(confirm)!);
      expect(
        getPlayerLiveScoreModifier(
          session.state!.liveResolution,
          P1,
          collectLiveModifiers(session.state!)
        )
      ).toBe(2);
      expect(session.state!.pendingAbilities).toEqual([]);
      expect(
        session.state!.actionHistory.some(
          (action) =>
            action.payload.pendingAbilityId === (index === 0 ? 'first-pending' : 'second-pending')
        )
      ).toBe(true);
    }
  });

  it('expresses every ordered subset of three inspected cards and preserves the chosen top order', () => {
    const orders: number[][] = [];
    const visit = (prefix: number[]) => {
      orders.push(prefix);
      for (const index of [0, 1, 2]) if (!prefix.includes(index)) visit([...prefix, index]);
    };
    visit([]);
    expect(orders).toHaveLength(16);
    for (const order of orders) {
      const { session, randomCalls } = setup();
      const [source] = replaceHand(session, [live('PL!-sd1-019-SD')]);
      const player = session.state!.players[0];
      Object.assign(player.hand, { cardIds: [] });
      Object.assign(player.liveZone, { cardIds: [source] });
      const top = player.mainDeck.cardIds.slice(0, 3);
      const rest = player.mainDeck.cardIds.slice(3);
      pending(session, source!, START_DASH_LIVE_SUCCESS_ABILITY_ID);
      const current = decision(session);
      expect(current.input.space).toMatchObject({ kind: 'CARDS', ordered: true, min: 0, max: 3 });
      const before = globalThis.structuredClone(session.state!);
      const calls = randomCalls();
      expect(getAiFallbackSelection(current)).toEqual({ kind: 'CARDS', cardRefs: [] });
      expect(getAiMechanicalSelection(current)).toBeNull();
      expect(session.state).toEqual(before);
      expect(randomCalls()).toBe(calls);
      submit(session, current, {
        kind: 'CARDS',
        cardRefs: order.map((index) => current.input.space.candidates[index]!.ref),
      });
      expect(session.state!.players[0].mainDeck.cardIds).toEqual([
        ...order.map((index) => top[index]),
        ...rest,
      ]);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
        top.filter((_, index) => !order.includes(index))
      );
      expect(session.state!.inspectionZone.cardIds).toEqual([]);
      expect(session.state!.activeEffect).toBeNull();
    }
  });
});
