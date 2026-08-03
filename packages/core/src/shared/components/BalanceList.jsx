// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useMemo, useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { MultisigBadge, VerifiedBadge, Icon } from '@xchain-wallet/core/ui';
import { EmptyStateNudge } from './EmptyStateNudge.jsx';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import styles from './BalanceList.module.css';

/**
 * Renders a flat list of balance rows. Filtering, tab selection, and
 * sectioning live in the parent (typically `<HomeTabs>`); this is a
 * dumb renderer so each tab can reuse the same row layout against
 * its own slice of the data.
 *
 * @param {object} props
 * @param {Array<BalanceRow>} props.rows
 * @param {{ threshold: number, cosignerCount: number, scheme: string } | null} [props.multisig]
 * @param {string} [props.multisigChainId]
 * @param {string} [props.emptyTitle]                empty-state headline
 * @param {string} [props.emptyBody]                 explanatory body copy
 * @param {() => void} [props.onReceive]             when supplied, the empty-state shows a Receive CTA
 * @param {(token: { chainId: string, tick: string, kind: string, displayName: string, divisibility: number, fiatRate: number | null, quantity: string }) => void} [props.onSelectToken]
 *        Click handler for a balance row. Surfaces the §27.6 Token detail page (G071) when supplied.
 * @param {Set<string> | null} [props.pinnedKeys]    `chainId:tick` keys pinned by the user. Pinned rows sort to the top (§27.3 / G072).
 * @param {(key: string, nextPinned: boolean) => void} [props.onTogglePin]   per-row pin/unpin callback; when supplied each row renders a star button
 * @param {Set<string> | null} [props.hiddenKeys]    `chainId:tick` keys hidden by the user. Hidden rows collapse into the Hidden footer section (§27.4 / G073).
 * @param {(key: string, nextHidden: boolean) => void} [props.onToggleHide]  per-row hide/unhide callback; when supplied, each row gains a "hide" entry in its overflow menu
 * @param {Record<string, { status: 'verified' | 'failed' | 'unavailable' | 'pending', reason: string | null }> | null} [props.verifyMap]   SPV proof verdict per `chainId:tick`; token rows render a `<VerifiedBadge>` when an entry exists (§7/§8). Native rows are never badged.
 * @param {boolean} [props.hideSmallBalances]   : `settings.privacy.hideSmallBalances`. Collapses dust rows into their own footer section instead of listing them inline.
 * @param {boolean} [props.showChain]   : name each row's chain in the subtitle. Off by default, because in a single-chain list the network is already set globally and repeating it is noise. Turn it on for any CROSS-CHAIN list, where the same tick appears once per chain and the rows are otherwise indistinguishable.
 */
