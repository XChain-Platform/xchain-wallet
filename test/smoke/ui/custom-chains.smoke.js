// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §9.7 / Cluster Q FOLLOWUP 2: custom (user-added) chain
// registry.
//
// Pins:
//   1. flows/customChains.js exports listCustomChains / addCustomChain /
//      removeCustomChain. The runtime flow validates via
//      validateChainDescriptor, persists to settings.customChains, and
//      mutates the running ChainRegistry.
//   2. Settings schema accepts settings.customChains as an
//      array-of-plain-objects v2-tolerant field.
//   3. createBackgroundHost imports the three flows, registers
//      chainRegistry.{listCustomChains,addCustomChain,removeCustomChain}
//      routes, and re-seeds the ChainRegistry from settings on first
//      settings.get via seedCustomChainsFromVault().
//   4. Three messaging shells (popup / web / desktop) export the three
//      shims with the canonical naming.
//   5. DeveloperModeSection mounts CustomChainsRow + the Add /
//      Remove UI.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    listCustomChains,
    addCustomChain,
    removeCustomChain,
} from '../../../packages/core/src/flows/customChains.js';
import { validateSettings } from '../../../packages/core/src/schemas/settings.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// ─── 1. flows/customChains.js shape ─────────────────────────────────────

const flowPath = join(wsRoot, 'packages/core/src/flows/customChains.js');
assert.ok(existsSync(flowPath), 'flows/customChains.js exists');
const flowSrc = readFileSync(flowPath, 'utf8');

assert.match(flowSrc, /import \{ validateChainDescriptor \}/,
    'addCustomChain validates via validateChainDescriptor');
assert.match(flowSrc, /export async function listCustomChains/,
    'listCustomChains exported');
assert.match(flowSrc, /export async function addCustomChain/,
    'addCustomChain exported');
assert.match(flowSrc, /export async function removeCustomChain/,
    'removeCustomChain exported');

// flows/index.js re-exports.
const flowsIndex = readFileSync(
    join(wsRoot, 'packages/core/src/flows/index.js'),
    'utf8',
);
assert.match(flowsIndex, /listCustomChains[\s\S]+?addCustomChain[\s\S]+?removeCustomChain[\s\S]+?from '\.\/customChains\.js'/,
    'flows/index.js re-exports the three');

// ─── 2. Behavioral round-trip via in-memory vault stub ──────────────────

function createVaultStub(initialSettings) {
    let settings = { ...initialSettings };
    return {
        settings: {
            async get() { return settings; },
            async put(next) { settings = { ...next }; },
        },
        _read: () => settings,
    };
}

const VALID_DESCRIPTOR = {
    id: 'forkcoin-regtest',
    coin: 'forkcoin',
    displayName: 'ForkCoin Regtest',
    networkKind: 'regtest',
    color: '#A1B2C3',
    icon: '',
    derivationPaths: { p2pkh: "m/44'/0'/A'/C/I" },
    addressTypes: ['p2pkh'],
    defaultAddressType: 'p2pkh',
    feeStrategy: {
        unit: 'sats-per-vbyte',
        supportedStrategies: ['low', 'normal', 'fast'],
        defaultStrategy: 'normal',
        rbfSupported: false,
    },
    supportedActions: ['SEND'],
    uriScheme: 'forkcoin',
    wifVersionByte: 0xef,
    explorer: { defaultUrl: 'http://127.0.0.1', defaultPort: 8090 },
    encoder: { defaultUrl: 'http://127.0.0.1', defaultPort: 8091 },
    hub: { defaultUrl: 'http://127.0.0.1', defaultPort: 8092 },
    adsDonationAddress: 'PLACEHOLDER_REPLACE_BEFORE_MAINNET',
};

// listCustomChains returns [] initially.
{
    const vault = createVaultStub({ schemaVersion: 2 });
    const list = await listCustomChains({ vault });
    assert.deepEqual(list, [], 'empty list when settings.customChains is missing');
}

// addCustomChain validates + persists + registers.
{
    const vault = createVaultStub({ schemaVersion: 2 });
    const registry = new ChainRegistry();
    const beforeRegistered = registry.has(VALID_DESCRIPTOR.id);
    assert.equal(beforeRegistered, false, 'registry starts without the custom chain');

    const r = await addCustomChain({ vault, chainRegistry: registry, descriptor: VALID_DESCRIPTOR });
    assert.equal(r.descriptor.id, VALID_DESCRIPTOR.id, 'returns the descriptor');
    assert.equal(registry.has(VALID_DESCRIPTOR.id), true, 'registry now knows the chain');
    const persisted = vault._read().customChains;
    assert.equal(persisted.length, 1, 'descriptor persisted');
    assert.equal(persisted[0].id, VALID_DESCRIPTOR.id, 'persisted record id matches');
}

