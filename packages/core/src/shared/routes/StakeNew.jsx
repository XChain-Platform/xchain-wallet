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
    ListPage,
    Screen,
    PageHeader,
    Icon,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { NetworkOptionList } from '../../ui/NetworkPicker.jsx';
import { t } from '../../i18n/index.js';
import { readFailureMessage } from '../utils/readFailureMessage.js';
import '../../i18n/locales/en/stakeNew.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';
import local from './StakeNew.module.css';

const chainRegistry = registryLib.defaultRegistry();

// Gate both arms on a Bitcoin address as a wallet launch policy; the indexer
// refuses only the validator arm off Bitcoin, and contract staking is chain-open.
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

    const btcChainIds = useMemo(
        () => chainRegistry.byCoin(STAKING_COIN).map((d) => d.id),
        [],
    );

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
    const [reload, setReload] = useState(0);
    // 'options' shows the two cards; 'chain' is the inline network
    // step for the validator arm when >1 Bitcoin chain qualifies.
    const [step, setStep] = useState(/** @type {'options' | 'chain'} */ ('options'));

    useEffect(() => {
        let cancelled = false;
        setAddressesByChain(null);
        setLoadError(null);
        messaging.getAddressesByChain(walletId)
            .then((byChain) => { if (!cancelled) setAddressesByChain(byChain || {}); })
            .catch((err) => {
                if (cancelled) return;
                setLoadError(readFailureMessage(err, 'load your staking networks'));
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, reload]);

    const stakingChains = useMemo(() => {
        if (!addressesByChain) return [];
        return btcChainIds.filter((cid) =>
            Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0,
        );
    }, [btcChainIds, addressesByChain]);

    const header = (
        <PageHeader
            nested={step === 'chain'}
            onBack={step === 'chain' ? () => setStep('options') : onBack}
            backLabel={step === 'chain' ? t('common.back') : t('stakeNew.backToStaking')}
            title={t('stakeNew.title')}
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            <ListPage>
                {children}
            </ListPage>
        </Screen>
    );

    if (loadError) {
        return wrap(
            <StatusMessage
                variant="error"
                recovery={{ label: t('common.tryAgain'), onAction: () => setReload((value) => value + 1) }}
            >
                {loadError}
            </StatusMessage>,
        );
    }

    if (!addressesByChain) {
        return wrap(<p className={styles.entryDescription}>{t('common.loading')}</p>);
    }

    if (step === 'chain') {
        return wrap(
            <>
                <p className={local.lede}>{t('stakeNew.chooseNetwork')}</p>
                {/* The standard network rows, drawn like token rows: icon,
                    name, ticker and network kind, right chevron (operator
                    ruling 2026-11-13). */}
                <NetworkOptionList
                    chainIds={stakingChains}
                    chainRegistry={chainRegistry}
                    onSelect={onPickValidator}
                />
            </>,
        );
    }

    const noStakingChain = stakingChains.length === 0;

    return wrap(
        <>
            {noStakingChain ? (
                <p className={styles.entryDescription}>
                    {t('stakeNew.bitcoinOnly')}
                </p>
            ) : null}
            {/* The shared action list (G101): bare icon, title, description, right chevron. */}
            <ActionList label={t('stakeNew.title')}>
                <ActionListItem
                    disabled={noStakingChain}
                    onClick={() => {
                        if (stakingChains.length === 1) onPickValidator(stakingChains[0]);
                        else setStep('chain');
                    }}
                    icon={<Icon.StakeIcon />}
                    title={t('stakeNew.validatorTitle')}
                    description={t('stakeNew.validatorDescription')}
                />
                <ActionListItem
                    disabled={noStakingChain}
                    onClick={() => onPickContract()}
                    icon={<Icon.ContractIcon />}
                    title={t('stakeNew.contractTitle')}
                    description={t('stakeNew.contractDescription')}
                />
            </ActionList>
        </>,
    );
}
