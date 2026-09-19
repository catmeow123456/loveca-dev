import { describe, expect, it } from 'vitest';
import { GameCommandType } from '../../src/application/game-commands';
import type { GameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID as IZUMI_ABILITY_ID,
  PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
  PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID as KARIN_ABILITY_ID,
  PL_N_BP4_004_LIVE_START_DRAW_WAIT_LOW_COST_OPPONENT_MEMBER_ABILITY_ID as KARIN15_DRAW_WAIT_ABILITY_ID,
  PL_N_BP4_004_LIVE_START_STACK_NIJIGASAKI_MEMBERS_BY_OPPONENT_WAIT_COUNT_ABILITY_ID as KARIN15_STACK_ABILITY_ID,
  PL_N_BP4_029_LIVE_START_TURN_ONE_SCORE_TARGET_NIJIGASAKI_BLADE_ABILITY_ID as RISE_ABILITY_ID,
  PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID as DAYDREAM_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { queryActivatedAbilityStart } from '../../src/application/card-effects/runtime/activated-registry';
import {
  createHeartRequirement,
  type AnyCardData,
  type CardInstance,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { buildAiBattleDecision, parseAiBattleResponse } from '../../src/server/ai-battle/decision';
import { getAiMechanicalSelection } from '../../src/server/ai-battle/policy';
import { readFrozenBluePurpleDeck } from '../helpers/ai-curated-decks';
import {
  P1,
  P2,
  setup,
  stage,
  member,
  replaceHand,
  decision,
  submit,
} from '../helpers/ai-battle-fixture';

const cards = readFrozenBluePurpleDeck().deck.mainDeck;
function card(base: string): AnyCardData {
  const found = cards.find((candidate) => candidate.cardCode.startsWith(`${base}-`));
  if (!found) throw new Error(`Missing blue-purple fixture card: ${base}`);
  return found;
}

function setupKarin(rarity = 'P') {
  const fixture = setup();
  const source = stage(
    fixture.session,
    { ...card('PL!N-bp3-004'), cardCode: `PL!N-bp3-004-${rarity}` } as MemberCardData,
    SlotPosition.CENTER
  );
  return { ...fixture, source };
}

function setupRiseUpHigh(rarity = 'L', targetCount = 2, turnCount = 1) {
  const fixture = setup();
  const { session } = fixture;
  const targets = [SlotPosition.LEFT, SlotPosition.RIGHT]
    .slice(0, targetCount)
    .map((slot) => stage(session, card('PL!N-bp4-017') as MemberCardData, slot));
  const outsider = stage(session, member(), SlotPosition.CENTER);
  const [source] = waiting(session, [
    { ...card('PL!N-bp4-029'), cardCode: `PL!N-bp4-029-${rarity}` },
  ]);
  const game = session.state!;
  const player = game.players[0];
  Object.assign(player.waitingRoom, { cardIds: [] });
  Object.assign(player, {
    liveZone: addCardToStatefulZone(player.liveZone, source!, {
      face: FaceState.FACE_UP,
      orientation: OrientationState.WAITING,
    }),
  });
  Object.assign(game, {
    turnCount,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P1,
      playerScores: new Map([[P1, 1]]),
    },
  });
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  Object.assign(game, result.gameState);
  return { ...fixture, source: source!, targets, outsider };
}

function riseModifiers(session: GameSession, kind: 'SCORE' | 'BLADE') {
  return session.state!.liveResolution.liveModifiers.filter(
    (modifier) => modifier.abilityId === RISE_ABILITY_ID && modifier.kind === kind
  );
}

function waiting(session: GameSession, data: AnyCardData[]) {
  const game = session.state!;
  const player = game.players[0];
  const ids = player.mainDeck.cardIds.slice(0, data.length);
  data.forEach((value, index) => {
    const id = ids[index]!;
    (game.cardRegistry as Map<string, CardInstance>).set(id, {
      ...game.cardRegistry.get(id)!,
      data: value,
    });
  });
  Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(ids.length) });
  Object.assign(player.waitingRoom, { cardIds: [...player.waitingRoom.cardIds, ...ids] });
  return ids;
}

function activation(session: GameSession) {
  const current = decision(session);
  const candidate = current.input.space.candidates.find((candidate) => {
    const command = current.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000);
    return (
      command.type === GameCommandType.ACTIVATE_ABILITY && command.abilityId === KARIN_ABILITY_ID
    );
  });
  return candidate ? { current, ref: candidate.ref } : undefined;
}

function activate(session: GameSession) {
  const action = activation(session);
  expect(action).toBeDefined();
  submit(session, action!.current, { kind: 'ACTION', actionRef: action!.ref });
}

function pick(session: GameSession, id: string) {
  const current = decision(session);
  const candidate = current.input.space.candidates.find(
    (candidate) => candidate.objectId === createPublicObjectId(id)
  );
  expect(candidate).toBeDefined();
  submit(session, current, { kind: 'CARDS', cardRefs: [candidate!.ref] });
}

