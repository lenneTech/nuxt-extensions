/**
 * Repair `<label for>` associations that hydration leaves pointing at nothing.
 *
 * ## The defect
 *
 * Nuxt UI's `FormField` generates ONE id with `useId()` and uses it for both halves of
 * the association: `<Label :for="id">` and, via `provide`/`inject`, the control's `id`.
 * One source, so the two cannot disagree — unless `useId()` itself returns different
 * values on the server and on the client.
 *
 * It does. Measured on a Nuxt 4 app page (SVL, DEV-3093), against `@nuxt/ui` 4.11.x:
 *
 * | | label `for` | control `id` |
 * | -- | -- | -- |
 * | SSR payload | `v-0-4-2` | `v-0-4-2` |
 * | after hydration | `v-0-4-2` | `v-0-1-2` |
 *
 * The middle segment is Vue's per-branch id prefix, which is extended at every async
 * boundary. Server and client walked a different number of them, so the ids diverge.
 *
 * **Vue >= 3.5.39 did not cause this — it exposed it.** "force patch dynamic props when
 * hydrating" (vuejs/core#9083, merged 2026-06-25) makes a hydrated element adopt its
 * freshly computed client value, where previously the server value simply stayed.
 *
 * Note WHY only the label is left behind, because it points at the real fix: the control's
 * `id` is a compiled element binding (`<input :id="id">`), so it is in the element's
 * `dynamicProps` and gets force-patched. The label's `for` is a PROP on reka-ui's `Label`
 * component and arrives at the `<label>` through `$attrs`, which is not part of that set.
 * The asymmetry is the component boundary, not the id generation. Fixing the divergence
 * upstream — or having `FormField` pass an SSR-stable id — removes the need for this file.
 *
 * ## Why it is worth a plugin
 *
 * A control whose label does not resolve loses its programmatic label: the visible text is
 * no longer its accessible name (WCAG 1.3.1). Where the field has no placeholder it has no
 * accessible name at all and a screen reader announces "edit text, blank" (4.1.2). Where it
 * has one, the placeholder becomes the name instead — which is arguably worse, because the
 * name no longer contains the visible label and speech input stops working (2.5.3 Label in
 * Name). Clicking the label also no longer focuses the control, and for a checkbox or radio
 * that is not a convenience but the primary hit target.
 *
 * And any test that addresses fields the way assistive technology does
 * (`getByRole('textbox', { name })`, the recommended Playwright locator) stops finding
 * them, which is how this surfaced: 39 specs at once.
 *
 * ## What this does, and what it deliberately does not
 *
 * After mount — and for a bounded window afterwards — every Nuxt UI field label whose
 * target does not resolve is re-pointed at the control inside its own field.
 *
 * It **refuses to guess**, which is the rule that matters most here. A repair that fires
 * where it should not is worse than the defect: a dangling label is inert and visible, a
 * mis-pointed one is confidently wrong and silent, and on a radio or checkbox a click on
 * the caption would then change a value the user never chose. So the repair only happens
 * when the field contains exactly ONE eligible control. A group of radios or checkboxes
 * shares one field root and is therefore skipped, not guessed at.
 *
 * `for` is repaired rather than `aria-labelledby` added, because `for` carries BOTH the
 * accessible name and click-to-focus. Adding `aria-labelledby` would restore the name
 * and leave the label dead to the mouse.
 *
 * This is a repair, not a cure: the right fix is for the id not to diverge in the first
 * place (see the component-boundary note above). It is applied here because the divergence
 * sits in the framework stack rather than in any one application, and because a nameless
 * form is not something to leave in place while that is resolved upstream.
 *
 * Default on; opt out with `ltExtensions.formLabelAssociation.enabled: false`.
 */

import type { LtExtensionsPublicRuntimeConfig } from '../types';

import { defineNuxtPlugin, useRuntimeConfig } from '#imports';

/**
 * Nuxt UI's field root. Verified against `@nuxt/ui` 4.11.0.
 *
 * Deliberately NOT named `FIELD_ROOT`: Nuxt UI stamps `data-slot="root"` on every component
 * root via `$attrs['data-slot'] ?? 'root'`, so this matches the nearest COMPONENT root, which
 * is only usually the `FormField`. The single-control rule below is what makes that safe.
 */
const COMPONENT_ROOT = '[data-slot="root"]';

/**
 * Only Nuxt UI's own field labels, not every `<label for>` on the page.
 *
 * Scanning `label[for]` would rewrite application-authored labels that merely happen to sit
 * inside some component root — including a `for` deliberately pointing at a control rendered
 * later. A library plugin that is on by default must not touch markup it was not aimed at.
 */
const FIELD_LABEL = 'label[data-slot="label"][for]';

/** Elements `for` can legally point at, in the shapes Nuxt UI renders them. */
const CONTROL = 'input, textarea, select';

