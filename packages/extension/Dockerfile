# Reproducible-build image for @xchain-wallet/extension - §51 / §55.
#
# Any third-party verifier can run `docker build` against this file at a
# specific tag and produce the same unpacked MV3 bundle as the
# maintainer's pre-submission artifact. Combined with scripts/reproduce.sh
# this closes the Level-2 verification loop for the extension shell (see
# REPRODUCIBLE_BUILDS.md).
#
# Honesty note (also in REPRODUCIBLE_BUILDS.md): the unpacked `dist/` is
# reproducible against a fixed lockfile, but the published `.crx` is NOT
# byte-for-byte the same - the Chrome Web Store re-packages + re-signs the
# final bytes. What a verifier reproduces here is the pre-store bundle.
#
# Pinning rules mirror packages/desktop/Dockerfile:
#   - Base image pinned to a specific digest (not a tag) - tags move.
#   - Node pinned + SHA256-verified, from tools/release/toolchain.json;
#     changing Node means changing THAT file (and bumping the minor
#     version in REPRODUCIBLE_BUILDS.md), never this one alone.
#   - pnpm pinned via corepack - version comes from root package.json
#     `packageManager` (passed in as a build-arg by reproduce.sh).
#
# THE NODE PIN WAS A HARDCODED `ENV NODE_VERSION=20.18.0` HERE, AND THE
# RELEASE LANE BUILDS THIS BUNDLE WITH 22.23.2. Both facts were true from
# the day toolchain.json landed: it lists its consumers and this file is
# not among them, because the pin was fixed for the desktop twin and the
# extension was missed. So the two halves of §6 step 3 disagreed by a Node
# major, the reproduction could not have matched the release on any host,
# and the mismatch would have read to a verifier following the published
# protocol as supply-chain tampering - which is the exact failure
# toolchain.json's own header describes and was written to end. The pins
# are ARGs now and reproduce.sh feeds them from toolchain.json, so this
# file cannot drift from the release lane again without the smoke saying
# so (test/smoke/audits/reproducible-toolchain.smoke.js).

# Debian bookworm slim, digest-pinned (same digest as the desktop + web
# images so a verifier who already pulled one base gets a cache hit).
#
# The digest's index carries exactly one real manifest, linux/amd64, so
# reproduce.sh passes --platform explicitly: an arm64 verifier emulates on
# purpose rather than discovering it by accident. Without that flag the
# build died at the Node install with a bare `exit code: 133`, because the
# x64 tarball below cannot execute on an arm64 image - measured on an
# arm64 host 2026-08-02, and the reason it names no cause is that the
# failure is an exec-format error inside a RUN layer.
FROM debian:bookworm-slim@sha256:40b107342c492725bc7aacbe93a49945445191ae364184a6d24fedb28172f6f7

ENV DEBIAN_FRONTEND=noninteractive \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    TZ=UTC \
    # SOURCE_DATE_EPOCH is set at BUILD time by reproduce.sh (from the
    # tag's commit date), not baked into the image.
    PNPM_HOME=/usr/local/pnpm

# System deps:
#   - curl, ca-certificates, xz-utils → Node binary download
#   - git → pnpm install may reach for git-hosted deps (xchain-sdk under
#          local development; benign in CI)
#   - python3, make, g++ → node-gyp fallback for `sharp` (icon resize
#          pipeline in vite.config.js). sharp usually resolves a prebuilt
#          binary, but the toolchain is kept present so a fallback build
#          stays deterministic rather than failing the reproduction.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        g++ \
        git \
        make \
        python3 \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Node at the pinned version. Official tarballs, SHA256-verified.
# Both values come from tools/release/toolchain.json by way of
# reproduce.sh; the defaults here only keep a bare `docker build` honest
# and are held to that file by the toolchain smoke. Upgrading Node is an
# edit to toolchain.json, never to these two lines.
ARG NODE_VERSION=22.23.2
ARG NODE_SHA256_X64=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307
ENV NODE_VERSION=${NODE_VERSION}
RUN curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && echo "${NODE_SHA256_X64}  node-v${NODE_VERSION}-linux-x64.tar.xz" | sha256sum -c - \
    && tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /usr/local --strip-components=1 --no-same-owner \
    && rm "node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && corepack enable \
    && node --version

# pnpm version comes from the root package.json's `packageManager` field
# at build time - reproduce.sh copies that into a build-arg.
ARG PNPM_VERSION=9.0.0
RUN corepack prepare "pnpm@${PNPM_VERSION}" --activate

# Non-root user - matches host-UID on Linux so files produced in the
# mounted volume don't land root-owned.
RUN groupadd --gid 1000 builder \
    && useradd --uid 1000 --gid 1000 --shell /bin/bash --create-home builder
USER builder
WORKDIR /workspace

# reproduce.sh mounts the source tree at /workspace read-only + a separate
# writable output directory at /out.
ENTRYPOINT ["bash", "packages/extension/scripts/build.sh"]
