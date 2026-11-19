// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The contract's identity card (G16, screen walk 2026-11-14, layout 3): an
// outlined white card with the contract mark centred (its network badge in
// the corner), the name and version, the address with copy, and What It Does
// as one muted line; under a divider, what the contract holds, then who
// published it, at which block, and how many calls it has had. No chart: the
// old blue card's line counted calls from one history page only (G10, G12).

import { useId, useState } from 'react';
import { CopyButton, Icon } from '@xchain-wallet/core/ui';
import { branding as brandingLib, registry as registryLib } from '@xchain-wallet/core';
import { AddressText } from '../../ui/AddressText.jsx';
import { formatWithThousands, trimAmountTail } from '../utils/amountFormat.js';
import { protocolCoinTickerFor } from '../../registry/nativeFee.js';
// The identity card's frame, mark, badge and lines are the oracle record's,
// so the two G16 cards match.
import identity from './OracleRecord.module.css';
import local from './ContractDetail.module.css';

const chainRegistry = registryLib.defaultRegistry();

function amountText(quantity) {
    const q = String(quantity ?? '');
    if (!/^-?\d+(\.\d+)?$/.test(q)) return q || '?';
    return formatWithThousands(trimAmountTail(q) || '0');
}

function blockText(block) {
    // A block number is an identifier: shown raw, never grouped (G123).
    return String(block ?? '?');
}

/**
 * "Holds 0.015 BTC and 1,250 XCHAIN", the chain's own coin first; past two
 * tokens the rest are counted.
 *
 * @param {Array<{ tick: string, quantity: any }>} rows
 * @param {string} coin
 */
function holdingsLine(rows, coin) {
    if (rows.length === 0) return 'Holds no tokens';
    const lead = rows.find((r) => String(r.tick).toUpperCase() === coin) || rows[0];
    const ordered = [lead, ...rows.filter((r) => r !== lead)];
    const parts = ordered.map((r) => `${amountText(r.quantity)} ${r.tick}`);
    if (parts.length === 1) return `Holds ${parts[0]}`;
    if (parts.length === 2) return `Holds ${parts[0]} and ${parts[1]}`;
    return `Holds ${parts[0]}, ${parts[1]} and ${parts.length - 2} more`;
}

/**
 * @param {object} props
 * @param {string} props.name                 the chain-recorded name and version, or "Unnamed contract"
 * @param {string} props.headingRest          the rest of the display label (" (C:BTC:42)"), read by screen readers
 * @param {string | null} props.contractAddress
 * @param {string} props.chainId
 * @param {string | null} props.owner
 * @param {boolean} props.isOwner
 * @param {string | number} props.deployBlock
 * @param {string} props.about               What It Does, in the publisher's words or built from its functions
 * @param {Array<{ tick: string, quantity: any }> | null} props.holdings  null while loading
 * @param {boolean} [props.holdingsError]   the balance read failed; the Details tab says why
 * @param {number | null} props.callsTotal   the explorer's total, or the loaded count when it gives none; null while loading
 */
export function ContractHero({
    name,
    headingRest,
    contractAddress,
    chainId,
    owner,
    isOwner,
    deployBlock,
    about,
    holdings,
    holdingsError = false,
    callsTotal,
}) {
    const titleId = useId();
    const [pipFailed, setPipFailed] = useState(false);
    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const pipUrl = descriptor ? brandingLib.chainIconSmallUrl(descriptor.id) : null;

    const coin = protocolCoinTickerFor(chainId);
    const holdingsText = holdingsError
        ? 'Holdings unavailable'
        : holdings == null ? 'Loading holdings…' : holdingsLine(holdings, coin);
    const callsText = callsTotal == null
        ? null
        : `${formatWithThousands(String(callsTotal))} call${callsTotal === 1 ? '' : 's'}`;

    return (
        <section className={identity.identityCard} aria-labelledby={titleId} data-contract-identity="">
            <span className={identity.identityMark} aria-hidden="true">
                <Icon.ContractIcon />
                {pipUrl && !pipFailed ? (
                    <img
                        className={identity.networkPip}
                        src={pipUrl}
                        width={20}
                        height={20}
                        alt=""
                        decoding="async"
                        onError={() => setPipFailed(true)}
                    />
                ) : null}
            </span>
            <h2 id={titleId} className={identity.identityName} style={{ overflowWrap: 'anywhere' }}>
                {name}
                {headingRest ? <span className="sr-only">{headingRest}</span> : null}
            </h2>
            {contractAddress ? (
                <p className={`${identity.identityAddress} ${local.identityAddressRow}`}>
                    <AddressText address={contractAddress} size="sm" className={local.identityMono} />
                    <span className={local.heroCopy}>
                        <CopyButton value={contractAddress} label="Copy Contract Address" iconOnly />
                    </span>
                </p>
            ) : null}
            {about ? <p className={identity.identityLine} data-contract-about="">{about}</p> : null}
            <div className={local.identityFoot}>
                <p className={local.identityHoldings}>{holdingsText}</p>
                <p className={`${identity.identityLine} ${local.identityPublished}`}>
                    {owner ? (
                        <>
                            <span>Published by</span>
                            {isOwner
                                ? <span>you,</span>
                                : <><AddressText address={String(owner)} size="sm" className={local.identityOwner} /><span aria-hidden="true">,</span></>}
                        </>
                    ) : <span>Publisher unknown,</span>}
                    <span>block {blockText(deployBlock)}</span>
                    {callsText ? (
                        <>
                            <span aria-hidden="true">·</span>
                            <span data-contract-calls="">{callsText}</span>
                        </>
                    ) : null}
                </p>
            </div>
        </section>
    );
}