export function BalanceList({
    rows,
    multisig,
    multisigChainId,
    emptyTitle = 'No balances yet',
    emptyBody,
    onReceive,
    onSelectToken,
    pinnedKeys,
    onTogglePin,
    hiddenKeys,
    onToggleHide,
    verifyMap,
    hideSmallBalances = false,
    showChain = false,
}) {
    const [hiddenExpanded, setHiddenExpanded] = useState(false);
    const [smallExpanded, setSmallExpanded] = useState(false);
    if (!rows || rows.length === 0) {
        return (
            <EmptyStateNudge
                title={emptyTitle}
                body={emptyBody}
                actionLabel={onReceive ? 'Receive' : undefined}
                onAction={onReceive}
                icon={onReceive ? <Icon.ReceiveIcon /> : undefined}
            />
        );
    }
    // Stable sort: pinned rows first (preserving each section's existing
    // chain/tick order), then unpinned. Caller already sorted within each
    // group via sortByChainThenAsset.
    const notHidden = hiddenKeys
        ? rows.filter((r) => !hiddenKeys.has(`${r.chainId}:${r.tick}`))
        : rows;
    const hidden = hiddenKeys
        ? rows.filter((r) => hiddenKeys.has(`${r.chainId}:${r.tick}`))
        : [];
    // . A row the user explicitly pinned is never dust to them, so the
    // pin wins over the dust threshold; everything else under the threshold
    // moves into its own collapsed section. Collapsed, not dropped: a balance
    // the wallet knows about but will not show anywhere is a support ticket.
    const small = hideSmallBalances
        ? notHidden.filter((r) => !pinnedKeys?.has(`${r.chainId}:${r.tick}`) && isSmallBalanceRow(r))
        : [];
    const smallSet = new Set(small.map((r) => `${r.chainId}:${r.tick}`));
    const visible = small.length > 0
        ? notHidden.filter((r) => !smallSet.has(`${r.chainId}:${r.tick}`))
        : notHidden;
    const sortedRows = pinnedKeys && pinnedKeys.size > 0
        ? [
            ...visible.filter((r) => pinnedKeys.has(`${r.chainId}:${r.tick}`)),
            ...visible.filter((r) => !pinnedKeys.has(`${r.chainId}:${r.tick}`)),
        ]
        : visible;
    return (
        <div className={styles.list} role="list" aria-label="Balances">
            {sortedRows.map((r) => {
                const key = `${r.chainId}:${r.tick}`;
                const pinned = pinnedKeys ? pinnedKeys.has(key) : false;
                return (
                    <BalanceRowEl
                        key={key}
                        row={r}
                        multisig={r.chainId === multisigChainId ? multisig : null}
                        onSelect={onSelectToken}
                        pinned={pinned}
                        onTogglePin={onTogglePin}
                        hidden={false}
                        onToggleHide={onToggleHide}
                        verify={verifyMap ? verifyMap[key] : null}
                        showChain={showChain}
                    />
                );
            })}
            {hidden.length > 0 ? (
                <>
                    <button
                        type="button"
                        className={styles.hiddenToggle}
                        onClick={() => setHiddenExpanded((v) => !v)}
                        aria-expanded={hiddenExpanded}
                    >
                        {hiddenExpanded
                            ? `Hide ${hidden.length} hidden token${hidden.length === 1 ? '' : 's'}`
                            : `Show ${hidden.length} hidden token${hidden.length === 1 ? '' : 's'}`}
                    </button>
                    {hiddenExpanded ? hidden.map((r) => {
                        const key = `${r.chainId}:${r.tick}`;
                        return (
                            <BalanceRowEl
                                key={`hidden:${key}`}
                                row={r}
                                multisig={r.chainId === multisigChainId ? multisig : null}
                                onSelect={onSelectToken}
                                pinned={false}
                                onTogglePin={onTogglePin}
                                hidden
                                onToggleHide={onToggleHide}
                                verify={verifyMap ? verifyMap[key] : null}
                                showChain={showChain}
                            />
                        );
                    }) : null}
                </>
            ) : null}
            {small.length > 0 ? (
                <>
                    <button
                        type="button"
                        className={styles.hiddenToggle}
                        onClick={() => setSmallExpanded((v) => !v)}
                        aria-expanded={smallExpanded}
                        data-testid="small-balances-toggle"
                    >
                        {smallExpanded
                            ? `Hide ${small.length} small balance${small.length === 1 ? '' : 's'}`
                            : `Show ${small.length} small balance${small.length === 1 ? '' : 's'}`}
                    </button>
                    {smallExpanded ? small.map((r) => {
                        const key = `${r.chainId}:${r.tick}`;
                        return (
                            <BalanceRowEl
                                key={`small:${key}`}
                                row={r}
                                multisig={r.chainId === multisigChainId ? multisig : null}
                                onSelect={onSelectToken}
                                pinned={false}
                                onTogglePin={onTogglePin}
                                hidden={false}
                                onToggleHide={onToggleHide}
                                verify={verifyMap ? verifyMap[key] : null}
                                showChain={showChain}
                            />
                        );
                    }) : null}
                </>
            ) : null}
        </div>
    );
}

