import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP8_001_ON_ENTER_STACK_ENERGY_SELF_AND_OTHER_NIJIGASAKI_ABILITY_ID as ENTER,
  N_BP8_001_LIVE_SUCCESS_RETURN_ONE_ENERGY_BELOW_DRAW_DISCARD_ABILITY_ID as SUCCESS,
  N_PR_026_LIVE_SUCCESS_DELEGATE_MEMBER_BELOW_LIVE_SUCCESS_ABILITIES_ABILITY_ID as RINA_SUCCESS,
  PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID as SHIZUKU_ENTER,
} from '../../src/application/card-effects/ability-ids';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addEnergyBelowMember,
  addMemberBelowMember,
  placeCardInSlot,
  removeMemberBelowMember,
} from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createLiveSuccessEvent,
  type EnterStageEvent,
} from '../../src/domain/events/game-events';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import november01DraftRows from '../fixtures/november-01-draft-effects.json';

const P1 = 'player1';
const P2 = 'player2';
const RINA = 'rina';
const SHIZUKU = 'shizuku';
const TARGET = 'target';
const ACTIVE = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
const MEMBER_STEP = 'N_BP8_001_SELECT_MEMBER_WITH_ENERGY_BELOW';
const ENERGY_STEP = 'N_BP8_001_SELECT_ONE_ENERGY_BELOW';
const DISCARD_STEP = 'N_BP8_001_DISCARD_AFTER_RETURN_ENERGY';

function member(id: string, cardCode = id, cost = 2, group = '虹ヶ咲'): CardInstance {
  const data: MemberCardData = {
    cardCode,
    name: id,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
    groupNames: [group],
  };
  return createCardInstance(data, P1, id);
}

function ayumu(id: string): CardInstance {
  const row = november01DraftRows['PL!N-bp8-001-SEC'];
  const data: MemberCardData = {
    cardCode: row.cardCode,
    name: row.nameCn,
    nameCn: row.nameCn,
    nameJp: row.nameJp,
    cardType: CardType.MEMBER,
    cost: row.cost,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
    groupNames: ['虹ヶ咲'],
    cardText: row.cardTextCn,
    cardTextCn: row.cardTextCn,
    cardTextJp: row.cardTextJp,
  };
  return createCardInstance(data, P1, id);
}

function energy(id: string): CardInstance {
  return createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, P1, id);
}

function baseGame(cards: readonly CardInstance[]): GameState {
  const deck = Array.from({ length: 4 }, (_, i) => member(`deck-${i}`));
  const hand = member('hand');
  const liveData: LiveCardData = {
    cardCode: 'test-live',
    name: 'test-live',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({}),
  };
  const live = createCardInstance(liveData, P1, 'live');
  let game = registerCards(
    {
      ...createGameState('n-bp8-001-delegation', P1, 'P1', P2, 'P2'),
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
      waitingPlayerId: null,
    },
    [...cards, ...deck, hand, live]
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    hand: { ...player.hand, cardIds: [hand.instanceId] },
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, ACTIVE),
  }));
  return game;
}

function setupRina(ayumuCount = 1, energyCount = 1): GameState {
  const source = member(RINA, 'PL!N-PR-026-PR', 15);
  const target = member(TARGET, 'test-aqours-target', 3, 'Aqours');
  const below = Array.from({ length: ayumuCount }, (_, i) => ayumu(`ayumu-${i}`));
  const energies = Array.from({ length: energyCount }, (_, i) => energy(`below-${i}`));
  return updatePlayer(baseGame([source, target, ...below, ...energies]), P1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, RINA, ACTIVE);
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, TARGET, ACTIVE);
    for (const card of below) {
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, card.instanceId);
    }
    for (const card of energies) {
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.LEFT, card.instanceId);
    }
    return { ...player, memberSlots };
  });
}

function choose(game: GameState, cardId?: string | null, optionId?: string): GameState {
  const session = createGameSession();
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  const result = session.executeCommand(
    createConfirmEffectStepCommand(P1, game.activeEffect!.id, cardId, null, false, optionId)
  );
  expect(result.success, result.error).toBe(true);
  return session.state!;
}

