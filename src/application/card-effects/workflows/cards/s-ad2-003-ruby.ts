import { addAction, getCardById } from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts } from '../../../effects/cheer-selection.js';
import { S_AD2_003_AUTO_ON_CHEER_BLADE_HEART_CARD_THRESHOLDS_GAIN_GREEN_BLUE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

export function registerSAd2003RubyWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, pending, options, context) => {
    const ability = {
      ...pending,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, pending),
    };
    const source = getCardById(game, ability.sourceCardId);
    const event = getLatestOwnNormalCheerEventByIds(game, ability.controllerId, ability.eventIds);
    const valid =
      source?.ownerId === ability.controllerId &&
      cardCodeMatchesBase(source.data.cardCode, 'PL!S-ad2-003') &&
      event !== null;
    const matchingCardIds = valid
      ? selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(game, ability.controllerId)
          .filter(({ effectiveBladeHearts }) => effectiveBladeHearts.length > 0)
          .map(({ cardId }) => cardId)
      : [];
    const sourceCurrent = isCurrentStageMemberAbilitySource(game, ability);
    const hearts =
      sourceCurrent && valid && matchingCardIds.length >= 5
        ? [
            { color: HeartColor.GREEN, count: 1 },
            ...(matchingCardIds.length >= 10 ? [{ color: HeartColor.BLUE, count: 1 }] : []),
          ]
        : [];
    if (valid) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
        game,
        ability,
        {
          ...options,
          confirmBeforeResolution:
            options.confirmBeforeResolution === true || options.orderedResolution !== true,
        },
        {
          effectText: `${getAbilityEffectText(ABILITY_ID)}（当前自己声援公开的持有BLADE HEART的卡片有${matchingCardIds.length}张，${hearts.length > 0 ? `实际获得[緑ハート]${hearts.length > 1 ? '和[青ハート]' : ''}` : '本次不获得HEART'}。）`,
          stepText: '确认后结算此效果。',
        }
      );
      if (confirmation) return confirmation;
    }
    let state = valid
      ? recordAbilityUseForContext(game, ability.controllerId, {
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          sourceLifecycleId: ability.sourceLifecycleId,
          pendingAbilityId: ability.id,
        })
      : game;
    state = {
      ...state,
      pendingAbilities: state.pendingAbilities.filter((entry) => entry.id !== ability.id),
    };
    if (hearts.length > 0) {
      state =
        addHeartLiveModifierForSourceMember(state, {
          playerId: ability.controllerId,
          sourceCardId: ability.sourceCardId,
          abilityId: ABILITY_ID,
          hearts,
        })?.gameState ?? state;
    }
    return context.continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: ability.sourceLifecycleId,
        step: valid ? 'CHEER_BLADE_HEART_CARD_THRESHOLDS' : 'INVALID_SOURCE_OR_CHEER_EVENT',
        cheerEventId: event?.eventId,
        matchingCardIds,
        matchingCount: matchingCardIds.length,
        hearts,
      }),
      options.orderedResolution === true
    );
  });
}
