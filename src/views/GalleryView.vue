<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';

import AppShell from '@/components/AppShell.vue';
import CircuitCard from '@/components/CircuitCard.vue';
import CircuitRow from '@/components/CircuitRow.vue';
import ConfirmStrip from '@/components/ConfirmStrip.vue';
import DockedAction from '@/components/DockedAction.vue';
import ForgeSlot from '@/components/ForgeSlot.vue';
import GripHandle from '@/components/GripHandle.vue';
import InlineNameEntry from '@/components/InlineNameEntry.vue';
import LastCircuitData from '@/components/LastCircuitData.vue';
import LogSetControl from '@/components/LogSetControl.vue';
import MenuButton from '@/components/MenuButton.vue';
import NavUpRow from '@/components/NavUpRow.vue';
import OdinMark from '@/components/OdinMark.vue';
import PoolCreateRow from '@/components/PoolCreateRow.vue';
import PoolElsewhereRow from '@/components/PoolElsewhereRow.vue';
import PoolGroupHeader from '@/components/PoolGroupHeader.vue';
import RestDigits from '@/components/RestDigits.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import SetProgress from '@/components/SetProgress.vue';
import StepperField from '@/components/StepperField.vue';
import TransientCardGhost from '@/components/TransientCardGhost.vue';
import TotalTime from '@/components/TotalTime.vue';
import TrashSnackbar from '@/components/TrashSnackbar.vue';
import WorkoutCard from '@/components/WorkoutCard.vue';
import { DEVICE_ONLY_NOTE } from '@/composables/useDb';
import { useOneShot } from '@/composables/useOneShot';
import { useTheme } from '@/composables/useTheme';
import { clampPrescriptionValue } from '@/composables/useWorkbench';
import type { PrescriptionField } from '@/composables/useWorkbench';
import { MOTION_CONSUME_MS, MOTION_MORPH_MS, MOTION_SETTLE_MS } from '@/styles/motion';
import { CONTRACT_COLOR_TOKENS, type ThemeName } from '@/styles/contract';
import {
  BORDER_TOKENS,
  DISPLAY_TYPE_TOKENS,
  MONO_TYPE_TOKENS,
  SAFE_AREA_TOKENS,
  SPACING_TOKENS,
  TRACKING_TOKENS,
} from '@/styles/geometry';

// The living component gallery + token board: every token rendered
// live so a theme can be judged on one screen, on device. Component
// states get added here as real components land.

const { theme, themes, setTheme } = useTheme();

const selectedTheme = computed({
  get: () => theme.value,
  set: (name: ThemeName) => {
    void setTheme(name);
  },
});

// Every token board derives from a TS source: colors from the
// contract, geometry from styles/geometry.ts (whose parity test diffs
// it against structure.css), so a minted token appears here
// automatically or fails the suite. Fonts/textures/glows get bespoke
// samples below (a glow is not a swatch); those are exempted by name
// in geometry.ts.
const colorTokens = CONTRACT_COLOR_TOKENS;
const monoTypeTokens = MONO_TYPE_TOKENS;
const displayTypeTokens = DISPLAY_TYPE_TOKENS;
const trackingTokens = TRACKING_TOKENS;
const spacingTokens = SPACING_TOKENS;
const borderTokens = BORDER_TOKENS;

// Live workout-card sample: the real shipped component with working
// steppers, sharing the composable's clamp so the board exercises
// exactly what ships - never a hand-copy. One control for both zones;
// the pool placement adds the + chip.
const demoCard = reactive({
  name: 'Cable Row',
  sets: 3,
  restSeconds: 60,
  open: true,
  flash: false,
});

function adjustDemoCard(field: PrescriptionField, delta: number): void {
  demoCard[field] = clampPrescriptionValue(field, demoCard[field] + delta);
}

async function replayFlash(): Promise<void> {
  demoCard.flash = false;
  await nextTick();
  demoCard.flash = true;
}

// Live pool samples: steal-strip toggle and inline create; emits echo
// below the rows so every path is visibly exercised.
const demoStealOpen = ref(false);
const demoPoolEvent = ref<string | null>(null);
const demoCreatedName = ref<string | null>(null);

// A live start for the total-time board row, minted at setup so the
// readout visibly runs.
const galleryWorkoutStartedAt = new Date(Date.now() - 65_000).toISOString();

