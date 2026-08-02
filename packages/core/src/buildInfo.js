// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Build-time wallet metadata used by user-facing surfaces (About panel,
// diagnostic dump, threat-model link).
//
// Synchronized-version note: this constant is updated alongside every
// package.json bump per the wallet's synchronized-versioning rule.
// See CHANGELOG.md for the version's release context.
//
// It is the version a USER sees, in the About panel and the diagnostic
// dump, which makes it the copy that matters most and the one that went
// wrong quietest: it sat at 0.333.0 while the root and the shipped
// extension were at 0.333.1, so About under-reported the build for as long
// as that drift lasted, and the only check on it compared this constant to
// core's package.json, which was equally stale (, 2026-08-01).
// test/smoke/audits/version-lockstep.smoke.js now holds it to the ROOT.

export const WALLET_VERSION = '0.333.1';

// License identifiers matching repo metadata.
export const LICENSE_NAME = 'GNU Affero General Public License v3.0 (AGPL-3.0)';
export const LICENSE_FILE = 'LICENSE.md';
export const NOTICE_FILE = 'NOTICE.md';
// Bump whenever the binding terms in LICENSE.md materially change. The
// onboarding gate compares the user's persisted acceptance against this
// constant and forces re-acceptance on mismatch (Cluster J FOLLOWUP 4).
// '1' was the pre-launch Dankest Community License. '2' marks the relicense
// to the GNU Affero General Public License v3.0 (AGPL-3.0), a material
// change to the binding terms, so every prior acceptance must be re-collected.
export const LICENSE_VERSION = '2';

// Disclosure / security artifact paths. SECURITY.md ships at the repo
// root and documents the private vulnerability disclosure path
// (GitHub Security Advisories preferred; security@dankest.llc fallback).
export const SECURITY_FILE = 'SECURITY.md';
export const SECURITY_PUBLISHED = true;

// Reproducible-build verification + release-signing artifacts. Pages
// not yet hosted; current paths point at in-repo docs that document
// the procedure. The root reproducible-build doc orients across every
// shell; the desktop-specific recipe lives under `packages/desktop/`.
export const REPRODUCIBLE_BUILD_DOC = 'docs/REPRODUCIBLE_BUILDS.md';
export const REPRODUCIBLE_BUILD_DOC_DESKTOP = 'packages/desktop/REPRODUCIBLE_BUILDS.md';
export const RELEASE_SIGNATURES_DOC = 'packages/extension/RELEASE_SIGNATURES.md';
export const RELEASE_SIGNATURES_PUBLISHED = false;
// Cluster T FOLLOWUP 2: verification recipe for end users (key import
// -> manifest download -> GPG verify -> artifact hash check -> optional
// reproduce). Surfaced in the About panel next to the reproducible-
// build doc so users land on the right doc with one click.
export const VERIFY_RELEASE_DOC = 'docs/Verify_Release.md';

// Update channel: currently only "development". Production / beta
// channels land at v1.0 GA per spec §51.
export const UPDATE_CHANNEL = 'development';

// §18.4 / Cluster N FOLLOWUP 1: runtime-fetched firmware manifest.
//
// The wallet ships with a bundled `FIRMWARE_MANIFEST` (see
// signers/firmware-manifest.js). Newer advisories published between
// wallet releases can be picked up via `refreshFirmwareManifest()`
// fetching a signed JSON file from `FIRMWARE_MANIFEST_URL` and
// verifying it against `FIRMWARE_MANIFEST_PUBLIC_KEY`.
//
// Pre-launch posture: both the signing key and the hosted endpoint are
// gated on §51 release-signing infrastructure publication. Empty
// values short-circuit the refresh flow. `refreshFirmwareManifest`
// returns `{ ok: false, reason: 'not-configured' }` so callers don't
// hit a placeholder URL. When the signing key is published, fill
// these constants and ship a release.
export const FIRMWARE_MANIFEST_URL = '';
export const FIRMWARE_MANIFEST_PUBLIC_KEY = '';
// Cache TTL: freshness window for a previously refreshed manifest.
// Older cache entries fall back to the bundled manifest. 24 hours
// matches the §18.4 deferred-shape sketch.
export const FIRMWARE_MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;
