import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP8_002_AUTO_LEAVE_STAGE_BOTTOM_SELF_WAIT_ORIGINAL_HEART_FOUR_ABILITY_ID as ABILITY,
  HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID as LISTENER,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  recoverCardsFromWaitingRoomToHandForPlayer,
  discardOneHandCardToWaitingRoomForPlayer,
} from '../../src/application/card-effects/runtime/actions';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  addHeartLiveModifierForSourceMember,
  addLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const TEXT =
  '【自动】此成员从舞台被放置入休息室时，可以将此卡放置于卡组底。如此做时，将存在于对方的舞台的１名原本持有的HEART的数量小于等于４的成员变为待机状态。';

function member(code: string, id: string, hearts: number, owner = P1, cost = 1) {
  const data: MemberCardData = {
    cardCode: code,
    name: id,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: hearts ? [createHeartIcon(HeartColor.PINK, hearts)] : [],
  };
  return createCardInstance(data, owner, id);
}

function setup(options: { code?: string; target?: boolean; watcher?: boolean } = {}) {
  // Fixed local fixtures from cards_export_2026-10-21.json; synthetic cards only model targets/fillers.
  const source = createCardInstance(
    {
      cardCode: options.code ?? 'PL!-bp8-002-P',
      name: '绚濑绘里',
      cardType: CardType.MEMBER,
      cost: 9,
      blade: 4,
      groupNames: ['μ’s'],
      unitName: 'BiBi',
      hearts: [
        createHeartIcon(HeartColor.PINK, 1),
        createHeartIcon(HeartColor.YELLOW, 1),
        createHeartIcon(HeartColor.PURPLE, 1),
      ],
    },
    P1,
    'eli'
  );
  const low = member('TEST-FOUR', 'low', 4, P2);
  const high = member('TEST-FIVE', 'high', 5, P2);
  const waiting = member('TEST-WAITING', 'waiting', 2, P2);
  const replacement = member('TEST-REPLACEMENT', 'replacement', 0, P1, 9);
  const deck = member('TEST-DECK', 'deck', 0);
  const enemyDeck = member('TEST-ENEMY-DECK', 'enemy-deck', 0, P2);
  const watcher = createCardInstance(
    {
      cardCode: 'PL!HS-bp8-001-P',
      name: '日野下花帆',
      cardType: CardType.MEMBER,
      cost: 13,
      blade: 3,
      groupNames: ['蓮ノ空'],
      unitName: 'スリーズブーケ',
      hearts: [
        createHeartIcon(HeartColor.GREEN, 2),
        createHeartIcon(HeartColor.BLUE, 1),
        createHeartIcon(HeartColor.PURPLE, 1),
      ],
    },
    P1,
    'watcher'
  );
  let game = registerCards(createGameState('bp8-002', P1, 'P1', P2, 'P2'), [
    source,
    low,
    high,
    waiting,
    replacement,
    deck,
    enemyDeck,
    watcher,
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: ['replacement'] },
    mainDeck: { ...player.mainDeck, cardIds: ['deck'] },
    memberSlots: placeCardInSlot(
      options.watcher
        ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'watcher')
        : player.memberSlots,
      SlotPosition.CENTER,
      'eli'
    ),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['enemy-deck'] },
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        options.target === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'low'),
        SlotPosition.CENTER,
        'high'
      ),
      SlotPosition.RIGHT,
      'waiting',
      { orientation: OrientationState.WAITING }
    ),
  }));
  return { game, source, low, high, watcher };
}

function leave(game: GameState): GameState {
  return sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    game,
    P1,
    'eli',
    enqueueTriggeredCardEffects
  )!.gameState;
}
function start(game: GameState): GameState {
  return resolvePendingCardEffects(leave(game)).gameState;
}
function activate(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    false,
    'activate'
  );
}
function select(game: GameState, id: string | null): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, id);
}
function movementEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}
function waitEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
}

