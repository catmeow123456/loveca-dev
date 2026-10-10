import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  LL_BP8_001_LIVE_SUCCESS_LOOK_SIX_STACK_MEMBER_BELOW_ABILITY_ID,
  LL_BP8_001_ON_ENTER_LOOK_SIX_STACK_MEMBER_BELOW_ABILITY_ID,
  N_BP7_026_LIVE_SUCCESS_TWO_NO_BLADE_HEART_MEMBERS_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { registerLlBp8001NicoAiSerasWorkflowHandlers } from '../../src/application/card-effects/workflows/cards/ll-bp8-001-nico-ai-seras';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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
const ENTER = LL_BP8_001_ON_ENTER_LOOK_SIX_STACK_MEMBER_BELOW_ABILITY_ID;
const SUCCESS = LL_BP8_001_LIVE_SUCCESS_LOOK_SIX_STACK_MEMBER_BELOW_ABILITY_ID;
registerLlBp8001NicoAiSerasWorkflowHandlers({ enqueueTriggeredCardEffects });

function member(id: string, cardCode = `TEST-${id}`, ownerId = P1): CardInstance {
  return createCardInstance(
    {
      cardCode,
      name: id,
      cardType: CardType.MEMBER,
      groupNames: ['Aqours'],
      cost: 15,
      blade: 7,
      hearts: [createHeartIcon(HeartColor.RED, 1)],
    },
    ownerId,
    id
  );
}
function live(id: string): CardInstance {
  return createCardInstance(
    {
      cardCode: 'PL!N-bp7-026-L',
      name: id,
      cardType: CardType.LIVE,
      score: 5,
      requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    },
    P1,
    id
  );
}
function pending(
  abilityId: string,
  sourceCardId = 'host',
  eventIds: readonly string[] = []
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId:
      abilityId === ENTER ? TriggerCondition.ON_ENTER_STAGE : TriggerCondition.ON_LIVE_SUCCESS,
    eventIds,
  };
}
function setup(
  options: {
    readonly abilityId?: string;
    readonly count?: number;
    readonly noMembers?: boolean;
    readonly hostPresent?: boolean;
  } = {}
) {
  const host = member('host', 'LL-bp8-001-R+');
  const count = options.count ?? 8;
  const cards = Array.from({ length: count }, (_, index) =>
    options.noMembers
      ? live(`deck-${index}`)
      : index === 1
        ? live(`deck-${index}`)
        : member(`deck-${index}`)
  );
  let game = registerCards(createGameState('ll-bp8-001', P1, 'P1', P2, 'P2'), [host, ...cards]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    memberSlots:
      options.hostPresent === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, host.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));
  const entry = createEnterStageEvent('host', ZoneType.HAND, SlotPosition.CENTER, P1, P1);
  game = emitGameEvent(game, entry);
  const ability = pending(options.abilityId ?? ENTER, host.instanceId, [entry.eventId]);
  game = resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
  return { game, cards, host, ability };
}
function select(game: GameState, ids: readonly string[]) {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    ids.length <= 1 ? (ids[0] ?? null) : undefined,
    undefined,
    undefined,
    undefined,
    ids.length > 1 ? ids : undefined
  );
}
function sessionFor(game: GameState) {
  let now = 1_000;
  const session = createGameSession({ now: () => now });
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  return {
    session,
    setNow: (next: number) => {
      now = next;
    },
  };
}
function openReveal(f: ReturnType<typeof sessionFor>, selected: string) {
  const result = f.session.executeCommand(
    createConfirmEffectStepCommand(P1, f.session.state!.activeEffect!.id, selected)
  );
  expect(result.success, result.error).toBe(true);
  return f.session.state!.activeEffect!;
}
function finishReveal(f: ReturnType<typeof sessionFor>) {
  const effect = f.session.state!.activeEffect!;
  f.setNow(effect.publicRevealAutoAdvanceAt!);
  const result = f.session.executeCommand(
    createAutoAdvancePublicRevealCommand(
      P2,
      effect.id,
      effect.publicRevealAutoAdvanceAt!,
      effect.publicRevealGeneration!
    )
  );
  expect(result.success, result.error).toBe(true);
  return f.session.state!;
}
function waitingEvents(game: GameState) {
  return game.eventLog.filter(
    ({ event }) =>
      event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
      'fromZone' in event &&
      event.fromZone === ZoneType.MAIN_DECK
  );
}

