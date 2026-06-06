// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// §18.4 / Cluster N FOLLOWUP 2 smoke — useSignerInfo hook + Send.jsx
// adoption.
//
// Asserts:
//   1. packages/core/src/shared/hooks/useSignerInfo.js exists and
//      exports `useSignerInfo` + `__clearSignerInfoCache` (test helper).
//   2. The hook owns a module-level cache, calls
//      `messaging.listSigners(walletId)` once per walletId, and
//      returns `{ vendor, model, firmwareVersion }` keyed off
//      `signerId`.
//   3. Send.jsx imports the hook and consumes it instead of the
//      previous inline `signersByWallet` state + useEffect lookup.
//   4. The hook null-guards: missing walletId / missing signerId /
//      record-not-found all return null so the banner just doesn't
//      render.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const hookPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'useSignerInfo.js');
const sendPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');

// --- 1. File exists + exports ------------------------------------------

assert.ok(existsSync(hookPath), 'useSignerInfo.js exists');
const hookSrc = readFileSync(hookPath, 'utf8');
assert.ok(/export function useSignerInfo\(\{ walletId, signerId \}\)/.test(hookSrc),
    'useSignerInfo is a named export with the right signature');
assert.ok(/export function __clearSignerInfoCache\(\)/.test(hookSrc),
    '__clearSignerInfoCache exists for test reset');

// --- 2. Module-level cache + listSigners + return shape ----------------

assert.ok(/const cache = .*new Map\(\)/.test(hookSrc),
    'hook owns a module-level cache (Map)');
assert.ok(/messaging\.listSigners\(walletId\)/.test(hookSrc),
    'hook calls messaging.listSigners(walletId)');
assert.ok(/cache\.set\(walletId,\s*arr\)/.test(hookSrc),
    'hook caches the list keyed by walletId');
assert.ok(
    /vendor:\s*rec\.vendor[\s\S]*?model:\s*rec\.model[\s\S]*?firmwareVersion:\s*rec\.firmwareVersion \?\? null/.test(hookSrc),
    'hook returns { vendor, model, firmwareVersion } pulled from the matching record',
);

// --- 3. Null guards ----------------------------------------------------

assert.ok(/if \(!signerId\) return null/.test(hookSrc),
    'hook returns null when signerId is missing');
assert.ok(/if \(!walletId \|\| typeof messaging\?\.listSigners !== 'function'\) return undefined/.test(hookSrc),
    'hook short-circuits on missing walletId / messaging');

// --- 4. Adopters: Send + BroadcastForm + DividendForm + DestroyForm
//        + TokenAdminForm all import the hook + thread signerInfo
//        through SignCredentials. Each form's lookup uses the same
//        `isHwSource ? fromAddress?.signerId : null` shape.

const routes = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');

// Two adoption shapes:
//   A) `isHwSource` boolean: Send / BroadcastForm / DividendForm /
//      DestroyForm / TokenAdminForm / ExecuteContractForm /
//      StakingActionForm — gate via `isHwSource ? fromAddress?.signerId : null`.
//   B) `hw` from `isHwSource(fromAddress)` helper: SwapForm / ComposeMessage.
const adoptersA = [
    ['Send.jsx', sendPath],
    ['BroadcastForm.jsx', join(routes, 'BroadcastForm.jsx')],
    ['DividendForm.jsx', join(routes, 'DividendForm.jsx')],
    ['DestroyForm.jsx', join(routes, 'DestroyForm.jsx')],
    ['TokenAdminForm.jsx', join(routes, 'TokenAdminForm.jsx')],
    ['ExecuteContractForm.jsx', join(routes, 'ExecuteContractForm.jsx')],
    ['StakingActionForm.jsx', join(routes, 'StakingActionForm.jsx')],
];
const adoptersB = [
    ['SwapForm.jsx', join(routes, 'SwapForm.jsx')],
    ['ComposeMessage.jsx', join(routes, 'ComposeMessage.jsx')],
];

for (const [label, path] of adoptersA) {
    const src = readFileSync(path, 'utf8');
    assert.ok(
        /import\s*\{\s*useSignerInfo\s*\}\s*from\s*'\.\.\/hooks\/useSignerInfo\.js'/.test(src),
        `${label} imports useSignerInfo`,
    );
    assert.ok(
        /useSignerInfo\(\{[\s\S]*?walletId,[\s\S]*?signerId:\s*isHwSource \? fromAddress\?\.signerId : null,?[\s\S]*?\}\)/.test(src),
        `${label} calls useSignerInfo with isHwSource-gated signerId`,
    );
    if (label !== 'Send.jsx') {
        assert.ok(/<SignCredentials\b[\s\S]*?signerInfo=\{hwSignerInfo\}/.test(src),
            `${label} passes signerInfo into <SignCredentials>`);
    }
}

for (const [label, path] of adoptersB) {
    const src = readFileSync(path, 'utf8');
    assert.ok(
        /import\s*\{\s*useSignerInfo\s*\}\s*from\s*'\.\.\/hooks\/useSignerInfo\.js'/.test(src),
        `${label} imports useSignerInfo`,
    );
    assert.ok(
        /useSignerInfo\(\{[\s\S]*?walletId,[\s\S]*?signerId:\s*hw \? fromAddress\?\.signerId : null,?[\s\S]*?\}\)/.test(src),
        `${label} calls useSignerInfo with hw-gated signerId (helper-style adoption)`,
    );
    assert.ok(/<SignCredentials\b[\s\S]*?signerInfo=\{hwSignerInfo\}/.test(src),
        `${label} passes signerInfo into <SignCredentials>`);
}

assert.ok(
    !/const \[signersByWallet, setSignersByWallet\] = useState/.test(readFileSync(sendPath, 'utf8')),
    'Send.jsx no longer keeps an inline signersByWallet state slot',
);

console.log(
    'OK — use-signer-info smoke (§18.4 / Cluster N FOLLOWUP 2 — useSignerInfo hook + walletId-keyed cache + Send.jsx canonical adopter; sweep continues with BroadcastForm + DividendForm + DestroyForm + TokenAdminForm threading signerInfo through SignCredentials; each form uses the same isHwSource-gated lookup shape)',
);