// Shared row parts, boarded standalone (they also render live inside
// the card and create-row samples above them).
const demoGripEvent = ref<string | null>(null);
const demoEntryOpen = ref(false);
const demoEntryResult = ref<string | null>(null);
const demoDisplayEntryOpen = ref(false);
const demoDisplayEntryResult = ref<string | null>(null);
const demoStepperRest = ref(60);

// Live circuit-row sample: the shipped row wired to a real ConfirmStrip
// (the delete flow's exact wiring), plus the tag/dimmed states boarded
// standalone.
const demoCircuitStripOpen = ref(false);
const demoConfirmEvent = ref<string | null>(null);
const demoHeaderEditEvent = ref<string | null>(null);

// Live log-set sample: the real shipped control, its own commit echoed
// below so the settle/blur write-behind path is visibly exercised too.
const demoLogSet = reactive({ reps: 12, weight: 135 });
const demoLogSetCommit = ref<string | null>(null);

function onDemoLogSetCommit(payload: { reps: number; weight: number }): void {
  demoLogSet.reps = payload.reps;
  demoLogSet.weight = payload.weight;
  demoLogSetCommit.value = `commit emitted: ${payload.reps} reps // ${payload.weight} lb`;
}

// Live forge sample: the real slot, each state and exit choreography
// playable; the phase-drop timers use the same motion.ts mirrors the
// workbench screen does, so this board exercises that parity too.
const demoForge = reactive<{
  lifted: boolean;
  armed: boolean;
  fx: 'idle' | 'consume' | 'abort';
}>({ lifted: false, armed: false, fx: 'idle' });
const demoForgeShot = useOneShot();

function toggleDemoForgeLifted(): void {
  demoForge.fx = 'idle';
  demoForge.lifted = !demoForge.lifted;
  if (!demoForge.lifted) {
    demoForge.armed = false;
  }
}

function toggleDemoForgeArmed(): void {
  demoForge.armed = !demoForge.armed;
  if (demoForge.armed) {
    demoForge.lifted = true;
    demoForge.fx = 'idle';
  }
}

function playDemoForge(fx: 'consume' | 'abort'): void {
  demoForge.fx = fx;
  demoForge.lifted = false;
  demoForge.armed = false;
  demoForgeShot.set(
    () => {
      demoForge.fx = 'idle';
    },
    fx === 'consume' ? MOTION_CONSUME_MS + MOTION_SETTLE_MS : MOTION_MORPH_MS,
  );
}

// env() values only resolve when applied to a property, so each token is
// measured through a hidden probe element.
const safeAreaReadout = ref<Array<{ token: string; resolved: string }>>([]);

onMounted(() => {
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  safeAreaReadout.value = SAFE_AREA_TOKENS.map((token) => {
    probe.style.width = `var(${token})`;
    return { token, resolved: getComputedStyle(probe).width };
  });
  probe.remove();
});
</script>

