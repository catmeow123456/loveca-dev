/**
 * CardAdminPage - 卡牌数据管理页面
 * 仅管理员可访问，提供卡牌数据的 CRUD 操作
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft, Plus, Download, Search, RefreshCw, Loader2,
  AlertTriangle, Lock, Pencil, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cardService, type CardUpdateInput, type CardCreateInput } from '@/lib/cardService';
import { resolveCardImagePath, preloadCardImages, getRecommendedImageSize } from '@/lib/imageService';
import { Card } from '@/components/card/Card';
import type { AnyCardData } from '@game/domain/entities/card';
import { CardType } from '@game/shared/types/enums';
import { CardEditModal } from './CardEditModal';

interface CardAdminPageProps {
  onBack: () => void;
}

export function CardAdminPage({ onBack }: CardAdminPageProps) {
  const { offlineMode } = useAuthStore(
    useShallow((s) => ({ offlineMode: s.offlineMode }))
  );

  const [cards, setCards] = useState<AnyCardData[]>([]);
  const [cardStatusMap, setCardStatusMap] = useState<Map<string, 'DRAFT' | 'PUBLISHED'>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<CardType | 'ALL'>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'DRAFT' | 'PUBLISHED'>('ALL');
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(28);
  const [batchWorking, setBatchWorking] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedType, selectedStatus]);

  const loadCards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await cardService.getAllCards(true, 'all');
      const statusMap = await cardService.getCardStatusMap();
      setCards(data);
      setCardStatusMap(statusMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const filteredCards = useMemo(() => {
    let result = cards;
    if (selectedType !== 'ALL') result = result.filter(c => c.cardType === selectedType);
    if (selectedStatus !== 'ALL') result = result.filter(c => cardStatusMap.get(c.cardCode) === selectedStatus);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(q) || c.cardCode.toLowerCase().includes(q));
    }
    return result.sort((a, b) => a.cardCode.localeCompare(b.cardCode));
  }, [cards, selectedType, selectedStatus, searchQuery, cardStatusMap]);

  const totalPages = Math.ceil(filteredCards.length / pageSize);
  const paginatedCards = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCards.slice(start, start + pageSize);
  }, [filteredCards, currentPage, pageSize]);

  useEffect(() => {
    if (paginatedCards.length > 0 && !loading) {
      const imageBaseNames = paginatedCards.map(card =>
        card.imageFilename
          ? card.imageFilename.replace(/^.*\//, '').replace(/\.(jpg|jpeg|png|webp)$/i, '')
          : card.cardCode
      );
      preloadCardImages(imageBaseNames, getRecommendedImageSize('sm'));
    }
  }, [paginatedCards, loading]);

  const goToPage = (page: number) => setCurrentPage(Math.max(1, Math.min(page, totalPages)));

  const handleSave = async (cardCode: string, updates: CardUpdateInput) => {
    await cardService.updateCard(cardCode, updates);
    await loadCards();
  };

  const handleCreate = async (input: CardCreateInput) => {
    await cardService.createCard(input);
    await loadCards();
  };

  const handleDelete = async (cardCode: string) => {
    await cardService.deleteCard(cardCode);
    await loadCards();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await cardService.exportCards();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cards_export_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  };

  const handleBatchStatus = async (targetStatus: 'PUBLISHED' | 'DRAFT') => {
    const targets = filteredCards.filter(c => cardStatusMap.get(c.cardCode) !== targetStatus);
    if (targets.length === 0) return;
    const action = targetStatus === 'PUBLISHED' ? '上线' : '转为草稿';
    if (!confirm(`确定要将筛选结果中的 ${targets.length} 张卡牌全部${action}吗？`)) return;

    setBatchWorking(true);
    setError(null);
    try {
      const fn = targetStatus === 'PUBLISHED'
        ? (code: string) => cardService.publishCard(code)
        : (code: string) => cardService.unpublishCard(code);
      await Promise.all(targets.map(c => fn(c.cardCode)));
      await loadCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : `批量${action}失败`);
    } finally {
      setBatchWorking(false);
    }
  };

  if (offlineMode) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <Lock size={40} className="mx-auto mb-4 text-orange-300/40" />
          <h2 className="text-xl text-orange-300 mb-2">离线模式</h2>
          <p className="text-orange-300/60 mb-4">卡牌管理功能需要登录后使用</p>
          <button onClick={onBack} className="px-4 py-2 bg-orange-500 text-white rounded-xl">返回</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-[#2d2820] to-[#1f1a15]">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#3d3020]/95 backdrop-blur-sm border-b border-orange-300/20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 text-orange-300/70 hover:text-orange-300 hover:bg-orange-500/10 rounded-lg transition-all">
                <ArrowLeft size={18} />
              </button>
              <h1 className="text-lg font-bold text-orange-200">卡牌数据管理</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExport}
                disabled={exporting}
                className="px-3 py-2 bg-[#2d2820]/80 text-orange-300 border border-orange-300/20 rounded-lg hover:border-orange-300/40 transition-all disabled:opacity-50 text-sm flex items-center gap-1.5"
              >
                <Download size={14} />
                {exporting ? '导出中...' : '导出 JSON'}
              </button>
              <button
                onClick={() => { setIsCreating(true); setSelectedCard(null); }}
                className="px-3 py-2 bg-gradient-to-r from-orange-400 to-amber-400 text-white rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-orange-500/30 text-sm flex items-center gap-1.5"
              >
                <Plus size={14} /> 新建卡牌
              </button>
            </div>
          </div>

          {/* 搜索和筛选 */}
          <div className="flex items-center gap-3 mt-3">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-orange-300/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索卡牌名称或编号..."
                className="w-full pl-9 pr-4 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-lg text-orange-100 text-sm placeholder-orange-300/40 focus:outline-none focus:border-orange-400/50"
              />
            </div>
            <div className="flex gap-1.5">
              {([
                { value: 'ALL' as const, label: '全部' },
                { value: CardType.MEMBER, label: '成员卡' },
                { value: CardType.LIVE, label: 'Live 卡' },
                { value: CardType.ENERGY, label: '能量卡' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedType(opt.value as CardType | 'ALL')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs transition-all border ${
                    selectedType === opt.value
                      ? 'bg-orange-500/25 text-orange-200 border-orange-400/50'
                      : 'bg-[#2d2820]/70 text-orange-300/50 border-orange-300/15 hover:text-orange-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="w-px h-6 bg-orange-300/15" />
            <div className="flex gap-1.5">
              {([
                { value: 'ALL' as const, label: '全部状态', active: 'bg-orange-500/25 text-orange-200 border-orange-400/50' },
                { value: 'DRAFT' as const, label: '草稿', active: 'bg-yellow-500/25 text-yellow-200 border-yellow-400/50' },
                { value: 'PUBLISHED' as const, label: '已上线', active: 'bg-green-500/25 text-green-200 border-green-400/50' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectedStatus(opt.value)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs transition-all border ${
                    selectedStatus === opt.value
                      ? opt.active
                      : 'bg-[#2d2820]/70 text-orange-300/50 border-orange-300/15 hover:text-orange-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button onClick={loadCards} disabled={loading} className="p-2 text-orange-300/50 hover:text-orange-300 transition-all">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex items-center gap-3 mt-2 text-xs text-orange-300/40">
            <span>共 {cards.length} 张</span>
            <span>·</span>
            <span>筛选: {filteredCards.length} 张</span>
            {filteredCards.length > 0 && (
              <>
                <span>·</span>
                <button
                  onClick={() => handleBatchStatus('PUBLISHED')}
                  disabled={batchWorking}
                  className="text-green-300/70 hover:text-green-300 disabled:opacity-40 flex items-center gap-0.5"
                >
                  <ArrowUp size={10} /> 全部上线
                </button>
                <button
                  onClick={() => handleBatchStatus('DRAFT')}
                  disabled={batchWorking}
                  className="text-yellow-300/70 hover:text-yellow-300 disabled:opacity-40 flex items-center gap-0.5"
                >
                  <ArrowDown size={10} /> 全部转草稿
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-500/15 border border-red-400/20 rounded-xl text-red-300 text-sm flex items-center gap-2">
              <AlertTriangle size={14} />
              {error}
              <button onClick={loadCards} className="ml-2 underline">重试</button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={28} className="animate-spin text-orange-300/40" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                {paginatedCards.map((card) => (
                  <div
                    key={card.cardCode}
                    className="group cursor-pointer"
                    onClick={() => { setSelectedCard(card); setIsCreating(false); }}
                  >
                    <div className="w-full relative" style={{ aspectRatio: '63/88' }}>
                      <Card
                        cardData={card}
                        imagePath={resolveCardImagePath(card)}
                        size="responsive"
                        interactive={false}
                        showHover={false}
                        className="rounded-lg transition-[filter] duration-200 group-hover:brightness-110"
                      />
                      {cardStatusMap.get(card.cardCode) === 'DRAFT' && (
                        <div className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] font-bold bg-yellow-500/80 text-yellow-950 rounded">
                          草稿
                        </div>
                      )}
                    </div>
                    <div className="mt-1.5 text-center">
                      <div className="text-xs text-orange-300/60 truncate">{card.cardCode}</div>
                      <div className="text-xs text-orange-300/35 truncate">{card.name}</div>
                    </div>
                    <div className="mt-1 flex justify-center gap-1">
                      <span className="px-2 py-0.5 text-xs bg-orange-500/15 text-orange-300/70 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <Pencil size={10} /> 编辑
                      </span>
                      {cardStatusMap.get(card.cardCode) === 'DRAFT' ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cardService.publishCard(card.cardCode).then(() => loadCards()).catch((err) => setError(err instanceof Error ? err.message : '上线失败'));
                          }}
                          className="px-2 py-0.5 text-xs bg-green-500/15 text-green-300/70 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-green-500/30 flex items-center gap-0.5"
                        >
                          <ArrowUp size={10} /> 上线
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            cardService.unpublishCard(card.cardCode).then(() => loadCards()).catch((err) => setError(err instanceof Error ? err.message : '下线失败'));
                          }}
                          className="px-2 py-0.5 text-xs bg-yellow-500/15 text-yellow-300/70 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-yellow-500/30 flex items-center gap-0.5"
                        >
                          <ArrowDown size={10} /> 下线
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-6">
                  <button onClick={() => goToPage(1)} disabled={currentPage === 1} className="p-2 text-orange-300/50 hover:text-orange-300 disabled:opacity-30 transition-all">
                    <ChevronsLeft size={16} />
                  </button>
                  <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-2 text-orange-300/50 hover:text-orange-300 disabled:opacity-30 transition-all">
                    <ChevronLeft size={16} />
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) pageNum = i + 1;
                      else if (currentPage <= 3) pageNum = i + 1;
                      else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                      else pageNum = currentPage - 2 + i;
                      return (
                        <button
                          key={pageNum}
                          onClick={() => goToPage(pageNum)}
                          className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                            currentPage === pageNum
                              ? 'bg-orange-500/25 text-orange-200 border border-orange-400/50'
                              : 'text-orange-300/50 hover:text-orange-300 hover:bg-orange-500/10'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <span className="text-orange-300/40 text-xs px-2">{currentPage}/{totalPages}</span>

                  <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="p-2 text-orange-300/50 hover:text-orange-300 disabled:opacity-30 transition-all">
                    <ChevronRight size={16} />
                  </button>
                  <button onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages} className="p-2 text-orange-300/50 hover:text-orange-300 disabled:opacity-30 transition-all">
                    <ChevronsRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}

          {filteredCards.length === 0 && !loading && (
            <div className="text-center py-20">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border-2 border-dashed border-orange-300/20 flex items-center justify-center">
                <Search size={24} className="text-orange-300/30" />
              </div>
              <div className="text-orange-300/50 text-sm">没有找到匹配的卡牌</div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {(selectedCard || isCreating) && (
          <CardEditModal
            card={selectedCard}
            isOpen={true}
            onClose={() => { setSelectedCard(null); setIsCreating(false); }}
            onSave={handleSave}
            onCreate={handleCreate}
            onDelete={handleDelete}
            isCreating={isCreating}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default CardAdminPage;