function delegateRina(game: GameState): GameState {
  const event = createLiveSuccessEvent(P1, ['live'], 1);
  const queued = enqueueTriggeredCardEffects(emitGameEvent(game, event), [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
  expect(queued.pendingAbilities.map((ability) => ability.abilityId)).toEqual([RINA_SUCCESS]);
  const confirmation = resolvePendingCardEffects(queued).gameState;
  expect(confirmation.activeEffect).toMatchObject({
    abilityId: RINA_SUCCESS,
    sourceCardId: RINA,
    metadata: { confirmOnlyPendingAbility: true },
  });
  return choose(confirmation);
}

function returnAndDiscard(game: GameState, energyId: string, drawnId: string): GameState {
  const pendingId = game.activeEffect!.id;
  const remainingPending = game.pendingAbilities.map((ability) => ability.id);
  expect(game.activeEffect).toMatchObject({
    abilityId: SUCCESS,
    sourceCardId: RINA,
    stepId: MEMBER_STEP,
  });
  const selected = choose(game, TARGET);
  expect(selected.activeEffect).toMatchObject({
    id: pendingId,
    abilityId: SUCCESS,
    sourceCardId: RINA,
    stepId: ENERGY_STEP,
  });
  const discard = choose(selected, energyId);
  expect(discard.activeEffect).toMatchObject({
    id: pendingId,
    abilityId: SUCCESS,
    sourceCardId: RINA,
    stepId: DISCARD_STEP,
  });
  expect(discard.pendingAbilities.map((ability) => ability.id)).toEqual(remainingPending);
  expect(discard.players[0].energyZone.cardStates.get(energyId)).toEqual({
    orientation: OrientationState.WAITING,
    face: FaceState.FACE_UP,
  });
  expect(discard.players[0].mainDeck.cardIds).toEqual(game.players[0].mainDeck.cardIds.slice(1));
  expect(discard.players[0].hand.cardIds).toContain(drawnId);
  const done = choose(discard, drawnId);
  expect(done.players[0].waitingRoom.cardIds).toContain(drawnId);
  expect(done.players[0].hand.cardIds).not.toContain(drawnId);
  return done;
}

function energyPlacedEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event) => event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT);
}

