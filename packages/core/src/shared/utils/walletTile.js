// A wallet tile's look (colour, uploaded 64x64 image, shape) kept in this device's
// local storage, keyed by wallet id, so every wallet tile shows what Edit wallet saved.
// The wallet record in the vault has no field for it and no message to write
// one, so the look stays on this device and does not travel with a backup.

const KEY = 'xc.walletTile.';
// The key the review build wrote, read until the look is saved again.
const PREVIEW_KEY = 'xc.preview.walletTile.';
export const WALLET_TILE_EVENT = 'xc:wallet-tile-changed';

/** @returns {{ colour?: string, image?: string | null, shape?: 'circle' | 'rounded' }} */
export function readWalletTile(walletId) {
    try {
        const storage = globalThis.localStorage;
        const raw = storage?.getItem(KEY + walletId) ?? storage?.getItem(PREVIEW_KEY + walletId);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function writeWalletTile(walletId, tile) {
    try {
        globalThis.localStorage?.setItem(KEY + walletId, JSON.stringify(tile));
    } catch {
        // Storage refused: the tile keeps its default look.
    }
    try { window.dispatchEvent(new CustomEvent(WALLET_TILE_EVENT, { detail: { walletId } })); } catch { /* no window */ }
}

/**
 * The tile id a list's look is stored under: a list has no vault record, so
 * its chain and list index name it, and every wallet on this device shares it.
 */
export function listTileId(chainId, actionIndex) {
    return `list:${chainId}:${actionIndex}`;
}

/** The CSS radius for a tile shape; circle is the default. */
export function tileRadius(shape) {
    return shape === 'rounded' ? '24%' : '50%';
}

/**
 * The text a wallet tile shows: the first letter of each word, at most two,
 * then any number in the name.
 * "Main" -> "M", "Ann wallet 1" -> "AW1", "1234" -> "1234",
 * "Savings 2024" -> "S2024"; at most five characters.
 */
export function walletTileText(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    const numbers = words.filter((w) => /^\d+$/.test(w));
    const letters = words
        .filter((w) => !/^\d+$/.test(w))
        .map((w) => (w.match(/\p{L}|\p{N}/u) || [''])[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
    const number = numbers.length ? numbers[numbers.length - 1] : '';
    const text = `${letters}${number}`;
    return (text || 'W').slice(0, 5);
}
