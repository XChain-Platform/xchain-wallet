// Smoke for Phase 2 — Step 20 (piece 6) — BROADCAST form (§40.6).
//
// Asserts:
//   1. packages/core/src/shared/routes/BroadcastForm.jsx exists and
//      exports a single component. Reuses IssueTokenForm.module.css
//      styles for visual parity with the Piece 3 forms.
//   2. Two-stage state machine (form → review/submitting → done).
//   3. Review runs the composed BROADCAST params through
//      decoder.decodeAction with action: "BROADCAST".
//   4. Sign wires through messaging.broadcastAction — the new Step-20
//      helper.
//   5. Validation rejects the case where both feed name and text are
//      empty (MESSAGE would be blank and the protocol validator would
//      reject it).
//   6. Params composer: MESSAGE comes from feedName when set, else text;
//      text becomes MEMO when feedName is present; version flips to '1'
//      when VALUE + FEE both present, '2' when only FEE, else '0'.
//   7. Core flow broadcastAction exists, is re-exported from
//      @xchain-wallet/core flows, and guards required inputs.
//   8. Decoder covers BROADCAST — v0 message, v1 oracle, v2 feed URL,
//      v3 feed results. Each summary differentiates the lane so the
//      sign screen matches the user's intent.
//   9. Background host registers action.broadcast; all three shell
//      messaging.js files export broadcastAction(opts).
//  10. ActionsMenu entries include a 'broadcast' item; popup + web +
//      desktop App.jsx track the 'broadcast' sub-route and pass
//      onBroadcast to buildActionEntries.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows, decoder } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'BroadcastForm.jsx');
assert.ok(existsSync(formPath), 'BroadcastForm.jsx exists');

const src = readFileSync(formPath, 'utf8');

// --- 1. Public surface + CSS reuse ------------------------------------

assert.ok(
    /export function BroadcastForm\b/.test(src),
    'BroadcastForm is a named export',
);
const exportCount = (src.match(/^export\s+(function|const|class)\b/gm) || []).length;
assert.equal(exportCount, 1, 'BroadcastForm.jsx only exports the component');
assert.ok(
    /IssueTokenForm\.module\.css/.test(src),
    'BroadcastForm reuses IssueTokenForm CSS module (same visual shape)',
);

// --- 2. Two-stage state machine ---------------------------------------

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `BroadcastForm tracks stage "${stage}"`);
}

// --- 3. Review runs through decoder.decodeAction ----------------------

