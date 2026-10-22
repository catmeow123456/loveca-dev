import { useState } from 'react';
import { CardType } from '@game/shared/types/enums';
import { CardEffectText } from '@/components/card/CardEffectText';
import { getExcelCardSummary, type ExcelCardRow } from '@/lib/excelCardView';

export interface ExcelCardCandidate {
  readonly id: string;
  readonly card: ExcelCardRow | null;
  readonly concealed?: boolean;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly order?: number;
}

interface ExcelCandidateTableProps {
  label: string;
  candidates: readonly ExcelCardCandidate[];
  onSelect: (id: string) => void;
}

/** Presentation only: identities and commands stay with the shared battle controller. */
export function ExcelCandidateTable({ label, candidates, onSelect }: ExcelCandidateTableProps) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspected = candidates.find((candidate) => candidate.id === inspectedId);
  const detail = inspected && !inspected.concealed ? inspected.card : null;
  const detailText = detail ? getExcelCardSummary(detail.front) : null;

  return (
    <div className="excel-candidate-picker">
      <div className="excel-candidate-scroll" tabIndex={0} aria-label={`${label}滚动区域`}>
        <table className="excel-table excel-candidate-table" aria-label={label}>
          <colgroup>
            <col className="excel-candidate-select" />
            <col className="excel-candidate-code" />
            <col className="excel-candidate-name" />
            <col className="excel-candidate-type" />
            <col className="excel-candidate-value" />
            <col />
            <col className="excel-candidate-inspect" />
          </colgroup>
          <thead>
            <tr>
              {['选择', '卡号', '名称', '类型', '费用/分数', '卡牌效果', '查看'].map((heading) => (
                <th key={heading} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate, index) => {
              // A face-down selection never consumes even an otherwise visible front.
              const card = candidate.concealed ? null : candidate.card;
              const text = card ? getExcelCardSummary(card.front) : null;
              const name = text
                ? [card?.location, text.name].filter(Boolean).join(' · ')
                : candidate.concealed
                  ? '未知手牌'
                  : '不可见卡牌';
              const state = [
                card?.state,
                card?.front.cardType === CardType.ENERGY && card.object.skipsNextActivePhase
                  ? '下次不活跃'
                  : '',
              ]
                .filter(Boolean)
                .join('；');
              const select = () => {
                if (!candidate.disabled) onSelect(candidate.id);
              };
              return (
                <tr
                  key={candidate.id}
                  aria-selected={candidate.selected === true}
                  data-selection-disabled={candidate.disabled === true}
                  onClick={select}
                >
                  <td>
                    <button
                      type="button"
                      className="excel-candidate-choose"
                      data-battle-ui-object-id={candidate.id}
                      disabled={candidate.disabled}
                      aria-pressed={candidate.selected === true}
                      aria-label={`${candidate.selected ? '取消选择' : '选择'}第 ${index + 1} 张：${name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        select();
                      }}
                    >
                      {candidate.selected ? `✓${candidate.order ?? ''}` : index + 1}
                    </button>
                  </td>
                  <td title={card?.front.cardCode}>{card?.front.cardCode ?? '—'}</td>
                  <td title={name}>{name}</td>
                  <td>{text?.type ?? '—'}</td>
                  <td title={text?.valueLabel}>{text?.value ?? '—'}</td>
                  <td className="excel-candidate-effect">
                    {state ? `${state}；` : ''}
                    {text?.preview ?? '信息未公开'}
                  </td>
                  <td>
                    {card && (
                      <button
                        type="button"
                        aria-label={`查看第 ${index + 1} 张：${name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setInspectedId(candidate.id);
                        }}
                      >
                        查看
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail && detailText && (
        <section className="excel-candidate-detail" aria-label="候选卡牌完整信息">
          <header>
            <strong>{detailText.name}</strong>
            <button type="button" onClick={() => setInspectedId(null)}>
              收起卡文
            </button>
          </header>
          <p>
            {detail.front.cardCode} · {detailText.type}
            {detail.location ? ` · ${detail.location}` : ''}
          </p>
          <p>
            {detail.metrics}
            {detail.state ? `；${detail.state}` : ''}
          </p>
          <CardEffectText text={detailText.effect ?? '无效果'} />
        </section>
      )}
    </div>
  );
}
