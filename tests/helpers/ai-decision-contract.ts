import {
  buildAiDecisionContract,
  getAiDecisionWitness,
  materializeAiDecisionCommand,
  sampleAiDecisionSelection,
  validateAiDecisionSelection,
  type AiDecisionContract,
  type AiDecisionContractHandle,
} from '../../src/application/ai-decisions/decision-contract';
import type { GameState } from '../../src/domain/entities/game';
import type { AiBattlePhaseOneAWindowSurface } from '../../src/server/ai-battle/phase-one-a-window-evidence';
import { selectConservativeDecision } from '../../src/server/ai-battle/conservative-decision-policy';

interface CertifiedAiDecisionSurfaceOptions {
  readonly authorityRevision?: number;
  readonly now?: number;
  readonly requiredMainPhaseActionKind?: 'ACTIVATE_ABILITY';
}

/**
 * Shared executable assertion used by the Phase 1A evidence matrix.
 *
 * It intentionally stops before executing the command so the surrounding
 * behavior test remains the authority-path assertion and can continue with
 * its scenario-specific choice.
 */
export function assertCertifiedAiDecisionSurface(
  game: GameState,
  playerId: string,
  expectedSurface: AiBattlePhaseOneAWindowSurface,
  options: CertifiedAiDecisionSurfaceOptions = {}
): AiDecisionContractHandle {
  const result = buildAiDecisionContract(
    game,
    playerId,
    options.authorityRevision ?? 0,
    options.now ?? 0
  );
  if (!result.ok) {
    throw new Error(
      `expected ${expectedSurface}, contract build failed with ${result.reason}: ${result.detail}`
    );
  }

  const actualSurface = classifySurface(result.handle.contract);
  if (actualSurface !== expectedSurface) {
    throw new Error(`expected ${expectedSurface}, received ${actualSurface}`);
  }

  const witness = getAiDecisionWitness(result.handle);
  if (!witness) {
    throw new Error(`${expectedSurface} did not provide a legal witness`);
  }
  const witnessValidation = validateAiDecisionSelection(result.handle, witness);
  if (!witnessValidation.ok) {
    throw new Error(`${expectedSurface} witness failed validation: ${witnessValidation.error}`);
  }
  const materialized = materializeAiDecisionCommand(result.handle, witness, options.now ?? 0);
  if (!materialized.ok) {
    throw new Error(`${expectedSurface} witness failed materialization: ${materialized.error}`);
  }

  const sampled = sampleAiDecisionSelection(result.handle, () => 0.731);
  if (!sampled) {
    throw new Error(`${expectedSurface} sampler did not return a selection`);
  }
  const sampledValidation = validateAiDecisionSelection(result.handle, sampled);
  if (!sampledValidation.ok) {
    throw new Error(`${expectedSurface} sampler failed validation: ${sampledValidation.error}`);
  }

  const conservative = selectConservativeDecision(result.handle.contract);
  if (!conservative.ok) {
    throw new Error(
      `${expectedSurface} conservative policy failed: ${conservative.reason}: ${conservative.detail}`
    );
  }
  const conservativeValidation = validateAiDecisionSelection(result.handle, conservative.selection);
  if (!conservativeValidation.ok) {
    throw new Error(
      `${expectedSurface} conservative selection failed validation: ${conservativeValidation.error}`
    );
  }
  const conservativeCommand = materializeAiDecisionCommand(
    result.handle,
    conservative.selection,
    options.now ?? 0
  );
  if (!conservativeCommand.ok) {
    throw new Error(
      `${expectedSurface} conservative selection failed materialization: ${conservativeCommand.error}`
    );
  }

  if (options.requiredMainPhaseActionKind) {
    assertMainPhaseAction(result.handle, options.requiredMainPhaseActionKind, options.now ?? 0);
  }

  return result.handle;
}

function classifySurface(contract: AiDecisionContract): AiBattlePhaseOneAWindowSurface {
  if (contract.kind !== 'ACTIVE_EFFECT') {
    if (
      contract.kind === 'MULLIGAN' ||
      contract.kind === 'MAIN_PHASE' ||
      contract.kind === 'LIVE_SET' ||
      contract.kind === 'JUDGMENT_CONFIRMATION' ||
      contract.kind === 'SCORE_CONFIRMATION' ||
      contract.kind === 'SUCCESS_LIVE_SELECTION' ||
      contract.kind === 'PHASE_CONFIRMATION'
    ) {
      return contract.kind;
    }
    throw new Error(`${contract.kind} is supported by the core but is outside this matrix`);
  }

  switch (contract.input.kind) {
    case 'CONFIRM':
      return 'ACTIVE_EFFECT_CONFIRM';
    case 'CARD_SELECTION':
      if (contract.input.groups.length > 0) return 'ACTIVE_EFFECT_CARD_GROUPED';
      return contract.input.ordered ? 'ACTIVE_EFFECT_CARD_ORDERED' : 'ACTIVE_EFFECT_CARD_SINGLE';
    case 'OPTION_SELECTION':
      return 'ACTIVE_EFFECT_OPTION';
    case 'ABILITY_ORDER':
      return 'ACTIVE_EFFECT_ABILITY_ORDER';
    case 'DEADLINE_CONFIRMATION':
      return 'ACTIVE_EFFECT_DEADLINE';
    case 'SLOT_SELECTION':
    case 'NUMBER_INPUT':
    case 'STAGE_FORMATION':
      throw new Error(`${contract.input.kind} is supported by the core but is outside this matrix`);
  }
}

function assertMainPhaseAction(
  handle: AiDecisionContractHandle,
  requiredKind: 'ACTIVATE_ABILITY',
  timestamp: number
): void {
  if (handle.contract.kind !== 'MAIN_PHASE') {
    throw new Error(`${requiredKind} can only be asserted on a MAIN_PHASE contract`);
  }
  const action = handle.contract.actions.find((candidate) => candidate.kind === requiredKind);
  if (!action) {
    throw new Error(`MAIN_PHASE contract did not expose ${requiredKind}`);
  }
  const selection = {
    kind: 'SELECT_MAIN_PHASE_ACTION',
    actionId: action.actionId,
  } as const;
  const validation = validateAiDecisionSelection(handle, selection);
  if (!validation.ok) {
    throw new Error(`${requiredKind} action failed validation: ${validation.error}`);
  }
  const materialized = materializeAiDecisionCommand(handle, selection, timestamp);
  if (!materialized.ok) {
    throw new Error(`${requiredKind} action failed materialization: ${materialized.error}`);
  }
}
