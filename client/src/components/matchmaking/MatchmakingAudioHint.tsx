import { Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MatchmakingAudioHint({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-center gap-1.5 text-xs leading-5 text-[var(--text-muted)]',
        className
      )}
    >
      <Volume2 size={13} className="shrink-0" aria-hidden="true" />
      候场背景音乐可在「个人中心 → 声音设置」中开启或关闭。
    </p>
  );
}
