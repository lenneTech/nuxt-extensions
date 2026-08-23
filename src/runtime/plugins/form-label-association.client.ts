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

/**
 * Elements `for` can legally point at, in the shapes Nuxt UI renders them.
 *
 * `button` is here because `button` IS a labelable element, and Nuxt UI puts the FormField id
 * on one for three whole component families: `USelect` / `USelectMenu` (a `button
 * role="combobox"` trigger), `UCheckbox` and `USwitch` (reka's `CheckboxRoot` / `SwitchRoot`).
 * Before 1.14.0 those were never repaired — their only native control is reka's submit proxy,
 * which is correctly excluded, leaving nothing eligible. That silently exempted exactly the
 * components where the header's own "on a checkbox a click on the caption is the primary hit
 * target" argument bites hardest.
 *
 * Narrowed to `[data-slot="base"]` so an ordinary button inside a field — a submit, a clear,
 * an icon action — is not mistaken for the field's control. That slot is Nuxt UI's own marker
 * for the component's principal element; verified against 4.11.0 in
 * `test/upstream-dom-contract.test.ts`.
 */
const CONTROL = 'input, textarea, select, button[data-slot="base"]';

/**
 * Natively hidden inputs. Not reka's doing — an application's own `<input type="hidden">`.
 *
 * Note what this does NOT catch: reka's submit proxy. That proxy carries `type="checkbox"` or
 * `type="text"`, never `type="hidden"` — measured, not assumed, in the contract test. The
 * 1.13.0 fixture invented the opposite and is the reason a wrong proxy theory shipped.
 */
const NATIVE_HIDDEN = '[type="hidden"], [hidden]';

/**
 * Anything removed from the accessibility tree is never a label target.
 *
 * Deliberately NOT narrowed by `id`, unlike the proxy selector below. An `aria-hidden` element
 * is invisible to assistive technology no matter who stamped an id on it, so pointing a label
 * at one restores no accessible name — the repair would report success and change nothing.
 * (Nuxt UI's `UFileUpload` lands here on reka >= 2.10.1 for exactly that reason. That field is
 * nameless and unfocusable independent of any hydration divergence; the fix belongs upstream,
 * not here.)
 */
const NOT_IN_A11Y_TREE = '[aria-hidden="true"]';

/**
 * Reka's hidden submit proxy: the input that carries the value into a native form submit.
 *
 * Reka's `VisuallyHidden` stamps `data-hidden` for `feature: 'fully-hidden'`, which is what
 * `VisuallyHiddenInput` defaults to — `Switch`, `Checkbox`, `RadioGroup`, `Slider`, `TagsInput`,
 * `NumberField` and friends. `PinInput`, `DateField` and `TimeField` pass `feature="focusable"`
 * instead and are caught by `NOT_IN_A11Y_TREE`; neither selector covers the other, which is why
 * both exist. `aria-hidden` additionally lands on the fully-hidden variant from reka 2.10.1
 * onward but NOT on 2.9.x, so `data-hidden` is the only identifying attribute there.
 *
 * Excluding the proxy is not about picking the wrong target — it could never be picked, since
 * the rule below requires a non-empty id and the proxy has none. It is about the COUNT: an
 * unfiltered proxy makes a second control eligible, the single-control rule then skips the
 * field, and the repair silently never happens.
 *
 * `:not([id])` is what separates the proxy from a consumer-stamped control. `UFileUpload`
 * renders the user's real file input through `VisuallyHidden feature="fully-hidden"` and puts
 * the FormField id on it; on reka 2.9.x that element carries `data-hidden` and nothing else,
 * so an unqualified `[data-hidden]` excluded the field's ONLY control and left its label
 * dangling. Every reka proxy asserts `id === ''` in the contract test.
 *
 * Before simplifying any part of this selector, note what pins it — each fails if the
 * corresponding piece is dropped:
 * - `:not([id])` — "repairs it when it is the field's only control (reka 2.9 shape)"
 * - `data-hidden` — "ignores the reka submit proxy as rendered by reka 2.9 (data-hidden only)"
 * - `aria-hidden` — "still refuses it when reka >= 2.10 also marks it aria-hidden"
 * - the real shapes behind all three — `test/upstream-dom-contract.test.ts`
 */
const REKA_SUBMIT_PROXY = '[data-hidden]:not([id])';

