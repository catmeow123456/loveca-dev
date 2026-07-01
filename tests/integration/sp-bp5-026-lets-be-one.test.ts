import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addHeartLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { GameService } from '../../src/application/game-service';
import { SP_BP5_026_LIVE_START_LIELLA_STAGE_HEART_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(): LiveCardData {
  return {
    cardCode: 'PL!SP-bp5-026-L',
    name: "Let's be ONE",
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function member(cardCode: string, hearts: number, groupNames: readonly string[] = ['Liella!']): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, hearts)],
  };
}

function setup(options: { readonly sourceInLiveZone?: boolean; readonly withModifier?: boolean }) {
  const sourceLive = createCardInstance(live(), PLAYER1, 'lets-be-one');
  const left = createCardInstance(member('PL!SP-test-left', 4), PLAYER1, 'left');
  const center = createCardInstance(member('PL!SP-test-center', 4), PLAYER1, 'center');
  const right = createCardInstance(member('PL!SP-test-right', 2), PLAYER1, 'right');
  const nonLiella = createCardInstance(member('PL!N-test-other', 10, ['虹ヶ咲']), PLAYER1, 'other');
  let game = createGameState('sp-bp5-026-lets-be-one', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, left, center, right, nonLiella]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, sourceLive.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, left.instanceId),
        SlotPosition.CENTER,
        center.instanceId
      ),
      SlotPosition.RIGHT,
      options.withModifier ? right.instanceId : nonLiella.instanceId
    ),
  }));
  if (options.withModifier) {
    game =
      addHeartLiveModifierForMember(game, {
        playerId: PLAYER1,
        memberCardId: right.instanceId,
        sourceCardId: sourceLive.instanceId,
        abilityId: 'test:add-one-heart',
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      })?.gameState ?? game;
  }
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 1]]),
    },
  };
  return { game, sourceLive };
}

function resolveLiveStart(game: GameState): GameState {
  const timing = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(timing.success).toBe(true);
  return confirmIfConfirmOnly(timing.gameState, PLAYER1);
}

function letsBeOneScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        SP_BP5_026_LIVE_START_LIELLA_STAGE_HEART_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID
  );
}

describe("PL!SP-bp5-026 Let's be ONE live-start workflow", () => {
  it('adds SCORE +1 to this LIVE when Liella stage effective Hearts are at least eleven', () => {
    const { game, sourceLive } = setup({ withModifier: true });

    const resolved = resolveLiveStart(game);

    expect(letsBeOneScoreModifiers(resolved)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: sourceLive.instanceId,
        sourceCardId: sourceLive.instanceId,
        abilityId: SP_BP5_026_LIVE_START_LIELLA_STAGE_HEART_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('consumes pending without SCORE when the Heart total is below eleven or source left liveZone', () => {
    const below = resolveLiveStart(setup({ withModifier: false }).game);
    expect(letsBeOneScoreModifiers(below)).toEqual([]);
    expect(below.pendingAbilities).toEqual([]);

    const sourceGone = resolveLiveStart(setup({ sourceInLiveZone: false, withModifier: true }).game);
    expect(letsBeOneScoreModifiers(sourceGone)).toEqual([]);
    expect(sourceGone.pendingAbilities).toEqual([]);
  });
});
