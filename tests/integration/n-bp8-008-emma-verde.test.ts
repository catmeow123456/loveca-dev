import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  getCardAbilityDefinitions,
} from '../../src/application/card-effect-runner';
import { CardAbilitySourceZone } from '../../src/application/card-effects/ability-definition-types';
import {
  N_BP8_008_ACTIVATED_REVEAL_SELF_HAND_BOTTOM_WAIT_OPPONENT_ABILITY_ID as ABILITY,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID as DRAW_TRIGGER,
} from '../../src/application/card-effects/ability-ids';
import { drawCardsForPlayer } from '../../src/application/card-effects/runtime/actions';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { playMemberFromZoneToStageSlotWithReplacement } from '../../src/application/card-effects/runtime/play-member-to-stage';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  registerCards,
  setActivePlayer,
  setPhase,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import { createPublicObjectId } from '../../src/online/projector';
import {
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  gameWith,
  hand,
  member,
  P1,
  P2,
  setState,
  stage,
} from '../helpers/modifier-workflow-fixtures';
import { getNovember06MemberData } from '../helpers/november-06-draft-effects';

const SOURCE = 'emma';
const TARGET = 'target';
const HIDDEN = 'other-hand-card';
const DECK_TOP = 'deck-top';
const TEXT =
  '【起动】将手牌的此卡公开：将此卡放置于卡组底。此后，自己的舞台上存在『虹咲』的成员的场合，将存在于对方的舞台的１名费用小于等于２的成员变为待机状态。此能力仅在此卡存在于手牌的场合才能起动。';

function setup(cardCode = 'PL!N-bp8-008-P', targetCost = 3) {
  const source = createCardInstance(
    { ...getNovember06MemberData('PL!N-bp8-008-P'), cardCode },
    P1,
    SOURCE
  );
  const ally = member('NIJI-ALLY', 'ally');
  const hidden = member('PRIVATE-HAND-CARD', HIDDEN);
  const deckTop = member('DECK-TOP', DECK_TOP);
  const target = member('OPPONENT-TARGET', TARGET, P2, {
    cost: targetCost,
    groupNames: ['Aqours'],
  });
  let game = setPhase(gameWith([source, ally, hidden, deckTop, target]), GamePhase.MAIN_PHASE);
  game = hand(stage(stage(game, [ally]), [target], P2), [source, hidden]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [DECK_TOP] },
  }));
  return { game, source, target };
}

function sessionWith(game: GameState) {
  let now = 1_000;
  const session = createGameSession({ now: () => now });
  session.createGame('emma-reveal', P1, 'P1', P2, 'P2');
  setState(session, game);
  return {
    session,
    setTime: (time: number) => {
      now = time;
    },
  };
}

function activation() {
  return createActivateAbilityCommand(P1, SOURCE, ABILITY);
}

function revealAdvance(game: GameState, playerId = P2) {
  const effect = game.activeEffect!;
  return createAutoAdvancePublicRevealCommand(
    playerId,
    effect.id,
    effect.publicRevealAutoAdvanceAt!,
    effect.publicRevealGeneration!
  );
}

function targetOrientation(game: GameState) {
  return game.players[1].memberSlots.cardStates.get(TARGET)?.orientation;
}

function abilityActions(game: GameState) {
  return game.actionHistory.filter((action) => action.payload.abilityId === ABILITY);
}

function memberStateEvents(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
}

