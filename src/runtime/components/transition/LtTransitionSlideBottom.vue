<script setup lang="ts">
/**
 * Slide transition component (from bottom)
 *
 * Provides a vertical slide animation from the bottom.
 * Elements slide up from below and down when leaving.
 *
 * @example
 * ```vue
 * <LtTransitionSlideBottom>
 *   <div v-if="show">Content slides from bottom</div>
 * </LtTransitionSlideBottom>
 * ```
 */
</script>

<template>
  <Transition
    enter-active-class="transition ease-out duration-500"
    enter-from-class="transform translate-y-full"
    enter-to-class="transform translate-y-0"
    leave-active-class="transition ease-in duration-500"
    leave-from-class="transform translate-y-0"
    leave-to-class="transform translate-y-full"
  >
    <slot></slot>
  </Transition>
</template>
