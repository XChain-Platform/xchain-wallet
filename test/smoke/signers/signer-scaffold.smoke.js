// Smoke for Phase 2 — Step 12 (piece 4a) — signer pairing scaffold +
// firmware manifest + derivation-path cross-check UI (§18.3–18.5).
//
// Piece 4a is scaffolding only: Trezor + Ledger SDK integration lands
// in Steps 13 (TrezorSigner) + 14 (LedgerSigner). Step 12 builds the
// pluggable primitives those will consume:
//
//   1. Firmware manifest — bundled JS module, not a .json file (the
//      browser shells can't import JSON without loaders, and the
//      node smoke runner is on v18 which doesn't support
//      `with { type: 'json' }` reliably).
//   2. checkFirmware helper — verdicts 'ok' | 'outdated' |
//      'vulnerable' | 'unsupported' | 'unknown'. compareVersions
//      exported for Steps 13-14 to reuse.
//   3. SignerRecord schema + vault collection + migration slot.
//   4. registerSigner / listSignersForWallet / unregisterSigner
//      flows — re-pair is idempotent by (walletId, vendor,
//      deviceIdentifier).
//   5. DerivationPathCrossCheck component — renders §18.5's cross-
//      check UI. Used by sign screens when signer is HW.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

// Node 18 exposes WebCrypto only on `globalThis.crypto`; the schemas
// reach for the bare global, so install it before import cascades run.
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    flows,
    schemas,
    signers,
    storage,
} from '../../../packages/core/src/index.js';

const { InMemoryBackend, Vault } = storage;

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

// --- 1. Firmware manifest shape --------------------------------------

assert.ok(
    existsSync(join(core, 'src', 'signers', 'firmware-manifest.js')),
    'firmware-manifest.js exists',
);
assert.ok(
    !existsSync(join(core, 'src', 'signers', 'firmware-manifest.json')),
    'firmware-manifest.json does NOT exist (bundling-safe JS module is the canonical form)',
);
const manifest = signers.FIRMWARE_MANIFEST;
assert.ok(manifest && typeof manifest === 'object', 'FIRMWARE_MANIFEST is an object');
assert.equal(manifest.schema, 'firmware-manifest/1', 'manifest declares its schema');
assert.ok(
    typeof manifest.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(manifest.generatedAt),
    'manifest carries generatedAt as ISO date',
);
assert.ok(
    typeof manifest.walletVersion === 'string' && /^\d+\.\d+\.\d+/.test(manifest.walletVersion),
    'manifest carries walletVersion (links advisory data to a release)',
);
assert.ok(manifest.vendors?.trezor, 'manifest includes trezor vendor');
assert.ok(manifest.vendors?.ledger, 'manifest includes ledger vendor');
assert.ok(
    manifest.vendors.trezor.models?.T2T1?.minimum,
    'Trezor Model T entry present',
);
assert.ok(
    manifest.vendors.ledger.models?.nanoX?.minimum,
    'Ledger Nano X entry present',
);
assert.ok(
    manifest.vendors.trezor.updateUrl?.includes('trezor.io'),
    'trezor updateUrl points at trezor.io',
);

// --- 2. checkFirmware verdicts ----------------------------------------

const { checkFirmware, compareVersions } = signers;

// 2a. Happy path — recommended or above.
{
    const v = checkFirmware({ vendor: 'trezor', model: 'T2T1', version: '2.7.2' });
    assert.equal(v.status, 'ok');
    assert.equal(v.vendor, 'trezor');
    assert.equal(v.displayName, 'Trezor Model T');
    assert.equal(v.recommended, '2.7.2');
    assert.ok(v.updateUrl?.includes('trezor.io'));
}

// 2b. Outdated (above minimum, below recommended).
{
    const v = checkFirmware({ vendor: 'trezor', model: 'T2T1', version: '2.5.0' });
    assert.equal(v.status, 'outdated');
    assert.match(v.detail, /recommended/i);
}

