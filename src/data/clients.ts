export const clientInfo = {
  docker: { label: 'Docker', prefix: 'docker' },
  podman: { label: 'Podman', prefix: 'podman' },
  ctr: { label: 'ctr', prefix: 'ctr images' },
  container: { label: 'Apple container', prefix: 'container image' },
} as const;

export type ClientId = keyof typeof clientInfo;

export function isClientId(value: string): value is ClientId {
  return Object.hasOwn(clientInfo, value);
}
