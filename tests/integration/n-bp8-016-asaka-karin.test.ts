import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP8_016_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_TWO_OR_LESS_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { delegateWaitingRoomMemberOnEnterAbility } from '../../src/application/card-effects/workflows/shared/activate-waiting-room-member-on-enter-ability';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLeaveStageEvent } from '../../src/domain/events/game-events';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { getNovember07MemberData } from '../helpers/november-07-draft-effects';
import { choose, gameWithCards, member, P1, P2 } from '../helpers/card-effect-zone-fixture';

const TEXT =
  '【登场】将存在于对方的舞台的１名原本持有的[ブレード]的数量小于等于２的成员变为待机状态。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）';
function setup(
  options: { code?: string; hand?: boolean; energies?: number; low?: boolean } = {}
): GameState {
  const source = createCardInstance(
    { ...getNovember07MemberData('PL!N-bp8-016'), cardCode: options.code ?? 'PL!N-bp8-016-N' },
    P1,
    'source'
  );
  const energies = Array.from({ length: options.energies ?? 11 }, (_, i) =>
    createCardInstance(
      { cardCode: `ENERGY-${i}`, name: '能量', cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  let game = gameWithCards([
    source,
    member('low', { blade: 2, groupNames: ['Aqours'] }, P2),
    member('high', { blade: 3 }, P2),
    member('waiting', { blade: 0 }, P2),
    member('deck'),
    ...energies,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: options.hand ? ['source'] : [] },
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    memberSlots: options.hand
      ? p.memberSlots
      : placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'),
    energyZone: energies.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      p.energyZone
    ),
  }));
  game = updatePlayer(game, P2, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        options.low === false
          ? p.memberSlots
          : placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'low'),
        SlotPosition.CENTER,
        'high'
      ),
      SlotPosition.RIGHT,
      'waiting',
      { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
    ),
  }));
  return {
    ...game,
    manualOperationMode: 'RULES',
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}
function start(game = setup()): GameState {
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(
      emitGameEvent(
        game,
        createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
      ),
      [TriggerCondition.ON_ENTER_STAGE]
    )
  ).gameState;
}
function stateEvents(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
}
function protectedGame(game: GameState): GameState {
  return addMemberWaitProtectionUntilLiveEnd(game, {
    affectedPlayerId: P2,
    sourceCardId: 'protection',
    abilityId: 'test:wait-protection',
  });
}

