// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Device-local custom notification sounds. Audio bytes stay outside the vault. */

export const CUSTOM_SOUND_PREFIX = 'custom:';
export const CUSTOM_SOUND_MAX_BYTES = 2 * 1024 * 1024;
export const CUSTOM_SOUND_MAX_DURATION = 30;
export const CUSTOM_SOUND_ACCEPT = Object.freeze([
    'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac',
    '.wav', '.mp3', '.ogg', '.m4a', '.aac',
]);

const DB_NAME = 'xchain-wallet-custom-sounds';
const STORE_NAME = 'sounds';
const DB_VERSION = 1;

export function isCustomSoundId(value) {
    return typeof value === 'string' && value.startsWith(CUSTOM_SOUND_PREFIX)
        && value.length > CUSTOM_SOUND_PREFIX.length;
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Custom sound storage failed.'));
    });
}

function openDatabase(idb = globalThis.indexedDB) {
    if (!idb?.open) return Promise.reject(new Error('Custom sound storage is not available on this device.'));
    return new Promise((resolve, reject) => {
        const request = idb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('nameKey', 'nameKey', { unique: true });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('Could not open custom sound storage.'));
        request.onblocked = () => reject(new Error('Custom sound storage is busy. Try again.'));
    });
}

async function useStore(mode, operation) {
    const db = await openDatabase();
    try {
        const transaction = db.transaction(STORE_NAME, mode);
        const completion = new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onabort = () => reject(transaction.error || new Error('Custom sound storage was interrupted.'));
            transaction.onerror = () => reject(transaction.error || new Error('Custom sound storage failed.'));
        });
        try {
            const result = await operation(transaction.objectStore(STORE_NAME));
            await completion;
            return result;
        } catch (error) {
            await completion.catch(() => {});
            throw error;
        }
    } finally {
        db.close();
    }
}

export async function listCustomSounds() {
    const records = await useStore('readonly', (store) => requestResult(store.getAll()));
    return records.map(({ bytes: _bytes, nameKey: _nameKey, ...metadata }) => metadata);
}

export async function getCustomSound(id) {
    if (!isCustomSoundId(id)) return null;
    return (await useStore('readonly', (store) => requestResult(store.get(id)))) || null;
}

export async function saveCustomSound({ name, icon, duration, mimeType, bytes }) {
    const cleanName = String(name || '').trim();
    if (cleanName.length < 1 || cleanName.length > 32) throw new Error('Sound name must be 1 to 32 characters.');
    if (typeof icon !== 'string' || icon.length === 0) throw new Error('Choose an icon.');
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > CUSTOM_SOUND_MAX_BYTES) {
        throw new Error('Sound file must be 2 MB or smaller.');
    }
    if (!Number.isFinite(duration) || duration <= 0 || duration > CUSTOM_SOUND_MAX_DURATION) {
        throw new Error('Sound must be 30 seconds or shorter.');
    }
    if (!mimeAccepted(mimeType)) throw new Error('Unsupported audio type.');
    const record = {
        id: `${CUSTOM_SOUND_PREFIX}${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        name: cleanName,
        nameKey: cleanName.toLowerCase(),
        icon,
        duration,
        mimeType,
        bytes,
    };
    try {
        await useStore('readwrite', (store) => requestResult(store.add(record)));
    } catch (error) {
        if (error?.name === 'ConstraintError') {
            const duplicate = new Error('A sound with this name already exists.');
            duplicate.code = 'duplicate-name';
            throw duplicate;
        }
        throw error;
    }
    const { bytes: _bytes, nameKey: _nameKey, ...metadata } = record;
    return metadata;
}

export async function deleteCustomSound(id) {
    if (!isCustomSoundId(id)) return false;
    await useStore('readwrite', (store) => requestResult(store.delete(id)));
    return true;
}

function extensionAccepted(name) {
    return /\.(wav|mp3|ogg|m4a|aac)$/i.test(name || '');
}

function mimeAccepted(type) {
    return /^(audio\/(wav|x-wav|mpeg|mp3|ogg|mp4|x-m4a|aac|x-aac))$/i.test(type || '');
}

async function decodeWithAudioContext(bytes, env) {
    const AudioContext = env.AudioContext || env.webkitAudioContext;
    if (typeof AudioContext !== 'function') return null;
    const context = new AudioContext();
    try {
        const decoded = await context.decodeAudioData(bytes.slice(0));
        return Number(decoded?.duration);
    } finally {
        await context.close?.();
    }
}

async function decodeWithAudioElement(bytes, mimeType, env) {
    if (typeof env.Audio !== 'function' || !env.URL?.createObjectURL) {
        throw new Error('Audio decoding is not available on this device.');
    }
    const url = env.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    try {
        return await new Promise((resolve, reject) => {
            const audio = new env.Audio();
            audio.preload = 'metadata';
            audio.onloadedmetadata = () => resolve(Number(audio.duration));
            audio.onerror = () => reject(new Error('The selected file could not be decoded as audio.'));
            audio.src = url;
            audio.load?.();
        });
    } finally {
        env.URL.revokeObjectURL?.(url);
    }
}

export async function validateCustomSoundFile(file, env = globalThis) {
    if (!file) throw new Error('Choose a sound file.');
    if (file.size > CUSTOM_SOUND_MAX_BYTES) throw new Error('Sound file must be 2 MB or smaller.');
    if (!extensionAccepted(file.name) && !mimeAccepted(file.type)) {
        throw new Error('Choose a WAV, MP3, OGG, M4A, or AAC audio file.');
    }
    const bytes = await file.arrayBuffer();
    let duration;
    try {
        duration = await decodeWithAudioContext(bytes, env);
        if (duration === null) duration = await decodeWithAudioElement(bytes, file.type, env);
    } catch {
        throw new Error('The selected file could not be decoded as audio.');
    }
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('The selected file could not be decoded as audio.');
    }
    if (duration > CUSTOM_SOUND_MAX_DURATION) throw new Error('Sound must be 30 seconds or shorter.');
    return { bytes, duration, mimeType: mimeAccepted(file.type) ? file.type : 'audio/mpeg' };
}

export async function playCustomSound(id, env = globalThis) {
    const sound = await getCustomSound(id);
    if (!sound || typeof env.Audio !== 'function' || !env.URL?.createObjectURL) return false;
    const url = env.URL.createObjectURL(new Blob([sound.bytes], { type: sound.mimeType }));
    try {
        const audio = new env.Audio(url);
        const release = () => env.URL.revokeObjectURL?.(url);
        audio.addEventListener?.('ended', release, { once: true });
        audio.addEventListener?.('error', release, { once: true });
        const playing = audio.play();
        if (playing?.catch) playing.catch(release);
        return true;
    } catch {
        env.URL.revokeObjectURL?.(url);
        return false;
    }
}
