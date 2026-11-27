import { describe, expect, it } from 'vitest';
import {
  ABILITY_ORDER_SELECTION_ID,
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_018_AUTO_REVEALED_CHEER_MOVED_SOURCE_SCORE_ABILITY_ID as HOLIDAY_ABILITY,
  S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID as KANAN_ABILITY,
  S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID as YOU_ABILITY,
  S_PB2_007_LIVE_SUCCESS_PLAY_CHEER_MEMBER_ABILITY_ID as CHEER_ABILITY,
  S_PB2_016_ON_ENTER_AZALEA_GREEN_PLACE_ENERGY_ABILITY_ID as ENERGY_ABILITY,
  SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID as REN_ABILITY,
} from '../../src/application/card-effects/ability-ids';
import { playMemberFromZoneToEmptySlot } from '../../src/application/card-effects/runtime/play-member-to-stage';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createConfirmJudgmentAction } from '../../src/application/actions';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
  type MemberCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createLiveSuccessEvent,
  createTurnEndEvent,
  type EnterStageEvent,
} from '../../src/domain/events/game-events';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  addHeartLiveModifierForTargetMember,
  addLiveModifier,
  getLiveCardScoreModifier,
  getMemberEffectiveHeartIcons,
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
import { selectCurrentLiveRevealedCheerCardIds } from '../../src/application/effects/cheer-selection';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getNovember06LiveData } from '../helpers/november-06-draft-effects';
import { getNovember20MemberData } from '../helpers/november-20-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const CHEER_BASE = 'PL!S-pb2-007';
const ENERGY_BASE = 'PL!S-pb2-016';
const CHEER_TEXT =
  '【LIVE成功时】因声援被公开的自己的卡片全部为『Aqours』的场合，可以将其中的１张费用小于等于２的成员卡，登场至不存在成员的区域。';
const ENERGY_TEXT =
  '【登场】存在于自己的舞台的『AZALEA』的成员持有的[緑ハート]合计大于等于5个的场合，从自己的能量卡组，将１张能量卡以待机状态放置入能量区。';
const CARD_STEP = 'S_PB2_007_SELECT_REVEALED_CHEER_MEMBER';
const SLOT_STEP = 'S_PB2_007_SELECT_EMPTY_STAGE_SLOT';
const CHEER_MOVEMENT = TriggerCondition.ON_REVEALED_CHEER_CARDS_MOVED;
const ENERGY_PLACEMENT = TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT;

function print(code: string, id: string): CardInstance {
  return createCardInstance(getNovember20MemberData(code), P1, id);
}

function member(
  id: string,
  {
    cost = 2,
    group = 'Aqours',
    unit,
    hearts = [],
  }: {
    cost?: number;
    group?: string;
    unit?: string;
    hearts?: readonly ReturnType<typeof createHeartIcon>[];
  } = {},
  owner = P1
) {
  const data: MemberCardData = {
    cardCode: `TEST-${id}`,
    name: id,
    cardType: CardType.MEMBER,
    groupNames: [group],
    unitName: unit,
    cost,
    blade: 0,
    hearts,
  };
  return createCardInstance(data, owner, id);
}

function live(id: string, group = 'Aqours', owner = P1) {
  const data: LiveCardData = {
    cardCode: `TEST-${id}`,
    name: id,
    cardType: CardType.LIVE,
    groupNames: [group],
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
  return createCardInstance(data, owner, id);
}

function energy(id: string) {
  return createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, P1, id);
}

function putOnStage(
  game: GameState,
  card: CardInstance,
  slot: SlotPosition,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, card.ownerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, card.instanceId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setupCheer(
  ownDeck: readonly CardInstance[],
  { holiday = false, waiting = false }: { holiday?: boolean; waiting?: boolean } = {}
) {
  const source = print(CHEER_BASE, 'cheer-hanamaru');
  const song = holiday
    ? createCardInstance(getNovember06LiveData('PL!HS-bp8-018'), P1, 'holiday')
    : live('performed-live');
  const support = member('blue-support', {
    hearts: [createHeartIcon(HeartColor.BLUE, 3), createHeartIcon(HeartColor.GREEN, 1)],
  });
  const opponent = member('opponent-cheer', { group: 'Liella!' }, P2);
  let game = registerCards(createGameState('s-pb2-007', P1, 'P1', P2, 'P2'), [
    source,
    song,
    support,
    opponent,
    ...ownDeck,
  ]);
  game = putOnStage(
    game,
    source,
    SlotPosition.CENTER,
    waiting ? OrientationState.WAITING : OrientationState.ACTIVE
  );
  if (holiday) game = putOnStage(game, support, SlotPosition.LEFT);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ownDeck.map((card) => card.instanceId) },
    liveZone: addCardToStatefulZone(player.liveZone, song.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [opponent.instanceId] },
  }));
  return { game, source, song, support };
}

