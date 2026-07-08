import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updateLiveResolution,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { S_BP5_023_LIVE_START_STAGE_AQOURS_SAINTSNOW_COST_STACK_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function awakenThePower(): LiveCardData {
  return live('PL!S-bp5-023-L', 'Awaken the power', ['Aqours', 'SaintSnow'], 7);
}

function live(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = ['Aqours'],
  score = 3
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function member(
  cardCode: string,
  groupNames: readonly string[],
  cost: number,
  name = cardCode
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
  };
}

function setupAwakenState(options: {
  readonly sourceInLiveZone?: boolean;
  readonly stageMembers: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly mainDeckCards?: readonly ReturnType<typeof createCardInstance>[];
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly waitingRoomCardIds: readonly string[];
  readonly mainDeckCardIds: readonly string[];
} {
  const source = createCardInstance(awakenThePower(), PLAYER1, 'awaken-source');
  const waitingRoomCards = options.waitingRoomCards ?? [];
  const mainDeckCards = options.mainDeckCards ?? [];
  let game = createGameState('s-bp5-023-awaken-the-power', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...options.stageMembers.map((entry) => entry.card),
    ...waitingRoomCards,
    ...mainDeckCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of options.stageMembers) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      liveZone:
        options.sourceInLiveZone === false
          ? player.liveZone
          : addCardToStatefulZone(player.liveZone, source.instanceId),
      waitingRoom: waitingRoomCards.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.waitingRoom
      ),
      mainDeck: mainDeckCards.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.mainDeck
      ),
    };
  });
  return {
    game,
    source,
    waitingRoomCardIds: waitingRoomCards.map((card) => card.instanceId),
    mainDeckCardIds: mainDeckCards.map((card) => card.instanceId),
  };
}

function validStageMembers(): readonly {
  readonly card: ReturnType<typeof createCardInstance>;
  readonly slot: SlotPosition;
}[] {
  return [
    {
      card: createCardInstance(member('PL!S-aqours-member', ['Aqours'], 10), PLAYER1, 'aqours'),
      slot: SlotPosition.LEFT,
    },
    {
      card: createCardInstance(
        member('PL!S-saintsnow-member', ['SaintSnow'], 10),
        PLAYER1,
        'saintsnow'
      ),
      slot: SlotPosition.CENTER,
    },
  ];
}

function legalLiveCards(count: number): readonly ReturnType<typeof createCardInstance>[] {
  return Array.from({ length: count }, (_, index) =>
    createCardInstance(
      live(`PL!S-legal-live-${index}`, `Legal ${index}`, [
        index % 2 === 0 ? 'Aqours' : 'SaintSnow',
      ]),
      PLAYER1,
      `legal-live-${index}`
    )
  );
}

function runLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function confirmSelectedCards(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedCardIds
  );
}

function pendingAwaken(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: S_BP5_023_LIVE_START_STAGE_AQOURS_SAINTSNOW_COST_STACK_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
  };
}

function lastResolvePayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          S_BP5_023_LIVE_START_STAGE_AQOURS_SAINTSNOW_COST_STACK_LIVE_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!S-bp5-023-L Awaken the power', () => {
  it('selects up to four Aqours/SaintSnow LIVE cards from waiting room and stacks them on deck top in selected order', () => {
    const waitingRoomCards = legalLiveCards(4);
    const mainDeckCards = [
      createCardInstance(live('PL!S-main-0'), PLAYER1, 'main-0'),
      createCardInstance(live('PL!S-main-1'), PLAYER1, 'main-1'),
    ];
    const { game, waitingRoomCardIds, mainDeckCardIds } = setupAwakenState({
      stageMembers: validStageMembers(),
      waitingRoomCards,
      mainDeckCards,
    });

    const started = runLiveStart(game);

    expect(started.activeEffect).toMatchObject({
      abilityId: S_BP5_023_LIVE_START_STAGE_AQOURS_SAINTSNOW_COST_STACK_LIVE_ABILITY_ID,
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 4,
      canSkipSelection: true,
    });
    expect(started.activeEffect?.selectableCardIds).toEqual(waitingRoomCardIds);

    const selectedOrder = [
      waitingRoomCardIds[2]!,
      waitingRoomCardIds[0]!,
      waitingRoomCardIds[3]!,
      waitingRoomCardIds[1]!,
    ];
    const resolved = confirmSelectedCards(started, selectedOrder);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0]!.mainDeck.cardIds.slice(0, 6)).toEqual([
      ...selectedOrder,
      ...mainDeckCardIds,
    ]);
    expect(resolved.players[0]!.waitingRoom.cardIds).toEqual([]);
    expect(lastResolvePayload(resolved)).toMatchObject({
      step: 'MOVE_WAITING_ROOM_LIVE_TO_DECK_TOP',
      selectedCardIds: selectedOrder,
      movedCardIds: selectedOrder,
      relevantEffectiveCostTotal: 20,
      conditionMet: true,
    });
  });

  it('does not start when only Aqours, only SaintSnow, or total effective cost is below 20', () => {
    const scenarios = [
      {
        name: 'only Aqours',
        stageMembers: [
          {
            card: createCardInstance(member('PL!S-aqours-only', ['Aqours'], 20), PLAYER1, 'only-aqours'),
            slot: SlotPosition.LEFT,
          },
        ],
      },
      {
        name: 'only SaintSnow',
        stageMembers: [
          {
            card: createCardInstance(
              member('PL!S-saintsnow-only', ['SaintSnow'], 20),
              PLAYER1,
              'only-saintsnow'
            ),
            slot: SlotPosition.LEFT,
          },
        ],
      },
      {
        name: 'insufficient cost',
        stageMembers: [
          {
            card: createCardInstance(member('PL!S-aqours-low', ['Aqours'], 9), PLAYER1, 'aqours-low'),
            slot: SlotPosition.LEFT,
          },
          {
            card: createCardInstance(
              member('PL!S-saintsnow-low', ['SaintSnow'], 10),
              PLAYER1,
              'saintsnow-low'
            ),
            slot: SlotPosition.CENTER,
          },
        ],
      },
    ] as const;

    for (const scenario of scenarios) {
      const { game } = setupAwakenState({
        stageMembers: scenario.stageMembers,
        waitingRoomCards: legalLiveCards(1),
      });
      const resolved = runLiveStart(game);
      expect(resolved.activeEffect, scenario.name).toBeNull();
      expect(lastResolvePayload(resolved)).toMatchObject({
        step: 'CONDITION_NOT_MET',
        conditionMet: false,
      });
    }
  });

  it('does not start when the source LIVE is no longer in own liveZone', () => {
    const { game, source } = setupAwakenState({
      sourceInLiveZone: false,
      stageMembers: validStageMembers(),
      waitingRoomCards: legalLiveCards(1),
    });
    const resolved = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [pendingAwaken(source.instanceId)],
    }).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(lastResolvePayload(resolved)).toMatchObject({
      step: 'CONDITION_NOT_MET',
      sourceIsCurrentLive: false,
      conditionMet: false,
    });
  });

  it('does not move cards when there are no legal waiting-room LIVE candidates', () => {
    const invalidCards = [
      createCardInstance(live('PL!S-off-group-live', 'Off Group', ['Liella!']), PLAYER1, 'off-group'),
      createCardInstance(member('PL!S-aqours-member-card', ['Aqours'], 1), PLAYER1, 'member-target'),
    ];
    const { game } = setupAwakenState({
      stageMembers: validStageMembers(),
      waitingRoomCards: invalidCards,
      mainDeckCards: [createCardInstance(live('PL!S-no-target-main'), PLAYER1, 'no-target-main')],
    });
    const resolved = runLiveStart(game);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0]!.waitingRoom.cardIds).toEqual(
      invalidCards.map((card) => card.instanceId)
    );
    expect(lastResolvePayload(resolved)).toMatchObject({
      step: 'NO_WAITING_ROOM_LIVE_TARGET',
      conditionMet: true,
    });
  });

  it('allows selecting zero cards without moving anything', () => {
    const waitingRoomCards = legalLiveCards(2);
    const mainDeckCards = [createCardInstance(live('PL!S-main-zero'), PLAYER1, 'main-zero')];
    const { game, waitingRoomCardIds, mainDeckCardIds } = setupAwakenState({
      stageMembers: validStageMembers(),
      waitingRoomCards,
      mainDeckCards,
    });
    const started = runLiveStart(game);
    const resolved = confirmSelectedCards(started, []);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0]!.waitingRoom.cardIds).toEqual(waitingRoomCardIds);
    expect(resolved.players[0]!.mainDeck.cardIds).toEqual(mainDeckCardIds);
    expect(lastResolvePayload(resolved)).toMatchObject({
      step: 'SKIP_WAITING_ROOM_LIVE_SELECTION',
      conditionMet: true,
    });
  });

  it('rejects non-candidate, duplicate, over-four, and stale selections without moving cards', () => {
    const waitingRoomCards = [
      ...legalLiveCards(5),
      createCardInstance(live('PL!S-off-group-live', 'Off Group', ['Liella!']), PLAYER1, 'off-group'),
      createCardInstance(member('PL!S-waiting-member', ['Aqours'], 1), PLAYER1, 'waiting-member'),
    ];
    const { game, waitingRoomCardIds } = setupAwakenState({
      stageMembers: validStageMembers(),
      waitingRoomCards,
      mainDeckCards: [createCardInstance(live('PL!S-illegal-main'), PLAYER1, 'illegal-main')],
    });
    const started = runLiveStart(game);
    const legalIds = waitingRoomCardIds.slice(0, 5);
    const offGroupLiveId = waitingRoomCardIds[5]!;
    const memberId = waitingRoomCardIds[6]!;

    for (const selectedCardIds of [
      [offGroupLiveId],
      [memberId],
      [legalIds[0]!, legalIds[0]!],
      legalIds,
    ]) {
      const rejected = confirmSelectedCards(started, selectedCardIds);
      expect(rejected.activeEffect).toBe(started.activeEffect);
      expect(rejected.players[0]!.waitingRoom.cardIds).toEqual(started.players[0]!.waitingRoom.cardIds);
      expect(rejected.players[0]!.mainDeck.cardIds).toEqual(started.players[0]!.mainDeck.cardIds);
    }

    const staleTargetId = legalIds[0]!;
    const stale = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== staleTargetId),
      },
      hand: addCardToStatefulZone(player.hand, staleTargetId),
    }));
    const staleRejected = confirmSelectedCards(stale, [staleTargetId]);
    expect(staleRejected.activeEffect).toBe(stale.activeEffect);
    expect(staleRejected.players[0]!.mainDeck.cardIds).toEqual(stale.players[0]!.mainDeck.cardIds);
    expect(staleRejected.players[0]!.hand.cardIds).toContain(staleTargetId);
  });

  it('counts effective cost modifiers and does not double-count a single dual-group member', () => {
    const aqours = createCardInstance(member('PL!S-aqours-cost', ['Aqours'], 9), PLAYER1, 'aqours-cost');
    const saintSnow = createCardInstance(
      member('PL!S-saintsnow-cost', ['SaintSnow'], 10),
      PLAYER1,
      'saintsnow-cost'
    );
    const base = setupAwakenState({
      stageMembers: [
        { card: aqours, slot: SlotPosition.LEFT },
        { card: saintSnow, slot: SlotPosition.CENTER },
      ],
      waitingRoomCards: legalLiveCards(1),
      mainDeckCards: [createCardInstance(live('PL!S-cost-main'), PLAYER1, 'cost-main')],
    }).game;
    const withCostModifier = updateLiveResolution(base, (liveResolution) => ({
      ...liveResolution,
      liveModifiers: [
        ...liveResolution.liveModifiers,
        {
          kind: 'MEMBER_COST',
          playerId: PLAYER1,
          memberCardId: aqours.instanceId,
          countDelta: 1,
          sourceCardId: aqours.instanceId,
          abilityId: 'test:member-cost-plus-one',
        },
      ],
    }));

    const started = runLiveStart(withCostModifier);
    expect(started.activeEffect).not.toBeNull();
    expect(lastResolvePayload(started)).toMatchObject({
      relevantEffectiveCostTotal: 20,
      conditionMet: true,
    });

    const dualMember = createCardInstance(
      member('PL!S-dual-member', ['Aqours', 'SaintSnow'], 11),
      PLAYER1,
      'dual-member'
    );
    const dualOnly = setupAwakenState({
      stageMembers: [{ card: dualMember, slot: SlotPosition.CENTER }],
      waitingRoomCards: legalLiveCards(1),
      mainDeckCards: [createCardInstance(live('PL!S-dual-main'), PLAYER1, 'dual-main')],
    }).game;
    const resolved = runLiveStart(dualOnly);
    expect(resolved.activeEffect).toBeNull();
    expect(lastResolvePayload(resolved)).toMatchObject({
      relevantMemberCardIds: [dualMember.instanceId],
      relevantEffectiveCostTotal: 11,
      conditionMet: false,
    });
  });
});
