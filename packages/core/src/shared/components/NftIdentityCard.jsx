// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An NFT's identity card (G16) for wide Home's detail panel (G115): an NFT
// has no price history, so instead of the blue chart card it opens with an
// outlined white card holding its art, its name in bold, the ticker and
// network muted, and how many of the supply this wallet holds.

import { useState } from 'react';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import { safeImageSrc } from '../utils/externalUrl.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/home.js';
import styles from './NftIdentityCard.module.css';

/**
 * The NFT's own art: a published image that is not its small icon (a card
 * or artwork image), when the token info carries one.
 *
 * @param {any} assetInfo
 * @returns {string | null}
 */
export function nftArtUrl(assetInfo) {
    const images = Array.isArray(assetInfo?.images) ? assetInfo.images : [];
    const art = images.find((i) => safeImageSrc(i?.url) && String(i?.type || '').toLowerCase() !== 'icon');
    return art ? art.url : null;
}

function wholeUnits(value) {
    try {
        return BigInt(String(value ?? '').trim()).toLocaleString('en-US');
    } catch {
        return null;
    }
}

/**
 * @param {object} props
 * @param {string} props.name
 * @param {string} props.tick
 * @param {string} props.chainName       the network it lives on, as a word ("Bitcoin")
 * @param {string | null} [props.artUrl]
 * @param {string | null} [props.quantity]  whole units held (an NFT has no decimals)
 * @param {string | number | null} [props.supply]
 * @param {number | string | null} [props.fiat]  what the holding is worth, if priced
 * @param {string} [props.fiatCurrency]
 * @param {boolean} [props.fiatFromSale]  the price is the DEX's last sale
 * @param {boolean} [props.hidden]        the wallet's privacy toggle hides amounts
 */
export function NftIdentityCard({ name, tick, chainName, artUrl = null, quantity = null, supply = null, fiat = null, fiatCurrency = 'USD', fiatFromSale = false, hidden = false }) {
    const [failedUrl, setFailedUrl] = useState(null);
    const src = safeImageSrc(artUrl);
    const showArt = Boolean(src) && failedUrl !== src;
    const held = wholeUnits(quantity);
    const total = wholeUnits(supply);
    const fiatText = fiat == null ? '' : formatFiatAmount(Number(fiat), fiatCurrency);
    let holding = '';
    if (!hidden && held) {
        holding = total
            ? t('home.wide.nft.holdOf', { held, total })
            : t('home.wide.nft.hold', { held });
        if (fiatText) {
            holding = `${holding} ${fiatFromSale
                ? t('home.wide.nft.worthLastSale', { value: fiatText })
                : t('home.wide.nft.worth', { value: fiatText })}`;
        }
    }
    return (
        <section className={styles.card} aria-label={name} data-nft-identity="">
            <span className={styles.art}>
                {showArt ? (
                    <img src={src} alt="" className={styles.artImg} onError={() => setFailedUrl(src)} />
                ) : (
                    <span className={styles.artFallback} aria-hidden="true">{String(tick || '').slice(0, 2)}</span>
                )}
            </span>
            <span className={styles.name}>{name}</span>
            <span className={styles.typeLine}>{t('home.wide.nft.typeLine', { tick, chain: chainName })}</span>
            {holding ? <span className={styles.holding}>{holding}</span> : null}
        </section>
    );
}
