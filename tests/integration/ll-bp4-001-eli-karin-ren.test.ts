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
import {
  LL_BP4_001_LIVE_START_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID,
  LL_BP4_001_ON_ENTER_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
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

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'll-bp4-001-source';
const SELECTED_ID = 'named-combination';
const OTHER_ID = 'other-top';
const ELI_ID = 'eli-top';
const LIVE_START_ABILITY = LL_BP4_001_LIVE_START_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID;
const ON_ENTER_ABILITY = LL_BP4_001_ON_ENTER_LOOK_TOP_NAMED_MEMBER_WAIT_OPPONENT_ABILITY_ID;
const EFFECT_TEXT =
  '【登场】/【LIVE开始时】检视自己卡组顶的5张卡。可以从其中公开1张「绚濑绘里」或「朝香果林」或「叶月恋」的成员卡加入手牌。其余的卡片放置入休息室。之后，将所有存在于对方的舞台的，费用小于等于因此公开的卡片的费用的，且原本持有的[ブレード]的数量小于等于3个的成员变为待机状态。';

function member(
  cardCode: string,
  instanceId: string,
  ownerId: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly blade?: number;
  } = {}
) {
  const data: MemberCardData = {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: options.blade ?? 2,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, ownerId, instanceId);
}

function placeStageMember(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function pending(abilityId: string): PendingAbilityState {
  return {
    id: `pending:${abilityId}`,
    abilityId,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId:
      abilityId === LIVE_START_ABILITY
        ? TriggerCondition.ON_LIVE_START
        : TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
    eventIds: [`event:${abilityId}`],
  };
}

function setup(
  abilityId: string,
  options: {
    readonly sourceOnStage?: boolean;
    readonly includeTargets?: boolean;
    readonly includeAlreadyWaitingMatch?: boolean;
  } = {}
): GameState {
  const source = member('LL-bp4-001-R+', SOURCE_ID, P1, {
    name: '絢瀬絵里&朝香果林&葉月恋',
    cost: 20,
    blade: 6,
  });
  const selected = member('LL-test-combination', SELECTED_ID, P1, {
    name: '絢瀬絵里&朝香果林&葉月恋',
    cost: 7,
  });
  const eli = member('LL-test-eli', ELI_ID, P1, { name: '绚濑绘里', cost: 5 });
  const other = member('LL-test-other', OTHER_ID, P1, { name: '高坂穂乃果' });
  const fillerA = member('LL-test-filler-a', 'filler-a', P1);
  const fillerB = member('LL-test-filler-b', 'filler-b', P1);
  const opponentCards = [
    member('LL-test-opponent-match', 'opponent-match', P2, { cost: 7, blade: 3 }),
    member('LL-test-opponent-high-cost', 'opponent-high-cost', P2, { cost: 8, blade: 3 }),
    member('LL-test-opponent-high-blade', 'opponent-high-blade', P2, { cost: 6, blade: 4 }),
    member('LL-test-opponent-already-waiting', 'opponent-already-waiting', P2, {
      cost: 6,
      blade: 2,
    }),
  ];
  let game = registerCards(createGameState(`ll-bp4-001:${abilityId}`, P1, 'P1', P2, 'P2'), [
    source,
    selected,
    eli,
    other,
    fillerA,
    fillerB,
    ...opponentCards,
  ]);
  if (options.sourceOnStage !== false) {
    game = placeStageMember(game, P1, SlotPosition.CENTER, SOURCE_ID);
  } else {
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [SOURCE_ID] },
    }));
  }
  if (options.includeTargets !== false) {
    game = placeStageMember(game, P2, SlotPosition.LEFT, 'opponent-match');
    game = placeStageMember(
      game,
      P2,
      SlotPosition.CENTER,
      options.includeAlreadyWaitingMatch === true
        ? 'opponent-already-waiting'
        : 'opponent-high-cost',
      options.includeAlreadyWaitingMatch === true
        ? OrientationState.WAITING
        : OrientationState.ACTIVE
    );
    game = placeStageMember(game, P2, SlotPosition.RIGHT, 'opponent-high-blade');
  }
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: [SELECTED_ID, OTHER_ID, ELI_ID, 'filler-a', 'filler-b'],
    },
  }));
  return { ...game, pendingAbilities: [pending(abilityId)] };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function select(game: GameState, selectedCardId: string | null): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, selectedCardId);
}

