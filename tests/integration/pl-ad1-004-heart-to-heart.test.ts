import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_AD1_004_LIVE_SUCCESS_ORANGE_CHEER_TO_HAND_ABILITY_ID as ABILITY,
  HS_BP8_018_AUTO_REVEALED_CHEER_MOVED_SOURCE_SCORE_ABILITY_ID as MOVE_AUTO,
} from '../../src/application/card-effects/ability-ids';
import {
  createCardInstance,
  type BladeHearts,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { addLiveModifier, getLiveCardScoreModifier } from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect as B,
  CardType,
  FaceState,
  GamePhase,
  HeartColor as H,
  OrientationState,
  SubPhase,
  TriggerCondition as T,
} from '../../src/shared/types/enums';
import { createNovember10OrangeCard } from '../helpers/november-10-orange-effects';
import { getNovember06LiveData } from '../helpers/november-06-draft-effects';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
const P = 'p1';
function member(id: string, color = H.ORANGE, owner = P) {
  const bladeHearts: BladeHearts = [{ effect: B.HEART, heartColor: color }];
  const data: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: `TEST-${id}`,
    name: id,
    cost: 1,
    blade: 1,
    hearts: [],
    bladeHearts,
  };
  return createCardInstance(data, owner, id);
}
function setup(): GameState {
  let game = registerCards(createGameState('heart', P, 'P1', 'p2', 'P2'), [
    createNovember10OrangeCard('PL!-ad1-004', P, 'source'),
    ...['orange', 'orange2', 'stale', 'unrevealed', 'not-cheer'].map((id) => member(id)),
    member('purple', H.PURPLE),
    member('opponent', H.ORANGE, 'p2'),
  ]);
  game = updatePlayer(game, P, (p) => ({
    ...p,
    liveZone: {
      ...p.liveZone,
      cardIds: ['source'],
      cardStates: new Map([
        ['source', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
      ]),
    },
  }));
  const cheerIds = ['orange', 'orange2', 'stale', 'unrevealed', 'purple', 'opponent'];
  game = emitGameEvent(
    game,
    createCheerEvent(P, cheerIds, cheerIds.length, { automated: true, additional: false })
  );
  return {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: ['orange', 'orange2', 'unrevealed', 'purple', 'opponent', 'not-cheer'],
      revealedCardIds: ['orange', 'orange2', 'purple', 'opponent', 'not-cheer'],
    },
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: P,
      liveResults: new Map([['source', true]]),
      firstPlayerCheerCardIds: cheerIds,
    },
  };
}
function open(game = setup()) {
  return resolvePendingCardEffects(enqueueTriggeredCardEffects(game, [T.ON_LIVE_SUCCESS]))
    .gameState;
}
function confirm(game: GameState, id?: string | null) {
  return confirmActiveEffectStep(game, P, game.activeEffect!.id, id);
}
function restore(game: GameState) {
  return confirmActiveEffectStepThroughPublicReveal(game, P, game.activeEffect!.id);
}

