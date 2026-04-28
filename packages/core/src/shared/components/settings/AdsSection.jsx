// AdsSection — §35.1 + §36 Automatic Donation System panel.
//
// Master ON/OFF + per-chain config (per-tx amount, trigger threshold,
// donation address shown for verification, lifetime stats). Backed by
// `settings.ads.{enabled, perChain[chainId]}` — schema v1.
//
// Donation addresses come from each chain descriptor's
// `adsDonationAddress`. Per the §35 gap audit / §0.25.0 changelog
// these still ship as the `PLACEHOLDER_REPLACE_BEFORE_MAINNET`
// sentinel; the panel surfaces that fact rather than displaying the
// sentinel as if it were a real address.

import { registry as registryLib } from '@xchain-wallet/core';
import { InfoTip } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { ADS_DONATION_ADDRESS_PLACEHOLDER } from '../../../registry/validate.js';
import { INPUT, ROW, ROW_HINT, ROW_LABEL, STACK, Status, ToggleRow } from './_settingsPrimitives.jsx';

const chainRegistry = registryLib.defaultRegistry();

const CHAIN_BLOCK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
    padding: 'var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
};
const FIELD_ROW = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--xc-space-2)',
};
const SUBTLE = { color: 'var(--xc-text-muted)', fontSize: 'var(--xc-text-sm)' };
const NUMERIC = { ...INPUT, width: 140, textAlign: 'right' };
const ADDRESS_BOX = {
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    color: 'var(--xc-text)',
    background: 'var(--xc-bg)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    overflow: 'auto',
    wordBreak: 'break-all',
};

export function AdsSection() {
    const { settings, loading, error, update } = useSettings();
    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const chainIds = Object.keys(settings.ads.perChain).filter((cid) => {
        const d = chainRegistry.get(cid);
        if (!d) return true; // surface stale entries so they can be edited away
        return registryLib.isChainVisibleToUser(d, settings);
    }).sort();

    const onToggleEnabled = async (next) => {
        try { await update({ ads: { enabled: next } }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('ads.enabled update failed:', err);
        }
    };
    const onChainPatch = async (chainId, patch) => {
        try {
            await update({ ads: { perChain: { [chainId]: patch } } });
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`ads.perChain.${chainId} update failed:`, err);
        }
    };

    return (
        <div style={STACK}>
            <ToggleRow
                label="Automatic Donation System"
                hint="Adds a small donation to outgoing transactions when the per-chain accumulator crosses your threshold."
                checked={Boolean(settings.ads.enabled)}
                onChange={onToggleEnabled}
            />

            {chainIds.length === 0 ? (
                <Status text="No chain ADS profiles yet — they're seeded automatically when a chain is activated." />
            ) : null}

            {chainIds.map((chainId) => {
                const chainState = settings.ads.perChain[chainId];
                const descriptor = chainRegistry.get(chainId);
                const displayName = descriptor?.displayName || chainId;
                const networkSuffix = descriptor && descriptor.networkKind !== 'mainnet'
                    ? ` · ${descriptor.networkKind}`
                    : '';
                const donationAddress = descriptor?.adsDonationAddress || '';
                const isPlaceholder = donationAddress === ADS_DONATION_ADDRESS_PLACEHOLDER;
                return (
                    <div key={chainId} style={CHAIN_BLOCK}>
                        <div style={{ fontWeight: 600, color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)' }}>
                            {displayName}{networkSuffix}
                        </div>

                        <div style={FIELD_ROW}>
                            <span style={SUBTLE}>Per tx (sats)</span>
                            <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                defaultValue={chainState.perTxAmountSats}
                                onBlur={(e) => {
                                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                    onChainPatch(chainId, { perTxAmountSats: n });
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                aria-label={`${displayName} per-transaction amount`}
                                style={NUMERIC}
                                disabled={!settings.ads.enabled}
                            />
                        </div>

                        <div style={FIELD_ROW}>
                            <span style={SUBTLE}>
                                Send when accumulated (sats)
                                <InfoTip
                                    aria="Trigger threshold help"
                                    label="The wallet keeps a running per-chain donation accumulator and sends a single donation transaction once it reaches this amount. Higher thresholds amortise the network fee across more donations; too high and the donation never fires before you stop using the wallet."
                                />
                            </span>
                            <input
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                defaultValue={chainState.triggerAmountSats}
                                onBlur={(e) => {
                                    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                    onChainPatch(chainId, { triggerAmountSats: n });
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                aria-label={`${displayName} trigger threshold`}
                                style={NUMERIC}
                                disabled={!settings.ads.enabled}
                            />
                        </div>

                        <div>
                            <div style={ROW_HINT}>Donation address</div>
                            {isPlaceholder ? (
                                <div style={{ ...ADDRESS_BOX, fontStyle: 'italic', color: 'var(--xc-text-muted)' }}>
                                    Pending — real {displayName} donation address ships before mainnet GA.
                                </div>
                            ) : (
                                <div style={ADDRESS_BOX} aria-label={`${displayName} donation address`}>
                                    {donationAddress}
                                </div>
                            )}
                        </div>

                        <div style={ROW}>
                            <span style={ROW_LABEL}>Lifetime stats</span>
                            <span style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-xs)' }}>
                                {chainState.lifetimeDonatedSats.toLocaleString()} sats
                                {' · '}
                                {chainState.lifetimeTxCount} {chainState.lifetimeTxCount === 1 ? 'tx' : 'txs'}
                                {chainState.accumulatedSats > 0 ? (
                                    <>
                                        {' · '}
                                        <span style={SUBTLE}>{chainState.accumulatedSats.toLocaleString()} accumulated</span>
                                    </>
                                ) : null}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