/**
 * Controls that exist for form submission rather than for the user, or that no one can reach.
 *
 * `[disabled]` is deliberately absent, and was removed in 1.13.1 after it caused exactly the
 * defect this file exists to repair: where a field's only control is disabled, filtering it
 * left nothing eligible, so the label stayed dangling and every read-only form lost its
 * accessible names. A disabled control is rendered, stays in the accessibility tree and is
 * announced; WCAG 1.3.1 and 4.1.2 apply to it unchanged, and WCAG's only carve-out for
 * inactive components is contrast (1.4.3 / 1.4.11) — there is no naming exemption anywhere.
 * Disablement is a property of the FIELD, never a marker of reka's submit proxy.
 *
 * For a disabled control the repair restores the accessible NAME only: a disabled element
 * prevents click dispatch and is not focusable, so the label's click-to-focus half is dead
 * either way. The name alone is the whole value on a read-only form, which is precisely the
 * page a screen-reader user reads rather than operates.
 */
const NOT_A_USER_CONTROL = `${NATIVE_HIDDEN}, ${NOT_IN_A11Y_TREE}, ${REKA_SUBMIT_PROXY}`;

/**
 * Field roots that are a composite widget rather than a single control.
 *
 * `URadioGroup` and `UCheckboxGroup` put the FormField id on reka's `RadioGroupRoot`, which
 * renders a `<div role="radiogroup">`. `for` can never work there — it only resolves against
 * labelable elements — so a repaired `for` would be inert no matter how carefully it was
 * chosen. These get `aria-labelledby` instead.
 */
const GROUP_ROOT = '[role="radiogroup"], [role="group"]';

/** The FormField slots that hold a control's description, in the order a label would name them. */
const DESCRIBING_SLOTS = '[data-slot="error"], [data-slot="help"], [data-slot="description"], [data-slot="hint"]';

/** An element hidden by style rather than by attribute, which no selector can express. */
function isVisuallyRemoved(element: Element): boolean {
  // `[hidden]` and `[aria-hidden]` are attributes and live in NOT_A_USER_CONTROL. `display:none`
  // — what `v-show="false"` produces — is not, and such a control must not be chosen: the label
  // would gain no accessible name, yet the association would RESOLVE, permanently marking the
  // field healthy and suppressing the correct repair once the real control appears.
  const style = (element as HTMLElement).style;

  return style?.display === 'none' || style?.visibility === 'hidden';
}

/**
 * The control a label may be re-pointed at, or `null` when the field is ambiguous.
 *
 * Exactly one eligible control is required. Zero means there is nothing safe to point at. More
 * than one means a group, and guessing inside a group is how a caption click ends up selecting
 * an option the user did not pick.
 */
function findControlForLabel(field: Element): Element | null {
  const eligible = [...field.querySelectorAll(CONTROL)].filter((control) => !control.matches(NOT_A_USER_CONTROL) && !isVisuallyRemoved(control));

  return eligible.length === 1 && eligible[0]!.id !== '' ? eligible[0]! : null;
}

/**
 * Whether writing `for="${control.id}"` on this label is safe.
 *
 * Two ways a repair can be worse than the dangling label it replaces, both verified against a
 * real accessible-name computation rather than reasoned about:
 *
 * 1. **The control already has a working label.** Multiple `<label>` elements CONCATENATE into
 *    one accessible name, so adding a second yields "VAT number Own label" — a name that
 *    matches no visible text, which breaks speech input (WCAG 2.5.3) and reads as nonsense.
 *    Reachable whenever an app passes its own `:id` to a field and writes its own `<label for>`.
 * 2. **The id is not unique.** `for` resolves through `getElementById`, which returns the FIRST
 *    match in document order. Writing an id that another element also carries hands the label's
 *    click to that other element. The read path already refuses a target outside the field
 *    (below); this closes the symmetric case on the write path.
 */
function isSafeToBind(label: HTMLLabelElement, control: Element): boolean {
  if ((control as HTMLInputElement).labels?.length) {
    return false;
  }

  return label.ownerDocument.getElementById(control.id) === control;
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
    if (control === null || control.id === label.htmlFor || !isSafeToBind(label, control)) {
      continue;
    }

    label.htmlFor = control.id;
    label.dataset.ltLabelRepaired = '';
    repaired += 1;
  }

  return repaired;
}