describe('费用2「上原步梦」真实能力委托', () => {
  it('lets 费用15「天王寺璃奈」 return one selected energy as the actual source, then draw and discard', () => {
    const delegated = delegateRina(setupRina(1, 2));
    const done = returnAndDiscard(delegated, 'below-1', 'deck-0');
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual(['below-0']);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual(['ayumu-0']);
    expect(done.players[0].energyZone.cardIds).toEqual(['below-1']);
    expect(done.players[0].hand.cardIds).toEqual(['hand']);
    expect(energyPlacedEvents(done)).toEqual([
      expect.objectContaining({
        placedEnergyCardIds: ['below-1'],
        orientation: OrientationState.WAITING,
        cause: expect.objectContaining({ sourceCardId: RINA, abilityId: SUCCESS }),
      }),
    ]);
    expect(
      done.actionHistory.filter((action) => action.payload.step === 'RETURN_ONE_ENERGY_BELOW')
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ sourceCardId: RINA, movedEnergyCardIds: ['below-1'] }),
      }),
    ]);
  });

  it.each([false, true])(
    'resolves two independent delegated instances fully when lower Ayumu cards are removed=%s',
    (removeLowerCards) => {
      let delegated = delegateRina(setupRina(2, 2));
      expect(delegated.activeEffect?.stepId).toBe('SELECT_NEXT_PENDING_ABILITY');
      const pending = delegated.pendingAbilities;
      expect(pending).toHaveLength(2);
      expect(new Set(pending.map((ability) => ability.id)).size).toBe(2);
      expect(pending.map((ability) => ability.metadata?.grantedFromMemberBelowCardId)).toEqual([
        'ayumu-0',
        'ayumu-1',
      ]);
      for (const ability of pending) {
        expect(ability).toMatchObject({
          abilityId: SUCCESS,
          sourceCardId: RINA,
          controllerId: P1,
          timingId: TriggerCondition.ON_LIVE_SUCCESS,
        });
      }
      if (removeLowerCards) {
        delegated = updatePlayer(delegated, P1, (player) => ({
          ...player,
          memberSlots: removeMemberBelowMember(
            removeMemberBelowMember(player.memberSlots, SlotPosition.CENTER, 'ayumu-0'),
            SlotPosition.CENTER,
            'ayumu-1'
          ),
          waitingRoom: {
            ...player.waitingRoom,
            cardIds: [...player.waitingRoom.cardIds, 'ayumu-0', 'ayumu-1'],
          },
        }));
        expect(delegated.pendingAbilities).toEqual(pending);
        expect(delegated.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([]);
      }
      const secondFirst = choose(delegated, undefined, pending[1].id);
      expect(secondFirst.activeEffect?.id).toBe(pending[1].id);
      const secondDone = returnAndDiscard(secondFirst, 'below-0', 'deck-0');
      expect(secondDone.activeEffect).toMatchObject({
        id: pending[0].id,
        abilityId: SUCCESS,
        sourceCardId: RINA,
        stepId: MEMBER_STEP,
      });
      const done = returnAndDiscard(secondDone, 'below-1', 'deck-1');
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
      expect(done.players[0].energyZone.cardIds).toEqual(['below-0', 'below-1']);
      expect(done.players[0].hand.cardIds).toEqual(['hand']);
      expect(energyPlacedEvents(done)).toHaveLength(2);
      expect(
        done.actionHistory
          .filter((action) => action.payload.step === 'RETURN_ONE_ENERGY_BELOW')
          .map((action) => action.payload.pendingAbilityId)
      ).toEqual([pending[1].id, pending[0].id]);
    }
  );

  it('confirms a delegated no-target effect without moving energy or drawing', () => {
    const delegated = delegateRina(setupRina(1, 0));
    expect(delegated.activeEffect).toMatchObject({
      abilityId: SUCCESS,
      sourceCardId: RINA,
      metadata: { confirmOnlyPendingAbility: true },
    });
    const done = choose(delegated);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].mainDeck.cardIds).toEqual(delegated.players[0].mainDeck.cardIds);
    expect(done.players[0].hand.cardIds).toEqual(['hand']);
    expect(done.players[0].energyZone.cardIds).toEqual([]);
    expect(energyPlacedEvents(done)).toEqual([]);
    expect(
      done.actionHistory.some((action) => action.payload.step === 'NO_ENERGY_BELOW_TARGET')
    ).toBe(true);
  });

  it.each([MEMBER_STEP, ENERGY_STEP])(
    'legally declines delegated success at %s without drawing',
    (step) => {
      let delegated = delegateRina(setupRina(1, 2));
      if (step === ENERGY_STEP) delegated = choose(delegated, TARGET);
      expect(delegated.activeEffect).toMatchObject({
        stepId: step,
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      const done = choose(delegated);
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([
        'below-0',
        'below-1',
      ]);
      expect(done.players[0].energyZone.cardIds).toEqual([]);
      expect(done.players[0].mainDeck.cardIds).toEqual(delegated.players[0].mainDeck.cardIds);
      expect(done.players[0].hand.cardIds).toEqual(['hand']);
      expect(energyPlacedEvents(done)).toEqual([]);
    }
  );

  it.each([false, true])(
    'lets 费用9「樱坂雫」 delegate waiting-room Ayumu with other placement=%s',
    (placeOther) => {
      const source = member(SHIZUKU, 'PL!N-bp3-003-R', 9);
      const waiting = ayumu('waiting-ayumu');
      const target = member(TARGET);
      const energies = [energy('zone-0'), energy('zone-1')];
      let game = updatePlayer(baseGame([source, waiting, target, ...energies]), P1, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SHIZUKU, ACTIVE),
          SlotPosition.LEFT,
          TARGET,
          ACTIVE
        ),
        waitingRoom: { ...player.waitingRoom, cardIds: [waiting.instanceId] },
        energyZone: addCardToStatefulZone(
          addCardToStatefulZone(player.energyZone, 'zone-0', ACTIVE),
          'zone-1',
          { ...ACTIVE, orientation: OrientationState.WAITING }
        ),
      }));
      const enter = createEnterStageEvent(SHIZUKU, ZoneType.HAND, SlotPosition.CENTER, P1, P1);
      game = resolvePendingCardEffects(
        enqueueTriggeredCardEffects(emitGameEvent(game, enter), [TriggerCondition.ON_ENTER_STAGE])
      ).gameState;
      expect(game.activeEffect).toMatchObject({
        abilityId: SHIZUKU_ENTER,
        sourceCardId: SHIZUKU,
        selectableCardIds: [waiting.instanceId],
      });
      const delegated = choose(game, waiting.instanceId);
      expect(delegated.activeEffect).toMatchObject({
        abilityId: ENTER,
        sourceCardId: waiting.instanceId,
        stepId: 'N_BP8_001_CHOOSE_ENERGY_ALLOCATION',
      });
      expect(delegated.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
        'OTHER_ONLY',
      ]);
      expect(delegated.players[0].waitingRoom.cardIds).toContain(waiting.instanceId);
      let done = choose(delegated, null, placeOther ? 'OTHER_ONLY' : undefined);
      if (placeOther) {
        expect(done.activeEffect?.stepId).toBe('N_BP8_001_SELECT_OTHER_NIJIGASAKI');
        expect(done.activeEffect?.selectableCardIds).not.toContain(waiting.instanceId);
        done = choose(done, TARGET);
      }
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(done.players[0].waitingRoom.cardIds).toContain(waiting.instanceId);
      expect(Object.values(done.players[0].memberSlots.slots)).not.toContain(waiting.instanceId);
      expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual(
        placeOther ? ['zone-1'] : []
      );
      expect(done.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([]);
      expect(done.players[0].energyZone.cardIds).toHaveLength(placeOther ? 1 : 2);
      expect(
        done.eventLog.filter(
          (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER
        )
      ).toHaveLength(placeOther ? 1 : 0);
      expect(
        done.eventLog
          .map((entry) => entry.event)
          .filter(
            (event): event is EnterStageEvent => event.eventType === TriggerCondition.ON_ENTER_STAGE
          )
          .map((event) => event.cardInstanceId)
      ).toEqual([SHIZUKU]);
    }
  );
});
