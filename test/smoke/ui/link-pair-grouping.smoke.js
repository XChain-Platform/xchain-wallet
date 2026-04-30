// Smoke for §28.3 / Cluster C FOLLOWUP 2 — cross-chain LINK pair
// grouping. Pins the historyGrouping link-pair subkind, the
// History.jsx GroupCard dual-badge surfacing, the connector-suppress
// branch in grouped mode, and the badge label.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const utils = join(core, 'src', 'shared', 'utils');
const routes = join(core, 'src', 'shared', 'routes');

// --- 1. historyGrouping.js carries the link-pair subkind -----------------

const hgPath = join(utils, 'historyGrouping.js');
assert.ok(existsSync(hgPath), 'historyGrouping.js exists');
const hg = readFileSync(hgPath, 'utf8');
assert.ok(/'link-pair'/.test(hg),
    'historyGrouping declares the link-pair subkind');
assert.ok(/linkPairLeaders\b/.test(hg),
    'historyGrouping carries a linkPairLeaders tracker');
assert.ok(/Cross-chain link\b/.test(hg),
    'summarizeGroup renders the Cross-chain link prefix');

// Behavior pin via a dynamic import — round-trip a 2-row pair through
// the live grouper to verify the leader / member / summary shapes.
const { groupHistoryEntries } = await import(hgPath);
const out = groupHistoryEntries([
    {
        key: 'btc:100', chainId: 'bitcoin-mainnet', address: 'a',
        actionIndex: '100', action: 'SEND', blockIndex: 500,
        timestamp: 0, txHash: '', source: '', raw: {},
        link: { peerChainId: 'litecoin-mainnet', peerCoinTicker: 'LTC', peerActionIndex: '200', linkActionIndex: 'L1' },
    },
    {
        key: 'ltc:200', chainId: 'litecoin-mainnet', address: 'b',
        actionIndex: '200', action: 'SEND', blockIndex: 400,
        timestamp: 0, txHash: '', source: '', raw: {},
        link: { peerChainId: 'bitcoin-mainnet', peerCoinTicker: 'BTC', peerActionIndex: '100', linkActionIndex: 'L1' },
    },
], 'grouped');

assert.equal(out.length, 1, 'two paired sides collapse to one group');
assert.equal(out[0].kind, 'group');
assert.equal(out[0].subkind, 'link-pair');
assert.equal(out[0].leader.chainId, 'litecoin-mainnet',
    'leader is the older side');
assert.equal(out[0].summary, 'Cross-chain link — SEND ↔ SEND');

// Single-side LINK survives as a plain entry.
const single = groupHistoryEntries([
    {
        key: 'btc:100', chainId: 'bitcoin-mainnet', address: 'a',
        actionIndex: '100', action: 'SEND', blockIndex: 500,
        timestamp: 0, txHash: '', source: '', raw: {},
        link: { peerChainId: 'litecoin-mainnet', peerCoinTicker: 'LTC', peerActionIndex: '200', linkActionIndex: 'L9' },
    },
], 'grouped');
assert.equal(single.length, 1);
assert.equal(single[0].kind, 'entry',
    'unpaired LINK row stays a plain entry, retains its 🔗 badge surface');

// --- 2. History.jsx GroupCard surfaces both badges + suppresses connector

const histPath = join(routes, 'History.jsx');
const hist = readFileSync(histPath, 'utf8');

// Badge label addition.
assert.ok(/subkind === 'link-pair'\) return 'CROSS-CHAIN'/.test(hist),
    'groupBadgeLabel returns CROSS-CHAIN for link-pair');

// Dual-chain badge in GroupCard.
assert.ok(/isLinkPair\b/.test(hist),
    'GroupCard derives an isLinkPair branch');
assert.ok(/peerDescriptor\b/.test(hist),
    'GroupCard resolves the peer chainDescriptor');
assert.ok(/linkPairConnector\b/.test(hist),
    'GroupCard renders the .linkPairConnector glyph for link-pair');

// Connector suppression in grouped mode.
assert.ok(/item\.subkind === 'link-pair'\s*\?\s*false/.test(hist),
    'grouped link-pair members render with showConnector=false');

// --- 3. CSS hook -----------------------------------------------------------

const histCss = readFileSync(join(routes, 'History.module.css'), 'utf8');
assert.ok(/\.linkPairConnector\b/.test(histCss),
    'History.module.css carries the .linkPairConnector rule');

console.log('link-pair-grouping smoke OK');