/**
 * Name composite widgets whose label cannot be repaired with `for`.
 *
 * A `<div role="radiogroup">` is not labelable, so the `for` repair above skips it and leaves
 * the group with no accessible name at all — the group's caption stays in the tree as loose
 * text, and a screen reader announces the radiogroup unnamed. `aria-labelledby` is the correct
 * instrument here: it names the group without touching any item, so it cannot mis-select
 * anything, which makes it strictly safer than the `for` repair.
 *
 * Gated exactly like `for`: one candidate root per field, and only when the label's own `for`
 * does not already resolve.
 *
 * @returns how many group roots were named.
 */
export function repairGroupLabels(root: Document | ParentNode): number {
  let repaired = 0;

  for (const label of root.querySelectorAll<HTMLLabelElement>(FIELD_LABEL)) {
    const field = label.closest(COMPONENT_ROOT);
    if (field === null) {
      continue;
    }

    const target = label.ownerDocument.getElementById(label.htmlFor);
    if (target !== null && field.contains(target)) {
      continue;
    }

    const groups = field.querySelectorAll(GROUP_ROOT);
    if (groups.length !== 1) {
      continue;
    }

    const group = groups[0]!;

    // Never overwrite an application's own naming — it is more specific than anything guessed
    // from position, and an app that set it did so deliberately.
    if (group.hasAttribute('aria-labelledby') || group.hasAttribute('aria-label')) {
      continue;
    }

    // FormField gives its label no id of its own, so one has to be minted before it can be
    // referenced. Derived from the group's id to stay stable across sweeps and collisions.
    if (label.id === '') {
      label.id = `${group.id === '' ? label.htmlFor : group.id}-lt-label`;
    }

    group.setAttribute('aria-labelledby', label.id);
    label.dataset.ltLabelRepaired = '';
    repaired += 1;
  }

  return repaired;
}

/**
 * Re-point `aria-describedby` tokens that hydration left dangling.
 *
 * The SAME divergence that breaks `for` breaks this, for the same reason, and it is arguably
 * worse. `FormField` renders its error / help / description containers with `:id` as a compiled
 * element binding, so those ids ARE in `dynamicProps` and Vue force-patches them to the client
 * value. The matching `aria-describedby` reaches the control through `useFormField().ariaAttrs`
 * inside a `v-bind` spread, which is NOT in `dynamicProps` — so it keeps the server value.
 *
 * The result on exactly the pages this plugin was written for: every validation error, help
 * text and description points at an id that no longer exists. A sighted user sees "Required
 * field"; a screen-reader user gets silence. That is WCAG 3.3.1 / 3.3.3 — the error is visible
 * but never announced on the field it belongs to.
 *
 * Repaired token-wise rather than wholesale, so a describedby token the application wrote and
 * that still resolves is left exactly as it is.
 *
 * @returns how many controls had at least one token repaired.
 */
export function repairDescribedBy(root: Document | ParentNode): number {
  let repaired = 0;

  for (const control of root.querySelectorAll<HTMLElement>('[aria-describedby]')) {
    const field = control.closest(COMPONENT_ROOT);
    if (field === null) {
      continue;
    }

    const tokens = control.getAttribute('aria-describedby')!.split(/\s+/).filter(Boolean);
    const dangling = tokens.filter((token) => control.ownerDocument.getElementById(token) === null);
    if (dangling.length === 0) {
      continue;
    }

    // Only the describing elements of THIS field are candidates, and only as many as there are
    // dangling tokens — so a field with one broken token and two candidates is left alone
    // rather than guessed at, the same refusal the `for` repair makes.
    const candidates = [...field.querySelectorAll(DESCRIBING_SLOTS)].filter((element) => element.id !== '');
    if (candidates.length !== dangling.length) {
      continue;
    }

    const replacements = new Map(dangling.map((token, index) => [token, candidates[index]!.id]));
    control.setAttribute('aria-describedby', tokens.map((token) => replacements.get(token) ?? token).join(' '));
    repaired += 1;
  }

  return repaired;
}

/**
 * Run every repair over `root` and report what each one did.
 *
 * @returns the per-repair counts, so the dev warning can name the mechanism rather than a total.
 */