function finishReveal(game: GameState): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

describe('LL-bp4-001-R+ 费用20「绚濑绘里&朝香果林&叶月恋」 definitions', () => {
  it('registers independent ON_ENTER and LIVE_START abilities by base code with exact exported text', () => {
    expect(getCardAbilityDefinitionsForCardCode('LL-bp4-001-R+')).toEqual([
      expect.objectContaining({
        abilityId: ON_ENTER_ABILITY,
        baseCardCodes: ['LL-bp4-001'],
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
        effectText: EFFECT_TEXT,
      }),
      expect.objectContaining({
        abilityId: LIVE_START_ABILITY,
        baseCardCodes: ['LL-bp4-001'],
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        queued: true,
        implemented: true,
        effectText: EFFECT_TEXT,
      }),
    ]);
    expect(getCardAbilityDefinitionsForCardCode('LL-bp4-001-R')).toHaveLength(2);
    expect(getCardAbilityDefinitionsForCardCode('LL-bp4-001-SEC')).toHaveLength(2);
    expect(getCardAbilityDefinitionsForCardCode('LL-bp4-002-R+')).toEqual([]);
  });
});

describe('LL-bp4-001 top-five named-member workflow', () => {
  for (const abilityId of [ON_ENTER_ABILITY, LIVE_START_ABILITY]) {
    it(`${abilityId} privately inspects five and exposes only structured named-member candidates`, () => {
      const waiting = start(setup(abilityId));
      expect(waiting.activeEffect).toMatchObject({
        abilityId,
        effectText: EFFECT_TEXT,
        inspectionCardIds: [SELECTED_ID, OTHER_ID, ELI_ID, 'filler-a', 'filler-b'],
        selectableCardIds: [SELECTED_ID, ELI_ID],
        selectionLabel: '选择要公开并加入手牌的指定成员',
        confirmSelectionLabel: '公开并加入手牌',
        skipSelectionLabel: '全部放置入休息室',
      });
      expect(waiting.inspectionZone.revealedCardIds).toEqual([]);
      expect(projectPlayerViewState(waiting, P2).activeEffect?.selectableObjectIds).toBeUndefined();
    });
  }

  it('reveals only the selected card, dwells before moving, then waits every matching top-level opponent member', () => {
    const waiting = start(setup(ON_ENTER_ABILITY));
    const revealing = select(waiting, SELECTED_ID);
    expect(revealing.activeEffect).toMatchObject({
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      effectText: EFFECT_TEXT,
      revealedCardIds: [SELECTED_ID],
    });
    expect(revealing.inspectionZone.revealedCardIds).toEqual([SELECTED_ID]);
    expect(revealing.players[0].hand.cardIds).toEqual([]);
    expect(revealing.players[0].waitingRoom.cardIds).toEqual([]);
    expect(revealing.players[1].memberSlots.cardStates.get('opponent-match')?.orientation).toBe(
      OrientationState.ACTIVE
    );

    const resolved = finishReveal(revealing);
    expect(resolved.players[0].hand.cardIds).toEqual([SELECTED_ID]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([
      OTHER_ID,
      ELI_ID,
      'filler-a',
      'filler-b',
    ]);
    expect(resolved.inspectionZone.cardIds).toEqual([]);
    expect(resolved.players[1].memberSlots.cardStates.get('opponent-match')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolved.players[1].memberSlots.cardStates.get('opponent-high-cost')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(resolved.players[1].memberSlots.cardStates.get('opponent-high-blade')?.orientation).toBe(
      OrientationState.ACTIVE
    );

    const waitingRoomEvents = resolved.eventLog
      .map((entry) => entry.event)
      .filter(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      );
    expect(waitingRoomEvents).toHaveLength(1);
    expect(waitingRoomEvents[0]).toMatchObject({
      cardInstanceIds: [OTHER_ID, ELI_ID, 'filler-a', 'filler-b'],
    });
    const memberStateEvents = resolved.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
    expect(memberStateEvents).toEqual([
      expect.objectContaining({
        cardInstanceId: 'opponent-match',
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
      }),
    ]);
  });

  it('allows selecting no card, groups all inspected cards into waiting, and waits no opponent member', () => {
    const resolved = select(start(setup(LIVE_START_ABILITY)), null);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([
      SELECTED_ID,
      OTHER_ID,
      ELI_ID,
      'filler-a',
      'filler-b',
    ]);
    expect(resolved.players[1].memberSlots.cardStates.get('opponent-match')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      resolved.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toEqual([]);
    expect(
      resolved.eventLog
        .map((entry) => entry.event)
        .filter(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.MAIN_DECK
        )
    ).toEqual([
      expect.objectContaining({
        cardInstanceIds: [SELECTED_ID, OTHER_ID, ELI_ID, 'filler-a', 'filler-b'],
      }),
    ]);
  });

  it('emits member-state events only for matching members whose orientation actually changes', () => {
    const resolved = finishReveal(
      select(start(setup(ON_ENTER_ABILITY, { includeAlreadyWaitingMatch: true })), SELECTED_ID)
    );
    expect(
      resolved.players[1].memberSlots.cardStates.get('opponent-already-waiting')?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      resolved.eventLog
        .map((entry) => entry.event)
        .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
    ).toEqual([
      expect.objectContaining({
        cardInstanceId: 'opponent-match',
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
      }),
    ]);
  });

  it('rejects illegal and stale selections without moving cards or advancing continuation', () => {
    const waiting = start(setup(ON_ENTER_ABILITY));
    expect(select(waiting, OTHER_ID)).toBe(waiting);

    const stale: GameState = {
      ...waiting,
      inspectionZone: {
        ...waiting.inspectionZone,
        cardIds: waiting.inspectionZone.cardIds.filter((cardId) => cardId !== SELECTED_ID),
      },
    };
    expect(select(stale, SELECTED_ID)).toBe(stale);

    const revealing = select(waiting, SELECTED_ID);
    const staleReveal: GameState = {
      ...revealing,
      inspectionZone: {
        ...revealing.inspectionZone,
        cardIds: revealing.inspectionZone.cardIds.filter((cardId) => cardId !== SELECTED_ID),
      },
    };
    const recovered = finishReveal(staleReveal);
    expect(recovered.activeEffect).toBeNull();
    expect(recovered.inspectionZone.cardIds).toEqual([]);
    expect(recovered.inspectionZone.revealedCardIds).toEqual([]);
    expect(recovered.players[0].hand.cardIds).toEqual([]);
    expect(recovered.players[0].waitingRoom.cardIds).toEqual([
      OTHER_ID,
      ELI_ID,
      'filler-a',
      'filler-b',
    ]);
    expect(recovered.players[1].memberSlots.cardStates.get('opponent-match')?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('keeps queued ON_ENTER resolution after the source leaves but rejects stale LIVE_START source', () => {
    const onEnter = start(setup(ON_ENTER_ABILITY, { sourceOnStage: false }));
    expect(onEnter.activeEffect).toMatchObject({ abilityId: ON_ENTER_ABILITY });

    const liveStartSetup = setup(LIVE_START_ABILITY, { sourceOnStage: false });
    const liveStart = start(liveStartSetup);
    expect(liveStart.activeEffect).toBeNull();
    expect(liveStart.pendingAbilities).toEqual([]);
    expect(liveStart.players[0].mainDeck.cardIds).toEqual(
      liveStartSetup.players[0].mainDeck.cardIds
    );
    expect(liveStart.inspectionZone.cardIds).toEqual([]);
  });
});
