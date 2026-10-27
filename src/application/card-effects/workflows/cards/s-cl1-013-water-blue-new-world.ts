import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForTargetMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_CL1_013_LIVE_START_RECYCLE_AQOURS_GAIN_BLUE_HEART_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const RECYCLE = 'S_CL1_013_SELECT_WAITING_ROOM_MEMBERS';
const TARGET = 'S_CL1_013_SELECT_AQOURS_HEART_TARGET';
const AQOURS_MEMBER = and(typeIs(CardType.MEMBER), groupAliasIs('Aqours'));
const RECYCLE_MEMBER = and(AQOURS_MEMBER, not(hasBladeHeart()));
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerSCl1013WaterBlueNewWorldWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    start(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    RECYCLE,
    (game, input, context) =>
      recycle(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects
      ),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    TARGET,
    (game, input, context) =>
      grantHearts(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
    queryCardSelection
  );
}

function candidates(game: GameState, playerId: string): readonly string[] {
  return (
    getPlayerById(game, playerId)?.waitingRoom.cardIds.filter((id) => {
      const card = getCardById(game, id);
      return card?.ownerId === playerId && RECYCLE_MEMBER(card);
    }) ?? []
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuation: Continue
): GameState {
  const ordered = options.orderedResolution === true;
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const selectableCardIds = candidates(game, player.id);
  if (selectableCardIds.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      stepText: '当前休息室没有可放置于卡组底的成员卡，本次不移动卡片，也不获得HEART。',
    });
    if (confirmation) return confirmation;
    return continuation(
      addAction(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          step: 'NO_WAITING_ROOM_MEMBERS',
          movedCardIds: [],
          blueHeartCount: 0,
        }
      ),
      ordered
    );
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: RECYCLE,
      stepText:
        '请选择休息室中至多6张不持有BLADE HEART的『Aqours』成员卡。展示结束后将所选卡片混洗并放置于卡组底，每2张使自己舞台上的1名『Aqours』成员获得2个[青ハート]。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: Math.min(6, selectableCardIds.length),
      selectionLabel: '选择要混洗并放置于卡组底的成员卡',
      confirmSelectionLabel: '混洗并放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放回卡片',
      metadata: {
        orderedResolution: ordered,
        candidateCardIds: selectableCardIds,
        publicCardSelectionConfirmation: {
          source: 'WAITING_ROOM',
          destination: 'MAIN_DECK_BOTTOM',
        },
      },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_RECYCLE_AQOURS_MEMBERS' },
  });
}

function recycle(
  game: GameState,
  selectedIds: readonly string[],
  continuation: Continue
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== RECYCLE) return game;
  const original = effect.metadata?.candidateCardIds;
  const current = new Set(candidates(game, effect.controllerId));
  if (
    !Array.isArray(original) ||
    selectedIds.length > 6 ||
    new Set(selectedIds).size !== selectedIds.length ||
    selectedIds.some((id) => !original.includes(id) || !current.has(id))
  ) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? finish(game, effect, continuation, 'STALE_RECYCLE_SELECTION', {
          movedCardIds: [],
          blueHeartCount: 0,
        })
      : game;
  }
  const result = shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
    game,
    effect.controllerId,
    selectedIds,
    {
      kind: 'CARD_EFFECT',
      playerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: ABILITY_ID,
      pendingAbilityId: effect.id,
    }
  );
  if (!result) return game;
  const blueHeartCount = Math.floor(result.movedCardIds.length / 2) * 2;
  const state = addAction(result.gameState, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step: 'RECYCLE_AQOURS_MEMBERS',
    movedCardIds: result.movedCardIds,
    blueHeartCount,
  });
  const targetIds = getStageMemberCardIdsMatching(state, effect.controllerId, AQOURS_MEMBER);
  // Recycling is independent of the later recipient, including an empty stage.
  if (blueHeartCount === 0 || targetIds.length === 0)
    return finish(state, effect, continuation, 'RECYCLE_WITHOUT_HEART_REWARD', {
      movedCardIds: result.movedCardIds,
      blueHeartCount,
    });
  return openTarget(state, effect, targetIds, blueHeartCount);
}

function openTarget(
  game: GameState,
  effect: ActiveEffectState,
  targetIds: readonly string[],
  blueHeartCount: number
): GameState {
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: TARGET,
      stepText: `请选择自己舞台上的1名『Aqours』成员，LIVE结束时为止获得${blueHeartCount}个[青ハート]。`,
      selectableCardIds: targetIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: undefined,
      maxSelectableCards: undefined,
      selectionLabel: '选择获得蓝色HEART的成员',
      confirmSelectionLabel: '获得[青ハート]',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      revealedCardIds: undefined,
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        blueHeartCount,
        targetLifecycles: Object.fromEntries(
          targetIds.map((id) => [id, getStageMemberLifecycleId(game, id)])
        ),
      },
    },
  };
}

function grantHearts(game: GameState, id: string | null, continuation: Continue): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== TARGET ||
    !id ||
    !effect.selectableCardIds?.includes(id)
  )
    return game;
  const count = effect.metadata?.blueHeartCount;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > 6 ||
    count % 2 !== 0
  )
    return game;
  const targets = getStageMemberCardIdsMatching(game, effect.controllerId, AQOURS_MEMBER);
  const lifecycle = (
    effect.metadata?.targetLifecycles as Readonly<Record<string, string>> | undefined
  )?.[id];
  if (!targets.includes(id) || lifecycle !== getStageMemberLifecycleId(game, id)) {
    return targets.length > 0
      ? openTarget(game, effect, targets, count)
      : finish(game, effect, continuation, 'NO_HEART_TARGET_AFTER_RECYCLE');
  }
  const result = addHeartLiveModifierForTargetMember(game, {
    playerId: effect.controllerId,
    targetMemberCardId: id,
    sourceCardId: effect.sourceCardId,
    abilityId: ABILITY_ID,
    hearts: [{ color: HeartColor.BLUE, count }],
  });
  return result
    ? finish(result.gameState, effect, continuation, 'GRANT_BLUE_HEART', {
        targetMemberCardId: id,
        blueHeartCount: count,
      })
    : game;
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  continuation: Continue,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuation(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