function BalanceRowEl({ row, multisig, onSelect, pinned, onTogglePin, hidden, onToggleHide, verify, showChain }) {
    const isNative = row.kind === 'native';
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    // App-wide privacy toggle: when on, replace the per-row qty and
    // fiat values with dots so navigating to / from the row leaks
    // nothing. Distinct from the per-row `hidden` prop above, which
    // controls whether this row appears in the Hidden tokens section.
    const [balancesHidden] = useBalancesHidden();
    // Network/env (mainnet/testnet/regtest) is already chosen globally
    // in Settings, so repeating it on every row adds noise. Show just the
    // tick symbol; chain family is conveyed by the chain icon.
    //
    // : that last clause only holds for NATIVE rows. The chain icon is
    // rendered under `isNative` below; a token with no published image falls
    // through to a letter chip, which is derived from the tick and therefore
    // identical for the same token on every chain. In a cross-chain list that
    // makes the rows genuinely indistinguishable: session 20 hit three
    // identical "XCHAIN / XCHAIN / 0.00000000" rows keyed bitcoin-regtest,
    // litecoin-regtest and dogecoin-regtest, and picking one silently
    // re-targets the calling form's network. So callers that show a
    // cross-chain list opt into naming the chain.
    //
    // D-60: that reasoning holds only on MAINNET. Off it, the user may not
    // have chosen the network at all - demo mode is started with
    // `activeNetwork: 'regtest'` by `Onboarding.jsx` and never says so - and
    // the row then reads "Bitcoin / BTC" priced at $7,000,000 for coins that
    // are worth nothing. The first time the word regtest reached the user was
    // an error message from the Send form. So a non-mainnet row names its
    // network, always: this is the one case where repeating it is not noise.
    const networkSuffix = row.networkKind && row.networkKind !== 'mainnet'
        ? ` · ${row.networkKind}`
        : '';
    const subtitle = (showChain && row.chainDisplayName
        ? `${row.tick} · ${row.chainDisplayName}`
        : row.tick) + networkSuffix;
    const fiat = useMemo(
        () => fiatValue(row.quantity, row.divisibility, row.fiatRate),
        [row.quantity, row.divisibility, row.fiatRate],
    );
    const clickable = typeof onSelect === 'function';
    const handleClick = clickable
        ? () => onSelect({
            chainId: row.chainId,
            tick: row.tick,
            kind: row.kind,
            displayName: row.displayName,
            divisibility: row.divisibility,
            fiatRate: row.fiatRate,
            quantity: row.quantity,
            imageUrl: row.imageUrl,
        })
        : undefined;
    const showPin = typeof onTogglePin === 'function';
    const pinKey = `${row.chainId}:${row.tick}`;
    const Tag = clickable ? 'button' : 'div';
    return (
        <Tag
            className={`${styles.row} ${clickable ? styles.rowClickable : ''} ${pinned ? styles.rowPinned : ''}`}
            role="listitem"
            type={clickable ? 'button' : undefined}
            data-balance-key={pinKey}
            onClick={handleClick}
            aria-label={clickable
                ? `Open ${row.displayName || row.tick} details`
                : undefined}
        >
            <div className={styles.iconWrap}>
                {isNative && chainIconUrl ? (
                    <img src={chainIconUrl} alt="" aria-hidden="true" className={styles.iconImg} />
                ) : row.imageUrl ? (
                    <img
                        src={row.imageUrl}
                        alt=""
                        aria-hidden="true"
                        className={styles.iconImg}
                        onError={(e) => {
                            // If the published image 404s, fall back to
                            // the letter chip by hiding the broken img;
                            // the next render still has imageUrl set, so
                            // we can't swap to <span>, so just hide.
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <span
                        className={styles.iconLetter}
                        style={{ background: tickerColor(row.tick), color: '#FFFFFF' }}
                        aria-hidden="true"
                    >
                        {row.tick.slice(0, 1)}
                    </span>
                )}
                {!isNative && chainIconUrl ? (
                    <img
                        src={chainIconUrl}
                        alt=""
                        aria-hidden="true"
                        title={row.chainDisplayName}
                        className={styles.chainOverlay}
                    />
                ) : null}
            </div>
            <div className={styles.body}>
                <div className={styles.title}>
                    <span className={styles.name} title={row.displayName}>{row.displayName}</span>
                    {multisig ? (
                        <MultisigBadge
                            threshold={multisig.threshold}
                            cosignerCount={multisig.cosignerCount}
                            scheme={multisig.scheme}
                            size="sm"
                        />
                    ) : null}
                    {!isNative && verify ? (
                        <VerifiedBadge status={verify.status} reason={verify.reason} size="sm" />
                    ) : null}
                </div>
                <div className={styles.subtitle}>{subtitle}</div>
            </div>
            <div className={styles.amounts}>
                <div className={styles.qty}>
                    {/* Q-1 residual: an unread balance is not a zero, and a
                        fiat figure derived from one is not a value. When
                        nothing answered, say so instead of printing 0; when
                        only part answered, show the figure but mark it as less
                        than the whole. The privacy toggle still wins, since it
                        exists to keep numbers off the screen entirely. */}
                    {balancesHidden
                        ? '•••••'
                        : row.unavailable === 'all'
                            ? <span className={styles.unavailable} title={row.unavailableReason || undefined}>Unavailable</span>
                            : formatAmount(row.quantity, row.divisibility)}
                </div>
                <div className={styles.fiat}>
                    {balancesHidden
                        ? '•••'
                        : row.unavailable === 'all'
                            ? <span title={row.unavailableReason || undefined}>Balance couldn&apos;t be loaded</span>
                            : row.unavailable === 'partial'
                                ? <span title={row.unavailableReason || undefined}>At least {formatFiat(fiat)}</span>
                                : formatFiat(fiat)}
                </div>
            </div>
            {showPin ? (
                <span
                    role="button"
                    tabIndex={0}
                    className={`${styles.pinBtn} ${pinned ? styles.pinBtnActive : ''}`}
                    aria-pressed={pinned}
                    aria-label={pinned ? `Unpin ${row.tick}` : `Pin ${row.tick}`}
                    title={pinned ? 'Unpin' : 'Pin to top'}
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onTogglePin(pinKey, !pinned);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onTogglePin(pinKey, !pinned);
                        }
                    }}
                >
                    {pinned ? '★' : '☆'}
                </span>
            ) : null}
            {typeof onToggleHide === 'function' ? (
                <span
                    role="button"
                    tabIndex={0}
                    className={`${styles.hideBtn} ${hidden ? styles.hideBtnActive : ''}`}
                    aria-pressed={hidden}
                    aria-label={hidden ? `Unhide ${row.tick}` : `Hide ${row.tick}`}
                    title={hidden ? 'Unhide' : 'Hide'}
                    onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        onToggleHide(pinKey, !hidden);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            onToggleHide(pinKey, !hidden);
                        }
                    }}
                >
                    {hidden ? '⊕' : '⊘'}
                </span>
            ) : null}
        </Tag>
    );
}

