// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { Icon, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { FormAction, FormFrame } from '../components/formStandard/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { TileLookFields, TILE_COLOURS } from '../components/TileLookFields.jsx';
import { listTileId, readWalletTile, tileRadius, walletTileText, writeWalletTile } from '../utils/walletTile.js';
import { neutralizeControlText } from '../utils/textHardening.js';

/**
 * Edit look: its own page for a list's icon (no editing in modals). The same
 * colour, shape and image fields Edit wallet uses, saved to the same store
 * under the list's tile id. Save stores the look and calls `onDone`; Back
 * calls `onBack` and stores nothing.
 *
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.actionIndex
 * @param {string} [props.name]          the list's name, for the preview initials
 * @param {() => void} props.onBack
 * @param {() => void} props.onDone      called after the look is stored
 */
export function ListLookForm({ chainId, actionIndex, name: nameProp, onBack, onDone }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const tileId = listTileId(chainId, actionIndex);
    const saved = readWalletTile(tileId);
    const [colour, setColour] = useState(saved.colour || TILE_COLOURS[0]);
    const [image, setImage] = useState(/** @type {string | null} */ (saved.image || null));
    const [shape, setShape] = useState(saved.shape === 'rounded' ? 'rounded' : 'circle');
    const [listName, setListName] = useState(nameProp || '');

    // The preview initials come from the list's name; a read that fails
    // leaves the generic text, which never blocks Save.
    useEffect(() => {
        if (nameProp || typeof messaging?.getListByActionIndex !== 'function') return undefined;
        let cancelled = false;
        messaging.getListByActionIndex({ chainId, actionIndex })
            .then((row) => {
                if (!cancelled && typeof row?.name === 'string' && row.name) setListName(neutralizeControlText(row.name));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [messaging, chainId, actionIndex, nameProp]);

    const displayName = listName || 'List';

    function handleSubmit(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        writeWalletTile(tileId, { colour, image, shape });
        onDone();
    }

    return (
        <Screen variant={variant} header={<PageHeader onBack={onBack} title="Edit Look" />}>
            <FormFrame
                label="Edit Look"
                onSubmit={handleSubmit}
                action={(
                    <FormAction icon={<Icon.SaveIcon />}>Save</FormAction>
                )}
            >
                <div data-flat-look-form="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-4)', minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'center' }} aria-hidden="true">
                        <span style={{ '--xc-avatar-shape': tileRadius(shape), display: 'inline-flex' }}>
                            <IdentityAvatar name={displayName} text={walletTileText(displayName)} seed={tileId} context="hero" variant="asset" tone={colour} src={image} />
                        </span>
                    </div>
                    <TileLookFields kind="list" colour={colour} onColour={setColour} shape={shape} onShape={setShape} image={image} onImage={setImage} />
                </div>
            </FormFrame>
        </Screen>
    );
}
