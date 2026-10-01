import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_PR_046_LIVE_SUCCESS_OPPONENT_CHEER_LIVE_DRAW_ONE_ABILITY_ID,
  PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
  PR_CONTINUOUS_TOTAL_SUCCESS_LIVE_SCORE_TEN_GAIN_PINK_HEART_ABILITY_ID,
  PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID,
  PR_ON_ENTER_LOOK_TOP_TEN_MINUS_HAND_TAKE_TWO_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { GameService } from '../../src/application/game-service';
import {
  getMemberEffectiveBladeCount,
  collectLiveModifiers,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function memberData(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['test'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function liveData(cardCode: string, score = 1): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['test'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function pending(
  id: string,
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  eventIds: readonly string[] = [id]
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId,
    eventIds,
  };
}

function attachSession(state: GameState) {
  const session = createGameSession();
  session.createGame('pr-shared-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

describe('PR continuous total successful LIVE score Heart family', () => {
  it.each(['PL!-PR-024-PR', 'PL!N-PR-034-SEC'])(
    'grants one public SOURCE_MEMBER pink Heart for %s only at total effective score 10',
    (cardCode) => {
      const source = createCardInstance(memberData(cardCode), P1, 'source');
      const ownLive = createCardInstance(liveData('OWN-LIVE', 4), P1, 'own-live');
      const opponentLive = createCardInstance(liveData('OPPONENT-LIVE', 6), P2, 'opponent-live');
      let game = registerCards(createGameState(`continuous-${cardCode}`, P1, 'P1', P2, 'P2'), [
        source,
        ownLive,
        opponentLive,
      ]);
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        successZone: addCardToZone(player.successZone, ownLive.instanceId),
      }));
      game = updatePlayer(game, P2, (player) => ({
        ...player,
        successZone: addCardToZone(player.successZone, opponentLive.instanceId),
      }));

      expect(collectLiveModifiers(game)).toContainEqual({
        kind: 'HEART',
        playerId: P1,
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.PINK, count: 1 }],
        sourceCardId: source.instanceId,
        abilityId: PR_CONTINUOUS_TOTAL_SUCCESS_LIVE_SCORE_TEN_GAIN_PINK_HEART_ABILITY_ID,
      });

      const belowThreshold = updatePlayer(game, P2, (player) => ({
        ...player,
        successZone: { ...player.successZone, cardIds: [] },
      }));
      expect(
        collectLiveModifiers(belowThreshold).some(
          (modifier) =>
            modifier.abilityId ===
            PR_CONTINUOUS_TOTAL_SUCCESS_LIVE_SCORE_TEN_GAIN_PINK_HEART_ABILITY_ID
        )
      ).toBe(false);
    }
  );
});

