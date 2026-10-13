// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import * as branding from '@xchain-wallet/core/branding/branding.js';
import { EmptyState, Icon } from '@xchain-wallet/core/ui';
import { isAssetImageSourceAllowed, tickerColor } from './BalanceList.jsx';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import styles from './CollectiblesView.module.css';

/**
 * §27.5 / G074: Collectibles view. Renders an NFT-shaped grid (large
 * square thumbnails) instead of the row layout used for fungible
 * balances. Each card shows the tick image when one is available and
 * falls back to a colored ticker-letter placeholder; tapping a card
 * surfaces the §27.6 token detail page via `onSelectToken` (the same
 * payload `<BalanceList>` emits, so the consuming router doesn't change).
 *
 * Image URLs come from two paths: row-payload `imageUrl` (when the
 * caller already has one) takes precedence, and `<CollectibleCard>`
 * falls back to fetching `messaging.getTokenInfo` per-card via the
 * shared `useTokenInfo` hook (Cluster I FOLLOWUP 3 / Cluster C
 * FOLLOWUP 3). The hook's module-level cache means revisits don't
 * re-fetch, and a missing / failing image leaves the ticker-letter
 * placeholder in place.
 *
 * @param {object} props
 * @param {Array<{chainId: string, tick: string, displayName: string, divisibility: number, fiatRate: number | null, quantity: string, imageUrl?: string | null}>} props.rows
 * @param {boolean} [props.demo]
 * @param {string} [props.emptyTitle]
 * @param {string} [props.emptyBody]
 * @param {() => void} [props.onReceive]
 * @param {(token: object) => void} [props.onSelectToken]
 * @param {Set<string> | null} [props.pinnedKeys]
 * @param {(key: string, nextPinned: boolean) => void} [props.onTogglePin]
 * @param {Set<string> | null} [props.hiddenKeys]
 * @param {(key: string, nextHidden: boolean) => void} [props.onToggleHide]
 * @param {boolean} [props.allowRemoteImages]
 */
