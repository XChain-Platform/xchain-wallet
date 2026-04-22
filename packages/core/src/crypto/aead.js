// AES-256-GCM via Web Crypto API — §11.4 step 2.
//
// Ciphertext format (binary concatenation):
//   [12-byte IV | ciphertext || 16-byte auth tag]
// Web Crypto's AES-GCM appends the tag to ciphertext automatically, so
// encrypted output is `iv || subtle.encrypt(...)`.

const IV_LENGTH = 12;    // GCM standard nonce length
const TAG_LENGTH = 128;  // bits — Web Crypto default; = 16 bytes

/**
 * Encrypt `plaintext` with a 256-bit key. Optional `aad` is authenticated
 * (not encrypted) and must be supplied again at decrypt time.
 *
 * @param {Uint8Array} key        32 bytes
 * @param {Uint8Array} plaintext
 * @param {Uint8Array} [aad]
 * @returns {Promise<Uint8Array>} iv || ciphertext(||tag)
 */
export async function encrypt(key, plaintext, aad) {
    assertKey(key);
    const iv = new Uint8Array(IV_LENGTH);
    crypto.getRandomValues(iv);
    const ck = await importKey(key);
    const params = buildParams(iv, aad);
    const ct = new Uint8Array(await crypto.subtle.encrypt(params, ck, plaintext));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0);
    out.set(ct, iv.length);
    return out;
}

/**
 * Decrypt a blob produced by `encrypt`. Throws on auth failure.
 *
 * @param {Uint8Array} key
 * @param {Uint8Array} blob       iv || ciphertext(||tag)
 * @param {Uint8Array} [aad]
 * @returns {Promise<Uint8Array>}
 */
export async function decrypt(key, blob, aad) {
    assertKey(key);
    if (blob.length < IV_LENGTH + TAG_LENGTH / 8) {
        throw new Error('aead: ciphertext too short');
    }
    const iv = blob.subarray(0, IV_LENGTH);
    const ct = blob.subarray(IV_LENGTH);
    const ck = await importKey(key);
    const params = buildParams(iv, aad);
    return new Uint8Array(await crypto.subtle.decrypt(params, ck, ct));
}

function assertKey(key) {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
        throw new Error('aead: key must be a 32-byte Uint8Array');
    }
}

function importKey(key) {
    return crypto.subtle.importKey('raw', key, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
    ]);
}

function buildParams(iv, aad) {
    const params = { name: 'AES-GCM', iv, tagLength: TAG_LENGTH };
    if (aad && aad.length > 0) params.additionalData = aad;
    return params;
}
