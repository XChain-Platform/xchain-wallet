// Smoke for §20 / G041 — Home.jsx signer-mode variant (Step 3 of 3).
//
// Pins:
//   - Home.jsx imports WALLET_MODE_DEFAULT and derives `walletMode` /
//     `isSignerMode` from settings.
//   - Home.jsx accepts `onSignPsbt` / `onSignMessage` / `onVerifySignature`
//     props (documented + threaded into the signer body).
//   - When `isSignerMode` is true, the regular HomeTabs / quick actions
//     body is bypassed and `<SignerHomeBody>` is rendered inside the
//     shared `<Screen>` with the same header.
//   - SignerHomeBody renders the explanatory banner + three CTAs (Sign
//     a PSBT / Sign a message / Verify a signature), each disabled when
//     its prop is undefined.
//   - Extension popup + web App.jsx pass `onSignPsbt` / `onSignMessage`
//     / `onVerifySignature` through to Home. Desktop intentionally does
//     not wire those props yet — the routes aren't implemented on that
//     shell — so the CTAs render disabled (tracked as Cluster W FOLLOWUP).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const homeSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Home.jsx'),
    'utf8',
);
const popupAppSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx'),
    'utf8',
);
const webAppSrc = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'App.jsx'),
    'utf8',
);
const desktopAppSrc = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx'),
    'utf8',
);

// ─── 1. Home.jsx imports + derivation ----------------------------

assert.match(
    homeSrc,
    /import \{ WALLET_MODE_DEFAULT \} from '\.\.\/\.\.\/schemas\/settings\.js';/,
    'Home.jsx imports WALLET_MODE_DEFAULT from schemas/settings',
);
assert.match(
    homeSrc,
    /const walletMode = settings\.settings\?\.walletMode \|\| WALLET_MODE_DEFAULT;/,
    'derives walletMode from useSettings hook with default fallback',
);
assert.match(
    homeSrc,
    /const isSignerMode = walletMode === 'signer';/,
    'derives isSignerMode',
);

// ─── 2. Home.jsx accepts the new props ----------------------------

assert.match(
    homeSrc,
    /onSignPsbt, onSignMessage, onVerifySignature,/,
    'Home destructures the three new sign / verify props',
);
assert.match(
    homeSrc,
    /\* @param \{\(\) => void\} \[props\.onSignPsbt\]/,
    'onSignPsbt documented in JSDoc',
);

// ─── 3. Signer-mode early return ----------------------------------

assert.match(
    homeSrc,
    /if \(isSignerMode\) \{[\s\S]+?<SignerHomeBody[\s\S]+?\}/,
    'isSignerMode branch renders SignerHomeBody inside its own <Screen>',
);
assert.match(
    homeSrc,
    /onSignPsbt=\{onSignPsbt\}/,
    'SignerHomeBody receives onSignPsbt',
);

// ─── 4. SignerHomeBody component ----------------------------------

assert.match(
    homeSrc,
    /function SignerHomeBody\(\{ onSignPsbt, onSignMessage, onVerifySignature \}\)/,
    'SignerHomeBody defined with the three sign / verify props',
);
assert.match(homeSrc, /Sign a PSBT/, 'marquee CTA label "Sign a PSBT"');
assert.match(homeSrc, /Sign a message/, 'secondary CTA label "Sign a message"');
assert.match(homeSrc, /Verify a signature/, 'tertiary CTA label "Verify a signature"');
assert.match(
    homeSrc,
    /<strong[^>]*>Signer mode<\/strong>/,
    'explanatory banner identifies the mode',
);
// Each CTA disabled when its handler prop is missing.
assert.match(homeSrc, /disabled=\{!onSignPsbt\}/, 'Sign-PSBT button disabled when prop undefined');
assert.match(homeSrc, /disabled=\{!onSignMessage\}/, 'Sign-message button disabled when prop undefined');
assert.match(homeSrc, /disabled=\{!onVerifySignature\}/, 'Verify-signature button disabled when prop undefined');

// ─── 5. Extension popup wiring ------------------------------------

assert.match(
    popupAppSrc,
    /onSignPsbt=\{activeWalletId \? \(\) => setUnlockedView\('sign-psbt'\) : undefined\}/,
    'extension popup wires onSignPsbt',
);
assert.match(
    popupAppSrc,
    /onSignMessage=\{activeWalletId \? \(\) => setUnlockedView\('sign-message'\) : undefined\}/,
    'extension popup wires onSignMessage',
);
assert.match(
    popupAppSrc,
    /onVerifySignature=\{activeWalletId \? \(\) => setUnlockedView\('verify-signature'\) : undefined\}/,
    'extension popup wires onVerifySignature',
);

// ─── 6. Web shell wiring ------------------------------------------

assert.match(
    webAppSrc,
    /onSignPsbt=\{activeWalletId \? \(\) => setUnlockedView\('sign-psbt'\) : undefined\}/,
    'web shell wires onSignPsbt',
);
assert.match(
    webAppSrc,
    /onSignMessage=\{activeWalletId \? \(\) => setUnlockedView\('sign-message'\) : undefined\}/,
    'web shell wires onSignMessage',
);
assert.match(
    webAppSrc,
    /onVerifySignature=\{activeWalletId \? \(\) => setUnlockedView\('verify-signature'\) : undefined\}/,
    'web shell wires onVerifySignature',
);

// ─── 7. Desktop shell intentionally NOT wired (FOLLOWUP) ---------

assert.doesNotMatch(
    desktopAppSrc,
    /onSignPsbt=\{activeWalletId/,
    'desktop shell does not wire onSignPsbt yet (sign-psbt route not registered) — Cluster W FOLLOWUP',
);

console.log('home-signer-mode smoke OK');