// 2c. Unsupported — below minimum.
{
    const v = checkFirmware({ vendor: 'trezor', model: 'T2T1', version: '2.0.0' });
    assert.equal(v.status, 'unsupported');
    assert.match(v.detail, /minimum/i);
}

// 2d. Unsupported — via "1.x" major-only pattern (Ledger Nano S).
{
    const v = checkFirmware({ vendor: 'ledger', model: 'nanoS', version: '1.6.1' });
    assert.equal(v.status, 'unsupported');
    assert.match(v.detail, /not supported/i);
}

// 2e. Unknown vendor falls back to 'unknown' — wallet doesn't block
//     sign, but renders a neutral "verify with vendor" banner.
{
    const v = checkFirmware({ vendor: 'acme', model: 'xyz', version: '1.0.0' });
    assert.equal(v.status, 'unknown');
    assert.equal(v.updateUrl, null);
}

// 2f. Unknown model under a known vendor — still 'unknown', keeps the
//     vendor's updateUrl so the banner can link to the right page.
{
    const v = checkFirmware({ vendor: 'trezor', model: 'TX9', version: '9.0.0' });
    assert.equal(v.status, 'unknown');
    assert.ok(v.updateUrl?.includes('trezor.io'));
}

// 2g. Missing version string — 'unknown'.
{
    const v = checkFirmware({ vendor: 'trezor', model: 'T2T1', version: '' });
    assert.equal(v.status, 'unknown');
    assert.equal(v.version, null);
    assert.match(v.detail, /not reported/i);
}

// 2h. compareVersions handles missing segments + pre-release suffixes.
assert.equal(compareVersions('1.12', '1.12.0'), 0);
assert.equal(compareVersions('2.0.0', '2.0.1'), -1);
assert.equal(compareVersions('2.1.0', '2.0.99'), 1);
assert.equal(compareVersions('2.0.0-rc1', '2.0.0'), -1, 'pre-release < stable');

// --- 3. SignerRecord schema -------------------------------------------

assert.equal(typeof schemas.createSignerRecord, 'function');
assert.equal(typeof schemas.validateSignerRecord, 'function');
assert.deepEqual([...schemas.SIGNER_KINDS], ['trezor', 'ledger']);

const draft = schemas.createSignerRecord({
    walletId: 'wallet-1',
    kind: 'trezor',
    vendor: 'trezor',
    model: 'T2T1',
    deviceIdentifier: 'fake-device-id',
});
assert.equal(draft.schemaVersion, 1);
assert.equal(draft.walletId, 'wallet-1');
assert.equal(draft.label, 'Trezor', 'defaults label from kind');
assert.equal(draft.firmwareVersion, null);
const validated = schemas.validateSignerRecord(draft);
assert.equal(validated.ok, true, `valid record passes validator (errors: ${validated.errors})`);

