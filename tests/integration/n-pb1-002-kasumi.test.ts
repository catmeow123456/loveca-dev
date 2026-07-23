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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_N_PB1_002_ON_ENTER_STACK_TWO_ENERGY_BELOW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { playMemberFromZoneToStageSlotWithReplacement } from '../../src/application/card-effects/runtime/play-member-to-stage';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  collectLiveModifiers,
  getPlayerLiveScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
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
const ABILITY = PL_N_PB1_002_ON_ENTER_STACK_TWO_ENERGY_BELOW_ABILITY_ID;
const SCORE_ABILITY = 'PL!N-pb1-002:continuous-two-energy-below-live-total-score';

function member(cardCode: string, name = '中須かすみ', cost = 13): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({}),
  };
}

function setupOnEnter(options: {
  readonly cardCode?: 'PL!N-pb1-002-P＋' | 'PL!N-pb1-002-R';
  readonly orientations?: readonly OrientationState[];
  readonly specialIndex?: number;
} = {}) {
  const source = createCardInstance(member(options.cardCode ?? 'PL!N-pb1-002-R'), P1, 'kasumi');
  const orientations = options.orientations ?? [OrientationState.ACTIVE, OrientationState.ACTIVE];
  const energies = orientations.map((_, index) =>
    createCardInstance(energy(`ENERGY-${index}`), P1, `energy-${index}`)
  );
  let game = registerCards(createGameState('n-pb1-002', P1, 'P1', P2, 'P2'), [
    source,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    energyZone: energies.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: orientations[index],
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  if (options.specialIndex !== undefined) {
    game = {
      ...game,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: energies[options.specialIndex]!.instanceId,
          sourceCardId: 'marker-source',
          abilityId: 'marker-ability',
        },
      ],
    };
  }
  game = emitGameEvent(game, {
    eventId: 'kasumi-enter',
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: Date.now(),
    cardInstanceId: source.instanceId,
    fromZone: ZoneType.HAND,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot: SlotPosition.CENTER,
    ownerId: P1,
    controllerId: P1,
  });
  return { game, source, energies };
}

function resolveOnEnter(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function chooseStack(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    'stack-two-energy'
  );
}

function selectEnergy(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedCardIds
  );
}

function scoreModifiers(game: GameState) {
  return collectLiveModifiers(game).filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === SCORE_ABILITY
  );
}