<template>
  <AppShell>
    <template #header>
      <div class="gallery-header">
        <h1 class="gallery-title">Gallery</h1>
        <label class="theme-picker">
          <span class="theme-picker__label">Theme</span>
          <select v-model="selectedTheme" class="theme-picker__select">
            <option v-for="name in themes" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
      </div>
    </template>

    <div class="board">
      <section class="board-section">
        <h2 class="board-eyebrow">Brand mark</h2>
        <div class="brand-sample">
          <OdinMark class="brand-sample__mark" />
          <h3 class="brand-sample__word">ODIN</h3>
        </div>
        <div class="brand-scales">
          <OdinMark class="brand-scales__mark brand-scales__mark--nav" />
          <OdinMark class="brand-scales__mark brand-scales__mark--solo" />
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Color roles</h2>
        <div class="swatch-grid">
          <div v-for="token in colorTokens" :key="token" class="swatch">
            <div class="swatch__fill" :style="{ background: `var(${token})` }"></div>
            <span class="swatch__name">{{ token }}</span>
          </div>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Type / mono tier</h2>
        <p
          v-for="token in monoTypeTokens"
          :key="token"
          class="type-sample"
          :style="{ fontSize: `var(${token})` }"
        >
          {{ token }} // REDLINE HUD 0123456789
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Type / display tier</h2>
        <p
          v-for="token in displayTypeTokens"
          :key="token"
          class="type-sample type-sample--display"
          :style="{ fontSize: `var(${token})` }"
        >
          ODIN
        </p>
        <p class="board-note">--type-display-hero (countdown scale):</p>
        <p class="type-sample type-sample--display type-sample--hero">1:32</p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Tracking ramp</h2>
        <p
          v-for="token in trackingTokens"
          :key="token"
          class="type-sample"
          :style="{ letterSpacing: `var(${token})` }"
        >
          {{ token }} // REDLINE HUD
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Spacing scale</h2>
        <div v-for="token in spacingTokens" :key="token" class="spacing-row">
          <span class="spacing-row__name">{{ token }}</span>
          <div class="spacing-row__bar" :style="{ width: `var(${token})` }"></div>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Border weights</h2>
        <div v-for="token in borderTokens" :key="token" class="border-row">
          <span class="border-row__name">{{ token }}</span>
          <div class="border-row__line" :style="{ borderTopWidth: `var(${token})` }"></div>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Tap target floor</h2>
        <div class="tap-target">
          <span class="tap-target__label">--tap-min</span>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Textures</h2>
        <div class="texture-sample texture-sample--grain">
          <span class="texture-sample__name">--texture-grain @ --texture-grain-size</span>
        </div>
        <div class="texture-sample texture-sample--scanline">
          <span class="texture-sample__name">--texture-scanline</span>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Glow recipes</h2>
        <div class="glow-cta-sample">--glow-cta</div>
        <p class="glow-display-sample">--glow-display-accent</p>
        <div class="forge-armed-sample">--glow-forge-armed</div>
        <div class="ghost-sample">--glow-drag-ghost</div>
        <div class="well-sample">--shadow-well</div>
        <div class="raster-sample" aria-hidden="true"></div>
        <p class="board-note">
          --raster above: the workbench forge's white raster-line event glow, the one glow off the
          red channel. --glow-flash and --glow-rest-value render live in the workout-card section
          below.
        </p>
        <div class="recede-sample">
          <span class="recede-sample__page">page</span>
          <span class="recede-sample__page recede-sample__page--receded">--lift-recede</span>
        </div>
        <p class="board-note">
          --lift-recede: the luminance grade the page drops while a card is lifted (right box).
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Safe areas (live)</h2>
        <div v-for="entry in safeAreaReadout" :key="entry.token" class="safe-row">
          <span class="safe-row__name">{{ entry.token }}</span>
          <span class="safe-row__value">{{ entry.resolved }}</span>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Menu button (default / primary / disabled)</h2>
        <MenuButton>Build Circuit</MenuButton>
        <MenuButton primary>Start Workout</MenuButton>
        <MenuButton primary disabled>Start Workout</MenuButton>
        <MenuButton disabled>Stats</MenuButton>
        <p class="board-note">
          A disabled primary drops the accent dress with the affordance (third row): no glow on a
          row that cannot be pressed.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Circuit card (pending / in-progress / done / long name)</h2>
        <div class="board-card-grid">
          <CircuitCard name="Lat Pulldown" :sets="4" />
          <CircuitCard name="Cable Row" :sets="4" :logged-sets="2" progress="in-progress" />
          <CircuitCard name="Face Pull" :sets="3" :logged-sets="3" progress="done" />
          <CircuitCard name="Single-Arm Overhead Press" :sets="3" />
        </div>
        <p class="board-note">
          The set button. Press for the Lock On reticle; in-progress rides the accent channel
          (fraction + left edge) because there are reps to go; done recedes under the green outline
          stamp and goes inert.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Set progress (start / mid-set / final set / all logged)</h2>
        <SetProgress :sets="4" :logged-sets="0" />
        <SetProgress :sets="4" :logged-sets="1" />
        <SetProgress :sets="4" :logged-sets="3" />
        <SetProgress :sets="4" :logged-sets="4" />
        <p class="board-note">
          The lift screen's state readout: done sets fill solid on the lifting red (not green - a
          logged set isn't done-done), the current set blinks via background fill-pulse, never a
          glow.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Total time (running / no session)</h2>
        <TotalTime :started-at="galleryWorkoutStartedAt" />
        <TotalTime :started-at="null" />
        <p class="board-note">
          Digits re-derive from the persisted session start on every tick; the parked readout is the
          no-session state.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Last circuit data (default / custom label / hidden label)</h2>
        <LastCircuitData :reps="12" :weight="135" weight-unit="lb" />
        <LastCircuitData :reps="8" :weight="60" weight-unit="kg" label="Previous Set" />
        <LastCircuitData :reps="10" :weight="25" weight-unit="lb" label="" />
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Screen header (default / editable pencil, live)</h2>
        <ScreenHeader title="Circuits" eyebrow="Rotation // Order" />
        <ScreenHeader
          title="Legs"
          eyebrow="5 Workouts"
          editable
          @edit="demoHeaderEditEvent = 'edit emitted'"
        />
        <p v-if="demoHeaderEditEvent" class="board-note">{{ demoHeaderEditEvent }}</p>
        <p class="board-note">
          The pencil is opt-in (editable): dim ink, never accent - it edits identity, it does not
          act on it. Every other screen's default render is untouched.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Circuit row (plain / next / active / dimmed, live delete)</h2>
        <CircuitRow name="Push Day" :order="2" :workout-count="4" />
        <CircuitRow name="Legs" :order="1" :workout-count="5" tag="next" />
        <CircuitRow name="Upper Body" :order="1" :workout-count="3" tag="active" />
        <CircuitRow name="Fresh Circuit" :order="3" :workout-count="0" dimmed />
        <CircuitRow
          name="Core"
          :order="4"
          :workout-count="2"
          @delete="demoCircuitStripOpen = !demoCircuitStripOpen"
        />
        <ConfirmStrip
          v-if="demoCircuitStripOpen"
          message="Delete this circuit?"
          detail="Its workouts and their history are kept"
          confirm-label="Delete circuit"
          @confirm="demoCircuitStripOpen = false"
          @cancel="demoCircuitStripOpen = false"
        />
        <p class="board-note">
          The rotation queue's row: a numbered rack socket (the workbench slot's badge idiom)
          holding the name, its workout count, a dim delete affordance, and the grip. tag renders
          one dress, two words (NEXT / ACTIVE); dimmed is swap mode's non-target dress. The last
          row's x wires the real ConfirmStrip above, the circuits screen's exact delete flow.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">
          Confirm strip (message / detail / detailValue / cancelLabel override, live)
        </h2>
        <ConfirmStrip
          message="Your logged sets are recorded"
          detail="Start Workout will start"
          detail-value="Legs"
          confirm-label="Swap to front"
          cancel-label="Never mind"
          @confirm="demoConfirmEvent = 'confirm emitted'"
          @cancel="demoConfirmEvent = 'cancel emitted'"
        />
        <p v-if="demoConfirmEvent" class="board-note">{{ demoConfirmEvent }}</p>
        <p class="board-note">
          Generalizes PoolElsewhereRow's steal-strip grammar (accent-soft plate, a consequence line,
          two actions) to any state-changing confirm, shown every time - never a modal. detailValue
          is composed here (`detail // VALUE`), never string-interpolated by the caller. cancelLabel
          overrides the default "Keep it" here, proving the prop works.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Nav up row (label override, render-only)</h2>
        <NavUpRow label="Home" />
        <p class="board-note">
          The quiet vermilion-ghost up affordance: self-wired from route meta everywhere else, so
          the gallery route (which carries no upTo) exercises the label override instead. The press
          path is inert here - with no upTo to resolve, goUp has nowhere to go on this route.
          Android renders nothing - the system back drives the same map.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Screen note (plain / with action)</h2>
        <ScreenNote>{{ DEVICE_ONLY_NOTE }}</ScreenNote>
        <ScreenNote action="Retry">Couldn't load this circuit</ScreenNote>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Workout card (pool stock / circuit committed, live)</h2>
        <WorkoutCard name="Lat Pulldown" :sets="4" :rest-seconds="90" variant="pool" addable />
        <WorkoutCard name="Lat Pulldown" :sets="4" :rest-seconds="90" variant="pool" addable open />
        <WorkoutCard
          :name="demoCard.name"
          :sets="demoCard.sets"
          :rest-seconds="demoCard.restSeconds"
          removable
          :open="demoCard.open"
          :flash="demoCard.flash"
          @toggle="demoCard.open = !demoCard.open"
          @adjust="adjustDemoCard"
          @rename="(name) => (demoCard.name = name)"
          @flash-end="demoCard.flash = false"
        />
        <p class="board-note">
          One identity, two dress states: pool stock is a cold steel-edged line (closed, then open
          above), the circuit card is the committed vermilion-spine plate (live below). Same fold,
          same editor either way - the fold carries the one action the placement earns, ADD TO
          CIRCUIT in the pool, REMOVE FROM CIRCUIT in a circuit. Press-and-hold the name to rename.
        </p>
        <MenuButton @click="() => void replayFlash()">Replay flash-on-add</MenuButton>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Pool chrome (headers / steal strip / inline create, live)</h2>
        <PoolGroupHeader label="Available" variant="available" />
        <PoolCreateRow @create="(name) => (demoCreatedName = name)" />
        <p v-if="demoCreatedName" class="board-note">create emitted: {{ demoCreatedName }}</p>
        <PoolGroupHeader label="In Other Circuits" variant="elsewhere" />
        <PoolElsewhereRow
          name="Pushups"
          owner="Upper Body"
          :open="demoStealOpen"
          @toggle="demoStealOpen = !demoStealOpen"
          @close="demoStealOpen = false"
          @steal="demoStealOpen = false"
          @drag-start="demoPoolEvent = 'drag-start emitted'"
        />
        <p v-if="demoPoolEvent" class="board-note">{{ demoPoolEvent }}</p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Shared row parts (grip / inline entry / stepper, live)</h2>
        <GripHandle @drag-start="demoGripEvent = 'drag-start emitted'" />
        <p v-if="demoGripEvent" class="board-note">{{ demoGripEvent }}</p>
        <InlineNameEntry
          v-if="demoEntryOpen"
          placeholder="Name"
          entry-label="Sample name"
          confirm-label="Commit sample name"
          @commit="
            (text) => {
              demoEntryResult = text || '(blank)';
              demoEntryOpen = false;
            }
          "
          @cancel="demoEntryOpen = false"
        />
        <MenuButton v-else @click="demoEntryOpen = true">Open inline entry</MenuButton>
        <p v-if="demoEntryResult" class="board-note">commit emitted: {{ demoEntryResult }}</p>
        <InlineNameEntry
          v-if="demoDisplayEntryOpen"
          size="display"
          seed="Legs"
          entry-label="Circuit name"
          confirm-label="Rename circuit"
          @commit="
            (text) => {
              demoDisplayEntryResult = text || '(blank)';
              demoDisplayEntryOpen = false;
            }
          "
          @cancel="demoDisplayEntryOpen = false"
        />
        <MenuButton v-else @click="demoDisplayEntryOpen = true">
          Open display-size entry (workbench rename)
        </MenuButton>
        <p v-if="demoDisplayEntryResult" class="board-note">
          commit emitted: {{ demoDisplayEntryResult }}
        </p>
        <StepperField
          label="Recover // Rest"
          :display="`${demoStepperRest}s`"
          dec-label="-15"
          inc-label="+15"
          :step="15"
          tone="rest"
          @adjust="
            (delta) => (demoStepperRest = Math.min(600, Math.max(0, demoStepperRest + delta)))
          "
        />
        <p class="board-note">
          The parts every draggable/editable row composes: GripHandle is the one drag surface (drag
          by the dots), InlineNameEntry is the create/rename contenteditable machine, and
          StepperField is the tap-once / hold-to-ramp control. All three also render live inside the
          card and pool samples above.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Docked action (amber / ghost / ghost pulsing / filled)</h2>
        <DockedAction variant="amber" label="Start Rest" />
        <DockedAction variant="ghost" label="Next Set" />
        <DockedAction variant="ghost" :pulsing="true" label="Next Set" />
        <DockedAction variant="filled" label="Next Set" />
        <p class="board-note">
          One geometry (03-02's docked CTA shape), three color variants: amber is the lift page's
          rest channel, ghost is the rest screen's vermilion doorway back to the act-state (pulsing
          past 0:10), filled is time-up - the loudest thing on the screen.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Log set control (live, reps / weight auto-log editor)</h2>
        <LogSetControl
          :reps="demoLogSet.reps"
          :weight="demoLogSet.weight"
          weight-unit="lb"
          @commit="onDemoLogSetCommit"
        />
        <p v-if="demoLogSetCommit" class="board-note">{{ demoLogSetCommit }}</p>
        <p class="board-note">
          Reps/weight thumb pads ride StepperField's shared pointer-hold logic; the value wells are
          contenteditable (the Bebas Neue line-box gotcha rules out &lt;input&gt;). Tap a pad or
          type a value and tab away: the commit event settles after a pad/type burst or a blur.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Rest digits (normal / time-up)</h2>
        <RestDigits :remaining="90" />
        <RestDigits :remaining="0" />
        <p class="board-note">
          The hero countdown, the real shipped component: solid amber fill with one glow layer
          (--glow-rest-value); at 0 the digits calm to --text-soft while the docked action (above)
          fills solid instead - amber dominates while resting, red takes over at time-up. The pulse
          state lives on DockedAction (see the board row above), not here.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Forge slot (create row + delete face, live)</h2>
        <ForgeSlot :fx="demoForge.fx" :lifted="demoForge.lifted" :armed="demoForge.armed">
          <PoolCreateRow @create="(name) => (demoCreatedName = name)" />
        </ForgeSlot>
        <MenuButton @click="toggleDemoForgeLifted">Toggle lifted (morph rewrite)</MenuButton>
        <MenuButton @click="toggleDemoForgeArmed">Toggle armed (double rail)</MenuButton>
        <MenuButton @click="playDemoForge('consume')">Play consume exit</MenuButton>
        <MenuButton @click="playDemoForge('abort')">Play abort exit</MenuButton>
        <p class="board-note">
          The delete target the create row doubles as. The morph/abort sweeps ride a quiet steel
          edge; only the consume earns the white event beam.
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Trash snackbar (undoable / verdict)</h2>
        <TrashSnackbar
          message="Cable Row deleted"
          undoable
          @undo="demoPoolEvent = 'undo emitted'"
        />
        <TrashSnackbar message="Couldn't restore // name back in use" :undoable="false" />
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Transient card ghost (card / elsewhere content)</h2>
        <TransientCardGhost
          :content="{
            kind: 'card',
            name: 'Cable Row',
            sets: 3,
            restSeconds: 60,
            variant: 'circuit',
          }"
        />
        <TransientCardGhost
          :content="{ kind: 'elsewhere', name: 'Pushups', owner: 'Upper Body' }"
        />
        <p class="board-note">
          The one content model every drag/exit transient renders: the discriminated union means an
          elsewhere entry (no prescription) can never paint as a zeroed card.
        </p>
      </section>
    </div>

    <template #action>
      <div class="gallery-action">
        <DockedAction variant="amber" label="Primary CTA" />
      </div>
    </template>
  </AppShell>
