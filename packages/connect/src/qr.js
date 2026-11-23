/**
 * QRCode for JavaScript
 *
 * Copyright (c) 2009 Kazuhiko Arase
 * Copyright (c) 2011 Ryan Day
 *
 * Licensed under the MIT license:
 * http://www.opensource.org/licenses/mit-license.php
 */

const TOTAL_CODEWORDS = [
    0,
    26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
    404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
    1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
    2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

const EC_BLOCKS = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 4,
    1, 2, 4, 4, 2, 4, 4, 4, 2, 4, 6, 5, 2, 4, 6, 6,
    2, 5, 8, 8, 4, 5, 8, 8, 4, 5, 8, 11, 4, 8, 10, 11,
    4, 9, 12, 16, 4, 9, 16, 16, 6, 10, 12, 18, 6, 10, 17, 16,
    6, 11, 16, 19, 6, 13, 18, 21, 7, 14, 21, 25, 8, 16, 20, 25,
    8, 17, 23, 25, 9, 17, 23, 34, 9, 18, 25, 30, 10, 20, 27, 32,
    12, 21, 29, 35, 12, 23, 34, 37, 12, 25, 34, 40, 13, 26, 35, 42,
    14, 28, 38, 45, 15, 29, 40, 48, 16, 31, 43, 51, 17, 33, 45, 54,
    18, 35, 48, 57, 19, 37, 51, 60, 19, 38, 53, 63, 20, 40, 56, 66,
    21, 43, 59, 70, 22, 45, 62, 74, 24, 47, 65, 77, 25, 49, 68, 81,
];

const EC_CODEWORDS = [
    7, 10, 13, 17, 10, 16, 22, 28, 15, 26, 36, 44, 20, 36, 52, 64,
    26, 48, 72, 88, 36, 64, 96, 112, 40, 72, 108, 130, 48, 88, 132, 156,
    60, 110, 160, 192, 72, 130, 192, 224, 80, 150, 224, 264,
    96, 176, 260, 308, 104, 198, 288, 352, 120, 216, 320, 384,
    132, 240, 360, 432, 144, 280, 408, 480, 168, 308, 448, 532,
    180, 338, 504, 588, 196, 364, 546, 650, 224, 416, 600, 700,
    224, 442, 644, 750, 252, 476, 690, 816, 270, 504, 750, 900,
    300, 560, 810, 960, 312, 588, 870, 1050, 336, 644, 952, 1110,
    360, 700, 1020, 1200, 390, 728, 1050, 1260, 420, 784, 1140, 1350,
    450, 812, 1200, 1440, 480, 868, 1290, 1530, 510, 924, 1350, 1620,
    540, 980, 1440, 1710, 570, 1036, 1530, 1800, 570, 1064, 1590, 1890,
    600, 1120, 1680, 1980, 630, 1204, 1770, 2100, 660, 1260, 1860, 2220,
    720, 1316, 1950, 2310, 750, 1372, 2040, 2430,
];

const LEVELS = {
    L: { index: 0, bit: 1 },
    M: { index: 1, bit: 0 },
    Q: { index: 2, bit: 3 },
    H: { index: 3, bit: 2 },
};

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let fieldValue = 1;
for (let i = 0; i < 255; i += 1) {
    EXP[i] = fieldValue;
    LOG[fieldValue] = i;
    fieldValue <<= 1;
    if (fieldValue & 0x100) fieldValue ^= 0x11D;
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];

function multiplyField(left, right) {
    return left === 0 || right === 0 ? 0 : EXP[LOG[left] + LOG[right]];
}

function multiplyPolynomials(left, right) {
    const result = new Uint8Array(left.length + right.length - 1);
    for (let i = 0; i < left.length; i += 1) {
        for (let j = 0; j < right.length; j += 1) {
            result[i + j] ^= multiplyField(left[i], right[j]);
        }
    }
    return result;
}

function generatorPolynomial(degree) {
    let result = new Uint8Array([1]);
    for (let i = 0; i < degree; i += 1) {
        result = multiplyPolynomials(result, new Uint8Array([1, EXP[i]]));
    }
    return result;
}

