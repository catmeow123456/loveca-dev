import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PB2_018_ON_ENTER_ACTIVATE_OPPONENT_MEMBERS_DRAW_ABILITY_ID as DRAW,
  PL_PB2_018_ON_ENTER_DISCARD_THREE_DIFFERENT_BIBI_WAIT_OPPONENT_ABILITY_ID as ENTER,
  PL_PB2_018_LIVE_START_DISCARD_THREE_DIFFERENT_BIBI_WAIT_OPPONENT_ABILITY_ID as START,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID as REACTION,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getAbilitySourceLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  placeCardInSlot,
  removeCardFromSlot,
  addCardToStatefulZone,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addMemberEffectActivationProhibitionUntilTurnEnd } from '../../src/domain/rules/member-effect-activation-prohibitions';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState as O,
  SlotPosition as S,
  TriggerCondition as T,
  ZoneType,
} from '../../src/shared/types/enums';
import { projectPlayerViewState } from '../../src/online/projector';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';

const DRAW_TEXT =
  '【登场】可以将至多3名存在于对方的舞台的待机状态的成员变为活跃状态。如此做时，每有1名因此变为活跃状态的成员，抽1张卡。';
const DISCARD_TEXT =
  '【登场】/【LIVE开始时】可以将手牌的3张名称各不相同的『BiBi』的成员卡放置入休息室：自己的舞台上仅存在『BiBi』的成员的场合，将存在于对方的舞台的1名成员变为待机状态。';
