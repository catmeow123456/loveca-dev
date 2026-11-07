import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP8_027_LIVE_SUCCESS_CHOOSE_WAITING_ROOM_TOP_OR_ENERGY_UNDER_NIJIGASAKI_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectChoiceCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
  createLeaveStageEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  createNovember07DraftCard,
  getNovember07LiveData,
} from '../helpers/november-07-draft-effects';
import { choose, gameWithCards, live, member, P1, P2 } from '../helpers/card-effect-zone-fixture';

const TEXT =
  '【LIVE成功时】从以下选择１项。\n・将存在于自己的休息室的１张『虹咲』的卡片放置于卡组顶。\n・从自己的能量卡组，将１张能量卡放置于存在于自己的舞台的『虹咲』的成员的下方。';
const TOP = 'waiting-room-to-deck-top';
const ENERGY = 'energy-under-nijigasaki-member';
function setup(
  options: {
    code?: string;
    waiting?: readonly string[];
    noMember?: boolean;
    energy?: boolean;
    sourceOut?: boolean;
  } = {}
): GameState {
  const source = createCardInstance(
    { ...getNovember07LiveData('PL!N-bp8-027'), cardCode: options.code ?? 'PL!N-bp8-027-L' },
    P1,
    'song'
  );
  const energy = ['energy-top', 'energy-next'].map((id) =>
    createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, P1, id)
  );
  let game = gameWithCards([
    source,
    createNovember07DraftCard('PL!N-bp8-027', P1, 'second-song'),
    member('waiting-member', { groupNames: ['虹ヶ咲'] }),
    live('waiting-live', { groupNames: ['虹咲'] }),
    member('waiting-other', { groupNames: ['Liella!'] }),
    member('foreign', { groupNames: ['虹ヶ咲'] }, P2),
    member('target', { groupNames: ['虹ヶ咲'] }),
    member('other-stage', { groupNames: ['Liella!'] }),
    member('buried', { groupNames: ['虹ヶ咲'] }),
    member('deck'),
    ...energy,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    liveZone: options.sourceOut
      ? p.liveZone
      : addCardToStatefulZone(p.liveZone, 'song', {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        }),
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: options.waiting ?? ['waiting-member', 'waiting-live', 'waiting-other', 'foreign'],
    },
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    energyDeck: {
      ...p.energyDeck,
      cardIds: options.energy === false ? [] : ['energy-top', 'energy-next'],
    },
    memberSlots: addMemberBelowMember(
      placeCardInSlot(
        options.noMember
          ? p.memberSlots
          : placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'target', {
              orientation: OrientationState.WAITING,
              face: FaceState.FACE_UP,
            }),
        SlotPosition.LEFT,
        'other-stage'
      ),
      SlotPosition.LEFT,
      'buried'
    ),
  }));
  return {
    ...game,
    manualOperationMode: 'RULES',
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}
function enqueue(game: GameState, sources: readonly string[] = ['song']): GameState {
  return enqueueTriggeredCardEffects(emitGameEvent(game, createLiveSuccessEvent(P1, sources, 2)), [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
}
function start(game = setup()): GameState {
  return resolvePendingCardEffects(enqueue(game)).gameState;
}
function option(game: GameState, id: string): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    id
  );
}
function selectBranch(game: GameState, id: string): GameState {
  return choose(option(game, id));
}
function moveEvents(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}
function energyPlacementEvents(game: GameState) {
  return game.eventLog.filter(
    ({ event }) =>
      event.eventType === TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER ||
      event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
  );
}

