import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function member(code: string, id: string, groupNames: readonly string[] = ['Liella!'], owner = P1) {
  return createCardInstance<MemberCardData>(
    {
      cardCode: code,
      name: id,
      groupNames,
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 2,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    owner,
    id
  );
}

function live(code: string, id: string, groupNames: readonly string[] = ['Liella!'], owner = P1) {
  return createCardInstance<LiveCardData>(
    {
      cardCode: code,
      name: id,
      groupNames,
      cardType: CardType.LIVE,
      score: 2,
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    },
    owner,
    id
  );
}

function energy(id: string) {
  return createCardInstance<EnergyCardData>(
    { cardCode: `ENERGY-${id}`, name: id, cardType: CardType.ENERGY },
    P1,
    id
  );
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp2-005-pending',
    abilityId: SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  readonly activeEnergy?: number;
  readonly mainDeck?: readonly CardInstance[];
  readonly waitingRoom?: readonly CardInstance[];
} = {}) {
  const source = member('PL!SP-bp2-005-P', 'ren-source');
  const energies = Array.from({ length: 3 }, (_, index) => energy(`energy-${index}`));
  const mainDeck = [...(options.mainDeck ?? [])];
  const waitingRoom = [...(options.waitingRoom ?? [])];
  let game = registerCards(
    createGameState('sp-bp2-005-ren', P1, 'P1', P2, 'P2'),
    [source, ...energies, ...mainDeck, ...waitingRoom]
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: {
      ...player.energyZone,
      cardIds: energies.map((card) => card.instanceId),
      cardStates: new Map(
        energies.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.activeEnergy ?? 2)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    mainDeck: { ...player.mainDeck, cardIds: mainDeck.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingRoom.map((card) => card.instanceId),
    },
  }));
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    source,
    energies,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseOption(game: GameState, optionId?: string): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    optionId
  );
}

function chooseCard(game: GameState, cardId?: string | null): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}

