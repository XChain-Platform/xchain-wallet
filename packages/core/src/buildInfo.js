// Build-time wallet metadata used by user-facing surfaces (About panel,
// diagnostic dump, threat-model link).
//
// Synchronized-version note: this constant is updated alongside every
// package.json bump per the wallet's synchronized-versioning rule.
// See CHANGELOG.md for the version's release context.

export const WALLET_VERSION = '0.281.0';

// License identifiers matching repo metadata.
export const LICENSE_NAME = 'Dankest Community License (Apache-2.0 + Additional Terms)';
export const LICENSE_FILE = 'LICENSE.md';
export const NOTICE_FILE = 'NOTICE.md';
// Bump whenever the binding terms in LICENSE.md materially change. The
// onboarding gate compares the user's persisted acceptance against this
// constant and forces re-acceptance on mismatch (Cluster J FOLLOWUP 4).
// Initial public value is '1' — pre-launch releases didn't track an
// explicit version so any prior acceptance is treated as compatible
// only with version '1'.
export const LICENSE_VERSION = '1';

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

// Update channel — currently only "development". Production / beta
// channels land at v1.0 GA per spec §51.
export const UPDATE_CHANNEL = 'development';
