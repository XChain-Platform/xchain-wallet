// Phase 3 Step 7 smoke — Open orders + cancel (§41.3.5).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

const panelPath = join(core, 'src', 'shared', 'components', 'OpenOrdersPanel.jsx');
assert.ok(existsSync(panelPath), 'OpenOrdersPanel.jsx exists');
const src = readFileSync(panelPath, 'utf8');
assert.ok(/export function OpenOrdersPanel\b/.test(src),
    'OpenOrdersPanel is a named export');
assert.ok(/messaging\.getMarketOrders\(/.test(src),
    'OpenOrdersPanel fetches via messaging.getMarketOrders per-address');
assert.ok(/messaging\.cancelOrder\(/.test(src)
    && /messaging\.cancelOrderHw\(/.test(src),
    'OpenOrdersPanel branches between cancelOrder and cancelOrderHw on isHwSource');
assert.ok(/SignCredentials/.test(src) && /isHwSource/.test(src),
    'OpenOrdersPanel reuses SignCredentials + isHwSource');
assert.ok(/POLL_INTERVAL_MS\s*=\s*5000/.test(src),
    'OpenOrdersPanel polls every 5s');
assert.ok(/document\.visibilityState === 'hidden'/.test(src),
    'OpenOrdersPanel pauses polling when the tab is hidden');
assert.ok(/variant="danger"/.test(src),
    'Cancel button renders as danger variant');

console.log(
    'OK — open-orders smoke (OpenOrdersPanel §41.3.5 fetches getMarketOrders per wallet address; polls every 5s with visibilitychange pause; cancel path branches cancelOrder/cancelOrderHw on isHwSource behind SignCredentials; danger-variant Cancel button)',
);
