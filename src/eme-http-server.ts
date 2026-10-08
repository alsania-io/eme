import { createServer, IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import { EMEMCPServer } from "./mcp-server.js";
import type { Config } from "./types.js";
import { loadConfig, minimalDefaults, validateConfig } from "./config-loader.js";

const DEFAULT_PORT = 3100;

export class EMEHTTPServer {
  private emeServer: EMEMCPServer;
  private port: number;
  private server: ReturnType<typeof createServer> | null = null;
  private config: Config;

  constructor(config: Config, port: number = DEFAULT_PORT) {
    this.config = config;
    this.emeServer = new EMEMCPServer(config);
    this.port = port;
  }

  async start(): Promise<void> {
    await this.emeServer.initialize();
    
    this.server = createServer(async (req, res) => {
      // Enable CORS
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      
      const url = new URL(req.url || "/", `http://localhost:${this.port}`);
      const path = url.pathname;
      
      // Health check
      if (path === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: "1.2.1" }));
        return;
      }
      
      // Get current config
      if (path === "/api/config" && req.method === "GET") {
        const safeConfig = { ...this.config };
        // Redact secrets
        const secretKeys = ['encryptionKey', 'openRouterApiKey', 'postgresConnection'];
        for (const key of secretKeys) {
          if (safeConfig[key as keyof Config]) {
            (safeConfig as any)[key] = '***REDACTED***';
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ config: safeConfig }));
        return;
      }
      
      // Update config
      if (path === "/api/config" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
          const updates = JSON.parse(body) as Partial<Config>;
          // Validate keys
          const validKeys = new Set(Object.keys(this.config) as Array<keyof Config>);
          const secretKeys = new Set<keyof Config>(['encryptionKey', 'openRouterApiKey', 'postgresConnection']);
          
          for (const key of Object.keys(updates) as Array<keyof Config>) {
            if (!validKeys.has(key)) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Unknown config key: ${key}` }));
              return;
            }
            if (secretKeys.has(key)) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Cannot modify ${key} via API` }));
              return;
            }
            (this.config as any)[key] = updates[key];
          }
          
          // Reinitialize if needed
          const reinitKeys = new Set(['embeddingModel', 'embeddingModelPath', 'embeddingDimension', 'vectorStore', 'vectorStorePath', 'qdrantUrl', 'qdrantCollection', 'qdrantVectorName', 'graphStore', 'graphStorePath', 'snapshotStore', 'snapshotPath']);
          const needsReinit = Object.keys(updates).some(k => reinitKeys.has(k));
          
          if (needsReinit) {
            await this.emeServer.close();
            this.emeServer = new EMEMCPServer(this.config);
            await this.emeServer.initialize();
          }
          
          // Save to file
          await this.saveConfigToFile();
          
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, updated: Object.keys(updates) }));
        } catch (error: any) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      
      // Reset config to defaults
      if (path === "/api/config/reset" && req.method === "POST") {
        this.config = { ...minimalDefaults };
        await this.emeServer.close();
        this.emeServer = new EMEMCPServer(this.config);
        await this.emeServer.initialize();
        await this.saveConfigToFile();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      
      // Save config to file
      if (path === "/api/config/save" && req.method === "POST") {
        await this.saveConfigToFile();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      
      // Load config from file
      if (path === "/api/config/load" && req.method === "POST") {
        const { loadConfig } = await import("./config-loader.js");
        this.config = loadConfig();
        await this.emeServer.close();
        this.emeServer = new EMEMCPServer(this.config);
        await this.emeServer.initialize();
        const safeConfig = { ...this.config };
        const secretKeys = ['encryptionKey', 'openRouterApiKey', 'postgresConnection'];
        for (const key of secretKeys) {
          if (safeConfig[key as keyof Config]) {
            (safeConfig as any)[key] = '***REDACTED***';
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ config: safeConfig }));
        return;
      }
      
      // Execute any tool
      if (path.startsWith("/api/tools/") && req.method === "POST") {
        const toolName = path.replace("/api/tools/", "");
        let body = "";
        for await (const chunk of req) body += chunk;
        let args = {};
        if (body) args = JSON.parse(body);
        
        try {
          const result = await this.emeServer.executeTool(toolName, args);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (error: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message, tool: toolName }));
        }
        return;
      }
      
      // Static frontend serving
      if (req.method === "GET") {
        const fs = await import("fs");
        const pathModule = await import("path");
        let requestedFile = path === "/" ? "index.html" : path.replace(/^\//, "");
        const safeFilePath = pathModule.normalize(requestedFile).replace(/^(\.\.[\/\\])+/, "");
        const fullPath = pathModule.join(process.cwd(), "frontend", safeFilePath);

        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const ext = pathModule.extname(fullPath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".ico": "image/x-icon"
          };
          const contentType = mimeTypes[ext] || "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType });
          fs.createReadStream(fullPath).pipe(res);
          return;
        }
      }

      // Not found
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
    
    return new Promise((resolve) => {
      this.server!.listen(this.port, () => {
        console.error(`[EME-HTTP] Server running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }
  
  private async saveConfigToFile(): Promise<void> {
    const fs = await import("fs");
    const path = await import("path");
    const configPath = path.join(process.cwd(), "eme-config.json");
    // Don't save secrets to file
    const safeConfig = { ...this.config };
    const secretKeys = ['encryptionKey', 'openRouterApiKey', 'postgresConnection'];
    for (const key of secretKeys) {
      if (safeConfig[key as keyof Config]) {
        (safeConfig as any)[key] = `$\{${key.toUpperCase()}\}`;
      }
    }
    fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2));
  }
  
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
    }
    await this.emeServer.close();
  }
}

// CLI entry point
async function main() {
  const config = loadConfig();
  const port = parseInt(process.env.PORT || "3100", 10);
  const server = new EMEHTTPServer(config, port);
  await server.start();
  
  // Handle shutdown
  process.on("SIGINT", async () => {
    console.error("\n[EME-HTTP] Shutting down...");
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);