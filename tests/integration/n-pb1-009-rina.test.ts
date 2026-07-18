import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createEnterWaitingRoomEvent,
  createTurnStartEvent,
} from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { gameService } from '../../src/application/game-service';
import { PL_N_PB1_009_LIVE_START_NO_BLADE_HEART_MEMBER_LIVE_TO_WAITING_DRAW_GAIN_YELLOW_BLUE_PURPLE_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(code: string): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setup(
  options: {
    conditionMet?: boolean;
    qualifyingInWaiting?: boolean;
    sourceOnStage?: boolean;
    sourceSlot?: SlotPosition;
    deckCount?: number;
  } = {}
): { game: GameState; sourceId: string; drawIds: readonly string[] } {
  const source = createCardInstance(member('PL!N-pb1-009-P＋'), P1, 'rina');
  const qualifying = createCardInstance(member('QUALIFYING'), P1, 'qualifying');
  const drawCards = Array.from({ length: options.deckCount ?? 1 }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`), P1, `draw-${index}`)
  );
  let game = registerCards(createGameState('n-pb1-009-rina', P1, 'P1', P2, 'P2'), [
    source,
    qualifying,
    ...drawCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(
            player.memberSlots,
            options.sourceSlot ?? SlotPosition.CENTER,
            source.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
          ),
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds:
        options.conditionMet === false || options.qualifyingInWaiting === false
          ? []
          : [qualifying.instanceId],
    },
  }));
  if (options.conditionMet !== false) {
    game = emitGameEvent(
      game,
      createEnterWaitingRoomEvent([qualifying.instanceId], ZoneType.LIVE_ZONE, P1, P1)
    );
  }
  game = {
    ...game,
    pendingAbilities: [
      {
        id: 'rina-pending',
        abilityId:
          PL_N_PB1_009_LIVE_START_NO_BLADE_HEART_MEMBER_LIVE_TO_WAITING_DRAW_GAIN_YELLOW_BLUE_PURPLE_HEART_ABILITY_ID,
        sourceCardId: source.instanceId,
        controllerId: P1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: ['live-start'],
        sourceSlot: SlotPosition.CENTER,
      },
    ],
  };
  return { game, sourceId: source.instanceId, drawIds: drawCards.map((card) => card.instanceId) };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState): GameState {
  const started = start(game);
  return started.activeEffect
    ? confirmActiveEffectStep(started, P1, started.activeEffect.id)
    : started;
}

function addSecondSource(game: GameState): { game: GameState; sourceId: string } {
  const source = createCardInstance(member('PL!N-pb1-009-R'), P1, 'rina-2');
  let next = registerCards(game, [source]);
  next = updatePlayer(next, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return {
    sourceId: source.instanceId,
    game: {
      ...next,
      pendingAbilities: [
        ...next.pendingAbilities,
        {
          ...next.pendingAbilities[0],
          id: 'rina-pending-2',
          sourceCardId: source.instanceId,
          sourceSlot: SlotPosition.LEFT,
        },
      ],
    },
  };
}

describe('PL!N-pb1-009 Rina LIVE_START workflow', () => {
  it('opens one realtime confirm-only window without resolving early', () => {
    const { game, drawIds } = setup();
    const state = start(game);
    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(state.activeEffect?.effectText).toContain('本回合符合条件的成员卡 1张，满足条件');
    expect(state.players[0].hand.cardIds).not.toContain(drawIds[0]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('draws one and gives yellow/blue/purple Heart with complete payload', () => {
    const { game, sourceId, drawIds } = setup();
    const state = confirm(game);
    expect(state.players[0].hand.cardIds).toContain(drawIds[0]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: P1,
      hearts: [
        { color: HeartColor.YELLOW, count: 1 },
        { color: HeartColor.BLUE, count: 1 },
        { color: HeartColor.PURPLE, count: 1 },
      ],
      sourceCardId: sourceId,
      abilityId:
        PL_N_PB1_009_LIVE_START_NO_BLADE_HEART_MEMBER_LIVE_TO_WAITING_DRAW_GAIN_YELLOW_BLUE_PURPLE_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
    });
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      conditionMet: true,
      qualifyingMovedMemberCardIds: ['qualifying'],
      drawnCardIds: [drawIds[0]],
      step: 'CONDITION_MET_DRAW_GAIN_YELLOW_BLUE_PURPLE_HEART',
    });
  });

  it('consumes a failed condition as an accurate no-op', () => {
    const state = confirm(setup({ conditionMet: false }).game);
    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      qualifyingMovedMemberCardIds: [],
      conditionMet: false,
      drawnCardIds: [],
      heartBonus: [],
      step: 'CONDITION_NOT_MET_NO_OP',
    });
  });

  it('still gives Heart with an empty deck', () => {
    const state = confirm(setup({ deckCount: 0, qualifyingInWaiting: false }).game);
    expect(state.actionHistory.at(-1)?.payload.drawnCardIds).toEqual([]);
    expect(state.liveResolution.liveModifiers).toHaveLength(1);
  });

  it('draws after the source leaves but does not write Heart', () => {
    const { game, drawIds } = setup({ sourceOnStage: false });
    const state = confirm(game);
    expect(state.players[0].hand.cardIds).toContain(drawIds[0]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload.heartBonus).toEqual([]);
  });

  it('binds the modifier to the source instance after it changes slots', () => {
    const { game, sourceId } = setup({ sourceSlot: SlotPosition.LEFT });
    expect(confirm(game).liveResolution.liveModifiers[0]).toMatchObject({
      sourceCardId: sourceId,
      target: 'SOURCE_MEMBER',
    });
  });

  it('does not expose the drawn instance id to the opponent projector', () => {
    const { game, drawIds } = setup();
    expect(JSON.stringify(projectPlayerViewState(confirm(game), P2))).not.toContain(drawIds[0]);
  });

  it('does not resolve twice after confirmation consumes the pending ability', () => {
    const started = start(setup().game);
    const effectId = started.activeEffect?.id ?? '';
    const resolved = confirmActiveEffectStep(started, P1, effectId);
    expect(confirmActiveEffectStep(resolved, P1, effectId)).toEqual(resolved);
  });

  it('automatically resolves an ordered batch without per-source confirmation windows', () => {
    const { game: twoSources } = addSecondSource(setup({ deckCount: 2 }).game);
    const orderSelection = start(twoSources);

    const state = confirmActiveEffectStep(
      orderSelection,
      P1,
      orderSelection.activeEffect?.id ?? '',
      undefined,
      undefined,
      true
    );

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.liveModifiers).toHaveLength(2);
  });

  it('uses the manual confirmation bridge when one source is selected from multiple pending', () => {
    const { game: twoSources, sourceId } = addSecondSource(setup().game);
    const orderSelection = start(twoSources);

    const state = confirmActiveEffectStep(
      orderSelection,
      P1,
      orderSelection.activeEffect?.id ?? '',
      sourceId
    );

    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(state.pendingAbilities).toHaveLength(2);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('rechecks at resolution when a qualifying event appears after the preview', () => {
    const { game } = setup({ conditionMet: false });
    const qualifying = createCardInstance(member('LATE-QUALIFYING'), P1, 'late-qualifying');
    let started = start(registerCards(game, [qualifying]));
    expect(started.activeEffect?.effectText).toContain('未满足条件');
    started = emitGameEvent(
      started,
      createEnterWaitingRoomEvent([qualifying.instanceId], ZoneType.LIVE_ZONE, P1, P1)
    );

    const state = confirmActiveEffectStep(started, P1, started.activeEffect?.id ?? '');

    expect(state.actionHistory.at(-1)?.payload.conditionMet).toBe(true);
    expect(state.liveResolution.liveModifiers).toHaveLength(1);
  });

  it('rechecks at resolution when a new turn boundary invalidates the preview event', () => {
    let started = start(setup().game);
    expect(started.activeEffect?.effectText).toContain('满足条件');
    started = emitGameEvent(started, createTurnStartEvent(started.turnCount + 1, P1));

    const state = confirmActiveEffectStep(started, P1, started.activeEffect?.id ?? '');

    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      conditionMet: false,
      step: 'CONDITION_NOT_MET_NO_OP',
    });
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('removes the source Heart modifier during the existing LIVE-end cleanup', () => {
    const resolved = confirm(setup().game);
    expect(resolved.liveResolution.liveModifiers).toHaveLength(1);

    const finalized = gameService.finalizeLiveResult(resolved);

    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });
});
