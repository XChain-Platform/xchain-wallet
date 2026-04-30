// Smoke for §37.2 / Cluster D FOLLOWUP 1 — Disconnect-site undo toast.
//
// Pins:
//   - createBackgroundHost registers `sites.restore` (vault-only, validates
//     `site.id` and `site.origin`, calls `vault.connectedSites.put`).
//   - Extension popup + web messaging shims expose `restoreConnectedSite`
//     routed to `sites.restore`.
//   - ConnectedSitesSection imports useToast, snapshots the record before
//     calling `deleteConnectedSite`, and surfaces a `useToast.showToast`
//     call with `actionLabel: 'Undo'` whose onAction calls
//     `restoreConnectedSite`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const popupShim = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);
const webShim = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const sectionSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'ConnectedSitesSection.jsx'),
    'utf8',
);

// ─── 1. host handler ────────────────────────────────────────────────────

const idx = hostSrc.indexOf("host.register('sites.restore'");
assert.notEqual(idx, -1, 'sites.restore handler registered');
const block = hostSrc.slice(idx, idx + 800);
assert.match(block, /site is required/, 'validates site presence');
assert.match(block, /site\.id is required/, 'validates site.id');
assert.match(block, /site\.origin is required/, 'validates site.origin');
assert.match(block, /vault\.connectedSites\.put\(site\)/, 'calls connectedSites.put with the snapshot');

// ─── 2. messaging shims ─────────────────────────────────────────────────

for (const [name, src] of [
    ['popup', popupShim],
    ['web', webShim],
]) {
    assert.match(
        src,
        /export function restoreConnectedSite\(req\)/,
        `${name} shim exports restoreConnectedSite`,
    );
    assert.match(
        src,
        /sendMessage\('sites\.restore', req\)/,
        `${name} shim routes to sites.restore`,
    );
}

// ─── 3. ConnectedSitesSection wiring ────────────────────────────────────

assert.match(
    sectionSrc,
    /import \{ useToast \} from '\.\.\/ToastHost\.jsx'/,
    'ConnectedSitesSection imports useToast',
);
assert.match(
    sectionSrc,
    /const \{ showToast \} = useToast\(\)/,
    'ConnectedSitesSection consumes useToast',
);
assert.match(
    sectionSrc,
    /const snapshot = sites \? sites\.find\(\(s\) => s\.id === id\) : null/,
    'onDisconnect snapshots the site before deletion',
);
assert.match(
    sectionSrc,
    /showToast\(\{[\s\S]+?actionLabel: 'Undo'/,
    'showToast carries an Undo action label',
);
assert.match(
    sectionSrc,
    /messaging\.restoreConnectedSite\(\{ site: snapshot \}\)/,
    'onAction restores the snapshot via restoreConnectedSite',
);
// Don't fire the toast in shells that don't expose restoreConnectedSite.
assert.match(
    sectionSrc,
    /typeof messaging\.restoreConnectedSite === 'function'/,
    'undo toast is gated on restoreConnectedSite availability',
);

console.log('connected-sites-undo smoke OK');
