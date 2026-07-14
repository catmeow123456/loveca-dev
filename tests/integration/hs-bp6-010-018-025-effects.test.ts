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
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID,
  HS_BP6_018_LEAVE_STAGE_DISCARD_TARGET_BLUE_HEART_BLADE_ABILITY_ID,
  HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID,
  HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
  cardCode: string,
  name = cardCode,
  options: {
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames ?? ['蓮ノ空'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, score: number, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function baseGame(testId: string): GameState {
  return createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2');
}

function withPending(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  metadata: Readonly<Record<string, unknown>> = {}
): GameState {
  return {
    ...game,
    pendingAbilities: [
      {
        id: `${abilityId}:${sourceCardId}:pending`,
        abilityId,
        sourceCardId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId,
        eventIds: ['manual-event'],
        metadata,
      },
    ],
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirm(game: GameState, selectedCardId?: string | null): GameState {
  return confirmActiveEffectStepThroughPublicReveal(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function stageMember(game: GameState, cardId: string, slot: SlotPosition): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

describe('PL!HS-bp6-010 Sayaka workflow', () => {
  it('can be skipped', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp6-010-R', '村野さやか', { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'bp6-010-source-skip'
    );
    const discard = createCardInstance(
      createMember('PL!HS-bp6-010-discard', 'Discard', { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'bp6-010-discard-skip'
    );
    let game = registerCards(baseGame('bp6-010-skip'), [source, discard]);
    game = stageMember(game, source.instanceId, SlotPosition.CENTER);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
    }));
    game = resolve(
      withPending(
        game,
        HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    game = confirm(game, null);

    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(game.players[0].waitingRoom.cardIds).toEqual([]);
    expect(game.liveResolution.liveModifiers).toEqual([]);
  });

  it('discards only DOLLCHESTRA, draws one, and gives a target member cost +5', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp6-010-R', '村野さやか', { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'bp6-010-source'
    );
    const discard = createCardInstance(
      createMember('PL!HS-bp6-010-doll', 'Doll card', { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'bp6-010-doll'
    );
    const nonDoll = createCardInstance(
      createMember('PL!HS-bp6-010-other', 'Other card', { unitName: 'みらくらぱーく！' }),
      PLAYER1,
      'bp6-010-other'
    );
    const drawCard = createCardInstance(
      createMember('PL!HS-bp6-010-draw', 'Draw card'),
      PLAYER1,
      'bp6-010-draw'
    );
    const remainingDeckCard = createCardInstance(
      createMember('PL!HS-bp6-010-remaining', 'Remaining'),
      PLAYER1,
      'bp6-010-remaining'
    );
    let game = registerCards(baseGame('bp6-010-cost'), [
      source,
      discard,
      nonDoll,
      drawCard,
      remainingDeckCard,
    ]);
    game = stageMember(game, source.instanceId, SlotPosition.CENTER);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId, nonDoll.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId, remainingDeckCard.instanceId] },
    }));
    game = resolve(
      withPending(
        game,
        HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(game.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);
    game = confirm(game, discard.instanceId);
    expect(game.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(game.players[0].hand.cardIds).toContain(drawCard.instanceId);
    expect(game.activeEffect?.selectableCardIds).toEqual([source.instanceId]);

    game = confirm(game, source.instanceId);

    expect(game.activeEffect).toBeNull();
    expect(game.liveResolution.liveModifiers).toContainEqual({
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: source.instanceId,
      sourceCardId: source.instanceId,
      abilityId: HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID,
      countDelta: 5,
    });
  });

  it('keeps the discard and draw when no DOLLCHESTRA stage target remains', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp6-010-R', '村野さやか', { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'bp6-010-source-no-target'
    );
    const discard = createCardInstance(
      createMember('PL!HS-bp6-010-doll-no-target', 'Doll card', { unitName: 'DOLLCHESTRA' }),
      PLAYER1,
      'bp6-010-doll-no-target'
    );
    const drawCard = createCardInstance(
      createMember('PL!HS-bp6-010-draw-no-target', 'Draw card'),
      PLAYER1,
      'bp6-010-draw-no-target'
    );
    const remainingDeckCard = createCardInstance(
      createMember('PL!HS-bp6-010-remaining-no-target', 'Remaining'),
      PLAYER1,
      'bp6-010-remaining-no-target'
    );
    let game = registerCards(baseGame('bp6-010-no-target'), [
      source,
      discard,
      drawCard,
      remainingDeckCard,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId, remainingDeckCard.instanceId] },
    }));
    game = resolve(
      withPending(
        game,
        HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID,
        source.instanceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    game = confirm(game, discard.instanceId);

    expect(game.activeEffect).toBeNull();
    expect(game.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(game.players[0].hand.cardIds).toContain(drawCard.instanceId);
    expect(game.liveResolution.liveModifiers).toEqual([]);
  });
});

describe('PL!HS-bp6-018 Sayaka workflow', () => {
  it('triggers from stage to waiting room and can be skipped', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp6-018-N', '村野さやか'),
      PLAYER1,
      'bp6-018-source-skip'
    );
    const discard = createCardInstance(
      createMember('PL!HS-bp6-018-discard'),
      PLAYER1,
      'bp6-018-discard-skip'
    );
    let game = registerCards(baseGame('bp6-018-skip'), [source, discard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [source.instanceId] },
    }));
    const event = createLeaveStageEvent(
      source.instanceId,
      SlotPosition.CENTER,
      ZoneType.WAITING_ROOM,
      PLAYER1,
      PLAYER1
    );
    game = enqueueTriggeredCardEffects(
      emitGameEvent(game, event),
      [TriggerCondition.ON_LEAVE_STAGE],
      {
        leaveStageEvents: [event],
      }
    );
    game = resolve(game);

    expect(game.activeEffect?.abilityId).toBe(
      HS_BP6_018_LEAVE_STAGE_DISCARD_TARGET_BLUE_HEART_BLADE_ABILITY_ID
    );
    game = confirm(game, null);

    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(game.liveResolution.liveModifiers).toEqual([]);
  });

  it('discards safely, keeps the enter-waiting trigger queued, and gives target blue Heart plus BLADE', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp6-018-N', '村野さやか'),
      PLAYER1,
      'bp6-018-source'
    );
    const autoSource = createCardInstance(
      createMember('PL!HS-pb1-003-P＋', '大沢瑠璃乃', { unitName: 'みらくらぱーく！' }),
      PLAYER1,
      'bp6-018-auto-source'
    );
    const discard = createCardInstance(
      createMember('PL!HS-bp6-018-discard'),
      PLAYER1,
      'bp6-018-discard'
    );
    const target = createCardInstance(
      createMember('PL!HS-bp6-018-target'),
      PLAYER1,
      'bp6-018-target'
    );
    let game = registerCards(baseGame('bp6-018-apply'), [source, autoSource, discard, target]);
    game = stageMember(game, autoSource.instanceId, SlotPosition.LEFT);
    game = stageMember(game, target.instanceId, SlotPosition.RIGHT);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [source.instanceId] },
    }));
    const event = createLeaveStageEvent(
      source.instanceId,
      SlotPosition.CENTER,
      ZoneType.WAITING_ROOM,
      PLAYER1,
      PLAYER1
    );
    game = enqueueTriggeredCardEffects(
      emitGameEvent(game, event),
      [TriggerCondition.ON_LEAVE_STAGE],
      {
        leaveStageEvents: [event],
      }
    );
    game = resolve(game);

    game = confirm(game, discard.instanceId);

    expect(game.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(
      game.pendingAbilities.some(
        (ability) =>
          ability.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(game.activeEffect?.selectableCardIds).toEqual([
      autoSource.instanceId,
      target.instanceId,
    ]);

    game = confirm(game, target.instanceId);

    expect(game.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
      sourceCardId: source.instanceId,
      abilityId: HS_BP6_018_LEAVE_STAGE_DISCARD_TARGET_BLUE_HEART_BLADE_ABILITY_ID,
      target: 'TARGET_MEMBER',
      targetMemberCardId: target.instanceId,
    });
    expect(game.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: target.instanceId,
      abilityId: HS_BP6_018_LEAVE_STAGE_DISCARD_TARGET_BLUE_HEART_BLADE_ABILITY_ID,
    });
  });

  it('no-ops for leave-stage events that do not move to waiting room', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp6-018-N', '村野さやか'),
      PLAYER1,
      'bp6-018-source-hand'
    );
    const discard = createCardInstance(
      createMember('PL!HS-bp6-018-discard-hand'),
      PLAYER1,
      'bp6-018-discard-hand'
    );
    let game = registerCards(baseGame('bp6-018-not-waiting'), [source]);
    game = registerCards(game, [discard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
    }));
    const event = createLeaveStageEvent(
      source.instanceId,
      SlotPosition.CENTER,
      ZoneType.HAND,
      PLAYER1,
      PLAYER1
    );
    game = enqueueTriggeredCardEffects(
      emitGameEvent(game, event),
      [TriggerCondition.ON_LEAVE_STAGE],
      {
        leaveStageEvents: [event],
      }
    );
    game = resolve(game);

    expect(game.pendingAbilities).toHaveLength(0);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(game.liveResolution.liveModifiers).toEqual([]);
  });
});

