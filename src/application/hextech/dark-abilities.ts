import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
  type HextechActiveEffectState,
  type HextechPendingAbilityState,
} from '../../domain/entities/game.js';
import { isMemberCardData } from '../../domain/entities/card.js';
import { tapEnergy } from '../../domain/entities/zone.js';
import {
  getHextechDefinition,
  type HextechActivationDefinition,
} from '../../domain/hextech/catalog.js';
import { getStageMemberLifecycleId } from '../../domain/rules/card-lifecycle.js';
import { isMemberWaitProtectedFromChange } from '../../domain/rules/member-wait-protections.js';
import { OrientationState } from '../../shared/types/enums.js';
import type { LiveStartEvent } from '../../domain/events/game-events.js';
import { getEnergySelectionCandidates } from '../effects/energy-selection.js';
import { drawCardsFromMainDeckToHand } from '../effects/draw.js';
import { enqueueTriggeredCardEffects } from '../card-effect-runner.js';
import { discardHandCardsToWaitingRoomAndEnqueueTriggers } from '../card-effects/runtime/enter-waiting-room-triggers.js';
import { waitStageMembersAndEnqueueTriggers } from '../card-effects/runtime/wait-stage-members.js';
import { returnStageMemberToHandAndEnqueueTriggers } from '../card-effects/runtime/return-stage-member-to-hand.js';

export function getDarkHextechUsage(game: GameState, instanceId: string) {
  const owned = game.hextech?.owned.find((item) => item.instanceId === instanceId);
  const definition = owned ? getHextechDefinition(owned.definitionId) : undefined;
  const activation = definition?.activation;
  if (!owned || !activation) return null;
  const used = !!game.hextech?.uses?.some(
    (use) =>
      use.instanceId === instanceId && (activation.limit === 'MATCH' || use.turn === game.turnCount)
  );
  return { owned, definition, activation, used };
}

function activeMembers(game: GameState, playerId: string) {
  const player = getPlayerById(game, playerId)!;
  return Object.values(player.memberSlots.slots).filter(
    (id): id is string =>
      !!id && player.memberSlots.cardStates.get(id)?.orientation === OrientationState.ACTIVE
  );
}

export function getDarkHextechTargets(
  game: GameState,
  playerId: string,
  instanceId: string,
  activation: HextechActivationDefinition
): string[] {
  if (activation.target === 'NONE') return [];
  const targetPlayer = game.players.find((player) =>
    activation.target === 'OWN_MEMBER' ? player.id === playerId : player.id !== playerId
  )!;
  return Object.values(targetPlayer.memberSlots.slots).filter((id): id is string => {
    const card = id ? getCardById(game, id) : null;
    if (!id || !card || !isMemberCardData(card.data) || card.ownerId !== targetPlayer.id)
      return false;
    if (activation.maxPrintedCost !== undefined && card.data.cost > activation.maxPrintedCost)
      return false;
    const orientation = targetPlayer.memberSlots.cardStates.get(id)?.orientation;
    if (activation.target === 'OPPONENT_WAITING' && orientation !== OrientationState.WAITING)
      return false;
    if (
      activation.target === 'OPPONENT_ACTIVE' &&
      (orientation !== OrientationState.ACTIVE ||
        isMemberWaitProtectedFromChange(game, targetPlayer.id, id, {
          kind: 'HEXTECH_EFFECT',
          playerId,
          sourceHextechInstanceId: instanceId,
        }))
    )
      return false;
    return true;
  });
}

export function canPayDarkHextech(game: GameState, instanceId: string): boolean {
  const usage = getDarkHextechUsage(game, instanceId);
  if (!usage || usage.used) return false;
  const { owned, activation } = usage;
  const player = getPlayerById(game, owned.playerId)!;
  return (
    player.hand.cardIds.length >= activation.discard &&
    getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY').length >=
      activation.energy &&
    (!activation.restOwn || activeMembers(game, player.id).length > 0) &&
    (activation.target === 'NONE' ||
      getDarkHextechTargets(game, player.id, instanceId, activation).length > 0)
  );
}

/** Own LIVE_START participates in the existing active-player scheduler with real source identity. */
export function enqueueDarkHextechLiveStart(
  game: GameState,
  events: readonly LiveStartEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    for (const owned of state.hextech?.owned ?? []) {
      const usage = getDarkHextechUsage(state, owned.instanceId);
      if (
        event.performerId !== owned.playerId ||
        !usage?.activation.timings.includes('OWN_LIVE_START') ||
        usage.used
      )
        continue;
      const id = `${owned.instanceId}:live-start:${event.eventId}`;
      if (
        state.pendingAbilities.some((entry) => entry.id === id) ||
        state.actionHistory.some(
          (action) => action.type === 'TRIGGER_ABILITY' && action.payload.pendingAbilityId === id
        )
      )
        continue;
      const ability: HextechPendingAbilityState = {
        id,
        abilityId: `hextech:${owned.definitionId}`,
        sourceKind: 'HEXTECH',
        sourceHextechInstanceId: owned.instanceId,
        controllerId: owned.playerId,
        mandatory: false,
        timingId: event.eventId,
        eventIds: [event.eventId],
      };
      state = addAction(
        { ...state, pendingAbilities: [...state.pendingAbilities, ability] },
        'TRIGGER_ABILITY',
        owned.playerId,
        {
          pendingAbilityId: id,
          abilityId: ability.abilityId,
          sourceHextechInstanceId: owned.instanceId,
          eventIds: ability.eventIds,
        }
      );
    }
  }
  return state;
}

