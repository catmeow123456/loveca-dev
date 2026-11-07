import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_009_ON_ENTER_OPTIONAL_RECOVER_LOW_COST_MEMBER_TO_DECK_TOP_ABILITY_ID as ABILITY,
  HS_BP8_004_ACTIVATED_DISCARD_LOW_COST_HASUNOSORA_GAIN_ON_ENTER_ABILITY_ID as GINKO,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
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
  getNovember07MemberData,
} from '../helpers/november-07-draft-effects';
import {
  choose,
  gameWithCards,
  live,
  member,
  P1,
  P2,
  sourceCardFixture,
} from '../helpers/card-effect-zone-fixture';

const TEXT = '【登场】可以将存在于自己的休息室的１张费用小于等于９的成员卡放置于卡组顶。';
function setup(
  options: { hand?: boolean; energies?: number; waiting?: readonly string[]; code?: string } = {}
): GameState {
  const source = createCardInstance(
    { ...getNovember07MemberData('PL!HS-bp8-009'), cardCode: options.code ?? 'PL!HS-bp8-009-N' },
    P1,
    'source'
  );
  const energies = Array.from({ length: options.energies ?? 4 }, (_, i) =>
    createCardInstance(
      { cardCode: `ENERGY-${i}`, name: '能量', cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  let game = gameWithCards([
    source,
    member('zero', { cost: 0 }),
    member('nine', { cost: 9, groupNames: ['Aqours'] }),
    member('ten', { cost: 10 }),
    live('live'),
    member('enemy', { cost: 1 }, P2),
    member('deck'),
    ...energies,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: { ...p.hand, cardIds: options.hand ? ['source'] : [] },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: options.waiting ?? ['zero', 'nine', 'ten', 'live', 'enemy'],
    },
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    memberSlots: options.hand
      ? p.memberSlots
      : placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'),
    energyZone: energies.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      p.energyZone
    ),
  }));
  return {
    ...game,
    manualOperationMode: 'RULES',
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}
function start(game = setup()): GameState {
  const event = createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P1, P1);
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_ENTER_STAGE])
  ).gameState;
}
function events(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}

