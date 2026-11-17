import {
  addAction,
  getPlayerById,
  type GameState,
  type HextechActiveEffectState,
} from '../../domain/entities/game.js';
import { getHextechDefinition } from '../../domain/hextech/catalog.js';
import { getStageMemberLifecycleId } from '../../domain/rules/card-lifecycle.js';
import { addLiveModifier } from '../../domain/rules/live-modifiers.js';
import type { HextechState } from '../../domain/hextech/state.js';
import { SlotPosition } from '../../shared/types/enums.js';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../card-effects/runtime/member-slot-moved-triggers.js';
import {
  startNextHandResetDiscard,
  finishHandResetDiscard,
  HAND_RESET_DISCARD_STEP_ID,
} from '../card-effects/workflows/shared/hand-reset.js';
import { enqueueTriggeredCardEffects } from '../card-effect-runner.js';

export function finishDarkAcquisition(game: GameState): GameState {
  return {
    ...game,
    activeEffect: null,
    hextech: { ...game.hextech!, pendingAcquisition: undefined },
  };
}

export function startDarkAcquisition(
  game: GameState,
  instanceId: string,
  kind: NonNullable<HextechState['pendingAcquisition']>['kind']
): GameState {
  const owned = game.hextech!.owned.find((entry) => entry.instanceId === instanceId)!;
  const definition = getHextechDefinition(owned.definitionId)!;
  const player = getPlayerById(game, owned.playerId)!;
  const base: HextechActiveEffectState = {
    id: `${instanceId}:acquire`,
    abilityId: `hextech:${owned.definitionId}`,
    sourceKind: 'HEXTECH',
    sourceHextechInstanceId: instanceId,
    controllerId: player.id,
    awaitingPlayerId: player.id,
    effectText: definition.rulesText,
    stepId: 'HEXTECH_COLUMN_LOCK',
    stepText: '选择获得纵列封锁的己方舞台成员（离场即失效）',
  };
  const state: GameState = {
    ...game,
    hextech: { ...game.hextech!, pendingAcquisition: { sourceInstanceId: instanceId, kind } },
  };
  if (kind === 'REWRITE_SCRIPT')
    return startNextHandResetDiscard(
      state,
      base,
      [player.id, game.players.find((entry) => entry.id !== player.id)!.id],
      0,
      false,
      finishDarkAcquisition
    );
  if (kind === 'POSITION_MISHAP') {
    const opponent = game.players.find((entry) => entry.id !== player.id)!;
    const ids = Object.values(opponent.memberSlots.slots).filter((id): id is string => !!id);
    return ids.length
      ? {
          ...state,
          activeEffect: {
            ...base,
            stepId: 'HEXTECH_POSITION_TARGET',
            stepText: '选择要换位的对方舞台成员；只有该成员本回合棒−2',
            selectableCardIds: ids,
            selectableCardVisibility: 'PUBLIC',
            selectableCardMode: 'SINGLE',
            minSelectableCards: 1,
            maxSelectableCards: 1,
            canSkipSelection: true,
            skipSelectionLabel: '不发动',
          },
        }
      : finishDarkAcquisition(state);
  }
  const ids = Object.values(player.memberSlots.slots).filter((id): id is string => !!id);
  return ids.length
    ? {
        ...state,
        activeEffect: {
          ...base,
          selectableCardIds: ids,
          selectableCardVisibility: 'PUBLIC',
          selectableCardMode: 'SINGLE',
          minSelectableCards: 1,
          maxSelectableCards: 1,
          canSkipSelection: false,
        },
      }
    : finishDarkAcquisition(state);
}

