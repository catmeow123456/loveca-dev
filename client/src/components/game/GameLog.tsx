/**
 * 游戏日志面板
 * 左侧可展开/收起的侧边栏
 */

import { memo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';

interface GameLogContentProps {
  active?: boolean;
  onClose?: () => void;
}

export const GameLogContent = memo(function GameLogContent({
  active = true,
  onClose,
}: GameLogContentProps) {
  const logs = useGameStore((s) => s.ui.logs);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && active) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, active]);

  const typeColors = {
    info: 'text-[var(--text-muted)]',
    action: 'text-cyan-400',
    phase: 'text-[var(--accent-gold)]',
    error: 'text-[var(--semantic-error)]',
  };

  return (
    <>
      <div className="modal-header flex flex-shrink-0 items-center justify-between px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
          <ScrollText size={16} className="text-[var(--accent-primary)]" />
          调试日志
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">{logs.length} 条</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="button-icon h-8 w-8"
              aria-label="关闭调试日志"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="cute-scrollbar flex-1 space-y-1 overflow-y-auto p-2 font-mono text-xs"
      >
        <AnimatePresence initial={false}>
          {logs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                'rounded border border-[var(--border-subtle)] px-2 py-1',
                'bg-[color:color-mix(in_srgb,var(--bg-surface)_76%,transparent)]',
                typeColors[log.type]
              )}
            >
              <div className="mb-0.5 text-[10px] text-[var(--text-muted)]">
                {new Date(log.timestamp).toLocaleTimeString('zh-CN', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </div>
              <div className="break-words text-[var(--text-secondary)]">{log.message}</div>
            </motion.div>
          ))}
        </AnimatePresence>

        {logs.length === 0 && (
          <div className="py-4 text-center text-[var(--text-muted)]">暂无日志</div>
        )}
      </div>
    </>
  );
});

export const GameLog = memo(function GameLog({
  isOpen,
  onClose,
  docked,
}: {
  isOpen: boolean;
  onClose: () => void;
  docked: boolean;
}) {
  const canShowDebugLog = useGameStore((s) => s.getBattleSurfaceCapabilities().canShowDebugLog);

  if (!canShowDebugLog || !isOpen) return null;

  return (
    <aside
      id="debug-battle-log-panel"
      role="region"
      aria-label="调试日志"
      data-docked={docked}
      className="battle-side-panel overflow-hidden"
    >
      <GameLogContent active={isOpen} onClose={onClose} />
    </aside>
  );
});

export default GameLog;
