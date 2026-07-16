import { nextTick, ref, watch, watchEffect } from 'vue';

import type { TrashedWorkout } from '@/domain/builder';
import {
  MOTION_CONSUME_MS,
  MOTION_MORPH_MS,
  MOTION_SETTLE_MS,
  MOTION_SLIDE_MS,
} from '@/styles/motion';

import { useOneShot } from './useOneShot';
import type { UndoTrashOutcome } from './useWorkbench';
import type { WorkbenchDragState } from './useWorkbenchDrag';

// The forge exit choreography. While a card is lifted the CSS owns
// MORPH / DORMANT / ARMED straight from drag-state classes, but the
// two exit choreographies play after the drag session has already
// reset, so they need their own transient phase. Consume (tv-off
// collapse, line dart, white-hot impact, reverse rewrite, undo
// snackbar) follows a forge drop; abort (bare reverse rewrite, plus a
// fly-home when nothing was committed) follows every other release.
// The screen hands geometry and persistence in through the options and
// renders the state this returns; ForgeSlot / TrashSnackbar /
// TransientCardGhost wear it.

// What a transient element renders - the drag ghost, the consume tv-off
// and the put-back fly all show the same content model, resolved from
// whichever zone the card lives in. A discriminated union so the
// compiler owns the card-vs-elsewhere branch: an elsewhere entry has no
// prescription, and no branch can accidentally render one as "0x // 0s".
export type TransientCard =
  | {
      kind: 'card';
      name: string;
      sets: number;
      restSeconds: number;
      variant: 'circuit' | 'pool';
    }
  | { kind: 'elsewhere'; name: string; owner: string };

// The drag session resets before its drop callbacks run, so the exit
// choreographies snapshot the in-flight ghost while it still exists.
interface GhostSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The consume snackbar. `undo` lands when the trash write settles; a
// `verdict` replaces the "<name> deleted" line (and takes the Undo
// button with it) when the delete or its undo could not deliver - the
// toast must never promise an undo it does not have.
export interface TrashToast {
  exerciseId: string;
  name: string;
  undo: TrashedWorkout | null;
  verdict: string | null;
}

const TOAST_HOLD_MS = 5000;
const VERDICT_HOLD_MS = 2000;

export interface ForgeChoreographyOptions {
  // The live drag session state (reactive).
  dragState: WorkbenchDragState;
  // Resolves what a lifted card renders, from either zone.
  cardContent(exerciseId: string): TransientCard | null;
  // The rendered row for an exercise, for the fly-home target.
  findRowEl(exerciseId: string): HTMLElement | null;
  // Where the tv-off line darts to; null when the forge is not mounted.
  measureDartTarget(): number | null;
  // Whether the release that just ended committed anything (reorder,
  // remove, add, trash): a commit's exit never flies the card home.
  wasDropCommitted(): boolean;
  trashWorkout(exerciseId: string): Promise<TrashedWorkout | null>;
  undoTrash(trashed: TrashedWorkout): Promise<UndoTrashOutcome>;
}

