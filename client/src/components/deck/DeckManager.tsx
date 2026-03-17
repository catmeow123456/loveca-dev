/**
 * DeckManager - 卡组管理页面
 * 支持创建新卡组、编辑已有卡组、删除卡组
 */

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Plus, Upload, Download, Save, Trash2,
  Pencil, Loader2, AlertTriangle, Wifi, WifiOff, Package,
  Check, Circle, Zap,
} from 'lucide-react';
import { useDeckStore } from '@/store/deckStore';
import { useAuthStore } from '@/store/authStore';
import { CardEditor } from '@/components/deck-editor';
import { calculateDeckStats, DeckStatsRow } from '@/components/common';
import { isApiConfigured, type DeckRecord } from '@/lib/apiClient';
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
    <div className="h-screen bg-gradient-to-br from-[#2d2820] via-[#1f1a15] to-[#2d2820] flex flex-col">
      {/* Header */}
      <header className="h-14 bg-[#3d3020]/80 backdrop-blur-sm border-b border-orange-300/15 flex items-center justify-between px-5 flex-shrink-0">
        <button
          onClick={viewMode === 'edit' ? handleCancelEdit : onBack}
          className="flex items-center gap-1.5 text-orange-300/70 hover:text-orange-300 transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          <span>{viewMode === 'edit' ? '取消' : '返回'}</span>
        </button>

        <h1 className="text-base font-bold text-orange-200">
          {viewMode === 'list' ? '卡组管理' : (editingDeckId ? '编辑卡组' : '创建卡组')}
        </h1>

        {/* User Info */}
        <div className="flex items-center gap-2 px-2.5 py-1 bg-[#2d2820]/80 rounded-full border border-orange-300/15 text-xs">
          {offlineMode ? (
            <WifiOff size={12} className="text-amber-400" />
          ) : isApiConfigured ? (
            <Wifi size={12} className="text-green-400" />
          ) : (
            <Zap size={12} className="text-gray-400" />
          )}
          <span className="text-orange-200 font-medium">{displayUsername}</span>
        </div>
      </header>

      {/* Main Content */}
      <AnimatePresence mode="wait">
        {viewMode === 'list' ? (
          /* 卡组列表视图 */
          <motion.main
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex-1 p-6 overflow-y-auto"
          >
            <div className="max-w-4xl mx-auto">
              {/* Action Bar */}
              <div className="flex items-center justify-between mb-6">
                <div className="text-orange-300/50 text-sm">
                  共 {cloudDecks.length} 个卡组
                </div>
                <div className="flex items-center gap-3">
                  <label className="px-4 py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 rounded-full text-sm font-medium transition-all duration-200 cursor-pointer border border-orange-300/30 hover:border-orange-300/50 flex items-center gap-1.5">
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
                    className="px-5 py-2 bg-gradient-to-r from-orange-400 to-amber-400 text-white rounded-full font-bold text-sm transition-all duration-200 hover:shadow-lg hover:shadow-orange-500/30 flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    创建新卡组
                  </button>
                </div>
              </div>

              {/* Loading State */}
              {isLoadingCloud && cloudDecks.length === 0 && (
                <div className="flex items-center justify-center py-20">
                  <div className="text-center">
                    <Loader2 size={32} className="animate-spin text-orange-300/40 mx-auto mb-3" />
                    <div className="text-orange-300/50 text-sm">加载卡组中...</div>
                  </div>
                </div>
              )}

              {/* Error State */}
              {cloudError && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-400/30 rounded-xl">
                  <div className="flex items-center gap-2 text-red-300 text-sm">
                    <AlertTriangle size={14} />
                    <span>{cloudError}</span>
                    <button
                      onClick={fetchCloudDecks}
                      className="ml-auto text-red-300 hover:text-red-200 text-sm"
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
                    <div className="text-orange-300/50 text-base mb-1">还没有卡组</div>
                    <div className="text-orange-300/30 text-sm">从推荐卡组开始，或自由创建</div>
                  </div>

                  <div className="mb-3 text-orange-300/40 text-xs font-semibold tracking-wider">推荐卡组</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-8">
                    {PRESET_DECKS.map((preset) => {
                      const memberCount = preset.deck.main_deck.members.reduce((s, e) => s + e.count, 0);
                      const liveCount = preset.deck.main_deck.lives.reduce((s, e) => s + e.count, 0);
                      const energyCount = preset.deck.energy_deck.reduce((s, e) => s + e.count, 0);
                      return (
                        <div
                          key={preset.id}
                          onClick={() => handleUsePreset(preset)}
                          className="p-4 bg-[#3d3020]/50 rounded-xl border border-orange-300/15 hover:border-orange-300/35 hover:bg-[#3d3020]/70 transition-all duration-200 cursor-pointer group"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h3 className="text-base font-bold text-orange-100 mb-0.5">{preset.name}</h3>
                              <p className="text-xs text-orange-300/50">{preset.description}</p>
                            </div>
                            <span className="ml-3 flex-shrink-0 text-xs px-2 py-0.5 bg-orange-500/15 text-orange-300 rounded-full border border-orange-400/20">
                              {preset.tag}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs text-orange-300/40">
                              <span>成员 {memberCount}/48</span>
                              <span>Live {liveCount}/12</span>
                              <span>能量 {energyCount}/12</span>
                            </div>
                            <span className="text-xs text-orange-400/50 group-hover:text-orange-300 transition-colors">
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
                      className="px-6 py-2.5 bg-gradient-to-r from-orange-400 to-amber-400 text-white rounded-full font-bold text-sm transition-all duration-200 hover:shadow-lg hover:shadow-orange-500/30"
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
                      className={`p-4 bg-[#3d3020]/50 rounded-xl border transition-all duration-200 ${
                        isDeleting
                          ? 'border-red-400/50'
                          : 'border-orange-300/15 hover:border-orange-300/30'
                      }`}
                    >
                      {isDeleting ? (
                        <div className="flex items-center justify-between">
                          <div className="text-red-300 text-sm">
                            确定要删除 "{deck.name}" 吗？此操作不可撤销。
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="px-3 py-1.5 text-orange-300 hover:bg-orange-500/10 rounded-lg transition-colors text-sm"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleDelete(deck.id)}
                              className="px-3 py-1.5 bg-red-500/20 text-red-300 hover:bg-red-500/30 rounded-lg border border-red-400/30 transition-colors text-sm"
                            >
                              确认删除
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h3 className="text-base font-bold text-orange-100 mb-0.5">{deck.name}</h3>
                              {deck.description && (
                                <p className="text-sm text-orange-300/40 line-clamp-1">{deck.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {deck.is_valid ? (
                                <span className="text-xs px-2 py-0.5 bg-green-500/15 text-green-300 rounded-full border border-green-400/20 flex items-center gap-1">
                                  <Check size={10} /> 完整
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 bg-orange-500/15 text-orange-300 rounded-full border border-orange-400/20 flex items-center gap-1">
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
                                  className={`px-3 py-1.5 rounded-lg transition-colors border text-xs flex items-center gap-1 ${
                                    downloadingDeckId === deck.id
                                      ? 'text-blue-300/50 border-blue-300/15 cursor-wait'
                                      : 'text-blue-300 hover:bg-blue-500/10 border-blue-300/20 hover:border-blue-300/40'
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
                                className="px-3 py-1.5 text-orange-300 hover:bg-orange-500/10 rounded-lg transition-colors border border-orange-300/20 hover:border-orange-300/40 text-xs flex items-center gap-1"
                              >
                                <Pencil size={12} /> 编辑
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(deck.id)}
                                className="p-1.5 text-red-300/50 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
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
          /* 卡组编辑视图 */
          <motion.main
            key="edit"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            {/* Edit Header - 单行：名称 + 描述 + 操作按钮 */}
            <div className="px-4 py-2.5 bg-[#3d3020]/50 border-b border-orange-300/15">
              <div className="flex items-center gap-3">
                {/* 卡组名称 */}
                <input
                  type="text"
                  placeholder="卡组名称"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  className="w-40 flex-shrink-0 px-3 py-1.5 bg-[#2d2820]/80 border border-orange-300/20 rounded-lg text-orange-100 text-sm font-semibold placeholder-orange-300/40 focus:outline-none focus:border-orange-400/50 transition-all"
                />
                {/* 卡组描述 */}
                <input
                  type="text"
                  placeholder="卡组描述（可选）"
                  value={deckDescription}
                  onChange={(e) => setDeckDescription(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-[#2d2820]/60 border border-orange-300/15 rounded-lg text-orange-200/80 text-sm placeholder-orange-300/30 focus:outline-none focus:border-orange-400/40 transition-all"
                />
                {/* 操作按钮 */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleExport}
                    className="px-3 py-1.5 text-orange-300/60 hover:text-orange-300 hover:bg-orange-500/10 rounded-lg transition-colors border border-orange-300/15 hover:border-orange-300/30 text-sm flex items-center gap-1.5"
                  >
                    <Download size={14} />
                    导出
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !deckName.trim()}
                    className={`px-4 py-1.5 rounded-lg font-semibold text-sm transition-all duration-200 flex items-center gap-1.5 ${
                      isSaving || !deckName.trim()
                        ? 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-green-400 to-emerald-400 text-white hover:shadow-lg hover:shadow-green-500/20'
                    }`}
                  >
                    <Save size={14} />
                    {isSaving ? '保存中...' : '保存'}
                    {isDirty && !isSaving && (
                      <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Save Error */}
            {saveError && (
              <div className="mx-4 mt-2 p-2.5 bg-red-500/10 border border-red-400/20 rounded-lg">
                <div className="flex items-center gap-2 text-red-300 text-xs">
                  <AlertTriangle size={12} />
                  <span>{saveError}</span>
                </div>
              </div>
            )}

            {/* Card Editor */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {editingDeck && (
                <CardEditor
                  deck={editingDeck}
                  onDeckChange={setEditingDeck}
                  onValidate={validateDeck}
                />
              )}
            </div>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}
