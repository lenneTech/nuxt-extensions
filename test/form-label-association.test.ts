import { beforeEach, describe, expect, it } from 'vitest';

import { repairDanglingLabels } from '../src/runtime/plugins/form-label-association.client';

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

describe('repairDanglingLabels', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

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
  it('skips the hidden form-value proxy and takes the visible control', () => {
    // Reka-based components render a hidden native control next to the visible one. Pointing
    // at it restores neither the name nor the click — and because the association would then
    // RESOLVE, the healthy-check would suppress any correct repair from then on.
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

  it.each([
    ['aria-hidden', '<input id="ghost" type="text" aria-hidden="true">'],
    ['disabled', '<input id="ghost" type="text" disabled>'],
    ['hidden', '<input id="ghost" type="text" hidden>'],
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

  it('skips a field whose only visible control is a button', () => {
    // A select-style trigger. `for` on a button would be legal, but the hidden input next to
    // it is not the user's control — so there is nothing safe to point at. Skipping beats
    // pointing at the wrong thing.
    document.body.innerHTML = `
      <div data-slot="root">
        <label for="v-0-4-2" data-slot="label">Country</label>
        <input id="hidden-proxy" name="country" type="hidden">
        <button id="trigger" role="combobox" type="button">Choose…</button>
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