/**
 * Controls that exist for form submission rather than for the user.
 *
 * Reka-based components (`Select`, `SelectMenu`, `InputMenu`, `RadioGroup`) render a hidden
 * native control next to the visible trigger. Pointing a label at one restores neither the
 * accessible name nor click-to-focus — and because the association then *resolves*, the
 * guard below would treat it as healthy forever, permanently suppressing a correct repair.
 */
const NOT_A_USER_CONTROL = '[type="hidden"], [hidden], [aria-hidden="true"], [disabled]';

/**
 * The control a label may be re-pointed at, or `null` when the field is ambiguous.
 *
 * Exactly one eligible control is required. Zero means there is nothing to point at (a
 * select-style field whose only visible control is a `button` lands here, and skipping is
 * the correct outcome). More than one means a group, and guessing inside a group is how a
 * caption click ends up selecting an option the user did not pick.
 */
function findControlForLabel(field: Element): Element | null {
  const eligible = [...field.querySelectorAll(CONTROL)].filter((control) => !control.matches(NOT_A_USER_CONTROL));

  return eligible.length === 1 && eligible[0]!.id !== '' ? eligible[0]! : null;
}

/**
 * Re-point every dangling field label at the control in its own field.
 *
 * Exported for the unit test: it runs against a DOM fixture rather than a live app, so the
 * pairing rules stay verifiable without a browser. Not part of the package's public API.
 *
 * @param root Where to look. Ids are resolved against the owning document regardless, since
 *   `id` is document-scoped — so a scoped root narrows which labels are visited, not which
 *   ids count as resolvable.
 * @returns how many labels were repaired.
 */
export function repairDanglingLabels(root: Document | ParentNode): number {
  let repaired = 0;

  for (const label of root.querySelectorAll<HTMLLabelElement>(FIELD_LABEL)) {
    const field = label.closest(COMPONENT_ROOT);
    if (field === null) {
      continue;
    }

    // Resolve against the owning document, never against `root`: `getElementById` exists on
    // `Document` and `DocumentFragment` but NOT on `Element`, so reading it off `root` makes
    // every element-scoped call a silent no-op.
    const target = label.ownerDocument.getElementById(label.htmlFor);

    // An association that resolves INSIDE its own field is working and is never touched —
    // this must not be able to break a page that is already correct. Resolving to something
    // outside the field is not health: the stale server id can collide with another field's
    // client id, and that label would otherwise stay bound to the wrong control forever.
    if (target !== null && field.contains(target)) {
      continue;
    }

    const control = findControlForLabel(field);
    if (control === null || control.id === label.htmlFor) {
      continue;
    }

    label.htmlFor = control.id;
    repaired += 1;
  }

  return repaired;
}

export default defineNuxtPlugin({
  // After the app's own plugins, so a page that assigns ids itself has already run.
  enforce: 'post',
  name: 'lt-form-label-association',
  setup(nuxtApp) {
    const options = (useRuntimeConfig().public.ltExtensions as LtExtensionsPublicRuntimeConfig['ltExtensions'] | undefined)?.formLabelAssociation;
    if (options?.enabled === false) {
      return;
    }

    const maxRepairMs = options?.maxRepairMs ?? 1500;
    let sweeping: null | ReturnType<typeof setInterval> = null;

    const sweep = (): void => {
      const repaired = repairDanglingLabels(document);
      if (repaired > 0 && import.meta.dev) {
        // Say so in development. A repair that is silent masks the defect, removes the
        // pressure to fix it upstream, and leaves the next developer looking at a `for`
        // attribute nobody in the codebase wrote.
        console.warn(
          `[@lenne.tech/nuxt-extensions] repaired ${repaired} form label association(s) broken by an SSR/client useId() divergence. ` +
            'This is a stopgap — see runtime/plugins/form-label-association.client.ts.',
        );
      }
    };

    /**
     * Sweep now, then keep sweeping briefly.
     *
     * The window is not decoration: a server-rendered subtree behind delayed hydration
     * (`hydrate-on-visible`, an unresolved `<Suspense>`, an island) carries the same
     * divergence but hydrates AFTER `app:mounted`, so a single pass would never reach it.
     * Content rendered entirely on the client needs no repair at all — with no server render
     * there is nothing for its ids to diverge from.
     */
    const sweepFor = (): void => {
      sweep();

      if (maxRepairMs <= 0 || sweeping !== null) {
        return;
      }
      sweeping = setInterval(sweep, 250);
      setTimeout(() => {
        if (sweeping !== null) {
          clearInterval(sweeping);
          sweeping = null;
        }
      }, maxRepairMs);
    };

    nuxtApp.hook('app:mounted', sweepFor);

    // Belt and braces for a navigation that pulls in server-rendered content (an island, a
    // lazily hydrated section). An ordinary client-side navigation cannot produce the defect
    // — label and control come from one `useId()` call in one render — so this is not the
    // load-bearing path, and the sweep is a cheap no-op when nothing is broken.
    nuxtApp.hook('page:finish', () => {
      requestAnimationFrame(sweepFor);
    });
  },
});
