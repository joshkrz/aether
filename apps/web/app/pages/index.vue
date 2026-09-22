<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';

import { normalizeApiError } from '../api/apiError';
import {
  authStatusQueryOptions,
  engineSetupMutationOptions,
  loginMutationOptions,
  logoutMutationOptions,
} from '../queries/authQuery';

const foundations = [
  'Zones and rooms with optional membership',
  'Plants that group climate systems',
  'Whole-house schedules with main and override slots',
  'Installation safety settings',
] as const;

const apiErrorMessages: Readonly<Record<string, string>> = {
  authorization_start_failed: 'Home Assistant authorization could not be started. Try again.',
  initial_setup_unavailable: 'Initial setup is temporarily unavailable. Restart the engine.',
  invalid_request_body: 'Check the values and try again.',
  invalid_setup_code: 'The setup code is invalid or expired.',
  network_error: 'The Aether engine could not be reached.',
  setup_complete: 'Setup has already been completed. Refresh the page to continue.',
  setup_required: 'Initial setup must be completed before signing in.',
  unauthenticated: 'Your session has expired. Sign in again.',
};

const errorMessage = (error: unknown): string => {
  const normalized = normalizeApiError(error);
  return apiErrorMessages[normalized.code] ?? 'The request could not be completed. Try again.';
};

const queryClient = useQueryClient();
const authStatusQuery = useQuery(authStatusQueryOptions());
const authStatus = computed(() => authStatusQuery.data.value);
const authenticatedUser = computed(() =>
  authStatus.value?.status === 'authenticated' ? authStatus.value.user : undefined,
);

const engineSetupMutation = useMutation(engineSetupMutationOptions());
const loginMutation = useMutation(loginMutationOptions());
const logoutMutation = useMutation(logoutMutationOptions(queryClient));

const homeAssistantOrigin = ref('');
const setupCode = ref('');
const revealSetupCode = ref(false);

const authStatusError = computed(() =>
  authStatusQuery.error.value === null ? undefined : errorMessage(authStatusQuery.error.value),
);
const engineSetupError = computed(() =>
  engineSetupMutation.error.value === null
    ? undefined
    : errorMessage(engineSetupMutation.error.value),
);
const loginError = computed(() =>
  loginMutation.error.value === null ? undefined : errorMessage(loginMutation.error.value),
);
const logoutError = computed(() =>
  logoutMutation.error.value === null ? undefined : errorMessage(logoutMutation.error.value),
);
const navigateToAuthorization = ({ authorizationUrl }: { authorizationUrl: string }): void => {
  window.location.assign(authorizationUrl);
};

const submitEngineSetup = (): void => {
  engineSetupMutation.mutate(
    {
      homeAssistantOrigin: homeAssistantOrigin.value.trim(),
      returnPath: '/',
      setupCode: setupCode.value.trim(),
    },
    { onSuccess: navigateToAuthorization },
  );
};

const submitLogin = (): void => {
  loginMutation.mutate({ returnPath: '/' }, { onSuccess: navigateToAuthorization });
};

const submitLogout = (): void => {
  logoutMutation.mutate();
};
</script>

