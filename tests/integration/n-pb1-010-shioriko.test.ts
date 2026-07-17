import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { ENERGY_OPERATION_SELECTION_STEP_ID } from '../../src/application/card-effects/runtime/energy-operation-selection';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
  N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID,
  N_PB1_010_SELECT_OPTION_STEP_ID,
  N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
} from '../../src/application/card-effects/workflows/cards/n-pb1-010-shioriko';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(
  cardCode: string,
  groupNames = ['虹ヶ咲学園スクールアイドル同好会']
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 10,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string, groupNames: readonly string[]): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

interface SetupResult {
  readonly game: GameState;
  readonly sourceId: string;
  readonly energyIds: readonly string[];
  readonly waitingIds: readonly string[];
  readonly deckTopId: string;
}

function setup(
  options: {
    readonly energyOrientations?: readonly OrientationState[];
    readonly waitingCards?: readonly {
      readonly data: MemberCardData | LiveCardData;
      readonly ownerId?: string;
    }[];
    readonly markedEnergyIndices?: readonly number[];
  } = {}
): SetupResult {
  const source = createCardInstance(member('PL!N-pb1-010-R'), PLAYER1, 'shioriko');
  const energies = (options.energyOrientations ?? []).map((_, index) =>
    createCardInstance(energy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  const waiting = (options.waitingCards ?? []).map((entry, index) =>
    createCardInstance(entry.data, entry.ownerId ?? PLAYER1, `waiting-${index}`)
  );
  const deckTop = createCardInstance(member('DECK-TOP'), PLAYER1, 'deck-top');
  let game = createGameState('n-pb1-010-shioriko', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energies, ...waiting, deckTop]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [deckTop.instanceId] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waiting.filter((card) => card.ownerId === PLAYER1).map((card) => card.instanceId),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energies.map((card) => card.instanceId),
      cardStates: new Map(
        energies.map((card, index) => [
          card.instanceId,
          {
            orientation: options.energyOrientations?.[index] ?? OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waiting.filter((card) => card.ownerId === PLAYER2).map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: PLAYER1,
      energyCardId: energies[index]!.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
  };
  game = emitGameEvent(game, {
    eventId: 'shioriko-enter',
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: 1,
    cardInstanceId: source.instanceId,
    fromZone: ZoneType.HAND,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot: SlotPosition.CENTER,
    ownerId: PLAYER1,
    controllerId: PLAYER1,
  });
  const resolved = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(resolved.success, resolved.error).toBe(true);
  return {
    game: resolved.gameState,
    sourceId: source.instanceId,
    energyIds: energies.map((card) => card.instanceId),
    waitingIds: waiting.map((card) => card.instanceId),
    deckTopId: deckTop.instanceId,
  };
}

function chooseOption(game: GameState, optionId: string | null, playerId = PLAYER1): GameState {
  return confirmActiveEffectStep(
    game,
    playerId,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    optionId
  );
}

function chooseCards(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  );
}

function lastResolve(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_N_PB1_010_ON_ENTER_CHOOSE_ACTIVATE_ONE_ENERGY_OR_STACK_NIJIGASAKI_LIVE_TO_DECK_TOP_ABILITY_ID
    );
}

describe('PL!N-pb1-010 Shioriko on-enter choice workflow', () => {
  it('opens a mandatory two-option window and rejects missing, illegal, stale-player input', () => {
    const { game } = setup();
    expect(game.activeEffect).toMatchObject({
      stepId: N_PB1_010_SELECT_OPTION_STEP_ID,
      stepText: '请选择要执行的效果。',
      canSkipSelection: false,
      selectableOptions: [
        { id: N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID, label: '将1张能量变为活跃状态' },
        {
          id: N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID,
          label: '将至多2张虹咲LIVE卡放置于卡组顶',
        },
      ],
    });
    expect(chooseOption(game, null)).toBe(game);
    expect(chooseOption(game, 'illegal-option')).toBe(game);
    expect(chooseOption(game, N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID, PLAYER2)).toBe(game);
  });

  it('safe-no-ops with no waiting energy and auto-activates exactly one ordinary candidate', () => {
    const noEnergy = chooseOption(setup().game, N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID);
    expect(noEnergy.activeEffect).toBeNull();
    expect(lastResolve(noEnergy)?.payload).toMatchObject({
      step: 'NO_OP_NO_WAITING_ENERGY',
      selectedOptionId: N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID,
      activatedEnergyCardIds: [],
    });

    const scenario = setup({
      energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
    });
    const resolved = chooseOption(scenario.game, N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].energyZone.cardStates.get(scenario.energyIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(resolved.players[0].energyZone.cardStates.get(scenario.energyIds[1]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(lastResolve(resolved)?.payload).toMatchObject({
      step: 'ACTIVATE_ONE_ENERGY',
      activatedEnergyCardIds: [scenario.energyIds[0]],
      previousOrientations: [
        { cardId: scenario.energyIds[0], orientation: OrientationState.WAITING },
      ],
      nextOrientation: OrientationState.ACTIVE,
    });
  });

  it('uses the common exact single-energy window for marked candidates and rejects invalid ids', () => {
    const scenario = setup({
      energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
      markedEnergyIndices: [1],
    });
    const selecting = chooseOption(scenario.game, N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID);
    expect(selecting.activeEffect).toMatchObject({
      stepId: ENERGY_OPERATION_SELECTION_STEP_ID,
      selectableCardIds: scenario.energyIds,
      minSelectableCards: 1,
      maxSelectableCards: 1,
      canSkipSelection: false,
    });
    expect(chooseCards(selecting, [scenario.sourceId])).toBe(selecting);
    expect(chooseCards(selecting, [scenario.energyIds[0]!, scenario.energyIds[1]!])).toBe(
      selecting
    );
    const resolved = chooseCards(selecting, [scenario.energyIds[1]!]);
    expect(resolved.activeEffect).toBeNull();
    expect(lastResolve(resolved)?.payload.activatedEnergyCardIds).toEqual([scenario.energyIds[1]]);
  });

  it('filters to own Nijigasaki LIVE cards, supports 0, and never opens an empty window', () => {
    const ownLiveA = live('NIJI-A', ['虹ヶ咲学園スクールアイドル同好会']);
    const ownMember = member('NIJI-MEMBER');
    const otherLive = live('OTHER-LIVE', ['Liella!']);
    const opponentLive = live('OPPONENT-NIJI', ['虹ヶ咲学園スクールアイドル同好会']);
    const scenario = setup({
      waitingCards: [
        { data: ownLiveA },
        { data: ownMember },
        { data: otherLive },
        { data: opponentLive, ownerId: PLAYER2 },
      ],
    });
    const selecting = chooseOption(scenario.game, N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID);
    expect(selecting.activeEffect).toMatchObject({
      stepId: N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID,
      selectableCardIds: [scenario.waitingIds[0]],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
    });
    const skipped = chooseCards(selecting, []);
    expect(skipped.activeEffect).toBeNull();
    expect(lastResolve(skipped)?.payload.step).toBe('SKIP_STACK_NIJIGASAKI_LIVE');

    const empty = chooseOption(setup().game, N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID);
    expect(empty.activeEffect).toBeNull();
    expect(lastResolve(empty)?.payload).toMatchObject({
      step: 'SKIP_STACK_NIJIGASAKI_LIVE',
      selectedCardIds: [],
      movedCardIds: [],
    });
  });

  it('reveals a non-empty ordered selection first, then preserves [A, B] as deck-top order', () => {
    const scenario = setup({
      waitingCards: [
        { data: live('NIJI-A', ['虹ヶ咲学園スクールアイドル同好会']) },
        { data: live('NIJI-B', ['虹ヶ咲学園スクールアイドル同好会']) },
      ],
    });
    const selecting = chooseOption(scenario.game, N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID);
    const session = createGameSession();
    session.createGame('n-pb1-010-session', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = selecting;
    const effectId = selecting.activeEffect!.id;
    const beforeActionCount = selecting.actionHistory.length;
    const first = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        undefined,
        undefined,
        undefined,
        scenario.waitingIds
      )
    );
    expect(first.success, first.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: scenario.waitingIds,
      publicCardSelectionOrdered: true,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(scenario.waitingIds);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([scenario.deckTopId]);
    expect(session.state?.actionHistory).toHaveLength(beforeActionCount);
    const deadline = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, deadline)
      ).success
    ).toBe(false);
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: { ...session.state!.activeEffect!, publicCardSelectionAutoAdvanceAt: 0 },
    };
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 0))
        .success
    ).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      ...scenario.waitingIds,
      scenario.deckTopId,
    ]);
    expect(lastResolve(session.state!)?.payload).toMatchObject({
      step: 'STACK_NIJIGASAKI_LIVE_TO_DECK_TOP',
      selectedCardIds: scenario.waitingIds,
      movedCardIds: scenario.waitingIds,
    });
  });

  it('does not move a stale public selection subset and refreshes remaining legal candidates', () => {
    const scenario = setup({
      waitingCards: [
        { data: live('NIJI-A', ['虹ヶ咲学園スクールアイドル同好会']) },
        { data: live('NIJI-B', ['虹ヶ咲学園スクールアイドル同好会']) },
      ],
    });
    let game = chooseOption(scenario.game, N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID);
    game = chooseCards(game, scenario.waitingIds);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== scenario.waitingIds[0]),
      },
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, scenario.waitingIds[0]!] },
    }));
    const restored = confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id);
    expect(restored.players[0].mainDeck.cardIds).toEqual([scenario.deckTopId]);
    expect(restored.activeEffect).toMatchObject({
      stepId: N_PB1_010_SELECT_NIJIGASAKI_LIVE_STEP_ID,
      selectableCardIds: [scenario.waitingIds[1]],
      maxSelectableCards: 1,
    });
    expect(lastResolve(restored)?.payload.step).toBe('STALE_STACK_SELECTION_REFRESH');
  });

  it('rejects duplicate, over-limit, outside-candidate, and stale LIVE inputs without advancing', () => {
    const scenario = setup({
      waitingCards: [
        { data: live('NIJI-A', ['虹ヶ咲学園スクールアイドル同好会']) },
        { data: live('NIJI-B', ['虹ヶ咲学園スクールアイドル同好会']) },
        { data: live('NIJI-C', ['虹ヶ咲学園スクールアイドル同好会']) },
        { data: live('OTHER', ['Liella!']) },
      ],
    });
    const selecting = chooseOption(scenario.game, N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID);
    expect(chooseCards(selecting, [scenario.waitingIds[0]!, scenario.waitingIds[0]!])).toBe(
      selecting
    );
    expect(chooseCards(selecting, scenario.waitingIds.slice(0, 3))).toBe(selecting);
    expect(chooseCards(selecting, [scenario.waitingIds[3]!])).toBe(selecting);

    const stale = updatePlayer(selecting, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== scenario.waitingIds[0]),
      },
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, scenario.waitingIds[0]!] },
    }));
    expect(chooseCards(stale, [scenario.waitingIds[0]!])).toBe(stale);
  });

  it('keeps an already queued branch valid after the source leaves the stage', () => {
    const liveScenario = setup({
      waitingCards: [{ data: live('NIJI-A', ['虹ヶ咲学園スクールアイドル同好会']) }],
    });
    let liveSelecting = chooseOption(liveScenario.game, N_PB1_010_STACK_NIJIGASAKI_LIVE_OPTION_ID);
    liveSelecting = updatePlayer(liveSelecting, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    expect(chooseCards(liveSelecting, []).activeEffect).toBeNull();

    const energyScenario = setup({
      energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
      markedEnergyIndices: [1],
    });
    let energySelecting = chooseOption(
      energyScenario.game,
      N_PB1_010_ACTIVATE_ONE_ENERGY_OPTION_ID
    );
    energySelecting = updatePlayer(energySelecting, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    const resolved = chooseCards(energySelecting, [energyScenario.energyIds[1]!]);
    expect(resolved.activeEffect).toBeNull();
    expect(lastResolve(resolved)?.payload.activatedEnergyCardIds).toEqual([
      energyScenario.energyIds[1],
    ]);
  });
});
