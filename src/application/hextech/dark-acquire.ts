import {
  getPlayerById,
  type GameState,
  type HextechActiveEffectState,
} from '../../domain/entities/game.js';
import { getHextechDefinition } from '../../domain/hextech/catalog.js';
import { getStageMemberLifecycleId } from '../../domain/rules/card-lifecycle.js';
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
  kind: 'REWRITE_SCRIPT' | 'COLUMN_LOCK'
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
  selectedCardIds: readonly string[] | undefined
): GameState {
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
