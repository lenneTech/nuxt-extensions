import { CheckboxRoot, NumberFieldRoot, PinInputRoot, SwitchRoot, VisuallyHidden } from 'reka-ui';
import { createApp, defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The upstream DOM contracts that `form-label-association.client.ts` is built on.
 *
 * ## Why this file exists
 *
 * The plugin repairs markup emitted by reka-ui and Nuxt UI. Its selectors — `[data-slot="root"]`,
 * `label[data-slot="label"]`, `[data-hidden]` — are assertions ABOUT THOSE LIBRARIES, and until
 * 1.14.0 nothing in this repo could check them: neither package was installed, so every fixture
 * in the plugin's own test file was hand-transcribed from something observed once, elsewhere.
 *
 * That is not a theoretical weakness. It is the direct cause of the 1.13.0 defect. The fixture
 * for reka's submit proxy was invented as `<input type="hidden">`; reka renders nothing of the
 * kind (see the first test below — the real proxy carries `type="checkbox"` or `type="text"`).
 * The invented shape was caught by the invented selector, the suite went green, and the wrong
 * theory shipped — bringing `[disabled]` with it, which then suppressed the repair on every
 * read-only form in every consuming project.
 *
 * So the split is deliberate:
 *
 * - `form-label-association.test.ts` tests OUR pairing rules against DOM fixtures. That is the
 *   right tool there: those rules are ours and owe nothing to upstream.
 * - THIS file tests THEIR markup, by rendering the real components and reading the real sources.
 *   It is the tripwire. When reka renames `data-hidden` or Nuxt UI stops stamping `data-slot`,
 *   this fails — instead of the rule tests staying green over a plugin that has silently
 *   stopped working, which is exactly the 1.13.0 failure mode.
 *
 * The sibling stopgap already had such a tripwire and the form-label plugin did not: see
 * `test/pre-hydration-input.test.ts`, which pins Vue's real hydration behaviour by running a
 * real SSR + hydrate rather than asserting what Vue is believed to do.
 */

/** Mount a component detached and return its host, so the whole rendered subtree is queryable. */
function mount(component: unknown, props: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  createApp(defineComponent({ render: () => h(component as never, props) })).mount(host);
  return host;
}

/** The submit proxy inside a rendered reka component, or `null` when it renders none. */
function proxyOf(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[data-hidden]');
}

/**
 * Read a file from an installed package.
 *
 * Deliberately NOT `require.resolve`: both packages ship an `exports` map that refuses these
 * subpaths. Resolving through `node_modules` keeps the assertion pointed at the real installed
 * dependency — the point of the file — rather than at a copy checked in here.
 */
function readFromPackage(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'node_modules', relativePath), 'utf8');
}

describe('reka-ui: the hidden submit proxy, as actually rendered', () => {
  it.each([
    ['SwitchRoot', SwitchRoot, { modelValue: false, name: 'active' }, 'checkbox'],
    ['CheckboxRoot', CheckboxRoot, { modelValue: false, name: 'agree' }, 'checkbox'],
    ['NumberFieldRoot', NumberFieldRoot, { modelValue: 1, name: 'qty' }, 'text'],
  ])('%s renders a proxy with data-hidden, no id, and type="%s" — never type="hidden"', (_name, component, props, expectedType) => {
    const proxy = proxyOf(mount(component, props));

    expect(proxy).not.toBeNull();
    expect(proxy!.getAttribute('type')).toBe(expectedType);

    // The three things the 1.13.0 fixture claimed and reka does not do. `type="hidden"` is the
    // one that mattered: the old exclusion list led with it, and it has never matched anything
    // reka emits.
    expect(proxy!.getAttribute('type')).not.toBe('hidden');
    expect(proxy!.hasAttribute('hidden')).toBe(false);

    // Load-bearing for the repair. The proxy carrying no id is what lets the plugin distinguish
    // it from a consumer-stamped control such as Nuxt UI's UFileUpload input, which also carries
    // `data-hidden` but IS the user's control.
    expect(proxy!.id).toBe('');
  });

  it('renders the PinInput proxy with aria-hidden and NOT data-hidden', () => {
    // PinInputRoot passes feature="focusable" explicitly, unlike the components above. This is
    // why `[aria-hidden="true"]` and `[data-hidden]` are both needed: neither covers the other.
    const host = mount(PinInputRoot, { modelValue: [], name: 'code' });
    const ariaHidden = host.querySelector<HTMLInputElement>('input[aria-hidden="true"]');

    expect(ariaHidden).not.toBeNull();
    expect(ariaHidden!.hasAttribute('data-hidden')).toBe(false);
  });

  it('sets aria-hidden on the fully-hidden variant too — but only since reka 2.10.1', () => {
    // Pins the version story in NOT_A_USER_CONTROL's JSDoc. reka 2.9.x set aria-hidden ONLY for
    // the focusable variant, so there `data-hidden` was the only identifying attribute. A reader
    // on 2.10.x must not conclude from the installed version alone that `data-hidden` is now
    // redundant — it is not, for anyone still on 2.9.
    const el = mount(VisuallyHidden, { as: 'input', feature: 'fully-hidden' }).firstElementChild!;

    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.hasAttribute('data-hidden')).toBe(true);
    expect(el.getAttribute('tabindex')).toBe('-1');
  });

  it('emits data-hidden from exactly one place in the library', () => {
    // The JSDoc calls `data-hidden` "precise in both directions". That holds only while reka
    // emits it nowhere else — assert it instead of trusting a grep someone ran once.
    expect(readFromPackage('reka-ui/src/VisuallyHidden/VisuallyHidden.vue')).toContain(
      "data-hidden=\"feature === 'fully-hidden' ? '' : undefined\"",
    );
  });

  it('roots Switch and Checkbox on a <button>, not on a native input', () => {
    // Consequence: their FormField id lands on a button. `button` IS labelable, so these are
    // repairable — but only if CONTROL includes it. Pinned so the gap cannot be forgotten.
    expect(mount(SwitchRoot, { modelValue: false }).firstElementChild!.tagName).toBe('BUTTON');
    expect(mount(CheckboxRoot, { modelValue: false }).firstElementChild!.tagName).toBe('BUTTON');
  });
});

