import { addAction, getPlayerById } from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
  replaceLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { SP_AD1_003_LIVE_START_YELLOW_PURPLE_SIX_REDUCE_SOURCE_COLORLESS_REQUIREMENT_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

export function registerSpAd1003KillerKyunWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, pending, options, context) => {
    const ability = {
      ...pending,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, pending),
    };
    const player = getPlayerById(game, ability.controllerId);
    const liveModifiers = collectLiveModifiers(game);
    const heartCount = player
      ? getAllMemberCardIds(player.memberSlots).reduce(
          (total, id) =>
            total +
            getMemberEffectiveHeartIcons(game, player.id, id, liveModifiers)
              .filter(({ color }) => color === HeartColor.YELLOW || color === HeartColor.PURPLE)
              .reduce((sum, heart) => sum + heart.count, 0),
          0
        )
      : 0;
    const sourceCurrent = isCurrentLiveCardAbilitySource(game, ability);
    const reduction = sourceCurrent && heartCount >= 6 ? 1 : 0;
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: `${getAbilityEffectText(ABILITY_ID)}（当前自己舞台成员持有的[黄ハート]和[紫ハート]合计${heartCount}个，实际减少${reduction}个必要无色HEART。）`,
      stepText: '确认后结算此效果。',
    });
    if (confirmation) return confirmation;
    const state = sourceCurrent
      ? replaceLiveModifier(
          game,
          {
            kind: 'REQUIREMENT',
            liveCardId: ability.sourceCardId,
            sourceCardId: ability.sourceCardId,
            abilityId: ABILITY_ID,
          },
          reduction > 0
            ? {
                kind: 'REQUIREMENT',
                liveCardId: ability.sourceCardId,
                sourceCardId: ability.sourceCardId,
                abilityId: ABILITY_ID,
                modifiers: [{ color: HeartColor.RAINBOW, countDelta: -reduction }],
              }
            : null
        )
      : game;
    return context.continuePendingCardEffects(
      addAction(
        {
          ...state,
          pendingAbilities: state.pendingAbilities.filter((entry) => entry.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        ability.controllerId,
        {
          pendingAbilityId: ability.id,
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          step: 'YELLOW_PURPLE_SIX_REDUCE_SOURCE_COLORLESS_REQUIREMENT',
          heartCount,
          reduction,
        }
      ),
      options.orderedResolution === true
    );
  });
}
