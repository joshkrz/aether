<script setup lang="ts">
const systemAreas = [
  {
    name: 'Rooms',
    description: 'Comfort, sensing, and demand',
  },
  {
    name: 'Controllers',
    description: 'Home Assistant climate entities',
  },
  {
    name: 'Plants',
    description: 'Shared physical equipment',
  },
  {
    name: 'Schedules',
    description: 'Daily comfort periods',
  },
] as const;

const foundations = [
  'Unified room-to-controller topology',
  'Plant constraints and energy sources',
  'Base schedules with temporary overrides',
  'Strict installation safety envelope',
] as const;
</script>

<template>
  <div class="bg-base-200 text-base-content min-h-screen">
    <header class="border-base-300 bg-base-100/90 border-b backdrop-blur">
      <div class="navbar mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="navbar-start gap-3">
          <a href="#top" class="text-xl font-semibold tracking-tight">Aether</a>
          <span class="badge badge-success badge-sm">Foundation ready</span>
        </div>

        <nav class="navbar-end hidden gap-1 sm:flex" aria-label="Primary navigation">
          <a class="btn btn-ghost btn-sm" href="#overview">Overview</a>
          <a class="btn btn-ghost btn-sm" href="#foundation">Foundation</a>
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
              Hybrid climate orchestrator
            </p>
            <h1
              class="text-5xl leading-[0.98] font-semibold tracking-[-0.045em] text-balance sm:text-7xl"
            >
              Comfort, coordinated.
            </h1>
            <p class="text-base-content/70 mt-7 max-w-2xl text-lg leading-8 sm:text-xl">
              Aether brings rooms, climate controllers, shared equipment, energy, and schedules into
              one explainable Home Assistant control system.
            </p>
            <div class="mt-9 flex flex-wrap gap-3">
              <a class="btn btn-primary" href="#overview">View system overview</a>
              <a class="btn btn-ghost" href="#foundation">See what is ready</a>
            </div>
          </div>

          <div class="rounded-box border-base-300 bg-base-200/70 border p-6 shadow-sm">
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-base-content/60 text-sm font-medium">Connection</p>
                <p class="mt-1 text-lg font-semibold">Awaiting engine</p>
              </div>
              <span class="status status-warning" aria-label="Not connected" />
            </div>
            <div class="divider my-4" />
            <p class="text-base-content/65 text-sm leading-6">
              This page is the web shell. Live installation state will appear here once the engine
              API is connected.
            </p>
          </div>
        </div>
      </section>

      <section id="overview" class="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8">
        <div class="max-w-2xl">
          <p class="text-primary text-sm font-semibold">System overview</p>
          <h2 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            One installation, clearly mapped
          </h2>
          <p class="text-base-content/65 mt-4 leading-7">
            Counts stay deliberately blank until they come from the engine, so the interface never
            presents sample data as real equipment.
          </p>
        </div>

        <div class="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article
            v-for="area in systemAreas"
            :key="area.name"
            class="card border-base-300 bg-base-100 border shadow-sm"
          >
            <div class="card-body gap-5">
              <div class="flex items-start justify-between gap-4">
                <h3 class="card-title text-lg">{{ area.name }}</h3>
                <span class="text-base-content/35 font-mono text-2xl" aria-label="No live data"
                  >—</span
                >
              </div>
              <p class="text-base-content/60 text-sm leading-6">{{ area.description }}</p>
            </div>
          </article>
        </div>
      </section>

      <section id="foundation" class="border-base-300 bg-base-100 border-y">
        <div class="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <p class="text-primary text-sm font-semibold">Core foundation</p>
            <h2 class="mt-2 text-3xl font-semibold tracking-tight">
              The domain model is ready for a real interface
            </h2>
            <p class="text-base-content/65 mt-4 max-w-xl leading-7">
              The web shell will consume validated data from the engine without duplicating climate
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
</template>
