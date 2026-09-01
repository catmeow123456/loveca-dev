import { apiClient, toApiClientError } from '@/lib/apiClient';

export interface MatchmakingBgmTrack {
  readonly id: string;
  readonly title: string;
  readonly audioUrl: string;
  readonly byteSize: number;
  readonly source: 'BUNDLED' | 'UPLOADED';
  readonly defaultSelected: boolean;
  readonly createdAt: string;
}

interface MatchmakingBgmLibrary {
  readonly tracks: readonly MatchmakingBgmTrack[];
}

export async function fetchMatchmakingBgmLibrary(): Promise<readonly MatchmakingBgmTrack[]> {
  const response = await apiClient.get<MatchmakingBgmLibrary>('/api/matchmaking-bgm');
  if (!response.data) {
    throw toApiClientError(response, '读取候场 BGM 曲库失败');
  }
  return response.data.tracks;
}

export async function fetchAdminMatchmakingBgmLibrary(): Promise<readonly MatchmakingBgmTrack[]> {
  const response = await apiClient.get<MatchmakingBgmLibrary>('/api/matchmaking-bgm/admin');
  if (!response.data) {
    throw toApiClientError(response, '读取候场 BGM 曲库失败');
  }
  return response.data.tracks;
}

export async function uploadAdminMatchmakingBgm(input: {
  readonly file: File;
  readonly title: string;
}): Promise<MatchmakingBgmTrack> {
  const form = new FormData();
  form.append('title', input.title);
  form.append('file', input.file, input.file.name);
  const response = await apiClient.post<MatchmakingBgmTrack>(
    '/api/matchmaking-bgm/admin',
    form,
    60_000
  );
  if (!response.data) {
    throw toApiClientError(response, '上传 BGM 失败');
  }
  return response.data;
}

export async function deleteAdminMatchmakingBgm(trackId: string): Promise<void> {
  const response = await apiClient.delete<{ deleted: true }>(
    `/api/matchmaking-bgm/admin/${encodeURIComponent(trackId)}`
  );
  if (!response.data) {
    throw toApiClientError(response, '删除 BGM 失败');
  }
}

export async function saveAdminDefaultMatchmakingBgmTracks(
  trackIds: readonly string[]
): Promise<readonly MatchmakingBgmTrack[]> {
  const response = await apiClient.put<MatchmakingBgmLibrary>(
    '/api/matchmaking-bgm/admin/default',
    { trackIds }
  );
  if (!response.data) {
    throw toApiClientError(response, '保存默认候场曲目失败');
  }
  return response.data.tracks;
}
