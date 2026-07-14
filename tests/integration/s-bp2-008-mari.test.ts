import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { createCheerEvent, createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { confirmActiveEffectStepThroughPublicReveal as confirmActiveEffectStep } from '../helpers/public-card-selection-confirmation';
import {
  S_BP2_022_LIVE_SUCCESS_DECK_REFRESHED_THIS_TURN_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP2_008_GRANTED_LIVE_SUCCESS_CHEER_LIVE_SCORE_ABILITY_ID,
  S_BP2_008_ON_ENTER_WAITING_ROOM_LIVE_TO_DECK_BOTTOM_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(cardCode: string, name: string, groupNames: readonly string[] = ['Aqours']): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 17,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function setup(options: { readonly distinct?: boolean; readonly full?: boolean; readonly aqours?: boolean } = {}) {
  const mari = createCardInstance(member('PL!S-bp2-008-P', '小原鞠莉'), PLAYER1, 'mari');
  const left = createCardInstance(member('test:left', '高海千歌'), PLAYER1, 'left');
  const center = createCardInstance(
    member('test:center', options.distinct === false ? '高海千歌' : '桜内梨子'),
    PLAYER1,
    'center'
  );
  const right = createCardInstance(
    member(
      'test:right',
      options.distinct === false ? '高海千歌' : '渡辺曜',
      options.aqours === false ? ['Liella!'] : ['Aqours']
    ),
    PLAYER1,
    'right'
  );
  const successLive = createCardInstance(live('test:success'), PLAYER1, 'success-live');
  const waitingLive = createCardInstance(live('test:waiting-live'), PLAYER1, 'waiting-live');
  const waitingMember = createCardInstance(member('test:waiting-member', '黒澤ルビィ'), PLAYER1, 'waiting-member');
  let game = registerCards(createGameState('bp2-008', PLAYER1, 'P1', PLAYER2, 'P2'), [
    mari,
    left,
    center,
    right,
    successLive,
    waitingLive,
    waitingMember,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let slots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, left.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    slots = placeCardInSlot(slots, SlotPosition.CENTER, mari.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.full !== false) {
      slots = placeCardInSlot(slots, SlotPosition.RIGHT, right.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots: slots,
      waitingRoom: { ...player.waitingRoom, cardIds: [waitingLive.instanceId, waitingMember.instanceId] },
    };
  });
  return { game, mariId: mari.instanceId, rightId: right.instanceId, successLiveId: successLive.instanceId, waitingLiveId: waitingLive.instanceId, waitingMemberId: waitingMember.instanceId };
}

function onEnterPending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'bp2-008-on-enter',
    abilityId: S_BP2_008_ON_ENTER_WAITING_ROOM_LIVE_TO_DECK_BOTTOM_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter'],
  };
}

function queueLiveSuccess(game: GameState, liveId: string): GameState {
  return enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS], {
    liveSuccessEvents: [createLiveSuccessEvent(PLAYER1, [liveId], 3)],
  });
}

function withOwnRevealedLives(game: GameState, count: number): GameState {
  const cards = Array.from({ length: count }, (_, index) =>
    createCardInstance(live(`test:cheer-${index}`), PLAYER1, `cheer-${index}`)
  );
  let state = registerCards(game, cards);
  const cardIds = cards.map((card) => card.instanceId);
  state = {
    ...state,
    resolutionZone: { ...state.resolutionZone, cardIds, revealedCardIds: cardIds },
    liveResolution: { ...state.liveResolution, firstPlayerCheerCardIds: cardIds },
  };
  return emitGameEvent(state, createCheerEvent(PLAYER1, cardIds, count, { additional: count > 3 }));
}