describe('PL!-bp8-002 费用9 绚濑绘里', () => {
  it.each(['P', 'N', 'P+', 'SEC', 'UNSEEN'])(
    'registers full Chinese text and all rarities: %s',
    (rarity) => {
      const definitions = getCardAbilityDefinitionsForCardCode(`PL!-bp8-002-${rarity}`);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        abilityId: ABILITY,
        baseCardCodes: ['PL!-bp8-002'],
        category: 'AUTO',
        sourceZone: 'STAGE_MEMBER',
        triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
        triggerToZones: [ZoneType.WAITING_ROOM],
        queued: true,
        implemented: true,
        effectText: TEXT,
      });
      expect(definitions[0]?.cardCodes).toBeUndefined();
      expect(start(setup({ code: `PL!-bp8-002-${rarity}` }).game).activeEffect?.effectText).toBe(
        TEXT
      );
    }
  );

  it('uses a real RULES relay command, fixed-self decision, bottom movement and opponent state event', () => {
    const { game } = setup();
    const session = createGameSession();
    session.createGame('bp8-002', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;
    expect(session.setManualOperationMode('RULES').success).toBe(true);
    const play = session.executeCommand(
      createPlayMemberToSlotCommand(P1, 'replacement', SlotPosition.CENTER, {
        relayMode: 'SINGLE',
        relayReplacementSlots: [SlotPosition.CENTER],
      })
    );
    expect(play.success, play.error).toBe(true);
    const optional = session.state!.activeEffect!;
    expect(optional).toMatchObject({
      abilityId: ABILITY,
      effectText: TEXT,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      confirmSelectionLabel: '发动',
    });
    expect(optional.selectableCardIds).toBeUndefined();
    expect(session.state!.eventLog.map((entry) => entry.event)).toContainEqual(
      expect.objectContaining({
        eventType: TriggerCondition.ON_LEAVE_STAGE,
        cardInstanceId: 'eli',
        replacingCardId: 'replacement',
        fromZone: ZoneType.MEMBER_SLOT,
        toZone: ZoneType.WAITING_ROOM,
      })
    );
    const paid = session.executeCommand(
      createConfirmEffectStepCommand(P1, optional.id, undefined, undefined, undefined, 'activate')
    );
    expect(paid.success, paid.error).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['deck', 'eli']);
    expect(session.state!.activeEffect).toMatchObject({
      selectableCardIds: ['low'],
      confirmSelectionLabel: '变为待机状态',
    });
    expect(session.state!.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state!.activeEffect?.canSkipSelection).toBeUndefined();
    const done = session.executeCommand(createConfirmEffectStepCommand(P1, optional.id, 'low'));
    expect(done.success, done.error).toBe(true);
    expect(session.state!.players[1].memberSlots.cardStates.get('low')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(movementEvents(session.state!)).toEqual([
      expect.objectContaining({
        movedCardIds: ['eli'],
        destination: { kind: 'BOTTOM' },
        cause: expect.objectContaining({
          kind: 'CARD_EFFECT',
          sourceCardId: 'eli',
          abilityId: ABILITY,
          pendingAbilityId: optional.id,
        }),
      }),
    ]);
    expect(waitEvents(session.state!)).toEqual([
      expect.objectContaining({
        cardInstanceId: 'low',
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
        cause: expect.objectContaining({ sourceCardId: 'eli', abilityId: ABILITY }),
      }),
    ]);
  });

  it('declines without moving or emitting either result event', () => {
    const initial = start(setup().game);
    const done = select(initial, null);
    expect(done.players[0].waitingRoom.cardIds).toContain('eli');
    expect(done.activeEffect).toBeNull();
    expect(movementEvents(done)).toEqual([]);
    expect(waitEvents(done)).toEqual([]);
  });

  it('allows bottoming with no later legal opponent target', () => {
    const done = activate(start(setup({ target: false }).game));
    expect(done.players[0].mainDeck.cardIds).toEqual(['deck', 'eli']);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(movementEvents(done)).toHaveLength(1);
    expect(waitEvents(done)).toEqual([]);
  });

  it('queues bottom-movement listeners but finishes its own target step before continuation', () => {
    const choosing = activate(start(setup({ watcher: true }).game));
    expect(choosing.activeEffect?.abilityId).toBe(ABILITY);
    expect(choosing.pendingAbilities).toContainEqual(
      expect.objectContaining({ abilityId: LISTENER })
    );
    expect(
      choosing.liveResolution.liveModifiers.some((modifier) => modifier.abilityId === LISTENER)
    ).toBe(false);
    const continued = select(choosing, 'low');
    expect(continued.activeEffect).toBeNull();
    expect(continued.pendingAbilities).toEqual([]);
    expect(continued.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        abilityId: LISTENER,
        sourceCardId: 'watcher',
        kind: 'BLADE',
        countDelta: 3,
      })
    );
    expect(
      continued.actionHistory.filter(
        (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === LISTENER
      )
    ).toHaveLength(1);
  });

  it('ignores ordinary Heart bonuses and honors original-Heart replacements', () => {
    let game = addHeartLiveModifierForSourceMember(setup().game, {
      playerId: P2,
      sourceCardId: 'low',
      abilityId: 'test:bonus',
      hearts: [createHeartIcon(HeartColor.BLUE, 20)],
    })!.gameState;
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: P2,
      memberCardId: 'high',
      sourceCardId: 'high',
      abilityId: 'test:original',
      hearts: [createHeartIcon(HeartColor.PINK, 4)],
    });
    expect(activate(start(game)).activeEffect?.selectableCardIds).toEqual(['low', 'high']);
  });

  it('rejects forged options, card selections and wrong-controller submissions without advancing', () => {
    const initial = start(setup().game);
    expect(
      confirmActiveEffectStep(
        initial,
        P1,
        initial.activeEffect!.id,
        undefined,
        undefined,
        false,
        'forged'
      )
    ).toBe(initial);
    expect(
      confirmActiveEffectStep(
        initial,
        P2,
        initial.activeEffect!.id,
        undefined,
        undefined,
        false,
        'activate'
      )
    ).toBe(initial);
    expect(select(initial, 'eli')).toBe(initial);
    expect(
      confirmActiveEffectStep(
        initial,
        P1,
        initial.activeEffect!.id,
        undefined,
        undefined,
        false,
        'activate',
        ['eli']
      )
    ).toBe(initial);
    const choosing = activate(initial);
    expect(select(choosing, 'high')).toBe(choosing);
    expect(select(choosing, 'eli')).toBe(choosing);
    expect(select(choosing, null)).toBe(choosing);
    for (const ids of [[], ['low'], ['low', 'low'], ['low', 'high']]) {
      expect(
        confirmActiveEffectStep(
          choosing,
          P1,
          choosing.activeEffect!.id,
          undefined,
          undefined,
          false,
          undefined,
          ids
        )
      ).toBe(choosing);
    }
    expect(
      confirmActiveEffectStep(
        choosing,
        P1,
        choosing.activeEffect!.id,
        'low',
        undefined,
        false,
        'activate'
      )
    ).toBe(choosing);
  });

  it('rejects a waiting-room round-trip before the pending ability first starts', () => {
    let game = leave(setup().game);
    game = recoverCardsFromWaitingRoomToHandForPlayer(game, P1, ['eli'], {
      candidateCardIds: ['eli'],
      exactCount: 1,
    })!.gameState;
    game = discardOneHandCardToWaitingRoomForPlayer(game, P1, 'eli')!.gameState;
    const done = resolvePendingCardEffects(game).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toContain('eli');
    expect(movementEvents(done)).toEqual([]);
  });

  it.each(['moved-away', 'round-trip', 'reentered-stage'])(
    'does not bottom an unavailable source object: %s',
    (kind) => {
      let game = start(setup().game);
      const recovered = recoverCardsFromWaitingRoomToHandForPlayer(game, P1, ['eli'], {
        candidateCardIds: ['eli'],
        exactCount: 1,
      })!;
      game = recovered.gameState;
      if (kind === 'round-trip') {
        game = discardOneHandCardToWaitingRoomForPlayer(game, P1, 'eli')!.gameState;
      } else if (kind === 'reentered-stage') {
        game = updatePlayer(game, P1, (player) => ({
          ...player,
          hand: { ...player.hand, cardIds: [] },
          memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'eli'),
        }));
        game = emitGameEvent(
          game,
          createEnterStageEvent('eli', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
        );
        game = leave(game);
      }
      const done = activate(game);
      expect(done.players[0].mainDeck.cardIds).toEqual(['deck']);
      expect(movementEvents(done)).toEqual([]);
      expect(waitEvents(done)).toEqual([]);
    }
  );

  it('rejects missing or mismatched leave-event facts at the pending starter', () => {
    const valid = leave(setup().game);
    for (const eventIds of [['missing'], []]) {
      const done = resolvePendingCardEffects({
        ...valid,
        pendingAbilities: valid.pendingAbilities.map((ability) => ({ ...ability, eventIds })),
      }).gameState;
      expect(done.activeEffect).toBeNull();
      expect(movementEvents(done)).toEqual([]);
    }
    const wrong = createLeaveStageEvent('high', SlotPosition.CENTER, ZoneType.WAITING_ROOM, P2, P2);
    const altered = emitGameEvent(valid, wrong);
    const done = resolvePendingCardEffects({
      ...altered,
      pendingAbilities: valid.pendingAbilities.map((ability) => ({
        ...ability,
        eventIds: [wrong.eventId],
      })),
    }).gameState;
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toContain('eli');
  });

  it.each(['original-heart', 'left-stage', 'reentered-stage'])(
    'consumes a now-stale target as a no-op after retaining paid bottom: %s',
    (kind) => {
      let choosing = activate(start(setup().game));
      if (kind === 'original-heart') {
        choosing = addLiveModifier(choosing, {
          kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
          playerId: P2,
          memberCardId: 'low',
          sourceCardId: 'low',
          abilityId: 'test:changed-original',
          hearts: [createHeartIcon(HeartColor.BLUE, 5)],
        });
      } else {
        choosing = updatePlayer(choosing, P2, (player) => ({
          ...player,
          memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        }));
        choosing = emitGameEvent(
          choosing,
          createLeaveStageEvent('low', SlotPosition.LEFT, ZoneType.HAND, P2, P2)
        );
        if (kind === 'reentered-stage') {
          choosing = updatePlayer(choosing, P2, (player) => ({
            ...player,
            memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'low'),
          }));
          choosing = emitGameEvent(
            choosing,
            createEnterStageEvent('low', ZoneType.HAND, SlotPosition.LEFT, P2, P2)
          );
        }
      }
      const done = select(choosing, 'low');
      expect(done.activeEffect).toBeNull();
      expect(done.players[0].mainDeck.cardIds).toEqual(['deck', 'eli']);
      expect(waitEvents(done)).toEqual([]);
    }
  );
});
