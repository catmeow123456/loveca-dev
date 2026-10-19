import { create } from 'zustand';
export const useBattleConnection = create<{
  matchId: string | null;
  state: 'connecting' | 'connected' | 'retrying';
}>(() => ({ matchId: null, state: 'connecting' }));
export function reportBattleConnection(
  matchId: string,
  state: 'connecting' | 'connected' | 'retrying'
) {
  useBattleConnection.setState({ matchId, state });
}
