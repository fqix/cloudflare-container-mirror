import { ArrowUpRight, Braces, Check, Copy, Moon, Sun, Terminal } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { buildImageCommands, clientInfo, dockerHub, enabledSource, explicitSource, isClientId, parseImage, sourceInfo, statuses, type ClientId } from './image-commands';

type Theme = 'light' | 'dark';

const repository = 'https://github.com/fqix/cloudflare-container-mirror';
const themeKey = 'mirror-theme';

function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(themeKey);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch { /* Browser storage may be disabled. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface CommandBoxProps {
  kind: 'pull' | 'docker';
  value: string;
  error?: string;
  clientLabel?: string;
}

function CommandBox({ kind, value, error, clientLabel = 'Docker' }: CommandBoxProps) {
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

function SourceTable() {
  return (
    <Card aria-labelledby="sources-title" className="min-w-0">
      <CardHeader>
        <CardTitle id="sources-title" className="text-lg">镜像源</CardTitle>
        <CardDescription>已验证表示完成样本拉取。接口已验证表示清单和分段下载通过。各源仍受上游可用性和限额影响。</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">镜像源</TableHead>
              <TableHead scope="col" className="text-right">验证状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody id="sources">
            {sourceInfo.map(source => (
              <TableRow key={source.host}>
                <TableHead scope="row" className="h-auto whitespace-normal py-2">
                  <code className="font-mono text-xs break-all" title={source.label}>{source.host}</code>
                  <span className="block text-xs font-normal whitespace-normal text-muted-foreground">{source.detail}</span>
                </TableHead>
                <TableCell className="text-right">
                  <Badge variant={source.state === 'verified' ? 'default' : source.state === 'api-verified' ? 'outline' : 'secondary'}>
                    {statuses[source.state]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface AppProps {
  host: string;
  origin: string;
}

export function App({ host, origin }: AppProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [client, setClient] = useState<ClientId>('docker');
  const [sourceHost, setSourceHost] = useState(dockerHub.host);
  const [image, setImage] = useState(dockerHub.example);
  const [targetTag, setTargetTag] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  function switchTheme(): void {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { window.localStorage.setItem(themeKey, next); } catch { /* Browser storage may be disabled. */ }
  }

  function changeImage(nextImage: string, preferredHost = sourceHost): void {
    const explicit = explicitSource(nextImage);
    const nextHost = explicit && !explicit.disabled ? explicit.host : preferredHost;
    const result = parseImage(nextImage, nextHost);
    setSourceHost(nextHost);
    setImage(nextImage);
    if (!result.ok || result.tag !== null) setTargetTag('');
  }

  function changeSource(nextHost: string): void {
    const nextImage = explicitSource(image) ? image.slice(image.indexOf('/') + 1) : image;
    changeImage(nextImage, nextHost);
  }

  function showExample(): void {
    const source = enabledSource(sourceHost);
    if (!source) return;
    changeImage(source.example);
    imageInput.current?.focus();
  }

  const result = buildImageCommands(host, image, sourceHost, targetTag, client);
  const clientLabel = clientInfo[client].label;
  const dockerConfig = JSON.stringify({ 'registry-mirrors': [origin] }, null, 2);
  const themeLabel = theme === 'dark' ? '切换为浅色主题' : '切换为深色主题';

  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 font-semibold">
            <Terminal className="size-5 shrink-0" aria-hidden />
            <span>Mirror</span>
            <span className="hidden text-sm font-normal text-muted-foreground sm:inline">/ 镜像入口</span>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={repository}>GitHub <ArrowUpRight aria-hidden /></a>
            </Button>
            <Button id="theme-toggle" type="button" variant="ghost" size="icon" aria-label={themeLabel} title={themeLabel} onClick={switchTheme}>
              {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section aria-labelledby="title" className="space-y-3 pt-9 pb-7 sm:pt-12 sm:pb-8">
          <Badge variant="secondary">公共容器镜像</Badge>
          <h1 id="title" className="text-3xl font-semibold tracking-tight sm:text-4xl">拉取镜像，保持原名</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            通过 Cloudflare 拉取公开容器镜像。Docker Hub 优先查询 Google 公开缓存，未命中时仍受匿名拉取限额约束。
          </p>
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.38fr)_minmax(0,1fr)] lg:gap-5">
          <Card className="min-w-0" aria-labelledby="commands-title">
            <CardHeader>
              <CardTitle id="commands-title" className="text-lg">命令生成</CardTitle>
              <CardDescription>选择镜像源或粘贴完整镜像名，复制命令到终端。</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="pull" className="min-w-0 gap-4">
                <TabsList aria-label="使用方式" className="h-auto max-w-full flex-wrap justify-start">
                  <TabsTrigger id="tab-pull" aria-controls="panel-pull" value="pull" className="text-xs sm:text-sm">拉取并还原镜像名</TabsTrigger>
                  <TabsTrigger id="tab-docker" aria-controls="panel-docker" value="docker" className="text-xs sm:text-sm">默认 Docker Hub 配置</TabsTrigger>
                </TabsList>
                <TabsContent id="panel-pull" aria-labelledby="tab-pull" value="pull" className="min-w-0 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="client">客户端</Label>
                      <Select value={client} onValueChange={value => { if (isClientId(value)) setClient(value); }}>
                        <SelectTrigger id="client" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {Object.entries(clientInfo).map(([id, info]) => (
                            <SelectItem key={id} value={id}>{info.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="source">镜像源</Label>
                      <Select value={sourceHost} onValueChange={changeSource}>
                        <SelectTrigger id="source" className="w-full font-mono">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {sourceInfo.filter(source => !source.disabled).map(source => (
                            <SelectItem key={source.host} value={source.host} className="font-mono">{source.host}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid min-w-0 gap-2 sm:col-span-2">
                      <Label htmlFor="image">原始镜像</Label>
                      <Input ref={imageInput} id="image" type="text" value={image} placeholder={dockerHub.example} className="font-mono"
                        aria-describedby="image-hint pull-feedback" aria-invalid={!result.ok}
                        autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={512}
                        onChange={event => changeImage(event.target.value)} />
                    </div>
                  </div>
                  <div id="image-hint" className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>支持完整镜像名、仓库和标签或 SHA-256 摘要。</span>
                    <Button id="example" type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={showExample}>使用示例</Button>
                  </div>
                  {result.ok && result.needsTargetTag && (
                    <div id="restore-tag-field" className="grid max-w-xs gap-2">
                      <Label htmlFor="restore-tag">还原后的标签</Label>
                      <Input id="restore-tag" type="text" value={targetTag} placeholder="local" className="font-mono"
                        aria-describedby="restore-tag-feedback" aria-invalid={Boolean(result.targetTagError)}
                        autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={128}
                        onChange={event => setTargetTag(event.target.value)} />
                      <p id="restore-tag-feedback" aria-live="polite" className={result.targetTagError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                        {result.targetTagError || (!targetTag ? '填写目标标签后可生成还原命令。' : '')}
                      </p>
                    </div>
                  )}
                  {client === 'ctr' && (
                    <p className="text-xs text-muted-foreground">命令使用 ctr 的默认命名空间。若指定其他命名空间，拉取和打标签需使用同一个。</p>
                  )}
                  {result.ok
                    ? <CommandBox kind="pull" value={result.commands} clientLabel={clientLabel} />
                    : <CommandBox kind="pull" value="请检查镜像地址" error={result.error} clientLabel={clientLabel} />}
                </TabsContent>
                <TabsContent id="panel-docker" aria-labelledby="tab-docker" value="docker" className="min-w-0 space-y-4">
                  <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
                    <p>在 Linux 的 <code className="font-mono text-foreground">/etc/docker/daemon.json</code> 或 Docker Desktop 的 <strong className="font-medium text-foreground">Settings → Docker Engine</strong> 中合并以下配置。已有 <code className="font-mono text-foreground">registry-mirrors</code> 数组时，将地址加入原数组。</p>
                    <p>Linux 可重载 Docker 配置。Docker Desktop 点击 <strong className="font-medium text-foreground">Apply &amp; restart</strong>，重启可能暂时中断运行中的容器。</p>
                  </div>
                  <CommandBox kind="docker" value={dockerConfig} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <SourceTable />
        </div>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-muted-foreground sm:px-6">
        仅提供公开镜像拉取。上传及私有仓库认证暂不支持。Ollama 模型需要原生 API，此入口尚未适配。
      </footer>
    </>
  );
}
