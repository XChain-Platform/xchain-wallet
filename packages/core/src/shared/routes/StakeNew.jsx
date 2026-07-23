// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    PageHeader,
    Icon,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import * as branding from '../../branding/branding.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';
import local from './StakeNew.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Staking is BTC-only at launch per §10.3; both arms stake from a
// Bitcoin-family chain the wallet already has an address on.
const STAKING_COIN = 'bitcoin';

/**
 * New-stake chooser: the staking list's "+" lands here. Two paths:
 *   - Validator staking: stake XCHAIN from one of your addresses to
 *     back a validator. Goes straight to the stake form; when the
 *     wallet has addresses on more than one Bitcoin chain, an inline
 *     network step picks the chain first.
 *   - Contract staking: stake tokens into a contract. Hands off to
 *     the contract browser; picking a contract there leads to its
 *     "Stake here" form.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {(chainId: string) => void} props.onPickValidator
 * @param {() => void} props.onPickContract
 * @param {() => void} props.onBack
 */
export function StakeNew({ walletId, onPickValidator, onPickContract, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const btcChainIds = useMemo(
        () => chainRegistry.byCoin(STAKING_COIN).map((d) => d.id),
        [],
    );

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    // 'options' shows the two cards; 'chain' is the inline network
    // step for the validator arm when >1 Bitcoin chain qualifies.
    const [step, setStep] = useState(/** @type {'options' | 'chain'} */ ('options'));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => { if (!cancelled) setAddressesByChain(byChain || {}); })
            .catch(() => { if (!cancelled) setAddressesByChain({}); });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    const stakingChains = useMemo(() => {
        if (!addressesByChain) return [];
        return btcChainIds.filter((cid) =>
            Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0,
        );
    }, [btcChainIds, addressesByChain]);

    const header = (
        <PageHeader
            onBack={step === 'chain' ? () => setStep('options') : onBack}
            backLabel={step === 'chain' ? 'Back' : 'Back to staking'}
            titleIcon={<Icon.StakeIcon />}
            title="New stake"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <div className={isFull ? local.wrapFull : local.wrapPopup}>
                {children}
            </div>
        </Screen>
    );

    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>Loading…</p>);
    }

    if (step === 'chain') {
        return wrap(
            <>
                <p className={local.lede}>Choose the network to stake on.</p>
                <div className={local.chainList}>
                    {stakingChains.map((cid) => {
                        const d = chainRegistry.get(cid);
                        const iconUrl = branding.chainIconSmallUrl(cid);
                        return (
                            <button
                                key={cid}
                                type="button"
                                className={local.chainBtn}
                                onClick={() => onPickValidator(cid)}
                            >
                                {iconUrl ? (
                                    <img src={iconUrl} alt="" aria-hidden="true" className={local.chainIcon} />
                                ) : null}
                                <span>{d?.displayName || cid}</span>
                            </button>
                        );
                    })}
                </div>
            </>,
        );
    }

    const noStakingChain = stakingChains.length === 0;

    return wrap(
        <>
            <p className={local.lede}>What would you like to stake?</p>
            {noStakingChain ? (
                <p className={styles.entryDescription}>
                    Staking is available on Bitcoin only at launch. Use Receive
                    on a Bitcoin network to generate an address first.
                </p>
            ) : null}
            <div className={local.options}>
                <button
                    type="button"
                    className={local.option}
                    disabled={noStakingChain}
                    onClick={() => {
                        if (stakingChains.length === 1) onPickValidator(stakingChains[0]);
                        else setStep('chain');
                    }}
                >
                    <span className={local.optionIcon} aria-hidden="true"><Icon.StakeIcon /></span>
                    <span className={local.optionBody}>
                        <span className={local.optionTitle}>Validator staking</span>
                        <span className={local.optionDesc}>
                            Stake XCHAIN to help secure the network and earn rewards.
                        </span>
                    </span>
                </button>
                <button
                    type="button"
                    className={local.option}
                    disabled={noStakingChain}
                    onClick={() => onPickContract()}
                >
                    <span className={local.optionIcon} aria-hidden="true"><Icon.ContractIcon /></span>
                    <span className={local.optionBody}>
                        <span className={local.optionTitle}>Contract staking</span>
                        <span className={local.optionDesc}>
                            Stake tokens into a contract. You'll pick the contract next.
                        </span>
                    </span>
                </button>
            </div>
        </>,
    );
}
