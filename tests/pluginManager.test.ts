import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  codexHooksPath,
  deployPluginFiles,
  isHookInstalled,
  updateHooksJson
} from "../electron/services/pluginManager";

describe("pluginManager service", () => {
  it("deploys plugin files correctly", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-test-"));
    try {
      const { scriptFile, pricingFile } = deployPluginFiles(tempDir, [], null);
      expect(fs.existsSync(scriptFile)).toBe(true);
      expect(fs.existsSync(pricingFile)).toBe(true);

      const scriptContent = fs.readFileSync(scriptFile, "utf8");
      expect(scriptContent).toContain("def normalize_model");

      const pricingContent = fs.readFileSync(pricingFile, "utf8");
      expect(pricingContent).toContain('[models."gpt-5.6-sol"]');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("updates hooks.json to enable and disable token_cost.py hook", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-test-"));
    try {
      const hooksFile = codexHooksPath(tempDir);
      const initialJson = {
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [{ type: "command", command: "echo hello" }]
            }
          ]
        }
      };
      fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
      fs.writeFileSync(hooksFile, JSON.stringify(initialJson, null, 2), "utf8");

      expect(isHookInstalled(tempDir)).toBe(false);

      // Enable hook
      updateHooksJson(tempDir, true);
      expect(isHookInstalled(tempDir)).toBe(true);

      const enabledContent = fs.readFileSync(hooksFile, "utf8");
      const parsed = JSON.parse(enabledContent);
      expect(parsed.hooks.SessionStart).toBeDefined();
      expect(parsed.hooks.Stop.length).toBe(1);

      // Disable hook
      updateHooksJson(tempDir, false);
      expect(isHookInstalled(tempDir)).toBe(false);

      const disabledContent = fs.readFileSync(hooksFile, "utf8");
      const parsedDisabled = JSON.parse(disabledContent);
      expect(parsedDisabled.hooks.SessionStart).toBeDefined();
      expect(parsedDisabled.hooks.Stop.length).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
