// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Event sounds (wallet-unconfirmed-and-sounds §6 M4.1): the seam between the
// notification producers and the shell that can make a noise.
//
// Core decides WHICH sound a notification gets, from `settings.sounds`; the
// shell's notify adapter decides whether and how to play it. So this module
// owns the palette manifest (ids and file names, the files themselves ship
// from the web shell's `public/sounds/`), the map from a notification kind
// to the settings family the user configures, the resolver, and a wrapper
// that decorates any producer's `notify` adapter with a `sound` field.
//
// Every producer (NotificationService and the five watchers) already carries
// a `getSettings` dependency and an injected `notify`, so wrapping the adapter
// at construction covers all twelve delivered kinds without touching a
// producer. The wrapper re-reads settings per delivery, which is the
// service's own rule: a toggle takes effect on the next event, no restart.
//
// A wrapped payload carries `sound: { id, file } | null`. Adapters that know
// nothing about sounds (desktop, extension) ignore the extra field; only the
// web adapter plays it, and only on its in-app path, so a sound never
// arrives without the toast it belongs to (§6 M4.1: never the sole signal).

/** The per-family value that mutes that family while the master stays on. */
export const SOUND_NONE = 'none';

/**
 * The bundled palette. `file` is relative to the shell's sound directory
 * (`/sounds/` on web). Kinds may share a file; every family is re-pickable.
 *
 * @type {ReadonlyArray<{ id: string, label: string, file: string }>}
 */
export const SOUND_PALETTE = Object.freeze([
    Object.freeze({ id: 'chime', label: 'Chime', file: 'chime.mp3' }),
    Object.freeze({ id: 'glass', label: 'Glass', file: 'glass.mp3' }),
    Object.freeze({ id: 'bell', label: 'Bell', file: 'bell.mp3' }),
    Object.freeze({ id: 'pluck', label: 'Pluck', file: 'pluck.mp3' }),
    Object.freeze({ id: 'ping', label: 'Ping', file: 'ping.mp3' }),
    Object.freeze({ id: 'alert', label: 'Alert', file: 'alert.mp3' }),
    Object.freeze({ id: 'drop', label: 'Drop', file: 'drop.mp3' }),
    Object.freeze({ id: 'bong', label: 'Bong', file: 'bong.mp3' }),
]);

/**
 * The settings families, one per notification toggle, each with the kinds
 * it covers and its palette default. The `key` is the `sounds.perKind` key
 * and matches the `notifications.*` flag it sits beside in Settings.
 *
 * `coinpay-*` kinds sit under incomingReceipts because the service already
 * gates `coinpay-required` there ("an inbound-settlement prompt") and the
 * autopay kinds are the same obligation's other outcomes.
 *
 * @type {ReadonlyArray<{ key: string, label: string, defaultSound: string, kinds: ReadonlyArray<string> }>}
 */
export const SOUND_FAMILIES = Object.freeze([
    Object.freeze({ key: 'txConfirmations', label: 'Transaction confirmations', defaultSound: 'glass', kinds: Object.freeze(['tx-confirmed']) }),
    Object.freeze({ key: 'incomingReceipts', label: 'Incoming receipts', defaultSound: 'chime', kinds: Object.freeze(['incoming-receipt', 'coinpay-required', 'coinpay-autopaid', 'coinpay-autopay-manual']) }),
    Object.freeze({ key: 'incomingPending', label: 'Incoming pending payments', defaultSound: 'pluck', kinds: Object.freeze(['incoming-pending']) }),
    Object.freeze({ key: 'messages', label: 'Incoming messages', defaultSound: 'ping', kinds: Object.freeze(['incoming-message']) }),
    Object.freeze({ key: 'governancePolls', label: 'Governance polls', defaultSound: 'bong', kinds: Object.freeze(['governance-poll']) }),
    Object.freeze({ key: 'deadlines', label: 'Deadlines', defaultSound: 'alert', kinds: Object.freeze(['deadline', 'deadline-summary']) }),
    Object.freeze({ key: 'dispenserEscrow', label: 'Dispenser running low', defaultSound: 'alert', kinds: Object.freeze(['dispenser-escrow']) }),
    Object.freeze({ key: 'dispenserFills', label: 'Dispenser fills', defaultSound: 'drop', kinds: Object.freeze(['dispenser-fill']) }),
    Object.freeze({ key: 'orderFills', label: 'Order fills', defaultSound: 'drop', kinds: Object.freeze(['order-fill']) }),
    Object.freeze({ key: 'priceAlerts', label: 'Price alerts', defaultSound: 'bell', kinds: Object.freeze(['price-alert']) }),
]);

