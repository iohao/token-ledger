import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const oldProjectRoot = process.env.OLD_PROJECT_ROOT ?? "/Users/join/gitme/ionet_me/codexUsageTs";
const codexHome = process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex");
const sourceDb = process.env.CODEX_USAGE_DATABASE ?? join(codexHome, ".codex-usage", "usage.sqlite");
const timeZone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

if (!existsSync(resolve(oldProjectRoot, "server/index.ts"))) {
  throw new Error(`Missing old project at ${oldProjectRoot}`);
}

if (!existsSync(sourceDb)) {
  throw new Error(`Missing source database at ${sourceDb}`);
}

const workDir = await mkdtemp(join(tmpdir(), "tokenledger-compare-"));
const tsDb = join(workDir, "ts.sqlite");
const rustDb = join(workDir, "rust.sqlite");

try {
  await mkdir(workDir, { recursive: true });
  await backupDatabase(sourceDb, tsDb);
  await backupDatabase(sourceDb, rustDb);

  const tsPort = "4317";
  const tsServer = spawn(
    "node",
    [
      "--experimental-strip-types",
      "server/index.ts",
      "--host",
      "127.0.0.1",
      "--port",
      tsPort,
      "--codex-home",
      codexHome,
      "--database",
      tsDb,
      "--timezone",
      timeZone
    ],
    {
      cwd: oldProjectRoot,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let serverOutput = "";
  tsServer.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  tsServer.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitForHealth(`http://127.0.0.1:${tsPort}/api/health`, tsServer);

  const preTsDashboard = await fetchJson(`http://127.0.0.1:${tsPort}/api/dashboard`);
  const preRustDashboard = await runRustExport({
    databasePath: rustDb,
    codexHome,
    timeZone
  });
  assertEquivalent("pre-sync dashboard", preTsDashboard, preRustDashboard);

  const preTsPreview = await fetchJson(`http://127.0.0.1:${tsPort}/api/sync-preview`);
  const preRustPreview = (
    await runRustExport({
      databasePath: rustDb,
      codexHome,
      timeZone,
      includeSyncPreview: true
    })
  ).syncPreview;
  assertDeepEqual("pre-sync preview", preTsPreview, preRustPreview);

  const postTsDashboard = await postJson(`http://127.0.0.1:${tsPort}/api/sync`);
  const postRustDashboard = await runRustExport({
    databasePath: rustDb,
    codexHome,
    timeZone,
    runSync: true,
    includeSyncPreview: true
  });
  assertEquivalent("post-sync dashboard", postTsDashboard, postRustDashboard);

  console.log("TS and Rust payloads match for pre-sync dashboard, sync preview, and post-sync dashboard.");

  tsServer.kill("SIGINT");
  await waitForExit(tsServer);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

async function backupDatabase(source, destination) {
  await runCommand("sqlite3", [source, `.backup ${destination}`], { cwd: repoRoot });
}

async function waitForHealth(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    if (child.exitCode !== null) {
      throw new Error(`Old TS server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore until retry.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for old TS server health check at ${url}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

async function runRustExport({
  databasePath,
  codexHome,
  timeZone,
  runSync = false,
  includeSyncPreview = false
}) {
  const args = [
    "run",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--quiet",
    "--bin",
    "export_dashboard",
    "--"
  ];

  if (runSync) {
    args.push("--run-sync");
  }
  if (includeSyncPreview) {
    args.push("--include-sync-preview");
  }

  const output = await runCommand(
    "cargo",
    args,
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        CODEX_USAGE_DATABASE: databasePath,
        TZ: timeZone,
        CARGO_HTTP_MULTIPLEXING: "false",
        CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
        CARGO_REGISTRIES_CRATES_IO_INDEX: "sparse+https://rsproxy.cn/index/"
      }
    }
  );

  return JSON.parse(output);
}

function normalizeDashboard(payload) {
  return {
    meta: {
      codexHomePath: payload.meta.codexHomePath,
      timeZone: payload.meta.timeZone,
      parseVersion: payload.meta.parseVersion,
      pricingNotes: payload.meta.pricingNotes
    },
    status: {
      state: payload.status.state,
      errorMessage: payload.status.errorMessage,
      coverageThrough: payload.status.coverageThrough,
      coverageGranularity: payload.status.coverageGranularity,
      scannedFiles: payload.status.scannedFiles,
      sessionCount: payload.status.sessionCount,
      dataSource: payload.status.dataSource
    },
    syncPreview: payload.syncPreview,
    summaries: payload.summaries.map(normalizeSummary),
    dailyHistory: payload.dailyHistory.map(normalizeDaily),
    monthlyHistory: payload.monthlyHistory.map(normalizeMonthly)
  };
}

function normalizeSummary(summary) {
  return {
    period: summary.period,
    totals: summary.totals,
    models: summary.models
  };
}

function normalizeDaily(summary) {
  return {
    dateKey: summary.dateKey,
    totals: summary.totals,
    models: summary.models
  };
}

function normalizeMonthly(summary) {
  return {
    monthKey: summary.monthKey,
    totals: summary.totals,
    models: summary.models
  };
}

function assertEquivalent(label, left, right) {
  assertDeepEqual(label, normalizeDashboard(left), normalizeDashboard(right));
}

function assertDeepEqual(label, left, right) {
  const leftJson = JSON.stringify(left, null, 2);
  const rightJson = JSON.stringify(right, null, 2);
  if (leftJson !== rightJson) {
    throw new Error(`${label} mismatch\n--- TS ---\n${leftJson}\n--- Rust ---\n${rightJson}`);
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        rejectPromise(
          new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stderr || stdout}`)
        );
      }
    });
  });
}

function waitForExit(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null) {
      resolvePromise();
      return;
    }
    child.once("close", () => resolvePromise());
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
