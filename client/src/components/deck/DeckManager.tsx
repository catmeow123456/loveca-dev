/**
 * DeckManager - 卡组管理页面
 * 支持创建新卡组、编辑已有卡组、删除卡组
 */

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Plus, Upload, Download, Save, Trash2,
  Pencil, Loader2, AlertTriangle, Wifi, WifiOff, Package,
  Check, Circle, Zap, Globe,
} from 'lucide-react';
import { useDeckStore } from '@/store/deckStore';
import { useAuthStore } from '@/store/authStore';
import { useGameStore } from '@/store/gameStore';
import { CardType } from '@game/shared/types/enums';
import { apiClient, isApiConfigured, type DeckRecord } from '@/lib/apiClient';
import { CardEditor } from '@/components/deck-editor';
import { calculateDeckStats, DeckStatsRow, ThemeToggle } from '@/components/common';
import { PRESET_DECKS, type PresetDeck } from './preset-decks';
import type { DeckConfig, CardEntry } from '@game/domain/card-data/deck-loader';
import * as yaml from 'yaml';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getCardImageUrl, isStorageEnabled } from '@/lib/imageService';

/**
 * 将 cardCode 转换为图片文件名（用于 MinIO Storage）
 */
function cardCodeToFilename(cardCode: string): string {
  let filename = cardCode.replace(/!/g, '');
  filename = filename.replace(/-[A-Za-z]+\+?$/, '');
  return filename;
}

type ViewMode = 'list' | 'edit';

interface DeckManagerProps {
  onBack: () => void;
}

function createEmptyDeck(name: string = '新卡组'): DeckConfig {
  return {
    player_name: name,
    description: '',
    main_deck: { members: [], lives: [] },
    energy_deck: []
  };
}

