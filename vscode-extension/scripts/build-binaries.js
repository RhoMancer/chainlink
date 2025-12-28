#!/usr/bin/env node

/**
 * Cross-platform build script for chainlink binaries.
 *
 * This script builds the chainlink Rust binary for multiple platforms:
 * - Windows x64 (native build)
 * - Linux x64 (via WSL with musl for portability)
 * - macOS x64/arm64 (requires macOS or cross-compilation setup)
 *
 * Usage:
 *   node scripts/build-binaries.js [--platform <platform>]
 *
 * Options:
 *   --platform windows   Build only Windows binary
 *   --platform linux     Build only Linux binary (requires WSL)
 *   --platform darwin    Build only macOS binary (requires macOS or cross toolchain)
 *   (no option)          Build all available platforms
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RUST_PROJECT = path.resolve(ROOT_DIR, '..', 'chainlink');
const BIN_DIR = path.join(ROOT_DIR, 'bin');

// Ensure bin directory exists
if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
}

function log(msg) {
    console.log(`[build] ${msg}`);
}

function error(msg) {
    console.error(`[build:error] ${msg}`);
}

function run(cmd, options = {}) {
    log(`Running: ${cmd}`);
    try {
        execSync(cmd, { stdio: 'inherit', ...options });
        return true;
    } catch (e) {
        error(`Command failed: ${cmd}`);
        return false;
    }
}

function checkWsl() {
    try {
        const result = spawnSync('wsl', ['--list', '--quiet'], { encoding: 'utf8' });
        return result.status === 0;
    } catch {
        return false;
    }
}

function getWslDistro() {
    // Look for Fedora 42 specifically as requested
    try {
        // Use -l -q for quiet list, and strip null characters from UTF-16 encoding
        const result = spawnSync('wsl', ['-l', '-q'], { encoding: 'utf8' });
        if (result.stdout) {
            // Remove null characters from Windows UTF-16 encoding
            const cleanOutput = result.stdout.replace(/\0/g, '');
            const distros = cleanOutput.split('\n').map(d => d.trim()).filter(Boolean);

            // Prefer FedoraLinux-42
            for (const distro of distros) {
                if (distro.includes('FedoraLinux-42') || distro.includes('Fedora')) {
                    return distro;
                }
            }

            // Fall back to first available distro
            if (distros.length > 0) {
                log(`No Fedora found, using: ${distros[0]}`);
                return distros[0];
            }
        }
    } catch (e) {
        error(`WSL distro detection failed: ${e}`);
    }
    return null;
}

function buildWindows() {
    log('Building Windows x64 binary...');

    const success = run(`cargo build --release --target x86_64-pc-windows-msvc`, {
        cwd: RUST_PROJECT,
    });

    if (!success) {
        error('Windows build failed');
        return false;
    }

    const src = path.join(RUST_PROJECT, 'target', 'x86_64-pc-windows-msvc', 'release', 'chainlink.exe');
    const dst = path.join(BIN_DIR, 'chainlink-win.exe');

    if (!fs.existsSync(src)) {
        // Try default target directory
        const altSrc = path.join(RUST_PROJECT, 'target', 'release', 'chainlink.exe');
        if (fs.existsSync(altSrc)) {
            fs.copyFileSync(altSrc, dst);
            log(`Copied ${altSrc} -> ${dst}`);
            return true;
        }
        error(`Binary not found at ${src}`);
        return false;
    }

    fs.copyFileSync(src, dst);
    log(`Copied ${src} -> ${dst}`);
    return true;
}

function buildLinux() {
    log('Building Linux x64 binary via WSL...');

    if (!checkWsl()) {
        error('WSL is not available. Cannot build Linux binary.');
        return false;
    }

    const distro = getWslDistro();
    if (!distro) {
        error('No Fedora WSL distro found. Please install Fedora in WSL.');
        return false;
    }

    log(`Using WSL distro: ${distro}`);

    // Convert Windows path to WSL path
    const wslRustProject = RUST_PROJECT.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, letter) => `/mnt/${letter.toLowerCase()}`);
    const wslBinDir = BIN_DIR.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, letter) => `/mnt/${letter.toLowerCase()}`);

    // Build script to run in WSL
    // Using musl target for maximum portability across Linux distros
    const buildScript = `
set -e
cd "${wslRustProject}"

# Install Rust if not present
if ! command -v rustup &> /dev/null; then
    echo "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi

# Ensure we have the musl target for portable Linux binaries
rustup target add x86_64-unknown-linux-musl 2>/dev/null || true

# Install musl-gcc if on Fedora
if command -v dnf &> /dev/null; then
    sudo dnf install -y musl-gcc musl-devel 2>/dev/null || echo "musl tools may already be installed"
fi

# Build with musl for portability
if rustup target list --installed | grep -q musl; then
    echo "Building with musl target for portability..."
    cargo build --release --target x86_64-unknown-linux-musl
    cp target/x86_64-unknown-linux-musl/release/chainlink "${wslBinDir}/chainlink-linux"
else
    echo "Building with gnu target (musl not available)..."
    cargo build --release
    cp target/release/chainlink "${wslBinDir}/chainlink-linux"
fi

chmod +x "${wslBinDir}/chainlink-linux"
echo "Linux binary built successfully"
`;

    // Write build script to temp file
    const scriptPath = path.join(ROOT_DIR, 'build-linux.sh');
    fs.writeFileSync(scriptPath, buildScript);

    try {
        const wslScriptPath = scriptPath.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, letter) => `/mnt/${letter.toLowerCase()}`);
        const result = spawnSync('wsl', ['-d', distro, 'bash', wslScriptPath], {
            stdio: 'inherit',
            encoding: 'utf8',
        });

        if (result.status !== 0) {
            error('Linux build failed');
            return false;
        }

        log('Linux binary built successfully');
        return true;
    } finally {
        // Clean up temp script
        try { fs.unlinkSync(scriptPath); } catch { }
    }
}

function buildDarwin() {
    log('Building macOS binaries...');

    if (process.platform !== 'darwin') {
        error('macOS builds require running on macOS or setting up cross-compilation.');
        error('Skipping macOS build.');
        return false;
    }

    // Build for x64
    let success = run(`cargo build --release --target x86_64-apple-darwin`, {
        cwd: RUST_PROJECT,
    });

    if (success) {
        const src = path.join(RUST_PROJECT, 'target', 'x86_64-apple-darwin', 'release', 'chainlink');
        const dst = path.join(BIN_DIR, 'chainlink-darwin');
        fs.copyFileSync(src, dst);
        fs.chmodSync(dst, 0o755);
        log(`Copied ${src} -> ${dst}`);
    }

    // Build for arm64 (Apple Silicon)
    success = run(`cargo build --release --target aarch64-apple-darwin`, {
        cwd: RUST_PROJECT,
    });

    if (success) {
        const src = path.join(RUST_PROJECT, 'target', 'aarch64-apple-darwin', 'release', 'chainlink');
        const dst = path.join(BIN_DIR, 'chainlink-darwin-arm64');
        fs.copyFileSync(src, dst);
        fs.chmodSync(dst, 0o755);
        log(`Copied ${src} -> ${dst}`);
    }

    return true;
}

function main() {
    const args = process.argv.slice(2);
    const platformIndex = args.indexOf('--platform');
    const targetPlatform = platformIndex !== -1 ? args[platformIndex + 1] : null;

    log('Starting binary build process...');
    log(`Rust project: ${RUST_PROJECT}`);
    log(`Output directory: ${BIN_DIR}`);

    const results = {};

    if (!targetPlatform || targetPlatform === 'windows') {
        results.windows = buildWindows();
    }

    if (!targetPlatform || targetPlatform === 'linux') {
        results.linux = buildLinux();
    }

    if (!targetPlatform || targetPlatform === 'darwin') {
        results.darwin = buildDarwin();
    }

    log('');
    log('Build Summary:');
    log('==============');
    for (const [platform, success] of Object.entries(results)) {
        log(`  ${platform}: ${success ? '✓ Success' : '✗ Failed'}`);
    }

    // List binaries
    log('');
    log('Built binaries:');
    if (fs.existsSync(BIN_DIR)) {
        const files = fs.readdirSync(BIN_DIR);
        for (const file of files) {
            const stat = fs.statSync(path.join(BIN_DIR, file));
            log(`  ${file} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
        }
    }

    const allSuccess = Object.values(results).every(r => r);
    process.exit(allSuccess ? 0 : 1);
}

main();
