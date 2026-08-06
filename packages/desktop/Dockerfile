# Reproducible-build image for @xchain-wallet/desktop - §51 / §40.12.
#
# Any third-party verifier can run `docker build` against this file at a
# specific tag and produce the exact same pre-signing artifact as the
# maintainer's official release. Combined with reproduce.sh, this
# closes the Level-2 verification loop (see REPRODUCIBLE_BUILDS.md).
#
# Pinning rules:
#   - Base image pinned to a specific digest (not a tag) - tags move.
#   - Node pinned to an EXACT patch, and to the same one the release
#     lanes install. Both live in tools/release/toolchain.json and
#     test/smoke/audits/reproducible-toolchain.smoke.js fails the build
#     if this file and that one disagree. A version pinned here but
#     floating in CI is not a pin: it silently guarantees the verifier
#     and the maintainer build with different toolchains.
#   - pnpm pinned via corepack - version comes from root package.json
#     `packageManager`.
#   - No `apt-get update` in the build step itself; all system deps
#     install in this Dockerfile so the base image is a frozen
#     reference. A verifier re-building the image pulls the same
#     digest and gets identical system packages.
#
# The image does NOT run the build itself - `reproduce.sh` mounts the
# source tree read-only + invokes the build. This lets the image be
# cached + reused across verifications of different release tags.

# Debian bookworm slim, digest-pinned. Chosen over Alpine because
# electron-builder's Linux target needs glibc + fpm (both less painful
# on Debian-family bases).
#
# This digest's index carries exactly one real manifest, linux/amd64, so
# the image is amd64 and only amd64. That matches the release lane, which
# runs on ubuntu-latest and cross-builds the arm64 artifact from there -
# an arm64 container would faithfully reproduce a build we never cut.
# reproduce.sh passes --platform linux/amd64 explicitly so a verifier on
# an arm64 host emulates deliberately rather than by accident.
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
#   - git → pnpm install may reach for git-hosted deps (xchain-sdk
#          under local development; benign in CI)
#   - python3, make, g++ → node-gyp fallback (no native deps today,
#          but electron-builder expects them to be present)
#   - rpm, fakeroot, dpkg → .deb / .rpm packaging via fpm
#   - libarchive-tools → bsdtar, used by electron-builder for
#          deterministic tar/zip creation
#   - locales → sets C.UTF-8 cleanly
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        dpkg \
        fakeroot \
        g++ \
        git \
        libarchive-tools \
        locales \
        make \
        python3 \
        rpm \
        xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && locale-gen C.UTF-8

# Install Node at the pinned version. Official tarballs, SHA256-verified.
#
# These two defaults are the copy a third party gets from a bare
# `docker build -f Dockerfile`, so they must equal what the release lanes
# install. tools/release/toolchain.json is the source of truth, the smoke
# test enforces the equality, and reproduce.sh passes the values through
# as build args so a stale default cannot survive a real reproduction.
# Upgrading Node means editing toolchain.json and these together.
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
# at build time - reproduce.sh copies that into a build-arg. Keeping
# the version out of this Dockerfile means bumping pnpm doesn't rebuild
# the image, which speeds up verification runs.
ARG PNPM_VERSION=11.8.0
RUN corepack prepare "pnpm@${PNPM_VERSION}" --activate

# Non-root user - matches host-UID on Linux so files produced in the
# mounted volume don't land root-owned. reproduce.sh passes `--user`
# with the invoking uid/gid; this USER is the fallback for manual runs.
RUN groupadd --gid 1000 builder \
    && useradd --uid 1000 --gid 1000 --shell /bin/bash --create-home builder
USER builder
WORKDIR /workspace

# `reproduce.sh` mounts a throwaway git worktree at /workspace WRITABLE,
# plus a separate output directory at /out. The build script inside the
# repo does the rest.
#
# It used to mount /workspace read-only, which cannot work and never did:
# `pnpm install` writes node_modules and electron-builder writes dist/,
# both under /workspace, so the very first step died on EROFS. What the
# `:ro` was reaching for - reproducing from the ref rather than from
# whatever is lying around in the checkout - is already guaranteed by
# building a detached worktree of the commit, which reproduce.sh creates
# and deletes around the run. The flag added no isolation, only failure.
ENTRYPOINT ["bash", "packages/desktop/scripts/build.sh"]