export function repairFieldAssociations(root: Document | ParentNode): { describedBy: number; groups: number; labels: number } {
  return {
    describedBy: repairDescribedBy(root),
    groups: repairGroupLabels(root),
    labels: repairDanglingLabels(root),
  };
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

    /**
     * Clamped, because an out-of-range value fails in the least obvious direction: a delay
     * above 2^31 overflows `setTimeout` and fires IMMEDIATELY, so an over-large window
     * silently becomes no window — the exact opposite of what the author asked for. `NaN`
     * behaves the same way.
     */
    const configured = options?.maxRepairMs ?? 1500;
    const maxRepairMs = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 30_000) : 0;
    const observeDeferred = options?.observeDeferred !== false;

    let sweeping: null | ReturnType<typeof setInterval> = null;
    let closing: null | ReturnType<typeof setTimeout> = null;
    let observer: MutationObserver | null = null;
    let warned = false;

    const sweep = (): void => {
      const { describedBy, groups, labels } = repairFieldAssociations(document);
      if (import.meta.dev && !warned && describedBy + groups + labels > 0) {
        // Once per page, not once per sweep: the interval plus the observer can fire this a
        // dozen times on a deferred-hydration page, and a wall of identical warnings is read
        // as noise rather than as a defect report.
        warned = true;

        // Name the fields, not just a count. "repaired 3" sends a developer hunting; the label
        // text is what they are actually looking for. A silent repair would be worse still —
        // it masks the defect, removes the pressure to fix it upstream, and leaves the next
        // reader looking at a `for` attribute nobody in the codebase wrote.
        const names = [...document.querySelectorAll<HTMLElement>('[data-lt-label-repaired]')].map((label) => label.textContent?.trim()).filter(Boolean);

        console.warn(
          `[@lenne.tech/nuxt-extensions] repaired ${labels} label association(s), ${groups} group name(s) and ` +
            `${describedBy} aria-describedby reference(s) broken by an SSR/client useId() divergence` +
            `${names.length > 0 ? `: ${names.join(', ')}` : ''}. ` +
            'This is a stopgap — see runtime/plugins/form-label-association.client.ts.',
        );
      }
    };

    /**
     * Sweep now, then keep sweeping briefly.
     *
     * The window is not decoration: a server-rendered subtree behind delayed hydration
     * (an unresolved `<Suspense>`, an island) carries the same divergence but hydrates AFTER
     * `app:mounted`, so a single pass would never reach it. Content rendered entirely on the
     * client needs no repair at all — with no server render there is nothing to diverge from.
     */
    const sweepFor = (): void => {
      sweep();

      if (maxRepairMs <= 0) {
        return;
      }

      // Restart the window rather than drop the request. A navigation landing at t=1400 ms
      // brings NEW server-rendered content and deserves the full `maxRepairMs`, not the 100 ms
      // left over from the previous page — which is what returning early here used to give it.
      // The interval itself is started once and reused, so restarting cannot stack sweeps.
      if (sweeping === null) {
        sweeping = setInterval(sweep, 250);
      }
      if (closing !== null) {
        clearTimeout(closing);
      }
      closing = setTimeout(() => {
        if (sweeping !== null) {
          clearInterval(sweeping);
          sweeping = null;
        }
        closing = null;
      }, maxRepairMs);
    };

    /**
     * Catch what the bounded window structurally cannot.
     *
     * `hydrate-on-visible` fires on scroll and `hydrate-on-interaction` on a click — either can
     * be minutes after mount, and both carry the very same divergence. No fixed window reaches
     * them; only watching does. The observer costs nothing while nothing changes, and the
     * filter keeps it from waking on ordinary re-renders: it reacts only to ADDED subtrees that
     * actually contain a field label, and coalesces a burst into one sweep per frame.
     */
    const observeDeferredHydration = (): void => {
      if (!observeDeferred || observer !== null || typeof MutationObserver === 'undefined') {
        return;
      }

      let queued = false;
      observer = new MutationObserver((records) => {
        if (queued) {
          return;
        }
        const carriesLabel = records.some((record) =>
          [...record.addedNodes].some((node) => node instanceof Element && (node.matches(FIELD_LABEL) || node.querySelector(FIELD_LABEL) !== null)),
        );
        if (!carriesLabel) {
          return;
        }
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          sweep();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };

    nuxtApp.hook('app:mounted', () => {
      sweepFor();
      observeDeferredHydration();
    });

    // Belt and braces for a navigation that pulls in server-rendered content. An ordinary
    // client-side navigation cannot produce the defect — label and control come from one
    // `useId()` call in one render — so this is not the load-bearing path, and the sweep is a
    // cheap no-op when nothing is broken.
    nuxtApp.hook('page:finish', () => {
      requestAnimationFrame(sweepFor);
    });
  },
});
