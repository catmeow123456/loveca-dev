import { describe, expect, it } from 'vitest';
import type { CardInstance, EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  updateResolutionZone,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  PL_S_PB1_003_LIVE_START_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN_ABILITY_ID,
  PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
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

function kanan(cardCode = 'PL!S-pb1-003-R'): MemberCardData {
  return {
    cardCode,
    name: '松浦果南',
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 15,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1), createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function live(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function card<T extends MemberCardData | LiveCardData | EnergyCardData>(
  data: T,
  instanceId: string,
  ownerId = PLAYER1
): CardInstance<T> {
  return createCardInstance(data, ownerId, instanceId);
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  id = `pending:${abilityId}`
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`event:${id}`],
  };
}

function sessionWithState(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('s-pb1-003-kanan', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function confirmOption(session: GameSession, selectedOptionId: string): GameState {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effect.id,
      undefined,
      undefined,
      undefined,
      selectedOptionId
    )
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function confirmCard(session: GameSession, selectedCardId: string): GameState {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect.id, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function latestPayload(game: GameState, abilityId: string, step: string) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === abilityId &&
        action.payload.step === step
    )?.payload;
}

function setupLiveStart(options: {
  readonly cardCode?: string;
  readonly activeEnergyCount: number;
  readonly extraPending?: readonly PendingAbilityState[];
}): {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly energyCards: readonly CardInstance<EnergyCardData>[];
} {
  const source = card(kanan(options.cardCode), 'kanan');
  const energyCards = [card(energy('ENE-1'), 'energy-1'), card(energy('ENE-2'), 'energy-2')];
  let game = createGameState('s-pb1-003-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: energyCards
      .slice(0, options.activeEnergyCount)
      .reduce(
        (zone, entry) =>
          addCardToStatefulZone(zone, entry.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
  }));
  return {
    game: {
      ...game,
      pendingAbilities: [
        pending(
          PL_S_PB1_003_LIVE_START_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_LIVE_START,
          'pending-live-start'
        ),
        ...(options.extraPending ?? []),
      ],
    },
    source,
    energyCards,
  };
}

function setupLiveSuccess(options: {
  readonly cheerCards?: readonly CardInstance[];
  readonly revealedCardIds?: readonly string[];
  readonly resolutionCardIds?: readonly string[];
  readonly firstPlayerCheerCardIds?: readonly string[];
  readonly includePending?: boolean;
} = {}): {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly cheerCards: readonly CardInstance[];
} {
  const source = card(kanan('PL!S-pb1-003-P＋'), 'kanan');
  const cheerCards = options.cheerCards ?? [card(live('PL!S-test-live-L'), 'live-cheer')];
  let game = createGameState('s-pb1-003-live-success', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: [...(options.resolutionCardIds ?? cheerCards.map((entry) => entry.instanceId))],
    revealedCardIds: [
      ...(options.revealedCardIds ?? cheerCards.map((entry) => entry.instanceId)),
    ],
  }));
  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
        firstPlayerCheerCardIds: [
          ...(options.firstPlayerCheerCardIds ?? cheerCards.map((entry) => entry.instanceId)),
        ],
        secondPlayerCheerCardIds: [],
      },
      pendingAbilities:
        options.includePending === false
          ? []
          : [
              pending(
                PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
                source.instanceId,
                TriggerCondition.ON_LIVE_SUCCESS,
                'pending-live-success'
              ),
            ],
    },
    source,
    cheerCards,
  };
}