/**
 * Heuristic for the "hide spam" affordance. Flags rows that are
 * tiny / unknown-issuer / zero-balance so the UI can surface a "hide all
 * spam" sweep button. Conservative: only obvious noise. Callers pass the
 * resulting key set into `<BalanceList>` `hiddenKeys`.
 *
 * @param {Array<{chainId: string, tick: string, kind: string, quantity: string, divisibility: number, fiatRate: number | null}>} rows
 * @returns {string[]}                          `chainId:tick` keys flagged as likely spam
 */
export function detectSpamCandidates(rows) {
    const flagged = [];
    for (const r of rows || []) {
        if (!r || r.kind === 'native') continue;
        const q = safeBigInt(r.quantity);
        if (q === 0n) {
            flagged.push(`${r.chainId}:${r.tick}`);
            continue;
        }
        // Subdivisible token whose magnitude rounds to 0.0001 of a unit
        // and has no fiat price. Almost always airdrop dust.
        if (r.fiatRate === null && r.divisibility > 0) {
            const div = 10n ** BigInt(r.divisibility);
            if (q < div / 10000n) flagged.push(`${r.chainId}:${r.tick}`);
        }
    }
    return flagged;
}

/* . Display dust thresholds in each chain's smallest unit. These decide
 * whether a ROW is worth listing, nothing else: they never gate a send, a fee
 * or a change output, so being a little generous here costs the user nothing.
 * Bitcoin's 546 is the familiar relay dust limit; Litecoin's relay floor sits
 * an order of magnitude higher per byte; Dogecoin Core carries an explicit
 * DEFAULT_DUST_LIMIT of 0.01 DOGE. */
export const SMALL_BALANCE_BASE_UNITS = Object.freeze({
    bitcoin: 546n,
    litecoin: 5460n,
    dogecoin: 1000000n,
});
const DEFAULT_SMALL_BALANCE_BASE_UNITS = 546n;