const COST = ['eli', 'maki', 'hand-nico'];
function data(code: string, name = code, unitName = 'BiBi'): MemberCardData {
  return {
    cardCode: code,
    name,
    unitName,
    groupNames: ['μ’s'],
    cardType: CardType.MEMBER,
    cost: 17,
    blade: 8,
    hearts: [],
  };
}
function pending(abilityId: string, id = `pending:${abilityId}`): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId: 'nico',
    controllerId: 'p1',
    sourceSlot: S.CENTER,
    mandatory: true,
    timingId: abilityId === START ? T.ON_LIVE_START : T.ON_ENTER_STAGE,
    eventIds: [],
  };
}
function setup(abilityId = DRAW, rarity = 'P+'): GameState {
  const cards = [
    createCardInstance(data(`PL!-pb2-018-${rarity}`, '矢澤にこ'), 'p1', 'nico'),
    createCardInstance(data('ELI-P', '絢瀬絵里'), 'p1', 'eli'),
    createCardInstance(data('ELI-P+', '绚濑绘里'), 'p1', 'eli-copy'),
    createCardInstance(data('MAKI-P', '西木野真姫'), 'p1', 'maki'),
    createCardInstance(data('NICO-HAND', '矢澤にこ'), 'p1', 'hand-nico'),
    createCardInstance(data('OTHER', '小泉花陽', 'Printemps'), 'p1', 'other'),
    createCardInstance(data('DUO', '绚濑绘里＆西木野真姬'), 'p1', 'duo'),
    ...['opp0', 'opp1', 'opp2'].map((id) =>
      createCardInstance({ ...data(id), groupNames: ['Aqours'], blade: 1 }, 'p2', id)
    ),
    ...Array.from({ length: 5 }, (_, i) => createCardInstance(data(`DECK-${i}`), 'p1', `deck${i}`)),
  ];
  let game = registerCards(createGameState('nico', 'p1', 'P1', 'p2', 'P2'), cards);
  game = updatePlayer(game, 'p1', (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: [...COST, 'eli-copy', 'other', 'duo'] },
    mainDeck: { ...p.mainDeck, cardIds: ['deck0', 'deck1', 'deck2', 'deck3', 'deck4'] },
    memberSlots: placeCardInSlot(p.memberSlots, S.CENTER, 'nico', {
      orientation: O.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, 'p2', (p) => {
    let memberSlots = p.memberSlots;
    for (const [index, slot] of [S.LEFT, S.CENTER, S.RIGHT].entries())
      memberSlots = placeCardInSlot(memberSlots, slot, `opp${index}`, {
        orientation: O.WAITING,
        face: FaceState.FACE_UP,
      });
    return { ...p, memberSlots };
  });
  game = addCheckTimingRuleSentinel(game, 'p2', 'nico2');
  return { ...game, currentPhase: GamePhase.MAIN_PHASE, pendingAbilities: [pending(abilityId)] };
}
function many(game: GameState, ids: readonly string[]) {
  return confirmActiveEffectStep(
    game,
    'p1',
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    ids
  );
}
function select(game: GameState, cardId: string) {
  return confirmActiveEffectStep(game, 'p1', game.activeEffect!.id, cardId);
}
function pay(abilityId = ENTER) {
  return many(resolvePendingCardEffects(setup(abilityId)).gameState, COST);
}
function onlyHand(game: GameState, cardIds: readonly string[]) {
  return updatePlayer(game, 'p1', (p) => ({ ...p, hand: { ...p.hand, cardIds } }));
}
const stateEvents = (game: GameState) =>
  game.eventLog.filter((entry) => entry.event.eventType === T.ON_MEMBER_STATE_CHANGED);
const payments = (game: GameState) =>
  game.actionHistory.filter((action) => action.type === 'PAY_COST');

describe('PL!-pb2-018 费用17「矢泽日香（矢泽妮可）」', () => {
  it.each(['P', 'P+', 'R', 'NEW'])(
    'registers three independent all-rarity abilities for %s with complete Chinese paragraphs',
    (rare) => {
      const defs = getCardAbilityDefinitionsForCardCode(`PL!-pb2-018-${rare}`);
      expect(defs.map((d) => d.abilityId)).toEqual([DRAW, ENTER, START]);
      expect(defs.find((d) => d.abilityId === DRAW)?.effectText).toBe(DRAW_TEXT);
      expect(defs.find((d) => d.abilityId === ENTER)?.effectText).toBe(DISCARD_TEXT);
      expect(defs.find((d) => d.abilityId === START)?.effectText).toBe(DISCARD_TEXT);
      expect(resolvePendingCardEffects(setup(DRAW, rare)).gameState.activeEffect?.abilityId).toBe(
        DRAW
      );
    }
  );
  it.each([0, 1, 2, 3])(
    'activates %i selected waiting opponents and draws exactly that many cards',
    (count) => {
      let game = resolvePendingCardEffects(setup()).gameState;
      const oldHand = game.players[0]!.hand.cardIds;
      game = many(
        game,
        Array.from({ length: count }, (_, i) => `opp${i}`)
      );
      expect(game.activeEffect).toBeNull();
      expect(game.players[0]!.hand.cardIds).toEqual([
        ...oldHand,
        ...Array.from({ length: count }, (_, i) => `deck${i}`),
      ]);
      expect(stateEvents(game)).toHaveLength(count);
      expect(
        stateEvents(game).every((e) => 'cause' in e.event && e.event.cause?.sourceCardId === 'nico')
      ).toBe(true);
      for (let i = 0; i < 3; i++)
        expect(game.players[1]!.memberSlots.cardStates.get(`opp${i}`)?.orientation).toBe(
          i < count ? O.ACTIVE : O.WAITING
        );
    }
  );
  it('does not draw or get stuck when a continuous prohibition prevents every requested activation', () => {
    let game = resolvePendingCardEffects(setup()).gameState;
    game = addMemberEffectActivationProhibitionUntilTurnEnd(game, {
      affectedPlayerIds: ['p2'],
      sourceCardId: 'prohibition',
      abilityId: 'prohibition',
    });
    const oldHand = game.players[0]!.hand.cardIds;
    game = many(game, ['opp0', 'opp1']);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0]!.hand.cardIds).toEqual(oldHand);
    expect(stateEvents(game)).toEqual([]);
  });
  it('rejects duplicate/own/unknown targets and refreshes a stale activation selection without partial changes', () => {
    const initial = resolvePendingCardEffects(setup()).gameState;
    for (const ids of [['opp0', 'opp0'], ['nico'], ['missing']])
      expect(many(initial, ids)).toBe(initial);
    const stale = updatePlayer(initial, 'p2', (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, S.LEFT),
      hand: { ...p.hand, cardIds: ['opp0'] },
    }));
    const result = many(stale, ['opp0', 'opp1']);
    expect(result.activeEffect?.selectableCardIds).toEqual(['opp1', 'opp2']);
    expect(stateEvents(result)).toEqual([]);
    expect(result.players[0]!.hand.cardIds).toEqual(initial.players[0]!.hand.cardIds);
  });
  it('uses the refresh-aware draw helper across the last deck card', () => {
    let game = setup();
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['deck0'] },
      waitingRoom: { ...p.waitingRoom, cardIds: ['deck1', 'deck2', 'deck3'] },
    }));
    const old = game.players[0]!.hand.cardIds.length;
    game = many(resolvePendingCardEffects(game).gameState, ['opp0', 'opp1', 'opp2']);
    expect(game.players[0]!.hand.cardIds).toHaveLength(old + 3);
    expect(game.players[0]!.hand.cardIds).toContain('deck0');
    expect(
      game.actionHistory.some((a) => a.type === 'RULE_ACTION' && a.payload.type === 'REFRESH')
    ).toBe(true);
  });
  it.each([ENTER, START])(
    'pays an exact distinct-name BiBi cost for %s; already waiting targets remain legal no-ops',
    (abilityId) => {
      let game = resolvePendingCardEffects(setup(abilityId)).gameState;
      expect(projectPlayerViewState(game, 'p1').activeEffect?.confirmSelectionLabel).toBe(
        '放置入休息室'
      );
      const opponentView = projectPlayerViewState(game, 'p2');
      expect(opponentView.activeEffect?.selectableObjectIds).toBeUndefined();
      game = many(game, COST);
      expect(game.activeEffect).toMatchObject({
        abilityId,
        selectableCardIds: ['opp0', 'opp1', 'opp2'],
        canSkipSelection: false,
      });
      expect(payments(game)).toHaveLength(1);
      expect(payments(game)[0]!.payload.discardedHandCardIds).toEqual(COST);
      const moved = game.eventLog.filter((e) => e.event.eventType === T.ON_ENTER_WAITING_ROOM);
      expect(moved).toHaveLength(1);
      expect(moved[0]!.event).toMatchObject({ fromZone: ZoneType.HAND, cardInstanceIds: COST });
      game = select(game, 'opp0');
      expect(game.activeEffect).toBeNull();
      expect(stateEvents(game)).toEqual([]);
    }
  );
  it('does not offer payment without three different names; rejects same-name prints, duplicates, wrong-unit and incomplete cost', () => {
    const noNames = resolvePendingCardEffects(
      onlyHand(setup(ENTER), ['eli', 'eli-copy', 'maki'])
    ).gameState;
    expect(noNames.activeEffect).toBeNull();
    const game = resolvePendingCardEffects(setup(ENTER)).gameState;
    for (const ids of [
      ['eli', 'eli-copy', 'maki'],
      ['eli', 'eli', 'maki'],
      ['eli', 'maki', 'other'],
      ['eli', 'maki'],
    ])
      expect(many(game, ids)).toBe(game);
    expect(many(game, []).activeEffect).toBeNull();
    expect(payments(game)).toEqual([]);
  });
  it('uses the existing different-name assignment for DUO names instead of treating the full printed string as a third name', () => {
    expect(
      resolvePendingCardEffects(onlyHand(setup(ENTER), ['eli', 'maki', 'duo'])).gameState
        .activeEffect
    ).toBeNull();
    const game = many(
      resolvePendingCardEffects(onlyHand(setup(ENTER), ['eli', 'hand-nico', 'duo'])).gameState,
      ['eli', 'hand-nico', 'duo']
    );
    expect(payments(game)).toHaveLength(1);
  });
  it.each(['mixed-stage', 'no-opponent', 'protected-opponent'])(
    'keeps legal payment available with %s and never refunds it',
    (scenario) => {
      let game = setup(ENTER);
      if (scenario === 'mixed-stage')
        game = updatePlayer(game, 'p1', (p) => ({
          ...p,
          hand: { ...p.hand, cardIds: p.hand.cardIds.filter((id) => id !== 'other') },
          memberSlots: placeCardInSlot(p.memberSlots, S.LEFT, 'other'),
        }));
      if (scenario === 'no-opponent')
        game = updatePlayer(game, 'p2', (p) => ({
          ...p,
          memberSlots: removeCardFromSlot(
            removeCardFromSlot(removeCardFromSlot(p.memberSlots, S.LEFT), S.CENTER),
            S.RIGHT
          ),
        }));
      if (scenario === 'protected-opponent') {
        game = updatePlayer(game, 'p2', (p) => ({
          ...p,
          memberSlots: placeCardInSlot(p.memberSlots, S.LEFT, 'opp0', {
            orientation: O.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        }));
        game = addMemberWaitProtectionUntilLiveEnd(game, {
          affectedPlayerId: 'p2',
          sourceCardId: 'guard',
          abilityId: 'guard',
        });
      }
      game = many(resolvePendingCardEffects(game).gameState, COST);
      expect(payments(game)).toHaveLength(1);
      expect(game.players[0]!.waitingRoom.cardIds).toEqual(COST);
      if (scenario === 'protected-opponent') {
        game = select(game, 'opp0');
        expect(game.players[1]!.memberSlots.cardStates.get('opp0')?.orientation).toBe(O.ACTIVE);
      }
      expect(game.activeEffect).toBeNull();
    }
  );
  it('revalidates cost before paying and preserves an already paid cost when a target disappears', () => {
    const start = resolvePendingCardEffects(setup(ENTER)).gameState;
    const missing = updatePlayer(start, 'p1', (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: p.hand.cardIds.filter((id) => id !== 'maki') },
      waitingRoom: { ...p.waitingRoom, cardIds: ['maki'] },
    }));
    const invalid = many(missing, COST);
    expect(payments(invalid)).toEqual([]);
    expect(invalid.players[0]!.waitingRoom.cardIds).toEqual(['maki']);
    let paid = pay();
    paid = updatePlayer(paid, 'p2', (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(
        removeCardFromSlot(removeCardFromSlot(p.memberSlots, S.LEFT), S.CENTER),
        S.RIGHT
      ),
    }));
    paid = select(paid, 'opp0');
    expect(paid.activeEffect).toBeNull();
    expect(payments(paid)).toHaveLength(1);
    expect(paid.players[0]!.waitingRoom.cardIds).toEqual(COST);
  });
  it.each([DRAW, ENTER])(
    'allows choosing either independent ON_ENTER pending first (%s)',
    (first) => {
      const game = setup();
      const ordered = resolvePendingCardEffects({
        ...game,
        pendingAbilities: [pending(DRAW), pending(ENTER)],
      }).gameState;
      expect(ordered.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
      const selected = confirmActiveEffectStep(
        ordered,
        'p1',
        ordered.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        `pending:${first}`
      );
      expect(selected.activeEffect?.abilityId).toBe(first);
      expect(selected.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
      expect(selected.pendingAbilities.map((p) => p.abilityId)).toEqual([
        first === DRAW ? ENTER : DRAW,
      ]);
    }
  );
  it('keeps an enter-waiting-room trigger pending until the paid ability finishes its target step', () => {
    let game = setup(ENTER);
    game = registerCards(game, [
      createCardInstance(
        { ...data('PL!SP-bp5-005-P', '葉月恋'), groupNames: ['Liella!'] },
        'p1',
        'reaction'
      ),
      createCardInstance(
        { cardCode: 'ENERGY', name: 'E', cardType: CardType.ENERGY },
        'p1',
        'pay-energy'
      ),
    ]);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, S.LEFT, 'reaction'),
      energyZone: addCardToStatefulZone(p.energyZone, 'pay-energy', {
        orientation: O.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = many(resolvePendingCardEffects(game).gameState, COST);
    expect(game.activeEffect?.abilityId).toBe(ENTER);
    expect(game.pendingAbilities.filter((p) => p.abilityId === REACTION)).toHaveLength(1);
    game = select(game, 'opp0');
    expect(game.activeEffect?.abilityId).toBe(REACTION);
  });
  it('preserves an already-triggered source lifecycle across re-entry while queuing the new entry abilities separately', () => {
    let game = setup(ENTER);
    const firstEntry = createEnterStageEvent('nico', ZoneType.HAND, S.CENTER, 'p1', 'p1');
    game = emitGameEvent(game, firstEntry);
    const oldLifecycle = getAbilitySourceLifecycleId(game, ENTER, 'nico');
    game = {
      ...game,
      pendingAbilities: [
        { ...pending(ENTER), eventIds: [firstEntry.eventId], sourceLifecycleId: oldLifecycle },
      ],
    };
    game = resolvePendingCardEffects(game).gameState;
    const nextEntry = createEnterStageEvent('nico', ZoneType.WAITING_ROOM, S.CENTER, 'p1', 'p1');
    game = enqueueTriggeredCardEffects(emitGameEvent(game, nextEntry), [T.ON_ENTER_STAGE], {
      enteredMemberCardIds: ['nico'],
    });
    expect(game.activeEffect?.sourceLifecycleId).toBe(oldLifecycle);
    const currentLifecycle = getAbilitySourceLifecycleId(game, ENTER, 'nico');
    expect(currentLifecycle).not.toBe(oldLifecycle);
    expect(game.pendingAbilities.filter((p) => p.sourceCardId === 'nico')).toHaveLength(2);
    game = many(game, COST);
    expect(payments(game)).toHaveLength(1);
    expect(payments(game)[0]!.payload.sourceLifecycleId).toBe(oldLifecycle);
    expect(game.activeEffect?.abilityId).toBe(ENTER);
    expect(game.activeEffect?.sourceLifecycleId).toBe(oldLifecycle);
  });
  it('does not pay twice when a submitted command is replayed after reaching the target step', () => {
    const game = resolvePendingCardEffects(setup(ENTER)).gameState;
    const session = createGameSession();
    session.createGame('nico-replay', 'p1', 'P1', 'p2', 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;
    const command = createConfirmEffectStepCommand(
      'p1',
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      COST
    );
    expect(session.executeCommand(command).success).toBe(true);
    session.executeCommand(command);
    expect(payments(session.state!)).toHaveLength(1);
    expect(session.state!.players[0]!.waitingRoom.cardIds).toEqual(COST);
    expect(session.state!.activeEffect?.stepId).toBe('PL_PB2_018_SELECT_OPPONENT_MEMBER_TO_WAIT');
  });
});