export function CollectiblesView({
    rows,
    demo = false,
    emptyTitle = 'No collectibles yet',
    emptyBody = 'Collectibles appear here after this wallet receives them.',
    onReceive,
    onSelectToken,
    pinnedKeys,
    onTogglePin,
    hiddenKeys,
    onToggleHide,
    allowRemoteImages = true,
}) {
    const [hiddenExpanded, setHiddenExpanded] = useState(false);

    if (!rows || rows.length === 0) {
        return (
            <EmptyState
                title={emptyTitle}
                body={emptyBody}
                actionLabel={onReceive ? 'Receive' : undefined}
                onAction={onReceive}
                actionIcon={onReceive ? <Icon.ReceiveIcon /> : undefined}
            />
        );
    }

    const visible = hiddenKeys
        ? rows.filter((r) => !hiddenKeys.has(`${r.chainId}:${r.tick}`))
        : rows;
    const hidden = hiddenKeys
        ? rows.filter((r) => hiddenKeys.has(`${r.chainId}:${r.tick}`))
        : [];
    const sortedRows = pinnedKeys && pinnedKeys.size > 0
        ? [
            ...visible.filter((r) => pinnedKeys.has(`${r.chainId}:${r.tick}`)),
            ...visible.filter((r) => !pinnedKeys.has(`${r.chainId}:${r.tick}`)),
        ]
        : visible;

    return (
        <div className={styles.wrap}>
            <div className={styles.grid} role="list" aria-label="Collectibles">
                {sortedRows.map((r) => (
                    <CollectibleCard
                        key={`${r.chainId}:${r.tick}`}
                        row={r}
                        demo={demo}
                        pinned={pinnedKeys ? pinnedKeys.has(`${r.chainId}:${r.tick}`) : false}
                        hidden={false}
                        onSelect={onSelectToken}
                        onTogglePin={onTogglePin}
                        onToggleHide={onToggleHide}
                        allowRemoteImages={allowRemoteImages}
                    />
                ))}
            </div>
            {hidden.length > 0 ? (
                <button
                    type="button"
                    className={styles.hiddenToggle}
                    onClick={() => setHiddenExpanded((v) => !v)}
                    aria-expanded={hiddenExpanded}
                >
                    {hiddenExpanded
                        ? `Hide ${hidden.length} hidden collectible${hidden.length === 1 ? '' : 's'}`
                        : `Show ${hidden.length} hidden collectible${hidden.length === 1 ? '' : 's'}`}
                </button>
            ) : null}
            {hidden.length > 0 && hiddenExpanded ? (
                <div className={styles.grid} role="list" aria-label="Hidden collectibles">
                    {hidden.map((r) => (
                        <CollectibleCard
                            key={`hidden:${r.chainId}:${r.tick}`}
                            row={r}
                            demo={demo}
                            pinned={pinnedKeys ? pinnedKeys.has(`${r.chainId}:${r.tick}`) : false}
                            hidden
                            onSelect={onSelectToken}
                            onTogglePin={onTogglePin}
                            onToggleHide={onToggleHide}
                            allowRemoteImages={allowRemoteImages}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function CollectibleCard({ row, demo, pinned, hidden, onSelect, onTogglePin, onToggleHide, allowRemoteImages }) {
    const [failedImageUrl, setFailedImageUrl] = useState(null);
    const chainIconUrl = branding.chainIconSmallUrl(row.chainId);
    // Fetch tick metadata to surface a real image when the row payload
    // doesn't already carry one. `useTokenInfo`'s module-level cache means
    // revisits don't re-fetch, and silent failure leaves the ticker-letter
    // placeholder in place.
    const assetInfo = useTokenInfo({
        chainId: row.chainId,
        tick: row.tick,
        skip: row.kind === 'native' || hidden || !allowRemoteImages,
        demo,
    });
    const fallbackImageUrl = assetInfo && typeof assetInfo.imageUrl === 'string'
        && assetInfo.imageUrl.length > 0
        ? assetInfo.imageUrl
        : null;
    const candidateImageUrl = (typeof row.imageUrl === 'string' && row.imageUrl.length > 0)
        ? row.imageUrl
        : fallbackImageUrl;
    const effectiveImageUrl = isAssetImageSourceAllowed(candidateImageUrl, allowRemoteImages)
        ? candidateImageUrl
        : null;
    const showImage = typeof effectiveImageUrl === 'string'
        && effectiveImageUrl.length > 0
        && failedImageUrl !== effectiveImageUrl;
    const clickable = typeof onSelect === 'function';
    const handleClick = clickable
        ? () => onSelect({
            chainId: row.chainId,
            tick: row.tick,
            kind: row.kind,
            displayName: row.displayName,
            divisibility: row.divisibility,
            fiatRate: row.fiatRate,
            fiatRateSource: row.fiatRateSource,
            quantity: row.quantity,
            imageUrl: effectiveImageUrl,
        })
        : undefined;
    const key = `${row.chainId}:${row.tick}`;
    const CardContent = clickable ? 'button' : 'div';
    return (
        <div
            className={`${styles.card} ${clickable ? styles.cardClickable : ''} ${pinned ? styles.cardPinned : ''} ${hidden ? styles.cardHidden : ''}`}
            role="listitem"
        >
            <CardContent
                className={styles.cardContent}
                type={clickable ? 'button' : undefined}
                onClick={handleClick}
                aria-label={clickable
                    ? `Open ${row.displayName || row.tick} details`
                    : undefined}
            >
                <div className={styles.thumb}>
                    <span
                        className={styles.thumbLetter}
                        style={{ background: tickerColor(row.tick) }}
                        aria-hidden="true"
                    >
                        {row.tick.slice(0, 2)}
                    </span>
                    {showImage ? (
                        <img
                            src={effectiveImageUrl}
                            width={192}
                            height={192}
                            alt=""
                            aria-hidden="true"
                            className={styles.thumbImg}
                            loading="lazy"
                            decoding="async"
                            style={{ position: 'absolute', inset: 0 }}
                            onError={() => setFailedImageUrl(effectiveImageUrl)}
                        />
                    ) : null}
                    {chainIconUrl ? (
                        <img
                            src={chainIconUrl}
                            width={20}
                            height={20}
                            alt=""
                            aria-hidden="true"
                            title={row.chainDisplayName}
                            className={styles.chainOverlay}
                            loading="lazy"
                            decoding="async"
                        />
                    ) : null}
                </div>
                <div className={styles.meta}>
                    <div className={styles.name} title={row.displayName}>{row.displayName}</div>
                    <div className={styles.subtitle}>{row.tick}</div>
                </div>
            </CardContent>
            {typeof onTogglePin === 'function' ? (
                <button
                    type="button"
                    className={`${styles.pinBtn} ${pinned ? styles.pinBtnActive : ''}`}
                    aria-pressed={pinned}
                    aria-label={pinned ? `Unpin ${row.tick}` : `Pin ${row.tick}`}
                    onClick={() => onTogglePin(key, !pinned)}
                >
                    {pinned ? '★' : '☆'}
                </button>
            ) : null}
            {typeof onToggleHide === 'function' ? (
                <button
                    type="button"
                    className={`${styles.hideBtn} ${hidden ? styles.hideBtnActive : ''}`}
                    aria-pressed={hidden}
                    aria-label={hidden ? `Unhide ${row.tick}` : `Hide ${row.tick}`}
                    onClick={() => onToggleHide(key, !hidden)}
                >
                    {hidden ? '⊕' : '⊘'}
                </button>
            ) : null}
        </div>
    );
}
