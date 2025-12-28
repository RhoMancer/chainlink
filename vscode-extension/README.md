# Chainlink Issue Tracker - VS Code Extension

A simple, lean issue tracker for AI-assisted development, integrated directly into VS Code.

## Features

- **Session Management**: Start/end work sessions with handoff notes for context preservation
- **Issue Tracking**: Create, update, and manage issues without leaving your editor
- **Daemon Auto-Start**: Background daemon keeps session state fresh
- **Cross-Platform**: Works on Windows, Linux, and macOS

## Installation

1. Install from the VS Code Extensions Marketplace (search "Chainlink Issue Tracker")
2. Open a project folder
3. Run `Chainlink: Initialize Project` from the command palette

## Commands

| Command | Description |
|---------|-------------|
| `Chainlink: Initialize Project` | Initialize chainlink in current workspace |
| `Chainlink: Start Session` | Start a new work session |
| `Chainlink: End Session` | End session with optional handoff notes |
| `Chainlink: Session Status` | Show current session info |
| `Chainlink: Start Daemon` | Manually start the background daemon |
| `Chainlink: Stop Daemon` | Stop the background daemon |
| `Chainlink: Daemon Status` | Check if daemon is running |
| `Chainlink: List Issues` | Show all open issues |
| `Chainlink: Create Issue` | Create a new issue |
| `Chainlink: Show Issue Details` | View details of a specific issue |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `chainlink.binaryPath` | `""` | Override path to chainlink binary (for development) |
| `chainlink.autoStartDaemon` | `true` | Auto-start daemon when .chainlink project detected |
| `chainlink.showOutputChannel` | `false` | Show output channel for daemon logs |

## Development

### Building the Extension

```bash
# Install dependencies
cd vscode-extension
npm install

# Compile TypeScript
npm run compile

# Build binaries for all platforms
npm run build:binaries

# Package the extension
npm run package
```

### Building Binaries

The extension bundles platform-specific binaries. To build them:

```bash
# Build all platforms (Windows native, Linux via WSL)
node scripts/build-binaries.js

# Build specific platform
node scripts/build-binaries.js --platform windows
node scripts/build-binaries.js --platform linux
```

**Requirements:**
- Windows: Visual Studio Build Tools with Rust
- Linux: WSL with Fedora 42 (or another distro with Rust installed)
- macOS: Xcode Command Line Tools with Rust

### Testing Locally

1. Open the `vscode-extension` folder in VS Code
2. Press F5 to launch Extension Development Host
3. Set `chainlink.binaryPath` to your local debug binary path

## Architecture

```
vscode-extension/
├── src/
│   ├── extension.ts    # Extension entry point, command registration
│   ├── daemon.ts       # Daemon lifecycle management
│   └── platform.ts     # Platform detection, binary resolution
├── bin/                # Platform binaries (populated by build script)
│   ├── chainlink-win.exe
│   ├── chainlink-linux
│   └── chainlink-darwin
├── scripts/
│   └── build-binaries.js  # Cross-compilation orchestration
└── package.json
```

## Daemon Behavior

The daemon runs as a background process that:
- Auto-flushes session state every 30 seconds
- Self-terminates when VS Code closes (zombie prevention via stdin monitoring)
- Writes logs to `.chainlink/daemon.log`

## License

MIT
