// Phase 3 Step 6 smoke — Place Order form (§41.3.4) + ORDER action
// flow + CANCEL helper (§41.3.5 prereq) + 3-shell messaging wiring +
// HW branch wired through the shared SignCredentials path.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desk = join(wsRoot, 'packages', 'desktop');

// --- 1. Flow exports ---------------------------------------------

assert.equal(typeof flows.orderAction, 'function', 'flows.orderAction exported');
assert.equal(typeof flows.cancelOrder, 'function', 'flows.cancelOrder exported');

// --- 2. orderAction guard rails ---------------------------------

await assert.rejects(
    flows.orderAction({ params: {} }),
    /GIVE_TICK is required/,
);
await assert.rejects(
    flows.orderAction({ params: { GIVE_TICK: 'A' } }),
    /GIVE_AMOUNT is required/,
);
await assert.rejects(
    flows.orderAction({
        params: { GIVE_TICK: 'A', GIVE_AMOUNT: '1', GET_TICK: 'B' },
    }),
    /GET_AMOUNT is required/,
);

// --- 3. cancelOrder guard rails ---------------------------------

await assert.rejects(
    flows.cancelOrder({}),
    /orderActionIndex is required/,
);

// --- 4. PlaceOrderPanel static wiring ---------------------------

const panelPath = join(core, 'src', 'shared', 'components', 'PlaceOrderPanel.jsx');
assert.ok(existsSync(panelPath), 'PlaceOrderPanel.jsx exists');
const src = readFileSync(panelPath, 'utf8');
assert.ok(/export function PlaceOrderPanel\b/.test(src),
    'PlaceOrderPanel is a named export');
assert.ok(/messaging\.orderAction\(/.test(src)
    && /messaging\.orderActionHw\(/.test(src),
    'PlaceOrderPanel branches between orderAction and orderActionHw on isHwSource');
assert.ok(/SignCredentials/.test(src) && /isHwSource/.test(src),
    'PlaceOrderPanel uses the shared SignCredentials + isHwSource helpers');
assert.ok(/EXPIRATION_PRESETS/.test(src) && /EXPIRATION/.test(src),
    'PlaceOrderPanel exposes expiration presets + writes EXPIRATION in blocks');
assert.ok(/side === 'buy'/.test(src)
    && /Buy \{tick1\}/.test(src)
    && /Sell \{tick1\}/.test(src),
    'PlaceOrderPanel has a buy/sell toggle bound to tick1');
assert.ok(/prefillPrice/.test(src) && /setPrice\(prefillPrice\)/.test(src),
    'PlaceOrderPanel accepts + applies prefillPrice from the orderbook click');
// Buy vs sell param orientation.
assert.ok(/p\.GIVE_TICK = tick2/.test(src) && /p\.GET_TICK = tick1/.test(src),
    'Buy side gives tick2 to get tick1');
assert.ok(/p\.GIVE_TICK = tick1/.test(src) && /p\.GET_TICK = tick2/.test(src),
    'Sell side gives tick1 to get tick2');

// --- 5. Background handlers --------------------------------------

const bgSrc = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const h of [
    'action.order', 'action.cancelOrder',
    'action.order.hw', 'action.cancelOrder.hw',
]) {
    const re = new RegExp(`['\"]${h.replace('.', '\\.')}['\"]`);
    assert.ok(re.test(bgSrc), `background registers ${h}`);
}

// --- 6. Three-shell messaging helpers ---------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desk, 'renderer', 'messaging.js')],
]) {
    const msg = readFileSync(msgPath, 'utf8');
    for (const fn of ['orderAction', 'orderActionHw', 'cancelOrder', 'cancelOrderHw']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(msg),
            `${shell} messaging exports ${fn}`,
        );
    }
}

console.log(
    'OK — place-order smoke (orderAction + cancelOrder core flows guard required fields; PlaceOrderPanel §41.3.4 uses SignCredentials + isHwSource + branches orderAction/orderActionHw + prefillPrice from orderbook + buy/sell toggle maps to GIVE/GET orientation + EXPIRATION presets; 4 background handlers registered (order/cancelOrder × sw+hw); orderAction + orderActionHw + cancelOrder + cancelOrderHw exported by popup/web/desktop messaging)',
);
