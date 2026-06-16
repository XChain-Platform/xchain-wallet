// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Cluster Q FOLLOWUP 4. Pins logConsole.record() emission
// points across vault / signer / encoder / bridge so the panel surfaces
// real activity, not just console.* output.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Vault open / close / clear records vault lifecycle into logConsole.
const vaultSrc = read('packages/core/src/storage/Vault.js');
assert.ok(/import \{ logConsole \} from '\.\.\/shared\/utils\/logConsole\.js'/.test(vaultSrc),
    'Vault.js imports logConsole');
assert.ok(/source: 'vault'[\s\S]*?'open \(empty\)'/.test(vaultSrc),
    'Vault.open records an open entry into logConsole');
assert.ok(/source: 'vault'[\s\S]*?'close'/.test(vaultSrc),
    'Vault.close records a close entry into logConsole');
assert.ok(/source: 'vault'[\s\S]*?'clear'/.test(vaultSrc),
    'Vault.clear records a clear entry into logConsole');

// 2. SoftwareSigner records unlock / lock / signPsbt / signMessage and
//    both multisig signer methods.
const signerSrc = read('packages/core/src/signers/SoftwareSigner.js');
assert.ok(/import \{ logConsole \} from '\.\.\/shared\/utils\/logConsole\.js'/.test(signerSrc),
    'SoftwareSigner.js imports logConsole');
for (const fragment of [
    'unlock id=',
    'lock id=',
    'signPsbt chain=',
    'signMessage chain=',
    'signMultisigClassical chain=',
    'signMultisigPsbt chain=',
]) {
    assert.ok(signerSrc.includes(fragment),
        `SoftwareSigner records "${fragment}" into logConsole`);
}
// And the wif-only unlock branch records too.
assert.ok(/format=wif-only/.test(signerSrc),
    'SoftwareSigner.unlock wif-only branch records its own log entry');

// 3. buildActionPsbt logs the encoder request + response.
const buildSrc = read('packages/core/src/flows/buildActionPsbt.js');
assert.ok(/import \{ logConsole \} from '\.\.\/shared\/utils\/logConsole\.js'/.test(buildSrc),
    'buildActionPsbt.js imports logConsole');
assert.ok(/source: 'encoder'[\s\S]*?'createTx action='/.test(buildSrc)
    || /createTx action=\$\{opts\.actionData\.action\}/.test(buildSrc),
    'buildActionPsbt records the encoder request');
assert.ok(/createTx ok action=/.test(buildSrc),
    'buildActionPsbt records the encoder response');

// 4. Bridge handlers wrap every host.register through a logging helper.
const bridgeSrc = read('packages/extension/src/bridge/handlers.js');
assert.ok(/from '@xchain-wallet\/core\/shared\/utils\/logConsole\.js'/.test(bridgeSrc),
    'bridge handlers import logConsole');
// The local register() shadows host.register and adds entry/exit/error
// log lines. Pin its presence and the source pattern.
assert.ok(/const register = \(name, handler\) => \{[\s\S]*?host\.register\(name,/.test(bridgeSrc),
    'bridge handlers wrap host.register through a local logging helper');
assert.ok(/source: `bridge:\$\{name\}`/.test(bridgeSrc),
    'bridge log entries are tagged source=bridge:<channel>');
assert.ok(/'→ '/.test(bridgeSrc) || /`→ \$\{origin\}`/.test(bridgeSrc),
    'bridge wrapper records an entry arrow with origin');
assert.ok(/'← ok'/.test(bridgeSrc), 'bridge wrapper records ok exit');
assert.ok(/`← \$\{code\}`/.test(bridgeSrc), 'bridge wrapper records error code on throw');

// All 11 known bridge handlers must register through the logging
// wrapper, not bare host.register.
const expectedHandlers = [
    'bridge.connect',
    'bridge.disconnect',
    'bridge.getAccounts',
    'bridge.getAddresses',
    'bridge.getBalances',
    'bridge.getSupportedChains',
    'bridge.getActiveChains',
    'bridge.signMessage',
    'bridge.signAction',
    'bridge.signPsbt',
    'bridge.parallel',
    'bridge.signIn',
];
for (const channel of expectedHandlers) {
    const inWrapper = new RegExp(`\\bregister\\('${channel.replace(/\./g, '\\.')}'`).test(bridgeSrc);
    const bareHostRegister = new RegExp(`host\\.register\\('${channel.replace(/\./g, '\\.')}'`).test(bridgeSrc);
    assert.ok(inWrapper, `bridge handler ${channel} registers through the logging wrapper`);
    assert.ok(!bareHostRegister, `bridge handler ${channel} no longer calls host.register directly`);
}

// 5. Behavioural — the logConsole module accepts the new structured
//    record() calls without throwing and reflects them in entries().
//    Verifies the API contract the surfaces above rely on.
const { logConsole } = await import(
    new URL('../../../packages/core/src/shared/utils/logConsole.js', import.meta.url).href
);
logConsole.clear();
const before = logConsole.entries().length;
logConsole.record({ source: 'vault', level: 'info', message: 'open (empty)' });
logConsole.record({ source: 'signer:software', level: 'info', message: 'signPsbt chain=bitcoin' });
logConsole.record({ source: 'encoder', level: 'info', message: 'createTx action=ISSUE chain=bitcoin' });
logConsole.record({ source: 'bridge:bridge.connect', level: 'info', message: '→ https://example.test' });
logConsole.record({ source: 'bridge:bridge.connect', level: 'warn', message: '← UserRejectedError' });
const after = logConsole.entries();
assert.equal(after.length - before, 5,
    'logConsole.record stores all five emitted entries');
assert.deepEqual(after.slice(-5).map((e) => e.source), [
    'vault',
    'signer:software',
    'encoder',
    'bridge:bridge.connect',
    'bridge:bridge.connect',
]);
assert.equal(after.at(-1).level, 'warn',
    'logConsole.record preserves the level on the final bridge error entry');
logConsole.clear();

console.log('OK — logConsole emissions across vault / signer / encoder / bridge');
