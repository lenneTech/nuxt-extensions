/**
 * Pre-hydration input preservation — the part Vue does not do yet.
 *
 * ## What Vue already handles
 *
 * Until Vue hydrates a server-rendered `<input>`, the element carries no framework listener.
 * What the user types is written to the DOM node, the `input` event reaches no model, and
 * `v-model`'s mounted hook then writes the model value back over it — the entry is ERASED,
 * not delayed.
 *
 * Vue fixed this in `vModelText` (vuejs/core#14411, shipped in 3.5.41): `created` records
 * `el.defaultValue`, and `mounted` compares the live value against it. When they differ, the
 * DOM value is pushed INTO the model instead of the node being overwritten.
 *
 * That adoption is gated on `el.type === 'text' || el.type === 'textarea'`. **Every other
 * input type still falls through to the erasure** — `email`, `password`, `tel`, `url`,
 * `search`, `number`. Verified against Vue 3.5.41 in `test/pre-hydration-input.test.ts`.
 *
 * Widening the gate is tracked upstream as vuejs/core#15210 (open, `p2-edge-case`, no
 * milestone, PR #15211 pending). **This plugin is a stopgap for exactly that gap and should
 * be deleted once the upstream fix lands** — the test above will start failing on the types
 * Vue has taken over, which is the signal to remove it.
 *
 * ## Why this matters more than the gate suggests
 *
 * The uncovered types are precisely the ones a sign-in form uses. That is also where people
 * type on sight, and where losing the entry is most expensive: a password silently truncated
 * to its last few characters produces "invalid credentials", which sends the user down the
 * wrong diagnostic path entirely.
 *
 * ## How it works
 *
 * At `app:beforeMount` the client bundle has loaded but hydration has not run, so every
 * server-rendered field still holds whatever the user typed. A field is treated as edited
 * when its live value differs from `defaultValue` — the same test Vue itself uses, so the
 * server's own pre-filled values are never mistaken for user input.
 *
 * At `app:mounted` any field whose value was overwritten gets it back, followed by a
 * synthetic `input` event so the framework's own listener adopts it. Setting `.value` alone
 * would not do: the model would still hold the old value and the next render would wipe the
 * node again.
 *
 * A browser autofill that landed before hydration is recovered the same way.
 *
 * ## Why not make the field `readonly` until mounted
 *
 * Declining the keystroke was the first approach tried and it is worse. The user is left with
 * a field that looks usable and silently refuses, which reads as a broken page. It also costs
 * real things: `readonly` is the documented technique for SUPPRESSING browser autofill,
 * screen readers announce "read only" and never announce the silent flip back, and mobile
 * browsers do not raise the on-screen keyboard for it. Preserving the entry avoids all of
 * that, because the field is never anything other than a normal, editable field.
 */

import type { LtPreHydrationInputOptions } from '../types';

import { defineNuxtPlugin, useRuntimeConfig } from '#imports';

type EditableField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Collect fields the user edited before hydration.
 *
 * `value !== defaultValue` is the discriminator, matching Vue's own: `defaultValue` is what
 * the server rendered, so a difference can only have come from the user (or from an autofill,
 * which is just as worth keeping). Server-supplied values therefore never enter the snapshot
 * and can never be restored over a legitimate change made during hydration.
 */
export function collectEditedFields(root: ParentNode): Map<EditableField, string> {
  const edited = new Map<EditableField, string>();

  for (const node of root.querySelectorAll('input, textarea')) {
    const field = node as EditableField;
    if (field.value !== field.defaultValue) {
      edited.set(field, field.value);
    }
  }

  return edited;
}

/**
 * Write a preserved value back onto a field and tell the framework about it.
 *
 * @returns `true` when a value was actually restored.
 */
export function restoreField(field: EditableField, value: string): boolean {
  if (!field.isConnected || field.value === value) {
    return false;
  }

  field.value = value;
  // The synthetic event is what makes the MODEL adopt the value. Without it the node shows
  // text the model knows nothing about, and the next render discards it again.
  field.dispatchEvent(new Event('input', { bubbles: true }));

  return true;
}

export default defineNuxtPlugin({
  // After the app's own plugins: the restore has to land once hydration has done its writes.
  enforce: 'post',
  name: 'lt-pre-hydration-input',
  setup(nuxtApp) {
    const options = (useRuntimeConfig().public.ltExtensions as { preHydrationInput?: LtPreHydrationInputOptions } | undefined)?.preHydrationInput;
    if (options?.enabled === false) {
      return;
    }

    const maxRestoreMs = options?.maxRestoreMs ?? 1500;
    let edited: Map<EditableField, string> = new Map();

    nuxtApp.hook('app:beforeMount', () => {
      // The bundle has loaded but hydration has not run, so the DOM still holds what was
      // typed. This is the last moment at which that is true.
      edited = collectEditedFields(document);
    });

    nuxtApp.hook('app:mounted', () => {
      if (edited.size === 0) {
        return;
      }

      const sweep = (): void => {
        for (const [field, value] of edited) {
          if (restoreField(field, value)) {
            // Once only. After this the application owns the field, and a later programmatic
            // clear — a reset button, a form reset — must not be undone by this plugin.
            edited.delete(field);
          }
        }
      };

      sweep();

      if (maxRestoreMs <= 0) {
        edited = new Map();

        return;
      }

      // Keep trying briefly for subtrees whose mount is deferred: an unresolved `<Suspense>`
      // boundary writes its model value later than `app:mounted`. When the window elapses the
      // snapshot is dropped, so typed values — passwords included — are not kept alive.
      const interval = setInterval(sweep, 250);
      setTimeout(() => {
        clearInterval(interval);
        edited = new Map();
      }, maxRestoreMs);
    });
  },
});
