/**
 * What Vue 3.5 already does about pre-hydration input — and where it stops.
 *
 * Before adding any machinery for this, the question has to be answered empirically: does the
 * defect still exist? `vModelText` in `@vue/runtime-dom` 3.5 carries a deliberate adoption
 * path — on hydration it records `el.defaultValue` in `created`, and in `mounted` it compares
 * the live DOM value against it. When they differ it pushes the DOM value INTO the model
 * instead of overwriting the node.
 *
 * That adoption is gated on `el.type === 'text' || el.type === 'textarea'`. Every other input
 * type falls through to `el.value = newValue`, i.e. the erasure. These tests pin both halves,
 * because the gate decides whether this module needs to do anything at all — and if a future
 * Vue widens or narrows it, that must fail loudly here rather than silently change what our
 * users experience.
 *
 * The simulation is faithful: before hydration an element carries no framework listener, so a
 * keystroke changes only the DOM node's `value` property. Assigning `.value` to the
 * server-rendered markup before mounting is exactly that state.
 */

import { collectEditedFields, restoreField } from '../src/runtime/plugins/pre-hydration-input.client';
import { renderToString } from '@vue/server-renderer';
import { describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, nextTick, ref, vModelText, withDirectives } from 'vue';

/**
 * Render on the "server", let the user type into the un-hydrated markup, then hydrate.
 *
 * @returns The model value and the DOM value once hydration has settled.
 */
async function typeThenHydrate(type: string, typed: string): Promise<{ dom: string; model: string }> {
  const model = ref<string>('');
  const tag = type === 'textarea' ? 'textarea' : 'input';

  const field = defineComponent({
    name: 'Field',
    setup() {
      return () =>
        withDirectives(
          h(tag, {
            'onUpdate:modelValue': (value: string) => {
              model.value = value;
            },
            ...(tag === 'input' ? { type } : {}),
          }),
          [[vModelText, model.value]],
        );
    },
  });

  const host = document.createElement('div');
  host.innerHTML = await renderToString(createSSRApp({ render: () => h(field) }));

  // The pre-hydration window: no listener exists, so a keystroke changes only the node.
  const element = host.querySelector(tag) as HTMLInputElement | HTMLTextAreaElement;
  element.value = typed;

  createSSRApp({ render: () => h(field) }).mount(host);
  await nextTick();

  return { dom: element.value, model: model.value };
}

describe('Vue 3.5 adopts pre-hydration input — for text fields', () => {
  it('keeps what the user typed into a plain text input', async () => {
    const { dom, model } = await typeThenHydrate('text', 'kai');

    expect(model).toBe('kai');
    expect(dom).toBe('kai');
  });

  it('keeps what the user typed into a textarea', async () => {
    const { dom, model } = await typeThenHydrate('textarea', 'kai');

    expect(model).toBe('kai');
    expect(dom).toBe('kai');
  });
});

describe('Vue 3.5 does NOT adopt it for other input types', () => {
  // Exactly the types `vModelText.mounted`'s adoption gate excludes — and exactly the types a
  // login form uses, which is where typing on sight is most likely.
  it.each(['email', 'password', 'search', 'tel', 'url'])('erases what was typed into type=%s', async (type) => {
    const { model } = await typeThenHydrate(type, 'kai');

    expect(model).toBe('');
  });
});

describe('collectEditedFields — what counts as user input', () => {
  function host(html: string): HTMLDivElement {
    const element = document.createElement('div');
    element.innerHTML = html;

    return element;
  }

  it('collects a field the user changed away from its server-rendered value', () => {
    const root = host('<input type="email" value="">');
    const field = root.querySelector('input')!;
    field.value = 'kai@lenne.tech';

    expect([...collectEditedFields(root).values()]).toEqual(['kai@lenne.tech']);
  });

  it('ignores a field the SERVER pre-filled but nobody touched', () => {
    // The discriminator is `value !== defaultValue`, the same test Vue itself uses. Without
    // it, an edit form's server-supplied values would be snapshotted and could later be
    // restored over a change the app legitimately made during hydration.
    const root = host('<input type="email" value="from-server@test.com">');

    expect(collectEditedFields(root).size).toBe(0);
  });

  it('collects a field whose server value the user then edited', () => {
    const root = host('<input type="email" value="from-server@test.com">');
    root.querySelector('input')!.value = 'typed-over@test.com';

    expect([...collectEditedFields(root).values()]).toEqual(['typed-over@test.com']);
  });

  it('covers textareas as well as inputs, and ignores untouched ones', () => {
    const root = host('<textarea>server text</textarea><textarea></textarea><input value="">');
    const [edited, untouched] = [...root.querySelectorAll('textarea')];
    edited!.value = 'typed';

    expect([...collectEditedFields(root).values()]).toEqual(['typed']);
    expect(untouched!.value).toBe('');
  });
});

describe('restoreField — putting the value back so the MODEL adopts it', () => {
  it('dispatches an input event, not just a value assignment', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    const seen: string[] = [];
    field.addEventListener('input', () => seen.push(field.value));

    try {
      expect(restoreField(field, 'kai')).toBe(true);
      // A bare `.value =` would leave the model holding the old value, and the next render
      // would wipe the node again. The event is the whole point.
      expect(seen).toEqual(['kai']);
      expect(field.value).toBe('kai');
    } finally {
      field.remove();
    }
  });

  it('does nothing when the value already survived — no redundant event', () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.value = 'kai';
    let events = 0;
    field.addEventListener('input', () => (events += 1));

    try {
      expect(restoreField(field, 'kai')).toBe(false);
      expect(events).toBe(0);
    } finally {
      field.remove();
    }
  });

  it('does nothing for a field that left the document', () => {
    const field = document.createElement('input');

    expect(restoreField(field, 'kai')).toBe(false);
    expect(field.value).toBe('');
  });
});
