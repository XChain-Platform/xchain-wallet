// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for leg 2: a real wallet must never be added into a vault
// the demo created.
//
// The vault has ONE password. `meta.kdfParams` is written when the vault
// is created; the master key that opens every record inside it comes
// from that password alone. In the demo funnel the vault was created by
// the demo, using a random throwaway password the user never saw. A
// wallet added there carries the user's chosen password on its own
// encryptedSeed but sits inside a container that still answers only to
// the demo's, so once the demo exits (or its 24h auto-wipe fires) the
// chosen password is refused with a bare "Incorrect password" and the
// wallet is unreachable on that device.
//
// Pins:
//   - the shared demo-graduation module and its exported surface
//   - the three demo escapes route through one teardown (no drift)
//   - Onboarding takes a `mode` prop and gates the add lane on it
//   - all three shells pass mode="add" in the add-wallet lane and
//     resume the picked lane after the wipe's reload

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    POST_DEMO_INTENT_KEY,
    POST_DEMO_INTENTS,
    setPostDemoIntent,
    takePostDemoIntent,
    demoOwnsVaultPassword,
    readVaultOccupancy,
    isVaultEmpty,
    exitDemoWallet,
} from '../../../packages/core/src/shared/utils/demoGraduation.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ─── 1. exported surface ────────────────────────────────────────────────

for (const [name, fn] of Object.entries({
    setPostDemoIntent,
    takePostDemoIntent,
    demoOwnsVaultPassword,
    readVaultOccupancy,
    isVaultEmpty,
    exitDemoWallet,
})) {
    assert.equal(typeof fn, 'function', `${name} exported`);
}
assert.equal(POST_DEMO_INTENT_KEY, 'xc:postDemoOnboardingStep', 'intent storage key pinned');
assert.deepEqual(
    POST_DEMO_INTENTS,
    ['create', 'import', 'import-freewallet'],
    'only the three onboarding lanes can be resumed',
);

// ─── 2. the gate itself ─────────────────────────────────────────────────

assert.equal(
    demoOwnsVaultPassword({ mode: 'add', demoWalletId: 'demo-1' }),
    true,
    'add-wallet inside a demo is gated',
);
assert.equal(
    demoOwnsVaultPassword({ mode: 'add', demoWalletId: null }),
    false,
    'a normal multi-wallet vault is untouched',
);
assert.equal(
    demoOwnsVaultPassword({ mode: 'fresh', demoWalletId: 'demo-1' }),
    false,
    'the fresh-install lane makes its own vault and is untouched',
);

// ─── 3. one teardown, three escapes ─────────────────────────────────────

const graduationSrc = read('packages', 'core', 'src', 'shared', 'utils', 'demoGraduation.js');
assert.match(
    graduationSrc,
    /const remaining = await readVaultOccupancy\(messaging\);\s*\n\s*if \(remaining !== 'empty'\) return/,
    'the wipe fires only on a confirmed-empty vault (unreadable never wipes)',
);
assert.match(
    graduationSrc,
    /if \(intent\) setPostDemoIntent\(intent\);\s*\n\s*await wipe\(\);/,
    'the resume lane is recorded only on the wiping branch',
);

for (const [label, path] of [
    ['WalletDetails', ['packages', 'core', 'src', 'shared', 'routes', 'WalletDetails.jsx']],
    ['DemoBanner', ['packages', 'core', 'src', 'shared', 'components', 'DemoBanner.jsx']],
    ['Onboarding', ['packages', 'core', 'src', 'shared', 'routes', 'Onboarding.jsx']],
]) {
    assert.match(
        read(...path),
        /exitDemoWallet/,
        `${label} routes its demo exit through the shared teardown`,
    );
}

// ─── 4. Onboarding gates the add lane ───────────────────────────────────

