// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33.2 command catalogue. Pure data: `buildCommands(ctx)` returns the
// palette's static commands (navigation + authoring + signing + wallet
// verbs) as an ordered array, and the shell supplies the imperative
// handlers via `ctx`. This is the single source of truth for what the
// palette can do, so it mirrors the ActionsMenu handler block in the shell
// App rather than duplicating a second, drifting list; the same
// hasBtcAddress / hasGovernanceAddress gates apply.
//
// Every command's `run` is a closure the shell owns. `navigate(view)` maps
// straight onto the shell's setUnlockedView, so a navigation command is
// just `() => navigate('send')`. Verb commands (lock, refresh) call the
// matching shell callback and are omitted entirely when the shell doesn't
// provide one, so a shell can adopt the palette incrementally without
// surfacing dead entries.

import { Icon } from '../../ui/index.js';

// Categories double as the Tab-cycle groups in the palette (§33.4). Order
// here is the order they render in when the query is empty. 'Suggested' holds
// free-form parsed intents (§33.3) and is only ever produced by
// parseFreeformCommands, never by buildCommands, so an empty query never shows
// it; when present it is prepended ahead of everything else.
export const COMMAND_CATEGORIES = /** @type {const} */ ([
    'Suggested',
    'Navigate',
    'Tokens',
    'Create',
    'Trade',
    'Sign',
    'Contacts',
    'Sites',
    'Wallet',
    'Settings',
    'Help',
]);

// §33.3 free-form query grammar. Kept intentionally small: "send"/"pay",
// a decimal amount, then a ticker. Anchored + whitespace-tolerant so a
// partial query like "send 100" (no ticker yet) does NOT match and the
// user just sees the normal fuzzy "Send" navigation command until they
// finish typing.
const SEND_QUERY_RE = /^(?:send|pay)\s+(\d+(?:\.\d+)?)\s+([a-z0-9]{1,32})\s*$/i;

// §33.2 "History entries (txid / token / date prefix)". Instead of indexing
// every history row (a per-address fan-out the palette shouldn't pay on each
// open), a query that LOOKS like a history lookup yields a command that opens
// the History route with its filter prefilled - History's own search already
// matches txids, actions, and dates. Two shapes qualify: a hex string of 8+
// chars (txid prefix) and a date prefix (YYYY, YYYY-MM, YYYY-MM-DD).
const TXID_QUERY_RE = /^[0-9a-f]{8,64}$/i;
const DATE_QUERY_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

/**
 * Parse a free-form palette query into synthetic action commands (§33.3).
 * Currently recognizes "send <amount> <TICK>" / "pay <amount> <TICK>" and
 * yields a command that opens the Send form prefilled. Returns [] when the
 * query is not a recognized intent (the caller falls back to fuzzy search)
 * or when the shell did not supply the matching action handler.
 *
 * Separate from buildCommands because these commands depend on the live
 * query text, not the static catalogue; the palette calls this per keystroke
 * and prepends the result above the fuzzy matches.
 *
 * @param {string} rawQuery
 * @param {{ composeSend?: (intent: { amount: string, tick: string }) => void, searchHistory?: (query: string) => void }} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function parseFreeformCommands(rawQuery, ctx) {
    const query = (rawQuery || '').trim();
    if (!query) return [];
    const out = [];

    const send = SEND_QUERY_RE.exec(query);
    if (send && typeof ctx?.composeSend === 'function') {
        const amount = send[1];
        const tick = send[2].toUpperCase();
        out.push({
            id: `freeform-send-${tick}-${amount}`,
            category: 'Suggested',
            title: `Send ${amount} ${tick}`,
            subtitle: 'Start a send with these details filled in',
            keywords: ['send', 'pay'],
            Icon: Icon.SendIcon,
            run: () => ctx.composeSend({ amount, tick }),
        });
    }

    // History lookup by txid prefix or date prefix (§33.2). Gated on shapes
    // that can't be an action/token name, so ordinary fuzzy queries never
    // grow a noisy "search history" row above their real matches.
    if (typeof ctx?.searchHistory === 'function'
        && (TXID_QUERY_RE.test(query) || DATE_QUERY_RE.test(query))) {
        out.push({
            id: 'freeform-history-search',
            category: 'Suggested',
            title: `Search history for "${query}"`,
            subtitle: 'Open History filtered to this query',
            keywords: ['history', 'transaction', 'txid'],
            Icon: Icon.HistoryIcon,
            run: () => ctx.searchHistory(query),
        });
    }

    return out;
}

/**
 * @typedef {object} CommandContext
 * @property {(view: string) => void} navigate  shell view setter (setUnlockedView)
 * @property {() => void} [lock]                 lock the wallet
 * @property {() => void} [refresh]              refresh balances / session
 * @property {() => void} [scan]                 open the QR scanner overlay
 * @property {() => void} [switchWallet]         open the wallet picker
 * @property {boolean} [hasBtcAddress]           gates BTC-only surfaces (VM / multisig)
 * @property {boolean} [hasGovernanceAddress]    gates governance polls
 */