describe('PR relay replacement cost-nine BLADE family', () => {
  function setupReplacement(
    cost = 9,
    eventReplacingCardId: string | null = 'replacement',
    sourceCode = 'PL!-PR-025-PR'
  ) {
    const source = createCardInstance(
      memberData(sourceCode, sourceCode.startsWith('PL!S-PR-047') ? '樱内梨子' : '南琴梨', 4),
      P1,
      'source'
    );
    const replacement = createCardInstance(
      memberData('REPLACEMENT', '换手成员', cost),
      P1,
      'replacement'
    );
    let game = registerCards(createGameState('relay-replacement', P1, 'P1', P2, 'P2'), [
      source,
      replacement,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, source.instanceId),
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        replacement.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = emitGameEvent(game, {
      eventId: 'leave-source',
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      timestamp: 1,
      triggerPlayerId: P1,
      cardInstanceId: source.instanceId,
      fromZone: ZoneType.MEMBER_SLOT,
      toZone: ZoneType.WAITING_ROOM,
      fromSlot: SlotPosition.CENTER,
      ownerId: P1,
      controllerId: P1,
      ...(eventReplacingCardId ? { replacingCardId: eventReplacingCardId } : {}),
    });
    return {
      game: {
        ...game,
        pendingAbilities: [
          pending(
            'relay-pending',
            PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
            source.instanceId,
            TriggerCondition.ON_LEAVE_STAGE,
            ['leave-source']
          ),
        ],
      },
      source,
      replacement,
    };
  }

  it.each([
    ['PL!-PR-025-PR', 'PL!-PR-025'],
    ['PL!-PR-025-UNSEEN', 'PL!-PR-025'],
    ['PL!HS-PR-040-SEC', 'PL!HS-PR-040'],
    ['PL!S-PR-047-P', 'PL!S-PR-047'],
  ])('definition family covers %s (%s)', (cardCode, baseCardCode) => {
    const source = createCardInstance(memberData(cardCode), P1, 'source');
    expect(source.data.cardCode).toBe(cardCode);
    expect(
      getCardAbilityDefinitionsForCardCode(cardCode).find(
        (definition) =>
          definition.abilityId === PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toMatchObject({
      baseCardCodes: ['PL!-PR-025', 'PL!HS-PR-040', 'PL!S-PR-047'],
      effectText:
        '【自动】此成员从舞台被放置入休息室时，此成员曾与费用大于等于9的成员换手的场合，LIVE结束时为止，该换手登场的成员获得[ブレード][ブレード]。',
    });
    expect(baseCardCode).toBe(cardCode.replace(/-(?:PR|P|SEC|UNSEEN)$/, ''));
  });

  it('does not grant the relay ability to adjacent PR cards', () => {
    for (const cardCode of ['PL!-PR-023-PR', 'PL!-PR-024-PR', 'PL!S-PR-046-PR', 'PL!S-PR-048-PR']) {
      expect(
        getCardAbilityDefinitionsForCardCode(cardCode).some(
          (definition) =>
            definition.abilityId === PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it.each(['PL!-PR-025-PR', 'PL!S-PR-047-PR', 'PL!S-PR-047-UNSEEN'])(
    'uses the exact LeaveStageEvent replacement and writes target-bound BLADE +2 for %s',
    (sourceCode) => {
      const { game, source, replacement } = setupReplacement(9, 'replacement', sourceCode);
      const resolved = resolvePendingCardEffects(game).gameState;
      expect(resolved.pendingAbilities).toEqual([]);
      expect(resolved.liveResolution.liveModifiers).toContainEqual({
        kind: 'BLADE',
        target: 'TARGET_MEMBER',
        playerId: P1,
        countDelta: 2,
        sourceCardId: source.instanceId,
        targetMemberCardId: replacement.instanceId,
        abilityId: PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
      });
    }
  );

  it.each([
    ['no replacingCardId', 9, null],
    ['effective cost below nine', 8, 'replacement'],
  ] as const)('safely no-ops for %s', (_label, cost, replacementId) => {
    const { game } = setupReplacement(cost, replacementId);
    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  function withReplacementCost(game: GameState, delta: number, setTo?: number): GameState {
    return {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST',
            playerId: P1,
            memberCardId: 'replacement',
            countDelta: delta,
            sourceCardId: 'source',
            abilityId: 'test-cost',
          },
          ...(setTo === undefined
            ? []
            : [
                {
                  kind: 'MEMBER_COST_SET' as const,
                  playerId: P1,
                  memberCardId: 'replacement',
                  setTo,
                  sourceCardId: 'source',
                  abilityId: 'test-cost-set',
                },
              ]),
        ],
      },
    };
  }

  function openRelayConfirmation(game: GameState): GameState {
    const withSecond = {
      ...game,
      pendingAbilities: [
        ...game.pendingAbilities,
        { ...game.pendingAbilities[0]!, id: 'second-relay', eventIds: ['missing-event'] },
      ],
    };
    const order = resolvePendingCardEffects(withSecond).gameState;
    return confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'relay-pending'
    );
  }

  it.each([
    [8, 1, undefined, 3],
    [9, -1, undefined, 1],
    [8, 0, 9, 3],
    [9, 5, 8, 1],
  ] as const)(
    'checks effective replacement cost: printed %i, delta %i, set %s',
    (cost, delta, setTo, expectedBlade) => {
      const { game } = setupReplacement(cost, 'replacement', 'PL!S-PR-047-PR');
      const resolved = resolvePendingCardEffects(withReplacementCost(game, delta, setTo)).gameState;
      expect(getMemberEffectiveBladeCount(resolved, P1, 'replacement')).toBe(expectedBlade);
      expect(resolved.pendingAbilities).toEqual([]);
      expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
        replacingCardEffectiveCost: setTo ?? cost + delta,
      });
    }
  );

  it.each([
    [0, 1, 3],
    [1, 0, 1],
  ] as const)(
    'rechecks the effective cost when confirming: delta %i becomes %i',
    (initialDelta, finalDelta, expectedBlade) => {
      const { game } = setupReplacement(8, 'replacement', 'PL!S-PR-047-PR');
      const started = openRelayConfirmation(withReplacementCost(game, initialDelta));
      expect(started.activeEffect?.effectText).toContain(`费用${8 + initialDelta}`);
      expect(started.activeEffect?.stepText).not.toContain('印刷');
      const resolved = confirmActiveEffectStep(
        withReplacementCost(started, finalDelta),
        P1,
        started.activeEffect!.id
      );
      expect(getMemberEffectiveBladeCount(resolved, P1, 'replacement')).toBe(expectedBlade);
    }
  );

  function emitReplacementLeaveAndReenter(game: GameState): GameState {
    const left = emitGameEvent(game, {
      eventId: 'replacement-left',
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      timestamp: 2,
      cardInstanceId: 'replacement',
      fromZone: ZoneType.MEMBER_SLOT,
      toZone: ZoneType.WAITING_ROOM,
      fromSlot: SlotPosition.CENTER,
      ownerId: P1,
      controllerId: P1,
    });
    return emitGameEvent(left, {
      eventId: 'replacement-reentered',
      eventType: TriggerCondition.ON_ENTER_STAGE,
      timestamp: 3,
      cardInstanceId: 'replacement',
      fromZone: ZoneType.WAITING_ROOM,
      toZone: ZoneType.MEMBER_SLOT,
      toSlot: SlotPosition.CENTER,
      ownerId: P1,
      controllerId: P1,
    });
  }

  it('does not reward a replacement that left and reentered before the pending resolves', () => {
    const { game } = setupReplacement(9, 'replacement', 'PL!S-PR-047-PR');
    const resolved = resolvePendingCardEffects(emitReplacementLeaveAndReenter(game)).gameState;
    expect(getMemberEffectiveBladeCount(resolved, P1, 'replacement')).toBe(1);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      replacementLeftAfterRelay: true,
      bladeBonus: 0,
    });
  });

  it('rechecks the replacement lifecycle after opening manual confirmation', () => {
    const { game } = setupReplacement(9, 'replacement', 'PL!S-PR-047-PR');
    const started = openRelayConfirmation(game);
    expect(started.activeEffect?.effectText).toContain('条件满足');
    const resolved = confirmActiveEffectStep(
      emitReplacementLeaveAndReenter(started),
      P1,
      started.activeEffect!.id
    );
    expect(getMemberEffectiveBladeCount(resolved, P1, 'replacement')).toBe(1);
  });

  it('accepts the original entry and later slot movement without treating them as reentry', () => {
    const { game } = setupReplacement(9, 'replacement', 'PL!S-PR-047-PR');
    let entered = emitGameEvent(game, {
      eventId: 'replacement-first-entry',
      eventType: TriggerCondition.ON_ENTER_STAGE,
      timestamp: 2,
      cardInstanceId: 'replacement',
      fromZone: ZoneType.HAND,
      toZone: ZoneType.MEMBER_SLOT,
      toSlot: SlotPosition.CENTER,
      ownerId: P1,
      controllerId: P1,
      replacedMemberCardId: 'source',
    });
    entered = updatePlayer(entered, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, CENTER: null, LEFT: 'replacement' },
      },
    }));
    const resolved = resolvePendingCardEffects(entered).gameState;
    expect(getMemberEffectiveBladeCount(resolved, P1, 'replacement')).toBe(3);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('shows real-time manual confirmation text and rechecks a stale replacement', () => {
    const first = setupReplacement();
    const secondSource = createCardInstance(
      memberData('PL!HS-PR-040-PR', '安养寺姬芽'),
      P1,
      'source-two'
    );
    let game = registerCards(first.game, [secondSource]);
    game = {
      ...game,
      pendingAbilities: [
        ...game.pendingAbilities,
        pending(
          'relay-pending-two',
          PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
          secondSource.instanceId,
          TriggerCondition.ON_LEAVE_STAGE,
          ['missing-event']
        ),
      ],
    };
    const selection = resolvePendingCardEffects(game).gameState;
    const bridge = confirmActiveEffectStep(
      selection,
      P1,
      selection.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'relay-pending'
    );
    expect(bridge.activeEffect?.effectText).toContain('费用9');
    expect(bridge.activeEffect?.effectText).toContain('条件满足，实际获得[ブレード][ブレード]');
    const stale = updatePlayer(bridge, P1, (player) => ({
      ...player,
      memberSlots: { ...player.memberSlots, slots: { ...player.memberSlots.slots, CENTER: null } },
    }));
    const resolved = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });
});

