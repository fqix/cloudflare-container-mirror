import { Braces, Check, Copy, Terminal } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from './ui/button';

interface CommandOutputProps {
  kind: 'pull' | 'docker';
  value: string;
  error?: string;
  clientLabel?: string;
}

export function CommandOutput({ kind, value, error, clientLabel = 'Docker' }: CommandOutputProps) {
  const code = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<{ value: string; text: string } | null>(null);
  const isPull = kind === 'pull';
  const label = isPull ? clientLabel + ' 命令' : 'Docker 配置';
  const feedback = error || (status?.value === value ? status.text : '');
  const copied = !error && feedback === '已复制';

  async function copy(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setStatus({ value, text: '已复制' });
    } catch {
      const selection = window.getSelection();
      if (!selection || !code.current) {
        setStatus({ value, text: '请手动复制。' });
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(code.current);
      selection.removeAllRanges();
      selection.addRange(range);
      setStatus({ value, text: '已选中，请手动复制。' });
    }
  }

  return (
    <div>
      <div className="min-w-0 overflow-hidden rounded-md border bg-muted/50">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            {isPull ? <Terminal className="size-4" aria-hidden /> : <Braces className="size-4" aria-hidden />}
            {isPull ? clientLabel + ' CLI' : 'daemon.json'}
          </span>
          <Button id={'copy-' + kind} type="button" size="sm" disabled={Boolean(error)} onClick={() => { void copy(); }}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {isPull ? '复制命令' : '复制配置'}
          </Button>
        </div>
        <pre className="max-h-56 min-w-0 overflow-auto p-3 font-mono text-xs leading-relaxed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:p-4 sm:text-sm" tabIndex={0} aria-label={label}>
          <code id={isPull ? 'pull-command' : 'docker-config'} ref={code}>{value}</code>
        </pre>
      </div>
      <p id={kind + '-feedback'} role="status" aria-live="polite" className={error ? 'mt-2 text-sm text-destructive' : 'mt-2 min-h-5 text-sm text-muted-foreground'}>{feedback}</p>
    </div>
  );
}
