<script setup lang="ts">
import { computed } from 'vue';

const errorMessages: Readonly<Record<string, string>> = {
  authorization_denied: 'Home Assistant authorization was cancelled or denied.',
  authorization_failed: 'Home Assistant authorization could not be completed.',
  authorization_rejected: 'Home Assistant rejected the authorization request.',
  home_assistant_unavailable: 'Home Assistant could not be reached.',
  invalid_oauth_callback: 'The authorization response was invalid.',
  invalid_oauth_transaction: 'The authorization request expired or has already been used.',
};

const route = useRoute();
const errorCode = computed(() =>
  typeof route.query.code === 'string' ? route.query.code : 'authorization_failed',
);
const errorMessage = computed(
  () =>
    errorMessages[errorCode.value] ??
    'Home Assistant authorization could not be completed. Try again.',
);

useHead({ title: 'Authorization error — Aether' });
</script>

<template>
  <main class="bg-base-200 text-base-content grid min-h-screen place-items-center p-6">
    <section class="card bg-base-100 w-full max-w-md border shadow-sm">
      <div class="card-body">
        <h1 class="card-title text-2xl">Authorization failed</h1>
        <p role="alert">{{ errorMessage }}</p>
        <div class="card-actions mt-4">
          <NuxtLink class="btn btn-primary" to="/">Return to Aether</NuxtLink>
        </div>
      </div>
    </section>
  </main>
</template>
