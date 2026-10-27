#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const workspaceRoot = path.resolve(argValue("--workspace-root") ?? process.cwd());
const packageJsonPath = path.join(workspaceRoot, "package.json");

const serviceAliases = new Map([
  ["default", "xrain"],
  ["workspace", "xrain"],
  ["service", "xrain"],
  ["services", "xrain"],
  ["xrain", "xrain"],
  ["lowcode", "xrain"],
  ["toolchain-smoke", "frontend-toolchain-smoke"],
  ["frontend-toolchain-smoke", "frontend-toolchain-smoke"],
]);

const commandMap = {
  xrain: {
    start: "start",
    stop: "stop",
    restart: "restart",
    status: "status",
    doctor: "doctor",
    diagnose: "doctor",
    check: "status",
    feed: "xrain:feed",
    "test-install-atomicity": "xrain:test:install-atomicity",
    "candidate-check": "xrain:candidate:check",
    "candidate-build": "xrain:candidate:build",
    "candidate-activate": "xrain:candidate:activate",
    "candidate-deactivate": "xrain:candidate:deactivate",
    build: "xrain:build",
    "backend-reload": "xrain:backend:reload",
    "frontend-start": "frontend:xrain:start",
    "reload-backend": "xrain:backend:reload",
    "host-reload": "xrain:backend:reload",
    migrate: "xrain:migrate",
    "repair-legacy-audit": "xrain:repair-legacy-audit",
    "isolated-migrate-check": "xrain:isolated:migrate-check",
    rebuild: "xrain:rebuild-database",
    "rebuild-database": "xrain:rebuild-database",
    "reset-owned-data": "xrain:reset-owned-data",
    "reset-xrain-data": "xrain:reset-owned-data",
  },
  "frontend-toolchain-smoke": {
    start: "frontend:toolchain-smoke:start",
    stop: "frontend:toolchain-smoke:stop",
    restart: "frontend:toolchain-smoke:restart",
    status: "frontend:toolchain-smoke:status",
    check: "frontend:toolchain-smoke:status",
    build: "frontend:toolchain-smoke:build",
  },
};

function readPackageJson() {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    console.error(`Cannot read target package.json at ${packageJsonPath}: ${error.message}`);
    console.error("Run from the target project or pass --workspace-root <directory>.");
    process.exit(1);
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(exitCode = 0) {
  console.log(`Usage:
  node <skill>/scripts/run-service.mjs [--workspace-root <directory>] --service <xrain|frontend-toolchain-smoke> --action <action>
  node <skill>/scripts/run-service.mjs [--workspace-root <directory>] --list

Examples:
  node <skill>/scripts/run-service.mjs --workspace-root <target-project> --service xrain --action start

The target project defaults to the current working directory.
Use --list to read its available package scripts.`);
  process.exit(exitCode);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage(0);
}

if (process.argv.includes("--list")) {
  const scripts = Object.keys(readPackageJson().scripts ?? {}).sort();
  console.log(`Available package scripts in ${workspaceRoot}:\n${scripts.map(script => `  - ${script}`).join("\n")}`);
  process.exit(0);
}

const rawService = (argValue("--service") ?? "default").toLowerCase();
const rawAction = (argValue("--action") ?? "status").toLowerCase();
const service = serviceAliases.get(rawService);

if (!service) {
  console.error(`Unknown service: ${rawService}`);
  usage(1);
}

const scriptName = commandMap[service]?.[rawAction];
if (!scriptName) {
  console.error(`Unknown action '${rawAction}' for service '${service}'.`);
  usage(1);
}

const packageJson = readPackageJson();
if (!packageJson.scripts?.[scriptName]) {
  console.error(`package.json does not define script '${scriptName}'. Update package.json first, then update this skill mapping.`);
  process.exit(1);
}

console.log(`[shzw-service-starter] ${service}:${rawAction} -> npm run ${scriptName}`);
const result =
  process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], {
        cwd: workspaceRoot,
        stdio: "inherit",
        windowsHide: true,
      })
    : spawnSync("npm", ["run", scriptName], {
        cwd: workspaceRoot,
        stdio: "inherit",
        windowsHide: true,
      });

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