describe('@nuxt/ui: the field contracts the plugin keys on', () => {
  it('stamps data-slot="root" on the FormField root and data-slot="label" on its label', () => {
    const source = readFromPackage('@nuxt/ui/dist/runtime/components/FormField.vue');

    expect(source).toContain('data-slot="root"');
    expect(source).toContain('data-slot="label"');

    // The label's `for` is a PROP on reka's Label component, so it reaches the <label> through
    // $attrs and is absent from the element's dynamicProps. That component boundary is what
    // exempts it from Vue's hydration force-patch — the entire reason this plugin exists.
    expect(source).toMatch(/<Label\s+:for="id"/);
  });

  it('renders UFileUpload’s REAL control as a fully-hidden VisuallyHidden carrying the field id', () => {
    // The trap that made this release's first cut a regression: this element carries
    // `data-hidden` AND is the user's control AND holds the label's target id. Excluding it on
    // `data-hidden` alone left the field with nothing eligible and the label dangling. The id
    // is what tells it apart from a proxy — every reka proxy above asserts `id === ''`.
    const source = readFromPackage('@nuxt/ui/dist/runtime/components/FileUpload.vue');

    expect(source).toMatch(/<VisuallyHidden[\s\S]{0,240}:id="id"/);
    expect(source).toMatch(/<VisuallyHidden[\s\S]{0,240}feature="fully-hidden"/);
  });

  it('gives UFileUpload its own click trigger, so the label is not the only way in', () => {
    // Load-bearing for a deliberate NON-repair. On reka >= 2.10.1 that file input is also
    // `aria-hidden="true"`, so `NOT_IN_A11Y_TREE` excludes it and the field's label is left
    // dangling on purpose: an element outside the accessibility tree cannot carry an accessible
    // name, so binding to it would give a screen-reader user nothing while marking the field
    // "healthy" forever — hiding an upstream defect behind a repair that repaired nothing.
    //
    // The one thing binding WOULD still buy is click-to-open, and this assertion is why that
    // does not tip the decision: the wrapper opens the picker itself. If Nuxt UI ever drops
    // this handler, the trade-off changes and this test is where that surfaces.
    const source = readFromPackage('@nuxt/ui/dist/runtime/components/FileUpload.vue');

    expect(source).toMatch(/@click="props\.interactive && !disabled && open\(\)"/);
  });

  it('marks that same control aria-hidden, which is an upstream accessibility defect', () => {
    // Pinned so the reasoning above stays checkable rather than remembered. `feature`
    // "fully-hidden" yields `aria-hidden="true"` from reka 2.10.1 (asserted by rendering, in
    // the reka block above). Combined with the id, that leaves UFileUpload with no named,
    // focusable control at all — independent of any hydration divergence. Belongs in a
    // @nuxt/ui issue; this plugin deliberately does not paper over it.
    //
    // WHEN THIS TEST FAILS, the defect was likely fixed upstream: re-evaluate whether
    // NOT_IN_A11Y_TREE should stay unqualified, because the reason it is unqualified is
    // exactly this markup.
    const source = readFromPackage('@nuxt/ui/dist/runtime/components/FileUpload.vue');
    const block = /<VisuallyHidden[\s\S]{0,400}?\/>/.exec(source)![0];

    expect(block).toContain('feature="fully-hidden"');
    expect(block).not.toContain('aria-hidden="false"');
  });

  it('roots RadioGroup on a div, so `for` can never work there', () => {
    // A `for` pointing at a <div role="radiogroup"> is inert no matter how it is repaired —
    // `for` only resolves against labelable elements. Groups need aria-labelledby instead.
    expect(readFromPackage('@nuxt/ui/dist/runtime/components/RadioGroup.vue')).toMatch(/RadioGroupRoot/);
  });
});
