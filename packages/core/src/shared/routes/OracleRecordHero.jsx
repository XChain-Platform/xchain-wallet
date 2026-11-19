// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The oracle record's identity card (G16): an outlined white card with the
// oracle's mark centred (the broadcast glyph with its network badge), its
// name in bold, its address, and one muted line saying what it is. No chart
// and no blue card: the record has no history worth charting (G10, G16).

import { useId, useState } from 'react';
import { Icon } from '@xchain-wallet/core/ui';
import { branding as brandingLib, registry as registryLib } from '@xchain-wallet/core';
import { AddressText } from '../../ui/AddressText.jsx';
import { neutralizeControlText } from '../utils/textHardening.js';
import { sinceMonthText } from './oracleRecordSeries.js';
import local from './OracleRecord.module.css';

const chainRegistry = registryLib.defaultRegistry();

function num(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} props
 * @param {string} props.chainId          the network the record was read from
 * @param {string} props.address          the oracle address
 * @param {string | null} [props.name]    a saved contact name for it, if any
 * @param {any} props.record              the oracle record
 * @param {any[] | null} props.markets    its markets (one page), null while loading
 */
export function OracleRecordHero({ chainId, address, name, record, markets }) {
    const titleId = useId();
    const [pipFailed, setPipFailed] = useState(false);
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const pipUrl = descriptor ? brandingLib.chainIconSmallUrl(descriptor.id) : null;
    const total = num(record?.total_feeds);
    const since = markets ? sinceMonthText(record, markets) : null;

    // G99: an unnamed oracle is titled by its address, whole when it fits,
    // and then needs no second address line.
    const safeName = neutralizeControlText(name, { maxLength: 80 });
    const kind = descriptor?.displayName ? `Prediction market oracle on ${descriptor.displayName}` : 'Prediction market oracle';
    const count = `${total} market${total === 1 ? '' : 's'}${since ? ` since ${since}` : ''}`;

    return (
        <section className={local.identityCard} aria-labelledby={titleId} data-oracle-identity="">
            <span className={local.identityMark} aria-hidden="true">
                <Icon.BroadcastIcon />
                {pipUrl && !pipFailed ? (
                    <img
                        className={local.networkPip}
                        src={pipUrl}
                        width={20}
                        height={20}
                        alt=""
                        decoding="async"
                        onError={() => setPipFailed(true)}
                    />
                ) : null}
            </span>
            <h2 id={titleId} className={local.identityName}>
                {safeName || <AddressText address={String(address || '')} className={local.identityAddressTitle} />}
            </h2>
            {safeName ? (
                <p className={local.identityAddress}><AddressText address={String(address || '')} size="sm" /></p>
            ) : null}
            <p className={local.identityLine}>{kind} · {count}</p>
        </section>
    );
}
