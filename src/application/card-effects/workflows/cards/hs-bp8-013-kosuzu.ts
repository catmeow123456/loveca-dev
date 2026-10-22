import { getCardById, getPlayerById } from '../../../../domain/entities/game.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { HS_BP8_013_LIVE_START_DOLLCHESTRA_LIVE_GAIN_THREE_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { registerLiveStartConditionalSourceBladeWorkflowHandlers } from '../shared/live-start-conditional-source-blade.js';

export function registerHsBp8013KosuzuWorkflowHandlers(): void {
  registerLiveStartConditionalSourceBladeWorkflowHandlers([
    {
      abilityId: HS_BP8_013_LIVE_START_DOLLCHESTRA_LIVE_GAIN_THREE_BLADE_ABILITY_ID,
      bladeBonus: 3,
      actionStep: 'DOLLCHESTRA_LIVE_GAIN_THREE_BLADE',
      getContext: (game, ability) => {
        const ids = (getPlayerById(game, ability.controllerId)?.liveZone.cardIds ?? []).filter(
          (id) => {
            const card = getCardById(game, id);
            return card !== null && unitAliasIs('DOLLCHESTRA')(card);
          }
        );
        return {
          conditionMet: ids.length > 0,
          conditionText: `当前自己的LIVE卡区有${ids.length}张『DOLLCHESTRA』卡片`,
          metadata: { qualifyingLiveCardIds: ids },
        };
      },
    },
  ]);
}
