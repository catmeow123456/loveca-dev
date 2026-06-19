import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import {
  cardNameAliasIs,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import {
  countCardsMatchingSelector,
  getCardIdsInZone,
  getCardIdsMatchingSelector,
} from '../../../effects/conditions.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  addBladeLiveModifierForSourceMember,
  shuffleWaitingRoomCardsToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const DECLINE_OPTION_LABEL = '不发动';

export const HS_BP6_031_RECYCLE_OPTION_STEP_ID = 'HS_BP6_031_RECYCLE_MEMBERS_OPTION';
export const HS_BP6_031_SELECT_HIME_TARGET_STEP_ID = 'HS_BP6_031_SELECT_HIME_BLADE_TARGET';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp6031FanfareWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
    (game, ability, options) =>
      startHsBp6031LiveStartRecycleMembers(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
    HS_BP6_031_RECYCLE_OPTION_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'activate'
        ? finishHsBp6031RecycleWaitingRoomMembers(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
    HS_BP6_031_SELECT_HIME_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsBp6031SelectHimeBladeTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsBp6031LiveStartRecycleMembers(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingRoomMemberCardIds = getCardIdsMatchingSelector(
    game,
    getCardIdsInZone(game, player.id, ZoneType.WAITING_ROOM),
    typeIs(CardType.MEMBER)
  );
  const miraCraMemberCount = countCardsMatchingSelector(
    game,
    waitingRoomMemberCardIds,
    unitAliasIs('みらくらぱーく！')
  );

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID
      ),
      stepId: HS_BP6_031_RECYCLE_OPTION_STEP_ID,
      stepText: `可以将休息室${waitingRoomMemberCardIds.length}张成员卡洗回卡组底，其中みらくらぱーく！成员${miraCraMemberCount}张。`,
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: 'activate', label: '发动' },
        { id: 'decline', label: DECLINE_OPTION_LABEL },
      ],
      metadata: {
        orderedResolution,
        waitingRoomMemberCardIds,
        miraCraMemberCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_RECYCLE_WAITING_ROOM_MEMBERS_OPTION',
      waitingRoomMemberCardIds,
      miraCraMemberCount,
    },
  });
}

function finishHsBp6031RecycleWaitingRoomMembers(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP6_031_RECYCLE_OPTION_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingRoomMemberCardIds = getWaitingRoomMemberCardIds(game, player.id);
  const miraCraMemberCount = countCardsMatchingSelector(
    game,
    waitingRoomMemberCardIds,
    unitAliasIs('みらくらぱーく！')
  );
  const recycleResult = shuffleWaitingRoomCardsToDeckBottomForPlayer(
    game,
    player.id,
    waitingRoomMemberCardIds
  );
  if (!recycleResult) {
    return game;
  }

  const himeTargetCardIds =
    miraCraMemberCount >= 15
      ? getStageMemberCardIdsMatching(
          recycleResult.gameState,
          player.id,
          cardNameAliasIs('安養寺姫芽')
        )
      : [];
  const baseAction = {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    movedMemberCardIds: recycleResult.movedCardIds,
    miraCraMemberCount,
  };
  const orderedResolution = effect.metadata?.orderedResolution === true;

  if (himeTargetCardIds.length === 0) {
    const state = { ...recycleResult.gameState, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        ...baseAction,
        step:
          miraCraMemberCount >= 15
            ? 'RECYCLE_MEMBERS_NO_HIME_TARGET'
            : 'RECYCLE_MEMBERS_CONDITION_NOT_MET',
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...recycleResult.gameState,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: getAbilityEffectText(
          HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID
        ),
        stepId: HS_BP6_031_SELECT_HIME_TARGET_STEP_ID,
        stepText: '请选择1名自己舞台上的「安养寺姬芽」获得BLADE +3。',
        awaitingPlayerId: player.id,
        selectableCardIds: himeTargetCardIds,
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择获得BLADE +3的安养寺姬芽',
        confirmSelectionLabel: '获得BLADE',
        metadata: {
          orderedResolution,
          movedMemberCardIds: recycleResult.movedCardIds,
          miraCraMemberCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      ...baseAction,
      step: 'RECYCLE_MEMBERS_SELECT_HIME_TARGET',
      selectableCardIds: himeTargetCardIds,
    }
  );
}

function finishHsBp6031SelectHimeBladeTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP6_031_SELECT_HIME_TARGET_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(game, {
    playerId: player.id,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
    amount: 3,
  });
  if (!bladeResult) {
    return game;
  }

  const state = { ...bladeResult.gameState, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_HIME_GAIN_BLADE',
      targetMemberCardId: selectedCardId,
      bladeBonus: 3,
      movedMemberCardIds: effect.metadata?.movedMemberCardIds,
      miraCraMemberCount: effect.metadata?.miraCraMemberCount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getWaitingRoomMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getCardIdsMatchingSelector(
    game,
    getCardIdsInZone(game, playerId, ZoneType.WAITING_ROOM),
    typeIs(CardType.MEMBER)
  );
}
