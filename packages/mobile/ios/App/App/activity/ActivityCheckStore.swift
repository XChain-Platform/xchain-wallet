// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

enum ActivityCheckStoreError: Error {
    case invalidConfig
}

final class ActivityCheckStore {
    typealias ProtectionApplier = (URL, FileProtectionType, Bool) throws -> Void

    private static let directoryName = "activity-check"
    private static let configFile = "activity-check.json"

    let directory: URL
    private let files: ActivityCheckFiles
    private let fileManager: FileManager
    private let applyProtection: ProtectionApplier

    init(fileManager: FileManager = .default) throws {
        let support = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        self.directory = support.appendingPathComponent(Self.directoryName, isDirectory: true)
        self.files = ActivityCheckFiles(directory: directory)
        self.fileManager = fileManager
        self.applyProtection = { url, protection, excludedFromBackup in
            try Self.protect(
                url,
                fileManager: fileManager,
                protection: protection,
                excludedFromBackup: excludedFromBackup
            )
        }
    }

    init(
        directory: URL,
        fileManager: FileManager = .default,
        applyProtection: ProtectionApplier? = nil
    ) {
        self.directory = directory
        self.files = ActivityCheckFiles(directory: directory)
        self.fileManager = fileManager
        self.applyProtection = applyProtection ?? { url, protection, excludedFromBackup in
            try Self.protect(
                url,
                fileManager: fileManager,
                protection: protection,
                excludedFromBackup: excludedFromBackup
            )
        }
    }

    func setActivityCheck(_ json: String) throws {
        let publicJSON = try Self.publicConfig(json)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try applyProtection(directory, .completeUntilFirstUserAuthentication, true)

        let configURL = directory.appendingPathComponent(Self.configFile)
        let temporaryURL = directory.appendingPathComponent(
            ".activity-check-\(UUID().uuidString).tmp"
        )

        do {
            try Data(publicJSON.utf8).write(to: temporaryURL, options: .withoutOverwriting)
            try applyProtection(
                temporaryURL,
                .completeUntilFirstUserAuthentication,
                true
            )
            if fileManager.fileExists(atPath: configURL.path) {
                _ = try fileManager.replaceItemAt(configURL, withItemAt: temporaryURL)
            } else {
                try fileManager.moveItem(at: temporaryURL, to: configURL)
            }
        } catch {
            try? fileManager.removeItem(at: temporaryURL)
            throw error
        }
    }

    func runLog() -> [Int64] {
        files.runLog()
    }

    func clear() -> Bool {
        files.clear()
    }

    private static func protect(
        _ url: URL,
        fileManager: FileManager,
        protection: FileProtectionType,
        excludedFromBackup: Bool
    ) throws {
        try fileManager.setAttributes(
            [.protectionKey: protection],
            ofItemAtPath: url.path
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = excludedFromBackup
        var protectedURL = url
        try protectedURL.setResourceValues(values)
    }

    private static func publicConfig(_ json: String) throws -> String {
        guard
            let data = json.data(using: .utf8),
            let input = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let enabled = input["enabled"] as? NSNumber,
            CFGetTypeID(enabled) == CFBooleanGetTypeID(),
            let inputTargets = input["targets"] as? [[String: Any]],
            let inputNotice = input["notice"] as? [String: Any],
            let noticeTitle = inputNotice["title"] as? String,
            let noticeBody = inputNotice["body"] as? String,
            let openTitle = input["openOnPhoneTitle"] as? String
        else {
            throw ActivityCheckStoreError.invalidConfig
        }

        let targets = try inputTargets.map { target -> [String: Any] in
            guard
                let address = target["address"] as? String,
                let url = target["url"] as? String,
                let confirmedPath = target["confirmedPath"] as? String,
                let pendingPath = target["pendingPath"] as? String
            else {
                throw ActivityCheckStoreError.invalidConfig
            }
            var publicTarget: [String: Any] = [
                "address": address,
                "url": url,
                "confirmedPath": confirmedPath,
                "pendingPath": pendingPath,
            ]
            for key in ["confirmed", "pending"] where target[key] != nil {
                guard let value = target[key] as? String else {
                    throw ActivityCheckStoreError.invalidConfig
                }
                publicTarget[key] = value
            }
            return publicTarget
        }

        let output: [String: Any] = [
            "enabled": enabled,
            "targets": targets,
            "notice": ["title": noticeTitle, "body": noticeBody],
            "openOnPhoneTitle": openTitle,
        ]
        let outputData = try JSONSerialization.data(
            withJSONObject: output,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        guard let outputJSON = String(data: outputData, encoding: .utf8) else {
            throw ActivityCheckStoreError.invalidConfig
        }
        return outputJSON
    }
}
