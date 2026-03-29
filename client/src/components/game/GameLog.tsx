/**
 * 游戏日志面板
 * 左侧可展开/收起的侧边栏
 */

import { memo, useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';

export const GameLog = memo(function GameLog() {
  const logs = useGameStore((s) => s.ui.logs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isExpanded]);

  const typeColors = {
    info: 'text-[var(--text-muted)]',
    action: 'text-cyan-400',
    phase: 'text-[var(--accent-gold)]',
    error: 'text-[var(--semantic-error)]',
  };

  return (
    <div className="fixed left-0 top-0 z-[var(--z-game-log)] flex h-full">
      <motion.button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex h-full w-8 items-center justify-center border-r',
          'border-[var(--border-default)] bg-[var(--bg-frosted)]',
          'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          'transition-colors'
        )}
        whileHover={{ width: 36 }}
        whileTap={{ scale: 0.95 }}
      >
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-center"
        >
          {isExpanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </motion.div>
      </motion.button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex h-full flex-col overflow-hidden border-r border-[var(--border-default)] bg-[var(--bg-frosted)] shadow-[var(--shadow-lg)] backdrop-blur-xl"
          >
            <div className="modal-header flex flex-shrink-0 items-center justify-between px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                <ScrollText size={16} className="text-[var(--accent-primary)]" />
                游戏日志
              </span>
              <span className="text-xs text-[var(--text-muted)]">{logs.length} 条</span>
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
                      'rounded border border-[var(--border-subtle)] py-1 px-2',
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
                <div className="py-4 text-center text-[var(--text-muted)]">
                  暂无日志
                </div>
              )}
            </div>

            <div className="modal-footer flex-shrink-0 p-2">
              <button
                onClick={() => {
                  // 这里可以添加清空日志的功能
                }}
                className="w-full rounded bg-[color:color-mix(in_srgb,var(--bg-surface)_70%,transparent)] py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
              >
                点击展开按钮收起
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default GameLog;
