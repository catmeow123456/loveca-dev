import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  setActivePlayer,
  setPhase,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import { createActivateAbilityCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'みらくらぱーく！',
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function baseGame(testId: string): GameState {
  return setPhase(createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2'), GamePhase.MAIN_PHASE);
}

function setupHime(options: {
  readonly includeTarget?: 'megu' | 'rurino' | false;
  readonly sourceZone?: ZoneType.HAND | ZoneType.MEMBER_SLOT | ZoneType.WAITING_ROOM;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly drawId: string;
  readonly targetId: string | null;
} {
  const source = createCardInstance(
    createMember('PL!HS-bp6-014-R', '安養寺 姫芽'),
    PLAYER1,
    'bp6-014-source'
  );
  const draw = createCardInstance(createMember('PL!HS-bp6-014-draw', 'Draw'), PLAYER1, 'draw');
  const target =
    options.includeTarget === false
      ? null
      : createCardInstance(
          createMember(
            options.includeTarget === 'rurino' ? 'PL!HS-target-rurino' : 'PL!HS-target-megu',
            options.includeTarget === 'rurino' ? '大沢瑠璃乃' : '藤島慈'
          ),
          PLAYER1,
          'target'
        );

  let game = registerCards(baseGame('hs-bp6-014-hime'), [
    source,
    draw,
    ...(target ? [target] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let nextPlayer = {
      ...player,
      mainDeck: addCardToZone(player.mainDeck, draw.instanceId),
    };
    const sourceZone = options.sourceZone ?? ZoneType.HAND;
    if (sourceZone === ZoneType.HAND) {
      nextPlayer = { ...nextPlayer, hand: addCardToZone(nextPlayer.hand, source.instanceId) };
    } else if (sourceZone === ZoneType.WAITING_ROOM) {
      nextPlayer = {
        ...nextPlayer,
        waitingRoom: addCardToZone(nextPlayer.waitingRoom, source.instanceId),
      };
    } else {
      nextPlayer = {
        ...nextPlayer,
        memberSlots: placeCardInSlot(nextPlayer.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      };
    }
    if (target) {
      nextPlayer = {
        ...nextPlayer,
        memberSlots: placeCardInSlot(nextPlayer.memberSlots, SlotPosition.LEFT, target.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      };
    }
    return nextPlayer;
  });

  return {
    game,
    sourceId: source.instanceId,
    drawId: draw.instanceId,
    targetId: target?.instanceId ?? null,
  };
}

function start(game: GameState, sourceId: string, playerId = PLAYER1): GameState {
  return activateCardAbility(
    game,
    playerId,
    sourceId,
    HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID
  );
}

function enterWaitingRoomEventCards(game: GameState): readonly string[] {
  return game.eventLog.flatMap((entry) =>
    entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      ? (entry.event.cardInstanceIds ?? [entry.event.cardInstanceId])
      : []
  );
}

describe('PL!HS-bp6-014 Hime hand activated workflow', () => {
  it('only starts from hand, not from stage or waiting room', () => {
    const fromHand = setupHime({ includeTarget: 'megu' });
    expect(start(fromHand.game, fromHand.sourceId)).not.toBe(fromHand.game);

    const fromStage = setupHime({ includeTarget: 'megu', sourceZone: ZoneType.MEMBER_SLOT });
    expect(start(fromStage.game, fromStage.sourceId)).toBe(fromStage.game);

    const fromWaiting = setupHime({ includeTarget: 'megu', sourceZone: ZoneType.WAITING_ROOM });
    expect(start(fromWaiting.game, fromWaiting.sourceId)).toBe(fromWaiting.game);
  });

  it('moves itself from hand to waiting room through enter-waiting-room event wrapper and draws one', () => {
    const scenario = setupHime({ includeTarget: 'megu' });

    const state = start(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual([scenario.drawId]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([scenario.sourceId]);
    expect(state.players[0].mainDeck.cardIds).toEqual([]);
    expect(enterWaitingRoomEventCards(state)).toEqual([scenario.sourceId]);
    expect(state.activeEffect).toMatchObject({
      abilityId: HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
      selectableCardIds: [scenario.targetId],
    });
  });

  it('allows the official activate command only when the HAND source card is in hand', () => {
    const handScenario = setupHime({ includeTarget: 'megu' });
    const handSession = createGameSession();
    (handSession as unknown as { authorityState: GameState }).authorityState = handScenario.game;

    const handResult = handSession.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        handScenario.sourceId,
        HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID
      )
    );

    expect(handResult.success).toBe(true);
    expect(handResult.gameState.players[0].hand.cardIds).toEqual([handScenario.drawId]);
    expect(handResult.gameState.activeEffect?.selectableCardIds).toEqual([handScenario.targetId]);

    for (const sourceZone of [ZoneType.MEMBER_SLOT, ZoneType.WAITING_ROOM] as const) {
      const scenario = setupHime({ includeTarget: 'megu', sourceZone });
      const session = createGameSession();
      (session as unknown as { authorityState: GameState }).authorityState = scenario.game;

      const result = session.executeCommand(
        createActivateAbilityCommand(
          PLAYER1,
          scenario.sourceId,
          HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID
        )
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('起动效果来源卡当前不在自己的手牌');
    }
  });

  it('lets Megu or Rurino gain BLADE +1 after the draw', () => {
    const scenario = setupHime({ includeTarget: 'rurino' });
    const started = start(scenario.game, scenario.sourceId);

    const finished = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.targetId
    );

    expect(finished.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(finished, PLAYER1, scenario.targetId!)).toBe(2);
    expect(finished.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'TARGET_MEGU_RURINO_GAIN_BLADE',
      targetCardId: scenario.targetId,
      bladeBonus: 1,
    });
  });

  it('still discards itself and draws one when there is no Megu or Rurino target', () => {
    const scenario = setupHime({ includeTarget: false });

    const state = start(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([scenario.drawId]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([scenario.sourceId]);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DISCARD_SELF_DRAW_ONE_NO_TARGET',
      bladeBonus: 0,
    });
  });

  it('does not start in the wrong phase, for a non-active player, or while another effect is active', () => {
    const scenario = setupHime({ includeTarget: 'megu' });

    const wrongPhase = setPhase(scenario.game, GamePhase.LIVE_PHASE);
    expect(start(wrongPhase, scenario.sourceId)).toBe(wrongPhase);

    const nonActivePlayer = setActivePlayer(scenario.game, 1);
    expect(start(nonActivePlayer, scenario.sourceId)).toBe(nonActivePlayer);

    const withActiveEffect: GameState = {
      ...scenario.game,
      activeEffect: {
        id: 'other-effect',
        abilityId: 'other-ability',
        sourceCardId: 'other-source',
        controllerId: PLAYER1,
        effectText: 'other',
        stepId: 'other-step',
        stepText: 'other',
        awaitingPlayerId: PLAYER1,
      },
    };
    expect(start(withActiveEffect, scenario.sourceId)).toBe(withActiveEffect);
  });
});