describe('PL!HS-bp6-025 Tsubasa La Liberte workflow', () => {
  it('LIVE start discards to give a Hasunosora member blue Heart, and skip leaves state unchanged', () => {
    const live = createCardInstance(
      createLive('PL!HS-bp6-025-L', 4, 'ツバサ・ラ・リベルテ'),
      PLAYER1,
      'bp6-025-live-start'
    );
    const discard = createCardInstance(
      createMember('PL!HS-bp6-025-discard'),
      PLAYER1,
      'bp6-025-discard'
    );
    const target = createCardInstance(
      createMember('PL!HS-bp6-025-target'),
      PLAYER1,
      'bp6-025-target'
    );
    let game = registerCards(baseGame('bp6-025-live-start'), [live, discard, target]);
    game = stageMember(game, target.instanceId, SlotPosition.CENTER);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
    }));
    const skipped = confirm(
      resolve(
        withPending(
          game,
          HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID,
          live.instanceId,
          TriggerCondition.ON_LIVE_START
        )
      ),
      null
    );
    expect(skipped.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(skipped.liveResolution.liveModifiers).toEqual([]);

    game = resolve(
      withPending(
        game,
        HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID,
        live.instanceId,
        TriggerCondition.ON_LIVE_START
      )
    );
    game = confirm(game, discard.instanceId);
    expect(game.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    game = confirm(game, target.instanceId);

    expect(game.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(game.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
      sourceCardId: live.instanceId,
      abilityId: HS_BP6_025_LIVE_START_DISCARD_TARGET_HASUNOSORA_BLUE_HEART_ABILITY_ID,
      target: 'TARGET_MEMBER',
      targetMemberCardId: target.instanceId,
    });
  });

  it('LIVE success no-ops with confirm-only realtime text when stage member count is below two', () => {
    const live = createCardInstance(
      createLive('PL!HS-bp6-025-L', 4, 'ツバサ・ラ・リベルテ'),
      PLAYER1,
      'bp6-025-live-success-noop'
    );
    const targetLive = createCardInstance(
      createLive('PL!HS-bp6-025-low-live', 3),
      PLAYER1,
      'bp6-025-low-live'
    );
    const member = createCardInstance(
      createMember('PL!HS-bp6-025-member'),
      PLAYER1,
      'bp6-025-member'
    );
    let game = registerCards(baseGame('bp6-025-success-noop'), [live, targetLive, member]);
    game = stageMember(game, member.instanceId, SlotPosition.CENTER);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [targetLive.instanceId] },
    }));
    game = resolve(
      withPending(
        game,
        HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID,
        live.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS
      )
    );

    expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(game.activeEffect?.effectText).toContain('当前舞台成员1名');
    expect(game.activeEffect?.effectText).toContain('休息室分数3以下LIVE 1张');
    expect(game.activeEffect?.effectText).toContain('不会回收');

    game = confirm(game);

    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(game.players[0].waitingRoom.cardIds).toEqual([targetLive.instanceId]);
  });

  it('LIVE success forces one score <=3 LIVE from waiting room and excludes higher score LIVE', () => {
    const live = createCardInstance(
      createLive('PL!HS-bp6-025-L', 4, 'ツバサ・ラ・リベルテ'),
      PLAYER1,
      'bp6-025-live-success'
    );
    const lowScoreLive = createCardInstance(
      createLive('PL!HS-bp6-025-low-live', 3),
      PLAYER1,
      'bp6-025-low-live-choose'
    );
    const highScoreLive = createCardInstance(
      createLive('PL!HS-bp6-025-high-live', 4),
      PLAYER1,
      'bp6-025-high-live'
    );
    const firstMember = createCardInstance(
      createMember('PL!HS-bp6-025-member-1'),
      PLAYER1,
      'bp6-025-member-1'
    );
    const secondMember = createCardInstance(
      createMember('PL!HS-bp6-025-member-2'),
      PLAYER1,
      'bp6-025-member-2'
    );
    let game = registerCards(baseGame('bp6-025-success-recover'), [
      live,
      lowScoreLive,
      highScoreLive,
      firstMember,
      secondMember,
    ]);
    game = stageMember(game, firstMember.instanceId, SlotPosition.LEFT);
    game = stageMember(game, secondMember.instanceId, SlotPosition.RIGHT);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [lowScoreLive.instanceId, highScoreLive.instanceId],
      },
    }));
    game = resolve(
      withPending(
        game,
        HS_BP6_025_LIVE_SUCCESS_STAGE_TWO_RECOVER_LOW_SCORE_LIVE_ABILITY_ID,
        live.instanceId,
        TriggerCondition.ON_LIVE_SUCCESS
      )
    );

    expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(game.activeEffect?.selectableCardIds).toEqual([lowScoreLive.instanceId]);
    expect(game.activeEffect?.canSkipSelection).toBe(false);

    game = confirm(game, lowScoreLive.instanceId);

    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([lowScoreLive.instanceId]);
    expect(game.players[0].waitingRoom.cardIds).toEqual([highScoreLive.instanceId]);
  });
});
