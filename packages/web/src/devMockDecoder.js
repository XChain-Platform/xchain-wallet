export function createDevMockDecoder(decodeMockPsbt) {
    const decode = (psbtHex) => {
        const decoded = decodeMockPsbt(psbtHex);
        return decoded?.actionString
            ? { ok: true, actionString: decoded.actionString }
            : { ok: false, reason: 'decode-failed' };
    };
    return {
        decodeActionFromPsbt: decode,
        decodeActionStringFromPsbt: decode,
    };
}
