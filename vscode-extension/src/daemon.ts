import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { resolveBinaryPath, ensureExecutable } from './platform';

export interface DaemonOptions {
    extensionPath: string;
    workspaceFolder: string;
    outputChannel: vscode.OutputChannel;
    overrideBinaryPath?: string;
}

export class DaemonManager {
    private process: cp.ChildProcess | null = null;
    private binaryPath: string;
    private chainlinkDir: string;
    private outputChannel: vscode.OutputChannel;
    private isShuttingDown = false;

    constructor(private options: DaemonOptions) {
        this.binaryPath = resolveBinaryPath(
            options.extensionPath,
            options.overrideBinaryPath
        );
        this.chainlinkDir = path.join(options.workspaceFolder, '.chainlink');
        this.outputChannel = options.outputChannel;
    }

    /**
     * Checks if the .chainlink directory exists in the workspace.
     */
    public hasChainlinkProject(): boolean {
        return fs.existsSync(this.chainlinkDir);
    }

    /**
     * Starts the daemon process.
     * The daemon will auto-terminate if stdin closes (zombie prevention).
     */
    public async start(): Promise<void> {
        if (this.process && !this.process.killed) {
            this.outputChannel.appendLine('Daemon is already running');
            return;
        }

        if (!this.hasChainlinkProject()) {
            throw new Error(
                `No .chainlink directory found in ${this.options.workspaceFolder}. ` +
                'Run "chainlink init" first.'
            );
        }

        // Ensure binary is executable on Unix
        ensureExecutable(this.binaryPath);

        this.outputChannel.appendLine(`Starting daemon: ${this.binaryPath}`);
        this.outputChannel.appendLine(`Chainlink dir: ${this.chainlinkDir}`);

        this.isShuttingDown = false;

        // Spawn the daemon with stdin pipe for zombie prevention
        // When VS Code crashes/closes, the pipe breaks and the daemon exits
        this.process = cp.spawn(this.binaryPath, ['daemon', 'run', '--dir', this.chainlinkDir], {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false, // Keep attached to parent
            windowsHide: true,
        });

        // Handle stdout
        this.process.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                this.outputChannel.appendLine(`[daemon] ${line}`);
            }
        });

        // Handle stderr
        this.process.stderr?.on('data', (data: Buffer) => {
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                this.outputChannel.appendLine(`[daemon:err] ${line}`);
            }
        });

        // Handle process exit
        this.process.on('exit', (code, signal) => {
            if (!this.isShuttingDown) {
                this.outputChannel.appendLine(
                    `Daemon exited unexpectedly (code: ${code}, signal: ${signal})`
                );
            } else {
                this.outputChannel.appendLine(`Daemon stopped (code: ${code})`);
            }
            this.process = null;
        });

        // Handle errors
        this.process.on('error', (err) => {
            this.outputChannel.appendLine(`Daemon error: ${err.message}`);
            vscode.window.showErrorMessage(`Chainlink daemon error: ${err.message}`);
            this.process = null;
        });

        // Wait a moment to ensure it started
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.process && !this.process.killed) {
                    this.outputChannel.appendLine('Daemon started successfully');
                    resolve();
                } else {
                    reject(new Error('Daemon failed to start'));
                }
            }, 500);

            this.process?.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    /**
     * Stops the daemon process gracefully.
     */
    public stop(): void {
        if (!this.process) {
            this.outputChannel.appendLine('Daemon is not running');
            return;
        }

        this.isShuttingDown = true;
        this.outputChannel.appendLine('Stopping daemon...');

        // Close stdin to signal the daemon to exit (zombie prevention)
        this.process.stdin?.end();

        // Give it a moment to exit gracefully
        const killTimeout = setTimeout(() => {
            if (this.process && !this.process.killed) {
                this.outputChannel.appendLine('Daemon did not exit gracefully, forcing kill');
                this.process.kill('SIGKILL');
            }
        }, 2000);

        this.process.on('exit', () => {
            clearTimeout(killTimeout);
        });

        // Also send SIGTERM for good measure
        this.process.kill('SIGTERM');
    }

    /**
     * Returns whether the daemon is currently running.
     */
    public isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }

    /**
     * Gets the daemon's PID if running.
     */
    public getPid(): number | undefined {
        return this.process?.pid;
    }

    /**
     * Executes a chainlink command and returns the output.
     */
    public async executeCommand(args: string[]): Promise<string> {
        ensureExecutable(this.binaryPath);

        return new Promise((resolve, reject) => {
            const proc = cp.spawn(this.binaryPath, args, {
                cwd: this.options.workspaceFolder,
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            proc.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            proc.on('exit', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(stderr.trim() || `Command failed with code ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Cleans up resources. Call this in extension deactivate().
     */
    public dispose(): void {
        this.stop();
    }
}
