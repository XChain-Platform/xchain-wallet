import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Screen,
    Button,
    Input,
    ChainBadge,
    AddressText,
 ChainPicker,  Icon,} from '@xchain-wallet/core/ui';
import {
    registry as registryLib,
    decoder as decoderLib,
    airdrop as airdropLib,
    schemas as schemasLib,
} from '@xchain-wallet/core';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { LockedTokenContext } from '../components/LockedTokenContext.jsx';
import { SignCredentials, isHwSource } from '../components/SignCredentials.jsx';
import { useWalletMode } from '../hooks/useWalletMode.js';
import { useDropZone } from '../hooks/useDropZone.js';
import styles from './IssueTokenForm.module.css';

const chainRegistry = registryLib.defaultRegistry();
const POLL_INTERVAL_MS = 10_000;

/**
 * Airdrop form — §40.9.
 *
 * Authors an AIRDROP-to-address-list as two sequential transactions:
 *
 *   1. LIST (v0, TYPE=2) — creates an on-chain ADDRESS list. Gets an
 *      ACTION_INDEX assigned by the indexer.
 *   2. AIRDROP (v0) — references that ACTION_INDEX to distribute the
 *      per-recipient amount to each address on the list.
 *
 * Stage machine:
 *   compose         — user pastes/uploads addresses, picks token+amount
 *   review-list     — decoder-rendered LIST preview + sign
 *   wait-index      — poll explorer for LIST's ACTION_INDEX
 *   review-airdrop  — decoder-rendered AIRDROP preview + sign
 *   done            — both txids shown
 *
 * Progress is persisted to `vault.pendingAirdrops` at each stage
 * transition so the user can close the wallet between signs and
 * resume. AirdropForm accepts an optional `resumeId`; when set, it
 * hydrates from the saved record and jumps to the right stage.
 *
 * Address validation is light (length + base58/bech32 charset);
 * anything that slips through is caught by the encoder at sign time.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null} [props.resumeId]
 * @param {() => void} props.onBack
 */
