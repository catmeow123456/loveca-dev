import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
  S_BP7_024_LIVE_START_TARGET_AQOURS_MEMBER_ORIGINAL_HEART_GREEN_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_MEMBER_STEP_ID = 'LIVE_START_TARGET_MEMBER_ORIGINAL_HEART_COLOR_SELECT_MEMBER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface LiveStartTargetMemberOriginalHeartColorConfig {
  readonly abilityId: string;
  readonly sourceBaseCardCode: string;
  readonly groupAlias: string;
  readonly groupDisplayName: string;
  readonly heartColor: HeartColor;
  readonly heartToken: string;
  readonly startActionStep: string;
  readonly noTargetActionStep: string;
  readonly applyActionStep: string;
}

const CONFIGS: readonly LiveStartTargetMemberOriginalHeartColorConfig[] = [
  {
    abilityId: HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
    sourceBaseCardCode: 'PL!HS-bp5-021',
    groupAlias: '蓮ノ空',
    groupDisplayName: '莲之空',
    heartColor: HeartColor.PINK,
    heartToken: '[桃ハート]',
    startActionStep: 'START_SELECT_HASUNOSORA_STAGE_MEMBER',
    noTargetActionStep: 'NO_HASUNOSORA_STAGE_MEMBER_TARGET',
    applyActionStep: 'APPLY_TARGET_ORIGINAL_HEART_PINK_REPLACEMENT',
  },
  {
    abilityId: S_BP7_024_LIVE_START_TARGET_AQOURS_MEMBER_ORIGINAL_HEART_GREEN_ABILITY_ID,
    sourceBaseCardCode: 'PL!S-bp7-024',
    groupAlias: 'Aqours',
    groupDisplayName: 'Aqours',
    heartColor: HeartColor.GREEN,
    heartToken: '[緑ハート]',
    startActionStep: 'START_SELECT_AQOURS_STAGE_MEMBER',
    noTargetActionStep: 'NO_AQOURS_STAGE_MEMBER_TARGET',
    applyActionStep: 'APPLY_TARGET_ORIGINAL_HEART_GREEN_REPLACEMENT',
  },
] as const;

export function registerLiveStartTargetMemberOriginalHeartColorWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startTargetMemberOriginalHeartColor(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      SELECT_MEMBER_STEP_ID,
      (game, input, context) =>
        finishTargetMemberOriginalHeartColor(
          game,
          input.selectedCardId ?? null,
          config,
          context.continuePendingCardEffects
        )
    );
  }
}

function startTargetMemberOriginalHeartColor(
  game: GameState,
  ability: PendingAbilityState,
  config: LiveStartTargetMemberOriginalHeartColorConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = removePendingAbility(game, ability.id);
  if (!isSourceLiveValid(stateWithoutPending, player.id, ability.sourceCardId, config)) {
    return resolveAndContinue(
      stateWithoutPending,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      { step: 'SOURCE_LIVE_INVALID' }
    );
  }

  const selectableCardIds = getCurrentTargetMemberCardIds(stateWithoutPending, player.id, config);
  if (selectableCardIds.length === 0) {
    return resolveAndContinue(
      stateWithoutPending,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: config.noTargetActionStep,
        targetMemberCardIds: [],
        reason: config.noTargetActionStep,
      }
    );
  }

  return startPendingActiveEffect(stateWithoutPending, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_MEMBER_STEP_ID,
      stepText: `请选择自己舞台上的1名『${config.groupDisplayName}』成员，使其原本持有的HEART全部变为${config.heartToken}。`,
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: `选择原本HEART变为${config.heartToken}的成员`,
      confirmSelectionLabel: `将原本HEART变为${config.heartToken}`,
      canSkipSelection: false,
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: config.startActionStep,
      selectableCardIds,
      targetGroupAlias: config.groupAlias,
      heartColor: config.heartColor,
    },
  });
}

function finishTargetMemberOriginalHeartColor(
  game: GameState,
  selectedCardId: string | null,
  config: LiveStartTargetMemberOriginalHeartColorConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== SELECT_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const currentTargetMemberCardIds = player
    ? getCurrentTargetMemberCardIds(game, player.id, config)
    : [];
  const sourceValid =
    player !== null && isSourceLiveValid(game, player.id, effect.sourceCardId, config);
  const targetValid =
    player !== null && sourceValid && currentTargetMemberCardIds.includes(selectedCardId);
  if (!player || !targetValid) {
    return finishWithoutReplacement(
      game,
      effect,
      player?.id ?? effect.controllerId,
      continuePendingCardEffects,
      {
        step: sourceValid ? 'STALE_OR_INVALID_MEMBER_SELECTION' : 'SOURCE_LIVE_INVALID',
        selectedCardId,
        selectableCardIds: currentTargetMemberCardIds,
      }
    );
  }

  const replacementModifier: LiveModifierState = {
    kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
    playerId: player.id,
    memberCardId: selectedCardId,
    color: config.heartColor,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  };
  const state = replaceLiveModifier(
    { ...game, activeEffect: null },
    {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    replacementModifier
  );

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.applyActionStep,
      targetMemberCardId: selectedCardId,
      targetGroupAlias: config.groupAlias,
      heartColor: config.heartColor,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getCurrentTargetMemberCardIds(
  game: GameState,
  playerId: string,
  config: LiveStartTargetMemberOriginalHeartColorConfig
): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), groupAliasIs(config.groupAlias))
  );
}

function isSourceLiveValid(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  config: LiveStartTargetMemberOriginalHeartColorConfig
): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player !== null &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, config.sourceBaseCardCode) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function resolveAndContinue(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(game, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function finishWithoutReplacement(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}