const onboardingSrc = read('packages', 'core', 'src', 'shared', 'routes', 'Onboarding.jsx');
assert.match(
    onboardingSrc,
    /mode = 'fresh'/,
    'Onboarding takes a mode prop defaulting to the fresh-install lane',
);
assert.match(
    onboardingSrc,
    /demoOwnsVaultPassword\(\{ mode, demoWalletId \}\)/,
    'Onboarding gates on the shared predicate',
);
assert.match(
    onboardingSrc,
    /const \[demoWalletId\] = useState\(\(\) => flowsLib\.getDemoWalletId\(\)\)/,
    'the demo id is latched at mount so the teardown cannot yank the screen mid-flow',
);
assert.match(
    onboardingSrc,
    /Leave the demo first/,
    'the gate explains itself rather than silently disabling the lane',
);
for (const lane of ['create', 'import', 'import-freewallet']) {
    assert.match(
        onboardingSrc,
        new RegExp(`handleGraduate\\('${lane.replace(/-/g, '-')}'`),
        `the ${lane} lane graduates out of the demo first`,
    );
}
assert.match(
    onboardingSrc,
    /remaining === 'unknown'/,
    'an unreadable vault surfaces an error instead of waving the user through',
);

// ─── 5. all three shells ────────────────────────────────────────────────

const shells = [
    ['web', ['packages', 'web', 'src', 'App.jsx']],
    ['extension popup', ['packages', 'extension', 'src', 'popup', 'App.jsx']],
    ['desktop renderer', ['packages', 'desktop', 'renderer', 'App.jsx']],
];

for (const [label, path] of shells) {
    const src = read(...path);
    assert.match(
        src,
        /import \{ takePostDemoIntent \} from '@xchain-wallet\/core\/shared\/utils\/demoGraduation\.js'/,
        `${label} imports the post-demo resume`,
    );
    assert.match(
        src,
        /useState\(\s*\n\s*\/\*\*[^\n]*\*\/\s*\n\s*\(\) => takePostDemoIntent\(\) \|\| 'welcome',\s*\n\s*\);/,
        `${label} seeds onboardingStep from the resumed lane`,
    );
    const addLane = src.slice(src.indexOf("unlockedView === 'add-wallet'"));
    const onboarding = addLane.slice(addLane.indexOf('<Onboarding'));
    assert.match(
        onboarding.slice(0, 400),
        /mode="add"/,
        `${label} marks the add-wallet Onboarding as the add lane`,
    );
}

// ─── 6. behaviour ───────────────────────────────────────────────────────

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
};

setPostDemoIntent('import-freewallet');
assert.equal(takePostDemoIntent(), 'import-freewallet', 'the picked lane survives the reload');
assert.equal(takePostDemoIntent(), null, 'and is one-shot');

setPostDemoIntent('pair-partner');
assert.equal(takePostDemoIntent(), null, 'an unsupported lane is never stored');

store.set('xc:demoWalletId', 'demo-1');
let wiped = 0;
const removed = [];
const result = await exitDemoWallet({
    messaging: {
        listWallets: async () => [],
        removeWallet: async ({ walletId }) => { removed.push(walletId); },
    },
    walletId: 'demo-1',
    intent: 'create',
    wipe: async () => { wiped += 1; },
    reload: () => true,
});
assert.deepEqual(result, { wiped: true, reloaded: true, remaining: 'empty' });
assert.deepEqual(removed, ['demo-1'], 'the demo record is removed');
assert.equal(wiped, 1, 'the demo-keyed vault store is cleared');
assert.equal(store.get('xc:demoWalletId'), undefined, 'the demo flag is cleared');
assert.equal(takePostDemoIntent(), 'create', 'the create lane resumes after the reload');

store.set('xc:demoWalletId', 'demo-1');
wiped = 0;
const kept = await exitDemoWallet({
    messaging: {
        listWallets: async () => [{ id: 'real-1' }],
        removeWallet: async () => {},
    },
    walletId: 'demo-1',
    intent: 'create',
    wipe: async () => { wiped += 1; },
    reload: () => true,
});
assert.deepEqual(kept, { wiped: false, reloaded: false, remaining: 'occupied' });
assert.equal(wiped, 0, 'a vault still holding a real wallet is never wiped');

delete globalThis.localStorage;

console.log('OK: demo add-wallet graduation smoke (leg 2: the add lane refuses to grow a demo-keyed vault; one shared teardown behind all three demo escapes; three shells pass mode="add" and resume the picked lane across the wipe reload)');
