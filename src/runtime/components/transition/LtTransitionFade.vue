<script setup lang="ts">
/**
 * Fade transition component
 *
 * Provides a simple opacity fade animation for entering/leaving elements.
 * Configurable duration for both enter and leave animations.
 *
 * @example
 * ```vue
 * <LtTransitionFade>
 *   <div v-if="show">Content fades in/out</div>
 * </LtTransitionFade>
 *
 * <LtTransitionFade :start-duration="200" :leave-duration="150">
 *   <div v-if="show">Custom timing</div>
 * </LtTransitionFade>
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
  <div :style="`--start-duration: ${props.startDuration}ms; --leave-duration: ${props.leaveDuration}ms;`">
    <Transition
      enter-active-class="transition ease-out duration-[--start-duration]"
      enter-from-class="transform opacity-0"
      enter-to-class="transform opacity-100"
      leave-active-class="transition ease-in duration-[--leave-duration]"
      leave-from-class="transform opacity-100"
      leave-to-class="transform opacity-0"
    >
      <slot></slot>
    </Transition>
  </div>
</template>