function advanceDisplay(fixture: ReturnType<typeof setup>) {
  const query = buildAiBattleDecision(
    fixture.session.state!,
    P2,
    fixture.session.getPlayerViewState(P2)!
  );
  expect(query.kind).toBe('WAITING_FOR_TIME');
  fixture.advanceTime(10_000);
  const current = decision(fixture.session, P2);
  expect(current.input.purpose).toBe('PUBLIC_DISPLAY');
  submit(fixture.session, current, getAiMechanicalSelection(current)!);
}

function setupDaydream(
  options: {
    rarity?: string;
    success?: 'none' | 'self' | 'opponent' | 'other';
    energy?: boolean;
    members?: boolean;
  } = {}
) {
  const fixture = setup();
  const { session } = fixture;
  const [source, success, ...members] = waiting(session, [
    { ...card('PL!N-bp4-030'), cardCode: `PL!N-bp4-030-${options.rarity ?? 'L'}` },
    {
      ...card('PL!N-bp4-029'),
      ...(options.success === 'other' ? { workNames: ['ラブライブ！'], groupNames: ["μ's"] } : {}),
    },
    card('PL!N-bp4-017'),
    card('PL!N-bp3-004'),
  ]);
  const game = session.state!;
  const player = game.players[0];
  Object.assign(player.waitingRoom, {
    cardIds: [...(options.members === false ? [] : members), success!],
  });
  Object.assign(player, {
    liveZone: addCardToStatefulZone(player.liveZone, source!, {
      face: FaceState.FACE_UP,
      orientation: OrientationState.WAITING,
    }),
  });
  if (options.success && options.success !== 'none') {
    const owner = options.success === 'opponent' ? game.players[1] : player;
    Object.assign(player.waitingRoom, {
      cardIds: player.waitingRoom.cardIds.filter((id) => id !== success),
    });
    Object.assign(game.cardRegistry.get(success!)!, { ownerId: owner.id });
    Object.assign(owner, {
      successZone: addCardToStatefulZone(owner.successZone, success!, {
        face: FaceState.FACE_UP,
        orientation: OrientationState.WAITING,
      }),
    });
  }
  if (options.energy === false) Object.assign(player.energyDeck, { cardIds: [] });
  Object.assign(game, {
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[source!, true]]),
      performingPlayerId: P1,
    },
  });
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success, result.error).toBe(true);
  Object.assign(game, result.gameState);
  return { ...fixture, source: source!, members, success: success! };
}

function daydreamOptions(session: GameSession) {
  const current = decision(session);
  expect(current.input.space.kind).toBe('ACTION');
  return current.input.space.candidates.map((candidate) => {
    const selection = { kind: 'ACTION', actionRef: candidate.ref } as const;
    const command = current.toCommand(selection, 1000);
    if (command.type !== GameCommandType.CONFIRM_EFFECT_STEP)
      throw new Error('Expected effect choice');
    return { ids: command.selectedEffectOptionIds, current, selection };
  });
}

function chooseDaydreamOptions(session: GameSession, ids: string[]) {
  const option = daydreamOptions(session).find(
    (option) => JSON.stringify(option.ids) === JSON.stringify(ids)
  );
  expect(option).toBeDefined();
  return submit(session, option!.current, option!.selection);
}

function expectRequiredSingleChoice(session: GameSession, ids: string[], invalidId: string) {
  const current = decision(session);
  expect(current.input.space).toMatchObject({ kind: 'CARDS', min: 1, max: 1, canSkip: false });
  expect(current.input.space.candidates.map((candidate) => candidate.objectId)).toEqual(
    ids.map(createPublicObjectId)
  );
  expect(() =>
    parseAiBattleResponse(current, JSON.stringify({ selection: { kind: 'CARDS', cardRefs: [] } }))
  ).toThrow();
  const before = session.state;
  for (const selectedCardId of [undefined, invalidId]) {
    const result = session.executeCommand({
      type: GameCommandType.CONFIRM_EFFECT_STEP,
      playerId: P1,
      timestamp: 1000,
      effectId: before!.activeEffect!.id,
      selectedCardId,
    });
    expect(result.success).toBe(false);
    expect(session.state).toBe(before);
  }
}

