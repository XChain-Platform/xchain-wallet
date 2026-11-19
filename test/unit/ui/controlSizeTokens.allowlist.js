// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
// Literal dimensions in this list either size non-control artwork or predate
// the shared control scale. New entries require a selector-specific reason.
export const CONTROL_SIZE_LITERAL_ALLOWLIST = [
    { file: 'shared/components/LeftNav.module.css', selector: '.nav .item', property: 'min-height', value: '44px', reason: 'The operator requires identical 44px side-menu rows on desktop and iPad; responsive control tokens use different values for those pointer modes.' },
    { file: 'shared/routes/DispensersList.module.css', selector: '.iconWrap', property: 'height', value: '48px', reason: 'Dispenser artwork geometry is not a control height.' },
    { file: 'shared/routes/DispensersList.module.css', selector: '.iconImg', property: 'height', value: '48px', reason: 'Dispenser artwork geometry is not a control height.' },
    { file: 'shared/routes/History.module.css', selector: '.detailActionIcon', property: 'height', value: '32px', reason: 'History action artwork geometry is not a control height.' },
    { file: 'shared/routes/History.module.css', selector: '.detailActionFavicon', property: 'height', value: '32px', reason: 'History favicon geometry is not a control height.' },
    { file: 'shared/routes/MyLists.module.css', selector: '.iconWrap', property: 'height', value: '48px', reason: 'List artwork geometry is not a control height.' },
    { file: 'shared/components/giveGet/GiveGet.module.css', selector: '.bigAmount', property: 'height', value: '48px', reason: 'The large amount entry shares one 48px row with its token chooser so the two line up at every width.' },
    { file: 'shared/components/giveGet/GiveGet.module.css', selector: '.cardMid', property: 'min-height', value: '48px', reason: 'The amount row keeps the height of the large amount entry so the card does not jump when the entry is empty.' },
    { file: 'shared/components/giveGet/GiveGet.module.css', selector: '.cardTop', property: 'min-height', value: '28px', reason: 'The card label row layout height, not a control height.' },
    { file: 'shared/components/giveGet/GiveGet.module.css', selector: '.flip', property: 'height', value: '44px', reason: 'The swap-direction circle is a 44px pointer target overlapping the two cards; no control token is 44px.' },
    { file: 'shared/routes/Send.module.css', selector: '.heroChainOverlay', property: 'height', value: '32px', reason: 'Send hero badge artwork is not a control height.' },
    { file: 'ui/Checkbox.module.css', selector: '.root', property: 'min-height', value: '44px', reason: 'The checkbox label row keeps a 44px pointer target floor; the painted box uses the control icon token.' },
    { file: 'ui/RadioGroup.module.css', selector: '.option', property: 'min-height', value: '44px', reason: 'Each radio label row keeps a 44px pointer target floor; the painted circle uses the control icon token.' },
    { file: 'ui/AssetMark.module.css', selector: '.mark', property: 'height', value: '32px', reason: 'Phone-width asset artwork geometry is not a control height.' },
    { file: 'ui/ChainPicker.module.css', selector: '.trigger', property: 'min-height', value: '36px', reason: 'Legacy fallback declaration pending removal after the picker baseline audit.' },
    { file: 'ui/ChainPicker.module.css', selector: '.lg .trigger', property: 'min-height', value: '48px', reason: 'Legacy fallback declaration pending removal after the picker baseline audit.' },
    { file: 'ui/Skeleton.module.css', selector: '.shapeAvatar', property: 'height', value: '32px', reason: 'Skeleton avatar geometry is not a control height.' },
    { file: 'shared/components/MarketTrading.module.css', selector: '.splitTable td', property: 'height', value: '28px', reason: 'The order book table row height, a table row and not a control; the price button inside it sizes from the control token.' },
    { file: 'shared/components/TotalBalanceHero.module.css', selector: '.eye.eye', property: 'height', value: '32px', reason: 'The balance card circle buttons are ruled 32px circles (G11); no control token is 32px.' },
    { file: 'shared/components/TotalBalanceHero.module.css', selector: '.eye.eye', property: 'min-height', value: '32px', reason: 'The balance card circle buttons are ruled 32px circles (G11); no control token is 32px.' },
    { file: 'ui/QuickActionTile.module.css', selector: '.icon', property: 'height', value: '32px', reason: 'The tinted icon circle artwork inside the tile, not a control height.' },
    { file: 'ui/QuickActionTile.module.css', selector: '.tile.tile.tile.square .icon', property: 'height', value: '32px', reason: 'The tinted icon circle artwork inside the square tile, not a control height.' },
];
