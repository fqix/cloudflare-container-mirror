import { useRef, useState } from 'react';
import { clientInfo, isClientId } from '../data/clients';
import { dockerHub, enabledSource, sourceInfo } from '../data/registries';
import { buildImageCommands, explicitSource, parseImage } from '../lib/image-commands';
import { CommandOutput } from './command-output';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const commandClients = Object.keys(clientInfo).filter(isClientId);

interface CommandGeneratorProps {
  host: string;
  origin: string;
}

export function CommandGenerator({ host, origin }: CommandGeneratorProps) {
  const [image, setImage] = useState(dockerHub.example);
  const [targetTag, setTargetTag] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const explicit = explicitSource(image);
  const sourceHost = explicit && !explicit.disabled ? explicit.host : dockerHub.host;

  function changeImage(nextImage: string): void {
    const result = parseImage(nextImage, dockerHub.host);
    setImage(nextImage);
    if (!result.ok || result.tag !== null) setTargetTag('');
  }

  function changeSource(nextHost: string): void {
    const source = enabledSource(nextHost);
    if (!source) return;
    const imageName = explicit ? image.slice(image.indexOf('/') + 1) : image;
    if (!parseImage(imageName, dockerHub.host).ok) return;
    changeImage(source.host + '/' + imageName);
  }

  function showExample(): void {
    const source = enabledSource(sourceHost);
    if (!source) return;
    changeImage(source.host + '/' + source.example);
    imageInput.current?.focus();
  }

  const result = buildImageCommands(host, image, sourceHost, targetTag);
  const dockerConfig = JSON.stringify({ 'registry-mirrors': [origin] }, null, 2);

  return (
    <Card className="min-w-0" aria-labelledby="commands-title">
      <CardHeader>
        <CardTitle id="commands-title" className="text-lg">命令生成</CardTitle>
        <CardDescription>选择镜像源或粘贴完整镜像名，复制所用客户端的命令。</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="pull" className="min-w-0 gap-4">
          <TabsList aria-label="使用方式" className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger id="tab-pull" aria-controls="panel-pull" value="pull" className="text-xs sm:text-sm">拉取并还原镜像名</TabsTrigger>
            <TabsTrigger id="tab-docker" aria-controls="panel-docker" value="docker" className="text-xs sm:text-sm">默认 Docker Hub 配置</TabsTrigger>
          </TabsList>
          <TabsContent id="panel-pull" aria-labelledby="tab-pull" value="pull" className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(10rem,0.35fr)_minmax(0,1fr)]">
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
              <div className="grid min-w-0 gap-2">
                <Label htmlFor="image">原始镜像</Label>
                <Input ref={imageInput} id="image" type="text" value={image} placeholder={dockerHub.example} className="font-mono"
                  aria-describedby="image-hint image-feedback" aria-invalid={!result.ok}
                  autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={512}
                  onChange={event => changeImage(event.target.value)} />
              </div>
            </div>
            <div id="image-hint" className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span>未指定镜像源时默认 docker.io，完整镜像名会自动识别；支持标签或 SHA-256 摘要。</span>
              <Button id="example" type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={showExample}>使用示例</Button>
            </div>
            <p id="image-feedback" role="status" className={result.ok ? 'sr-only' : 'text-sm text-destructive'}>
              {result.ok ? '' : result.error}
            </p>
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
            <div className="grid items-start gap-4 md:grid-cols-2" role="group" aria-label="各客户端命令">
              {commandClients.map(client => {
                const command = client === 'docker' || !result.ok
                  ? result
                  : buildImageCommands(host, image, sourceHost, targetTag, client);
                return <CommandOutput key={client} kind="pull" client={client} value={command.ok ? command.commands : '—'} disabled={!command.ok} />;
              })}
            </div>
          </TabsContent>
          <TabsContent id="panel-docker" aria-labelledby="tab-docker" value="docker" className="min-w-0 space-y-4">
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>在 Linux 的 <code className="font-mono text-foreground">/etc/docker/daemon.json</code> 或 Docker Desktop 的 <strong className="font-medium text-foreground">Settings → Docker Engine</strong> 中合并以下配置。已有 <code className="font-mono text-foreground">registry-mirrors</code> 数组时，将地址加入原数组。</p>
              <p>Linux 可重载 Docker 配置。Docker Desktop 点击 <strong className="font-medium text-foreground">Apply &amp; restart</strong>，重启可能暂时中断运行中的容器。</p>
            </div>
            <CommandOutput kind="docker" value={dockerConfig} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
