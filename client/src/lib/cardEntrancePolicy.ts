import type { BattleSurfaceCapabilities } from '../store/battleSurfaceCapabilities';

export function canPresentCardEntrance(
  capabilities: Pick<BattleSurfaceCapabilities, 'surface' | 'isReadOnly'>
) {
  return (
    !capabilities.isReadOnly &&
    ['LOCAL_DEBUG', 'REMOTE_DEBUG', 'SOLITAIRE', 'ONLINE'].includes(capabilities.surface)
  );
}
