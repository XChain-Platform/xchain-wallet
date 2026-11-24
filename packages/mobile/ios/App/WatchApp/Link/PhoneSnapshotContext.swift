// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum PhoneSnapshotContext {
    static func read(_ context: [String: Any]) -> Data? {
        guard !context.isEmpty,
              let version = context["v"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(),
              version.compare(1) == .orderedSame,
              JSONSerialization.isValidJSONObject(context),
              let data = try? JSONSerialization.data(
                  withJSONObject: context,
                  options: [.sortedKeys]
              ),
              (try? JSONDecoder().decode(Snapshot.self, from: data)) != nil else {
            return nil
        }

        return data
    }
}