// Missing fields rejected.
{
    const bad = schemas.validateSignerRecord({
        ...draft,
        deviceIdentifier: '',
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.some((e) => /deviceIdentifier/.test(e)));
}

// --- 4. Vault collection + codec slot ---------------------------------

const masterKey = new Uint8Array(32);
for (let i = 0; i < 32; i += 1) masterKey[i] = (i + 1) & 0xff;

const vault = new Vault({ backend: new InMemoryBackend(), masterKey });
await vault.open();

assert.ok(vault.signers, 'vault exposes a signers collection');
assert.deepEqual(await vault.signers.list(), [], 'signers starts empty');

// 4a. registerSigner creates + persists.
const created = await flows.registerSigner({
    vault,
    walletId: 'wallet-1',
    kind: 'trezor',
    vendor: 'trezor',
    model: 'T2T1',
    deviceIdentifier: 'dev-abc',
    firmwareVersion: '2.7.2',
});
assert.equal(created.kind, 'trezor');
assert.equal(created.firmwareVersion, '2.7.2');
assert.equal((await vault.signers.list()).length, 1);

// 4b. Re-registering the same physical device is idempotent — no
//     duplicate record, same id, firmware + lastSeenAt bumped.
const again = await flows.registerSigner({
    vault,
    walletId: 'wallet-1',
    kind: 'trezor',
    vendor: 'trezor',
    model: 'T2T1',
    deviceIdentifier: 'dev-abc',
    firmwareVersion: '2.7.3',
    label: 'My Trezor',
});
assert.equal(again.id, created.id, 're-pair returns the same record id');
assert.equal(again.firmwareVersion, '2.7.3', 'firmware version updates');
assert.equal(again.label, 'My Trezor', 'label updates');
assert.ok(again.lastSeenAt >= created.lastSeenAt, 'lastSeenAt is bumped (or equal)');
assert.equal((await vault.signers.list()).length, 1, 'still only one row');

// 4c. A different deviceIdentifier on the same wallet creates a
//     second record.
const second = await flows.registerSigner({
    vault,
    walletId: 'wallet-1',
    kind: 'ledger',
    vendor: 'ledger',
    model: 'nanoX',
    deviceIdentifier: 'dev-xyz',
});
assert.notEqual(second.id, created.id);
assert.equal((await vault.signers.list()).length, 2);

// 4d. listSignersForWallet filters by wallet.
const walletList = await flows.listSignersForWallet(vault, 'wallet-1');
assert.equal(walletList.length, 2);
assert.equal((await flows.listSignersForWallet(vault, 'nonexistent')).length, 0);

// 4e. unregisterSigner deletes; second call returns false.
assert.equal(await flows.unregisterSigner(vault, created.id), true);
assert.equal(await flows.unregisterSigner(vault, created.id), false);
assert.equal((await vault.signers.list()).length, 1);

// 4f. Codec round-trip preserves signers.
await vault.save();
await vault.close();
const masterKey2 = new Uint8Array(32);
for (let i = 0; i < 32; i += 1) masterKey2[i] = (i + 1) & 0xff;
const vault2 = new Vault({ backend: vault._backend, masterKey: masterKey2 });
await vault2.open();
assert.equal(
    (await vault2.signers.list()).length,
    1,
    'signers survive save/load round-trip',
);
await vault2.close();

// --- 5. DerivationPathCrossCheck component exists ---------------------

const xcheckPath = join(
    core, 'src', 'shared', 'components', 'DerivationPathCrossCheck.jsx',
);
const xcheckCssPath = join(
    core, 'src', 'shared', 'components', 'DerivationPathCrossCheck.module.css',
);
assert.ok(existsSync(xcheckPath), 'DerivationPathCrossCheck.jsx exists');
assert.ok(existsSync(xcheckCssPath), 'DerivationPathCrossCheck.module.css exists');

const xcheck = readFileSync(xcheckPath, 'utf8');
assert.ok(
    /export function DerivationPathCrossCheck\b/.test(xcheck),
    'DerivationPathCrossCheck is a named export',
);
assert.ok(
    /signerKind === 'trezor'/.test(xcheck) && /signerKind === 'ledger'/.test(xcheck),
    'component branches on signerKind for the device label',
);
assert.ok(
    /reject on the device/i.test(xcheck),
    'component renders the §18.5 cross-check copy',
);
assert.ok(
    /Verify[\s\S]*derivation path[\s\S]*address[\s\S]*on your/.test(xcheck),
    'component instructs user to compare both path and address against device screen',
);

const xcheckCss = readFileSync(xcheckCssPath, 'utf8');
for (const cls of ['.root', '.title', '.grid', '.label', '.value', '.path', '.instruction']) {
    assert.ok(xcheckCss.includes(cls), `cross-check CSS defines ${cls}`);
}

console.log(
    'OK — signer scaffold smoke (firmware manifest + checkFirmware verdicts + SignerRecord schema + vault collection + registerSigner idempotence + codec round-trip + DerivationPathCrossCheck component)',
);
