# Mirror / 镜像入口

[打开镜像入口](https://fengqi.dev)，选择镜像源并复制拉取与还原标签命令。服务运行在 Cloudflare Workers，为支持的公开镜像提供匿名入口，无需 VPS。

## 拉取公开镜像

在原始镜像名前加上代理域名。Docker Hub 的官方镜像使用 `docker.io/library/` 前缀。

```sh
docker pull fengqi.dev/docker.io/library/nginx:alpine
docker tag fengqi.dev/docker.io/library/nginx:alpine nginx:alpine

docker pull fengqi.dev/ghcr.io/mhsanaei/3x-ui:v3.7.0
docker pull fengqi.dev/registry.k8s.io/pause:3.10
```

`docker tag` 会为已拉取的镜像添加原始名称，不删除代理名称。按摘要拉取而未指定标签时，可在页面填写还原后的标签，再复制生成的两步命令。

页面同时展示以下四种客户端的拉取和标签还原命令，共用镜像源与镜像名称输入，每组命令可独立复制。不带镜像源的名称默认使用 `docker.io`；粘贴带镜像源的完整名称（例如 `ghcr.io/mhsanaei/3x-ui:v3.7.0`）时，会自动识别并切换到对应镜像源：

| 客户端 | 拉取命令 | 还原标签命令 |
| --- | --- | --- |
| Docker | `docker pull` | `docker tag` |
| Podman | `podman pull` | `podman tag` |
| containerd / ctr | `ctr images pull` | `ctr images tag` |
| Apple container（macOS） | `container image pull` | `container image tag` |

无法识别或尚未接入的镜像源、需要登录的源和格式错误会显示具体原因，并禁用四组命令的复制。输入应为镜像名称，不包含 `https://` 等 URL 协议头。

Podman、ctr 和 Apple container 的还原目标使用完整名称，例如 `docker.io/library/nginx:alpine`。这些客户端按摘要拉取时使用 `repo@sha256:…`，再根据原标签或手动填写的标签生成还原命令。ctr 默认使用 `default` 命名空间；如需 Kubernetes 的镜像存储，在两条命令的 `ctr` 后都加上 `-n k8s.io`。

命令语法参考：[Podman](https://docs.podman.io/en/latest/Commands.html)、[containerd](https://github.com/containerd/containerd/blob/main/docs/getting-started.md)、[Apple container](https://github.com/apple/container/blob/main/docs/command-reference.md)。目前完整镜像拉取的生产验证使用 Docker CLI；其他客户端的命令生成经过回归测试。

| 镜像源 | 示例 | 生产验证 |
| --- | --- | --- |
| `docker.io` | `library/busybox:latest` | 已完成 `busybox:latest` 和 `hello-world:latest` 拉取 |
| `ghcr.io` | `mhsanaei/3x-ui:v3.7.0` | 样本拉取流程成功，另通过代理验证镜像层分段下载 |
| `gcr.io` | `distroless/static-debian12:latest` | 样本拉取成功 |
| `quay.io` | `prometheus/busybox:latest` | 样本拉取成功 |
| `registry.k8s.io` | `pause:3.10` | 样本拉取成功 |
| `k8s.gcr.io` | `pause:3.10` | 兼容映射至 `registry.k8s.io`，样本拉取成功 |
| `mcr.microsoft.com` | `hello-world:latest` | 样本拉取成功 |
| `docker.elastic.co` | `elasticsearch/elasticsearch:8.17.0` | 接口已验证，清单和分段下载通过 |
| `nvcr.io` | `nvidia/cuda:12.6.3-base-ubuntu24.04` | 接口已验证，清单和分段下载通过 |

Docker Hub 的清单和镜像层优先查 `mirror.gcr.io`，未命中时回退到 Docker Hub。OCI Referrers 查询直接使用 Docker Hub 的结果。其他源在需要时由 Worker 获取匿名拉取令牌，用户凭据不用于这些上游请求。Cloudflare Workers 和各上游均有用量限制，Docker Hub 匿名额度用尽时，缓存未命中的请求仍会返回 HTTP 429。 [Google 公开缓存说明](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images)

服务仅提供公开镜像拉取。DHI 需要登录，目前未开放。Ollama 使用独立的模型 API，需要单独适配，当前入口未开放。

### 将 Docker Hub 设置为默认镜像源

在 Docker Engine 的 JSON 配置中合并下面的设置。已有 `registry-mirrors` 数组时，将地址加入原数组并保留其他配置。

```json
{
  "registry-mirrors": ["https://fengqi.dev"]
}
```

- Linux 编辑 `/etc/docker/daemon.json`，用 `sudo dockerd --validate --config-file /etc/docker/daemon.json` 校验，再向 `dockerd` 发送 `SIGHUP` 重载。
- Docker Desktop 打开 **Settings → Docker Engine**，合并配置后点击 **Apply & restart**。重启可能暂时中断运行中的容器。

用 `docker info` 查看 **Registry Mirrors**，再试 `docker pull busybox:latest`。这项配置用于 Docker Hub，其他镜像源使用上面的带前缀地址。 [Docker 镜像配置](https://docs.docker.com/docker-hub/image-library/mirror/)

## 构建与部署

使用 Vite、React、TypeScript、Tailwind CSS 和 [shadcn/ui](https://ui.shadcn.com/docs/installation)。建议使用 Node.js 22.22.3，与自动构建环境保持一致。

```text
index.html                 # Vite HTML 入口
vite.config.ts             # React、Tailwind 与构建配置
src/
  main.tsx                 # React 启动入口
  App.tsx                  # 应用装配
  pages/                   # 页面布局
  components/              # 业务组件
    ui/                    # shadcn/ui 基础组件
  hooks/                   # 主题等交互状态
  data/                    # 镜像源、客户端元数据
  lib/                     # 镜像解析、命令生成、通用工具
  styles/                  # 全局样式与主题
worker/index.ts            # Registry 代理入口
public/                    # 原样发布的静态文件
tests/                     # 命令、代理和静态资源路由测试
scripts/                   # Worker 构建和测试运行脚本
postman/                   # 本地代理测试使用的模拟上游
wrangler.jsonc             # Worker 与静态资源部署配置
```

Vite 将前端输出到 `dist/client/`，Worker 输出到 `dist/worker.mjs`。Cloudflare Static Assets 提供页面和带哈希的 JS/CSS 文件，Registry API 请求由 Worker 处理。

添加基础组件可运行 `npx shadcn@4.23.0 add <组件名>`；组件目录和样式路径由 `components.json` 配置。

```sh
npm ci
npm run dev
```

`npm run dev` 启动带热更新的前端开发服务。检查并构建生产产物：

```sh
npm run check
npm run build
npm run preview
```

`npm run preview` 预览前端产物。使用 `npm run dev:worker` 在本地同时运行构建后的前端和镜像代理。

部署时登录自己的 Cloudflare 账号。

```sh
npx wrangler login
npm run deploy
```

部署后可使用 Wrangler 给出的 `workers.dev` 地址。自定义域名在 Cloudflare 控制台的 Worker **域（Domains）** 页面中管理。使用自己的域名时，将上面的代理地址替换为你的域名。 [Cloudflare 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

### GitHub 自动部署

本仓库已通过 Cloudflare Workers Builds 关联到 `docker-proxy`。推送 `main` 会自动构建并部署到 [fengqi.dev](https://fengqi.dev)。

| 设置 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 根目录 | `/` |
| 构建命令 | `npm run check && npm run build` |
| 部署命令 | `npx wrangler deploy --no-bundle` |
| 构建变量 | `NODE_VERSION=22.22.3` |
| 预览构建 | 关闭 |

分叉部署时，在自己 Worker 的 **Settings → Builds** 中连接自己的仓库，并确保 `wrangler.jsonc` 中的 `name` 与 Worker 名称一致。构建记录位于 Cloudflare 的部署页面。 [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)

## 本地测试

命令生成的回归测试无需 Postman：

```sh
npm run test:ui
```

安装支持 `simulation run` 的 Postman CLI 1.75.0 或更高版本，并将它加入 `PATH`。测试使用本地模拟，无需 Postman 云工作区账号。`npm test` 会构建 Worker，在 `localhost:41743` 启动模拟并验证构建产物。

```sh
npm test
```

也可以通过 `POSTMAN_BIN=/path/to/postman npm test` 指定 CLI 的位置。

在另一个终端运行 `npm run dev:worker` 后，可检查页面、静态资源和 Registry API 的分流：

```sh
SMOKE_BASE_URL=http://127.0.0.1:8787 npm run test:smoke
```

2026-11-09：严格类型检查、构建、35 项代理测试、21 项命令生成测试和静态资源/API 路由检查通过。线上验证范围见上表及 [验证记录](VERIFICATION.md)。