function errorCorrection(data, degree) {
    const generator = generatorPolynomial(degree);
    const result = new Uint8Array(data.length + degree);
    result.set(data);
    for (let offset = 0; offset < data.length; offset += 1) {
        const coefficient = result[offset];
        if (coefficient === 0) continue;
        for (let i = 0; i < generator.length; i += 1) {
            result[offset + i] ^= multiplyField(generator[i], coefficient);
        }
    }
    return result.slice(data.length);
}

class BitBuffer {
    constructor() {
        this.bytes = [];
        this.length = 0;
    }

    put(value, length) {
        for (let i = length - 1; i >= 0; i -= 1) this.putBit((value >>> i) & 1);
    }

    putBit(value) {
        const byte = Math.floor(this.length / 8);
        if (this.bytes.length <= byte) this.bytes.push(0);
        if (value) this.bytes[byte] |= 0x80 >>> (this.length % 8);
        this.length += 1;
    }
}

class Matrix {
    constructor(size) {
        this.size = size;
        this.data = new Uint8Array(size * size);
        this.reserved = new Uint8Array(size * size);
    }

    set(row, col, value, reserved = false) {
        const index = row * this.size + col;
        this.data[index] = value ? 1 : 0;
        if (reserved) this.reserved[index] = 1;
    }

    get(row, col) {
        return this.data[row * this.size + col];
    }

    isReserved(row, col) {
        return this.reserved[row * this.size + col] === 1;
    }
}

function countBits(value) {
    let bits = 0;
    while (value !== 0) {
        bits += 1;
        value >>>= 1;
    }
    return bits;
}

function characterCountBits(version) {
    return version < 10 ? 8 : 16;
}

function dataCapacity(version, level) {
    return TOTAL_CODEWORDS[version] - EC_CODEWORDS[(version - 1) * 4 + level.index];
}

function fits(byteLength, version, level) {
    return 4 + characterCountBits(version) + byteLength * 8 <= dataCapacity(version, level) * 8;
}

function chooseVersion(byteLength, level) {
    for (let version = 1; version <= 40; version += 1) {
        if (fits(byteLength, version, level)) return version;
    }
    throw new RangeError('Text does not fit in a version 40 QR code');
}

function makeCodewords(bytes, version, level) {
    const dataCount = dataCapacity(version, level);
    const buffer = new BitBuffer();
    buffer.put(4, 4);
    buffer.put(bytes.length, characterCountBits(version));
    for (const byte of bytes) buffer.put(byte, 8);
    if (buffer.length + 4 <= dataCount * 8) buffer.put(0, 4);
    while (buffer.length % 8 !== 0) buffer.putBit(0);
    const paddingBytes = dataCount - buffer.bytes.length;
    for (let i = 0; i < paddingBytes; i += 1) {
        buffer.put(i % 2 === 0 ? 0xEC : 0x11, 8);
    }

    const totalCount = TOTAL_CODEWORDS[version];
    const blockCount = EC_BLOCKS[(version - 1) * 4 + level.index];
    const groupTwoBlocks = totalCount % blockCount;
    const groupOneBlocks = blockCount - groupTwoBlocks;
    const groupOneDataCount = Math.floor(dataCount / blockCount);
    const ecCount = Math.floor(totalCount / blockCount) - groupOneDataCount;
    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;

    for (let block = 0; block < blockCount; block += 1) {
        const length = groupOneDataCount + (block >= groupOneBlocks ? 1 : 0);
        const data = new Uint8Array(buffer.bytes.slice(offset, offset + length));
        dataBlocks.push(data);
        ecBlocks.push(errorCorrection(data, ecCount));
        offset += length;
    }

    const result = new Uint8Array(totalCount);
    let resultOffset = 0;
    for (let i = 0; i <= groupOneDataCount; i += 1) {
        for (const block of dataBlocks) {
            if (i < block.length) result[resultOffset++] = block[i];
        }
    }
    for (let i = 0; i < ecCount; i += 1) {
        for (const block of ecBlocks) result[resultOffset++] = block[i];
    }
    return result;
}

function setupFinder(matrix) {
    const positions = [[0, 0], [matrix.size - 7, 0], [0, matrix.size - 7]];
    for (const [row, col] of positions) {
        for (let r = -1; r <= 7; r += 1) {
            if (row + r < 0 || row + r >= matrix.size) continue;
            for (let c = -1; c <= 7; c += 1) {
                if (col + c < 0 || col + c >= matrix.size) continue;
                const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6))
                    || (c >= 0 && c <= 6 && (r === 0 || r === 6))
                    || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                matrix.set(row + r, col + c, dark, true);
            }
        }
    }
}

