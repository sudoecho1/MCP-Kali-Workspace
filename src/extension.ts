import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as https from 'https';

export function activate(context: vscode.ExtensionContext) {
    console.log('MCP Kali Workspace extension activated');

    let setupCommand = vscode.commands.registerCommand('mcp-kali.setup', async () => {
        await setupWorkspace(context);
    });

    let removeCommand = vscode.commands.registerCommand('mcp-kali.remove', async () => {
        await removeWorkspace();
    });

    context.subscriptions.push(setupCommand, removeCommand);
}

async function downloadResources(context: vscode.ExtensionContext): Promise<void> {
    const resourcesDir = path.join(context.extensionPath, 'resources');
    
    // Ensure resources directory exists
    if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
    }

    const MCP_SERVER_URL = 'https://gitlab.com/kalilinux/packages/mcp-kali-server/-/raw/kali/master/mcp_server.py';
    const REQUIREMENTS_URL = 'https://gitlab.com/kalilinux/packages/mcp-kali-server/-/raw/kali/master/requirements.txt';

    try {
        await Promise.all([
            downloadFile(MCP_SERVER_URL, path.join(resourcesDir, 'mcp_server.py')),
            downloadFile(REQUIREMENTS_URL, path.join(resourcesDir, 'requirements.txt'))
        ]);
        console.log('MCP Kali resources updated successfully');
    } catch (error) {
        console.error('Failed to download resources:', error);
        // Continue even if download fails - use bundled resources if available
    }
}

function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                return downloadFile(response.headers.location!, destPath)
                    .then(resolve)
                    .catch(reject);
            }
            
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
                return;
            }

            const file = fs.createWriteStream(destPath);
            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });

            file.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }).on('error', reject);
    });
}

