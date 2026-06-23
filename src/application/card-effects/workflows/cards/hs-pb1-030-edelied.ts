import type { HeartIcon } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForMember,
  addLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, normalizeCardName, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_BLADE_TARGET_STEP_ID = 'HS_PB1_030_SELECT_EDELNOTE_MEMBER_BLADE_TARGET';
const SELECT_HEART_TARGET_STEP_ID =
  'HS_PB1_030_SELECT_DIFFERENT_NAME_EDELNOTE_MEMBER_PURPLE_HEART_TARGET';
const BLADE_BONUS = 2;
const PURPLE_HEART_BONUS: readonly HeartIcon[] = [{ color: HeartColor.PURPLE, count: 2 }];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const edelNoteMember = and(typeIs(CardType.MEMBER), unitAliasIs('EdelNote'));

export function registerHsPb1030EdeliedWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1030EdeliedLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID,
    SELECT_BLADE_TARGET_STEP_ID,
    (game, input, context) =>
      finishSelectBladeTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID,
    SELECT_HEART_TARGET_STEP_ID,
    (game, input, context) =>
      finishSelectHeartTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1030EdeliedLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getEdelNoteMemberCardIds(game, player.id);
  const stateWithoutPending = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_EDELNOTE_BLADE_TARGET',
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_BLADE_TARGET_STEP_ID,
        stepText: '请选择自己舞台上1名『EdelNote』成员获得 BLADE +2。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectionLabel: '选择获得 BLADE 的 EdelNote 成员',
        confirmSelectionLabel: '获得 BLADE',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          eventIds: ability.eventIds,
          timingId: ability.timingId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_EDELNOTE_BLADE_TARGET',
      selectableCardIds,
    }
  );
}

function finishSelectBladeTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_BLADE_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !getEdelNoteMemberCardIds(game, player.id).includes(selectedCardId)) {
    return game;
  }

  const bladeModifier = createTargetMemberBladeModifier(
    player.id,
    selectedCardId,
    effect.abilityId
  );
  let state = addLiveModifier(game, bladeModifier);
  const heartCandidateIds = getDifferentNameEdelNoteMemberCardIds(state, player.id, selectedCardId);
  const orderedResolution = effect.metadata?.orderedResolution === true;

  if (heartCandidateIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_DIFFERENT_NAME_EDELNOTE_HEART_TARGET',
        bladeTargetCardId: selectedCardId,
        bladeBonus: BLADE_BONUS,
      }),
      orderedResolution
    );
  }

  state = addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: SELECT_HEART_TARGET_STEP_ID,
        stepText: '请选择1名与获得 BLADE 的成员卡名不同的『EdelNote』成员获得紫 Heart +2。',
        selectableCardIds: heartCandidateIds,
        selectionLabel: '选择获得紫 Heart 的不同名 EdelNote 成员',
        confirmSelectionLabel: '获得紫 Heart',
        selectableOptions: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          bladeTargetCardId: selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_EDELNOTE_BLADE_TARGET',
      bladeTargetCardId: selectedCardId,
      bladeBonus: BLADE_BONUS,
      selectableCardIds: heartCandidateIds,
    }
  );

  return state;
}

function finishSelectHeartTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_HEART_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const bladeTargetCardId = getStringMetadata(effect.metadata?.bladeTargetCardId);
  if (
    !player ||
    !bladeTargetCardId ||
    !getDifferentNameEdelNoteMemberCardIds(game, player.id, bladeTargetCardId).includes(
      selectedCardId
    )
  ) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(game, {
    playerId: player.id,
    memberCardId: selectedCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: PURPLE_HEART_BONUS,
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_DIFFERENT_NAME_EDELNOTE_HEART_TARGET',
      bladeTargetCardId,
      heartTargetCardId: selectedCardId,
      heartBonus: heartResult.heartBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getEdelNoteMemberCardIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, edelNoteMember);
}

function getDifferentNameEdelNoteMemberCardIds(
  game: GameState,
  playerId: string,
  bladeTargetCardId: string
): readonly string[] {
  const bladeTargetCard = getCardById(game, bladeTargetCardId);
  const bladeTargetName = normalizeCardName(bladeTargetCard?.data.name);
  if (!bladeTargetName) {
    return [];
  }
  return getEdelNoteMemberCardIds(game, playerId).filter((cardId) => {
    const card = getCardById(game, cardId);
    return normalizeCardName(card?.data.name) !== bladeTargetName;
  });
}

function createTargetMemberBladeModifier(
  playerId: string,
  memberCardId: string,
  abilityId: string
): Extract<LiveModifierState, { readonly kind: 'BLADE' }> {
  return {
    kind: 'BLADE',
    playerId,
    countDelta: BLADE_BONUS,
    sourceCardId: memberCardId,
    abilityId,
  };
}

function getStringMetadata(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