type ChoiceStep = 'TARGET' | 'REST' | 'DISCARD' | 'ENERGY' | 'CONFIRM';
type Choices = Partial<Record<Exclude<ChoiceStep, 'CONFIRM'>, readonly string[]>>;
const STEPS: readonly ChoiceStep[] = ['TARGET', 'REST', 'DISCARD', 'ENERGY', 'CONFIRM'];

export function startDarkHextechAbility(
  game: GameState,
  instanceId: string,
  pending?: HextechPendingAbilityState,
  orderedResolution = false
): GameState {
  const usage = getDarkHextechUsage(game, instanceId);
  if (!usage) return game;
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((entry) => entry.id !== pending?.id),
  };
  return openNextStep(
    state,
    {
      id: pending?.id ?? `${instanceId}:activate:${game.actionSequence + 1}`,
      abilityId: `hextech:${usage.owned.definitionId}`,
      sourceKind: 'HEXTECH',
      sourceHextechInstanceId: instanceId,
      controllerId: usage.owned.playerId,
      awaitingPlayerId: usage.owned.playerId,
      effectText: usage.definition!.rulesText,
      stepId: 'HEXTECH_CONFIRM',
      stepText: '',
      metadata: { orderedResolution, choices: {} },
    },
    0
  );
}

function stepSpec(game: GameState, effect: HextechActiveEffectState, step: ChoiceStep) {
  const usage = getDarkHextechUsage(game, effect.sourceHextechInstanceId)!;
  const player = getPlayerById(game, effect.controllerId)!;
  const activation = usage.activation;
  switch (step) {
    case 'TARGET':
      return {
        candidates: getDarkHextechTargets(
          game,
          player.id,
          effect.sourceHextechInstanceId,
          activation
        ),
        count: activation.target === 'NONE' ? 0 : 1,
        text:
          activation.target === 'OWN_MEMBER' ? '选择要送回手牌的己方成员' : '选择受影响的对方成员',
        private: false,
      };
    case 'REST':
      return {
        candidates: activeMembers(game, player.id),
        count: activation.restOwn ? 1 : 0,
        text: '选择作为代价待机的己方成员',
        private: false,
      };
    case 'DISCARD':
      return {
        candidates: player.hand.cardIds,
        count: activation.discard,
        text: `选择${activation.discard}张手牌作为代价放置入休息室`,
        private: true,
      };
    case 'ENERGY':
      return {
        candidates: getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY'),
        count: activation.energy,
        text: `选择支付的${activation.energy}张活跃能量`,
        private: false,
      };
    case 'CONFIRM':
      return {
        candidates: [],
        count: 0,
        text: canPayDarkHextech(game, effect.sourceHextechInstanceId)
          ? '确认发动：同时支付所选代价并结算效果'
          : '当前已无法合法发动，请放弃（不消耗次数）',
        private: false,
      };
  }
}

function openNextStep(
  game: GameState,
  effect: HextechActiveEffectState,
  startIndex: number
): GameState {
  for (let index = startIndex; index < STEPS.length; index++) {
    const step = STEPS[index];
    const spec = stepSpec(game, effect, step);
    if (step !== 'CONFIRM' && spec.count === 0) continue;
    return {
      ...game,
      activeEffect: {
        ...effect,
        stepId: `HEXTECH_${step}`,
        stepText: spec.text,
        selectableCardIds: spec.candidates,
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: spec.count,
        maxSelectableCards: spec.count,
        selectableCardVisibility: spec.private ? 'AWAITING_PLAYER_ONLY' : 'PUBLIC',
        selectionLabel: spec.text,
        confirmSelectionLabel: step === 'CONFIRM' ? '支付并发动' : '继续',
        canSkipSelection: true,
        skipSelectionLabel: '放弃（不消耗次数）',
      },
    };
  }
  return game;
}

function choicesLegal(
  game: GameState,
  effect: HextechActiveEffectState,
  choices: Choices
): boolean {
  if (!canPayDarkHextech(game, effect.sourceHextechInstanceId)) return false;
  const lifecycles = (effect.metadata?.selectedLifecycles ?? {}) as Record<string, string>;
  if (
    [...(choices.TARGET ?? []), ...(choices.REST ?? [])].some(
      (id) => lifecycles[id] !== getStageMemberLifecycleId(game, id)
    )
  )
    return false;
  return STEPS.filter((step) => step !== 'CONFIRM').every((step) => {
    const spec = stepSpec(game, effect, step);
    const ids = choices[step] ?? [];
    return (
      ids.length === spec.count &&
      new Set(ids).size === ids.length &&
      ids.every((id) => spec.candidates.includes(id))
    );
  });
}

