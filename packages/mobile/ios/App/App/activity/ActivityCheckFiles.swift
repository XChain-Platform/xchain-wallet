// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

struct ActivityCheckFiles {
    private static let configFile = "activity-check.json"
    private static let runsFile = "activity-check-runs.txt"

    private let directory: URL
    private let configURL: URL
    private let runsURL: URL
    private let fileManager = FileManager.default

    init(directory: URL) {
        self.directory = directory
        self.configURL = directory.appendingPathComponent(Self.configFile)
        self.runsURL = directory.appendingPathComponent(Self.runsFile)
    }

    func writeConfig(_ json: String) throws {
        try createDirectoryIfNeeded()
        try Data(json.utf8).write(to: configURL, options: .atomic)
    }

    func readConfig() -> String? {
        guard let data = try? Data(contentsOf: configURL) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func appendRun(atMs: Int64) {
        var runs = runLog()
        runs.append(atMs)
        runs = Array(runs.suffix(20))

        guard let data = runs.map(String.init).joined(separator: "\n").data(using: .utf8) else {
            return
        }

        do {
            try createDirectoryIfNeeded()
            try data.write(to: runsURL, options: .atomic)
        } catch {
            return
        }
    }

    func runLog() -> [Int64] {
        guard let data = try? Data(contentsOf: runsURL),
              let contents = String(data: data, encoding: .utf8) else {
            return []
        }

        return contents.split(whereSeparator: \.isNewline).compactMap {
            Int64($0.trimmingCharacters(in: .whitespaces))
        }
    }

    func clear() -> Bool {
        for url in [configURL, runsURL] where fileManager.fileExists(atPath: url.path) {
            try? fileManager.removeItem(at: url)
        }

        return !fileManager.fileExists(atPath: configURL.path)
            && !fileManager.fileExists(atPath: runsURL.path)
    }

    private func createDirectoryIfNeeded() throws {
        if !fileManager.fileExists(atPath: directory.path) {
            try fileManager.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
        }
    }
}
