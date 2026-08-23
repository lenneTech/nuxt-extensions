import { beforeEach, describe, expect, it } from 'vitest';

import { repairDanglingLabels, repairDescribedBy, repairGroupLabels } from '../src/runtime/plugins/form-label-association.client';

/**
 * The pairing rules of the `<label for>` repair (see the plugin header for the defect).
 *
 * Driven against DOM fixtures rather than a live app, so the rules stay verifiable
 * without a browser — and so the case that matters most can be asserted at all: a
 * repair that fires where it should NOT is worse than the defect, because it would
 * re-point a working label at the wrong control and nothing would look broken.
 */

/** The markup Nuxt UI's `FormField` produces, with the ids passed in explicitly. */
function field({ controlId, labelFor, labelText = 'Team name' }: { controlId: string; labelFor: string; labelText?: string }): string {
  return `
    <div data-slot="root">
      <div data-slot="wrapper">
        <div data-slot="labelWrapper">
          <label for="${labelFor}" data-slot="label">${labelText}</label>
        </div>
      </div>
      <div><input id="${controlId}" name="teamName" type="text"></div>
    </div>
  `;
}

function render(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

// File scope, so every block below is isolated by construction rather than by the convention
// that each test remembers to assign `innerHTML` first. Ids are document-scoped, so one block's
// leftover markup can silently satisfy another block's `getElementById`.
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('repairDanglingLabels', () => {
  it('re-points a label whose target does not exist', () => {
    // Verbatim the measured divergence: server ids on the label, client ids on the control.
    const doc = render(field({ controlId: 'v-0-1-2', labelFor: 'v-0-4-2' }));

    expect(repairDanglingLabels(doc)).toBe(1);
    expect(doc.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');

    // The point of the repair: the control has an accessible name again.
    expect(doc.querySelector('input')!.labels?.[0]?.textContent?.trim()).toBe('Team name');
  });

  it('leaves a WORKING association untouched', () => {
    // The failure mode that would be worse than the defect — a repair that re-points a
    // label that was never broken.
    const doc = render(field({ controlId: 'same-id', labelFor: 'same-id' }));

    expect(repairDanglingLabels(doc)).toBe(0);
    expect(doc.querySelector('label')!.getAttribute('for')).toBe('same-id');
  });

  it('does not reach across field boundaries', () => {
    // Two fields, the FIRST one broken. Its label must not adopt the second field's
    // control just because that one happens to be next in the document.
    const doc = render(field({ controlId: 'a-client', labelFor: 'a-server' }) + field({ controlId: 'b-client', labelFor: 'b-client', labelText: 'Surname' }));

    repairDanglingLabels(doc);

    const [first, second] = [...doc.querySelectorAll('label')];
    expect(first!.getAttribute('for'), 'the broken label took the neighbouring field’s control').toBe('a-client');
    expect(second!.getAttribute('for')).toBe('b-client');
  });

  it('skips a label with no control in its field rather than guessing', () => {
    const doc = render(`
      <div data-slot="root">
        <div data-slot="labelWrapper"><label for="gone" data-slot="label">Orphan</label></div>
      </div>
      <input id="unrelated" type="text">
    `);

    expect(repairDanglingLabels(doc)).toBe(0);
    expect(doc.querySelector('label')!.getAttribute('for')).toBe('gone');
  });

  it('skips a control that carries no id of its own', () => {
    // Nothing to point AT — re-pointing at an empty id would replace a broken
    // association with a differently broken one.
    const doc = render(field({ controlId: '', labelFor: 'v-0-4-2' }));

    expect(repairDanglingLabels(doc)).toBe(0);
  });

  it('is idempotent — a second pass repairs nothing', () => {
    const doc = render(field({ controlId: 'v-0-1-2', labelFor: 'v-0-4-2' }));

    expect(repairDanglingLabels(doc)).toBe(1);
    expect(repairDanglingLabels(doc)).toBe(0);
  });

  it('repairs every broken field on a page, not just the first', () => {
    // The real shape: one page carried eleven of them.
    const doc = render(
      Array.from({ length: 11 }, (_, i) => field({ controlId: `v-0-1-${i}`, labelFor: `v-0-4-${i}`, labelText: `Field ${i}` })).join(''),
    );

    expect(repairDanglingLabels(doc)).toBe(11);
    expect([...doc.querySelectorAll('label')].filter((l) => doc.getElementById((l as HTMLLabelElement).htmlFor) === null)).toEqual([]);
  });
});

describe('repairDanglingLabels — refuses to guess inside a group', () => {
  /**
   * The shape verified against `@nuxt/ui` 4.11.0: `RadioGroup` renders ONE
   * `data-slot="root"` and N item labels, each `:for="item.id"` where `item.id` derives from
   * the GROUP's `useId()`. So when the id diverges, every label in the group dangles at once.
   */
  function group(tag: 'checkbox' | 'radio'): string {
    return `
      <div data-slot="root">
        <div data-slot="item">
          <input id="grp-client:ja" name="answer" type="${tag}">
          <label for="grp-server:ja" data-slot="label">Ja</label>
        </div>
        <div data-slot="item">
          <input id="grp-client:nein" name="answer" type="${tag}">
          <label for="grp-server:nein" data-slot="label">Nein</label>
        </div>
      </div>
    `;
  }

  it.each(['radio', 'checkbox'] as const)('leaves a %s group alone rather than binding every label to the first item', (tag) => {
    // The whole point. Binding both captions to the first input would make a click on
    // "Nein" select "Ja" — a value the user never chose, submitted silently. An inert label
    // is recoverable; a confidently wrong one is not.
    document.body.innerHTML = group(tag);

    expect(repairDanglingLabels(document)).toBe(0);
    expect([...document.querySelectorAll('label')].map((l) => l.getAttribute('for'))).toEqual(['grp-server:ja', 'grp-server:nein']);
  });
});

describe('repairDanglingLabels — which control counts', () => {
  it('takes the visible control over a hand-written native type="hidden" input', () => {
    // NOTE: this is an application's own hidden input, NOT reka's submit proxy. Until 1.13.1
    // this case was named as if it were the proxy, and that misnaming is precisely how the
    // wrong proxy theory survived review: reka renders `type="checkbox"` / `type="text"`,
    // never `type="hidden"` (pinned in test/upstream-dom-contract.test.ts). The real proxy
    // shapes are covered below.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Country</label>
        <input id="hidden-proxy" name="country" type="hidden">
        <input id="v-0-1-2" type="text">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });

  // Reka's `VisuallyHiddenInput` as it is ACTUALLY rendered: `VisuallyHidden` with `as="input"`
  // and the default `feature: 'fully-hidden'`. Note what is NOT there — no `type="hidden"`, no
  // `hidden` attribute, and no `id`. A fixture built with `type="hidden"` (as the test above
  // does, legitimately, for a hand-written native hidden input) does not stand in for this one.
  const REKA_PROXY_2_10 = '<input name="season" value="" data-hidden="" aria-hidden="true" tabindex="-1" style="position:absolute">';
  // reka-ui 2.9.x set `aria-hidden` only for the `focusable` variant, so on those versions
  // `data-hidden` is the ONLY attribute that identifies the proxy.
  const REKA_PROXY_2_9 = '<input name="season" value="" data-hidden="" tabindex="-1" style="position:absolute">';

  it.each([
    // CHARACTERISATION, not a regression test: on 2.10 the proxy also carries `aria-hidden`,
    // which 1.13.0 already excluded — so this row passes under the old selector too. It is
    // kept because it records the shape actually rendered, which is the thing 1.13.0 got wrong.
    ['reka >= 2.10 (data-hidden + aria-hidden)', REKA_PROXY_2_10],
    // REGRESSION test: on 2.9 `data-hidden` is the only identifying attribute, so this row is
    // the one that fails against the 1.13.0 selector.
    ['reka 2.9 (data-hidden only)', REKA_PROXY_2_9],
  ])('ignores the reka submit proxy as rendered by %s', (_label, proxy) => {
    // Without the `data-hidden` filter this is not a near miss: the proxy makes TWO controls
    // eligible, the group rule then skips the field, and the repair silently never happens.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Season</label>
        ${proxy}
        <input id="v-0-1-2" type="text">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });

  it.each([
    ['disabled', '<input id="v-0-1-2" type="text" disabled>'],
    ['readonly', '<input id="v-0-1-2" type="text" readonly>'],
    ['a disabled <select>', '<select id="v-0-1-2" disabled><option>a</option></select>'],
  ])('repairs a field whose only control is %s', (_label, control) => {
    // A disabled or readonly control is rendered, reaches the accessibility tree, and is
    // announced — so it needs its name just as much (WCAG 1.3.1, 4.1.2). Excluding `disabled`
    // here once made every read-only form in a consuming app reproduce this exact defect:
    // nothing was eligible, so nothing was repaired, and the label stayed pointing at nothing.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">VAT number</label>
        ${control}
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });

  it.each([
    // `aria-hidden` and `hidden` are excluded regardless of id: an element out of the
    // accessibility tree can never carry an accessible name, so binding a label to one would
    // report success and change nothing.
    ['aria-hidden, even with an id', '<input id="ghost" type="text" aria-hidden="true">'],
    ['hidden, even with an id', '<input id="ghost" type="text" hidden>'],
    // `data-hidden` is excluded only WITHOUT an id — that is what separates reka's proxy
    // (never has one) from a consumer-stamped control such as UFileUpload's file input
    // (always has one, and IS the label's intended target).
    ['data-hidden and id-less, like reka’s proxy', '<input type="text" data-hidden="">'],
  ])('ignores a control that is %s', (_label, ghost) => {
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Name</label>
        ${ghost}
        <input id="v-0-1-2" type="text">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });

  it('repairs a Nuxt UI select/checkbox/switch trigger, which is a button', () => {
    // `button` IS a labelable element, and Nuxt UI puts the FormField id on one for USelect,
    // UCheckbox and USwitch. Before 1.14.0 these were never repaired: their only native
    // control is reka's proxy, correctly excluded, leaving nothing eligible — which exempted
    // exactly the components where a caption click is the primary hit target.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Country</label>
        <input name="country" data-hidden="">
        <button id="v-0-1-2" data-slot="base" role="combobox" type="button">Choose…</button>
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });

  it('ignores a button that is not the field’s own control', () => {
    // Narrowed to `[data-slot="base"]` so a submit, clear or icon action inside the field is
    // not mistaken for the control. Nothing eligible here, so nothing is repaired.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Country</label>
        <button id="submit" type="submit">Save</button>
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(0);
  });

  it.each(['textarea', 'select'])('repairs a %s, not only an input', (tag) => {
    const control = tag === 'select' ? '<select id="v-0-1-2"><option>a</option></select>' : '<textarea id="v-0-1-2"></textarea>';
    document.body.innerHTML = `<div data-slot="root"><label for="v-0-4-2" data-slot="label">Notes</label>${control}</div>`;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });
});

describe('repairDanglingLabels — what "already resolves" may not mean', () => {
  it('repairs a label whose stale id happens to resolve to ANOTHER field', () => {
    // Server and client ids come from the same small generator space on the same page, so a
    // stale server id colliding with some other field's client id is not exotic. Treating
    // "resolves" as "healthy" would leave this label naming the wrong control forever — and
    // that control would then report two labels.
    // Field 2 is HEALTHY — its label resolves to its own control. Field 1's stale server id
    // happens to be that same string, so it resolves too, just to the wrong field.
    document.body.innerHTML = `
      <div data-slot="root"><label for="collide" data-slot="label">Email</label><input id="email-client" type="email"></div>
      <div data-slot="root"><label for="collide" data-slot="label">Password</label><input id="collide" type="password"></div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    const [email, password] = [...document.querySelectorAll('label')];
    expect(email!.getAttribute('for')).toBe('email-client');
    expect(password!.getAttribute('for'), 'the healthy field must not be disturbed').toBe('collide');
  });
});

describe('repairDanglingLabels — scope', () => {
  it('works when given an Element root, not only a Document', () => {
    // The signature accepts `ParentNode`. Resolving ids off `root` would make this a silent
    // no-op, because `getElementById` exists on Document and DocumentFragment but not on
    // Element — ids are resolved against the owning document instead.
    document.body.innerHTML = `<div id="scope">${field({ controlId: 'v-0-1-2', labelFor: 'v-0-4-2' })}</div>`;
    const scope = document.getElementById('scope')!;

    expect(repairDanglingLabels(scope)).toBe(1);
    expect(scope.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });

  it('never touches an application-authored label', () => {
    // Only Nuxt UI's own field labels carry `data-slot="label"`. A hand-written label with a
    // deliberately dangling `for` — a control behind a `v-if`, a third-party widget — must
    // survive untouched, even when it sits inside some component root.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="rendered-later">Custom</label>
        <input id="something-else" type="text">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(0);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('rendered-later');
  });
});

describe('repairDanglingLabels — refuses a repair that would be worse than the defect', () => {
  it('never adds a SECOND label to a control that already has a working one', () => {
    // Multiple <label>s CONCATENATE into one accessible name, so a second one here would yield
    // "VAT number Own label" — a name matching no visible text, which breaks speech input
    // (WCAG 2.5.3). Reachable whenever an app passes its own :id and writes its own <label for>.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">VAT number</label>
        <label for="v-0-1-2">Own label</label>
        <input id="v-0-1-2" type="text">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(0);
    expect(document.querySelector<HTMLInputElement>('#v-0-1-2')!.labels).toHaveLength(1);
  });

  it('refuses to write an id that another element in the document also carries', () => {
    // `for` resolves through getElementById, which returns the FIRST match in document order.
    // Writing a duplicated id hands the label's click to that other element. The read path
    // already refuses a target outside the field; this is the symmetric guard on the write path.
    document.body.innerHTML = `
      <div id="v-0-1-2">an impostor earlier in the document</div>
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Team name</label>
        <input id="v-0-1-2" type="text">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(0);
  });

  it('ignores a control removed by display:none, which no attribute selector can express', () => {
    // What `v-show="false"` produces. Binding here gains no accessible name, yet the
    // association would RESOLVE — permanently marking the field healthy and suppressing the
    // correct repair once the real control appears.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Team name</label>
        <input id="v-0-1-2" type="text" style="display: none">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(0);
  });
});

describe('repairDanglingLabels — the group rule under partial disablement', () => {
  it('leaves a group alone when only SOME of its items are disabled', () => {
    // The second 1.13.0 defect, and the more dangerous one. `[disabled]` filtered the disabled
    // radio out, leaving exactly one eligible control — so the group rule never engaged and
    // BOTH captions were rebound to the enabled item. Clicking "Nein" then selected "Ja":
    // a value the user never chose, submitted silently. Measured on 1.13.0: repaired=2.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="stale-ja" data-slot="label">Ja</label>
        <label for="stale-nein" data-slot="label">Nein</label>
        <input id="c:ja" type="radio" name="s" value="ja">
        <input id="c:nein" type="radio" name="s" value="nein" disabled>
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(0);
    expect([...document.querySelectorAll('label')].map((l) => l.getAttribute('for'))).toEqual(['stale-ja', 'stale-nein']);
  });

  it('leaves a group alone when ALL of its items are disabled', () => {
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="stale-ja" data-slot="label">Ja</label>
        <label for="stale-nein" data-slot="label">Nein</label>
        <input id="c:ja" type="radio" name="s" disabled>
        <input id="c:nein" type="radio" name="s" disabled>
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(0);
  });

  it('repairs a disabled control that sits beside reka’s proxy', () => {
    // The intersection of both halves of the 1.13.1 fix: the proxy must be filtered (or the
    // count reaches two and the group rule skips the field) AND the disabled control must
    // stay eligible (or nothing is left to point at).
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Quantity</label>
        <input name="qty" data-hidden="" tabindex="-1">
        <input id="v-0-1-2" type="text" disabled>
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });
});

describe('repairGroupLabels — naming a composite widget `for` cannot address', () => {
  const group = (attrs = ''): string => `
    <div data-slot="root">
      <label for="v-0-4-2" data-slot="label">Preferred contact</label>
      <div id="v-0-1-2" role="radiogroup" ${attrs}>
        <input id="opt-a" type="radio" name="contact"><input id="opt-b" type="radio" name="contact">
      </div>
    </div>
  `;

  it('points aria-labelledby at the caption when the label’s `for` dangles', () => {
    // A `for` on a <div role="radiogroup"> is inert however carefully it is chosen — `for`
    // only resolves against labelable elements. aria-labelledby names the group without
    // touching any item, so unlike a `for` repair it cannot mis-select anything.
    document.body.innerHTML = group();

    expect(repairGroupLabels(document)).toBe(1);

    const labelId = document.querySelector('label')!.id;
    expect(labelId).not.toBe('');
    expect(document.querySelector('[role="radiogroup"]')!.getAttribute('aria-labelledby')).toBe(labelId);
  });

  it('never overwrites naming the application wrote itself', () => {
    document.body.innerHTML = group('aria-labelledby="app-authored"');

    expect(repairGroupLabels(document)).toBe(0);
    expect(document.querySelector('[role="radiogroup"]')!.getAttribute('aria-labelledby')).toBe('app-authored');
  });

  it('leaves a healthy association alone', () => {
    document.body.innerHTML = group().replace('for="v-0-4-2"', 'for="v-0-1-2"');

    expect(repairGroupLabels(document)).toBe(0);
  });

  it('is idempotent', () => {
    document.body.innerHTML = group();
    repairGroupLabels(document);

    expect(repairGroupLabels(document)).toBe(0);
  });
});

describe('repairDescribedBy — the same divergence, on the error message', () => {
  const withError = (describedBy: string, errorId: string): string => `
    <div data-slot="root">
      <label for="v-0-1-2" data-slot="label">Email</label>
      <input id="v-0-1-2" type="email" aria-describedby="${describedBy}">
      <div id="${errorId}" data-slot="error">Required field</div>
    </div>
  `;

  it('re-points a token that resolves to nothing', () => {
    // FormField renders the error container's id as a compiled binding, so Vue force-patches
    // it on hydration. The matching aria-describedby arrives through a v-bind spread and does
    // NOT get patched — so it keeps the server value and points at nothing. The sighted user
    // sees "Required field"; the screen-reader user gets silence. WCAG 3.3.1 / 3.3.3.
    document.body.innerHTML = withError('v-0-4-2-error', 'v-0-1-2-error');

    expect(repairDescribedBy(document)).toBe(1);
    expect(document.querySelector('input')!.getAttribute('aria-describedby')).toBe('v-0-1-2-error');
  });

  it('keeps tokens that still resolve, and repairs only the broken one', () => {
    // Token-wise, so an application's own describedby survives untouched.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-1-2" data-slot="label">Email</label>
        <input id="v-0-1-2" aria-describedby="app-hint v-0-4-2-error">
        <div id="v-0-1-2-error" data-slot="error">Required field</div>
      </div>
      <div id="app-hint">Still resolves</div>
    `;

    expect(repairDescribedBy(document)).toBe(1);
    expect(document.querySelector('input')!.getAttribute('aria-describedby')).toBe('app-hint v-0-1-2-error');
  });

  it('leaves a healthy reference untouched', () => {
    document.body.innerHTML = withError('v-0-1-2-error', 'v-0-1-2-error');

    expect(repairDescribedBy(document)).toBe(0);
  });

  it('refuses to guess when the count of candidates does not match', () => {
    // One dangling token, two possible describing elements — the same refusal the `for` repair
    // makes. Naming the wrong element is worse than naming none.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-1-2" data-slot="label">Email</label>
        <input id="v-0-1-2" aria-describedby="v-0-4-2-error">
        <div id="a" data-slot="error">Required field</div>
        <div id="b" data-slot="help">We never share it</div>
      </div>
    `;

    expect(repairDescribedBy(document)).toBe(0);
  });

  it('does not reach into another field for a describing element', () => {
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-1-2" data-slot="label">Email</label>
        <input id="v-0-1-2" aria-describedby="v-0-4-2-error">
      </div>
      <div data-slot="root"><div id="other-error" data-slot="error">Someone else’s error</div></div>
    `;

    expect(repairDescribedBy(document)).toBe(0);
  });
});

describe('repairDanglingLabels — a consumer-stamped control that also carries data-hidden', () => {
  // Nuxt UI's UFileUpload renders the user's REAL file input through reka's
  // `VisuallyHidden feature="fully-hidden"` and puts the FormField id on it
  // (pinned in test/upstream-dom-contract.test.ts). So `data-hidden` alone does NOT
  // mean "proxy" — the missing id is what means that.

  it('repairs it when it is the field’s only control (reka 2.9 shape)', () => {
    // The regression 1.13.1 shipped with before this test existed: an unqualified
    // `[data-hidden]` excluded the field's ONLY control, leaving nothing eligible and the
    // label dangling — on a component that worked correctly under 1.13.0.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Attachment</label>
        <input id="v-0-1-2" type="file" data-hidden="" tabindex="-1">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });

  it('still refuses it when reka >= 2.10 also marks it aria-hidden', () => {
    // Deliberately NOT repaired, and this is not a gap in the plugin. An `aria-hidden`
    // element is outside the accessibility tree, so a label pointing at it carries no
    // accessible name — the repair would report success and change nothing. That field is
    // nameless and unfocusable regardless of hydration; the fix belongs in @nuxt/ui.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Attachment</label>
        <input id="v-0-1-2" type="file" data-hidden="" aria-hidden="true" tabindex="-1">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(0);
  });

  it('still excludes the id-less proxy beside it, so the count stays at one', () => {
    // Both halves at once: the id-less proxy must be filtered (or the count reaches two and
    // the group rule skips the field) while the id-bearing control stays eligible.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Attachment</label>
        <input name="files" data-hidden="" tabindex="-1">
        <input id="v-0-1-2" type="file" data-hidden="" tabindex="-1">
      </div>
    `;

    expect(repairDanglingLabels(document)).toBe(1);
    expect(document.querySelector('label')!.getAttribute('for')).toBe('v-0-1-2');
  });
});