function queueSuccess(game: GameState, liveCardId: string) {
  const event = createLiveSuccessEvent(P1, [liveCardId], 1);
  const state = emitGameEvent(
    {
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map([[liveCardId, true]]),
      },
    },
    event
  );
  return enqueueTriggeredCardEffects(state, [TriggerCondition.ON_LIVE_SUCCESS], {
    liveSuccessEvents: [event],
  });
}

function confirm(game: GameState, cardId?: string | null, slot?: SlotPosition) {
  expect(game.activeEffect).not.toBeNull();
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId, slot);
}

function events(game: GameState) {
  return game.eventLog.map(({ event }) => event);
}

describe('PL!S-pb2-007 费用13「国木田花丸」', () => {
  it.each(['PL!S-pb2-007-PP', 'PL!S-pb2-007-UNSEEN'])(
    'registers %s with exact Chinese text',
    (code) => {
      expect(getCardAbilityDefinitionsForCardCode(code)).toContainEqual(
        expect.objectContaining({
          abilityId: CHEER_ABILITY,
          baseCardCodes: [CHEER_BASE],
          triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
          effectText: CHEER_TEXT,
        })
      );
    }
  );

  it('after a real successful LIVE, displays and stages Kanan, then lets the new ON_ENTER and Holiday choose order', () => {
    const kanan = print('PL!S-bp6-012-N', 'kanan');
    const ownLive = live('own-cheer-live');
    const expensive = member('expensive', { cost: 3 });
    const millCards = Array.from({ length: 5 }, (_, i) => member(`mill-${i}`));
    const { game, source, song } = setupCheer([kanan, ownLive, expensive, ...millCards], {
      holiday: true,
    });
    const revealed = revealCheerCardsFromMainDeck(game, P1, 3).gameState;
    const service = new GameService();
    const judgment = service.processAction(
      {
        ...revealed,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        currentTurnType: TurnType.FIRST_PLAYER_TURN,
      },
      createConfirmJudgmentAction(P1, new Map())
    );
    expect(judgment.success, judgment.error).toBe(true);
    const result = service.advancePhase(judgment.gameState);
    expect(result.success, result.error).toBe(true);
    const selecting = result.gameState;
    expect(selecting.liveResolution.liveResults.get(song.instanceId)).toBe(true);
    expect(selecting.activeEffect).toMatchObject({
      abilityId: CHEER_ABILITY,
      stepId: CARD_STEP,
      selectableCardIds: [kanan.instanceId],
      effectText: CHEER_TEXT,
      canSkipSelection: true,
      skipSelectionLabel: '不登场',
    });
    expect(confirm(selecting, ownLive.instanceId).resolutionZone).toEqual(selecting.resolutionZone);
    expect(confirm(selecting, kanan.instanceId, SlotPosition.RIGHT)).toBe(selecting);
    let now = 10_000;
    const session = createGameSession({ now: () => now });
    session.restoreRuntimeState({ authorityState: selecting, currentPublicSeq: 0 });
    const effectId = selecting.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effectId, kanan.instanceId)).success
    ).toBe(true);
    const displaying = session.state!;
    expect(displaying.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [kanan.instanceId],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(displaying.resolutionZone.cardIds).toContain(kanan.instanceId);
    expect(displaying.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBeNull();

    const advance = createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000);
    expect(session.executeCommand(advance).success).toBe(false);
    now = 12_000;
    expect(session.executeCommand(advance).success).toBe(true);
    expect(session.executeCommand(advance).success).toBe(false);
    const ordered = session.state!;
    expect(ordered.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(kanan.instanceId);
    expect(ordered.players[0].memberSlots.cardStates.get(kanan.instanceId)).toEqual({
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    expect(ordered.resolutionZone.cardIds).not.toContain(kanan.instanceId);
    expect(ordered.resolutionZone.revealedCardIds).not.toContain(kanan.instanceId);
    expect(selectCurrentLiveRevealedCheerCardIds(ordered, P1)).toContain(kanan.instanceId);
    expect(ordered.players[0].movedToStageThisTurn).toContain(kanan.instanceId);
    const entry = events(ordered).filter(
      (event): event is EnterStageEvent => event.eventType === TriggerCondition.ON_ENTER_STAGE
    );
    const movements = events(ordered).filter((event) => event.eventType === CHEER_MOVEMENT);
    expect(entry).toMatchObject([
      {
        cardInstanceId: kanan.instanceId,
        fromZone: ZoneType.RESOLUTION_ZONE,
        toZone: ZoneType.MEMBER_SLOT,
        toSlot: SlotPosition.RIGHT,
        ownerId: P1,
        controllerId: P1,
      },
    ]);
    expect(entry[0]?.relayReplacements).toBeUndefined();
    expect(movements).toMatchObject([
      {
        destination: 'MEMBER_SLOT',
        fromZone: ZoneType.RESOLUTION_ZONE,
        toZone: ZoneType.MEMBER_SLOT,
        movedCardIds: [kanan.instanceId],
        cause: { sourceCardId: source.instanceId, playerId: P1, abilityId: CHEER_ABILITY },
      },
    ]);
    expect(ordered.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(ordered.pendingAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ abilityId: KANAN_ABILITY, eventIds: [entry[0]?.eventId] }),
        expect.objectContaining({ abilityId: HOLIDAY_ABILITY, eventIds: [movements[0]?.eventId] }),
      ])
    );
    expect(
      ordered.pendingAbilities.filter((ability) => ability.abilityId === CHEER_ABILITY)
    ).toEqual([]);
    const holiday = ordered.pendingAbilities.find((item) => item.abilityId === HOLIDAY_ABILITY)!;
    const holidayConfirmation = confirmActiveEffectStep(
      ordered,
      P1,
      ordered.activeEffect!.id,
      undefined,
      undefined,
      false,
      holiday.id
    );
    const scored = confirm(holidayConfirmation);
    expect(getLiveCardScoreModifier(scored.liveResolution, song.instanceId)).toBe(1);
  });

  it.each(['Aqours', 'Liella!'])(
    'uses moved %s LIVE cards for the history condition, only offers still public members',
    (group) => {
      const movedLive = live('moved-live', group);
      const movedMember = member('moved-member');
      const remaining = member('remaining');
      const { game, song } = setupCheer([movedLive, movedMember, remaining], { waiting: true });
      let state = revealCheerCardsFromMainDeck(game, P2, 1).gameState;
      state = revealCheerCardsFromMainDeck(state, P1, 1).gameState;
      state = revealCheerCardsFromMainDeck(state, P1, 2, { additional: true }).gameState;
      const movedIds = [movedLive.instanceId, movedMember.instanceId];
      state = updatePlayer(
        {
          ...state,
          resolutionZone: {
            ...state.resolutionZone,
            cardIds: state.resolutionZone.cardIds.filter((id) => !movedIds.includes(id)),
            revealedCardIds: state.resolutionZone.revealedCardIds.filter(
              (id) => !movedIds.includes(id)
            ),
          },
        },
        P1,
        (player) => ({
          ...player,
          hand: { ...player.hand, cardIds: movedIds },
        })
      );
      const selecting = resolvePendingCardEffects(queueSuccess(state, song.instanceId)).gameState;
      if (group !== 'Aqours') {
        expect(selecting.activeEffect).toBeNull();
        expect(selecting.pendingAbilities).toEqual([]);
        return;
      }
      expect(selecting.activeEffect?.selectableCardIds).toEqual([remaining.instanceId]);
      const skipped = confirm(selecting, null);
      expect(skipped.activeEffect).toBeNull();
      expect(skipped.resolutionZone.cardIds).toEqual(state.resolutionZone.cardIds);
    }
  );

  it('keeps the original pending ability after its source leaves and isolates replaced cheer history', () => {
    const removed = live('redo-non-aqours', 'Liella!');
    const playable = member('redo-aqours');
    const { game, song, source } = setupCheer([removed, playable]);
    const original = revealCheerCardsFromMainDeck(game, P1, 1).gameState;
    const rebuilt = revealCheerCardsFromMainDeck(original, P1, 1, {
      replaceCurrentCheerCards: true,
    }).gameState;
    const pending = queueSuccess(rebuilt, song.instanceId);
    const sourceLeft = updatePlayer(pending, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: { ...player.waitingRoom, cardIds: [source.instanceId] },
    }));
    const opponentLive = live('opponent-success', 'Liella!', P2);
    const withOpponentResult = emitGameEvent(
      registerCards(sourceLeft, [opponentLive]),
      createLiveSuccessEvent(P2, [opponentLive.instanceId], 1)
    );
    const selecting = resolvePendingCardEffects(withOpponentResult).gameState;
    expect(selecting.activeEffect?.selectableCardIds).toEqual([playable.instanceId]);
    const choosing = confirm(confirm(selecting, playable.instanceId));
    expect(choosing.activeEffect?.stepId).toBe(SLOT_STEP);
    const staged = confirm(choosing, undefined, SlotPosition.CENTER);
    expect(staged.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(playable.instanceId);
  });

  it('revalidates slots and movable targets, including during a pending public display', () => {
    const selected = member('selected');
    const backup = member('backup');
    const { game, song, support } = setupCheer([selected, backup]);
    const revealed = revealCheerCardsFromMainDeck(game, P1, 2).gameState;
    const filler = member('filler');
    const filling = putOnStage(
      putOnStage(registerCards(revealed, [filler]), support, SlotPosition.LEFT),
      filler,
      SlotPosition.RIGHT
    );
    const full = resolvePendingCardEffects(queueSuccess(filling, song.instanceId)).gameState;
    expect(full.activeEffect).toBeNull();
    expect(events(full).some((event) => event.eventType === CHEER_MOVEMENT)).toBe(false);

    const choosing = resolvePendingCardEffects(queueSuccess(revealed, song.instanceId)).gameState;
    const displaying = confirm(choosing, selected.instanceId);
    const changed = {
      ...displaying,
      resolutionZone: { ...displaying.resolutionZone, revealedCardIds: [backup.instanceId] },
    };
    const reselecting = confirm(changed);
    expect(reselecting.activeEffect).toMatchObject({
      stepId: CARD_STEP,
      selectableCardIds: [backup.instanceId],
    });
    const choosingSlot = confirm(confirm(reselecting, backup.instanceId));
    expect(choosingSlot.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    const nowOccupied = putOnStage(choosingSlot, support, SlotPosition.LEFT);
    const refreshed = confirm(nowOccupied, undefined, SlotPosition.LEFT);
    expect(refreshed.activeEffect?.selectableSlots).toEqual([SlotPosition.RIGHT]);
    expect(refreshed.resolutionZone.cardIds).toContain(backup.instanceId);
    const staged = confirm(refreshed, undefined, SlotPosition.RIGHT);
    expect(staged.players[0].memberSlots.slots).toMatchObject({
      [SlotPosition.LEFT]: support.instanceId,
      [SlotPosition.RIGHT]: backup.instanceId,
    });
    expect(events(staged).filter((event) => event.eventType === CHEER_MOVEMENT)).toHaveLength(1);
  });

  it.each(['new own result', 'turn end'])(
    'does not reuse a previous LIVE success after %s',
    (boundary) => {
      const playable = member('late-cheer');
      const { game, song } = setupCheer([playable]);
      const old = queueSuccess(
        revealCheerCardsFromMainDeck(game, P1, 1).gameState,
        song.instanceId
      );
      const newer = emitGameEvent(
        old,
        boundary === 'new own result'
          ? createLiveSuccessEvent(P1, [song.instanceId], 1)
          : createTurnEndEvent(old.turnCount, P1)
      );
      const done = resolvePendingCardEffects(newer).gameState;
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(done.resolutionZone.cardIds).toContain(playable.instanceId);
    }
  );
});