describe('PL!SP-bp2-005 P/R 费用4「葉月 恋」', () => {
  it('支付确认前不改变能量或卡牌，并且只有一个负向入口', () => {
    const top = member('PL!SP-test-member', 'liella-member');
    const scenario = setup({ mainDeck: [top] });
    const state = start(scenario.game);

    expect(state.activeEffect).toMatchObject({
      stepText: '可以支付[E][E]：检视自己卡组顶的7张卡。',
      selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(state.activeEffect?.selectableOptions?.some((option) => option.label === '不发动')).toBe(
      false
    );
    expect(state.inspectionZone.cardIds).toEqual([]);
    expect(state.players[0].mainDeck.cardIds).toEqual([top.instanceId]);
    expect(scenario.energies.map((card) => state.players[0].energyZone.cardStates.get(card.instanceId)?.orientation)).toEqual([
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.WAITING,
    ]);
  });

  it('不发动时不支付、不检视且消费 pending', () => {
    const scenario = setup({ mainDeck: [member('PL!SP-test-member', 'top')] });
    const done = chooseOption(start(scenario.game));

    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('当前窗口结束后继续下一个 pending', () => {
    const scenario = setup({ mainDeck: [member('PL!SP-test-member', 'top')] });
    const nextPending = { ...pending(scenario.source.instanceId), id: 'next-pending' };
    const started = start({ ...scenario.game, pendingAbilities: [pending(scenario.source.instanceId), nextPending] });
    const continued = chooseOption(started);

    expect(continued.activeEffect).toMatchObject({
      abilityId: 'system:select-pending-card-effect',
      stepText: '选择下一个待处理效果',
    });
    expect(continued.pendingAbilities).toContainEqual(nextPending);
  });

  it('能量不足不打开空窗口，确认支付前来源离场也不支付或检视', () => {
    const insufficient = start(setup({ activeEnergy: 1 }).game);
    expect(insufficient.activeEffect).toBeNull();
    expect(insufficient.pendingAbilities).toEqual([]);

    const scenario = setup({ mainDeck: [member('PL!SP-test-member', 'top')] });
    const started = start(scenario.game);
    const invalidated = updatePlayer(started, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const done = chooseOption(invalidated, 'pay');
    expect(done.activeEffect).toBeNull();
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('支付恰好2张活跃能量，记录 PAY_COST，并私密检视至多7张的 Liella! 成员和 LIVE', () => {
    const liellaMember = member('PL!SP-test-member', 'liella-member');
    const liellaLive = live('PL!SP-test-live', 'liella-live');
    const nonLiella = member('PL!N-test-member', 'non-liella', ['虹ヶ咲']);
    const opponentLiella = member('PL!SP-opponent', 'opponent-liella', ['Liella!'], P2);
    const extras = Array.from({ length: 5 }, (_, index) =>
      member(`PL!N-extra-${index}`, `extra-${index}`, ['虹ヶ咲'])
    );
    const scenario = setup({
      mainDeck: [liellaMember, liellaLive, nonLiella, opponentLiella, ...extras],
    });
    const inspected = chooseOption(start(scenario.game), 'pay');

    expect(inspected.activeEffect).toMatchObject({
      inspectionCardIds: [
        liellaMember.instanceId,
        liellaLive.instanceId,
        nonLiella.instanceId,
        opponentLiella.instanceId,
        ...extras.slice(0, 3).map((card) => card.instanceId),
      ],
      selectableCardIds: [liellaMember.instanceId, liellaLive.instanceId],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: true,
      skipSelectionLabel: '不加入',
    });
    expect(inspected.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(inspected.players[0].energyZone.cardStates.get('energy-1')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(inspected.actionHistory.find((action) => action.type === 'PAY_COST')?.payload).toMatchObject({
      abilityId: SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
      energyCardIds: ['energy-0', 'energy-1'],
      amount: 2,
    });
  });

  it('无 Liella! 候选时显示稳定提示并可确认将全部放置入休息室', () => {
    const nonLiella = member('PL!N-test-member', 'non-liella', ['虹ヶ咲']);
    const state = chooseOption(start(setup({ mainDeck: [nonLiella] }).game), 'pay');

    expect(state.activeEffect).toMatchObject({
      stepText:
        '没有可加入手牌的『Liella!』卡片。确认后其余卡片放置入休息室。',
      selectableCardIds: [],
      skipSelectionLabel: '确认',
    });
  });

  it('可以选择0张，将全部 inspected cards 作为一组 MAIN_DECK -> WAITING_ROOM 事件移动', () => {
    const cards = [
      member('PL!SP-test-member', 'liella-member'),
      member('PL!N-test-member', 'non-liella', ['虹ヶ咲']),
    ];
    const inspected = chooseOption(start(setup({ mainDeck: cards }).game), 'pay');
    const done = chooseCard(inspected, null);

    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).toEqual(cards.map((card) => card.instanceId));
    const event = done.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        entry.event.fromZone === ZoneType.MAIN_DECK
    )?.event;
    expect(event).toMatchObject({
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cardInstanceIds: cards.map((card) => card.instanceId),
    });
  });

  it('选择1张后先只公开，最终确认才入手并移动 remainder', () => {
    const selected = live('PL!SP-test-live', 'selected-live');
    const remainder = member('PL!N-test-member', 'remainder', ['虹ヶ咲']);
    const inspected = chooseOption(start(setup({ mainDeck: [selected, remainder] }).game), 'pay');
    const revealed = chooseCard(inspected, selected.instanceId);

    expect(revealed.inspectionZone.revealedCardIds).toContain(selected.instanceId);
    expect(revealed.players[0].hand.cardIds).not.toContain(selected.instanceId);
    expect(revealed.players[0].waitingRoom.cardIds).toEqual([]);
    expect(revealed.activeEffect).toMatchObject({
      stepText:
        '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。',
      selectableCardIds: [],
      canSkipSelection: false,
    });

    const revealEffectId = revealed.activeEffect!.id;
    const done = chooseCard(revealed);
    expect(done.players[0].hand.cardIds).toContain(selected.instanceId);
    expect(done.players[0].waitingRoom.cardIds).toEqual([remainder.instanceId]);
    const waitingEvents = done.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(waitingEvents).toHaveLength(1);
    expect(waitingEvents[0]?.event.cardInstanceIds).toEqual([remainder.instanceId]);
    expect(waitingEvents[0]?.event.cardInstanceIds).not.toContain(selected.instanceId);
    expect(confirmActiveEffectStep(done, P1, revealEffectId)).toBe(done);
  });

  it('拒绝非候选、重复和 stale 输入，不移动也不推进窗口', () => {
    const selected = member('PL!SP-test-member', 'selected');
    const nonCandidate = member('PL!N-test-member', 'non-candidate', ['虹ヶ咲']);
    const started = chooseOption(start(setup({ mainDeck: [selected, nonCandidate] }).game), 'pay');
    expect(chooseCard(started, nonCandidate.instanceId)).toBe(started);
    expect(
      confirmActiveEffectStep(
        started,
        P1,
        started.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [selected.instanceId, selected.instanceId]
      )
    ).toBe(started);

    const revealed = chooseCard(started, selected.instanceId);
    const stale = {
      ...revealed,
      inspectionZone: {
        ...revealed.inspectionZone,
        cardIds: revealed.inspectionZone.cardIds.filter((id) => id !== selected.instanceId),
      },
    };
    expect(chooseCard(stale)).toBe(stale);
    expect(stale.players[0].hand.cardIds).not.toContain(selected.instanceId);
    expect(stale.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('牌库不足7张与主卡组空但休息室可 refresh 都沿用 inspectTopCards，付费后无卡不退费', () => {
    const shortCards = [member('PL!SP-test-a', 'a'), live('PL!SP-test-b', 'b')];
    const short = chooseOption(start(setup({ mainDeck: shortCards }).game), 'pay');
    expect(short.activeEffect?.inspectionCardIds).toEqual(shortCards.map((card) => card.instanceId));

    const refreshCards = [member('PL!SP-refresh-a', 'refresh-a'), live('PL!SP-refresh-b', 'refresh-b')];
    const refreshed = chooseOption(start(setup({ mainDeck: [], waitingRoom: refreshCards }).game), 'pay');
    expect(new Set(refreshed.activeEffect?.inspectionCardIds)).toEqual(
      new Set(refreshCards.map((card) => card.instanceId))
    );
    expect(refreshed.players[0].waitingRoom.cardIds).toEqual([]);

    const emptyScenario = setup({ mainDeck: [], waitingRoom: [] });
    const emptyDone = chooseOption(start(emptyScenario.game), 'pay');
    expect(emptyDone.activeEffect).toBeNull();
    expect(emptyDone.pendingAbilities).toEqual([]);
    expect(emptyDone.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(emptyDone.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(true);
  });
});
