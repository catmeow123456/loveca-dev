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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_013_ON_ENTER_THREE_AZUNA_DRAW_ONE_ABILITY_ID,
  N_BP7_014_AUTO_LEAVE_STAGE_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_BP7_015_ACTIVATED_SELF_SACRIFICE_RECOVER_MEMBER_ABILITY_ID,
  N_BP7_021_ACTIVATED_SELF_SACRIFICE_RECOVER_LIVE_ABILITY_ID,
  N_BP7_024_ON_ENTER_THREE_R3BIRTH_GAIN_PINK_HEART_ABILITY_ID,
  PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID,
  SP_BP7_019_ON_ENTER_THREE_FIVEYNCRISE_RECOVER_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
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

const P1 = 'player1';
const P2 = 'player2';

function member(
  cardCode: string,
  options: { readonly unitName?: string; readonly groupNames?: readonly string[] } = {}
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string, groupNames: readonly string[] = ['虹ヶ咲']): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: P1,
    timingId,
    sourceSlot,
    eventIds: [`${abilityId}:event`],
  };
}

function putOnStage(game: GameState, cardId: string, slot: SlotPosition): GameState {
  return updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

describe('BP7 simple shared-family additions', () => {
  it("covers Poppin' Up! by base number, including the new SECL printing", () => {
    const effectText =
      '【LIVE成功时】LIVE的合计分数比对方高的场合，从因声援被公开的自己的卡片中，将1张『虹咲』的卡片加入手牌。';
    for (const cardCode of ['PL!N-bp1-026-L', 'PL!N-bp1-026-SECL', 'PL!N-bp1-026-SEC']) {
      expect(getCardAbilityDefinitionsForCardCode(cardCode)).toContainEqual(
        expect.objectContaining({
          abilityId:
            PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID,
          baseCardCodes: ['PL!N-bp1-026'],
          effectText,
          implemented: true,
        })
      );
    }
  });

  it.each([
    [3, true],
    [2, false],
  ] as const)('PL!N-bp7-013 counts current A・ZU・NA stage members (%i)', (count, draws) => {
    const source = createCardInstance(
      member('PL!N-bp7-013-N', { unitName: 'A・ZU・NA' }),
      P1,
      'ayumu'
    );
    const left = createCardInstance(
      member('AZUNA-LEFT', { unitName: 'A・ZU・NA' }),
      P1,
      'azuna-left'
    );
    const right = createCardInstance(
      member('AZUNA-RIGHT', { unitName: count === 3 ? 'A・ZU・NA' : 'DiverDiva' }),
      P1,
      'azuna-right'
    );
    const draw = createCardInstance(member('DRAW'), P1, 'draw');
    let game = registerCards(createGameState('n-bp7-013', P1, 'P1', P2, 'P2'), [
      source,
      left,
      right,
      draw,
    ]);
    game = putOnStage(game, source.instanceId, SlotPosition.CENTER);
    game = putOnStage(game, left.instanceId, SlotPosition.LEFT);
    game = putOnStage(game, right.instanceId, SlotPosition.RIGHT);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [draw.instanceId] },
    }));
    const state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          N_BP7_013_ON_ENTER_THREE_AZUNA_DRAW_ONE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    }).gameState;

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds.includes(draw.instanceId)).toBe(draws);
    expect(state.actionHistory.at(-1)?.payload.step).toBe(
      draws ? 'AZUNA_STAGE_MEMBER_THREE_DRAW_ONE' : 'STAGE_UNIT_MEMBER_COUNT_CONDITION_NOT_MET'
    );
  });

  it('PL!N-bp7-013 resolves from a delegated waiting-room source without a stage slot', () => {
    const source = createCardInstance(
      member('PL!N-bp7-013-N', { unitName: 'A・ZU・NA' }),
      P1,
      'delegated-ayumu'
    );
    const stage = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].map((slot) =>
      createCardInstance(member(`AZUNA-${slot}`, { unitName: 'A・ZU・NA' }), P1, `azuna-${slot}`)
    );
    const draw = createCardInstance(member('DRAW'), P1, 'delegated-draw');
    const spare = createCardInstance(member('SPARE'), P1, 'delegated-spare');
    let game = registerCards(createGameState('n-bp7-013-delegated', P1, 'P1', P2, 'P2'), [
      source,
      ...stage,
      draw,
      spare,
    ]);
    for (const [index, slot] of [
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ].entries()) {
      game = putOnStage(game, stage[index]!.instanceId, slot);
    }
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, source.instanceId),
      mainDeck: { ...player.mainDeck, cardIds: [draw.instanceId, spare.instanceId] },
    }));
    const state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          N_BP7_013_ON_ENTER_THREE_AZUNA_DRAW_ONE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    }).gameState;

    expect(state.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(state.players[0].hand.cardIds).toContain(draw.instanceId);
    expect(state.actionHistory.at(-1)?.payload.step).toBe('AZUNA_STAGE_MEMBER_THREE_DRAW_ONE');
  });

  it('PL!N-bp7-014 offers only a Nijigasaki LIVE after the leave-stage pending', () => {
    const source = createCardInstance(member('PL!N-bp7-014-N'), P1, 'kasumi');
    const legal = createCardInstance(live('N-LIVE'), P1, 'n-live');
    const wrong = createCardInstance(live('S-LIVE', ['Aqours']), P1, 's-live');
    let game = registerCards(createGameState('n-bp7-014', P1, 'P1', P2, 'P2'), [
      source,
      legal,
      wrong,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [source.instanceId, legal.instanceId, wrong.instanceId],
      },
    }));
    const leaveEvent = createLeaveStageEvent(
      source.instanceId,
      SlotPosition.CENTER,
      ZoneType.WAITING_ROOM,
      P1,
      P1
    );
    game = enqueueTriggeredCardEffects(
      emitGameEvent(game, leaveEvent),
      [TriggerCondition.ON_LEAVE_STAGE],
      { leaveStageEvents: [leaveEvent] }
    );
    const state = resolvePendingCardEffects(game).gameState;

    expect(state.activeEffect).toMatchObject({
      abilityId: N_BP7_014_AUTO_LEAVE_STAGE_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      selectableCardIds: [legal.instanceId],
      canSkipSelection: false,
    });
  });

  it('PL!SP-bp7-019 requires three current 5yncri5e! members before recovering a LIVE', () => {
    const source = createCardInstance(
      member('PL!SP-bp7-019-N', { unitName: '5yncri5e!' }),
      P1,
      'shiki'
    );
    const left = createCardInstance(member('FIVE-LEFT', { unitName: '5yncri5e!' }), P1, 'left');
    const right = createCardInstance(member('FIVE-RIGHT', { unitName: '5yncri5e!' }), P1, 'right');
    const target = createCardInstance(live('TARGET-LIVE', ['Liella!']), P1, 'target-live');
    let game = registerCards(createGameState('sp-bp7-019', P1, 'P1', P2, 'P2'), [
      source,
      left,
      right,
      target,
    ]);
    for (const [cardId, slot] of [
      [source.instanceId, SlotPosition.CENTER],
      [left.instanceId, SlotPosition.LEFT],
      [right.instanceId, SlotPosition.RIGHT],
    ] as const) {
      game = putOnStage(game, cardId, slot);
    }
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, target.instanceId),
    }));
    const state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          SP_BP7_019_ON_ENTER_THREE_FIVEYNCRISE_RECOVER_LIVE_ABILITY_ID,
          source.instanceId,
          TriggerCondition.ON_ENTER_STAGE
        ),
      ],
    }).gameState;

    expect(state.activeEffect).toMatchObject({
      abilityId: SP_BP7_019_ON_ENTER_THREE_FIVEYNCRISE_RECOVER_LIVE_ABILITY_ID,
      selectableCardIds: [target.instanceId],
      canSkipSelection: false,
    });
  });

  it.each([
    [3, 2],
    [2, 1],
  ] as const)(
    'PL!N-bp7-024 applies pink Heart only with three R3BIRTH members (%i)',
    (count, pinkCount) => {
      const source = createCardInstance(
        member('PL!N-bp7-024-N', { unitName: 'R3BIRTH' }),
        P1,
        'lanzhu'
      );
      const left = createCardInstance(member('R3-LEFT', { unitName: 'R3BIRTH' }), P1, 'r3-left');
      const right = createCardInstance(
        member('R3-RIGHT', { unitName: count === 3 ? 'R3BIRTH' : 'A・ZU・NA' }),
        P1,
        'r3-right'
      );
      let game = registerCards(createGameState('n-bp7-024', P1, 'P1', P2, 'P2'), [
        source,
        left,
        right,
      ]);
      game = putOnStage(game, source.instanceId, SlotPosition.CENTER);
      game = putOnStage(game, left.instanceId, SlotPosition.LEFT);
      game = putOnStage(game, right.instanceId, SlotPosition.RIGHT);
      const state = resolvePendingCardEffects({
        ...game,
        pendingAbilities: [
          pending(
            N_BP7_024_ON_ENTER_THREE_R3BIRTH_GAIN_PINK_HEART_ABILITY_ID,
            source.instanceId,
            TriggerCondition.ON_ENTER_STAGE
          ),
        ],
      }).gameState;

      expect(
        getMemberEffectiveHeartIcons(state, P1, source.instanceId)
          .filter(({ color }) => color === HeartColor.PINK)
          .reduce((sum, { count: amount }) => sum + amount, 0)
      ).toBe(pinkCount);
    }
  );

  it.each([
    [
      'PL!N-bp7-015-N',
      N_BP7_015_ACTIVATED_SELF_SACRIFICE_RECOVER_MEMBER_ABILITY_ID,
      'WAITING-MEMBER',
      CardType.MEMBER,
    ],
    [
      'PL!N-bp7-021-N',
      N_BP7_021_ACTIVATED_SELF_SACRIFICE_RECOVER_LIVE_ABILITY_ID,
      'WAITING-LIVE',
      CardType.LIVE,
    ],
  ] as const)(
    '%s pays self-sacrifice first and requires one matching recovery target',
    (cardCode, abilityId, targetCode, targetType) => {
      const source = createCardInstance(member(cardCode), P1, 'source');
      const target = createCardInstance(
        targetType === CardType.MEMBER ? member(targetCode) : live(targetCode),
        P1,
        'target'
      );
      let game = registerCards(createGameState(cardCode, P1, 'P1', P2, 'P2'), [source, target]);
      game = { ...game, currentPhase: GamePhase.MAIN_PHASE };
      game = putOnStage(game, source.instanceId, SlotPosition.CENTER);
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        waitingRoom: addCardToZone(player.waitingRoom, target.instanceId),
      }));

      const state = activateCardAbility(game, P1, source.instanceId, abilityId);
      expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
      expect(state.players[0].waitingRoom.cardIds).toContain(source.instanceId);
      expect(state.activeEffect).toMatchObject({
        abilityId,
        canSkipSelection: false,
      });
      expect(state.activeEffect?.selectableCardIds).toContain(target.instanceId);
    }
  );
});
