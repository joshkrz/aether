<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';

import { normalizeApiError } from '../api/apiError';
import { installationOverviewQueryOptions } from '../queries/installationQuery';

const systemAreas = [
  {
    key: 'rooms',
    name: 'Rooms',
    description: 'Comfort, sensing, and demand',
  },
  {
    key: 'climateControllers',
    name: 'Controllers',
    description: 'Home Assistant climate entities',
  },
  {
    key: 'plants',
    name: 'Plants',
    description: 'Shared physical equipment',
  },
  {
    key: 'energySources',
    name: 'Energy sources',
    description: 'Electricity, gas, and other inputs',
  },
  {
    key: 'schedules',
    name: 'Schedules',
    description: 'Daily comfort periods',
  },
] as const;

const installationOverviewQuery = useQuery(installationOverviewQueryOptions());
const installationOverviewError = computed(() => {
  const error = installationOverviewQuery.error.value;

  if (error === null) {
    return undefined;
  }

  const normalized = normalizeApiError(error);
  return normalized.code === 'network_error'
    ? 'The Aether engine could not be reached.'
    : 'Installation data could not be loaded. Try again.';
});
</script>

<template>
  <section id="overview" class="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8">
    <div class="max-w-2xl">
      <p class="text-primary text-sm font-semibold">System overview</p>
      <h2 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        <template v-if="installationOverviewQuery.data.value?.status === 'configured'">
          {{ installationOverviewQuery.data.value.installation.name }}
        </template>
        <template v-else>One installation, clearly mapped</template>
      </h2>

      <p v-if="installationOverviewQuery.isPending.value" class="text-base-content/65 mt-4">
        Loading installation data…
      </p>
      <div v-else-if="installationOverviewError" class="alert alert-error mt-4" role="alert">
        <span>{{ installationOverviewError }}</span>
        <button class="btn btn-sm" type="button" @click="installationOverviewQuery.refetch()">
          Retry
        </button>
      </div>
      <p
        v-else-if="installationOverviewQuery.data.value?.status === 'not_configured'"
        class="text-base-content/65 mt-4 leading-7"
      >
        The installation has not been configured yet.
      </p>
      <div
        v-else-if="installationOverviewQuery.data.value?.status === 'configured'"
        class="mt-4 flex flex-wrap items-center gap-3"
      >
        <span
          class="badge"
          :class="
            installationOverviewQuery.data.value.topology.valid ? 'badge-success' : 'badge-error'
          "
        >
          {{
            installationOverviewQuery.data.value.topology.valid
              ? 'Topology valid'
              : 'Topology invalid'
          }}
        </span>
        <span class="text-base-content/65 text-sm">
          {{ installationOverviewQuery.data.value.topology.errorCount }} errors ·
          {{ installationOverviewQuery.data.value.topology.warningCount }} warnings
        </span>
      </div>
    </div>

    <div class="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <article
        v-for="area in systemAreas"
        :key="area.key"
        class="card border-base-300 bg-base-100 border shadow-sm"
      >
        <div class="card-body gap-5">
          <div class="flex items-start justify-between gap-4">
            <h3 class="card-title text-lg">{{ area.name }}</h3>
            <span class="text-base-content/35 font-mono text-2xl">
              {{
                installationOverviewQuery.data.value?.status === 'configured'
                  ? installationOverviewQuery.data.value.counts[area.key]
                  : '—'
              }}
            </span>
          </div>
          <p class="text-base-content/60 text-sm leading-6">{{ area.description }}</p>
        </div>
      </article>
    </div>
  </section>
</template>