export function DeckManager({ onBack }: DeckManagerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingDeck, setEditingDeck] = useState<DeckConfig | null>(null);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [deckName, setDeckName] = useState('');
  const [deckDescription, setDeckDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // 初始快照用于 dirty 检测
  const initialSnapshot = useRef<string>('');
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
  const isAdmin = profile?.role === 'admin';

  const [downloadingDeckId, setDownloadingDeckId] = useState<string | null>(null);

  // DeckLog 导入
  const [showDecklogDialog, setShowDecklogDialog] = useState(false);
  const [decklogInput, setDecklogInput] = useState('');
  const [decklogLoading, setDecklogLoading] = useState(false);
  const [decklogError, setDecklogError] = useState<string | null>(null);
  const [decklogWarnings, setDecklogWarnings] = useState<string[]>([]);

  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);

  useEffect(() => {
    fetchCloudDecks();
  }, [fetchCloudDecks]);

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
        await deleteCloudDeck(editingDeckId);
      }

      useDeckStore.setState({ player1Deck: deckToSave });
      const result = await saveToCloud('player1', deckName.trim(), deckDescription.trim());

      if (!result.success) {
        setSaveError(result.error || '保存失败');
      } else {
        await fetchCloudDecks();
        setViewMode('list');
        setEditingDeck(null);
        setEditingDeckId(null);
      }
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

  const handleDownloadImages = async (deck: DeckRecord) => {
    setDownloadingDeckId(deck.id);

    try {
      const zip = new JSZip();
      const imageFolder = zip.folder('images');
      if (!imageFolder) throw new Error('创建文件夹失败');

      const cardList: { code: string; type: 'card' | 'energy'; index: number }[] = [];

      for (const entry of deck.main_deck) {
        for (let i = 0; i < entry.count; i++) {
          cardList.push({ code: entry.card_code, type: 'card', index: i + 1 });
        }
      }

      for (const entry of deck.energy_deck) {
        for (let i = 0; i < entry.count; i++) {
          cardList.push({ code: entry.card_code, type: 'energy', index: i + 1 });
        }
      }

      console.log(`准备下载 ${cardList.length} 张卡牌图片 (使用 ${isStorageEnabled ? '远程存储' : '本地文件'})...`);

      let successCount = 0;
      let failCount = 0;

      for (const card of cardList) {
        const filename = cardCodeToFilename(card.code);
        const url = getCardImageUrl(filename, 'large');
        const ext = isStorageEnabled ? 'webp' : (card.type === 'energy' ? 'png' : 'jpg');

        try {
          const response = await fetch(url);
          if (!response.ok) {
            console.warn(`下载失败: ${url}`);
            failCount++;
            continue;
          }

          const blob = await response.blob();
          const zipFileName = `${card.code}_${card.index}.${ext}`;
          imageFolder.file(zipFileName, blob);
          successCount++;
        } catch (err) {
          console.warn(`下载失败: ${url}`, err);
          failCount++;
        }
      }

      console.log(`下载完成: 成功 ${successCount}, 失败 ${failCount}`);

      if (successCount === 0) {
        throw new Error('没有成功下载任何图片');
      }

      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `${deck.name}-images.zip`);
    } catch (err) {
      console.error('下载图片失败:', err);
      setSaveError(err instanceof Error ? err.message : '下载失败');
    } finally {
      setDownloadingDeckId(null);
    }
  };

  return (
    <div className="app-shell flex h-screen flex-col">
      <header className="relative z-10 mx-4 mt-4 flex h-14 flex-shrink-0 items-center justify-between rounded-[24px] border border-[var(--border-default)] bg-[var(--bg-frosted)] px-5 shadow-[var(--shadow-md)] backdrop-blur-xl">
        <button
          onClick={viewMode === 'edit' ? handleCancelEdit : onBack}
          className="button-ghost inline-flex items-center gap-1.5 px-3 py-2 text-sm"
        >
          <ArrowLeft size={16} />
          <span>{viewMode === 'edit' ? '取消' : '返回'}</span>
        </button>

        <h1 className="text-base font-bold text-[var(--text-primary)]">
          {viewMode === 'list' ? '卡组管理' : (editingDeckId ? '编辑卡组' : '创建卡组')}
        </h1>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="status-pill px-2.5 py-1 text-xs">
          {offlineMode ? (
            <WifiOff size={12} className="text-[var(--semantic-warning)]" />
          ) : isApiConfigured ? (
            <Wifi size={12} className="text-[var(--semantic-success)]" />
          ) : (
            <Zap size={12} className="text-[var(--text-secondary)]" />
          )}
          <span className="font-medium text-[var(--text-primary)]">{displayUsername}</span>
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {viewMode === 'list' ? (
          <motion.main
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="relative z-10 flex-1 overflow-y-auto p-6"
          >
            <div className="workspace-shell mx-auto max-w-5xl p-6">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div className="text-sm text-[var(--text-secondary)]">
                  共 {cloudDecks.length} 个卡组
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => { setShowDecklogDialog(true); setDecklogError(null); setDecklogWarnings([]); }}
                    className="button-secondary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium"
                  >
                    <Globe size={14} />
                    从 DeckLog 导入
                  </button>
                  <label className="button-secondary inline-flex cursor-pointer items-center gap-1.5 px-4 py-2 text-sm font-medium">
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
                    className="button-primary inline-flex items-center gap-1.5 px-5 py-2 text-sm font-bold"
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
                      const memberCount = preset.deck.main_deck.members.reduce((s, e) => s + e.count, 0);
                      const liveCount = preset.deck.main_deck.lives.reduce((s, e) => s + e.count, 0);
                      const energyCount = preset.deck.energy_deck.reduce((s, e) => s + e.count, 0);
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
                  const isDeleting = deleteConfirm === deck.id;

                  return (
                    <motion.div
                      key={deck.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.04 }}
                      className={`rounded-xl border p-4 transition-all duration-200 ${
                        isDeleting
                          ? 'border-[color:color-mix(in_srgb,var(--semantic-error)_45%,transparent)]'
                          : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] hover:border-[var(--border-default)]'
                      }`}
                    >
                      {isDeleting ? (
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-[var(--semantic-error)]">
                            确定要删除 "{deck.name}" 吗？此操作不可撤销。
                          </div>
                          <div className="flex items-center gap-2">
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
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h3 className="mb-0.5 text-base font-bold text-[var(--text-primary)]">{deck.name}</h3>
                              {deck.description && (
                                <p className="line-clamp-1 text-sm text-[var(--text-secondary)]">{deck.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {deck.is_valid ? (
                                <span className="chip-badge text-[var(--semantic-success)] px-2 py-0.5 text-xs flex items-center gap-1">
                                  <Check size={10} /> 完整
                                </span>
                              ) : (
                                <span className="chip-badge px-2 py-0.5 text-xs flex items-center gap-1">
                                  <Circle size={8} /> 未完成
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <DeckStatsRow stats={stats} updatedAt={deck.updated_at} size="md" />
                            <div className="flex items-center gap-1.5">
                              {isAdmin && (
                                <button
                                  onClick={() => handleDownloadImages(deck)}
                                  disabled={downloadingDeckId === deck.id}
                                  className={`rounded-lg border px-3 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                                    downloadingDeckId === deck.id
                                      ? 'cursor-wait text-[var(--semantic-info)]/50 border-[color:color-mix(in_srgb,var(--semantic-info)_20%,transparent)]'
                                      : 'text-[var(--semantic-info)] hover:bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,transparent)] border-[color:color-mix(in_srgb,var(--semantic-info)_30%,transparent)]'
                                  }`}
                                  title="下载卡组图片"
                                >
                                  {downloadingDeckId === deck.id
                                    ? <><Loader2 size={12} className="animate-spin" /> 下载中</>
                                    : <><Package size={12} /> 下载图片</>
                                  }
                                </button>
                              )}
                              <button
                                onClick={() => handleEdit(deck)}
                                className="button-secondary px-3 py-1.5 text-xs flex items-center gap-1"
                              >
                                <Pencil size={12} /> 编辑
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(deck.id)}
                                className="rounded-lg p-1.5 text-[var(--semantic-error)]/60 transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] hover:text-[var(--semantic-error)]"
                                title="删除卡组"
                              >
                                <Trash2 size={14} />
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
            <div className="workspace-toolbar px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="卡组名称"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  className="input-field min-w-[180px] flex-[0.8] px-3 py-2 text-sm font-semibold"
                />
                <input
                  type="text"
                  placeholder="卡组备注 / 描述（可选）"
                  value={deckDescription}
                  onChange={(e) => setDeckDescription(e.target.value)}
                  className="input-field min-w-[260px] flex-[1.6] px-3 py-2 text-sm"
                />
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={handleExport}
                    className="button-secondary flex items-center gap-1.5 px-3 py-2 text-sm"
                  >
                    <Download size={14} />
                    导出
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !deckName.trim()}
                    className={`button-primary flex items-center gap-1.5 px-4 py-2 text-sm font-semibold ${
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
    </div>
  );
}
