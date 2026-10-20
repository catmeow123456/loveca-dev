import { describe, expect, it } from 'vitest';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { queryActiveEffectSelection } from '../../src/application/card-effects/runtime/step-registry';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { SINGLE_COPY_SOURCE_CASES } from '../helpers/hs-bp8-004-single-copy-cases';
import { sourceCardFixture } from '../helpers/card-effect-zone-fixture';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

type Case = (typeof SINGLE_COPY_SOURCE_CASES)[number];
type Mode = 'NATIVE' | 'HOST' | 'FREE';
const P1 = 'p1',
  P2 = 'p2';
const key = (entry: Case) => entry.workflowPath.split('/').at(-1)!.replace('.ts', '');
function setup(entry: Case, mode: Mode, noCostResources = false): GameState {
  const k = key(entry);
  // The copied MiraCra-only predicate still inspects the recipient's real identity.
  const hostCode = k === 'hs-pb1-014-hime' ? 'PL!HS-bp8-003-P' : 'PL!HS-bp8-004-SEC';
  const sourceData = sourceCardFixture(
    mode === 'NATIVE' ? entry.representativeCardCode : hostCode
  ) as MemberCardData;
  expect(sourceData).toBeDefined();
  const actor = createCardInstance(sourceData, P1, 'actor');
  // Non-source objects are intentionally synthetic, with complete known Hearts and controlled identity.
  const member = (id: string, owner = P1, unit = 'スリーズブーケ', cost = 2) =>
    createCardInstance(
      {
        cardCode: `SYNTHETIC-${id}`,
        name: `合成${id}`,
        cardType: CardType.MEMBER,
        cost,
        blade: 1,
        hearts: [{ color: HeartColor.PURPLE, count: 1 }],
        groupNames: ['蓮ノ空'],
        unitName: unit,
      } as MemberCardData,
      owner,
      id
    );
  const live = (id: string, unit: string) =>
    createCardInstance(
      {
        cardCode: `SYNTHETIC-${id}`,
        name: `合成${id}`,
        cardType: CardType.LIVE,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
        groupNames: ['蓮ノ空'],
        unitName: unit,
      } as LiveCardData,
      P1,
      id
    );
  const hand = Array.from(
    { length: noCostResources ? 0 : k === 'hs-bp8-003-rurino' ? 8 : 3 },
    (_, i) => member(`hand-${i}`)
  );
  const enemyHand = Array.from({ length: 8 }, (_, i) => member(`enemy-hand-${i}`, P2));
  const waiting = [
    ...Array.from({ length: 10 }, (_, i) => member(`waiting-${i}`)),
    live('cerise-live', 'スリーズブーケ'),
    live('doll-live', 'DOLLCHESTRA'),
    live('miracra-live', 'Mira-Cra Park!'),
    live('edelnote-live', 'EdelNote'),
  ];
  const enemyWaiting = Array.from({ length: 10 }, (_, i) => member(`enemy-waiting-${i}`, P2));
  const deck = Array.from({ length: 20 }, (_, i) => member(`deck-${i}`));
  const energy = Array.from({ length: 6 }, (_, i) =>
    createCardInstance(
      { cardCode: `SYNTHETIC-E${i}`, name: '合成能量', cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  const others = [
    member('other-left', P1, 'Mira-Cra Park!'),
    member('other-right', P1, 'Mira-Cra Park!'),
    member('opponent-left', P2),
    member('opponent-right', P2),
  ];
  const relay = [
    member('relay-cerise'),
    member('relay-doll', P1, 'DOLLCHESTRA'),
    member('relay-miracra', P1, 'Mira-Cra Park!'),
  ];
  let game = registerCards(createGameState('single-copy-matrix', P1, 'P1', P2, 'P2'), [
    actor,
    ...hand,
    ...enemyHand,
    ...waiting,
    ...enemyWaiting,
    ...deck,
    ...energy,
    ...others,
    ...relay,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'actor'),
        SlotPosition.LEFT,
        'other-left',
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      ),
      SlotPosition.RIGHT,
      'other-right'
    ),
    hand: { ...p.hand, cardIds: hand.map((c) => c.instanceId) },
    waitingRoom: { ...p.waitingRoom, cardIds: waiting.map((c) => c.instanceId) },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((c) => c.instanceId) },
    energyZone: energy.reduce(
      (zone, card, i) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            i < 4 && !noCostResources ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      p.energyZone
    ),
  }));
  game = updatePlayer(game, P2, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: enemyHand.map((c) => c.instanceId) },
    waitingRoom: { ...p.waitingRoom, cardIds: enemyWaiting.map((c) => c.instanceId) },
    memberSlots: placeCardInSlot(
      placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'opponent-left'),
      SlotPosition.RIGHT,
      'opponent-right'
    ),
  }));
  const pending: PendingAbilityState = {
    id: 'copy-child',
    abilityId: entry.abilityId,
    sourceCardId: 'actor',
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
    metadata: {
      fromZone: ZoneType.WAITING_ROOM,
      relayReplacements: relay.map((c) => ({ cardId: c.instanceId, effectiveCost: 0 })),
    },
    ...(mode === 'NATIVE'
      ? {}
      : {
          onEnterInvocation: {
            definitionSourceCardCode: entry.representativeCardCode,
            waiveActivationCosts: mode === 'FREE',
            grantId: 'synthetic-grant',
          },
        }),
  };
  return { ...game, currentPhase: GamePhase.MAIN_PHASE, pendingAbilities: [pending] };
}
function step(game: GameState, optionOverride?: string): GameState {
  const effect = game.activeEffect!;
  const selection = queryActiveEffectSelection(game);
  let id: string | undefined, ids: readonly string[] | undefined, option: string | undefined;
  if (selection?.kind === 'CARDS') {
    if (selection.mode === 'SINGLE') id = selection.cardIds[0];
    else if (selection.groups) {
      const chosen = new Set<string>();
      for (const group of selection.groups)
        for (const card of group.cardIds
          .filter((c) => !chosen.has(c))
          .slice(0, Math.max(group.min, Math.min(1, group.max))))
          chosen.add(card);
      ids = [...chosen].slice(0, selection.max);
    } else ids = selection.cardIds.slice(0, selection.max);
  } else if (selection?.kind === 'OPTIONS') option = optionOverride ?? selection.options[0]?.id;
  else if (effect.selectableOptions?.length)
    option = optionOverride ?? effect.selectableOptions[0].id;
  else if (effect.effectChoice?.options.length)
    option = optionOverride ?? effect.effectChoice.options[0].id;
  else if (effect.selectableCardIds?.length) {
    if (effect.selectableCardMode === 'ORDERED_MULTI')
      ids = effect.selectableCardIds.slice(
        0,
        effect.maxSelectableCards ?? effect.minSelectableCards ?? 1
      );
    else id = effect.selectableCardIds[0];
  }
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    effect.awaitingPlayerId ?? P1,
    effect.id,
    id,
    undefined,
    undefined,
    option,
    ids
  );
}
function settle(game: GameState): GameState {
  let state = resolvePendingCardEffects(game).gameState;
  for (let i = 0; i < 40 && state.activeEffect; i++) {
    const next = step(state);
    if (next === state)
      throw new Error(`Unresolved ${state.activeEffect.abilityId} ${state.activeEffect.stepId}`);
    state = next;
  }
  expect(state.activeEffect).toBeNull();
  expect(state.pendingAbilities).toEqual([]);
  return state;
}
// [hand, deck, waiting] proves a positive effect for every ID; modifiers/orientation add targeted checks below.
const RESULTS: Record<string, { normal: readonly number[]; free?: readonly number[] }> = {
  'hs-pr-035-ginko': { normal: [3, 20, 14] },
  'hs-bp1-008-kosuzu': { normal: [4, 16, 17] },
  'hs-bp2-005-rurino': { normal: [3, 20, 14], free: [4, 20, 13] },
  'hs-bp2-007-ginko': { normal: [4, 20, 13] },
  'hs-bp2-008-kosuzu': { normal: [3, 20, 14] },
  'hs-bp2-009-hime': { normal: [3, 20, 14] },
  'hs-bp2-014-rurino': { normal: [4, 19, 14] },
  'hs-bp2-018-hime': { normal: [3, 20, 13] },
  'hs-bp5-007-seras': { normal: [2, 20, 15], free: [4, 20, 13] },
  'hs-bp5-016-izumi': { normal: [2, 20, 15], free: [3, 20, 14] },
  'hs-bp6-003-rurino': { normal: [4, 20, 13] },
  'hs-bp6-008-izumi': { normal: [4, 20, 13] },
  'hs-bp6-015-seras': { normal: [3, 18, 16] },
  'hs-bp8-001-kaho': { normal: [3, 17, 17] },
  'hs-bp8-006-hime': { normal: [2, 20, 15], free: [3, 20, 14] },
  'hs-cl1-002-sayaka': { normal: [4, 20, 13] },
  'hs-cl1-004-ginko': { normal: [3, 17, 17] },
  'hs-pb1-004-ginko': { normal: [3, 17, 17], free: [4, 17, 16] },
  'hs-pb1-007-seras': { normal: [3, 20, 14], free: [4, 20, 13] },
  'hs-pb1-012-ginko': { normal: [4, 30, 3] },
  'hs-pb1-014-hime': { normal: [3, 20, 14] },
  'hs-pb1-016-izumi': { normal: [3, 20, 14] },
  'hs-sd1-004-ginko': { normal: [3, 20, 14], free: [4, 20, 13] },
  'hs-sd1-005-kosuzu': { normal: [4, 20, 13] },
  'hs-bp8-003-rurino': { normal: [6, 20, 16] },
  'hs-bp8-012-ginko': { normal: [3, 30, 4] },
};
const COSTS: Record<string, readonly [number, number]> = {
  'hs-bp2-005-rurino': [0, 1],
  'hs-bp2-009-hime': [1, 0],
  'hs-bp2-018-hime': [2, 0],
  'hs-bp5-007-seras': [0, 2],
  'hs-bp5-016-izumi': [0, 1],
  'hs-bp8-006-hime': [0, 1],
  'hs-cl1-002-sayaka': [1, 0],
  'hs-pb1-004-ginko': [1, 1],
  'hs-pb1-007-seras': [2, 1],
  'hs-sd1-004-ginko': [0, 1],
};
function assertConcreteResult(
  game: GameState,
  entry: Case,
  free: boolean,
  noCostResources = false
) {
  const k = key(entry),
    p = game.players[0],
    enemy = game.players[1];
  const result = RESULTS[k];
  const expected = free ? (result.free ?? result.normal) : result.normal;
  expect([p.hand.cardIds.length, p.mainDeck.cardIds.length, p.waitingRoom.cardIds.length]).toEqual([
    expected[0] - (noCostResources ? 3 : 0),
    ...expected.slice(1),
  ]);
  const modifiers = game.liveResolution.liveModifiers.filter(
    (m) => m.abilityId === entry.abilityId
  );
  const modifier = modifiers[0];
  if (k === 'hs-bp2-008-kosuzu' || k === 'hs-pb1-012-ginko')
    expect(modifier).toMatchObject({ kind: 'BLADE', sourceCardId: 'actor', countDelta: 2 });
  if (k === 'hs-bp2-009-hime')
    expect(modifier).toMatchObject({
      kind: 'HEART',
      sourceCardId: 'actor',
      hearts: [{ color: HeartColor.PINK, count: 2 }],
    });
  if (k === 'hs-bp8-006-hime')
    expect(modifier).toMatchObject({
      kind: 'HEART',
      sourceCardId: 'actor',
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
  if (k === 'hs-bp8-012-ginko')
    expect(modifier).toMatchObject({
      kind: 'HEART',
      sourceCardId: 'actor',
      hearts: [{ color: HeartColor.GREEN, count: 2 }],
    });
  if (k === 'hs-pb1-016-izumi')
    expect(modifier).toMatchObject({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      targetMemberCardId: 'other-left',
      hearts: [{ color: HeartColor.PURPLE, count: 1 }],
    });
  if (k === 'hs-bp2-014-rurino')
    expect(game.liveProhibitions).toContainEqual({
      playerId: P1,
      sourceCardId: 'actor',
      abilityId: entry.abilityId,
      expiresAt: 'LIVE_END',
    });
  if (k === 'hs-bp2-018-hime') {
    expect(p.liveZone.cardIds).toEqual(['cerise-live']);
    expect(game.actionHistory.some((a) => a.payload.nextLiveSetLimitReduction === 1)).toBe(true);
  }
  if (k === 'hs-pr-035-ginko') {
    expect(enemy.waitingRoom.cardIds).toHaveLength(7);
    expect(enemy.mainDeck.cardIds).toHaveLength(3);
    expect(enemy.memberSlots.cardStates.get('opponent-left')?.orientation).toBe(
      OrientationState.WAITING
    );
  }
  if (k === 'hs-bp5-016-izumi')
    for (const id of ['opponent-left', 'opponent-right'])
      expect(enemy.memberSlots.cardStates.get(id)?.orientation).toBe(OrientationState.WAITING);
  if (k === 'hs-bp6-003-rurino')
    expect(p.memberSlots.cardStates.get('other-left')?.orientation).toBe(OrientationState.ACTIVE);
  if (k === 'hs-bp6-008-izumi')
    expect(p.memberSlots.cardStates.get('actor')?.orientation).toBe(OrientationState.WAITING);
  if (k === 'hs-bp8-001-kaho')
    expect(
      p.energyZone.cardIds.filter(
        (id) => p.energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toHaveLength(6);
  if (k === 'hs-pb1-014-hime')
    expect(enemy.memberSlots.slots[SlotPosition.CENTER]).toBe('opponent-left');
  if (k === 'hs-bp8-003-rurino') {
    expect(enemy.hand.cardIds).toHaveLength(6);
    expect(enemy.waitingRoom.cardIds).toHaveLength(12);
  }
  const cost = COSTS[k];
  if (cost)
    expect(
      p.energyZone.cardIds.filter(
        (id) => p.energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toHaveLength((noCostResources ? 0 : 4) - (free ? 0 : cost[0]));
  const pay = game.actionHistory.filter(
    (a) => a.type === 'PAY_COST' && a.payload.abilityId === entry.abilityId
  );
  if (free || !cost) expect(pay).toEqual([]);
  else expect(pay.length).toBeGreaterThan(0);
  expect(
    game.actionHistory
      .filter((a) => a.payload.abilityId === entry.abilityId && a.type === 'RESOLVE_ABILITY')
      .some((a) => a.payload.sourceCardId === 'actor')
  ).toBe(true);
}

describe('single ON_ENTER copied definition with real recipient and printed-cost waiver', () => {
  it.each(SINGLE_COPY_SOURCE_CASES)(
    '$representativeCardCode $abilityId performs its real effect natively and on a normal-cost host',
    (entry) => {
      assertConcreteResult(settle(setup(entry, 'NATIVE')), entry, false);
      assertConcreteResult(settle(setup(entry, 'HOST')), entry, false);
    }
  );
  it.each(SINGLE_COPY_SOURCE_CASES)(
    '$representativeCardCode $abilityId performs its effect with only the activation cost waived',
    (entry) => {
      assertConcreteResult(settle(setup(entry, 'FREE')), entry, true);
    }
  );
  it.each(SINGLE_COPY_SOURCE_CASES.filter((entry) => COSTS[key(entry)]))(
    '$representativeCardCode waived cost requires neither hand cards nor active energy',
    (entry) => {
      assertConcreteResult(settle(setup(entry, 'FREE', true)), entry, true, true);
    }
  );
});

function entryFor(name: string): Case {
  return SINGLE_COPY_SOURCE_CASES.find((entry) => key(entry) === name)!;
}
function restore(game: GameState): GameState {
  return rehydrateAuthorityGameState(
    serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
  );
}
describe('single copied ON_ENTER continuation and host facts', () => {
  it.each(['HOST', 'FREE'] as const)(
    'retains copied invocation across save/restore and both Hime post-cost branches (%s)',
    (mode) => {
      const entry = entryFor('hs-bp8-006-hime');
      let game = resolvePendingCardEffects(setup(entry, mode)).gameState;
      if (mode === 'HOST') game = step(game);
      expect(game.activeEffect?.onEnterInvocation).toMatchObject({
        definitionSourceCardCode: entry.representativeCardCode,
        waiveActivationCosts: mode === 'FREE',
      });
      game = restore(game);
      game = step(game, 'arrange-top-three');
      expect(game.activeEffect?.onEnterInvocation).toMatchObject({
        definitionSourceCardCode: entry.representativeCardCode,
        waiveActivationCosts: mode === 'FREE',
      });
      game = restore(game);
      game = confirmActiveEffectStepThroughPublicReveal(
        game,
        P1,
        game.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        ['deck-2']
      );
      game = settle(game);
      expect(game.players[0].mainDeck.cardIds).toHaveLength(18);
      expect(game.players[0].mainDeck.cardIds[0]).toBe('deck-2');
      expect(game.players[0].waitingRoom.cardIds).toHaveLength(mode === 'FREE' ? 16 : 17);
      expect(
        game.liveResolution.liveModifiers.filter((m) => m.abilityId === entry.abilityId)
      ).toEqual([]);
      expect(
        game.actionHistory.filter(
          (a) => a.type === 'PAY_COST' && a.payload.abilityId === entry.abilityId
        )
      ).toHaveLength(mode === 'FREE' ? 0 : 1);
    }
  );
  it('keeps the other CL004 effect branch executable with free costs', () => {
    const entry = entryFor('hs-cl1-004-ginko');
    let game = resolvePendingCardEffects(setup(entry, 'FREE')).gameState;
    game = settle(step(game, 'wait-opponent-low-cost-member'));
    expect(game.players[0].mainDeck.cardIds).toHaveLength(20);
    expect(game.players[1].memberSlots.cardStates.get('opponent-left')?.orientation).toBe(
      OrientationState.WAITING
    );
  });
  it('checks the recipient stage identity rather than the copied MiraCra-only template', () => {
    const entry = entryFor('hs-pb1-014-hime');
    let game = setup(entry, 'FREE');
    const actor = createCardInstance(sourceCardFixture('PL!HS-bp8-004-SEC')!, P1, 'actor');
    game = settle(registerCards(game, [actor]));
    expect(game.players[1].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(game.actionHistory.some((a) => a.payload.step === 'OWN_STAGE_NOT_ONLY_MIRACRA')).toBe(
      true
    );
  });
  it('checks the host entry zone even when the copied non-hand effect is waived', () => {
    const entry = entryFor('hs-bp6-015-seras');
    const initial = setup(entry, 'FREE');
    const game = settle({
      ...initial,
      pendingAbilities: initial.pendingAbilities.map((a) => ({
        ...a,
        metadata: { ...a.metadata, fromZone: ZoneType.HAND },
      })),
    });
    expect(game.players[0].hand.cardIds).toHaveLength(3);
    expect(game.players[0].mainDeck.cardIds).toHaveLength(20);
    expect(game.players[0].waitingRoom.cardIds).toHaveLength(14);
  });
  it.each(['hs-bp2-007-ginko', 'hs-bp2-008-kosuzu', 'hs-bp2-009-hime', 'hs-sd1-005-kosuzu'])(
    '%s does not invent relay replacements when the host did not relay',
    (name) => {
      const entry = entryFor(name);
      const initial = setup(entry, 'FREE');
      const game = settle({
        ...initial,
        pendingAbilities: initial.pendingAbilities.map((a) => ({
          ...a,
          metadata: { ...a.metadata, relayReplacements: [] },
        })),
      });
      expect(game.players[0].hand.cardIds).toHaveLength(3);
      expect(
        game.liveResolution.liveModifiers.filter((m) => m.abilityId === entry.abilityId)
      ).toEqual([]);
      expect(
        game.actionHistory.filter(
          (a) => a.type === 'PAY_COST' && a.payload.abilityId === entry.abilityId
        )
      ).toEqual([]);
    }
  );
});

describe('copied printed costs do not require a post-cost target to exist', () => {
  it.each(['NATIVE', 'HOST', 'FREE'] as const)(
    'HS2018 %s pays or waives and applies its independent next-set reduction without a LIVE target',
    (mode) => {
      const entry = entryFor('hs-bp2-018-hime');
      const initial = updatePlayer(setup(entry, mode), P1, (p) => ({
        ...p,
        waitingRoom: {
          ...p.waitingRoom,
          cardIds: p.waitingRoom.cardIds.filter((id) => id.startsWith('waiting-')),
        },
      }));
      const game = settle(initial);
      expect(game.players[0].liveZone.cardIds).toEqual([]);
      expect(game.liveSetLimitReductions).toEqual([
        expect.objectContaining({ playerId: P1, sourceCardId: 'actor', amount: 1 }),
      ]);
      expect(
        game.players[0].energyZone.cardIds.filter(
          (id) =>
            game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
        )
      ).toHaveLength(mode === 'FREE' ? 4 : 2);
      expect(
        game.actionHistory.filter(
          (a) => a.type === 'PAY_COST' && a.payload.abilityId === entry.abilityId
        )
      ).toHaveLength(mode === 'FREE' ? 0 : 1);
    }
  );
  it.each(['NATIVE', 'HOST', 'FREE'] as const)(
    'CL002 %s can pay or waive without a DOLLCHESTRA recovery target',
    (mode) => {
      const entry = entryFor('hs-cl1-002-sayaka');
      const initial = updatePlayer(setup(entry, mode), P1, (p) => ({
        ...p,
        waitingRoom: {
          ...p.waitingRoom,
          cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'doll-live'),
        },
      }));
      const game = settle(initial);
      expect(game.players[0].hand.cardIds).toHaveLength(3);
      expect(
        game.players[0].energyZone.cardIds.filter(
          (id) =>
            game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
        )
      ).toHaveLength(mode === 'FREE' ? 4 : 3);
      expect(
        game.actionHistory.filter(
          (a) => a.type === 'PAY_COST' && a.payload.abilityId === entry.abilityId
        )
      ).toHaveLength(mode === 'FREE' ? 0 : 1);
    }
  );
  it.each(['HOST', 'FREE'] as const)(
    'HS2018 %s still applies the next-set reduction if all LIVE targets disappear while choosing',
    (mode) => {
      const entry = entryFor('hs-bp2-018-hime');
      let game = resolvePendingCardEffects(setup(entry, mode)).gameState;
      if (mode === 'HOST') game = step(game);
      expect(game.activeEffect?.selectableCardIds).toContain('cerise-live');
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        waitingRoom: {
          ...p.waitingRoom,
          cardIds: p.waitingRoom.cardIds.filter((id) => id.startsWith('waiting-')),
        },
      }));
      game = confirmActiveEffectStepThroughPublicReveal(
        game,
        P1,
        game.activeEffect!.id,
        'cerise-live'
      );
      expect(game.activeEffect).toBeNull();
      expect(game.liveSetLimitReductions).toEqual([expect.objectContaining({ amount: 1 })]);
    }
  );
});

function reenter(game: GameState): GameState {
  return emitGameEvent(
    game,
    createEnterStageEvent('actor', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
  );
}
function capturedPending(game: GameState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.map((ability) => ({
      ...ability,
      sourceLifecycleId: getStageMemberLifecycleId(game, 'actor'),
    })),
  };
}
describe('single copied self actions keep the original source rules object', () => {
  it.each(['NATIVE', 'HOST', 'FREE'] as const)(
    'HS2008 %s does not give BLADE to a host that re-entered before pending resolution',
    (mode) => {
      const entry = entryFor('hs-bp2-008-kosuzu');
      const game = settle(reenter(capturedPending(setup(entry, mode))));
      expect(
        game.liveResolution.liveModifiers.filter((m) => m.abilityId === entry.abilityId)
      ).toEqual([]);
    }
  );
  it.each(['NATIVE', 'HOST'] as const)(
    'HS2009 %s keeps paid energy but does not give Hearts to the re-entered source',
    (mode) => {
      const entry = entryFor('hs-bp2-009-hime');
      let game = resolvePendingCardEffects(capturedPending(setup(entry, mode))).gameState;
      game = settle(reenter(game));
      expect(
        game.liveResolution.liveModifiers.filter((m) => m.abilityId === entry.abilityId)
      ).toEqual([]);
      expect(
        game.players[0].energyZone.cardIds.filter(
          (id) =>
            game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
        )
      ).toHaveLength(3);
      expect(
        game.actionHistory.filter(
          (a) => a.type === 'PAY_COST' && a.payload.abilityId === entry.abilityId
        )
      ).toHaveLength(1);
    }
  );
  it('HS2009 free immediate resolution does not reward a re-entered source either', () => {
    const entry = entryFor('hs-bp2-009-hime');
    const game = settle(reenter(capturedPending(setup(entry, 'FREE'))));
    expect(
      game.liveResolution.liveModifiers.filter((m) => m.abilityId === entry.abilityId)
    ).toEqual([]);
    expect(game.actionHistory.filter((a) => a.type === 'PAY_COST')).toEqual([]);
  });
  it.each(['NATIVE', 'HOST', 'FREE'] as const)(
    'PB1012 %s still recycles and recovers after re-entry, while its old source receives no BLADE',
    (mode) => {
      const entry = entryFor('hs-pb1-012-ginko');
      let game = resolvePendingCardEffects(capturedPending(setup(entry, mode))).gameState;
      game = step(game);
      expect(game.activeEffect?.selectableCardIds).toContain('cerise-live');
      game = settle(reenter(restore(game)));
      expect([
        game.players[0].hand.cardIds.length,
        game.players[0].mainDeck.cardIds.length,
        game.players[0].waitingRoom.cardIds.length,
      ]).toEqual([4, 30, 3]);
      expect(
        game.liveResolution.liveModifiers.filter((m) => m.abilityId === entry.abilityId)
      ).toEqual([]);
      expect(game.actionHistory.at(-1)?.payload.bladeBonus).toBe(0);
    }
  );
  it.each(['NATIVE', 'HOST', 'FREE'] as const)(
    'PB1012 %s keeps both completed recycle movements even when the old source has left and no LIVE can be recovered',
    (mode) => {
      const entry = entryFor('hs-pb1-012-ginko');
      let game = updatePlayer(capturedPending(setup(entry, mode)), P1, (p) => ({
        ...p,
        waitingRoom: {
          ...p.waitingRoom,
          cardIds: p.waitingRoom.cardIds.filter((id) => id.startsWith('waiting-')),
        },
      }));
      game = resolvePendingCardEffects(game).gameState;
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        memberSlots: {
          ...p.memberSlots,
          slots: { ...p.memberSlots.slots, [SlotPosition.CENTER]: null },
        },
      }));
      game = settle(game);
      expect(game.players[0].mainDeck.cardIds).toHaveLength(30);
      expect(game.players[1].mainDeck.cardIds).toHaveLength(10);
      expect(game.players[0].waitingRoom.cardIds).toEqual([]);
      expect(
        game.liveResolution.liveModifiers.filter((m) => m.abilityId === entry.abilityId)
      ).toEqual([]);
      expect(game.actionHistory.at(-1)?.payload.bladeBonus).toBe(0);
    }
  );
  it.each(['NATIVE', 'HOST', 'FREE'] as const)(
    'HS6008 %s skips the unavailable old self-wait and still performs its independent recovery',
    (mode) => {
      const entry = entryFor('hs-bp6-008-izumi');
      const game = settle(reenter(capturedPending(setup(entry, mode))));
      expect(game.players[0].memberSlots.cardStates.get('actor')?.orientation).toBe(
        OrientationState.ACTIVE
      );
      expect(game.players[0].hand.cardIds).toHaveLength(4);
      expect(game.players[0].waitingRoom.cardIds).toHaveLength(13);
      expect(
        game.eventLog.filter(
          ({ event }) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
        )
      ).toEqual([]);
    }
  );
});

it.each(['NATIVE', 'HOST', 'FREE'] as const)(
  'HS6008 %s still recovers when the old source has left before resolving',
  (mode) => {
    const entry = entryFor('hs-bp6-008-izumi');
    let game = capturedPending(setup(entry, mode));
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        slots: { ...p.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    game = settle(game);
    expect(game.players[0].hand.cardIds).toHaveLength(4);
    expect(game.players[0].waitingRoom.cardIds).toHaveLength(13);
    expect(
      game.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toEqual([]);
  }
);
