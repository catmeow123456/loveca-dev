import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
  N_SD2_027_LIVE_START_WAIT_UP_TO_THREE_NIJIGASAKI_SCORE_PER_WAITED_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function ketsuiNoHikari(): LiveCardData {
  return {
    cardCode: 'PL!N-sd2-027-P',
    name: '決意の光',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function member(cardCode: string, groupNames: readonly string[] = ['虹ヶ咲']): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function setup(
  options: {
    readonly leftOrientation?: OrientationState;
    readonly rightGroup?: readonly string[];
    readonly includeOpponent?: boolean;
  } = {}
) {
  const source = createCardInstance(ketsuiNoHikari(), P1, 'ketsui');
  const left = createCardInstance(member('LEFT'), P1, 'left');
  const center = createCardInstance(member('CENTER'), P1, 'center');
  const right = createCardInstance(member('RIGHT', options.rightGroup ?? ['虹ヶ咲']), P1, 'right');
  const opponent = createCardInstance(member('OPPONENT'), P2, 'opponent');
  let game = registerCards(createGameState('n-sd2-027', P1, 'P1', P2, 'P2'), [
    source,
    left,
    center,
    right,
    opponent,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
    memberSlots: [
      [SlotPosition.LEFT, left, options.leftOrientation ?? OrientationState.ACTIVE],
      [SlotPosition.CENTER, center, OrientationState.ACTIVE],
      [SlotPosition.RIGHT, right, OrientationState.ACTIVE],
    ].reduce(
      (slots, [slot, card, orientation]) =>
        placeCardInSlot(slots, slot as SlotPosition, (card as typeof left).instanceId, {
          orientation: orientation as OrientationState,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  if (options.includeOpponent) {
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
  }
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[P1, 5]]),
    },
  };
  return { game, source, left, center, right, opponent };
}

function start(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function choose(game: GameState, selectedCardIds: readonly string[]): GameState {
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
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        N_SD2_027_LIVE_START_WAIT_UP_TO_THREE_NIJIGASAKI_SCORE_PER_WAITED_ABILITY_ID
  );
}

function setupWithBp7ShiorikoListener() {
  const source = createCardInstance(ketsuiNoHikari(), P1, 'ketsui-listener-scenario');
  const left = createCardInstance(member('LEFT-TARGET'), P1, 'left-target');
  const shioriko = createCardInstance(
    member('PL!N-bp7-022-N'),
    P1,
    'bp7-shioriko-listener'
  );
  const right = createCardInstance(member('RIGHT-TARGET'), P1, 'right-target');
  const discard = createCardInstance(member('DISCARD-CARD'), P1, 'discard-card');
  const deckFiller = createCardInstance(member('DECK-FILLER'), P1, 'deck-filler');
  let game = registerCards(
    createGameState('n-sd2-027-bp7-022-batch', P1, 'P1', P2, 'P2'),
    [source, left, shioriko, right, discard, deckFiller]
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
    hand: addCardToZone(player.hand, discard.instanceId),
    mainDeck: addCardToZone(player.mainDeck, deckFiller.instanceId),
    memberSlots: [
      [SlotPosition.LEFT, left],
      [SlotPosition.CENTER, shioriko],
      [SlotPosition.RIGHT, right],
    ].reduce(
      (slots, [slot, card]) =>
        placeCardInSlot(slots, slot as SlotPosition, (card as typeof left).instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[P1, 5]]),
    },
  };
  return { game, source, left, shioriko, right, discard };
}

describe('PL!N-sd2-027 決意の光', () => {
  it('opens one optional public multi-target window for own active main-stage Nijigasaki members', () => {
    const scenario = setup({
      leftOrientation: OrientationState.WAITING,
      rightGroup: ['Liella!'],
      includeOpponent: true,
    });
    const opened = start(scenario.game);
    expect(opened.activeEffect).toMatchObject({
      abilityId: N_SD2_027_LIVE_START_WAIT_UP_TO_THREE_NIJIGASAKI_SCORE_PER_WAITED_ABILITY_ID,
      effectText:
        '【LIVE开始时】可以将至多3名『虹咲』的成员变为待机状态：每有1名因此变为待机状态的成员，此卡的分数+1。',
      stepText: '可以将自己舞台上至多3名『虹咲』成员变为待机状态。',
      selectableCardIds: [scenario.center.instanceId],
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      selectionLabel: '选择要变为待机状态的成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(opened.activeEffect?.selectableCardIds).not.toContain(scenario.opponent.instanceId);
  });

  it('waits selected members, emits standard events, and adds score per actual change', () => {
    const scenario = setup();
    const resolved = choose(start(scenario.game), [
      scenario.left.instanceId,
      scenario.center.instanceId,
    ]);
    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.left.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.center.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      resolved.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(2);
    expect(scoreModifiers(resolved)).toEqual([
      {
        kind: 'SCORE',
        playerId: P1,
        countDelta: 2,
        liveCardId: scenario.source.instanceId,
        sourceCardId: scenario.source.instanceId,
        abilityId: N_SD2_027_LIVE_START_WAIT_UP_TO_THREE_NIJIGASAKI_SCORE_PER_WAITED_ABILITY_ID,
      },
    ]);
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(7);
    expect(
      resolved.actionHistory.find(
        (action) => action.payload.step === 'WAIT_NIJIGASAKI_MEMBERS_GAIN_SCORE'
      )?.payload
    ).toMatchObject({ requestedCount: 2, actualWaitedCount: 2, scoreBonus: 2 });
  });

  it('batches simultaneous waits so bp7 Shioriko pays once and chooses a non-first target', () => {
    const scenario = setupWithBp7ShiorikoListener();
    const afterKetsui = choose(start(scenario.game), [
      scenario.left.instanceId,
      scenario.right.instanceId,
    ]);

    const waitingEvents = afterKetsui.eventLog.filter(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.nextOrientation === OrientationState.WAITING
    );
    expect(waitingEvents.map((entry) => entry.event.cardInstanceId)).toEqual([
      scenario.left.instanceId,
      scenario.right.instanceId,
    ]);
    expect(scoreModifiers(afterKetsui)).toEqual([
      expect.objectContaining({ countDelta: 2, liveCardId: scenario.source.instanceId }),
    ]);
    expect(afterKetsui.liveResolution.playerScores.get(P1)).toBe(7);
    expect(
      afterKetsui.actionHistory.filter(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(afterKetsui.activeEffect).toMatchObject({
      abilityId: N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID,
      stepId: 'NIJIGASAKI_MEMBER_WAITED_SELECT_DISCARD',
      metadata: {
        changedCardIds: [scenario.left.instanceId, scenario.right.instanceId],
        triggerEventIds: waitingEvents.map((entry) => entry.event.eventId),
      },
    });

    const selectingTarget = confirmActiveEffectStep(
      afterKetsui,
      P1,
      afterKetsui.activeEffect!.id,
      scenario.discard.instanceId
    );
    expect(selectingTarget.activeEffect).toMatchObject({
      stepId: 'NIJIGASAKI_MEMBER_WAITED_SELECT_ACTIVATE_TARGET',
      selectableCardIds: [scenario.left.instanceId, scenario.right.instanceId],
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要变为活跃状态的成员',
      confirmSelectionLabel: '变为活跃状态',
      canSkipSelection: false,
    });

    const resolved = confirmActiveEffectStep(
      selectingTarget,
      P1,
      selectingTarget.activeEffect!.id,
      scenario.right.instanceId
    );
    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.left.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.right.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(resolved.players[0].waitingRoom.cardIds).toContain(scenario.discard.instanceId);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.payload.abilityId ===
            N_BP7_022_AUTO_LIVE_PHASE_NIJIGASAKI_MEMBER_WAIT_DISCARD_ACTIVATE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
  });

  it('counts only targets that remain legal and actually change orientation', () => {
    const scenario = setup();
    const opened = start(scenario.game);
    const stale = updatePlayer(opened, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const resolved = choose(stale, [scenario.left.instanceId, scenario.center.instanceId]);
    expect(scoreModifiers(resolved)).toHaveLength(1);
    expect(scoreModifiers(resolved)[0]).toMatchObject({ countDelta: 1 });
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(6);
    expect(
      resolved.actionHistory.find(
        (action) => action.payload.step === 'WAIT_NIJIGASAKI_MEMBERS_GAIN_SCORE'
      )?.payload
    ).toMatchObject({ requestedCount: 2, actualWaitedCount: 1, scoreBonus: 1 });
  });

  it('allows not activating and rejects duplicate or unoffered IDs', () => {
    const scenario = setup();
    const opened = start(scenario.game);
    expect(choose(opened, [scenario.left.instanceId, scenario.left.instanceId])).toBe(opened);
    expect(choose(opened, ['not-offered'])).toBe(opened);
    const skipped = choose(opened, []);
    expect(skipped.activeEffect).toBeNull();
    expect(scoreModifiers(skipped)).toEqual([]);
    expect(skipped.liveResolution.playerScores.get(P1)).toBe(5);
  });

  it('does not wait members or add score when the source LIVE becomes stale', () => {
    const scenario = setup();
    const opened = start(scenario.game);
    const stale = updatePlayer(opened, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.source.instanceId),
    }));
    const resolved = choose(stale, [scenario.left.instanceId]);
    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.left.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(5);
    expect(
      resolved.actionHistory.find((action) => action.payload.step === 'SOURCE_LIVE_NO_LONGER_VALID')
    ).toBeDefined();
  });
});
