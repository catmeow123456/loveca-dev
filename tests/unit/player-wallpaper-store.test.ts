import type { PlayerWallpaperView } from '../../src/online/player-wallpaper-types';

const playerWallpaperClient = vi.hoisted(() => ({
  downloadPlayerWallpaperAsset: vi.fn(),
  fetchPlayerWallpaper: vi.fn(),
}));

vi.mock('@/lib/playerWallpaperClient', () => playerWallpaperClient);

import { usePlayerWallpaperStore } from '../../client/src/store/playerWallpaperStore';

function wallpaperView(version: number): PlayerWallpaperView {
  return {
    version,
    wideMode: 'DEFAULT',
    compactMode: 'INHERIT_PC',
    wideSolidPreset: null,
    compactSolidPreset: null,
    wide: null,
    compact: null,
    wideSource: null,
    compactSource: null,
    canPublishToday: true,
    nextChangeAt: null,
    lastPublishedAt: null,
  };
}

beforeEach(() => {
  usePlayerWallpaperStore.getState().setSessionUser(null);
  vi.clearAllMocks();
});

it('切换账号时并行加载新账号壁纸并忽略旧账号的迟到响应', async () => {
  let resolveFirst!: (wallpaper: PlayerWallpaperView) => void;
  let resolveSecond!: (wallpaper: PlayerWallpaperView) => void;
  playerWallpaperClient.fetchPlayerWallpaper
    .mockReturnValueOnce(
      new Promise<PlayerWallpaperView>((resolve) => {
        resolveFirst = resolve;
      })
    )
    .mockReturnValueOnce(
      new Promise<PlayerWallpaperView>((resolve) => {
        resolveSecond = resolve;
      })
    );

  usePlayerWallpaperStore.getState().setSessionUser('user-a');
  usePlayerWallpaperStore.getState().setSessionUser('user-b');

  expect(playerWallpaperClient.fetchPlayerWallpaper).toHaveBeenCalledTimes(2);

  resolveFirst(wallpaperView(1));
  resolveSecond(wallpaperView(2));
  await usePlayerWallpaperStore.getState().load();

  expect(usePlayerWallpaperStore.getState()).toMatchObject({
    ownerUserId: 'user-b',
    wallpaper: wallpaperView(2),
    isLoading: false,
    error: null,
  });
});