<template>
  <main
    v-if="authStatusQuery.isPending.value"
    class="bg-base-200 text-base-content grid min-h-screen place-items-center p-6"
  >
    <p role="status">Checking authentication…</p>
  </main>

  <main
    v-else-if="authStatusQuery.isError.value"
    class="bg-base-200 text-base-content grid min-h-screen place-items-center p-6"
  >
    <section class="card bg-base-100 w-full max-w-md border shadow-sm">
      <div class="card-body">
        <h1 class="card-title">Aether is unavailable</h1>
        <p role="alert">{{ authStatusError }}</p>
        <div class="card-actions mt-2">
          <button class="btn btn-primary" type="button" @click="authStatusQuery.refetch()">
            Retry
          </button>
        </div>
      </div>
    </section>
  </main>

  <main
    v-else-if="authStatus?.status === 'setup_required'"
    class="bg-base-200 text-base-content grid min-h-screen place-items-center p-6"
  >
    <section class="card bg-base-100 w-full max-w-lg border shadow-sm">
      <form class="card-body" @submit.prevent="submitEngineSetup">
        <h1 class="card-title text-2xl">Set up Aether</h1>
        <p>Connect Aether to your Home Assistant instance.</p>

        <label class="form-control mt-4">
          <span class="label-text mb-2">Home Assistant URL</span>
          <input
            v-model="homeAssistantOrigin"
            class="input input-bordered w-full"
            type="url"
            placeholder="http://homeassistant.local:8123"
            autocomplete="url"
            autocapitalize="none"
            spellcheck="false"
            required
          />
        </label>

        <label class="form-control mt-4">
          <span class="label-text mb-2">Setup code</span>
          <span class="join w-full">
            <input
              v-model="setupCode"
              class="input input-bordered join-item min-w-0 flex-1"
              :type="revealSetupCode ? 'text' : 'password'"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              required
            />
            <button
              class="btn join-item"
              type="button"
              :aria-pressed="revealSetupCode"
              @click="revealSetupCode = !revealSetupCode"
            >
              {{ revealSetupCode ? 'Hide' : 'Show' }}
            </button>
          </span>
        </label>

        <p class="text-base-content/65 mt-2 text-sm">
          The setup code is printed in the Aether engine or container log.
        </p>

        <p v-if="engineSetupError" class="alert alert-error mt-4" role="alert">
          {{ engineSetupError }}
        </p>

        <div class="card-actions mt-4">
          <button
            class="btn btn-primary"
            type="submit"
            :disabled="engineSetupMutation.isPending.value"
          >
            {{ engineSetupMutation.isPending.value ? 'Connecting…' : 'Connect Home Assistant' }}
          </button>
        </div>
      </form>
    </section>
  </main>

  <main
    v-else-if="authStatus?.status === 'unauthenticated'"
    class="bg-base-200 text-base-content grid min-h-screen place-items-center p-6"
  >
    <section class="card bg-base-100 w-full max-w-md border shadow-sm">
      <div class="card-body">
        <h1 class="card-title text-2xl">Sign in to Aether</h1>
        <p>Use your Home Assistant account to continue.</p>

        <p v-if="loginError" class="alert alert-error mt-4" role="alert">
          {{ loginError }}
        </p>

        <div class="card-actions mt-4">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="loginMutation.isPending.value"
            @click="submitLogin"
          >
            {{
              loginMutation.isPending.value
                ? 'Opening Home Assistant…'
                : 'Continue with Home Assistant'
            }}
          </button>
        </div>
      </div>
    </section>
  </main>

  <div v-else-if="authenticatedUser" class="bg-base-200 text-base-content min-h-screen">
    <header class="border-base-300 bg-base-100/90 border-b backdrop-blur">
      <div class="navbar mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="navbar-start gap-3">
          <a href="#top" class="text-xl font-semibold tracking-tight">Aether</a>
          <span class="badge badge-success badge-sm">Signed in</span>
        </div>

        <nav class="navbar-end gap-1" aria-label="Primary navigation">
          <a class="btn btn-ghost btn-sm hidden sm:inline-flex" href="#overview">Overview</a>
          <a
            v-if="authenticatedUser.isAdmin"
            class="btn btn-ghost btn-sm hidden sm:inline-flex"
            href="#configuration"
            >Configuration</a
          >
          <a class="btn btn-ghost btn-sm hidden sm:inline-flex" href="#foundation">Foundation</a>
          <span class="hidden text-sm md:inline">{{ authenticatedUser.displayName }}</span>
          <span v-if="authenticatedUser.isAdmin" class="badge badge-outline hidden md:inline-flex">
            Admin
          </span>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            :disabled="logoutMutation.isPending.value"
            @click="submitLogout"
          >
            {{ logoutMutation.isPending.value ? 'Signing out…' : 'Sign out' }}
          </button>
        </nav>
      </div>
    </header>

    <main id="top">
      <section class="border-base-300 bg-base-100 relative overflow-hidden border-b">
        <div
          class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,color-mix(in_oklch,var(--color-primary)_18%,transparent),transparent_45%)]"
          aria-hidden="true"
        />

        <div
          class="relative mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1.25fr_0.75fr] lg:items-end lg:px-8"
        >
          <div class="max-w-3xl">
            <p
              class="text-primary mb-5 font-mono text-sm font-semibold tracking-[0.16em] uppercase"
            >
              Whole-house climate scheduling
            </p>
            <h1
              class="text-5xl leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-7xl"
            >
              Comfort, coordinated.
            </h1>
            <p class="text-base-content/70 mt-7 max-w-2xl text-lg leading-8 sm:text-xl">
              Map rooms, zones, and heating and cooling systems, then build whole-house schedules
              around your Home Assistant climate entities.
            </p>
            <div class="mt-9 flex flex-wrap gap-3">
              <a class="btn btn-primary" href="#overview">View system overview</a>
              <a v-if="authenticatedUser.isAdmin" class="btn btn-ghost" href="#configuration"
                >Configure installation</a
              >
              <a class="btn btn-ghost" href="#foundation">See what is ready</a>
            </div>
          </div>

          <div class="rounded-box border-base-300 bg-base-200/70 border p-6 shadow-sm">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-base-content/60 text-sm font-medium">Home Assistant</p>
                <p class="mt-1 text-lg font-semibold">Account connected</p>
              </div>
              <span class="status status-success" aria-label="Connected" />
            </div>
            <div class="divider my-4" />
            <p class="text-base-content/65 text-sm leading-6">
              Signed in as {{ authenticatedUser.displayName }}.
              <template v-if="authenticatedUser.isAdmin">
                This account can configure and control Aether.
              </template>
              <template v-else> This account has read-only access. </template>
            </p>
            <p v-if="logoutError" class="alert alert-error mt-4" role="alert">
              {{ logoutError }}
            </p>
          </div>
        </div>
      </section>

      <InstallationOverviewPanel />

      <InstallationConfigurationPanel v-if="authenticatedUser.isAdmin" />

      <section id="foundation" class="border-base-300 bg-base-100 border-y">
        <div class="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <p class="text-primary text-sm font-semibold">Core foundation</p>
            <h2 class="mt-2 text-3xl font-semibold tracking-tight">
              The domain model is ready for a real interface
            </h2>
            <p class="text-base-content/65 mt-4 max-w-xl leading-7">
              The web shell consumes validated data from the engine without duplicating climate
              policy in Vue components.
            </p>
          </div>

          <ul class="grid gap-3" aria-label="Completed foundations">
            <li
              v-for="foundation in foundations"
              :key="foundation"
              class="rounded-box border-base-300 bg-base-200 flex items-center gap-3 border px-4 py-3"
            >
              <span class="status status-success" aria-hidden="true" />
              <span class="font-medium">{{ foundation }}</span>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <footer
      class="text-base-content/55 mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8"
    >
      <p>Aether local-first climate orchestration</p>
      <p>Nuxt · Vue · Vite</p>
    </footer>
  </div>

  <main v-else class="bg-base-200 text-base-content grid min-h-screen place-items-center p-6">
    <section class="card bg-base-100 w-full max-w-md border shadow-sm">
      <div class="card-body">
        <h1 class="card-title">Unexpected authentication state</h1>
        <button class="btn btn-primary mt-2" type="button" @click="authStatusQuery.refetch()">
          Retry
        </button>
      </div>
    </section>
  </main>
</template>
