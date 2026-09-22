<script setup lang="ts">
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  ControllerLocationSchema,
  InstallationSchema,
  PlantIdSchema,
  ZoneIdSchema,
  validateInstallationTopology,
  type ClimateController,
  type DiscoveredClimateEntity,
  type Installation,
} from '@aether/core';
import { computed, ref, watch } from 'vue';

import { normalizeApiError } from '../api/apiError';
import type { InstallationConfiguration } from '../api/installationApi';
import {
  browserTimeZone,
  createClimateControllerDraft,
  createInstallationDraft,
  createLocalId,
  createPlantDraft,
  createRoomDraft,
  createZoneDraft,
} from '../configuration/configurationDraft';
import { climateDiscoveryQueryOptions } from '../queries/climateDiscoveryQuery';
import {
  installationConfigurationQueryOptions,
  installationQueryKeys,
  saveInstallationMutationOptions,
} from '../queries/installationQuery';

const queryClient = useQueryClient();
const configurationQuery = useQuery(installationConfigurationQueryOptions());
const climateQuery = useQuery(climateDiscoveryQueryOptions());
const saveMutation = useMutation(saveInstallationMutationOptions());
const draft = ref<Installation>();
const saved = ref<Installation>();
const revision = ref(0);
const initialized = ref(false);
const savedMessage = ref('');
const selectedClimateEntityId = ref('');
const selectedClimateLocation = ref('');
const selectedClimatePlantId = ref('');

const discoveredEntities = computed(() => climateQuery.data.value?.entities ?? []);
const assignedEntityIds = computed(
  () => new Set(draft.value?.climateControllers.map(({ entityId }) => entityId) ?? []),
);
const unassignedEntities = computed(() =>
  discoveredEntities.value.filter(({ entityId }) => !assignedEntityIds.value.has(entityId)),
);
const selectedClimateEntity = computed(() =>
  unassignedEntities.value.find(({ entityId }) => entityId === selectedClimateEntityId.value),
);
const entityCanBeAssigned = (entity: DiscoveredClimateEntity): boolean =>
  entity.available && (entity.hvacModes.includes('heat') || entity.hvacModes.includes('cool'));
const entityStatus = (entity: DiscoveredClimateEntity): string => {
  if (!entity.available) return 'unavailable';
  if (!entity.hvacModes.includes('heat') && !entity.hvacModes.includes('cool')) {
    return 'no separate heat or cool mode';
  }
  return entity.hvacModes.join(', ');
};
const parseLocation = (value: string) => {
  const [type, id] = value.split(':', 2);
  if (type === 'zone') return ControllerLocationSchema.safeParse({ type, zoneId: id });
  if (type === 'room') return ControllerLocationSchema.safeParse({ type, roomId: id });
  return ControllerLocationSchema.safeParse(undefined);
};
const locationValue = (controller: ClimateController): string =>
  controller.location.type === 'zone'
    ? `zone:${controller.location.zoneId}`
    : `room:${controller.location.roomId}`;
const locationIsMissing = (controller: ClimateController): boolean => {
  const location = controller.location;
  return location.type === 'zone'
    ? !draft.value?.zones.some(({ id }) => id === location.zoneId)
    : !draft.value?.rooms.some(({ id }) => id === location.roomId);
};
const locationExists = (location: ClimateController['location']): boolean =>
  location.type === 'zone'
    ? (draft.value?.zones.some(({ id }) => id === location.zoneId) ?? false)
    : (draft.value?.rooms.some(({ id }) => id === location.roomId) ?? false);
