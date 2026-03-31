/**
 * DeckManager - 卡组管理页面
 * 支持创建新卡组、编辑已有卡组、删除卡组
 */

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Plus, Upload, Download, Save, Trash2,
  Pencil, Loader2, AlertTriangle, Wifi, WifiOff,
  Check, Circle, Zap, Globe, Copy, ExternalLink, EyeOff,
} from 'lucide-react';
import { useDeckStore } from '@/store/deckStore';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';
import { CardType } from '@game/shared/types/enums';
import { apiClient, isApiConfigured, type DeckRecord } from '@/lib/apiClient';
import { CardEditor } from '@/components/deck-editor';
import { calculateDeckStats, DeckStatsRow, getDeckPointTextClass, PageHeader, ThemeToggle } from '@/components/common';
import { PRESET_DECKS, type PresetDeck } from './preset-decks';
import type { DeckConfig, CardEntry } from '@game/domain/card-data/deck-loader';
import { calculateDeckConfigStats, validateDeckConfig } from '@game/domain/rules/deck-construction';
import * as yaml from 'yaml';
import { useMediaQuery } from '@/hooks/useMediaQuery';

type ViewMode = 'list' | 'edit';

interface DeckManagerProps {
  onBack: () => void;
  initialOpenDeckId?: string | null;
}

