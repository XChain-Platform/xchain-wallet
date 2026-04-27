// Build-time wallet metadata used by user-facing surfaces (About panel,
// diagnostic dump, threat-model link).
//
// Synchronized-version note: this constant is updated alongside every
// package.json bump per the wallet's synchronized-versioning rule.
// See CHANGELOG.md for the version's release context.

export const WALLET_VERSION = '0.186.0';

// License identifiers matching repo metadata.
export const LICENSE_NAME = 'Dankest Community License (Apache-2.0 + Additional Terms)';
export const LICENSE_FILE = 'LICENSE.md';
export const NOTICE_FILE = 'NOTICE.md';

// Disclosure / security artifact paths. SECURITY.md doesn't exist yet
// per the §35 gap audit (2026-04-26_unbuilt-from-spec.md); the field
// stays here so the About panel renders the link slot, with a "not yet
// published" indicator until the file lands.
export const SECURITY_FILE = 'SECURITY.md';
export const SECURITY_PUBLISHED = false;

// Reproducible-build verification + release-signing artifacts. Pages
// not yet hosted; current paths point at in-repo READMEs that document
// the procedure.
export const REPRODUCIBLE_BUILD_DOC = 'packages/desktop/REPRODUCIBLE_BUILDS.md';
export const RELEASE_SIGNATURES_DOC = 'packages/extension/RELEASE_SIGNATURES.md';
export const RELEASE_SIGNATURES_PUBLISHED = false;

// Update channel — currently only "development". Production / beta
// channels land at v1.0 GA per spec §51.
export const UPDATE_CHANNEL = 'development';
