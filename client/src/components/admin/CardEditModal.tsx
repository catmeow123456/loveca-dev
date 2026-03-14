/**
 * CardEditModal - 卡牌编辑弹窗
 */

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Trash2, Wand2, Upload } from 'lucide-react';
import { CardType, HeartColor, BladeHeartEffect } from '@game/shared/types/enums';
import type { AnyCardData } from '@game/domain/entities/card';
import type { CardUpdateInput, CardCreateInput } from '@/lib/cardService';
import { resolveCardImagePath } from '@/lib/imageService';
import {
  uploadCardImage,
  validateImageFile,
  getImagePreviewUrl,
  revokeImagePreviewUrl,
  type UploadProgress,
} from '@/lib/imageUploadService';
import { extractCardEffect } from '@/lib/aiService';
import { GROUP_OPTIONS, GROUP_UNIT_MAP, HEART_COLOR_OPTIONS, RARITY_OPTIONS } from '@/components/deck-editor/filter-constants';
import { formDataToYaml, yamlToFormData } from './yaml-helpers';

type EditMode = 'form' | 'yaml';

interface CardEditModalProps {
  card: AnyCardData | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (cardCode: string, updates: CardUpdateInput) => Promise<void>;
  onCreate: (input: CardCreateInput) => Promise<void>;
  onDelete: (cardCode: string) => Promise<void>;
  isCreating: boolean;
}

