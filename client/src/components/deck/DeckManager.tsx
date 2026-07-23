/**
 * DeckManager - 卡组管理页面
 * 支持创建新卡组、编辑已有卡组、删除卡组
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Plus,
  Upload,
  Download,
  Save,
  Trash2,
  Pencil,
  Loader2,
  AlertTriangle,
  Wifi,
  WifiOff,
  Check,
  Circle,
  Zap,
  Globe,
  Copy,
  CopyPlus,
  ExternalLink,
  EyeOff,
  Link2,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { useDeckStore } from '@/store/deckStore';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';
import { CardType } from '@game/shared/types/enums';
import { apiClient, isApiConfigured, type DeckRecord } from '@/lib/apiClient';
import { CardEditor } from '@/components/deck-editor';
import {
  calculateDeckStats,
  DeckStatsRow,
  getDeckPointTextClass,
  PageHeader,
  ThemeToggle,
} from '@/components/common';
import { PRESET_DECKS, type PresetDeck } from './preset-decks';
import {
  CardDataRegistry,
  DeckConfigSchema,
  DeckLoader,
  type CardEntry,
  type DeckConfig,
} from '@game/domain/card-data/deck-loader';
import {
  calculateDeckConfigStats,
  validateDeckConfig,
  DECK_POINT_LIMIT,
} from '@game/domain/rules/deck-construction';
import * as yaml from 'yaml';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  createDeckRecordCardTypeResolver,
  deckConfigToRecordPayload,
  deckRecordToConfig,
} from '@/lib/deckRecordUtils';
import { createNewDeckConfig } from '@game/domain/card-data/deck-defaults';

type ViewMode = 'list' | 'edit';
type DecklogSource = 'jp' | 'en';

const DECKLOG_SOURCE_LABELS: Record<DecklogSource, string> = {
  jp: '日版 DeckLog',
  en: '国际版 DeckLog',
};

const DECKLOG_SOURCE_META: Record<
  DecklogSource,
  { title: string; domain: string; example: string }
> = {
  jp: {
    title: '日本版',
    domain: 'decklog.bushiroad.com',
    example: '2D6XL',
  },
  en: {
    title: '国际版',
    domain: 'decklog-en.bushiroad.com',
    example: '60G2Q',
  },
};

function inferDecklogSource(input: string): DecklogSource | null {
  const normalized = input.trim().toLowerCase();
  if (normalized.includes('decklog-en.bushiroad.com')) return 'en';
  if (normalized.includes('decklog.bushiroad.com')) return 'jp';
  return null;
}

interface DeckManagerProps {
  onBack: () => void;
  initialOpenDeckId?: string | null;
}

function formatYamlStructureError(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join('.') || '根节点'}: ${issue.message}`)
    .join('；');
}

export function DeckManager({ onBack, initialOpenDeckId = null }: DeckManagerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingDeck, setEditingDeck] = useState<DeckConfig | null>(null);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [deckName, setDeckName] = useState('');
  const [deckDescription, setDeckDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [sharingDeckId, setSharingDeckId] = useState<string | null>(null);
  const [copyingDeckId, setCopyingDeckId] = useState<string | null>(null);
  const [openActionsDeckId, setOpenActionsDeckId] = useState<string | null>(null);
  const [showImportSheet, setShowImportSheet] = useState(false);

  // 初始快照用于 dirty 检测
  const [initialSnapshot, setInitialSnapshot] = useState('');
  const initialOpenHandled = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const isDirty = editingDeck
    ? JSON.stringify(editingDeck) !== initialSnapshot ||
      deckName !== editingDeck.player_name ||
      deckDescription !== (editingDeck.description || '')
    : false;

  // Deck store
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const isLoadingCloud = useDeckStore((s) => s.isLoadingCloud);
  const cloudError = useDeckStore((s) => s.cloudError);
  const fetchCloudDecks = useDeckStore((s) => s.fetchCloudDecks);
  const saveToCloud = useDeckStore((s) => s.saveToCloud);
  const deleteCloudDeck = useDeckStore((s) => s.deleteCloudDeck);
  const validateDeck = useDeckStore((s) => s.validateDeck);

  // Auth store
  const { profile, offlineMode, offlineUser } = useAuthStore();
  const displayUsername = offlineMode
    ? offlineUser?.displayName || 'Guest'
    : profile?.display_name || profile?.username || 'User';
  const cloudFeaturesUnavailable = offlineMode || !isApiConfigured;

  // DeckLog 导入
  const [showDecklogDialog, setShowDecklogDialog] = useState(false);
  const [decklogInput, setDecklogInput] = useState('');
  const [decklogSource, setDecklogSource] = useState<DecklogSource>('jp');
  const [decklogLoading, setDecklogLoading] = useState(false);
  const [decklogError, setDecklogError] = useState<string | null>(null);
  const [decklogWarnings, setDecklogWarnings] = useState<string[]>([]);
  const [mobileMetaExpanded, setMobileMetaExpanded] = useState(false);
  const isMobile = useMediaQuery('(max-width: 767px)');

  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );

  useEffect(() => {
    fetchCloudDecks();
  }, [fetchCloudDecks, offlineMode]);

  useEffect(() => {
    if (!showDecklogDialog && !showImportSheet) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showDecklogDialog && !decklogLoading) setShowDecklogDialog(false);
      if (showImportSheet) setShowImportSheet(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [decklogLoading, showDecklogDialog, showImportSheet]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!openActionsDeckId) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenActionsDeckId(null);
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(`[data-deck-actions-root="${openActionsDeckId}"]`)
      ) {
        return;
      }
      setOpenActionsDeckId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('pointerdown', closeOnOutsidePress);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('pointerdown', closeOnOutsidePress);
    };
  }, [openActionsDeckId]);

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2200);
  };

  const handleCreateNew = () => {
    const newDeck = createNewDeckConfig('新卡组');
    setEditingDeck(newDeck);
    setEditingDeckId(null);
    setDeckName('新卡组');
    setDeckDescription('');
    setSaveError(null);
    setInitialSnapshot(JSON.stringify(newDeck));
    setViewMode('edit');
  };

  const handleEdit = useCallback(
    (cloudDeck: DeckRecord) => {
      const localDeck = deckRecordToConfig(cloudDeck, {
        resolveCardType: resolveDeckRecordCardType,
      });

      setEditingDeck(localDeck);
      setEditingDeckId(cloudDeck.id);
      setDeckName(cloudDeck.name);
      setDeckDescription(cloudDeck.description || '');
      setSaveError(null);
      setInitialSnapshot(JSON.stringify(localDeck));
      setViewMode('edit');
    },
    [resolveDeckRecordCardType]
  );

  useEffect(() => {
    if (!initialOpenDeckId || initialOpenHandled.current || cloudDecks.length === 0) return;
    const targetDeck = cloudDecks.find((deck) => deck.id === initialOpenDeckId);
    if (!targetDeck) return;

    const timer = window.setTimeout(() => {
      if (initialOpenHandled.current) return;
      initialOpenHandled.current = true;
      handleEdit(targetDeck);
      window.history.replaceState({}, '', '/');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cloudDecks, handleEdit, initialOpenDeckId]);

  const handleDelete = async (deckId: string) => {
    const result = await deleteCloudDeck(deckId);
    if (!result.success) {
      setSaveError(result.error || '删除失败');
    }
    setDeleteConfirm(null);
  };

  const handleCopyDeck = async (deck: DeckRecord) => {
    if (cloudFeaturesUnavailable) {
      setSaveError('离线模式下无法复制云端卡组');
      return;
    }

    setOpenActionsDeckId(null);
    setCopyingDeckId(deck.id);
    setSaveError(null);

    try {
      const result = await apiClient.post<DeckRecord>(`/api/decks/${deck.id}/copy`);
      if (result.error || !result.data) {
        setSaveError(result.error?.message || '复制卡组失败');
        return;
      }

      await fetchCloudDecks();
      handleEdit(result.data);
      showToast(`已创建 ${result.data.name}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '复制卡组失败');
    } finally {
      setCopyingDeckId(null);
    }
  };

  const getShareUrl = (deck: DeckRecord) =>
    `${window.location.origin}/decks/share/${deck.share_id}`;

  const handleEnableShare = async (deckId: string) => {
    if (cloudFeaturesUnavailable) {
      setSaveError('离线模式下无法分享云端卡组');
      return;
    }

    setSharingDeckId(deckId);
    setSaveError(null);

    try {
      const result = await apiClient.post<DeckRecord>(`/api/decks/${deckId}/share`);
      if (result.error || !result.data?.share_id) {
        setSaveError(result.error?.message || '开启分享失败');
        return;
      }

      await fetchCloudDecks();

      try {
        await navigator.clipboard.writeText(getShareUrl(result.data));
        showToast('分享已开启，链接已复制');
      } catch {
        showToast('分享已开启，可以点击“复制链接”手动复制');
      }
    } finally {
      setSharingDeckId(null);
    }
  };

  const handleDisableShare = async (deckId: string) => {
    if (cloudFeaturesUnavailable) {
      setSaveError('离线模式下无法关闭分享');
      return;
    }

    setSharingDeckId(deckId);
    setSaveError(null);

    try {
      const result = await apiClient.delete<DeckRecord>(`/api/decks/${deckId}/share`);
      if (result.error) {
        setSaveError(result.error.message);
        return;
      }
      await fetchCloudDecks();
      showToast('已关闭分享');
    } finally {
      setSharingDeckId(null);
    }
  };

  const handleCopyShareLink = async (deck: DeckRecord) => {
    if (cloudFeaturesUnavailable) {
      setSaveError('离线模式下无法使用分享链接');
      return;
    }

    if (!deck.share_id) {
      setSaveError('该卡组尚未生成分享链接');
      return;
    }

    try {
      await navigator.clipboard.writeText(getShareUrl(deck));
      showToast('分享链接已复制');
    } catch {
      setSaveError('复制链接失败，请检查浏览器权限');
    }
  };

  const handleOpenShare = (deck: DeckRecord) => {
    if (cloudFeaturesUnavailable) {
      setSaveError('离线模式下无法打开分享页');
      return;
    }

    if (!deck.share_id) {
      setSaveError('该卡组尚未生成分享链接');
      return;
    }
    window.location.href = getShareUrl(deck);
  };

  const handleSave = async () => {
    if (!editingDeck || !deckName.trim()) {
      setSaveError('请输入卡组名称');
      return;
    }

    if (cloudFeaturesUnavailable) {
      setSaveError('离线模式下无法保存云端卡组，请使用导出 YAML 备份当前卡组');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const deckToSave: DeckConfig = {
        ...editingDeck,
        player_name: deckName.trim(),
        description: deckDescription.trim(),
      };

      if (editingDeckId) {
        const deckPayload = deckConfigToRecordPayload(deckToSave);

        const result = await apiClient.put<DeckRecord>(`/api/decks/${editingDeckId}`, {
          name: deckName.trim(),
          description: deckDescription.trim(),
          main_deck: deckPayload.main_deck,
          energy_deck: deckPayload.energy_deck,
        });

        if (result.error) {
          setSaveError(result.error.message || '保存失败');
          return;
        }
      } else {
        useDeckStore.setState({ player1Deck: deckToSave });
        const result = await saveToCloud('player1', deckName.trim(), deckDescription.trim());

        if (!result.success) {
          setSaveError(result.error || '保存失败');
          return;
        }
      }

      await fetchCloudDecks();
      setViewMode('list');
      setEditingDeck(null);
      setEditingDeckId(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setViewMode('list');
    setEditingDeck(null);
    setEditingDeckId(null);
    setSaveError(null);
  };

  const handleUsePreset = (preset: PresetDeck) => {
    const deck = { ...preset.deck };
    setEditingDeck(deck);
    setEditingDeckId(null);
    setDeckName(preset.name);
    setDeckDescription(preset.description);
    setSaveError(null);
    setInitialSnapshot(JSON.stringify(deck));
    setViewMode('edit');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const rawDeck = yaml.parse(content);
        const parseResult = DeckConfigSchema.safeParse(rawDeck);

        if (!parseResult.success) {
          setSaveError(`YAML 结构错误：${formatYamlStructureError(parseResult.error.issues)}`);
          return;
        }

        const registry = new CardDataRegistry();
        registry.load(Array.from(cardDataRegistry.values()));
        const loader = new DeckLoader(registry);
        const loadResult = loader.loadFromConfig(parseResult.data);

        if (!loadResult.success) {
          setSaveError(`YAML 卡牌校验失败：${loadResult.errors.join('；')}`);
          return;
        }

        const deck = parseResult.data;

        setEditingDeck(deck);
        setDeckName(deck.player_name || '导入的卡组');
        setDeckDescription(deck.description || '');
        setSaveError(null);
        setInitialSnapshot(JSON.stringify(deck));
        setViewMode('edit');
        if (loadResult.warnings.length > 0) {
          showToast(`YAML 已导入，${loadResult.warnings[0]}`);
        }
      } catch {
        setSaveError('YAML 格式错误');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDecklogImport = async () => {
    if (!decklogInput.trim()) {
      setDecklogError('请输入 DeckLog 卡组 ID 或 URL');
      return;
    }

    if (offlineMode) {
      setDecklogError('离线模式下无法使用 DeckLog 导入');
      return;
    }

    if (!isApiConfigured) {
      setDecklogError('需要连接后端服务才能使用此功能');
      return;
    }

    setDecklogLoading(true);
    setDecklogError(null);
    setDecklogWarnings([]);

    try {
      const result = await apiClient.post<{
        cards: { card_code: string; count: number; raw_code: string }[];
        deckName: string;
        source: DecklogSource;
      }>('/api/decks/scrape-decklog', {
        deck_id: decklogInput.trim(),
        source: decklogSource,
      });

      if (!result.data) {
        setDecklogError(result.error?.message || '爬取失败');
        return;
      }

      const { cards, deckName: scrapedName } = result.data;
      const members: CardEntry[] = [];
      const lives: CardEntry[] = [];
      const energyDeck: CardEntry[] = [];
      const warnings: string[] = [];

      for (const card of cards) {
        const cardData = cardDataRegistry.get(card.card_code);
        if (!cardData) {
          warnings.push(`未找到卡牌: ${card.card_code} (${card.raw_code})`);
          continue;
        }

        const entry: CardEntry = { card_code: card.card_code, count: card.count };
        if (cardData.cardType === CardType.MEMBER) {
          members.push(entry);
        } else if (cardData.cardType === CardType.LIVE) {
          lives.push(entry);
        } else if (cardData.cardType === CardType.ENERGY) {
          energyDeck.push(entry);
        }
      }

      if (members.length === 0 && lives.length === 0 && energyDeck.length === 0) {
        setDecklogError('没有匹配到任何已知卡牌，请检查卡牌数据是否已加载');
        return;
      }

      setDecklogWarnings(warnings);

      const deck: DeckConfig = {
        player_name: scrapedName || 'DeckLog 导入',
        description: `从 ${DECKLOG_SOURCE_LABELS[decklogSource]} 导入 (${decklogInput.trim()})`,
        main_deck: { members, lives },
        energy_deck: energyDeck,
      };

      setEditingDeck(deck);
      setEditingDeckId(null);
      setDeckName(deck.player_name || 'DeckLog 导入');
      setDeckDescription(deck.description || '');
      setSaveError(null);
      setInitialSnapshot(JSON.stringify(deck));
      setViewMode('edit');
      setShowDecklogDialog(false);
      setDecklogInput('');
    } catch {
      setDecklogError('请求失败，请检查网络连接');
    } finally {
      setDecklogLoading(false);
    }
  };

  const handleExport = () => {
    if (!editingDeck) return;

    const deckToExport = {
      ...editingDeck,
      player_name: deckName.trim(),
      description: deckDescription.trim(),
    };

    const yamlStr = yaml.stringify(deckToExport);
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deckName.trim() || 'deck'}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-shell app-viewport-shell flex flex-col">
      <PageHeader
        title={viewMode === 'list' ? '卡组管理' : editingDeckId ? '编辑卡组' : '创建卡组'}
        left={
          <button
            onClick={viewMode === 'edit' ? handleCancelEdit : onBack}
            className="button-ghost inline-flex h-10 items-center justify-center gap-1.5 px-2.5 py-2 text-sm sm:px-3"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">{viewMode === 'edit' ? '取消' : '返回'}</span>
          </button>
        }
        right={
          <>
            <ThemeToggle />
            <div className="status-pill min-w-0 max-w-full px-2.5 py-1 text-xs">
              {offlineMode ? (
                <WifiOff size={12} className="text-[var(--semantic-warning)]" />
              ) : isApiConfigured ? (
                <Wifi size={12} className="text-[var(--semantic-success)]" />
              ) : (
                <Zap size={12} className="text-[var(--text-secondary)]" />
              )}
              <span className="truncate font-medium text-[var(--text-primary)] max-[420px]:max-w-[92px] sm:max-w-none">
                {displayUsername}
              </span>
            </div>
          </>
        }
      />

      <AnimatePresence mode="wait">
        {viewMode === 'list' ? (
          <motion.main
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="relative z-10 flex-1 overflow-y-auto p-3 sm:p-6"
          >
            <div className="workspace-shell mx-auto max-w-5xl p-3 sm:p-6">
              <div className="mb-5 sm:flex sm:justify-end">
                {isMobile ? (
                  <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <button
                      onClick={handleCreateNew}
                      className="button-primary inline-flex min-h-11 items-center justify-center gap-1.5 px-5 py-2 text-sm font-bold"
                    >
                      <Plus size={15} />
                      创建卡组
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowImportSheet(true)}
                      className="button-secondary inline-flex min-h-11 items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold"
                      aria-haspopup="dialog"
                    >
                      <Upload size={15} />
                      导入
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <button
                      onClick={() => {
                        if (cloudFeaturesUnavailable) {
                          setSaveError('离线模式下无法使用 DeckLog 导入');
                          return;
                        }
                        setShowDecklogDialog(true);
                        setDecklogSource('jp');
                        setDecklogError(null);
                        setDecklogWarnings([]);
                      }}
                      className={`button-secondary inline-flex min-h-11 items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium ${
                        cloudFeaturesUnavailable ? 'opacity-60' : ''
                      }`}
                      title={
                        cloudFeaturesUnavailable ? '离线模式下无法使用 DeckLog 导入' : undefined
                      }
                    >
                      <Globe size={14} />从 DeckLog 导入
                    </button>
                    <label className="button-secondary inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium">
                      <Upload size={14} />
                      导入 YAML
                      <input
                        type="file"
                        accept=".yaml,.yml"
                        className="hidden"
                        onChange={handleImport}
                      />
                    </label>
                    <button
                      onClick={handleCreateNew}
                      className="button-primary inline-flex min-h-11 items-center justify-center gap-1.5 px-5 py-2 text-sm font-bold"
                    >
                      <Plus size={14} />
                      创建新卡组
                    </button>
                  </div>
                )}
              </div>

              {isLoadingCloud && cloudDecks.length === 0 && (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <Loader2
                      size={32}
                      className="mx-auto mb-3 animate-spin text-[var(--accent-primary)]"
                    />
                    <div className="text-sm text-[var(--text-secondary)]">加载卡组中...</div>
                  </div>
                </div>
              )}

              {cloudError && (
                <div className="mb-6 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-4">
                  <div className="flex items-center gap-2 text-sm text-[var(--semantic-error)]">
                    <AlertTriangle size={14} />
                    <span>{cloudError}</span>
                    <button
                      onClick={fetchCloudDecks}
                      className="ml-auto text-sm underline underline-offset-2"
                    >
                      重试
                    </button>
                  </div>
                </div>
              )}

              {saveError && (
                <div className="mb-6 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-4">
                  <div className="flex items-center gap-2 text-sm text-[var(--semantic-error)]">
                    <AlertTriangle size={14} />
                    <span>{saveError}</span>
                  </div>
                </div>
              )}

              {/* Empty State with Presets */}
              {!isLoadingCloud && cloudDecks.length === 0 && (
                <div className="py-8">
                  <div className="text-center mb-6">
                    <div className="mb-1 text-base text-[var(--text-secondary)]">还没有卡组</div>
                    <div className="text-sm text-[var(--text-muted)]">
                      从推荐卡组开始，或自由创建
                    </div>
                  </div>

                  <div className="mb-3 text-xs font-semibold tracking-wider text-[var(--text-muted)]">
                    推荐卡组
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-8">
                    {PRESET_DECKS.map((preset) => {
                      const { memberCount, liveCount, energyCount, pointTotal } =
                        calculateDeckConfigStats(preset.deck);
                      return (
                        <div
                          key={preset.id}
                          onClick={() => handleUsePreset(preset)}
                          className="group cursor-pointer rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] p-4 transition-all duration-200 hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h3 className="mb-0.5 text-base font-bold text-[var(--text-primary)]">
                                {preset.name}
                              </h3>
                              <p className="text-xs text-[var(--text-secondary)]">
                                {preset.description}
                              </p>
                            </div>
                            <span className="chip-badge ml-3 flex-shrink-0 px-2 py-0.5 text-xs">
                              {preset.tag}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                              <span>成员 {memberCount}/48</span>
                              <span>Live {liveCount}/12</span>
                              <span>能量 {energyCount}/12</span>
                              <span className={getDeckPointTextClass(pointTotal)}>
                                点数 {pointTotal}/{DECK_POINT_LIMIT}pt
                              </span>
                            </div>
                            <span className="text-xs text-[var(--accent-primary)] transition-colors">
                              使用此卡组 →
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-center">
                    <button
                      onClick={handleCreateNew}
                      className="button-primary px-6 py-2.5 text-sm font-bold"
                    >
                      <Plus size={14} className="inline mr-1.5 -mt-0.5" />
                      从空白创建
                    </button>
                  </div>
                </div>
              )}

              {/* Deck Grid */}
              <div className="grid gap-3">
                {cloudDecks.map((deck, index) => {
                  const deckConfig = deckRecordToConfig(deck, {
                    resolveCardType: resolveDeckRecordCardType,
                  });
                  const stats = calculateDeckStats(deck, {
                    resolveCardType: resolveDeckRecordCardType,
                  });
                  const deckValidity = validateDeckConfig(deckConfig).valid;
                  const isDeleting = deleteConfirm === deck.id;

                  return (
                    <motion.div
                      key={deck.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className={`relative rounded-xl border p-3 sm:p-4 transition-all duration-200 ${
                        openActionsDeckId === deck.id ? 'z-20' : 'z-0'
                      } ${
                        isDeleting
                          ? 'border-[color:color-mix(in_srgb,var(--semantic-error)_45%,transparent)]'
                          : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] hover:border-[var(--border-default)]'
                      }`}
                    >
                      {isDeleting ? (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm text-[var(--semantic-error)]">
                            确定要删除 "{deck.name}" 吗？此操作不可撤销。
                          </div>
                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="button-ghost px-3 py-1.5 text-sm"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleDelete(deck.id)}
                              className="rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_14%,transparent)] px-3 py-1.5 text-sm text-[var(--semantic-error)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_20%,transparent)]"
                            >
                              确认删除
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2.5">
                          <div className="col-start-1 row-start-1 min-w-0">
                            <h3 className="mb-0.5 truncate text-[15px] font-bold text-[var(--text-primary)] sm:text-base">
                              {deck.name}
                            </h3>
                            {deck.description && (
                              <p className="line-clamp-1 text-xs text-[var(--text-secondary)] sm:line-clamp-2 sm:text-sm">
                                {deck.description}
                              </p>
                            )}
                            <div className="mt-1 text-[11px] text-[var(--text-muted)] sm:hidden">
                              {new Date(deck.updated_at).toLocaleDateString('zh-CN')}
                            </div>
                          </div>
                          <div className="col-span-2 row-start-2 flex flex-wrap items-center gap-1 min-[560px]:col-span-1 min-[560px]:col-start-2 min-[560px]:row-start-1 min-[560px]:justify-end">
                            {deck.share_enabled && (
                              <span className="chip-badge flex items-center gap-1 px-2 py-0.5 text-[11px] text-[var(--semantic-info)]">
                                <Globe size={10} /> 已分享
                              </span>
                            )}
                            {deckValidity ? (
                              <span className="chip-badge flex items-center gap-1 px-2 py-0.5 text-[11px] text-[var(--semantic-success)]">
                                <Check size={10} /> 完整
                              </span>
                            ) : (
                              <span className="chip-badge flex items-center gap-1 px-2 py-0.5 text-[11px]">
                                <Circle size={8} /> 未完成
                              </span>
                            )}
                          </div>

                          <div className="col-span-2 row-start-3 min-w-0 self-center min-[560px]:col-span-1 min-[560px]:col-start-1 min-[560px]:row-start-2">
                            <DeckStatsRow
                              stats={stats}
                              updatedAt={isMobile ? undefined : deck.updated_at}
                              size={isMobile ? 'sm' : 'md'}
                              className="min-w-0"
                            />
                          </div>
                          <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1.5 min-[560px]:row-start-2">
                            <button
                              onClick={() => handleEdit(deck)}
                              className="button-secondary flex min-h-10 shrink-0 items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold"
                            >
                              <Pencil size={12} /> 编辑
                            </button>
                            <div className="relative" data-deck-actions-root={deck.id}>
                              <button
                                type="button"
                                aria-label={`${deck.name}的更多操作`}
                                aria-haspopup="menu"
                                aria-expanded={openActionsDeckId === deck.id}
                                onClick={() =>
                                  setOpenActionsDeckId((current) =>
                                    current === deck.id ? null : deck.id
                                  )
                                }
                                className="button-ghost inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              >
                                {copyingDeckId === deck.id ? (
                                  <Loader2 size={16} className="animate-spin" />
                                ) : (
                                  <MoreHorizontal size={18} />
                                )}
                              </button>

                              {openActionsDeckId === deck.id && (
                                <div
                                  role="menu"
                                  aria-label={`${deck.name}的操作`}
                                  className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-52 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1.5 shadow-2xl"
                                >
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => handleCopyDeck(deck)}
                                    disabled={copyingDeckId === deck.id}
                                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-wait disabled:opacity-60"
                                  >
                                    <CopyPlus size={15} className="text-[var(--accent-primary)]" />
                                    复制为新版本
                                  </button>

                                  {deck.share_enabled && deck.share_id ? (
                                    <>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setOpenActionsDeckId(null);
                                          void handleCopyShareLink(deck);
                                        }}
                                        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                                      >
                                        <Copy size={15} /> 复制分享链接
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setOpenActionsDeckId(null);
                                          handleOpenShare(deck);
                                        }}
                                        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                                      >
                                        <ExternalLink size={15} /> 打开分享页
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setOpenActionsDeckId(null);
                                          void handleDisableShare(deck.id);
                                        }}
                                        disabled={sharingDeckId === deck.id}
                                        className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--semantic-warning)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-wait disabled:opacity-60"
                                      >
                                        <EyeOff size={15} /> 关闭分享
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setOpenActionsDeckId(null);
                                        void handleEnableShare(deck.id);
                                      }}
                                      disabled={sharingDeckId === deck.id}
                                      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-wait disabled:opacity-60"
                                    >
                                      <Globe size={15} /> 开启分享
                                    </button>
                                  )}

                                  <div className="my-1 border-t border-[var(--border-subtle)]" />
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setOpenActionsDeckId(null);
                                      setDeleteConfirm(deck.id);
                                    }}
                                    className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--semantic-error)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)]"
                                  >
                                    <Trash2 size={15} /> 删除卡组
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.main>
        ) : (
          <motion.main
            key="edit"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="relative z-10 flex flex-1 flex-col overflow-hidden p-4 pt-6"
          >
            <div className="workspace-shell flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="workspace-toolbar px-3 py-2 sm:px-4 sm:py-3">
                {isMobile ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="卡组名称"
                        value={deckName}
                        onChange={(e) => setDeckName(e.target.value)}
                        className="input-field min-w-0 flex-1 px-3 py-2 text-sm font-semibold"
                      />
                      <button
                        onClick={handleSave}
                        disabled={isSaving || !deckName.trim()}
                        className={`button-primary inline-flex h-10 shrink-0 items-center justify-center gap-1.5 px-3 text-sm font-semibold ${
                          isSaving || !deckName.trim() ? 'cursor-not-allowed opacity-50' : ''
                        }`}
                      >
                        <Save size={14} />
                        <span>{isSaving ? '保存中' : '保存'}</span>
                        {isDirty && !isSaving && (
                          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setMobileMetaExpanded((v) => !v)}
                        className="button-ghost inline-flex h-8 items-center gap-1 px-2 py-1 text-[11px]"
                      >
                        <Pencil size={12} />
                        {mobileMetaExpanded ? '收起备注' : '编辑备注'}
                      </button>
                      <button
                        onClick={handleExport}
                        className="button-ghost inline-flex h-8 items-center gap-1 px-2 py-1 text-[11px]"
                      >
                        <Download size={12} />
                        导出
                      </button>
                    </div>

                    {mobileMetaExpanded && (
                      <input
                        type="text"
                        placeholder="卡组备注 / 描述（可选）"
                        value={deckDescription}
                        onChange={(e) => setDeckDescription(e.target.value)}
                        className="input-field w-full px-3 py-2 text-sm"
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
                    <input
                      type="text"
                      placeholder="卡组名称"
                      value={deckName}
                      onChange={(e) => setDeckName(e.target.value)}
                      className="input-field w-full px-3 py-2 text-sm font-semibold md:min-w-[180px] md:flex-[0.8]"
                    />
                    <input
                      type="text"
                      placeholder="卡组备注 / 描述（可选）"
                      value={deckDescription}
                      onChange={(e) => setDeckDescription(e.target.value)}
                      className="input-field w-full px-3 py-2 text-sm md:min-w-[260px] md:flex-[1.6]"
                    />
                    <div className="flex items-center gap-2 md:ml-auto">
                      <button
                        onClick={handleExport}
                        className="button-secondary flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm md:flex-initial"
                      >
                        <Download size={14} />
                        导出
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={isSaving || !deckName.trim()}
                        className={`button-primary flex min-h-11 flex-1 items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold md:flex-initial ${
                          isSaving || !deckName.trim() ? 'cursor-not-allowed opacity-50' : ''
                        }`}
                      >
                        <Save size={14} />
                        {isSaving ? '保存中...' : '保存'}
                        {isDirty && !isSaving && (
                          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {saveError && (
                <div className="mx-4 mt-2 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-2.5">
                  <div className="flex items-center gap-2 text-xs text-[var(--semantic-error)]">
                    <AlertTriangle size={12} />
                    <span>{saveError}</span>
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-hidden">
                {editingDeck && (
                  <CardEditor
                    deck={editingDeck}
                    onDeckChange={setEditingDeck}
                    onValidate={validateDeck}
                  />
                )}
              </div>
            </div>
          </motion.main>
        )}
      </AnimatePresence>

      {showImportSheet &&
        createPortal(
          <div
            className="modal-backdrop z-50 flex items-end justify-center p-0"
            onClick={() => setShowImportSheet(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="deck-import-sheet-title"
              className="modal-surface safe-bottom w-full rounded-b-none rounded-t-[24px] border-b-0"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex justify-center pt-3">
                <div className="h-1.5 w-12 rounded-full bg-[var(--border-default)]" />
              </div>

              <div className="px-5 pb-3 pt-4">
                <h2
                  id="deck-import-sheet-title"
                  className="text-lg font-bold text-[var(--text-primary)]"
                >
                  导入卡组
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">选择卡组来源</p>
              </div>

              <div className="space-y-2 px-4 pb-3">
                <button
                  type="button"
                  disabled={cloudFeaturesUnavailable}
                  onClick={() => {
                    setShowImportSheet(false);
                    setDecklogSource('jp');
                    setDecklogError(null);
                    setDecklogWarnings([]);
                    setShowDecklogDialog(true);
                  }}
                  className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-4 py-3 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--accent-primary)]">
                    <Globe size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--text-primary)]">
                      从 DeckLog 导入
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
                      {cloudFeaturesUnavailable ? '离线模式下不可用' : '输入日版或国际版卡组链接'}
                    </span>
                  </span>
                </button>

                <label className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-4 py-3 text-left transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:color-mix(in_srgb,var(--semantic-info)_14%,transparent)] text-[var(--semantic-info)]">
                    <Upload size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--text-primary)]">
                      导入 YAML 文件
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
                      从本机选择 .yaml 或 .yml 文件
                    </span>
                  </span>
                  <input
                    type="file"
                    accept=".yaml,.yml"
                    className="hidden"
                    onChange={(event) => {
                      setShowImportSheet(false);
                      handleImport(event);
                    }}
                  />
                </label>
              </div>

              <div className="border-t border-[var(--border-subtle)] px-4 py-3">
                <button
                  type="button"
                  onClick={() => setShowImportSheet(false)}
                  className="button-ghost inline-flex min-h-11 w-full items-center justify-center px-4 py-2 text-sm font-semibold"
                >
                  取消
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showDecklogDialog &&
        createPortal(
          <div
            className={`modal-backdrop z-50 flex ${
              isMobile ? 'items-end justify-center p-0' : 'items-center justify-center p-4'
            }`}
            onClick={() => !decklogLoading && setShowDecklogDialog(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="decklog-dialog-title"
              className={`modal-surface modal-accent-amber flex w-full flex-col overflow-hidden ${
                isMobile
                  ? 'safe-bottom max-h-[88dvh] rounded-b-none rounded-t-[24px] border-b-0'
                  : 'max-w-lg'
              }`}
              onClick={(event) => event.stopPropagation()}
            >
              {isMobile && (
                <div className="flex justify-center pt-3">
                  <div className="h-1.5 w-12 rounded-full bg-[var(--border-default)]" />
                </div>
              )}

              <div className="flex items-start gap-3 px-5 pb-4 pt-4 sm:px-6 sm:pt-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--accent-primary)]">
                  <Globe size={21} />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h2
                    id="decklog-dialog-title"
                    className="text-lg font-bold text-[var(--text-primary)]"
                  >
                    从 DeckLog 导入
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
                    读取公开卡组，导入后可继续编辑
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="关闭 DeckLog 导入"
                  disabled={decklogLoading}
                  onClick={() => setShowDecklogDialog(false)}
                  className="button-ghost inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="touch-scroll flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
                <fieldset className="mb-5">
                  <legend className="mb-2 text-xs font-semibold tracking-wide text-[var(--text-muted)]">
                    DECKLOG 站点
                  </legend>
                  <div className="grid grid-cols-2 gap-2">
                    {(['jp', 'en'] as const).map((source) => {
                      const isSelected = decklogSource === source;
                      const meta = DECKLOG_SOURCE_META[source];
                      return (
                        <button
                          key={source}
                          type="button"
                          aria-pressed={isSelected}
                          disabled={decklogLoading}
                          onClick={() => {
                            setDecklogSource(source);
                            setDecklogError(null);
                          }}
                          className={`relative min-h-[74px] rounded-2xl border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                            isSelected
                              ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] shadow-sm'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-[var(--text-primary)]">
                              {meta.title}
                            </span>
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                                isSelected
                                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                                  : 'border-[var(--border-default)] text-transparent'
                              }`}
                            >
                              <Check size={12} strokeWidth={3} />
                            </span>
                          </span>
                          <span className="mt-1 block truncate text-[10px] text-[var(--text-muted)] sm:text-[11px]">
                            {meta.domain}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div>
                  <label
                    htmlFor="decklog-import-input"
                    className="mb-2 block text-xs font-semibold tracking-wide text-[var(--text-muted)]"
                  >
                    卡组链接或编号
                  </label>
                  <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] transition-colors focus-within:border-[color:color-mix(in_srgb,var(--accent-primary)_65%,transparent)] focus-within:ring-2 focus-within:ring-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)]">
                    <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-frosted)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                      <Link2 size={13} className="text-[var(--accent-primary)]" />
                      <span className="min-w-0 flex-1 truncate">
                        {DECKLOG_SOURCE_META[decklogSource].domain}
                      </span>
                      <span className="rounded-full bg-[var(--bg-overlay)] px-2 py-0.5">
                        自动识别链接来源
                      </span>
                    </div>
                    <input
                      id="decklog-import-input"
                      type="text"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="粘贴链接或输入卡组编号"
                      value={decklogInput}
                      onChange={(event) => {
                        const nextInput = event.target.value;
                        const inferredSource = inferDecklogSource(nextInput);
                        setDecklogInput(nextInput);
                        if (inferredSource) setDecklogSource(inferredSource);
                        setDecklogError(null);
                        setDecklogWarnings([]);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !decklogLoading) handleDecklogImport();
                      }}
                      className="min-h-12 w-full bg-transparent px-3 py-3 text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] sm:text-sm"
                      autoFocus={!isMobile}
                    />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                    例如{' '}
                    <span className="font-mono">{DECKLOG_SOURCE_META[decklogSource].example}</span>
                    ，也可以直接粘贴浏览器中的完整链接。
                  </p>
                </div>

                {decklogError && (
                  <div
                    role="alert"
                    className="mt-4 flex items-start gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)] p-3 text-xs leading-5 text-[var(--semantic-error)]"
                  >
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{decklogError}</span>
                  </div>
                )}

                {decklogWarnings.length > 0 && (
                  <div className="mt-4 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_10%,transparent)] p-3">
                    <div className="mb-1 text-xs font-semibold text-[var(--semantic-warning)]">
                      以下卡牌未匹配到本地数据
                    </div>
                    <ul className="touch-scroll max-h-32 space-y-0.5 overflow-y-auto text-xs text-[var(--text-secondary)]">
                      {decklogWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="modal-footer safe-bottom flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="hidden text-xs text-[var(--text-muted)] sm:block">
                  保存前可在编辑器中检查和调整卡组
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    onClick={() => setShowDecklogDialog(false)}
                    className="button-ghost inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm font-medium"
                    disabled={decklogLoading}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleDecklogImport}
                    disabled={decklogLoading || !decklogInput.trim()}
                    className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold transition-all ${
                      decklogLoading || !decklogInput.trim()
                        ? 'cursor-not-allowed bg-[var(--bg-hover)] text-[var(--text-muted)]'
                        : 'button-primary text-white'
                    }`}
                  >
                    {decklogLoading ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> 正在读取…
                      </>
                    ) : (
                      <>
                        <Globe size={14} /> 读取并导入
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-none fixed right-4 top-20 z-[70] max-w-[min(88vw,360px)]"
          >
            <div className="flex items-center gap-2 rounded-2xl border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[var(--bg-frosted)] px-4 py-3 text-sm text-[var(--semantic-success)] shadow-[var(--shadow-lg)] backdrop-blur-xl">
              <Check size={16} />
              <span>{toastMessage}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
