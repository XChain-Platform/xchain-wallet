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
import { Button, EmptyState, Icon } from '@xchain-wallet/core/ui';
import { isAssetImageSourceAllowed, tickerColor } from './BalanceList.jsx';
import { useTokenInfo } from '../hooks/useTokenInfo.js';
import buttonStyles from '../../ui/Button.module.css';
import styles from './CollectiblesView.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/balances.js';
import '../../i18n/locales/en/components.js';
import '../../i18n/locales/en/settings.js';

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
 * @param {Set<string> | null} [props.automaticHiddenKeys]
 * @param {(key: string, nextHidden: boolean) => void} [props.onToggleHide]
 * @param {boolean} [props.allowRemoteImages]
 * @param {string | null} [props.selectedKey] `chainId:tick` of the card whose detail shows beside the grid (wide Home, G115)
 * @param {'default' | 'large'} [props.size] `large` is Home's NFTs tab (operator 2026-11-15): big images to browse, two across on a phone and more as the list widens, the name under each
 */
export function CollectiblesView({
    rows,
    demo = false,
    size = 'default',
    emptyTitle = t('home.tabs.noCollectiblesYet'),
    emptyBody = t('components.collectiblesView.collectiblesAppearHereAfterThis'),
    onReceive,
    emptyActionLabel,
    onEmptyAction,
    onSelectToken,
    pinnedKeys,
    onTogglePin,
    hiddenKeys,
    automaticHiddenKeys,
    onToggleHide,
    allowRemoteImages = true,
    selectedKey = null,
}) {
    const [hiddenExpanded, setHiddenExpanded] = useState(false);

    if (!rows || rows.length === 0) {
        // A caller's own empty action (clearing a filter) takes the button
        // over from Receive.
        if (emptyActionLabel && typeof onEmptyAction === 'function') {
            return <EmptyState title={emptyTitle} body={emptyBody} actionLabel={emptyActionLabel} onAction={onEmptyAction} actionIcon={<Icon.RefreshIcon />} />;
        }
        return (
            <EmptyState
                title={emptyTitle}
                body={emptyBody}
                actionLabel={onReceive ? t('home.receive') : undefined}
                onAction={onReceive}
                actionIcon={onReceive ? <Icon.ReceiveIcon /> : undefined}
            />
        );
    }

    const isHidden = (row) => {
        const key = `${row.chainId}:${row.tick}`;
        return Boolean(hiddenKeys?.has(key) || automaticHiddenKeys?.has(key));
    };
    const visible = rows.filter((row) => !isHidden(row));
    const hidden = rows.filter(isHidden);
    const sortedRows = pinnedKeys && pinnedKeys.size > 0
        ? [
            ...visible.filter((r) => pinnedKeys.has(`${r.chainId}:${r.tick}`)),
            ...visible.filter((r) => !pinnedKeys.has(`${r.chainId}:${r.tick}`)),
        ]
        : visible;

    return (
        <div className={styles.wrap} data-size={size === 'large' ? 'large' : undefined}>
            <div className={styles.grid} role="list" aria-label={t('components.collectiblesView.collectibles')}>
                {sortedRows.map((r) => (
                    <CollectibleCard
                        key={`${r.chainId}:${r.tick}`}
                        row={r}
                        demo={demo}
                        large={size === 'large'}
                        pinned={pinnedKeys ? pinnedKeys.has(`${r.chainId}:${r.tick}`) : false}
                        hidden={false}
                        onSelect={onSelectToken}
                        onTogglePin={onTogglePin}
                        onToggleHide={onToggleHide}
                        allowRemoteImages={allowRemoteImages}
                        selected={selectedKey === `${r.chainId}:${r.tick}`}
                    />
                ))}
            </div>
            {hidden.length > 0 ? (
                <Button
                    variant="ghost"
                    size="md"
                    block
                    icon={hiddenExpanded ? <Icon.EyeOffIcon /> : <Icon.EyeIcon />}
                    className={styles.hiddenToggle}
                    onClick={() => setHiddenExpanded((v) => !v)}
                    aria-expanded={hiddenExpanded}
                >
                    {hiddenExpanded
                        ? t('components.collectiblesView.hideHidden', { count: hidden.length })
                        : t('components.collectiblesView.showHidden', { count: hidden.length })}
                </Button>
            ) : null}
            {hidden.length > 0 && hiddenExpanded ? (
                <div className={styles.grid} role="list" aria-label={t('components.collectiblesView.hiddenCollectibles')}>
                    {hidden.map((r) => (
                        <CollectibleCard
                            key={`hidden:${r.chainId}:${r.tick}`}
                            row={r}
                            demo={demo}
                            large={size === 'large'}
                            pinned={pinnedKeys ? pinnedKeys.has(`${r.chainId}:${r.tick}`) : false}
                            hidden
                            onSelect={onSelectToken}
                            onTogglePin={onTogglePin}
                            onToggleHide={automaticHiddenKeys?.has(`${r.chainId}:${r.tick}`)
                                ? undefined
                                : onToggleHide}
                            allowRemoteImages={allowRemoteImages}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function CollectibleCard({ row, demo, large = false, pinned, hidden, onSelect, onTogglePin, onToggleHide, allowRemoteImages, selected = false }) {
    const [failedImageUrl, setFailedImageUrl] = useState(null);
    const [failedChainIconUrl, setFailedChainIconUrl] = useState(null);
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
            data-xc-row-state={clickable ? '' : undefined}
            data-selected={selected ? 'true' : undefined}
        >
            <CardContent
                aria-current={clickable && selected ? 'true' : undefined}
                // The clickable card is a native button on the shared Button
                // base; the ghost look and large size keep it out of the boxed
                // outline rule, and .cardContent lays the card out on top.
                className={clickable
                    ? `${buttonStyles.btn} ${buttonStyles.ghost} ${buttonStyles.lg} ${styles.cardContent}`
                    : styles.cardContent}
                type={clickable ? 'button' : undefined}
                onClick={handleClick}
                aria-label={clickable
                    ? t('components.collectiblesView.openDetails', { value: row.displayName || row.tick })
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
                    {chainIconUrl && failedChainIconUrl !== chainIconUrl ? (
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
                            onError={() => setFailedChainIconUrl(chainIconUrl)}
                        />
                    ) : null}
                </div>
                <div className={styles.meta}>
                    <div className={styles.name} title={row.displayName || row.tick}>{row.displayName || row.tick}</div>
                    {/* The large grid is for browsing images: the name alone sits under each. */}
                    {large ? null : <div className={styles.subtitle}>{row.tick}</div>}
                </div>
            </CardContent>
            {typeof onTogglePin === 'function' ? (
                <Button
                    size="sm"
                    variant={pinned ? 'primary' : 'secondary'}
                    icon={<span aria-hidden="true">{pinned ? '★' : '☆'}</span>}
                    aria-pressed={pinned}
                    aria-label={pinned ? t('balances.unpin', { tick: row.tick }) : t('balances.pin', { tick: row.tick })}
                    title={pinned ? t('balances.unpin2') : t('balances.pinToTop')}
                    onClick={() => onTogglePin(key, !pinned)}
                    className={styles.pinBtn}
                />
            ) : null}
            {typeof onToggleHide === 'function' ? (
                <Button
                    size="sm"
                    variant={hidden ? 'primary' : 'secondary'}
                    icon={<span aria-hidden="true">{hidden ? '⊕' : '⊘'}</span>}
                    aria-pressed={hidden}
                    aria-label={hidden ? t('balances.unhide', { tick: row.tick }) : t('balances.hide', { tick: row.tick })}
                    title={hidden ? t('settings.display.unhide2') : t('settings.developer.hide')}
                    onClick={() => onToggleHide(key, !hidden)}
                    className={styles.hideBtn}
                />
            ) : null}
        </div>
    );
}
