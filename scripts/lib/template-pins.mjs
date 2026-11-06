/**
 * Which versions `lt fullstack init` would raise in nuxt-base-template when it vendors this package.
 *
 * Vendor mode copies src/ into the project's app/core/ and then raises every version the project
 * shares with this package to this package's version when that is newer (cli:
 * `src/lib/align-framework-pins.ts`, `alignFrameworkPins()`, called from
 * `src/extensions/frontend-helper.ts`). A raised version is one the template's own `check` never
 * ran with. After 1.24.0 that was vue-tsc 3.3.13 → 3.3.14: six TS2339 in a template component,
 * and a template check that stopped at the first `//` in a component attribute with exit 0
 * (smoke test, 2026-11-05). A type check of the template would have missed the second part, so
 * this gate compares versions instead: when nothing is raised, the template's own check has
 * already run with every version a vendored project gets.
 *
 * The rule is the CLI's, and must stay identical to it:
 * - A package the project already declares is raised to the framework's version when that is
 *   newer, in the section the project keeps it. Never lowered, never moved, never added.
 * - What the framework ships (`dependencies`) raises either section; what it only develops with
 *   (`devDependencies`) raises only the project's devDependencies.
 * - A range is raised only when the framework's version lies above the whole range. Anything that
 *   is neither a version nor a range (`workspace:*`, a URL, a tag) is skipped and reported.
 * - Only exact framework versions count.
 */

import semver from "semver";

/** The template's package.json, on the branch new projects are created from. */
export const TEMPLATE_PACKAGE_JSON_URL =
  "https://raw.githubusercontent.com/lenneTech/nuxt-base-starter/main/nuxt-base-template/package.json";

const SECTIONS = /** @type {const} */ (["dependencies", "devDependencies"]);

/** Which framework sections may raise a version in each section of the project. */
const RAISE_SOURCES = {
  dependencies: ["dependencies"],
  devDependencies: ["dependencies", "devDependencies"],
};

/**
 * Never compared: the CLI removes this package from the project before it aligns, and the CLI's
 * shared rule skips nest-server.
 */
const NOT_ALIGNED = new Set(["@lenne.tech/nest-server", "@lenne.tech/nuxt-extensions"]);

/**
 * @typedef {{ from: string, name: string, section: "dependencies" | "devDependencies", to: string }} PinRaise
 * @typedef {{ current: string, name: string, section: string }} PinSkip
 */

/**
 * @param {Record<string, any>} project the template's package.json
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} framework this package's package.json
 * @returns {{ compared: number, raised: PinRaise[], skipped: PinSkip[] }}
 */
export function pinsVendoringRaises(project, framework) {
  /** @type {PinRaise[]} */
  const raised = [];
  /** @type {PinSkip[]} */
  const skipped = [];
  let compared = 0;

  for (const section of SECTIONS) {
    const own = project?.[section];
    if (!own || typeof own !== "object") continue;
    for (const [name, current] of Object.entries(own)) {
      if (NOT_ALIGNED.has(name) || typeof current !== "string") continue;
      const target = newestFrameworkVersion(framework, name, RAISE_SOURCES[section]);
      if (!target) continue;
      compared++;

      if (semver.valid(current)) {
        if (semver.gt(target, current)) raised.push({ from: current, name, section, to: target });
      } else if (semver.validRange(current)) {
        if (semver.gtr(target, current)) raised.push({ from: current, name, section, to: target });
      } else {
        skipped.push({ current, name, section });
      }
    }
  }

  return { compared, raised, skipped };
}

/**
 * The newest exact version the framework declares for `name` across `sections`.
 *
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} framework
 * @param {string} name
 * @param {readonly ("dependencies" | "devDependencies")[]} sections
 * @returns {string | undefined}
 */
function newestFrameworkVersion(framework, name, sections) {
  let newest;
  for (const section of sections) {
    const version = framework?.[section]?.[name];
    if (semver.valid(version) && (!newest || semver.gt(version, newest))) newest = version;
  }
  return newest;
}