describe('PL!HS-bp8-009 费用4 日野下花帆', () => {
  it.each(['N', 'P', 'SEC', 'UNSEEN'])(
    'covers every rarity and exact complete text: %s',
    (rare) => {
      const definitions = getCardAbilityDefinitionsForCardCode(`PL!HS-bp8-009-${rare}`);
      expect(definitions).toEqual([
        expect.objectContaining({
          abilityId: ABILITY,
          baseCardCodes: ['PL!HS-bp8-009'],
          effectText: TEXT,
          delegatedOnEnterFromWaitingRoomPolicy: {
            decision: 'ALLOW',
            reason: 'SOURCE_INDEPENDENT',
          },
        }),
      ]);
      expect(definitions[0]?.cardCodes).toBeUndefined();
      expect(start(setup({ code: `PL!HS-bp8-009-${rare}` })).activeEffect?.effectText).toBe(TEXT);
    }
  );
  it.each([3, 4])(
    'pays printed entrance cost4 in RULES with %i energy, without using it as the target cost',
    (count) => {
      const session = createGameSession({ cardEntrance: 'LOCAL' });
      session.createGame('kaho-rules', P1, 'P1', P2, 'P2');
      session.restoreRuntimeState({
        authorityState: setup({ hand: true, energies: count }),
        currentPublicSeq: 0,
      });
      const before = session.state!;
      const played = session.executeCommand(
        createPlayMemberToSlotCommand(P1, 'source', SlotPosition.CENTER, { relayMode: 'NONE' })
      );
      expect(played.success, played.error).toBe(count === 4);
      if (count === 3) {
        expect(session.state!.players).toEqual(before.players);
        return;
      }
      const entrance = session.state!.entranceRuntime?.pending;
      if (entrance)
        expect(
          session.executeCommand({
            type: GameCommandType.ACK_CARD_ENTRANCE,
            playerId: P1,
            entranceId: entrance.id,
            timestamp: Date.now(),
          }).success
        ).toBe(true);
      expect(
        [...session.state!.players[0].energyZone.cardStates.values()].filter(
          ({ orientation }) => orientation === OrientationState.WAITING
        )
      ).toHaveLength(4);
      expect(session.state!.activeEffect).toMatchObject({
        abilityId: ABILITY,
        selectableCardIds: ['zero', 'nine'],
        canSkipSelection: true,
        confirmSelectionLabel: '放置于卡组顶',
        skipSelectionLabel: '不发动',
      });
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, 'nine')
        ).success
      ).toBe(true);
      expect(session.state!.players[0].mainDeck.cardIds).toEqual(['deck']);
    }
  );
  it('reveals before moving, then emits one real movement event and continues once', () => {
    let now = 1000;
    const session = createGameSession({ now: () => now });
    session.createGame('kaho-reveal', P1, 'P1', P2, 'P2');
    session.restoreRuntimeState({ authorityState: start(), currentPublicSeq: 0 });
    const effectId = session.state!.activeEffect!.id;
    const selection = session.getPlayerViewState(P1)?.activeEffect;
    expect(selection).toMatchObject({
      selectableObjectMode: 'SINGLE',
      selectableObjectIds: ['obj_zero', 'obj_nine'],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(selection?.effectChoice).toBeUndefined();
    expect(selection?.selectableOptions).toBeUndefined();
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effectId, 'nine')).success
    ).toBe(true);
    const revealed = session.state!;
    const deadline = revealed.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    expect(revealed.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(revealed.players[0].waitingRoom.cardIds).toContain('nine');
    expect(events(revealed)).toEqual([]);
    for (const viewer of [P1, P2])
      expect(
        projectPlayerViewState(revealed, viewer).objects[createPublicObjectId('nine')].surface
      ).toBe('FRONT');
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, deadline))
        .success
    ).toBe(false);
    now = deadline;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, deadline))
        .success
    ).toBe(true);
    const done = session.state!;
    expect(done.players[0].mainDeck.cardIds).toEqual(['nine', 'deck']);
    expect(done.activeEffect).toBeNull();
    expect(events(done)).toHaveLength(1);
    expect(events(done)[0]).toMatchObject({
      movedCardIds: ['nine'],
      destination: { kind: 'TOP' },
      cause: { abilityId: ABILITY, sourceCardId: 'source' },
    });
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P1, effectId, deadline))
        .success
    ).toBe(false);
  });
  it('declines and rejects ineligible targets without moving cards', () => {
    const game = start();
    expect(game.activeEffect?.selectableCardIds).toEqual(['zero', 'nine']);
    for (const id of ['ten', 'live', 'enemy', 'missing']) expect(choose(game, id)).toBe(game);
    const session = createGameSession();
    session.createGame('kaho-decline', P1, 'P1', P2, 'P2');
    session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    expect(session.getPlayerViewState(P1)?.activeEffect?.skipSelectionLabel).toBe('不发动');
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, game.activeEffect!.id, null))
        .success
    ).toBe(true);
    const done = session.state!;
    expect(done.activeEffect).toBeNull();
    expect(events(done)).toEqual([]);
    expect(done.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(start(setup({ waiting: ['ten', 'live'] })).activeEffect).toBeNull();
  });
  it('keeps the triggered independent effect after source leaves and safely completes stale reveal', () => {
    const revealed = choose(start(), 'nine');
    const sourceLeft = updatePlayer(revealed, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
    }));
    expect(choose(sourceLeft).players[0].mainDeck.cardIds).toEqual(['nine', 'deck']);
    const stale = updatePlayer(revealed, P1, (p) => ({
      ...p,
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'nine'),
      },
    }));
    const done = choose(stale);
    expect(done.activeEffect).toBeNull();
    expect(events(done)).toEqual([]);
  });
  it('runs real Ginko discard and free ON_ENTER invocation, keeping host identity during public recovery', () => {
    const actor = createCardInstance(sourceCardFixture('PL!HS-bp8-004-SEC')!, P1, 'actor');
    let game = registerCards(setup(), [
      actor,
      createNovember07DraftCard('PL!HS-bp8-009', P1, 'template'),
    ]);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['template'] },
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'actor'),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('actor', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
    );
    const activated = activateCardAbility(game, P1, 'actor', GINKO);
    const delegated = confirmActiveEffectStep(
      activated,
      P1,
      activated.activeEffect!.id,
      'template'
    );
    expect(delegated.activeEffect).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: 'actor',
      onEnterInvocation: {
        definitionSourceCardCode: 'PL!HS-bp8-009-N',
        waiveActivationCosts: true,
      },
    });
    const revealed = choose(delegated, 'nine');
    const done = choose(revealed);
    expect(done.players[0].mainDeck.cardIds).toEqual(['nine', 'deck']);
    expect(done.players[0].waitingRoom.cardIds).toContain('template');
    expect(events(done)).toHaveLength(1);
    expect(
      done.actionHistory.filter((a) => a.type === 'PAY_COST' && a.payload.abilityId === ABILITY)
    ).toEqual([]);
  });
  it('does not move the same physical card after a waiting-room reentry during public recovery', () => {
    const revealed = choose(start(), 'nine');
    const reentered = emitGameEvent(
      revealed,
      createEnterWaitingRoomEvent(['nine'], ZoneType.HAND, P1, P1)
    );
    const done = choose(reentered);
    expect(done.players[0].waitingRoom.cardIds).toContain('nine');
    expect(done.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(events(done)).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });
});
