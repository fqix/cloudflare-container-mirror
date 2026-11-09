type PullState = 'verified' | 'api-verified' | 'pending';
type SourceState = PullState | 'login' | 'api';

interface EnabledSource {
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

type ImageSource = EnabledSource | DisabledSource;

type ImageResult =
  | {
      ok: true;
      source: EnabledSource;
      path: string;
      tagSourcePath: string;
      canonicalRepo: string;
      tag: string | null;
    }
  | { ok: false; error: string };

const dockerHub: EnabledSource = {
  host: 'docker.io',
  label: 'Docker Hub',
  example: 'nginx:alpine',
  state: 'verified',
  detail: 'Google 缓存优先',
};

// Mark a source verified only after a complete public image pull.
const sourceInfo: readonly ImageSource[] = [
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
const statuses: Record<SourceState, string> = {
  verified: '已验证',
  'api-verified': '接口已验证',
  pending: '待最终验证',
  login: '需登录',
  api: '待适配',
};
const sourceByHost = new Map<string, ImageSource>(sourceInfo.map(source => [source.host, source]));
sourceByHost.set('index.docker.io', dockerHub);
sourceByHost.set('registry-1.docker.io', dockerHub);
const component = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const repositoryPattern = new RegExp('^' + component + '(?:/' + component + ')*$');
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

function explicitSource(text: string): ImageSource | undefined {
  const slash = text.indexOf('/');
  return slash === -1 ? undefined : sourceByHost.get(text.slice(0, slash));
}

function invalidImage(error: string): ImageResult {
  return { ok: false, error };
}

function parseImage(text: string, selectedHost: string): ImageResult {
  if (!text || text.length > 512 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    return invalidImage('请输入有效的镜像名，镜像名中不能包含空格或命令符。');
  }
  const explicit = explicitSource(text);
  const source = explicit || sourceByHost.get(selectedHost);
  let image = text;
  const slash = text.indexOf('/');
  if (explicit) {
    image = text.slice(slash + 1);
  } else if (slash !== -1) {
    const first = text.slice(0, slash);
    if (first === 'localhost' || first.includes('.') || first.includes(':')) {
      return invalidImage('该镜像源尚未接入。请选择下方列表中的公开镜像源。');
    }
  }
  if (!source) return invalidImage('请选择镜像源。');
  if (source.disabled) {
    if (source.state === 'login') return invalidImage('该镜像源需要登录，公开入口暂不支持。');
    if (source.state === 'api') return invalidImage('Ollama 使用原生模型 API，此入口尚未适配。');
    return invalidImage('该镜像源暂未开放。');
  }
  const at = image.indexOf('@');
  const digest = at === -1 ? null : image.slice(at + 1);
  const named = at === -1 ? image : image.slice(0, at);
  const colon = named.indexOf(':');
  const tag = colon === -1 ? null : named.slice(colon + 1);
  let repository = colon === -1 ? named : named.slice(0, colon);
  if (!repositoryPattern.test(repository) || repository.length > 255 ||
      (tag !== null && !tagPattern.test(tag)) ||
      (digest !== null && !digestPattern.test(digest))) {
    return invalidImage('仓库名应使用小写字母。请检查标签或 SHA-256 摘要的格式。');
  }
  if (source.namespace && !repository.includes('/')) {
    return invalidImage('该镜像源需要仓库命名空间，例如 ' + source.example + '。');
  }
  if (source.host === dockerHub.host && !repository.includes('/')) {
    repository = 'library/' + repository;
  }
  const effectiveTag = tag ?? (digest ? null : 'latest');
  const tagPart = effectiveTag ? ':' + effectiveTag : '';
  const digestPart = digest ? '@' + digest : '';
  const repositoryPath = source.host + '/' + repository;
  const canonicalRepo = source.host === dockerHub.host
    ? repository.replace(/^library\/([^/]+)$/, '$1')
    : repositoryPath;
  return {
    ok: true,
    source,
    path: repositoryPath + tagPart + digestPart,
    // Docker stores pulls by digest under repo@digest even when the pull command includes a tag.
    tagSourcePath: repositoryPath + (digest ? digestPart : tagPart),
    canonicalRepo,
    tag: effectiveTag,
  };
}

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error('Missing or invalid UI element: ' + id);
  return element;
}

const sourceSelect = requireElement('source', HTMLSelectElement);
const sourceTable = requireElement('sources', HTMLTableSectionElement);
const imageInput = requireElement('image', HTMLInputElement);
const restoreTagField = requireElement('restore-tag-field', HTMLElement);
const restoreTagInput = requireElement('restore-tag', HTMLInputElement);
const restoreTagFeedback = requireElement('restore-tag-feedback', HTMLElement);
const pullCommand = requireElement('pull-command', HTMLElement);
const copyPull = requireElement('copy-pull', HTMLButtonElement);
const pullFeedback = requireElement('pull-feedback', HTMLElement);
const dockerConfig = requireElement('docker-config', HTMLElement);
const dockerFeedback = requireElement('docker-feedback', HTMLElement);
const host = location.host || 'docker.fengqi.dev';
const origin = location.origin === 'null' ? 'https://' + host : location.origin;

for (const source of sourceInfo) {
  if (!source.disabled) {
    const option = document.createElement('option');
    option.value = source.host;
    option.textContent = source.host;
    sourceSelect.append(option);
  }
  const row = document.createElement('tr');
  const name = document.createElement('th');
  name.scope = 'row';
  const code = document.createElement('code');
  code.textContent = source.host;
  code.title = source.label;
  name.append(code);
  const status = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = 'status ' + source.state;
  badge.textContent = statuses[source.state];
  status.append(badge);
  const detail = document.createElement('td');
  detail.textContent = source.detail;
  row.append(name, status, detail);
  sourceTable.append(row);
}

function render(): void {
  const source = explicitSource(imageInput.value);
  if (source && !source.disabled) sourceSelect.value = source.host;
  const result = parseImage(imageInput.value, sourceSelect.value);
  imageInput.setAttribute('aria-invalid', String(!result.ok));
  pullFeedback.classList.toggle('error', !result.ok);
  pullFeedback.textContent = result.ok ? '' : result.error;
  copyPull.disabled = !result.ok;
  const needsTargetTag = result.ok && result.tag === null;
  restoreTagField.hidden = !needsTargetTag;
  if (!needsTargetTag) restoreTagInput.value = '';
  const manualTag = restoreTagInput.value;
  const invalidTag = manualTag !== '' && !tagPattern.test(manualTag);
  restoreTagInput.setAttribute('aria-invalid', String(invalidTag));
  restoreTagFeedback.classList.toggle('error', invalidTag);
  restoreTagFeedback.textContent = '';
  if (needsTargetTag && !manualTag) {
    restoreTagFeedback.textContent = '填写目标标签后可生成还原命令。';
  } else if (invalidTag) {
    restoreTagFeedback.textContent = '标签格式无效，当前只生成拉取命令。';
  }
  if (!result.ok) {
    pullCommand.textContent = '请检查镜像地址';
    return;
  }

  const commands = ['docker pull ' + host + '/' + result.path];
  const targetTag = result.tag ?? (invalidTag ? '' : manualTag);
  if (targetTag) {
    commands.push('docker tag ' + host + '/' + result.tagSourcePath + ' ' + result.canonicalRepo + ':' + targetTag);
  }
  pullCommand.textContent = commands.join('\n');
}

sourceSelect.addEventListener('change', () => {
  if (explicitSource(imageInput.value)) imageInput.value = imageInput.value.slice(imageInput.value.indexOf('/') + 1);
  render();
});
imageInput.addEventListener('input', render);
restoreTagInput.addEventListener('input', render);
requireElement('example', HTMLButtonElement).addEventListener('click', () => {
  const source = sourceByHost.get(sourceSelect.value);
  if (!source || source.disabled) return;
  imageInput.value = source.example;
  imageInput.focus();
  render();
});
dockerConfig.textContent = JSON.stringify({ 'registry-mirrors': [origin] }, null, 2);

async function copyValue(code: HTMLElement, feedback: HTMLElement): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(code.textContent ?? '');
    feedback.textContent = '已复制';
  } catch {
    const selection = window.getSelection();
    if (!selection) {
      feedback.textContent = '请手动复制。';
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(range);
    feedback.textContent = '已选中，请手动复制。';
  }
}
copyPull.addEventListener('click', () => { void copyValue(pullCommand, pullFeedback); });
requireElement('copy-docker', HTMLButtonElement).addEventListener('click', () => { void copyValue(dockerConfig, dockerFeedback); });

const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role=tab]'));
function activateTab(index: number, focus: boolean): void {
  tabs.forEach((tab, i) => {
    const active = index === i;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = tab.getAttribute('aria-controls');
    if (panel) requireElement(panel, HTMLElement).hidden = !active;
  });
  if (focus) tabs[index]?.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateTab(index, false));
  const positions = new Map<string, number>([
    ['ArrowLeft', (index + tabs.length - 1) % tabs.length],
    ['ArrowRight', (index + 1) % tabs.length],
    ['Home', 0],
    ['End', tabs.length - 1],
  ]);
  tab.addEventListener('keydown', event => {
    const next = positions.get(event.key);
    if (next === undefined) return;
    event.preventDefault();
    activateTab(next, true);
  });
});

render();

export {};
