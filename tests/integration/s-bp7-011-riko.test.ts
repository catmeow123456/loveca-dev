import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  getActivatedAbilityUiConfigs,
} from '../../src/application/card-effect-runner';
import { S_BP7_011_ACTIVATED_WAIT_SELF_MILL_BOTTOM_TWO_ALL_AQOURS_MEMBERS_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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
const SOURCE_ID = 's-bp7-011-source';
const ABILITY_ID =
  S_BP7_011_ACTIVATED_WAIT_SELF_MILL_BOTTOM_TWO_ALL_AQOURS_MEMBERS_ACTIVATE_GAIN_TWO_BLADE_ABILITY_ID;
const ABILITY_USE_STEP = 'ABILITY_USE';
const EFFECT_TEXT =
  '【起动】【1回合1次】将此成员变为待机状态：将自己的卡组底的2张卡片放置入休息室。那些全部为『Aqours』的成员卡的场合，将此成员变为活跃状态，LIVE结束时为止，获得[ブレード][ブレード]。';

function member(
  cardCode: string,
  instanceId: string,
  groupNames: readonly string[] = ['Aqours']
): CardInstance {
  const data: MemberCardData = {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: cardCode.startsWith('PL!S-bp7-011') ? 7 : 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, P1, instanceId);
}

function live(cardCode: string, instanceId: string): CardInstance {
  const data: LiveCardData = {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
  return createCardInstance(data, P1, instanceId);
}

function setup(
  options: {
    readonly sourceCode?: string;
    readonly orientation?: OrientationState;
    readonly deck?: readonly CardInstance[];
    readonly waiting?: readonly CardInstance[];
  } = {}
): GameState {
  const source = member(options.sourceCode ?? 'PL!S-bp7-011-N', SOURCE_ID);
  const deck = options.deck ?? [
    member('TEST-TOP', 'top'),
    member('TEST-A', 'a'),
    member('TEST-B', 'b'),
  ];
  const waiting = options.waiting ?? [];
  let game = registerCards(createGameState('s-bp7-011-riko', P1, 'P1', P2, 'P2'), [
    source,
    ...deck,
    ...waiting,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: options.orientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { ...game, currentPhase: GamePhase.MAIN_PHASE };
}

function player(game: GameState) {
  return game.players.find((candidate) => candidate.id === P1)!;
}

function sourceOrientation(game: GameState) {
  return player(game).memberSlots.cardStates.get(SOURCE_ID)?.orientation;
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === ABILITY_ID
  );
}

describe('PL!S-bp7-011-N 费用7「樱内梨子」起动效果', () => {
  it('按基础编号覆盖全罕度，activatedUi 直接展示完整中文卡文', () => {
    for (const cardCode of ['PL!S-bp7-011-N', 'PL!S-bp7-011-FOIL']) {
      expect(getCardAbilityDefinitionsForCardCode(cardCode)).toEqual([
        expect.objectContaining({
          abilityId: ABILITY_ID,
          baseCardCodes: ['PL!S-bp7-011'],
          perTurnLimit: 1,
          effectText: EFFECT_TEXT,
        }),
      ]);
    }
    expect(getActivatedAbilityUiConfigs('PL!S-bp7-011-N')).toEqual([
      expect.objectContaining({ abilityId: ABILITY_ID, text: EFFECT_TEXT }),
    ]);
  });

  it('先支付来源 WAIT 费用，底牌公开展示完成前不再活跃且不获得 BLADE', () => {
    const started = activateCardAbility(setup(), P1, SOURCE_ID, ABILITY_ID);

    expect(sourceOrientation(started)).toBe(OrientationState.WAITING);
    expect(player(started).mainDeck.cardIds).toEqual(['top']);
    expect(player(started).waitingRoom.cardIds).toEqual(['b', 'a']);
    expect(started.activeEffect).toMatchObject({
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      effectText: EFFECT_TEXT,
      revealedCardIds: ['b', 'a'],
    });
    expect(started.activeEffect?.stepText).toContain('这些卡全部为『Aqours』的成员卡。展示结束后');
    expect(bladeModifiers(started)).toEqual([]);
    for (const viewerId of [P1, P2]) {
      expect(projectPlayerViewState(started, viewerId).activeEffect?.revealedObjectIds).toEqual([
        createPublicObjectId('b'),
        createPublicObjectId('a'),
      ]);
    }

    const waitingEvents = started.eventLog.filter(
      ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(waitingEvents).toHaveLength(1);
    expect(waitingEvents[0]?.event).toMatchObject({
      cardInstanceIds: ['b', 'a'],
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: SOURCE_ID,
        abilityId: ABILITY_ID,
      },
    });
    const sourceStateEvents = started.eventLog.filter(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        event.cardInstanceId === SOURCE_ID
    );
    expect(sourceStateEvents).toHaveLength(1);
    const waitEvent = sourceStateEvents[0]?.event;
    if (!waitEvent || waitEvent.eventType !== TriggerCondition.ON_MEMBER_STATE_CHANGED) {
      throw new Error('未找到来源成员支付 WAIT 费用的状态变化事件');
    }
    expect(waitEvent.previousOrientation).toBe(OrientationState.ACTIVE);
    expect(waitEvent.nextOrientation).toBe(OrientationState.WAITING);
    expect(started.actionHistory).toContainEqual(
      expect.objectContaining({ type: 'PAY_COST', playerId: P1 })
    );
    expect(
      started.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY_ID && action.payload.step === ABILITY_USE_STEP
      )
    ).toBe(true);
  });

  it('两张均为 Aqours 成员时展示后再活跃来源、获得 BLADE +2，且同回合不能再发动', () => {
    const started = activateCardAbility(setup(), P1, SOURCE_ID, ABILITY_ID);
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);

    expect(done.activeEffect).toBeNull();
    expect(sourceOrientation(done)).toBe(OrientationState.ACTIVE);
    expect(bladeModifiers(done)).toEqual([
      expect.objectContaining({
        target: 'SOURCE_MEMBER',
        playerId: P1,
        sourceCardId: SOURCE_ID,
        countDelta: 2,
      }),
    ]);
    expect(
      done.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          event.cardInstanceId === SOURCE_ID
      )
    ).toHaveLength(2);

    const repeated = activateCardAbility(done, P1, SOURCE_ID, ABILITY_ID);
    expect(repeated).toBe(done);
  });

  it.each([
    ['Aqours LIVE', live('TEST-LIVE', 'mismatch')],
    ['其他团体成员', member('TEST-OTHER', 'mismatch', ['虹咲'])],
  ])('底牌中包含%s时仍保留 WAIT 费用，但不再活跃、不获得 BLADE', (_label, mismatch) => {
    const game = setup({ deck: [member('TEST-TOP', 'top'), member('TEST-A', 'a'), mismatch] });
    const started = activateCardAbility(game, P1, SOURCE_ID, ABILITY_ID);
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);

    expect(player(done).waitingRoom.cardIds).toEqual(['mismatch', 'a']);
    expect(player(done).mainDeck.cardIds).toEqual(['top']);
    expect(sourceOrientation(done)).toBe(OrientationState.WAITING);
    expect(bladeModifiers(done)).toEqual([]);
    expect(
      done.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY_ID && action.payload.step === ABILITY_USE_STEP
      )
    ).toBe(true);
  });

  it('卡组和休息室都无牌时仍可合法支付 WAIT，不反向阻止发动', () => {
    const done = activateCardAbility(setup({ deck: [], waiting: [] }), P1, SOURCE_ID, ABILITY_ID);

    expect(done.activeEffect).toBeNull();
    expect(sourceOrientation(done)).toBe(OrientationState.WAITING);
    expect(player(done).mainDeck.cardIds).toEqual([]);
    expect(player(done).waitingRoom.cardIds).toEqual([]);
    expect(bladeModifiers(done)).toEqual([]);
    expect(done.actionHistory).toContainEqual(
      expect.objectContaining({ type: 'PAY_COST', playerId: P1 })
    );
    expect(
      done.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY_ID && action.payload.step === ABILITY_USE_STEP
      )
    ).toBe(true);
  });

  it('依 refresh 后实际移动的两张判定，既有 WAIT 费用与 ability use 不回滚', () => {
    const game = setup({
      deck: [member('TEST-INITIAL', 'initial')],
      waiting: [member('TEST-REFRESH-A', 'refresh-a'), member('TEST-REFRESH-B', 'refresh-b')],
    });
    const started = activateCardAbility(game, P1, SOURCE_ID, ABILITY_ID);

    const millAction = started.actionHistory.find(
      (action) =>
        action.payload.abilityId === ABILITY_ID &&
        action.payload.step === 'MILL_BOTTOM_TWO_AFTER_WAIT_COST'
    );
    expect(millAction?.payload.refreshCount).toEqual(expect.any(Number));
    expect(millAction?.payload.refreshCount).not.toBe(0);
    const movedCardIds = Array.isArray(millAction?.payload.movedCardIds)
      ? millAction.payload.movedCardIds.filter(
          (cardId): cardId is string => typeof cardId === 'string'
        )
      : [];
    expect(movedCardIds).toHaveLength(2);
    expect(started.activeEffect?.revealedCardIds).toEqual([...new Set(movedCardIds)]);
    expect(sourceOrientation(started)).toBe(OrientationState.WAITING);
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(sourceOrientation(done)).toBe(OrientationState.ACTIVE);
    expect(bladeModifiers(done)).toHaveLength(1);
  });

  it('公开展示期间来源离场时，已支付费用、底牌移动与次数保留，但不替换目标也不给 BLADE', () => {
    let started = activateCardAbility(setup(), P1, SOURCE_ID, ABILITY_ID);
    started = updatePlayer(started, P1, (currentPlayer) => ({
      ...currentPlayer,
      memberSlots: removeCardFromSlot(currentPlayer.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...currentPlayer.waitingRoom,
        cardIds: [...currentPlayer.waitingRoom.cardIds, SOURCE_ID],
      },
    }));
    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);

    expect(done.activeEffect).toBeNull();
    expect(player(done).waitingRoom.cardIds).toEqual(['b', 'a', SOURCE_ID]);
    expect(bladeModifiers(done)).toEqual([]);
    expect(
      done.actionHistory.some(
        (action) =>
          action.payload.abilityId === ABILITY_ID && action.payload.step === ABILITY_USE_STEP
      )
    ).toBe(true);
  });

  it('非主要阶段、非活跃来源或伪造卡号均不能支付费用', () => {
    const notMain: GameState = { ...setup(), currentPhase: GamePhase.PERFORMANCE_PHASE };
    expect(activateCardAbility(notMain, P1, SOURCE_ID, ABILITY_ID)).toBe(notMain);

    const waiting = setup({ orientation: OrientationState.WAITING });
    expect(activateCardAbility(waiting, P1, SOURCE_ID, ABILITY_ID)).toBe(waiting);

    const wrongCode = setup({ sourceCode: 'PL!S-bp7-010-N' });
    expect(activateCardAbility(wrongCode, P1, SOURCE_ID, ABILITY_ID)).toBe(wrongCode);
  });
});
