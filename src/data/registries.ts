type PullState = 'verified' | 'api-verified' | 'pending';
type SourceState = PullState | 'login' | 'api';

export interface EnabledSource {
  host: string;
  label: string;
  example: string;
  state: PullState;
  detail: string;
  namespace?: boolean;
  disabled?: false;
}

interface DisabledSource {
  host: string;
  label: string;
  state: SourceState;
  detail: string;
  disabled: true;
}

export type ImageSource = EnabledSource | DisabledSource;

export const dockerHub: EnabledSource = {
  host: 'docker.io',
  label: 'Docker Hub',
  example: 'nginx:alpine',
  state: 'verified',
  detail: 'Google 缓存优先',
};

// Mark a source verified only after a complete public image pull.
export const sourceInfo: readonly ImageSource[] = [
  dockerHub,
  { host: 'ghcr.io', label: 'GitHub Container Registry', example: 'mhsanaei/3x-ui:v3.7.0', state: 'verified', namespace: true, detail: '公开镜像' },
  { host: 'gcr.io', label: 'Google Container Registry', example: 'distroless/static-debian12:latest', state: 'verified', namespace: true, detail: '公开镜像' },
  { host: 'registry.k8s.io', label: 'Kubernetes Registry', example: 'pause:3.10', state: 'verified', detail: 'Kubernetes 公开镜像' },
  { host: 'k8s.gcr.io', label: 'Kubernetes Registry 旧域名', example: 'pause:3.10', state: 'verified', detail: '映射至 registry.k8s.io' },
  { host: 'mcr.microsoft.com', label: 'Microsoft Container Registry', example: 'hello-world:latest', state: 'verified', detail: '公开镜像' },
  { host: 'quay.io', label: 'Quay', example: 'prometheus/busybox:latest', state: 'verified', namespace: true, detail: '公开镜像' },
  { host: 'docker.elastic.co', label: 'Elastic Registry', example: 'elasticsearch/elasticsearch:8.17.0', state: 'api-verified', namespace: true, detail: '公开镜像' },
  { host: 'nvcr.io', label: 'NVIDIA NGC', example: 'nvidia/cuda:12.6.3-base-ubuntu24.04', state: 'api-verified', namespace: true, detail: '公开镜像' },
  { host: 'dhi.io', label: 'Docker Hardened Images', state: 'login', disabled: true, detail: '需要登录' },
  { host: 'registry.ollama.ai', label: 'Ollama', state: 'api', disabled: true, detail: '模型 API，待单独适配' },
];
export const statuses: Record<SourceState, string> = {
  verified: '已验证',
  'api-verified': '接口已验证',
  pending: '待最终验证',
  login: '需登录',
  api: '待适配',
};
const sourceByHost = new Map<string, ImageSource>(sourceInfo.map(source => [source.host, source]));
sourceByHost.set('index.docker.io', dockerHub);
sourceByHost.set('registry-1.docker.io', dockerHub);
export function sourceForHost(host: string): ImageSource | undefined {
  return sourceByHost.get(host);
}

export function enabledSource(host: string): EnabledSource | undefined {
  const source = sourceByHost.get(host);
  return source?.disabled ? undefined : source;
}