export function useForgeChoreography(options: ForgeChoreographyOptions) {
  const forgeFx = ref<'idle' | 'consume' | 'abort'>('idle');
  const fxShot = useOneShot();

  // The tv-off transient (position via --cg-* custom props; the
  // collapse keyframes own transform, so the position rides inside).
  const consumeGhost = ref<(GhostSnapshot & { content: TransientCard; dartTo: number }) | null>(
    null,
  );
  // The put-back transient: the lifted card flies back to its row.
  const flyGhost = ref<
    (GhostSnapshot & { content: TransientCard; toX: number; toY: number }) | null
  >(null);
  const flyShot = useOneShot();

  const trashToast = ref<TrashToast | null>(null);
  const toastShot = useOneShot();

  let ghostSnapshot: GhostSnapshot | null = null;
  watchEffect(() => {
    if (options.dragState.draggingId !== null) {
      ghostSnapshot = {
        x: options.dragState.ghostX,
        y: options.dragState.ghostY,
        width: options.dragState.ghostWidth,
        height: options.dragState.ghostHeight,
      };
    }
  });

  function playForgeFx(phase: 'consume' | 'abort', durationMs: number): void {
    forgeFx.value = phase;
    fxShot.set(() => {
      forgeFx.value = 'idle';
      consumeGhost.value = null;
    }, durationMs);
  }

  function dismissToast(): void {
    toastShot.cancel();
    trashToast.value = null;
  }

  function onTrashDrop(exerciseId: string): void {
    const content = options.cardContent(exerciseId);
    const from = ghostSnapshot;
    if (content && from) {
      const dartTo = options.measureDartTarget() ?? from.y;
      consumeGhost.value = { content, ...from, dartTo };
      dismissToast();
      trashToast.value = { exerciseId, name: content.name, undo: null, verdict: null };
      toastShot.set(dismissToast, MOTION_CONSUME_MS + TOAST_HOLD_MS);
    }
    playForgeFx('consume', MOTION_CONSUME_MS + MOTION_SETTLE_MS);
    void options.trashWorkout(exerciseId).then((undo) => {
      const toast = trashToast.value;
      // The toast may already belong to a later drop; the exercise id
      // is the honest key (names can repeat across quick deletes).
      if (!toast || toast.exerciseId !== exerciseId) {
        return;
      }
      if (undo) {
        toast.undo = undo;
        return;
      }
      // Nothing was trashed (already gone, or the chain resynced): the
      // reload told the screen the truth; say so and drop the Undo.
      toast.verdict = "Couldn't delete // try again";
      toastShot.set(dismissToast, VERDICT_HOLD_MS);
    });
  }

  async function undoTrashTapped(): Promise<void> {
    const toast = trashToast.value;
    if (!toast || !toast.undo || toast.verdict !== null) {
      return;
    }
    const outcome = await options.undoTrash(toast.undo);
    if (outcome === 'restored') {
      dismissToast();
      return;
    }
    // Either way the reload already told the screen the truth; the two
    // non-restored outcomes still earn different copy (a retaken name
    // is a verdict, an I/O failure is not).
    toast.verdict =
      outcome === 'spent'
        ? "Couldn't restore // name back in use"
        : "Couldn't restore // try again";
    toastShot.set(dismissToast, VERDICT_HOLD_MS);
  }

  // A put-back (or cancel) flies the card home: functional motion, the
  // exit states where the card went. Commits deliberately do not
  // animate (release is the preview); consume owns its own exit.
  async function flyHome(exerciseId: string): Promise<void> {
    const from = ghostSnapshot;
    const content = options.cardContent(exerciseId);
    if (!from || !content) {
      return;
    }
    await nextTick();
    const row = options.findRowEl(exerciseId);
    if (!row) {
      return;
    }
    const rect = row.getBoundingClientRect();
    flyGhost.value = { content, ...from, toX: rect.left, toY: rect.top };
    flyShot.set(() => {
      flyGhost.value = null;
    }, MOTION_SLIDE_MS);
  }

  // The exit watcher: every release that is not a consume plays the
  // reverse rewrite (the grammar covers every exit); a release that
  // committed nothing also flies the card home. A new lift cancels any
  // exit still playing. (Drop callbacks run synchronously inside the
  // drag's drop(), before this deferred watcher fires - that ordering
  // is what lets the consume branch win here.)
  watch(
    () => options.dragState.draggingId,
    (draggingId, previous) => {
      if (draggingId !== null) {
        forgeFx.value = 'idle';
        consumeGhost.value = null;
        fxShot.cancel();
        return;
      }
      if (previous === null || forgeFx.value === 'consume') {
        return;
      }
      playForgeFx('abort', MOTION_MORPH_MS);
      if (!options.wasDropCommitted()) {
        void flyHome(previous);
      }
    },
  );

  // The screen-switch reset: transient paint and the undo toast are
  // keyed to the old circuit's ids and must not survive it.
  function reset(): void {
    forgeFx.value = 'idle';
    consumeGhost.value = null;
    flyGhost.value = null;
    fxShot.cancel();
    flyShot.cancel();
    dismissToast();
  }

  return {
    forgeFx,
    consumeGhost,
    flyGhost,
    trashToast,
    onTrashDrop,
    undoTrashTapped,
    dismissToast,
    reset,
  };
}
