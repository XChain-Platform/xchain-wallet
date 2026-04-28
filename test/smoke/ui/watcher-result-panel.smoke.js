// Smoke for §20 / Cluster X Step 3 — extracted shared
// WatcherResultPanel component. Renders the unsigned PSBT hex +
// animated QR (XCW or BBQr) for cross-device transport when a
// watcher-mode wallet builds a PSBT. Originally a private component
// inside Send.jsx; lifted out so the rest of the action authoring
// surface (FOLLOWUP 5 sweep) can render the same panel.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const panelPath = 'packages/core/src/shared/components/WatcherResultPanel.jsx';
const cssPath = 'packages/core/src/shared/components/WatcherResultPanel.module.css';
assert.ok(existsSync(join(wsRoot, panelPath)), `${panelPath} exists`);
assert.ok(existsSync(join(wsRoot, cssPath)), `${cssPath} exists`);

const panelSrc = readFileSync(join(wsRoot, panelPath), 'utf8');

// ─── 1. Imports ---------------------------------------------------

assert.match(
    panelSrc,
    /import \{ AnimatedQrFrames, Button, StatusMessage \} from '\.\.\/\.\.\/ui\/index\.js';/,
    'panel imports UI primitives from core/ui',
);
assert.match(
    panelSrc,
    /import \{ encodeXcwChunks \} from '\.\.\/\.\.\/uri\/psbtQr\.js';/,
    'panel imports encodeXcwChunks',
);
assert.match(
    panelSrc,
    /import \{ encodeBbqrPsbtFrames \} from '\.\.\/\.\.\/uri\/bbqrPsbt\.js';/,
    'panel imports encodeBbqrPsbtFrames',
);

// ─── 2. Component shape ------------------------------------------

assert.match(
    panelSrc,
    /export function WatcherResultPanel\(\{[\s\S]+?\}\)/,
    'WatcherResultPanel is a named export',
);
assert.match(panelSrc, /onBuildAnother/, 'accepts onBuildAnother prop');
assert.match(panelSrc, /onSendAnother/, 'accepts onSendAnother prop (Send.jsx legacy alias)');
assert.match(panelSrc, /onDone/, 'accepts onDone prop');
assert.match(
    panelSrc,
    /title = 'Unsigned PSBT — ready for signing'/,
    'title prop has a default heading',
);

// ─── 3. Render shape ---------------------------------------------

assert.match(panelSrc, /encodeXcwChunks\(psbtHex\)/, 'panel encodes hex into XCW chunks');
assert.match(
    panelSrc,
    /encodeBbqrPsbtFrames\(psbtHex\)/,
    'panel encodes hex into BBQr H frames when format === bbqr',
);
assert.match(panelSrc, /qrFormat === 'bbqr'/, 'panel branches export format on qrFormat');
assert.match(panelSrc, /<AnimatedQrFrames\b/, 'panel renders AnimatedQrFrames');
assert.match(panelSrc, /readOnly[\s\S]+?value=\{psbtHex\}/, 'panel exposes the hex in a read-only textarea');
assert.match(panelSrc, /Copy hex/, 'panel exposes a Copy hex affordance');
assert.match(panelSrc, /Plain-text chunks/, 'panel exposes the plain-text chunks fallback');
assert.match(
    panelSrc,
    /BBQr \(Sparrow \/ Coldcard \/ SeedSigner\)/,
    'panel labels the BBQr radio choice with target wallets',
);
assert.match(panelSrc, /XCW \(this wallet\)/, 'panel labels the XCW radio choice');

// ─── 4. CSS module ------------------------------------------------

const cssSrc = readFileSync(join(wsRoot, cssPath), 'utf8');
for (const cls of [
    'successCard', 'successTitle', 'successHint',
    'successSummary', 'successRow', 'successMono',
    'successTxidBlock', 'successTxidRow', 'successLink',
    'successLabel', 'hint', 'actions',
]) {
    assert.ok(
        new RegExp(`\\.${cls}\\b`).test(cssSrc),
        `WatcherResultPanel.module.css defines .${cls}`,
    );
}

console.log('watcher-result-panel smoke OK');