describe('PR on-enter look top ten minus hand, take up to two family', () => {
  function setup(handCount: number, deckCount: number) {
    const source = createCardInstance(memberData('PL!HS-PR-039-PR', '百生吟子', 15), P1, 'source');
    const hand = Array.from({ length: handCount }, (_, index) =>
      createCardInstance(memberData(`HAND-${index}`), P1, `hand-${index}`)
    );
    const deck = Array.from({ length: deckCount }, (_, index) =>
      createCardInstance(memberData(`DECK-${index}`), P1, `deck-${index}`)
    );
    let game = registerCards(createGameState('look-ten-minus-hand', P1, 'P1', P2, 'P2'), [
      source,
      ...hand,
      ...deck,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
      mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    }));
    game = {
      ...game,
      pendingAbilities: [
        pending(
          'look-pending',
          PR_ON_ENTER_LOOK_TOP_TEN_MINUS_HAND_TAKE_TWO_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    };
    return { game, deckIds: deck.map((card) => card.instanceId) };
  }

  it('locks the count at resolution start, keeps inspection private, and moves the rest in one group', () => {
    const { game, deckIds } = setup(7, 4);
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect).toMatchObject({
      effectText:
        '【登场】检视自己卡组顶的，等同于10减去自己的手牌的张数的数量的卡片。从中将至多2张卡片加入手牌。其余的放置入休息室。',
      selectableCardIds: deckIds.slice(0, 3),
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 2,
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      skipSelectionLabel: '全部放置入休息室',
    });
    const resolved = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [deckIds[1]!, deckIds[2]!]
    );
    expect(resolved.players[0].hand.cardIds).toEqual(
      expect.arrayContaining([deckIds[1], deckIds[2]])
    );
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([deckIds[0]]);
    expect(
      resolved.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      )
    ).toHaveLength(1);
  });

  it('safely ends without an empty window when hand count is already ten', () => {
    const { game, deckIds } = setup(10, 2);
    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual(deckIds);
  });

  it('clamps the selectable maximum to the cards actually inspected', () => {
    const { game, deckIds } = setup(7, 1);
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.inspectionCardIds).toEqual(deckIds);
    expect(started.activeEffect?.selectableCardMode).toBeUndefined();
    expect(started.activeEffect?.canSkipSelection).toBe(true);
  });
});

