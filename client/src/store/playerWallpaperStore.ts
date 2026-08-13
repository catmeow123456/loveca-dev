import { create } from 'zustand';
import { downloadPlayerWallpaperAsset, fetchPlayerWallpaper } from '@/lib/playerWallpaperClient';
import type {
  PlayerWallpaperAssetView,
  PlayerWallpaperView,
} from '@game/online/player-wallpaper-types';

interface PlayerWallpaperState {
  readonly ownerUserId: string | null;
  readonly wallpaper: PlayerWallpaperView | null;
  readonly includesSources: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly objectUrls: Readonly<Record<string, string>>;
  readonly failedAssetIds: ReadonlySet<string>;
  setSessionUser: (userId: string | null) => void;
  load: (includeSources?: boolean, force?: boolean) => Promise<void>;
  applyWallpaper: (wallpaper: PlayerWallpaperView) => void;
  ensureAsset: (asset: PlayerWallpaperAssetView | null) => Promise<void>;
}

let loadGeneration = 0;
const pendingAssetLoads = new Map<string, Promise<void>>();
let activeWallpaperLoad: {
  readonly ownerUserId: string;
  readonly promise: Promise<void>;
} | null = null;

export const usePlayerWallpaperStore = create<PlayerWallpaperState>((set, get) => ({
  ownerUserId: null,
  wallpaper: null,
  includesSources: false,
  isLoading: false,
  error: null,
  objectUrls: {},
  failedAssetIds: new Set(),

  setSessionUser: (userId) => {
    if (get().ownerUserId === userId) return;
    loadGeneration += 1;
    revokeObjectUrls(get().objectUrls);
    pendingAssetLoads.clear();
    set({
      ownerUserId: userId,
      wallpaper: null,
      includesSources: false,
      isLoading: false,
      error: null,
      objectUrls: {},
      failedAssetIds: new Set(),
    });
    if (userId) void get().load(false);
  },

  load: async (includeSources = false, force = false) => {
    const ownerUserId = get().ownerUserId;
    if (!ownerUserId) return;
    if (activeWallpaperLoad?.ownerUserId === ownerUserId) {
      const activeLoad = activeWallpaperLoad;
      await activeLoad.promise;
      if (activeWallpaperLoad === activeLoad) activeWallpaperLoad = null;
      if (get().ownerUserId !== ownerUserId) return;
      if (force || (includeSources && !get().includesSources)) {
        await get().load(includeSources, force);
      }
      return;
    }
    if (!force && get().wallpaper && (!includeSources || get().includesSources)) return;
    const generation = loadGeneration;
    set({ isLoading: true, error: null, failedAssetIds: force ? new Set() : get().failedAssetIds });
    const promise = (async () => {
      try {
        const wallpaper = await fetchPlayerWallpaper(includeSources);
        if (generation !== loadGeneration || get().ownerUserId !== ownerUserId) return;
        set({ wallpaper, includesSources: includeSources, isLoading: false });
      } catch (error) {
        if (generation !== loadGeneration || get().ownerUserId !== ownerUserId) return;
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : '读取游戏桌壁纸失败',
        });
      }
    })();
    const activeLoad = { ownerUserId, promise };
    activeWallpaperLoad = activeLoad;
    try {
      await promise;
    } finally {
      if (activeWallpaperLoad === activeLoad) activeWallpaperLoad = null;
    }
  },

  applyWallpaper: (wallpaper) => {
    revokeObjectUrls(get().objectUrls);
    pendingAssetLoads.clear();
    set({
      wallpaper,
      includesSources: !!(wallpaper.wideSource || wallpaper.compactSource),
      objectUrls: {},
      failedAssetIds: new Set(),
      error: null,
    });
  },

  ensureAsset: async (asset) => {
    if (!asset || get().objectUrls[asset.id] || get().failedAssetIds.has(asset.id)) return;
    const existing = pendingAssetLoads.get(asset.id);
    if (existing) return existing;
    const ownerUserId = get().ownerUserId;
    const generation = loadGeneration;
    const pending = downloadPlayerWallpaperAsset(asset)
      .then((objectUrl) => {
        if (generation !== loadGeneration || get().ownerUserId !== ownerUserId) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        set((state) => ({ objectUrls: { ...state.objectUrls, [asset.id]: objectUrl } }));
      })
      .catch((error: unknown) => {
        if (generation !== loadGeneration || get().ownerUserId !== ownerUserId) return;
        set((state) => ({
          failedAssetIds: new Set([...state.failedAssetIds, asset.id]),
          error:
            error instanceof Error ? error.message : '自定义壁纸暂时无法加载，已使用系统默认背景。',
        }));
      })
      .finally(() => {
        pendingAssetLoads.delete(asset.id);
      });
    pendingAssetLoads.set(asset.id, pending);
    return pending;
  },
}));

function revokeObjectUrls(objectUrls: Readonly<Record<string, string>>): void {
  for (const url of Object.values(objectUrls)) {
    URL.revokeObjectURL(url);
  }
}
