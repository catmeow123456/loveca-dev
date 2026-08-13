import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Ban,
  CalendarClock,
  Copy,
  FileClock,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { ActionButton, Panel, SectionHeading, StatusBadge, TextInput } from '@/components/common';
import { AdminPageHeader } from './AdminPageHeader';
import { useKeyedState } from '@/hooks/useKeyedState';
import {
  cancelAdminDeckPointTableSchedule,
  copyAdminDeckPointTableToDraft,
  createAdminDeckPointTableDraft,
  deleteAdminDeckPointTable,
  discardAdminDeckPointTable,
  fetchAdminDeckPointTables,
  previewAdminDeckPointTableDiff,
  publishAdminDeckPointTable,
  updateAdminDeckPointTable,
  type AdminDeckPointTable,
  type DeckPointTableDiffPreview,
  type DeckPointTableEntryView,
  type DeckPointTableLifecycle,
} from '@/lib/deckPointTableAdminClient';
import { useDeckPointTableStore } from '@/store/deckPointTableStore';
import {
  buildDeckPointTableInput,
  formatBeijingDateTime,
  groupDeckPointTables,
  makeCopyDraftDefaults,
  requireEffectiveDateTime,
  sortDeckPointTableEntries,
  toDeckPointTableForm,
  type DeckPointTableForm,
} from './deck-point-table-model';

const EMPTY_FORM: DeckPointTableForm = {
  version: '',
  displayName: '',
  pointLimit: '9',
  effectiveDateTime: '',
  entries: [],
};

const LIFECYCLE_LABELS: Record<DeckPointTableLifecycle, string> = {
  DRAFT: '草稿',
  SCHEDULED: '已排期',
  ACTIVE: '当前生效',
  RETIRED: '历史版本',
};

const LIFECYCLE_TONES: Record<DeckPointTableLifecycle, 'neutral' | 'success' | 'warning' | 'info'> =
  {
    DRAFT: 'neutral',
    SCHEDULED: 'warning',
    ACTIVE: 'success',
    RETIRED: 'info',
  };

