<div align="center">
  <img src="src-tauri/icons/tesapi-logo.svg" width="112" height="112" alt="TesAPI logo">
  <h1>TesAPI</h1>
  <p>A local-first desktop API client with Git workspaces and safe MCP access for AI tools.</p>

  [![Latest release](https://img.shields.io/github/v/release/ridhomujizat/TesAPI?display_name=tag&sort=semver)](https://github.com/ridhomujizat/TesAPI/releases/latest)
  [![Release build](https://github.com/ridhomujizat/TesAPI/actions/workflows/release.yml/badge.svg)](https://github.com/ridhomujizat/TesAPI/actions/workflows/release.yml)
  ![macOS](https://img.shields.io/badge/platform-macOS-111111?logo=apple)
  ![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
</div>

TesAPI keeps API collections on your computer, gives each workspace a portable file structure, and can synchronize that structure through Git. Its MCP integration lets Claude, Codex, Cursor, and other compatible AI clients inspect or draft requests without silently exposing secrets or changing data.

## App Preview

![TesAPI showing a Commerce API workspace with collections, query parameters, environment variables, and Git integration](screenshots/tesapi-showcase.png)

## Features

- Build and send HTTP requests with params, headers, authentication, JSON, form-data, URL-encoded bodies, and file uploads.
- Edit JSON request and response bodies with CodeMirror syntax highlighting.
- Import browser cURL commands from Bash, PowerShell, or Windows Command Prompt, then export requests back to cURL.
- Import Postman collections into the current workspace.
- Organize requests in collections and folders, keep request history, and save multiple example responses.
- Manage environments with inline `{{variable}}` highlighting and local secret values.
- Create local or Git-backed workspaces with branches, commits, pull, push, diffs, and recoverable conflict handling.
- Connect AI clients through the bundled MCP server with scoped access, approval prompts, secret redaction, and activity logs.
- Check for signed TesAPI updates published through GitHub Releases.

## Download

Download the latest build from [GitHub Releases](https://github.com/ridhomujizat/TesAPI/releases/latest):

| Mac | File |
| --- | --- |
| Apple Silicon (M1, M2, M3, M4, or newer) | File ending in `_aarch64.dmg` |
| Intel | File ending in `_x64.dmg` |

Open the DMG and drag TesAPI into Applications. The current release is not Apple-notarized, so macOS may block the first launch. Control-click TesAPI, choose **Open**, then confirm **Open**. You can also allow it from **System Settings → Privacy & Security**.

## MCP Integration

Open **Settings → MCP Server** to configure a supported client:

- Claude Desktop
- Claude Code
- Codex
- Cursor

Choose the capability granted to each workspace and client. Read access can inspect collections and requests; higher capabilities can create drafts, save changes, or execute requests. Risky operations remain subject to TesAPI's safety policy and approval UI, and secret values are redacted before data is returned to an AI client.

Keep TesAPI running while an MCP client is connected. The bundled `tesapi-mcp` process is only a local bridge; workspace access, policy checks, approvals, storage, and HTTP execution stay inside TesAPI.

## Local-First Storage

- Workspace collections and requests are stored as portable files in the workspace folder you choose.
- App settings, the workspace registry, and MCP activity are stored locally in the Tauri app-data directory.
- Secret environment values remain in machine-local files and are excluded from workspace Git history.
- TesAPI remains local-first. Data reaches a remote only when you send an API request, configure Git synchronization, or connect a workspace to a self-hosted TesAPI Sync server.

## Development

Requirements:

- Node.js 22+
- Rust stable
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
git clone https://github.com/ridhomujizat/TesAPI.git
cd TesAPI
npm install
npm run tauri dev
```

Create a production bundle with:

```bash
npm run tauri build
```

Run the main checks with:

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
before making changes; it is the source of truth for human and AI-assisted
development. For substantial changes, open an issue first so the behavior and
security impact can be agreed before implementation.

## Security

Do not include API keys, tokens, cookies, authorization headers, or local environment files in bug reports. If you find a vulnerability that could expose secrets or execute requests without approval, report it privately to the repository owner instead of opening a public issue.

## License

TesAPI is available under the [MIT License](LICENSE). Third-party dependencies remain subject to their own licenses.
