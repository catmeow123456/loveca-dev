import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { hasPlayerMovedEnergyFromZoneToDeckThisTurn } from '../../../effects/conditions.js';
import {
  SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
  SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  createOptionalEnergyReturnWindow,
  resolveOptionalEnergyReturn,
} from '../../runtime/optional-energy-return.js';

const PAY = 'SP_BP7_006_PAY_RETURN_ENERGY';
const RECOVER = 'SP_BP7_006_RECOVER_LIELLA_MEMBER';
type Continue = (game: GameState, ordered: boolean) => GameState;
type Enqueue = (game: GameState, triggers: readonly TriggerCondition[]) => GameState;

export function registerSpBp7006KinakoWorkflowHandlers(deps: {
  enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
    (g, a, o, c) =>
      start(
        g,
        a,
        o.orderedResolution === true,
        c.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
    PAY,
    (g, i, c) =>
      pay(
        g,
        i.selectedCardIds ?? (i.selectedCardId ? [i.selectedCardId] : []),
        i.selectedOptionId ?? null,
        c.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP7_006_ON_ENTER_RETURN_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
    RECOVER,
    (g, i, c) => recover(g, i.selectedCardId ?? null, c.continuePendingCardEffects)
  );
  registerPendingAbilityStarterHandler(
    SP_BP7_006_LIVE_SUCCESS_ENERGY_RETURNED_SCORE_ABILITY_ID,
    (g, a, o, c) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(g, a, o, {
        effectText: getScoreConfirmationText(g, a.controllerId, a.abilityId),
        stepText: '确认后结算此效果。',
      });
      return (
        confirmation ?? score(g, a, o.orderedResolution === true, c.continuePendingCardEffects)
      );
    }
  );
}

function targets(game: GameState, playerId: string) {
  const p = getPlayerById(game, playerId);
  return (
    p?.waitingRoom.cardIds.filter((id) => {
      const c = getCardById(game, id);
      return !!c && isMemberCardData(c.data) && groupAliasIs('Liella!')(c);
    }) ?? []
  );
}
function finish(
  game: GameState,
  a: PendingAbilityState,
  ordered: boolean,
  next: Continue,
  payload: Record<string, unknown>
) {
  return next(
    addAction(
      {
        ...game,
        activeEffect: null,
        pendingAbilities: game.pendingAbilities.filter((x) => x.id !== a.id),
      },
      'RESOLVE_ABILITY',
      a.controllerId,
      { pendingAbilityId: a.id, abilityId: a.abilityId, sourceCardId: a.sourceCardId, ...payload }
    ),
    ordered
  );
}
function start(
  game: GameState,
  a: PendingAbilityState,
  ordered: boolean,
  next: Continue,
  enqueue: Enqueue
): GameState {
  const p = getPlayerById(game, a.controllerId);
  if (
    !p ||
    findMemberSlot(p, a.sourceCardId) === null ||
    p.energyZone.cardIds.length === 0 ||
    targets(game, p.id).length === 0
  )
    return finish(game, a, ordered, next, { step: 'NO_VALID_COST_OR_TARGET' });
  return (
    createOptionalEnergyReturnWindow(game, {
      ability: a,
      requiredCount: 1,
      effectText: getAbilityEffectText(a.abilityId),
      stepId: PAY,
      stepText: '可以将1张能量放回能量卡组并发动此效果。',
      orderedResolution: ordered,
    }) ?? game
  );
}
function pay(
  game: GameState,
  ids: readonly string[],
  option: string | null,
  next: Continue,
  enqueue: Enqueue
): GameState {
  const e = game.activeEffect;
  if (!e) return game;
  const player = getPlayerById(game, e.controllerId);
  if (!player || findMemberSlot(player, e.sourceCardId) === null) {
    return finish(game, activeEffectToPending(e), e.metadata?.orderedResolution === true, next, {
      step: 'SOURCE_INVALID',
    });
  }
  const payment = resolveOptionalEnergyReturn(game, {
    selectedCardIds: ids,
    selectedOptionId: option,
    enqueueTriggeredCardEffects: enqueue,
  });
  if (!payment) return game;
  if (payment.declined)
    return finish(
      game,
      {
        id: e.id,
        abilityId: e.abilityId,
        sourceCardId: e.sourceCardId,
        controllerId: e.controllerId,
        mandatory: true,
        timingId: '',
        eventIds: [],
      } as PendingAbilityState,
      e.metadata?.orderedResolution === true,
      next,
      { step: 'DECLINED' }
    );
  return afterPay(
    payment.gameState,
    {
      id: e.id,
      abilityId: e.abilityId,
      sourceCardId: e.sourceCardId,
      controllerId: e.controllerId,
      mandatory: true,
      timingId: '',
      eventIds: [],
    } as PendingAbilityState,
    payment.movedEnergyCardIds,
    e.metadata?.orderedResolution === true,
    next
  );
}
function afterPay(
  game: GameState,
  a: PendingAbilityState,
  ids: readonly string[],
  ordered: boolean,
  next: Continue
): GameState {
  const p = getPlayerById(game, a.controllerId);
  if (!p || findMemberSlot(p, a.sourceCardId) === null || ids.length !== 1)
    return finish(game, a, ordered, next, { step: 'SOURCE_INVALID' });
  const state = game;
  const candidates = targets(state, p.id);
  if (candidates.length === 0)
    return finish(state, a, ordered, next, {
      step: 'PAID_NO_TARGET',
      movedEnergyCardIds: ids,
    });
  return {
    ...state,
    activeEffect: {
      id: a.id,
      abilityId: a.abilityId,
      sourceCardId: a.sourceCardId,
      controllerId: p.id,
      effectText: getAbilityEffectText(a.abilityId),
      stepId: RECOVER,
      stepText: '请选择自己休息室中的1张『Liella!』成员卡加入手牌。',
      awaitingPlayerId: p.id,
      selectableCardIds: candidates,
      minSelectableCards: 1,
      maxSelectableCards: 1,
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: { orderedResolution: ordered, movedEnergyCardIds: ids },
    },
  };
}

function activeEffectToPending(
  effect: NonNullable<GameState['activeEffect']>
): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: '',
    eventIds: [],
  };
}
function recover(game: GameState, id: string | null, next: Continue): GameState {
  const e = game.activeEffect;
  if (!e || !id) return game;
  const r = recoverCardsFromWaitingRoomToHandForPlayer(game, e.controllerId, [id], {
    candidateCardIds: e.selectableCardIds ?? [],
    exactCount: 1,
  });
  if (!r) return game;
  return finish(
    r.gameState,
    {
      id: e.id,
      abilityId: e.abilityId,
      sourceCardId: e.sourceCardId,
      controllerId: e.controllerId,
      mandatory: true,
      timingId: '',
      eventIds: [],
    } as PendingAbilityState,
    e.metadata?.orderedResolution === true,
    next,
    {
      step: 'RECOVERED',
      movedEnergyCardIds: e.metadata?.movedEnergyCardIds,
      recoveredCardIds: r.movedCardIds,
    }
  );
}
function score(
  game: GameState,
  a: PendingAbilityState,
  ordered: boolean,
  next: Continue
): GameState {
  const p = getPlayerById(game, a.controllerId);
  const returned = p ? hasPlayerMovedEnergyFromZoneToDeckThisTurn(game, p.id) : false;
  const valid = !!p && p.memberSlots.slots[SlotPosition.CENTER] === a.sourceCardId && returned;
  let state = game;
  if (valid)
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: p!.id,
      countDelta: 1,
      sourceCardId: a.sourceCardId,
      abilityId: a.abilityId,
    });
  return finish(state, a, ordered, next, { conditionMet: valid, scoreBonus: valid ? 1 : 0 });
}

function getScoreConfirmationText(game: GameState, playerId: string, abilityId: string): string {
  const returned = hasPlayerMovedEnergyFromZoneToDeckThisTurn(game, playerId);
  return `${getAbilityEffectText(abilityId)}\n（本回合${returned ? '发生过' : '未发生'}自己的能量从能量区返回能量卡组，条件${returned ? '满足，实际[スコア]+1' : '未满足，实际不增加分数'}。）`;
}
