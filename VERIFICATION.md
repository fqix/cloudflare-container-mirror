# Verification

Verified on **2026-11-09**. Production source is `worker/index.ts`; `tests/proxy.test.mjs` tests the built `dist/worker.mjs` bundle. Core SHA256: `8969903c55ce1dc0c08a65ed74219b0986327a24c927362cb5e26135be8d19bc`.

`npm run check` and `npm run build` passed. **`npm test` passed all 35 tests against the TypeScript-built bundle, including NVCR.** The test runner starts and stops a local Postman simulation automatically. It needs Node.js 22 and Postman CLI 1.75.0 or newer; fixtures require no cloud workspace or account. `POSTMAN_BIN` can select the CLI executable.

The standard Vite layout builds static files in `dist/client/` and a separate proxy in `dist/worker.mjs`. Both the Vite development page and the complete local Wrangler page rendered correctly. **The static-routing smoke test passed:** HTML, emitted JavaScript and CSS returned 200 with the expected content types; `/v2/` returned the registry JSON response; missing API and asset paths retained JSON 404 responses without an SPA fallback.

The React interface uses official shadcn/ui components with neutral light and dark themes. `npm run test:ui` passed all **19 command-generation regression tests**, covering Docker, Podman, ctr and Apple container, tag restoration, digest references and unsafe input rejection. The latter three clients were checked against their official command documentation and source, not by running their image pull workflows. Browser checks covered theme switching, source selection, clipboard copying, digest-only target tags, invalid tags and the Docker configuration tab.

The canonical domain is **https://fengqi.dev**. Its `/v2/` endpoint returned HTTP 200 with successful TLS verification, and `docker pull fengqi.dev/docker.io/library/busybox:latest` completed successfully. The tests below also cover the same proxy core through its earlier domain.

The tests exercise actual Worker handlers over local HTTP fixtures: prefix routing, fixed-endpoint anonymous authentication, credential isolation, bounded token responses, streaming, HEAD/Range, cache fallback, real error preservation, native referrers, pagination, redirect limits and rejection of untrusted targets. They establish behavior against the modeled dependencies; the production checks below separately establish live reachability for the listed samples.

| Source | Sample | Production result |
| --- | --- | --- |
| Docker Hub | `docker.io/library/busybox:latest` | Docker CLI pull completed; the legacy unprefixed path was also verified with BusyBox and hello-world. |
| GHCR | `ghcr.io/mhsanaei/3x-ui:v3.7.0` | Docker CLI pull completed using locally cached layers. A separate request through the Worker read one byte with HTTP 206 from an 80,769,127-byte layer, verifying the live CDN path. |
| GCR | `gcr.io/distroless/static-debian12:latest` | Docker CLI pull completed. |
| Kubernetes | `registry.k8s.io/pause:3.10` | Docker CLI pull completed. The `k8s.gcr.io` alias also completed the full CLI flow. |
| MCR | `mcr.microsoft.com/hello-world:latest` | Docker CLI pull completed. |
| Quay | `quay.io/prometheus/busybox:latest` | Docker CLI pull completed. |
| Elastic | `docker.elastic.co/elasticsearch/elasticsearch:8.17.0` | Index and platform-manifest GET/HEAD 200; config and layer HEAD 200 and one-byte Range 206. Referrers returned the real upstream 404. Large image not fully downloaded. |
| NVCR | `nvcr.io/nvidia/cuda:12.6.3-base-ubuntu24.04` | Index and platform-manifest GET/HEAD 200; config and layer HEAD 200 and one-byte Range 206. Referrers returned a real empty index with HTTP 200. Large image not fully downloaded. |

These production checks used Worker revision `225754f5`. They validate the named public samples, not every tag, private image or licensed image. DHI and Ollama are not enabled.

New sources ignore client Authorization and cookies. When required, the Worker validates a known challenge, obtains an anonymous pull token from that source's fixed auth endpoint, reads at most 64 KiB, and retries once. That token is sent only to the same registry API, never its CDN. The legacy Docker Hub client Bearer flow remains restricted to Hub; Basic credentials are not forwarded. No account pool, PAT storage or refresh tokens are used.

Hub manifests and blobs try the selective Google cache first; misses can still receive Hub's real anonymous-rate-limit 429. Hub referrers go directly to the authoritative Hub endpoint. Other sources preserve their native discovery results. No empty referrer index or not-found result is synthesized. Safe same-path pagination links are rewritten to the client prefix; unsupported links fail explicitly. Response bodies stream, so a failure after headers have been returned requires a client retry.

Redirect hosts and paths are bounded by provider documentation and the observed sample requests. They are not a promise that future provider backend changes will work without an allowlist update. No real tokens, signed download URLs or server addresses are retained in the published test fixtures.

Provider references: [Docker Registry authentication](https://docs.docker.com/reference/api/registry/auth/), [Google's selective Docker Hub cache](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images), [Docker endpoint allowlist](https://docs.docker.com/desktop/enterprise/allow-list/), [GitHub container endpoints](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Quay firewall endpoints](https://docs.redhat.com/en/documentation/openshift_container_platform_installation/4.15/html/installation_configuration/configuring-firewall), [Kubernetes request routing](https://github.com/kubernetes/registry.k8s.io/blob/main/cmd/archeio/docs/request-handling.md), [Microsoft registry firewall rules](https://github.com/microsoft/containerregistry/blob/main/docs/client-firewall-rules.md), and [containerd referrer discovery](https://github.com/containerd/containerd/blob/main/core/remotes/docker/referrers.go).
