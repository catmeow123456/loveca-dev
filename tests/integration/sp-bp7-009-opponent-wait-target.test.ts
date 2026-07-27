import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(
  cardCode: string,
  ownerId: string,
  instanceId: string,
  blade: number,
  orientation = OrientationState.ACTIVE
) {
  return {
    card: createCardInstance(
      {
        cardCode,
        name: instanceId,
        groupNames: ['Liella!'],
        cardType: CardType.MEMBER,
        cost: 4,
        blade,
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      },
      ownerId,
      instanceId
    ),
    orientation,
  };
}

function place(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  entry: ReturnType<typeof member>
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, entry.card.instanceId, {
      orientation: entry.orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setup(options?: { readonly withLegalTarget?: boolean }): {
  readonly game: GameState;
  readonly legalTargetId: string | null;
  readonly highBladeTargetId: string;
  readonly waitingTargetId: string;
} {
  const source = member('PL!SP-bp7-009-P', P1, 'source', 2);
  const legalTarget =
    options?.withLegalTarget === false ? null : member('TARGET-BLADE-2', P2, 'legal', 2);
  const highBladeTarget = member('TARGET-BLADE-3', P2, 'high', 3);
  const waitingTarget = member(
    'TARGET-WAITING-BLADE-1',
    P2,
    'waiting',
    1,
    OrientationState.WAITING
  );
  const entries = [source, highBladeTarget, waitingTarget, ...(legalTarget ? [legalTarget] : [])];
  let game = registerCards(
    createGameState('sp-bp7-009-opponent-wait', P1, 'P1', P2, 'P2'),
    entries.map((entry) => entry.card)
  );
  game = place(game, P1, SlotPosition.CENTER, source);
  if (legalTarget) {
    game = place(game, P2, SlotPosition.LEFT, legalTarget);
  }
  game = place(game, P2, SlotPosition.CENTER, highBladeTarget);
  game = place(game, P2, SlotPosition.RIGHT, waitingTarget);

  return {
    game: {
      ...game,
      pendingAbilities: [
        {
          id: 'sp-bp7-009-live-start-pending',
          abilityId: SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
          sourceCardId: source.card.instanceId,
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          sourceSlot: SlotPosition.CENTER,
        },
      ],
    },
    legalTargetId: legalTarget?.card.instanceId ?? null,
    highBladeTargetId: highBladeTarget.card.instanceId,
    waitingTargetId: waitingTarget.card.instanceId,
  };
}

describe('PL!SP-bp7-009 LIVE_START opponent wait target', () => {
  it('selects only an ACTIVE opponent member with printed BLADE at most two', () => {
    const { game, legalTargetId, highBladeTargetId, waitingTargetId } = setup();
    const preview = resolvePendingCardEffects(game).gameState;

    expect(preview.activeEffect).toMatchObject({
      abilityId: SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
      selectableCardIds: [legalTargetId],
      selectionLabel: '选择对方舞台上原本[BLADE]小于等于2的成员',
    });

    const illegal = confirmActiveEffectStep(
      preview,
      P1,
      preview.activeEffect!.id,
      highBladeTargetId
    );
    expect(illegal).toBe(preview);

    const resolved = confirmActiveEffectStep(preview, P1, preview.activeEffect!.id, legalTargetId!);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[1].memberSlots.cardStates.get(legalTargetId!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolved.players[1].memberSlots.cardStates.get(highBladeTargetId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(resolved.players[1].memberSlots.cardStates.get(waitingTargetId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === legalTargetId &&
          entry.event.previousOrientation === OrientationState.ACTIVE &&
          entry.event.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
  });

  it('silently resolves a no-op when there is no legal target', () => {
    const { game } = setup({ withLegalTarget: false });
    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID &&
          action.payload.step === 'SKIP_NO_TARGET'
      )
    ).toBe(true);
  });
});
