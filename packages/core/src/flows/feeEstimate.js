// Fee estimate — bridge between the §21.2 simulator, the §29.2 Max
// button, and the §44.2 user-selectable fee tiers.
//
// Three speed tiers per chain (low / normal / fast) sized for a
// typical 1-input / 2-output SEND tx. Plus a "custom" mode the
// FeeSelector exposes for power users — it accepts a sat/vB rate (or
// DOGE/kB rate) and recomputes the absolute fee.
//
// Values are STATIC PLACEHOLDERS marked as such. When the SDK exposes
// a real fee endpoint (Step 4 of this cluster), this flow probes for
// it and swaps the source while keeping the same return shape —
// callers don't relearn the contract.
//
// Output is always `{ sats, source, confidence, ... }`. `source` is
// the truthful provenance of the value; surfaces show it next to the
// number so the user understands what they're looking at.

/**
 * Per-chain fee tier table. Each tier has a sat/vB or DOGE/kB rate.
 * `txSize` is the assumed virtual size in vbytes (BTC/LTC) or raw
 * bytes (DOGE — its minrelayfee is denominated per-kB of raw size).
 */
const PLACEHOLDER_FEE_TIERS = /** @type {const} */ ({
    bitcoin: {
        txSize: 250,
        unit: 'sat/vB',
        tiers: {
            low: { rate: 1, label: 'Low', etaMinutes: 60 },
            normal: { rate: 6, label: 'Normal', etaMinutes: 30 },
            fast: { rate: 12, label: 'Fast', etaMinutes: 10 },
        },
    },
    litecoin: {
        txSize: 250,
        unit: 'sat/vB',
        tiers: {
            low: { rate: 1, label: 'Low', etaMinutes: 5 },
            normal: { rate: 1, label: 'Normal', etaMinutes: 3 },
            fast: { rate: 2, label: 'Fast', etaMinutes: 2 },
        },
    },
    dogecoin: {
        // DOGE minrelayfee 1 DOGE/kB → 100_000_000 koinu/kB ≈
        // 100_000 koinu/B. Tier rates are koinu per byte.
        txSize: 250,
        unit: 'DOGE/kB',
        tiers: {
            // Below mainnet's minrelayfee. Many nodes will reject;
            // included only because some Doge nodes still relax it.
            low: { rate: 10_000, label: 'Low', etaMinutes: 5 },
            normal: { rate: 100_000, label: 'Normal', etaMinutes: 1 },
            fast: { rate: 200_000, label: 'Fast', etaMinutes: 1 },
        },
    },
});

const DEFAULT_SPEED = 'normal';

/**
 * @typedef {'low' | 'normal' | 'fast'} FeeSpeed
 */

/**
 * @typedef {object} FeeEstimate
 * @property {number} sats          absolute fee in coin base units (sats / koinu)
 * @property {string} coinAmount    same value as a decimal string at coin scale
 * @property {'static-placeholder' | 'sdk' | 'user'} source
 * @property {'low' | 'medium' | 'high'} confidence
 * @property {string} [rate]        human display, e.g., "6 sat/vB"
 * @property {string} [unit]        rate unit ('sat/vB' or 'DOGE/kB')
 * @property {number} [rateValue]   numeric rate at chain's native unit granularity
 * @property {number} [vsize]       assumed virtual size in bytes
 * @property {FeeSpeed} [speed]     tier this estimate corresponds to
 * @property {number} [etaMinutes]  approximate ETA at this rate
 */

/**
 * Estimate the network fee at a given speed tier.
 *
 * @param {object} opts
 * @param {string} opts.chainId
 * @param {{ get: (id: string) => any }} opts.chainRegistry
 * @param {FeeSpeed} [opts.speed]   default 'normal'
 * @returns {FeeEstimate | null}
 */
export function estimateNativeSendFee({ chainId, chainRegistry, speed = DEFAULT_SPEED } = {}) {
    if (typeof chainId !== 'string' || !chainRegistry) return null;
    const desc = chainRegistry.get(chainId);
    const coin = desc?.coin;
    if (!coin) return null;
    const table = PLACEHOLDER_FEE_TIERS[coin];
    if (!table) {
        return {
            sats: 0,
            coinAmount: '0',
            source: 'static-placeholder',
            confidence: 'low',
            speed,
        };
    }
    const tier = table.tiers[speed] ?? table.tiers[DEFAULT_SPEED];
    const sats = computeSats(table, tier.rate);
    return {
        sats,
        coinAmount: satsToCoinDecimal(sats),
        source: 'static-placeholder',
        confidence: 'low',
        rate: formatRate(table.unit, tier.rate),
        unit: table.unit,
        // §44.7 — rateValue is the user-displayed value in the chain's
        // natural unit (sat/vB for BTC/LTC, DOGE/kB for DOGE). Custom
        // mode echoes this value back through the input verbatim.
        rateValue: perByteRateToDisplay(table.unit, tier.rate),
        vsize: table.txSize,
        speed,
        etaMinutes: tier.etaMinutes,
    };
}

