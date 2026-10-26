// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { memo, useCallback, useMemo, useState } from 'react';
import { Button, EmptyState, MultisigBadge, VerifiedBadge, Icon, ListRow } from '@xchain-wallet/core/ui';
import { AssetMark } from '../../ui/AssetMark.jsx';
export { tickerColor } from '../../ui/AssetMark.jsx';
import { useBalancesHidden } from '../hooks/useBalancesHidden.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/balanceList.js';
import '../../i18n/locales/en/balances.js';
import '../../i18n/locales/en/pending.js';
import '../../i18n/locales/en/settings.js';
import styles from './BalanceList.module.css';
import { addPlainDecimals } from '../../flows/escrowedTokens.js';
import {
    decimalFromBaseUnits,
    expandDecimalNotation,
    formatAtomicAmount,
    formatDecimalAmount,
    multiplyDecimalStrings,
    sumDecimalStrings,
} from '../utils/amountFormat.js';
import {
    formatFiatAmount,
    formatFiatAmountForSpeech,
} from '../utils/fiatAmountFormat.js';
import {
    smallBalanceBaseUnitsFor,
    tickerForDescriptor,
} from '../../registry/coinTicker.js';
import { defaultRegistry } from '../../registry/index.js';

const chainRegistry = defaultRegistry();

export function isAssetImageSourceAllowed(src, allowRemoteImages = true) {
    if (typeof src !== 'string' || src.length === 0) return false;
    if (allowRemoteImages) return true;
    return /^(?:data:|blob:)/i.test(src);
}

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
 * @param {string} [props.emptyActionLabel]          label for a caller-defined empty-state action; takes the button over from Receive
 * @param {() => void} [props.onEmptyAction]         runs that action (e.g. clearing the filter that emptied the list)
 * @param {(token: { chainId: string, tick: string, kind: string, displayName: string, divisibility: number, fiatRate: number | null, fiatRateSource?: string, quantity: string }) => void} [props.onSelectToken]
 *        Click handler for a balance row. Surfaces the §27.6 Token detail page (G071) when supplied.
 * @param {(row: BalanceRow) => string} [props.getRowActionLabel]  overrides the default "Open ... details" accessible label for selector uses
 * @param {Set<string> | null} [props.pinnedKeys]    `chainId:tick` keys pinned by the user. Pinned rows sort to the top (§27.3 / G072).
 * @param {(key: string, nextPinned: boolean) => void} [props.onTogglePin]   per-row pin/unpin callback; when supplied each row renders a star button
 * @param {Set<string> | null} [props.hiddenKeys]    `chainId:tick` keys hidden by the user. Hidden rows collapse into the Hidden footer section (§27.4 / G073).
 * @param {Set<string> | null} [props.automaticHiddenKeys] `chainId:tick` keys collapsed by a display preference. These rows stay reachable but have no per-row unhide action because the preference owns their visibility.
 * @param {(key: string, nextHidden: boolean) => void} [props.onToggleHide]  per-row hide/unhide callback; when supplied, each row gains a "hide" entry in its overflow menu
 * @param {Record<string, { status: 'verified' | 'failed' | 'unavailable' | 'pending', reason: string | null }> | null} [props.verifyMap]   SPV proof verdict per `chainId:tick`; token rows render a `<VerifiedBadge>` when an entry exists (§7/§8). Native rows are never badged.
 * @param {boolean} [props.hideSmallBalances]: `settings.privacy.hideSmallBalances`. Collapses dust rows into their own footer section instead of listing them inline.
 * @param {'dust'|'0.0001'|'0.01'|'1'} [props.smallBalanceThreshold] threshold in whole asset units, or the chain-aware dust heuristic
 * @param {'full'|'trim'|'plain'} [props.numberFormat] exact balance amount presentation
 * @param {boolean} [props.showChain]: name each token row's chain in its accessible name (sighted users read it from the overlay badge). Multi-chain row sets enable this automatically; callers can still force it for a single-chain context.
 * @param {boolean} [props.allowRemoteImages] permits issuer-selected image URLs. Privacy-sensitive callers pass false until settings explicitly allow them.
 * @param {(row: BalanceRow) => number} [props.getRowTabIndex] assigns the single tab stop for a composite picker
 */
