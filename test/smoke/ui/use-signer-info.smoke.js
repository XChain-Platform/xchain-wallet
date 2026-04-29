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

const adopters = [
    ['Send.jsx', sendPath],
    ['BroadcastForm.jsx', join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'BroadcastForm.jsx')],
    ['DividendForm.jsx', join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'DividendForm.jsx')],
    ['DestroyForm.jsx', join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'DestroyForm.jsx')],
    ['TokenAdminForm.jsx', join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'TokenAdminForm.jsx')],
];

for (const [label, path] of adopters) {
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
        // Send is the canonical adopter that already passed signerInfo
        // via its own HwSignBlock; the others thread it through
        // SignCredentials.
        assert.ok(/<SignCredentials\b[\s\S]*?signerInfo=\{hwSignerInfo\}/.test(src),
            `${label} passes signerInfo into <SignCredentials>`);
    }
}

assert.ok(
    !/const \[signersByWallet, setSignersByWallet\] = useState/.test(readFileSync(sendPath, 'utf8')),
    'Send.jsx no longer keeps an inline signersByWallet state slot',
);

console.log(
    'OK — use-signer-info smoke (§18.4 / Cluster N FOLLOWUP 2 — useSignerInfo hook + walletId-keyed cache + Send.jsx canonical adopter; sweep continues with BroadcastForm + DividendForm + DestroyForm + TokenAdminForm threading signerInfo through SignCredentials; each form uses the same isHwSource-gated lookup shape)',
);
