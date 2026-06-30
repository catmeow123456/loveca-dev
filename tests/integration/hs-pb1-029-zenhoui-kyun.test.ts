import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { GameService } from '../../src/application/game-service';
import { HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMiraCraMember(cardCode: string, heartCount = 1): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'みらくらぱーく！',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, heartCount)],
  };
}

function createLive(cardCode = 'PL!HS-pb1-029-L'): LiveCardData {
  return {
    cardCode,
    name: '全方位キュン♡',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'みらくらぱーく！',
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 4,
      [HeartColor.GREEN]: 1,
      [HeartColor.BLUE]: 1,
      [HeartColor.RAINBOW]: 8,
    }),
  };
}

function runLiveStart(extraHeartMemberIndexes: readonly number[], printedRich = false) {
  const live = createCardInstance(createLive(), PLAYER1, 'zenhoui-live');
  const drawCard = createCardInstance(createMiraCraMember('DRAW-CARD'), PLAYER1, 'draw-card');
  const members = [
    createCardInstance(createMiraCraMember('MIRACRA-1'), PLAYER1, 'miracra-1'),
    createCardInstance(createMiraCraMember('MIRACRA-2'), PLAYER1, 'miracra-2'),
    createCardInstance(createMiraCraMember('MIRACRA-PRINTED-RICH', 3), PLAYER1, 'miracra-rich'),
  ];
  const stageMembers = printedRich ? members : members.slice(0, 2);

  let game = createGameState('hs-pb1-029-zenhoui-kyun', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, drawCard, ...stageMembers]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    stageMembers.forEach((member, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
        member.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
    });
    return {
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      hand: { ...player.hand, cardIds: [] },
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots,
    };
  });

  for (const index of extraHeartMemberIndexes) {
    const member = members[index];
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: member.instanceId,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
      sourceCardId: 'pre-existing-heart-source',
      abilityId: 'pre-existing-heart',
    });
  }

  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return { state: result.gameState, live, drawCard, members };
}

describe('HS-pb1-029 全方位キュン♡ workflow', () => {
  it('does not draw or reduce requirement when no Mira-Cra member has extra effective Heart', () => {
    const { state, live, drawCard } = runLiveStart([]);

    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.players[0].mainDeck.cardIds).toEqual([drawCard.instanceId]);
    expect(state.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'REQUIREMENT',
        sourceCardId: live.instanceId,
        abilityId: HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID,
      })
    );
  });

  it('draws one card but does not reduce requirement when one Mira-Cra member has extra Heart', () => {
    const { state, live, drawCard } = runLiveStart([0]);

    expect(state.players[0].hand.cardIds).toEqual([drawCard.instanceId]);
    expect(state.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'REQUIREMENT',
        sourceCardId: live.instanceId,
        abilityId: HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID,
      })
    );
  });

  it('draws one and reduces rainbow requirement by two when two Mira-Cra members have extra effective Heart', () => {
    const { state, live, drawCard, members } = runLiveStart([0, 1], true);

    expect(state.players[0].hand.cardIds).toEqual([drawCard.instanceId]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: live.instanceId,
      abilityId: HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_029_LIVE_START_DRAW_REDUCE_REQUIREMENT_BY_EXTRA_HEART_MIRACRA_ABILITY_ID &&
          action.payload.extraHeartMiraCraMemberCount === 2 &&
          Array.isArray(action.payload.extraHeartMiraCraMemberIds) &&
          !action.payload.extraHeartMiraCraMemberIds.includes(members[2].instanceId)
      )
    ).toBe(true);
  });
});
