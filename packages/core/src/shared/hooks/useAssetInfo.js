import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/**
 * §27.6 + §27.5 — shared asset-metadata lookup for token-detail and
 * collectibles surfaces. Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3.
 *
 * Returns the normalized `AssetInfo` record (description, creator,
 * supply, locks, market price, extracted imageUrl) for a (chainId,
 * asset) pair, or `null` when:
 *   - `chainId` or `asset` is missing,
 *   - `messaging.getAssetInfo` isn't wired in this build,
 *   - the lookup fails (silently — caller renders "no metadata" copy).
 *
 * Module-level cache keyed by `chainId:asset` survives re-mounts inside
 * a single session so navigating Detail → back → Detail (or hovering
 * the same row in Collectibles) doesn't re-fetch.
 *
 * @param {object} args
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.asset
 * @param {boolean} [args.skip]                 caller can opt out (e.g. native coins)
 * @returns {import('../../flows/assetInfo.js').AssetInfo | null}
 */

const cache = /** @type {Map<string, any>} */ (new Map());

export function useAssetInfo({ chainId, asset, skip = false }) {
    const { messaging } = useMessaging();
    const key = chainId && asset ? `${chainId}:${asset}` : null;
    const [info, setInfo] = useState(/** @type {any} */ (
        key && cache.has(key) ? cache.get(key) : null
    ));

    useEffect(() => {
        if (skip || !key) {
            setInfo(null);
            return undefined;
        }
        if (cache.has(key)) {
            setInfo(cache.get(key));
            return undefined;
        }
        if (typeof messaging?.getAssetInfo !== 'function') return undefined;
        let cancelled = false;
        messaging.getAssetInfo({ chainId, asset })
            .then((next) => {
                if (cancelled) return;
                cache.set(key, next);
                setInfo(next);
            })
            .catch(() => { /* silent — renderer falls back to "no metadata" copy */ });
        return () => { cancelled = true; };
    }, [key, skip, messaging, chainId, asset]);

    return info;
}

/**
 * Test helper — clears the module-level asset-info cache between spec
 * runs so a stale mock doesn't leak across cases.
 */
export function __clearAssetInfoCache() {
    cache.clear();
}
