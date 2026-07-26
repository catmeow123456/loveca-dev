import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addMemberBelowMember, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
  N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID,
  S_BP3_010_011_ON_ENTER_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function member(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = ['Aqours']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function place(
  game: GameState,
  playerId: string,
  cardId: string,
  slot: SlotPosition,
  orientation: OrientationState
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setup(cardCode: 'PL!S-bp3-010-N' | 'PL!S-bp3-011-N' | 'PL!-bp3-001-P') {
  const source = createCardInstance(member(cardCode), PLAYER1, `${cardCode}-source`);
  const waiting = createCardInstance(member('WAITING-TARGET'), PLAYER1, 'waiting-target');
  const active = createCardInstance(member('ACTIVE-TARGET'), PLAYER1, 'active-target');
  const opponent = createCardInstance(member('OPPONENT-TARGET'), PLAYER2, 'opponent-target');
  const below = createCardInstance(member('BELOW-TARGET'), PLAYER1, 'below-target');
  let game = registerCards(createGameState(`activate-${cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    waiting,
    active,
    opponent,
    below,
  ]);
  game = place(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
  game = place(game, PLAYER1, waiting.instanceId, SlotPosition.LEFT, OrientationState.WAITING);
  game = place(game, PLAYER1, active.instanceId, SlotPosition.RIGHT, OrientationState.ACTIVE);
  game = place(game, PLAYER2, opponent.instanceId, SlotPosition.CENTER, OrientationState.WAITING);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.CENTER, below.instanceId),
  }));
  return { game, source, waiting, active, opponent, below };
}

function setupNsd2() {
  const source = createCardInstance(
    live('PL!N-sd2-025-P', 'ワンダーメイツ'),
    PLAYER1,
    'n-sd2-025-source'
  );
  const waiting = createCardInstance(
    member('NIJIGASAKI-WAITING', '虹咲待机成员', ['虹ヶ咲']),
    PLAYER1,
    'nijigasaki-waiting'
  );
  const active = createCardInstance(
    member('NIJIGASAKI-ACTIVE', '虹咲活跃成员', ['虹ヶ咲']),
    PLAYER1,
    'nijigasaki-active'
  );
  const nonNijigasaki = createCardInstance(
    member('AQOURS-WAITING', 'Aqours待机成员'),
    PLAYER1,
    'aqours-waiting'
  );
  const opponent = createCardInstance(
    member('OPPONENT-NIJIGASAKI', '对方虹咲成员', ['虹ヶ咲']),
    PLAYER2,
    'opponent-nijigasaki'
  );
  const below = createCardInstance(
    member('BELOW-NIJIGASAKI', '下方虹咲成员', ['虹ヶ咲']),
    PLAYER1,
    'below-nijigasaki'
  );
  let game = registerCards(createGameState('activate-n-sd2-025', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    waiting,
    active,
    nonNijigasaki,
    opponent,
    below,
  ]);
  game = place(game, PLAYER1, waiting.instanceId, SlotPosition.LEFT, OrientationState.WAITING);
  game = place(
    game,
    PLAYER1,
    nonNijigasaki.instanceId,
    SlotPosition.CENTER,
    OrientationState.WAITING
  );
  game = place(game, PLAYER1, active.instanceId, SlotPosition.RIGHT, OrientationState.ACTIVE);
  game = place(game, PLAYER2, opponent.instanceId, SlotPosition.CENTER, OrientationState.WAITING);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: { ...player.liveZone, cardIds: [source.instanceId] },
    memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.CENTER, below.instanceId),
  }));
  return { game, source, waiting, active, nonNijigasaki, opponent, below };
}

function queue(
  game: GameState,
  sourceCardId: string,
  abilityId = S_BP3_010_011_ON_ENTER_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID
): GameState {
  const pending: PendingAbilityState = {
    id: `pending-${sourceCardId}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId:
      abilityId === N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID
        ? TriggerCondition.ON_LIVE_START
        : TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['on-enter-event'],
    sourceSlot: SlotPosition.CENTER,
  };
  return { ...game, pendingAbilities: [pending] };
}

function start(game: GameState, sourceCardId: string): GameState {
  return resolvePendingCardEffects(queue(game, sourceCardId)).gameState;
}

describe('activate own stage member shared workflow', () => {
  for (const cardCode of ['PL!S-bp3-010-N', 'PL!S-bp3-011-N'] as const) {
    it(`${cardCode} selects one own WAITING main-stage member and emits one state event`, () => {
      const setupState = setup(cardCode);
      let state = start(setupState.game, setupState.source.instanceId);
      expect(state.activeEffect).toMatchObject({
        abilityId: S_BP3_010_011_ON_ENTER_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
        stepText: '可以选择自己舞台上的1名成员变为活跃状态。',
        selectionLabel: '选择要变为活跃状态的成员',
        confirmSelectionLabel: '变为活跃状态',
        skipSelectionLabel: '不发动',
        canSkipSelection: true,
        selectableCardIds: [setupState.waiting.instanceId],
      });
      state = confirmActiveEffectStep(
        state,
        PLAYER1,
        state.activeEffect!.id,
        setupState.waiting.instanceId
      );
      expect(
        state.players[0].memberSlots.cardStates.get(setupState.waiting.instanceId)?.orientation
      ).toBe(OrientationState.ACTIVE);
      expect(
        state.eventLog.filter(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            entry.event.cardInstanceId === setupState.waiting.instanceId
        )
      ).toHaveLength(1);
      expect(state.activeEffect).toBeNull();
    });
  }

  it('allows not activating and does not change orientation', () => {
    const setupState = setup('PL!S-bp3-010-N');
    const started = start(setupState.game, setupState.source.instanceId);
    const skipped = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(skipped.activeEffect).toBeNull();
    expect(
      skipped.players[0].memberSlots.cardStates.get(setupState.waiting.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('consumes pending without an empty window when no own WAITING target exists', () => {
    const setupState = setup('PL!S-bp3-010-N');
    const game = updatePlayer(setupState.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(setupState.waiting.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    const resolved = start(game, setupState.source.instanceId);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('keeps ON_ENTER queued semantics after the source leaves and rescans current own stage', () => {
    const setupState = setup('PL!S-bp3-011-N');
    let queued = queue(setupState.game, setupState.source.instanceId);
    queued = updatePlayer(queued, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
        cardStates: new Map(
          [...player.memberSlots.cardStates].filter(([id]) => id !== setupState.source.instanceId)
        ),
      },
    }));
    const resolved = resolvePendingCardEffects(queued).gameState;
    expect(resolved.activeEffect?.selectableCardIds).toEqual([setupState.waiting.instanceId]);
  });

  it('rejects non-candidate, duplicate, and stale ids without changing state', () => {
    const setupState = setup('PL!S-bp3-010-N');
    const started = start(setupState.game, setupState.source.instanceId);
    for (const id of [
      setupState.active.instanceId,
      setupState.opponent.instanceId,
      setupState.below.instanceId,
      'missing-id',
    ]) {
      expect(confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, id)).toBe(started);
    }
  });

  it('preserves PL!-bp3-001 LIVE_START source-on-stage gating after shared promotion', () => {
    const setupState = setup('PL!-bp3-001-P');
    let queued = queue(
      setupState.game,
      setupState.source.instanceId,
      BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID
    );
    queued = updatePlayer(queued, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
        cardStates: new Map(
          [...player.memberSlots.cardStates].filter(([id]) => id !== setupState.source.instanceId)
        ),
      },
    }));
    const resolved = resolvePendingCardEffects(queued).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID &&
          action.payload.step === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });

  it('PL!N-sd2-025-P 分数1「奇妙伙伴」强制选择自己主舞台的待机虹咲成员并产生状态事件', () => {
    const setupState = setupNsd2();
    let state = resolvePendingCardEffects(
      queue(
        setupState.game,
        setupState.source.instanceId,
        N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID
      )
    ).gameState;
    expect(state.activeEffect).toMatchObject({
      abilityId: N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID,
      stepText: '请选择自己舞台上的1名『虹咲』成员变为活跃状态。',
      selectionLabel: '选择要变为活跃状态的成员',
      confirmSelectionLabel: '变为活跃状态',
      selectableCardIds: [setupState.waiting.instanceId],
    });
    expect(state.activeEffect?.canSkipSelection).not.toBe(true);
    expect(state.activeEffect?.skipSelectionLabel).toBeUndefined();

    const cannotSkip = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, null);
    expect(cannotSkip).toBe(state);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      setupState.waiting.instanceId
    );
    expect(
      state.players[0].memberSlots.cardStates.get(setupState.waiting.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      state.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === setupState.waiting.instanceId
      )
    ).toHaveLength(1);
    expect(state.activeEffect).toBeNull();
  });

  it('PL!N-sd2-025-P 分数1「奇妙伙伴」无合法虹咲目标时安全结算且不显示空窗口', () => {
    const setupState = setupNsd2();
    const game = updatePlayer(setupState.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(setupState.waiting.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    const resolved = resolvePendingCardEffects(
      queue(
        game,
        setupState.source.instanceId,
        N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID
      )
    ).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('PL!N-sd2-025-P 分数1「奇妙伙伴」来源LIVE离区后不改变目标并关闭窗口', () => {
    const setupState = setupNsd2();
    const started = resolvePendingCardEffects(
      queue(
        setupState.game,
        setupState.source.instanceId,
        N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID
      )
    ).gameState;
    const staleSource = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const resolved = confirmActiveEffectStep(
      staleSource,
      PLAYER1,
      staleSource.activeEffect!.id,
      setupState.waiting.instanceId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.players[0].memberSlots.cardStates.get(setupState.waiting.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('PL!N-sd2-025-P 分数1「奇妙伙伴」拒绝确认时已失效的目标且不推进窗口', () => {
    const setupState = setupNsd2();
    const started = resolvePendingCardEffects(
      queue(
        setupState.game,
        setupState.source.instanceId,
        N_SD2_025_LIVE_START_ACTIVATE_NIJIGASAKI_STAGE_MEMBER_ABILITY_ID
      )
    ).gameState;
    const staleTarget = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(setupState.waiting.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    expect(
      confirmActiveEffectStep(
        staleTarget,
        PLAYER1,
        staleTarget.activeEffect!.id,
        setupState.waiting.instanceId
      )
    ).toBe(staleTarget);
  });
});
