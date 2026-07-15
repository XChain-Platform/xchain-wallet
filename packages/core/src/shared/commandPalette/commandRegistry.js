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
    'Create',
    'Trade',
    'Sign',
    'Contacts',
    'Wallet',
    'Settings',
]);

// §33.3 free-form query grammar. Kept intentionally small: "send"/"pay",
// a decimal amount, then a ticker. Anchored + whitespace-tolerant so a
// partial query like "send 100" (no ticker yet) does NOT match and the
// user just sees the normal fuzzy "Send" navigation command until they
// finish typing.
const SEND_QUERY_RE = /^(?:send|pay)\s+(\d+(?:\.\d+)?)\s+([a-z0-9]{1,32})\s*$/i;

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
 * @param {{ composeSend?: (intent: { amount: string, tick: string }) => void }} ctx
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
        { id: 'nav-dispensers', category: 'Navigate', title: 'Dispensers', subtitle: 'Your dispensers', keywords: ['vending', 'sell'], Icon: Icon.DollarIcon, run: go('dispensers-list') },
        { id: 'nav-my-tokens', category: 'Navigate', title: 'My Tokens', subtitle: 'Tokens you issued', keywords: ['issued', 'assets', 'manage'], Icon: Icon.TokenIcon, run: go('my-tokens') },
        { id: 'nav-messaging', category: 'Navigate', title: 'Messaging', subtitle: 'Encrypted inbox', keywords: ['inbox', 'messages', 'chat'], Icon: Icon.MessageIcon, run: go('messaging') },
        { id: 'nav-addresses', category: 'Navigate', title: 'Addresses', subtitle: 'Manage your addresses', keywords: ['accounts', 'keys'], Icon: Icon.AddressIcon, run: go('addresses') },
        { id: 'nav-actions', category: 'Navigate', title: 'All actions', subtitle: 'Every action form', keywords: ['more', 'menu', 'catalogue'], Icon: Icon.MoreIcon, run: go('actions') },
    );
    if (ctx.hasBtcAddress) {
        list.push({ id: 'nav-contracts', category: 'Navigate', title: 'Contracts', subtitle: 'Smart contracts', keywords: ['vm', 'deploy', 'execute'], Icon: Icon.ContractIcon, run: go('contracts-list') });
        list.push({ id: 'nav-staking', category: 'Navigate', title: 'Staking', subtitle: 'Capability staking dashboard', keywords: ['stake', 'validator', 'rewards'], Icon: Icon.StakeIcon, run: go('staking-dashboard') });
    }
    if (ctx.hasGovernanceAddress) {
        list.push({ id: 'nav-governance', category: 'Navigate', title: 'Governance', subtitle: 'Polls and voting', keywords: ['vote', 'poll', 'proposal'], Icon: Icon.HandshakeIcon, run: go('governance-polls') });
    }

    // ---- Create: authoring forms that open free-entry (no ref needed) ---
    list.push(
        { id: 'create-token', category: 'Create', title: 'Create a token', subtitle: 'Guided issuance wizard', keywords: ['issue', 'new token', 'mint', 'launch'], Icon: Icon.PlusIcon, run: go('wizard') },
        { id: 'create-issue', category: 'Create', title: 'Issue token', subtitle: 'Standalone ISSUE', keywords: ['issue'], Icon: Icon.TokenIcon, run: go('issue') },
        { id: 'create-mint', category: 'Create', title: 'Mint supply', subtitle: 'Add to an existing token', keywords: ['mint', 'supply'], Icon: Icon.PlusIcon, run: go('mint') },
        { id: 'create-destroy', category: 'Create', title: 'Destroy tokens', subtitle: 'Burn supply', keywords: ['burn', 'destroy'], Icon: Icon.TrashIcon, run: go('destroy') },
        { id: 'create-broadcast', category: 'Create', title: 'Broadcast a message', subtitle: 'On-chain BROADCAST', keywords: ['broadcast', 'announce'], Icon: Icon.BroadcastIcon, run: go('broadcast') },
        { id: 'create-dispenser', category: 'Create', title: 'Create dispenser', subtitle: 'Sell a token at a fixed rate', keywords: ['dispenser', 'vending', 'sell'], Icon: Icon.DollarIcon, run: go('dispenser') },
        { id: 'create-dividend', category: 'Create', title: 'Pay a dividend', subtitle: 'Distribute to holders', keywords: ['dividend', 'distribute'], Icon: Icon.DollarIcon, run: go('dividend') },
        { id: 'create-airdrop', category: 'Create', title: 'Airdrop', subtitle: 'Send to many recipients', keywords: ['airdrop', 'distribute', 'bulk'], Icon: Icon.SendIcon, run: go('airdrop') },
        { id: 'create-advanced', category: 'Create', title: 'Advanced action', subtitle: 'Author any action by hand', keywords: ['advanced', 'raw', 'expert'], Icon: Icon.GearIcon, run: go('advanced') },
    );

    // ---- Trade: DEX / cross-chain flows ---------------------------------
    list.push(
        { id: 'trade-swap', category: 'Trade', title: 'Swap', subtitle: 'Place a DEX order', keywords: ['swap', 'order', 'exchange'], Icon: Icon.SwapIcon, run: go('swap') },
        { id: 'trade-coinpay', category: 'Trade', title: 'Pay an order', subtitle: 'Settle a matched order (COINPAY)', keywords: ['coinpay', 'pay', 'settle'], Icon: Icon.DollarIcon, run: go('coinpay') },
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