describe('PL!N-bp8-027 分数2 化作约定吧我们的歌', () => {
  it.each(['L', 'P', 'SEC', 'UNSEEN'])(
    'registers the complete two-branch text for every rarity: %s',
    (rare) => {
      expect(getCardAbilityDefinitionsForCardCode(`PL!N-bp8-027-${rare}`)).toEqual([
        expect.objectContaining({
          abilityId: ABILITY,
          baseCardCodes: ['PL!N-bp8-027'],
          effectText: TEXT,
          category: 'LIVE_SUCCESS',
          sourceZone: 'LIVE_CARD',
          triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
          queued: true,
          implemented: true,
        }),
      ]);
      expect(start(setup({ code: `PL!N-bp8-027-${rare}` })).activeEffect?.effectText).toBe(TEXT);
    }
  );
  it('always retains both mandatory branches and rejects skip, unknown and multiple choice input', () => {
    const game = start(setup({ waiting: [], noMember: true, energy: false }));
    expect(game.activeEffect).toMatchObject({
      effectChoice: {
        mode: 'SINGLE',
        minSelections: 1,
        maxSelections: 1,
        options: [
          { id: TOP, selectable: true },
          { id: ENERGY, selectable: true },
        ],
        publicConfirmation: true,
      },
      canSkipSelection: false,
    });
    expect(choose(game, null)).toBe(game);
    expect(option(game, 'fake')).toBe(game);
    expect(
      confirmActiveEffectStep(
        game,
        P1,
        game.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [TOP, ENERGY]
      )
    ).toBe(game);
  });
  it.each(['waiting-member', 'waiting-live'])(
    'moves any own Nijigasaki card, including MEMBER and LIVE: %s',
    (target) => {
      const branch = selectBranch(start(), TOP);
      expect(branch.activeEffect).toMatchObject({
        selectableCardIds: ['waiting-member', 'waiting-live'],
        selectableCardMode: 'SINGLE',
        canSkipSelection: false,
        confirmSelectionLabel: '放置于卡组顶',
      });
      expect(branch.activeEffect?.effectChoice).toBeUndefined();
      expect(branch.activeEffect?.selectableOptions).toBeUndefined();
      expect(branch.activeEffect?.skipSelectionLabel).toBeUndefined();
      for (const id of [null, 'foreign', 'waiting-other', 'target'])
        expect(choose(branch, id)).toBe(branch);
      const revealed = choose(branch, target);
      expect(revealed.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
      expect(revealed.players[0].mainDeck.cardIds).toEqual(['deck']);
      expect(moveEvents(revealed)).toEqual([]);
      const done = choose(revealed);
      expect(done.players[0].mainDeck.cardIds).toEqual([target, 'deck']);
      expect(moveEvents(done)).toEqual([
        expect.objectContaining({ movedCardIds: [target], destination: { kind: 'TOP' } }),
      ]);
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
    }
  );
  it('uses real RULES commands with separate public option and card deadlines before any move', () => {
    let now = 1000;
    const session = createGameSession({ now: () => now });
    session.createGame('song-rules', P1, 'P1', P2, 'P2');
    session.restoreRuntimeState({ authorityState: start(), currentPublicSeq: 0 });
    const id = session.state!.activeEffect!.id;
    expect(session.manualOperationMode).toBe('RULES');
    expect(
      session.executeCommand(
        createConfirmEffectChoiceCommand(P1, id, { selectedEffectOptionIds: [TOP] })
      ).success
    ).toBe(true);
    const choice = session.state!;
    expect(choice.activeEffect?.stepId).toBe(PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID);
    expect(choice.activeEffect?.selectableCardIds).toBeUndefined();
    for (const viewer of [P1, P2])
      expect(
        projectPlayerViewState(choice, viewer).activeEffect?.effectChoice?.selectedOptionIds
      ).toEqual([TOP]);
    const choiceDeadline = choice.activeEffect!.publicEffectChoiceAutoAdvanceAt!;
    expect(
      session.executeCommand(createAutoAdvancePublicEffectChoiceCommand(P2, id, choiceDeadline))
        .success
    ).toBe(false);
    now = choiceDeadline;
    expect(
      session.executeCommand(createAutoAdvancePublicEffectChoiceCommand(P2, id, choiceDeadline))
        .success
    ).toBe(true);
    expect(session.state!.activeEffect?.effectChoice).toBeUndefined();
    expect(session.state!.activeEffect?.selectableCardIds).toEqual([
      'waiting-member',
      'waiting-live',
    ]);
    const selection = session.getPlayerViewState(P1)?.activeEffect;
    expect(selection).toMatchObject({ selectableObjectMode: 'SINGLE', canSkipSelection: false });
    expect(selection?.effectChoice).toBeUndefined();
    expect(selection?.selectableOptions).toBeUndefined();
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, id, null)).success).toBe(
      false
    );
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, id, 'waiting-live')).success
    ).toBe(true);
    const reveal = session.state!;
    for (const viewer of [P1, P2])
      expect(
        projectPlayerViewState(reveal, viewer).objects[createPublicObjectId('waiting-live')].surface
      ).toBe('FRONT');
    expect(reveal.players[0].waitingRoom.cardIds).toContain('waiting-live');
    expect(moveEvents(reveal)).toEqual([]);
    const cardDeadline = reveal.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P1, id, cardDeadline))
        .success
    ).toBe(false);
    now = cardDeadline;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, id, cardDeadline))
        .success
    ).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['waiting-live', 'deck']);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P1, id, cardDeadline))
        .success
    ).toBe(false);
    expect(moveEvents(session.state!)).toHaveLength(1);
  });
  it('selects a current top-level Nijigasaki member and places exactly the energy-deck top without zone events', () => {
    const branch = selectBranch(start(), ENERGY);
    expect(branch.activeEffect).toMatchObject({
      selectableCardIds: ['target'],
      canSkipSelection: false,
      confirmSelectionLabel: '放置于成员下方',
    });
    expect(branch.activeEffect?.effectChoice).toBeUndefined();
    expect(branch.activeEffect?.minSelectableCards).toBeUndefined();
    for (const id of [null, 'other-stage', 'buried', 'waiting-member'])
      expect(choose(branch, id)).toBe(branch);
    const session = createGameSession();
    session.createGame('song-energy-target-click', P1, 'P1', P2, 'P2');
    session.restoreRuntimeState({ authorityState: branch, currentPublicSeq: 0 });
    const selection = session.getPlayerViewState(P1)?.activeEffect;
    expect(selection).toMatchObject({ selectableObjectMode: 'SINGLE', canSkipSelection: false });
    expect(selection?.effectChoice).toBeUndefined();
    expect(selection?.selectableOptions).toBeUndefined();
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, branch.activeEffect!.id, null))
        .success
    ).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, branch.activeEffect!.id, 'target'))
        .success
    ).toBe(true);
    const done = session.state!;
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['energy-top']);
    expect(done.players[0].energyDeck.cardIds).toEqual(['energy-next']);
    expect(done.players[0].energyZone.cardIds).toEqual([]);
    expect(energyPlacementEvents(done)).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });
  it.each([TOP, ENERGY])(
    'does not substitute the other branch when the selected %s branch has no target',
    (id) => {
      const options = id === TOP ? { waiting: [] } : { noMember: true };
      const done = selectBranch(start(setup(options)), id);
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(done.players[0].mainDeck.cardIds).toEqual(['deck']);
      expect(done.players[0].energyDeck.cardIds).toEqual(['energy-top', 'energy-next']);
      expect(moveEvents(done)).toEqual([]);
      expect(energyPlacementEvents(done)).toEqual([]);
    }
  );
  it('keeps the selected energy branch with an empty deck and resolves an actual zero placement', () => {
    const done = choose(selectBranch(start(setup({ energy: false })), ENERGY), 'target');
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(done.actionHistory.at(-1)?.payload.placedEnergyCardIds).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });
  it('resolves an already-triggered independent source after leaving LIVE before or during the branch', () => {
    let game = enqueue(setup());
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      liveZone: { ...p.liveZone, cardIds: [], cardStates: new Map() },
      waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, 'song'] },
    }));
    const started = resolvePendingCardEffects(game).gameState;
    expect(started.activeEffect?.abilityId).toBe(ABILITY);
    const branch = selectBranch(started, ENERGY);
    const done = choose(branch, 'target');
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(['energy-top']);
    expect(done.players[0].waitingRoom.cardIds).toContain('song');
  });
  it.each(['left', 'reentered'])(
    'does not move a waiting card that has %s during public display',
    (kind) => {
      let game = choose(selectBranch(start(), TOP), 'waiting-live');
      if (kind === 'left')
        game = updatePlayer(game, P1, (p) => ({
          ...p,
          waitingRoom: {
            ...p.waitingRoom,
            cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'waiting-live'),
          },
        }));
      else
        game = emitGameEvent(
          game,
          createEnterWaitingRoomEvent(['waiting-live'], ZoneType.HAND, P1, P1)
        );
      const done = choose(game);
      expect(done.players[0].mainDeck.cardIds).toEqual(['deck']);
      expect(moveEvents(done)).toEqual([]);
      expect(done.activeEffect).toBeNull();
    }
  );
  it('does not place energy under a member that left and reentered the stage after target selection began', () => {
    let game = selectBranch(start(), ENERGY);
    game = emitGameEvent(
      game,
      createLeaveStageEvent('target', SlotPosition.CENTER, ZoneType.HAND, P1, P1)
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent('target', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
    );
    const done = choose(game, 'target');
    expect(done.players[0].energyDeck.cardIds).toEqual(['energy-top', 'energy-next']);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });
  it('returns to the real ordered pending pool after a no-target branch and resolves the second mandatory choice', () => {
    const game = updatePlayer(setup({ waiting: [], noMember: true }), P1, (p) => ({
      ...p,
      liveZone: addCardToStatefulZone(p.liveZone, 'second-song', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));
    const order = resolvePendingCardEffects(enqueue(game, ['song', 'second-song'])).gameState;
    expect(order.activeEffect?.stepId).toBe('SELECT_NEXT_PENDING_ABILITY');
    let state = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    state = selectBranch(state, TOP);
    expect(state.activeEffect?.stepId).toBe('N_BP8_027_CHOOSE_LIVE_SUCCESS_EFFECT');
    state = selectBranch(state, ENERGY);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyDeck.cardIds).toEqual(['energy-top', 'energy-next']);
  });
});