/**
 * Return the full set of `{ low, normal, fast }` estimates for a chain.
 * The FeeSelector primitive uses this to render the three preset
 * buttons; Send.jsx uses it to back the simulator + Max with the
 * user's chosen tier.
 *
 * @param {object} opts
 * @param {string} opts.chainId
 * @param {{ get: (id: string) => any }} opts.chainRegistry
 * @returns {{ low: FeeEstimate, normal: FeeEstimate, fast: FeeEstimate, unit: string } | null}
 */
export function estimateNativeSendFeeTiers({ chainId, chainRegistry } = {}) {
    if (typeof chainId !== 'string' || !chainRegistry) return null;
    const desc = chainRegistry.get(chainId);
    const coin = desc?.coin;
    if (!coin) return null;
    const table = PLACEHOLDER_FEE_TIERS[coin];
    if (!table) return null;
    return {
        low: estimateNativeSendFee({ chainId, chainRegistry, speed: 'low' }),
        normal: estimateNativeSendFee({ chainId, chainRegistry, speed: 'normal' }),
        fast: estimateNativeSendFee({ chainId, chainRegistry, speed: 'fast' }),
        unit: table.unit,
    };
}

/**
 * Build a custom-rate FeeEstimate. The FeeSelector's "Custom" mode
 * feeds this — user enters a rate in the displayed unit (sat/vB for
 * BTC/LTC, DOGE/kB for DOGE), this function converts to per-byte
 * internally and recomputes the absolute fee. §44.7.
 *
 * @param {object} opts
 * @param {string} opts.chainId
 * @param {{ get: (id: string) => any }} opts.chainRegistry
 * @param {number} opts.rate                   in chain's DISPLAYED unit
 * @returns {FeeEstimate | null}
 */
export function customFeeEstimate({ chainId, chainRegistry, rate } = {}) {
    if (typeof chainId !== 'string' || !chainRegistry) return null;
    if (!Number.isFinite(rate) || rate < 0) return null;
    const desc = chainRegistry.get(chainId);
    const coin = desc?.coin;
    if (!coin) return null;
    const table = PLACEHOLDER_FEE_TIERS[coin];
    if (!table) return null;
    const ratePerByte = displayRateToPerByte(table.unit, rate);
    const sats = computeSats(table, ratePerByte);
    return {
        sats,
        coinAmount: satsToCoinDecimal(sats),
        source: 'user',
        confidence: 'high',
        rate: formatRate(table.unit, ratePerByte),
        unit: table.unit,
        rateValue: rate, // keep the user-typed value so the input echoes back unchanged
        vsize: table.txSize,
        speed: undefined,
    };
}

/**
 * Convert a per-byte rate (the table's internal granularity) to the
 * user-displayed value in the chain's natural unit. Inverse of
 * `displayRateToPerByte`. Useful when porting tier defaults into the
 * custom input.
 *
 * @param {string} unit
 * @param {number} ratePerByte
 * @returns {number}
 */
export function perByteRateToDisplay(unit, ratePerByte) {
    if (!Number.isFinite(ratePerByte)) return 0;
    if (unit === 'DOGE/kB') {
        // koinu/byte × 1000 bytes / 100_000_000 koinu/DOGE
        return Number(((ratePerByte * 1000) / 1e8).toFixed(8));
    }
    return ratePerByte;
}

/**
 * Convert a user-typed rate in the displayed unit back to per-byte.
 *
 * @param {string} unit
 * @param {number} displayValue
 * @returns {number}
 */
export function displayRateToPerByte(unit, displayValue) {
    if (!Number.isFinite(displayValue)) return 0;
    if (unit === 'DOGE/kB') {
        // DOGE/kB × 100_000_000 koinu/DOGE / 1000 bytes/kB
        return (displayValue * 1e8) / 1000;
    }
    return displayValue;
}