function setupTiming(matrix) {
    for (let offset = 8; offset < matrix.size - 8; offset += 1) {
        matrix.set(offset, 6, offset % 2 === 0, true);
        matrix.set(6, offset, offset % 2 === 0, true);
    }
}

function alignmentCoordinates(version, size) {
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    const interval = size === 145 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
    const positions = [size - 7];
    for (let i = 1; i < count - 1; i += 1) positions[i] = positions[i - 1] - interval;
    positions.push(6);
    return positions.reverse();
}

function setupAlignment(matrix, version) {
    const positions = alignmentCoordinates(version, matrix.size);
    for (let rowIndex = 0; rowIndex < positions.length; rowIndex += 1) {
        for (let colIndex = 0; colIndex < positions.length; colIndex += 1) {
            const overlapsFinder = (rowIndex === 0 && colIndex === 0)
                || (rowIndex === 0 && colIndex === positions.length - 1)
                || (rowIndex === positions.length - 1 && colIndex === 0);
            if (overlapsFinder) continue;
            const row = positions[rowIndex];
            const col = positions[colIndex];
            for (let r = -2; r <= 2; r += 1) {
                for (let c = -2; c <= 2; c += 1) {
                    matrix.set(row + r, col + c,
                        Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0), true);
                }
            }
        }
    }
}

function bch(value, polynomial) {
    const polynomialBits = countBits(polynomial);
    let remainder = value;
    while (countBits(remainder) - polynomialBits >= 0) {
        remainder ^= polynomial << (countBits(remainder) - polynomialBits);
    }
    return remainder;
}

function setupFormat(matrix, level, mask) {
    const value = (level.bit << 3) | mask;
    const bits = ((value << 10) | bch(value << 10, 0x537)) ^ 0x5412;
    for (let i = 0; i < 15; i += 1) {
        const dark = ((bits >>> i) & 1) === 1;
        const verticalRow = i < 6 ? i : (i < 8 ? i + 1 : matrix.size - 15 + i);
        const horizontalCol = i < 8 ? matrix.size - i - 1 : (i === 8 ? 7 : 14 - i);
        matrix.set(verticalRow, 8, dark, true);
        matrix.set(8, horizontalCol, dark, true);
    }
    matrix.set(matrix.size - 8, 8, true, true);
}

function setupVersion(matrix, version) {
    if (version < 7) return;
    const bits = (version << 12) | bch(version << 12, 0x1F25);
    for (let i = 0; i < 18; i += 1) {
        const row = Math.floor(i / 3);
        const col = i % 3 + matrix.size - 11;
        const dark = ((bits >>> i) & 1) === 1;
        matrix.set(row, col, dark, true);
        matrix.set(col, row, dark, true);
    }
}

function setupData(matrix, codewords) {
    let direction = -1;
    let row = matrix.size - 1;
    let bit = 7;
    let byte = 0;
    for (let col = matrix.size - 1; col > 0; col -= 2) {
        if (col === 6) col -= 1;
        while (true) {
            for (let offset = 0; offset < 2; offset += 1) {
                if (matrix.isReserved(row, col - offset)) continue;
                const dark = byte < codewords.length && ((codewords[byte] >>> bit) & 1) === 1;
                matrix.set(row, col - offset, dark);
                bit -= 1;
                if (bit === -1) {
                    byte += 1;
                    bit = 7;
                }
            }
            row += direction;
            if (row < 0 || row >= matrix.size) {
                row -= direction;
                direction = -direction;
                break;
            }
        }
    }
}

function maskAt(mask, row, col) {
    switch (mask) {
        case 0: return (row + col) % 2 === 0;
        case 1: return row % 2 === 0;
        case 2: return col % 3 === 0;
        case 3: return (row + col) % 3 === 0;
        case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
        case 5: return (row * col) % 2 + (row * col) % 3 === 0;
        case 6: return ((row * col) % 2 + (row * col) % 3) % 2 === 0;
        case 7: return ((row * col) % 3 + (row + col) % 2) % 2 === 0;
        default: throw new RangeError('QR mask must be an integer from 0 to 7');
    }
}

