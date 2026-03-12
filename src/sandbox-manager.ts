import { randomUUID } from "crypto";
import { spawn, exec, execSync } from "child_process";
import { promisify } from "util";
import type { SandboxManager } from "./types";
import { debugLog, debugWarn } from "./utils";

const execAsync = promisify(exec);

const EXECUTION_TIMEOUT = 270_000; // 4.5 minutes in milliseconds

/**
 * Subprocess-based sandbox implementation
 * Executes Python code in a local subprocess
 */
class SubprocessSandbox implements SandboxManager {
  spawn(code: string, cwd: string): import("child_process").ChildProcess {
    // Spawn Python process with unbuffered output
    return spawn("python3", ["-u", "-c", code], {
      cwd,
      env: { ...process.env },
    });
  }

  async cleanup(): Promise<void> {
    // No persistent resources to clean up
  }
}

/**
 * Docker-based sandbox implementation
 * Executes Python code in an isolated Docker container
 */
class DockerSandbox implements SandboxManager {
  private containerId: string | null = null;
  private lastUsed: number = 0;
  private readonly sessionId: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.startCleanupTimer();
  }

  private startCleanupTimer() {
    // Check every 60 seconds for expired containers
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60_000);
  }

  private async cleanupExpired() {
    if (this.containerId && Date.now() - this.lastUsed > EXECUTION_TIMEOUT) {
      await this.stopContainer();
    }
  }


  private async stopContainer() {
    if (!this.containerId) return;

    const containerId = this.containerId;
    this.containerId = null;

    try {
      await execAsync(`docker stop ${containerId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("No such container") || message.includes("is not running")) {
        return;
      }
      throw new Error(`Failed to stop container ${containerId}: ${message}`);
    }
  }

  spawn(code: string, cwd: string): import("child_process").ChildProcess {
    try {
      // Check if we need to create a new container
      if (!this.containerId || Date.now() - this.lastUsed > EXECUTION_TIMEOUT) {
        // Stop old container if it exists
        if (this.containerId) {
          try {
            execSync(`docker stop ${this.containerId}`, { stdio: "ignore" });
          } catch {
            // Container might already be stopped
          }
          this.containerId = null;
        }

        // Create new container
        const containerName = `pi-ptc-${this.sessionId}-${Date.now()}`;
        const output = execSync(
          `docker run -d --rm --network none --name ${containerName} ` +
          `-v "${cwd}:/workspace:ro" ` +
          `--memory 512m --cpus 1.0 ` +
          `python:3.12-slim tail -f /dev/null`,
          { encoding: "utf-8" }
        );
        this.containerId = output.trim();
      }

      this.lastUsed = Date.now();

      // Execute Python code in container
      return spawn("docker", ["exec", "-i", this.containerId, "python3", "-u", "-c", code], {
        cwd,
      });
    } catch (error) {
      throw new Error(
        `Failed to create/use Docker container: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    await this.stopContainer();
  }
}

/**
 * Check if Docker is available on the system
 */
async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync("docker --version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a sandbox manager (uses subprocess by default, Docker opt-in via PTC_USE_DOCKER=true)
 */
export async function createSandbox(): Promise<SandboxManager> {
  const sessionId = randomUUID();
  const useDocker = process.env.PTC_USE_DOCKER === "true";

  if (useDocker) {
    const dockerAvailable = await isDockerAvailable();
    if (dockerAvailable) {
      debugLog("Using Docker sandbox (PTC_USE_DOCKER=true)");
      return new DockerSandbox(sessionId);
    } else {
      debugWarn("Docker requested but not available, falling back to subprocess sandbox");
      return new SubprocessSandbox();
    }
  } else {
    debugLog("Using subprocess sandbox (default)");
    return new SubprocessSandbox();
  }
}
