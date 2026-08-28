import fs from "node:fs";
import path from "node:path";
import { generatePluginPricingTomlForProvider } from "./pricing";
import type { CodexPluginConfigDTO, RelayPricingProviderDTO } from "../../src/dto/dashboard";

export function pluginBaseDir(codexHome: string): string {
  return path.join(codexHome, ".tokenledger", "plugins", "codex-token-cost");
}

export function pluginScriptPath(codexHome: string): string {
  return path.join(pluginBaseDir(codexHome), "scripts", "token_cost.py");
}

export function pluginPricingPath(codexHome: string): string {
  return path.join(pluginBaseDir(codexHome), "pricing.toml");
}

export function codexHooksPath(codexHome: string): string {
  return path.join(codexHome, "hooks.json");
}

function resolveTokenCostScript(): string {
  // Check if we are running in dev mode or in repository
  const devScriptPath = path.resolve(__dirname, "../../plugins/codex-token-cost/scripts/token_cost.py");
  if (fs.existsSync(devScriptPath)) {
    return fs.readFileSync(devScriptPath, "utf8");
  }

  // Check extraResources or current working directory
  const cwdScriptPath = path.join(process.cwd(), "plugins/codex-token-cost/scripts/token_cost.py");
  if (fs.existsSync(cwdScriptPath)) {
    return fs.readFileSync(cwdScriptPath, "utf8");
  }

  throw new Error("Could not find token_cost.py script source");
}

export function deployPluginFiles(
  codexHome: string,
  relays: RelayPricingProviderDTO[],
  selectedProviderId?: string | null
): { scriptFile: string; pricingFile: string } {
  const baseDir = pluginBaseDir(codexHome);
  const scriptsDir = path.join(baseDir, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });

  const scriptFile = pluginScriptPath(codexHome);
  const scriptContent = resolveTokenCostScript();
  fs.writeFileSync(scriptFile, scriptContent, "utf8");

  const pricingFile = pluginPricingPath(codexHome);
  const tomlContent = generatePluginPricingTomlForProvider(relays, selectedProviderId);
  fs.writeFileSync(pricingFile, tomlContent, "utf8");

  // Also sync to dev directory if present
  let currentDir = process.cwd();
  while (currentDir !== path.dirname(currentDir)) {
    const devPluginDir = path.join(currentDir, "plugins", "codex-token-cost");
    if (fs.existsSync(devPluginDir) && fs.statSync(devPluginDir).isDirectory()) {
      try {
        fs.writeFileSync(path.join(devPluginDir, "pricing.toml"), tomlContent, "utf8");
      } catch {}
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  return { scriptFile, pricingFile };
}

export function isHookInstalled(codexHome: string): boolean {
  const hooksFile = codexHooksPath(codexHome);
  if (!fs.existsSync(hooksFile)) {
    return false;
  }

  try {
    const content = fs.readFileSync(hooksFile, "utf8");
    const val = JSON.parse(content);
    return hasTokenCostHook(val);
  } catch {
    return false;
  }
}

function hasTokenCostHook(root: any): boolean {
  const stopHooks = root?.hooks?.Stop;
  if (!Array.isArray(stopHooks)) {
    return false;
  }

  return stopHooks.some((entry: any) => {
    const innerHooks = entry?.hooks;
    if (Array.isArray(innerHooks)) {
      return innerHooks.some((h: any) => {
        return typeof h?.command === "string" && h.command.includes("token_cost.py");
      });
    }
    return false;
  });
}

export function updateHooksJson(codexHome: string, enable: boolean): void {
  const hooksFile = codexHooksPath(codexHome);
  let root: Record<string, any> = {};

  if (fs.existsSync(hooksFile)) {
    try {
      const content = fs.readFileSync(hooksFile, "utf8");
      root = JSON.parse(content);
    } catch {
      root = {};
    }
  }

  if (!root || typeof root !== "object") {
    root = {};
  }
  if (!root.hooks || typeof root.hooks !== "object") {
    root.hooks = {};
  }
  if (!Array.isArray(root.hooks.Stop)) {
    root.hooks.Stop = [];
  }

  const stopArr = root.hooks.Stop as any[];

  // Filter out existing token_cost.py hooks
  const filteredStop = stopArr.filter((entry: any) => {
    const innerHooks = entry?.hooks;
    if (Array.isArray(innerHooks)) {
      return !innerHooks.some(
        (h: any) => typeof h?.command === "string" && h.command.includes("token_cost.py")
      );
    }
    return true;
  });

  if (enable) {
    const scriptFile = pluginScriptPath(codexHome);
    const hookEntry = {
      hooks: [
        {
          type: "command",
          command: `python3 -B "${scriptFile}"`,
          timeout: 10,
          statusMessage: "Calculating token cost"
        }
      ]
    };
    filteredStop.push(hookEntry);
  }

  root.hooks.Stop = filteredStop;

  const parentDir = path.dirname(hooksFile);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  fs.writeFileSync(hooksFile, JSON.stringify(root, null, 2), "utf8");
}