export function AirdropForm({ walletId, resumeId = null, onBack, initialChainId, initialTick, initialFromAddress }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));

    const [chainId, setChainId] = useState(/** @type {string | null} */ (initialChainId || null));
    const lockedToken = !!(initialChainId && initialTick);
    const [fromAddressId, setFromAddressId] = useState(
        /** @type {string | null} */ (null),
    );

    const [token, setToken] = useState((initialTick || '').toUpperCase());
    const [amountPer, setAmountPer] = useState('');
    const [memo, setMemo] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [recipients, setRecipients] = useState(
        /** @type {{ valid: string[], invalid: string[], duplicates: number }} */
        ({ valid: [], invalid: [], duplicates: 0 }),
    );
    const [showInvalid, setShowInvalid] = useState(false);
    const [password, setPassword] = useState('');

    const [stage, setStage] = useState(
        /** @type {'compose' | 'review-list' | 'wait-index' | 'review-airdrop' | 'done'} */
        ('compose'),
    );
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [pendingId, setPendingId] = useState(/** @type {string | null} */ (null));
    const [listTxid, setListTxid] = useState(/** @type {string | null} */ (null));
    const [listActionIndex, setListActionIndex] = useState(
        /** @type {string | null} */ (null),
    );
    const [airdropTxid, setAirdropTxid] = useState(/** @type {string | null} */ (null));
    const [waitElapsed, setWaitElapsed] = useState(0);
    const [hydrated, setHydrated] = useState(false);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const fileInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    // Load addresses on mount (same pattern as DividendForm).
    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const first = Object.keys(byChain)[0];
                if (!first) {
                    setLoadError(
                        'No addresses on any chain yet. Use Receive to generate one before airdropping.',
                    );
                    return;
                }
                if (!resumeId && !lockedToken) setChainId(first);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load addresses.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging, resumeId]);

    // Hydrate from resumeId once addresses are loaded.
    useEffect(() => {
        if (!resumeId || hydrated || !addressesByChain) return;
        let cancelled = false;
        messaging.listPendingAirdropsForWallet({ walletId })
            .then((records) => {
                if (cancelled) return;
                const rec = (records || []).find((r) => r.id === resumeId);
                if (!rec) {
                    setLoadError('Pending airdrop not found — it may have been cleared.');
                    return;
                }
                setChainId(rec.chainId);
                setToken(rec.token);
                setAmountPer(rec.amountPer);
                setRecipients({ valid: [...rec.recipients], invalid: [], duplicates: 0 });
                setMemo(rec.memo || '');
                setPendingId(rec.id);
                setListTxid(rec.listTxid);
                setListActionIndex(rec.listActionIndex);
                setAirdropTxid(rec.airdropTxid);
                if (rec.stage === 'waiting-index') setStage('wait-index');
                else if (rec.stage === 'ready-to-airdrop') setStage('review-airdrop');
                else if (rec.stage === 'done') setStage('done');
                // Pick matching fromAddressId once addresses load.
                const addrs = addressesByChain[rec.chainId] || [];
                const match = addrs.find((a) => a.address === rec.fromAddress);
                if (match) setFromAddressId(match.id);
                setHydrated(true);
            })
            .catch((err) => {
                if (!cancelled) setLoadError(err?.message || 'Failed to load pending airdrop.');
            });
        return () => { cancelled = true; };
    }, [resumeId, hydrated, addressesByChain, walletId, messaging]);

    // Default fromAddressId → preferred issuer address (when present)
    // or the newest external HD address on the chosen chain.
    useEffect(() => {
        if (!chainId || !addressesByChain || fromAddressId) return;
        const all = addressesByChain[chainId] || [];
        if (initialFromAddress) {
            const match = all.find((a) => a.address === initialFromAddress);
            if (match) { setFromAddressId(match.id); return; }
        }
        const addrs = all.filter(
            (a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0',
        );
        if (addrs.length > 0) {
            const sorted = [...addrs].sort((a, b) => {
                const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                return bi - ai;
            });
            setFromAddressId(sorted[0].id);
        }
    }, [chainId, addressesByChain, fromAddressId, initialFromAddress]);

    // Re-classify recipients whenever the paste text changes.
    useEffect(() => {
        if (stage !== 'compose') return;
        const parts = airdropLib.parsePaste(pasteText);
        setRecipients(airdropLib.classifyRecipients(parts));
    }, [pasteText, stage]);

    useEffect(() => {
        if (stage === 'review-list' || stage === 'review-airdrop') {
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }, [stage]);

    // Stage-4 polling: waits for the LIST to be indexed and resolves
    // its ACTION_INDEX. Pauses when the tab is hidden to avoid burning
    // explorer bandwidth for off-screen windows.
    useEffect(() => {
        if (stage !== 'wait-index' || !listTxid || !chainId || !pendingId) return undefined;
        let cancelled = false;
        const started = Date.now();
        const tick = async () => {
            if (cancelled) return;
            setWaitElapsed(Math.floor((Date.now() - started) / 1000));
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden') return;
            try {
                const resp = await messaging.getActionByTxid({ chainId, txid: listTxid });
                if (cancelled) return;
                const idx = extractActionIndex(resp);
                if (idx) {
                    setListActionIndex(idx);
                    try {
                        await messaging.updatePendingAirdrop({
                            id: pendingId,
                            patch: { stage: 'ready-to-airdrop', listActionIndex: idx },
                        });
                    } catch (err) {
                        // Persistence failure is non-fatal here — the in-memory
                        // state still advances, and the user can re-sign.
                    }
                    setStage('review-airdrop');
                }
            } catch (err) {
                // Keep polling through transient network errors.
            }
        };
        tick(); // fire once immediately
        const handle = setInterval(tick, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(handle); };
    }, [stage, listTxid, chainId, pendingId, messaging]);

    const descriptor = chainId ? chainRegistry.get(chainId) : null;
    const fromAddress = useMemo(() => {
        if (!chainId || !fromAddressId || !addressesByChain) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [chainId, fromAddressId, addressesByChain]);

    const chainsWithAddresses = addressesByChain ? Object.keys(addressesByChain) : [];

    // Compose the LIST params (v0, TYPE=2, ITEM=recipients).
    const listParams = useMemo(() => {
        /** @type {Record<string, string | string[]>} */
        const p = {
            VERSION: '0',
            TYPE: '2',
            ITEM: [...recipients.valid],
        };
        return p;
    }, [recipients.valid]);

    // Compose the AIRDROP params (v0, resolved LIST_ACTION_INDEX).
    const airdropParams = useMemo(() => {
        /** @type {Record<string, string> } */
        const p = {
            VERSION: '0',
            TICK: token.trim().toUpperCase(),
            AMOUNT: String(amountPer).trim(),
            LIST_ACTION_INDEX: listActionIndex || '',
        };
        if (memo.trim()) p.MEMO = memo.trim();
        return p;
    }, [token, amountPer, memo, listActionIndex]);

    const listDecoded = useMemo(() => {
        if (stage !== 'review-list' && stage !== 'wait-index') return null;
        return decoderLib.decodeAction({
            action: 'LIST',
            params: listParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, listParams, chainId]);

    const airdropDecoded = useMemo(() => {
        if (stage !== 'review-airdrop' && stage !== 'done') return null;
        return decoderLib.decodeAction({
            action: 'AIRDROP',
            params: airdropParams,
            chainId: chainId || undefined,
            chainRegistry,
        });
    }, [stage, airdropParams, chainId]);

    const totalDistribution = useMemo(() => {
        const amt = Number(String(amountPer).trim());
        if (!Number.isFinite(amt) || amt <= 0) return null;
        if (recipients.valid.length === 0) return null;
        return amt * recipients.valid.length;
    }, [amountPer, recipients.valid.length]);

    const handleFile = useCallback((event) => {
        const file = event.target?.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            const parts = airdropLib.parseCsv(text);
            setPasteText(parts.join('\n'));
        };
        reader.readAsText(file);
    }, []);

    // Cluster P FOLLOWUP 2 — drag-and-drop a CSV / TXT recipient list
    // onto the textarea. Additive; the click-to-pick lane via the
    // `<input type="file">` below stays the primary affordance.
    const recipientsDrop = useDropZone({
        accept: ['.csv', '.txt', 'text/csv', 'text/plain'],
        readAs: 'text',
        onError: (msg) => setFormError(msg),
        onFile: ({ content }) => {
            const text = typeof content === 'string' ? content : '';
            const parts = airdropLib.parseCsv(text);
            setPasteText(parts.join('\n'));
        },
    });

    function handleReviewList(event) {
        event.preventDefault();
        if (!chainId || !fromAddress) {
            setFormError('Pick a source address first.');
            return;
        }
        if (!token.trim()) {
            setFormError('Token is required.');
            return;
        }
        if (!/^[A-Za-z0-9.^]+$/.test(token.trim())) {
            setFormError('Token ticker accepts A–Z, 0–9, period, or ^TICK_ID.');
            return;
        }
        const amt = String(amountPer).trim();
        if (!amt || Number(amt) <= 0) {
            setFormError('Per-recipient amount must be a positive number.');
            return;
        }
        if (recipients.valid.length === 0) {
            setFormError('Add at least one valid recipient address.');
            return;
        }
        if (memo && /[|;]/.test(memo)) {
            setFormError('Memo cannot contain | or ; characters.');
            return;
        }
        setFormError(null);
        setStage('review-list');
    }

    const hw = isHwSource(fromAddress);
    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    // §20 / Cluster W FOLLOWUP 5 — AIRDROP is a multi-phase action: LIST is
    // broadcast first, then the wallet polls for indexer confirmation, then
    // AIRDROP is broadcast referencing the indexed LIST's ACTION_INDEX. The
    // index-wait step is fundamentally incompatible with the watcher-mode
    // contract (the wallet that builds the PSBT is not the wallet that
    // broadcasts it, so it can't observe the broadcast hitting the indexer).
    // Block the form in watcher mode with a redirect rather than ship a
    // partial flow that strands the user mid-LIST.
    const { isWatcherMode } = useWalletMode();

    async function handleSignList(event) {
        event.preventDefault();
        if (submitting) return;
        if (!hw && password.length === 0) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params: listParams,
            };
            const res = hw
                ? await messaging.createListHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.createList({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('LIST broadcast did not return a txid.');
            const record = schemasLib.createPendingAirdrop({
                walletId,
                chainId,
                fromAddress: fromAddress.address,
                token: token.trim().toUpperCase(),
                amountPer: String(amountPer).trim(),
                recipients: recipients.valid,
                listTxid: txid,
                memo: memo.trim() || undefined,
            });
            await messaging.savePendingAirdrop({ record });
            setPendingId(record.id);
            setListTxid(txid);
            setPassword('');
            setStage('wait-index');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'LIST broadcast failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleSignAirdrop(event) {
        event.preventDefault();
        if (submitting) return;
        if (!hw && password.length === 0) return;
        if (hw && hwStatus !== 'available') return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const base = {
                walletId,
                chainId,
                from: {
                    address: fromAddress.address,
                    publicKey: fromAddress.publicKey,
                    derivationPath: fromAddress.derivationPath,
                    addressId: fromAddress.id,
                    source: fromAddress.source,
                    signerId: fromAddress.signerId,
                },
                params: airdropParams,
            };
            const res = hw
                ? await messaging.airdropActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.airdropAction({ ...base, password });
            const txid = res?.txid || res?.broadcast?.txid;
            if (!txid) throw new Error('AIRDROP broadcast did not return a txid.');
            setAirdropTxid(txid);
            if (pendingId) {
                try {
                    await messaging.updatePendingAirdrop({
                        id: pendingId,
                        patch: { stage: 'done', airdropTxid: txid },
                    });
                } catch (err) { /* non-fatal */ }
            }
            setPassword('');
            setStage('done');
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'AIRDROP broadcast failed.',
            );
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        } finally {
            setSubmitting(false);
        }
    }

    async function handleClearPending() {
        if (pendingId) {
            try { await messaging.clearPendingAirdrop({ id: pendingId }); } catch (_) { /* */ }
        }
        onBack();
    }

    const titleSuffix = descriptor ? ` on ${descriptor.displayName}` : '';

        const header = (
        <ScreenHeader
            onBack={onBack}
            title="{stage === 'review-list' ? 'Review address list'
                    : stage === 'wait-index' ? 'Waiting for list to be indexed'
                        : stage === 'review-airdrop' ? 'Review airdrop'
                            : stage === 'done' ? 'Airdrop complete'
                                : `Airdrop tokens${titleSuffix}`}"
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
    if (isWatcherMode) {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Not available in watcher mode</h2>
                <p className={styles.hint}>
                    Airdrop is a two-phase action — the wallet broadcasts a
                    LIST transaction, waits for the indexer to confirm it,
                    then broadcasts the AIRDROP transaction referencing the
                    list. A watcher-mode wallet can't observe the LIST
                    landing on-chain (broadcasting happens on a different
                    wallet), so this flow can't be split across an
                    air-gapped boundary today.
                </p>
                <p className={styles.hint}>
                    Switch this wallet to <strong>full</strong> mode to
                    author an airdrop, or use a Full-mode wallet that holds
                    the same seed.
                </p>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={onBack}>Back</Button>
                </div>
            </>,
        );
    }

    if (stage === 'done') {
        return wrap(
            <>
                <h2 className={styles.successTitle}>Airdrop sent</h2>
                <p className={styles.successLabel}>LIST transaction</p>
                <code className={styles.txid}>{listTxid}</code>
                <p className={styles.successLabel}>AIRDROP transaction</p>
                <code className={styles.txid}>{airdropTxid}</code>
                <div className={styles.actions}>
                    <Button variant="primary" onClick={handleClearPending}>Done</Button>
                </div>
            </>,
        );
    }

    if (stage === 'wait-index') {
        const minutes = Math.floor(waitElapsed / 60);
        const slow = minutes >= 5;
        return wrap(
            <>
                <p className={styles.summary}>{listDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>LIST transaction</dt>
                    <dd className={styles.detailsValue}>
                        <code className={styles.txid}>{listTxid}</code>
                    </dd>
                    <dt className={styles.detailsLabel}>Elapsed</dt>
                    <dd className={styles.detailsValue}>
                        {minutes > 0 ? `${minutes} min ${waitElapsed % 60}s` : `${waitElapsed}s`}
                    </dd>
                </dl>
                <p className={styles.hint}>
                    Waiting for the LIST transaction to be indexed. Once the
                    explorer assigns an ACTION_INDEX, we'll continue to the
                    AIRDROP step. Safe to close the wallet — we'll resume from
                    Home when you reopen it.
                </p>
                {slow ? (
                    <p className={styles.hint}>
                        This is taking longer than usual. Typical wait is 1–2
                        block confirmations. You can leave it running or come
                        back later.
                    </p>
                ) : null}
                <div className={styles.actions}>
                    <Button variant="ghost" onClick={onBack}>Close (keep waiting)</Button>
                    <Button variant="ghost" onClick={handleClearPending}>Cancel airdrop</Button>
                </div>
            </>,
        );
    }

    if (stage === 'review-list') {
        return wrap(
            <form onSubmit={handleSignList} noValidate>
                <p className={styles.summary}>{listDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(listDecoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                </dl>
                {listDecoded && listDecoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {listDecoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                <p className={styles.hint}>
                    Airdrop is a two-transaction flow. Step 1 broadcasts the
                    address list; once it's indexed, step 2 signs the AIRDROP
                    that references it. {hw
                        ? 'You will confirm on your hardware device twice.'
                        : 'You will enter your password twice.'}
                </p>
                <SignCredentials
                    fromAddress={fromAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (submitError) setSubmitError(null);
                    }}
                    onStatusChange={onHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={submitError}
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={hw ? hwStatus !== 'available' : password.length === 0}
                    >
                        {hw
                            ? `Sign LIST on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : (descriptor ? `Sign LIST on ${descriptor.displayName}` : 'Sign LIST')}
                    </Button>
                </div>
            </form>,
        );
    }

    if (stage === 'review-airdrop') {
        return wrap(
            <form onSubmit={handleSignAirdrop} noValidate>
                <p className={styles.summary}>{airdropDecoded?.summary}</p>
                <dl className={styles.detailsList}>
                    <dt className={styles.detailsLabel}>Chain</dt>
                    <dd className={styles.detailsValue}>
                        {descriptor ? <ChainBadge descriptor={descriptor} size="sm" /> : chainId}
                    </dd>
                    <dt className={styles.detailsLabel}>From</dt>
                    <dd className={styles.detailsValue}>
                        <AddressText address={fromAddress.address} />
                    </dd>
                    {(airdropDecoded?.details || []).map((d) => (
                        <DetailRow key={d.label} label={d.label} value={d.value} />
                    ))}
                    <dt className={styles.detailsLabel}>Recipients</dt>
                    <dd className={styles.detailsValue}>{recipients.valid.length}</dd>
                    {totalDistribution !== null ? (
                        <>
                            <dt className={styles.detailsLabel}>Total distribution</dt>
                            <dd className={styles.detailsValue}>
                                ~{totalDistribution} {token.trim().toUpperCase()}
                            </dd>
                        </>
                    ) : null}
                </dl>
                {airdropDecoded && airdropDecoded.warnings.length > 0 ? (
                    <div role="alert" className={styles.warnings}>
                        {airdropDecoded.warnings.map((w, i) => (
                            <p key={i} className={styles.warning}>{w}</p>
                        ))}
                    </div>
                ) : null}
                <p className={styles.hint}>
                    AIRDROP charges an XChain fee based on the number of
                    recipients (§AIRDROP.md). The indexer computes the exact
                    fee at execute time; make sure the source address holds
                    enough of {token.trim().toUpperCase() || 'the token'} +
                    fee tick to cover the full distribution.
                </p>
                <SignCredentials
                    fromAddress={fromAddress}
                    chainId={chainId}
                    password={password}
                    onPasswordChange={(v) => {
                        setPassword(v);
                        if (submitError) setSubmitError(null);
                    }}
                    onStatusChange={onHwStatusChange}
                    passwordRef={passwordRef}
                    submitError={submitError}
                    disabled={submitting}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <div role="alert" className={styles.error}>{submitError}</div>
                ) : null}
                <div className={styles.actions}>
                    <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
                        Close (resume later)
                    </Button>
                    <Button
                        type="submit"
                        variant="primary"
                        loading={submitting}
                        disabled={
                            !listActionIndex
                            || (hw ? hwStatus !== 'available' : password.length === 0)
                        }
                    >
                        {hw
                            ? `Sign AIRDROP on ${fromAddress.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                            : (descriptor ? `Sign AIRDROP on ${descriptor.displayName}` : 'Sign AIRDROP')}
                    </Button>
                </div>
            </form>,
        );
    }

    // stage === 'compose'
    return wrap(
        <form onSubmit={handleReviewList} noValidate>
            {lockedToken && chainId ? (
                <LockedTokenContext chainId={chainId} tick={token} label="Token to drop" />
            ) : (
                <>
                    {chainsWithAddresses.length > 1 ? (
                        <ChainPicker label="Chain" value={chainId} onChange={setChainId} chainIds={chainsWithAddresses} chainRegistry={chainRegistry} />
                    ) : descriptor ? (
                        <div className={styles.chainLine}>
                            <ChainBadge descriptor={descriptor} size="sm" />
                        </div>
                    ) : null}
                </>
            )}

            {fromAddress ? (
                <div className={styles.fromLine}>
                    <span className={styles.fromLabel}>Airdropping from</span>
                    <AddressText address={fromAddress.address} />
                </div>
            ) : (
                <div role="alert" className={styles.error}>
                    No address on this chain. Use Receive to generate one first.
                </div>
            )}

            {lockedToken ? null : (
                <Input
                    label="Token to drop"
                    hint="Ticker of the token each recipient will receive."
                    value={token}
                    onChange={(e) => setToken(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
            )}
            <Input
                label="Per-recipient amount"
                hint="Amount sent to each address on the list."
                inputMode="decimal"
                value={amountPer}
                onChange={(e) => setAmountPer(e.target.value)}
                autoComplete="off"
            />

            <label
                className={styles.pickerLabel}
                {...recipientsDrop.rootProps}
                data-drop-active={recipientsDrop.isDragOver ? 'true' : 'false'}
            >
                Recipients
                <textarea
                    className={styles.picker}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={recipientsDrop.isDragOver
                        ? 'Drop the CSV / TXT file here'
                        : 'Paste addresses, one per line or comma-separated.'}
                    rows={8}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                />
            </label>
            <div className={styles.fromLine}>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    onChange={handleFile}
                    aria-label="Upload CSV of addresses"
                />
            </div>

            {pasteText.trim() ? (
                <p className={styles.hint}>
                    {recipients.valid.length} valid address
                    {recipients.valid.length === 1 ? '' : 'es'}
                    {recipients.duplicates > 0
                        ? ` · ${recipients.duplicates} duplicate${recipients.duplicates === 1 ? '' : 's'} removed`
                        : ''}
                    {recipients.invalid.length > 0
                        ? ` · ${recipients.invalid.length} invalid skipped`
                        : ''}
                    {totalDistribution !== null
                        ? ` · total ~${totalDistribution} ${token.trim().toUpperCase() || 'TOKEN'}`
                        : ''}
                </p>
            ) : null}

            {recipients.invalid.length > 0 ? (
                <div className={styles.hint}>
                    <button
                        type="button"
                        className={styles.back}
                        onClick={() => setShowInvalid((s) => !s)}
                    >
                        {showInvalid ? 'Hide' : 'Show'} {recipients.invalid.length} invalid
                    </button>
                    {showInvalid ? (
                        <ul>
                            {recipients.invalid.map((a, i) => (
                                <li key={i}><code>{a}</code></li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}

            <Input
                label="Memo (optional)"
                hint="Protocol rejects | or ;."
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                autoComplete="off"
            />

            {formError ? (
                <div role="alert" className={styles.error}>{formError}</div>
            ) : null}
            <div className={styles.actions}>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={!fromAddress || recipients.valid.length === 0 || !token || !amountPer}
                >
                    Preview list
                </Button>
            </div>
        </form>,
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

// Resolve the ACTION_INDEX from whatever shape the explorer returns.
// Transactions endpoint returns the action row merged with tx data;
// historically the field is either `action_index` (snake_case from
// the DB) or `actionIndex` (camelCase if wrapped by a newer layer).
function extractActionIndex(resp) {
    if (!resp || typeof resp !== 'object') return null;
    const raw = resp.action_index ?? resp.actionIndex ?? null;
    if (raw === null || raw === undefined) return null;
    const s = String(raw);
    return s.length > 0 ? s : null;
}