export function CardEditModal({ card, isOpen, onClose, onSave, onCreate, onDelete, isCreating }: CardEditModalProps) {
  const [formData, setFormData] = useState<CardUpdateInput & { cardCode?: string; cardType?: 'MEMBER' | 'LIVE' | 'ENERGY' }>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('form');
  const [yamlText, setYamlText] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);

  const [aiExtracting, setAiExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    return () => {
      if (imagePreview) {
        revokeImagePreviewUrl(imagePreview);
      }
    };
  }, [imagePreview]);

  useEffect(() => {
    if (card) {
      setFormData({
        name: card.name,
        groupName: card.groupName ?? null,
        unitName: card.unitName ?? null,
        cardText: card.cardText ?? null,
        rare: card.rare ?? null,
        product: card.product ?? null,
        ...(card.cardType === CardType.MEMBER ? {
          cost: card.cost,
          blade: card.blade,
          hearts: [...card.hearts],
          bladeHearts: card.bladeHearts ? [...card.bladeHearts] : null,
        } : {}),
        ...(card.cardType === CardType.LIVE ? {
          score: card.score,
          requirements: Array.from(card.requirements.colorRequirements.entries()).map(([color, count]) => ({ color, count })),
          bladeHearts: card.bladeHearts ? [...card.bladeHearts] : null,
        } : {}),
      });
    } else {
      setFormData({
        cardCode: '',
        cardType: 'MEMBER',
        name: '',
        groupName: null,
        unitName: null,
        cost: 0,
        blade: 0,
        hearts: [],
        bladeHearts: null,
        score: 1,
        requirements: [],
        cardText: null,
        rare: null,
        product: null,
      });
    }
    setError(null);
    setEditMode('form');
    setYamlText('');
    setYamlError(null);
  }, [card, isOpen]);

  const switchToYaml = () => {
    setYamlText(formDataToYaml(formData, card?.cardType, isCreating));
    setYamlError(null);
    setEditMode('yaml');
  };

  const switchToForm = () => {
    try {
      const parsed = yamlToFormData(yamlText, formData);
      setFormData(parsed);
      setYamlError(null);
      setEditMode('form');
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : 'YAML 解析失败');
    }
  };

  const handleAiExtract = async () => {
    setAiExtracting(true);
    setError(null);
    try {
      let imageUrl: string | null = null;
      if (imagePreview) {
        setError('请先保存卡牌（上传图片）后再使用 AI 提取');
        return;
      }
      if (card?.imageFilename) {
        imageUrl = resolveCardImagePath(card, 'large');
      }
      if (!imageUrl || imageUrl.includes('back.webp')) {
        setError('当前卡牌没有图片，无法进行 AI 提取');
        return;
      }
      const result = await extractCardEffect(imageUrl);
      setFormData((prev) => ({ ...prev, cardText: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 提取失败');
    } finally {
      setAiExtracting(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    let currentFormData = formData;
    if (editMode === 'yaml') {
      try {
        currentFormData = yamlToFormData(yamlText, formData);
        setFormData(currentFormData);
      } catch (err) {
        setError('YAML 解析失败: ' + (err instanceof Error ? err.message : String(err)));
        setSaving(false);
        return;
      }
    }

    try {
      const targetCardCode = isCreating ? currentFormData.cardCode : card?.cardCode;

      let imageFilename: string | undefined;
      if (imageFile && targetCardCode) {
        setUploadProgress({ status: 'compressing', progress: 0, message: '开始处理图片...' });

        const uploadResult = await uploadCardImage(imageFile, targetCardCode, (progress) => {
          setUploadProgress(progress);
        });

        if (!uploadResult.success) {
          throw new Error(`图片上传失败: ${uploadResult.error}`);
        }

        imageFilename = uploadResult.imageFilename;
        setUploadProgress({ status: 'done', progress: 100, message: '图片上传完成！' });
      }

      if (isCreating) {
        if (!currentFormData.cardCode || !currentFormData.name || !currentFormData.cardType) {
          throw new Error('请填写卡牌编号、名称和类型');
        }
        await onCreate({
          cardCode: currentFormData.cardCode,
          cardType: currentFormData.cardType,
          name: currentFormData.name,
          groupName: currentFormData.groupName,
          unitName: currentFormData.unitName,
          cost: currentFormData.cardType === 'MEMBER' ? currentFormData.cost : null,
          blade: currentFormData.cardType === 'MEMBER' ? currentFormData.blade : null,
          hearts: currentFormData.cardType === 'MEMBER' ? currentFormData.hearts : undefined,
          bladeHearts: currentFormData.bladeHearts,
          score: currentFormData.cardType === 'LIVE' ? currentFormData.score : null,
          requirements: currentFormData.cardType === 'LIVE' ? currentFormData.requirements : undefined,
          cardText: currentFormData.cardText,
          imageFilename,
          rare: currentFormData.rare,
          product: currentFormData.product,
        });
      } else if (card) {
        await onSave(card.cardCode, {
          ...currentFormData,
          imageFilename,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  const handleDelete = async () => {
    if (!card) return;
    if (!confirm(`确定要删除卡牌 ${card.cardCode} 吗？此操作不可撤销。`)) return;

    setSaving(true);
    try {
      await onDelete(card.cardCode);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // Hearts 编辑器
  const addOrIncrementHeart = (color: HeartColor) => {
    const hearts = formData.hearts || [];
    const idx = hearts.findIndex(h => h.color === color);
    if (idx >= 0) {
      const newHearts = [...hearts];
      newHearts[idx] = { ...newHearts[idx], count: newHearts[idx].count + 1 };
      setFormData({ ...formData, hearts: newHearts });
    } else {
      setFormData({ ...formData, hearts: [...hearts, { color, count: 1 }] });
    }
  };

  const decrementHeart = (index: number) => {
    const hearts = [...(formData.hearts || [])];
    if (hearts[index].count <= 1) {
      setFormData({ ...formData, hearts: hearts.filter((_, i) => i !== index) });
    } else {
      hearts[index] = { ...hearts[index], count: hearts[index].count - 1 };
      setFormData({ ...formData, hearts });
    }
  };

  const incrementHeart = (index: number) => {
    const hearts = [...(formData.hearts || [])];
    hearts[index] = { ...hearts[index], count: hearts[index].count + 1 };
    setFormData({ ...formData, hearts });
  };

  const removeHeart = (index: number) => {
    const newHearts = (formData.hearts || []).filter((_, i) => i !== index);
    setFormData({ ...formData, hearts: newHearts });
  };

  // Requirements 编辑器
  const addOrIncrementReq = (color: HeartColor) => {
    const reqs = formData.requirements || [];
    const idx = reqs.findIndex(r => r.color === color);
    if (idx >= 0) {
      const newReqs = [...reqs];
      newReqs[idx] = { ...newReqs[idx], count: newReqs[idx].count + 1 };
      setFormData({ ...formData, requirements: newReqs });
    } else {
      setFormData({ ...formData, requirements: [...reqs, { color, count: 1 }] });
    }
  };

  const decrementReq = (index: number) => {
    const reqs = [...(formData.requirements || [])];
    if (reqs[index].count <= 1) {
      setFormData({ ...formData, requirements: reqs.filter((_, i) => i !== index) });
    } else {
      reqs[index] = { ...reqs[index], count: reqs[index].count - 1 };
      setFormData({ ...formData, requirements: reqs });
    }
  };

  const incrementReq = (index: number) => {
    const reqs = [...(formData.requirements || [])];
    reqs[index] = { ...reqs[index], count: reqs[index].count + 1 };
    setFormData({ ...formData, requirements: reqs });
  };

  const removeRequirement = (index: number) => {
    const newReqs = (formData.requirements || []).filter((_, i) => i !== index);
    setFormData({ ...formData, requirements: newReqs });
  };

  // BladeHearts 编辑器
  const addBladeHeart = (effect: BladeHeartEffect, heartColor?: HeartColor) => {
    const current = formData.bladeHearts || [];
    const item: { effect: BladeHeartEffect; heartColor?: HeartColor } = { effect };
    if (heartColor) item.heartColor = heartColor;
    setFormData({ ...formData, bladeHearts: [...current, item] });
  };

  const removeBladeHeart = (index: number) => {
    const newList = (formData.bladeHearts || []).filter((_, i) => i !== index);
    setFormData({ ...formData, bladeHearts: newList.length > 0 ? newList : null });
  };

  const cardType = formData.cardType || card?.cardType;

  // 解析当前选中的作品名列表（支持 \n 分隔的多值，空字符串代表特殊的小组）
  // 注意：使用 != null 而非真值判断，因为空字符串 '' 是有效值（代表跨系列小组）
  const selectedGroups = formData.groupName != null ? formData.groupName.split('\n') : [];

  // 添加/移除作品名
  const toggleGroup = (group: string) => {
    const current = new Set(selectedGroups);
    if (current.has(group)) {
      current.delete(group);
    } else {
      current.add(group);
    }
    // 过滤掉空字符串仅用于判断 size，但保留空字符串在最终结果中
    const nonEmptyGroups = Array.from(current).filter(g => g.trim() || g === '');
    const newGroupName = nonEmptyGroups.length > 0 ? nonEmptyGroups.join('\n') : null;
    // 如果组名变化导致当前小组不在新组的范围内，清空小组选择
    const groupsForUnitLookup = newGroupName ? newGroupName.split('\n').filter(g => g.trim() || g === '') : [];
    const newUnitOptions = groupsForUnitLookup.length > 0
      ? [...new Set(groupsForUnitLookup.flatMap(g => GROUP_UNIT_MAP[g] || []))]
      : [];
    const currentUnitValid = newUnitOptions.includes(formData.unitName || '');
    setFormData({
      ...formData,
      groupName: newGroupName,
      unitName: currentUnitValid ? formData.unitName : null,
    });
  };

  // 获取所有选中作品名的小组选项
  const unitOptions = selectedGroups.length > 0
    ? [...new Set(selectedGroups.flatMap(g => GROUP_UNIT_MAP[g] || []))]
    : [];

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="relative bg-gradient-to-b from-[#3d3020] to-[#2d2820] rounded-2xl border border-orange-300/30 shadow-2xl shadow-orange-500/20 w-full max-w-2xl max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-orange-300/20">
          <h2 className="text-lg font-bold text-orange-100">
            {isCreating ? '创建新卡牌' : `编辑卡牌: ${card?.cardCode}`}
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-orange-300/20">
              <button
                onClick={() => editMode === 'yaml' ? switchToForm() : undefined}
                className={`px-3 py-1.5 text-xs transition-all ${
                  editMode === 'form'
                    ? 'bg-orange-500/25 text-orange-200'
                    : 'bg-transparent text-orange-300/50 hover:text-orange-300'
                }`}
              >
                表单
              </button>
              <button
                onClick={() => editMode === 'form' ? switchToYaml() : undefined}
                className={`px-3 py-1.5 text-xs transition-all ${
                  editMode === 'yaml'
                    ? 'bg-orange-500/25 text-orange-200'
                    : 'bg-transparent text-orange-300/50 hover:text-orange-300'
                }`}
              >
                YAML
              </button>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full text-orange-300/60 hover:text-orange-300 hover:bg-orange-500/15 transition-all"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] cute-scrollbar">
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-400/30 rounded-xl text-red-300 text-sm">
              {error}
            </div>
          )}

          {editMode === 'yaml' ? (
            <div className="space-y-3">
              {yamlError && (
                <div className="p-3 bg-red-500/20 border border-red-400/30 rounded-xl text-red-300 text-sm">
                  YAML 解析错误: {yamlError}
                </div>
              )}
              <textarea
                value={yamlText}
                onChange={(e) => {
                  setYamlText(e.target.value);
                  setYamlError(null);
                }}
                className="w-full px-4 py-3 bg-[#1a1510] border border-orange-300/20 rounded-xl text-orange-100 font-mono text-sm focus:outline-none focus:border-orange-400/50 resize-y"
                style={{ minHeight: '400px' }}
                spellCheck={false}
              />
              <p className="text-xs text-orange-300/40">
                直接编辑 YAML 格式的卡牌数据。切回表单模式时会自动解析并应用更改。
              </p>
            </div>
          ) : (
          <div className="space-y-4">
            {/* 基本信息 */}
            <div className="grid grid-cols-2 gap-4">
              {isCreating && (
                <>
                  <div>
                    <label className="block text-sm text-orange-300/70 mb-1">卡牌编号 *</label>
                    <input
                      type="text"
                      value={formData.cardCode || ''}
                      onChange={(e) => setFormData({ ...formData, cardCode: e.target.value })}
                      className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                      placeholder="PL-sd1-001"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-orange-300/70 mb-1">卡牌类型 *</label>
                    <select
                      value={formData.cardType || 'MEMBER'}
                      onChange={(e) => setFormData({ ...formData, cardType: e.target.value as 'MEMBER' | 'LIVE' | 'ENERGY' })}
                      className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                    >
                      <option value="MEMBER">成员卡</option>
                      <option value="LIVE">Live 卡</option>
                      <option value="ENERGY">能量卡</option>
                    </select>
                  </div>
                </>
              )}

              <div className={isCreating ? 'col-span-2' : ''}>
                <label className="block text-sm text-orange-300/70 mb-1">卡牌名称 *</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-orange-300/70 mb-2">作品名（可多选）</label>
                {/* 可选作品名标签面板 */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {GROUP_OPTIONS.map((g) => {
                    const isSelected = selectedGroups.includes(g);
                    const displayLabel = g;
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => toggleGroup(g)}
                        className={`px-2 py-1 text-xs rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-orange-500/25 text-orange-200 border-orange-400/50'
                            : 'border-orange-300/20 bg-[#3d3020]/40 text-orange-300/70 hover:border-orange-300/40 hover:text-orange-300'
                        }`}
                      >
                        {displayLabel}
                      </button>
                    );
                  })}
                </div>
                {/* 已选作品名列表 */}
                <div className="flex flex-wrap gap-1.5">
                  {selectedGroups.length > 0 ? (
                    selectedGroups.map((g) => {
                      const displayLabel = g === '' ? '()' : g;
                      return (
                        <div key={g === '' ? '__empty__' : g} className="flex items-center gap-1 px-2 py-1 bg-orange-500/15 border border-orange-400/30 rounded-lg text-sm">
                          <span className="text-orange-100">{displayLabel}</span>
                          <button
                            type="button"
                            onClick={() => toggleGroup(g)}
                            className="px-1 text-red-400/70 hover:text-red-300"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-orange-300/40 py-1">点击上方标签添加作品名</div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm text-orange-300/70 mb-1">小组</label>
                <select
                  value={formData.unitName || ''}
                  onChange={(e) => setFormData({ ...formData, unitName: e.target.value || null })}
                  className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                  disabled={selectedGroups.length === 0}
                >
                  <option value="">无</option>
                  {unitOptions.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-orange-300/70 mb-1">稀有度</label>
                <select
                  value={formData.rare || ''}
                  onChange={(e) => setFormData({ ...formData, rare: e.target.value || null })}
                  className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                >
                  <option value="">自动（从编号推断）</option>
                  {RARITY_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-orange-300/70 mb-1">收录商品</label>
                <input
                  type="text"
                  value={formData.product || ''}
                  onChange={(e) => setFormData({ ...formData, product: e.target.value || null })}
                  className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                  placeholder="例: ブースターパック vol.1"
                />
              </div>
            </div>

            {/* 成员卡专属字段 */}
            {cardType === CardType.MEMBER && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-orange-300/70 mb-1">费用</label>
                    <input
                      type="number"
                      value={formData.cost ?? 0}
                      onChange={(e) => setFormData({ ...formData, cost: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-orange-300/70 mb-1">应援棒 (Blade)</label>
                    <input
                      type="number"
                      value={formData.blade ?? 0}
                      onChange={(e) => setFormData({ ...formData, blade: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                      min="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm text-orange-300/70 mb-2 block">心图标 (Hearts)</label>
                  {/* 颜色面板 */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {HEART_COLOR_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => addOrIncrementHeart(opt.value as HeartColor)}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-orange-300/20 bg-[#3d3020]/40 text-orange-300/70 hover:border-orange-300/40 hover:text-orange-300 transition-all"
                      >
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${opt.colorClass}`} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* 已选列表 */}
                  <div className="flex flex-wrap gap-1.5">
                    {(formData.hearts || []).map((heart, i) => {
                      const opt = HEART_COLOR_OPTIONS.find(o => o.value === heart.color);
                      return (
                        <div key={i} className="flex items-center gap-1 px-2 py-1 bg-[#2d2820]/80 border border-orange-300/20 rounded-lg text-sm">
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${opt?.colorClass ?? 'bg-gray-400'}`} />
                          <span className="text-orange-100">{opt?.label ?? heart.color}</span>
                          <span className="text-orange-300/50 mx-0.5">×{heart.count}</span>
                          <button onClick={() => decrementHeart(i)} className="px-1 text-orange-300/60 hover:text-orange-200">−</button>
                          <button onClick={() => incrementHeart(i)} className="px-1 text-orange-300/60 hover:text-orange-200">+</button>
                          <button onClick={() => removeHeart(i)} className="px-1 text-red-400/70 hover:text-red-300">✕</button>
                        </div>
                      );
                    })}
                    {(formData.hearts || []).length === 0 && (
                      <div className="text-sm text-orange-300/40 py-2">点击上方颜色添加心图标</div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Live 卡专属字段 */}
            {cardType === CardType.LIVE && (
              <>
                <div>
                  <label className="block text-sm text-orange-300/70 mb-1">分数</label>
                  <input
                    type="number"
                    value={formData.score ?? 1}
                    onChange={(e) => setFormData({ ...formData, score: parseInt(e.target.value) || 1 })}
                    className="w-32 px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50"
                    min="1"
                  />
                </div>

                <div>
                  <label className="text-sm text-orange-300/70 mb-2 block">心需求 (Requirements)</label>
                  {/* 颜色面板 */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {HEART_COLOR_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => addOrIncrementReq(opt.value as HeartColor)}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-orange-300/20 bg-[#3d3020]/40 text-orange-300/70 hover:border-orange-300/40 hover:text-orange-300 transition-all"
                      >
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${opt.colorClass}`} />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* 已选列表 */}
                  <div className="flex flex-wrap gap-1.5">
                    {(formData.requirements || []).map((req, i) => {
                      const opt = HEART_COLOR_OPTIONS.find(o => o.value === req.color);
                      return (
                        <div key={i} className="flex items-center gap-1 px-2 py-1 bg-[#2d2820]/80 border border-orange-300/20 rounded-lg text-sm">
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${opt?.colorClass ?? 'bg-gray-400'}`} />
                          <span className="text-orange-100">{opt?.label ?? req.color}</span>
                          <span className="text-orange-300/50 mx-0.5">×{req.count}</span>
                          <button onClick={() => decrementReq(i)} className="px-1 text-orange-300/60 hover:text-orange-200">−</button>
                          <button onClick={() => incrementReq(i)} className="px-1 text-orange-300/60 hover:text-orange-200">+</button>
                          <button onClick={() => removeRequirement(i)} className="px-1 text-red-400/70 hover:text-red-300">✕</button>
                        </div>
                      );
                    })}
                    {(formData.requirements || []).length === 0 && (
                      <div className="text-sm text-orange-300/40 py-2">点击上方颜色添加心需求</div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* BladeHearts 编辑 */}
            {(cardType === CardType.MEMBER || cardType === CardType.LIVE) && (
              <div>
                <label className="text-sm text-orange-300/70 mb-2 block">
                  应援棒心效果 (BladeHearts) {cardType === CardType.LIVE && '- Live 成功奖励'}
                </label>
                {/* 效果按钮面板 */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <button
                    onClick={() => addBladeHeart(BladeHeartEffect.DRAW)}
                    className="px-2 py-1 text-xs rounded-lg border border-orange-300/20 bg-[#3d3020]/40 text-orange-300/70 hover:border-orange-300/40 hover:text-orange-300 transition-all"
                  >
                    抽卡
                  </button>
                  <button
                    onClick={() => addBladeHeart(BladeHeartEffect.SCORE)}
                    className="px-2 py-1 text-xs rounded-lg border border-orange-300/20 bg-[#3d3020]/40 text-orange-300/70 hover:border-orange-300/40 hover:text-orange-300 transition-all"
                  >
                    加分
                  </button>
                  <span className="border-l border-orange-300/20 mx-1" />
                  {HEART_COLOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => addBladeHeart(BladeHeartEffect.HEART, opt.value as HeartColor)}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-orange-300/20 bg-[#3d3020]/40 text-orange-300/70 hover:border-orange-300/40 hover:text-orange-300 transition-all"
                    >
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${opt.value === HeartColor.RAINBOW ? 'bg-pink-400' : opt.colorClass}`} />
                      {opt.value === HeartColor.RAINBOW ? 'All' : opt.label}
                    </button>
                  ))}
                </div>
                {/* 已选列表 */}
                <div className="flex flex-wrap gap-1.5">
                  {(formData.bladeHearts || []).map((item, i) => {
                    let pillColor: string | null = null;
                    let pillLabel = '';
                    if (item.effect === BladeHeartEffect.DRAW) {
                      pillLabel = '抽卡';
                    } else if (item.effect === BladeHeartEffect.SCORE) {
                      pillLabel = '加分';
                    } else if (item.effect === BladeHeartEffect.HEART && item.heartColor) {
                      const opt = HEART_COLOR_OPTIONS.find(o => o.value === item.heartColor);
                      pillColor = item.heartColor === HeartColor.RAINBOW ? 'bg-pink-400' : (opt?.colorClass ?? 'bg-gray-400');
                      pillLabel = item.heartColor === HeartColor.RAINBOW ? 'All' : (opt?.label ?? item.heartColor);
                    }
                    return (
                      <div key={i} className="flex items-center gap-1 px-2 py-1 bg-[#2d2820]/80 border border-orange-300/20 rounded-lg text-sm">
                        {pillColor && <span className={`inline-block w-2.5 h-2.5 rounded-full ${pillColor}`} />}
                        <span className="text-orange-100">{pillLabel}</span>
                        <button onClick={() => removeBladeHeart(i)} className="px-1 text-red-400/70 hover:text-red-300">✕</button>
                      </div>
                    );
                  })}
                  {(formData.bladeHearts || []).length === 0 && (
                    <div className="text-sm text-orange-300/40 py-2">点击上方按钮添加应援棒心效果</div>
                  )}
                </div>
              </div>
            )}

            {/* 卡牌文本 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-orange-300/70">卡牌文本</label>
                <button
                  type="button"
                  onClick={handleAiExtract}
                  disabled={aiExtracting || (!card?.imageFilename && !imagePreview)}
                  className="px-2 py-0.5 text-xs rounded-lg bg-purple-600/60 text-purple-100 hover:bg-purple-500/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  {aiExtracting ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-purple-200 border-t-transparent rounded-full animate-spin" />
                      提取中...
                    </>
                  ) : (
                    <><Wand2 size={12} /> AI 提取效果</>
                  )}
                </button>
              </div>
              <textarea
                value={formData.cardText || ''}
                onChange={(e) => setFormData({ ...formData, cardText: e.target.value || null })}
                className="w-full px-3 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 focus:outline-none focus:border-orange-400/50 min-h-[80px] resize-y"
                placeholder="【登场】效果描述..."
              />
            </div>

            {/* 卡牌图片上传 */}
            <div>
              <label className="block text-sm text-orange-300/70 mb-2">卡牌图片</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const validation = validateImageFile(file);
                    if (!validation.valid) {
                      setError(validation.error || '文件验证失败');
                      return;
                    }
                    setImageFile(file);
                    if (imagePreview) revokeImagePreviewUrl(imagePreview);
                    setImagePreview(getImagePreviewUrl(file));
                    setError(null);
                  }
                }}
              />

              <div className="flex gap-4 items-start">
                <div className="w-32 rounded-xl border-2 border-dashed border-orange-300/30 flex items-center justify-center overflow-hidden bg-[#2d2820]/40" style={{ aspectRatio: '63/88' }}>
                  {imagePreview ? (
                    <img src={imagePreview} alt="预览" className="w-full h-full object-cover" />
                  ) : card?.imageFilename ? (
                    <img src={resolveCardImagePath(card, 'medium')} alt={card.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-orange-300/30 text-xs text-center px-2">暂无图片</span>
                  )}
                </div>

                <div className="flex-1 space-y-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-300 hover:border-orange-300/40 transition-all text-sm flex items-center gap-1.5"
                  >
                    <Upload size={14} />
                    {imageFile || card?.imageFilename ? '更换图片' : '选择图片'}
                  </button>

                  {imageFile && (
                    <div className="text-xs text-orange-300/60">
                      已选择: {imageFile.name} ({(imageFile.size / 1024).toFixed(1)}KB)
                    </div>
                  )}

                  {uploadProgress && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-orange-300/70">
                        <span>{uploadProgress.message}</span>
                        <span>{uploadProgress.progress}%</span>
                      </div>
                      <div className="h-2 bg-[#2d2820] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            uploadProgress.status === 'error' ? 'bg-red-500'
                            : uploadProgress.status === 'done' ? 'bg-green-500'
                            : 'bg-orange-500'
                          }`}
                          style={{ width: `${uploadProgress.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-orange-300/40">
                    支持 JPG, PNG, WebP 格式，最大 10MB
                  </p>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-orange-300/20 bg-[#2d2820]/50">
          <div>
            {!isCreating && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-4 py-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-all disabled:opacity-50 flex items-center gap-1.5 text-sm"
              >
                <Trash2 size={14} /> 删除
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-orange-300/70 hover:text-orange-300 rounded-xl transition-all text-sm"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="px-6 py-2 bg-gradient-to-r from-orange-400 to-amber-400 text-white rounded-xl font-medium transition-all hover:shadow-lg hover:shadow-orange-500/30 disabled:opacity-50 text-sm"
            >
              {saving ? '保存中...' : (isCreating ? '创建' : '保存')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
