# Mirror / 镜像入口

[打开镜像入口](https://docker.fengqi.dev)，选择镜像源并复制拉取与还原标签命令。服务运行在 Cloudflare Workers，为支持的公开镜像提供匿名入口，无需 VPS。

## 拉取公开镜像

在原始镜像名前加上代理域名。Docker Hub 的官方镜像使用 `docker.io/library/` 前缀。

```sh
docker pull docker.fengqi.dev/docker.io/library/nginx:alpine
docker tag docker.fengqi.dev/docker.io/library/nginx:alpine nginx:alpine

docker pull docker.fengqi.dev/ghcr.io/mhsanaei/3x-ui:v3.7.0
docker pull docker.fengqi.dev/registry.k8s.io/pause:3.10
```

`docker tag` 会为已拉取的镜像添加原始名称，不删除代理名称。按摘要拉取而未指定标签时，可在页面填写还原后的标签，再复制生成的两步命令。

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
  "registry-mirrors": ["https://docker.fengqi.dev"]
}
```

- Linux 编辑 `/etc/docker/daemon.json`，用 `sudo dockerd --validate --config-file /etc/docker/daemon.json` 校验，再向 `dockerd` 发送 `SIGHUP` 重载。
- Docker Desktop 打开 **Settings → Docker Engine**，合并配置后点击 **Apply & restart**。重启可能暂时中断运行中的容器。

用 `docker info` 查看 **Registry Mirrors**，再试 `docker pull busybox:latest`。这项配置用于 Docker Hub，其他镜像源使用上面的带前缀地址。 [Docker 镜像配置](https://docs.docker.com/docker-hub/image-library/mirror/)

## 构建与部署

需要 Node.js 22 或更高版本。`src/worker.ts` 是代理入口，`src/ui.ts` 是页面交互，`src/page.html` 是页面模板。构建将它们合并为 `dist/worker.mjs` 单文件。

```sh
npm ci
npm run check
npm run build
npm run dev
```

部署时登录自己的 Cloudflare 账号。

```sh
npx wrangler login
npm run deploy
```

部署后可使用 Wrangler 给出的 `workers.dev` 地址。自定义域名在 Cloudflare 控制台的 **Workers & Pages → Worker → Settings → Domains & Routes** 中管理。使用自己的域名时，将上面的代理地址替换为你的域名。 [Cloudflare 自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## 本地测试

安装支持 `simulation run` 的 Postman CLI 1.75.0 或更高版本，并将它加入 `PATH`。测试使用本地模拟，无需 Postman 云工作区账号。`npm test` 会构建 Worker，在 `localhost:41743` 启动模拟并验证构建产物。

```sh
npm test
```

也可以通过 `POSTMAN_BIN=/path/to/postman npm test` 指定 CLI 的位置。

2026-11-09：严格类型检查、构建和 35 项代理测试通过。线上验证范围见上表及 [验证记录](VERIFICATION.md)。