/**
 * Build the static command list for the palette.
 *
 * @param {CommandContext} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function buildCommands(ctx) {
    const { navigate } = ctx;
    if (typeof navigate !== 'function') {
        throw new TypeError('buildCommands: ctx.navigate is required');
    }
    const go = (view) => () => navigate(view);
    const list = [];

    // ---- Navigate: primary surfaces (mirror LeftNav) --------------------
    list.push(
        { id: 'nav-home', category: 'Navigate', title: 'Home', subtitle: 'Balances and portfolio', keywords: ['balances', 'portfolio', 'tokens', 'overview'], Icon: Icon.HomeIcon, run: go('home') },
        { id: 'nav-history', category: 'Navigate', title: 'History', subtitle: 'Transaction timeline', keywords: ['transactions', 'activity', 'timeline'], Icon: Icon.HistoryIcon, run: go('history') },
        { id: 'nav-send', category: 'Navigate', title: 'Send', subtitle: 'Send a coin or token', keywords: ['pay', 'transfer', 'spend'], Icon: Icon.SendIcon, run: go('send') },
        { id: 'nav-receive', category: 'Navigate', title: 'Receive', subtitle: 'Show a receive address', keywords: ['address', 'deposit', 'qr'], Icon: Icon.ReceiveIcon, run: go('receive') },
        { id: 'nav-markets', category: 'Navigate', title: 'Open DEX', subtitle: 'Markets and orders', keywords: ['dex', 'market', 'trade', 'exchange', 'orderbook'], Icon: Icon.MarketIcon, run: go('markets') },
        { id: 'nav-my-orders', category: 'Navigate', title: 'My orders', subtitle: 'Your open DEX orders', keywords: ['orders', 'open', 'dex', 'cancel', 'edit'], Icon: Icon.MarketIcon, run: go('my-orders') },
        { id: 'nav-my-swaps', category: 'Navigate', title: 'My swaps', subtitle: 'Your open atomic swaps', keywords: ['swaps', 'open', 'atomic', 'cancel', 'edit'], Icon: Icon.SwapIcon, run: go('my-swaps') },
        { id: 'nav-dispensers', category: 'Navigate', title: 'Dispensers', subtitle: 'Your dispensers', keywords: ['vending', 'sell'], Icon: Icon.DollarIcon, run: go('dispensers-list') },
        { id: 'nav-my-tokens', category: 'Navigate', title: 'My Tokens', subtitle: 'Tokens you own', keywords: ['issued', 'owned', 'assets', 'manage'], Icon: Icon.TokenIcon, run: go('my-tokens') },
        { id: 'nav-messaging', category: 'Navigate', title: 'Messaging', subtitle: 'Encrypted inbox', keywords: ['inbox', 'messages', 'chat'], Icon: Icon.MessageIcon, run: go('messaging') },
        { id: 'nav-addresses', category: 'Navigate', title: 'Addresses', subtitle: 'Manage your addresses', keywords: ['accounts', 'keys'], Icon: Icon.AddressIcon, run: go('addresses') },
        { id: 'nav-lists', category: 'Navigate', title: 'My Lists', subtitle: 'Address and token lists', keywords: ['list', 'roster', 'allowlist', 'blocklist'], Icon: Icon.TokenListIcon, run: go('lists') },
        { id: 'nav-obligations', category: 'Navigate', title: 'Payments due', subtitle: 'Pending COINPAY obligations', keywords: ['coinpay', 'obligation', 'pay', 'due', 'match', 'deadline'], Icon: Icon.ClockIcon, run: go('obligations') },
        { id: 'nav-actions', category: 'Navigate', title: 'All actions', subtitle: 'Every action form', keywords: ['more', 'menu', 'catalogue'], Icon: Icon.MoreIcon, run: go('actions') },
    );
    if (ctx.hasBtcAddress) {
        list.push({ id: 'nav-contracts', category: 'Navigate', title: 'Contracts', subtitle: 'Smart contracts', keywords: ['vm', 'deploy', 'execute'], Icon: Icon.ContractIcon, run: go('contracts-list') });
        list.push({ id: 'nav-staking', category: 'Navigate', title: 'Staking', subtitle: 'Your staking positions', keywords: ['stake', 'validator', 'rewards'], Icon: Icon.StakeIcon, run: go('staking-dashboard') });
    }
    if (ctx.hasGovernanceAddress) {
        list.push({ id: 'nav-governance', category: 'Navigate', title: 'Governance', subtitle: 'Polls and voting', keywords: ['vote', 'poll', 'proposal'], Icon: Icon.HandshakeIcon, run: go('governance-polls') });
    }
    // Betting, on the DEX pattern: the browse hub plus the two views a user comes
    // back to rather than browses to. Ungated like the actions-menu entry it
    // mirrors, because the hub itself reports when no chain in this wallet
    // supports BET; gating here would make the destination silently unfindable
    // instead of explaining itself.
    list.push(
        { id: 'nav-betting', category: 'Navigate', title: 'Betting', subtitle: 'Browse betting markets', keywords: ['bet', 'market', 'odds', 'wager', 'oracle', 'parimutuel'], Icon: Icon.DollarIcon, run: go('bet-markets') },
        { id: 'nav-my-bets', category: 'Navigate', title: 'My bets', subtitle: 'Bets you have placed', keywords: ['bet', 'stake', 'wager', 'payout', 'winnings'], Icon: Icon.DollarIcon, run: go('my-bets') },
        { id: 'nav-bet-oracle-console', category: 'Navigate', title: 'My markets', subtitle: 'Markets you run as oracle: publish a result or cancel', keywords: ['bet', 'oracle', 'resolve', 'market', 'settle', 'publish'], Icon: Icon.DollarIcon, run: go('bet-oracle-console') },
    );

    // ---- Create: authoring forms that open free-entry (no ref needed) ---
    list.push(
        { id: 'create-token', category: 'Create', title: 'Create a token', subtitle: 'Guided issuance wizard', keywords: ['issue', 'new token', 'mint', 'launch'], Icon: Icon.PlusIcon, run: go('wizard') },
        { id: 'create-issue', category: 'Create', title: 'Issue token', subtitle: 'Issue a token directly', keywords: ['issue'], Icon: Icon.TokenIcon, run: go('issue') },
        { id: 'create-mint', category: 'Create', title: 'Mint supply', subtitle: 'Add to an existing token', keywords: ['mint', 'supply'], Icon: Icon.PlusIcon, run: go('mint') },
        { id: 'create-destroy', category: 'Create', title: 'Destroy tokens', subtitle: 'Burn supply', keywords: ['burn', 'destroy'], Icon: Icon.TrashIcon, run: go('destroy') },
        { id: 'create-sweep', category: 'Create', title: 'Sweep address', subtitle: 'Move balances, ownerships, and escrow to one destination', keywords: ['sweep', 'migrate', 'move', 'consolidate'], Icon: Icon.SendIcon, run: go('sweep') },
        { id: 'create-broadcast', category: 'Create', title: 'Broadcast a message', subtitle: 'Post a message on-chain', keywords: ['broadcast', 'announce'], Icon: Icon.BroadcastIcon, run: go('broadcast') },
        { id: 'create-oracle-price', category: 'Create', title: 'Publish oracle price', subtitle: 'Price a token in a currency so dispensers can sell at that rate', keywords: ['oracle', 'price', 'fiat', 'quote', 'feed'], Icon: Icon.DollarIcon, run: go('oracle') },
        { id: 'create-dispenser', category: 'Create', title: 'Create dispenser', subtitle: 'Sell a token at a fixed rate', keywords: ['dispenser', 'vending', 'sell'], Icon: Icon.DollarIcon, run: go('dispenser') },
        { id: 'create-dividend', category: 'Create', title: 'Pay a dividend', subtitle: 'Distribute to holders', keywords: ['dividend', 'distribute'], Icon: Icon.DollarIcon, run: go('dividend') },
        { id: 'create-airdrop', category: 'Create', title: 'Airdrop', subtitle: 'Send to many recipients', keywords: ['airdrop', 'distribute', 'bulk'], Icon: Icon.SendIcon, run: go('airdrop') },
        { id: 'create-list', category: 'Create', title: 'Create a list', subtitle: 'Publish an address or token list', keywords: ['list', 'roster', 'allowlist'], Icon: Icon.TokenListIcon, run: go('list-create') },
        { id: 'create-publish-file', category: 'Create', title: 'Publish file', subtitle: 'Public or token-gated on-chain file', keywords: ['file', 'upload', 'publish', 'gated', 'encrypted', 'content'], Icon: Icon.UploadIcon, run: go('publish-file') },
        // D-153: the ADDRESS-scoped half of the controller form (ADDRESS v1 -
        // a self-imposed gate on this address's own transfers, and the
        // recipient-side gate on what it will accept) had NO entry point at
        // all: the only route in was Manage Token -> More -> Controller, so a
        // wallet that had never issued a token could not reach it from any
        // screen. Titled for the address subject, since the token subject is
        // already reachable from the token it belongs to.
        { id: 'create-controller-bind', category: 'Create', title: 'Bind a controller', subtitle: 'Route this address\'s actions through a guard contract', keywords: ['controller', 'guard', 'bind', 'policy', 'gate', 'compliance', 'royalty'], Icon: Icon.LockIcon, run: go('controller-bind') },
        { id: 'create-advanced', category: 'Create', title: 'Advanced action', subtitle: 'Author any action by hand', keywords: ['advanced', 'raw', 'expert'], Icon: Icon.GearIcon, run: go('advanced') },
    );

    // ---- Trade: DEX / cross-chain flows ---------------------------------
    list.push(
        { id: 'trade-swap', category: 'Trade', title: 'Swap', subtitle: 'Place a DEX order', keywords: ['swap', 'order', 'exchange'], Icon: Icon.SwapIcon, run: go('swap') },
        { id: 'trade-order', category: 'Trade', title: 'Create order', subtitle: 'Place a DEX limit order', keywords: ['order', 'limit', 'dex', 'sell', 'buy', 'native'], Icon: Icon.MarketIcon, run: go('create-order') },
        { id: 'trade-coinpay', category: 'Trade', title: 'Pay an order', subtitle: 'Settle a matched order', keywords: ['coinpay', 'pay', 'settle'], Icon: Icon.DollarIcon, run: go('coinpay') },
        { id: 'trade-xchain-swap', category: 'Trade', title: 'Cross-chain swap', subtitle: 'Swap across chains', keywords: ['cross chain', 'bridge', 'atomic'], Icon: Icon.LinkIcon, run: go('cross-chain-swap') },
        { id: 'trade-xchain-templates', category: 'Trade', title: 'Cross-chain templates', subtitle: 'Prebuilt cross-chain flows', keywords: ['cross chain', 'templates', 'parallel'], Icon: Icon.LinkIcon, run: go('cross-chain-templates') },
    );

    // ---- Sign: message / signature / PSBT -------------------------------
    list.push(
        { id: 'sign-message', category: 'Sign', title: 'Sign a message', subtitle: 'Prove address ownership', keywords: ['sign', 'message', 'attest'], Icon: Icon.SignIcon, run: go('sign-message') },
        { id: 'sign-verify', category: 'Sign', title: 'Verify a signature', subtitle: 'Check a signed message', keywords: ['verify', 'signature', 'check'], Icon: Icon.VerifyIcon, run: go('verify-signature') },
        { id: 'sign-psbt', category: 'Sign', title: 'Sign a PSBT', subtitle: 'Sign a partially-signed transaction', keywords: ['psbt', 'sign', 'watcher', 'air-gapped'], Icon: Icon.SignIcon, run: go('sign-psbt') },
    );

    // ---- Contacts -------------------------------------------------------
    list.push(
        { id: 'nav-contacts', category: 'Contacts', title: 'Contacts', subtitle: 'Your saved addresses', keywords: ['address book', 'people'], Icon: Icon.UsersIcon, run: go('contacts') },
    );

    // ---- Wallet verbs (only when the shell wires the handler) -----------
    if (typeof ctx.scan === 'function') {
        list.push({ id: 'wallet-scan', category: 'Wallet', title: 'Scan a QR code', subtitle: 'Open the camera scanner', keywords: ['qr', 'camera', 'scan'], Icon: Icon.ScanIcon, run: () => ctx.scan() });
    }
    if (typeof ctx.refresh === 'function') {
        list.push({ id: 'wallet-refresh', category: 'Wallet', title: 'Refresh', subtitle: 'Reload balances and status', keywords: ['reload', 'sync', 'update'], Icon: Icon.RefreshIcon, run: () => ctx.refresh() });
    }
    if (typeof ctx.switchWallet === 'function') {
        list.push({ id: 'wallet-switch', category: 'Wallet', title: 'Switch wallet', subtitle: 'Choose another wallet', keywords: ['wallet', 'account', 'change'], Icon: Icon.UsersIcon, run: () => ctx.switchWallet() });
    }
    if (typeof ctx.lock === 'function') {
        list.push({ id: 'wallet-lock', category: 'Wallet', title: 'Lock wallet', subtitle: 'Lock and require the password', keywords: ['lock', 'logout', 'secure'], Icon: Icon.LockIcon, run: () => ctx.lock() });
    }
    if (typeof ctx.openHelp === 'function') {
        list.push({ id: 'help-shortcuts', category: 'Wallet', title: 'Keyboard shortcuts', subtitle: 'Show the shortcut cheatsheet', keywords: ['keys', 'hotkeys', 'help', 'cheatsheet', 'shortcuts'], Icon: Icon.InfoIcon, run: () => ctx.openHelp() });
    }

    // ---- Settings -------------------------------------------------------
    list.push(
        { id: 'nav-settings', category: 'Settings', title: 'Settings', subtitle: 'Open settings', keywords: ['preferences', 'options', 'config'], Icon: Icon.GearIcon, run: go('settings') },
        { id: 'nav-connected-sites', category: 'Settings', title: 'Connected sites', subtitle: 'dApp permissions', keywords: ['dapps', 'permissions', 'connections'], Icon: Icon.LinkIcon, run: go('connected-sites') },
    );

    return list;
}

/**
 * Convert loaded contact records into palette commands (§33.2 "Contacts").
 * Kept separate from `buildCommands` because contacts are async shell data,
 * not part of the static catalogue; the shell loads them and concatenates
 * the result. Each command navigates to the contacts list (a contact-detail
 * deep-link needs a ref the palette doesn't carry yet, tracked as a
 * follow-up), and the contact's addresses feed the fuzzy keywords so
 * searching a hex prefix finds the person.
 *
 * @param {Array<{ id: string, name?: string, label?: string, entries?: Array<{ address?: string }>, address?: string }>} contacts
 * @param {{ navigate: (view: string) => void }} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function contactsToCommands(contacts, ctx) {
    if (!Array.isArray(contacts)) return [];
    const out = [];
    for (const c of contacts) {
        const name = c.name || c.label;
        if (!name) continue;
        const addresses = Array.isArray(c.entries)
            ? c.entries.map((e) => e && e.address).filter(Boolean)
            : (c.address ? [c.address] : []);
        out.push({
            id: `contact-${c.id}`,
            category: 'Contacts',
            title: name,
            subtitle: 'Open in Contacts',
            keywords: ['contact', ...addresses],
            Icon: Icon.UserIcon,
            run: () => ctx.navigate('contacts'),
        });
    }
    return out;
}

/**
 * Convert Home's balance rows into palette commands (§33.2 "Tokens").
 * Rows come from `buildBalanceRows` and already carry the full ref
 * TokenDetail needs, so `run` hands the whole row to a shell-supplied
 * `openToken` (setTokenDetailRef + navigate('token-detail')). Skipped
 * entirely when the shell doesn't wire `openToken`.
 *
 * @param {Array<{ chainId: string, tick: string, kind: string, displayName: string, chainShort?: string, chainDisplayName?: string }>} rows
 * @param {{ openToken?: (row: object) => void }} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function balancesToCommands(rows, ctx) {
    if (!Array.isArray(rows) || typeof ctx?.openToken !== 'function') return [];
    const out = [];
    for (const row of rows) {
        if (!row || typeof row.chainId !== 'string' || typeof row.tick !== 'string') continue;
        out.push({
            id: `token-${row.chainId}-${row.tick}`,
            category: 'Tokens',
            title: row.displayName || row.tick,
            subtitle: row.chainDisplayName ? `${row.tick} on ${row.chainDisplayName}` : row.tick,
            keywords: ['token', row.tick, row.chainShort].filter(Boolean),
            Icon: Icon.TokenIcon,
            run: () => ctx.openToken(row),
        });
    }
    return out;
}

/**
 * Convert connected-site records into palette commands (§33.2 "Connected
 * sites"). Each command opens the Connected Sites settings surface; a
 * per-site detail deep-link would need selection state that surface doesn't
 * expose yet. Skipped when the shell can't open that surface; as of 
 * every shell can, the popup included.
 *
 * @param {Array<{ id: string, appName?: string, origin?: string }>} sites
 * @param {{ openConnectedSites?: () => void }} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function sitesToCommands(sites, ctx) {
    if (!Array.isArray(sites) || typeof ctx?.openConnectedSites !== 'function') return [];
    const out = [];
    for (const site of sites) {
        if (!site || (!site.appName && !site.origin)) continue;
        out.push({
            id: `site-${site.id ?? site.origin}`,
            category: 'Sites',
            title: site.appName || site.origin,
            subtitle: site.appName && site.origin ? `${site.origin} - manage permissions` : 'Manage permissions',
            keywords: ['site', 'dapp', 'connected', site.origin].filter(Boolean),
            Icon: Icon.LinkIcon,
            run: () => ctx.openConnectedSites(),
        });
    }
    return out;
}

// §33.2 "Settings pages". Static mirror of the Settings.jsx section list
// (ids must match SectionDef.id there; the shell-wiring smoke pins this).
// Sections whose visibility is conditional in Settings (accounts-addresses)
// or that duplicate a dedicated palette entry (connected-sites) are omitted.
const SETTINGS_SECTIONS = /** @type {const} */ ([
    { id: 'this-wallet', title: 'This Wallet', keywords: ['wallet', 'rename', 'remove'] },
    { id: 'appearance', title: 'Appearance', keywords: ['theme', 'dark', 'light', 'accent'] },
    { id: 'display', title: 'Display', keywords: ['pinned', 'hidden', 'tokens'] },
    { id: 'keyboard', title: 'Keyboard', keywords: ['shortcuts', 'rebind', 'keys', 'hotkeys'] },
    { id: 'language-region', title: 'Language & Region', keywords: ['language', 'currency', 'fiat'] },
    { id: 'privacy', title: 'Privacy', keywords: ['tor', 'rotation', 'blur'] },
    { id: 'safety', title: 'Safety', keywords: ['autolock', 'panic', 'undo'] },
    { id: 'wallet-mode', title: 'Wallet Mode', keywords: ['watcher', 'signer', 'air-gapped'] },
    { id: 'backup', title: 'Backup', keywords: ['seed', 'phrase', 'restore', 'export'] },
    { id: 'fees', title: 'Fees', keywords: ['fee', 'rbf', 'strategy'] },
    { id: 'network', title: 'Network', keywords: ['mainnet', 'testnet', 'regtest'] },
    { id: 'network-endpoints', title: 'Network & Endpoints', keywords: ['explorer', 'encoder', 'hub', 'url'] },
    { id: 'notifications', title: 'Notifications', keywords: ['alerts', 'notify'] },
    { id: 'ads', title: 'Donations', keywords: ['donation', 'ads', 'support'] },
    { id: 'developer', title: 'Developer', keywords: ['dev', 'debug', 'regtest'] },
    { id: 'about', title: 'About', keywords: ['version', 'license'] },
]);

