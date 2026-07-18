import type { GameState } from '../../../domain/entities/game.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type ActivatedAbilityUiConfig,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { getRenGrantedActivatedAbilityUiConfigs } from './granted-activated-abilities.js';

interface ActivatedAbilityUiQueryOptions {
  readonly game?: GameState;
  readonly playerId?: string;
  readonly sourceCardId?: string;
}

export function getActivatedAbilityUiConfigs(
  cardCode: string | undefined,
  sourceZone: CardAbilitySourceZone = CardAbilitySourceZone.STAGE_MEMBER,
  options: ActivatedAbilityUiQueryOptions = {}
): readonly ActivatedAbilityUiConfig[] {
  const directConfigs = getCardAbilityDefinitionsForCardCode(cardCode).flatMap((definition) =>
    definition.category === CardAbilityCategory.ACTIVATED &&
    definition.implemented &&
    definition.sourceZone === sourceZone &&
    definition.activatedUi
      ? [definition.activatedUi]
      : []
  );
  const grantedConfigs =
    sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
    options.game &&
    options.playerId &&
    options.sourceCardId
      ? getRenGrantedActivatedAbilityUiConfigs(
          options.game,
          options.playerId,
          options.sourceCardId
        )
      : [];

  const configsByAbilityId = new Map<string, ActivatedAbilityUiConfig>();
  for (const config of [...directConfigs, ...grantedConfigs]) {
    if (!configsByAbilityId.has(config.abilityId)) {
      configsByAbilityId.set(config.abilityId, config);
    }
  }
  return [...configsByAbilityId.values()].sort(
    (left, right) =>
      (left.displayOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.displayOrder ?? Number.MAX_SAFE_INTEGER)
  );
}

export function getActivatedAbilityUiConfig(
  cardCode: string | undefined,
  sourceZone: CardAbilitySourceZone = CardAbilitySourceZone.STAGE_MEMBER,
  options: ActivatedAbilityUiQueryOptions = {}
): ActivatedAbilityUiConfig | null {
  return getActivatedAbilityUiConfigs(cardCode, sourceZone, options)[0] ?? null;
}
