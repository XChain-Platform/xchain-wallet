// Read-only passthroughs to xchain-sdk's introspection surface.
// AdvancedActionsForm (§40.10) uses these to render its schema-driven
// field list and run live validation — the SDK is the source of
// truth for action names, format versions, field lists, and
// validation rules.
//
// SDK surface:
//   sdk.getActions()                           — array of action names
//   sdk.getActionFormats(action)               — { versionN: formatStr, ... }
//   sdk.getActionFields(action, version?)      — field list; without
//                                                version, returns the
//                                                union of all versions'
//                                                fields (with '...'
//                                                prefix preserved for
//                                                rest-fields)
//   sdk.validateAction(action, params)         — { valid, errors[] }

/**
 * @param {{ sdkRegistry: any, chainId: string }} params
 * @returns {Promise<string[]>}
 */
export async function listActions({ sdkRegistry, chainId }) {
    if (!sdkRegistry) throw new Error('listActions: sdkRegistry is required');
    if (!chainId) throw new Error('listActions: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getActions();
}

/**
 * @param {{ sdkRegistry: any, chainId: string, action: string }} params
 * @returns {Promise<Record<string, string>>}
 */
export async function getActionFormats({ sdkRegistry, chainId, action }) {
    if (!sdkRegistry) throw new Error('getActionFormats: sdkRegistry is required');
    if (!chainId) throw new Error('getActionFormats: chainId is required');
    if (!action) throw new Error('getActionFormats: action is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getActionFormats(action);
}

/**
 * @param {{ sdkRegistry: any, chainId: string, action: string, version?: number | string }} params
 * @returns {Promise<string[]>}
 */
export async function getActionFields({ sdkRegistry, chainId, action, version }) {
    if (!sdkRegistry) throw new Error('getActionFields: sdkRegistry is required');
    if (!chainId) throw new Error('getActionFields: chainId is required');
    if (!action) throw new Error('getActionFields: action is required');
    const sdk = sdkRegistry.get(chainId);
    if (version === undefined || version === null || version === '') {
        return sdk.getActionFields(action);
    }
    return sdk.getActionFields(action, Number(version));
}

/**
 * @param {{ sdkRegistry: any, chainId: string, action: string, params: object }} args
 * @returns {Promise<{ valid: boolean, errors: any[] }>}
 */
export async function validateActionDryRun({ sdkRegistry, chainId, action, params }) {
    if (!sdkRegistry) throw new Error('validateActionDryRun: sdkRegistry is required');
    if (!chainId) throw new Error('validateActionDryRun: chainId is required');
    if (!action) throw new Error('validateActionDryRun: action is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.validateAction(action, params || {});
}
