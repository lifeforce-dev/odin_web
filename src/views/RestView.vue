<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import DockedAction from '@/components/DockedAction.vue';
import LogSetControl from '@/components/LogSetControl.vue';
import RestDigits from '@/components/RestDigits.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import TotalTime from '@/components/TotalTime.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { useRestSession } from '@/composables/useRestSession';
import { useRestTimer } from '@/composables/useRestTimer';
import { restEndsAtIso } from '@/domain/rest-timer';

// The rest screen, timer-as-fact + auto-log: the just-finished set is
// logged on arrival (it already happened, so a forgettable save button
// would lose data), edited in place above a countdown hero that
// derives from the persisted endsAt every render. Final mode (the
// session's last set) drops the countdown outright and docks FINISH
// instead of NEXT SET; same screen, same auto-log.

const PULSE_AT_SECONDS = 10;

const props = defineProps<{
  exerciseId: string;
  setIndex: number;
}>();

const router = useRouter();
const db = useDb();

const {
  arrival,
  hasLoaded,
  loadFailed,
  refresh,
  writeFailed,
  finishFailed,
  commitEdit,
  flushPendingWrites,
  finish,
} = useRestSession(
  db,
  () => props.exerciseId,
  () => props.setIndex,
);

const logSetControlRef = ref<InstanceType<typeof LogSetControl> | null>(null);

// Null in final mode (no countdown at all) or before the first read
// lands; useRestTimer parks remaining at 0 either way.
const endsAt = computed(() => {
  const current = arrival.value;
  if (!current || current.mode !== 'countdown') {
    return null;
  }
  return restEndsAtIso(current.loggedAt, current.restSeconds);
});
const { remaining } = useRestTimer(() => endsAt.value);

const timeUp = computed(() => arrival.value?.mode === 'countdown' && remaining.value === 0);
const pulsing = computed(
  () =>
    arrival.value?.mode === 'countdown' &&
    remaining.value > 0 &&
    remaining.value <= PULSE_AT_SECONDS,
);
const actionVariant = computed<'ghost' | 'filled'>(() =>
  arrival.value?.mode === 'final' || timeUp.value ? 'filled' : 'ghost',
);
const actionLabel = computed(() => (arrival.value?.mode === 'final' ? 'Finish' : 'Next Set'));

function handleCommit(payload: { reps: number; weight: number }): void {
  void commitEdit(payload.reps, payload.weight);
}

async function handleAction(): Promise<void> {
  const current = arrival.value;
  if (!current) {
    return;
  }
  // Flush BEFORE the mode branch and stop on a dirty outcome (the note
  // is already on the glass): a failed edit must block both NEXT SET
  // and FINISH, never let FINISH stamp endedAt on top of it.
  logSetControlRef.value?.flush();
  const clean = await flushPendingWrites();
  if (!clean) {
    return;
  }
  if (current.mode === 'final') {
    const finished = await finish();
    if (finished) {
      void router.push({ name: 'home' });
    }
    return;
  }
  if (current.remainingForExercise > 0) {
    void router.push({ name: 'workout-set', params: { exerciseId: current.exerciseId } });
  } else {
    void router.push({ name: 'workout-start' });
  }
}
</script>

<template>
  <AppShell>
    <div class="rest">
      <div class="rest__content">
        <ScreenHeader
          title="Rest"
          :back-to="{ name: 'workout-set', params: { exerciseId: props.exerciseId } }"
          back-label="Skip"
          eyebrow="Set"
          :eyebrow-value="props.setIndex"
        />
        <ScreenNote v-if="!db">{{ DEVICE_ONLY_NOTE }}</ScreenNote>
        <ScreenNote v-else-if="loadFailed" action="Retry" @action="() => void refresh()">
          Couldn't load the rest screen
        </ScreenNote>
        <template v-else-if="arrival">
          <LogSetControl
            ref="logSetControlRef"
            :reps="arrival.reps"
            :weight="arrival.weight"
            :weight-unit="arrival.weightUnit"
            @commit="handleCommit"
          />
          <ScreenNote v-if="writeFailed">Couldn't save the edit // try again</ScreenNote>
          <div v-if="arrival.mode === 'countdown'" class="rest__hero">
            <p class="rest__eyebrow">Recover // Rest</p>
            <RestDigits :remaining="remaining" />
          </div>
        </template>
        <ScreenNote v-else-if="hasLoaded">Nothing resting here // start a set first</ScreenNote>
      </div>
    </div>
    <template #action>
      <!-- loadFailed and a null arrival both gate here too: this footer
           is its own template tree (the AppShell #action slot), not
           covered by the body's v-else chain above. -->
      <div v-if="!loadFailed && arrival" class="rest__footer">
        <ScreenNote v-if="finishFailed">Couldn't finish // try again</ScreenNote>
        <TotalTime :started-at="arrival.sessionStartedAt" />
        <DockedAction
          :variant="actionVariant"
          :pulsing="pulsing"
          :label="actionLabel"
          @press="() => void handleAction()"
        />
      </div>
    </template>
  </AppShell>
</template>

<style scoped>
.rest {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: var(--space-6) var(--space-4) 0;
}

/* The lower third stays visually empty on purpose: a ~120px mascot
   slot is reserved there, design pending. */
.rest__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.rest__hero {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: var(--space-8);
  text-align: center;
}

.rest__eyebrow {
  margin: 0 0 var(--space-3);
  color: var(--text-dim);
  font-size: var(--type-label);
  letter-spacing: var(--tracking-4);
  text-transform: uppercase;
}

/* Byte-identical with WorkoutSetView's .workout-set__footer - these
   move together. */
.rest__footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-2);
}
</style>