describe('PL!S-pb1-003 松浦果南', () => {
  it('LIVE_START pays two energy and replaces all printed original Hearts with green', () => {
    const { game, source, energyCards } = setupLiveStart({ activeEnergyCount: 2 });
    const started = resolvePendingCardEffects(game).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_S_PB1_003_LIVE_START_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN_ABILITY_ID,
      selectableOptions: [
        { id: 'pay', label: '支付[E][E]' },
        { id: 'decline', label: '不发动' },
      ],
    });

    const resolved = confirmOption(sessionWithState(started), 'pay');
    expect(resolved.activeEffect).toBeNull();
    for (const energyCard of energyCards) {
      expect(resolved.players[0].energyZone.cardStates.get(energyCard.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: PLAYER1,
      memberCardId: source.instanceId,
      color: HeartColor.GREEN,
      sourceCardId: source.instanceId,
      abilityId: PL_S_PB1_003_LIVE_START_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN_ABILITY_ID,
    });
    expect(getMemberEffectiveHeartIcons(resolved, PLAYER1, source.instanceId)).toEqual([
      createHeartIcon(HeartColor.GREEN, 2),
    ]);
  });

  it('LIVE_START decline and insufficient energy are no-op and continue pending resolution', () => {
    const declinedSetup = setupLiveStart({ activeEnergyCount: 2 });
    const declinedStart = resolvePendingCardEffects(declinedSetup.game).gameState;
    const declined = confirmOption(sessionWithState(declinedStart), 'decline');

    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(declined.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({ kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT' })
    );
    expect(
      declined.players[0].energyZone.cardStates.get(declinedSetup.energyCards[0]!.instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);

    const noTargetLiveSuccessPending = pending(
      PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
      declinedSetup.source.instanceId,
      TriggerCondition.ON_LIVE_SUCCESS,
      'pending-live-success-no-target'
    );
    const insufficient = resolvePendingCardEffects(
      setupLiveStart({ activeEnergyCount: 1, extraPending: [noTargetLiveSuccessPending] }).game
    ).gameState;
    expect(insufficient.activeEffect).toMatchObject({
      selectableOptions: [{ id: 'decline', label: '不发动' }],
    });

    const afterDecline = confirmOption(sessionWithState(insufficient), 'decline');
    expect(afterDecline.activeEffect).toBeNull();
    expect(afterDecline.pendingAbilities).toEqual([]);
    expect(
      latestPayload(
        afterDecline,
        PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
        'NO_LIVE_REVEALED_CHEER_TARGET'
      )
    ).toBeTruthy();
  });

  it('LIVE_SUCCESS chooses one own current revealed cheer LIVE card and moves it to hand', () => {
    const { game, cheerCards } = setupLiveSuccess();
    const targetCardId = cheerCards[0]!.instanceId;
    const started = resolvePendingCardEffects(game).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
      selectableCardIds: [targetCardId],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
    });

    const resolved = confirmCard(sessionWithState(started), targetCardId);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual([targetCardId]);
    expect(resolved.resolutionZone.cardIds).not.toContain(targetCardId);
    expect(resolved.resolutionZone.revealedCardIds).not.toContain(targetCardId);
  });

  it('LIVE_SUCCESS ignores non-LIVE, opponent, unrevealed, and stale cheer cards', () => {
    const legal = card(live('PL!S-legal-live-L'), 'legal-live');
    const nonLive = card(member('PL!S-non-live-R'), 'non-live');
    const opponentLive = card(live('PL!S-opponent-live-L'), 'opponent-live', PLAYER2);
    const unrevealed = card(live('PL!S-unrevealed-live-L'), 'unrevealed-live');
    const stale = card(live('PL!S-stale-live-L'), 'stale-live');
    const { game } = setupLiveSuccess({
      cheerCards: [legal, nonLive, opponentLive, unrevealed, stale],
      resolutionCardIds: [
        legal.instanceId,
        nonLive.instanceId,
        opponentLive.instanceId,
        unrevealed.instanceId,
      ],
      revealedCardIds: [
        legal.instanceId,
        nonLive.instanceId,
        opponentLive.instanceId,
        stale.instanceId,
      ],
      firstPlayerCheerCardIds: [
        legal.instanceId,
        nonLive.instanceId,
        opponentLive.instanceId,
        unrevealed.instanceId,
        stale.instanceId,
      ],
    });
    const started = resolvePendingCardEffects(game).gameState;

    expect(started.activeEffect?.selectableCardIds).toEqual([legal.instanceId]);
    for (const invalid of [nonLive, opponentLive, unrevealed, stale]) {
      const session = sessionWithState(started);
      const result = session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, invalid.instanceId)
      );
      expect(result.success).toBe(false);
      expect(session.state?.players[0].hand.cardIds).not.toContain(invalid.instanceId);
    }
  });

  it('LIVE_SUCCESS consumes no-op when no target exists and rejects stale legal choices', () => {
    const noTarget = resolvePendingCardEffects(
      setupLiveSuccess({ cheerCards: [card(member('PL!S-member-R'), 'member-cheer')] }).game
    ).gameState;
    expect(noTarget.activeEffect).toBeNull();
    expect(
      latestPayload(
        noTarget,
        PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
        'NO_LIVE_REVEALED_CHEER_TARGET'
      )
    ).toBeTruthy();

    const { game, cheerCards } = setupLiveSuccess();
    const started = resolvePendingCardEffects(game).gameState;
    const targetCardId = cheerCards[0]!.instanceId;
    const staleState = updateResolutionZone(started, (zone) => ({
      ...zone,
      cardIds: zone.cardIds.filter((cardId) => cardId !== targetCardId),
      revealedCardIds: zone.revealedCardIds.filter((cardId) => cardId !== targetCardId),
    }));
    const session = sessionWithState(staleState);
    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, staleState.activeEffect!.id, targetCardId)
    );

    expect(result.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(staleState.activeEffect!.id);
    expect(session.state?.players[0].hand.cardIds).not.toContain(targetCardId);
  });
});