</template>

<style scoped>
.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4);
  border-bottom: var(--hairline) solid var(--border);
}

.gallery-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-display-title);
  font-weight: 400;
  line-height: 1;
  letter-spacing: var(--tracking-2);
  color: var(--text);
  text-transform: uppercase;
}

.theme-picker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.theme-picker__label {
  font-size: var(--type-label);
  letter-spacing: var(--tracking-3);
  color: var(--text-dim);
  text-transform: uppercase;
}

.theme-picker__select {
  min-height: var(--tap-min);
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--type-body);
  color: var(--text);
  background: var(--surface);
  border: var(--rule) solid var(--border);
}

.board {
  display: grid;
  gap: var(--space-8);
  padding: var(--space-4);
}

.board-section {
  display: grid;
  gap: var(--space-3);
}

.board-eyebrow {
  margin: 0;
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-3);
  color: var(--text-dim);
  text-transform: uppercase;
}

.board-note {
  margin: 0;
  font-size: var(--type-body);
  color: var(--text-soft);
}

/* The circuit-card rows render in the start screen's own grid shape so
   the board verifies the tiles at their shipped width. Moves together
   with WorkoutStartView's .workout-start__grid (a shared home would
   put layout in a component or base.css, both wrong layers). */
.board-card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}

.brand-sample {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.brand-sample__mark {
  flex: none;
  width: var(--type-display-wordmark);
  height: var(--type-display-wordmark);
}

.brand-sample__word {
  margin: 0;
  padding-left: var(--space-4);
  color: var(--accent);
  font-family: var(--font-display);
  font-size: var(--type-display-wordmark);
  line-height: 0.82;
  letter-spacing: var(--tracking-3);
  text-shadow: var(--glow-display-accent);
  border-left: var(--hairline) solid var(--border-strong);
}

.brand-scales {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.brand-scales__mark {
  flex: none;
}

.brand-scales__mark--nav {
  width: var(--space-8);
  height: var(--space-8);
}

.brand-scales__mark--solo {
  width: var(--space-12);
  height: var(--space-12);
}

.swatch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--space-2);
}

