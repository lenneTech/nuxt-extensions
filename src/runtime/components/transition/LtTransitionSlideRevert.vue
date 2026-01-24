<script setup lang="ts">
/**
 * Slide transition component (from left)
 *
 * Provides a horizontal slide animation from the left side.
 * Elements slide in from the left and out to the left.
 * This is the reverse of LtTransitionSlide.
 *
 * @example
 * ```vue
 * <LtTransitionSlideRevert>
 *   <div v-if="show">Content slides from left</div>
 * </LtTransitionSlideRevert>
 * ```
 */
</script>

<template>
  <Transition
    enter-active-class="transition ease-out duration-500"
    enter-from-class="transform translate-x-[-100%]"
    enter-to-class="transform translate-x-0"
    leave-active-class="transition ease-in duration-500"
    leave-from-class="transform translate-x-0"
    leave-to-class="transform translate-x-[-100%]"
  >
    <slot></slot>
  </Transition>
</template>