describe('blue-purple Karin AI decisions through authority commands', () => {
  it.each(['R', 'P', 'TEST'])(
    'waits, discards and recovers a Nijigasaki LIVE for printing %s',
    (rarity) => {
      const f = setupKarin(rarity);
      const hand = replaceHand(f.session, [card('PL!N-bp4-017'), card('PL!N-bp4-029')]);
      const [target, invalidTarget] = waiting(f.session, [
        card('PL!N-bp4-030'),
        card('PL!N-bp4-017'),
      ]);
      const before = structuredClone(f.session.state);
      const randomBefore = f.randomCalls();
      expect(activation(f.session)).toBeDefined();
      expect(f.session.state).toEqual(before);
      expect(f.randomCalls()).toBe(randomBefore);

      activate(f.session);
      expect(f.session.state!.players[0].memberSlots.cardStates.get(f.source)?.orientation).toBe(
        OrientationState.WAITING
      );
      expectRequiredSingleChoice(f.session, hand, target!);
      expect(
        f.session.getPlayerViewState(P2)!.objects[createPublicObjectId(hand[0]!)]?.frontInfo
      ).toBeUndefined();
      pick(f.session, hand[0]!);
      expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(hand[0]);
      expectRequiredSingleChoice(f.session, [target!], invalidTarget!);
      pick(f.session, target!);
      expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(target);
      advanceDisplay(f);
      expect(f.session.state!.players[0].hand.cardIds).toEqual([hand[1], target]);
      expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual([invalidTarget, hand[0]]);
      expect(f.session.state!.activeEffect).toBeNull();
      expect(activation(f.session)).toBeUndefined();

      // Reactivating the same stage object cannot bypass its per-turn use limit.
      Object.assign(f.session.state!.players[0].memberSlots.cardStates.get(f.source)!, {
        orientation: OrientationState.ACTIVE,
      });
      expect(activation(f.session)).toBeUndefined();
      const used = f.session.state;
      expect(
        f.session.executeCommand({
          type: GameCommandType.ACTIVATE_ABILITY,
          playerId: P1,
          timestamp: 1000,
          cardId: f.source,
          abilityId: KARIN_ABILITY_ID,
        }).success
      ).toBe(false);
      expect(f.session.state).toBe(used);
    }
  );

  it('can activate with an empty waiting room and recover the LIVE just discarded', () => {
    const f = setupKarin();
    const [live] = replaceHand(f.session, [card('PL!N-bp4-029')]);
    activate(f.session);
    pick(f.session, live!);
    expectRequiredSingleChoice(f.session, [live!], f.source);
    pick(f.session, live!);
    advanceDisplay(f);
    expect(f.session.state!.players[0].hand.cardIds).toEqual([live]);
    expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(decision(f.session).input.purpose).toBe('MAIN');
  });

  it('finishes and keeps costs when discarding leaves no recovery target', () => {
    const f = setupKarin();
    const [discard] = replaceHand(f.session, [card('PL!N-bp4-017')]);
    activate(f.session);
    pick(f.session, discard!);
    expect(f.session.state!.players[0].hand.cardIds).toEqual([]);
    expect(f.session.state!.players[0].waitingRoom.cardIds).toEqual([discard]);
    expect(f.session.state!.players[0].memberSlots.cardStates.get(f.source)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(f.session.state!.activeEffect).toBeNull();
    expect(decision(f.session).input.purpose).toBe('MAIN');
  });

  it.each(['empty hand', 'waiting source', 'source in hand', 'source in waiting room'])(
    'omits unavailable activation without stopping AI: %s',
    (condition) => {
      const f = setupKarin();
      const player = f.session.state!.players[0];
      if (condition === 'empty hand') replaceHand(f.session, []);
      if (condition === 'waiting source')
        Object.assign(player.memberSlots.cardStates.get(f.source)!, {
          orientation: OrientationState.WAITING,
        });
      if (condition.startsWith('source in')) {
        Object.assign(player, {
          memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        });
        const zone = condition === 'source in hand' ? player.hand : player.waitingRoom;
        Object.assign(zone, { cardIds: [...zone.cardIds, f.source] });
      }
      expect(queryActivatedAbilityStart(f.session.state!, P1, f.source, KARIN_ABILITY_ID)).toBe(
        false
      );
      expect(activation(f.session)).toBeUndefined();
    }
  );

  it('shares source, player, phase and active-effect gates with the activation handler', () => {
    const f = setupKarin();
    const game = f.session.state!;
    expect(queryActivatedAbilityStart(game, P2, f.source, KARIN_ABILITY_ID)).toBe(false);
    expect(queryActivatedAbilityStart(game, P1, 'missing-source', KARIN_ABILITY_ID)).toBe(false);
    expect(
      queryActivatedAbilityStart(
        { ...game, currentPhase: GamePhase.LIVE_PHASE },
        P1,
        f.source,
        KARIN_ABILITY_ID
      )
    ).toBe(false);
    expect(
      queryActivatedAbilityStart({ ...game, activePlayerIndex: 1 }, P1, f.source, KARIN_ABILITY_ID)
    ).toBe(false);
    activate(f.session);
    expect(queryActivatedAbilityStart(f.session.state!, P1, f.source, KARIN_ABILITY_ID)).toBe(
      false
    );
  });
});

describe('blue-purple Daydream Mermaid AI success choices', () => {
  it.each(
    ['L', 'L+', 'TEST'].flatMap((rarity) => [
      { rarity, ids: ['energy'] },
      { rarity, ids: ['member-recovery'] },
      { rarity, ids: ['energy', 'member-recovery'] },
    ])
  )('resolves $ids through public displays for $rarity', ({ rarity, ids }) => {
    const f = setupDaydream({ rarity, success: 'self' });
    const before = structuredClone(f.session.state!);
    const randomCalls = f.randomCalls();
    expect(daydreamOptions(f.session).map((option) => option.ids)).toEqual([
      ['energy'],
      ['member-recovery'],
      ['energy', 'member-recovery'],
    ]);
    expect(f.session.state).toEqual(before);
    expect(f.randomCalls()).toBe(randomCalls);
    const command = chooseDaydreamOptions(f.session, ids);
    expect(f.session.state!.players[0].energyZone.cardIds).toEqual(
      before.players[0].energyZone.cardIds
    );
    expect(f.session.state!.players[0].hand.cardIds).toEqual(before.players[0].hand.cardIds);
    advanceDisplay(f);
    if (ids.includes('member-recovery')) {
      expectRequiredSingleChoice(f.session, f.members, f.source);
      pick(f.session, f.members[1]!);
      expect(f.session.state!.players[0].waitingRoom.cardIds).toContain(f.members[1]);
      expect(
        f.session.getPlayerViewState(P2)!.objects[createPublicObjectId(f.members[1]!)]?.surface
      ).toBe('FRONT');
      advanceDisplay(f);
    }
    const state = f.session.state!;
    const addedEnergy = ids.includes('energy') ? [before.players[0].energyDeck.cardIds[0]!] : [];
    expect(state.players[0].energyZone.cardIds).toEqual([
      ...before.players[0].energyZone.cardIds,
      ...addedEnergy,
    ]);
    expect(state.players[0].energyDeck.cardIds).toEqual(
      before.players[0].energyDeck.cardIds.slice(addedEnergy.length)
    );
    for (const id of addedEnergy)
      expect(state.players[0].energyZone.cardStates.get(id)?.orientation).toBe(
        OrientationState.WAITING
      );
    expect(state.players[0].hand.cardIds).toEqual([
      ...before.players[0].hand.cardIds,
      ...(ids.includes('member-recovery') ? [f.members[1]] : []),
    ]);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(f.session.executeCommand(command).success).toBe(false);
    expect(f.session.state).toBe(state);
    expect(decision(f.session).input.purpose).toBe('RULE_CONFIRM');
  });

  it.each(['none', 'opponent', 'other'] as const)(
    'requires one option when success is %s',
    (success) => {
      const f = setupDaydream({ success });
      expect(daydreamOptions(f.session).map((option) => option.ids)).toEqual([
        ['energy'],
        ['member-recovery'],
      ]);
      const before = f.session.state;
      for (const ids of [[], ['energy', 'member-recovery'], ['energy', 'energy'], ['unknown']]) {
        expect(
          f.session.executeCommand({
            type: GameCommandType.CONFIRM_EFFECT_STEP,
            playerId: P1,
            timestamp: 1000,
            effectId: before!.activeEffect!.id,
            selectedEffectOptionIds: ids,
          }).success
        ).toBe(false);
        expect(f.session.state).toBe(before);
      }
      chooseDaydreamOptions(f.session, ['energy']);
      advanceDisplay(f);
      expect(f.session.state!.activeEffect).toBeNull();
    }
  );

  it.each([
    { energy: false, members: true, ids: [['member-recovery']] },
    { energy: true, members: false, ids: [['energy']] },
    { energy: false, members: false, ids: [] },
  ])('offers only executable branches with energy=$energy members=$members', (options) => {
    const f = setupDaydream({ ...options, success: 'self' });
    if (options.ids.length)
      expect(daydreamOptions(f.session).map((option) => option.ids)).toEqual(options.ids);
    else {
      expect(f.session.state!.activeEffect).toBeNull();
      expect(f.session.state!.pendingAbilities).toEqual([]);
      expect(decision(f.session).input.purpose).toBe('RULE_CONFIRM');
    }
  });

  it('rejects a departed member and continues the next pending after a valid recovery', () => {
    const f = setupDaydream({ success: 'self' });
    chooseDaydreamOptions(f.session, ['energy', 'member-recovery']);
    advanceDisplay(f);
    const current = decision(f.session);
    const staleCommand = current.toCommand(
      { kind: 'CARDS', cardRefs: [current.input.space.candidates[0]!.ref] },
      1000
    );
    const player = f.session.state!.players[0];
    Object.assign(player.waitingRoom, {
      cardIds: player.waitingRoom.cardIds.filter((id) => id !== f.members[0]),
    });
    Object.assign(player.hand, { cardIds: [...player.hand.cardIds, f.members[0]!] });
    const before = f.session.state;
    expect(f.session.executeCommand(staleCommand).success).toBe(false);
    expect(f.session.state).toBe(before);
    Object.assign(f.session.state!, {
      pendingAbilities: [
        {
          id: 'next-success',
          sourceCardId: f.source,
          abilityId: DAYDREAM_ABILITY_ID,
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_SUCCESS,
          eventIds: [],
        },
      ],
    });
    pick(f.session, f.members[1]!);
    expect(f.session.state!.pendingAbilities.map((ability) => ability.id)).toContain(
      'next-success'
    );
    advanceDisplay(f);
    expect(f.session.state!.players[0].hand.cardIds).toContain(f.members[1]);
    expect(f.session.state!.activeEffect?.id).toBe('next-success');
    expect(daydreamOptions(f.session).map((option) => option.ids)).toEqual([['energy']]);
    chooseDaydreamOptions(f.session, ['energy']);
    advanceDisplay(f);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.pendingAbilities).toEqual([]);
  });
});

