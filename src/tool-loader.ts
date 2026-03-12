import * as fs from "fs";
import * as path from "path";
import type { LoadedTool, PtcToolDefinition } from "./types";
import { debugLog } from "./utils";

/**
 * Load custom tool definitions from the tools/ directory.
 */
export async function loadTools(extensionRoot: string): Promise<LoadedTool[]> {
  const toolsDir = path.join(extensionRoot, "tools");

  if (!fs.existsSync(toolsDir)) {
    return [];
  }

  const files = fs.readdirSync(toolsDir).filter((filename) => filename.endsWith(".js"));
  if (files.length === 0) {
    return [];
  }

  const results: LoadedTool[] = [];
  const loadErrors: Error[] = [];

  for (const file of files) {
    const filePath = path.join(toolsDir, file);
    try {
      const mod = await import(filePath);
      const def = (mod.default || mod) as Partial<PtcToolDefinition>;

      if (!def.name || !def.execute || !def.parameters) {
        loadErrors.push(
          new Error(`Skipping ${file}: missing required fields (name, execute, parameters)`)
        );
        continue;
      }

      results.push({
        tool: {
          name: def.name,
          label: def.label || def.name,
          description: def.description || def.name,
          parameters: def.parameters,
          ptc: def.ptc,
          execute: def.execute,
        },
        filename: file,
      });
      debugLog(`Loaded custom tool: ${def.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      loadErrors.push(new Error(`Failed to load tool from ${file}: ${message}`));
    }
  }

  if (loadErrors.length > 0) {
    throw new AggregateError(loadErrors, `Failed to load ${loadErrors.length} custom tool(s)`);
  }

  if (results.length > 0) {
    debugLog(`${results.length} custom tool(s) loaded from tools/`);
  }

  return results;
}
