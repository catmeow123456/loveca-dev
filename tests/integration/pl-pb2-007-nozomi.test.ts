import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { PL_PB2_007_ACTIVATED_SELF_SACRIFICE_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getActivatedAbilityUiConfig } from '../../src/application/card-effects/runtime/activated-ability-ui';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const EFFECT_TEXT =
  '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张『μ’s』的LIVE卡加入手牌。此后，存在于自己的成功LIVE卡区的『μ’s』的卡片每有1张，将1张能量变为活跃状态。';

const member = (code: string, group = "μ's"): MemberCardData => ({
  cardCode: code,
  name: '东条希',
  groupNames: [group],
  cardType: CardType.MEMBER,
  cost: 4,
  blade: 1,
  hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
});

const live = (code: string, group = "μ's"): LiveCardData => ({
  cardCode: code,
  name: code,
  groupNames: [group],
  cardType: CardType.LIVE,
  score: 1,
  requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
});

const energy = (index: number): EnergyCardData => ({
  cardCode: `energy-${index}`,
  name: `energy-${index}`,
  cardType: CardType.ENERGY,
});

interface SuccessCardSpec {
  readonly group?: string;
  readonly ownerId?: string;
  readonly cardType?: CardType.LIVE | CardType.MEMBER;
}

function authority(session: ReturnType<typeof createGameSession>, game: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}

function setup(
  options: {
    readonly includeTarget?: boolean;
    readonly energyCount?: number;
    readonly successCards?: readonly SuccessCardSpec[];
  } = {}
) {
  const session = createGameSession();
  session.createGame('pl-pb2-007', P1, 'P1', P2, 'P2');
  const source = createCardInstance(member('PL!-pb2-007-PP'), P1, 'source');
  const target = createCardInstance(live('target-muse-live'), P1, 'target');
  const nonMuseLive = createCardInstance(live('non-muse-live', 'Liella!'), P1, 'non-muse');
  const energies = Array.from({ length: options.energyCount ?? 3 }, (_, index) =>
    createCardInstance(energy(index), P1, `energy-${index}`)
  );
  const successCards = (options.successCards ?? []).map((spec, index) =>
    createCardInstance(
      spec.cardType === CardType.MEMBER
        ? member(`success-member-${index}`, spec.group ?? "μ's")
        : live(`success-live-${index}`, spec.group ?? "μ's"),
      spec.ownerId ?? P1,
      `success-${index}`
    )
  );
  let game = registerCards(session.state!, [
    source,
    target,
    nonMuseLive,
    ...energies,
    ...successCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds:
        options.includeTarget === false
          ? [nonMuseLive.instanceId]
          : [target.instanceId, nonMuseLive.instanceId],
    },
    successZone: {
      ...player.successZone,
      cardIds: successCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: {
      ...player.energyZone,
      cardIds: energies.map((card) => card.instanceId),
      cardStates: new Map(
        energies.map((card) => [
          card.instanceId,
          { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
        ])
      ),
    },
  }));
  authority(session, {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  });
  return { session, source, target, nonMuseLive, energies, successCards };
}

function expirePublicSelection(
  session: ReturnType<typeof createGameSession>,
  requesterId = P2
): void {
  const reveal = session.state!.activeEffect!;
  authority(session, {
    ...session.state!,
    activeEffect: { ...reveal, publicCardSelectionAutoAdvanceAt: 0 },
  });
  const result = session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(requesterId, reveal.id, 0)
  );
  expect(result.success, result.error).toBe(true);
}

function activeEnergyIds(game: GameState, energyIds: readonly string[]): readonly string[] {
  const player = game.players[0];
  return energyIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
  );
}