describe('blue-purple Rise Up High AI target selection', () => {
  it.each([
    { rarity: 'L', targetIndex: 0 },
    { rarity: 'L+', targetIndex: 1 },
    { rarity: 'TEST', targetIndex: 1 },
  ])(
    'selects only the chosen member for $rarity without adding score again',
    ({ rarity, targetIndex }) => {
      const f = setupRiseUpHigh(rarity);
      expect(f.session.state!.liveResolution.playerScores.get(P1)).toBe(2);
      expect(riseModifiers(f.session, 'SCORE')).toHaveLength(1);
      expect(riseModifiers(f.session, 'BLADE')).toEqual([]);
      const initialBlades = f.targets.map((id) =>
        getMemberEffectiveBladeCount(f.session.state!, P1, id)
      );
      const before = structuredClone(f.session.state);
      const randomCalls = f.randomCalls();
      const current = decision(f.session);
      expect(f.session.state).toEqual(before);
      expect(f.randomCalls()).toBe(randomCalls);
      expectRequiredSingleChoice(f.session, f.targets, f.outsider);
      expect(
        buildAiBattleDecision(f.session.state!, P2, f.session.getPlayerViewState(P2)!)
      ).toEqual({ kind: 'WAITING_FOR_PLAYER' });
      const refs = current.input.space.candidates.map((candidate) => candidate.ref);
      for (const cardRefs of [refs, [refs[0], refs[0]]]) {
        expect(() =>
          parseAiBattleResponse(current, JSON.stringify({ selection: { kind: 'CARDS', cardRefs } }))
        ).toThrow();
      }
      const command = submit(f.session, current, { kind: 'CARDS', cardRefs: [refs[targetIndex]!] });
      expect(f.session.state!.activeEffect).toBeNull();
      expect(f.session.state!.liveResolution.playerScores.get(P1)).toBe(2);
      expect(riseModifiers(f.session, 'SCORE')).toHaveLength(1);
      expect(riseModifiers(f.session, 'BLADE')).toEqual([
        expect.objectContaining({
          target: 'TARGET_MEMBER',
          sourceCardId: f.source,
          targetMemberCardId: f.targets[targetIndex],
          countDelta: 1,
        }),
      ]);
      expect(f.targets.map((id) => getMemberEffectiveBladeCount(f.session.state!, P1, id))).toEqual(
        initialBlades.map((count, index) => count + (index === targetIndex ? 1 : 0))
      );
      const finished = f.session.state;
      expect(f.session.executeCommand(command).success).toBe(false);
      expect(f.session.state).toBe(finished);
      expect(decision(f.session).input.purpose).toBe('MAIN');
    }
  );

  it('rejects a departed target and accepts another member from the same window', () => {
    const f = setupRiseUpHigh();
    const current = decision(f.session);
    const command = current.toCommand(
      { kind: 'CARDS', cardRefs: [current.input.space.candidates[0]!.ref] },
      1000
    );
    const player = f.session.state!.players[0];
    Object.assign(player, {
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    });
    Object.assign(player.waitingRoom, { cardIds: [f.targets[0]!] });
    const before = f.session.state;
    expect(f.session.executeCommand(command).success).toBe(false);
    expect(f.session.state).toBe(before);
    expect(riseModifiers(f.session, 'BLADE')).toEqual([]);
    pick(f.session, f.targets[1]!);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.liveResolution.playerScores.get(P1)).toBe(2);
    expect(riseModifiers(f.session, 'SCORE')).toHaveLength(1);
    expect(riseModifiers(f.session, 'BLADE')).toEqual([
      expect.objectContaining({ targetMemberCardId: f.targets[1] }),
    ]);
  });

  it('continues the next pending ability after the target is resolved', () => {
    const f = setupRiseUpHigh();
    const nextSource = stage(
      f.session,
      card('PL!N-bp1-003') as MemberCardData,
      SlotPosition.CENTER
    );
    Object.assign(f.session.state!, {
      pendingAbilities: [
        {
          id: 'next-live-start',
          sourceCardId: nextSource,
          abilityId: PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: [],
        },
      ],
    });
    pick(f.session, f.targets[0]!);
    expect(f.session.state!.activeEffect).toMatchObject({
      sourceCardId: nextSource,
      abilityId: PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    });
    const current = decision(f.session);
    const skip = current.input.space.candidates.find((candidate) => {
      const command = current.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000);
      return (
        command.type === GameCommandType.CONFIRM_EFFECT_STEP && command.selectedCardId === null
      );
    });
    expect(skip).toBeDefined();
    submit(f.session, current, { kind: 'ACTION', actionRef: skip!.ref });
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.pendingAbilities).toEqual([]);
    expect(f.session.state!.liveResolution.playerScores.get(P1)).toBe(2);
    expect(riseModifiers(f.session, 'SCORE')).toHaveLength(1);
    expect(riseModifiers(f.session, 'BLADE')).toHaveLength(1);
  });

  it.each([
    { targetCount: 0, turnCount: 1, score: 2, blades: 0 },
    { targetCount: 1, turnCount: 1, score: 2, blades: 1 },
    { targetCount: 2, turnCount: 2, score: 1, blades: 0 },
  ])(
    'keeps automatic branches without AI target selection ($targetCount targets, turn $turnCount)',
    ({ targetCount, turnCount, score, blades }) => {
      const f = setupRiseUpHigh('L', targetCount, turnCount);
      expect(f.session.state!.activeEffect).toBeNull();
      expect(f.session.state!.liveResolution.playerScores.get(P1)).toBe(score);
      expect(riseModifiers(f.session, 'BLADE')).toHaveLength(blades);
      expect(decision(f.session).input.purpose).toBe('MAIN');
    }
  );
});

