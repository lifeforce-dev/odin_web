<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import DockedAction from '@/components/DockedAction.vue';
import LogSetControl from '@/components/LogSetControl.vue';
import NavUpRow from '@/components/NavUpRow.vue';
import RestDigits from '@/components/RestDigits.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import TotalTime from '@/components/TotalTime.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { useRestAlarm } from '@/composables/useRestAlarm';
import { useRestSession } from '@/composables/useRestSession';
import { useRestTimer } from '@/composables/useRestTimer';
import { armRollbackNotice } from '@/composables/useRollbackNotice';
import { restEndsAtIso } from '@/domain/rest-timer';
import { resolveUpTo, useUpOverride } from '@/router/up';

// The rest screen, timer-as-fact + auto-log: the just-finished set is
// logged on arrival (it already happened, so a forgettable save button
// would lose data), edited in place above a countdown hero that
// derives from the persisted endsAt every render. Final mode (the
// session's last set) drops the countdown outright and docks FINISH
// instead of NEXT SET; same screen, same auto-log. Back on this screen
// IS the rollback while the rest window is open: the up affordance (OS
// or on-screen) undoes the arrival instead of leaving quietly. Past
// the window (sitting at 0:00, or a cold-open restore hours later)
// back is a plain leave - the set stays logged, and the row's label
// stops promising destruction.

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
  rollbackState,
  commitEdit,
  flushPendingWrites,
  finish,
  rollBack,
} = useRestSession(
  db,
  () => props.exerciseId,
  () => props.setIndex,
);

useUpOverride(async () => {
  const outcome = await rollBack();
  if (outcome === 'failed') {
    // Destructive intent unfulfilled: stay put, the note renders below.
    return;
  }
  if (outcome === 'rolled-back') {
    armRollbackNotice();
  }
  // The structural map owns the destination (rest's meta.upTo already
  // carries the exerciseId); the literal mirrors that meta entry and
  // covers only a current route that no longer resolves mid-transition.
  void router.replace(
    resolveUpTo(router.currentRoute.value) ?? {
      name: 'workout-set',
      params: { exerciseId: props.exerciseId },
    },
  );
});

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

// The OS becomes the alarm clock while the app is backgrounded mid-rest;
// endsAt is the same countdown fact the digits derive from (null in
// final mode, so FINISH screens schedule nothing).
useRestAlarm(() => endsAt.value);

// The rollback window covers BOTH modes (final mode has no countdown,
// but its arrival still ages by the same loggedAt + restSeconds rule
// useRestSession's suppression reads). While it is open the up row
// says Roll Back Set; expired, back is a plain leave and the label
// falls to the structural destination instead of lying.
const rollbackWindowEndsAt = computed(() => {
  const current = arrival.value;
  if (!current) {
    return null;
  }
  return restEndsAtIso(current.loggedAt, current.restSeconds);
});
const { remaining: rollbackWindowRemaining } = useRestTimer(() => rollbackWindowEndsAt.value);
const upLabel = computed(() =>
  arrival.value && rollbackWindowRemaining.value === 0 ? 'Workout' : undefined,
);

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
  // is already on the screen): a failed edit must block both NEXT SET
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
        <ScreenHeader title="Rest" eyebrow="Set" :eyebrow-value="props.setIndex" />
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
          <ScreenNote v-if="rollbackState === 'failed'">Couldn't roll back // try again</ScreenNote>
          <div v-if="arrival.mode === 'countdown'" class="rest__hero">
            <p class="rest__eyebrow">Recover // Rest</p>
            <RestDigits :remaining="remaining" />
          </div>
        </template>
        <ScreenNote v-else-if="hasLoaded">Nothing resting here // start a set first</ScreenNote>
      </div>
    </div>
    <template #action>
      <!-- loadFailed and a null arrival both gate the footer below, but
           the up row must survive both (a failed load or a stale route
           must never strand an iOS user): this slot is its own
           template tree (the AppShell #action slot), so NavUpRow sits
           outside that gate. -->
      <NavUpRow :label="upLabel" />
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
