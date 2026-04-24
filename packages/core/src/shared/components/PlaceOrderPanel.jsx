// PlaceOrderPanel — §41.3.4 Place Order form.
//
// Limit orders only (XChain ORDER is inherently limit-based — Pass 1
// §3 rules out margin / algo / aggregation). Buy vs Sell toggle maps
// to which side of the (tick1, tick2) pair the user gives vs gets:
//
//   Buy  tick1 with tick2 → give (price × size) tick2, get size tick1
//   Sell tick1 for tick2  → give size tick1, get (price × size) tick2
//
// Expiration in blocks (XChain's native unit). Presets map rough
// calendar durations to their block counts per-chain; "never" emits
// 0 (the protocol's perpetual sentinel).
//
// Signs via `messaging.orderAction` / `orderActionHw`, reusing the
// shared <SignCredentials> gate so Trezor/Ledger signers slot in
// behind the same form surface (Phase 2 HW Sign pattern).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input } from '@xchain-wallet/core/ui';
import { useMessaging } from '../useMessaging.js';
import { SignCredentials, isHwSource } from './SignCredentials.jsx';

const EXPIRATION_PRESETS = [
    { id: '1d', label: '1 day', blocks: 144 },
    { id: '1w', label: '1 week', blocks: 1008 },
    { id: '1m', label: '1 month', blocks: 4320 },
    { id: 'never', label: 'Never', blocks: 0 },
];

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} props.chainId
 * @param {string} props.tick1
 * @param {string} props.tick2
 * @param {string | null} [props.prefillPrice]       from orderbook click
 * @param {() => void} [props.onOrderPlaced]         refresh parent after placement
 */
