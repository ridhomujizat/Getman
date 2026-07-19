# TesAPI

A personal desktop API client built with Tauri, React, and TypeScript.

## cURL import/export

Phase 2 uses the pure TypeScript parser in `src/lib/curl/`. It accepts Bash/POSIX, Windows `cmd.exe`, and PowerShell cURL copied from browser developer tools, including caret/backtick continuations, quoted headers, cookies, JSON, form-data, basic auth, and bearer auth. Unknown cURL-only flags are tolerated with warnings instead of crashing the request builder.

The request builder detects cURL pasted into the URL field and copies the active request back to a multiline Bash cURL command. There is no runtime cURL parsing dependency.

Run the parser checks directly with Node 22+:

```sh
node src/lib/curl/__tests__/normalize.test.ts
node src/lib/curl/__tests__/tokenize.test.ts
node src/lib/curl/__tests__/parse.test.ts
node src/lib/curl/__tests__/export.test.ts
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Phase 3 local storage

TesAPI stores one local workspace under the Tauri app-data directory:

```text
tesapi/
├── workspaces.json
└── workspaces/<workspace-id>/
    ├── workspace.json
    ├── collections/<collection-id>.json
    ├── history.ndjson
    ├── session.json
    └── environments.json
```

All persistence goes through `StorageProvider`; the current implementation is `LocalJsonProvider`. Collection files use atomic Rust writes with a `.bak` copy, history is capped at 1,000 entries, and malformed files are quarantined before backup recovery. New request tabs remain drafts until the Save action creates a collection node. Environment variables use `{{variable}}` placeholders and resolve only when sending or exporting cURL.