export const BalanceList = memo(function BalanceList({
    rows,
    multisig,
    multisigChainId,
    emptyTitle = t('balances.noBalancesYet'),
    emptyBody = t('balances.xchainPlatformCoinsAndTokens'),
    onReceive,
    emptyActionLabel,
    onEmptyAction,
    onSelectToken,
    getRowActionLabel,
    pinnedKeys,
    onTogglePin,
    hiddenKeys,
    automaticHiddenKeys,
    onToggleHide,
    verifyMap,
    hideSmallBalances = false,
    smallBalanceThreshold = 'dust',
    numberFormat = 'full',
    showChain = false,
    fiatCurrency = 'USD',
    allowRemoteImages = true,
    getRowTabIndex,
}) {
    const [hiddenExpanded, setHiddenExpanded] = useState(false);
    const [smallExpanded, setSmallExpanded] = useState(false);
    if (!rows || rows.length === 0) {
        const hasEmptyAction = Boolean(emptyActionLabel) && typeof onEmptyAction === 'function';
        return (
            <EmptyState
                title={emptyTitle}
                body={emptyBody}
                actionLabel={hasEmptyAction ? emptyActionLabel : (onReceive ? t('home.receive') : undefined)}
                onAction={hasEmptyAction ? onEmptyAction : onReceive}
                actionIcon={!hasEmptyAction && onReceive ? <Icon.ReceiveIcon /> : undefined}
            />
        );
    }
    // Stable sort: pinned rows first (preserving each section's existing
    // chain/tick order), then unpinned. Caller already sorted within each
    // group via sortByChainThenAsset.
    const isHidden = (row) => {
        const key = `${row.chainId}:${row.tick}`;
        return Boolean(hiddenKeys?.has(key) || automaticHiddenKeys?.has(key));
    };
    const notHidden = rows.filter((row) => !isHidden(row));
    const hidden = rows.filter(isHidden);
    //A row the user explicitly pinned is never dust to them, so the
    // pin wins over the dust threshold; everything else under the threshold
    // moves into its own collapsed section. Collapsed, not dropped: a balance
    // the wallet knows about but will not show anywhere is a support ticket.
    const small = hideSmallBalances
        ? notHidden.filter((r) => !pinnedKeys?.has(`${r.chainId}:${r.tick}`) && isSmallBalanceRow(r, smallBalanceThreshold))
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
    const labelChains = showChain || new Set(rows.map((row) => row.chainId).filter(Boolean)).size > 1;
    return (
        // Every row is a listitem wrapper around its details button and its
        // pin and hide controls, so the container stays a list in both modes.
        <div className={styles.list} role="list" aria-label={t('balances.balances')}>
            {sortedRows.map((r) => {
                const key = `${r.chainId}:${r.tick}`;
                const pinned = pinnedKeys ? pinnedKeys.has(key) : false;
                return (
                    <BalanceRowEl
                        key={key}
                        row={r}
                        numberFormat={numberFormat}
                        fiatCurrency={fiatCurrency}
                        multisig={r.chainId === multisigChainId ? multisig : null}
                        onSelect={onSelectToken}
                        getActionLabel={getRowActionLabel}
                        pinned={pinned}
                        onTogglePin={onTogglePin}
                        hidden={false}
                        onToggleHide={onToggleHide}
                        verify={verifyMap ? verifyMap[key] : null}
                        showChain={labelChains}
                        allowRemoteImages={allowRemoteImages}
                        getTabIndex={getRowTabIndex}
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
                            ? t('balanceList.hiddenTokens.hide', { count: hidden.length })
                            : t('balanceList.hiddenTokens.show', { count: hidden.length })}
                    </button>
                    {hiddenExpanded ? hidden.map((r) => {
                        const key = `${r.chainId}:${r.tick}`;
                        const pinned = pinnedKeys ? pinnedKeys.has(key) : false;
                        return (
                            <BalanceRowEl
                                key={`hidden:${key}`}
                                row={r}
                                numberFormat={numberFormat}
                                fiatCurrency={fiatCurrency}
                                multisig={r.chainId === multisigChainId ? multisig : null}
                                onSelect={onSelectToken}
                                getActionLabel={getRowActionLabel}
                                pinned={pinned}
                                onTogglePin={onTogglePin}
                                hidden
                                onToggleHide={automaticHiddenKeys?.has(key) ? undefined : onToggleHide}
                                verify={verifyMap ? verifyMap[key] : null}
                                showChain={labelChains}
                                allowRemoteImages={allowRemoteImages}
                                getTabIndex={getRowTabIndex}
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
                            ? t('balanceList.smallBalances.hide', { count: small.length })
                            : t('balanceList.smallBalances.show', { count: small.length })}
                    </button>
                    {smallExpanded ? small.map((r) => {
                        const key = `${r.chainId}:${r.tick}`;
                        return (
                            <BalanceRowEl
                                key={`small:${key}`}
                                row={r}
                                numberFormat={numberFormat}
                                fiatCurrency={fiatCurrency}
                                multisig={r.chainId === multisigChainId ? multisig : null}
                                onSelect={onSelectToken}
                                getActionLabel={getRowActionLabel}
                                pinned={false}
                                onTogglePin={onTogglePin}
                                hidden={false}
                                onToggleHide={onToggleHide}
                                verify={verifyMap ? verifyMap[key] : null}
                                showChain={labelChains}
                                allowRemoteImages={allowRemoteImages}
                                getTabIndex={getRowTabIndex}
                            />
                        );
                    }) : null}
                </>
            ) : null}
        </div>
    );
});

const BalanceRowEl = memo(function BalanceRowEl({ row, multisig, onSelect, getActionLabel, pinned, onTogglePin, hidden, onToggleHide, verify, showChain, allowRemoteImages, getTabIndex, fiatCurrency = 'USD', numberFormat = 'full' }) {
    const isNative = row.kind === 'native';
    const tokenImageUrl = isAssetImageSourceAllowed(row.imageUrl, allowRemoteImages)
        ? row.imageUrl
        : null;
    // App-wide privacy toggle: when on, replace the per-row qty and
    // fiat values with dots so navigating to / from the row leaks
    // nothing. Distinct from the per-row `hidden` prop above, which
    // controls whether this row appears in the Hidden tokens section.
    const [balancesHidden] = useBalancesHidden();
    // The subtitle is the ticker alone, on every list. The chain is shown by
    // the asset mark: native rows use the chain icon itself and every token row
    // carries the chain overlay badge (AssetMark draws a lettered badge when a
    // chain has no icon), which is what tells the same ticker on two chains
    // apart. The network is chosen once in Settings and never repeated here.
    //
    // The overlay is decorative to assistive tech, so a list that mixes chains
    // (`showChain`) names the chain in the row's accessible name instead,
    // unless the caller's action label already names it.
    const subtitle = row.tick;
    const chainSpeech = showChain && !isNative && row.chainDisplayName
        ? t('balanceList.rowChainSpeech', { chain: row.chainDisplayName })
        : '';
    const fiat = useMemo(
        () => fiatValue(row.quantity, row.divisibility, row.fiatRate),
        [row.quantity, row.divisibility, row.fiatRate],
    );
    const hasPending = safeBigInt(row.pendingQuantity) > 0n;
    const clickable = typeof onSelect === 'function';
    const actionLabel = clickable && typeof getActionLabel === 'function'
        ? getActionLabel(row)
        : `Open ${row.displayName || row.tick} details`;
    const handleClickCallback = useCallback(() => {
        onSelect({
            chainId: row.chainId,
            tick: row.tick,
            kind: row.kind,
            displayName: row.displayName,
            divisibility: row.divisibility,
            fiatRate: row.fiatRate,
            fiatRateSource: row.fiatRateSource,
            quantity: row.quantity,
            imageUrl: tokenImageUrl,
        });
    }, [clickable, onSelect, row.chainId, row.tick, row.kind, row.displayName,
        row.divisibility, row.fiatRate, row.fiatRateSource, row.quantity, tokenImageUrl]);
    const handleClick = clickable ? handleClickCallback : undefined;
    const showPin = typeof onTogglePin === 'function';
    const pinKey = `${row.chainId}:${row.tick}`;
    const handleTogglePin = useCallback((event) => {
        event.stopPropagation();
        event.preventDefault();
        onTogglePin(pinKey, !pinned);
    }, [onTogglePin, pinKey, pinned]);
    const handleToggleHide = useCallback((event) => {
        event.stopPropagation();
        event.preventDefault();
        onToggleHide(pinKey, !hidden);
    }, [onToggleHide, pinKey, hidden]);
    const roving = typeof getTabIndex === 'function';
    const quantityLabel = formatAmount(row.quantity, row.divisibility, numberFormat);
    const escrowLabel = row.escrowed ? escrowLine(row) : null;
    const fiatLabel = row.unavailable === 'partial'
        ? `At least ${formatRowFiat(row, fiat, fiatCurrency)}`
        : formatRowFiat(row, fiat, fiatCurrency);
    const quantitySpeech = row.unavailable === 'all'
        ? 'Balance unavailable'
        : `${row.unavailable === 'partial' ? 'At least ' : ''}${quantityLabel} ${row.tick}${hasPending ? ' confirmed' : ''}`;
    const pendingSpeech = hasPending
        ? `${formatAmount(row.pendingQuantity, row.divisibility, numberFormat)} ${row.tick} pending`
        : '';
    const fiatSpeechValue = formatFiatAmountForSpeech(fiat, fiatCurrency);
    const fiatSpeech = fiatSpeechValue
        ? `${row.unavailable === 'partial' ? 'At least ' : ''}${fiatSpeechValue}${!isNative && row.fiatRateSource === 'market' ? ', DEX price' : ''}`
        : '';
    const chainPart = chainSpeech && !actionLabel.includes(row.chainDisplayName) ? chainSpeech : '';
    const rowAccessibleLabel = balancesHidden
        ? [actionLabel, chainPart, 'balance hidden'].filter(Boolean).join(', ')
        : [
            actionLabel,
            chainPart,
            quantitySpeech,
            pendingSpeech,
            fiatSpeech,
        ].filter(Boolean).join(', ');
    return (
        <div
            className={`${styles.row} ${pinned ? styles.rowPinned : ''}`}
            role="listitem"
            data-balance-key={pinKey}
        >
            <ListRow
                className={`${styles.rowContent} ${clickable ? styles.rowClickable : ''}`}
                onClick={handleClick}
                aria-label={clickable ? rowAccessibleLabel : undefined}
                tabIndex={roving ? getTabIndex(row) : undefined}
                data-balance-option={roving ? pinKey : undefined}
                leading={(
                    <AssetMark
                        chainId={row.chainId}
                        tick={row.tick}
                        imageUrl={tokenImageUrl}
                        isNative={isNative}
                    />
                )}
                title={(
                    <span className={styles.title}>
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
                            <VerifiedBadge status={verify.status} reason={verify.reason} size="sm" details={!clickable} />
                        ) : null}
                    </span>
                )}
                subtitle={<span className={styles.subtitle} title={subtitle}>{subtitle}</span>}
                contentClassName={styles.rowBody}
                trailingClassName={styles.amountsSlot}
                trailing={<span className={styles.amounts}>
                    <span className={`${styles.qty} ${quantityLabel.length > LONG_QUANTITY_CHARS ? styles.qtyLong : ''}`.trim()} aria-label={balancesHidden ? t('balances.balanceHidden') : quantitySpeech}>
                        {/* Q-1 residual: an unread balance is not a zero, and a
                            fiat figure derived from one is not a value. When
                            nothing answered, say so instead of printing 0; when
                            only part answered, show the figure but mark it as less
                            than the whole. The privacy toggle still wins, since it
                            exists to keep numbers off the screen entirely. */}
                        {balancesHidden
                            ? '•••••'
                            : row.unavailable === 'all'
                                ? <span className={styles.unavailable} title={row.unavailableReason || undefined}>{t('balances.unavailable')}</span>
                                : (
                                    <FitAmount title={quantityLabel}>
                                        {quantityLabel}
                                        {hasPending ? <span className={styles.subtitle}> {t('pending.row.confirmed')}</span> : null}
                                    </FitAmount>
                                )}
                    </span>
                    {hasPending ? (
                        <span
                            className={styles.fiat}
                            data-testid="balance-pending"
                            aria-label={balancesHidden ? t('balances.pendingBalanceHidden') : pendingSpeech}
                        >
                            {balancesHidden
                                ? t('balances.pending')
                                : t('balances.pending2', { formatAmountValue: formatAmount(row.pendingQuantity, row.divisibility, numberFormat) })}
                        </span>
                    ) : null}
                    {row.escrowed ? (
                        <span className={styles.fiat} data-testid="balance-escrowed">
                            {balancesHidden ? '•••' : <FitAmount title={escrowLabel}>{escrowLabel}</FitAmount>}
                        </span>
                    ) : null}
                    <span
                        className={styles.fiat}
                        aria-label={balancesHidden
                            ? t('balances.fiatValueHidden')
                            : row.unavailable === 'all'
                                ? t('balances.fiatValueUnavailable')
                                : (fiatSpeech || undefined)}
                    >
                        {balancesHidden
                            ? '•••'
                            : row.unavailable === 'all'
                                ? <span title={row.unavailableReason || undefined}>{t('balances.balanceCouldnTBeLoaded')}</span>
                                : row.unavailable === 'partial'
                                    ? <FitAmount title={`${fiatLabel}. ${row.unavailableReason || ''}`.trim()}>{fiatLabel}</FitAmount>
                                    : <FitAmount title={fiatLabel}>{fiatLabel}</FitAmount>}
                    </span>
                </span>}
            />
            {showPin ? (
                <Button
                    className={styles.pinBtn}
                    size="sm"
                    variant={pinned ? 'primary' : 'secondary'}
                    icon={<span aria-hidden="true">{pinned ? '★' : '☆'}</span>}
                    aria-pressed={pinned}
                    aria-label={pinned ? t('balances.unpin', { tick: row.tick }) : t('balances.pin', { tick: row.tick })}
                    title={pinned ? t('balances.unpin2') : t('balances.pinToTop')}
                    onClick={handleTogglePin}
                />
            ) : null}
            {typeof onToggleHide === 'function' ? (
                <Button
                    className={styles.hideBtn}
                    size="sm"
                    variant={hidden ? 'primary' : 'secondary'}
                    icon={<span aria-hidden="true">{hidden ? '⊕' : '⊘'}</span>}
                    aria-pressed={hidden}
                    aria-label={hidden ? t('balances.unhide', { tick: row.tick }) : t('balances.hide', { tick: row.tick })}
                    title={hidden ? t('settings.display.unhide2') : t('settings.developer.hide')}
                    onClick={handleToggleHide}
                />
            ) : null}
        </div>
    );
}, balanceRowPropsEqual);

function balanceRowPropsEqual(previous, next) {
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    if (previousKeys.length !== nextKeys.length) return false;
    for (const key of previousKeys) {
        if (key === 'row') continue;
        if (!Object.hasOwn(next, key)) return false;
        if (!Object.is(previous[key], next[key])) return false;
    }
    return shallowEqualRow(previous.row, next.row);
}

function shallowEqualRow(previous, next) {
    if (Object.is(previous, next)) return true;
    if (!previous || !next) return false;
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    if (previousKeys.length !== nextKeys.length) return false;
    return previousKeys.every((key) => Object.hasOwn(next, key)
        && Object.is(previous[key], next[key]));
}

// A balance longer than this (for example 1,000,000.00000000) steps down one
// type size so it still fits beside the name; one that still does not fit
// moves to its own line under the name. Neither ends in an ellipsis.
const LONG_QUANTITY_CHARS = 16;

function FitAmount({ children, title }) {
    return (
        <span className={styles.amountFit} title={title}>
            {children}
        </span>
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
        // A token held in the user's own open offers is theirs, however little
        // is left free: that is the row escrow exists to keep on screen.
        if (r.escrowed) continue;
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

/**
 * Whether a balance row counts as dust for `settings.privacy.hideSmallBalances`.
 *
 * Zero confirmed quantity is dust only when no pending native funds exist.
 * Above zero, native rows compare against their chain's threshold, and
 * divisible tokens against a ten-thousandth of a unit (the same magnitude the
 * spam heuristic already calls airdrop dust). An indivisible token is never
 * dust: one unit is one whole thing, usually an NFT.
 *
 * @param {{ chainId: string, tick: string, kind: string, quantity: string | bigint, divisibility: number }} row
 * @param {'dust'|'0.0001'|'0.01'|'1'} [threshold]
 * @returns {boolean}
 */
export function isSmallBalanceRow(row, threshold = 'dust') {
    if (!row) return false;
    if (row.escrowed || row.unavailable || safeBigInt(row.pendingQuantity) > 0n) return false;
    const q = safeBigInt(row.quantity);
    if (q < 0n) return false;
    if (q === 0n) return true;
    if (threshold !== 'dust') {
        return q < decimalUnitsToBaseUnits(threshold, row.divisibility);
    }
    if (row.kind === 'native') {
        const descriptor = chainRegistry.get(row.chainId);
        const chainThreshold = smallBalanceBaseUnitsFor(
            descriptor || row.coin || coinFromChainId(row.chainId),
        );
        return q < chainThreshold;
    }
    const div = Number(row.divisibility) || 0;
    if (div <= 0) return false;
    return q < (10n ** BigInt(div)) / 10000n;
}

function decimalUnitsToBaseUnits(value, divisibility) {
    const div = Math.max(0, Number(divisibility) || 0);
    const [whole, fraction = ''] = String(value).split('.');
    const scale = 10n ** BigInt(div);
    const kept = fraction.slice(0, div).padEnd(div, '0');
    let result = BigInt(whole || '0') * scale + BigInt(kept || '0');
    if (fraction.slice(div).replace(/0/g, '')) result += 1n;
    return result;
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
                if (b.native.pendingQuantity != null) {
                    nativeAcc.pendingQuantity = (nativeAcc.pendingQuantity || 0n)
                        + safeBigInt(b.native.pendingQuantity);
                }
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

            if (Array.isArray(b.escrow)) addEscrowRows(tokenAcc, b.escrow, { chainId, descriptor });
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
    return out.map((r) => ({
        ...r,
        quantity: r.quantity.toString(),
        ...(r.pendingQuantity == null ? {} : { pendingQuantity: r.pendingQuantity.toString() }),
    }));
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

// Fold an address's open-offer escrow (`balances.escrow`, merged in by Home
// from flows/escrowedTokens.js) into its token rows. The explorer's balance
// read drops a zero FREE balance, so a token escrowed in full has no row yet
// and gets one here at quantity 0; its divisibility is unknown until a balance
// arrives, and only matters for that zero. `escrowed` stays a plain decimal
// string because offer amounts come back human-scaled, not atomic.
function addEscrowRows(tokenAcc, escrow, { chainId, descriptor }) {
    for (const e of escrow) {
        if (!e || typeof e.tick !== 'string' || !e.amount) continue;
        let acc = tokenAcc.get(e.tick);
        if (!acc) {
            acc = mkRow({
                kind: 'token', chainId, descriptor, tick: e.tick, displayName: e.tick,
                divisibility: (String(e.amount).split('.')[1] || '').length, fiatRate: null,
            });
            tokenAcc.set(e.tick, acc);
        }
        acc.escrowed = addPlainDecimals(acc.escrowed || '0', e.amount);
        // The part of it held by dispensers in their close window.
        if (e.closing) acc.escrowClosing = addPlainDecimals(acc.escrowClosing || '0', e.closing);
    }
}

// The escrow line under a token's amount. Escrow in a closing dispenser is
// named as such, since it leaves escrow when the close lands.
export function escrowLine(row) {
    if (!row.escrowClosing) return `+ ${row.escrowed} in escrow`;
    if (row.escrowClosing === row.escrowed) return `+ ${row.escrowed} in a closing dispenser`;
    return `+ ${row.escrowed} in escrow (${row.escrowClosing} in a closing dispenser)`;
}

function mkRow({ kind, chainId, descriptor, tick, displayName, divisibility, fiatRate, imageUrl }) {
    return {
        kind,
        chainId,
        coin: descriptor.coin,
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
    return tickerForDescriptor({ coin });
}

const CHAIN_ORDER = { bitcoin: 0, litecoin: 1, dogecoin: 2 };
export function sortByChainThenAsset(rows) {
    return rows.slice().sort((a, b) => {
        const ax = CHAIN_ORDER[a.coin || coinFromChainId(a.chainId)] ?? 99;
        const bx = CHAIN_ORDER[b.coin || coinFromChainId(b.chainId)] ?? 99;
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

/**
 * Atomic quantity at its divisibility, grouped for the selected language.
 * numberFormat: 'full' keeps every place, 'trim' drops trailing zeros, and
 * 'plain' skips grouping and locale entirely.
 */
export function formatAmount(quantityStr, divisibility, numberFormat = 'full') {
    if (numberFormat === 'plain') {
        const q = String(quantityStr || '0');
        if (!divisibility || divisibility <= 0) return q;
        const negative = q.startsWith('-');
        const abs = negative ? q.slice(1) : q;
        const padded = abs.padStart(divisibility + 1, '0');
        const whole = padded.slice(0, padded.length - divisibility);
        const frac = padded.slice(padded.length - divisibility);
        const out = frac ? `${whole}.${frac}` : whole;
        return negative ? `-${out}` : out;
    }
    if (numberFormat !== 'trim') return formatAtomicAmount(quantityStr, divisibility);
    const plain = formatAmount(quantityStr, divisibility, 'plain');
    const trimmed = plain.includes('.') ? plain.replace(/0+$/, '').replace(/\.$/, '') : plain;
    return formatDecimalAmount(trimmed);
}

export function fiatValue(quantityStr, divisibility, fiatRate) {
    if (typeof fiatRate !== 'number' || !isFinite(fiatRate)) return null;
    const amount = decimalFromBaseUnits(safeBigInt(quantityStr), divisibility || 0);
    // String() of a rate under 1e-6 is exponent text ("1e-7"), which the exact
    // multiply reads as not a number and drops the row as unpriced.
    return multiplyDecimalStrings(amount, expandDecimalNotation(fiatRate));
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
    let total = '0';
    let priced = 0;
    let unpriced = 0;
    for (const r of rows || []) {
        const v = fiatValue(r.quantity, r.divisibility, r.fiatRate);
        if (v === null) unpriced += 1;
        else { total = sumDecimalStrings([total, v]); priced += 1; }
    }
    return { total, priced, unpriced };
}

/**
 * Format a fiat value in the user's currency. The rows were USD-only, so a
 * wallet set to euros showed "€0.00 EUR" on the balance card and "$0.00" on
 * every coin row beneath it.
 *
 * @param {string | number | null | undefined} value
 * @param {string} [currency]   ISO code; defaults to USD
 */
export function formatFiat(value, currency = 'USD') {
    return formatFiatAmount(value, currency);
}

function formatRowFiat(row, value, currency) {
    const formatted = formatFiat(value, currency);
    if (!formatted || row?.kind === 'native' || row?.fiatRateSource !== 'market') return formatted;
    return `${formatted} · DEX price`;
}
