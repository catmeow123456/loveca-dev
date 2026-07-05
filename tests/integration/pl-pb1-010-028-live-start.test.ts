import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID,
  PL_PB1_028_LIVE_START_ACTIVATE_PRINTEMPS_MEMBERS_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, name: string, unitName: string): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    unitName,
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string, name: string, score: number, unitName: string): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    unitName,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  };
}

function card<TData extends MemberCardData | LiveCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function pending(
  abilityId: string,
  sourceCardId: string,
  id = `pending:${abilityId}:${sourceCardId}`
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event:${id}`],
  };
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('pl-pb1-010-028-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmActiveEffect(
  session: GameSession,
  selectedCardId?: string | null
): GameState {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function choosePendingAbilityBySource(session: GameSession, sourceCardId: string): GameState {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, sourceCardId)
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function setup010(options: {
  readonly handCount?: number;
  readonly otherMembers?: readonly CardInstance<MemberCardData>[];
  readonly sourceCardCode?: 'PL!-pb1-010-R' | 'PL!-pb1-010-P＋';
  readonly extraPending?: readonly PendingAbilityState[];
}): {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly handCards: readonly CardInstance<MemberCardData>[];
  readonly otherMembers: readonly CardInstance<MemberCardData>[];
} {
  const source = card(
    member(options.sourceCardCode ?? 'PL!-pb1-010-R', '高坂穂乃果', 'Printemps'),
    'honoka-source'
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    card(member(`PL!-test-discard-${index}`, `discard-${index}`, 'Printemps'), `discard-${index}`)
  );
  const otherMembers =
    options.otherMembers ??
    [
      card(member('PL!-test-other-kotori', '南ことり', 'Printemps'), 'other-kotori'),
      card(member('PL!-test-other-hanayo', '小泉花陽', 'Printemps'), 'other-hanayo'),
    ];

  let game = createGameState('pl-pb1-010-honoka', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...handCards, ...otherMembers]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: [source, ...otherMembers].reduce((slots, entry, index) => {
      const slot = [SlotPosition.CENTER, SlotPosition.LEFT, SlotPosition.RIGHT][index]!;
      return placeCardInSlot(slots, slot, entry.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }, player.memberSlots),
    hand: handCards.reduce((zone, entry) => addCardToZone(zone, entry.instanceId), player.hand),
  }));
  return {
    game: {
      ...game,
      pendingAbilities: [
        pending(
          PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID,
          source.instanceId,
          'pending-010'
        ),
        ...(options.extraPending ?? []),
      ],
    },
    source,
    handCards,
    otherMembers,
  };
}

function setup028(options: {
  readonly entries?: readonly {
    readonly card: CardInstance<MemberCardData>;
    readonly slot: SlotPosition;
    readonly orientation: OrientationState;
  }[];
  readonly includeSourceInLiveZone?: boolean;
  readonly extraPending?: readonly PendingAbilityState[];
} = {}): {
  readonly game: GameState;
  readonly source: CardInstance<LiveCardData>;
  readonly entries: readonly {
    readonly card: CardInstance<MemberCardData>;
    readonly slot: SlotPosition;
    readonly orientation: OrientationState;
  }[];
} {
  const source = card(live('PL!-pb1-028-L', 'WAO-WAO Powerful day!', 5, 'Printemps'), 'wao-wao');
  const entries =
    options.entries ??
    [
      {
        card: card(member('PL!-printemps-1', '高坂穂乃果', 'Printemps'), 'printemps-1'),
        slot: SlotPosition.LEFT,
        orientation: OrientationState.WAITING,
      },
      {
        card: card(member('PL!-printemps-2', '南ことり', 'Printemps'), 'printemps-2'),
        slot: SlotPosition.CENTER,
        orientation: OrientationState.WAITING,
      },
      {
        card: card(member('PL!-printemps-3', '小泉花陽', 'Printemps'), 'printemps-3'),
        slot: SlotPosition.RIGHT,
        orientation: OrientationState.WAITING,
      },
    ];

  let game = createGameState('pl-pb1-028-wao-wao', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...entries.map((entry) => entry.card)]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone:
      options.includeSourceInLiveZone === false
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    memberSlots: entries.reduce(
      (slots, entry) =>
        placeCardInSlot(slots, entry.slot, entry.card.instanceId, {
          orientation: entry.orientation,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: PLAYER1,
        playerScores: new Map([[PLAYER1, source.data.score]]),
      },
      pendingAbilities: [
        pending(
          PL_PB1_028_LIVE_START_ACTIVATE_PRINTEMPS_MEMBERS_SCORE_ABILITY_ID,
          source.instanceId,
          'pending-028'
        ),
        ...(options.extraPending ?? []),
      ],
    },
    source,
    entries,
  };
}

describe('PL!-pb1-010 / PL!-pb1-028 LIVE start workflows', () => {
  it('PL!-pb1-010 discards one hand card, enqueues enter-waiting event, and gives only other stage members [BLADE]+1', () => {
    const { game, source, handCards, otherMembers } = setup010({
      sourceCardCode: 'PL!-pb1-010-P＋',
    });
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID,
      stepText:
        '请选择1张手牌放置入休息室。支付后，当前其他舞台成员 2名各获得[BLADE]+1。也可以选择不发动。',
      selectionLabel: '选择要放置入休息室的手牌',
      skipSelectionLabel: '不发动',
    });

    const session = sessionWithState(started);
    const resolved = confirmActiveEffect(session, handCards[0]!.instanceId);

    expect(resolved.players[0].hand.cardIds).not.toContain(handCards[0]!.instanceId);
    expect(resolved.players[0].waitingRoom.cardIds).toContain(handCards[0]!.instanceId);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceIds?.includes(handCards[0]!.instanceId) === true
      )
    ).toBe(true);
    const bladeSourceIds = resolved.liveResolution.liveModifiers
      .filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            PL_PB1_010_LIVE_START_DISCARD_HAND_OTHER_MEMBERS_GAIN_BLADE_ABILITY_ID
      )
      .map((modifier) => modifier.sourceCardId)
      .sort();
    expect(bladeSourceIds).toEqual(otherMembers.map((entry) => entry.instanceId).sort());
    expect(bladeSourceIds).not.toContain(source.instanceId);
  });

  it('PL!-pb1-010 decline, no hand, and no other member branches consume pending and continue', () => {
    const declineSetup = setup010({});
    const declineStarted = resolvePendingCardEffects(declineSetup.game).gameState;
    const declined = confirmActiveEffect(sessionWithState(declineStarted), null);
    expect(declined.players[0].waitingRoom.cardIds).toHaveLength(0);
    expect(declined.liveResolution.liveModifiers).toEqual([]);

    const nextPending = pending(
      PL_PB1_028_LIVE_START_ACTIVATE_PRINTEMPS_MEMBERS_SCORE_ABILITY_ID,
      'missing-live',
      'pending-next'
    );
    const noHand = resolvePendingCardEffects(
      setup010({ handCount: 0, extraPending: [nextPending] }).game
    ).gameState;
    expect(noHand.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    const afterSelectingNext = choosePendingAbilityBySource(sessionWithState(noHand), 'missing-live');
    expect(afterSelectingNext.activeEffect?.abilityId).toBe(
      PL_PB1_028_LIVE_START_ACTIVATE_PRINTEMPS_MEMBERS_SCORE_ABILITY_ID
    );

    const noOther = resolvePendingCardEffects(setup010({ otherMembers: [] }).game).gameState;
    expect(noOther.pendingAbilities).toEqual([]);
    expect(noOther.activeEffect).toBeNull();
  });

  it('PL!-pb1-028 confirm-only text reflects live Printemps waiting count and score result', () => {
    const { game } = setup028();
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('Printemps成员 3名');
    expect(started.activeEffect?.effectText).toContain('待机 3名');
    expect(started.activeEffect?.effectText).toContain('确认后实际变活跃 3名');
    expect(started.activeEffect?.effectText).toContain('满足条件，分数+1');
    expect(started.activeEffect?.stepText).toBe(started.activeEffect?.effectText);
  });

  it('PL!-pb1-028 activates three waiting Printemps members, enqueues state-change events, and scores +1', () => {
    const { game, entries } = setup028();
    const started = resolvePendingCardEffects(game).gameState;
    const resolved = confirmActiveEffect(sessionWithState(started));

    for (const entry of entries) {
      expect(resolved.players[0].memberSlots.cardStates.get(entry.card.instanceId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(
      resolved.liveResolution.liveModifiers.find(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId ===
            PL_PB1_028_LIVE_START_ACTIVATE_PRINTEMPS_MEMBERS_SCORE_ABILITY_ID
      )
    ).toMatchObject({
      kind: 'SCORE',
      countDelta: 1,
    });
    const changedCardIds = resolved.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
      .map((event) => event.cardInstanceId)
      .sort();
    expect(changedCardIds).toEqual(entries.map((entry) => entry.card.instanceId).sort());
  });

  it('PL!-pb1-028 does not count already ACTIVE members and safely handles no Printemps or source leaving', () => {
    const mixedEntries = [
      {
        card: card(member('PL!-printemps-wait-1', '高坂穂乃果', 'Printemps'), 'wait-1'),
        slot: SlotPosition.LEFT,
        orientation: OrientationState.WAITING,
      },
      {
        card: card(member('PL!-printemps-wait-2', '南ことり', 'Printemps'), 'wait-2'),
        slot: SlotPosition.CENTER,
        orientation: OrientationState.WAITING,
      },
      {
        card: card(member('PL!-printemps-active', '小泉花陽', 'Printemps'), 'active-1'),
        slot: SlotPosition.RIGHT,
        orientation: OrientationState.ACTIVE,
      },
    ];
    const mixedStarted = resolvePendingCardEffects(setup028({ entries: mixedEntries }).game).gameState;
    const mixedResolved = confirmActiveEffect(sessionWithState(mixedStarted));
    expect(mixedResolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(
      mixedResolved.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(2);

    const nonPrintempsEntries = [
      {
        card: card(member('PL!-bibi-member', '矢澤にこ', 'BiBi'), 'bibi-member'),
        slot: SlotPosition.CENTER,
        orientation: OrientationState.WAITING,
      },
    ];
    const noPrintempsStarted = resolvePendingCardEffects(
      setup028({ entries: nonPrintempsEntries }).game
    ).gameState;
    expect(noPrintempsStarted.activeEffect?.effectText).toContain('Printemps成员 0名');
    const noPrintempsResolved = confirmActiveEffect(sessionWithState(noPrintempsStarted));
    expect(noPrintempsResolved.pendingAbilities).toEqual([]);
    expect(noPrintempsResolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);

    const sourceLeftStarted = resolvePendingCardEffects(
      setup028({ includeSourceInLiveZone: false }).game
    ).gameState;
    expect(sourceLeftStarted.activeEffect?.effectText).toContain('来源LIVE不在LIVE区');
    const sourceLeftResolved = confirmActiveEffect(sessionWithState(sourceLeftStarted));
    expect(sourceLeftResolved.pendingAbilities).toEqual([]);
    expect(sourceLeftResolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });
});
