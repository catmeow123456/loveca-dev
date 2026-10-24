import { Table2 } from 'lucide-react';
import { useAppPresentation, useTextPresentation } from '@/lib/appPresentation';
import { cn } from '@/lib/utils';

export function PresentationModeButton({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const textOnly = useTextPresentation();
  const setMode = useAppPresentation((state) => state.setMode);
  if (textOnly) return null;

  return (
    <button
      type="button"
      className={cn(
        compact
          ? 'button-icon'
          : 'button-ghost inline-flex min-h-10 shrink-0 items-center gap-2 px-2 sm:px-3',
        className
      )}
      title="切换到 Excel 模式（Ctrl+Alt+E）"
      aria-label="切换到 Excel 模式"
      onClick={() => setMode('excel')}
    >
      <Table2 size={18} aria-hidden="true" />
      {!compact && <span className="hidden sm:inline">Excel 模式</span>}
    </button>
  );
}
