import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/use-theme';
import { Button } from './ui/button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? '切换为浅色主题' : '切换为深色主题';

  return (
    <Button id="theme-toggle" type="button" variant="ghost" size="icon" aria-label={label} title={label} onClick={toggleTheme}>
      {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
