# Reproducible-build image for @xchain-wallet/web - §51 / §55.
#
# Any third-party verifier can run `docker build` against this file at a
# specific tag and produce the exact same SPA bundle as the maintainer's
# official release. Combined with scripts/reproduce.sh this closes the
# Level-2 verification loop for the browser shell (see
# REPRODUCIBLE_BUILDS.md).
#
# Pinning rules mirror packages/desktop/Dockerfile:
#   - Base image pinned to a specific digest (not a tag) - tags move.
#   - Node pinned + SHA256-verified; changing Node means changing this
#     file (and bumping the minor version in REPRODUCIBLE_BUILDS.md).
#   - pnpm pinned via corepack - version comes from root package.json
#     `packageManager` (passed in as a build-arg by reproduce.sh).
#   - No `apt-get update` outside this Dockerfile so the base image is a
#     frozen reference.
#
# The image does NOT run the build itself - reproduce.sh mounts the
# source tree read-only + invokes scripts/build.sh. This lets the image
# be cached + reused across verifications of different release tags.

# Debian bookworm slim, digest-pinned (same digest as the desktop image
# so a verifier who already pulled one shell's base gets a cache hit).
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
#   - python3, make, g++ → node-gyp fallback for any native dep (e.g.
#          `sharp`, used by the extension icon pipeline; kept here so the
#          web + extension images stay byte-identical as base references)
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
# reproduce.sh. This file pinned 20.18.0 by hand while the release lane
# built the same bundle with 22.23.2, so the reproduction could not have
# matched on any host - the same defect the extension twin carried
#, for the same reason: toolchain.json names its consumers by
# hand and neither of these two was on the list.
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
# at build time - reproduce.sh copies that into a build-arg. Keeping the
# version out of this Dockerfile means bumping pnpm doesn't rebuild the
# image, which speeds up verification runs.
ARG PNPM_VERSION=11.8.0
RUN corepack prepare "pnpm@${PNPM_VERSION}" --activate

# Non-root user - matches host-UID on Linux so files produced in the
# mounted volume don't land root-owned. reproduce.sh passes `--user` with
# the invoking uid/gid; this USER is the fallback for manual runs.
RUN groupadd --gid 1000 builder \
    && useradd --uid 1000 --gid 1000 --shell /bin/bash --create-home builder
USER builder
WORKDIR /workspace

# reproduce.sh mounts the source tree at /workspace read-only + a separate
# writable output directory at /out. The build script inside the repo does
# the rest.
ENTRYPOINT ["bash", "packages/web/scripts/build.sh"]
