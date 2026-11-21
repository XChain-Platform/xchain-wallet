// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum QRModules {
    static func unpack(size: Int, bits: String) -> [Bool]? {
        guard size > 0 else { return nil }

        let (moduleCount, multiplicationOverflow) = size.multipliedReportingOverflow(by: size)
        guard !multiplicationOverflow else { return nil }

        let (roundedModuleCount, additionOverflow) = moduleCount.addingReportingOverflow(7)
        guard !additionOverflow else { return nil }

        guard let bytes = Data(base64Encoded: bits),
              bytes.count == roundedModuleCount / 8 else {
            return nil
        }

        return (0..<moduleCount).map { index in
            let byte = bytes[index >> 3]
            let mask = UInt8(1 << (7 - (index & 7)))
            return byte & mask != 0
        }
    }
}