describe('PL!-ad1-004 分数7「HEART to HEART!」', () => {
  it('mandatorily selects one current own revealed orange cheer card and moves only after the public display', () => {
    const state = open();
    expect(state.activeEffect).toMatchObject({
      abilityId: ABILITY,
      selectableCardIds: ['orange', 'orange2'],
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
    });
    expect(confirm(state, null)).toBe(state);
    for (const bad of ['purple', 'stale', 'unrevealed', 'opponent', 'not-cheer'])
      expect(confirm(state, bad)).toBe(state);
    const shown = confirm(state, 'orange');
    expect(shown.activeEffect).toMatchObject({
      stepId: 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION',
      revealedCardIds: ['orange'],
    });
    expect(shown.resolutionZone.cardIds).toContain('orange');
    expect(shown.players[0].hand.cardIds).toEqual([]);
    expect(
      shown.eventLog.some(({ event }) => event.eventType === T.ON_REVEALED_CHEER_CARDS_MOVED)
    ).toBe(false);
    const done = restore(shown);
    expect(done.players[0].hand.cardIds).toEqual(['orange']);
    expect(done.resolutionZone.cardIds).not.toContain('orange');
    expect(done.liveResolution.firstPlayerCheerCardIds).toContain('orange');
    expect(done.activeEffect).toBeNull();
    expect(
      done.eventLog.filter(({ event }) => event.eventType === T.ON_REVEALED_CHEER_CARDS_MOVED)
    ).toHaveLength(1);
  });
  it('uses effective orange judgments after replacement in both directions', () => {
    const purpleToOrange = addLiveModifier(setup(), {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P,
      fromColors: [H.PURPLE],
      toColor: H.ORANGE,
    });
    expect(open(purpleToOrange).activeEffect?.selectableCardIds).toEqual([
      'orange',
      'orange2',
      'purple',
    ]);
    const orangeToPurple = addLiveModifier(setup(), {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P,
      fromColors: [H.ORANGE],
      toColor: H.PURPLE,
    });
    const none = open(orangeToPurple);
    expect(none.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(confirm(none).activeEffect).toBeNull();
  });
  it.each(['moved', 'unrevealed', 'not-current', 'recolored'])(
    'rejects a target that becomes %s during public display',
    (change) => {
      let game = confirm(open(), 'orange');
      if (change === 'moved')
        game = {
          ...game,
          resolutionZone: {
            ...game.resolutionZone,
            cardIds: game.resolutionZone.cardIds.filter((id) => id !== 'orange'),
          },
        };
      if (change === 'unrevealed')
        game = {
          ...game,
          resolutionZone: {
            ...game.resolutionZone,
            revealedCardIds: game.resolutionZone.revealedCardIds.filter((id) => id !== 'orange'),
          },
        };
      if (change === 'not-current')
        game = {
          ...game,
          liveResolution: { ...game.liveResolution, firstPlayerCheerCardIds: ['orange2'] },
          eventLog: [],
        };
      if (change === 'recolored')
        game = addLiveModifier(game, {
          kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
          playerId: P,
          fromColors: [H.ORANGE],
          toColor: H.PURPLE,
        });
      const restored = restore(game);
      expect(restored.players[0].hand.cardIds).toEqual([]);
      expect(
        restored.eventLog.some(({ event }) => event.eventType === T.ON_REVEALED_CHEER_CARDS_MOVED)
      ).toBe(false);
      if (change === 'recolored') expect(restored.activeEffect).toBeNull();
      else {
        expect(restored.activeEffect?.selectableCardIds).toEqual(['orange2']);
        const done = confirmActiveEffectStepThroughPublicReveal(
          restored,
          P,
          restored.activeEffect!.id,
          'orange2'
        );
        expect(done.players[0].hand.cardIds).toEqual(['orange2']);
      }
    }
  );
  it('retains captured ability when source leaves and continues into the actual cheer-movement trigger only after movement', () => {
    let game = registerCards(setup(), [
      createCardInstance(getNovember06LiveData('PL!HS-bp8-018'), P, 'holiday'),
    ]);
    game = updatePlayer(game, P, (p) => ({
      ...p,
      liveZone: {
        ...p.liveZone,
        cardIds: ['source', 'holiday'],
        cardStates: new Map([
          ['source', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
          ['holiday', { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }],
        ]),
      },
    }));
    game = open(game);
    game = updatePlayer(game, P, (p) => ({
      ...p,
      liveZone: { ...p.liveZone, cardIds: ['holiday'] },
      waitingRoom: { ...p.waitingRoom, cardIds: ['source'] },
    }));
    const shown = confirm(game, 'orange');
    expect(shown.pendingAbilities.some((p) => p.abilityId === MOVE_AUTO)).toBe(false);
    const moved = restore(shown);
    expect(moved.players[0].hand.cardIds).toEqual(['orange']);
    expect(moved.activeEffect?.abilityId).toBe(MOVE_AUTO);
    expect(getLiveCardScoreModifier(moved.liveResolution, 'holiday')).toBe(0);
    const done = confirm(moved);
    expect(getLiveCardScoreModifier(done.liveResolution, 'holiday')).toBe(1);
    expect(done.pendingAbilities).toEqual([]);
  });
});
