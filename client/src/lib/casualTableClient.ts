import { apiClient, toApiClientError } from '@/lib/apiClient';
import type {
  CasualLobbyQuery,
  CasualLobbyView,
  CasualRoomSummary,
  CasualTableCommandTarget,
  CasualTableCurrentView,
  CasualTableEntryInput,
  CreateCasualTableInput,
} from '@game/online/casual-table-types';
import type { OnlineSpectatorLinkView } from '@game/online/release-types';

async function data<T>(request: ReturnType<typeof apiClient.get<T>>): Promise<T> {
  const response = await request;
  if (!response.data) throw toApiClientError(response, '房间操作未完成，请重试');
  return response.data;
}
const base = '/api/casual-tables';
export const getCasualCurrent = () => data(apiClient.get<CasualTableCurrentView>(`${base}/me`));
export function getCasualLobby(query: CasualLobbyQuery = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return data(apiClient.get<CasualLobbyView>(`${base}/rooms?${params}`));
}
export const previewCasualRoom = (code: string) =>
  data(apiClient.get<CasualRoomSummary>(`${base}/rooms/${encodeURIComponent(code)}`));
export const casualWrite = (path: string, body: unknown) =>
  data(apiClient.post<unknown>(`${base}/${path}`, body));
export const findCasualOpponent = (entry: CasualTableEntryInput) => casualWrite('find', entry);
export const createCasualRoom = (entry: CreateCasualTableInput) => casualWrite('create', entry);
export const joinCasualRoom = (target: CasualTableCommandTarget, entry: CasualTableEntryInput) =>
  casualWrite('join', { target, entry });
export const spectateCasualRoom = (target: CasualTableCommandTarget, seat: 'FIRST' | 'SECOND') =>
  data(apiClient.post<OnlineSpectatorLinkView>(`${base}/spectate`, { target, seat }));
