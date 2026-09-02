import type { ActiveEffectViewState, MatchViewState } from '@game/online';

export function buildInspectionZoneInteractionKey(
  matchView: MatchViewState | null | undefined,
  activeEffect: ActiveEffectViewState | null | undefined
): string | null {
  const inspectionWindow = matchView?.window?.windowType === 'INSPECTION' ? matchView.window : null;
  if (!matchView || !inspectionWindow) {
    return null;
  }

  const sourceZone = inspectionWindow.context?.sourceZone ?? null;
  const windowActiveEffectId =
    typeof inspectionWindow.context?.activeEffectId === 'string'
      ? inspectionWindow.context.activeEffectId
      : null;
  const activeEffectStepId =
    windowActiveEffectId !== null && activeEffect?.id === windowActiveEffectId
      ? activeEffect.stepId
      : null;

  return JSON.stringify({
    matchId: matchView.matchId,
    actingSeat: inspectionWindow.actingSeat ?? null,
    sourceZone,
    activeEffectId: windowActiveEffectId,
    activeEffectStepId,
  });
}
