import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
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
  it.each(['PL!-PR-023-PR', 'PL!N-PR-034-SEC'])(
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
  function setupReplacement(cost = 9, eventReplacingCardId: string | null = 'replacement') {
    const source = createCardInstance(memberData('PL!-PR-024-PR', '南琴梨'), P1, 'source');
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
    ['PL!-PR-024-PR', 'PL!-PR-024'],
    ['PL!-PR-024-UNSEEN', 'PL!-PR-024'],
    ['PL!HS-PR-040-SEC', 'PL!HS-PR-040'],
    ['PL!S-PR-046-P', 'PL!S-PR-046'],
  ])('definition family covers %s (%s)', (cardCode, baseCardCode) => {
    const source = createCardInstance(memberData(cardCode), P1, 'source');
    expect(source.data.cardCode).toBe(cardCode);
    expect(
      getCardAbilityDefinitionsForCardCode(cardCode).find(
        (definition) =>
          definition.abilityId === PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toMatchObject({
      baseCardCodes: ['PL!-PR-024', 'PL!HS-PR-040', 'PL!S-PR-046'],
      effectText:
        '【自动】此成员从舞台被放置入休息室时，此成员曾与费用大于等于9的成员换手的场合，LIVE结束时为止，该换手登场的成员获得[ブレード][ブレード]。',
    });
    expect(baseCardCode).toBe(cardCode.replace(/-(?:PR|P|SEC|UNSEEN)$/, ''));
  });

  it('does not grant the relay ability to corrected Eri or the unimplemented adjacent card', () => {
    for (const cardCode of ['PL!-PR-022-PR', 'PL!-PR-023-PR']) {
      expect(
        getCardAbilityDefinitionsForCardCode(cardCode).some(
          (definition) =>
            definition.abilityId === PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('uses the exact LeaveStageEvent replacement and writes target-bound BLADE +2', () => {
    const { game, source, replacement } = setupReplacement();
    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: P1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      targetMemberCardId: replacement.instanceId,
      abilityId: PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
    });
  });

  it.each([
    ['no replacingCardId', 9, null],
    ['printed cost below nine', 8, 'replacement'],
  ] as const)('safely no-ops for %s', (_label, cost, replacementId) => {
    const { game } = setupReplacement(cost, replacementId);
    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
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
    const source = createCardInstance(memberData('PL!S-PR-047-PR', '黑泽露比', 13), P1, 'source');
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
