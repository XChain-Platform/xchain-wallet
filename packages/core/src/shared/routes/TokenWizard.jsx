// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    PageHeader,
    Button,
    Input,
    ChainBadge,
    AddressText,
 NetworkField,  Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    flows as flowsLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useActionConfirmFlow, isUserRejection } from '../hooks/useActionConfirmFlow.js';
import { ActionConfirmScreen } from '../components/ActionConfirmScreen.jsx';
import { useSignerReady } from '../hooks/useSignerReady.js';
import { ListPickerScreen } from '../components/ListPickerScreen.jsx';
import { blockDateEstimateText } from '../utils/blockDateEstimate.js';
import {
    LOCK_FLAGS,
    applyAdvancedIssueFields,
    validateAdvancedIssueFields,
    advancedIssueWarnings,
} from '../utils/issueAdvancedFields.js';
import { NativeFeeToggle } from '../components/NativeFeeToggle.jsx';
import { NATIVE_FEE_WARNING } from '../../sdk/nativeFeePreflight.js';
import styles from './TokenWizard.module.css';
import { useNativeFee } from '../hooks/useNativeFee.js';

const chainRegistry = registryLib.defaultRegistry();

// Native coin ticker per protocol coin (label for the native-fee toggle).
const PROTOCOL_COIN_TICKER = { bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE' };

/**
 * Token Creation Wizard (§40.1).
 *
 * Five-stage flow: template → chain → details → preview → sign.
 *
 *   template:  pick one of six templates (§40.1). Step 4 ships the
 *              Custom template as fully interactive; the other five
 *              are visible as cards but their dedicated detail forms
 *              land in Phase-2 Step 6 (piece 2d).
 *   chain:     pick the chain to create the token on. Filtered to
 *              chains the wallet already has an address on (needs a
 *              fee-paying address). Auto-picks the newest external
 *              HD address on that chain.
 *   details:   template-specific fields. Custom exposes all ISSUE v0
 *              fields (ticker, supply, max-mint, decimals, description,
 *              lock flags, transfer-ownership).
 *   preview:   plain-English summary from `decoder.decodeAction` for
 *              the composed ISSUE params.
 *   sign:      TODO: `messaging.issueToken` lands in Step 5 (piece
 *              2c). Today the sign button surfaces the "not yet
 *              wired" error through the shared submit path.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 */
export function TokenWizard({ walletId, onBack }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [stage, setStage] = useState(
        /** @type {'template' | 'chain' | 'details' | 'preview' | 'sign' | 'done' | 'error'} */ ('template'),
    );
    const [template, setTemplate] = useState(
        /** @type {null | 'meme' | 'utility' | 'collectible' | 'edition' | 'community' | 'subtoken' | 'custom'} */ (null),
    );
    const [chainId, setChainId] = useState(/** @type {string | null} */ (null));
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    // Details form state (some fields are only visible for certain
    // templates (see renderDetailsStage). Keeping all state here so
    // the user can flip between templates without re-typing.
    const [name, setName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [supply, setSupply] = useState('');
    const [divisible, setDivisible] = useState(false);
    const [description, setDescription] = useState('');
    const [maxMint, setMaxMint] = useState('');
    const [lockOnCreate, setLockOnCreate] = useState(false);
    const [transferTo, setTransferTo] = useState('');
    const [imageUrl, setImageUrl] = useState('');         // collectible + edition
    const [parentToken, setParentToken] = useState('');   // subtoken only
    // Edition-only public-mint window fields.
    const [perAddressMax, setPerAddressMax] = useState('');
    const [mintStartBlock, setMintStartBlock] = useState('');
    const [mintStopBlock, setMintStopBlock] = useState('');
    // PC-06: the Custom template's advanced disclosure. These are the
    // ISSUE v0 fields that used to be reachable only as post-create
    // admin edits (PC-02 locks / PC-03 callback / PC-04 access lists),
    // so a fair-mint token can be fully configured in one transaction.
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [lockChecks, setLockChecks] = useState(
        /** @type {Record<string, boolean>} */ ({}),
    );
    const [callbackTick, setCallbackTick] = useState('');
    const [callbackAmount, setCallbackAmount] = useState('');
    const [callbackBlock, setCallbackBlock] = useState('');
    const [allowListIdx, setAllowListIdx] = useState(/** @type {string | null} */ (null));
    const [blockListIdx, setBlockListIdx] = useState(/** @type {string | null} */ (null));
    const [allowListCount, setAllowListCount] = useState(/** @type {number | null} */ (null));
    const [blockListCount, setBlockListCount] = useState(/** @type {number | null} */ (null));
    const [listPickerFor, setListPickerFor] = useState(
        /** @type {'allow' | 'block' | null} */ (null),
    );
    const [currentHeight, setCurrentHeight] = useState(/** @type {number | null} */ (null));
    // Divisibility of the CALLBACK token. `null` means "not proven",
    // which the validator treats as indivisible - see
    // issueAdvancedFields.js for why that is the safe direction.
    const [callbackTickDecimals, setCallbackTickDecimals] = useState(
        /** @type {number | null} */ (null),
    );
    const { payFeeInNativeCoin, setPayFeeInNativeCoin } = useNativeFee();

    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before creating a token.',
                    );
                    return;
                }
                setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Auto-pick the highest external HD address on the current chain.
    useEffect(() => {
        if (!chainId || !addressesByChain) return;
        const addrs = (addressesByChain[chainId] || []).filter(
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        } else {
            setFromAddressId(null);
        }
    }, [chainId, addressesByChain]);

    useEffect(() => {
        if (stage === 'preview') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // PC-06: chain tip, for the callback block's future-block rail and
    // its date estimate. Only fetched once the advanced panel is open.
    useEffect(() => {
        if (!showAdvanced || !chainId) return undefined;
        if (flowsLib.isDemoWallet(walletId)) return undefined;
        if (typeof messaging?.getIndexerWatermark !== 'function') return undefined;
        let cancelled = false;
        messaging.getIndexerWatermark({ chainId })
            .then((r) => { if (!cancelled) setCurrentHeight(r && r.watermark != null ? Number(r.watermark) : null); })
            .catch(() => { if (!cancelled) setCurrentHeight(null); });
        return () => { cancelled = true; };
    }, [showAdvanced, chainId, messaging, walletId]);

    // PC-06: prove the callback token's divisibility so a fractional
    // payout can be allowed. Anything short of a confirmed divisibility
    // (still loading, unknown ticker, unreachable explorer) stays null,
    // and the validator then holds the payout to whole numbers.
    useEffect(() => {
        const tick = callbackTick.trim().toUpperCase();
        setCallbackTickDecimals(null);
        if (!showAdvanced || !chainId || !tick) return undefined;
        if (typeof messaging?.getTokenInfo !== 'function') return undefined;
        let cancelled = false;
        const timer = setTimeout(() => {
            messaging.getTokenInfo({ chainId, tick })
                .then((info) => {
                    if (cancelled) return;
                    const d = info?.divisibility;
                    setCallbackTickDecimals(Number.isInteger(d) ? d : null);
                })
                .catch(() => { if (!cancelled) setCallbackTickDecimals(null); });
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [showAdvanced, chainId, callbackTick, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const coinTicker = descriptor ? PROTOCOL_COIN_TICKER[descriptor.coin] : '';
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    //  ( §5.6 slice 2): the wizard is software-only, so the
    // slice flag alone decides between the shared confirm page and the
    // legacy preview + sign stages.
    const actionConfirm = useActionConfirmFlow({ messaging, walletId });
    // An already-unlocked wallet does not re-prompt on the confirm page.
    const signerReady = useSignerReady(walletId);
    // The confirm page's password field writes `password` state; the approve
    // callback reads the ref so it sees the latest keystrokes.
    const passwordValueRef = useRef('');
    passwordValueRef.current = password;

    // Compose ISSUE v0 params from the current form state. Dispatched
    // by template (see TEMPLATE_COMPOSERS); each picks the subset of
    // ISSUE v0 fields its template wants. The memo key intentionally
    // includes `template` so switching templates re-composes.
    // PC-06: the advanced fields ride only the Custom template (the
    // other five are opinionated presets), so they are bundled once and
    // the composer ignores them everywhere else.
    const advanced = useMemo(() => ({
        lockChecks,
        callbackTick,
        callbackAmount,
        callbackBlock,
        allowListIdx,
        blockListIdx,
    }), [lockChecks, callbackTick, callbackAmount, callbackBlock,
         allowListIdx, blockListIdx]);

    const actionParams = useMemo(
        () => composeIssueParams(template, {
            name,
            supply,
            maxMint,
            divisible,
            description,
            lockOnCreate,
            transferTo,
            imageUrl,
            parentToken,
            perAddressMax,
            mintStartBlock,
            mintStopBlock,
            advanced,
        }),
        [template, name, supply, maxMint, divisible, description,
         lockOnCreate, transferTo, imageUrl, parentToken,
         perAddressMax, mintStartBlock, mintStopBlock, advanced],
    );

    const decoded = useMemo(() => {
        if (stage !== 'preview' && stage !== 'sign') return null;
        return decoderLib.decodeAction({
            action: 'ISSUE',
            params: actionParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, actionParams, chainId]);

    function handleDetailsSubmit(event) {
        event.preventDefault();
        if (!name.trim()) {
            setFormError('Token name is required.');
            return;
        }
        if (!/^[A-Za-z0-9]+$/.test(name)) {
            setFormError('Token name must be A–Z, 0–9.');
            return;
        }
        if (template === 'subtoken') {
            if (!parentToken.trim()) {
                setFormError('Parent ticker is required for subtokens.');
                return;
            }
            if (!/^[A-Za-z0-9]+$/.test(parentToken)) {
                setFormError('Parent ticker must be A–Z, 0–9.');
                return;
            }
        }
        // Collectible's supply is hard-wired to 1 by the composer;
        // no user-facing supply field.
        if (template !== 'collectible') {
            if (!supply.trim() || Number(supply) <= 0) {
                setFormError('Supply must be a positive number.');
                return;
            }
        }
        if (template === 'edition') {
            if (!maxMint.trim() || Number(maxMint) <= 0) {
                setFormError('Copies per mint must be a positive number.');
                return;
            }
            if (mintStartBlock && mintStopBlock
                && Number(mintStopBlock) <= Number(mintStartBlock)) {
                setFormError('Minting must close after it opens. Check the block numbers.');
                return;
            }
        }
        // PC-06: the advanced fields share the create transaction, so a
        // bad one costs the whole token, not just the field. Pre-flight
        // them here rather than letting the indexer reject the ISSUE.
        if (template === 'custom') {
            const advancedError = validateAdvancedIssueFields(advanced, {
                supply,
                currentHeight,
                callbackTickDecimals,
            });
            if (advancedError) {
                setShowAdvanced(true);
                setFormError(advancedError);
                return;
            }
        }
        setFormError(null);
        openConfirmScreen();
        return;
        setStage('preview');
    }

    //  ( §5.6 slice 2): the wizard's details step goes straight
    // to the shared confirm page, skipping its own preview + sign stages.
    // Compose + tamper-check + pre-flight run HOST-side; Approve signs the
    // byte-identical prebuilt PSBT via issueToken.prebuiltPsbt.
    async function openConfirmScreen() {
        const from = fromAddress ? {
            address: fromAddress.address,
            publicKey: fromAddress.publicKey,
            derivationPath: fromAddress.derivationPath,
            addressId: fromAddress.id,
            source: fromAddress.source,
            signerId: fromAddress.signerId,
        } : null;
        if (!from) { setFormError('No source address available.'); return; }
        setSubmitError(null);
        try {
            const res = await actionConfirm.run({
                chainId,
                from,
                actionData: { action: 'ISSUE', params: actionParams },
                encoderOpts: { payFeeInNativeCoin: payFeeInNativeCoin || undefined },
                onApprove: (prebuiltPsbt) => messaging.issueToken({
                    walletId,
                    chainId,
                    from,
                    params: actionParams,
                    password: passwordValueRef.current,
                    payFeeInNativeCoin: payFeeInNativeCoin || undefined,
                    prebuiltPsbt,
                }),
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            if (isUserRejection(err)) return;
            setFormError(err?.message || 'Issue failed.');
        }
    }

    async function handleSign(event) {
        event.preventDefault();
        if (stage === 'sign' || password.length === 0) return;
        setStage('sign');
        setSubmitError(null);
        try {
            // messaging.issueToken lands in Phase 2 Step 5 (piece 2c).
            // Until then the call surfaces the host's
            // "unknown-message-type" error cleanly so the user sees
            // why the sign step is gated.
            const res = await messaging.issueToken({
                walletId,
                password,
                chainId,
                from: fromAddress ? {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                } : null,
                params: actionParams,
                payFeeInNativeCoin: payFeeInNativeCoin || undefined,
            });
            setResult(res);
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            const isNativeFeeErr = err?.name === 'NativeFeeForfeitError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : isNativeFeeErr && err?.reason === 'unsupported'
                        ? `Paying the protocol fee in ${coinTicker || 'the native coin'} is not available for this action. Turn it off to pay in XCHAIN.`
                    : isNativeFeeErr
                        ? 'The native-coin fee price is temporarily unavailable. Try again in a moment, or turn off native-coin fee payment.'
                    : err?.message || 'Sign failed.',
            );
            setStage('preview');
            passwordRef.current?.focus();
            passwordRef.current?.select();
        }
    }

        const header = (
        <PageHeader
            onBack={onBack}
            backLabel="Back to home"
            title="Create a token"
        />
    );
    const wrap = (children) => (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{children}</div> : children}
        </Screen>
    );

    if (loadError) {
        return wrap(<div role="alert" className={styles.error}>{loadError}</div>);
    }
    if (!addressesByChain || !chainId) {
        return wrap(<p className={styles.hint}>Loading…</p>);
    }

    //  confirm page, rendered in place of the wizard step (the overlay
    // modal didn't fit small/mobile viewports); wizard state stays intact.
    if (actionConfirm.open) {
        return (
            <ActionConfirmScreen
                confirmAction={actionConfirm.confirmAction}
                screenVariant={variant}
                chainLabel={descriptor?.displayName || chainId}
                signerReady={signerReady}
                password={password}
                onPasswordChange={setPassword}
                hintClassName={styles.hint}
            />
        );
    }

    // PC-06 access lists: the same TYPE=2 address-list picker the admin
    // access-lists mode uses, so create and edit bind lists identically.
    if (listPickerFor) {
        return (
            <ListPickerScreen
                variant={variant}
                messaging={messaging}
                chainId={chainId}
                addresses={addressesByChain?.[chainId] || []}
                filterType="2"
                title={listPickerFor === 'allow' ? 'Choose allow-list' : 'Choose block-list'}
                onSelect={(row) => {
                    if (listPickerFor === 'allow') {
                        setAllowListIdx(row.actionIndex);
                        setAllowListCount(row.memberCount);
                    } else {
                        setBlockListIdx(row.actionIndex);
                        setBlockListCount(row.memberCount);
                    }
                    setListPickerFor(null);
                }}
                onBack={() => setListPickerFor(null)}
            />
        );
    }

    if (stage === 'template') {
        return wrap(renderTemplateStage({
            onPick: (t) => { setTemplate(t); setStage('chain'); },
        }));
    }

    if (stage === 'chain') {
        return wrap(renderChainStage({
            chainsWithAddresses,
            chainId,
            setChainId,
            descriptor,
            fromAddress,
            onBack: () => setStage('template'),
            onNext: () => setStage('details'),
        }));
    }

    if (stage === 'details') {
        return wrap(renderDetailsStage({
            template,
            name, setName,
            displayName, setDisplayName,
            supply, setSupply,
            divisible, setDivisible,
            description, setDescription,
            maxMint, setMaxMint,
            lockOnCreate, setLockOnCreate,
            transferTo, setTransferTo,
            imageUrl, setImageUrl,
            parentToken, setParentToken,
            perAddressMax, setPerAddressMax,
            mintStartBlock, setMintStartBlock,
            mintStopBlock, setMintStopBlock,
            payFeeInNativeCoin, setPayFeeInNativeCoin, coinTicker,
            advancedPanel: {
                showAdvanced, setShowAdvanced,
                lockChecks, setLockChecks,
                lockOnCreate,
                callbackTick, setCallbackTick,
                callbackAmount, setCallbackAmount,
                callbackBlock, setCallbackBlock,
                callbackBlockEstimate: blockDateEstimateText({
                    coin: descriptor?.coin, currentHeight, targetBlock: callbackBlock,
                }),
                callbackTickDecimals,
                currentHeight,
                chainLabel: descriptor?.displayName || chainId,
                allowListIdx, blockListIdx, allowListCount, blockListCount,
                onPickList: setListPickerFor,
                onClearList: (which) => {
                    if (which === 'allow') { setAllowListIdx(null); setAllowListCount(null); }
                    else { setBlockListIdx(null); setBlockListCount(null); }
                },
                warnings: advancedIssueWarnings(advanced),
            },
            formError,
            onBack: () => setStage('chain'),
            onSubmit: handleDetailsSubmit,
            submitLabel: 'Issue token',
            submitLoading: actionConfirm.composing,
        }));
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        return wrap(
            <>
                <h2 className={styles.successTitle}>Token created</h2>
                {txid ? (
                    <>
                        <p className={styles.successLabel}>Transaction ID</p>
                        <code className={styles.txid}>{txid}</code>
                    </>
                ) : (
                    <p className={styles.hint}>Broadcast complete.</p>
                )}
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Done</Button>
                </div>
            </>,
        );
    }

    // stage === 'preview' or 'sign'
    return wrap(
        <form onSubmit={handleSign} noValidate>
            <p className={styles.summary}>{decoded?.summary}</p>
            <dl className={styles.detailsList}>
                <dt className={styles.detailsLabel}>Chain</dt>
                <dd className={styles.detailsValue}>
                    {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                </dd>
                {fromAddress ? (
                    <>
                        <dt className={styles.detailsLabel}>From</dt>
                        <dd className={styles.detailsValue}>
                            <AddressText address={fromAddress.address} />
                        </dd>
                    </>
                ) : null}
                {(decoded?.details || []).map((d) => (
                    <DetailRow key={d.label} label={d.label} value={d.value} />
                ))}
            </dl>
            {payFeeInNativeCoin ? (
                <div role="alert" className={styles.warnings}>
                    <p className={styles.warning}>{NATIVE_FEE_WARNING}</p>
                </div>
            ) : null}
            {decoded && decoded.warnings.length > 0 ? (
                <div role="alert" className={styles.warnings}>
                    {decoded.warnings.map((w, i) => (
                        <p key={i} className={styles.warning}>{w}</p>
                    ))}
                </div>
            ) : null}
            <Input
                ref={passwordRef}
                type="password"
                label="Password"
                hint="Required to sign."
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (submitError) setSubmitError(null);
                }}
                autoComplete="current-password"
                disabled={stage === 'sign'}
                error={submitError || undefined}
            />
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={stage === 'sign'}
                    disabled={password.length === 0}
                >
                    Create token
                </Button>
            </div>
        </form>,
    );
}

/**
 * Compose an ISSUE v0 action-params object from the wizard's details
 * form. Dispatches by template; each composer picks the subset of
 * ISSUE fields its template wants. The shape matches what
 * `actionDecoder` and the SDK's `Actions.createAction` both consume.
 *
 * Template semantics (§40.1):
 *
 * - **meme**: fire-and-forget: MAX_SUPPLY + MINT_SUPPLY + non-divisible
 *               + LOCK_MAX_SUPPLY + LOCK_MINT in one ISSUE transaction.
 *               (The spec describes a BATCH but the protocol's ISSUE v0
 *               composes all three atomically via `MINT_SUPPLY` +
 *               `LOCK_*` fields, simpler and one fewer signature.)
 * - **utility**: mintable, adjustable: MAX_SUPPLY + MAX_MINT, no lock
 *               flags. Description encouraged for discovery.
 * - **community**: dividend-capable + mintable: same shape as utility;
 *               dividends are a later DIVIDEND action on the TICK, not
 *               a flag on ISSUE.
 * - **collectible**: single-edition: MAX_SUPPLY=1 + MINT_SUPPLY=1 +
 *               non-divisible + LOCK_MAX_SUPPLY + LOCK_MINT. Image URL
 *               goes into DESCRIPTION (the JDOG protocol example). Full
 *               FILE + BATCH path is deferred past Phase 2 (BATCH bans
 *               FILE per protocol §BATCH; the FILE-action pipeline is
 *               its own feature).
 * - **edition**: fair-mint set of N identical prints (mirrors
 *               `sdk.nft.edition({mint})`): MAX_SUPPLY=N + DECIMALS=0 +
 *               LOCK_MAX_SUPPLY + MAX_MINT (+ optional MINT_ADDRESS_MAX /
 *               MINT_START_BLOCK / MINT_STOP_BLOCK). Deliberately **no
 *               MINT_SUPPLY and no LOCK_MINT**. The cap locks at
 *               issuance with zero minted supply (LOCK_MAX_SUPPLY
 *               validates the declared cap) so every print stays
 *               publicly mintable through the MINT window.
 * - **subtoken**: TICK = "PARENT.CHILD"; supply + decimals + optional
 *               description. Parent-ownership check is runtime at the
 *               protocol layer; the wizard doesn't verify pre-flight.
 * - **custom**: every ISSUE v0 field exposed. Superset of the other
 *               five; used for edge cases the templates don't cover.
 *               PC-06 completes it: the advanced disclosure adds the
 *               seven lock flags, the callback trio, and the
 *               allow/block lists, so a token that previously needed a
 *               create plus three admin edits is one transaction.
 */
function composeIssueParams(template, form) {
    const composer = TEMPLATE_COMPOSERS[template] || TEMPLATE_COMPOSERS.custom;
    return composer(form);
}

const TEMPLATE_COMPOSERS = {
    meme(form) {
        const p = baseParams(form);
        p.DECIMALS = '0';           // meme tokens are indivisible
        seedSupply(p, form);
        p.LOCK_MAX_SUPPLY = '1';
        p.LOCK_MINT = '1';
        maybeDescription(p, form);
        return p;
    },

    utility(form) {
        const p = baseParams(form);
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        maybeDescription(p, form);
        return p;
    },

    community(form) {
        // Dividend support is a protocol-level property of the TICK
        // (enforced via a DIVIDEND action on an owned token); the ISSUE
        // shape is the same as utility today.
        return TEMPLATE_COMPOSERS.utility(form);
    },

    collectible(form) {
        const p = baseParams(form);
        p.DECIMALS = '0';
        p.MAX_SUPPLY = '1';
        p.MINT_SUPPLY = '1';
        p.LOCK_MAX_SUPPLY = '1';
        p.LOCK_MINT = '1';
        // The image URL lives in DESCRIPTION (the TIS IMAGE format);
        // the lightweight path. For fully ON-CHAIN artwork + metadata,
        // create the token here, then use Manage Token → Artwork with
        // "make this the token's picture everywhere": it uploads the
        // image and a TIS document as FILE actions and re-points
        // DESCRIPTION at the document (action:<index>, TIS On-Chain
        // Format).
        if (form.imageUrl) p.DESCRIPTION = form.imageUrl.trim();
        else if (form.description) p.DESCRIPTION = form.description.trim();
        return p;
    },

    edition(form) {
        const p = baseParams(form);
        p.DECIMALS = '0';
        if (form.supply) p.MAX_SUPPLY = String(form.supply).trim();
        p.LOCK_MAX_SUPPLY = '1';
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        if (form.perAddressMax) p.MINT_ADDRESS_MAX = String(form.perAddressMax).trim();
        if (form.mintStartBlock) p.MINT_START_BLOCK = String(form.mintStartBlock).trim();
        if (form.mintStopBlock) p.MINT_STOP_BLOCK = String(form.mintStopBlock).trim();
        // Same DESCRIPTION convention as collectible; the shared
        // artwork URL, falling back to a plain description.
        if (form.imageUrl) p.DESCRIPTION = form.imageUrl.trim();
        else if (form.description) p.DESCRIPTION = form.description.trim();
        return p;
    },

    subtoken(form) {
        const p = baseParams(form);
        // TICK already came in uppercased; compose parent.child if both
        // are present. `parentToken` is the existing tick the user
        // owns; the wizard's Subtoken form prompts for it separately
        // and joins here.
        if (form.parentToken) {
            const parent = String(form.parentToken).trim().toUpperCase();
            const child = String(form.name).trim().toUpperCase();
            p.TICK = `${parent}.${child}`;
        }
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        maybeDescription(p, form);
        return p;
    },

    custom(form) {
        const p = baseParams(form);
        p.DECIMALS = form.divisible ? '8' : '0';
        seedSupply(p, form);
        if (form.maxMint) p.MAX_MINT = String(form.maxMint).trim();
        maybeDescription(p, form);
        if (form.lockOnCreate) {
            p.LOCK_MAX_SUPPLY = '1';
            p.LOCK_MINT = '1';
        }
        if (form.transferTo) p.TRANSFER = form.transferTo.trim();
        // PC-06: the advanced disclosure's lock matrix, callback trio,
        // and access lists. Applied last so an explicitly checked flag
        // and the `lockOnCreate` shortcut converge on the same '1'
        // rather than fighting over the field.
        applyAdvancedIssueFields(p, form.advanced);
        return p;
    },
};

function baseParams(form) {
    return {
        VERSION: '0',
        TICK: (form.name || '').toUpperCase(),
    };
}

function seedSupply(p, form) {
    if (!form.supply) return;
    const supply = String(form.supply).trim();
    p.MAX_SUPPLY = supply;
    p.MINT_SUPPLY = supply;
}

function maybeDescription(p, form) {
    if (form.description) p.DESCRIPTION = form.description.trim();
}

const TEMPLATES = [
    {
        id: 'meme',
        name: 'Meme token',
        tagline: 'Fixed supply, locked, non-divisible: launch and forget.',
        interactive: true,
    },
    {
        id: 'utility',
        name: 'Utility token',
        tagline: 'Mintable, adjustable supply, descriptive.',
        interactive: true,
    },
    {
        id: 'collectible',
        name: 'Collectible',
        tagline: 'One-of-a-kind collectible with on-chain artwork.',
        interactive: true,
    },
    {
        id: 'edition',
        name: 'Limited edition',
        tagline: 'A fixed set of identical collectibles that anyone can mint.',
        interactive: true,
    },
    {
        id: 'community',
        name: 'Community',
        tagline: 'Dividend-enabled, mintable.',
        interactive: true,
    },
    {
        id: 'subtoken',
        name: 'Subtoken',
        tagline: 'Named sub-token under a ticker you own.',
        interactive: true,
    },
    {
        id: 'custom',
        name: 'Custom',
        tagline: 'Every token field, fully editable.',
        interactive: true,
    },
];

function renderTemplateStage({ onPick }) {
    return (
        <>
            <p className={styles.stageHint}>Choose a template.</p>
            <ul className={styles.templateGrid}>
                {TEMPLATES.map((t) => (
                    <li key={t.id}>
                        <button
                            type="button"
                            className={
                                t.interactive
                                    ? styles.templateCard
                                    : `${styles.templateCard} ${styles.templateCardDisabled}`
                            }
                            onClick={() => t.interactive && onPick(t.id)}
                            disabled={!t.interactive}
                            aria-disabled={!t.interactive}
                            title={t.interactive ? undefined : 'Dedicated form ships in Phase 2 Step 6. Use Custom today.'}
                        >
                            <span className={styles.templateName}>{t.name}</span>
                            <span className={styles.templateTag}>{t.tagline}</span>
                            {!t.interactive ? (
                                <span className={styles.templateSoon}>Use Custom (dedicated form ships in Step 6)</span>
                            ) : null}
                        </button>
                    </li>
                ))}
            </ul>
        </>
    );
}

function renderChainStage({
    chainsWithAddresses, chainId, setChainId, descriptor, fromAddress,
    onBack, onNext,
}) {
    return (
        <>
            <p className={styles.stageHint}>Which chain should this token live on?</p>
            <NetworkField value={chainId} onChange={setChainId} chainIds={chainsWithAddresses.length ? chainsWithAddresses : (chainId ? [chainId] : [])} chainRegistry={chainRegistry} />

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Fee paid by</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="primary"
                    onClick={onNext}
                    disabled={!fromAddress}
                >
                    Next
                </Button>
            </div>
        </>
    );
}

/**
 * Which ISSUE-form fields each template wants the user to fill in.
 * Fields not listed are either fixed by the composer (Meme's
 * DECIMALS=0, Collectible's MAX_SUPPLY=1) or irrelevant for the
 * template's use case. Custom exposes every field.
 */
const TEMPLATE_FIELDS = {
    meme: {
        name: true, displayName: true, supply: true, description: true,
    },
    utility: {
        name: true, displayName: true, supply: true, divisible: true,
        description: true, maxMint: true,
    },
    community: {
        name: true, displayName: true, supply: true, divisible: true,
        description: true, maxMint: true,
    },
    collectible: {
        name: true, displayName: true, imageUrl: true,
    },
    edition: {
        name: true, displayName: true, supply: true, imageUrl: true,
        maxMint: true, perAddressMax: true, mintStartBlock: true,
        mintStopBlock: true,
    },
    subtoken: {
        parentToken: true, name: true, displayName: true, supply: true,
        divisible: true, description: true,
    },
    custom: {
        name: true, displayName: true, supply: true, divisible: true,
        description: true, maxMint: true, lockOnCreate: true, transferTo: true,
    },
};

function renderDetailsStage({
    template,
    name, setName,
    displayName, setDisplayName,
    supply, setSupply,
    divisible, setDivisible,
    description, setDescription,
    maxMint, setMaxMint,
    lockOnCreate, setLockOnCreate,
    transferTo, setTransferTo,
    imageUrl, setImageUrl,
    parentToken, setParentToken,
    perAddressMax, setPerAddressMax,
    mintStartBlock, setMintStartBlock,
    mintStopBlock, setMintStopBlock,
    payFeeInNativeCoin, setPayFeeInNativeCoin, coinTicker,
    advancedPanel,
    formError, onBack, onSubmit, submitLabel = 'Preview', submitLoading = false,
}) {
    const show = TEMPLATE_FIELDS[template] || TEMPLATE_FIELDS.custom;
    const isEdition = template === 'edition';
    return (
        <form onSubmit={onSubmit} noValidate>
            <p className={styles.stageHint}>
                Template: <strong>{template}</strong>
            </p>
            {show.parentToken ? (
                <Input
                    label="Parent ticker"
                    hint="An existing token you own. The subtoken's full ticker will be PARENT.CHILD."
                    value={parentToken}
                    onChange={(e) => setParentToken(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}
            {show.name ? (
                <Input
                    label={template === 'subtoken' ? 'Subtoken name' : 'Token name (ticker)'}
                    hint="A–Z, 0–9. Uppercase."
                    value={name}
                    onChange={(e) => setName(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            ) : null}
            {show.displayName ? (
                <Input
                    label="Display name (optional)"
                    hint="UI label, not stored on-chain."
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.supply ? (
                <Input
                    label={isEdition ? 'Edition size' : 'Supply'}
                    hint={isEdition
                        ? 'How many copies will ever exist. This number is locked permanently when the edition is created.'
                        : undefined}
                    inputMode="decimal"
                    value={supply}
                    onChange={(e) => setSupply(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.divisible ? (
                <label className={styles.checkRow}>
                    <input
                        type="checkbox"
                        checked={divisible}
                        onChange={(e) => setDivisible(e.target.checked)}
                    />
                    <span>Divisible (8 decimal places)</span>
                </label>
            ) : null}
            {show.description ? (
                <Input
                    label="Description (optional)"
                    hint="Up to 250 characters. Stored on-chain."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    autoComplete="off"
                    maxLength={250}
                />
            ) : null}
            {show.imageUrl ? (
                <Input
                    label="Image URL"
                    hint={isEdition
                        ? 'The artwork every copy shares, stored on-chain in the description. Use a stable URL (IPFS, your own host).'
                        : "The collectible's image, stored on-chain in the description. Use a stable URL (IPFS, your own host)."}
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    maxLength={250}
                />
            ) : null}
            {show.maxMint ? (
                <Input
                    label={isEdition ? 'Copies per mint' : 'Max mint per transaction (optional)'}
                    hint={isEdition
                        ? 'How many copies one mint claims. Anyone can mint until the edition sells out.'
                        : 'Caps how much can be minted in one transaction.'}
                    inputMode="decimal"
                    value={maxMint}
                    onChange={(e) => setMaxMint(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.perAddressMax ? (
                <Input
                    label="Limit per address (optional)"
                    hint="The most copies any single address can mint in total. Leave blank for no limit."
                    inputMode="decimal"
                    value={perAddressMax}
                    onChange={(e) => setPerAddressMax(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.mintStartBlock ? (
                <Input
                    label="Minting opens at block (optional)"
                    hint="Block height when public minting starts. Leave blank to open immediately."
                    inputMode="decimal"
                    value={mintStartBlock}
                    onChange={(e) => setMintStartBlock(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.mintStopBlock ? (
                <Input
                    label="Minting closes at block (optional)"
                    hint="Block height when public minting ends. Leave blank to keep it open until sold out."
                    inputMode="decimal"
                    value={mintStopBlock}
                    onChange={(e) => setMintStopBlock(e.target.value)}
                    autoComplete="off"
                />
            ) : null}
            {show.lockOnCreate ? (
                <label className={styles.checkRow}>
                    <input
                        type="checkbox"
                        checked={lockOnCreate}
                        onChange={(e) => setLockOnCreate(e.target.checked)}
                    />
                    <span>Lock supply + minting immediately (irreversible)</span>
                </label>
            ) : null}
            {show.transferTo ? (
                <Input
                    label="Transfer ownership to (optional)"
                    hint="Leave blank to keep control."
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                />
            ) : null}
            {template === 'custom' && advancedPanel ? (
                <AdvancedIssuePanel {...advancedPanel} />
            ) : null}
            <NativeFeeToggle
                checked={payFeeInNativeCoin}
                onChange={setPayFeeInNativeCoin}
                coinTicker={coinTicker}
            />
            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button type="submit" variant="primary" block loading={submitLoading}>
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
}

/**
 * PC-06: the Custom template's advanced disclosure - the ISSUE v0
 * fields that used to be reachable only as post-create admin edits.
 *
 * Collapsed by default: these are permanent, consequential settings
 * that most issuers never touch, and every one of them shares the
 * create transaction, so a mistake here costs the token itself.
 */
function AdvancedIssuePanel({
    showAdvanced, setShowAdvanced,
    lockChecks, setLockChecks,
    lockOnCreate,
    callbackTick, setCallbackTick,
    callbackAmount, setCallbackAmount,
    callbackBlock, setCallbackBlock,
    callbackBlockEstimate,
    callbackTickDecimals,
    currentHeight,
    chainLabel,
    allowListIdx, blockListIdx, allowListCount, blockListCount,
    onPickList, onClearList,
    warnings = [],
}) {
    // The shortcut checkbox above already commits these two flags, so
    // their rows render checked-and-disabled rather than offering a
    // second, contradictory control for the same wire field.
    const forcedByShortcut = { max_supply: !!lockOnCreate, mint: !!lockOnCreate };
    return (
        <div className={styles.advanced}>
            <Button
                type="button"
                variant="ghost"
                block
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced(!showAdvanced)}
            >
                {showAdvanced ? 'Hide advanced settings' : 'Advanced settings (optional)'}
            </Button>
            {!showAdvanced ? (
                <p className={styles.hint}>
                    Locks, a callback, and allow/block lists. All optional, and all
                    settable later from Manage Token - except the locks, which are
                    permanent whenever they are set.
                </p>
            ) : (
                <div className={styles.advancedBody}>
                    <p className={styles.hint}>
                        These settings ride the same transaction that creates the token,
                        so everything below is configured in one signature. If any value
                        here is rejected by the network, the whole creation is rejected
                        and the token is not created.
                    </p>

                    <h3 className={styles.advancedHeading}>Locks (permanent)</h3>
                    <p className={styles.hint}>
                        Each flag is a one-way switch. Once the token is created with a
                        lock set, it can never be unlocked.
                    </p>
                    <div role="group" aria-label="Lock flags">
                        {LOCK_FLAGS.map((f) => {
                            const forced = !!forcedByShortcut[f.key];
                            return (
                                <div key={f.key} className={styles.lockFlagRow}>
                                    <label className={styles.checkRow}>
                                        <input
                                            type="checkbox"
                                            checked={forced || !!lockChecks[f.key]}
                                            disabled={forced}
                                            onChange={(e) => setLockChecks({
                                                ...lockChecks,
                                                [f.key]: e.target.checked,
                                            })}
                                        />
                                        <span>
                                            {f.label}
                                            {forced ? ' (set by "Lock supply + minting immediately")' : ''}
                                        </span>
                                    </label>
                                    <p className={styles.lockFlagHint}>{f.hint}</p>
                                </div>
                            );
                        })}
                    </div>

                    <h3 className={styles.advancedHeading}>Callback</h3>
                    <p className={styles.hint}>
                        A callback lets you later recall <strong>all</strong> of this token
                        back to your address in one action, paying every holder a set amount
                        of another token per unit they held. It can only be configured before
                        any supply is distributed, so creating the token with it set is the
                        one moment it is guaranteed to be available.
                    </p>
                    <Input
                        label="Callback token (optional)"
                        hint="The ticker holders are paid in when you call back. Must be a token you'll hold enough of to cover every holder."
                        value={callbackTick}
                        onChange={(e) => setCallbackTick(e.target.value.toUpperCase())}
                        autoComplete="off"
                        autoCapitalize="characters"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    <Input
                        label="Payout per unit"
                        hint={callbackTickDecimals != null
                            ? `How much of ${callbackTick} each holder receives per unit they hold. Up to ${callbackTickDecimals} decimal place${callbackTickDecimals === 1 ? '' : 's'}.`
                            : 'How much of the callback token each holder receives per unit they hold. Whole numbers only until the wallet can confirm the callback token is divisible.'}
                        inputMode="decimal"
                        value={callbackAmount}
                        onChange={(e) => setCallbackAmount(e.target.value)}
                        autoComplete="off"
                    />
                    <Input
                        label="Callback allowed from block"
                        hint={callbackBlockEstimate
                            ? `The earliest block you can trigger the callback. Est. ${callbackBlockEstimate}.`
                            : 'The earliest block height you can trigger the callback. Must be a future block.'}
                        inputMode="decimal"
                        value={callbackBlock}
                        onChange={(e) => setCallbackBlock(e.target.value)}
                        autoComplete="off"
                    />
                    {currentHeight != null ? (
                        <p className={styles.hint}>
                            Current block on {chainLabel}: {currentHeight.toLocaleString('en-US')}.
                            Date above is a rough estimate; real block times vary.
                        </p>
                    ) : null}

                    <h3 className={styles.advancedHeading}>Access lists</h3>
                    <p className={styles.hint}>
                        Restrict who can interact with the token by pointing it at address
                        lists you've published. An allow-list permits only its members; a
                        block-list denies its members. Create one in My Lists first.
                    </p>
                    <div className={styles.listRow}>
                        <div className={styles.fromLine}>
                            <span className={styles.detailsLabel}>Allow-list</span>
                            <span className={styles.detailsValue}>
                                {allowListIdx
                                    ? `List #${allowListIdx}${allowListCount != null ? ` · ${allowListCount} member${allowListCount === 1 ? '' : 's'}` : ''}`
                                    : 'None (anyone may interact)'}
                            </span>
                        </div>
                        <Button type="button" variant="ghost" onClick={() => onPickList('allow')}>
                            {allowListIdx ? 'Change allow-list' : 'Choose allow-list'}
                        </Button>
                        {allowListIdx ? (
                            <Button type="button" variant="ghost" onClick={() => onClearList('allow')}>
                                Remove
                            </Button>
                        ) : null}
                    </div>
                    <div className={styles.listRow}>
                        <div className={styles.fromLine}>
                            <span className={styles.detailsLabel}>Block-list</span>
                            <span className={styles.detailsValue}>
                                {blockListIdx
                                    ? `List #${blockListIdx}${blockListCount != null ? ` · ${blockListCount} member${blockListCount === 1 ? '' : 's'}` : ''}`
                                    : 'None'}
                            </span>
                        </div>
                        <Button type="button" variant="ghost" onClick={() => onPickList('block')}>
                            {blockListIdx ? 'Change block-list' : 'Choose block-list'}
                        </Button>
                        {blockListIdx ? (
                            <Button type="button" variant="ghost" onClick={() => onClearList('block')}>
                                Remove
                            </Button>
                        ) : null}
                    </div>
                    <p className={styles.hint}>
                        Removing a list here only clears it before the token exists. Once
                        created, a bound list can be replaced but never removed: the
                        protocol has no "clear" for one. To lift a restriction later, point
                        it at an empty address list.
                    </p>

                    {warnings.length > 0 ? (
                        <div role="alert" className={styles.warnings}>
                            {warnings.map((w) => (
                                <p key={w} className={styles.warning}>{w}</p>
                            ))}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

function DetailRow({ label, value }) {
    return (
        <>
            <dt className={styles.detailsLabel}>{label}</dt>
            <dd className={styles.detailsValue}>{value}</dd>
        </>
    );
}
