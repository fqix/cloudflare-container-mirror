import { ArrowUpRight, Terminal } from 'lucide-react';
import { ThemeToggle } from './components/theme-toggle';
import { Button } from './components/ui/button';
import { HomePage } from './pages/home-page';

const repository = 'https://github.com/fqix/cloudflare-container-mirror';

interface AppProps {
  host: string;
  origin: string;
}

export function App({ host, origin }: AppProps) {
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
            <ThemeToggle />
          </div>
        </div>
      </header>

      <HomePage host={host} origin={origin} />

      <footer className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-muted-foreground sm:px-6">
        仅提供公开镜像拉取。上传及私有仓库认证暂不支持。Ollama 模型需要原生 API，此入口尚未适配。
      </footer>
    </>
  );
}
