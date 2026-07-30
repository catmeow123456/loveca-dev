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
import { N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
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
const EFFECT_TEXT =
  '【LIVE开始时】可以将1名『虹咲』的成员变为待机状态：LIVE结束时为止，获得[ブレード][ブレード]。';

function member(
  cardCode: string,
  name: string,
  groups: readonly string[],
  blade = 1
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: groups,
    cardType: CardType.MEMBER,
    cost: 5,
    blade,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'n-sd2-006-pending',
    abilityId: N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: false,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: { readonly sourceOnStage?: boolean } = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly activeNijigasakiId: string;
  readonly waitingNijigasakiId: string;
  readonly activeOtherId: string;
} {
  const source = createCardInstance(
    member('PL!N-sd2-006-SD2', '近江彼方', ['虹ヶ咲'], 2),
    PLAYER1,
    'kanata'
  );
  const activeNijigasaki = createCardInstance(
    member('PL!N-test-active', '上原歩夢', ['虹ヶ咲']),
    PLAYER1,
    'active-nijigasaki'
  );
  const waitingNijigasaki = createCardInstance(
    member('PL!N-test-waiting', '桜坂しずく', ['虹ヶ咲']),
    PLAYER1,
    'waiting-nijigasaki'
  );
  const activeOther = createCardInstance(
    member('PL!S-test-active', '高海千歌', ['Aqours']),
    PLAYER1,
    'active-other'
  );
  let game = createGameState('n-sd2-006', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, activeNijigasaki, waitingNijigasaki, activeOther]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, activeNijigasaki.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, waitingNijigasaki.instanceId, {
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    return { ...player, memberSlots };
  });
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    sourceId: source.instanceId,
    activeNijigasakiId: activeNijigasaki.instanceId,
    waitingNijigasakiId: waitingNijigasaki.instanceId,
    activeOtherId: activeOther.instanceId,
  };
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!N-sd2-006-SD2 费用11「近江彼方」', () => {
  it('pays by waiting one active Nijigasaki member, emits the state event, and gives the source BLADE +2', () => {
    const scenario = setup();
    const preview = resolvePendingCardEffects(scenario.game).gameState;

    expect(preview.activeEffect).toMatchObject({
      abilityId: N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
      effectText: EFFECT_TEXT,
      selectableCardIds: [scenario.activeNijigasakiId, scenario.sourceId],
      selectionLabel: '选择要用于支付费用的成员',
      confirmSelectionLabel: '支付费用',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(preview.activeEffect?.selectableCardIds).not.toContain(scenario.waitingNijigasakiId);
    expect(preview.activeEffect?.selectableCardIds).not.toContain(scenario.activeOtherId);

    const resolved = confirmActiveEffectStep(
      preview,
      PLAYER1,
      preview.activeEffect!.id,
      scenario.activeNijigasakiId
    );
    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.activeNijigasakiId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, scenario.sourceId)).toBe(4);
    expect(resolved.eventLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
            cardInstanceId: scenario.activeNijigasakiId,
            previousOrientation: OrientationState.ACTIVE,
            nextOrientation: OrientationState.WAITING,
          }),
        }),
      ])
    );
    expect(resolved.actionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'PAY_COST',
          payload: expect.objectContaining({
            abilityId: N_SD2_006_LIVE_START_WAIT_NIJIGASAKI_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
            paidCostCardId: scenario.activeNijigasakiId,
          }),
        }),
      ])
    );
    expect(latestPayload(resolved)).toMatchObject({
      step: 'PAY_WAIT_COST_GAIN_TWO_BLADE',
      paidCostCardId: scenario.activeNijigasakiId,
      bladeBonus: 2,
      bladeApplied: true,
    });
  });

  it('declines without paying the cost or gaining BLADE', () => {
    const scenario = setup();
    const preview = resolvePendingCardEffects(scenario.game).gameState;
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.activeNijigasakiId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, scenario.sourceId)).toBe(2);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'DECLINE_WAIT_COST',
      paidCostCardId: null,
      bladeBonus: 0,
      bladeApplied: false,
    });
  });

  it('keeps the paid WAITING cost when the source member is no longer a valid reward target', () => {
    const scenario = setup();
    const preview = resolvePendingCardEffects(scenario.game).gameState;
    const sourceRemoved = updatePlayer(preview, PLAYER1, (player) => {
      const cardStates = new Map(player.memberSlots.cardStates);
      cardStates.delete(scenario.sourceId);
      return {
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: [...player.waitingRoom.cardIds, scenario.sourceId],
        },
        memberSlots: {
          ...player.memberSlots,
          slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
          cardStates,
        },
      };
    });

    const resolved = confirmActiveEffectStep(
      sourceRemoved,
      PLAYER1,
      sourceRemoved.activeEffect!.id,
      scenario.activeNijigasakiId
    );
    expect(
      resolved.players[0].memberSlots.cardStates.get(scenario.activeNijigasakiId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'PAY_COST',
          payload: expect.objectContaining({
            paidCostCardId: scenario.activeNijigasakiId,
          }),
        }),
      ])
    );
    expect(latestPayload(resolved)).toMatchObject({
      step: 'PAY_WAIT_COST_SOURCE_NO_LONGER_VALID',
      paidCostCardId: scenario.activeNijigasakiId,
      bladeBonus: 0,
      bladeApplied: false,
    });
  });

  it('consumes the pending ability without a window when no active Nijigasaki cost target exists', () => {
    const scenario = setup({ sourceOnStage: false });
    const game = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map([
          [
            scenario.activeNijigasakiId,
            { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
          ],
          [
            scenario.waitingNijigasakiId,
            { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
          ],
        ]),
      },
    }));
    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(latestPayload(resolved)).toMatchObject({
      step: 'NO_ACTIVE_NIJIGASAKI_MEMBER_FOR_COST',
      bladeBonus: 0,
      bladeApplied: false,
    });
  });
});