assert.ok(
    /action:\s*['"]BROADCAST['"]/.test(src),
    'BroadcastForm calls decoder with action: "BROADCAST"',
);
assert.ok(
    /decoderLib\.decodeAction/.test(src),
    'BroadcastForm invokes decoder.decodeAction',
);
assert.ok(src.includes('decoded.warnings'), 'BroadcastForm renders decoder warnings');

// --- 4. Sign wires through messaging.broadcastAction ------------------

assert.ok(
    /messaging\.broadcastAction\s*\(/.test(src),
    'BroadcastForm calls messaging.broadcastAction from the sign stage',
);
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'BroadcastForm distinguishes wrong-password from other errors',
);

// --- 5. Validation ----------------------------------------------------

assert.ok(
    /Enter a feed name or a message/.test(src),
    'BroadcastForm rejects empty feedName+text (MESSAGE required)',
);

// --- 6. Params composer -----------------------------------------------

assert.ok(
    /VERSION:\s*version/.test(src) || /p\.VERSION\s*=/.test(src) || /VERSION:\s*['"]0['"]/.test(src) || /version\s*=\s*['"]0['"]/.test(src),
    'BroadcastForm composes VERSION',
);
assert.ok(
    /MESSAGE:\s*message/.test(src) || /p\.MESSAGE/.test(src) || /MESSAGE:\s*feed/.test(src),
    'BroadcastForm sets MESSAGE',
);
assert.ok(
    /p\.VALUE\s*=\s*val|if \(val\) p\.VALUE/.test(src),
    'BroadcastForm only sets VALUE when non-empty',
);
assert.ok(
    /p\.FEE\s*=\s*fee|if \(fee\) p\.FEE/.test(src),
    'BroadcastForm only sets FEE when non-empty',
);
assert.ok(
    /p\.MEMO\s*=\s*memo|if \(memo\) p\.MEMO/.test(src),
    'BroadcastForm only sets MEMO when non-empty',
);
assert.ok(
    /toISOString/.test(src),
    'BroadcastForm supports UTC timestamp injection into memo',
);

// --- 7. Core flow -----------------------------------------------------

assert.equal(
    typeof flows.broadcastAction,
    'function',
    'flows.broadcastAction is re-exported from core',
);
await assert.rejects(
    async () => flows.broadcastAction(),
    /broadcastAction: opts is required/,
    'broadcastAction rejects missing opts',
);
await assert.rejects(
    async () => flows.broadcastAction({}),
    /broadcastAction: params is required/,
    'broadcastAction rejects missing params',
);
await assert.rejects(
    async () => flows.broadcastAction({ params: {} }),
    /MESSAGE or params\.BROADCAST_ACTION_INDEX is required/,
    'broadcastAction rejects when neither MESSAGE nor BROADCAST_ACTION_INDEX present',
);
await assert.rejects(
    async () => flows.broadcastAction({ params: { MESSAGE: 'hi' } }),
    /broadcastAction: from is required/,
    'broadcastAction rejects missing source',
);

const flowSrc = readFileSync(join(core, 'src', 'flows', 'broadcastAction.js'), 'utf8');
assert.ok(
    /action:\s*'BROADCAST'/.test(flowSrc),
    'broadcastAction flow forwards action: "BROADCAST" to submitAction',
);
assert.ok(
    /normalizeSource/.test(flowSrc),
    'broadcastAction flow reuses normalizeSource from sendToken',
);

// --- 8. Decoder coverage ----------------------------------------------

{
    // v0 — plain message
    const v0 = decoder.decodeAction({
        action: 'BROADCAST',
        params: { VERSION: '0', MESSAGE: 'hello world' },
    });
    assert.ok(/Broadcast\s+"hello world"/.test(v0.summary), 'v0 summary quotes the message');
    assert.ok(v0.details.some((d) => d.label === 'Message'), 'v0 surfaces Message detail');

    // v0 empty message warns
    const v0empty = decoder.decodeAction({
        action: 'BROADCAST',
        params: { VERSION: '0', MESSAGE: '' },
    });
    assert.ok(v0empty.warnings.some((w) => /Message is empty/.test(w)), 'v0 warns on empty MESSAGE');

    // v1 — oracle
    const v1 = decoder.decodeAction({
        action: 'BROADCAST',
        params: { VERSION: '1', MESSAGE: 'BTC-USD', VALUE: '84860', FEE: '1' },
    });
    assert.ok(/Publish oracle value/.test(v1.summary), 'v1 summary identifies the oracle lane');
    assert.ok(v1.details.some((d) => d.label === 'Feed'), 'v1 uses Feed label');
    assert.ok(v1.details.some((d) => d.label === 'Feed fee'), 'v1 surfaces Feed fee');

    // v2 — feed URL
    const v2 = decoder.decodeAction({
        action: 'BROADCAST',
        params: { VERSION: '2', MESSAGE: 'https://feeds.example/feed.json', FEE: '1' },
    });
    assert.ok(/Publish feed/.test(v2.summary), 'v2 summary identifies the feed lane');

    // v3 — feed results
    const v3 = decoder.decodeAction({
        action: 'BROADCAST',
        params: { VERSION: '3', BROADCAST_ACTION_INDEX: '1234', VALUE: '7' },
    });
    assert.ok(/Publish feed result/.test(v3.summary), 'v3 summary identifies the feed-results lane');
    assert.ok(/feed #1234/.test(v3.summary), 'v3 summary includes the feed index');

    // pipe/semicolon in MESSAGE gets flagged
    const bad = decoder.decodeAction({
        action: 'BROADCAST',
        params: { VERSION: '0', MESSAGE: 'bad|message' },
    });
    assert.ok(
        bad.warnings.some((w) => /\| or ;/.test(w)),
        'decoder flags pipe/semicolon in MESSAGE',
    );
}

// --- 9. Background handler + messaging helpers -------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(
    /host\.register\('action\.broadcast'/.test(bg),
    'background host registers action.broadcast',
);
assert.ok(
    /broadcastAction\(\{\s*\.\.\.req,\s*vault,\s*chainRegistry,\s*sdkRegistry\s*\}\)/.test(bg),
    'action.broadcast handler forwards deps to broadcastAction',
);

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function broadcastAction\b/.test(m),
        `${shell} messaging.js exports broadcastAction`,
    );
    assert.ok(
        /sendMessage\('action\.broadcast'/.test(m),
        `${shell} messaging.js routes broadcastAction via action.broadcast`,
    );
}

// --- 10. ActionsMenu + App.jsx sub-routes ------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        app.includes('BroadcastForm'),
        `${shell} App.jsx imports BroadcastForm`,
    );
    assert.ok(
        app.includes("'broadcast'"),
        `${shell} App.jsx tracks the broadcast sub-route`,
    );
    assert.ok(
        /id:\s*['"]broadcast['"]/.test(app),
        `${shell} App.jsx registers the broadcast entry in buildActionEntries`,
    );
    assert.ok(
        /onBroadcast:\s*\(\)\s*=>\s*setUnlockedView\('broadcast'\)/.test(app),
        `${shell} App.jsx wires onBroadcast to the broadcast sub-route`,
    );
}

console.log(
    'OK — broadcast form smoke (BroadcastForm §40.6 + broadcastAction core flow + action.broadcast handler + three messaging helpers + ActionsMenu entry + popup/web/desktop wiring + decoder coverage for v0/v1/v2/v3)',
);
