import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP7_010_ON_ENTER_LOOK_BOTTOM_ONE_OPTIONAL_DECK_FOURTH_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';

const P1 = 'player1';
const P2 = 'player2';
const SOURCE_ID = 's-bp7-010-source';
const ABILITY_ID = S_BP7_010_ON_ENTER_LOOK_BOTTOM_ONE_OPTIONAL_DECK_FOURTH_ABILITY_ID;
const PLACE_OPTION_ID = 'place-fourth-from-top';
const KEEP_BOTTOM_OPTION_ID = 'keep-at-bottom';

function member(
  cardCode: string,
  ownerId = P1,
  instanceId = cardCode
): ReturnType<typeof createCardInstance> {
  const data: MemberCardData = {
    cardCode,
    name: cardCode === 'PL!S-bp7-010-N' ? '高海千歌' : cardCode,
    groupNames: ['Aqours', 'CYaRon!'],
    cardType: CardType.MEMBER,
    cost: cardCode.startsWith('PL!S-bp7-010') ? 4 : 1,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, ownerId, instanceId);
}

function pending(id = 'pending:s-bp7-010', sourceCardId = SOURCE_ID): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    readonly deckCardIds?: readonly string[];
    readonly waitingRoomCardIds?: readonly string[];
    readonly sourceCardCode?: string;
  } = {}
): GameState {
  const source = member(options.sourceCardCode ?? 'PL!S-bp7-010-N', P1, SOURCE_ID);
  const allZoneIds = [
    ...(options.deckCardIds ?? ['deck-1', 'deck-2', 'deck-3', 'deck-4', 'deck-bottom']),
    ...(options.waitingRoomCardIds ?? []),
  ];
  const zoneCards = [...new Set(allZoneIds)].map((cardId) =>
    member(`PL!S-test-${cardId}`, P1, cardId)
  );
  let game = registerCards(createGameState('s-bp7-010-chika', P1, 'P1', P2, 'P2'), [
    source,
    ...zoneCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: [
        ...(options.deckCardIds ?? ['deck-1', 'deck-2', 'deck-3', 'deck-4', 'deck-bottom']),
      ],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [...(options.waitingRoomCardIds ?? [])],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SOURCE_ID, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { ...game, pendingAbilities: [pending()] };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function selectChoice(game: GameState, optionId: string, playerId = P1): GameState {
  return confirmActiveEffectStep(
    game,
    playerId,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [optionId]
  );
}

function choose(game: GameState, optionId: string, playerId = P1): GameState {
  return continuePublicEffectChoiceForTest(selectChoice(game, optionId, playerId), playerId);
}

describe('PL!S-bp7-010-N 费用4「高海千歌」卡组底检视', () => {
  it('私密检视卡组底1张，两个放置结果使用公开效果选项', () => {
    const waiting = start(setup());

    expect(waiting.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      stepText: '检视了自己卡组底的1张卡。可以将其放置于卡组顶第4张处。',
      inspectionCardIds: ['deck-bottom'],
      selectableOptions: [
        { id: PLACE_OPTION_ID, label: '放置于卡组顶第4张' },
        { id: KEEP_BOTTOM_OPTION_ID, label: '不放置' },
      ],
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: PLACE_OPTION_ID, text: '将检视的卡放置于卡组顶第4张。' },
          { id: KEEP_BOTTOM_OPTION_ID, text: '不放置，将检视的卡保留在卡组底。' },
        ],
        publicConfirmation: true,
      },
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
    });
    expect(waiting.players[0].mainDeck.cardIds).toEqual(['deck-1', 'deck-2', 'deck-3', 'deck-4']);
    expect(waiting.inspectionZone).toMatchObject({
      cardIds: ['deck-bottom'],
      revealedCardIds: [],
    });

    const ownView = projectPlayerViewState(waiting, P1);
    const opponentView = projectPlayerViewState(waiting, P2);
    expect(ownView.activeEffect?.selectableOptions).toBeUndefined();
    expect(opponentView.activeEffect?.selectableOptions).toBeUndefined();
    expect(ownView.activeEffect?.effectChoice?.options).toHaveLength(2);
    expect(opponentView.activeEffect?.effectChoice?.options).toHaveLength(2);
    expect(ownView.activeEffect?.inspectionObjectIds).toHaveLength(1);
    expect(opponentView.activeEffect?.inspectionObjectIds).toBeUndefined();
    const opponentInspectionObjectId =
      opponentView.table.zones.FIRST_INSPECTION_ZONE.objectIds?.[0];
    expect(
      opponentInspectionObjectId
        ? opponentView.objects[opponentInspectionObjectId]?.surface
        : undefined
    ).toBe('BACK');
    expect(
      opponentInspectionObjectId
        ? opponentView.objects[opponentInspectionObjectId]?.frontInfo
        : undefined
    ).toBeUndefined();
  });

  it.each([
    [PLACE_OPTION_ID, ['deck-1', 'deck-2', 'deck-3', 'deck-bottom', 'deck-4']],
    [KEEP_BOTTOM_OPTION_ID, ['deck-1', 'deck-2', 'deck-3', 'deck-4', 'deck-bottom']],
  ] as const)('选择%s后先向双方公开选项，展示结束后才移动检视卡', (optionId, expectedDeck) => {
    const waiting = start(setup());
    const disclosed = selectChoice(waiting, optionId);

    expect(disclosed.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      effectChoice: { selectedOptionIds: [optionId] },
    });
    expect(disclosed.players[0].mainDeck.cardIds).toEqual(['deck-1', 'deck-2', 'deck-3', 'deck-4']);
    expect(disclosed.inspectionZone.cardIds).toEqual(['deck-bottom']);
    for (const playerId of [P1, P2]) {
      expect(projectPlayerViewState(disclosed, playerId).activeEffect?.effectChoice).toMatchObject({
        options: [
          { id: PLACE_OPTION_ID, text: '将检视的卡放置于卡组顶第4张。' },
          { id: KEEP_BOTTOM_OPTION_ID, text: '不放置，将检视的卡保留在卡组底。' },
        ],
        selectedOptionIds: [optionId],
      });
    }
    const ownView = projectPlayerViewState(disclosed, P1);
    const ownInspectionObjectId = ownView.table.zones.FIRST_INSPECTION_ZONE.objectIds?.[0];
    expect(
      ownInspectionObjectId ? ownView.objects[ownInspectionObjectId]?.surface : undefined
    ).toBe('FRONT');
    expect(
      ownInspectionObjectId ? ownView.objects[ownInspectionObjectId]?.frontInfo : undefined
    ).toBeDefined();
    const opponentView = projectPlayerViewState(disclosed, P2);
    const opponentInspectionObjectId =
      opponentView.table.zones.FIRST_INSPECTION_ZONE.objectIds?.[0];
    expect(
      opponentInspectionObjectId
        ? opponentView.objects[opponentInspectionObjectId]?.surface
        : undefined
    ).toBe('BACK');
    expect(
      opponentInspectionObjectId
        ? opponentView.objects[opponentInspectionObjectId]?.frontInfo
        : undefined
    ).toBeUndefined();

    const done = continuePublicEffectChoiceForTest(disclosed, P1);
    expect(done.players[0].mainDeck.cardIds).toEqual(expectedDeck);
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });

  it('卡组5张时将原底牌放置于卡组顶第4张且清理inspection', () => {
    const done = choose(start(setup()), PLACE_OPTION_ID);

    expect(done.players[0].mainDeck.cardIds).toEqual([
      'deck-1',
      'deck-2',
      'deck-3',
      'deck-bottom',
      'deck-4',
    ]);
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.inspectionContext).toBeNull();
    expect(done.activeEffect).toBeNull();
    expect(done.eventLog).toEqual([]);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'PLACE_INSPECTED_CARD_AT_DECK_FOURTH',
      movedCardId: 'deck-bottom',
      positionFromTop: 4,
      insertIndex: 3,
    });
  });

  it('选择不放置时底牌回到原位且卡组顺序不变', () => {
    const originalDeck = ['deck-1', 'deck-2', 'deck-3', 'deck-4', 'deck-bottom'];
    const done = choose(start(setup({ deckCardIds: originalDeck })), KEEP_BOTTOM_OPTION_ID);

    expect(done.players[0].mainDeck.cardIds).toEqual(originalDeck);
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.inspectionContext).toBeNull();
    expect(done.activeEffect).toBeNull();
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'KEEP_INSPECTED_CARD_AT_DECK_BOTTOM',
      movedCardId: 'deck-bottom',
      positionFromTop: null,
      insertIndex: 4,
    });
  });

  it.each([1, 2, 3, 4])('原始卡组只有%d张时夹到可达的卡组底位置', (deckCount) => {
    const deckCardIds = Array.from({ length: deckCount }, (_, index) => `short-${index + 1}`);
    const done = choose(start(setup({ deckCardIds })), PLACE_OPTION_ID);

    expect(done.players[0].mainDeck.cardIds).toEqual(deckCardIds);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      positionFromTop: 4,
      insertIndex: deckCount - 1,
    });
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.inspectionContext).toBeNull();
  });

  it('空卡组且无刷新资源时精确消费pending并no-op', () => {
    const done = start(setup({ deckCardIds: [], waitingRoomCardIds: [] }));

    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.inspectionContext).toBeNull();
    expect(done.actionHistory.at(-1)?.payload.step).toBe('NO_BOTTOM_CARD_TO_INSPECT');
  });

  it('空卡组但休息室有牌时先按标准刷新再检视卡组底', () => {
    const waiting = start(setup({ deckCardIds: [], waitingRoomCardIds: ['refresh-bottom'] }));

    expect(waiting.activeEffect?.inspectionCardIds).toEqual(['refresh-bottom']);
    expect(waiting.players[0].waitingRoom.cardIds).toEqual([]);
    expect(waiting.players[0].mainDeck.cardIds).toEqual([]);
    const done = choose(waiting, KEEP_BOTTOM_OPTION_ID);
    expect(done.players[0].mainDeck.cardIds).toEqual(['refresh-bottom']);
    expect(done.inspectionContext).toBeNull();
  });

  it('伪造option、错误操作者、stale inspection与重复提交均不改变状态', () => {
    const waiting = start(setup());
    expect(choose(waiting, 'forged-option')).toBe(waiting);
    expect(choose(waiting, PLACE_OPTION_ID, P2)).toBe(waiting);
    expect(confirmActiveEffectStep(waiting, P1, waiting.activeEffect!.id, null)).toBe(waiting);

    const staleOwner: GameState = {
      ...waiting,
      inspectionContext: { ownerPlayerId: P2, sourceZone: ZoneType.MAIN_DECK },
    };
    expect(choose(staleOwner, PLACE_OPTION_ID)).toStrictEqual(staleOwner);

    const staleCard: GameState = {
      ...waiting,
      inspectionZone: { ...waiting.inspectionZone, cardIds: [] },
    };
    expect(choose(staleCard, PLACE_OPTION_ID)).toStrictEqual(staleCard);

    const done = choose(waiting, PLACE_OPTION_ID);
    const repeated = confirmActiveEffectStep(
      done,
      P1,
      waiting.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      PLACE_OPTION_ID
    );
    expect(repeated).toBe(done);
    expect(
      done.players[0].mainDeck.cardIds.filter((cardId) => cardId === 'deck-bottom')
    ).toHaveLength(1);
  });

  it('入队后来源离场仍可完成检视结算，且未知罕贵度仍走base family', () => {
    const waiting = start(setup({ sourceCardCode: 'PL!S-bp7-010-SEC' }));
    const sourceLeft = updatePlayer(waiting, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
    }));
    const done = choose(sourceLeft, PLACE_OPTION_ID);

    expect(done.activeEffect).toBeNull();
    expect(done.players[0].mainDeck.cardIds[3]).toBe('deck-bottom');
  });

  it('结束后通过统一continuation继续下一个pending效果', () => {
    const first = start(setup());
    const secondPending = pending('pending:s-bp7-010:second');
    const withContinuation = {
      ...first,
      pendingAbilities: [...first.pendingAbilities, secondPending],
    };

    const continued = choose(withContinuation, KEEP_BOTTOM_OPTION_ID);
    expect(continued.activeEffect).toMatchObject({
      id: secondPending.id,
      abilityId: ABILITY_ID,
    });
    expect(continued.pendingAbilities.some((ability) => ability.id === secondPending.id)).toBe(
      false
    );
  });
});
