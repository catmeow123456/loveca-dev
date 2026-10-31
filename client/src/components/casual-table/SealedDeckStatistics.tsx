import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DeckAnalysisCharts } from '@/components/common/DeckAnalysisCharts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import { getPresentationPortalRoot } from '@/lib/appPresentation';
import type { DeckAnalysis } from '@/lib/deckAnalysis';

export function SealedDeckStatistics({
  open,
  onClose,
  analysis,
}: {
  open: boolean;
  onClose: () => void;
  analysis: DeckAnalysis;
}) {
  const wide = useMediaQuery('(min-width: 1200px)');
  const ref = useRef<HTMLElement>(null);
  useDialogAccessibility({ isOpen: open && !wide, dialogRef: ref, onEscape: onClose });
  if (!open) return null;
  const panel = (
    <aside
      id="sealed-deck-statistics"
      ref={ref}
      className={`sealed-statistics${wide ? '' : ' sealed-statistics--drawer'}`}
      role={wide ? 'complementary' : 'dialog'}
      aria-modal={wide ? undefined : true}
      aria-label="卡组统计"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (wide && event.key === 'Escape') onClose();
      }}
    >
      <div className="sealed-panel-header">
        <h3>卡组统计</h3>
        <button type="button" className="button-icon" aria-label="关闭卡组统计" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="sealed-statistics-content">
        <p className="sealed-statistics-note">
          已选 {analysis.memberCount} 张成员 + 固定 {analysis.liveCount} 张 Live
          <br />
          实时更新，不受筛选影响
        </p>
        <DeckAnalysisCharts analysis={analysis} sealed />
      </div>
    </aside>
  );
  return wide
    ? panel
    : createPortal(
        <div className="sealed-statistics-backdrop" onClick={onClose}>
          <div
            className="sealed-statistics-drawer-wrap"
            onClick={(event) => event.stopPropagation()}
          >
            {panel}
          </div>
        </div>,
        getPresentationPortalRoot()
      );
}
