#!/usr/bin/env node

/**
 * Download mcp_server.py from the official Kali Linux GitLab repository
 * This ensures we always package the latest version from upstream
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const MCP_SERVER_URL = 'https://gitlab.com/kalilinux/packages/mcp-kali-server/-/raw/kali/master/mcp_server.py';
const REQUIREMENTS_URL = 'https://gitlab.com/kalilinux/packages/mcp-kali-server/-/raw/kali/master/requirements.txt';

// Ensure resources directory exists
if (!fs.existsSync(RESOURCES_DIR)) {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading ${url}...`);
        
        https.get(url, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                return downloadFile(response.headers.location, destPath)
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
                console.log(`✓ Downloaded to ${destPath}`);
                resolve();
            });

            file.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }).on('error', reject);
    });
}

async function main() {
    try {
        console.log('Downloading resources from Kali Linux GitLab repository...\n');
        
        await downloadFile(MCP_SERVER_URL, path.join(RESOURCES_DIR, 'mcp_server.py'));
        await downloadFile(REQUIREMENTS_URL, path.join(RESOURCES_DIR, 'requirements.txt'));
        
        console.log('\n✓ All resources downloaded successfully');
        
        // Add attribution comment to the top of mcp_server.py
        const mcpServerPath = path.join(RESOURCES_DIR, 'mcp_server.py');
        const content = fs.readFileSync(mcpServerPath, 'utf8');
        const attribution = `# Source: https://gitlab.com/kalilinux/packages/mcp-kali-server
# This file is downloaded during the build process from the official Kali Linux repository
# License: Refer to the upstream repository for licensing information

`;
        if (!content.startsWith('# Source:')) {
            fs.writeFileSync(mcpServerPath, attribution + content);
            console.log('✓ Added attribution header to mcp_server.py');
        }
        
    } catch (error) {
        console.error('Error downloading resources:', error.message);
        process.exit(1);
    }
}

main();
