// Smoke for §21 — Step 6 — RawPsbtViewer reveal (Developer Mode).
//
// Closes Settings FOLLOWUP 6 from the §35 close report. Asserts:
//   - <RawPsbtViewer> exists with the expected public API
//   - Returns null when developerMode=false (the only way the gate
//     short-circuits — caller never gets a stray reveal block)
//   - SignApproval wires it for both signPsbt (with hex) and
//     signAction (with action fields), gated behind a freshly-fetched
//     developerMode setting
//   - Send.jsx wires it into the review stage with the action fields
//     it has at review time (no PSBT yet — encode happens on submit),
//     gated behind the existing useDeveloperMode hook
//   - approval-side messaging exposes getSettings

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const compPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'RawPsbtViewer.jsx');
const cssPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'RawPsbtViewer.module.css');
const signPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'kinds', 'SignApproval.jsx');
const sendPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
const approvalMsgPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'messaging.js');

assert.ok(existsSync(compPath), 'RawPsbtViewer.jsx exists');
assert.ok(existsSync(cssPath), 'RawPsbtViewer.module.css exists');

const compSrc = readFileSync(compPath, 'utf8');
const cssSrc = readFileSync(cssPath, 'utf8');
const signSrc = readFileSync(signPath, 'utf8');
const sendSrc = readFileSync(sendPath, 'utf8');
const msgSrc = readFileSync(approvalMsgPath, 'utf8');

// --- 1. Public API + gate semantics -------------------------------------

assert.match(compSrc, /export function RawPsbtViewer\(/);
assert.match(compSrc, /props\.developerMode/);
assert.match(compSrc, /props\.psbtHex/);
assert.match(compSrc, /props\.actionFields/);

// Hard gate: developerMode=false → null. Plus secondary gate: nothing
// to show → null (avoids an empty disclosure if both psbtHex and
// actionFields are absent).
assert.match(
    compSrc,
    /if \(!developerMode\) return null;/,
    'developerMode=false short-circuits to null',
);
assert.match(
    compSrc,
    /if \(!hasPsbt && !hasFields\) return null;/,
    'no payload → null (no orphan disclosure)',
);

// --- 2. Sections + copy button ------------------------------------------

assert.match(compSrc, /aria-label="PSBT hex"/);
assert.match(compSrc, /aria-label="Action fields"/);
assert.match(compSrc, /aria-label="Parsed inputs \/ outputs"/);
assert.match(compSrc, /parser not wired yet/, 'placeholder is honest about the parser limit');
assert.match(compSrc, /navigator\.clipboard\?\.writeText/);
assert.match(
    compSrc,
    /Copy \$\{hasPsbt \? 'PSBT hex' : 'action fields'\}/,
    'copy button labels what it copies',
);

// CSS hooks for every visible piece.
for (const cls of ['root', 'toggle', 'body', 'section', 'label', 'hex', 'json', 'placeholder', 'copyBtn']) {
    assert.match(cssSrc, new RegExp(`\\.${cls}\\b`), `CSS defines .${cls}`);
}

// --- 3. SignApproval wiring --------------------------------------------

assert.match(signSrc, /import \{ RawPsbtViewer \}/, 'imports the viewer');
assert.match(signSrc, /getSettings/, 'imports getSettings from approval messaging');

// Settings fetch on mount.
assert.match(signSrc, /const \[developerMode, setDeveloperMode\] = useState\(false\);/);
assert.match(
    signSrc,
    /getSettings\(\)\s*\.then\(\(s\) => \{[^}]*setDeveloperMode\(Boolean\(s\?\.developerMode\)\);/s,
    'fetches settings on mount and sets developerMode',
);
assert.match(
    signSrc,
    /\.catch\(\(\) => \{ \/\* keep developerMode false on failure \*\//,
    'fetch failure leaves developerMode false (gate stays closed)',
);

// Renders for both signPsbt (psbtHex) and signAction (actionFields).
assert.match(
    signSrc,
    /<RawPsbtViewer\s+developerMode=\{developerMode\}\s+psbtHex=\{kind === 'signPsbt' \? payload\?\.payload\?\.psbtHex : undefined\}/,
    'psbtHex flows through only for signPsbt',
);
assert.match(
    signSrc,
    /actionFields=\{\s*kind === 'signAction'\s*\?\s*\{ action: payload\?\.action, \.\.\.\(payload\?\.payload \|\| \{\}\) \}\s*:\s*kind === 'signPsbt'/,
    'actionFields uses {action, ...payload.payload} for signAction',
);

// --- 4. approval/messaging.js ------------------------------------------

assert.match(msgSrc, /export function getSettings\(/);
assert.match(msgSrc, /sendMessage\('settings\.get'\)/);

// --- 5. Send.jsx wiring --------------------------------------------------

assert.match(sendSrc, /import \{ RawPsbtViewer \}/);
assert.match(sendSrc, /import \{ useDeveloperMode \}/);
assert.match(sendSrc, /const \{ developerMode \} = useDeveloperMode\(\);/);
assert.match(
    sendSrc,
    /<RawPsbtViewer\s+developerMode=\{developerMode\}\s+actionFields=\{\{\s*action: 'SEND'/s,
    'Send.jsx review renders RawPsbtViewer with action fields it has at review time',
);

console.log('raw-psbt-viewer smoke OK');
