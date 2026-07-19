<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import DockedAction from '@/components/DockedAction.vue';
import LastCircuitData from '@/components/LastCircuitData.vue';
import NavUpRow from '@/components/NavUpRow.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import SetProgress from '@/components/SetProgress.vue';
import TotalTime from '@/components/TotalTime.vue';
import TrashSnackbar from '@/components/TrashSnackbar.vue';
import { useActiveSession } from '@/composables/useActiveSession';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { ensureNotificationPermission } from '@/composables/useNotificationPermission';
import { REST_PRIMER_COPY } from '@/composables/useRestAlarm';
import { consumeRollbackNotice } from '@/composables/useRollbackNotice';

// The lift (workout-set) screen, three zones:
// CONTEXT (white title + last-session card, quiet), STATE (flex-grow
// centered set boxes + giant LIFT!), ACTION (docked total time + the
// amber rest CTA). Mid-set the accent-colored LIFT! owns the screen; the
// title never wears the accent. The CTA reads FINISH on the session's
// final unlogged set and both labels route to the rest screen - final
// mode derives there from session facts. A rest rollback lands back
// here and arms a one-shot SET ROLLED BACK snackbar (consumed once, so
// a later remount stays quiet).

const props = defineProps<{
  exerciseId: string;
}>();

const router = useRouter();
const db = useDb();

const { workoutSet, hasLoaded, loadFailed, refresh, restFailed, startRest } = useActiveSession(
  db,
  () => props.exerciseId,
);

const showRolledBack = ref(consumeRollbackNotice());

async function handleRest(): Promise<void> {
  // Starting a real rest (not the final-set FINISH) is the first
  // relevant moment for rest alerts: prime the notification permission
  // in our own voice before the OS surface. Fire-and-forget - it self-
  // suppresses after the first time and never blocks the rest itself.
  if (workoutSet.value && !workoutSet.value.isFinalSet) {
    void ensureNotificationPermission(REST_PRIMER_COPY);
  }
  const entry = await startRest();
  if (entry) {
    void router.push({
      name: 'rest',
      params: { exerciseId: entry.exerciseId, setIndex: entry.setIndex },
    });
  }
}
</script>

<template>
  <AppShell>
    <div class="workout-set">
      <ScreenHeader :title="workoutSet?.exerciseName ?? 'Workout Set'" />
      <ScreenNote v-if="!db">{{ DEVICE_ONLY_NOTE }}</ScreenNote>
      <ScreenNote v-else-if="loadFailed" action="Retry" @action="() => void refresh()">
        Couldn't load the workout set
      </ScreenNote>
      <template v-else-if="workoutSet">
        <LastCircuitData
          v-if="workoutSet.lastSession"
          :reps="workoutSet.lastSession.reps"
          :weight="workoutSet.lastSession.weight"
          :weight-unit="workoutSet.lastSession.weightUnit"
        />
        <div v-if="workoutSet.currentSet !== null" class="workout-set__state">
          <SetProgress :sets="workoutSet.prescribedSets" :logged-sets="workoutSet.loggedSets" />
          <p class="workout-set__word">Lift!</p>
        </div>
        <ScreenNote v-else>All sets logged // pick another workout</ScreenNote>
      </template>
      <ScreenNote v-else-if="hasLoaded">
        Not on this workout // pick an exercise from the grid
      </ScreenNote>
    </div>
    <template #action>
      <!-- loadFailed gates the footer below too: the body's v-else
           chain already hides stale facts behind the Retry note, but
           this footer is its own tree and would keep rendering the
           previous read's clock and CTA label over a button that
           writes against the current route. NavUpRow and the snackbar
           sit outside that gate: the up affordance must survive a
           failed load, and the rollback notice has nothing to do with
           this load's outcome. -->
      <NavUpRow />
      <TrashSnackbar
        v-if="showRolledBack"
        class="workout-set__snack"
        message="Set rolled back"
        :undoable="false"
      />
      <div
        v-if="!loadFailed && workoutSet && workoutSet.currentSet !== null"
        class="workout-set__footer"
      >
        <ScreenNote v-if="restFailed">Couldn't start the rest // try again</ScreenNote>
        <TotalTime :started-at="workoutSet.session?.startedAt ?? null" />
        <DockedAction
          variant="amber"
          :label="workoutSet.isFinalSet ? 'Finish' : 'Start Rest'"
          @press="handleRest"
        />
      </div>
    </template>
  </AppShell>
</template>

<style scoped>
.workout-set {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: var(--space-6) var(--space-4) 0;
}

/* Zone 2 absorbs all flex: the boxes and the word are one grouped,
   centered readout - no dead space, no "set x of y" caption. */
.workout-set__state {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-12);
  align-items: center;
  justify-content: center;
}

/* Giant live word: accent FILL only, no text glow, no halo. */
.workout-set__word {
  margin: 0;
  color: var(--accent);
  font-family: var(--font-display);
  font-size: var(--type-display-hero);
  line-height: 0.86;
  letter-spacing: var(--tracking-4);
  text-transform: uppercase;
}

/* Byte-identical with RestView's .rest__footer - these move together. */
.workout-set__footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-2);
}

/* Matches the footer's side padding so the snack lines up with the
   docked action below it. */
.workout-set__snack {
  margin: 0 var(--space-4);
}
</style>
