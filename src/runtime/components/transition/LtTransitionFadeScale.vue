<script setup lang="ts">
/**
 * Fade with scale transition component
 *
 * Provides a combined fade and scale animation.
 * Elements fade in while scaling up from 95% to 100%,
 * and fade out while scaling down to 95%.
 *
 * Great for modal dialogs, dropdown menus, and pop-ups.
 *
 * @example
 * ```vue
 * <LtTransitionFadeScale>
 *   <div v-if="show">Content fades and scales</div>
 * </LtTransitionFadeScale>
 *
 * <LtTransitionFadeScale :start-duration="200" :leave-duration="150">
 *   <div v-if="show">Custom timing</div>
 * </LtTransitionFadeScale>
 * ```
 */
const props = withDefaults(
  defineProps<{
    /** Duration in ms for the leave animation (default: 100) */
    leaveDuration?: `${number}` | number;
    /** Duration in ms for the enter animation (default: 100) */
    startDuration?: `${number}` | number;
  }>(),
  {
    leaveDuration: 100,
    startDuration: 100,
  },
);
</script>

<template>
  <div
    :style="`--start-duration: ${props.startDuration}ms; --leave-duration: ${props.leaveDuration}ms;`"
  >
    <Transition
      enter-active-class="transition ease-out duration-[--start-duration]"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-[--leave-duration]"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <slot></slot>
    </Transition>
  </div>
</template>