.swatch {
  display: grid;
  gap: var(--space-1);
}

.swatch__fill {
  height: var(--space-12);
  border: var(--hairline) solid var(--border);
}

.swatch__name {
  font-size: var(--type-micro);
  color: var(--text-soft);
  word-break: break-all;
}

.type-sample {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.type-sample--display {
  font-family: var(--font-display);
  line-height: 1;
  letter-spacing: var(--tracking-2);
}

.type-sample--hero {
  font-size: var(--type-display-hero);
  font-variant-numeric: tabular-nums;
}

.spacing-row,
.border-row,
.safe-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.spacing-row__name,
.border-row__name,
.safe-row__name {
  flex: none;
  width: var(--space-12);
  min-width: fit-content;
  font-size: var(--type-micro);
  color: var(--text-soft);
}

.spacing-row__bar {
  height: var(--space-2);
  background: var(--accent);
}

.border-row__line {
  flex: 1;
  border-top: 0 solid var(--border-strong);
}

.tap-target {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-min);
  height: var(--tap-min);
  border: var(--hairline) dashed var(--border-strong);
}

.tap-target__label {
  font-size: var(--type-micro);
  color: var(--text-dim);
}

.texture-sample {
  display: flex;
  align-items: flex-end;
  height: var(--space-12);
  padding: var(--space-1);
  background-color: var(--surface);
  border: var(--hairline) solid var(--border);
}