describe('PL!N-pb1-002-P＋ / R 费用13「中須かすみ」', () => {
  it.each(['PL!N-pb1-002-P＋', 'PL!N-pb1-002-R'] as const)(
    'uses the real PLAY_MEMBER -> ON_ENTER_STAGE queue path for %s and opens the exact optional window',
    (cardCode) => {
      const session = createGameSession();
      session.createGame(`real-enter-${cardCode}`, P1, 'P1', P2, 'P2');
      const source = createCardInstance(member(cardCode), P1, 'real-kasumi');
      const energies = [0, 1].map((index) =>
        createCardInstance(energy(`REAL-ENERGY-${index}`), P1, `real-energy-${index}`)
      );
      let game = registerCards(session.state!, [source, ...energies]);
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        hand: addCardToZone(player.hand, source.instanceId),
        energyZone: energies.reduce(
          (zone, card) =>
            addCardToStatefulZone(zone, card.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
          player.energyZone
        ),
      }));
      (session as unknown as { authorityState: GameState }).authorityState = {
        ...game,
        manualOperationMode: 'FREE',
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
        activePlayerIndex: 0,
      };

      const result = session.executeCommand(
        createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      );
      expect(result.success, result.error).toBe(true);
      expect(session.state?.activeEffect).toMatchObject({
        abilityId: ABILITY,
        effectText: '【登场】可以将2张存在于自己的能量区的能量放置于此成员下方。',
        stepText: '可以将2张存在于自己的能量区的能量放置于此成员下方。',
        selectableOptions: [{ id: 'stack-two-energy', label: '将2张能量放置于此成员下方' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      expect(session.state?.activeEffect).not.toHaveProperty('selectableCardIds');
      expect(
        session.state?.actionHistory.some(
          (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === ABILITY
        )
      ).toBe(true);
    }
  );

  it('declines without moving energy and records neither cost nor ability-use actions', () => {
    const scenario = setupOnEnter({ orientations: [OrientationState.ACTIVE, OrientationState.WAITING] });
    const started = resolveOnEnter(scenario.game);
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].energyZone.cardIds).toEqual(['energy-0', 'energy-1']);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(done.actionHistory.some((action) => action.payload.step === 'ABILITY_USE')).toBe(false);
  });

  it.each([0, 1])('consumes the pending without an activeEffect when only %i energy is available', (count) => {
    const scenario = setupOnEnter({
      orientations: Array.from({ length: count }, () => OrientationState.ACTIVE),
    });
    const done = resolveOnEnter(scenario.game);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
  });

  it('automatically stacks exactly two energy and clears their special-energy markers', () => {
    const scenario = setupOnEnter({
      orientations: [OrientationState.WAITING, OrientationState.ACTIVE],
      specialIndex: 0,
    });
    const done = chooseStack(resolveOnEnter(scenario.game));
    expect(done.players[0].energyZone.cardIds).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      'energy-0',
      'energy-1',
    ]);
    expect(done.energyActivePhaseSkips).toEqual([]);
    expect(
      done.actionHistory.find(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'STACK_TWO_ENERGY_BELOW'
      )?.payload.stackedEnergyCardIds
    ).toEqual(['energy-0', 'energy-1']);
  });

  it('automatically stacks ordinary excess energy in stable WAITING then ACTIVE order', () => {
    const scenario = setupOnEnter({
      orientations: [
        OrientationState.ACTIVE,
        OrientationState.WAITING,
        OrientationState.ACTIVE,
        OrientationState.WAITING,
      ],
    });
    const done = chooseStack(resolveOnEnter(scenario.game));
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      'energy-1',
      'energy-3',
    ]);
    expect(
      done.actionHistory.find((action) => action.payload.step === 'STACK_TWO_ENERGY_BELOW')?.payload
        .stackedEnergyCardIds
    ).toEqual(['energy-1', 'energy-3']);
  });

  it('uses COMMON_ENERGY_OPERATION_SELECTION for special excess energy and accepts an exact pair', () => {
    const scenario = setupOnEnter({
      orientations: [OrientationState.WAITING, OrientationState.ACTIVE, OrientationState.ACTIVE],
      specialIndex: 2,
    });
    const selecting = chooseStack(resolveOnEnter(scenario.game));
    expect(selecting.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      selectableCardIds: ['energy-0', 'energy-1', 'energy-2'],
      minSelectableCards: 2,
      maxSelectableCards: 2,
      stepText: '请选择要放到成员下方的能量。',
      selectionLabel: '选择要放到成员下方的能量',
      confirmSelectionLabel: '放到成员下方',
    });
    const done = selectEnergy(selecting, ['energy-2', 'energy-0']);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      'energy-2',
      'energy-0',
    ]);
    expect(done.players[0].energyZone.cardIds).toEqual(['energy-1']);
    expect(done.energyActivePhaseSkips).toEqual([]);
  });

  it('does not advance on duplicate, outside, wrong-count, or stale energy selections', () => {
    const scenario = setupOnEnter({
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE],
      specialIndex: 2,
    });
    const selecting = chooseStack(resolveOnEnter(scenario.game));
    for (const selected of [
      ['energy-0', 'energy-0'],
      ['energy-0', 'outside'],
      ['energy-0'],
      ['energy-0', 'energy-1', 'energy-2'],
    ]) {
      const rejected = selectEnergy(selecting, selected);
      expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
      expect(rejected.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    }
    const stale = updatePlayer(selecting, P1, (player) => ({
      ...player,
      energyZone: removeCardFromStatefulZone(player.energyZone, 'energy-1'),
    }));
    const rejected = selectEnergy(stale, ['energy-0', 'energy-1']);
    expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(rejected.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
  });

  it('safely consumes the effect when the source becomes invalid before option or selection submission', () => {
    const direct = resolveOnEnter(setupOnEnter().game);
    const directLost = updatePlayer(direct, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const directDone = chooseStack(directLost);
    expect(directDone.activeEffect).toBeNull();
    expect(directDone.players[0].energyZone.cardIds).toEqual(['energy-0', 'energy-1']);

    const specialScenario = setupOnEnter({
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE],
      specialIndex: 2,
    });
    const selecting = chooseStack(resolveOnEnter(specialScenario.game));
    const selectionLost = updatePlayer(selecting, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const selectionDone = selectEnergy(selectionLost, ['energy-0', 'energy-2']);
    expect(selectionDone.activeEffect).toBeNull();
    expect(selectionDone.players[0].energyZone.cardIds).toEqual([
      'energy-0',
      'energy-1',
      'energy-2',
    ]);
  });

  it('continues into the next pending ability after successful stacking', () => {
    const scenario = setupOnEnter({
      orientations: [
        OrientationState.ACTIVE,
        OrientationState.ACTIVE,
        OrientationState.ACTIVE,
        OrientationState.ACTIVE,
      ],
    });
    const second = createCardInstance(member('PL!N-pb1-002-P＋'), P1, 'second-kasumi');
    let started = registerCards(resolveOnEnter(scenario.game), [second]);
    started = updatePlayer(started, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, second.instanceId),
    }));
    const nextPending: PendingAbilityState = {
      id: 'second-pending',
      abilityId: ABILITY,
      sourceCardId: second.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: ['second-enter'],
      sourceSlot: SlotPosition.LEFT,
    };
    started = { ...started, pendingAbilities: [...started.pendingAbilities, nextPending] };
    const continued = chooseStack(started);
    expect(continued.activeEffect).toMatchObject({
      id: 'second-pending',
      abilityId: ABILITY,
      sourceCardId: second.instanceId,
    });
  });

  it('returns energyBelow to the energy deck on replacement and removes the continuous modifier', () => {
    const scenario = setupOnEnter();
    const stacked = chooseStack(resolveOnEnter(scenario.game));
    expect(scoreModifiers(stacked)).toHaveLength(1);
    const replacement = createCardInstance(member('REPLACEMENT', 'Replacement', 13), P1, 'replacement');
    let game = registerCards(stacked, [replacement]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, replacement.instanceId),
    }));
    const replaced = playMemberFromZoneToStageSlotWithReplacement(game, P1, {
      cardId: replacement.instanceId,
      sourceZone: ZoneType.HAND,
      toSlot: SlotPosition.CENTER,
    });
    expect(replaced).not.toBeNull();
    expect(replaced!.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(replaced!.gameState.players[0].energyDeck.cardIds).toEqual(
      expect.arrayContaining(['energy-0', 'energy-1'])
    );
    expect(replaced!.gameState.players[0].waitingRoom.cardIds).toContain('kasumi');
    expect(replaced!.gameState.players[0].waitingRoom.cardIds).not.toContain('energy-0');
    expect(scoreModifiers(replaced!.gameState)).toEqual([]);
  });

  it('returns energyBelow before normal leave-stage waiting-room cleanup', () => {
    const stacked = chooseStack(resolveOnEnter(setupOnEnter().game));
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      stacked,
      P1,
      'kasumi',
      (game) => game
    );
    expect(left).not.toBeNull();
    expect(left!.gameState.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(left!.gameState.players[0].energyDeck.cardIds).toEqual(
      expect.arrayContaining(['energy-0', 'energy-1'])
    );
    expect(left!.gameState.players[0].waitingRoom.cardIds).toContain('kasumi');
    expect(left!.gameState.players[0].waitingRoom.cardIds).not.toContain('energy-0');
    expect(scoreModifiers(left!.gameState)).toEqual([]);
  });

  it('feeds player SCORE +1 into LIVE judgment preview and settlement', () => {
    const scenario = setupOnEnter();
    const currentLive = createCardInstance(live('CURRENT-LIVE'), P1, 'current-live');
    let game = registerCards(chooseStack(resolveOnEnter(scenario.game)), [currentLive]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P1 },
    };
    const modifiers = collectLiveModifiers(game);
    expect(scoreModifiers(game)[0]).not.toHaveProperty('liveCardId');
    expect(getPlayerLiveScoreModifier(game.liveResolution, P1, modifiers)).toBe(1);

    const result = new GameService().processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: P1,
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });
    expect(result.success, result.error).toBe(true);
    expect(result.gameState.liveResolution.playerScores.get(P1)).toBe(2);
    expect(
      result.gameState.actionHistory.find(
        (action) =>
          action.type === 'LIVE_JUDGMENT' && action.payload.action === 'AUTO_PERFORMANCE_JUDGMENT'
      )?.payload
    ).toMatchObject({ scoreDraft: 2, effectScoreBonus: 1 });
  });

  it('consumes an insufficient manually queued pending and preserves continuation', () => {
    const scenario = setupOnEnter({ orientations: [OrientationState.ACTIVE] });
    const pending: PendingAbilityState = {
      id: 'manual-insufficient',
      abilityId: ABILITY,
      sourceCardId: scenario.source.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: ['manual-event'],
      sourceSlot: SlotPosition.CENTER,
    };
    const done = resolvePendingCardEffects({ ...scenario.game, pendingAbilities: [pending] }).gameState;
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });
});
