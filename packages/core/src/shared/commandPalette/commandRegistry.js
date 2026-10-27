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
// hasVmAddress / hasBtcAddress / hasGovernanceAddress gates apply.
//
// Every command's `run` is a closure the shell owns. `navigate(view)` maps
// straight onto the shell's setUnlockedView, so a navigation command is
// just `() => navigate('send')`. Verb commands (lock, refresh) call the
// matching shell callback and are omitted entirely when the shell doesn't
// provide one, so a shell can adopt the palette incrementally without
// surfacing dead entries.

import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/governance.js';
import '../../i18n/locales/en/issue.js';
import '../../i18n/locales/en/keyboard.js';
import '../../i18n/locales/en/palette.js';
import '../../i18n/locales/en/routes.js';
import '../../i18n/locales/en/scan.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/settings.js';
import '../../i18n/locales/en/ui.js';
import { Icon } from '../../ui/index.js';

// Categories double as the Tab-cycle groups in the palette (§33.4). Order
// here is the order they render in when the query is empty. 'Suggested' holds
// free-form parsed intents (§33.3), while CommandPalette creates 'Recent' from
// commands selected since the app opened. Neither category is emitted by
// buildCommands.
export const COMMAND_CATEGORIES = /** @type {const} */ ([
    'Suggested',
    'Recent',
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

// Category names double as identity (Tab-cycle groups, the Recent bucket), so
// they stay English in data and are only localized for display.
const CATEGORY_LABEL_KEYS = {
    Suggested: 'palette.category.suggested',
    Recent: 'ui.addressCombobox.recent',
    Navigate: 'palette.category.navigate',
    Tokens: 'home.tabs.tokens',
    Create: 'palette.category.create',
    Trade: 'palette.category.trade',
    Sign: 'send.review.sign',
    Contacts: 'components.contactsPickerScreen.contacts',
    Sites: 'palette.category.sites',
    Wallet: 'settings.thisWallet.wallet',
    Settings: 'home.settings',
    Help: 'palette.category.help',
};

export function categoryLabel(category) {
    const key = CATEGORY_LABEL_KEYS[category];
    return key ? t(key) : category;
}

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

// Demo wallets keep discovery, inspection, the sidebar destinations (Send,
// Receive and Scan show the inline demo note) and the create and trade forms
// (each shows the inline demo note and never composes), while the actions
// catalogue and signing tools stay out of the palette.
const DEMO_UNAVAILABLE_COMMAND_IDS = new Set([
    'nav-actions',
    'nav-multisig-create',
    'nav-multisig-sign',
    'nav-cosigner-accounts',
    'sign-message',
    'sign-psbt',
]);

// Watch-only wallets can author unsigned transactions, but they cannot use
// commands whose only outcome requires a private key in this wallet.
// Signer mode does not author or broadcast transactions; the Actions menu
// keeps only the signing tools there, so the palette drops the same authoring
// categories instead of opening forms the mode refuses to submit.
const SIGNER_UNAVAILABLE_CATEGORIES = new Set(['Create', 'Trade']);

const WATCHER_UNAVAILABLE_COMMAND_IDS = new Set([
    'sign-message',
    'sign-psbt',
]);

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
 * @param {{ composeSend?: (intent: { amount: string, tick: string }) => void, searchHistory?: (query: string) => void, isDemoWallet?: boolean, isSignerMode?: boolean }} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function parseFreeformCommands(rawQuery, ctx) {
    const query = (rawQuery || '').trim();
    if (!query) return [];
    const out = [];

    const send = SEND_QUERY_RE.exec(query);
    if (send && !ctx?.isDemoWallet && !ctx?.isSignerMode
        && typeof ctx?.composeSend === 'function') {
        const amount = send[1];
        const tick = send[2].toUpperCase();
        out.push({
            id: `freeform-send-${tick}-${amount}`,
            category: 'Suggested',
            title: t('uri.intent.sendAmount', { amount, tick }),
            subtitle: t('palette.freeformSend.subtitle'),
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
            title: t('palette.freeformHistory.title', { query }),
            subtitle: t('palette.freeformHistory.subtitle'),
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
 * @property {boolean} [hasBtcAddress]           gates BTC-only surfaces (staking / multisig); also the Contracts fallback when hasVmAddress is absent
 * @property {boolean} [hasVmAddress]            gates Contracts: an address on any chain whose descriptor advertises DEPLOY (BTC / LTC / DOGE today)
 * @property {boolean} [hasGovernanceAddress]    gates governance polls
 * @property {boolean} [hasDexSurface] false only when the build compiled the DEX surface out; its commands then point at views that do not exist
 * @property {boolean} [isSignerMode] §20 air-gapped signer mode; drops the Send and Receive navigate commands
 * @property {boolean} [isWatcherMode] hides commands that require a private key in this wallet
 * @property {boolean} [isDemoWallet] hides commands that mutate the read-only demo wallet
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
    // Defaults to true: every shell has it unless its profile hides the DEX,
    // and a shell that forgets to pass the flag should keep its DEX rather than
    // silently lose them.
    const hasDex = ctx.hasDexSurface !== false;
    const list = [];

    // ---- Navigate: primary surfaces (mirror LeftNav) --------------------
    list.push(
        { id: 'nav-home', category: 'Navigate', title: t('home.title'), subtitle: t('palette.navHome.subtitle'), keywords: ['balances', 'portfolio', 'tokens', 'overview'], Icon: Icon.HomeIcon, run: go('home') },
        { id: 'nav-history', category: 'Navigate', title: t('history.title'), subtitle: t('palette.navHistory.subtitle'), keywords: ['transactions', 'activity', 'timeline'], Icon: Icon.HistoryIcon, run: go('history') },
        // The palette reaches every route by name, so gating the nav
        // rails alone would leave Send one Cmd-K away from a wallet whose
        // Wallet Mode screen says the screen is hidden. Signer mode drops both.
        ...(ctx.isSignerMode ? [] : [
            { id: 'nav-send', category: 'Navigate', title: t('send.title'), subtitle: t('palette.navSend.subtitle'), keywords: ['pay', 'transfer', 'spend'], Icon: Icon.SendIcon, run: go('send') },
            { id: 'nav-receive', category: 'Navigate', title: t('home.receive'), subtitle: t('palette.navReceive.subtitle'), keywords: ['address', 'deposit', 'qr'], Icon: Icon.ReceiveIcon, run: go('receive') },
        ]),
        // The DEX rows are gated on the surface EXISTING in this build,
        // not on anything about the wallet: a build that hides the DEX compiles
        // those routes out, so the command would land the user on Home with no
        // explanation.
        // Spread in place rather than pushed later, so the display order every
        // other build has stays exactly as it was.
        ...(hasDex ? [
            { id: 'nav-markets', category: 'Navigate', title: t('palette.navMarkets.title'), subtitle: t('palette.navMarkets.subtitle'), keywords: ['dex', 'market', 'trade', 'exchange', 'orderbook'], Icon: Icon.MarketIcon, run: go('markets') },
            { id: 'nav-marketplace', category: 'Navigate', title: t('nav.marketplace'), subtitle: t('palette.navMarketplace.subtitle'), keywords: ['market', 'activity', 'dispenser', 'orders', 'swaps'], Icon: Icon.LineChartIcon, run: go('market-activity') },
            { id: 'nav-my-orders', category: 'Navigate', title: t('palette.navMyOrders.title'), subtitle: t('palette.navMyOrders.subtitle'), keywords: ['orders', 'open', 'dex', 'cancel', 'edit'], Icon: Icon.MarketIcon, run: go('my-orders') },
            { id: 'nav-my-swaps', category: 'Navigate', title: t('palette.navMySwaps.title'), subtitle: t('palette.navMySwaps.subtitle'), keywords: ['swaps', 'open', 'atomic', 'cancel', 'edit'], Icon: Icon.SwapIcon, run: go('my-swaps') },
        ] : []),
        { id: 'nav-dispensers', category: 'Navigate', title: t('routes.addressList.dispensers'), subtitle: t('palette.navDispensers.subtitle'), keywords: ['vending', 'sell'], Icon: Icon.DollarIcon, run: go('dispensers-list') },
        // The buyer's side. 'Dispensers' above lists the ones this wallet
        // opened; a buyer with no link in hand needs the search, which was
        // reachable only through the Token Actions catalogue.
        { id: 'nav-browse-dispensers', category: 'Navigate', title: t('palette.navBrowseDispensers.title'), subtitle: t('palette.navBrowseDispensers.subtitle'), keywords: ['browse', 'dispenser', 'buy', 'search', 'vending', 'shop'], Icon: Icon.DollarIcon, run: go('dispenser-explorer') },
        { id: 'nav-my-tokens', category: 'Navigate', title: t('palette.navMyTokens.title'), subtitle: t('palette.navMyTokens.subtitle'), keywords: ['issued', 'owned', 'assets', 'manage'], Icon: Icon.TokenIcon, run: go('my-tokens') },
        { id: 'nav-messaging', category: 'Navigate', title: t('home.messaging'), subtitle: t('palette.navMessaging.subtitle'), keywords: ['inbox', 'messages', 'chat'], Icon: Icon.MessageIcon, run: go('messaging') },
        { id: 'nav-addresses', category: 'Navigate', title: t('home.addresses'), subtitle: t('palette.navAddresses.subtitle'), keywords: ['accounts', 'keys'], Icon: Icon.AddressIcon, run: go('addresses') },
        { id: 'nav-lists', category: 'Navigate', title: t('palette.navLists.title'), subtitle: t('palette.navLists.subtitle'), keywords: ['list', 'roster', 'allowlist', 'blocklist'], Icon: Icon.TokenListIcon, run: go('lists') },
        // Plain-language subtitle, opcode in `keywords` only: 'coinpay' still
        // matches in search, and no palette row renders a raw protocol verb.
        { id: 'nav-obligations', category: 'Navigate', title: t('nav.paymentsDue'), subtitle: t('palette.navObligations.subtitle'), keywords: ['coinpay', 'obligation', 'pay', 'due', 'match', 'deadline'], Icon: Icon.ClockIcon, run: go('obligations') },
        { id: 'nav-actions', category: 'Navigate', title: t('palette.navActions.title'), subtitle: t('palette.navActions.subtitle'), keywords: ['more', 'menu', 'catalogue'], Icon: Icon.MoreIcon, run: go('actions') },
    );
    // Contracts follow the VM gate (every chain whose descriptor advertises
    // DEPLOY: BTC, LTC and DOGE today), the same gate Home's Contracts entry
    // uses, so an LTC/DOGE-only wallet reaches Contracts from the palette too.
    // A shell that has not wired hasVmAddress yet falls back to the older
    // BTC gate rather than hiding the surface. Staking stays BTC-only.
    if (ctx.hasVmAddress ?? ctx.hasBtcAddress) {
        list.push({ id: 'nav-contracts', category: 'Navigate', title: t('home.contracts'), subtitle: t('palette.navContracts.subtitle'), keywords: ['vm', 'deploy', 'execute'], Icon: Icon.ContractIcon, run: go('contracts-list') });
    }
    if (ctx.hasBtcAddress) {
        list.push({ id: 'nav-staking', category: 'Navigate', title: t('home.staking'), subtitle: t('palette.navStaking.subtitle'), keywords: ['stake', 'validator', 'rewards'], Icon: Icon.StakeIcon, run: go('staking-dashboard') });
        // Multisig is Bitcoin-only (§10.3), so it shares the staking gate. The
        // actions menu already listed both; the palette found neither.
        list.push(
            { id: 'nav-multisig-create', category: 'Navigate', title: t('palette.navMultisigCreate.title'), subtitle: t('palette.navMultisigCreate.subtitle'), keywords: ['multisig', 'cosigner', 'shared', 'xpub', 'fingerprint', 'n-of-m'], Icon: Icon.UsersIcon, run: go('multisig-create') },
            { id: 'nav-multisig-sign', category: 'Navigate', title: t('palette.navMultisigSign.title'), subtitle: t('palette.navMultisigSign.subtitle'), keywords: ['multisig', 'cosigner', 'approve', 'psbt'], Icon: Icon.SignIcon, run: go('multisig-sign') },
            { id: 'nav-cosigner-accounts', category: 'Navigate', title: t('palette.navCoSignerAccounts.title'), subtitle: t('palette.navCoSignerAccounts.subtitle'), keywords: ['agent', 'automated', 'cosigner', 'co-sign', 'musig2', 'policy', 'bot'], Icon: Icon.UsersIcon, run: go('cosigner-accounts') },
        );
    }
    if (ctx.hasGovernanceAddress) {
        list.push({ id: 'nav-governance', category: 'Navigate', title: t('governance.title'), subtitle: t('palette.navGovernance.subtitle'), keywords: ['vote', 'poll', 'proposal'], Icon: Icon.HandshakeIcon, run: go('governance-polls') });
    }
    // Betting, on the DEX pattern: the browse hub plus the two views a user comes
    // back to rather than browses to. Ungated like the actions-menu entry it
    // mirrors, because the hub itself reports when no chain in this wallet
    // supports BET; gating here would make the destination silently unfindable
    // instead of explaining itself.
    list.push(
        { id: 'nav-betting', category: 'Navigate', title: t('palette.navBetting.title'), subtitle: t('palette.navBetting.subtitle'), keywords: ['bet', 'market', 'odds', 'wager', 'oracle', 'parimutuel'], Icon: Icon.DollarIcon, run: go('bet-markets') },
        { id: 'nav-my-bets', category: 'Navigate', title: t('palette.navMyBets.title'), subtitle: t('palette.navMyBets.subtitle'), keywords: ['bet', 'stake', 'wager', 'payout', 'winnings'], Icon: Icon.DollarIcon, run: go('my-bets') },
        { id: 'nav-bet-oracle-console', category: 'Navigate', title: t('palette.navBetOracleConsole.title'), subtitle: t('palette.navBetOracleConsole.subtitle'), keywords: ['bet', 'oracle', 'resolve', 'market', 'settle', 'publish'], Icon: Icon.DollarIcon, run: go('bet-oracle-console') },
    );

    // ---- Create: authoring forms that open free-entry (no ref needed) ---
    list.push(
        { id: 'create-token', category: 'Create', title: t('palette.createToken.title'), subtitle: t('palette.createToken.subtitle'), keywords: ['issue', 'new token', 'mint', 'launch'], Icon: Icon.PlusIcon, run: go('wizard') },
        { id: 'create-issue', category: 'Create', title: t('issue.title'), subtitle: t('palette.createIssue.subtitle'), keywords: ['issue'], Icon: Icon.TokenIcon, run: go('issue') },
        { id: 'create-mint', category: 'Create', title: t('palette.createMint.title'), subtitle: t('palette.createMint.subtitle'), keywords: ['mint', 'supply'], Icon: Icon.PlusIcon, run: go('mint') },
        { id: 'create-destroy', category: 'Create', title: t('palette.createDestroy.title'), subtitle: t('palette.createDestroy.subtitle'), keywords: ['burn', 'destroy'], Icon: Icon.TrashIcon, run: go('destroy') },
        { id: 'create-sweep', category: 'Create', title: t('palette.createSweep.title'), subtitle: t('palette.createSweep.subtitle'), keywords: ['sweep', 'migrate', 'move', 'consolidate'], Icon: Icon.SendIcon, run: go('sweep') },
        { id: 'create-broadcast', category: 'Create', title: t('palette.createBroadcast.title'), subtitle: t('palette.createBroadcast.subtitle'), keywords: ['broadcast', 'announce'], Icon: Icon.BroadcastIcon, run: go('broadcast') },
        { id: 'create-oracle-price', category: 'Create', title: t('palette.createOraclePrice.title'), subtitle: t('palette.createOraclePrice.subtitle'), keywords: ['oracle', 'price', 'fiat', 'quote', 'feed'], Icon: Icon.DollarIcon, run: go('oracle') },
        { id: 'create-dispenser', category: 'Create', title: t('palette.createDispenser.title'), subtitle: t('palette.createDispenser.subtitle'), keywords: ['dispenser', 'vending', 'sell'], Icon: Icon.DollarIcon, run: go('dispenser') },
        { id: 'create-dividend', category: 'Create', title: t('palette.createDividend.title'), subtitle: t('palette.createDividend.subtitle'), keywords: ['dividend', 'distribute'], Icon: Icon.DollarIcon, run: go('dividend') },
        { id: 'create-airdrop', category: 'Create', title: t('palette.createAirdrop.title'), subtitle: t('palette.createAirdrop.subtitle'), keywords: ['airdrop', 'distribute', 'bulk'], Icon: Icon.SendIcon, run: go('airdrop') },
        { id: 'create-list', category: 'Create', title: t('palette.createList.title'), subtitle: t('palette.createList.subtitle'), keywords: ['list', 'roster', 'allowlist'], Icon: Icon.TokenListIcon, run: go('list-create') },
        { id: 'create-publish-file', category: 'Create', title: t('palette.createPublishFile.title'), subtitle: t('palette.createPublishFile.subtitle'), keywords: ['file', 'upload', 'publish', 'gated', 'encrypted', 'content'], Icon: Icon.UploadIcon, run: go('publish-file') },
        // D-153: the ADDRESS-scoped half of the controller form (ADDRESS v1 -
        // a self-imposed gate on this address's own transfers, and the
        // recipient-side gate on what it will accept) had NO entry point at
        // all: the only route in was Manage Token -> More -> Controller, so a
        // wallet that had never issued a token could not reach it from any
        // screen. Titled for the address subject, since the token subject is
        // already reachable from the token it belongs to.
        { id: 'create-controller-bind', category: 'Create', title: t('palette.createControllerBind.title'), subtitle: t('palette.createControllerBind.subtitle'), keywords: ['controller', 'guard', 'bind', 'policy', 'gate', 'compliance', 'royalty'], Icon: Icon.LockIcon, run: go('controller-bind') },
        // The two bridge surfaces. Authoring forms that open free-entry, like
        // their neighbours here: the move form picks its own leg from the
        // chain it is on, and the settings form carries the same token picker
        // every other TokenAdminForm mode does, so neither needs a ref the
        // palette cannot supply. Ungated: the bridge is not the DEX surface,
        // and both forms report for themselves when a chain or a token cannot
        // bridge. Filed under Create rather than Trade because a bridge move
        // is not a trade; nobody is on the other side of it.
        { id: 'create-bridge-move', category: 'Create', title: t('palette.createBridgeMove.title'), subtitle: t('palette.createBridgeMove.subtitle'), keywords: ['bridge', 'cross chain', 'move', 'chain', 'xbridge', 'migrate', 'port'], Icon: Icon.LinkIcon, run: go('bridge-move') },
        { id: 'create-bridge-settings', category: 'Create', title: t('palette.createBridgeSettings.title'), subtitle: t('palette.createBridgeSettings.subtitle'), keywords: ['bridge', 'chains', 'issuer', 'depth', 'confirmations', 'freeze', 'xbridge'], Icon: Icon.LinkIcon, run: go('bridge-settings') },
        { id: 'create-advanced', category: 'Create', title: t('palette.createAdvanced.title'), subtitle: t('palette.createAdvanced.subtitle'), keywords: ['advanced', 'raw', 'expert'], Icon: Icon.GearIcon, run: go('advanced') },
    );

    // ---- Trade: DEX / cross-chain flows ---------------------------------
    // Ungated here: 'trade-coinpay' SETTLES an order that already matched, which
    // is a payment the user owes - one seed spans shells, so a match made on web
    // can come due on a phone whose build has no DEX. Templates only prefill the
    // parallel composer, which every build has.
    list.push(
        ...(hasDex ? [
            { id: 'trade-swap', category: 'Trade', title: t('palette.tradeSwap.title'), subtitle: t('palette.tradeSwap.subtitle'), keywords: ['swap', 'order', 'exchange'], Icon: Icon.SwapIcon, run: go('swap') },
            { id: 'trade-order', category: 'Trade', title: t('palette.tradeOrder.title'), subtitle: t('palette.tradeOrder.subtitle'), keywords: ['order', 'limit', 'dex', 'sell', 'buy', 'native'], Icon: Icon.MarketIcon, run: go('create-order') },
        ] : []),
        { id: 'trade-coinpay', category: 'Trade', title: t('palette.tradeCoinpay.title'), subtitle: t('palette.tradeCoinpay.subtitle'), keywords: ['coinpay', 'pay', 'settle'], Icon: Icon.DollarIcon, run: go('coinpay') },
        ...(hasDex ? [
            { id: 'trade-xchain-swap', category: 'Trade', title: t('palette.tradeXchainSwap.title'), subtitle: t('palette.tradeXchainSwap.subtitle'), keywords: ['cross chain', 'bridge', 'atomic'], Icon: Icon.LinkIcon, run: go('cross-chain-swap') },
            { id: 'trade-xchain-order', category: 'Trade', title: t('palette.tradeXchainOrder.title'), subtitle: t('palette.tradeXchainOrder.subtitle'), keywords: ['cross chain', 'order', 'limit', 'federation', 'partial'], Icon: Icon.LinkIcon, run: go('cross-chain-order') },
        ] : []),
        { id: 'trade-xchain-templates', category: 'Trade', title: t('palette.tradeXchainTemplates.title'), subtitle: t('palette.tradeXchainTemplates.subtitle'), keywords: ['cross chain', 'templates', 'parallel'], Icon: Icon.LinkIcon, run: go('cross-chain-templates') },
    );

    // ---- Sign: message / signature / PSBT -------------------------------
    list.push(
        { id: 'sign-message', category: 'Sign', title: t('home.signer.signMessage'), subtitle: t('palette.signMessage.subtitle'), keywords: ['sign', 'message', 'attest'], Icon: Icon.SignIcon, run: go('sign-message') },
        { id: 'sign-verify', category: 'Sign', title: t('home.signer.verifySignature'), subtitle: t('palette.signVerify.subtitle'), keywords: ['verify', 'signature', 'check'], Icon: Icon.VerifyIcon, run: go('verify-signature') },
        { id: 'sign-psbt', category: 'Sign', title: t('home.signer.signTransaction'), subtitle: t('palette.signPsbt.subtitle'), keywords: ['psbt', 'sign', 'watcher', 'air-gapped'], Icon: Icon.SignIcon, run: go('sign-psbt') },
    );

    // ---- Contacts -------------------------------------------------------
    list.push(
        { id: 'nav-contacts', category: 'Contacts', title: t('components.contactsPickerScreen.contacts'), subtitle: t('palette.navContacts.subtitle'), keywords: ['address book', 'people'], Icon: Icon.UsersIcon, run: go('contacts') },
    );

    // ---- Wallet verbs (only when the shell wires the handler) -----------
    if (typeof ctx.scan === 'function') {
        list.push({ id: 'wallet-scan', category: 'Wallet', title: t('scan.scannerAlt'), subtitle: t('palette.walletScan.subtitle'), keywords: ['qr', 'camera', 'scan'], Icon: Icon.ScanIcon, run: () => ctx.scan() });
    }
    if (typeof ctx.refresh === 'function') {
        list.push({ id: 'wallet-refresh', category: 'Wallet', title: t('components.tradeHistoryPanel.refresh'), subtitle: t('palette.walletRefresh.subtitle'), keywords: ['reload', 'sync', 'update'], Icon: Icon.RefreshIcon, run: () => ctx.refresh() });
    }
    if (typeof ctx.switchWallet === 'function') {
        list.push({ id: 'wallet-switch', category: 'Wallet', title: t('components.bottomTabBar.switchWallet'), subtitle: t('palette.walletSwitch.subtitle'), keywords: ['wallet', 'account', 'change'], Icon: Icon.UsersIcon, run: () => ctx.switchWallet() });
    }
    if (typeof ctx.lock === 'function') {
        list.push({ id: 'wallet-lock', category: 'Wallet', title: t('home.lockWallet'), subtitle: t('palette.walletLock.subtitle'), keywords: ['lock', 'logout', 'secure'], Icon: Icon.LockIcon, run: () => ctx.lock() });
    }
    if (typeof ctx.openHelp === 'function') {
        list.push({ id: 'help-shortcuts', category: 'Wallet', title: t('keyboard.shortcutHelp.keyboardShortcuts'), subtitle: t('palette.helpShortcuts.subtitle'), keywords: ['keys', 'hotkeys', 'help', 'cheatsheet', 'shortcuts'], Icon: Icon.InfoIcon, run: () => ctx.openHelp() });
    }

    // ---- Settings -------------------------------------------------------
    list.push(
        { id: 'nav-settings', category: 'Settings', title: t('home.settings'), subtitle: t('components.totalBalanceHero.openSettings'), keywords: ['preferences', 'options', 'config'], Icon: Icon.GearIcon, run: go('settings') },
        { id: 'nav-connected-sites', category: 'Settings', title: t('settings.connectedSites.connectedSites'), subtitle: t('palette.navConnectedSites.subtitle'), keywords: ['dapps', 'permissions', 'connections'], Icon: Icon.LinkIcon, run: go('connected-sites') },
    );

    if (ctx.isSignerMode) {
        return list.filter((command) => !SIGNER_UNAVAILABLE_CATEGORIES.has(command.category));
    }
    if (ctx.isDemoWallet) {
        return list.filter((command) => !DEMO_UNAVAILABLE_COMMAND_IDS.has(command.id));
    }
    if (ctx.isWatcherMode) {
        return list.filter((command) => !WATCHER_UNAVAILABLE_COMMAND_IDS.has(command.id));
    }
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
            subtitle: t('palette.contact.subtitle'),
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
            subtitle: row.chainDisplayName ? t('palette.token.subtitle', { tick: row.tick, chain: row.chainDisplayName }) : row.tick,
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
 * expose yet. Skipped when the shell can't open that surface; as
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
            subtitle: site.appName && site.origin ? t('palette.site.subtitleWithOrigin', { origin: site.origin }) : t('palette.site.subtitle'),
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
    { id: 'this-wallet', get title() { return t('settings.page.thisWallet'); }, keywords: ['wallet', 'rename', 'remove'] },
    { id: 'appearance', get title() { return t('settings.page.appearance'); }, keywords: ['theme', 'dark', 'light'] },
    { id: 'display', get title() { return t('settings.page.display'); }, keywords: ['pinned', 'hidden', 'tokens'] },
    { id: 'keyboard', get title() { return t('settings.page.keyboard'); }, keywords: ['shortcuts', 'rebind', 'keys', 'hotkeys'] },
    { id: 'language-region', get title() { return t('settings.page.languageRegion'); }, keywords: ['language', 'currency', 'fiat'] },
    { id: 'privacy', get title() { return t('settings.page.privacy'); }, keywords: ['tor', 'rotation', 'blur'] },
    { id: 'safety', get title() { return t('settings.page.safety'); }, keywords: ['autolock', 'panic', 'undo'] },
    { id: 'wallet-mode', get title() { return t('settings.page.walletMode'); }, keywords: ['watcher', 'signer', 'air-gapped'] },
    { id: 'backup', get title() { return t('settings.page.backup'); }, keywords: ['seed', 'phrase', 'restore', 'export'] },
    { id: 'fees', get title() { return t('settings.page.fees'); }, keywords: ['fee', 'rbf', 'strategy'] },
    { id: 'network', get title() { return t('settings.network.label'); }, keywords: ['mainnet', 'testnet', 'regtest'] },
    { id: 'network-endpoints', get title() { return t('settings.page.networkEndpoints'); }, keywords: ['explorer', 'encoder', 'hub', 'url'] },
    { id: 'notifications', get title() { return t('alerts.notificationsTitle'); }, keywords: ['alerts', 'notify'] },
    { id: 'ads', get title() { return t('palette.settings.ads'); }, keywords: ['donation', 'ads', 'support'] },
    { id: 'developer', get title() { return t('palette.settings.developer'); }, keywords: ['dev', 'debug', 'regtest'] },
    { id: 'about', get title() { return t('routes.addressList.about'); }, keywords: ['version', 'license'] },
]);

/**
 * Settings sections the Settings screen does not list for this wallet, by the
 * same rules as its `visible` flags: Network endpoints needs Developer Mode
 * (an unloaded settings object counts as visible, as there), and the compact
 * popup has no Keyboard section.
 *
 * @param {{ settings?: { developerMode?: boolean } | null, compact?: boolean }} opts
 * @returns {string[]}
 */
export function hiddenSettingsSectionIds({ settings, compact = false } = {}) {
    const hidden = [];
    if (settings?.developerMode === false) hidden.push('network-endpoints');
    if (compact) hidden.push('keyboard');
    return hidden;
}

/**
 * Settings-section deep-link commands (§33.2). `openSettings(sectionId)` is
 * shell-supplied (sets the Settings initialSubpageId and navigates); when
 * absent (extension popup has no Settings route) no commands are produced.
 * Sections named in `hiddenSettingsSections` are left out, because opening
 * one would land on the bare Settings list.
 *
 * @param {{ openSettings?: (sectionId: string) => void, hiddenSettingsSections?: string[] }} ctx
 * @returns {import('./fuzzyMatch.js').Command[]}
 */
export function settingsSectionsToCommands(ctx) {
    if (typeof ctx?.openSettings !== 'function') return [];
    const hidden = new Set(ctx.hiddenSettingsSections || []);
    return SETTINGS_SECTIONS.filter((s) => !hidden.has(s.id)).map((s) => ({
        id: `settings-${s.id}`,
        category: 'Settings',
        title: t('palette.settingsSectionTitle', { section: s.title }),
        subtitle: t('palette.settingsSectionSubtitle'),
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
            { id: 'help-backup', category: 'Help', title: t('palette.helpBackup.title'), subtitle: t('palette.helpBackup.subtitle'), keywords: ['help', 'backup', 'seed', 'recovery'], Icon: Icon.InfoIcon, run: () => ctx.openSettings('backup') },
            { id: 'help-connect-dapp', category: 'Help', title: t('palette.helpConnectDapp.title'), subtitle: t('palette.helpConnectDapp.subtitle'), keywords: ['help', 'dapp', 'connect', 'permissions'], Icon: Icon.InfoIcon, run: () => ctx.openSettings('connected-sites') },
            { id: 'help-panic', category: 'Help', title: t('palette.helpPanic.title'), subtitle: t('palette.helpPanic.subtitle'), keywords: ['help', 'panic', 'emergency', 'lock'], Icon: Icon.InfoIcon, run: () => ctx.openSettings('safety') },
        );
    }
    if (typeof ctx?.openHelp === 'function') {
        out.push({ id: 'help-keys', category: 'Help', title: t('palette.helpKeys.title'), subtitle: t('palette.helpKeys.subtitle'), keywords: ['help', 'keys', 'hotkeys', 'shortcuts'], Icon: Icon.InfoIcon, run: () => ctx.openHelp() });
    }
    return out;
}
