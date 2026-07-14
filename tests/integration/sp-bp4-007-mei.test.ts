import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID,
  SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
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

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(
  cardCode: string,
  name: string,
  score: number,
  groupNames: readonly string[] = ['Liella!']
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupState(options: {
  readonly includeValidTarget?: boolean;
  readonly includeInvalidTargets?: boolean;
  readonly includeBladeMember?: boolean;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly validLiveId: string;
  readonly bladeSourceId: string | null;
} {
  const source = createCardInstance(
    createMember('PL!SP-bp4-007-P', '米女メイ'),
    PLAYER1,
    'sp-bp4-007-source'
  );
  const other = createCardInstance(createMember('PL!SP-test-other', 'Other'), PLAYER1, 'other');
  const bladeSource = createCardInstance(
    createMember('PL!SP-sd2-011-SD2', '鬼塚冬毬'),
    PLAYER1,
    'blade-source'
  );
  const validLive = createCardInstance(
    createLive('PL!SP-test-liella-live', 'Liella Live', 3),
    PLAYER1,
    'valid-live'
  );
  const highScoreLive = createCardInstance(
    createLive('PL!SP-test-high-score-live', 'High Score Liella Live', 4),
    PLAYER1,
    'high-score-live'
  );
  const nonLiellaLive = createCardInstance(
    createLive('PL!S-test-aqours-live', 'Aqours Live', 2, ['Aqours']),
    PLAYER1,
    'non-liella-live'
  );
  const includeBladeMember = options.includeBladeMember === true;
  const waitingRoomCardIds = [
    ...(options.includeValidTarget === false ? [] : [validLive.instanceId]),
    ...(options.includeInvalidTargets === true
      ? [highScoreLive.instanceId, nonLiellaLive.instanceId]
      : []),
  ];

  let game = createGameState('sp-bp4-007-mei', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other, bladeSource, validLive, highScoreLive, nonLiellaLive]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        source.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
      SlotPosition.RIGHT,
      includeBladeMember ? bladeSource.instanceId : other.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingRoomCardIds,
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    validLiveId: validLive.instanceId,
    bladeSourceId: includeBladeMember ? bladeSource.instanceId : null,
  };
}

function moveAndQueue(game: GameState, cardId: string, toSlot: SlotPosition): GameState {
  const moveResult = moveMemberBetweenSlots(game, PLAYER1, cardId, toSlot);
  expect(moveResult).not.toBeNull();
  return enqueueTriggeredCardEffects(moveResult!.gameState, [TriggerCondition.ON_MEMBER_SLOT_MOVED]);
}

function chooseFirstPendingBySource(game: GameState, sourceCardId: string): GameState {
  const effect = game.activeEffect;
  expect(effect).not.toBeNull();
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, effect!.id, sourceCardId);
}

describe('PL!SP-bp4-007 Mei on-move low-score Liella LIVE recovery', () => {
  it('queues from the member move event and requires selecting a legal LIVE target', () => {
    const scenario = setupState({ includeInvalidTargets: true });
    const queued = moveAndQueue(scenario.game, scenario.sourceId, SlotPosition.CENTER);

    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]).toMatchObject({
      abilityId: SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
    });

    const selecting = resolvePendingCardEffects(queued).gameState;
    expect(selecting.activeEffect).toMatchObject({
      abilityId: SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID,
      selectableCardIds: [scenario.validLiveId],
      canSkipSelection: false,
    });

    const state = confirmActiveEffectStepThroughPublicReveal(
      selecting,
      PLAYER1,
      selecting.activeEffect!.id,
      scenario.validLiveId
    );
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).not.toContain(scenario.validLiveId);
    expect(state.players[0].hand.cardIds).toContain(scenario.validLiveId);
  });

  it('consumes the pending ability as a no-op when there is no legal target', () => {
    const scenario = setupState({ includeValidTarget: false, includeInvalidTargets: true });
    const state = resolvePendingCardEffects(
      moveAndQueue(scenario.game, scenario.sourceId, SlotPosition.CENTER)
    ).gameState;

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID &&
          action.payload.step === 'NO_VALID_LOW_SCORE_LIELLA_LIVE'
      )
    ).toBe(true);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('respects per-turn limit after a successful recovery', () => {
    const scenario = setupState();
    const selecting = resolvePendingCardEffects(
      moveAndQueue(scenario.game, scenario.sourceId, SlotPosition.CENTER)
    ).gameState;
    const resolved = confirmActiveEffectStepThroughPublicReveal(
      selecting,
      PLAYER1,
      selecting.activeEffect!.id,
      scenario.validLiveId
    );
    const secondQueued = moveAndQueue(resolved, scenario.sourceId, SlotPosition.LEFT);

    expect(secondQueued.pendingAbilities).toEqual([]);
  });

  it('continues to the next moved-member pending ability after selection resolves', () => {
    const scenario = setupState({ includeBladeMember: true });
    const queued = moveAndQueue(scenario.game, scenario.sourceId, SlotPosition.RIGHT);

    expect(queued.pendingAbilities.map((ability) => ability.abilityId)).toEqual(
      expect.arrayContaining([
        SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID,
        SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
      ])
    );

    const orderSelection = resolvePendingCardEffects(queued).gameState;
    const selectingMei = chooseFirstPendingBySource(orderSelection, scenario.sourceId);
    expect(selectingMei.activeEffect?.abilityId).toBe(
      SP_BP4_007_AUTO_ON_MOVE_RECOVER_LOW_SCORE_LIELLA_LIVE_ABILITY_ID
    );

    const state = confirmActiveEffectStepThroughPublicReveal(
      selectingMei,
      PLAYER1,
      selectingMei.activeEffect!.id,
      scenario.validLiveId
    );
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(true);
  });
});