export function finishDarkAcquisitionStep(
  game: GameState,
  effect: HextechActiveEffectState,
  selectedCardId: string | null | undefined,
  selectedCardIds: readonly string[] | undefined,
  selectedOptionId?: string | null
): GameState {
  if (game.hextech?.pendingAcquisition?.kind === 'POSITION_MISHAP')
    return finishPositionMishapStep(game, effect, selectedCardId, selectedOptionId);
  if (effect.stepId === HAND_RESET_DISCARD_STEP_ID)
    return finishHandResetDiscard(
      game,
      selectedCardId ?? null,
      selectedCardIds,
      finishDarkAcquisition,
      enqueueTriggeredCardEffects
    );
  if (effect.stepId !== 'HEXTECH_COLUMN_LOCK') return game;
  const id = selectedCardId ?? (selectedCardIds?.length === 1 ? selectedCardIds[0] : undefined);
  if (
    !id ||
    !Object.values(getPlayerById(game, effect.controllerId)!.memberSlots.slots).includes(id)
  )
    return game;
  return finishDarkAcquisition({
    ...game,
    hextech: {
      ...game.hextech!,
      columnLocks: [
        ...(game.hextech?.columnLocks ?? []),
        {
          memberCardId: id,
          playerId: effect.controllerId,
          lifecycleId: getStageMemberLifecycleId(game, id),
          sourceInstanceId: effect.sourceHextechInstanceId,
        },
      ],
    },
  });
}

function finishPositionMishapStep(
  game: GameState,
  effect: HextechActiveEffectState,
  selectedCardId: string | null | undefined,
  selectedOptionId: string | null | undefined
): GameState {
  const finish = (state: GameState, step: string) =>
    finishDarkAcquisition(
      addAction(state, 'RESOLVE_ABILITY', effect.controllerId, {
        abilityId: effect.abilityId,
        sourceHextechInstanceId: effect.sourceHextechInstanceId,
        step,
      })
    );
  if (selectedCardId === null) return finish(game, 'DECLINE');
  const opponent = game.players.find((player) => player.id !== effect.controllerId)!;
  const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];
  if (effect.stepId === 'HEXTECH_POSITION_TARGET') {
    const fromSlot = slots.find((slot) => opponent.memberSlots.slots[slot] === selectedCardId);
    if (!selectedCardId || !fromSlot || !effect.selectableCardIds?.includes(selectedCardId))
      return game;
    return {
      ...game,
      activeEffect: {
        ...effect,
        selectableCardIds: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        stepId: 'HEXTECH_POSITION_DESTINATION',
        stepText: '选择对方的目的成员区；已有成员则交换，所选成员棒−2直到本回合LIVE结束',
        revealedCardIds: [selectedCardId],
        selectableOptions: slots
          .filter((slot) => slot !== fromSlot)
          .map((slot) => ({
            id: slot,
            label: {
              [SlotPosition.LEFT]: '移至对方左侧（你视角右侧）',
              [SlotPosition.CENTER]: '移至对方中央',
              [SlotPosition.RIGHT]: '移至对方右侧（你视角左侧）',
            }[slot],
          })),
        metadata: {
          targetCardId: selectedCardId,
          targetLifecycleId: getStageMemberLifecycleId(game, selectedCardId),
          fromSlot,
        },
      },
    };
  }
  if (effect.stepId !== 'HEXTECH_POSITION_DESTINATION') return game;
  const targetId = effect.metadata?.targetCardId;
  const fromSlot = effect.metadata?.fromSlot as SlotPosition;
  const toSlot = slots.find((slot) => slot === selectedOptionId);
  if (
    typeof targetId !== 'string' ||
    !toSlot ||
    toSlot === fromSlot ||
    !effect.selectableOptions?.some((option) => option.id === toSlot) ||
    opponent.memberSlots.slots[fromSlot] !== targetId ||
    effect.metadata?.targetLifecycleId !== getStageMemberLifecycleId(game, targetId)
  )
    return game;
  const moved = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    opponent.id,
    targetId,
    toSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'HEXTECH_EFFECT',
        playerId: effect.controllerId,
        sourceHextechInstanceId: effect.sourceHextechInstanceId,
      },
      prepareGameStateBeforeEnqueue: (state) =>
        addLiveModifier(state, {
          kind: 'BLADE',
          target: 'TARGET_MEMBER',
          playerId: opponent.id,
          targetMemberCardId: targetId,
          sourceHextechInstanceId: effect.sourceHextechInstanceId,
          abilityId: effect.abilityId,
          countDelta: -2,
        }),
    }
  );
  return moved ? finish(moved.gameState, 'MOVE_AND_LOSE_BLADE') : game;
}
