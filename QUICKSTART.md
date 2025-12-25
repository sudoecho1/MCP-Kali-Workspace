# MCP Kali VS Code Extension - Quick Start

## What You Need to Do

1. **Get the MCP server files from GitLab:**
   ```bash
   cd resources/
   curl -o mcp_server.py https://gitlab.com/kalilinux/packages/mcp-kali-server/-/raw/kali/master/mcp_server.py
   curl -o requirements.txt https://gitlab.com/kalilinux/packages/mcp-kali-server/-/raw/kali/master/requirements.txt
   cd ..
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Compile the extension:**
   ```bash
   npm run compile
   ```

4. **Test it:**
   - Press F5 in VS Code to launch Extension Development Host
   - In the new window, open a workspace
   - Run: `MCP Kali: Setup Workspace`

5. **Package for installation:**
   ```bash
   npm run package
   ```

6. **Install the extension:**
   ```bash
   code --install-extension mcp-kali-workspace-0.1.0.vsix
   ```

## Next Steps

After installation, in any workspace:
1. Run command: `MCP Kali: Setup Workspace`
2. Follow prompts for Kali IP, SSH user, SSH key
3. Reload VS Code
4. Use MCP tools in Copilot Chat!