const FAMILY_BY_KIND = new Map();
for (const family of SOUND_FAMILIES) {
    for (const kind of family.kinds) FAMILY_BY_KIND.set(kind, family);
}
const PALETTE_BY_ID = new Map(SOUND_PALETTE.map((s) => [s.id, s]));

/**
 * The palette entry for an id, or null for `none`, an unknown id, or junk.
 *
 * @param {unknown} id
 * @returns {{ id: string, label: string, file: string } | null}
 */
export function soundById(id) {
    if (typeof id !== 'string') return null;
    return PALETTE_BY_ID.get(id) || null;
}

/**
 * The settings family a notification kind is configured under, or null for
 * a kind no picker can reach. An unreachable kind gets no sound rather than
 * a default: a sound the user cannot change is the opposite of M4.2.
 *
 * @param {unknown} kind
 * @returns {{ key: string, label: string, defaultSound: string, kinds: ReadonlyArray<string> } | null}
 */
export function familyForKind(kind) {
    if (typeof kind !== 'string') return null;
    return FAMILY_BY_KIND.get(kind) || null;
}

/**
 * The sound id a family currently resolves to, before the master toggle is
 * consulted: the stored pick when it names a palette entry or `none`, else
 * the family's default. Settings pickers render THIS so the row shows what
 * would actually play. An id the palette no longer knows falls back to the
 * default rather than to silence, so a renamed palette never mutes a user.
 *
 * @param {import('../schemas/settings.js').Settings | null | undefined} settings
 * @param {string} familyKey
 * @returns {string} a palette id or SOUND_NONE
 */
export function pickedSoundForFamily(settings, familyKey) {
    const family = SOUND_FAMILIES.find((f) => f.key === familyKey);
    if (!family) return SOUND_NONE;
    const perKind = settings && settings.sounds && settings.sounds.perKind;
    const stored = perKind && typeof perKind === 'object' ? perKind[familyKey] : undefined;
    if (stored === SOUND_NONE) return SOUND_NONE;
    if (soundById(stored)) return /** @type {string} */ (stored);
    return family.defaultSound;
}

/**
 * The sound to play for a notification of `kind`, or null when nothing
 * should play: sounds off (the default), the family muted, or a kind no
 * family covers. Quiet hours and the per-kind notification toggles are NOT
 * re-checked here, by construction: a producer only hands the adapter a
 * notification that already passed both, so a suppressed notification has
 * no sound to suppress.
 *
 * @param {import('../schemas/settings.js').Settings | null | undefined} settings
 * @param {unknown} kind
 * @returns {{ id: string, file: string } | null}
 */
export function resolveNotificationSound(settings, kind) {
    const sounds = settings && settings.sounds;
    if (!sounds || sounds.enabled !== true) return null;
    const family = familyForKind(kind);
    if (!family) return null;
    const picked = pickedSoundForFamily(settings, family.key);
    const entry = soundById(picked);
    return entry ? { id: entry.id, file: entry.file } : null;
}

/**
 * Decorate a producer's `notify` adapter so every payload carries `sound`.
 * Settings are re-read per delivery; a failed read means "no sound", never
 * a lost notification, because the sound is an ornament on the toast and
 * the toast is the thing the user must not miss.
 *
 * @template {{ kind: string }} P
 * @param {(n: P & { sound: { id: string, file: string } | null }) => (void | Promise<void>)} notify
 * @param {() => (import('../schemas/settings.js').Settings | Promise<import('../schemas/settings.js').Settings>)} getSettings
 * @returns {(n: P) => Promise<void>}
 */
export function withNotificationSound(notify, getSettings) {
    if (typeof notify !== 'function') throw new Error('withNotificationSound: notify is required');
    if (typeof getSettings !== 'function') throw new Error('withNotificationSound: getSettings is required');
    return async function notifyWithSound(payload) {
        let sound = null;
        try {
            sound = resolveNotificationSound(await getSettings(), payload && payload.kind);
        } catch {
            sound = null;
        }
        return notify({ ...payload, sound });
    };
}
