// @xchain-wallet/bridge-spec
//
// Type definitions for the window.xchain dApp bridge.
// Full API surface defined in SPEC.md §43.
//
// This package is TypeScript-first so third-party dApp developers can
// consume strong types when integrating. Runtime wallet code uses
// JavaScript with JSDoc types per the rest of the XChain Platform.

export interface XChainProvider {
    readonly version: string;
    readonly isXChainWallet: boolean;
}
