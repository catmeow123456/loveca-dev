import { describe, expect, it } from 'vitest';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';
import type { AnyCardData, CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { recordMoveToStage } from '../../src/domain/entities/player';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
  PL_S_BP5_005_LIVE_START_DISCARD_CHOOSE_HEART_NON_AQOURS_ENTERED_MEMBERS_ABILITY_ID,
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
const ABILITY_ID =
  PL_S_BP5_005_LIVE_START_DISCARD_CHOOSE_HEART_NON_AQOURS_ENTERED_MEMBERS_ABILITY_ID;

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    bladeHearts: [],
  };
}

function instance<TData extends AnyCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function pending(sourceCardId: string, id = 's-bp5-005-pending'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event:${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    readonly sourceEntered?: boolean;
    readonly handCards?: readonly CardInstance[];
    readonly stageMembers?: readonly {
      readonly card: CardInstance<MemberCardData>;
      readonly slot: SlotPosition;
      readonly enteredThisTurn?: boolean;
    }[];
    readonly extraPending?: readonly PendingAbilityState[];
  } = {}
) {
  const source = instance(
    member('PL!S-bp5-005-R＋', { name: '渡辺 曜', groupNames: ['Aqours'] }),
    'you-source'
  );
  const handCards = options.handCards ?? [
    instance(member('PL!S-test-hand', { name: 'Discard cost' }), 'discard-cost'),
  ];
  const stageMembers = options.stageMembers ?? [];
  let game = registerCards(createGameState('s-bp5-005-you', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    ...handCards,
    ...stageMembers.map((entry) => entry.card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    for (const entry of stageMembers) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    let nextPlayer = {
      ...player,
      hand: {
        ...player.hand,
        cardIds: handCards.map((card) => card.instanceId),
      },
      memberSlots,
    };
    if (options.sourceEntered === true) {
      nextPlayer = recordMoveToStage(nextPlayer, source.instanceId);
    }
    for (const entry of stageMembers) {
      if (entry.enteredThisTurn === true) {
        nextPlayer = recordMoveToStage(nextPlayer, entry.card.instanceId);
      }
    }
    return nextPlayer;
  });

  return {
    game: {
      ...game,
      pendingAbilities: [pending(source.instanceId), ...(options.extraPending ?? [])],
    },
    source,
    handCards,
    stageMembers,
  };
}

function startEffect(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirmDiscard(game: GameState, selectedCardId?: string | null): GameState {
  const effect = game.activeEffect!;
  return confirmActiveEffectStep(game, PLAYER1, effect.id, selectedCardId);
}

function chooseHeart(game: GameState, selectedOptionId: HeartColor): GameState {
  const publicChoice = confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [selectedOptionId]
  );
  return publicChoice === game
    ? game
    : confirmActiveEffectStep(publicChoice, PLAYER1, publicChoice.activeEffect!.id);
}

function latestPayload(game: GameState): Record<string, unknown> | undefined {
  return game.actionHistory
    .filter(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!S-bp5-005 渡辺 曜', () => {
  it('opens the real optional discard window and skipping does not pay the cost', () => {
    const { game, handCards } = setup();

    const started = startEffect(game);
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(started.activeEffect?.selectableCardIds).toEqual([handCards[0]!.instanceId]);

    const skipped = confirmDiscard(started, null);
    const player = skipped.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(skipped.activeEffect).toBeNull();
    expect(player.hand.cardIds).toEqual([handCards[0]!.instanceId]);
    expect(player.waitingRoom.cardIds).toEqual([]);
    expect(skipped.liveResolution.liveModifiers).toEqual([]);
    expect(skipped.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(latestPayload(skipped)).toMatchObject({
      step: 'SKIP_DISCARD_CHOOSE_HEART',
    });
  });

  it('discards one hand card to waiting room and then shows the three Heart options', () => {
    const { game, handCards } = setup();

    let state = startEffect(game);
    state = confirmDiscard(state, handCards[0]!.instanceId);
    const player = state.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(player.hand.cardIds).toEqual([]);
    expect(player.waitingRoom.cardIds).toEqual([handCards[0]!.instanceId]);
    expect(state.activeEffect?.effectChoice).toMatchObject({
      mode: 'SINGLE',
      minSelections: 1,
      maxSelections: 1,
      publicConfirmation: true,
      options: [
        {
          id: HeartColor.YELLOW,
          text: '自己舞台上这个回合登场的成员中，所有『Aqours』以外的成员获得[黄ハート]。',
        },
        {
          id: HeartColor.GREEN,
          text: '自己舞台上这个回合登场的成员中，所有『Aqours』以外的成员获得[緑ハート]。',
        },
        {
          id: HeartColor.BLUE,
          text: '自己舞台上这个回合登场的成员中，所有『Aqours』以外的成员获得[青ハート]。',
        },
      ],
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' && action.payload.discardedCardId === handCards[0]!.instanceId
      )
    ).toBe(true);
    expect(state.eventLog.at(-1)?.event).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      fromZone: ZoneType.HAND,
      toZone: ZoneType.WAITING_ROOM,
      cardInstanceIds: [handCards[0]!.instanceId],
    });
  });

  it('gives the chosen Heart to all non-Aqours members that entered this turn only', () => {
    const enteredSaintSnow = instance(
      member('PL!S-test-saintsnow', { groupNames: ['SaintSnow'] }),
      'entered-saintsnow'
    );
    const notEnteredLiella = instance(
      member('PL!SP-test-liella', { groupNames: ['Liella!'] }),
      'not-entered-liella'
    );
    const { game, source, handCards } = setup({
      sourceEntered: true,
      stageMembers: [
        { card: enteredSaintSnow, slot: SlotPosition.LEFT, enteredThisTurn: true },
        { card: notEnteredLiella, slot: SlotPosition.RIGHT, enteredThisTurn: false },
      ],
    });

    let state = startEffect(game);
    state = confirmDiscard(state, handCards[0]!.instanceId);
    state = chooseHeart(state, HeartColor.GREEN);

    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'HEART',
        playerId: PLAYER1,
        target: 'TARGET_MEMBER',
        sourceCardId: source.instanceId,
        targetMemberCardId: enteredSaintSnow.instanceId,
        abilityId: ABILITY_ID,
        hearts: [{ color: HeartColor.GREEN, count: 1 }],
      })
    );
    expect(state.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'HEART',
        targetMemberCardId: notEnteredLiella.instanceId,
      })
    );
    expect(state.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'HEART',
        sourceCardId: source.instanceId,
        target: 'SOURCE_MEMBER',
      })
    );
    expect(latestPayload(state)).toMatchObject({
      step: 'CHOOSE_HEART_APPLY_ENTERED_NON_AQOURS_HEART',
      discardedCardId: handCards[0]!.instanceId,
      selectedHeartColor: HeartColor.GREEN,
      selectedHeartLabel: '[緑ハート]',
      targetMemberCardIds: [enteredSaintSnow.instanceId],
    });
  });

  it('keeps the paid discard cost and records no target after choosing a Heart', () => {
    const { game, handCards } = setup({ sourceEntered: true });

    let state = startEffect(game);
    state = confirmDiscard(state, handCards[0]!.instanceId);
    state = chooseHeart(state, HeartColor.BLUE);
    const player = state.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(player.waitingRoom.cardIds).toEqual([handCards[0]!.instanceId]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(latestPayload(state)).toMatchObject({
      step: 'CHOOSE_HEART_NO_TARGET_AFTER_COST',
      selectedHeartColor: HeartColor.BLUE,
      targetMemberCardIds: [],
    });
  });

  it('continues to the next pending ability after the Heart selection resolves', () => {
    const enteredSaintSnow = instance(
      member('PL!S-test-saintsnow', { groupNames: ['SaintSnow'] }),
      'entered-saintsnow'
    );
    const dia = instance(member('PL!S-bp5-004-R', { name: '黒澤ダイヤ' }), 'dia-source');
    const aqoursTarget = instance(
      member('PL!S-test-aqours-target', { groupNames: ['Aqours'] }),
      'aqours-target'
    );
    const diaPending: PendingAbilityState = {
      id: 's-bp5-004-after-you',
      abilityId: PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: dia.instanceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: ['event:s-bp5-004-after-you'],
      sourceSlot: SlotPosition.RIGHT,
    };
    const { game, handCards } = setup({
      stageMembers: [
        { card: enteredSaintSnow, slot: SlotPosition.LEFT, enteredThisTurn: true },
        { card: dia, slot: SlotPosition.RIGHT, enteredThisTurn: false },
      ],
      extraPending: [diaPending],
    });
    const stateWithAqoursTarget = updatePlayer(
      registerCards(game, [aqoursTarget]),
      PLAYER1,
      (player) => ({
        ...player,
        hand: {
          ...player.hand,
          cardIds: [handCards[0]!.instanceId],
        },
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, dia.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      })
    );
    const finalSetup = updatePlayer(stateWithAqoursTarget, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, aqoursTarget.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    let state = startEffect(
      addCheckTimingRuleSentinel(finalSetup, PLAYER1, 's-bp5-005-continuation')
    );
    state = confirmDiscard(state, handCards[0]!.instanceId);
    state = chooseHeart(state, HeartColor.YELLOW);

    if (state.activeEffect?.abilityId === 'system:select-pending-card-effect') {
      const next = state.pendingAbilities.find(
        (ability) =>
          ability.abilityId ===
          PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID
      );
      expect(next).toBeTruthy();
      state = confirmActiveEffectStep(
        state,
        PLAYER1,
        state.activeEffect.id,
        null,
        null,
        false,
        next!.id
      );
    }

    expect(state.activeEffect?.abilityId).toBe(
      PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID
    );
  });
});
