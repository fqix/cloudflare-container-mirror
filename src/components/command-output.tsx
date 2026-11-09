import { Braces, Check, Copy, Terminal } from 'lucide-react';
import { useRef, useState } from 'react';
import { clientInfo, type ClientId } from '../data/clients';
import { Button } from './ui/button';

type CommandOutputProps = { value: string } & (
  | { kind: 'pull'; client: ClientId; disabled: boolean }
  | { kind: 'docker' }
);

export function CommandOutput(props: CommandOutputProps) {
  const { value } = props;
  const code = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<{ value: string; text: string } | null>(null);
  const isPull = props.kind === 'pull';
  const clientLabel = isPull ? clientInfo[props.client].label : 'Docker';
  const id = isPull ? 'pull-' + props.client : 'docker';
  const codeId = isPull ? 'pull-command-' + props.client : 'docker-config';
  const label = isPull ? clientLabel + ' 命令' : 'Docker 配置';
  const disabled = isPull && props.disabled;
  const feedback = !disabled && status?.value === value ? status.text : '';
  const copied = feedback === '已复制';

  async function copy(): Promise<void> {
    if (disabled) return;
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
    <div className="min-w-0">
      <div className="min-w-0 overflow-hidden rounded-md border bg-muted/50">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            {isPull ? <Terminal className="size-4" aria-hidden /> : <Braces className="size-4" aria-hidden />}
            {isPull ? clientLabel + ' CLI' : 'daemon.json'}
          </span>
          <Button id={'copy-' + id} type="button" size="sm" disabled={disabled} aria-label={isPull ? '复制命令 ' + clientLabel : '复制配置'} onClick={() => { void copy(); }}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {isPull ? '复制命令' : '复制配置'}
          </Button>
        </div>
        <pre className="max-h-56 min-w-0 overflow-auto p-3 font-mono text-xs leading-relaxed focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:p-4 sm:text-sm" tabIndex={0} aria-label={label}>
          <code id={codeId} ref={code}>{value}</code>
        </pre>
        {isPull && props.client === 'ctr' && (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">命令使用 ctr 的默认命名空间。若指定其他命名空间，拉取和打标签需使用同一个。</p>
        )}
      </div>
      <p id={id + '-feedback'} role="status" className="mt-2 min-h-5 text-sm text-muted-foreground">{feedback}</p>
    </div>
  );
}