const canAddClimate = computed(() => {
  const entity = selectedClimateEntity.value;
  const location = parseLocation(selectedClimateLocation.value);
  return (
    entity !== undefined &&
    entityCanBeAssigned(entity) &&
    location.success &&
    locationExists(location.data) &&
    (draft.value?.plants.some(({ id }) => id === selectedClimatePlantId.value) ?? false)
  );
});
const addClimateEntity = (): void => {
  const entity = selectedClimateEntity.value;
  const location = parseLocation(selectedClimateLocation.value);
  const plantId = PlantIdSchema.safeParse(selectedClimatePlantId.value);
  if (
    !draft.value ||
    !entity ||
    !entityCanBeAssigned(entity) ||
    !location.success ||
    !locationExists(location.data) ||
    !plantId.success
  ) {
    return;
  }

  draft.value.climateControllers.push(
    createClimateControllerDraft(createLocalId('controller'), entity, location.data, plantId.data),
  );
  selectedClimateEntityId.value = '';
  savedMessage.value = '';
};
const removeClimateEntity = (id: string): void => {
  if (draft.value) {
    draft.value.climateControllers = draft.value.climateControllers.filter(
      (controller) => controller.id !== id,
    );
  }
  savedMessage.value = '';
};
const setControllerLocation = (controller: ClimateController, event: Event): void => {
  const parsed = parseLocation((event.target as HTMLSelectElement).value);
  if (parsed.success) controller.location = parsed.data;
  savedMessage.value = '';
};
const setControllerPlant = (controller: ClimateController, event: Event): void => {
  const parsed = PlantIdSchema.safeParse((event.target as HTMLSelectElement).value);
  if (parsed.success) controller.plantId = parsed.data;
  savedMessage.value = '';
};
const controllerDiscoveryWarning = (controller: ClimateController): string | undefined => {
  if (climateQuery.data.value === undefined) return undefined;
  const discovered = discoveredEntities.value.find(
    ({ entityId }) => entityId === controller.entityId,
  );
  if (!discovered) return 'Entity no longer appears in Home Assistant. Assignment is kept.';
  if (!discovered.available) return 'Entity is unavailable. Assignment is kept.';
  const { heat, cool, off } = controller.capabilities;
  if (
    heat !== discovered.hvacModes.includes('heat') ||
    cool !== discovered.hvacModes.includes('cool') ||
    off !== discovered.hvacModes.includes('off') ||
    (controller.controlProfile.heatingMode !== undefined &&
      !discovered.hvacModes.includes(controller.controlProfile.heatingMode)) ||
    (controller.controlProfile.coolingMode !== undefined &&
      !discovered.hvacModes.includes(controller.controlProfile.coolingMode)) ||
    (controller.controlProfile.offMode !== undefined &&
      !discovered.hvacModes.includes(controller.controlProfile.offMode))
  ) {
    return 'Reported HVAC modes changed. Review this assignment before live control.';
  }
  if (!off) return 'No off mode was reported. Automatic off cannot be enforced for this entity.';
  return undefined;
};

const applyConfiguration = (response: InstallationConfiguration): void => {
  revision.value = response.revision;

  if (response.status === 'configured') {
    saved.value = InstallationSchema.parse(response.installation);
    draft.value = InstallationSchema.parse(response.installation);
  } else {
    saved.value = undefined;
    draft.value = createInstallationDraft(createLocalId('installation'), browserTimeZone());
  }

  initialized.value = true;
  savedMessage.value = '';
  saveMutation.reset();
};

watch(
  configurationQuery.data,
  (response) => {
    if (response !== undefined && !initialized.value) {
      applyConfiguration(response);
    }
  },
  { immediate: true },
);

const changed = computed(
  () =>
    draft.value !== undefined &&
    (saved.value === undefined || JSON.stringify(draft.value) !== JSON.stringify(saved.value)),
);
watch(changed, (isChanged) => {
  if (isChanged) savedMessage.value = '';
});
const parsedDraft = computed(() => InstallationSchema.safeParse(draft.value));
const schemaIssues = computed(() =>
  parsedDraft.value.success
    ? []
    : parsedDraft.value.error.issues.map(({ path, message }) => ({ path, message })),
);
const topology = computed(() =>
  parsedDraft.value.success ? validateInstallationTopology(parsedDraft.value.data) : undefined,
);
const hasDuplicateIdentifiers = computed(
  () =>
    topology.value?.issues.some(({ code }) =>
      [
        'duplicate_entity_id',
        'duplicate_controller_entity_id',
        'duplicate_schedule_block_id',
      ].includes(code),
    ) ?? false,
);
const queryError = computed(() => {
  const error = configurationQuery.error.value;
  if (error === null) return undefined;
  const code = normalizeApiError(error).code;
  return code === 'network_error'
    ? 'The Aether engine could not be reached.'
    : 'Configuration could not be loaded. Try again.';
});
const saveError = computed(() => {
  const error = saveMutation.error.value;
  if (error === null) return undefined;
  const code = normalizeApiError(error).code;

  if (code === 'configuration_revision_conflict') {
    return 'Another administrator saved a newer version. Your edits are still here. Reloading the latest version will discard them.';
  }
  if (code === 'unauthenticated') return 'Your session expired. Sign in again.';
  if (code === 'administrator_required') return 'An administrator account is required to save.';
  if (code === 'invalid_configuration' || code === 'duplicate_configuration_identifier') {
    return 'Check the validation issues below before saving.';
  }
  return 'Configuration could not be saved. Try again.';
});

