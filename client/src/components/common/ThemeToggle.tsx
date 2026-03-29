import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { applyTheme, readTheme, toggleTheme, type Theme } from '@/lib/theme';

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const handleToggle = () => {
    const nextTheme = toggleTheme(theme);
    applyTheme(nextTheme);
    setTheme(nextTheme);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`button-icon ${className}`.trim()}
      title={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
      aria-label={theme === 'light' ? '切换到深色主题' : '切换到浅色主题'}
    >
      <span
        className="transition-transform duration-300"
        style={{ transform: `rotate(${theme === 'light' ? 0 : 180}deg)` }}
      >
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </span>
    </button>
  );
}
