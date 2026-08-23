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

  // vue-tsc + typescript must live IN the consumer project: vue-tsc resolves
  // typescript relative to itself, so an npx-fetched copy cannot see the consumer's.
  const devDeps = {
    typescript: pkg.devDependencies?.typescript,
    "vue-tsc": pkg.devDependencies?.["vue-tsc"],
  };
  for (const [name, version] of Object.entries(devDeps)) {
    if (!version) {
      console.error(`\u2717 "${name}" has no devDependency to pin the consumer typecheck against`);
      process.exit(1);
    }
  }

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name: "lt-consumer-smoke", private: true, type: "module", dependencies: deps, devDependencies: devDeps },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, "nuxt.config.ts"),
    `export default defineNuxtConfig({ modules: ['${pkg.name}'], ltExtensions: { auth: { enabled: true }, ai: { enabled: true } } })\n`,
  );
  writeFileSync(join(dir, "app.vue"), "<template><div>smoke</div></template>\n");

  // A consumer that USES the auth client the way real projects do, so the packed
  // TYPES are exercised and not just the packed runtime.
  //
  // Why this exists: 1.15.0 shipped a type-only regression that every gate here
  // was blind to. `check` was 10/10 green and `nuxt build` below succeeded, while
  // the starter's `typecheck` went from 0 to 14 errors on the same code. The cause
  // was narrowing the auth wrappers' `options` parameter from `any` to `unknown`:
  // better-auth derives each action's RETURN type from that generic, so the
  // concrete `{ data, error }` union collapsed to `Promise<unknown>` and every
  // `const { data, error } = await authClient.…()` in a consumer stopped compiling.
  //
  // Building proves the module runs. Only typechecking proves it is still usable.
  //
  // KNOWN LIMIT: these assertions catch a type going USELESS (`unknown`, or newly
  // `| undefined`). They do NOT catch a return type narrowing from one concrete
  // union to a different, smaller concrete union — measured: the 1.15.0 regression
  // also narrowed signIn/changePassword returns that way, and only the five checks
  // below fired. Comparing the packed .d.ts against the previous release is what
  // would close that gap; this is the cheap 80%.
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ extends: "./.nuxt/tsconfig.json", include: ["consumer-types.ts", "app.vue"] }, null, 2),
  );
  writeFileSync(
    join(dir, "consumer-types.ts"),
    [
      "// Compiled, never executed. Type-level assertions only — deliberately NOT",
      "// mimicked API calls, because guessing better-auth's exact response shapes",
      "// makes the fixture fail for reasons that have nothing to do with a regression.",
      "// What matters is that the packed types stay USABLE, and that is checkable directly.",
      `import { createLtAuthClient } from '${pkg.name}/lib';`,
      "",
      "type Fail<M extends string> = { REGRESSION: M };",
      "// `any` satisfies BOTH `unknown extends T` and `undefined extends T`, so the",
      "// naive checks below would flag the pre-1.15.0 baseline (which is `any` here).",
      "// This is the standard discriminator: only `any` absorbs the `1 & T` intersection.",
      "type IsAny<T> = 0 extends 1 & T ? true : false;",
      "// `any` is permitted: it is the historical shape and it stays usable for consumers.",
      "// What must never appear is a type that is concrete AND useless.",
      "type NotUnknown<T, M extends string> = IsAny<T> extends true ? true : unknown extends T ? Fail<M> : true;",
      "type Defined<T, M extends string> = IsAny<T> extends true ? true : undefined extends T ? Fail<M> : true;",
      "",
      "const authClient = createLtAuthClient({ baseURL: 'http://localhost:3000' });",
      "type C = typeof authClient;",
      "// `Ret` must special-case `any` as well: inferring `R` out of `any` yields",
      "// `unknown`, which would make every `any`-typed action look like a regression.",
      "type Ret<F> = IsAny<F> extends true ? any : F extends (...a: never[]) => infer R ? Awaited<R> : Fail<'not callable'>;",
      "",
      "// Return types must stay concrete. In 1.15.0 they collapsed to `Promise<unknown>`",
      "// because the wrappers' `options` parameter was narrowed from `any` to `unknown`,",
      "// and better-auth derives each action's return type from that generic. Every",
      "// `const { data, error } = await authClient.…()` in a consumer stopped compiling.",
      "export const _r1: NotUnknown<Ret<C['changePassword']>, 'changePassword return collapsed to unknown'> = true;",
      "export const _r2: NotUnknown<Ret<C['resetPassword']>, 'resetPassword return collapsed to unknown'> = true;",
      "export const _r3: NotUnknown<Ret<C['signIn']['email']>, 'signIn.email return collapsed to unknown'> = true;",
      "export const _r4: NotUnknown<Ret<C['signUp']['email']>, 'signUp.email return collapsed to unknown'> = true;",
      "",
      "// Plugin surfaces must stay reachable without the consumer narrowing them first.",
      "// In 1.15.0 these became `| undefined`, producing TS18048/TS2722 at every call site.",
      "export const _p1: Defined<C['passkey'], 'authClient.passkey became optional'> = true;",
      "export const _p2: Defined<C['admin'], 'authClient.admin became optional'> = true;",
      "export const _p3: Defined<C['twoFactor']['verifyTotp'], 'twoFactor.verifyTotp became optional'> = true;",
      "export const _p4: Defined<C['twoFactor']['verifyBackupCode'], 'twoFactor.verifyBackupCode became optional'> = true;",
      "export const _p5: NotUnknown<Ret<C['twoFactor']['enable']>, 'twoFactor.enable return collapsed to unknown'> = true;",
      "",
    ].join("\n"),
  );

  console.log("[consumer-build] installing…");
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir, "npm install");

  console.log("[consumer-build] building…");
  const out = run("npx", ["nuxt", "build"], dir, "nuxt build");

  console.log("[consumer-build] typechecking the consumer against the packed types…");
  run("npx", ["vue-tsc", "--noEmit", "-p", "tsconfig.json"], dir, "consumer typecheck");

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
