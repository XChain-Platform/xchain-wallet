// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoSignerProvision (§22, P4 passive co-signer, management UI).
//
// Bespoke wizard to create an agent account: the wallet becomes the automated
// policy co-signer (daemon half) of a 2-of-2 MuSig2 account. The user picks a
// BTC network + one of their own addresses to be the daemon key, pastes the
// agent's public key, names the account, and authors the spending policy. On
// submit, provisionCoSignerAccount derives the aggregate P2TR address through
// the SDK and persists a CoSignerAccount; the wizard then shows the address
// to fund.
//
// No unlock is needed here: both pubkeys are public. The daemon private key is
// only derived transiently at co-sign time (see passiveCoSignForAccount).
//
// MuSig2 is BTC-only at launch (§22 + §10.3), matching the multisig routes.

import { useEffect, useMemo, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    Select,
    ChainPicker,
    ChainBadge,
    CopyButton,
    AddressText,
    StatusMessage,
} from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import {
    CoSignerPolicyEditor,
    emptyPolicyDraft,
    buildPolicyDraft,
} from './CoSignerPolicyEditor.jsx';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();

// MuSig2 agent accounts are BTC-only at launch, mirroring MultisigCreate.
const COSIGNER_COIN = 'bitcoin';

// A compressed secp256k1 pubkey is 33 bytes = 66 hex chars.
const PUBKEY_RE = /^[0-9a-fA-F]{66}$/;

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {(accountId: string) => void} [props.onDone]   navigate to detail after create
 */
export function CoSignerProvision({ walletId, onBack, onDone }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(/** @type {Record<string, any[]> | null} */ (null));
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const btcChainIds = useMemo(() => chainRegistry.byCoin(COSIGNER_COIN).map((d) => d.id), []);
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));

    const [daemonAddressId, setDaemonAddressId] = useState('');
    const [agentPubkey, setAgentPubkey] = useState('');
    const [name, setName] = useState('Agent account');
    const [policyDraft, setPolicyDraft] = useState(emptyPolicyDraft());

    const [stage, setStage] = useState(/** @type {'compose' | 'submitting' | 'done'} */ ('compose'));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain || {});
                const btcWithAddresses = btcChainIds.find(
                    (cid) => Array.isArray(byChain?.[cid]) && byChain[cid].length > 0,
                );
                if (!btcWithAddresses) {
                    setLoadError(
                        'Agent accounts are Bitcoin-only at launch. Use Receive on a BTC network to generate an address first.',
                    );
                    return;
                }
                setChainId(btcWithAddresses);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load wallet addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, btcChainIds, messaging]);

    // Reset the picked daemon address when the chain changes (the address
    // belongs to a specific chain).
    useEffect(() => { setDaemonAddressId(''); }, [chainId]);

    const chainAddresses = (chainId && addressesByChain?.[chainId]) || [];
    const daemonAddress = chainAddresses.find((a) => a.id === daemonAddressId) || null;

    const composeError = useMemo(() => {
        if (!chainId) return 'Pick a Bitcoin network.';
        if (!daemonAddress) return 'Pick one of your addresses to be this wallet\'s key.';
        if (!daemonAddress.publicKey) return 'The selected address has no public key on record.';
        if (!PUBKEY_RE.test(agentPubkey.trim())) return 'Enter the agent public key as 66 hex characters (33-byte compressed).';
        if (agentPubkey.trim().toLowerCase() === String(daemonAddress.publicKey).toLowerCase()) {
            return 'The agent key must differ from this wallet\'s key.';
        }
        const built = buildPolicyDraft(policyDraft);
        if (built.error) return built.error;
        return null;
    }, [chainId, daemonAddress, agentPubkey, policyDraft]);

    async function handleSubmit() {
        if (composeError || !chainId || !daemonAddress) return;
        const built = buildPolicyDraft(policyDraft);
        if (built.error) { setSubmitError(built.error); return; }

        setStage('submitting');
        setSubmitError(null);
        try {
            const r = await messaging.provisionCoSignerAccount({
                walletId,
                chainId,
                agentPubkey: agentPubkey.trim().toLowerCase(),
                daemonPubkey: String(daemonAddress.publicKey).toLowerCase(),
                daemonDerivationPath: daemonAddress.derivationPath,
                policy: built.policy,
                allowedOutputs: built.allowedOutputs,
                name: name.trim() || 'Agent account',
            });
            setResult(r);
            setStage('done');
        } catch (err) {
            setSubmitError(err?.message || 'Failed to create the agent account.');
            setStage('compose');
        }
    }

    const header = <PageHeader onBack={onBack} title="New agent account" />;
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<StatusMessage variant="error">{loadError}</StatusMessage>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading wallet…</p>);
    }

    if (stage === 'done') {
        const account = result;
        return wrap(
            <>
                <p className={styles.successTitle}>Agent account created</p>
                <p className={styles.hint}>
                    Fund this address to give the agent a balance to operate on. The
                    agent and this wallet must both sign every spend; this wallet
                    signs automatically when a request satisfies the policy, and asks
                    you to approve each one.
                </p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Name</dt>
                    <dd className={styles.detailsValue}>{account?.name}</dd>
                    <dt className={styles.detailsLabel}>Fund this address</dt>
                    <dd className={styles.detailsValue} style={{ display: 'flex', gap: 'var(--xc-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <AddressText address={account?.aggregateAddress} />
                        <CopyButton value={account?.aggregateAddress || ''} label="Copy address" />
                    </dd>
                </dl>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={() => (onDone ? onDone(account?.id) : onBack())}>
                        {onDone ? 'View account' : 'Done'}
                    </Button>
                </div>
            </>,
        );
    }

    const descriptor = chainRegistry.get(chainId);

    return wrap(
        <>
            <p className={styles.hint} style={{ textAlign: 'left' }}>
                An agent account is a 2-of-2 shared address between an automated
                agent and this wallet. This wallet acts as the policy co-signer:
                it signs a request automatically when it fits the rules you set
                below, and refuses anything out of policy. Bitcoin-only at launch.
            </p>

            <ChainPicker
                label="Network"
                value={chainId}
                onChange={setChainId}
                chainIds={btcChainIds.filter((cid) => Array.isArray(addressesByChain[cid]) && addressesByChain[cid].length > 0)}
                chainRegistry={chainRegistry}
            />

            <Select
                label="This wallet's key"
                value={daemonAddressId}
                onChange={(e) => setDaemonAddressId(e.target.value)}
                hint="One of your addresses on this network. Its public key becomes this wallet's half of the pair."
            >
                <option value="">Select address</option>
                {chainAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                        {a.address}{a.label ? ` · ${a.label}` : ''}
                    </option>
                ))}
            </Select>

            <Input
                label="Agent public key (hex, 33-byte compressed)"
                value={agentPubkey}
                onChange={(e) => setAgentPubkey(e.target.value.trim())}
                placeholder="02abcdef…"
            />

            <Input
                label="Account name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent account"
            />

            <CoSignerPolicyEditor value={policyDraft} onChange={setPolicyDraft} />

            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Network</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                </dd>
            </dl>

            {submitError ? <StatusMessage variant="error">{submitError}</StatusMessage> : null}

            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="primary"
                    onClick={handleSubmit}
                    disabled={Boolean(composeError) || stage === 'submitting'}
                    loading={stage === 'submitting'}
                >
                    Create agent account
                </Button>
                {composeError ? <p className={styles.hint} style={{ marginTop: 'var(--xc-space-2)' }}>{composeError}</p> : null}
            </div>
        </>,
    );
}