describe('PR LIVE-start waiting LIVE to deck top family', () => {
  function setup(waitingLiveCount = 3, fillerCount = 0) {
    const source = createCardInstance(memberData('PL!S-PR-048-PR', '黑泽露比', 13), P1, 'source');
    const lives = Array.from({ length: waitingLiveCount }, (_, index) =>
      createCardInstance(liveData(`WAITING-LIVE-${index}`), P1, `waiting-live-${index}`)
    );
    const fillers = Array.from({ length: fillerCount }, (_, index) =>
      createCardInstance(memberData(`FILLER-${index}`), P1, `filler-${index}`)
    );
    const deckTop = createCardInstance(memberData('DECK-TOP'), P1, 'deck-top');
    let game = registerCards(createGameState('waiting-live-top', P1, 'P1', P2, 'P2'), [
      source,
      ...lives,
      ...fillers,
      deckTop,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...lives, ...fillers].map((card) => card.instanceId),
      },
      mainDeck: { ...player.mainDeck, cardIds: [deckTop.instanceId] },
    }));
    game = {
      ...game,
      pendingAbilities: [
        pending(
          'waiting-live-pending',
          PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    };
    return {
      game,
      liveIds: lives.map((card) => card.instanceId),
      deckTopId: deckTop.instanceId,
    };
  }

  it('opens ordered public selection with the required player copy and resolves after display', () => {
    const { game, liveIds, deckTopId } = setup();
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: liveIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 3,
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
      skipSelectionLabel: '不放置',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_TOP',
          ordered: true,
        },
      },
    });
    const session = attachSession(started);
    const effectId = session.state!.activeEffect!.id;
    const selectedIds = [liveIds[2]!, liveIds[0]!];
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          effectId,
          undefined,
          undefined,
          undefined,
          undefined,
          selectedIds
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: selectedIds,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(liveIds);

    const display = session.state!.activeEffect!;
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: { ...display, publicCardSelectionAutoAdvanceAt: 0 },
    };
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, 0)).success
    ).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([...selectedIds, deckTopId]);
    expect(
      session.state?.eventLog
        .map((entry) => entry.event)
        .find(
          (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
        )
    ).toMatchObject({
      playerId: P1,
      movedCardIds: selectedIds,
      destination: { kind: 'TOP' },
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: 'source',
        abilityId: PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID,
      },
    });
  });

  it('shows a dynamic confirm-only result when the condition fails, while ordered resolution no-ops', () => {
    const { game } = setup(1, 9);
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.effectText).toContain('当前休息室10张');
    expect(started.activeEffect?.effectText).toContain('条件未满足，实际不放置卡片');
    expect(confirmActiveEffectStep(started, P1, started.activeEffect!.id).activeEffect).toBeNull();

    const orderedGame = {
      ...game,
      pendingAbilities: [
        game.pendingAbilities[0]!,
        { ...game.pendingAbilities[0]!, id: 'waiting-live-pending-two' },
      ],
    };
    const orderWindow = resolvePendingCardEffects(orderedGame).gameState;
    const resolved = confirmActiveEffectStep(
      orderWindow,
      P1,
      orderWindow.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('supports skip without public display and stale restored selection safely no-ops', () => {
    const skippedSetup = setup(2);
    const skipped = resolvePendingCardEffects(skippedSetup.game).gameState;
    const skippedDone = confirmActiveEffectStep(
      skipped,
      P1,
      skipped.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      []
    );
    expect(skippedDone.activeEffect).toBeNull();
    expect(skippedDone.players[0].waitingRoom.cardIds).toEqual(skippedSetup.liveIds);

    const staleSetup = setup(2);
    const started = resolvePendingCardEffects(staleSetup.game).gameState;
    const session = attachSession(started);
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effectId, staleSetup.liveIds[0]))
        .success
    ).toBe(true);
    const display = session.state!.activeEffect!;
    const staleState = updatePlayer(session.state!, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== staleSetup.liveIds[0]),
      },
      hand: addCardToZone(player.hand, staleSetup.liveIds[0]!),
    }));
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...staleState,
      activeEffect: { ...display, publicCardSelectionAutoAdvanceAt: 0 },
    };
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, 0)).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([staleSetup.deckTopId]);
  });
});

