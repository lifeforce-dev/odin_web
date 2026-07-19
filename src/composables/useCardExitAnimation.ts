import { nextTick, ref, watch, watchEffect } from 'vue';

import type { TrashedWorkout } from '@/domain/builder';
import {
  MOTION_DELETE_MS,
  MOTION_MORPH_MS,
  MOTION_SETTLE_MS,
  MOTION_SLIDE_MS,
} from '@/styles/motion';

import { useOneShot } from './useOneShot';
import type { UndoTrashOutcome } from './useWorkbench';
import type { WorkbenchDragState } from './useWorkbenchDrag';

// The card's exit animations. While a card is lifted the CSS drives the
// reveal / rest / armed states straight from drag-state classes, but the
// two exit animations play after the drag session has already reset, so
// they need their own transient phase. The delete animation (the card
// collapses to a line, the line flies into the target, a flash, then the
// undo snackbar) follows a drop on the delete target; the cancel animation
// (the face hides, plus the card flying back to its row when nothing was
// committed) follows every other release. The screen hands geometry and
// persistence in through the options and renders the state this returns;
// DeleteTarget / TrashSnackbar / TransientCardGhost use it.

// What a transient element renders - the drag ghost, the deleting card, and
// the returning card all show the same content model, resolved from
// whichever zone the card lives in. A discriminated union so the compiler
// owns the card-vs-elsewhere branch: an elsewhere entry has no prescription,
// and no branch can accidentally render one as "0x // 0s".
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
// animations snapshot the in-flight ghost while it still exists.
interface GhostSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The delete snackbar. `undo` lands when the trash write settles; a `notice`
// replaces the "<name> deleted" line (and takes the Undo button with it)
// when the delete or its undo could not deliver - the toast must never
// promise an undo it does not have.
export interface TrashToast {
  exerciseId: string;
  name: string;
  undo: TrashedWorkout | null;
  notice: string | null;
}

const TOAST_HOLD_MS = 5000;
const NOTICE_HOLD_MS = 2000;

export interface CardExitAnimationOptions {
  // The live drag session state (reactive).
  dragState: WorkbenchDragState;
  // Resolves what a lifted card renders, from either zone.
  cardContent(exerciseId: string): TransientCard | null;
  // The rendered row for an exercise, the target the card returns to.
  findRowEl(exerciseId: string): HTMLElement | null;
  // The y the collapsing card's line flies to; null when the delete target
  // is not mounted.
  measureDeleteTargetY(): number | null;
  // Whether the release that just ended committed anything (reorder,
  // remove, add, delete): a commit's exit never returns the card to its row.
  wasDropCommitted(): boolean;
  trashWorkout(exerciseId: string): Promise<TrashedWorkout | null>;
  undoTrash(trashed: TrashedWorkout): Promise<UndoTrashOutcome>;
}

export function useCardExitAnimation(options: CardExitAnimationOptions) {
  const exitFx = ref<'idle' | 'delete' | 'cancel'>('idle');
  const fxShot = useOneShot();

  // The deleting card (position via --delete-ghost-* custom props; the
  // collapse keyframes own transform, so the position rides inside).
  const deleteGhost = ref<(GhostSnapshot & { content: TransientCard; targetY: number }) | null>(
    null,
  );
  // The returning card: the lifted card flies back to its row.
  const returnGhost = ref<
    (GhostSnapshot & { content: TransientCard; toX: number; toY: number }) | null
  >(null);
  const returnShot = useOneShot();

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

  function playExitFx(phase: 'delete' | 'cancel', durationMs: number): void {
    exitFx.value = phase;
    fxShot.set(() => {
      exitFx.value = 'idle';
      deleteGhost.value = null;
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
      const targetY = options.measureDeleteTargetY() ?? from.y;
      deleteGhost.value = { content, ...from, targetY };
      dismissToast();
      trashToast.value = { exerciseId, name: content.name, undo: null, notice: null };
      toastShot.set(dismissToast, MOTION_DELETE_MS + TOAST_HOLD_MS);
    }
    playExitFx('delete', MOTION_DELETE_MS + MOTION_SETTLE_MS);
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
      // Nothing was deleted (already gone, or the chain resynced): the
      // reload told the screen the truth; say so and drop the Undo.
      toast.notice = "Couldn't delete // try again";
      toastShot.set(dismissToast, NOTICE_HOLD_MS);
    });
  }

  async function undoTrashTapped(): Promise<void> {
    const toast = trashToast.value;
    if (!toast || !toast.undo || toast.notice !== null) {
      return;
    }
    const outcome = await options.undoTrash(toast.undo);
    if (outcome === 'restored') {
      dismissToast();
      return;
    }
    // Either way the reload already told the screen the truth; the two
    // non-restored outcomes still earn different copy (a retaken name and
    // an I/O failure read differently).
    toast.notice =
      outcome === 'spent'
        ? "Couldn't restore // name back in use"
        : "Couldn't restore // try again";
    toastShot.set(dismissToast, NOTICE_HOLD_MS);
  }

  // A cancelled drag returns the card to its row: functional motion showing
  // where the card went. Commits deliberately do not animate (the release
  // was the preview); a delete owns its own exit.
  async function returnToRow(exerciseId: string): Promise<void> {
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
    returnGhost.value = { content, ...from, toX: rect.left, toY: rect.top };
    returnShot.set(() => {
      returnGhost.value = null;
    }, MOTION_SLIDE_MS);
  }

  // The exit watcher: every release that is not a delete plays the hide
  // sweep (the same sweep covers every exit); a release that committed
  // nothing also returns the card to its row. A new lift cancels any exit
  // still playing. (Drop callbacks run synchronously inside the drag's
  // drop(), before this deferred watcher fires - that ordering is what lets
  // the delete branch win here.)
  watch(
    () => options.dragState.draggingId,
    (draggingId, previous) => {
      if (draggingId !== null) {
        exitFx.value = 'idle';
        deleteGhost.value = null;
        fxShot.cancel();
        return;
      }
      if (previous === null || exitFx.value === 'delete') {
        return;
      }
      playExitFx('cancel', MOTION_MORPH_MS);
      if (!options.wasDropCommitted()) {
        void returnToRow(previous);
      }
    },
  );

  // The screen-switch reset: transient paint and the undo toast are keyed to
  // the old circuit's ids and must not survive it.
  function reset(): void {
    exitFx.value = 'idle';
    deleteGhost.value = null;
    returnGhost.value = null;
    fxShot.cancel();
    returnShot.cancel();
    dismissToast();
  }

  return {
    exitFx,
    deleteGhost,
    returnGhost,
    trashToast,
    onTrashDrop,
    undoTrashTapped,
    dismissToast,
    reset,
  };
}