describe('PL!N-bp8-008 费用13「艾玛·维尔德」', () => {
  it.each(['PL!N-bp8-008-P', 'PL!N-bp8-008-N'])(
    'finds the complete HAND activation for %s',
    (cardCode) => {
      const { game, source } = setup(cardCode);
      expect(source.data).toMatchObject({ name: '艾玛·维尔德', cost: 13, cardTextCn: TEXT });
      const definition = getCardAbilityDefinitions(cardCode).find(
        (item) => item.abilityId === ABILITY
      );
      expect(definition).toMatchObject({
        sourceZone: CardAbilitySourceZone.HAND,
        effectText: TEXT,
        activatedUi: { abilityId: ABILITY, text: TEXT },
        implemented: true,
      });
      expect(definition?.perTurnLimit).toBeUndefined();
      const { session } = sessionWith(game);
      expect(session.manualOperationMode).toBe('RULES');
      expect(session.executeCommand(activation()).success).toBe(true);
      expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    }
  );

  it('publicly reveals only Emma, bottoms once at the deadline, and then requires an effective-cost target', () => {
    const { game } = setup();
    const reduced = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: P2,
      memberCardId: TARGET,
      countDelta: -1,
      sourceCardId: 'modifier',
    });
    const { session, setTime } = sessionWith(reduced);
    expect(session.executeCommand(activation()).success).toBe(true);
    const revealed = session.state!;
    const effect = revealed.activeEffect!;
    expect(effect.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(effect.publicRevealAutoAdvanceAt).toBe(3_000);
    expect(effect.selectableCardIds).toBeUndefined();
    expect(revealed.players[0].hand.cardIds).toEqual([SOURCE, HIDDEN]);
    expect(revealed.players[0].mainDeck.cardIds).toEqual([DECK_TOP]);
    expect(targetOrientation(revealed)).toBe(OrientationState.ACTIVE);
    expect(abilityActions(revealed)).toMatchObject([
      { type: 'PAY_COST', payload: { sourceCardId: SOURCE, revealedCardIds: [SOURCE] } },
      { type: 'RESOLVE_ABILITY', payload: { step: 'ABILITY_USE', sourceCardId: SOURCE } },
    ]);
    const sourceObject = createPublicObjectId(SOURCE);
    const hiddenObject = createPublicObjectId(HIDDEN);
    for (const viewer of [P1, P2]) {
      const view = session.getPlayerViewState(viewer)!;
      expect(view.activeEffect).toMatchObject({
        revealedObjectIds: [sourceObject],
        publicRevealAutoAdvanceAt: effect.publicRevealAutoAdvanceAt,
        publicRevealGeneration: effect.publicRevealGeneration,
      });
      expect(view.activeEffect?.selectableObjectIds).toBeUndefined();
      expect(view.objects[sourceObject]).toMatchObject({
        surface: 'FRONT',
        publiclyRevealed: true,
      });
    }
    expect(session.getPlayerViewState(P1)?.objects[hiddenObject]?.surface).toBe('FRONT');
    expect(session.getPlayerViewState(P2)?.objects[hiddenObject]?.surface).not.toBe('FRONT');

    const advance = revealAdvance(revealed);
    setTime(2_999);
    expect(session.executeCommand(advance).success).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, TARGET)).success
    ).toBe(false);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([DECK_TOP]);
    setTime(3_000);
    expect(session.executeCommand(advance).success).toBe(true);
    const targeting = session.state!;
    expect(targeting.players[0].mainDeck.cardIds).toEqual([DECK_TOP, SOURCE]);
    expect(targeting.players[0].hand.cardIds).toEqual([HIDDEN]);
    expect(targeting.activeEffect).toMatchObject({
      selectableCardIds: [TARGET],
      canSkipSelection: false,
    });
    expect(targeting.activeEffect?.revealedCardIds).toBeUndefined();
    expect(session.getPlayerViewState(P2)?.objects[sourceObject]?.surface).not.toBe('FRONT');
    expect(targetOrientation(targeting)).toBe(OrientationState.ACTIVE);
    expect(session.executeCommand(advance).success).toBe(false);
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, effect.id)).success).toBe(
      false
    );
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, HIDDEN)).success
    ).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P2, effect.id, TARGET)).success
    ).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, TARGET)).success
    ).toBe(true);

    const done = session.state!;
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].mainDeck.cardIds).toEqual([DECK_TOP, SOURCE]);
    expect(targetOrientation(done)).toBe(OrientationState.WAITING);
    expect(abilityActions(done).slice(2)).toMatchObject([
      { type: 'RESOLVE_ABILITY', payload: { movedCardIds: [SOURCE] } },
      { type: 'RESOLVE_ABILITY', payload: { targetMemberCardId: TARGET } },
    ]);
    expect(memberStateEvents(done)).toMatchObject([
      {
        cardInstanceId: TARGET,
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
        cause: { kind: 'CARD_EFFECT', abilityId: ABILITY, sourceCardId: SOURCE, playerId: P1 },
      },
    ]);
  });

  it.each([
    'no Nijigasaki ally',
    'over-cost target',
    'already waiting',
    'protected target',
  ] as const)('still pays and places Emma at the bottom with %s', (condition) => {
    const { game } = setup(undefined, condition === 'over-cost target' ? 3 : 2);
    let state = game;
    if (condition === 'no Nijigasaki ally') {
      state = registerCards(state, [member('OTHER-ALLY', 'ally', P1, { groupNames: ['Aqours'] })]);
    }
    if (condition === 'already waiting') {
      state = updatePlayer(state, P2, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, TARGET, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      }));
    }
    if (condition === 'protected target') {
      state = addMemberWaitProtectionUntilLiveEnd(state, {
        affectedPlayerId: P2,
        abilityId: 'protection',
        sourceCardId: 'protection',
      });
    }
    const { session, setTime } = sessionWith(state);
    expect(session.executeCommand(activation()).success).toBe(true);
    const advance = revealAdvance(session.state!, P1);
    setTime(3_000);
    expect(session.executeCommand(advance).success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([DECK_TOP, SOURCE]);
    expect(
      abilityActions(session.state!).filter((action) => action.type === 'PAY_COST')
    ).toHaveLength(1);
    expect(memberStateEvents(session.state!)).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });

  it('rejects activation off-turn, outside the main phase, or from a source on stage', () => {
    const { game, source } = setup();
    const onStage = stage(
      updatePlayer(game, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [HIDDEN] },
      })),
      [source]
    );
    for (const invalid of [
      setActivePlayer(game, 1),
      setPhase(game, GamePhase.LIVE_SET_PHASE),
      onStage,
    ]) {
      const { session } = sessionWith(invalid);
      expect(session.executeCommand(activation()).success).toBe(false);
      expect(abilityActions(session.state!)).toEqual([]);
    }
  });

  it('rechecks the revealed source and later candidates without replaying the paid cost', () => {
    const { session, setTime } = sessionWith(setup(undefined, 2).game);
    expect(session.executeCommand(activation()).success).toBe(true);
    const revealed = session.state!;
    const advance = revealAdvance(revealed);
    setState(
      session,
      updatePlayer(revealed, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [HIDDEN] },
        waitingRoom: { ...player.waitingRoom, cardIds: [SOURCE] },
      }))
    );
    setTime(3_000);
    expect(session.executeCommand(advance).success).toBe(true);
    const targeting = session.state!;
    expect(targeting.players[0].mainDeck.cardIds).toEqual([DECK_TOP]);
    expect(targeting.players[0].waitingRoom.cardIds).toEqual([SOURCE]);
    expect(targeting.activeEffect?.selectableCardIds).toEqual([TARGET]);
    setState(
      session,
      addLiveModifier(targeting, {
        kind: 'MEMBER_COST',
        playerId: P2,
        memberCardId: TARGET,
        countDelta: 1,
        sourceCardId: 'modifier',
      })
    );
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, targeting.activeEffect!.id, TARGET))
        .success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(targetOrientation(session.state!)).toBe(OrientationState.ACTIVE);
    expect(
      abilityActions(session.state!).filter((action) => action.type === 'PAY_COST')
    ).toHaveLength(1);
    expect(memberStateEvents(session.state!)).toEqual([]);
  });

  it('can activate the same card again after drawing it in the same turn', () => {
    const { session, setTime } = sessionWith(setup().game);
    expect(session.executeCommand(activation()).success).toBe(true);
    const advance = revealAdvance(session.state!);
    setTime(3_000);
    expect(session.executeCommand(advance).success).toBe(true);
    const done = session.state!;
    expect(done.activeEffect).toBeNull();
    const draw = drawCardsForPlayer(done, P1, 2)!;
    expect(draw.drawnCardIds).toEqual([DECK_TOP, SOURCE]);
    setState(session, draw.gameState);
    expect(session.executeCommand(activation()).success).toBe(true);
    expect(session.state!.turnCount).toBe(done.turnCount);
    expect(session.state!.activeEffect?.revealedCardIds).toEqual([SOURCE]);
    expect(
      abilityActions(session.state!).filter((action) => action.payload.step === 'ABILITY_USE')
    ).toHaveLength(2);
  });

  it('requires a fresh selection when the same target card leaves and re-enters the stage', () => {
    const { session, setTime } = sessionWith(setup(undefined, 2).game);
    expect(session.executeCommand(activation()).success).toBe(true);
    const advance = revealAdvance(session.state!);
    setTime(3_000);
    expect(session.executeCommand(advance).success).toBe(true);
    const targeting = session.state!;
    const stale = createConfirmEffectStepCommand(P1, targeting.activeEffect!.id, TARGET);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      targeting,
      P2,
      TARGET,
      enqueueTriggeredCardEffects
    )!.gameState;
    const reentered = playMemberFromZoneToStageSlotWithReplacement(left, P2, {
      cardId: TARGET,
      sourceZone: ZoneType.WAITING_ROOM,
      toSlot: SlotPosition.CENTER,
    })!.gameState;
    setState(session, reentered);
    expect(session.executeCommand(stale).success).toBe(true);
    const refreshed = session.state!;
    expect(targetOrientation(refreshed)).toBe(OrientationState.ACTIVE);
    expect(memberStateEvents(refreshed)).toEqual([]);
    expect(refreshed.activeEffect?.selectableCardIds).toEqual([TARGET]);
    expect(session.executeCommand(stale).success).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, refreshed.activeEffect!.id, TARGET))
        .success
    ).toBe(true);
    expect(targetOrientation(session.state!)).toBe(OrientationState.WAITING);
    expect(memberStateEvents(session.state!)).toHaveLength(1);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([DECK_TOP, SOURCE]);
  });

  it('resumes the check timing and resolves a real trigger caused by waiting the target', () => {
    const { game } = setup(undefined, 2);
    const observer = createCardInstance(getNovember06MemberData('PL!-pb1-015-R'), P1, 'maki');
    const state = updatePlayer(registerCards(game, [observer]), P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, observer.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const { session, setTime } = sessionWith(state);
    expect(session.executeCommand(activation()).success).toBe(true);
    const advance = revealAdvance(session.state!);
    setTime(3_000);
    expect(session.executeCommand(advance).success).toBe(true);
    const targeting = session.state!;
    expect(
      targeting.actionHistory.some((action) => action.payload.abilityId === DRAW_TRIGGER)
    ).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, targeting.activeEffect!.id, TARGET))
        .success
    ).toBe(true);
    const done = session.state!;
    expect(
      done.actionHistory.filter(
        (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === DRAW_TRIGGER
      )
    ).toHaveLength(1);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].hand.cardIds).toEqual([HIDDEN, DECK_TOP]);
    expect(done.players[0].mainDeck.cardIds).toEqual([SOURCE]);
  });
});
