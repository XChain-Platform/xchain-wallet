// Smoke for §20 / G040 — Send.jsx watcher-mode branch (Step 2 of 3).
//
// Pins:
//   - flows/buildSendPsbt.js exports an encode-only helper that requires
//     the encoder, not a signer / password / vault.
//   - flows/index.js re-exports buildSendPsbt.
//   - createBackgroundHost destructures buildSendPsbt and registers
//     `action.send.psbt`.
//   - All three messaging shims expose `buildSendPsbtRequest` calling
//     `action.send.psbt`.
//   - Send.jsx reads `settings.walletMode`, derives `isWatcherMode`,
//     branches the submit handler to `messaging.buildSendPsbtRequest`,
//     swaps the password / HW block for an explanatory hint at review,
//     and renders a `WatcherResultPanel` in the done stage when the
//     result envelope carries `psbtHex` instead of a `txid`.
//   - WatcherResultPanel pulls in `encodeXcwChunks` from `uri/psbtQr.js`
//     and renders an `<AnimatedQrFrames>` block + plain-text chunks.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const flowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'buildSendPsbt.js'),
    'utf8',
);
const flowsIndexSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const popupShimSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);
const webShimSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const desktopShimSrc = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js'),
    'utf8',
);
const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);

// ─── 1. flows/buildSendPsbt.js ------------------------------------