/**
 * Settings-section deep-link commands (§33.2). `openSettings(sectionId)` is
 * shell-supplied (sets the Settings initialSubpageId and navigates); when
 * absent (extension popup has no Settings route) no commands are produced.
 *
 * @param {{ openSettings?: (sectionId: string) => void }} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function settingsSectionsToCommands(ctx) {
    if (typeof ctx?.openSettings !== 'function') return [];
    return SETTINGS_SECTIONS.map((s) => ({
        id: `settings-${s.id}`,
        category: 'Settings',
        title: `Settings → ${s.title}`,
        subtitle: 'Open this settings section',
        keywords: ['settings', ...s.keywords],
        Icon: Icon.GearIcon,
        run: () => ctx.openSettings(s.id),
    }));
}

/**
 * Help-topic commands (§33.2 "Help topics"). The wallet has no learn-mode
 * article surface yet, so each question routes to the closest real
 * destination (a settings section or the shortcut cheatsheet). Entries
 * whose destination handler is missing are dropped, mirroring the verb
 * commands' incremental-adoption pattern.
 *
 * @param {{ openSettings?: (sectionId: string) => void, openHelp?: () => void }} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function helpToCommands(ctx) {
    const out = [];
    if (typeof ctx?.openSettings === 'function') {
        out.push(
            { id: 'help-backup', category: 'Help', title: 'How do I back up my wallet?', subtitle: 'Opens Settings → Backup', keywords: ['help', 'backup', 'seed', 'recovery'], Icon: Icon.InfoIcon, run: () => ctx.openSettings('backup') },
            { id: 'help-connect-dapp', category: 'Help', title: 'How do I manage connected sites?', subtitle: 'Opens Settings → Connected sites', keywords: ['help', 'dapp', 'connect', 'permissions'], Icon: Icon.InfoIcon, run: () => ctx.openSettings('connected-sites') },
            { id: 'help-panic', category: 'Help', title: 'What is panic mode?', subtitle: 'Opens Settings → Safety', keywords: ['help', 'panic', 'emergency', 'lock'], Icon: Icon.InfoIcon, run: () => ctx.openSettings('safety') },
        );
    }
    if (typeof ctx?.openHelp === 'function') {
        out.push({ id: 'help-keys', category: 'Help', title: 'What keyboard shortcuts are there?', subtitle: 'Opens the shortcut cheatsheet', keywords: ['help', 'keys', 'hotkeys', 'shortcuts'], Icon: Icon.InfoIcon, run: () => ctx.openHelp() });
    }
    return out;
}
