<template>
  <div class="p-8">
    <h1 class="text-2xl font-bold mb-4">@lenne.tech/nuxt-extensions Playground</h1>

    <div class="space-y-8">
      <!-- Auth Demo -->
      <section>
        <h2 class="text-xl font-semibold mb-2">Auth Demo</h2>
        <div v-if="isAuthenticated" class="p-4 bg-green-100 rounded">
          <p>Logged in as: {{ user?.name || user?.email }}</p>
          <button
            class="mt-2 px-4 py-2 bg-red-500 text-white rounded"
            @click="signOut()"
          >
            Logout
          </button>
        </div>
        <div v-else class="p-4 bg-gray-100 rounded">
          <p>Not logged in</p>
          <p class="text-sm text-gray-500">
            Auth composable is working: isAuthenticated = {{ isAuthenticated }}
          </p>
        </div>
      </section>

      <!-- Transition Demo -->
      <section>
        <h2 class="text-xl font-semibold mb-2">Transition Demo</h2>
        <button
          class="px-4 py-2 bg-blue-500 text-white rounded"
          @click="showTransition = !showTransition"
        >
          Toggle Transition
        </button>
        <LtTransitionFade>
          <div v-if="showTransition" class="mt-4 p-4 bg-blue-100 rounded">
            This content fades in and out
          </div>
        </LtTransitionFade>
      </section>

      <!-- File Utils Demo -->
      <section>
        <h2 class="text-xl font-semibold mb-2">File Utils Demo</h2>
        <p>formatFileSize(1024): {{ formatFileSize(1024) }}</p>
        <p>formatFileSize(1048576): {{ formatFileSize(1048576) }}</p>
        <p>formatDuration(125): {{ formatDuration(125) }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
const showTransition = ref(false);

// Auth composable
const { user, isAuthenticated, signOut } = useLtAuth();

// File utils
const { formatFileSize, formatDuration } = useLtFile();
</script>