const formatPath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? 'Installation' : path.map(String).join(' › ');

const addPlant = (): void => {
  draft.value?.plants.push(createPlantDraft(createLocalId('plant')));
  savedMessage.value = '';
};
const addZone = (): void => {
  draft.value?.zones.push(createZoneDraft(createLocalId('zone')));
  savedMessage.value = '';
};
const addRoom = (): void => {
  draft.value?.rooms.push(createRoomDraft(createLocalId('room')));
  savedMessage.value = '';
};
const removePlant = (id: string): void => {
  if (draft.value) draft.value.plants = draft.value.plants.filter((plant) => plant.id !== id);
  savedMessage.value = '';
};
const removeZone = (id: string): void => {
  if (draft.value) draft.value.zones = draft.value.zones.filter((zone) => zone.id !== id);
  savedMessage.value = '';
};
const removeRoom = (id: string): void => {
  if (draft.value) draft.value.rooms = draft.value.rooms.filter((room) => room.id !== id);
  savedMessage.value = '';
};
const setRoomZone = (roomId: string, event: Event): void => {
  const room = draft.value?.rooms.find(({ id }) => id === roomId);
  if (room === undefined) return;

  const value = (event.target as HTMLSelectElement).value;
  if (value === '') {
    delete room.zoneId;
  } else {
    room.zoneId = ZoneIdSchema.parse(value);
  }
  savedMessage.value = '';
};

const discardChanges = (): void => {
  if (saved.value) {
    draft.value = InstallationSchema.parse(saved.value);
  } else {
    draft.value = createInstallationDraft(createLocalId('installation'), browserTimeZone());
  }
  savedMessage.value = '';
  saveMutation.reset();
};

const reloadLatest = async (): Promise<void> => {
  const response = await configurationQuery.refetch();
  if (response.isSuccess && response.data !== undefined) applyConfiguration(response.data);
};

const save = (): void => {
  const parsed = InstallationSchema.safeParse(draft.value);
  if (!parsed.success || hasDuplicateIdentifiers.value || saveMutation.isPending.value) return;

  saveMutation.mutate(
    { revision: revision.value, installation: parsed.data },
    {
      onSuccess: async (response) => {
        if (response.status !== 'configured') return;
        applyConfiguration(response);
        savedMessage.value = 'Configuration saved.';
        queryClient.setQueryData(installationQueryKeys.configuration(), response);
        await queryClient.invalidateQueries({ queryKey: installationQueryKeys.overview() });
      },
    },
  );
};
</script>

