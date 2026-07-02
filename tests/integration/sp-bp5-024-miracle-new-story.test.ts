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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function live(): LiveCardData {
  return {
    cardCode: 'PL!SP-bp5-024-L',
    name: 'MIRACLE NEW STORY',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 7,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp5-024-pending',
    abilityId: SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
  };
}

function setup(movedMemberIds: readonly string[] = []): {
  readonly game: GameState;
  readonly liveId: string;
  readonly movedLeftId: string;
  readonly movedCenterId: string;
  readonly unmovedRightId: string;
} {
  const sourceLive = createCardInstance(live(), PLAYER1, 'miracle-new-story');
  const movedLeft = createCardInstance(member('PL!SP-test-left'), PLAYER1, 'moved-left');
  const movedCenter = createCardInstance(member('PL!SP-test-center'), PLAYER1, 'moved-center');
  const unmovedRight = createCardInstance(member('PL!SP-test-right'), PLAYER1, 'unmoved-right');
  let game = createGameState('sp-bp5-024-miracle-new-story', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, movedLeft, movedCenter, unmovedRight]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, sourceLive.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, movedLeft.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.CENTER,
        movedCenter.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      SlotPosition.RIGHT,
      unmovedRight.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
    positionMovedThisTurn: [...movedMemberIds],
  }));
  return {
    game: { ...game, pendingAbilities: [pending(sourceLive.instanceId)] },
    liveId: sourceLive.instanceId,
    movedLeftId: movedLeft.instanceId,
    movedCenterId: movedCenter.instanceId,
    unmovedRightId: unmovedRight.instanceId,
  };
}

function heartModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId === SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID
  );
}

describe('PL!SP-bp5-024 MIRACLE NEW STORY live-start workflow', () => {
  it('opens a color choice and gives the selected Heart to all moved stage members', () => {
    const scenario = setup(['moved-left', 'moved-center']);

    const started = resolvePendingCardEffects(scenario.game).gameState;
    expect(started.activeEffect?.selectableOptions).toEqual([
      { id: 'pink', label: '选择[桃ハート]' },
      { id: 'red', label: '选择[赤ハート]' },
      { id: 'purple', label: '选择[紫ハート]' },
    ]);

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'red'
    );

    expect(heartModifiers(resolved)).toEqual(
      expect.arrayContaining([
        {
          kind: 'HEART',
          target: 'TARGET_MEMBER',
          playerId: PLAYER1,
          sourceCardId: scenario.liveId,
          targetMemberCardId: scenario.movedLeftId,
          abilityId: SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID,
          hearts: [{ color: HeartColor.RED, count: 1 }],
        },
        {
          kind: 'HEART',
          target: 'TARGET_MEMBER',
          playerId: PLAYER1,
          sourceCardId: scenario.liveId,
          targetMemberCardId: scenario.movedCenterId,
          abilityId: SP_BP5_024_LIVE_START_CHOOSE_HEART_FOR_MOVED_STAGE_MEMBERS_ABILITY_ID,
          hearts: [{ color: HeartColor.RED, count: 1 }],
        },
      ])
    );
    expect(
      heartModifiers(resolved).some(
        (modifier) => modifier.kind === 'HEART' && modifier.targetMemberCardId === scenario.unmovedRightId
      )
    ).toBe(false);
  });

  it('consumes pending without opening a color choice when no current stage member moved', () => {
    const scenario = setup([]);

    const resolved = resolvePendingCardEffects(scenario.game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(heartModifiers(resolved)).toEqual([]);
  });

  it('does not add Heart if the source LIVE leaves liveZone after color choice opens', () => {
    const scenario = setup(['moved-left']);
    const started = resolvePendingCardEffects(scenario.game).gameState;
    expect(started.activeEffect).not.toBeNull();
    const sourceGone = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.liveId),
    }));

    const resolved = confirmActiveEffectStep(
      sourceGone,
      PLAYER1,
      sourceGone.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'red'
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(heartModifiers(resolved)).toEqual([]);
  });
});