describe('PL!N-bp8-016 费用11 朝香果林', () => {
  it.each(['N', 'P', 'SEC', 'UNSEEN'])(
    'covers every rarity with full text and independent delegation: %s',
    (rare) => {
      const definitions = getCardAbilityDefinitionsForCardCode(`PL!N-bp8-016-${rare}`);
      expect(definitions).toEqual([
        expect.objectContaining({
          abilityId: ABILITY,
          baseCardCodes: ['PL!N-bp8-016'],
          effectText: TEXT,
          delegatedOnEnterFromWaitingRoomPolicy: {
            decision: 'ALLOW',
            reason: 'SOURCE_INDEPENDENT',
          },
        }),
      ]);
      expect(definitions[0]?.cardCodes).toBeUndefined();
      expect(start(setup({ code: `PL!N-bp8-016-${rare}` })).activeEffect?.effectText).toBe(TEXT);
    }
  );
  it.each([10, 11])(
    'requires printed cost11 in RULES with %i active energy and resolves a mandatory target by command',
    (energyCount) => {
      const session = createGameSession({ cardEntrance: 'LOCAL' });
      session.createGame('karin-rules', P1, 'P1', P2, 'P2');
      session.restoreRuntimeState({
        authorityState: setup({ hand: true, energies: energyCount }),
        currentPublicSeq: 0,
      });
      const play = session.executeCommand(
        createPlayMemberToSlotCommand(P1, 'source', SlotPosition.CENTER, { relayMode: 'NONE' })
      );
      expect(play.success, play.error).toBe(energyCount === 11);
      if (energyCount === 10) return;
      const entrance = session.state!.entranceRuntime?.pending;
      if (entrance)
        expect(
          session.executeCommand({
            type: GameCommandType.ACK_CARD_ENTRANCE,
            playerId: P1,
            entranceId: entrance.id,
            timestamp: Date.now(),
          }).success
        ).toBe(true);
      expect(
        [...session.state!.players[0].energyZone.cardStates.values()].filter(
          ({ orientation }) => orientation === OrientationState.WAITING
        )
      ).toHaveLength(11);
      const effectId = session.state!.activeEffect!.id;
      expect(session.state!.activeEffect).toMatchObject({
        abilityId: ABILITY,
        selectableCardIds: ['low'],
        confirmSelectionLabel: '变为待机状态',
      });
      const selection = session.getPlayerViewState(P1)?.activeEffect;
      expect(selection?.selectableObjectMode ?? 'SINGLE').toBe('SINGLE');
      expect(selection?.selectableObjectIds).toEqual(['obj_low']);
      expect(selection?.effectChoice).toBeUndefined();
      expect(selection?.selectableOptions).toBeUndefined();
      expect(selection?.canSkipSelection).not.toBe(true);
      expect(
        session.executeCommand(createConfirmEffectStepCommand(P1, effectId, null)).success
      ).toBe(false);
      expect(
        session.executeCommand(createConfirmEffectStepCommand(P1, effectId, 'low')).success
      ).toBe(true);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.players[1].memberSlots.cardStates.get('low')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(stateEvents(session.state!)).toHaveLength(1);
      expect(stateEvents(session.state!)[0]).toMatchObject({
        cardInstanceId: 'low',
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
        cause: { abilityId: ABILITY, playerId: P1 },
      });
    }
  );
  it('uses original BLADE replacements while ignoring ordinary additions and reductions', () => {
    let game = addLiveModifier(setup(), {
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: P2,
      sourceCardId: 'low',
      abilityId: 'ordinary-plus',
      countDelta: 10,
    });
    game = addLiveModifier(game, {
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: P2,
      sourceCardId: 'high',
      abilityId: 'ordinary-minus',
      countDelta: -3,
    });
    expect(start(game).activeEffect?.selectableCardIds).toEqual(['low']);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P2,
      sourceCardId: 'high',
      memberCardId: 'high',
      abilityId: 'original-low',
      count: 2,
    });
    expect(start(game).activeEffect?.selectableCardIds).toEqual(['low', 'high']);
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P2,
      sourceCardId: 'low',
      memberCardId: 'low',
      abilityId: 'original-high',
      count: 3,
    });
    expect(start(game).activeEffect?.selectableCardIds).toEqual(['high']);
  });
  it('excludes waiting/protected targets and safely no-ops when protection appears later', () => {
    expect(start(protectedGame(setup())).activeEffect).toBeNull();
    expect(start(setup({ low: false })).activeEffect).toBeNull();
    const started = start();
    const done = choose(protectedGame(started), 'low');
    expect(done.activeEffect).toBeNull();
    expect(done.players[1].memberSlots.cardStates.get('low')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(stateEvents(done)).toEqual([]);
  });
  it('rejects skipping, foreign/high/already-waiting targets and still resolves after the source leaves', () => {
    const started = start();
    for (const id of [null, 'source', 'high', 'waiting', 'missing'])
      expect(choose(started, id)).toBe(started);
    expect(confirmActiveEffectStep(started, P2, started.activeEffect!.id, 'low')).toBe(started);
    const left = updatePlayer(started, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    const done = choose(left, 'low');
    expect(done.players[1].memberSlots.cardStates.get('low')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(stateEvents(done)).toHaveLength(1);
  });
  it.each(['left', 'reentered', 'original-changed'])(
    'consumes a selected target that became %s as a no-op',
    (kind) => {
      let game = start();
      if (kind === 'original-changed')
        game = addLiveModifier(game, {
          kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
          playerId: P2,
          sourceCardId: 'low',
          memberCardId: 'low',
          abilityId: 'changed',
          count: 3,
        });
      else {
        game = updatePlayer(game, P2, (p) => ({
          ...p,
          memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT),
        }));
        game = emitGameEvent(
          game,
          createLeaveStageEvent('low', SlotPosition.LEFT, ZoneType.HAND, P2, P2)
        );
        if (kind === 'reentered') {
          game = updatePlayer(game, P2, (p) => ({
            ...p,
            memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'low'),
          }));
          game = emitGameEvent(
            game,
            createEnterStageEvent('low', ZoneType.HAND, SlotPosition.LEFT, P2, P2)
          );
        }
      }
      const done = choose(game, 'low');
      expect(done.activeEffect).toBeNull();
      expect(stateEvents(done)).toEqual([]);
    }
  );
  it('delegates from the waiting room through the real source-independent helper and runner without a stage entry', () => {
    let game = updatePlayer(setup(), P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: ['source'] },
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    game = delegateWaitingRoomMemberOnEnterAbility(
      game,
      {
        controllerId: P1,
        parentAbilityId: 'test-parent',
        parentSourceCardId: 'parent',
        parentEffectId: 'parent-effect',
        targetCardId: 'source',
        delegatedAbilityId: ABILITY,
        orderedResolution: false,
      },
      (state, ability) =>
        resolvePendingCardEffects({
          ...state,
          pendingAbilities: [...state.pendingAbilities, ability],
        }).gameState
    );
    expect(game.activeEffect).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: 'source',
      selectableCardIds: ['low'],
    });
    const done = choose(game, 'low');
    expect(done.players[0].waitingRoom.cardIds).toEqual(['source']);
    expect(done.players[1].memberSlots.cardStates.get('low')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      done.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE)
    ).toEqual([]);
    expect(done.pendingAbilities).toEqual([]);
  });
});