const IZUMI_PAY_STEP_ID = 'HS_PR_020_PAY_ENERGY_STACK_WAITING_MEMBERS';
const IZUMI_SELECT_STEP_ID = 'HS_PR_020_SELECT_WAITING_MEMBERS_TO_DECK_TOP';
const PUBLIC_CONFIRMATION_STEP_ID = 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION';

function setupIzumi(options: { activeEnergy?: number } = {}) {
  const fixture = setup();
  const { session } = fixture;
  const source = stage(session, card('PL!HS-PR-023') as MemberCardData, SlotPosition.CENTER);
  const player = session.state!.players[0];
  Object.assign(player.waitingRoom, { cardIds: [] });
  // The waiting room holds a plain LIVE next to the two members: it must never
  // appear in the member-only selection window.
  const [memberA, memberB, waitingLive] = waiting(session, [
    member('IZUMI-WAIT-A', 2),
    member('IZUMI-WAIT-B', 4),
    {
      cardCode: 'IZUMI-WAIT-LIVE',
      name: 'IZUMI-WAIT-LIVE',
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    },
  ]);
  const game = session.state!;
  player.energyZone.cardIds.forEach((id, index) =>
    Object.assign(player.energyZone.cardStates.get(id)!, {
      orientation:
        index < (options.activeEnergy ?? 1) ? OrientationState.ACTIVE : OrientationState.WAITING,
    })
  );
  Object.assign(game, {
    pendingAbilities: [
      {
        id: `pending:${source}`,
        sourceCardId: source,
        abilityId: IZUMI_ABILITY_ID,
        controllerId: P1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: [],
      },
    ],
  });
  Object.assign(game, resolvePendingCardEffects(game).gameState);
  return { ...fixture, source, memberA: memberA!, memberB: memberB!, waitingLive: waitingLive! };
}