function applyMask(matrix, mask) {
    for (let row = 0; row < matrix.size; row += 1) {
        for (let col = 0; col < matrix.size; col += 1) {
            if (!matrix.isReserved(row, col) && maskAt(mask, row, col)) {
                matrix.data[row * matrix.size + col] ^= 1;
            }
        }
    }
}

function penalty(matrix) {
    let score = 0;
    for (let outer = 0; outer < matrix.size; outer += 1) {
        let lastRow = -1;
        let lastCol = -1;
        let rowRun = 0;
        let colRun = 0;
        let rowBits = 0;
        let colBits = 0;
        for (let inner = 0; inner < matrix.size; inner += 1) {
            const rowValue = matrix.get(outer, inner);
            const colValue = matrix.get(inner, outer);
            if (rowValue === lastRow) rowRun += 1;
            else {
                if (rowRun >= 5) score += 3 + rowRun - 5;
                lastRow = rowValue;
                rowRun = 1;
            }
            if (colValue === lastCol) colRun += 1;
            else {
                if (colRun >= 5) score += 3 + colRun - 5;
                lastCol = colValue;
                colRun = 1;
            }
            rowBits = ((rowBits << 1) & 0x7FF) | rowValue;
            colBits = ((colBits << 1) & 0x7FF) | colValue;
            if (inner >= 10 && (rowBits === 0x5D0 || rowBits === 0x05D)) score += 40;
            if (inner >= 10 && (colBits === 0x5D0 || colBits === 0x05D)) score += 40;
        }
        if (rowRun >= 5) score += 3 + rowRun - 5;
        if (colRun >= 5) score += 3 + colRun - 5;
    }

    for (let row = 0; row < matrix.size - 1; row += 1) {
        for (let col = 0; col < matrix.size - 1; col += 1) {
            const block = matrix.get(row, col) + matrix.get(row, col + 1)
                + matrix.get(row + 1, col) + matrix.get(row + 1, col + 1);
            if (block === 0 || block === 4) score += 3;
        }
    }

    let dark = 0;
    for (const value of matrix.data) dark += value;
    return score + Math.abs(Math.ceil((dark * 100 / matrix.data.length) / 5) - 10) * 10;
}

function chooseMask(matrix, level) {
    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
        setupFormat(matrix, level, mask);
        applyMask(matrix, mask);
        const score = penalty(matrix);
        applyMask(matrix, mask);
        if (score < bestPenalty) {
            bestPenalty = score;
            bestMask = mask;
        }
    }
    return bestMask;
}

export function encodeQr(text, { ecl = 'L', mask, version } = {}) {
    if (typeof text !== 'string') throw new TypeError('QR text must be a string');
    const level = LEVELS[String(ecl).toUpperCase()];
    if (!level) throw new RangeError('QR error correction level must be L, M, Q, or H');
    if (version !== undefined && (!Number.isInteger(version) || version < 1 || version > 40)) {
        throw new RangeError('QR version must be an integer from 1 to 40');
    }
    if (mask !== undefined && (!Number.isInteger(mask) || mask < 0 || mask > 7)) {
        throw new RangeError('QR mask must be an integer from 0 to 7');
    }

    const bytes = new TextEncoder().encode(text);
    const chosenVersion = version ?? chooseVersion(bytes.length, level);
    if (!fits(bytes.length, chosenVersion, level)) {
        throw new RangeError(`Text does not fit in QR version ${chosenVersion}`);
    }

    const size = 17 + 4 * chosenVersion;
    const matrix = new Matrix(size);
    setupFinder(matrix);
    setupTiming(matrix);
    setupAlignment(matrix, chosenVersion);
    setupFormat(matrix, level, 0);
    setupVersion(matrix, chosenVersion);
    setupData(matrix, makeCodewords(bytes, chosenVersion, level));
    const chosenMask = mask ?? chooseMask(matrix, level);
    applyMask(matrix, chosenMask);
    setupFormat(matrix, level, chosenMask);

    return {
        version: chosenVersion,
        size,
        modules: Array.from({ length: size }, (_, row) => Array.from(
            matrix.data.slice(row * size, (row + 1) * size),
            Boolean
        )),
    };
}
