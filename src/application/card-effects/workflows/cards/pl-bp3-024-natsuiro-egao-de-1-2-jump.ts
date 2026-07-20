import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, groupIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HEART_COLOR_STEP_ID = 'PL_BP3_024_SELECT_HEART_COLOR';
const SELECT_MUSE_MEMBER_STEP_ID = 'PL_BP3_024_SELECT_MUSE_MEMBER';
const HEART_COLOR_OPTIONS = [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE] as const;
const HEART_COLOR_LABELS: Readonly<Record<(typeof HEART_COLOR_OPTIONS)[number], string>> = {
  [HeartColor.PINK]: '[桃ハート]',
  [HeartColor.YELLOW]: '[黄ハート]',
  [HeartColor.PURPLE]: '[紫ハート]',
};

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3024NatsuiroEgaoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startNatsuiroEgaoHeartSelection(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
    SELECT_HEART_COLOR_STEP_ID,
    (game, input, context) =>
      startNatsuiroEgaoMemberSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
    SELECT_MUSE_MEMBER_STEP_ID,
    (game, input, context) =>
      finishNatsuiroEgaoMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startNatsuiroEgaoHeartSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const successLiveCount = player?.successZone.cardIds.length ?? 0;
  const selectableCardIds = player ? getMuseStageMemberCardIds(game, player.id) : [];
  if (!player || !sourceInLiveZone || successLiveCount === 0 || selectableCardIds.length === 0) {
    return consumePendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      !sourceInLiveZone
        ? 'SOURCE_NOT_IN_LIVE_ZONE'
        : successLiveCount === 0
          ? 'NO_SUCCESS_LIVE'
          : 'NO_MUSE_STAGE_MEMBER_TARGET',
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_HEART_COLOR_STEP_ID,
      stepText: '请选择本次获得的Heart颜色。',
      awaitingPlayerId: player.id,
      selectableCardIds: [],
      selectableCardVisibility: 'PUBLIC',
      effectChoice: {
        mode: 'SINGLE',
        options: HEART_COLOR_OPTIONS.map((color) => ({
          id: color,
          text: `选择的成员获得${HEART_COLOR_LABELS[color]}。`,
        })),
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      selectionLabel: '选择Heart颜色',
      confirmSelectionLabel: '获得Heart',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HEART_COLOR',
      successLiveCount,
      selectableCardIds,
      heartColorOptions: HEART_COLOR_OPTIONS,
    },
  });
}

function startNatsuiroEgaoMemberSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_HEART_COLOR_STEP_ID
  ) {
    return game;
  }
  const selectedHeartColor = isHeartColorOption(selectedOptionId) ? selectedOptionId : null;
  if (selectedHeartColor === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(effect.sourceCardId) === true;
  const successLiveCount = player?.successZone.cardIds.length ?? 0;
  const selectableCardIds = player ? getMuseStageMemberCardIds(game, player.id) : [];
  if (!player || !sourceInLiveZone || successLiveCount === 0 || selectableCardIds.length === 0) {
    return finishWithoutHeartModifier(
      game,
      effect.controllerId,
      !sourceInLiveZone
        ? 'SOURCE_NOT_IN_LIVE_ZONE_BEFORE_TARGET'
        : successLiveCount === 0
          ? 'NO_SUCCESS_LIVE_BEFORE_TARGET'
          : 'NO_MUSE_STAGE_MEMBER_TARGET',
      { selectedHeartColor, successLiveCount },
      continuePendingCardEffects
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_MUSE_MEMBER_STEP_ID,
        stepText: "请选择自己舞台上的1名『μ's』成员获得所选Heart。",
        selectableCardIds,
        selectableCardMode: 'SINGLE',
        selectableOptions: undefined,
        effectChoice: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: "选择获得Heart的『μ's』成员",
        confirmSelectionLabel: '获得Heart',
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedHeartColor,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_HEART_COLOR_SELECT_MUSE_MEMBER_TARGET',
      selectedHeartColor,
      selectableCardIds,
      successLiveCount,
    }
  );
}

function finishNatsuiroEgaoMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_MUSE_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedHeartColor = isHeartColorOption(effect.metadata?.selectedHeartColor)
    ? effect.metadata.selectedHeartColor
    : null;
  if (!player || selectedHeartColor === null) {
    return game;
  }
  if (!getMuseStageMemberCardIds(game, player.id).includes(selectedCardId)) {
    return finishWithoutHeartModifier(
      game,
      player.id,
      'STALE_MUSE_STAGE_MEMBER_TARGET',
      { selectedHeartColor, selectedCardId },
      continuePendingCardEffects
    );
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(effect.sourceCardId);
  const successLiveCount = player.successZone.cardIds.length;
  if (!sourceInLiveZone || successLiveCount === 0) {
    return finishWithoutHeartModifier(
      game,
      player.id,
      sourceInLiveZone
        ? 'NO_SUCCESS_LIVE_BEFORE_APPLY_HEART'
        : 'SOURCE_NOT_IN_LIVE_ZONE_BEFORE_APPLY_HEART',
      { selectedHeartColor, selectedCardId, successLiveCount },
      continuePendingCardEffects
    );
  }

  const heartResult = addHeartLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      hearts: [{ color: selectedHeartColor, count: 1 }],
    }
  );
  if (!heartResult) {
    return finishWithoutHeartModifier(
      game,
      player.id,
      'TARGET_MEMBER_HEART_MODIFIER_UNAVAILABLE',
      { selectedHeartColor, selectedCardId, successLiveCount },
      continuePendingCardEffects
    );
  }

  return continuePendingCardEffects(
    addAction(heartResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_MUSE_MEMBER_GAIN_SELECTED_HEART',
      selectedHeartColor,
      selectedCardId,
      successLiveCount,
      heartBonus: heartResult.heartBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getMuseStageMemberCardIds(game: GameState, playerId: string): string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), groupIs("μ's"))
  );
}

function isHeartColorOption(value: unknown): value is (typeof HEART_COLOR_OPTIONS)[number] {
  return HEART_COLOR_OPTIONS.includes(value as (typeof HEART_COLOR_OPTIONS)[number]);
}

function consumePendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
      }
    ),
    orderedResolution
  );
}

function finishWithoutHeartModifier(
  game: GameState,
  playerId: string,
  step: string,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