// addCustomChain rejects invalid descriptors with the validator's errors.
{
    const vault = createVaultStub({ schemaVersion: 2 });
    const registry = new ChainRegistry();
    const broken = { ...VALID_DESCRIPTOR, id: '' };
    await assert.rejects(
        () => addCustomChain({ vault, chainRegistry: registry, descriptor: broken }),
        /invalid descriptor/i,
        'invalid descriptor rejected',
    );
    assert.equal(vault._read().customChains, undefined, 'no persisted record on rejection');
}

// addCustomChain rejects duplicate ids (vs already-registered).
{
    const vault = createVaultStub({ schemaVersion: 2 });
    const registry = new ChainRegistry();
    await addCustomChain({ vault, chainRegistry: registry, descriptor: VALID_DESCRIPTOR });
    await assert.rejects(
        () => addCustomChain({ vault, chainRegistry: registry, descriptor: VALID_DESCRIPTOR }),
        /already registered/i,
        'duplicate id rejected',
    );
}

// addCustomChain refuses to override a bundled chain id.
{
    const vault = createVaultStub({ schemaVersion: 2 });
    const registry = new ChainRegistry();
    const collide = { ...VALID_DESCRIPTOR, id: 'bitcoin-mainnet' };
    await assert.rejects(
        () => addCustomChain({ vault, chainRegistry: registry, descriptor: collide }),
        /already registered|reserved id/i,
        'bundled-chain id collision rejected',
    );
}

// removeCustomChain unwires both registry + persistence.
{
    const vault = createVaultStub({ schemaVersion: 2 });
    const registry = new ChainRegistry();
    await addCustomChain({ vault, chainRegistry: registry, descriptor: VALID_DESCRIPTOR });
    assert.equal(registry.has(VALID_DESCRIPTOR.id), true, 'registered after add');
    const r = await removeCustomChain({
        vault, chainRegistry: registry, chainId: VALID_DESCRIPTOR.id,
    });
    assert.equal(r.removed, true, 'remove reports true');
    assert.equal(registry.has(VALID_DESCRIPTOR.id), false, 'registry no longer knows the chain');
    assert.deepEqual(vault._read().customChains, [], 'persisted list emptied');
}

// removeCustomChain refuses bundled chains with a friendly message.
{
    const vault = createVaultStub({ schemaVersion: 2 });
    const registry = new ChainRegistry();
    await assert.rejects(
        () => removeCustomChain({
            vault, chainRegistry: registry, chainId: 'bitcoin-mainnet',
        }),
        /bundled chain/i,
        'bundled chain refuses removal',
    );
}

// ─── 3. Settings schema accepts customChains ────────────────────────────

const baseSettings = {
    schemaVersion: 3,
    theme: 'system',
    reducedMotion: 'auto',
    autolockMinutes: 15,
    fiatCurrency: 'USD',
    language: 'en',
    sdkEndpoints: {},
    fees: {},
    privacy: {
        torRouting: false,
        changeAddressRotation: true,
        hideSmallBalances: false,
        blurOnBlur: false,
        labelsSurviveRestore: false,
    },
    ads: { enabled: true, perChain: {} },
    notifications: {
        txConfirmations: true,
        incomingReceipts: true,
        dispenserFills: true,
        orderFills: true,
        priceAlerts: false,
    },
    developerMode: false,
    learnMode: false,
    grace: { undoSendSeconds: 5, testSendThresholdSats: 0 },
    panicMode: { enabled: false },
    backupReminders: 'off',
};

{
    const r = validateSettings({ ...baseSettings, customChains: [VALID_DESCRIPTOR] });
    assert.equal(r.ok, true, 'settings with customChains array validates');
}
{
    const r = validateSettings({ ...baseSettings, customChains: [] });
    assert.equal(r.ok, true, 'empty customChains array validates');
}
{
    const r = validateSettings({ ...baseSettings, customChains: 'nope' });
    assert.equal(r.ok, false, 'non-array customChains is rejected');
}

// ─── 4. createBackgroundHost wiring ─────────────────────────────────────

const hostSrc = readFileSync(
    join(wsRoot, 'packages/extension/src/background/createBackgroundHost.js'),
    'utf8',
);

assert.match(hostSrc, /listCustomChains[\s\S]+?addCustomChain[\s\S]+?removeCustomChain/,
    'host destructures the three flows');
