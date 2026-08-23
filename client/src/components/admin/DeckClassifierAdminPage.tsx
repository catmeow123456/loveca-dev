import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, Loader2, Pencil, Plus, RefreshCw, Rocket, RotateCcw, Trash2 } from 'lucide-react';
import type {
  DeckClassificationRunView,
  DeckClassifierArchetypeView,
  DeckClassifierOverviewView,
  DeckClassifierPreviewView,
  DeckClassifierRuleDefinitionView,
  DeckClassifierTemplateCardView,
  DeckEnvironmentSection,
} from '@game/online/deck-classifier-types';
import type { AnyCardData } from '@game/domain/entities/card';
import { ActionButton, Panel, StatusBadge, TextInput } from '@/components/common';
import { getBaseCardCode } from '@/lib/cardUtils';
import {
  archiveDeckClassifierArchetype,
  createDeckClassifierArchetype,
  createDeckClassifierRule,
  createDeckClassifierTemplateFromReview,
  deleteDeckClassifierRule,
  deleteDeckClassifierTemplate,
  fetchDeckClassifierOverview,
  importDeckClassifierTemplateFromMatch,
  previewDeckClassifierRelease,
  publishDeckClassifierRelease,
  reclassifyDecks,
  revokeDeckClassificationOverride,
  setDeckClassificationOverride,
  updateDeckClassifierArchetype,
  updateDeckClassifierArchetypeDisplay,
  updateDeckClassifierDisplaySettings,
  updateDeckClassifierRule,
  updateDeckClassifierTemplate,
  waitForDeckClassificationRun,
} from '@/lib/deckClassifierAdminClient';
import {
  commonRuleConditionsToDefinition,
  DEFAULT_COMMON_RULE_CONDITION,
  definitionToCommonRuleConditions,
  describeRuleDefinition,
  type CommonRuleCondition,
} from '@/lib/deckClassifierRuleEditor';
import { resolveCardImagePath } from '@/lib/imageService';
import { useGameStore } from '@/store/gameStore';
import { AdminPageHeader } from './AdminPageHeader';
import { AdminViewTabs } from './AdminViewTabs';

type Tab = 'overview' | 'archetypes' | 'templates' | 'rules' | 'review';

const TABS = [
  { value: 'overview', label: '发布与口径' },
  { value: 'archetypes', label: '分类名称' },
  { value: 'templates', label: '样板库' },
  { value: 'rules', label: '识别规则' },
  { value: 'review', label: '待处理' },
] as const;

const CLASSIFIER_SELECT_CLASS = 'input-field h-11 px-3 text-sm';

const DISPLAY_SECTION_OPTIONS = [
  { value: 'USAGE', label: '使用占比' },
  { value: 'WINNER', label: '胜者构成' },
  { value: 'TOP_RANKED', label: '高排名玩家构成' },
] as const satisfies readonly { value: DeckEnvironmentSection; label: string }[];

const DEFAULT_RULE_JSON = JSON.stringify(
  {
    includeAll: [{ baseCardCode: 'PL!-bp4-021', cardType: 'LIVE', minCount: 2 }],
  },
  null,
  2
);

interface ArchetypeFormState {
  readonly editingId: string | null;
  readonly archetypeKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly description: string;
  readonly color: string;
  readonly representativeCardCode: string;
  readonly sortOrder: string;
}

const EMPTY_ARCHETYPE_FORM: ArchetypeFormState = {
  editingId: null,
  archetypeKey: '',
  name: '',
  groupName: '',
  description: '',
  color: '#7C3AED',
  representativeCardCode: '',
  sortOrder: '100',
};

export interface DeckClassifierTemplateImportSource {
  readonly matchId: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly name: string;
  readonly note: string;
}