/**
 * Async variant: probe the shell's messaging layer for a real fee
 * source before falling back to the placeholder table. The first
 * shell that registers `estimateFee` (the §44 SDK / encoder work)
 * starts feeding the FeeSelector + simulator with live rates; until
 * then, callers see exactly the same `static-placeholder`-flagged
 * values as the sync `estimateNativeSendFee`.
 *
 * SDK contract (when it lands):
 *   `messaging.estimateFee({ chainId })` → `{ low, normal, fast, unit, sourceLabel? }`
 *   where each tier is `{ rate, etaMinutes? }` in the chain's
 *   per-byte unit (sat/vB / koinu/byte). The flow shapes this into
 *   the same `FeeEstimate` callers already consume.
 *
 * @param {object} opts
 * @param {{ estimateFee?: (req: { chainId: string }) => Promise<{ low?: { rate: number, etaMinutes?: number }, normal?: { rate: number, etaMinutes?: number }, fast?: { rate: number, etaMinutes?: number }, unit?: string } | null> }} [opts.messaging]
 * @param {string} opts.chainId
 * @param {{ get: (id: string) => any }} opts.chainRegistry
 * @returns {Promise<{ low: FeeEstimate, normal: FeeEstimate, fast: FeeEstimate, unit: string } | null>}
 */
export async function fetchNativeSendFeeTiers({ messaging, chainId, chainRegistry } = {}) {
    if (typeof chainId !== 'string' || !chainRegistry) return null;
    const desc = chainRegistry.get(chainId);
    const coin = desc?.coin;
    if (!coin) return null;
    const table = PLACEHOLDER_FEE_TIERS[coin];
    if (!table) return null;

    if (messaging && typeof messaging.estimateFee === 'function') {
        try {
            const sdk = await messaging.estimateFee({ chainId });
            if (sdk && typeof sdk === 'object') {
                const unit = typeof sdk.unit === 'string' ? sdk.unit : table.unit;
                return {
                    low: shapeSdkTier({ table, sdk: sdk.low, unit, fallback: table.tiers.low, speed: 'low' }),
                    normal: shapeSdkTier({ table, sdk: sdk.normal, unit, fallback: table.tiers.normal, speed: 'normal' }),
                    fast: shapeSdkTier({ table, sdk: sdk.fast, unit, fallback: table.tiers.fast, speed: 'fast' }),
                    unit,
                };
            }
        } catch {
            // SDK refused / errored — silently fall through to the placeholder.
        }
    }

    return estimateNativeSendFeeTiers({ chainId, chainRegistry });
}

function shapeSdkTier({ table, sdk, unit, fallback, speed }) {
    const live = sdk && typeof sdk === 'object' && Number.isFinite(sdk.rate);
    const ratePerByte = live ? sdk.rate : fallback.rate;
    const sats = computeSats(table, ratePerByte);
    return {
        sats,
        coinAmount: satsToCoinDecimal(sats),
        source: live ? 'sdk' : 'static-placeholder',
        confidence: live ? 'high' : 'low',
        rate: formatRate(unit, ratePerByte),
        unit,
        rateValue: perByteRateToDisplay(unit, ratePerByte),
        vsize: table.txSize,
        speed,
        etaMinutes: live && Number.isFinite(sdk.etaMinutes) ? sdk.etaMinutes : fallback.etaMinutes,
    };
}

function computeSats(table, ratePerByte) {
    return Math.ceil(ratePerByte * table.txSize);
}

function formatRate(unit, value) {
    if (unit === 'DOGE/kB') {
        // value is koinu/byte; convert to DOGE/kB for display.
        const dogePerKb = (value * 1000) / 1e8;
        return `${trimNumber(dogePerKb)} DOGE/kB`;
    }
    return `${trimNumber(value)} ${unit}`;
}

function trimNumber(n) {
    const s = Number(n.toFixed(8)).toString();
    return s;
}

/**
 * Convert sats (BTC/LTC/DOGE base unit; 8 decimals) to a tidy decimal
 * string at coin scale. Trailing zeros stripped for display; the value
 * is exact.
 *
 * @param {number} sats
 * @returns {string}
 */
export function satsToCoinDecimal(sats) {
    if (!Number.isFinite(sats) || sats < 0) return '0';
    if (sats === 0) return '0';
    const intPart = Math.floor(sats / 1e8);
    const fracPart = sats - intPart * 1e8;
    if (fracPart === 0) return String(intPart);
    const frac = String(fracPart).padStart(8, '0').replace(/0+$/, '');
    return `${intPart}.${frac}`;
}