export function DeckPointTablesAdminPage({ onBack }: { onBack: () => void }) {
  const [tables, setTables] = useState<AdminDeckPointTable[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffPreview, setDiffPreview] = useState<DeckPointTableDiffPreview | null>(null);
  const [copySource, setCopySource] = useState<AdminDeckPointTable | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [replacementTableId, setReplacementTableId] = useState('');

  const groups = useMemo(() => groupDeckPointTables(tables), [tables]);
  const selectedTable =
    tables.find((table) => table.id === selectedTableId) ?? groups.active ?? tables[0] ?? null;
  const initialForm = selectedTable ? toDeckPointTableForm(selectedTable) : EMPTY_FORM;
  const [form, setForm] = useKeyedState<DeckPointTableForm>(
    selectedTable ? `${selectedTable.id}:${selectedTable.revision}` : 'none',
    initialForm
  );
  const [scheduleEffectiveDateTime, setScheduleEffectiveDateTime] = useKeyedState(
    selectedTable?.id ?? 'none',
    defaultScheduleDateTime()
  );
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);
  const replacementCandidates = tables.filter((table) => table.id !== selectedTable?.id);

  const loadTables = useCallback(async (preferredTableId?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const nextTables = await fetchAdminDeckPointTables();
      setTables(nextTables);
      setSelectedTableId((current) => {
        const preferred = preferredTableId ?? current;
        if (preferred && nextTables.some((table) => table.id === preferred)) return preferred;
        return (
          nextTables.find((table) => table.lifecycle === 'ACTIVE')?.id ?? nextTables[0]?.id ?? null
        );
      });
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTables(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTables]);

  const selectTable = (table: AdminDeckPointTable) => {
    if (isDirty && !window.confirm('切换后将放弃当前未保存的修改，是否继续？')) return;
    setSelectedTableId(table.id);
    setDiffPreview(null);
    setReplacementTableId('');
    setError(null);
  };

  const runTableMutation = async (
    operation: () => Promise<AdminDeckPointTable>,
    options: { refreshPublic?: boolean } = {}
  ) => {
    setIsWorking(true);
    setError(null);
    try {
      const result = await operation();
      setDiffPreview(null);
      await loadTables(result.id);
      if (options.refreshPublic) await useDeckPointTableStore.getState().refresh();
      return true;
    } catch (operationError) {
      setError(readError(operationError));
      return false;
    } finally {
      setIsWorking(false);
    }
  };

  const saveTable = async () => {
    if (!selectedTable) return;
    try {
      const input = buildDeckPointTableInput(form);
      const effectiveDateTime =
        selectedTable.lifecycle === 'DRAFT' || !form.effectiveDateTime.trim()
          ? undefined
          : requireEffectiveDateTime(form);
      await runTableMutation(
        () =>
          updateAdminDeckPointTable(selectedTable.id, {
            ...input,
            ...(effectiveDateTime ? { effectiveDateTime } : {}),
            expectedRevision: selectedTable.revision,
          }),
        {
          refreshPublic:
            selectedTable.lifecycle === 'ACTIVE' || selectedTable.lifecycle === 'SCHEDULED',
        }
      );
    } catch (validationError) {
      setError(readError(validationError));
    }
  };

  const previewDiff = async () => {
    if (!selectedTable || selectedTable.lifecycle !== 'DRAFT' || isDirty) return;
    setIsWorking(true);
    setError(null);
    try {
      setDiffPreview(await previewAdminDeckPointTableDiff(selectedTable.id));
    } catch (previewError) {
      setError(readError(previewError));
    } finally {
      setIsWorking(false);
    }
  };

  const publishImmediately = async () => {
    if (!selectedTable || selectedTable.lifecycle !== 'DRAFT' || isDirty || !diffPreview) return;
    if (!window.confirm(`确定立即发布“${selectedTable.displayName}”并原子替换当前PT限制表吗？`))
      return;
    await runTableMutation(
      () =>
        publishAdminDeckPointTable(selectedTable.id, {
          mode: 'IMMEDIATE',
          expectedRevision: selectedTable.revision,
          expectedActiveTableId: diffPreview.activeTable.id,
        }),
      { refreshPublic: true }
    );
  };

  const publishScheduled = async () => {
    if (!selectedTable || selectedTable.lifecycle !== 'DRAFT' || isDirty || !diffPreview) return;
    let effectiveDateTime: string;
    try {
      effectiveDateTime = requireEffectiveDateTime({
        ...form,
        effectiveDateTime: scheduleEffectiveDateTime,
      });
    } catch (validationError) {
      setError(readError(validationError));
      return;
    }
    if (
      !window.confirm(
        `确定安排“${selectedTable.displayName}”于 ${effectiveDateTime}（北京时间）生效吗？`
      )
    )
      return;
    await runTableMutation(
      () =>
        publishAdminDeckPointTable(selectedTable.id, {
          mode: 'SCHEDULED',
          effectiveDateTime,
          expectedRevision: selectedTable.revision,
          expectedActiveTableId: diffPreview.activeTable.id,
        }),
      { refreshPublic: true }
    );
  };

  const discardTable = async () => {
    if (!selectedTable || selectedTable.lifecycle === 'RETIRED') return;
    if (selectedTable.lifecycle === 'ACTIVE') {
      const replacement = replacementCandidates.find((table) => table.id === replacementTableId);
      if (!replacement) {
        setError('请先选择接替的PT限制表');
        return;
      }
      if (
        !window.confirm(
          `确定废弃当前表“${selectedTable.displayName}”，并在同一事务中将“${replacement.displayName}”切换为新的当前表吗？系统不会出现无 ACTIVE 表的窗口。`
        )
      )
        return;
      await runTableMutation(
        () =>
          discardAdminDeckPointTable(selectedTable.id, {
            expectedRevision: selectedTable.revision,
            replacementTableId: replacement.id,
            replacementExpectedRevision: replacement.revision,
          }),
        { refreshPublic: true }
      );
      return;
    }
    if (!window.confirm(`确定废弃“${selectedTable.displayName}”吗？它将作为历史版本保留。`)) return;
    await runTableMutation(() =>
      discardAdminDeckPointTable(selectedTable.id, { expectedRevision: selectedTable.revision })
    );
  };

  const cancelSchedule = async () => {
    if (!selectedTable || selectedTable.lifecycle !== 'SCHEDULED') return;
    if (
      !window.confirm(
        `确定取消“${selectedTable.displayName}”的生效排期吗？它将转为历史版本并记录为“已取消排期”。`
      )
    ) {
      return;
    }
    await runTableMutation(() =>
      cancelAdminDeckPointTableSchedule(selectedTable.id, selectedTable.revision)
    );
  };

  const deleteTable = async () => {
    if (!selectedTable || selectedTable.lifecycle !== 'RETIRED') return;
    if (!window.confirm(`确定永久删除历史表“${selectedTable.displayName}”吗？此操作不可恢复。`))
      return;
    setIsWorking(true);
    setError(null);
    try {
      await deleteAdminDeckPointTable(selectedTable.id, selectedTable.revision);
      setDiffPreview(null);
      await loadTables();
    } catch (operationError) {
      setError(readError(operationError));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="app-shell min-h-screen">
      <AdminPageHeader
        title="卡组规则管理"
        category="卡牌与规则"
        onBack={onBack}
        actions={
          <ActionButton
            variant="icon"
            aria-label="刷新PT限制表"
            onClick={() => void loadTables()}
            disabled={isLoading || isWorking}
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </ActionButton>
        }
      />

      <main className="product-page-main">
        <div className="mx-auto grid w-full max-w-6xl gap-4">
          <Panel tone="muted" padding="compact" className="text-sm text-[var(--text-secondary)]">
            PT限制表按北京时间（Asia/Shanghai）精确到秒生效。所有生命周期都可修订规则；保存、发布和替换均使用修订号避免并发覆盖。
          </Panel>

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]"
            >
              {error}
            </div>
          ) : null}

          {isLoading && tables.length === 0 ? (
            <Panel className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
              <RefreshCw size={16} className="animate-spin text-[var(--accent-primary)]" />
              正在读取PT限制表
            </Panel>
          ) : (
            <>
              <Panel as="section" className="grid gap-4" aria-labelledby="point-table-overview">
                <SectionHeading
                  title="PT限制表"
                  description="选择任一版本查看并编辑完整规则。"
                  eyebrow={`${tables.length} 个版本`}
                  id="point-table-overview"
                  action={
                    <ActionButton
                      variant="secondary"
                      size="compact"
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      <Plus size={14} />
                      新建空白草稿
                    </ActionButton>
                  }
                />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {groups.active ? (
                    <TableSelectCard
                      table={groups.active}
                      selected={groups.active.id === selectedTable?.id}
                      onSelect={() => selectTable(groups.active!)}
                    />
                  ) : null}
                  {groups.scheduled ? (
                    <TableSelectCard
                      table={groups.scheduled}
                      selected={groups.scheduled.id === selectedTable?.id}
                      onSelect={() => selectTable(groups.scheduled!)}
                    />
                  ) : null}
                  {groups.drafts.map((table) => (
                    <TableSelectCard
                      key={table.id}
                      table={table}
                      selected={table.id === selectedTable?.id}
                      onSelect={() => selectTable(table)}
                    />
                  ))}
                  {groups.history.map((table) => (
                    <TableSelectCard
                      key={table.id}
                      table={table}
                      selected={table.id === selectedTable?.id}
                      onSelect={() => selectTable(table)}
                    />
                  ))}
                </div>
              </Panel>

              {selectedTable ? (
                <TableEditor
                  table={selectedTable}
                  form={form}
                  isDirty={isDirty}
                  isWorking={isWorking}
                  diffPreview={diffPreview}
                  scheduleEffectiveDateTime={scheduleEffectiveDateTime}
                  replacementTableId={replacementTableId}
                  replacementCandidates={replacementCandidates}
                  onFormChange={(next) => {
                    setForm(next);
                    setDiffPreview(null);
                  }}
                  onScheduleEffectiveDateTimeChange={setScheduleEffectiveDateTime}
                  onReplacementTableIdChange={setReplacementTableId}
                  onSave={() => void saveTable()}
                  onPreviewDiff={() => void previewDiff()}
                  onPublishImmediately={() => void publishImmediately()}
                  onPublishScheduled={() => void publishScheduled()}
                  onDiscard={() => void discardTable()}
                  onCancelSchedule={() => void cancelSchedule()}
                  onDelete={() => void deleteTable()}
                  onCopy={() => setCopySource(selectedTable)}
                />
              ) : (
                <EmptyState>当前没有PT限制表。</EmptyState>
              )}
            </>
          )}
        </div>
      </main>

      {copySource ? (
        <CopyDraftDialog
          source={copySource}
          busy={isWorking}
          serverError={error}
          onClose={() => setCopySource(null)}
          onConfirm={async (input) => {
            const succeeded = await runTableMutation(() =>
              copyAdminDeckPointTableToDraft(copySource.id, input)
            );
            if (succeeded) setCopySource(null);
          }}
        />
      ) : null}
      {createDialogOpen ? (
        <CreateDraftDialog
          busy={isWorking}
          serverError={error}
          onClose={() => setCreateDialogOpen(false)}
          onConfirm={async (input) => {
            const succeeded = await runTableMutation(() =>
              createAdminDeckPointTableDraft({ ...input, entries: [] })
            );
            if (succeeded) setCreateDialogOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function TableSelectCard({
  table,
  selected,
  onSelect,
}: {
  table: AdminDeckPointTable;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid gap-2 rounded-lg border p-3 text-left transition ${selected ? 'border-[var(--accent-primary)] bg-[color:var(--accent-primary)]/8' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">
          {table.displayName}
        </span>
        <StatusBadge tone={LIFECYCLE_TONES[table.lifecycle]}>
          {LIFECYCLE_LABELS[table.lifecycle]}
        </StatusBadge>
      </div>
      <span className="font-mono text-xs text-[var(--text-muted)]">{table.version}</span>
      <span className="text-xs text-[var(--text-secondary)]">
        {table.entries.length} 项 · 上限 {table.pointLimit}pt · r{table.revision}
      </span>
      <span className="text-xs text-[var(--text-muted)]">
        生效：{formatBeijingDateTime(table.effectiveFrom)}
      </span>
      {table.lifecycle === 'RETIRED' ? (
        <span className="text-xs text-[var(--text-muted)]">
          {formatRetirementReason(table.retirementReason)}
        </span>
      ) : null}
    </button>
  );
}

function TableEditor(props: {
  table: AdminDeckPointTable;
  form: DeckPointTableForm;
  isDirty: boolean;
  isWorking: boolean;
  diffPreview: DeckPointTableDiffPreview | null;
  scheduleEffectiveDateTime: string;
  replacementTableId: string;
  replacementCandidates: AdminDeckPointTable[];
  onFormChange: (form: DeckPointTableForm) => void;
  onScheduleEffectiveDateTimeChange: (value: string) => void;
  onReplacementTableIdChange: (value: string) => void;
  onSave: () => void;
  onPreviewDiff: () => void;
  onPublishImmediately: () => void;
  onPublishScheduled: () => void;
  onDiscard: () => void;
  onCancelSchedule: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const { table, form } = props;
  const metadataByCode = useMemo(
    () => new Map(table.entries.map((entry) => [entry.baseCardCode, entry])),
    [table.entries]
  );
  const updateEntry = (index: number, field: 'baseCardCode' | 'points', value: string) => {
    props.onFormChange({
      ...form,
      entries: form.entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry
      ),
    });
  };

  return (
    <Panel as="section" className="grid gap-4" aria-labelledby="point-table-editor">
      <SectionHeading
        title="编辑PT限制表"
        description={`修订 r${table.revision} · 上次更新 ${formatBeijingDateTime(table.updatedAt)} · 操作人 ${table.updatedBy ?? '系统'}`}
        eyebrow={LIFECYCLE_LABELS[table.lifecycle]}
        id="point-table-editor"
        action={
          <StatusBadge tone={props.isDirty ? 'warning' : 'neutral'}>
            {props.isDirty ? '有未保存更改' : '已保存'}
          </StatusBadge>
        }
      />

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_100px]">
        <Field label="版本号">
          <TextInput
            value={form.version}
            onChange={(event) => props.onFormChange({ ...form, version: event.target.value })}
          />
        </Field>
        <Field label="显示名称">
          <TextInput
            value={form.displayName}
            onChange={(event) => props.onFormChange({ ...form, displayName: event.target.value })}
          />
        </Field>
        <Field label="PT上限">
          <TextInput
            type="number"
            min={1}
            max={99}
            value={form.pointLimit}
            onChange={(event) => props.onFormChange({ ...form, pointLimit: event.target.value })}
          />
        </Field>
      </div>

      {table.lifecycle !== 'DRAFT' ? (
        <div className="grid max-w-xl gap-1">
          <Field label="生效时间（北京时间，精确到秒）" className="max-w-sm">
            <TextInput
              type="datetime-local"
              step={1}
              value={form.effectiveDateTime}
              onChange={(event) =>
                props.onFormChange({ ...form, effectiveDateTime: event.target.value })
              }
            />
          </Field>
          {table.lifecycle === 'ACTIVE' ? (
            <p className="text-xs text-[var(--text-muted)]">
              当前生效表不能改为未来时间；如需未来启用，请新建草稿并定时发布。
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            PT卡牌（点数降序、基础编号升序）
          </h3>
          <ActionButton
            variant="secondary"
            size="compact"
            onClick={() =>
              props.onFormChange({
                ...form,
                entries: [...form.entries, { baseCardCode: '', points: '1' }],
              })
            }
          >
            <Plus size={14} />
            添加卡牌
          </ActionButton>
        </div>
        <div className="grid max-h-[32rem] gap-2 overflow-auto pr-1">
          {form.entries.length === 0 ? (
            <EmptyState>该版本尚未添加PT卡牌。</EmptyState>
          ) : (
            form.entries.map((entry, index) => {
              const metadata = metadataByCode.get(entry.baseCardCode);
              return (
                <div
                  key={index}
                  className="grid gap-2 rounded-lg border border-[var(--border-subtle)] p-2 sm:grid-cols-[minmax(0,1fr)_90px_36px] sm:items-center"
                >
                  <div className="min-w-0">
                    <TextInput
                      aria-label={`第 ${index + 1} 项基础编号`}
                      value={entry.baseCardCode}
                      onChange={(event) => updateEntry(index, 'baseCardCode', event.target.value)}
                      className="font-mono"
                    />
                    {metadata ? (
                      <p className="mt-1 truncate px-1 text-xs text-[var(--text-muted)]">
                        {metadata.cardNameCn ?? metadata.cardNameJp ?? '已验证基础编号'}
                        {metadata.cost !== undefined ? ` · 费用${metadata.cost}` : ''}
                        {metadata.score !== undefined ? ` · 分数${metadata.score}` : ''}
                      </p>
                    ) : null}
                  </div>
                  <TextInput
                    aria-label={`${entry.baseCardCode || `第 ${index + 1} 项`}点数`}
                    type="number"
                    min={1}
                    max={99}
                    value={entry.points}
                    onChange={(event) => updateEntry(index, 'points', event.target.value)}
                  />
                  <ActionButton
                    variant="icon"
                    aria-label={`删除 ${entry.baseCardCode || `第 ${index + 1} 项`}`}
                    onClick={() =>
                      props.onFormChange({
                        ...form,
                        entries: form.entries.filter((_, entryIndex) => entryIndex !== index),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </ActionButton>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
        <ActionButton onClick={props.onSave} disabled={props.isWorking || !props.isDirty}>
          <Save size={15} />
          保存修改
        </ActionButton>
        <ActionButton variant="ghost" onClick={props.onCopy} disabled={props.isWorking}>
          <Copy size={15} />
          基于此版创建草稿
        </ActionButton>
        {table.lifecycle === 'DRAFT' ? (
          <ActionButton
            variant="secondary"
            onClick={props.onPreviewDiff}
            disabled={props.isWorking || props.isDirty}
          >
            <FileClock size={15} />
            与当前表比较
          </ActionButton>
        ) : null}
      </div>

      {props.diffPreview ? <DiffPreview preview={props.diffPreview} /> : null}

      {table.lifecycle === 'DRAFT' ? (
        <div className="grid gap-3 rounded-lg border border-[color:var(--semantic-warning)]/35 bg-[color:var(--semantic-warning)]/7 p-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">发布草稿</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              发布前必须保存并查看与当前表的差异。定时发布使用北京时间，精确到秒。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="定时生效时间（北京时间）" className="sm:min-w-72">
              <TextInput
                type="datetime-local"
                step={1}
                value={props.scheduleEffectiveDateTime}
                onChange={(event) => props.onScheduleEffectiveDateTimeChange(event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                variant="secondary"
                onClick={props.onPublishScheduled}
                disabled={props.isWorking || props.isDirty || !props.diffPreview}
              >
                <CalendarClock size={15} />
                定时发布
              </ActionButton>
              <ActionButton
                onClick={props.onPublishImmediately}
                disabled={props.isWorking || props.isDirty || !props.diffPreview}
              >
                <Send size={15} />
                立即发布
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}

      {table.lifecycle === 'ACTIVE' ? (
        <div className="grid gap-3 rounded-lg border border-[color:var(--semantic-error)]/35 bg-[color:var(--semantic-error)]/7 p-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">废弃当前表并原子切换</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              必须选择另一张表作为接替版本。后端会在同一事务中切换
              ACTIVE，不会出现没有当前表的窗口。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="接替PT限制表" className="sm:min-w-72">
              <select
                aria-label="接替PT限制表"
                value={props.replacementTableId}
                onChange={(event) => props.onReplacementTableIdChange(event.target.value)}
                className="h-10 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)]"
              >
                <option value="">请选择接替版本</option>
                {props.replacementCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}（{LIFECYCLE_LABELS[candidate.lifecycle]}，r
                    {candidate.revision}
                    {candidate.retirementReason === 'MANUALLY_DISCARDED' ? '，已人工废弃' : ''}）
                  </option>
                ))}
              </select>
            </Field>
            <ActionButton
              variant="secondary"
              onClick={props.onDiscard}
              disabled={props.isWorking || !props.replacementTableId}
            >
              <Ban size={15} />
              废弃并切换
            </ActionButton>
          </div>
        </div>
      ) : table.lifecycle === 'RETIRED' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--semantic-error)]/35 p-3">
          <p className="text-xs text-[var(--text-secondary)]">历史表可物理删除，删除后不可恢复。</p>
          <ActionButton variant="secondary" onClick={props.onDelete} disabled={props.isWorking}>
            <Trash2 size={15} />
            永久删除
          </ActionButton>
        </div>
      ) : table.lifecycle === 'SCHEDULED' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">
            取消后会转为历史版本，并保留原计划生效时间与完整记录。
          </p>
          <ActionButton
            variant="secondary"
            onClick={props.onCancelSchedule}
            disabled={props.isWorking}
          >
            <X size={15} />
            取消排期
          </ActionButton>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">
            废弃后会转为历史版本并保留完整记录。
          </p>
          <ActionButton variant="secondary" onClick={props.onDiscard} disabled={props.isWorking}>
            <Ban size={15} />
            废弃此表
          </ActionButton>
        </div>
      )}

      <TableEntries entries={table.entries} />
    </Panel>
  );
}

function TableEntries({ entries }: { entries: readonly DeckPointTableEntryView[] }) {
  return (
    <details className="rounded-lg border border-[var(--border-subtle)]">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--text-secondary)]">
        查看服务端已保存卡表（{entries.length} 项）
      </summary>
      <div className="max-h-80 overflow-auto border-t border-[var(--border-subtle)]">
        {sortDeckPointTableEntries(entries).map((entry) => (
          <div
            key={entry.baseCardCode}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-xs font-semibold text-[var(--text-primary)]">
                {entry.baseCardCode}
              </div>
              <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                {entry.cardNameCn ?? entry.cardNameJp ?? '未找到已发布卡牌名称'}
              </div>
            </div>
            <StatusBadge tone="accent">{entry.points}pt</StatusBadge>
          </div>
        ))}
      </div>
    </details>
  );
}

function DiffPreview({ preview }: { preview: DeckPointTableDiffPreview }) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">发布差异</h3>
        <span className="text-xs text-[var(--text-muted)]">
          {preview.before.displayName} → {preview.after.displayName}
        </span>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        PT上限：<strong>{preview.diff.pointLimitBefore}pt</strong> →{' '}
        <strong>{preview.diff.pointLimitAfter}pt</strong>
      </p>
      {preview.diff.entries.length === 0 &&
      preview.diff.pointLimitBefore === preview.diff.pointLimitAfter ? (
        <p className="text-sm text-[var(--text-secondary)]">与当前生效表没有规则差异。</p>
      ) : (
        <div className="grid gap-1">
          {preview.diff.entries.map((entry) => (
            <div
              key={entry.baseCardCode}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md bg-[var(--bg-surface)] px-2.5 py-2 text-sm"
            >
              <span className="truncate font-mono text-xs">{entry.baseCardCode}</span>
              <span>
                {entry.before === 0 ? '新增' : `${entry.before}pt`} →{' '}
                {entry.after === 0 ? '移出' : `${entry.after}pt`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyDraftDialog({
  source,
  busy,
  serverError,
  onClose,
  onConfirm,
}: {
  source: AdminDeckPointTable;
  busy: boolean;
  serverError: string | null;
  onClose: () => void;
  onConfirm: (input: { version: string; displayName: string }) => void | Promise<void>;
}) {
  const defaults = makeCopyDraftDefaults(source);
  const [version, setVersion] = useState(defaults.version);
  const [displayName, setDisplayName] = useState(defaults.displayName);
  const [validationError, setValidationError] = useState<string | null>(null);
  const submit = () => {
    const normalized = { version: version.trim(), displayName: displayName.trim() };
    if (!normalized.version || !normalized.displayName) {
      setValidationError('请填写新版本号和显示名称');
      return;
    }
    void onConfirm(normalized);
  };
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-point-table-title"
        className="product-workbench w-full max-w-lg p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="copy-point-table-title" className="font-bold text-[var(--text-primary)]">
              基于旧版本创建草稿
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              复制“{source.displayName}”的PT上限和完整卡表。
            </p>
          </div>
          <ActionButton variant="icon" aria-label="关闭" onClick={onClose} disabled={busy}>
            <X size={16} />
          </ActionButton>
        </div>
        {validationError ? (
          <p className="mt-3 text-sm text-[var(--semantic-error)]">{validationError}</p>
        ) : serverError ? (
          <p className="mt-3 text-sm text-[var(--semantic-error)]">{serverError}</p>
        ) : null}
        <div className="mt-4 grid gap-3">
          <Field label="新版本号">
            <TextInput
              value={version}
              onChange={(event) => {
                setVersion(event.target.value);
                setValidationError(null);
              }}
            />
          </Field>
          <Field label="新显示名称">
            <TextInput
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setValidationError(null);
              }}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </ActionButton>
          <ActionButton onClick={submit} disabled={busy}>
            <Copy size={15} />
            {busy ? '创建中' : '创建草稿'}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function CreateDraftDialog({
  busy,
  serverError,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  serverError: string | null;
  onClose: () => void;
  onConfirm: (input: {
    version: string;
    displayName: string;
    pointLimit: number;
  }) => void | Promise<void>;
}) {
  const [version, setVersion] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pointLimit, setPointLimit] = useState('9');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = () => {
    const normalizedPointLimit = Number(pointLimit);
    if (!version.trim() || !displayName.trim()) {
      setValidationError('请填写版本号和显示名称');
      return;
    }
    if (
      !Number.isSafeInteger(normalizedPointLimit) ||
      normalizedPointLimit < 1 ||
      normalizedPointLimit > 99
    ) {
      setValidationError('卡组PT上限必须是1-99的整数');
      return;
    }
    void onConfirm({
      version: version.trim(),
      displayName: displayName.trim(),
      pointLimit: normalizedPointLimit,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-point-table-title"
        className="product-workbench w-full max-w-lg p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="create-point-table-title" className="font-bold text-[var(--text-primary)]">
              新建空白PT限制表草稿
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              创建后可以在编辑区逐项添加PT卡牌。
            </p>
          </div>
          <ActionButton variant="icon" aria-label="关闭" onClick={onClose} disabled={busy}>
            <X size={16} />
          </ActionButton>
        </div>
        {validationError ? (
          <p className="mt-3 text-sm text-[var(--semantic-error)]">{validationError}</p>
        ) : serverError ? (
          <p className="mt-3 text-sm text-[var(--semantic-error)]">{serverError}</p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px]">
          <Field label="版本号" className="sm:col-span-2">
            <TextInput value={version} onChange={(event) => setVersion(event.target.value)} />
          </Field>
          <Field label="显示名称">
            <TextInput
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field label="PT上限">
            <TextInput
              type="number"
              min={1}
              max={99}
              value={pointLimit}
              onChange={(event) => setPointLimit(event.target.value)}
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </ActionButton>
          <ActionButton onClick={submit} disabled={busy}>
            <Plus size={15} />
            {busy ? '创建中' : '创建草稿'}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1 text-xs font-semibold text-[var(--text-secondary)] ${className}`}>
      {label}
      {children}
    </label>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-4 text-sm text-[var(--text-secondary)]">
      {children}
    </div>
  );
}

function defaultScheduleDateTime(): string {
  const nextDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(nextDay);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T00:00:00`;
}

function formatRetirementReason(reason: AdminDeckPointTable['retirementReason']): string {
  if (reason === 'REPLACED') return '历史原因：已被新版本替换';
  if (reason === 'SCHEDULE_CANCELLED') return '历史原因：已取消排期';
  if (reason === 'MANUALLY_DISCARDED') return '历史原因：已人工废弃';
  return '历史原因：未记录';
}

function readError(error: unknown): string {
  if (!(error instanceof Error)) return '操作失败';
  if ('code' in error && error.code === 'POINT_TABLE_REVISION_CONFLICT')
    return `${error.message}。请刷新页面后重新应用修改。`;
  return error.message;
}