/**
 * Whether a balance row counts as dust for `settings.privacy.hideSmallBalances`.
 *
 * Zero is always dust, which is the case the user actually hits: an empty
 * LTC / DOGE row on a Bitcoin-only wallet. Above zero, native rows compare
 * against their chain's threshold, and divisible tokens against a ten-thousandth
 * of a unit (the same magnitude the spam heuristic already calls airdrop dust).
 * An indivisible token is never dust: one unit is one whole thing, usually an NFT.
 *
 * @param {{ chainId: string, tick: string, kind: string, quantity: string | bigint, divisibility: number }} row
 * @returns {boolean}
 */
export function isSmallBalanceRow(row) {
    if (!row) return false;
    const q = safeBigInt(row.quantity);
    if (q < 0n) return false;
    if (q === 0n) return true;
    if (row.kind === 'native') {
        const threshold = SMALL_BALANCE_BASE_UNITS[coinFromChainId(row.chainId)]
            ?? DEFAULT_SMALL_BALANCE_BASE_UNITS;
        return q < threshold;
    }
    const div = Number(row.divisibility) || 0;
    if (div <= 0) return false;
    return q < (10n ** BigInt(div)) / 10000n;
}

/**
 * Aggregates raw `balances` keyed by chainId + chain registry into
 * a flat list of `BalanceRow`s. Used by every tab so each tab gets
 * the same shape and only needs to filter.
 *
 * When `activeByChain` (chainId -> { address }) is supplied, each chain's
 * row reflects ONLY its active (operating) address, not the sum across all
 * addresses. Omitting it keeps the legacy whole-account aggregate, so other
 * callers are unaffected.
 *
 * @param {Record<string, any[]>} balances
 * @param {import('../../registry/index.js').ChainRegistry} chainRegistry
 * @param {Record<string, { address: string }> | null} [activeByChain]
 */
export function buildBalanceRows(balances, chainRegistry, activeByChain = null) {
    const out = [];
    if (!balances || typeof balances !== 'object') return out;

    for (const [chainId, entries] of Object.entries(balances)) {
        if (!Array.isArray(entries)) continue;
        const descriptor = chainRegistry.get(chainId);
        if (!descriptor) continue;

        const activeAddr = activeByChain && activeByChain[chainId]
            ? activeByChain[chainId].address
            : null;

        let nativeAcc = null;
        const tokenAcc = new Map();
        // Q-1 residual: `flows/balances.js` already reports WHICH side of a
        // per-address read failed (`unavailable: ['native'|'tokens']`), and
        // nothing on Home ever looked. So a chain whose `/address/` endpoint
        // was momentarily down produced no native row at all: the coin simply
        // vanished from the list, or - where another address on the same chain
        // did answer - the row showed a silently understated total. Both read
        // as fact. Track it here and let the row say "unavailable" instead of
        // stating a number it does not have.
        let nativeUnavailable = false;
        let nativeUnavailableReason = null;
        // D-67: sum each distinct ADDRESS once, not each Address RECORD. Two
        // records can name one address - importing a WIF twice makes a second
        // record, and importing a key the wallet already derives collides with
        // its HD record - and the entries here carry one chain balance per
        // record, so summing them reports money the wallet does not have.
        // Observed live: an address holding 0.59998404 BTC displayed as
        // 1.19996808 on Home after a duplicate import.
        const seenAddresses = new Set();

        for (const entry of entries) {
            // Active-address mode: only the active address contributes to the
            // chain's balance, so the user sees one address per coin.
            if (activeAddr && entry.address !== activeAddr) continue;
            if (seenAddresses.has(entry.address)) continue;
            const b = entry.balances;
            if (!b || typeof b !== 'object') continue;
            seenAddresses.add(entry.address);

            if (Array.isArray(b.unavailable) && b.unavailable.includes('native')) {
                nativeUnavailable = true;
                if (!nativeUnavailableReason && b.unavailableReason) {
                    nativeUnavailableReason = String(b.unavailableReason);
                }
            }

            if (b.native && b.native.quantity != null) {
                if (!nativeAcc) {
                    nativeAcc = mkRow({
                        kind: 'native',
                        chainId,
                        descriptor,
                        tick: b.native.tick || descriptor.coin.toUpperCase(),
                        displayName: b.native.displayName || descriptor.displayName,
                        divisibility: Number(b.native.divisibility ?? 8),
                        fiatRate: b.native.fiatRate,
                    });
                }
                nativeAcc.quantity += safeBigInt(b.native.quantity);
            }

            if (Array.isArray(b.tokens)) {
                for (const a of b.tokens) {
                    if (!a || typeof a.tick !== 'string') continue;
                    let acc = tokenAcc.get(a.tick);
                    if (!acc) {
                        acc = mkRow({
                            kind: a.kind || 'token',
                            chainId,
                            descriptor,
                            tick: a.tick,
                            displayName: a.displayName || a.tick,
                            divisibility: Number(a.divisibility ?? 8),
                            fiatRate: a.fiatRate,
                            imageUrl: typeof a.imageUrl === 'string' && a.imageUrl.length > 0
                                ? a.imageUrl
                                : null,
                        });
                        tokenAcc.set(a.tick, acc);
                    }
                    acc.quantity += safeBigInt(a.quantity);
                }
            }
        }

        // Q-1 residual. Two distinct cases, and neither is a zero:
        //
        //   nativeAcc === null   nothing answered. The row is emitted anyway
        //                        (a coin that vanishes from the list is worse
        //                        than one that says why) and marked whole.
        //   nativeAcc !== null   some addresses answered and some did not, so
        //                        the sum is real but INCOMPLETE. Marked
        //                        partial: the number is shown, flagged as less
        //                        than the whole, because a silently understated
        //                        balance is the same lie told quietly.
        if (nativeUnavailable) {
            const row = nativeAcc ?? mkRow({
                kind: 'native',
                chainId,
                descriptor,
                tick: descriptor.coin.toUpperCase(),
                displayName: descriptor.displayName,
                divisibility: 8,
                fiatRate: null,
            });
            row.unavailable = nativeAcc ? 'partial' : 'all';
            row.unavailableReason = nativeUnavailableReason;
            if (!nativeAcc) nativeAcc = row;
        }

        if (nativeAcc) out.push(nativeAcc);
        for (const acc of tokenAcc.values()) out.push(acc);
    }
    return out.map((r) => ({ ...r, quantity: r.quantity.toString() }));
}