describe('PL!-pb2-007 东条希', () => {
  it.each(['PL!-pb2-007-PP', 'PL!-pb2-007-R', 'PL!-pb2-007-UNSEEN'])(
    '%s uses one base-code definition and exact activated UI text',
    (cardCode) => {
      const definition = getCardAbilityDefinitionsForCardCode(cardCode).find(
        (candidate) => candidate.abilityId === ABILITY
      );
      expect(definition).toMatchObject({
        abilityId: ABILITY,
        baseCardCodes: ['PL!-pb2-007'],
        category: CardAbilityCategory.ACTIVATED,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
        effectText: EFFECT_TEXT,
      });
      expect(definition?.cardCodes).toBeUndefined();
      expect(getActivatedAbilityUiConfig(cardCode)).toMatchObject({
        abilityId: ABILITY,
        text: EFFECT_TEXT,
        title: '自送休息室，回收μ’s LIVE并活跃能量',
      });
    }
  );

  it('公开回收后按自己成功区中自己持有的结构化μ’s卡数活跃能量', () => {
    const { session, source, target, nonMuseLive, energies } = setup({
      energyCount: 3,
      successCards: [{}, { cardType: CardType.MEMBER }, { group: 'Liella!' }, { ownerId: P2 }],
    });

    expect(
      session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success
    ).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: ABILITY,
      selectableCardIds: [target.instanceId],
      canSkipSelection: false,
      stepText: '请选择自己的休息室中1张『μ’s』LIVE卡加入手牌。',
      selectionLabel: '选择要加入手牌的『μ’s』LIVE卡',
      confirmSelectionLabel: '加入手牌',
    });
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(nonMuseLive.instanceId);
    expect(
      session.state?.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          event.cardInstanceId === source.instanceId
      )
    ).toBe(true);

    const selectionId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, selectionId, target.instanceId))
        .success
    ).toBe(true);
    expect(session.state?.activeEffect?.revealedCardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(target.instanceId);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(
      activeEnergyIds(
        session.state!,
        energies.map((card) => card.instanceId)
      )
    ).toEqual([]);

    expirePublicSelection(session);
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(
      activeEnergyIds(
        session.state!,
        energies.map((card) => card.instanceId)
      )
    ).toEqual(energies.slice(0, 2).map((card) => card.instanceId));
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_PER_SUCCESS_MUSE_CARD',
      selectedCardIds: [target.instanceId],
      conditionValue: 2,
      successGroupCardCount: 2,
      activatedEnergyCardIds: energies.slice(0, 2).map((card) => card.instanceId),
    });
  });

  it('没有可回收目标也保留自送费用并继续活跃能量', () => {
    const { session, source, energies } = setup({
      includeTarget: false,
      energyCount: 2,
      successCards: [{}, {}],
    });
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY)).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(
      activeEnergyIds(
        session.state!,
        energies.map((card) => card.instanceId)
      )
    ).toEqual(energies.map((card) => card.instanceId));
  });

  it.each([
    { label: '能量不足时至多活跃实际待机能量', successCount: 3, energyCount: 1, activeCount: 1 },
    { label: '成功区计数为0时不活跃能量', successCount: 0, energyCount: 2, activeCount: 0 },
  ])('$label', ({ successCount, energyCount, activeCount }) => {
    const { session, source, target, energies } = setup({
      energyCount,
      successCards: Array.from({ length: successCount }, () => ({})),
    });
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)
    );
    expirePublicSelection(session);
    expect(
      activeEnergyIds(
        session.state!,
        energies.map((card) => card.instanceId)
      )
    ).toHaveLength(activeCount);
  });

  it('特殊能量超额时使用通用精确选择窗口并拒绝非法与stale选择', () => {
    const { session, source, target, energies } = setup({
      energyCount: 3,
      successCards: [{}, {}],
    });
    authority(session, {
      ...session.state!,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: energies[0].instanceId,
          sourceCardId: 'marker',
          abilityId: 'marker',
        },
      ],
    });
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)
    );
    expirePublicSelection(session);
    const selection = session.state!.activeEffect!;
    expect(selection).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择要变为活跃状态的待机能量。',
      selectionLabel: '选择要变为活跃的能量',
      confirmSelectionLabel: '变为活跃',
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          selection.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [energies[0].instanceId, 'outside']
        )
      ).success
    ).toBe(false);
    authority(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        energyZone: removeCardFromStatefulZone(player.energyZone, energies[0].instanceId),
      }))
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          selection.id,
          undefined,
          undefined,
          undefined,
          undefined,
          energies.slice(1).map((card) => card.instanceId)
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      activeEnergyIds(
        session.state!,
        energies.slice(1).map((card) => card.instanceId)
      )
    ).toEqual(energies.slice(1).map((card) => card.instanceId));
  });

  it('公开后回收目标stale时不移动该卡，但仍结算独立的成功区能量段', () => {
    const { session, source, target, energies } = setup({
      energyCount: 1,
      successCards: [{}],
    });
    session.executeCommand(createActivateAbilityCommand(P1, source.instanceId, ABILITY));
    session.executeCommand(
      createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, target.instanceId)
    );
    const reveal = session.state!.activeEffect!;
    authority(
      session,
      updatePlayer(
        { ...session.state!, activeEffect: { ...reveal, publicCardSelectionAutoAdvanceAt: 0 } },
        P1,
        (player) => ({
          ...player,
          waitingRoom: {
            ...player.waitingRoom,
            cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
          },
        })
      )
    );
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, 0)).success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(
      activeEnergyIds(
        session.state!,
        energies.map((card) => card.instanceId)
      )
    ).toEqual([energies[0].instanceId]);
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      selectedCardIds: [],
      successGroupCardCount: 1,
      activatedEnergyCardIds: [energies[0].instanceId],
    });
  });
});