function setupEnergy({
  greens = 2,
  unit = '「AZALEA」',
  deckSize = 2,
}: {
  greens?: number;
  unit?: string;
  deckSize?: number;
} = {}) {
  const source = print(ENERGY_BASE, 'energy-hanamaru');
  const support = member('azalea-support', {
    unit,
    hearts: [createHeartIcon(HeartColor.GREEN, greens)],
  });
  const opponent = member(
    'opponent-azalea',
    {
      unit: 'AZALEA',
      hearts: [createHeartIcon(HeartColor.GREEN, 5)],
    },
    P2
  );
  const below = member('below', { unit: 'AZALEA', hearts: [createHeartIcon(HeartColor.GREEN, 5)] });
  const rainbow = member('rainbow', {
    unit: 'AZALEA',
    hearts: [createHeartIcon(HeartColor.RAINBOW, 5)],
  });
  const deck = Array.from({ length: deckSize }, (_, index) => energy(`energy-${index}`));
  let game = registerCards(createGameState('s-pb2-016', P1, 'P1', P2, 'P2'), [
    source,
    support,
    opponent,
    below,
    rainbow,
    ...deck,
  ]);
  game = putOnStage(game, support, SlotPosition.LEFT, OrientationState.WAITING);
  game = putOnStage(game, rainbow, SlotPosition.RIGHT);
  game = putOnStage(game, opponent, SlotPosition.CENTER);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
    memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.LEFT, below.instanceId),
    energyDeck: { ...player.energyDeck, cardIds: deck.map((card) => card.instanceId) },
  }));
  return { game, source, support, deck };
}