function izumiActiveEnergy(f: ReturnType<typeof setupIzumi>) {
  const player = f.session.state!.players[0];
  return player.energyZone.cardIds.filter(
    (id) => player.energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
  ).length;
}

function izumiOption(current: ReturnType<typeof decision>, optionId: 'pay' | 'decline') {
  const candidate = current.input.space.candidates.find((candidate) => {
    const command = current.toCommand({ kind: 'ACTION', actionRef: candidate.ref }, 1000);
    return (
      command.type === GameCommandType.CONFIRM_EFFECT_STEP && command.selectedOptionId === optionId
    );
  });
  expect(candidate).toBeDefined();
  return candidate!;
}

describe('blue-purple Izumi stack-waiting-members AI decisions', () => {
  it('adapts pay/decline and the ordered two-member stack through authority commands', () => {
    const f = setupIzumi();
    expect(f.session.state!.activeEffect).toMatchObject({
      sourceCardId: f.source,
      abilityId: IZUMI_ABILITY_ID,
      stepId: IZUMI_PAY_STEP_ID,
    });

    const pay = decision(f.session);
    expect(pay.input.purpose).toBe('EFFECT');
    expect(pay.input.space.kind).toBe('ACTION');
    expect(pay.input.space.candidates).toHaveLength(2);
    const payOption = izumiOption(pay, 'pay');
    expect(izumiOption(pay, 'decline').ref).not.toBe(payOption.ref);

    const activeBefore = izumiActiveEnergy(f);
    expect(activeBefore).toBeGreaterThan(0);
    submit(f.session, pay, { kind: 'ACTION', actionRef: payOption.ref });
    expect(izumiActiveEnergy(f)).toBe(activeBefore - 1);
    expect(f.session.state!.activeEffect).toMatchObject({
      abilityId: IZUMI_ABILITY_ID,
      stepId: IZUMI_SELECT_STEP_ID,
    });

    const select = decision(f.session);
    expect(select.input.purpose).toBe('EFFECT');
    expect(select.input.space).toMatchObject({ kind: 'CARDS', min: 2, max: 2, ordered: true });
    expect(select.input.space.candidates.map((candidate) => candidate.objectId)).toEqual([
      createPublicObjectId(f.memberA),
      createPublicObjectId(f.memberB),
    ]);
    const refs = select.input.space.candidates.map((candidate) => candidate.ref);
    expect(() =>
      parseAiBattleResponse(
        select,
        JSON.stringify({ selection: { kind: 'CARDS', cardRefs: [refs[0]!] } })
      )
    ).toThrow();

    // Reversed submission order must map to the deck-top order: first selected is topmost.
    submit(f.session, select, { kind: 'CARDS', cardRefs: [refs[1]!, refs[0]!] });
    expect(f.session.state!.activeEffect?.stepId).toBe(PUBLIC_CONFIRMATION_STEP_ID);
    advanceDisplay(f);

    const state = f.session.state!;
    const player = state.players[0];
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(player.mainDeck.cardIds.slice(0, 2)).toEqual([f.memberB, f.memberA]);
    expect(player.waitingRoom.cardIds).toEqual([f.waitingLive]);
    expect(decision(f.session).input.purpose).toBe('MAIN');
  });

  it('declining keeps energy, waiting room and deck unchanged', () => {
    const f = setupIzumi();
    const player = f.session.state!.players[0];
    const deckBefore = [...player.mainDeck.cardIds];
    const waitingBefore = [...player.waitingRoom.cardIds];
    const activeBefore = izumiActiveEnergy(f);

    const pay = decision(f.session);
    const decline = izumiOption(pay, 'decline');
    submit(f.session, pay, { kind: 'ACTION', actionRef: decline.ref });

    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.pendingAbilities).toEqual([]);
    expect(player.mainDeck.cardIds).toEqual(deckBefore);
    expect(player.waitingRoom.cardIds).toEqual(waitingBefore);
    expect(izumiActiveEnergy(f)).toBe(activeBefore);
    expect(decision(f.session).input.purpose).toBe('MAIN');
  });

  it('skips without an AI window when no energy can be paid', () => {
    const f = setupIzumi({ activeEnergy: 0 });
    expect(izumiActiveEnergy(f)).toBe(0);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.pendingAbilities).toEqual([]);
    expect(decision(f.session).input.purpose).toBe('MAIN');
  });
});