/**
 * Build a zero-balance native row for a chain. Used by ReceivePicker to
 * make sure every chain the wallet has addresses on appears in the
 * Coins list even when the balance is 0 (so receive against that chain
 * is one tap away).
 *
 * @param {string} chainId
 * @param {import('../../registry/index.js').ChainRegistry} chainRegistry
 * @returns {object | null} BalanceRow with `quantity: "0"`, or null if
 *          the chain isn't registered.
 */
export function buildNativeRow(chainId, chainRegistry) {
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) return null;
    const row = mkRow({
        kind: 'native',
        chainId,
        descriptor,
        tick: shortLabelForCoin(descriptor.coin),
        displayName: descriptor.displayName,
        divisibility: 8,
        fiatRate: null,
    });
    return { ...row, quantity: row.quantity.toString() };
}

/**
 * Build a zero-balance token row from a platform search hit. Used by
 * ReceivePicker's "On the platform" discovery section to surface
 * tokens that exist on the platform but aren't in the user's balance.
 * Tapping the row lands on Receive with the chain + tick pre-filled.
 *
 * `meta` is whatever the picker has on hand from its search call
 * (usually just nulls), so the row falls back to a letter chip + the
 * tick as displayName. Callers are responsible for confirming the
 * token exists; this helper trusts its inputs and only fails on an
 * unregistered chain.
 *
 * @param {string} chainId
 * @param {string} tick
 * @param {{ displayName?: string | null, imageUrl?: string | null } | null} [meta]
 * @param {import('../../registry/index.js').ChainRegistry} chainRegistry
 * @returns {object | null}
 */
export function buildPlatformTokenRow(chainId, tick, meta, chainRegistry) {
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) return null;
    const row = mkRow({
        kind: 'token',
        chainId,
        descriptor,
        tick,
        displayName: meta?.displayName || tick,
        divisibility: 8,
        fiatRate: null,
        imageUrl: meta?.imageUrl || null,
    });
    return { ...row, quantity: row.quantity.toString() };
}