function queueEnter(game: GameState, source: CardInstance) {
  const played = playMemberFromZoneToEmptySlot(game, P1, {
    cardId: source.instanceId,
    sourceZone: ZoneType.HAND,
    toSlot: SlotPosition.CENTER,
  });
  expect(played).not.toBeNull();
  return enqueueTriggeredCardEffects(played!.gameState, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: [played!.enterStageEvent],
  });
}

describe('PL!S-pb2-016 费用5「国木田花丸」', () => {
  it.each(['PL!S-pb2-016-P+', 'PL!S-pb2-016-UNSEEN'])(
    'registers %s with exact Chinese text',
    (code) => {
      expect(getCardAbilityDefinitionsForCardCode(code)).toContainEqual(
        expect.objectContaining({
          abilityId: ENERGY_ABILITY,
          baseCardCodes: [ENERGY_BASE],
          triggerCondition: TriggerCondition.ON_ENTER_STAGE,
          effectText: ENERGY_TEXT,
        })
      );
    }
  );

  it.each([
    { greens: 2, unit: '「AZALEA」', deckSize: 2, places: true },
    { greens: 1, unit: '「AZALEA」', deckSize: 2, places: false },
    { greens: 5, unit: 'Guilty Kiss', deckSize: 2, places: false },
    { greens: 2, unit: '「AZALEA」', deckSize: 0, places: false },
  ])(
    'counts own top-level AZALEA Hearts with $greens green support in $unit and deck size $deckSize',
    (test) => {
      const { game, source, deck } = setupEnergy(test);
      const pending = queueEnter(game, source);
      expect(pending.pendingAbilities).toMatchObject([
        {
          sourceCardId: source.instanceId,
          abilityId: ENERGY_ABILITY,
          timingId: TriggerCondition.ON_ENTER_STAGE,
        },
      ]);
      const done = resolvePendingCardEffects(pending).gameState;
      expect(done.activeEffect).toBeNull();
      expect(done.pendingAbilities).toEqual([]);
      expect(done.players[0].energyDeck.cardIds).toEqual(
        deck.slice(test.places ? 1 : 0).map((card) => card.instanceId)
      );
      expect(done.players[0].energyZone.cardIds).toEqual(test.places ? ['energy-0'] : []);
      const placed = events(done).filter((event) => event.eventType === ENERGY_PLACEMENT);
      if (test.places) {
        expect(done.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
          OrientationState.WAITING
        );
        expect(placed).toMatchObject([
          {
            targetPlayerId: P1,
            placedEnergyCardIds: ['energy-0'],
            orientation: OrientationState.WAITING,
            cause: { sourceCardId: source.instanceId, abilityId: ENERGY_ABILITY },
          },
        ]);
      } else {
        expect(placed).toEqual([]);
      }
    }
  );

  it('counts an effective Heart modifier added after the entry has already queued', () => {
    const { game, source, support } = setupEnergy({ greens: 1 });
    const pending = queueEnter(game, source);
    const boosted = addHeartLiveModifierForTargetMember(pending, {
      playerId: P1,
      targetMemberCardId: support.instanceId,
      sourceCardId: source.instanceId,
      abilityId: 'test:green-boost',
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
    })!.gameState;
    expect(resolvePendingCardEffects(boosted).gameState.players[0].energyZone.cardIds).toEqual([
      'energy-0',
    ]);
  });

  it('checks the current Heart colors after an original-color replacement', () => {
    const { game, source, support } = setupEnergy();
    const pending = queueEnter(game, source);
    const changed = addLiveModifier(pending, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: P1,
      memberCardId: support.instanceId,
      sourceCardId: source.instanceId,
      abilityId: 'test:change-support-color',
      color: HeartColor.BLUE,
    });
    const done = resolvePendingCardEffects(changed).gameState;
    expect(done.players[0].energyZone.cardIds).toEqual([]);
    expect(events(done).filter((event) => event.eventType === ENERGY_PLACEMENT)).toEqual([]);
  });

  it('resolves through real You delegation without forging entry, and delivers the energy event to Ren', () => {
    const you = print('PL!S-bp7-005-SEC', 'you');
    const source = print(ENERGY_BASE, 'energy-hanamaru');
    const ren = print('PL!SP-bp4-016-N', 'ren');
    const top = energy('top-energy');
    const discarded = [live('first-discard'), live('second-discard')];
    let game = registerCards(createGameState('s-pb2-016-delegated', P1, 'P1', P2, 'P2'), [
      you,
      source,
      ren,
      top,
      ...discarded,
    ]);
    game = putOnStage(game, you, SlotPosition.CENTER);
    game = putOnStage(game, source, SlotPosition.LEFT);
    game = putOnStage(game, ren, SlotPosition.RIGHT);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: discarded.map((card) => card.instanceId) },
      energyDeck: { ...player.energyDeck, cardIds: [top.instanceId] },
    }));
    game = addHeartLiveModifierForTargetMember(game, {
      playerId: P1,
      sourceCardId: source.instanceId,
      targetMemberCardId: source.instanceId,
      abilityId: 'test:green-boost',
      hearts: [createHeartIcon(HeartColor.GREEN, 2)],
    })!.gameState;
    const started = activateCardAbility(
      { ...game, currentPhase: GamePhase.MAIN_PHASE },
      P1,
      you.instanceId,
      YOU_ABILITY
    );
    const target = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      discarded.map((card) => card.instanceId)
    );
    const order = confirm(target, source.instanceId);
    expect(order.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'source-first',
      'target-first',
    ]);
    const resolved = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'target-first'
    );
    const done = resolved.activeEffect?.abilityId === REN_ABILITY ? confirm(resolved) : resolved;
    expect(done.delegatedAbilitySequence).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].energyZone.cardIds).toEqual([top.instanceId]);
    expect(
      events(done).filter((event) => event.eventType === TriggerCondition.ON_ENTER_STAGE)
    ).toEqual([]);
    const placed = events(done).filter((event) => event.eventType === ENERGY_PLACEMENT);
    expect(placed).toMatchObject([
      {
        cause: { sourceCardId: source.instanceId, abilityId: ENERGY_ABILITY },
        placedEnergyCardIds: [top.instanceId],
      },
    ]);
    expect(
      done.actionHistory.filter(
        ({ type, payload }) => type === 'TRIGGER_ABILITY' && payload.abilityId === REN_ABILITY
      )
    ).toHaveLength(1);
    expect(
      getMemberEffectiveHeartIcons(done, P1, ren.instanceId).filter(
        (heart) => heart.color === HeartColor.PURPLE
      )
    ).toHaveLength(2);
  });
});
