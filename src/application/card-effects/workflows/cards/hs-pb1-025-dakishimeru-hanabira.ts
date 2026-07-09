import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { HS_PB1_025_LIVE_START_HASUNOSORA_WAITING_TARGET_GREEN_HEART_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { ZoneType } from '../../../../shared/types/enums.js';

const SELECT_HASUNOSORA_MEMBER_STEP_ID = 'HS_PB1_025_SELECT_HASUNOSORA_STAGE_MEMBER_GREEN_HEART';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1025DakishimeruHanabiraWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_025_LIVE_START_HASUNOSORA_WAITING_TARGET_GREEN_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1025LiveStartGreenHeart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_025_LIVE_START_HASUNOSORA_WAITING_TARGET_GREEN_HEART_ABILITY_ID,
    SELECT_HASUNOSORA_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHsPb1025LiveStartGreenHeart(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1025LiveStartGreenHeart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const hasunosoraWaitingMemberIds = getCardIdsInZoneMatching(
    game,
    player.id,
    ZoneType.WAITING_ROOM,
    (card) => isMemberCardData(card.data) && groupAliasIs('蓮ノ空')(card)
  );
  const selectableCardIds = getHasunosoraStageMemberIds(game, player.id);
  if (hasunosoraWaitingMemberIds.length < 10 || selectableCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step:
          hasunosoraWaitingMemberIds.length < 10
            ? 'SKIP_HASUNOSORA_WAITING_MEMBERS_LESS_THAN_TEN'
            : 'NO_HASUNOSORA_STAGE_MEMBER_TARGET',
        hasunosoraWaitingMemberCount: hasunosoraWaitingMemberIds.length,
        selectableCardIds,
      },
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
      stepId: SELECT_HASUNOSORA_MEMBER_STEP_ID,
      stepText: '请选择自己舞台上1名『莲之空』成员获得[緑ハート]。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardMode: 'SINGLE',
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择获得[緑ハート]的成员',
      confirmSelectionLabel: '获得[緑ハート]',
      metadata: {
        orderedResolution,
        hasunosoraWaitingMemberCount: hasunosoraWaitingMemberIds.length,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HASUNOSORA_STAGE_MEMBER_GREEN_HEART',
      hasunosoraWaitingMemberCount: hasunosoraWaitingMemberIds.length,
      selectableCardIds,
    },
  });
}

function finishHsPb1025LiveStartGreenHeart(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== HS_PB1_025_LIVE_START_HASUNOSORA_WAITING_TARGET_GREEN_HEART_ABILITY_ID ||
    effect.stepId !== SELECT_HASUNOSORA_MEMBER_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getHasunosoraStageMemberIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const heartResult = addHeartLiveModifierForMember(game, {
    playerId: player.id,
    memberCardId: selectedCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [{ color: HeartColor.GREEN, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...heartResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TARGET_HASUNOSORA_STAGE_MEMBER_GAIN_GREEN_HEART',
      targetMemberCardId: selectedCardId,
      hasunosoraWaitingMemberCount: effect.metadata?.hasunosoraWaitingMemberCount,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
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
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getHasunosoraStageMemberIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    const card = cardId ? getCardById(game, cardId) : null;
    return card !== null && isMemberCardData(card.data) && groupAliasIs('蓮ノ空')(card);
  });
}