function mkRow({ kind, chainId, descriptor, tick, displayName, divisibility, fiatRate, imageUrl }) {
    return {
        kind,
        chainId,
        chainShort: shortLabelForCoin(descriptor.coin),
        chainDisplayName: descriptor.displayName,
        chainColor: descriptor.color,
        networkKind: descriptor.networkKind,
        tick,
        displayName,
        divisibility,
        fiatRate: typeof fiatRate === 'number' ? fiatRate : null,
        quantity: 0n,
        imageUrl: typeof imageUrl === 'string' && imageUrl.length > 0 ? imageUrl : null,
    };
}

function shortLabelForCoin(coin) {
    const map = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };
    return map[coin] || coin.toUpperCase();
}

const CHAIN_ORDER = { bitcoin: 0, litecoin: 1, dogecoin: 2 };
export function sortByChainThenAsset(rows) {
    return rows.slice().sort((a, b) => {
        const ax = CHAIN_ORDER[coinFromChainId(a.chainId)] ?? 99;
        const bx = CHAIN_ORDER[coinFromChainId(b.chainId)] ?? 99;
        return (ax - bx) || a.tick.localeCompare(b.tick);
    });
}
export function coinFromChainId(id) {
    if (typeof id !== 'string') return '';
    const dash = id.indexOf('-');
    return dash > 0 ? id.slice(0, dash) : id;
}

function safeBigInt(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string') {
        const t = v.trim();
        if (!/^-?\d+$/.test(t)) return 0n;
        return BigInt(t);
    }
    return 0n;
}

export function formatAmount(quantityStr, divisibility) {
    const q = String(quantityStr || '0');
    if (!divisibility || divisibility <= 0) return groupThousands(q);
    const negative = q.startsWith('-');
    const abs = negative ? q.slice(1) : q;
    const padded = abs.padStart(divisibility + 1, '0');
    const whole = padded.slice(0, padded.length - divisibility);
    const frac = padded.slice(padded.length - divisibility);
    const out = `${groupThousands(whole)}.${frac}`;
    return negative ? `-${out}` : out;
}

function groupThousands(s) {
    return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fiatValue(quantityStr, divisibility, fiatRate) {
    if (typeof fiatRate !== 'number' || !isFinite(fiatRate)) return null;
    const q = safeBigInt(quantityStr);
    if (q === 0n) return 0;
    if (!divisibility || divisibility <= 0) return Number(q) * fiatRate;
    const div = 10n ** BigInt(divisibility);
    const whole = Number(q / div);
    const frac = Number(q % div) / Number(div);
    return (whole + frac) * fiatRate;
}

/**
 * Sum the fiat value across an arbitrary list of `BalanceRow`s. Rows
 * without a `fiatRate` (no price data) are SKIPPED in the sum and
 * counted as `unpriced` so the caller can surface "X tokens not
 * priced" if it cares.
 *
 * @param {Array<{quantity: string, divisibility: number, fiatRate: number | null}>} rows
 * @returns {{ total: number, priced: number, unpriced: number }}
 */
export function sumFiatValue(rows) {
    let total = 0;
    let priced = 0;
    let unpriced = 0;
    for (const r of rows || []) {
        const v = fiatValue(r.quantity, r.divisibility, r.fiatRate);
        if (v === null) unpriced += 1;
        else { total += v; priced += 1; }
    }
    return { total, priced, unpriced };
}

export function formatFiat(usd) {
    if (usd === null || usd === undefined) return '';
    if (usd === 0) return '$0.00';
    if (usd > 0 && usd < 0.01) return '<$0.01';
    return '$' + usd.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

const PALETTE = [
    '#1E90C7', '#7B2C8F', '#0EA5E9', '#10B981', '#F59E0B',
    '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
    '#6366F1', '#84CC16', '#06B6D4', '#A855F7', '#F43F5E',
];
export function tickerColor(tick) {
    let h = 0;
    for (let i = 0; i < tick.length; i += 1) {
        h = (h * 31 + tick.charCodeAt(i)) >>> 0;
    }
    return PALETTE[h % PALETTE.length];
}
