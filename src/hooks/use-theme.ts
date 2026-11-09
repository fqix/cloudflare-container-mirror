import { useState } from 'react';

type Theme = 'light' | 'dark';

const themeKey = 'mirror-theme';

export function useTheme() {
  // The HTML entry applies the initial theme before the stylesheet loads.
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.classList.contains('dark') ? 'dark' : 'light');

  function toggleTheme(): void {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    setTheme(next);
    try { window.localStorage.setItem(themeKey, next); } catch { /* Browser storage may be disabled. */ }
  }

  return { theme, toggleTheme };
}
