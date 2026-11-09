import { clientInfo, type ClientId } from '../data/clients';
import { dockerHub, sourceForHost, type EnabledSource, type ImageSource } from '../data/registries';

export type ImageResult =
  | {
      ok: true;
      source: EnabledSource;
      path: string;
      tagSourcePath: string;
      repositoryPath: string;
      canonicalRepo: string;
      tag: string | null;
    }
  | { ok: false; error: string };

const component = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const repositoryPattern = new RegExp('^' + component + '(?:/' + component + ')*$');
const tagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

export function explicitSource(text: string): ImageSource | undefined {
  const slash = text.indexOf('/');
  return slash === -1 ? undefined : sourceForHost(text.slice(0, slash));
}

function invalidImage(error: string): ImageResult {
  return { ok: false, error };
}

export function parseImage(text: string, selectedHost: string): ImageResult {
  if (!text || text.length > 512 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    return invalidImage('请输入有效的镜像名，镜像名中不能包含空格或命令符。');
  }
  const explicit = explicitSource(text);
  const source = explicit || sourceForHost(selectedHost);
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
    repositoryPath,
    canonicalRepo,
    tag: effectiveTag,
  };
}

export type CommandResult =
  | { ok: true; commands: string; needsTargetTag: boolean; targetTagError: string | null }
  | { ok: false; error: string };

export function buildImageCommands(
  host: string,
  text: string,
  selectedHost: string,
  manualTag = '',
  client: ClientId = 'docker',
): CommandResult {
  const result = parseImage(text, selectedHost);
  if (!result.ok) return result;

  const needsTargetTag = result.tag === null;
  const invalidTag = needsTargetTag && manualTag !== '' && !tagPattern.test(manualTag);
  const targetTag = result.tag ?? (invalidTag ? '' : manualTag);
  const prefix = clientInfo[client].prefix;
  // Use the same canonical digest reference for pulling and tagging with other clients.
  const pullPath = client === 'docker' ? result.path : result.tagSourcePath;
  const targetRepo = client === 'docker' ? result.canonicalRepo : result.repositoryPath;
  const commands = [prefix + ' pull ' + host + '/' + pullPath];
  if (targetTag) {
    commands.push(prefix + ' tag ' + host + '/' + result.tagSourcePath + ' ' + targetRepo + ':' + targetTag);
  }
  return {
    ok: true,
    commands: commands.join('\n'),
    needsTargetTag,
    targetTagError: invalidTag ? '标签格式无效，当前只生成拉取命令。' : null,
  };
}