describe('LL-bp8-001 费用15「矢泽日香&宫下爱&赛拉丝」inspection and stacking', () => {
  it.each([ENTER, SUCCESS])(
    'privately inspects six, submits a single member directly, reveals only selected, and stacks after dwell (%s)',
    (abilityId) => {
      const scenario = setup({ abilityId });
      expect(scenario.game.inspectionZone.cardIds).toEqual(
        scenario.cards.slice(0, 6).map((card) => card.instanceId)
      );
      expect(scenario.game.activeEffect?.selectableCardIds).toContain('deck-0');
      expect(scenario.game.activeEffect?.selectableCardIds).not.toContain('deck-1');
      expect(scenario.game.activeEffect?.effectText).toBe(
        '【登场】/【LIVE成功时】检视自己的卡组顶的６张卡片。可以将其中的１张成员卡公开，放置于此成员的下方。其余的放置入休息室。'
      );
      expect(scenario.game.activeEffect?.selectableCardMode).toBeUndefined();
      expect(scenario.game.activeEffect?.minSelectableCards).toBeUndefined();
      expect(scenario.game.activeEffect?.maxSelectableCards).toBeUndefined();
      expect(scenario.game.activeEffect?.autoSubmitSingleSelection).toBeUndefined();
      expect(scenario.game.activeEffect?.selectionLabel).toBe(
        '选择要公开并放置于此成员下方的成员卡'
      );
      expect(scenario.game.activeEffect?.confirmSelectionLabel).toBe('公开并放置于此成员下方');
      expect(scenario.game.activeEffect?.canSkipSelection).toBe(true);
      expect(scenario.game.activeEffect?.skipSelectionLabel).toBe('全部放置入休息室');
      for (const viewer of [P1, P2]) {
        const view = projectPlayerViewState(scenario.game, viewer);
        expect(view.objects[createPublicObjectId('deck-0')]?.surface).toBe(
          viewer === P1 ? 'FRONT' : 'BACK'
        );
        expect(view.activeEffect?.selectableObjectMode).toBeUndefined();
        expect(view.activeEffect?.minSelectableObjects).toBeUndefined();
        expect(view.activeEffect?.maxSelectableObjects).toBeUndefined();
        expect(view.activeEffect?.autoSubmitSingleSelection).toBeUndefined();
        expect(view.activeEffect?.selectableObjectIds).toEqual(
          viewer === P1
            ? scenario.game.activeEffect!.selectableCardIds!.map(createPublicObjectId)
            : undefined
        );
      }
      const f = sessionFor(scenario.game);
      const effect = openReveal(f, 'deck-0');
      expect(effect.stepId).toBe('COMMON_PUBLIC_REVEAL_DWELL');
      expect(effect.revealedCardIds).toEqual(['deck-0']);
      expect(effect.selectableCardIds).toBeUndefined();
      expect(effect.confirmSelectionLabel).toBeUndefined();
      expect(effect.canSkipSelection).toBeUndefined();
      expect(f.session.state!.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
      expect(waitingEvents(f.session.state!)).toEqual([]);
      const opponent = projectPlayerViewState(f.session.state!, P2);
      expect(opponent.objects[createPublicObjectId('deck-0')]?.surface).toBe('FRONT');
      expect(opponent.objects[createPublicObjectId('deck-2')]?.surface).toBe('BACK');
      const early = f.session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          P2,
          effect.id,
          effect.publicRevealAutoAdvanceAt!,
          effect.publicRevealGeneration!
        )
      );
      expect(early.success).toBe(false);
      const completed = finishReveal(f);
      expect(completed.activeEffect).toBeNull();
      expect(completed.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual(['deck-0']);
      for (const viewer of [P1, P2]) {
        expect(
          projectPlayerViewState(completed, viewer).objects[createPublicObjectId('deck-0')]?.surface
        ).toBe('FRONT');
      }
      expect(completed.players[0].waitingRoom.cardIds).toEqual([
        'deck-1',
        'deck-2',
        'deck-3',
        'deck-4',
        'deck-5',
      ]);
      expect(completed.inspectionZone.cardIds).toEqual([]);
      const events = waitingEvents(completed);
      expect(events).toHaveLength(1);
      expect(events[0]!.event).toMatchObject({
        cardInstanceIds: ['deck-1', 'deck-2', 'deck-3', 'deck-4', 'deck-5'],
        cause: { sourceCardId: 'host', abilityId },
      });
      expect(
        f.session.executeCommand(
          createAutoAdvancePublicRevealCommand(
            P2,
            effect.id,
            effect.publicRevealAutoAdvanceAt!,
            effect.publicRevealGeneration!
          )
        ).success
      ).toBe(false);
      expect(waitingEvents(f.session.state!)).toHaveLength(1);
    }
  );

  it('lets the player decline, or read a no-target/short deck before moving all cards as one batch', () => {
    for (const options of [{}, { noMembers: true }, { count: 3 }, { hostPresent: false }]) {
      const scenario = setup(options);
      const expected = scenario.cards.slice(0, 6).map((card) => card.instanceId);
      expect(scenario.game.inspectionZone.cardIds).toEqual(expected);
      expect(scenario.game.activeEffect?.skipSelectionLabel).toBe('全部放置入休息室');
      expect(scenario.game.activeEffect?.selectableCardMode).toBeUndefined();
      const finished = select(scenario.game, []);
      expect(finished.activeEffect).toBeNull();
      expect(finished.inspectionZone.cardIds).toEqual([]);
      expect(waitingEvents(finished)).toHaveLength(1);
      expect(waitingEvents(finished)[0]!.event).toMatchObject({ cardInstanceIds: expected });
      expect(finished.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    }
  });

  it('keeps an empty deck confirmation and rejects illegal, duplicate, and stale selections', () => {
    const empty = setup({ count: 0 });
    expect(empty.game.activeEffect?.skipSelectionLabel).toBe('确认');
    expect(select(empty.game, []).activeEffect).toBeNull();
    const scenario = setup();
    for (const ids of [['host'], ['deck-1'], ['deck-0', 'deck-0'], ['deck-0', 'deck-2']])
      expect(select(scenario.game, ids)).toBe(scenario.game);
    const f = sessionFor(scenario.game);
    for (const ids of [['deck-0'], ['deck-0', 'deck-0'], ['deck-0', 'deck-2']]) {
      const before = f.session.state;
      const result = f.session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          before!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ids
        )
      );
      expect(result.success).toBe(false);
      expect(f.session.state).toBe(before);
    }
    const stale = {
      ...scenario.game,
      inspectionZone: {
        ...scenario.game.inspectionZone,
        cardIds: scenario.game.inspectionZone.cardIds.filter((id) => id !== 'deck-0'),
      },
    };
    expect(select(stale, ['deck-0'])).toBe(stale);
  });

  it('does not transfer old inspection to a new host lifecycle, and leaves all current inspected cards in the waiting room', () => {
    const scenario = setup();
    const f = sessionFor(scenario.game);
    openReveal(f, 'deck-0');
    let replaced = updatePlayer(f.session.state!, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.CENTER,
        'host',
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    replaced = emitGameEvent(
      replaced,
      createEnterStageEvent('host', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    f.session.restoreRuntimeState({ authorityState: replaced, currentPublicSeq: 0 });
    const finished = finishReveal(f);
    expect(finished.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(finished.players[0].waitingRoom.cardIds).toEqual(
      scenario.cards.slice(0, 6).map((card) => card.instanceId)
    );
    expect(waitingEvents(finished)).toHaveLength(1);
  });

  it('stacks beneath the same host after an in-stage slot move', () => {
    const scenario = setup();
    const f = sessionFor(scenario.game);
    openReveal(f, 'deck-0');
    const moved = updatePlayer(f.session.state!, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.RIGHT,
        'host',
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      ),
    }));
    f.session.restoreRuntimeState({ authorityState: moved, currentPublicSeq: 0 });
    const finished = finishReveal(f);
    expect(finished.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(finished.players[0].memberSlots.memberBelow[SlotPosition.RIGHT]).toEqual(['deck-0']);
    expect(waitingEvents(finished)).toHaveLength(1);
  });

  it('retains the triggered lifecycle even when the same host reenters before the pending starts', () => {
    const scenario = setup();
    let game = {
      ...scenario.game,
      activeEffect: null,
      inspectionZone: { ...scenario.game.inspectionZone, cardIds: [], revealedCardIds: [] },
      inspectionContext: null,
    };
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: scenario.cards.map((card) => card.instanceId) },
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('host', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    const started = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [scenario.ability],
    }).gameState;
    expect(started.activeEffect?.selectableCardIds).toEqual([]);
    expect(started.inspectionZone.cardIds).toHaveLength(6);
    expect(select(started, []).activeEffect).toBeNull();
  });

  it('rechecks a stale revealed card without duplicating it, and keeps later pending until inspection completes', () => {
    const scenario = setup();
    const next = live('next-live');
    let game = registerCards(scenario.game, [next]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, next.instanceId),
    }));
    game = {
      ...game,
      pendingAbilities: [
        pending(
          N_BP7_026_LIVE_SUCCESS_TWO_NO_BLADE_HEART_MEMBERS_SCORE_ABILITY_ID,
          next.instanceId
        ),
      ],
    };
    const f = sessionFor(game);
    openReveal(f, 'deck-0');
    expect(f.session.state!.pendingAbilities).toHaveLength(1);
    let changed = updatePlayer(f.session.state!, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['deck-0'] },
    }));
    changed = {
      ...changed,
      inspectionZone: {
        ...changed.inspectionZone,
        cardIds: changed.inspectionZone.cardIds.filter((id) => id !== 'deck-0'),
        revealedCardIds: [],
      },
    };
    f.session.restoreRuntimeState({ authorityState: changed, currentPublicSeq: 0 });
    const finished = finishReveal(f);
    expect(finished.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
    expect(finished.players[0].hand.cardIds).toContain('deck-0');
    expect(finished.players[0].waitingRoom.cardIds).not.toContain('deck-0');
    expect(finished.activeEffect?.abilityId).toBe(
      N_BP7_026_LIVE_SUCCESS_TWO_NO_BLADE_HEART_MEMBERS_SCORE_ABILITY_ID
    );
    expect(waitingEvents(finished)).toHaveLength(1);
  });
});