export function PlaceOrderPanel({ walletId, chainId, tick1, tick2, prefillPrice, onOrderPlaced }) {
    const { messaging } = useMessaging();
    const [side, setSide] = useState(/** @type {'buy' | 'sell'} */ ('buy'));
    const [price, setPrice] = useState('');
    const [size, setSize] = useState('');
    const [expirationId, setExpirationId] = useState('1w');
    const [customExpiration, setCustomExpiration] = useState('');
    const [addressesByChain, setAddressesByChain] = useState(
        /** @type {Record<string, any[]> | null} */ (null),
    );
    const [fromAddressId, setFromAddressId] = useState(/** @type {string | null} */ (null));
    const [password, setPassword] = useState('');
    const [stage, setStage] = useState(/** @type {'form' | 'submitting' | 'done'} */ ('form'));
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [formError, setFormError] = useState(/** @type {string | null} */ (null));
    const [result, setResult] = useState(/** @type {any | null} */ (null));
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));

    const [hwStatus, setHwStatus] = useState('idle');
    const onHwStatusChange = useCallback(({ status }) => setHwStatus(status), []);

    useEffect(() => {
        if (prefillPrice) setPrice(prefillPrice);
    }, [prefillPrice]);

    useEffect(() => {
        let cancelled = false;
        messaging.getAddressesByChain(walletId)
            .then((byChain) => {
                if (cancelled) return;
                setAddressesByChain(byChain);
                const onChain = (byChain[chainId] || [])
                    .filter((a) => a.source === 'hd' && a.derivationPath?.split('/')?.[4] === '0');
                if (onChain.length > 0) {
                    const sorted = [...onChain].sort((a, b) => {
                        const ai = Number(a.derivationPath?.split('/')?.[5] ?? -1);
                        const bi = Number(b.derivationPath?.split('/')?.[5] ?? -1);
                        return bi - ai;
                    });
                    setFromAddressId(sorted[0].id);
                }
            })
            .catch(() => { /* surfaced via submit error on place */ });
        return () => { cancelled = true; };
    }, [messaging, walletId, chainId]);

    const fromAddress = useMemo(() => {
        if (!addressesByChain || !fromAddressId) return null;
        return (addressesByChain[chainId] || []).find((a) => a.id === fromAddressId) || null;
    }, [addressesByChain, chainId, fromAddressId]);

    const hw = isHwSource(fromAddress);

    const total = useMemo(() => {
        const p = Number(price);
        const s = Number(size);
        if (!Number.isFinite(p) || !Number.isFinite(s) || p <= 0 || s <= 0) return null;
        return p * s;
    }, [price, size]);

    const expirationBlocks = useMemo(() => {
        if (expirationId === 'custom') {
            const n = Number(customExpiration);
            if (!Number.isFinite(n) || n < 0) return null;
            return Math.floor(n);
        }
        const preset = EXPIRATION_PRESETS.find((e) => e.id === expirationId);
        return preset ? preset.blocks : null;
    }, [expirationId, customExpiration]);

    const summary = useMemo(() => {
        if (!total) return null;
        if (side === 'buy') {
            return `Give ${total} ${tick2}, get ${size} ${tick1}`;
        }
        return `Give ${size} ${tick1}, get ${total} ${tick2}`;
    }, [side, total, size, tick1, tick2]);

    function buildParams() {
        const sizeStr = String(size).trim();
        const totalStr = total == null ? '' : String(total);
        /** @type {Record<string, string>} */
        const p = { VERSION: '0' };
        if (side === 'buy') {
            p.GIVE_TICK = tick2;
            p.GIVE_AMOUNT = totalStr;
            p.GET_TICK = tick1;
            p.GET_AMOUNT = sizeStr;
        } else {
            p.GIVE_TICK = tick1;
            p.GIVE_AMOUNT = sizeStr;
            p.GET_TICK = tick2;
            p.GET_AMOUNT = totalStr;
        }
        if (expirationBlocks != null) p.EXPIRATION = String(expirationBlocks);
        return p;
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (stage === 'submitting') return;
        if (!fromAddress) {
            setFormError('No address to sign from on this chain. Use Receive first.');
            return;
        }
        if (!price.trim() || !size.trim()) {
            setFormError('Price and size are required.');
            return;
        }
        const p = Number(price);
        const s = Number(size);
        if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(s) || s <= 0) {
            setFormError('Price and size must be positive numbers.');
            return;
        }
        if (expirationBlocks === null) {
            setFormError('Expiration must be a non-negative integer (blocks).');
            return;
        }
        if (!hw && password.length === 0) {
            setFormError('Enter your password to sign.');
            return;
        }
        if (hw && hwStatus !== 'available') {
            setFormError('Connect and unlock the hardware signer first.');
            return;
        }
        setFormError(null);
        setStage('submitting');
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
                params: buildParams(),
            };
            const res = hw
                ? await messaging.orderActionHw({ ...base, signerId: fromAddress.signerId })
                : await messaging.orderAction({ ...base, password });
            setResult(res);
            setPassword('');
            setStage('done');
            onOrderPlaced?.();
        } catch (err) {
            const isBadPassword = err?.name === 'InvalidPasswordError';
            setSubmitError(
                isBadPassword
                    ? 'Incorrect password.'
                    : err?.message || 'Order placement failed.',
            );
            setStage('form');
            if (!hw) {
                passwordRef.current?.focus();
                passwordRef.current?.select();
            }
        }
    }

    if (stage === 'done') {
        const txid = result?.txid || result?.broadcast?.txid;
        return (
            <div
                style={{
                    border: '1px solid var(--xc-border)',
                    borderRadius: '4px',
                    padding: '0.75rem',
                }}
            >
                <p style={{ margin: '0 0 0.25rem', fontWeight: 600 }}>Order placed</p>
                {txid ? (
                    <p style={{ margin: 0, fontSize: '0.75rem' }}>
                        <code>{txid}</code>
                    </p>
                ) : null}
                <div style={{ marginTop: '0.5rem' }}>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setStage('form');
                            setPrice('');
                            setSize('');
                            setResult(null);
                        }}
                    >
                        Place another
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <form
            onSubmit={handleSubmit}
            noValidate
            style={{
                border: '1px solid var(--xc-border)',
                borderRadius: '4px',
                padding: '0.5rem',
            }}
        >
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>Place order</p>
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
                <Button
                    type="button"
                    variant={side === 'buy' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setSide('buy')}
                >
                    Buy {tick1}
                </Button>
                <Button
                    type="button"
                    variant={side === 'sell' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setSide('sell')}
                >
                    Sell {tick1}
                </Button>
            </div>
            <Input
                label={`Price (${tick2})`}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
            />
            <Input
                label={`Size (${tick1})`}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
            />
            <label style={{ display: 'block', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                Expiration
                <select
                    value={expirationId}
                    onChange={(e) => setExpirationId(e.target.value)}
                    style={{ marginLeft: '0.5rem' }}
                >
                    {EXPIRATION_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                    <option value="custom">Custom…</option>
                </select>
            </label>
            {expirationId === 'custom' ? (
                <Input
                    label="Custom expiration (blocks)"
                    value={customExpiration}
                    onChange={(e) => setCustomExpiration(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                />
            ) : null}
            {summary ? (
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                    {summary}
                </p>
            ) : null}
            <div style={{ marginTop: '0.5rem' }}>
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
                    disabled={stage === 'submitting'}
                    getSignerStatus={messaging.getSignerStatus}
                />
                {hw && submitError ? (
                    <p role="alert" style={{ margin: '0.25rem 0 0', color: '#ef5350', fontSize: '0.75rem' }}>
                        {submitError}
                    </p>
                ) : null}
            </div>
            {formError ? (
                <p role="alert" style={{ margin: '0.5rem 0 0', color: '#ef5350', fontSize: '0.8rem' }}>
                    {formError}
                </p>
            ) : null}
            <div style={{ marginTop: '0.5rem' }}>
                <Button
                    type="submit"
                    variant="primary"
                    loading={stage === 'submitting'}
                    disabled={
                        !fromAddress
                        || !price
                        || !size
                        || (hw ? hwStatus !== 'available' : password.length === 0)
                    }
                >
                    {hw
                        ? `${side === 'buy' ? 'Buy' : 'Sell'} on ${fromAddress?.source === 'trezor' ? 'Trezor' : 'Ledger'}`
                        : `Place ${side} order`}
                </Button>
            </div>
        </form>
    );
}
