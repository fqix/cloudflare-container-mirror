import { CommandGenerator } from '../components/command-generator';
import { RegistryTable } from '../components/registry-table';
import { Badge } from '../components/ui/badge';

interface HomePageProps {
  host: string;
  origin: string;
}

export function HomePage({ host, origin }: HomePageProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6">
      <section aria-labelledby="title" className="space-y-3 pt-9 pb-7 sm:pt-12 sm:pb-8">
        <Badge variant="secondary">公共容器镜像</Badge>
        <h1 id="title" className="text-3xl font-semibold tracking-tight sm:text-4xl">拉取镜像，保持原名</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          通过 Cloudflare 拉取公开容器镜像。Docker Hub 优先查询 Google 公开缓存，未命中时仍受匿名拉取限额约束。
        </p>
      </section>

      <div className="grid gap-4 lg:gap-5">
        <CommandGenerator host={host} origin={origin} />
        <RegistryTable />
      </div>
    </main>
  );
}