assert.match(flowSrc, /export async function buildSendPsbt\(opts\)/, 'flow exports buildSendPsbt');
assert.match(flowSrc, /sdk\.actions\.createAction\(\{ action: 'SEND', params \}\)/, 'creates SEND action string');
assert.match(flowSrc, /encoder\.createTx\(\{/, 'calls encoder.createTx');
assert.match(flowSrc, /psbtHex: encoded\.psbt,/, 'returns psbtHex');
// Watcher mode never broadcasts — guard against accidental signing / broadcast.
// (Doc comments may legitimately mention "signer" / "signing" — pin against
// import + call shapes instead of bare substrings.)
assert.doesNotMatch(flowSrc, /import [\s\S]*signers\//, 'flow does not import any signer module');
assert.doesNotMatch(flowSrc, /signer\.signPsbt/, 'no signer.signPsbt call in the flow');
assert.doesNotMatch(flowSrc, /\.broadcastTx\(/, 'no broadcastTx call in the flow');
assert.doesNotMatch(flowSrc, /\bunlockWallet\(/, 'no unlockWallet call in the flow');

// ─── 2. flows/index.js re-export --------------------------------

assert.match(
    flowsIndexSrc,
    /export \{ buildSendPsbt \} from '\.\/buildSendPsbt\.js';/,
    'flows/index re-exports buildSendPsbt',
);

// ─── 3. createBackgroundHost wiring -----------------------------

assert.match(hostSrc, /\n\s*buildSendPsbt,\n/, 'host destructures buildSendPsbt from flows');
const handlerIdx = hostSrc.indexOf("host.register('action.send.psbt'");
assert.notEqual(handlerIdx, -1, 'action.send.psbt handler registered');
const handlerBlock = hostSrc.slice(handlerIdx, handlerIdx + 320);
assert.match(handlerBlock, /chainRegistry, sdkRegistry/, 'handler uses chainRegistry + sdkRegistry deps only');
assert.match(handlerBlock, /buildSendPsbt\(\{ \.\.\.req, chainRegistry, sdkRegistry \}\)/, 'handler forwards to buildSendPsbt');
assert.doesNotMatch(handlerBlock, /\bvault\b/, 'handler does not require vault — no unlock');

// ─── 4. Three messaging shims -----------------------------------

for (const [name, src] of [
    ['popup', popupShimSrc],
    ['web', webShimSrc],
    ['desktop', desktopShimSrc],
]) {
    assert.match(
        src,
        /export function buildSendPsbtRequest\(opts\)/,
        `${name} shim exports buildSendPsbtRequest`,
    );
    assert.match(
        src,
        /sendMessage\('action\.send\.psbt', opts\)/,
        `${name} shim routes to action.send.psbt`,
    );
}

// ─── 5. Send.jsx watcher branch ---------------------------------

assert.match(
    sendSrc,
    /import \{ encodeXcwChunks \} from '\.\.\/\.\.\/uri\/psbtQr\.js';/,
    'Send.jsx imports encodeXcwChunks',
);
assert.match(
    sendSrc,
    /import \{ WALLET_MODE_DEFAULT \} from '\.\.\/\.\.\/schemas\/settings\.js';/,
    'Send.jsx imports WALLET_MODE_DEFAULT',
);
assert.match(sendSrc, /AnimatedQrFrames,/, 'Send.jsx imports AnimatedQrFrames from core/ui');
assert.match(
    sendSrc,
    /const walletMode = settings\?\.walletMode \|\| WALLET_MODE_DEFAULT;/,
    'derives walletMode from settings with default fallback',
);
assert.match(
    sendSrc,
    /const isWatcherMode = walletMode === 'watcher';/,
    'derives isWatcherMode',
);
assert.match(
    sendSrc,
    /messaging\.buildSendPsbtRequest\(base\)/,
    'submit handler routes through buildSendPsbtRequest in watcher mode',
);
assert.match(
    sendSrc,
    /Build unsigned PSBT/,
    'submit button label changes to "Build unsigned PSBT" in watcher mode',
);
assert.match(
    sendSrc,
    /Watcher mode — this wallet will build an unsigned PSBT/,
    'review-stage hint copy explains watcher mode',
);
// §20 Cluster W FOLLOWUP 3 (closed at v0.239.0) — when the source address is
// HW-paired AND watcher mode is on, an extra StatusMessage explains that the
// pairing here is decorative and the same HW device must be paired on the
// Signer-mode wallet to actually sign the PSBT.
assert.match(
    sendSrc,
    /Source address is paired to \{fromAddress\.source === 'trezor' \? 'Trezor' : 'Ledger'\} on/,
    'watcher-mode HW-source hint pins vendor name',
);
assert.match(
    sendSrc,
    /Pair the same \{fromAddress\.source === 'trezor' \? 'Trezor' : 'Ledger'\} on your\s+Signer-mode wallet to sign/,
    'hint redirects user to pair on Signer wallet',
);
assert.match(
    sendSrc,
    /if \(result\?\.psbtHex && !txid\) \{[\s\S]+?<WatcherResultPanel/,
    'done stage branches to WatcherResultPanel when result.psbtHex is set',
);

// ─── 6. WatcherResultPanel ----------------------------------------

assert.match(sendSrc, /function WatcherResultPanel\(\{ result, onSendAnother, onDone \}\)/, 'WatcherResultPanel defined');
assert.match(sendSrc, /encodeXcwChunks\(psbtHex\)/, 'panel encodes hex into XCW chunks');
assert.match(sendSrc, /<AnimatedQrFrames\b/, 'panel renders AnimatedQrFrames');
assert.match(sendSrc, /readOnly[\s\S]+?value=\{psbtHex\}/, 'panel exposes the hex in a read-only textarea');
assert.match(sendSrc, /Copy hex/, 'panel exposes a Copy hex affordance');
assert.match(sendSrc, /Plain-text chunks/, 'panel exposes the plain-text chunks fallback');
// §20 Cluster W FOLLOWUP 4 (closed at v0.241.0) — BBQr (hex) export
// alongside XCW chunks so watcher-mode PSBTs are signable on
// Sparrow / Coldcard / SeedSigner. WatcherResultPanel imports
// encodeBbqrPsbtFrames and exposes a format toggle.
assert.match(
    sendSrc,
    /import \{ encodeBbqrPsbtFrames \} from '\.\.\/\.\.\/uri\/bbqrPsbt\.js';/,
    'Send.jsx imports encodeBbqrPsbtFrames',
);
assert.match(
    sendSrc,
    /encodeBbqrPsbtFrames\(psbtHex\)/,
    'panel encodes hex into BBQr H frames when format === bbqr',
);
assert.match(
    sendSrc,
    /qrFormat === 'bbqr'/,
    'panel branches export format on qrFormat',
);
assert.match(
    sendSrc,
    /BBQr \(Sparrow \/ Coldcard \/ SeedSigner\)/,
    'panel labels the BBQr radio choice with target wallets',
);

console.log('send-watcher-mode smoke OK');
