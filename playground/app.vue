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

      <!-- Pre-Hydration Input Preservation Demo -->
      <section>
        <h2 class="text-xl font-semibold mb-2">Pre-Hydration Input Preservation</h2>
        <p class="text-sm text-gray-500 mb-2">
          Type into these before the page hydrates (throttle the CPU and reload). Vue keeps the
          text field on its own since 3.5.41; the email and password fields are the gap this
          module's plugin closes.
        </p>
        <div class="space-y-2">
          <input v-model="demoText" class="border rounded px-2 py-1 w-full" placeholder="type=text (Vue handles this)" type="text">
          <input v-model="demoEmail" autocomplete="username" class="border rounded px-2 py-1 w-full" placeholder="type=email (module handles this)" type="email">
          <input v-model="demoSecret" autocomplete="current-password" class="border rounded px-2 py-1 w-full" placeholder="type=password (module handles this)" type="password">
        </div>
        <!-- The models, so a test can tell the model adopted the value rather than the DOM
             node merely showing one. -->
        <pre id="demo-models" class="mt-2 text-xs">{{ JSON.stringify({ text: demoText, email: demoEmail, secret: demoSecret }) }}</pre>
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
const demoText = ref('');
const demoEmail = ref('');
const demoSecret = ref('');

// Auth composable
const { user, isAuthenticated, signOut } = useLtAuth();

// File utils
const { formatFileSize, formatDuration } = useLtFile();
</script>