export function finishDarkHextechAbilityStep(
  game: GameState,
  effect: HextechActiveEffectState,
  selectedCardId: string | null | undefined,
  selectedCardIds: readonly string[] | undefined,
  continueEffects: (state: GameState, ordered: boolean) => GameState
): GameState {
  const finish = (state: GameState, step: string) =>
    continueEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        sourceHextechInstanceId: effect.sourceHextechInstanceId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
        step,
      }),
      effect.metadata?.orderedResolution === true
    );
  if (selectedCardId === null) return finish(game, 'DECLINE');
  const step = STEPS.find((candidate) => effect.stepId === `HEXTECH_${candidate}`);
  if (!step) return game;
  const choices = (effect.metadata?.choices ?? {}) as Choices;
  if (step !== 'CONFIRM') {
    const ids = selectedCardIds ?? (selectedCardId ? [selectedCardId] : []);
    const spec = stepSpec(game, effect, step);
    if (
      ids.length !== spec.count ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !spec.candidates.includes(id))
    )
      return game;
    return openNextStep(
      game,
      {
        ...effect,
        metadata: {
          ...effect.metadata,
          choices: { ...choices, [step]: ids },
          selectedLifecycles: {
            ...((effect.metadata?.selectedLifecycles as Record<string, string>) ?? {}),
            ...Object.fromEntries(
              (step === 'TARGET' || step === 'REST' ? ids : []).map((id) => [
                id,
                getStageMemberLifecycleId(game, id),
              ])
            ),
          },
        },
      },
      STEPS.indexOf(step) + 1
    );
  }
  if (!choicesLegal(game, effect, choices)) return finish(game, 'STALE_TARGET_OR_COST');
  const usage = getDarkHextechUsage(game, effect.sourceHextechInstanceId)!;
  const playerId = effect.controllerId;
  const instanceId = effect.sourceHextechInstanceId;
  const targetId = choices.TARGET?.[0];
  const target = targetId ? getCardById(game, targetId)! : undefined;
  // Every choice was checked against the current state before the first payment mutation.
  let state = updatePlayer(game, playerId, (player) => ({
    ...player,
    energyZone: (choices.ENERGY ?? []).reduce((zone, id) => tapEnergy(zone, id), player.energyZone),
  }));
  state = {
    ...state,
    hextech: {
      ...state.hextech!,
      uses: [...(state.hextech?.uses ?? []), { instanceId, turn: state.turnCount }],
    },
  };
  state = addAction(state, 'HEXTECH_ACTIVATED', playerId, {
    instanceId,
    turn: state.turnCount,
    energyCardIds: choices.ENERGY ?? [],
    discardedCardIds: choices.DISCARD ?? [],
    restedCardIds: choices.REST ?? [],
    targetCardId: targetId,
  });
  if (choices.DISCARD?.length)
    state = discardHandCardsToWaitingRoomAndEnqueueTriggers(
      state,
      playerId,
      choices.DISCARD,
      { count: choices.DISCARD.length },
      enqueueTriggeredCardEffects
    )!.gameState;
  const cause = { kind: 'HEXTECH_EFFECT' as const, playerId, sourceHextechInstanceId: instanceId };
  if (choices.REST?.length)
    state = waitStageMembersAndEnqueueTriggers(state, {
      playerId,
      memberCardIds: choices.REST,
      cause,
      enqueueTriggeredCardEffects,
    }).gameState;
  switch (usage.owned.definitionId) {
    case 'dark-sit-down':
    case 'dark-borrowed-rest':
      state = waitStageMembersAndEnqueueTriggers(state, {
        playerId: target!.ownerId,
        memberCardIds: [targetId!],
        cause,
        enqueueTriggeredCardEffects,
      }).gameState;
      break;
    case 'dark-exit-notice':
    case 'dark-forced-encore':
    case 'dark-farewell-gift':
      state = returnStageMemberToHandAndEnqueueTriggers(
        state,
        target!.ownerId,
        targetId!,
        enqueueTriggeredCardEffects
      )!.gameState;
      break;
    case 'dark-silent-spotlight':
      state = {
        ...state,
        hextech: {
          ...state.hextech!,
          silencedMembers: [
            ...(state.hextech?.silencedMembers ?? []),
            {
              memberCardId: targetId!,
              playerId: target!.ownerId,
              lifecycleId: getStageMemberLifecycleId(state, targetId!),
              sourceInstanceId: instanceId,
              turn: state.turnCount,
            },
          ],
        },
      };
      break;
    case 'dark-borrow-now':
      state = drawCardsFromMainDeckToHand(state, playerId, 4)!.gameState;
      break;
  }
  return finish(state, 'HEXTECH_RESOLVED');
}
