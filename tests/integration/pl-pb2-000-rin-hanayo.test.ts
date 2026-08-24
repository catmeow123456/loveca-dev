import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PB2_000_CONTINUOUS_PLAY_DOUBLE_RELAY_ABILITY_ID,
  PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { removeStageMemberBoundLiveModifiers } from '../../src/domain/rules/live-modifiers';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'rin-hanayo';
const CONTINUOUS_EFFECT_TEXT = '【常时】打出此卡时，可以与2名成员进行换手。';
const ON_ENTER_EFFECT_TEXT =
  '【登场】从2名『μ’s』的成员换手登场的场合，从自己的休息室将1张『μ’s』的LIVE卡加入手牌，接着，那2名成员的费用合计为15的场合，LIVE结束时为止，获得「【常时】LIVE的合计分数+1。」。';

function member(cardCode: string, cost: number, group = "μ's"): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [group],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function live(cardCode: string, group = "μ's"): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [group],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function setup(
  options: {
    readonly leftGroup?: string;
    readonly leftEffectiveCost?: number;
    readonly centerEffectiveCost?: number;
    readonly includeRecoveryTarget?: boolean;
  } = {}
): {
  readonly game: GameState;
  readonly recoveryLiveId: string;
  readonly leftId: string;
  readonly centerId: string;
} {
  const source = createCardInstance(member('PL!-pb2-000-DUO', 15), P1, SOURCE_ID);
  const center = createCardInstance(member('MUSE-CENTER', 8), P1, 'muse-center');
  const left = createCardInstance(
    member('MUSE-LEFT', 7, options.leftGroup ?? "μ's"),
    P1,
    'muse-left'
  );
  const recoveryLive = createCardInstance(live('MUSE-LIVE'), P1, 'muse-live');
  let game = registerCards(createGameState('pl-pb2-000', P1, 'P1', P2, 'P2'), [
    source,
    center,
    left,
    recoveryLive,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: source.instanceId,
      },
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        center.instanceId,
        left.instanceId,
        ...(options.includeRecoveryTarget === false ? [] : [recoveryLive.instanceId]),
      ],
    },
  }));
  const pending: PendingAbilityState = {
    id: 'rin-hanayo-on-enter',
    abilityId: PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID,
    sourceCardId: source.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
    sourceSlot: SlotPosition.CENTER,
    metadata: {
      relayReplacements: [
        {
          cardId: center.instanceId,
          slot: SlotPosition.CENTER,
          effectiveCost: options.centerEffectiveCost ?? 8,
        },
        {
          cardId: left.instanceId,
          slot: SlotPosition.LEFT,
          effectiveCost: options.leftEffectiveCost ?? 7,
        },
      ],
    },
  };
  return {
    game: { ...game, pendingAbilities: [pending] },
    recoveryLiveId: recoveryLive.instanceId,
    leftId: left.instanceId,
    centerId: center.instanceId,
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

describe('PL!-pb2-000-DUO 费用15「星空凛&小泉花阳」', () => {
  it('按基础编号将双换手常时与登场效果拆为两条精确卡文 definition', () => {
    for (const cardCode of ['PL!-pb2-000-DUO', 'PL!-pb2-000-UNSEEN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(
        definitions.find(
          (definition) =>
            definition.abilityId === PL_PB2_000_CONTINUOUS_PLAY_DOUBLE_RELAY_ABILITY_ID
        )
      ).toMatchObject({
        baseCardCodes: ['PL!-pb2-000'],
        category: 'CONTINUOUS',
        sourceZone: 'HAND',
        queued: false,
        implemented: true,
        effectText: CONTINUOUS_EFFECT_TEXT,
      });
      expect(
        definitions.find(
          (definition) =>
            definition.abilityId ===
            PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID
        )
      ).toMatchObject({
        baseCardCodes: ['PL!-pb2-000'],
        category: 'ON_ENTER',
        sourceZone: 'PLAYED_MEMBER',
        queued: true,
        implemented: true,
        effectText: ON_ENTER_EFFECT_TEXT,
      });
    }
  });

  it('uses the exact two-member relay snapshot, publicly confirms recovery, then grants source-bound LIVE total score +1', () => {
    const scenario = setup();
    let game = resolve(scenario.game);

    expect(game.activeEffect).toMatchObject({
      abilityId: PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID,
      selectableCardIds: [scenario.recoveryLiveId],
      stepText: '请选择自己休息室中1张『μ’s』LIVE卡加入手牌。',
      selectionLabel: '选择要加入手牌的『μ’s』LIVE卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        relayEffectiveCostTotal: 15,
        relayReplacements: [
          { cardId: scenario.centerId, effectiveCost: 8 },
          { cardId: scenario.leftId, effectiveCost: 7 },
        ],
      },
    });

    const effectId = game.activeEffect!.id;
    game = confirmActiveEffectStep(game, P1, effectId, scenario.recoveryLiveId);
    expect(game.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [scenario.recoveryLiveId],
    });
    expect(game.players[0].waitingRoom.cardIds).toContain(scenario.recoveryLiveId);
    expect(game.liveResolution.liveModifiers).toEqual([]);

    game = confirmActiveEffectStep(game, P1, effectId);
    expect(game.players[0].hand.cardIds).toContain(scenario.recoveryLiveId);
    expect(game.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: P1,
      countDelta: 1,
      sourceCardId: SOURCE_ID,
      targetMemberCardId: SOURCE_ID,
      abilityId: PL_PB2_000_ON_ENTER_DOUBLE_MUSE_RELAY_RECOVER_LIVE_GAIN_SCORE_ABILITY_ID,
    });
    expect(game.liveResolution.playerScores.get(P1)).toBe(1);

    const stateAfterSourceLeaves = removeStageMemberBoundLiveModifiers(game, [SOURCE_ID]);
    expect(stateAfterSourceLeaves.liveResolution.liveModifiers).toEqual([]);
    expect(stateAfterSourceLeaves.liveResolution.playerScoreBonuses.get(P1)).toBeUndefined();
  });

  it('does not grant score when the relay effective-cost snapshot is not exactly 15', () => {
    const scenario = setup({ leftEffectiveCost: 6 });
    const started = resolve(scenario.game);
    const game = confirmActiveEffectStepThroughPublicReveal(
      started,
      P1,
      started.activeEffect!.id,
      scenario.recoveryLiveId
    );

    expect(game.players[0].hand.cardIds).toContain(scenario.recoveryLiveId);
    expect(game.liveResolution.liveModifiers).toEqual([]);
    expect(game.actionHistory.at(-1)?.payload).toMatchObject({
      relayEffectiveCostTotal: 14,
      scoreGranted: false,
    });
  });

  it('rejects a forged two-member snapshot when either replacement is not an owned μ’s member', () => {
    const scenario = setup({ leftGroup: 'Aqours' });
    const game = resolve(scenario.game);

    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).not.toContain(scenario.recoveryLiveId);
    expect(game.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DOUBLE_MUSE_RELAY_CONDITION_NOT_MET',
      reason: 'REPLACEMENT_NOT_OWN_MUSE_MEMBER',
    });
  });

  it('still grants the temporary score when no μ’s LIVE exists to recover', () => {
    const scenario = setup({ includeRecoveryTarget: false });
    const game = resolve(scenario.game);

    expect(game.activeEffect).toBeNull();
    expect(game.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        targetMemberCardId: SOURCE_ID,
        countDelta: 1,
      })
    );
    expect(game.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'NO_MUSE_LIVE_TO_RECOVER',
      relayEffectiveCostTotal: 15,
      scoreGranted: true,
    });
  });

  it('公开展示后回收目标离开休息室时不替换目标，继续分数分支与后续 pending', () => {
    const scenario = setup();
    let game = resolve(scenario.game);
    const effectId = game.activeEffect!.id;
    game = confirmActiveEffectStep(game, P1, effectId, scenario.recoveryLiveId);
    expect(game.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);

    const nextPending: PendingAbilityState = {
      ...scenario.game.pendingAbilities[0]!,
      id: 'rin-hanayo-follow-up',
      metadata: { relayReplacements: [] },
    };
    game = updatePlayer({ ...game, pendingAbilities: [nextPending] }, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== scenario.recoveryLiveId),
      },
      hand: {
        ...player.hand,
        cardIds: [...player.hand.cardIds, scenario.recoveryLiveId],
      },
    }));

    game = confirmActiveEffectStep(game, P1, effectId);

    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(game.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        targetMemberCardId: SOURCE_ID,
        countDelta: 1,
      })
    );
    expect(
      game.actionHistory.find(
        (action) => action.payload.step === 'SELECTED_MUSE_LIVE_LEFT_WAITING_ROOM'
      )?.payload
    ).toMatchObject({
      selectedCardId: scenario.recoveryLiveId,
      movedCardIds: [],
      relaySnapshotValid: true,
      scoreGranted: true,
    });
    expect(game.actionHistory.at(-1)?.payload).toMatchObject({
      pendingAbilityId: nextPending.id,
      step: 'DOUBLE_MUSE_RELAY_CONDITION_NOT_MET',
    });
  });
});