<template>
  <section id="configuration" class="mx-auto max-w-7xl scroll-mt-20 px-4 py-16 sm:px-6 lg:px-8">
    <div class="max-w-3xl">
      <p class="text-primary text-sm font-semibold">Configuration</p>
      <h2 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Map your installation</h2>
      <p class="text-base-content/65 mt-4 leading-7">
        Set up plants, zones, rooms, and Home Assistant climate entities. Changes take effect only
        when you save.
      </p>
    </div>

    <p v-if="configurationQuery.isPending.value" class="mt-8" role="status">
      Loading configuration…
    </p>
    <div v-else-if="queryError" class="alert alert-error mt-8" role="alert">
      <span>{{ queryError }}</span>
      <button class="btn btn-sm" type="button" @click="configurationQuery.refetch()">Retry</button>
    </div>

    <form v-else-if="draft" class="mt-8 space-y-8" @submit.prevent="save">
      <div class="alert alert-info text-sm">
        <span>
          {{
            saved
              ? 'Editing a saved installation. Incomplete links can be saved as a draft.'
              : 'This installation has not been saved yet. Review the prefilled settings below.'
          }}
        </span>
      </div>

      <section
        class="card border-base-300 bg-base-100 border shadow-sm"
        aria-labelledby="settings-title"
      >
        <div class="card-body">
          <h3 id="settings-title" class="card-title">Installation settings</h3>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="form-control">
              <span class="label-text mb-2">Name</span>
              <input v-model="draft.name" class="input input-bordered w-full" required />
            </label>
            <label class="form-control">
              <span class="label-text mb-2">IANA timezone</span>
              <input
                v-model="draft.timeZone"
                class="input input-bordered w-full"
                placeholder="Europe/London"
                required
              />
            </label>
            <label class="form-control">
              <span class="label-text mb-2">Display temperature unit</span>
              <select v-model="draft.displayTemperatureUnit" class="select select-bordered w-full">
                <option value="celsius">Celsius</option>
                <option value="fahrenheit">Fahrenheit</option>
              </select>
            </label>
          </div>
          <h4 class="mt-4 font-semibold">Safety limits</h4>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label class="form-control">
              <span class="label-text mb-2">Minimum target (°C)</span>
              <input
                v-model.number="draft.safety.minimumTargetTemperatureCelsius"
                class="input input-bordered w-full"
                type="number"
                step="0.1"
                required
              />
            </label>
            <label class="form-control">
              <span class="label-text mb-2">Maximum target (°C)</span>
              <input
                v-model.number="draft.safety.maximumTargetTemperatureCelsius"
                class="input input-bordered w-full"
                type="number"
                step="0.1"
                required
              />
            </label>
            <label class="form-control">
              <span class="label-text mb-2">Maximum telemetry age (seconds)</span>
              <input
                v-model.number="draft.safety.maximumTelemetryAgeSeconds"
                class="input input-bordered w-full"
                type="number"
                min="1"
                step="1"
                required
              />
            </label>
            <label class="form-control">
              <span class="label-text mb-2">Minimum command interval (seconds)</span>
              <input
                v-model.number="draft.safety.minimumCommandIntervalSeconds"
                class="input input-bordered w-full"
                type="number"
                min="1"
                step="1"
                required
              />
            </label>
            <label class="form-control">
              <span class="label-text mb-2">Acknowledgement timeout (seconds)</span>
              <input
                v-model.number="draft.safety.commandAcknowledgementTimeoutSeconds"
                class="input input-bordered w-full"
                type="number"
                min="1"
                step="1"
                required
              />
            </label>
          </div>
        </div>
      </section>

      <section
        class="card border-base-300 bg-base-100 border shadow-sm"
        aria-labelledby="plants-title"
      >
        <div class="card-body">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="plants-title" class="card-title">Plants</h3>
              <p class="text-base-content/60 text-sm">
                Group climate entities under their physical system.
              </p>
            </div>
            <button class="btn btn-outline btn-sm" type="button" @click="addPlant">
              Add plant
            </button>
          </div>
          <p v-if="draft.plants.length === 0" class="text-base-content/55 mt-4 text-sm">
            No plants yet.
          </p>
          <div
            v-for="plant in draft.plants"
            :key="plant.id"
            class="border-base-300 rounded-box mt-4 grid gap-3 border p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
          >
            <label class="form-control">
              <span class="label-text mb-2">Plant name</span>
              <input v-model="plant.name" class="input input-bordered w-full" required />
            </label>
            <label class="form-control">
              <span class="label-text mb-2">Type</span>
              <select v-model="plant.type" class="select select-bordered w-full">
                <option value="boiler">Boiler</option>
                <option value="heat_pump">Heat pump</option>
                <option value="hvac">HVAC</option>
                <option value="other">Other</option>
              </select>
            </label>
            <button
              class="btn btn-ghost btn-sm text-error"
              type="button"
              :aria-label="`Remove ${plant.name}`"
              @click="removePlant(plant.id)"
            >
              Remove
            </button>
          </div>
        </div>
      </section>

      <section
        class="card border-base-300 bg-base-100 border shadow-sm"
        aria-labelledby="zones-title"
      >
        <div class="card-body">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="zones-title" class="card-title">Zones</h3>
              <p class="text-base-content/60 text-sm">Zones may have no rooms or several rooms.</p>
            </div>
            <button class="btn btn-outline btn-sm" type="button" @click="addZone">Add zone</button>
          </div>
          <p v-if="draft.zones.length === 0" class="text-base-content/55 mt-4 text-sm">
            No zones yet.
          </p>
          <div
            v-for="zone in draft.zones"
            :key="zone.id"
            class="border-base-300 rounded-box mt-4 flex flex-wrap items-end gap-3 border p-4"
          >
            <label class="form-control min-w-56 flex-1">
              <span class="label-text mb-2">Zone name</span>
              <input v-model="zone.name" class="input input-bordered w-full" required />
            </label>
            <button
              class="btn btn-ghost btn-sm text-error"
              type="button"
              :aria-label="`Remove ${zone.name}`"
              @click="removeZone(zone.id)"
            >
              Remove
            </button>
          </div>
        </div>
      </section>

      <section
        class="card border-base-300 bg-base-100 border shadow-sm"
        aria-labelledby="rooms-title"
      >
        <div class="card-body">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="rooms-title" class="card-title">Rooms</h3>
              <p class="text-base-content/60 text-sm">
                A room can belong to one zone or stand alone.
              </p>
            </div>
            <button class="btn btn-outline btn-sm" type="button" @click="addRoom">Add room</button>
          </div>
          <p v-if="draft.rooms.length === 0" class="text-base-content/55 mt-4 text-sm">
            No rooms yet.
          </p>
          <div
            v-for="room in draft.rooms"
            :key="room.id"
            class="border-base-300 rounded-box mt-4 grid gap-3 border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <label class="form-control">
              <span class="label-text mb-2">Room name</span>
              <input v-model="room.name" class="input input-bordered w-full" required />
            </label>
            <label class="form-control">
              <span class="label-text mb-2">Zone</span>
              <select
                class="select select-bordered w-full"
                :value="room.zoneId ?? ''"
                @change="setRoomZone(room.id, $event)"
              >
                <option value="">No zone</option>
                <option
                  v-if="room.zoneId && !draft.zones.some(({ id }) => id === room.zoneId)"
                  :value="room.zoneId"
                >
                  Missing zone ({{ room.zoneId }})
                </option>
                <option v-for="zone in draft.zones" :key="zone.id" :value="zone.id">
                  {{ zone.name }}
                </option>
              </select>
            </label>
            <button
              class="btn btn-ghost btn-sm text-error"
              type="button"
              :aria-label="`Remove ${room.name}`"
              @click="removeRoom(room.id)"
            >
              Remove
            </button>
          </div>
        </div>
      </section>

      <section
        class="card border-base-300 bg-base-100 border shadow-sm"
        aria-labelledby="entities-title"
      >
        <div class="card-body">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="entities-title" class="card-title">Climate entities</h3>
              <p class="text-base-content/65 text-sm">
                Assign each Home Assistant climate entity to one plant and one room or zone.
              </p>
            </div>
            <button class="btn btn-outline btn-sm" type="button" @click="climateQuery.refetch()">
              Refresh from Home Assistant
            </button>
          </div>
          <p
            v-if="climateQuery.isPending.value"
            class="text-base-content/60 mt-4 text-sm"
            role="status"
          >
            Discovering climate entities…
          </p>
          <div
            v-else-if="climateQuery.isError.value"
            class="alert alert-warning mt-4 text-sm"
            role="alert"
          >
            <span>
              {{
                normalizeApiError(climateQuery.error.value).code === 'not_connected'
                  ? 'Connect the Aether engine to Home Assistant to discover climate entities.'
                  : 'Climate entities could not be read from Home Assistant. Saved assignments are kept.'
              }}
            </span>
          </div>
          <p v-else-if="discoveredEntities.length === 0" class="text-base-content/60 mt-4 text-sm">
            Home Assistant reported no climate entities.
          </p>

          <div v-if="draft.climateControllers.length > 0" class="mt-5 space-y-4">
            <div
              v-for="controller in draft.climateControllers"
              :key="controller.id"
              class="border-base-300 rounded-box grid gap-3 border p-4 sm:grid-cols-2"
            >
              <label class="form-control">
                <span class="label-text mb-2">Name</span>
                <input v-model="controller.name" class="input input-bordered w-full" required />
              </label>
              <div class="min-w-0 self-end pb-2 text-sm">
                <span class="font-mono break-all">{{ controller.entityId }}</span>
              </div>
              <label class="form-control">
                <span class="label-text mb-2">Plant</span>
                <select
                  class="select select-bordered w-full"
                  :value="controller.plantId"
                  @change="setControllerPlant(controller, $event)"
                >
                  <option
                    v-if="!draft.plants.some(({ id }) => id === controller.plantId)"
                    :value="controller.plantId"
                  >
                    Missing plant ({{ controller.plantId }})
                  </option>
                  <option v-for="plant in draft.plants" :key="plant.id" :value="plant.id">
                    {{ plant.name }}
                  </option>
                </select>
              </label>
              <label class="form-control">
                <span class="label-text mb-2">Zone or room</span>
                <select
                  class="select select-bordered w-full"
                  :value="locationValue(controller)"
                  @change="setControllerLocation(controller, $event)"
                >
                  <option v-if="locationIsMissing(controller)" :value="locationValue(controller)">
                    Missing location ({{ locationValue(controller) }})
                  </option>
                  <optgroup v-if="draft.zones.length > 0" label="Zones">
                    <option v-for="zone in draft.zones" :key="zone.id" :value="`zone:${zone.id}`">
                      {{ zone.name }}
                    </option>
                  </optgroup>
                  <optgroup v-if="draft.rooms.length > 0" label="Rooms">
                    <option v-for="room in draft.rooms" :key="room.id" :value="`room:${room.id}`">
                      {{ room.name }}
                    </option>
                  </optgroup>
                </select>
              </label>
              <p class="text-base-content/60 text-sm sm:col-span-2">
                Saved modes:
                {{
                  [
                    controller.controlProfile.heatingMode,
                    controller.controlProfile.coolingMode,
                    controller.controlProfile.offMode,
                  ]
                    .filter(Boolean)
                    .join(', ') || 'none'
                }}
              </p>
              <p
                v-if="controllerDiscoveryWarning(controller)"
                class="text-warning text-sm sm:col-span-2"
                role="status"
              >
                {{ controllerDiscoveryWarning(controller) }}
              </p>
              <button
                class="btn btn-ghost btn-sm text-error justify-self-start"
                type="button"
                :aria-label="`Remove ${controller.name}`"
                @click="removeClimateEntity(controller.id)"
              >
                Remove entity
              </button>
            </div>
          </div>
          <p v-else class="text-base-content/60 mt-4 text-sm">No climate entities assigned yet.</p>

          <div class="border-base-300 mt-6 border-t pt-5">
            <h4 class="font-semibold">Add a discovered entity</h4>
            <p class="text-base-content/65 mt-1 text-sm">
              Entities without a separate heat or cool mode, or currently unavailable, cannot be
              newly assigned.
            </p>
            <div class="mt-4 grid gap-3 sm:grid-cols-3">
              <label class="form-control">
                <span class="label-text mb-2">Climate entity</span>
                <select v-model="selectedClimateEntityId" class="select select-bordered w-full">
                  <option value="">Select entity</option>
                  <option
                    v-for="entity in unassignedEntities"
                    :key="entity.entityId"
                    :value="entity.entityId"
                    :disabled="!entityCanBeAssigned(entity)"
                  >
                    {{ entity.name }} ({{ entity.entityId }}) — {{ entityStatus(entity) }}
                  </option>
                </select>
              </label>
              <label class="form-control">
                <span class="label-text mb-2">Plant</span>
                <select v-model="selectedClimatePlantId" class="select select-bordered w-full">
                  <option value="">Select plant</option>
                  <option v-for="plant in draft.plants" :key="plant.id" :value="plant.id">
                    {{ plant.name }}
                  </option>
                </select>
              </label>
              <label class="form-control">
                <span class="label-text mb-2">Zone or room</span>
                <select v-model="selectedClimateLocation" class="select select-bordered w-full">
                  <option value="">Select location</option>
                  <optgroup v-if="draft.zones.length > 0" label="Zones">
                    <option v-for="zone in draft.zones" :key="zone.id" :value="`zone:${zone.id}`">
                      {{ zone.name }}
                    </option>
                  </optgroup>
                  <optgroup v-if="draft.rooms.length > 0" label="Rooms">
                    <option v-for="room in draft.rooms" :key="room.id" :value="`room:${room.id}`">
                      {{ room.name }}
                    </option>
                  </optgroup>
                </select>
              </label>
            </div>
            <p v-if="selectedClimateEntity" class="text-base-content/65 mt-3 text-sm">
              Reported modes: {{ selectedClimateEntity.hvacModes.join(', ') || 'none' }}.
              <template v-if="selectedClimateEntity.fanModes.length > 0">
                Fan: {{ selectedClimateEntity.fanModes.join(', ') }}.</template
              >
              <template v-if="selectedClimateEntity.presetModes.length > 0">
                Presets: {{ selectedClimateEntity.presetModes.join(', ') }}.</template
              >
              <template v-if="selectedClimateEntity.swingModes.length > 0">
                Swing: {{ selectedClimateEntity.swingModes.join(', ') }}.</template
              >
            </p>
            <button
              class="btn btn-outline btn-sm mt-4"
              type="button"
              :disabled="!canAddClimate"
              @click="addClimateEntity"
            >
              Add climate entity
            </button>
          </div>
        </div>
      </section>

      <p class="text-base-content/60 text-sm">
        {{ draft.schedules.length }} schedules are saved. Schedule editing is the next setup step.
      </p>

      <section
        class="card border-base-300 bg-base-100 border shadow-sm"
        aria-labelledby="validation-title"
      >
        <div class="card-body">
          <h3 id="validation-title" class="card-title">Validation</h3>
          <p
            v-if="schemaIssues.length === 0 && (topology?.issues.length ?? 0) === 0"
            class="text-success text-sm"
          >
            No configuration issues found.
          </p>
          <ul v-if="schemaIssues.length > 0" class="space-y-2 text-sm" aria-label="Field errors">
            <li v-for="(issue, index) in schemaIssues" :key="index" class="text-error">
              {{ formatPath(issue.path) }}: {{ issue.message }}
            </li>
          </ul>
          <ul
            v-if="topology && topology.issues.length > 0"
            class="space-y-2 text-sm"
            aria-label="Topology issues"
          >
            <li
              v-for="(issue, index) in topology.issues"
              :key="index"
              :class="issue.severity === 'error' ? 'text-error' : 'text-warning'"
            >
              {{ formatPath(issue.path) }}: {{ issue.message }}
            </li>
          </ul>
          <p v-if="hasDuplicateIdentifiers" class="text-error text-sm">
            Resolve duplicate identifiers before saving.
          </p>
        </div>
      </section>

      <div
        class="border-base-300 bg-base-100 rounded-box sticky bottom-0 flex flex-wrap items-center gap-3 border p-4 shadow-lg"
      >
        <button
          class="btn btn-primary"
          type="submit"
          :disabled="
            !changed ||
            schemaIssues.length > 0 ||
            hasDuplicateIdentifiers ||
            saveMutation.isPending.value
          "
        >
          {{ saveMutation.isPending.value ? 'Saving…' : 'Save configuration' }}
        </button>
        <button
          class="btn btn-ghost"
          type="button"
          :disabled="!changed || saveMutation.isPending.value"
          @click="discardChanges"
        >
          Discard changes
        </button>
        <span v-if="changed" class="badge badge-warning">Unsaved changes</span>
        <span v-if="savedMessage" class="text-success text-sm" role="status">{{
          savedMessage
        }}</span>
        <div v-if="saveError" class="alert alert-error w-full text-sm" role="alert">
          <span>{{ saveError }}</span>
          <button
            v-if="
              normalizeApiError(saveMutation.error.value).code === 'configuration_revision_conflict'
            "
            class="btn btn-sm"
            type="button"
            @click="reloadLatest"
          >
            Discard edits and reload
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
