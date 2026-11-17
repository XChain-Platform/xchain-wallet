// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A contact's tile look as every screen reads it. The look is stored on the
// contact record (`look`, the same { colour, shape, image } that Edit Wallet
// and Edit Account keep in readWalletTile); a contact saved before looks could
// be edited has none, and reads as the default it always showed: its initials,
// the colour picked from its avatar seed, a circle. Nothing is rewritten on
// read, so such a contact keeps its version until the user saves it.

/** The seed that picks a contact's default colour (as View Contact always used). */
export function contactAvatarSeed(contact) {
    return String(contact?.avatarSeed || contact?.id || '');
}

/**
 * The stored look, normalised. A null field means "the default": no colour
 * keeps the seed-picked colour, no shape keeps the circle, no image shows the
 * initials.
 *
 * @param {{ look?: { colour?: string | null, shape?: string, image?: string | null } } | null | undefined} contact
 * @returns {{ colour: string | null, shape: 'circle' | 'rounded' | null, image: string | null }}
 */
export function readContactLook(contact) {
    const look = contact && typeof contact.look === 'object' && contact.look !== null ? contact.look : {};
    return {
        colour: typeof look.colour === 'string' && look.colour ? look.colour : null,
        shape: look.shape === 'rounded' || look.shape === 'circle' ? look.shape : null,
        image: typeof look.image === 'string' && look.image ? look.image : null,
    };
}

/** Whether two looks (as readContactLook returns them) draw the same tile. */
export function sameContactLook(a, b) {
    return (a?.colour ?? null) === (b?.colour ?? null)
        && (a?.shape || 'circle') === (b?.shape || 'circle')
        && (a?.image ?? null) === (b?.image ?? null);
}
