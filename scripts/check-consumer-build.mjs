#!/usr/bin/env node
/**
 * Consumer smoke test: pack the module, install the tarball into a throwaway
 * Nuxt project, and build it.
 *
 * WHY this exists — the repo's own checks are blind to a whole class of bugs:
 *   - the playground installs EVERY devDependency, so an optional peer that is
 *     really mandatory (a static value import) always resolves there;
 *   - `check` never runs `prepack`, so a broken prepack step goes unnoticed;
 *   - nothing verifies `files` / `exports`, so a missing entry only surfaces
 *     after publishing.
 *
 * Two real bugs shipped past a green `check` this way (see CHANGELOG 1.9.1):
 * the `@better-auth/passkey` optional peer broke every consumer build, and
 * `sync-module-version` silently froze `meta.version` at 1.5.2.
 *
 * The consumer installs ONLY the non-optional peers — that is the whole point:
 * it reproduces a project that does not want passkeys, TUS uploads or Playwright.
 *
 * Not part of `check` (it costs ~1-2 min of install + build). It runs in
 * `release` and CI, where that price buys a guarantee the fast guards cannot.
 *
 * Usage: node scripts/check-consumer-build.mjs [--keep]
 *   --keep  leave the temp project in place for inspection
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = process.argv.includes("--keep");
const started = Date.now();

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const optional = pkg.peerDependenciesMeta ?? {};

// Only the peers a consumer MUST install. Optional ones are deliberately left
// out — installing them would hide exactly the bug this test exists for.
const requiredPeers = Object.entries(pkg.peerDependencies ?? {})
  .filter(([name]) => optional[name]?.optional !== true)
  .map(([name]) => name);

const omitted = Object.keys(optional).filter((name) => optional[name]?.optional === true);

function run(cmd, args, cwd, label) {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    console.error(`\n✗ ${label} failed\n`);
    console.error(out.split("\n").slice(-30).join("\n"));
    process.exit(1);
  }
}

console.log(`[consumer-build] required peers: ${requiredPeers.join(", ") || "(none)"}`);
console.log(`[consumer-build] deliberately NOT installed: ${omitted.join(", ") || "(none)"}`);

// `npm pack` runs prepack — so this also covers the version sync + module build.
// Derive the filename instead of parsing `--json`: prepack writes to stdout too,
// so the JSON arrives mixed in with the build output.
console.log("[consumer-build] packing…");
run("npm", ["pack", "--pack-destination", tmpdir()], ROOT, "npm pack");
const tarball = join(tmpdir(), `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`);
if (!existsSync(tarball)) {
  console.error(`✗ expected tarball not found: ${tarball}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "lt-consumer-"));
try {
  // Pin the peers to the versions this repo develops against, so a failure here
  // is about the packed module and not about resolving some unrelated range.
  const deps = { [pkg.name]: `file:${tarball}` };
  for (const peer of requiredPeers) {
    const dev = pkg.devDependencies?.[peer];
    if (!dev) {
      console.error(`✗ required peer "${peer}" has no devDependency to pin against`);
      process.exit(1);
    }
    deps[peer] = dev;
  }

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "lt-consumer-smoke", private: true, type: "module", dependencies: deps }, null, 2),
  );
  writeFileSync(
    join(dir, "nuxt.config.ts"),
    `export default defineNuxtConfig({ modules: ['${pkg.name}'], ltExtensions: { auth: { enabled: true }, ai: { enabled: true } } })\n`,
  );
  writeFileSync(join(dir, "app.vue"), "<template><div>smoke</div></template>\n");

  console.log("[consumer-build] installing…");
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir, "npm install");

  console.log("[consumer-build] building…");
  const out = run("npx", ["nuxt", "build"], dir, "nuxt build");

  // A build can "succeed" while the module silently did nothing — assert it ran.
  if (!out.includes(pkg.name)) {
    console.error(`✗ the packed module never announced itself during the build — is it registered?`);
    process.exit(1);
  }

  console.log(`\n✓ consumer build passed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
} finally {
  rmSync(tarball, { force: true });
  if (KEEP) console.log(`[consumer-build] kept: ${dir}`);
  else rmSync(dir, { force: true, recursive: true });
}
