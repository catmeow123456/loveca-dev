import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts } from '../../../effects/cheer-selection.js';
import { revealCheerCardsFromMainDeck } from '../../../effects/cheer.js';
import { HS_AD2_001_AUTO_ON_CHEER_TWO_NO_BLADE_HEART_ADDITIONAL_CHEER_ABILITY_ID } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { getLatestOwnNormalCheerEventByIds } from '../../runtime/cheer-events.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = HS_AD2_001_AUTO_ON_CHEER_TWO_NO_BLADE_HEART_ADDITIONAL_CHEER_ABILITY_ID;

export function registerHsAd2001KozueWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, pending, options, context) => {
    const ordered = options.orderedResolution === true;
    const player = getPlayerById(game, pending.controllerId);
    const source = getCardById(game, pending.sourceCardId);
    const cheerEvent = getLatestOwnNormalCheerEventByIds(
      game,
      pending.controllerId,
      pending.eventIds
    );
    if (
      !player ||
      !source ||
      source.ownerId !== pending.controllerId ||
      !isMemberCardData(source.data) ||
      !cardCodeMatchesBase(source.data.cardCode, 'PL!HS-ad2-001') ||
      !cheerEvent
    ) {
      return context.continuePendingCardEffects(
        finish(game, pending, 'INVALID_SOURCE_OR_CHEER_EVENT'),
        ordered
      );
    }

    const ability = {
      ...pending,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, pending),
    };
    const matchingCardIds = selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts(
      game,
      ability.controllerId
    );
    const conditionMet = matchingCardIds.length >= 2;
    const additionalCheerCount =
      conditionMet && player.mainDeck.cardIds.length + player.waitingRoom.cardIds.length > 0
        ? 1
        : 0;
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
      game,
      ability,
      {
        ...options,
        confirmBeforeResolution: options.confirmBeforeResolution === true || !ordered,
      },
      {
        effectText: `${getAbilityEffectText(ABILITY_ID)}（当前自己声援公开的不持有BLADE HEART的卡片有${matchingCardIds.length}张，${conditionMet ? `满足条件，实际追加进行${additionalCheerCount}张卡片的声援` : '未满足条件，本次不追加声援'}。）`,
        stepText: '确认后结算此效果。',
      }
    );
    if (confirmation) return confirmation;

    const stateWithUse = recordAbilityUseForContext(game, ability.controllerId, {
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: ability.sourceLifecycleId,
      pendingAbilityId: ability.id,
    });
    const withoutPending = {
      ...stateWithUse,
      pendingAbilities: stateWithUse.pendingAbilities.filter((entry) => entry.id !== ability.id),
    };
    const result = conditionMet
      ? revealCheerCardsFromMainDeck(withoutPending, ability.controllerId, 1, {
          automated: true,
          additional: true,
        })
      : { gameState: withoutPending, cheerCardIds: [] as readonly string[] };
    return context.continuePendingCardEffects(
      addAction(result.gameState, 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: ability.sourceLifecycleId,
        step: conditionMet ? 'TWO_NO_BLADE_HEART_ADDITIONAL_CHEER' : 'CONDITION_NOT_MET',
        cheerEventId: cheerEvent.eventId,
        matchingCardIds,
        conditionMet,
        requestedAdditionalCheerCount: conditionMet ? 1 : 0,
        additionalCheerCardIds: result.cheerCardIds,
        actualAdditionalCheerCount: result.cheerCardIds.length,
      }),
      ordered
    );
  });
}

function finish(game: GameState, ability: PendingAbilityState, step: string): GameState {
  return addAction(
    { ...game, pendingAbilities: game.pendingAbilities.filter((entry) => entry.id !== ability.id) },
    'RESOLVE_ABILITY',
    ability.controllerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
    }
  );
}