function createEmptyDeck(name: string = '新卡组'): DeckConfig {
  return {
    player_name: name,
    description: '',
    main_deck: { members: [], lives: [] },
    energy_deck: []
  };
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

  // 初始快照用于 dirty 检测
  const initialSnapshot = useRef<string>('');
  const initialOpenHandled = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const isDirty = editingDeck
    ? JSON.stringify(editingDeck) !== initialSnapshot.current ||
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

  // DeckLog 导入
  const [showDecklogDialog, setShowDecklogDialog] = useState(false);
  const [decklogInput, setDecklogInput] = useState('');
  const [decklogLoading, setDecklogLoading] = useState(false);
  const [decklogError, setDecklogError] = useState<string | null>(null);
  const [decklogWarnings, setDecklogWarnings] = useState<string[]>([]);
  const [mobileMetaExpanded, setMobileMetaExpanded] = useState(false);
  const isMobile = useMediaQuery('(max-width: 767px)');

  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);

  useEffect(() => {
    fetchCloudDecks();
  }, [fetchCloudDecks]);

  useEffect(() => {
    if (!initialOpenDeckId || initialOpenHandled.current || cloudDecks.length === 0) return;
    const targetDeck = cloudDecks.find((deck) => deck.id === initialOpenDeckId);
    if (!targetDeck) return;

    initialOpenHandled.current = true;
    handleEdit(targetDeck);
    window.history.replaceState({}, '', '/');
  }, [cloudDecks, initialOpenDeckId]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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
    const newDeck = createEmptyDeck('新卡组');
    setEditingDeck(newDeck);
    setEditingDeckId(null);
    setDeckName('新卡组');
    setDeckDescription('');
    setSaveError(null);
    initialSnapshot.current = JSON.stringify(newDeck);
    setViewMode('edit');
  };

  const handleEdit = (cloudDeck: DeckRecord) => {
    const mainDeck = cloudDeck.main_deck || [];
    const members: CardEntry[] = [];
    const lives: CardEntry[] = [];

    for (const entry of mainDeck) {
      if (entry.card_type === 'LIVE') {
        lives.push({ card_code: entry.card_code, count: entry.count });
      } else if (entry.card_type === 'MEMBER') {
        members.push({ card_code: entry.card_code, count: entry.count });
      } else {
        throw new Error(`未知的卡牌类型: ${entry.card_type}`);
      }
    }

    const localDeck: DeckConfig = {
      player_name: cloudDeck.name,
      description: cloudDeck.description || '',
      main_deck: { members, lives },
      energy_deck: cloudDeck.energy_deck || [],
    };

    setEditingDeck(localDeck);
    setEditingDeckId(cloudDeck.id);
    setDeckName(cloudDeck.name);
    setDeckDescription(cloudDeck.description || '');
    setSaveError(null);
    initialSnapshot.current = JSON.stringify(localDeck);
    setViewMode('edit');
  };

  const handleDelete = async (deckId: string) => {
    const result = await deleteCloudDeck(deckId);
    if (!result.success) {
      setSaveError(result.error || '删除失败');
    }
    setDeleteConfirm(null);
  };

  const getShareUrl = (deck: DeckRecord) => `${window.location.origin}/decks/share/${deck.share_id}`;

  const handleEnableShare = async (deckId: string) => {
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

    setIsSaving(true);
    setSaveError(null);

    try {
      const deckToSave: DeckConfig = {
        ...editingDeck,
        player_name: deckName.trim(),
        description: deckDescription.trim(),
      };

      if (editingDeckId) {
        const mainDeck = [
          ...deckToSave.main_deck.members.map((e) => ({ card_code: e.card_code, count: e.count, card_type: 'MEMBER' as const })),
          ...deckToSave.main_deck.lives.map((e) => ({ card_code: e.card_code, count: e.count, card_type: 'LIVE' as const })),
        ];
        const energyDeck = deckToSave.energy_deck.map((e) => ({ card_code: e.card_code, count: e.count }));
        const validation = validateDeck(deckToSave);

        const result = await apiClient.put<DeckRecord>(`/api/decks/${editingDeckId}`, {
          name: deckName.trim(),
          description: deckDescription.trim(),
          main_deck: mainDeck,
          energy_deck: energyDeck,
          is_valid: validation.valid,
          validation_errors: validation.errors,
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
    initialSnapshot.current = JSON.stringify(deck);
    setViewMode('edit');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const deck = yaml.parse(content) as DeckConfig;

        if (!deck.main_deck) deck.main_deck = { members: [], lives: [] };
        if (!deck.energy_deck) deck.energy_deck = [];

        setEditingDeck(deck);
        setDeckName(deck.player_name || '导入的卡组');
        setDeckDescription(deck.description || '');
        setSaveError(null);
        initialSnapshot.current = JSON.stringify(deck);
        setViewMode('edit');
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
      }>('/api/decks/scrape-decklog', { deck_id: decklogInput.trim() });

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
        description: `从 DeckLog 导入 (${decklogInput.trim()})`,
        main_deck: { members, lives },
        energy_deck: energyDeck,
      };

      setEditingDeck(deck);
      setEditingDeckId(null);
      setDeckName(deck.player_name || 'DeckLog 导入');
      setDeckDescription(deck.description || '');
      setSaveError(null);
      initialSnapshot.current = JSON.stringify(deck);
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
    <div className="app-shell flex h-screen flex-col">
      <PageHeader
        title={viewMode === 'list' ? '卡组管理' : (editingDeckId ? '编辑卡组' : '创建卡组')}
        left={(
          <button
            onClick={viewMode === 'edit' ? handleCancelEdit : onBack}
            className="button-ghost inline-flex h-10 items-center justify-center gap-1.5 px-2.5 py-2 text-sm sm:px-3"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">{viewMode === 'edit' ? '取消' : '返回'}</span>
          </button>
        )}
        right={(
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
              <span className="truncate font-medium text-[var(--text-primary)] max-[420px]:max-w-[92px] sm:max-w-none">{displayUsername}</span>
            </div>
          </>
        )}
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
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="text-sm text-[var(--text-secondary)]">
                  共 {cloudDecks.length} 个卡组
                </div>
                <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3">
                  <button
                    onClick={() => { setShowDecklogDialog(true); setDecklogError(null); setDecklogWarnings([]); }}
                    className="button-secondary inline-flex min-h-11 items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium"
                  >
                    <Globe size={14} />
                    从 DeckLog 导入
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
              </div>

              {isLoadingCloud && cloudDecks.length === 0 && (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <Loader2 size={32} className="mx-auto mb-3 animate-spin text-[var(--accent-primary)]" />
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
                    <div className="text-sm text-[var(--text-muted)]">从推荐卡组开始，或自由创建</div>
                  </div>

                  <div className="mb-3 text-xs font-semibold tracking-wider text-[var(--text-muted)]">推荐卡组</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-8">
                    {PRESET_DECKS.map((preset) => {
                      const { memberCount, liveCount, energyCount, pointTotal } = calculateDeckConfigStats(preset.deck);
                      return (
                        <div
                          key={preset.id}
                          onClick={() => handleUsePreset(preset)}
                          className="group cursor-pointer rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] p-4 transition-all duration-200 hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h3 className="mb-0.5 text-base font-bold text-[var(--text-primary)]">{preset.name}</h3>
                              <p className="text-xs text-[var(--text-secondary)]">{preset.description}</p>
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
                              <span className={getDeckPointTextClass(pointTotal)}>点数 {pointTotal}/12pt</span>
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
                  const stats = calculateDeckStats(deck);
                  const deckConfig = {
                    player_name: deck.name,
                    description: deck.description || '',
                    main_deck: {
                      members: deck.main_deck
                        .filter((entry) => entry.card_type === 'MEMBER')
                        .map((entry) => ({ card_code: entry.card_code, count: entry.count })),
                      lives: deck.main_deck
                        .filter((entry) => entry.card_type === 'LIVE')
                        .map((entry) => ({ card_code: entry.card_code, count: entry.count })),
                    },
                    energy_deck: deck.energy_deck || [],
                  };
                  const deckValidity = validateDeckConfig(deckConfig).valid;
                  const isDeleting = deleteConfirm === deck.id;

                  return (
                    <motion.div
                      key={deck.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className={`rounded-xl border p-3 sm:p-4 transition-all duration-200 ${
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
                        <>
                          <div className="mb-2.5 flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h3 className="mb-0.5 truncate text-[15px] font-bold text-[var(--text-primary)] sm:text-base">{deck.name}</h3>
                              {deck.description && (
                                <p className="line-clamp-1 text-xs text-[var(--text-secondary)] sm:line-clamp-2 sm:text-sm">{deck.description}</p>
                              )}
                              <div className="mt-1 text-[11px] text-[var(--text-muted)] sm:hidden">
                                {new Date(deck.updated_at).toLocaleDateString('zh-CN')}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
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
                          </div>

                          <div className="flex flex-col gap-2.5 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between">
                            <DeckStatsRow stats={stats} updatedAt={isMobile ? undefined : deck.updated_at} size={isMobile ? 'sm' : 'md'} className="min-w-0" />
                            <div className={`${isMobile ? 'flex items-center gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none]' : 'flex flex-wrap items-center gap-2 min-[560px]:gap-1.5'}`}>
                              {deck.share_enabled && deck.share_id ? (
                                <>
                                  <button
                                    onClick={() => handleCopyShareLink(deck)}
                                    className="shrink-0 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-success)_22%,transparent)] px-2.5 py-1.5 text-xs text-[var(--semantic-success)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] min-[560px]:px-3 min-[560px]:py-1.5"
                                  >
                                    <span className="inline-flex items-center justify-center gap-1">
                                      <Copy size={12} />
                                      <span className="sm:hidden">复制</span>
                                      <span className="hidden sm:inline">复制链接</span>
                                    </span>
                                  </button>
                                  <button
                                    onClick={() => handleOpenShare(deck)}
                                    className="shrink-0 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-info)_22%,transparent)] px-2.5 py-1.5 text-xs text-[var(--semantic-info)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,transparent)] min-[560px]:px-3 min-[560px]:py-1.5"
                                  >
                                    <span className="inline-flex items-center justify-center gap-1">
                                      <ExternalLink size={12} />
                                      <span className="sm:hidden">打开</span>
                                      <span className="hidden sm:inline">打开分享页</span>
                                    </span>
                                  </button>
                                  <button
                                    onClick={() => handleDisableShare(deck.id)}
                                    disabled={sharingDeckId === deck.id}
                                    className="shrink-0 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_22%,transparent)] px-2.5 py-1.5 text-xs text-[var(--semantic-warning)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,transparent)] disabled:cursor-wait disabled:opacity-60 min-[560px]:px-3 min-[560px]:py-1.5"
                                  >
                                    <span className="inline-flex items-center justify-center gap-1">
                                      {sharingDeckId === deck.id ? <Loader2 size={12} className="animate-spin" /> : <EyeOff size={12} />}
                                      <span className="sm:hidden">关闭</span>
                                      <span className="hidden sm:inline">关闭分享</span>
                                    </span>
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => handleEnableShare(deck.id)}
                                  disabled={sharingDeckId === deck.id}
                                  className="shrink-0 rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_22%,transparent)] px-2.5 py-1.5 text-xs text-[var(--accent-primary)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] disabled:cursor-wait disabled:opacity-60 min-[560px]:px-3 min-[560px]:py-1.5"
                                >
                                  <span className="inline-flex items-center justify-center gap-1">
                                    {sharingDeckId === deck.id ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
                                    分享
                                  </span>
                                </button>
                              )}
                              <button
                                onClick={() => handleEdit(deck)}
                                className="button-secondary flex shrink-0 items-center justify-center gap-1 px-2.5 py-1.5 text-xs min-[560px]:px-3 min-[560px]:py-1.5"
                              >
                                <Pencil size={12} /> 编辑
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(deck.id)}
                                className="shrink-0 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_18%,transparent)] px-2.5 py-1.5 text-xs text-[var(--semantic-error)]/70 transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] hover:text-[var(--semantic-error)] min-[560px]:border-0 min-[560px]:p-1.5"
                                title="删除卡组"
                              >
                                <span className="inline-flex items-center justify-center gap-1">
                                  <Trash2 size={14} />
                                  <span className={isMobile ? 'inline' : 'min-[560px]:hidden'}>删除</span>
                                </span>
                              </button>
                            </div>
                          </div>
                        </>
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
                        isSaving || !deckName.trim()
                          ? 'cursor-not-allowed opacity-50'
                          : ''
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
                        isSaving || !deckName.trim()
                          ? 'cursor-not-allowed opacity-50'
                          : ''
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

      {showDecklogDialog && (
        <div className="modal-backdrop z-50 flex items-center justify-center">
          <div className="modal-surface modal-accent-amber mx-4 w-full max-w-md p-6">
            <h2 className="mb-1 text-lg font-bold text-[var(--text-primary)]">从 DeckLog 导入</h2>
            <p className="mb-4 text-sm text-[var(--text-secondary)]">输入 DeckLog 卡组 ID 或完整 URL</p>

            <input
              type="text"
              placeholder="例如: 2D6XL 或 https://decklog.bushiroad.com/view/2D6XL"
              value={decklogInput}
              onChange={(e) => { setDecklogInput(e.target.value); setDecklogError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !decklogLoading) handleDecklogImport(); }}
              className="input-field mb-3 px-4 py-2.5 text-sm"
              autoFocus
            />

            {decklogError && (
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-2 text-xs text-[var(--semantic-error)]">
                <AlertTriangle size={12} />
                <span>{decklogError}</span>
              </div>
            )}

            {decklogWarnings.length > 0 && (
              <div className="mb-3 p-2 bg-amber-500/10 border border-amber-400/20 rounded-lg">
                <div className="text-xs text-amber-300 mb-1">以下卡牌未匹配到本地数据：</div>
                <ul className="text-xs text-amber-300/70 space-y-0.5 max-h-24 overflow-y-auto">
                  {decklogWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 mt-2">
              <button
                onClick={() => setShowDecklogDialog(false)}
                className="px-4 py-2 text-orange-300/60 hover:text-orange-300 rounded-lg text-sm transition-colors"
                disabled={decklogLoading}
              >
                取消
              </button>
              <button
                onClick={handleDecklogImport}
                disabled={decklogLoading || !decklogInput.trim()}
                className={`px-5 py-2 rounded-lg font-semibold text-sm transition-all flex items-center gap-1.5 ${
                  decklogLoading || !decklogInput.trim()
                    ? 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-orange-400 to-amber-400 text-white hover:shadow-lg hover:shadow-orange-500/20'
                }`}
              >
                {decklogLoading ? (
                  <><Loader2 size={14} className="animate-spin" /> 爬取中...</>
                ) : (
                  <><Globe size={14} /> 导入</>
                )}
              </button>
            </div>
          </div>
        </div>
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