const KARIN15_DRAW_WAIT_STEP_ID = 'PL_N_BP4_004_SELECT_OPPONENT_LOW_COST_MEMBER_TO_WAIT';
const KARIN15_STACK_STEP_ID = 'PL_N_BP4_004_SELECT_NIJIGASAKI_MEMBERS_TO_DECK_TOP';

function nijigasakiMember(code: string, cost: number): MemberCardData {
  return { ...member(code, cost), groupNames: ['虹ヶ咲学園スクールアイドル同好会'] };
}

function stageOpponent(
  session: GameSession,
  data: MemberCardData,
  slot: SlotPosition,
  orientation: OrientationState
) {
  const game = session.state!;
  const opponent = game.players[1];
  const id = opponent.mainDeck.cardIds[0]!;
  Object.assign(opponent.mainDeck, { cardIds: opponent.mainDeck.cardIds.slice(1) });
  (game.cardRegistry as Map<string, CardInstance>).set(id, {
    ...game.cardRegistry.get(id)!,
    data,
  });
  Object.assign(opponent, {
    memberSlots: placeCardInSlot(opponent.memberSlots, slot, id, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  });
  return id;
}

interface Karin15OpponentEntry {
  slot: SlotPosition;
  cost: number;
  orientation: OrientationState;
}

// One ability at a time: injecting both would open the shared ability-order
// window instead of the card's own selection steps.
function setupKarin15(
  abilityId: string,
  options: {
    opponent?: readonly Karin15OpponentEntry[];
    nijigasaki?: readonly string[];
    foreign?: boolean;
  } = {}
) {
  const fixture = setup();
  const { session } = fixture;
  const source = stage(session, card('PL!N-bp4-004') as MemberCardData, SlotPosition.CENTER);
  const game = session.state!;
  const player = game.players[0];
  Object.assign(player.waitingRoom, { cardIds: [] });
  const opponentIds = (options.opponent ?? []).map((entry) =>
    stageOpponent(session, member(`OPP-${entry.cost}`, entry.cost), entry.slot, entry.orientation)
  );
  const waitingIds = waiting(session, [
    ...(options.nijigasaki ?? []).map((code, index) => nijigasakiMember(code, 2 + index)),
    // A non-虹ヶ咲 waiting member must never appear in the group-restricted window.
    ...(options.foreign ? [{ ...member('WAIT-FOREIGN', 2), groupNames: ["μ's"] }] : []),
  ]);
  const handBefore = player.hand.cardIds.length;
  Object.assign(game, {
    pendingAbilities: [
      {
        id: `pending:${source}`,
        sourceCardId: source,
        abilityId,
        controllerId: P1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: [],
      },
    ],
  });
  Object.assign(game, resolvePendingCardEffects(game).gameState);
  return { ...fixture, source, opponentIds, waitingIds, handBefore };
}

describe('blue-purple Karin-15 live-start AI decisions', () => {
  it('adapts the draw-one wait-one window and excludes illegal targets', () => {
    const f = setupKarin15(KARIN15_DRAW_WAIT_ABILITY_ID, {
      opponent: [
        { slot: SlotPosition.LEFT, cost: 4, orientation: OrientationState.ACTIVE },
        { slot: SlotPosition.CENTER, cost: 10, orientation: OrientationState.ACTIVE },
        { slot: SlotPosition.RIGHT, cost: 2, orientation: OrientationState.WAITING },
      ],
    });
    expect(f.session.state!.activeEffect).toMatchObject({
      sourceCardId: f.source,
      abilityId: KARIN15_DRAW_WAIT_ABILITY_ID,
      stepId: KARIN15_DRAW_WAIT_STEP_ID,
    });
    expect(f.session.state!.players[0].hand.cardIds).toHaveLength(f.handBefore + 1);

    const current = decision(f.session);
    expect(current.input.purpose).toBe('EFFECT');
    expect(current.input.space).toMatchObject({
      kind: 'CARDS',
      min: 1,
      max: 1,
      canSkip: false,
    });
    // Only the ACTIVE cost-4 member is selectable: cost 10 exceeds the cap and
    // the cost-2 member is already WAITING.
    expect(current.input.space.candidates.map((candidate) => candidate.objectId)).toEqual([
      createPublicObjectId(f.opponentIds[0]!),
    ]);
    expect(() =>
      parseAiBattleResponse(current, JSON.stringify({ selection: { kind: 'CARDS', cardRefs: [] } }))
    ).toThrow();

    submit(f.session, current, {
      kind: 'CARDS',
      cardRefs: [current.input.space.candidates[0]!.ref],
    });
    const state = f.session.state!;
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[1].memberSlots.cardStates.get(f.opponentIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[1].memberSlots.cardStates.get(f.opponentIds[1]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(decision(f.session).input.purpose).toBe('MAIN');
  });

  it('still draws but opens no AI window when no opponent target is legal', () => {
    const f = setupKarin15(KARIN15_DRAW_WAIT_ABILITY_ID, {
      opponent: [{ slot: SlotPosition.CENTER, cost: 10, orientation: OrientationState.ACTIVE }],
    });
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.pendingAbilities).toEqual([]);
    expect(f.session.state!.players[0].hand.cardIds).toHaveLength(f.handBefore + 1);
    expect(decision(f.session).input.purpose).toBe('MAIN');
  });

  it('adapts the ordered 虹ヶ咲 stack window excluding foreign members', () => {
    const f = setupKarin15(KARIN15_STACK_ABILITY_ID, {
      opponent: [{ slot: SlotPosition.CENTER, cost: 4, orientation: OrientationState.WAITING }],
      nijigasaki: ['WAIT-NIJI-A', 'WAIT-NIJI-B'],
      foreign: true,
    });
    expect(f.session.state!.activeEffect).toMatchObject({
      sourceCardId: f.source,
      abilityId: KARIN15_STACK_ABILITY_ID,
      stepId: KARIN15_STACK_STEP_ID,
    });

    const current = decision(f.session);
    expect(current.input.purpose).toBe('EFFECT');
    // One WAITING opponent member caps the stack at 1 despite two candidates.
    expect(current.input.space).toMatchObject({
      kind: 'CARDS',
      min: 0,
      max: 1,
      ordered: true,
      canSkip: true,
      skipDescription: '不放置',
    });
    expect(current.input.space.candidates.map((candidate) => candidate.objectId)).toEqual([
      createPublicObjectId(f.waitingIds[0]!),
      createPublicObjectId(f.waitingIds[1]!),
    ]);

    submit(f.session, current, {
      kind: 'CARDS',
      cardRefs: [current.input.space.candidates[1]!.ref],
    });
    expect(f.session.state!.activeEffect?.stepId).toBe(PUBLIC_CONFIRMATION_STEP_ID);
    advanceDisplay(f);

    const state = f.session.state!;
    const player = state.players[0];
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(player.mainDeck.cardIds[0]).toBe(f.waitingIds[1]!);
    expect(player.waitingRoom.cardIds).toEqual([f.waitingIds[0]!, f.waitingIds[2]!]);
    expect(decision(f.session).input.purpose).toBe('MAIN');
  });

  it('maps an empty selection to the explicit skip and needs no window without waiting opponents', () => {
    const f = setupKarin15(KARIN15_STACK_ABILITY_ID, {
      opponent: [{ slot: SlotPosition.CENTER, cost: 4, orientation: OrientationState.WAITING }],
      nijigasaki: ['WAIT-NIJI'],
    });
    const player = f.session.state!.players[0];
    const deckBefore = [...player.mainDeck.cardIds];
    const current = decision(f.session);
    const command = submit(f.session, current, { kind: 'CARDS', cardRefs: [] });
    expect(command.type).toBe(GameCommandType.CONFIRM_EFFECT_STEP);
    expect(f.session.state!.activeEffect).toBeNull();
    expect(f.session.state!.pendingAbilities).toEqual([]);
    expect(player.mainDeck.cardIds).toEqual(deckBefore);
    expect(player.waitingRoom.cardIds).toEqual([f.waitingIds[0]!]);
    expect(decision(f.session).input.purpose).toBe('MAIN');

    const idle = setupKarin15(KARIN15_STACK_ABILITY_ID, {
      opponent: [{ slot: SlotPosition.CENTER, cost: 4, orientation: OrientationState.ACTIVE }],
      nijigasaki: ['WAIT-NIJI'],
    });
    expect(idle.session.state!.activeEffect).toBeNull();
    expect(idle.session.state!.pendingAbilities).toEqual([]);
    expect(decision(idle.session).input.purpose).toBe('MAIN');
  });
});
