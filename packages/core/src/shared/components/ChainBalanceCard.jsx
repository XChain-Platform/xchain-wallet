import { ChainBadge, MultisigBadge } from '@xchain-wallet/core/ui';
import styles from './ChainBalanceCard.module.css';

/**
 * One chain's balance summary on the Home screen.
 *
 * Renders the chain badge + per-address aggregate. For each address
 * with a `balances` payload (shape: `{ native, assets[] }`), the card
 * sums the native quantity and lists every token across every address.
 * Per-address `error` strings surface in the fallback line so a
 * partial fetch failure doesn't hide the entire chain.
 *
 * `multisig` is optional and surfaces the §22 N-of-M / scheme indicator.
 *
 * @param {object} props
 * @param {import('../../registry/validate.js').ChainDescriptor} props.descriptor
 * @param {Array<{ address: string, label: string, balances: any | null, error: string | null }>} props.entries
 * @param {{ threshold: number, cosignerCount: number, scheme: 'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2' } | null} [props.multisig]
 */
export function ChainBalanceCard({ descriptor, entries, multisig }) {
    const totals = aggregate(entries);
    const errors = entries.filter((e) => e.error);
    const allError = errors.length === entries.length && entries.length > 0;
    const native = totals.native;

    return (
        <section
            className={styles.card}
            aria-label={`${descriptor.displayName} balances`}
        >
            <header className={styles.header}>
                <ChainBadge descriptor={descriptor} size="md" />
                <span className={styles.count}>
                    {entries.length === 1
                        ? '1 address'
                        : `${entries.length} addresses`}
                </span>
                {multisig ? (
                    <MultisigBadge
                        threshold={multisig.threshold}
                        cosignerCount={multisig.cosignerCount}
                        scheme={multisig.scheme}
                        size="sm"
                    />
                ) : null}
            </header>

            {native ? (
                <div className={styles.nativeRow}>
                    <span className={styles.nativeAmount}>
                        {formatAmount(native.quantity, native.divisibility)}
                    </span>
                    <span className={styles.nativeSymbol}>{native.symbol}</span>
                </div>
            ) : null}

            {totals.assets.length > 0 ? (
                <ul className={styles.assetList} aria-label="Tokens">
                    {totals.assets.map((a) => (
                        <li key={a.asset} className={styles.assetRow}>
                            <span className={styles.assetTicker} title={a.displayName}>
                                {a.asset}
                            </span>
                            <span className={styles.assetQty}>
                                {formatAmount(a.quantity, a.divisibility)}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : null}

            {allError ? (
                <p className={styles.fallback}>
                    Balance unavailable — {errors[0].error}
                </p>
            ) : !native && totals.assets.length === 0 ? (
                <p className={styles.fallback}>No balances on this chain.</p>
            ) : null}
        </section>
    );
}

function aggregate(entries) {
    /** @type {{ symbol: string, divisibility: number, quantity: bigint } | null} */
    let nativeAcc = null;
    /** @type {Map<string, { asset: string, displayName: string, divisibility: number, quantity: bigint }>} */
    const assets = new Map();
    for (const entry of entries) {
        const b = entry.balances;
        if (!b || typeof b !== 'object') continue;
        if (b.native && b.native.quantity != null) {
            const q = safeBigInt(b.native.quantity);
            if (nativeAcc === null) {
                nativeAcc = {
                    symbol: b.native.asset || '',
                    divisibility: Number(b.native.divisibility ?? 8),
                    quantity: q,
                };
            } else {
                nativeAcc.quantity += q;
            }
        }
        if (Array.isArray(b.assets)) {
            for (const a of b.assets) {
                if (!a || typeof a.asset !== 'string') continue;
                const q = safeBigInt(a.quantity);
                const existing = assets.get(a.asset);
                if (existing) {
                    existing.quantity += q;
                } else {
                    assets.set(a.asset, {
                        asset: a.asset,
                        displayName: a.displayName || a.asset,
                        divisibility: Number(a.divisibility ?? 8),
                        quantity: q,
                    });
                }
            }
        }
    }
    return {
        native: nativeAcc
            ? {
                symbol: nativeAcc.symbol,
                divisibility: nativeAcc.divisibility,
                quantity: nativeAcc.quantity.toString(),
            }
            : null,
        assets: Array.from(assets.values())
            .map((a) => ({ ...a, quantity: a.quantity.toString() }))
            .sort((a, b) => a.asset.localeCompare(b.asset)),
    };
}

function safeBigInt(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    if (typeof v === 'string') {
        const trimmed = v.trim();
        if (!/^-?\d+$/.test(trimmed)) return 0n;
        return BigInt(trimmed);
    }
    return 0n;
}

/**
 * Format an atomic-unit string with the configured divisibility,
 * trimming trailing zeros after the decimal point. Non-divisible
 * (divisibility=0) assets render as plain integers.
 */
function formatAmount(quantityStr, divisibility) {
    const q = String(quantityStr || '0');
    if (!divisibility || divisibility <= 0) {
        return groupThousands(q);
    }
    const negative = q.startsWith('-');
    const abs = negative ? q.slice(1) : q;
    const padded = abs.padStart(divisibility + 1, '0');
    const whole = padded.slice(0, padded.length - divisibility);
    let frac = padded.slice(padded.length - divisibility);
    frac = frac.replace(/0+$/, '');
    const wholeFmt = groupThousands(whole);
    const out = frac ? `${wholeFmt}.${frac}` : wholeFmt;
    return negative ? `-${out}` : out;
}

function groupThousands(s) {
    const n = String(s);
    return n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
