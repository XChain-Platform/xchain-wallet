const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;
const RENDER_TARGET = 0.9;
const RENDERABLE_SOURCE_TYPES = new Set([
    'gif',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'jpeg',
    'jpg',
    'png',
    'webp',
]);

function normalizedType(value) {
    return typeof value === 'string'
        ? value.trim().toLowerCase().split(';', 1)[0]
        : '';
}

export function artworkFailureCause({
    sourceType,
    contentType,
    byteLength,
    error,
    cspDirective,
} = {}) {
    const directive = normalizedType(cspDirective);
    if (/(^|\s)(img-src|connect-src)(\s|$)/.test(directive)) return 'csp';

    const errorName = normalizedType(error?.name);
    const errorMessage = normalizedType(error?.message ?? error);
    if (
        errorName === 'securityerror'
        || /taint|cross[- ]origin|origin-clean/.test(errorMessage)
    ) return 'taint';

    const types = [sourceType, contentType].map(normalizedType);
    if (types.some((type) => type === 'svg' || type === 'image/svg+xml')) return 'svg';
    if (types.some((type) => type === 'avif' || type === 'image/avif')) return 'avif';
    if (Number.isFinite(byteLength) && byteLength > MAX_ARTWORK_BYTES) return 'oversize';

    return 'unknown';
}

export function renderedShare(results) {
    const eligible = Array.isArray(results)
        ? results.filter((result) => RENDERABLE_SOURCE_TYPES.has(normalizedType(result?.sourceType)))
        : [];
    const rendered = eligible.filter((result) => result.rendered === true).length;
    const share = eligible.length === 0 ? 0 : rendered / eligible.length;

    return { share, reaches90Percent: share >= RENDER_TARGET };
}