export function DeckClassifierAdminPage({
  onBack,
  initialTemplateImport,
}: {
  onBack: () => void;
  initialTemplateImport?: DeckClassifierTemplateImportSource | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTemplateImport ? 'templates' : 'overview');
  const [overview, setOverview] = useState<DeckClassifierOverviewView | null>(null);
  const [preview, setPreview] = useState<DeckClassifierPreviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('例行维护卡组分类配置');
  const [archetypeForm, setArchetypeForm] = useState<ArchetypeFormState>(EMPTY_ARCHETYPE_FORM);
  const [templateArchetypeId, setTemplateArchetypeId] = useState('');
  const [templateMatchId, setTemplateMatchId] = useState(initialTemplateImport?.matchId ?? '');
  const [templateSeat, setTemplateSeat] = useState<'FIRST' | 'SECOND'>(
    initialTemplateImport?.seat ?? 'FIRST'
  );
  const [templateName, setTemplateName] = useState(initialTemplateImport?.name ?? '');
  const [templateNote, setTemplateNote] = useState(initialTemplateImport?.note ?? '');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleArchetypeId, setRuleArchetypeId] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [rulePriority, setRulePriority] = useState('100');
  const [ruleJson, setRuleJson] = useState(DEFAULT_RULE_JSON);
  const [ruleEditorMode, setRuleEditorMode] = useState<'COMMON' | 'JSON'>('COMMON');
  const [commonRuleConditions, setCommonRuleConditions] = useState<readonly CommonRuleCondition[]>([
    DEFAULT_COMMON_RULE_CONDITION,
  ]);
  const [ruleEnabled, setRuleEnabled] = useState(true);
  const [overrideChoices, setOverrideChoices] = useState<Record<string, string>>({});

  const activeArchetypes = useMemo(
    () => overview?.archetypes.filter((archetype) => archetype.lifecycle === 'ACTIVE') ?? [],
    [overview]
  );

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await fetchDeckClassifierOverview();
      setOverview(next);
      setTemplateArchetypeId((current) =>
        next.archetypes.some((entry) => entry.id === current && entry.lifecycle === 'ACTIVE')
          ? current
          : (next.archetypes.find((entry) => entry.lifecycle === 'ACTIVE')?.id ?? '')
      );
      setRuleArchetypeId((current) =>
        next.archetypes.some((entry) => entry.id === current && entry.lifecycle === 'ACTIVE')
          ? current
          : (next.archetypes.find((entry) => entry.lifecycle === 'ACTIVE')?.id ?? '')
      );
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Initial aggregate load only.
  }, []);

  const run = async (operation: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await operation();
      setMessage(successMessage);
      await load();
      return true;
    } catch (operationError) {
      setError(readError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runClassificationOperation = async (
    operation: () => Promise<DeckClassificationRunView>,
    pendingMessage: string,
    successMessage: string
  ) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const initialRun = await operation();
      setMessage(pendingMessage);
      const completedRun = await waitForDeckClassificationRun(initialRun);
      if (!completedRun) {
        setMessage('重分类任务仍在后台处理，请稍后点击右上角刷新查看最终结果');
        await load();
        return true;
      }
      if (completedRun.status === 'FAILED') {
        throw new Error(completedRun.errorMessage ?? '卡组重分类任务执行失败');
      }
      setMessage(successMessage);
      await load();
      return true;
    } catch (operationError) {
      setMessage(null);
      setError(readError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const requireOverview = () => {
    if (!overview) throw new Error('卡组分类管理数据尚未载入');
    return overview;
  };

  const submitArchetype = async (event: FormEvent) => {
    event.preventDefault();
    const current = requireOverview();
    const payload = {
      expectedDraftRevision: current.draftRevision,
      name: archetypeForm.name,
      groupName: archetypeForm.groupName,
      description: archetypeForm.description,
      sortOrder: Number(archetypeForm.sortOrder),
      reason,
    };
    const completed = await run(
      () =>
        archetypeForm.editingId
          ? updateDeckClassifierArchetype(archetypeForm.editingId, payload)
          : createDeckClassifierArchetype({
              ...payload,
              archetypeKey: archetypeForm.archetypeKey,
              color: archetypeForm.color,
              representativeCardCode: archetypeForm.representativeCardCode.trim() || null,
            }),
      archetypeForm.editingId ? '分类定义已保存到草稿；发布前不会影响玩家分类' : '分类名称已创建'
    );
    if (completed && !archetypeForm.editingId) setArchetypeForm(EMPTY_ARCHETYPE_FORM);
  };

  const submitArchetypeDisplay = async () => {
    const archetypeId = archetypeForm.editingId;
    if (!archetypeId) return;
    await run(
      () =>
        updateDeckClassifierArchetypeDisplay(archetypeId, {
          color: archetypeForm.color,
          representativeCardCode: archetypeForm.representativeCardCode.trim() || null,
          reason,
        }),
      '代表卡和颜色已即时生效；无需预览、重算或发布'
    );
  };

  const submitTemplate = async (event: FormEvent) => {
    event.preventDefault();
    const current = requireOverview();
    const completed = await run(
      () =>
        importDeckClassifierTemplateFromMatch({
          expectedDraftRevision: current.draftRevision,
          archetypeId: templateArchetypeId,
          matchId: templateMatchId,
          seat: templateSeat,
          name: templateName,
          sourceNote: templateNote,
          reason,
        }),
      '已从对局的长期观察事实导入样板'
    );
    if (completed) {
      setTemplateMatchId('');
      setTemplateName('');
      setTemplateNote('');
    }
  };

  const submitRule = async (event: FormEvent) => {
    event.preventDefault();
    const current = requireOverview();
    let definition: DeckClassifierRuleDefinitionView;
    try {
      definition =
        ruleEditorMode === 'COMMON'
          ? commonRuleConditionsToDefinition(commonRuleConditions)
          : (JSON.parse(ruleJson) as DeckClassifierRuleDefinitionView);
    } catch (definitionError) {
      setError(
        definitionError instanceof SyntaxError ? '规则 JSON 格式无效' : readError(definitionError)
      );
      return;
    }
    const payload = {
      expectedDraftRevision: current.draftRevision,
      archetypeId: ruleArchetypeId,
      name: ruleName,
      priority: Number(rulePriority),
      definition,
      enabled: ruleEnabled,
      reason,
    };
    const completed = await run(
      () =>
        editingRuleId
          ? updateDeckClassifierRule(editingRuleId, payload)
          : createDeckClassifierRule(payload),
      editingRuleId ? '识别规则已更新' : '识别规则已创建'
    );
    if (completed) resetRuleForm();
  };

  const editArchetype = (archetype: DeckClassifierArchetypeView) => {
    setArchetypeForm({
      editingId: archetype.id,
      archetypeKey: archetype.archetypeKey,
      name: archetype.name,
      groupName: archetype.groupName,
      description: archetype.description,
      color: archetype.color,
      representativeCardCode: archetype.representativeCardCode ?? '',
      sortOrder: String(archetype.sortOrder),
    });
  };

  const editRule = (rule: NonNullable<typeof overview>['rules'][number]) => {
    const commonConditions = definitionToCommonRuleConditions(rule.definition);
    setEditingRuleId(rule.id);
    setRuleArchetypeId(rule.archetypeId);
    setRuleName(rule.name);
    setRulePriority(String(rule.priority));
    setRuleJson(JSON.stringify(rule.definition, null, 2));
    setRuleEditorMode(commonConditions ? 'COMMON' : 'JSON');
    setCommonRuleConditions(commonConditions ?? [DEFAULT_COMMON_RULE_CONDITION]);
    setRuleEnabled(rule.enabled);
  };

  const resetRuleForm = () => {
    setEditingRuleId(null);
    setRuleName('');
    setRulePriority('100');
    setRuleJson(DEFAULT_RULE_JSON);
    setRuleEditorMode('COMMON');
    setCommonRuleConditions([DEFAULT_COMMON_RULE_CONDITION]);
    setRuleEnabled(true);
  };

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <AdminPageHeader
        title="卡组分类"
        category="对局与赛季"
        onBack={onBack}
        actions={
          <button className="button-icon" onClick={() => void load()} aria-label="刷新">
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
          </button>
        }
      />

      <main className="product-page-main flex-1">
        <div className="mx-auto w-full max-w-6xl">
          <AdminViewTabs label="卡组分类管理视图" value={tab} tabs={TABS} onChange={setTab} />

          {error ? <Notice tone="error">{error}</Notice> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}
          {!overview && busy ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]">
              <Loader2 size={18} className="animate-spin" /> 正在载入卡组分类配置…
            </div>
          ) : null}

          {overview ? (
            <>
              <Panel padding="compact" className="mb-4">
                <label className="block text-sm font-semibold text-[var(--text-primary)]">
                  本次操作原因
                  <TextInput
                    className="mt-2 w-full"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="至少 5 个字；会写入持久审计"
                  />
                </label>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  草稿修订 #{overview.draftRevision}
                  。名称、样板和规则只有发布并完成全量分类后才会原子替换玩家正在看的版本。
                  代表卡和颜色属于展示设置，单独保存后即时生效。
                </p>
              </Panel>

              {tab === 'overview' ? (
                <OverviewTab
                  key={`${overview.displayMode}:${overview.visibleSections.join(',')}:${overview.topRankedPlayerCount}`}
                  overview={overview}
                  preview={preview}
                  busy={busy}
                  reason={reason}
                  onPreview={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      setPreview(await previewDeckClassifierRelease(overview.draftRevision));
                    } catch (previewError) {
                      setError(readError(previewError));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  onDisplaySettings={(settings) =>
                    run(
                      () =>
                        updateDeckClassifierDisplaySettings({
                          ...settings,
                          reason,
                        }),
                      '玩家展示设置已即时保存'
                    )
                  }
                  onPublish={() =>
                    run(
                      () => publishDeckClassifierRelease(overview.draftRevision, reason),
                      '新分类版本已进入后台构建；旧版本会继续服务到新版本完整成功'
                    )
                  }
                  onReclassify={() =>
                    runClassificationOperation(
                      () => reclassifyDecks(null, reason),
                      '已创建全量重分类任务，正在处理…',
                      '全量重分类已完成，页面数据已刷新'
                    )
                  }
                />
              ) : null}

              {tab === 'archetypes' ? (
                <ArchetypesTab
                  form={archetypeForm}
                  setForm={setArchetypeForm}
                  archetypes={overview.archetypes}
                  templates={overview.templates}
                  busy={busy}
                  onSubmit={submitArchetype}
                  onSaveDisplay={() => void submitArchetypeDisplay()}
                  onEdit={editArchetype}
                  onArchive={(archetype) => {
                    if (!window.confirm(`归档“${archetype.name}”？其草稿样板和规则会同时停用。`))
                      return;
                    void run(
                      () =>
                        archiveDeckClassifierArchetype(
                          archetype.id,
                          overview.draftRevision,
                          reason
                        ),
                      '分类名称已归档'
                    );
                  }}
                />
              ) : null}

              {tab === 'templates' ? (
                <TemplatesTab
                  overview={overview}
                  activeArchetypes={activeArchetypes}
                  busy={busy}
                  archetypeId={templateArchetypeId}
                  matchId={templateMatchId}
                  seat={templateSeat}
                  name={templateName}
                  note={templateNote}
                  onArchetypeId={setTemplateArchetypeId}
                  onMatchId={setTemplateMatchId}
                  onSeat={setTemplateSeat}
                  onName={setTemplateName}
                  onNote={setTemplateNote}
                  onSubmit={submitTemplate}
                  onToggle={(template) =>
                    run(
                      () =>
                        updateDeckClassifierTemplate(template.id, {
                          expectedDraftRevision: overview.draftRevision,
                          archetypeId: template.archetypeId,
                          name: template.name,
                          cards: template.cards,
                          sourceNote: template.sourceNote,
                          enabled: !template.enabled,
                          reason,
                        }),
                      template.enabled ? '样板已停用' : '样板已启用'
                    )
                  }
                  onDelete={(template) => {
                    if (!window.confirm(`删除样板“${template.name}”？已发布版本仍保留冻结快照。`))
                      return;
                    void run(
                      () =>
                        deleteDeckClassifierTemplate(template.id, overview.draftRevision, reason),
                      '样板已从草稿库删除'
                    );
                  }}
                  onUpdate={(templateId, input) =>
                    run(
                      () =>
                        updateDeckClassifierTemplate(templateId, {
                          expectedDraftRevision: overview.draftRevision,
                          ...input,
                          reason,
                        }),
                      '样板已保存到草稿；重新预览并发布完成后才会影响玩家分类'
                    )
                  }
                />
              ) : null}

              {tab === 'rules' ? (
                <RulesTab
                  overview={overview}
                  activeArchetypes={activeArchetypes}
                  busy={busy}
                  editingRuleId={editingRuleId}
                  archetypeId={ruleArchetypeId}
                  name={ruleName}
                  priority={rulePriority}
                  definitionJson={ruleJson}
                  editorMode={ruleEditorMode}
                  commonConditions={commonRuleConditions}
                  enabled={ruleEnabled}
                  onArchetypeId={setRuleArchetypeId}
                  onName={setRuleName}
                  onPriority={setRulePriority}
                  onDefinitionJson={setRuleJson}
                  onEditorMode={(mode) => {
                    if (mode === 'JSON' && ruleEditorMode === 'COMMON') {
                      setError(null);
                      try {
                        setRuleJson(
                          JSON.stringify(
                            commonRuleConditionsToDefinition(commonRuleConditions),
                            null,
                            2
                          )
                        );
                      } catch (modeError) {
                        setError(
                          `${readError(modeError)}；已保留原高级 JSON，请在高级模式中继续填写`
                        );
                      }
                    }
                    if (mode === 'COMMON' && ruleEditorMode === 'JSON') {
                      try {
                        const definition = JSON.parse(ruleJson) as DeckClassifierRuleDefinitionView;
                        const common = definitionToCommonRuleConditions(definition);
                        if (!common) {
                          setError(
                            '当前 JSON 使用了直观编辑器尚未支持的条件，需继续使用 JSON 编辑'
                          );
                          return;
                        }
                        setCommonRuleConditions(common);
                      } catch {
                        setError('规则 JSON 格式无效，暂时无法切换到直观编辑');
                        return;
                      }
                    }
                    if (!(mode === 'JSON' && ruleEditorMode === 'COMMON')) setError(null);
                    setRuleEditorMode(mode);
                  }}
                  onCommonConditions={setCommonRuleConditions}
                  onEnabled={setRuleEnabled}
                  onSubmit={submitRule}
                  onCancel={resetRuleForm}
                  onEdit={editRule}
                  onDelete={(rule) => {
                    if (!window.confirm(`删除识别规则“${rule.name}”？`)) return;
                    void run(
                      () => deleteDeckClassifierRule(rule.id, overview.draftRevision, reason),
                      '识别规则已删除'
                    );
                  }}
                />
              ) : null}

              {tab === 'review' ? (
                <ReviewTab
                  overview={overview}
                  activeArchetypes={activeArchetypes}
                  busy={busy}
                  choices={overrideChoices}
                  onChoice={(fingerprint, value) =>
                    setOverrideChoices((current) => ({ ...current, [fingerprint]: value }))
                  }
                  onOverride={(fingerprint, targetStatus, archetypeId) =>
                    runClassificationOperation(
                      () =>
                        setDeckClassificationOverride({
                          deckFingerprint: fingerprint,
                          targetStatus,
                          archetypeId,
                          appliesToFutureReleases: true,
                          reason,
                        }),
                      '人工分类设置已保存，正在重分类…',
                      '人工分类已生效，待处理队列已刷新'
                    )
                  }
                  onAddTemplate={(fingerprint, archetypeId, name, sourceNote) =>
                    run(
                      () =>
                        createDeckClassifierTemplateFromReview({
                          expectedDraftRevision: overview.draftRevision,
                          archetypeId,
                          deckFingerprint: fingerprint,
                          name,
                          sourceNote,
                          reason,
                        }),
                      '已加入启用的草稿样板；预览并发布成功后才参与分类'
                    )
                  }
                  onRevoke={(overrideId) =>
                    runClassificationOperation(
                      () => revokeDeckClassificationOverride(overrideId, reason),
                      '人工分类锁定已撤销，正在重分类…',
                      '人工分类锁定已撤销，分类结果已刷新'
                    )
                  }
                />
              ) : null}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function OverviewTab({
  overview,
  preview,
  busy,
  reason,
  onPreview,
  onDisplaySettings,
  onPublish,
  onReclassify,
}: {
  overview: DeckClassifierOverviewView;
  preview: DeckClassifierPreviewView | null;
  busy: boolean;
  reason: string;
  onPreview: () => void;
  onDisplaySettings: (settings: {
    readonly displayMode: Exclude<DeckClassifierOverviewView['displayMode'], 'HIDDEN'>;
    readonly visibleSections: readonly DeckEnvironmentSection[];
    readonly topRankedPlayerCount: number;
  }) => Promise<boolean>;
  onPublish: () => Promise<boolean>;
  onReclassify: () => Promise<boolean>;
}) {
  const active = overview.activeRelease;
  const [visibleSections, setVisibleSections] = useState<readonly DeckEnvironmentSection[]>(
    overview.visibleSections
  );
  const [displayMode, setDisplayMode] = useState<
    Exclude<DeckClassifierOverviewView['displayMode'], 'HIDDEN'>
  >(overview.displayMode === 'HIDDEN' ? 'BOTH' : overview.displayMode);
  const [topRankedPlayerCount, setTopRankedPlayerCount] = useState(
    String(overview.topRankedPlayerCount)
  );
  const parsedTopRankedPlayerCount = Number(topRankedPlayerCount);
  const displaySettingsValid =
    Number.isInteger(parsedTopRankedPlayerCount) &&
    parsedTopRankedPlayerCount >= 10 &&
    parsedTopRankedPlayerCount <= 100;
  const displaySummary =
    visibleSections.length === 0
      ? '完全不展示'
      : DISPLAY_SECTION_OPTIONS.filter((option) => visibleSections.includes(option.value))
          .map((option) => option.label)
          .join('、');
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Panel padding="compact">
        <h2 className="text-base font-semibold">玩家展示口径</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          展示内容可以任意组合；全部取消会即时隐藏整块卡组环境。高排名玩家构成固定采用玩家等权，不受基础计权方式影响。
        </p>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-[var(--text-secondary)]">
            展示内容
            <details className="relative mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)]">
              <summary className="flex h-11 cursor-pointer list-none items-center px-3 text-sm font-normal text-[var(--text-primary)]">
                <span className="truncate">{displaySummary}</span>
                <span className="ml-auto text-[var(--text-muted)]">⌄</span>
              </summary>
              <div className="absolute z-20 mt-1 w-full space-y-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 shadow-lg">
                {DISPLAY_SECTION_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 py-1.5 font-normal hover:bg-[var(--bg-overlay)]"
                  >
                    <input
                      type="checkbox"
                      checked={visibleSections.includes(option.value)}
                      disabled={busy}
                      onChange={(event) =>
                        setVisibleSections((current) =>
                          event.target.checked
                            ? [...current, option.value]
                            : current.filter((section) => section !== option.value)
                        )
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
                <button
                  type="button"
                  className="min-h-9 w-full rounded px-2 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--bg-overlay)]"
                  disabled={busy || visibleSections.length === 0}
                  onClick={() => setVisibleSections([])}
                >
                  全部取消（完全不展示）
                </button>
              </div>
            </details>
          </label>

          <label className="block text-sm font-semibold text-[var(--text-secondary)]">
            使用占比／胜者构成的基础计权
            <select
              className={`${CLASSIFIER_SELECT_CLASS} mt-2 w-full`}
              value={displayMode}
              disabled={busy}
              onChange={(event) =>
                setDisplayMode(
                  event.target.value as Exclude<DeckClassifierOverviewView['displayMode'], 'HIDDEN'>
                )
              }
            >
              <option value="PLAYER_EQUAL">仅玩家等权</option>
              <option value="MATCH_EQUAL">仅对局等权</option>
              <option value="BOTH">两者均显示</option>
            </select>
          </label>

          <label className="block text-sm font-semibold text-[var(--text-secondary)]">
            高排名人数
            <TextInput
              className="mt-2 w-full"
              type="number"
              min={10}
              max={100}
              value={topRankedPlayerCount}
              disabled={busy || !visibleSections.includes('TOP_RANKED')}
              invalid={!displaySettingsValid}
              onChange={(event) => setTopRankedPlayerCount(event.target.value)}
            />
          </label>

          <ActionButton
            size="compact"
            disabled={busy || reason.trim().length < 5 || !displaySettingsValid}
            onClick={() =>
              void onDisplaySettings({
                displayMode,
                visibleSections,
                topRankedPlayerCount: parsedTopRankedPlayerCount,
              })
            }
          >
            即时保存展示设置
          </ActionButton>
        </div>
      </Panel>

      <Panel padding="compact">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">当前发布版本</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {active ? `版本 ${active.version} · ${active.reason}` : '尚未发布分类版本'}
            </p>
          </div>
          <StatusBadge tone={active ? 'success' : 'warning'}>
            {active ? '服务中' : '未发布'}
          </StatusBadge>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton variant="secondary" size="compact" disabled={busy} onClick={onPreview}>
            <RefreshCw size={15} /> 全量预览
          </ActionButton>
          <ActionButton
            size="compact"
            disabled={busy || reason.trim().length < 5}
            onClick={() => void onPublish()}
          >
            <Rocket size={15} /> 发布新版本
          </ActionButton>
          <ActionButton
            variant="ghost"
            size="compact"
            disabled={busy || !active || reason.trim().length < 5}
            onClick={() => void onReclassify()}
          >
            <RotateCcw size={15} /> 重分类当前版本
          </ActionButton>
        </div>
      </Panel>

      {preview ? (
        <Panel padding="compact" className="lg:col-span-2">
          <h2 className="text-base font-semibold">草稿全量预览</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Metric label="唯一构筑" value={preview.uniqueFingerprintCount} />
            <Metric label="观察席位" value={preview.observationCount} />
            <Metric label="已识别" value={preview.classifiedCount} />
            <Metric label="未识别" value={preview.unknownCount} />
            <Metric label="冲突" value={preview.ambiguousCount} />
            <Metric label="非法" value={preview.invalidCount} />
            <Metric label="人工排除" value={preview.excludedCount} />
            <Metric label="变化席位" value={preview.changedCount} />
          </div>
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            识别覆盖 {(preview.coverageRate * 100).toFixed(1)}
            %。未识别和冲突会作为独立扇区进入玩家统计分母；人工排除不进入玩家统计。
          </p>
        </Panel>
      ) : null}

      <Panel padding="compact" className="lg:col-span-2">
        <h2 className="text-base font-semibold">最近分类任务</h2>
        <div className="mt-3 space-y-2">
          {overview.runs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">暂无分类任务</p>
          ) : (
            overview.runs.slice(0, 12).map((run) => (
              <div
                key={run.id}
                className="grid gap-1 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm sm:grid-cols-[auto_1fr_auto]"
              >
                <StatusBadge tone={runTone(run.status)}>{run.status}</StatusBadge>
                <span className="min-w-0 truncate">
                  版本 {run.releaseVersion} · {run.reason}
                </span>
                <span className="text-xs tabular-nums text-[var(--text-muted)]">
                  {run.processedCount}/{run.totalCount} · 变化 {run.changedCount}
                </span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function ArchetypesTab({
  form,
  setForm,
  archetypes,
  templates,
  busy,
  onSubmit,
  onSaveDisplay,
  onEdit,
  onArchive,
}: {
  form: ArchetypeFormState;
  setForm: (value: ArchetypeFormState) => void;
  archetypes: DeckClassifierOverviewView['archetypes'];
  templates: DeckClassifierOverviewView['templates'];
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
  onSaveDisplay: () => void;
  onEdit: (archetype: DeckClassifierArchetypeView) => void;
  onArchive: (archetype: DeckClassifierArchetypeView) => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const representativeCard = form.representativeCardCode
    ? cardDataRegistry.get(form.representativeCardCode)
    : undefined;
  const sampleBaseCodes = useMemo(
    () =>
      new Set(
        templates
          .filter((template) => template.archetypeId === form.editingId)
          .flatMap((template) => template.cards.map((card) => card.baseCardCode))
      ),
    [form.editingId, templates]
  );
  const representativeCardOptions = useMemo(
    () =>
      [...cardDataRegistry.values()]
        .filter((card) => card.cardType === 'MEMBER' || card.cardType === 'LIVE')
        .sort((left, right) => {
          const leftSuggested = sampleBaseCodes.has(getBaseCardCode(left.cardCode)) ? 0 : 1;
          const rightSuggested = sampleBaseCodes.has(getBaseCardCode(right.cardCode)) ? 0 : 1;
          return leftSuggested - rightSuggested || left.cardCode.localeCompare(right.cardCode);
        }),
    [cardDataRegistry, sampleBaseCodes]
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Panel padding="compact">
        <h2 className="text-base font-semibold">
          {form.editingId ? '编辑分类名称' : '新增分类名称'}
        </h2>
        <form className="mt-3 space-y-3" onSubmit={onSubmit}>
          <Field label="稳定 key">
            <TextInput
              value={form.archetypeKey}
              disabled={form.editingId !== null}
              onChange={(event) => setForm({ ...form, archetypeKey: event.target.value })}
              placeholder="niji_example"
              required
            />
          </Field>
          <Field label="玩家显示名">
            <TextInput
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </Field>
          <Field label="所属系列／分组">
            <TextInput
              value={form.groupName}
              onChange={(event) => setForm({ ...form, groupName: event.target.value })}
              required
            />
          </Field>
          <Field label="说明">
            <textarea
              className="input-field min-h-20 w-full"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <p className="rounded-lg bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-muted)]">
            {form.editingId
              ? '代表卡和颜色是独立展示设置；点击“即时保存展示”后玩家刷新即可看到，不进入分类草稿，也不触发重算。'
              : '新建分类时会一并建立初始展示设置；分类发布后仍可独立即时修改。'}
          </p>
          <Field label="代表卡牌（可选）">
            <TextInput
              list="deck-classifier-representative-cards"
              value={form.representativeCardCode}
              onChange={(event) =>
                setForm({ ...form, representativeCardCode: event.target.value.trim() })
              }
              placeholder="输入或选择精确卡号"
            />
            <datalist id="deck-classifier-representative-cards">
              {representativeCardOptions.map((card) => (
                <option key={card.cardCode} value={card.cardCode}>
                  {card.name}
                </option>
              ))}
            </datalist>
            {form.representativeCardCode ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--bg-overlay)] p-2">
                {representativeCard ? (
                  <img
                    src={resolveCardImagePath(representativeCard, 'thumb')}
                    alt=""
                    className="h-16 w-12 rounded object-cover object-top"
                  />
                ) : (
                  <span className="h-16 w-12 rounded bg-[var(--bg-surface)]" />
                )}
                <div className="min-w-0 text-xs">
                  <div className="truncate font-semibold">
                    {representativeCard?.name ?? '未找到此精确卡号'}
                  </div>
                  <div className="mt-0.5 truncate text-[var(--text-muted)]">
                    {form.representativeCardCode}
                  </div>
                  <div className="mt-1 text-[var(--text-muted)]">
                    优先选择样板中的关键卡；未设置时使用分类颜色。
                  </div>
                </div>
              </div>
            ) : null}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="颜色">
              <input
                className="input-field h-10 w-full"
                type="color"
                value={form.color}
                onChange={(event) => setForm({ ...form, color: event.target.value })}
              />
            </Field>
            <Field label="顺序">
              <TextInput
                type="number"
                value={form.sortOrder}
                onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
                required
              />
            </Field>
          </div>
          {form.editingId ? (
            <ActionButton
              type="button"
              variant="secondary"
              size="compact"
              disabled={busy}
              onClick={onSaveDisplay}
            >
              即时保存展示
            </ActionButton>
          ) : null}
          <div className="flex gap-2">
            <ActionButton type="submit" size="compact" disabled={busy}>
              {form.editingId ? <Pencil size={15} /> : <Plus size={15} />}
              {form.editingId ? '保存分类草稿' : '新增分类'}
            </ActionButton>
            {form.editingId ? (
              <ActionButton
                type="button"
                variant="ghost"
                size="compact"
                onClick={() => setForm(EMPTY_ARCHETYPE_FORM)}
              >
                取消
              </ActionButton>
            ) : null}
          </div>
        </form>
      </Panel>

      <Panel padding="compact">
        <h2 className="text-base font-semibold">分类目录</h2>
        <div className="mt-3 space-y-2">
          {archetypes.map((archetype) => (
            <div
              key={archetype.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] px-3 py-2"
            >
              {archetype.representativeCardCode &&
              cardDataRegistry.get(archetype.representativeCardCode) ? (
                <img
                  src={resolveCardImagePath(
                    cardDataRegistry.get(archetype.representativeCardCode),
                    'thumb'
                  )}
                  alt=""
                  className="h-12 w-9 rounded object-cover object-top"
                />
              ) : (
                <span className="h-9 w-9 rounded-lg" style={{ backgroundColor: archetype.color }} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{archetype.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {archetype.groupName} · {archetype.archetypeKey}
                  </span>
                  {archetype.lifecycle === 'ARCHIVED' ? <StatusBadge>已归档</StatusBadge> : null}
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {archetype.templateCount} 个样板 · {archetype.ruleCount} 条规则
                </p>
              </div>
              <ActionButton variant="ghost" size="compact" onClick={() => onEdit(archetype)}>
                <Pencil size={14} />
                编辑
              </ActionButton>
              {archetype.lifecycle === 'ACTIVE' ? (
                <ActionButton variant="ghost" size="compact" onClick={() => onArchive(archetype)}>
                  <Archive size={14} />
                  归档
                </ActionButton>
              ) : null}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

interface TemplateEditorState {
  readonly templateId: string;
  readonly archetypeId: string;
  readonly name: string;
  readonly sourceNote: string;
  readonly enabled: boolean;
  readonly cards: readonly DeckClassifierTemplateCardView[];
}

type TemplateSortMode = 'ARCHETYPE' | 'NAME' | 'UPDATED_DESC' | 'CREATED_DESC' | 'ENABLED';

function TemplatesTab({
  overview,
  activeArchetypes,
  busy,
  archetypeId,
  matchId,
  seat,
  name,
  note,
  onArchetypeId,
  onMatchId,
  onSeat,
  onName,
  onNote,
  onSubmit,
  onToggle,
  onDelete,
  onUpdate,
}: {
  overview: DeckClassifierOverviewView;
  activeArchetypes: readonly DeckClassifierArchetypeView[];
  busy: boolean;
  archetypeId: string;
  matchId: string;
  seat: 'FIRST' | 'SECOND';
  name: string;
  note: string;
  onArchetypeId: (value: string) => void;
  onMatchId: (value: string) => void;
  onSeat: (value: 'FIRST' | 'SECOND') => void;
  onName: (value: string) => void;
  onNote: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onToggle: (template: DeckClassifierOverviewView['templates'][number]) => Promise<boolean>;
  onDelete: (template: DeckClassifierOverviewView['templates'][number]) => void;
  onUpdate: (
    templateId: string,
    input: {
      readonly archetypeId: string;
      readonly name: string;
      readonly cards: readonly DeckClassifierTemplateCardView[];
      readonly sourceNote: string;
      readonly enabled: boolean;
    }
  ) => Promise<boolean>;
}) {
  const nameById = new Map(overview.archetypes.map((entry) => [entry.id, entry.name]));
  const cardDataByBaseCode = useCardDataByBaseCode();
  const [editor, setEditor] = useState<TemplateEditorState | null>(null);
  const [filterArchetypeId, setFilterArchetypeId] = useState('');
  const [filterCard, setFilterCard] = useState('');
  const [templateSortMode, setTemplateSortMode] = useState<TemplateSortMode>('ARCHETYPE');
  const archetypeById = useMemo(
    () => new Map(overview.archetypes.map((entry) => [entry.id, entry])),
    [overview.archetypes]
  );
  const visibleTemplates = useMemo(() => {
    const cardQuery = filterCard.trim().toLocaleLowerCase('zh-CN');
    return overview.templates
      .filter((template) => !filterArchetypeId || template.archetypeId === filterArchetypeId)
      .filter(
        (template) =>
          !cardQuery ||
          template.cards.some((card) => {
            const cardData = cardDataByBaseCode.get(card.baseCardCode);
            return (
              card.baseCardCode.toLocaleLowerCase('zh-CN').includes(cardQuery) ||
              cardData?.name.toLocaleLowerCase('zh-CN').includes(cardQuery)
            );
          })
      )
      .sort((left, right) => {
        if (templateSortMode === 'NAME') return left.name.localeCompare(right.name, 'zh-CN');
        if (templateSortMode === 'UPDATED_DESC') return right.updatedAt - left.updatedAt;
        if (templateSortMode === 'CREATED_DESC') return right.createdAt - left.createdAt;
        if (templateSortMode === 'ENABLED') {
          return (
            Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)
          );
        }
        const leftArchetype = archetypeById.get(left.archetypeId);
        const rightArchetype = archetypeById.get(right.archetypeId);
        return (
          (leftArchetype?.sortOrder ?? 0) - (rightArchetype?.sortOrder ?? 0) ||
          (leftArchetype?.groupName ?? '').localeCompare(
            rightArchetype?.groupName ?? '',
            'zh-CN'
          ) ||
          (leftArchetype?.name ?? '').localeCompare(rightArchetype?.name ?? '', 'zh-CN') ||
          left.name.localeCompare(right.name, 'zh-CN')
        );
      });
  }, [
    archetypeById,
    cardDataByBaseCode,
    filterArchetypeId,
    filterCard,
    overview.templates,
    templateSortMode,
  ]);
  const memberTotal =
    editor?.cards
      .filter((card) => card.cardType === 'MEMBER')
      .reduce((sum, card) => sum + card.count, 0) ?? 0;
  const liveTotal =
    editor?.cards
      .filter((card) => card.cardType === 'LIVE')
      .reduce((sum, card) => sum + card.count, 0) ?? 0;
  const beginEdit = (template: DeckClassifierOverviewView['templates'][number]) =>
    setEditor({
      templateId: template.id,
      archetypeId: template.archetypeId,
      name: template.name,
      sourceNote: template.sourceNote,
      enabled: template.enabled,
      cards: template.cards.map((card) => ({ ...card })),
    });
  const updateCard = (index: number, patch: Partial<DeckClassifierTemplateCardView>) =>
    setEditor((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((card, cardIndex) =>
              cardIndex === index ? { ...card, ...patch } : card
            ),
          }
        : current
    );
  return (
    <div className="space-y-4">
      <Panel padding="compact">
        <h2 className="text-base font-semibold">从排位对局导入样板</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          服务端会按对局 ID 和席位读取不可变的长期卡组观察，不接受浏览器回传卡表。
        </p>
        <form className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-5" onSubmit={onSubmit}>
          <Field label="归入分类">
            <ArchetypeSelect
              value={archetypeId}
              archetypes={activeArchetypes}
              onChange={onArchetypeId}
            />
          </Field>
          <Field label="对局 ID">
            <TextInput
              value={matchId}
              onChange={(event) => onMatchId(event.target.value)}
              required
            />
          </Field>
          <Field label="席位">
            <select
              className={`${CLASSIFIER_SELECT_CLASS} w-full`}
              value={seat}
              onChange={(event) => onSeat(event.target.value as 'FIRST' | 'SECOND')}
            >
              <option value="FIRST">FIRST</option>
              <option value="SECOND">SECOND</option>
            </select>
          </Field>
          <Field label="样板名称">
            <TextInput value={name} onChange={(event) => onName(event.target.value)} required />
          </Field>
          <Field label="来源备注">
            <TextInput value={note} onChange={(event) => onNote(event.target.value)} />
          </Field>
          <div className="md:col-span-2 lg:col-span-5">
            <ActionButton type="submit" size="compact" disabled={busy || !archetypeId}>
              <Plus size={15} />
              导入样板
            </ActionButton>
          </div>
        </form>
      </Panel>
      <Panel padding="compact">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              样板列表（{visibleTemplates.length}/{overview.templates.length}）
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              查看或编辑会展开完整卡表；保存后需重新预览并发布，才会替换玩家正在使用的分类版本。
            </p>
          </div>
          <ActionButton
            type="button"
            variant="ghost"
            size="compact"
            disabled={!filterArchetypeId && !filterCard}
            onClick={() => {
              setFilterArchetypeId('');
              setFilterCard('');
            }}
          >
            清除筛选
          </ActionButton>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field label="卡组分类">
            <select
              className={`${CLASSIFIER_SELECT_CLASS} w-full`}
              value={filterArchetypeId}
              onChange={(event) => setFilterArchetypeId(event.target.value)}
            >
              <option value="">全部分类</option>
              {overview.archetypes.map((archetype) => (
                <option key={archetype.id} value={archetype.id}>
                  {archetype.groupName} · {archetype.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="包含卡牌">
            <TextInput
              value={filterCard}
              onChange={(event) => setFilterCard(event.target.value)}
              placeholder="输入基础卡号或卡名"
            />
          </Field>
          <Field label="排序">
            <select
              className={`${CLASSIFIER_SELECT_CLASS} w-full`}
              value={templateSortMode}
              onChange={(event) => setTemplateSortMode(event.target.value as TemplateSortMode)}
            >
              <option value="ARCHETYPE">卡组分类、样板名称</option>
              <option value="NAME">样板名称</option>
              <option value="UPDATED_DESC">最近修改</option>
              <option value="CREATED_DESC">最近创建</option>
              <option value="ENABLED">启用状态</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 space-y-2">
          {visibleTemplates.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              没有符合当前筛选条件的样板
            </p>
          ) : null}
          {visibleTemplates.map((template) => {
            const isEditing = editor?.templateId === template.id;
            return (
              <div
                key={template.id}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold">{template.name}</span>
                  <StatusBadge tone={template.enabled ? 'success' : 'neutral'}>
                    {template.enabled ? '启用' : '停用'}
                  </StatusBadge>
                  <span className="truncate text-xs text-[var(--text-muted)]">
                    {nameById.get(template.archetypeId) ?? template.archetypeId} ·{' '}
                    {templateSourceLabel(template.sourceKind)} · {template.cards.length} 种卡
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1">
                    <ActionButton
                      variant="ghost"
                      size="compact"
                      disabled={busy}
                      onClick={() => (isEditing ? setEditor(null) : beginEdit(template))}
                    >
                      <Pencil size={14} />
                      {isEditing ? '收起' : '查看/编辑'}
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      size="compact"
                      disabled={busy || isEditing}
                      onClick={() => void onToggle(template)}
                    >
                      {template.enabled ? '停用' : '启用'}
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      size="compact"
                      disabled={busy}
                      onClick={() => onDelete(template)}
                    >
                      <Trash2 size={14} />
                      删除
                    </ActionButton>
                  </div>
                </div>
                {isEditing && editor ? (
                  <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                      <Field label="样板名称">
                        <TextInput
                          value={editor.name}
                          onChange={(event) =>
                            setEditor((current) =>
                              current ? { ...current, name: event.target.value } : current
                            )
                          }
                        />
                      </Field>
                      <Field label="归入分类">
                        <ArchetypeSelect
                          value={editor.archetypeId}
                          archetypes={activeArchetypes}
                          onChange={(value) =>
                            setEditor((current) =>
                              current ? { ...current, archetypeId: value } : current
                            )
                          }
                        />
                      </Field>
                      <Field label="来源备注">
                        <TextInput
                          value={editor.sourceNote}
                          onChange={(event) =>
                            setEditor((current) =>
                              current ? { ...current, sourceNote: event.target.value } : current
                            )
                          }
                        />
                      </Field>
                      <label className="flex items-end gap-2 pb-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editor.enabled}
                          onChange={(event) =>
                            setEditor((current) =>
                              current ? { ...current, enabled: event.target.checked } : current
                            )
                          }
                        />
                        启用样板
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge tone={memberTotal === 48 ? 'success' : 'warning'}>
                        MEMBER {memberTotal}/48
                      </StatusBadge>
                      <StatusBadge tone={liveTotal === 12 ? 'success' : 'warning'}>
                        LIVE {liveTotal}/12
                      </StatusBadge>
                      <span className="text-[var(--text-muted)]">
                        相同基础编号会在服务端合并；卡组必须合计 60 张。
                      </span>
                    </div>
                    <div className="mt-2 max-h-80 space-y-1 overflow-auto pr-1">
                      {editor.cards.map((card, index) => {
                        const cardData = cardDataByBaseCode.get(card.baseCardCode.trim());
                        return (
                          <div
                            key={`${card.cardType}-${card.baseCardCode}-${index}`}
                            className="grid grid-cols-[2.25rem_7rem_minmax(0,1fr)_5rem_auto] items-center gap-2"
                          >
                            {cardData ? (
                              <img
                                src={resolveCardImagePath(cardData, 'thumb')}
                                alt=""
                                loading="lazy"
                                className="h-12 w-9 rounded object-cover object-top"
                              />
                            ) : (
                              <span className="h-12 w-9 rounded bg-[var(--bg-overlay)]" />
                            )}
                            <select
                              className={`${CLASSIFIER_SELECT_CLASS} w-full`}
                              value={card.cardType}
                              onChange={(event) =>
                                updateCard(index, {
                                  cardType: event.target.value as 'MEMBER' | 'LIVE',
                                })
                              }
                            >
                              <option value="MEMBER">MEMBER</option>
                              <option value="LIVE">LIVE</option>
                            </select>
                            <div className="min-w-0">
                              <TextInput
                                className="w-full"
                                value={card.baseCardCode}
                                aria-label={`第 ${index + 1} 项基础卡号`}
                                onChange={(event) =>
                                  updateCard(index, { baseCardCode: event.target.value })
                                }
                              />
                              <p
                                className={`mt-0.5 truncate text-[10px] ${cardData ? 'text-[var(--text-muted)]' : 'text-[var(--semantic-warning)]'}`}
                              >
                                {cardData?.name ?? '未在当前卡牌库找到该基础卡号'}
                              </p>
                            </div>
                            <TextInput
                              type="number"
                              min={1}
                              max={60}
                              value={card.count}
                              aria-label={`第 ${index + 1} 项数量`}
                              onChange={(event) =>
                                updateCard(index, { count: Number(event.target.value) })
                              }
                            />
                            <ActionButton
                              type="button"
                              variant="ghost"
                              size="compact"
                              onClick={() =>
                                setEditor((current) =>
                                  current
                                    ? {
                                        ...current,
                                        cards: current.cards.filter(
                                          (_entry, cardIndex) => cardIndex !== index
                                        ),
                                      }
                                    : current
                                )
                              }
                            >
                              <Trash2 size={14} />
                            </ActionButton>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(['MEMBER', 'LIVE'] as const).map((cardType) => (
                        <ActionButton
                          key={cardType}
                          type="button"
                          variant="ghost"
                          size="compact"
                          onClick={() =>
                            setEditor((current) =>
                              current
                                ? {
                                    ...current,
                                    cards: [
                                      ...current.cards,
                                      { baseCardCode: '', cardType, count: 1 },
                                    ],
                                  }
                                : current
                            )
                          }
                        >
                          <Plus size={14} /> 添加 {cardType}
                        </ActionButton>
                      ))}
                      <ActionButton
                        type="button"
                        size="compact"
                        disabled={
                          busy ||
                          memberTotal !== 48 ||
                          liveTotal !== 12 ||
                          !editor.name.trim() ||
                          !editor.archetypeId ||
                          editor.cards.some(
                            (card) => !card.baseCardCode.trim() || !Number.isInteger(card.count)
                          )
                        }
                        onClick={async () => {
                          const completed = await onUpdate(editor.templateId, {
                            archetypeId: editor.archetypeId,
                            name: editor.name,
                            cards: editor.cards,
                            sourceNote: editor.sourceNote,
                            enabled: editor.enabled,
                          });
                          if (completed) setEditor(null);
                        }}
                      >
                        <Pencil size={14} /> 保存到草稿
                      </ActionButton>
                      <ActionButton
                        type="button"
                        variant="ghost"
                        size="compact"
                        onClick={() => setEditor(null)}
                      >
                        取消
                      </ActionButton>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function RulesTab({
  overview,
  activeArchetypes,
  busy,
  editingRuleId,
  archetypeId,
  name,
  priority,
  definitionJson,
  editorMode,
  commonConditions,
  enabled,
  onArchetypeId,
  onName,
  onPriority,
  onDefinitionJson,
  onEditorMode,
  onCommonConditions,
  onEnabled,
  onSubmit,
  onCancel,
  onEdit,
  onDelete,
}: {
  overview: DeckClassifierOverviewView;
  activeArchetypes: readonly DeckClassifierArchetypeView[];
  busy: boolean;
  editingRuleId: string | null;
  archetypeId: string;
  name: string;
  priority: string;
  definitionJson: string;
  editorMode: 'COMMON' | 'JSON';
  commonConditions: readonly CommonRuleCondition[];
  enabled: boolean;
  onArchetypeId: (value: string) => void;
  onName: (value: string) => void;
  onPriority: (value: string) => void;
  onDefinitionJson: (value: string) => void;
  onEditorMode: (value: 'COMMON' | 'JSON') => void;
  onCommonConditions: (value: readonly CommonRuleCondition[]) => void;
  onEnabled: (value: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  onEdit: (rule: DeckClassifierOverviewView['rules'][number]) => void;
  onDelete: (rule: DeckClassifierOverviewView['rules'][number]) => void;
}) {
  const nameById = new Map(overview.archetypes.map((entry) => [entry.id, entry.name]));
  const updateCommonCondition = (index: number, patch: Partial<CommonRuleCondition>) =>
    onCommonConditions(
      commonConditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition
      )
    );
  return (
    <div className="grid gap-4 lg:grid-cols-[34rem_1fr]">
      <Panel padding="compact">
        <h2 className="text-base font-semibold">
          {editingRuleId ? '编辑识别规则' : '新增识别规则'}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          常用条件可直接填写卡号和数量；高级 JSON 仍只接受受限结构，不会执行脚本或 SQL。
          数字越小优先级越高。保存后需重新发布才会影响玩家分类。
        </p>
        <form className="mt-3 space-y-3" onSubmit={onSubmit}>
          <Field label="归入分类">
            <ArchetypeSelect
              value={archetypeId}
              archetypes={activeArchetypes}
              onChange={onArchetypeId}
            />
          </Field>
          <Field label="规则名称">
            <TextInput value={name} onChange={(event) => onName(event.target.value)} required />
          </Field>
          <Field label="优先级">
            <TextInput
              type="number"
              min={0}
              value={priority}
              onChange={(event) => onPriority(event.target.value)}
              required
            />
          </Field>
          <div>
            <div className="flex gap-1 rounded-lg bg-[var(--bg-overlay)] p-1">
              <button
                type="button"
                className={`flex-1 rounded px-2 py-1.5 text-xs ${editorMode === 'COMMON' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--text-muted)]'}`}
                onClick={() => onEditorMode('COMMON')}
              >
                常用条件
              </button>
              <button
                type="button"
                className={`flex-1 rounded px-2 py-1.5 text-xs ${editorMode === 'JSON' ? 'bg-[var(--bg-surface)] font-semibold shadow-sm' : 'text-[var(--text-muted)]'}`}
                onClick={() => onEditorMode('JSON')}
              >
                高级 JSON
              </button>
            </div>
            {editorMode === 'COMMON' ? (
              <div className="mt-2 space-y-2">
                {commonConditions.map((condition, index) => (
                  <div key={index} className="rounded-lg border border-[var(--border-subtle)] p-2">
                    <div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2">
                      <select
                        className={`${CLASSIFIER_SELECT_CLASS} w-full`}
                        value={condition.kind}
                        onChange={(event) => {
                          const kind = event.target.value as CommonRuleCondition['kind'];
                          updateCommonCondition(index, {
                            kind,
                            minCount: kind === 'FORBID_CARD' ? '' : condition.minCount || '1',
                            maxCount: kind === 'FORBID_CARD' ? '' : condition.maxCount,
                          });
                        }}
                      >
                        <option value="CARD_COUNT">单张卡数量</option>
                        <option value="COUNT_SUM">多张卡合计</option>
                        <option value="FORBID_CARD">不得包含某卡</option>
                      </select>
                      <select
                        className={`${CLASSIFIER_SELECT_CLASS} w-full`}
                        value={condition.cardType}
                        onChange={(event) =>
                          updateCommonCondition(index, {
                            cardType: event.target.value as CommonRuleCondition['cardType'],
                          })
                        }
                      >
                        <option value="">任意类型</option>
                        <option value="MEMBER">MEMBER</option>
                        <option value="LIVE">LIVE</option>
                      </select>
                      <ActionButton
                        type="button"
                        variant="ghost"
                        size="compact"
                        onClick={() =>
                          onCommonConditions(
                            commonConditions.filter(
                              (_entry, conditionIndex) => conditionIndex !== index
                            )
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </ActionButton>
                    </div>
                    <TextInput
                      className="mt-2 w-full"
                      value={condition.cardCodes}
                      placeholder={
                        condition.kind === 'COUNT_SUM'
                          ? '多张基础卡号，用逗号或空格分隔'
                          : '基础卡号，例如 PL!-bp4-021'
                      }
                      onChange={(event) =>
                        updateCommonCondition(index, { cardCodes: event.target.value })
                      }
                    />
                    {condition.kind !== 'FORBID_CARD' ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Field label="最少张数（≥）">
                          <TextInput
                            type="number"
                            min={0}
                            max={60}
                            value={condition.minCount}
                            onChange={(event) =>
                              updateCommonCondition(index, { minCount: event.target.value })
                            }
                          />
                        </Field>
                        <Field label="最多张数（≤，可空）">
                          <TextInput
                            type="number"
                            min={0}
                            max={60}
                            value={condition.maxCount}
                            onChange={(event) =>
                              updateCommonCondition(index, { maxCount: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ['CARD_COUNT', '添加单卡条件'],
                      ['COUNT_SUM', '添加合计条件'],
                      ['FORBID_CARD', '添加禁止条件'],
                    ] as const
                  ).map(([kind, label]) => (
                    <ActionButton
                      key={kind}
                      type="button"
                      variant="ghost"
                      size="compact"
                      onClick={() =>
                        onCommonConditions([
                          ...commonConditions,
                          {
                            ...DEFAULT_COMMON_RULE_CONDITION,
                            kind,
                            minCount: kind === 'FORBID_CARD' ? '' : '1',
                          },
                        ])
                      }
                    >
                      <Plus size={14} /> {label}
                    </ActionButton>
                  ))}
                </div>
              </div>
            ) : (
              <Field label="结构化条件 JSON">
                <textarea
                  className="input-field mt-2 min-h-64 w-full font-mono text-xs"
                  value={definitionJson}
                  onChange={(event) => onDefinitionJson(event.target.value)}
                  spellCheck={false}
                />
              </Field>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onEnabled(event.target.checked)}
            />
            启用规则
          </label>
          <div className="flex gap-2">
            <ActionButton type="submit" size="compact" disabled={busy || !archetypeId}>
              {editingRuleId ? <Pencil size={15} /> : <Plus size={15} />}
              {editingRuleId ? '保存规则' : '新增规则'}
            </ActionButton>
            {editingRuleId ? (
              <ActionButton type="button" variant="ghost" size="compact" onClick={onCancel}>
                取消
              </ActionButton>
            ) : null}
          </div>
        </form>
      </Panel>
      <Panel padding="compact">
        <h2 className="text-base font-semibold">规则列表（{overview.rules.length}）</h2>
        <div className="mt-3 space-y-2">
          {overview.rules.map((rule) => {
            const descriptions = describeRuleDefinition(rule.definition);
            return (
              <div
                key={rule.id}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{rule.name}</span>
                  <StatusBadge tone={rule.enabled ? 'success' : 'neutral'}>
                    {rule.enabled ? '启用' : '停用'}
                  </StatusBadge>
                  <span className="text-xs text-[var(--text-muted)]">
                    优先级 {rule.priority} · {nameById.get(rule.archetypeId) ?? rule.archetypeId}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <ActionButton variant="ghost" size="compact" onClick={() => onEdit(rule)}>
                      <Pencil size={14} />
                      编辑
                    </ActionButton>
                    <ActionButton variant="ghost" size="compact" onClick={() => onDelete(rule)}>
                      <Trash2 size={14} />
                      删除
                    </ActionButton>
                  </div>
                </div>
                {descriptions ? (
                  <ul className="mt-2 space-y-1 rounded bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-muted)]">
                    {descriptions.map((description, index) => (
                      <li key={index}>• {description}</li>
                    ))}
                  </ul>
                ) : (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--bg-overlay)] p-2 text-xs text-[var(--text-muted)]">
                    {JSON.stringify(rule.definition, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function ReviewTab({
  overview,
  activeArchetypes,
  busy,
  choices,
  onChoice,
  onOverride,
  onAddTemplate,
  onRevoke,
}: {
  overview: DeckClassifierOverviewView;
  activeArchetypes: readonly DeckClassifierArchetypeView[];
  busy: boolean;
  choices: Readonly<Record<string, string>>;
  onChoice: (fingerprint: string, value: string) => void;
  onOverride: (
    fingerprint: string,
    status: 'CLASSIFIED' | 'UNKNOWN' | 'EXCLUDED',
    archetypeId: string | null
  ) => Promise<boolean>;
  onAddTemplate: (
    fingerprint: string,
    archetypeId: string,
    name: string,
    sourceNote: string
  ) => Promise<boolean>;
  onRevoke: (overrideId: string) => Promise<boolean>;
}) {
  const nameById = new Map(overview.archetypes.map((entry) => [entry.id, entry.name]));
  const templateFingerprints = new Set(
    overview.templates.map((template) => template.deckFingerprint)
  );
  return (
    <div className="space-y-4">
      <Panel padding="compact">
        <h2 className="text-base font-semibold">
          未识别与冲突队列（{overview.reviewQueue.length}）
        </h2>
        <div className="mt-3 space-y-3">
          {overview.reviewQueue.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">当前没有待复核构筑</p>
          ) : (
            overview.reviewQueue.map((item) => {
              const choice = choices[item.deckFingerprint] ?? '';
              const alreadyInTemplateLibrary = templateFingerprints.has(item.deckFingerprint);
              return (
                <div
                  key={item.deckFingerprint}
                  className="rounded-lg border border-[var(--border-subtle)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={item.status === 'AMBIGUOUS' ? 'warning' : 'neutral'}>
                      {item.status}
                    </StatusBadge>
                    <span className="ml-auto text-xs text-[var(--text-muted)]">
                      {item.occurrenceCount} 次 · {item.playerCount} 名玩家 · {item.seasonCount}{' '}
                      个赛季
                    </span>
                  </div>
                  <ClassifierDeckComposition cards={item.cards} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ArchetypeSelect
                      value={choice}
                      archetypes={activeArchetypes}
                      onChange={(value) => onChoice(item.deckFingerprint, value)}
                      allowEmpty
                    />
                    <ActionButton
                      size="compact"
                      disabled={busy || !choice}
                      onClick={() =>
                        void onOverride(item.deckFingerprint, 'CLASSIFIED', choice || null)
                      }
                    >
                      人工归类
                    </ActionButton>
                    <ActionButton
                      variant="secondary"
                      size="compact"
                      disabled={busy || !choice || alreadyInTemplateLibrary}
                      onClick={() =>
                        void onAddTemplate(
                          item.deckFingerprint,
                          choice,
                          `${nameById.get(choice) ?? '未命名分类'} · 待处理导入`,
                          `从待处理队列导入；历史出现 ${item.occurrenceCount} 次，涉及 ${item.playerCount} 名玩家、${item.seasonCount} 个赛季`
                        )
                      }
                    >
                      {alreadyInTemplateLibrary ? '已在样板库' : '加入样板库'}
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      size="compact"
                      disabled={busy}
                      onClick={() => void onOverride(item.deckFingerprint, 'UNKNOWN', null)}
                    >
                      保持未识别
                    </ActionButton>
                    <ActionButton
                      variant="ghost"
                      size="compact"
                      disabled={busy}
                      onClick={() => void onOverride(item.deckFingerprint, 'EXCLUDED', null)}
                    >
                      标记异常并排除
                    </ActionButton>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Panel>
      <Panel padding="compact">
        <h2 className="text-base font-semibold">生效中的人工锁定（{overview.overrides.length}）</h2>
        <div className="mt-3 space-y-2">
          {overview.overrides.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">暂无人工锁定</p>
          ) : (
            overview.overrides.map((override) => (
              <div
                key={override.id}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge>{override.targetStatus}</StatusBadge>
                  <span>
                    {override.archetypeId
                      ? (nameById.get(override.archetypeId) ?? override.archetypeId)
                      : '不指定分类'}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">{override.reason}</span>
                  <ActionButton
                    className="ml-auto"
                    variant="ghost"
                    size="compact"
                    disabled={busy}
                    onClick={() => void onRevoke(override.id)}
                  >
                    <RotateCcw size={14} />
                    撤销锁定
                  </ActionButton>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">
                    查看卡组构成
                  </summary>
                  <ClassifierDeckComposition cards={override.cards} />
                </details>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function ClassifierDeckComposition({
  cards,
}: {
  cards: readonly DeckClassifierTemplateCardView[];
}) {
  const cardDataByBaseCode = useCardDataByBaseCode();
  const groups = (['MEMBER', 'LIVE'] as const).map((cardType) => ({
    cardType,
    cards: cards
      .filter((card) => card.cardType === cardType)
      .sort((left, right) => left.baseCardCode.localeCompare(right.baseCardCode)),
  }));
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-2">
      {groups.map((group) => (
        <section key={group.cardType}>
          <div className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
            {group.cardType} · {group.cards.reduce((sum, card) => sum + card.count, 0)} 张／
            {group.cards.length} 种
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {group.cards.map((card) => {
              const cardData = cardDataByBaseCode.get(card.baseCardCode);
              return (
                <div
                  key={`${group.cardType}-${card.baseCardCode}`}
                  className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-[var(--bg-overlay)] p-1.5"
                >
                  {cardData ? (
                    <img
                      src={resolveCardImagePath(cardData, 'thumb')}
                      alt=""
                      loading="lazy"
                      className="h-12 w-9 rounded object-cover object-top"
                    />
                  ) : (
                    <span className="h-12 w-9 rounded bg-[var(--bg-surface)]" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">
                      {cardData?.name ?? '未知卡牌'}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
                      {card.baseCardCode}
                    </div>
                  </div>
                  <span className="pr-1 text-xs font-semibold tabular-nums">×{card.count}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function useCardDataByBaseCode(): ReadonlyMap<string, AnyCardData> {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  return useMemo(() => {
    const result = new Map<string, AnyCardData>();
    for (const card of cardDataRegistry.values()) {
      const baseCardCode = getBaseCardCode(card.cardCode);
      if (!result.has(baseCardCode)) result.set(baseCardCode, card);
    }
    return result;
  }, [cardDataRegistry]);
}

function ArchetypeSelect({
  value,
  archetypes,
  onChange,
  allowEmpty = false,
}: {
  value: string;
  archetypes: readonly DeckClassifierArchetypeView[];
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select
      className={`${CLASSIFIER_SELECT_CLASS} min-w-44 w-full`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={!allowEmpty}
    >
      {allowEmpty ? <option value="">选择分类…</option> : null}
      {archetypes.map((archetype) => (
        <option key={archetype.id} value={archetype.id}>
          {archetype.groupName} · {archetype.name}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-[var(--text-secondary)]">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return (
    <p
      className={`mb-4 rounded-xl px-3 py-2 text-sm ${tone === 'error' ? 'bg-[var(--semantic-error)]/10 text-[var(--semantic-error)]' : 'bg-[var(--semantic-success)]/10 text-[var(--semantic-success)]'}`}
    >
      {children}
    </p>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] p-3">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function runTone(
  status: DeckClassifierOverviewView['runs'][number]['status']
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'RUNNING') return 'info';
  return 'warning';
}

function templateSourceLabel(
  sourceKind: DeckClassifierOverviewView['templates'][number]['sourceKind']
): string {
  if (sourceKind === 'MATCH_OBSERVATION') return '排位对局导入';
  if (sourceKind === 'SEED_PACKAGE') return '初始样板包';
  return '手动维护';
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}