describe('PL!S-PR-046 费用5 渡边曜 opponent revealed LIVE draw', () => {
  const ABILITY_ID = S_PR_046_LIVE_SUCCESS_OPPONENT_CHEER_LIVE_DRAW_ONE_ABILITY_ID;
  const TEXT = '【LIVE成功时】因声援被公开的对方的卡片中存在LIVE卡的场合，抽1张卡。';
  function setup(
    options: {
      sourceCode?: string;
      liveOwner?: string;
      currentCheer?: boolean;
      hasLive?: boolean;
      moved?: boolean;
      sourceOnStage?: boolean;
    } = {}
  ) {
    const owner = options.liveOwner ?? P2;
    const source = createCardInstance(
      memberData(options.sourceCode ?? 'PL!S-PR-046-PR', '渡边曜', 5),
      P1,
      'you'
    );
    const cheer = createCardInstance(
      options.hasLive === false ? memberData('CHEER') : liveData('CHEER'),
      owner,
      'cheer'
    );
    const draw = createCardInstance(memberData('DRAW'), P1, 'draw');
    let game = registerCards(createGameState('you-pr046', P1, 'P1', P2, 'P2'), [
      source,
      cheer,
      draw,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [draw.instanceId] },
      memberSlots:
        options.sourceOnStage === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
    }));
    game = updatePlayer(game, owner, (player) => ({
      ...player,
      hand: options.moved ? addCardToZone(player.hand, cheer.instanceId) : player.hand,
    }));
    game = {
      ...game,
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: options.moved ? [] : ['cheer'],
        revealedCardIds: options.moved ? [] : ['cheer'],
      },
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: P1,
        firstPlayerCheerCardIds: owner === P1 && options.currentCheer !== false ? ['cheer'] : [],
        secondPlayerCheerCardIds: owner === P2 && options.currentCheer !== false ? ['cheer'] : [],
      },
      pendingAbilities: [
        pending('you-pending', ABILITY_ID, 'you', TriggerCondition.ON_LIVE_SUCCESS),
      ],
    };
    return emitGameEvent(game, {
      eventId: 'cheer-history',
      eventType: TriggerCondition.ON_CHEER,
      timestamp: 1,
      playerId: owner,
      revealedCardIds: ['cheer'],
      totalBlade: 1,
    });
  }
  it.each(['PR', 'SEC', 'UNSEEN'])(
    'binds all rarities and draws only after the confirmation: %s',
    (rare) => {
      const code = `PL!S-PR-046-${rare}`;
      expect(
        getCardAbilityDefinitionsForCardCode(code).find((item) => item.abilityId === ABILITY_ID)
      ).toMatchObject({
        baseCardCodes: ['PL!S-PR-046'],
        effectText: TEXT,
        queued: true,
        implemented: true,
      });
      const started = resolvePendingCardEffects(setup({ sourceCode: code })).gameState;
      expect(started.players[0].hand.cardIds).toEqual([]);
      expect(started.activeEffect?.effectText).toBe(
        `${TEXT}（本次对方因声援公开的卡中存在LIVE卡，满足条件，实际抽1张卡。）`
      );
      const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
      expect(done.players[0].hand.cardIds).toEqual(['draw']);
      expect(done.pendingAbilities).toEqual([]);
      expect(done.activeEffect).toBeNull();
    }
  );
  it('counts the opponent LIVE historical reveal even after it leaves the resolution zone', () => {
    const started = resolvePendingCardEffects(setup({ moved: true })).gameState;
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(done.players[0].hand.cardIds).toEqual(['draw']);
    expect(done.players[1].hand.cardIds).toEqual(['cheer']);
  });
  it.each([{ hasLive: false }, { liveOwner: P1 }, { currentCheer: false }])(
    'does not draw for an ineligible state %j',
    (options) => {
      const game = setup(options);
      const started = resolvePendingCardEffects(game).gameState;
      const done = started.activeEffect
        ? confirmActiveEffectStep(started, P1, started.activeEffect.id)
        : started;
      expect(done.players[0].mainDeck.cardIds).toEqual(['draw']);
      expect(done.pendingAbilities).toEqual([]);
    }
  );
  function leaveStage(game: GameState) {
    return updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, 'you'),
    }));
  }
  function triggerSuccess(game: GameState) {
    const successLive = createCardInstance(liveData('SUCCESS-LIVE'), P1, 'success-live');
    const event = createLiveSuccessEvent(P1, ['success-live'], 1);
    const logged = emitGameEvent(
      registerCards({ ...game, pendingAbilities: [] }, [successLive]),
      event
    );
    return enqueueTriggeredCardEffects(logged, [TriggerCondition.ON_LIVE_SUCCESS], {
      liveSuccessEvents: [event],
    });
  }
  it.each(['before-start', 'after-confirmation-opens'] as const)(
    'resolves a real triggered draw after source leaves: %s',
    (timing) => {
      const queued = triggerSuccess(setup());
      expect(queued.pendingAbilities.map((a) => a.abilityId)).toEqual([ABILITY_ID]);
      const started =
        timing === 'before-start'
          ? resolvePendingCardEffects(leaveStage(queued)).gameState
          : leaveStage(resolvePendingCardEffects(queued).gameState);
      expect(started.activeEffect?.effectText).toContain('实际抽1张卡');
      const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
      expect(done.players[0].hand.cardIds).toEqual(['draw']);
      expect(started.players[0].waitingRoom.cardIds).toContain('you');
      expect(Object.values(done.players[0].memberSlots.slots)).not.toContain('you');
      expect(done.pendingAbilities).toEqual([]);
      expect(done.activeEffect).toBeNull();
    }
  );
  it('does not enqueue if the source left before LIVE_SUCCESS', () => {
    const queued = triggerSuccess(leaveStage(setup()));
    expect(queued.pendingAbilities).toEqual([]);
    expect(resolvePendingCardEffects(queued).gameState.players[0].hand.cardIds).toEqual([]);
  });
  it('still checks the opponent reveal condition after the source leaves', () => {
    const queued = triggerSuccess(setup({ hasLive: false }));
    const started = resolvePendingCardEffects(leaveStage(queued)).gameState;
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(done.players[0].mainDeck.cardIds).toEqual(['draw']);
    expect(done.pendingAbilities).toEqual([]);
  });
  it('handles ordered resolution without extra windows', () => {
    const game = setup();
    const ordered = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        ...game.pendingAbilities,
        { ...game.pendingAbilities[0]!, id: 'you-second' },
      ],
    }).gameState;
    const done = confirmActiveEffectStep(
      ordered,
      P1,
      ordered.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(done.players[0].hand.cardIds).toEqual(['draw']);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });
  it('collects the actual LIVE_SUCCESS definition and rejects cross-bound PR abilities', () => {
    const ownLive = createCardInstance(liveData('SUCCESS-LIVE'), P1, 'success-live');
    let game = registerCards(setup(), [ownLive]);
    game = {
      ...game,
      liveResolution: { ...game.liveResolution, liveResults: new Map([['success-live', true]]) },
    };
    const checked = new GameService().executeCheckTiming({ ...game, pendingAbilities: [] }, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(checked.success).toBe(true);
    expect(
      checked.gameState.activeEffect?.abilityId ?? checked.gameState.pendingAbilities[0]?.abilityId
    ).toBe(ABILITY_ID);
    for (const rare of ['PR', 'UNSEEN']) {
      const ids = (base: string) =>
        getCardAbilityDefinitionsForCardCode(`${base}-${rare}`).map((item) => item.abilityId);
      expect(ids('PL!S-PR-046')).not.toContain(
        PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID
      );
      expect(ids('PL!S-PR-047')).not.toContain(
        PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID
      );
      expect(ids('PL!S-PR-048')).not.toContain(
        PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID
      );
      expect(ids('PL!S-PR-048')).toContain(
        PR_LIVE_START_WAITING_ROOM_AT_MOST_NINE_STACK_LIVE_ABILITY_ID
      );
      expect(ids('PL!S-PR-047')).toContain(
        PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID
      );
      expect(ids('PL!S-PR-047')).not.toContain(ABILITY_ID);
      expect(ids('PL!S-PR-048')).not.toContain(ABILITY_ID);
    }
  });
});
