// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Foundation

@main
struct ActivityCheckFilesCheck {
    static func main() {
        let fileManager = FileManager.default
        let directory = fileManager.temporaryDirectory
            .appendingPathComponent("activity-check-files-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: directory) }

        let files = ActivityCheckFiles(directory: directory)

        guard !fileManager.fileExists(atPath: directory.path) else {
            fail("fresh directory")
        }
        guard files.readConfig() == nil else {
            fail("absent config is nil")
        }

        do {
            try files.writeConfig("{\"enabled\":true}")
        } catch {
            fail("write config: \(error)")
        }
        guard files.readConfig() == "{\"enabled\":true}" else {
            fail("write then read")
        }

        do {
            try files.writeConfig("{\"enabled\":false}")
        } catch {
            fail("overwrite config: \(error)")
        }
        guard files.readConfig() == "{\"enabled\":false}" else {
            fail("overwrite")
        }

        for run in 1...25 {
            files.appendRun(atMs: Int64(run))
        }
        guard files.runLog() == Array(6...25).map(Int64.init) else {
            fail("25 runs keep the last 20 in order")
        }

        let runsURL = directory.appendingPathComponent("activity-check-runs.txt")
        do {
            try Data("6\njunk\n7\n".utf8).write(to: runsURL, options: .atomic)
        } catch {
            fail("prepare junk line: \(error)")
        }
        guard files.runLog() == [6, 7] else {
            fail("junk line skipped")
        }

        guard files.clear() else {
            fail("clear on present files")
        }
        guard files.readConfig() == nil, files.runLog().isEmpty else {
            fail("clear removed both files")
        }
        guard files.clear() else {
            fail("clear on absent files")
        }
    }

    private static func fail(_ name: String) -> Never {
        FileHandle.standardError.write(Data("FAILED: \(name)\n".utf8))
        exit(1)
    }
}