describe('PL!S-bp2-008 小原鞠莉', () => {
  it('opens one public 0–1 waiting-room LIVE selection and moves only its selected candidate to deck bottom', () => {
    const scenario = setup();
    const preview = resolvePendingCardEffects({ ...scenario.game, pendingAbilities: [onEnterPending(scenario.mariId)] }).gameState;
    expect(preview.activeEffect).toMatchObject({
      selectableCardIds: [scenario.waitingLiveId],
      selectableCardVisibility: 'PUBLIC',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      stepText: '请选择自己休息室中至多1张LIVE卡放置到卡组底。也可以选择不放置。',
      selectionLabel: '选择要放置到卡组底的LIVE',
      confirmSelectionLabel: '放置到卡组底',
      skipSelectionLabel: '不放置',
    });
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id, undefined, undefined, undefined, undefined, [scenario.waitingLiveId]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([scenario.waitingLiveId]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([scenario.waitingMemberId]);
    expect(resolved.activeEffect).toBeNull();
  });

  it('keeps invalid selections open, but stale candidates clear safely without moving another card', () => {
    const scenario = setup();
    const preview = resolvePendingCardEffects({ ...scenario.game, pendingAbilities: [onEnterPending(scenario.mariId)] }).gameState;
    const invalid = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id, undefined, undefined, undefined, undefined, [scenario.waitingMemberId]);
    expect(invalid).toBe(preview);
    const stale = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [scenario.waitingMemberId] },
    }));
    const resolved = confirmActiveEffectStep(stale, PLAYER1, stale.activeEffect!.id, undefined, undefined, undefined, undefined, [scenario.waitingLiveId]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('moves the selected candidate when a different old candidate has left the waiting room', () => {
    const scenario = setup();
    const secondLive = createCardInstance(live('test:waiting-live-b'), PLAYER1, 'waiting-live-b');
    let initial = registerCards(scenario.game, [secondLive]);
    initial = updatePlayer(initial, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, secondLive.instanceId],
      },
    }));
    const preview = resolvePendingCardEffects({
      ...initial,
      pendingAbilities: [onEnterPending(scenario.mariId)],
    }).gameState;
    expect(preview.activeEffect?.selectableCardIds).toEqual([
      scenario.waitingLiveId,
      secondLive.instanceId,
    ]);
    const afterOtherLeaves = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [scenario.waitingLiveId, scenario.waitingMemberId] },
    }));
    const resolved = confirmActiveEffectStep(
      afterOtherLeaves,
      PLAYER1,
      afterOtherLeaves.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.waitingLiveId]
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].mainDeck.cardIds).toEqual([scenario.waitingLiveId]);
  });

  it.each([
    [{ full: false }, false],
    [{ aqours: false }, false],
    [{ distinct: false }, false],
    [{}, true],
  ] as const)('only queues the granted LIVE_SUCCESS ability when the full distinct Aqours stage condition is %s', (options, expected) => {
    const scenario = setup(options);
    const queued = queueLiveSuccess(scenario.game, scenario.successLiveId);
    expect(queued.pendingAbilities.some((ability) => ability.abilityId === S_BP2_008_GRANTED_LIVE_SUCCESS_CHEER_LIVE_SCORE_ABILITY_ID)).toBe(expected);
    expect(queued.actionHistory.some((action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === S_BP2_008_GRANTED_LIVE_SUCCESS_CHEER_LIVE_SCORE_ABILITY_ID)).toBe(expected);
  });

  it('does not count a memberBelow card as a missing top-level stage member', () => {
    const scenario = setup({ full: false });
    const withMemberBelow = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.RIGHT]: [scenario.rightId],
        },
      },
    }));
    const queued = queueLiveSuccess(withMemberBelow, scenario.successLiveId);
    expect(queued.pendingAbilities).toEqual([]);
  });

  it.each([[0, 0], [1, 1], [2, 1], [3, 2], [4, 2]])('scores +%s from %s own revealed LIVE cards', (count, scoreBonus) => {
    const scenario = setup();
    const queued = queueLiveSuccess(withOwnRevealedLives(scenario.game, count), scenario.successLiveId);
    const preview = resolvePendingCardEffects(queued).gameState;
    expect(preview.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(preview.activeEffect?.effectText).toContain(`本次自己声援公开 LIVE ${count}张，实际分数+${scoreBonus}。`);
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1) ?? 0).toBe(scoreBonus);
    if (scoreBonus > 0) {
      expect(resolved.liveResolution.liveModifiers).toContainEqual(expect.objectContaining({
        kind: 'SCORE', playerId: PLAYER1, sourceCardId: scenario.mariId,
        abilityId: S_BP2_008_GRANTED_LIVE_SUCCESS_CHEER_LIVE_SCORE_ABILITY_ID, countDelta: scoreBonus,
      }));
      const modifier = resolved.liveResolution.liveModifiers.find(
        (candidate) => candidate.abilityId === S_BP2_008_GRANTED_LIVE_SUCCESS_CHEER_LIVE_SCORE_ABILITY_ID
      );
      expect(modifier).not.toHaveProperty('liveCardId');
    }
  });

  it('still counts this LIVE’s revealed cards after a prior effect moved them from resolutionZone', () => {
    const scenario = setup();
    const revealed = withOwnRevealedLives(scenario.game, 3);
    const movedAway = { ...revealed, resolutionZone: { ...revealed.resolutionZone, cardIds: [], revealedCardIds: [] } };
    const preview = resolvePendingCardEffects(queueLiveSuccess(movedAway, scenario.successLiveId)).gameState;
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('resolves same-source multiple pending abilities in order without a confirm-only window', () => {
    const scenario = setup();
    const queued = queueLiveSuccess(withOwnRevealedLives(scenario.game, 1), scenario.successLiveId);
    const first = queued.pendingAbilities[0]!;
    const orderSelection = resolvePendingCardEffects({
      ...queued,
      pendingAbilities: [...queued.pendingAbilities, { ...first, id: `${first.id}:second` }],
    }).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('opens confirm-only before resolving 008 when manually selected from multiple pending abilities', () => {
    const scenario = setup();
    const queued = queueLiveSuccess(withOwnRevealedLives(scenario.game, 1), scenario.successLiveId);
    const otherPending: PendingAbilityState = {
      id: 'other-live-success',
      abilityId: S_BP2_022_LIVE_SUCCESS_DECK_REFRESHED_THIS_TURN_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: scenario.successLiveId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      eventIds: ['same-live-success'],
    };
    const orderSelection = resolvePendingCardEffects({
      ...queued,
      pendingAbilities: [...queued.pendingAbilities, otherPending],
    }).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      scenario.mariId
    );
    expect(preview.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(preview.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
  });

  it('resolves an already queued ability after the stage formation later stops satisfying its grant condition', () => {
    const scenario = setup();
    const queued = queueLiveSuccess(withOwnRevealedLives(scenario.game, 3), scenario.successLiveId);
    const formationChanged = updatePlayer(queued, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.RIGHT]: null },
      },
    }));
    const preview = resolvePendingCardEffects(formationChanged).gameState;
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });
});
