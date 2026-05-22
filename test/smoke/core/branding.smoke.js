// Smoke test for packages/core/src/branding/.
//
// Run with `node packages/core/test/branding.smoke.js` from the repo root.
// Verifies:
//   - Module loads and exposes the expected API surface.
//   - All tick files referenced by the branding module + chain descriptors
//     exist on disk (`brandingUrl` returns file:// URLs in Node; we strip the
//     scheme and stat each one).
//   - Accent colours are valid hex.
//   - No §5.5 sentinel strings leaked into the constants.

import { strict as assert } from 'node:assert';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as core from '../../../packages/core/src/index.js';

const { branding, registry } = core;

// 1. API surface
for (const name of [
    'PRODUCT_NAME',
    'TAGLINE',
    'CANONICAL_DOMAIN',
    'HOMEPAGE_URL',
    'ACCENT_PRIMARY',
    'ACCENT_SECONDARY',
    'DEFAULT_EXPLORER_BASE',
    'DEFAULT_HUB_BASE',
    'LOGO_FILE',
    'FAVICON_FILE',
    'CHAIN_ICON_SMALL',
    'CHAIN_ICON_LARGE',
    'brandingUrl',
    'logoUrl',
    'faviconUrl',
    'chainIconSmallUrl',
    'chainIconLargeUrl',
]) {
    assert.ok(branding[name] !== undefined, `branding.${name} must be exported`);
}

// 2. Product strings
assert.equal(branding.PRODUCT_NAME, 'XChain Wallet');
assert.equal(branding.CANONICAL_DOMAIN, 'wallet.xchain.io');
assert.equal(branding.HOMEPAGE_URL, 'https://wallet.xchain.io');
assert.ok(/^The self-custodial/.test(branding.TAGLINE), 'tagline set');

// 3. Accent colours are CSS hex
const HEX = /^#[0-9A-Fa-f]{6}$/;
assert.ok(HEX.test(branding.ACCENT_PRIMARY), 'ACCENT_PRIMARY hex');
assert.ok(HEX.test(branding.ACCENT_SECONDARY), 'ACCENT_SECONDARY hex');

// 4. No unresolved §5.5 sentinel bleed
const PROBE = JSON.stringify({
    name: branding.PRODUCT_NAME,
    tagline: branding.TAGLINE,
    domain: branding.CANONICAL_DOMAIN,
});
assert.ok(!/PLACEHOLDER_/.test(PROBE), 'no PLACEHOLDER_ sentinel in branding strings');

// 5. Files referenced by branding exist on disk
const statFromUrl = (url) => {
    // Strip file:// for Node stat; brandingUrl returns a string URL in Node.
    const p = url.startsWith('file://') ? fileURLToPath(url) : url;
    return statSync(p);
};

statFromUrl(branding.logoUrl());
statFromUrl(branding.faviconUrl());

// 6. All nine chain icons (small + large) resolve
const EXPECTED_CHAINS = [
    'bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest',
    'dogecoin-mainnet', 'dogecoin-testnet', 'dogecoin-regtest',
    'litecoin-mainnet', 'litecoin-testnet', 'litecoin-regtest',
];
for (const id of EXPECTED_CHAINS) {
    const small = branding.chainIconSmallUrl(id);
    const large = branding.chainIconLargeUrl(id);
    assert.ok(small, `small icon URL for ${id}`);
    assert.ok(large, `large icon URL for ${id}`);
    statFromUrl(small);
    statFromUrl(large);
}
assert.equal(branding.chainIconSmallUrl('does-not-exist'), null);

// 7. Every bundled descriptor carries a non-empty `icon` that resolves
const reg = registry.defaultRegistry();
for (const id of EXPECTED_CHAINS) {
    const d = reg.get(id);
    assert.ok(d, `registry has ${id}`);
    assert.ok(typeof d.icon === 'string' && d.icon.length > 0, `${id} icon filename set`);
    statFromUrl(branding.brandingUrl(d.icon));
}

console.log('OK — branding smoke test (21 tokens, 17 exports, 9 descriptors)');