async function setupWorkspace(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a workspace folder first');
        return;
    }

    // Prompt for configuration
    const kaliIp = await vscode.window.showInputBox({
        prompt: 'Enter Kali VM IP address',
        placeHolder: '192.168.110.23',
        validateInput: (value) => {
            if (!value || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) {
                return 'Please enter a valid IP address';
            }
            return null;
        }
    });

    if (!kaliIp) return;

    // Show progress
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Setting up MCP Kali Workspace',
        cancellable: false
    }, async (progress) => {
        try {
            progress.report({ message: 'Creating workspace directories...' });
            
            // Create .mcp-kali directory in workspace (for scripts only)
            const mcpDir = path.join(workspaceFolder.uri.fsPath, '.mcp-kali');
            if (!fs.existsSync(mcpDir)) {
                fs.mkdirSync(mcpDir, { recursive: true });
            }

            progress.report({ message: 'Downloading latest MCP server files...' });
            
            // Try to download latest resources from upstream
            let downloadSuccess = false;
            try {
                await downloadResources(context);
                downloadSuccess = true;
            } catch (error) {
                console.warn('Failed to download latest resources, using bundled version:', error);
                vscode.window.showWarningMessage(
                    'Could not download latest MCP server files (offline or network issue). Using bundled version.',
                    'OK'
                );
            }

            progress.report({ message: 'Copying MCP server files...' });
            
            // Copy resources (either freshly downloaded or bundled)
            const resourcesDir = path.join(context.extensionPath, 'resources');
            const mcpServerPy = path.join(resourcesDir, 'mcp_server.py');
            const requirementsTxt = path.join(resourcesDir, 'requirements.txt');
            
            if (!fs.existsSync(mcpServerPy) || !fs.existsSync(requirementsTxt)) {
                throw new Error('MCP server files not found. Please reinstall the extension.');
            }
            
            fs.copyFileSync(mcpServerPy, path.join(mcpDir, 'mcp_server.py'));
            fs.copyFileSync(requirementsTxt, path.join(mcpDir, 'requirements.txt'));

            progress.report({ message: 'Creating Python virtual environment...' });
            
            // Create venv in local cache directory to avoid SMB/network share symlink issues
            const isWindows = process.platform === 'win32';
            const pythonCmd = isWindows ? 'python' : 'python3';
            const homeDir = require('os').homedir();
            const cacheDir = path.join(homeDir, '.cache', 'mcp-kali-workspace');
            const venvDir = path.join(cacheDir, 'venv');
            const venvBinDir = isWindows ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
            
            // Create cache directory
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            
            // Create venv if it doesn't exist
            if (!fs.existsSync(venvDir)) {
                execSync(`${pythonCmd} -m venv "${venvDir}"`, { stdio: 'inherit' });
            }

            progress.report({ message: 'Installing dependencies...' });
            
            // Install requirements
            const pipCmd = isWindows ? path.join(venvBinDir, 'pip') : path.join(venvBinDir, 'pip');
            execSync(`"${pipCmd}" install -r "${path.join(mcpDir, 'requirements.txt')}"`, { stdio: 'inherit' });

            progress.report({ message: 'Creating wrapper script...' });
            
            // Create wrapper script (OS-specific)
            let wrapperPath: string;
            const mcpServerPath = path.join(mcpDir, 'mcp_server.py');
            
            if (isWindows) {
                // Windows batch script
                const wrapperScript = `@echo off
"${path.join(venvBinDir, 'python')}" "${mcpServerPath}" %*
`;
                wrapperPath = path.join(mcpDir, 'mcp-wrapper.cmd');
                fs.writeFileSync(wrapperPath, wrapperScript);
            } else {
                // Unix shell script
                const wrapperScript = `#!/usr/bin/env bash
exec "${path.join(venvBinDir, 'python3')}" "${mcpServerPath}" "$@"
`;
                wrapperPath = path.join(mcpDir, 'mcp-wrapper.sh');
                fs.writeFileSync(wrapperPath, wrapperScript);
                fs.chmodSync(wrapperPath, 0o755);
            }

            progress.report({ message: 'Configuring VS Code...' });
            
            // Create/update .vscode/mcp.json
            const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir, { recursive: true });
            }

            const mcpConfig = {
                servers: {
                    kaliMcp: {
                        type: 'stdio',
                        command: wrapperPath,
                        args: [
                            '--server',
                            `http://${kaliIp}:5000`
                        ]
                    }
                }
            };

            const mcpJsonPath = path.join(vscodeDir, 'mcp.json');
            fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2));

            // Update settings.json (only if settings are available)
            const config = vscode.workspace.getConfiguration();
            try {
                await config.update('chat.mcp.discovery.enabled', true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                console.log('chat.mcp.discovery.enabled not available');
            }
            try {
                await config.update('chat.agent.enabled', true, vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                console.log('chat.agent.enabled not available');
            }
            try {
                await config.update('chat.mcp.access', 'all', vscode.ConfigurationTarget.Workspace);
            } catch (e) {
                console.log('chat.mcp.access not available');
            }

            vscode.window.showInformationMessage(
                'MCP Kali Workspace setup complete! Make sure kali-server-mcp is running on your Kali VM.',
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Setup failed: ${error}`);
        }
    });
}

async function removeWorkspace() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Please open a workspace folder first');
        return;
    }

    const mcpDir = path.join(workspaceFolder.uri.fsPath, '.mcp-kali');
    const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
    const mcpConfigPath = path.join(vscodeDir, 'mcp.json');

    // Check if MCP setup exists
    if (!fs.existsSync(mcpDir)) {
        vscode.window.showInformationMessage('No MCP Kali configuration found in this workspace');
        return;
    }

    // Confirm removal
    const confirm = await vscode.window.showWarningMessage(
        'Remove MCP Kali configuration from this workspace? This will delete .mcp-kali/ and remove the MCP server entry from .vscode/mcp.json',
        'Remove',
        'Cancel'
    );

    if (confirm !== 'Remove') {
        return;
    }

    try {
        // Remove .mcp-kali directory
        if (fs.existsSync(mcpDir)) {
            fs.rmSync(mcpDir, { recursive: true, force: true });
        }

        // Remove kaliMcp entry from mcp.json
        if (fs.existsSync(mcpConfigPath)) {
            const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
            if (mcpConfig.servers && mcpConfig.servers.kaliMcp) {
                delete mcpConfig.servers.kaliMcp;
                
                // If no servers left, remove the file
                if (Object.keys(mcpConfig.servers).length === 0) {
                    fs.unlinkSync(mcpConfigPath);
                } else {
                    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
                }
            }
        }

        vscode.window.showInformationMessage(
            'MCP Kali configuration removed. Reload window to apply changes.',
            'Reload Window'
        ).then(selection => {
            if (selection === 'Reload Window') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });

    } catch (error) {
        vscode.window.showErrorMessage(`Failed to remove configuration: ${error}`);
    }
}

export function deactivate() {}