assert.match(hostSrc, /host\.register\('chainRegistry\.listCustomChains'/,
    'listCustomChains route registered');
assert.match(hostSrc, /host\.register\('chainRegistry\.addCustomChain'/,
    'addCustomChain route registered');
assert.match(hostSrc, /host\.register\('chainRegistry\.removeCustomChain'/,
    'removeCustomChain route registered');
assert.match(hostSrc, /seedCustomChainsFromVault/,
    'seedCustomChainsFromVault helper present');
// The seed and the endpoint-override pass share one sequenced task, so the
// override map is rebuilt against a registry that already knows the
// user-added chain. Behaviour lives in
// test/unit/background/customChainsSeedRetry.test.js; this pins the shape.
assert.match(hostSrc, /await seedCustomChainsFromVault\(vault, chainRegistry\);\s*\n\s*await applyEndpointOverridesFromVault\(vault, sdkRegistry\);/,
    'settings.get triggers the seed and then the endpoint overrides');

// ─── 5. Three messaging shells expose the shims ─────────────────────────

const shells = [
    'packages/extension/src/popup/messaging.js',
    'packages/web/src/messaging.js',
    'packages/desktop/renderer/messaging.js',
];
for (const shellPath of shells) {
    const src = readFileSync(join(wsRoot, shellPath), 'utf8');
    assert.match(src, /export function listCustomChains/, `${shellPath}: listCustomChains shim`);
    assert.match(src, /export function addCustomChain/, `${shellPath}: addCustomChain shim`);
    assert.match(src, /export function removeCustomChain/, `${shellPath}: removeCustomChain shim`);
    assert.match(src, /chainRegistry\.listCustomChains/, `${shellPath}: routes to chainRegistry.listCustomChains`);
    assert.match(src, /chainRegistry\.addCustomChain/, `${shellPath}: routes to chainRegistry.addCustomChain`);
    assert.match(src, /chainRegistry\.removeCustomChain/, `${shellPath}: routes to chainRegistry.removeCustomChain`);
}

// ─── 6. DeveloperModeSection wiring ─────────────────────────────────────

const sectionSrc = readFileSync(
    join(wsRoot, 'packages/core/src/shared/components/settings/DeveloperModeSection.jsx'),
    'utf8',
);
assert.match(sectionSrc, /CustomChainsRow/, 'DeveloperModeSection mounts CustomChainsRow');
assert.match(sectionSrc, /messaging\.listCustomChains/, 'CustomChainsRow calls messaging.listCustomChains');
assert.match(sectionSrc, /messaging\.addCustomChain/, 'CustomChainsRow calls messaging.addCustomChain');
assert.match(sectionSrc, /messaging\.removeCustomChain/, 'CustomChainsRow calls messaging.removeCustomChain');

// ─── 7. Every UI realm hydrates its OWN registry from settings ──────────
//
// The host seeds only the ChainRegistry instance it holds. The MV3 popup,
// the approval window and the desktop renderer each run a separate realm
// with their own defaultRegistry(), so each must install the persisted
// custom chains itself or every registry-derived surface there (endpoint
// editor, regtest blocks, pickers) keeps showing bundled chains only.

const registryIndexSrc = readFileSync(join(wsRoot, 'packages/core/src/registry/index.js'), 'utf8');
assert.match(registryIndexSrc, /export \{ hydrateCustomChainsFromSettings \}/,
    'registry barrel exports hydrateCustomChainsFromSettings');

// Popup + desktop renderer + web: the shared settings hook hydrates on every
// successful read, which is also the first readable moment after unlock.
const useSettingsSrc = readFileSync(
    join(wsRoot, 'packages/core/src/shared/hooks/useSettings.js'),
    'utf8',
);
assert.match(useSettingsSrc, /hydrateCustomChainsFromSettings\(defaultRegistry\(\), next\)/,
    'useSettings hydrates the realm registry from each settings read');

// Approval window: outside MessagingProvider, so it hydrates directly.
const approvalMainSrc = readFileSync(join(wsRoot, 'packages/extension/src/approval/main.jsx'), 'utf8');
assert.match(approvalMainSrc, /hydrateCustomChainsFromSettings\(registry\.defaultRegistry\(\)/,
    'approval entry hydrates its realm registry at boot');
const signApprovalSrc = readFileSync(
    join(wsRoot, 'packages/extension/src/approval/kinds/SignApproval.jsx'),
    'utf8',
);
assert.match(signApprovalSrc, /hydrateCustomChainsFromSettings\(chainRegistry, s\)/,
    'SignApproval hydrates its realm registry from the unlocked settings read');
// ConnectApproval carries no password gate, so it hydrates on mount and reads
// the list through the live hook: behaviour lives in
// test/unit/approval/connectApprovalChains.test.jsx.
const connectApprovalSrc = readFileSync(
    join(wsRoot, 'packages/extension/src/approval/kinds/ConnectApproval.jsx'),
    'utf8',
);
assert.match(connectApprovalSrc, /hydrateCustomChainsFromSettings\(chainRegistry, s\)/,
    'ConnectApproval hydrates its realm registry from the settings read');
assert.match(connectApprovalSrc, /useSupportedChains\(chainRegistry\)/,
    'ConnectApproval reads the chain list from the live registry');

// Same-session add / remove mirrors into the calling realm's registry.
assert.match(sectionSrc, /chainRegistry\.addCustom\(accepted\)/,
    'CustomChainsRow installs an accepted descriptor into the local registry');
assert.match(sectionSrc, /chainRegistry\.removeCustom\(chainId\)/,
    'CustomChainsRow mirrors a removal into the local registry');

console.log('OK: custom chain registry flow + schema + host + shells + UI + per-realm hydration');
