// Smoke for Phase 2 — Step 22b (piece 7b part 2) — DispenserExplorer
// (§40.7.2 browse surface) + DispenserDetail buyer surface extensions.
//
// Asserts:
//   1. DispenserExplorer.jsx exists + exports a single component.
//   2. Supports two search modes (token / address) with a chain filter
//      (all chains vs specific). Empty-state wording asks the user to
//      enter a search term. Regex-validates token input.
//   3. Token searches route through messaging.getDispensersForToken;
//      address searches through messaging.getDispensersForAddress.
//   4. DispenserDetail gains a buyer surface for non-owners:
//        - token-paid lane → Buy Fills stage calling messaging.sendAsset
//          with asset = get_tick, amount = get_amount * fills,
//          to = dispenser address. Password re-prompt + wrong-password
//          handling + danger-aware hint about UTXO-chain buy race.
//        - coin-paid lane → Pay Here panel with copy-address + copy-
//          amount helpers and a note that native-coin send from this
//          wallet is on the roadmap.
//   5. ActionsMenu "Browse dispensers" entry is registered; popup + web
//      + desktop App.jsx track the 'dispenser-explorer' sub-route and
//      tag dispenserRef with origin: 'explorer' vs 'list' so the
//      detail page's back button routes to the right parent.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const explorerPath = join(sharedRoutes, 'DispenserExplorer.jsx');
const detailPath = join(sharedRoutes, 'DispenserDetail.jsx');
assert.ok(existsSync(explorerPath), 'DispenserExplorer.jsx exists');

const explorerSrc = readFileSync(explorerPath, 'utf8');
const detailSrc = readFileSync(detailPath, 'utf8');

// --- 1. Single-component export ---------------------------------------

assert.ok(
    /export function DispenserExplorer\b/.test(explorerSrc),
    'DispenserExplorer is a named export',
);
assert.equal(
    (explorerSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'DispenserExplorer.jsx only exports the component',
);

// --- 2. Search modes + chain filter -----------------------------------

assert.ok(/searchMode/.test(explorerSrc), 'explorer tracks searchMode state');
for (const mode of ["'token'", "'address'"]) {
    assert.ok(
        explorerSrc.includes(mode),
        `explorer supports search mode ${mode}`,
    );
}
assert.ok(
    /chainFilter/.test(explorerSrc),
    'explorer tracks chainFilter state',
);
assert.ok(
    /All chains/.test(explorerSrc),
    'explorer offers an "All chains" option that fans out per-chain',
);
assert.ok(
    /Token search accepts A–Z, 0–9, period, or \^TICK_ID/.test(explorerSrc),
    'explorer validates token input shape',
);
assert.ok(
    /Search by token ticker to find open dispensers/.test(explorerSrc),
    'explorer renders empty-state wording before the first search',
);

// --- 3. Search routing -------------------------------------------------

assert.ok(
    /messaging\.getDispensersForToken/.test(explorerSrc),
    'token searches call messaging.getDispensersForToken',
);
assert.ok(
    /messaging\.getDispensersForAddress/.test(explorerSrc),
    'address searches call messaging.getDispensersForAddress',
);
assert.ok(
    /Promise\.all\(targetChains\.map/.test(explorerSrc),
    'explorer fans out queries per target chain in parallel',
);

// --- 4. DispenserDetail buyer surfaces --------------------------------

assert.ok(/isTokenPaid/.test(detailSrc), 'detail detects token-paid lane');
assert.ok(/isCoinPaid/.test(detailSrc), 'detail detects coin-paid lane');
assert.ok(
    /buyStage/.test(detailSrc),
    'detail tracks buyStage state for the buy flow',
);
assert.ok(
    /messaging\.sendAsset/.test(detailSrc),
    'token-paid buy invokes messaging.sendAsset',
);
assert.ok(
    /asset:\s*getTick/.test(detailSrc),
    'token-paid buy sends GET_TICK',
);
assert.ok(
    /amount:\s*totalPayAmount/.test(detailSrc),
    'token-paid buy scales amount by fills',
);
assert.ok(
    /to:\s*dispAddr/.test(detailSrc),
    'token-paid buy targets the dispenser address',
);
assert.ok(
    /fillsNum/.test(detailSrc),
    'detail supports multi-fill buy (fills input scaled to an integer)',
);
assert.ok(
    /Pay to buy/.test(detailSrc),
    'coin-paid surfaces a "Pay to buy" panel',
);
assert.ok(
    /navigator\.clipboard/.test(detailSrc),
    'pay-here panel exposes a copy-to-clipboard button',
);
assert.ok(
    /any \{getCoin\} wallet\s*\n?\s*can trigger a fill/.test(detailSrc)
        || /Native-coin sending from this wallet is on the roadmap/.test(detailSrc),
    'pay-here panel calls out the bare-coin-payment UX expectation',
);
assert.ok(
    /inherent risk of UTXO-chain/.test(detailSrc),
    'token-paid review stage warns about UTXO-chain buy race',
);
assert.ok(
    /ownerAddress/.test(detailSrc),
    'buyer surfaces are only shown to non-owners',
);

// --- 5. ActionsMenu + App.jsx routing ---------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('DispenserExplorer'), `${shell} App.jsx imports DispenserExplorer`);
    assert.ok(
        app.includes("'dispenser-explorer'"),
        `${shell} tracks the dispenser-explorer sub-route`,
    );
    assert.ok(
        /id:\s*['"]dispenser-explorer['"]/.test(app),
        `${shell} registers the Browse dispensers entry`,
    );
    assert.ok(
        /onBrowseDispensers:\s*\(\)\s*=>\s*setUnlockedView\('dispenser-explorer'\)/.test(app),
        `${shell} wires onBrowseDispensers to the explorer sub-route`,
    );
    assert.ok(
        /origin:\s*['"]explorer['"]/.test(app),
        `${shell} tags explorer-originating nav with origin:"explorer"`,
    );
    assert.ok(
        /origin:\s*['"]list['"]/.test(app),
        `${shell} tags list-originating nav with origin:"list"`,
    );
    assert.ok(
        /dispenserRef\.origin\s*===\s*['"]explorer['"]/.test(app),
        `${shell} dispatches detail's back button on origin`,
    );
}

console.log(
    'OK — dispenser explorer smoke (DispenserExplorer §40.7.2 browse — token + address search modes + per-chain fan-out; DispenserDetail buyer surfaces: token-paid sendAsset buy with fills multiplier + password re-prompt + UTXO-race warning, coin-paid pay-here panel with copy-to-clipboard + native-send roadmap note; ActionsMenu "Browse dispensers" entry + explorer sub-route + origin-tagged list vs explorer nav in popup/web/desktop)',
);