.texture-sample--grain {
  background-image: var(--texture-grain);
  background-size: var(--texture-grain-size);
}

.texture-sample--scanline {
  background-image: var(--texture-scanline);
}

.texture-sample__name {
  font-size: var(--type-micro);
  color: var(--text-soft);
}

.glow-cta-sample {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  font-size: var(--type-data);
  letter-spacing: var(--tracking-2);
  color: var(--accent);
  text-transform: uppercase;
  background: var(--accent-soft);
  border: var(--rule) solid var(--accent);
  box-shadow: var(--glow-cta);
}

.glow-display-sample {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-display-wordmark);
  line-height: 1;
  color: var(--accent);
  text-shadow: var(--glow-display-accent);
  text-transform: uppercase;
}

.well-sample {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  font-size: var(--type-body);
  color: var(--text-soft);
  background: var(--bg);
  border: var(--hairline) solid var(--border);
  box-shadow: var(--shadow-well);
}

.forge-armed-sample {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  font-size: var(--type-body);
  color: var(--text-soft);
  border: var(--hairline) solid var(--border);
  box-shadow: var(--glow-forge-armed);
}

/* The forge's raster line at rest: 2px of --text wearing --raster. */
.raster-sample {
  height: var(--rule);
  margin: var(--space-2) 0;
  background: var(--text);
  box-shadow: var(--raster);
}

.recede-sample {
  display: flex;
  gap: var(--space-2);
}

.recede-sample__page {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  font-size: var(--type-body);
  color: var(--text);
  background: var(--surface-raise);
  border: var(--hairline) solid var(--border-strong);
}

.recede-sample__page--receded {
  filter: var(--lift-recede);
}

.ghost-sample {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: start;
  padding: var(--space-3) var(--space-4);
  font-size: var(--type-body);
  color: var(--text-soft);
  background: var(--surface);
  border: var(--hairline) solid var(--accent);
  box-shadow: var(--glow-drag-ghost);
}

.safe-row__value {
  font-size: var(--type-body);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.gallery-action {
  padding: var(--space-3) var(--space-4);
  border-top: var(--hairline) solid var(--border);
}
</style>
