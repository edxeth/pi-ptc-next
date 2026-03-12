import * as fs from "fs";
import * as path from "path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PtcToolDefinition } from "./types";
import type { ToolRegistry } from "./tool-registry";
import { debugLog, debugWarn } from "./utils";

/**
 * Watch the tools/ directory for file changes and hot-reload custom tools.
 */
export function watchTools(
  extensionRoot: string,
  pi: ExtensionAPI,
  toolRegistry: ToolRegistry,
  initialFileMap?: Map<string, string>
): { close(): void } {
  const toolsDir = path.join(extensionRoot, "tools");

  if (!fs.existsSync(toolsDir)) {
    fs.mkdirSync(toolsDir, { recursive: true });
  }

  const fileToTool = new Map<string, string>(initialFileMap ?? []);
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function loadFile(filename: string): Promise<void> {
    const filePath = path.join(toolsDir, filename);

    if (!fs.existsSync(filePath)) {
      const toolName = fileToTool.get(filename);
      if (toolName) {
        toolRegistry.removeTool(toolName);
        fileToTool.delete(filename);
        const activeTools = pi.getActiveTools();
        pi.setActiveTools(activeTools.filter((name) => name !== toolName));
        debugLog(`Watcher removed tool: ${toolName} (${filename} deleted)`);
      }
      return;
    }

    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    const mod = await import(filePath);
    const def = (mod.default || mod) as Partial<PtcToolDefinition>;

    if (!def.name || !def.execute || !def.parameters) {
      throw new Error(
        `Watcher skipping ${filename}: missing required fields (name, execute, parameters)`
      );
    }

    const previousTool = fileToTool.get(filename);
    if (previousTool && previousTool !== def.name) {
      toolRegistry.removeTool(previousTool);
      const activeTools = pi.getActiveTools();
      pi.setActiveTools(activeTools.filter((name) => name !== previousTool));
      debugLog(`Watcher removed old tool: ${previousTool} (renamed to ${def.name})`);
    }

    pi.registerTool({
      name: def.name,
      label: def.label || def.name,
      description: def.description || def.name,
      parameters: def.parameters,
      execute: def.execute,
      ptc: def.ptc,
    } as PtcToolDefinition);

    const activeTools = pi.getActiveTools();
    if (!activeTools.includes(def.name)) {
      pi.setActiveTools([...activeTools, def.name]);
    }

    fileToTool.set(filename, def.name);
    debugLog(`Watcher loaded/reloaded tool: ${def.name}`);
  }

  const watcher = fs.watch(toolsDir, (_eventType, filename) => {
    if (!filename || !filename.endsWith(".js")) {
      return;
    }

    const existing = debounceTimers.get(filename);
    if (existing) {
      clearTimeout(existing);
    }

    debounceTimers.set(
      filename,
      setTimeout(() => {
        debounceTimers.delete(filename);
        void loadFile(filename).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          debugWarn(`Watcher failed to load ${filename}: ${message}`);
        });
      }, 300)
    );
  });

  return {
    close() {
      watcher.close();
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
    },
  };
}
