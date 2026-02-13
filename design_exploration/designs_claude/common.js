/**
 * Workout Flow State Machine
 * Implements the non-negotiable UX flow contract:
 * Main -> Circuit -> Progress -> Input -> Rest -> (loop or circuit)
 */
(function () {
  const DEFAULT_WORKOUT = {
    name: "Upper Body Circuit",
    exercises: [
      { name: "Lat Pulldown", targetReps: 10, setCount: 4, defaultWeight: 90, restSeconds: 3 },
      { name: "Cable Row", targetReps: 12, setCount: 4, defaultWeight: 80, restSeconds: 3 },
      { name: "Face Pull", targetReps: 15, setCount: 3, defaultWeight: 40, restSeconds: 3 },
      { name: "Chest Press", targetReps: 10, setCount: 4, defaultWeight: 110, restSeconds: 3 },
      { name: "Chest Fly", targetReps: 12, setCount: 3, defaultWeight: 70, restSeconds: 3 }
    ]
  };

  const config = window.DESIGN_CONFIG || {};
  const workout = config.workout || DEFAULT_WORKOUT;

  const labels = {
    rank: config.labels?.rank || "Level",
    streak: config.labels?.streak || "Streak",
    currency: config.labels?.currency || "Points",
    objective: config.labels?.objective || "Objective",
    objectiveDone: config.labels?.objectiveDone || "Session complete.",
    points: config.labels?.points || "Session XP"
  };

  const rewards = {
    setPoints: Number(config.rewards?.setPoints ?? 10),
    setCurrency: Number(config.rewards?.setCurrency ?? 5),
    exercisePoints: Number(config.rewards?.exercisePoints ?? 25),
    exerciseCurrency: Number(config.rewards?.exerciseCurrency ?? 12)
  };

  const state = {
    screen: "main",
    startedAt: null,
    selectedExercise: null,
    completedSets: Array(workout.exercises.length).fill(0),
    entries: Array.from({ length: workout.exercises.length }, () => []),
    currentInput: { reps: "", weight: "" },
    restRemaining: 0,
    restTimerStarted: false,
    restTimerId: null,
    inputSubmitted: false,
    rank: Number(config.initial?.rank ?? 3),
    rankXp: Number(config.initial?.rankXp ?? 45),
    streak: Number(config.initial?.streak ?? 7),
    currency: Number(config.initial?.currency ?? 250),
    sessionPoints: 0
  };

  const root = document.getElementById("app");
  if (!root) {
    return;
  }

  const timerInterval = setInterval(() => {
    if (state.startedAt && !state.restTimerId) {
      render();
    }
  }, 1000);

  window.addEventListener("beforeunload", () => {
    clearInterval(timerInterval);
    stopRestTimer();
  });

  function elapsedSeconds() {
    if (!state.startedAt) {
      return 0;
    }
    return Math.floor((Date.now() - state.startedAt) / 1000);
  }

  function formatTime(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function exerciseByIndex(index) {
    return workout.exercises[index];
  }

  function lockedExerciseIndex() {
    if (state.selectedExercise === null) {
      return null;
    }

    const exercise = exerciseByIndex(state.selectedExercise);
    if (!exercise) {
      return null;
    }

    return state.completedSets[state.selectedExercise] < exercise.setCount
      ? state.selectedExercise
      : null;
  }

  function allExercisesComplete() {
    return workout.exercises.every((ex, idx) => state.completedSets[idx] >= ex.setCount);
  }

  function objectiveText() {
    if (allExercisesComplete()) {
      return labels.objectiveDone;
    }

    const lockedIdx = lockedExerciseIndex();
    if (lockedIdx !== null) {
      const exercise = exerciseByIndex(lockedIdx);
      const doneSets = state.completedSets[lockedIdx];
      return `${exercise.name}: Set ${doneSets + 1} of ${exercise.setCount}`;
    }

    return "Select an exercise to begin";
  }

  function addRewards(points, currency) {
    state.sessionPoints += points;
    state.rankXp += points;
    state.currency += currency;

    while (state.rankXp >= 100) {
      state.rankXp -= 100;
      state.rank += 1;
      showToast(`Level up! Now ${labels.rank} ${state.rank}`);
    }
  }

  function requestNotifications() {
    if (!("Notification" in window)) {
      showToast("Notifications unavailable in this browser");
      return;
    }

    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        showToast("Notifications enabled");
      } else {
        showToast("Using in-page alerts");
      }
    });
  }

  function notifyTimerDone() {
    const idx = state.selectedExercise;
    const exercise = idx !== null ? exerciseByIndex(idx) : null;
    const body = exercise ? `${exercise.name} rest complete` : "Rest complete";

    showToast(body);

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(config.notificationTitle || "Workout Timer", {
          body,
          tag: "workout-rest"
        });
      } catch (err) {
        // Fallback handled by toast.
      }
    }
  }

  function getToastRegion() {
    let region = document.getElementById("toastRegion");
    if (region) {
      return region;
    }

    region = document.createElement("div");
    region.id = "toastRegion";
    region.className = "toast-region";
    region.setAttribute("aria-live", "assertive");
    region.setAttribute("aria-atomic", "true");
    document.body.appendChild(region);
    return region;
  }

  function showToast(message) {
    const region = getToastRegion();
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    region.appendChild(node);
    setTimeout(() => node.remove(), 3000);
  }

  function stopRestTimer() {
    if (state.restTimerId) {
      clearInterval(state.restTimerId);
      state.restTimerId = null;
    }
  }

  function beginRestTimer() {
    stopRestTimer();
    state.restTimerId = setInterval(() => {
      if (state.restRemaining > 0) {
        state.restRemaining -= 1;
        render();
        if (state.restRemaining === 0) {
          onRestTimerFinished();
        }
        return;
      }
      onRestTimerFinished();
    }, 1000);
  }

  function onRestTimerFinished() {
    stopRestTimer();
    notifyTimerDone();

    if (state.inputSubmitted) {
      advanceAfterSet();
      return;
    }

    state.screen = "input";
    render();
    showToast("Timer ended. Submit set data to continue.");
  }

  function advanceAfterSet() {
    const idx = state.selectedExercise;
    if (idx === null) {
      return;
    }

    const exercise = exerciseByIndex(idx);
    if (state.completedSets[idx] < exercise.setCount) {
      state.completedSets[idx] += 1;
    }

    state.restRemaining = 0;
    state.restTimerStarted = false;
    state.inputSubmitted = false;

    if (state.completedSets[idx] >= exercise.setCount) {
      addRewards(rewards.exercisePoints, rewards.exerciseCurrency);
      state.selectedExercise = null;
      state.currentInput = { reps: "", weight: "" };
      state.screen = allExercisesComplete() ? "complete" : "circuit";
    } else {
      state.screen = "progress";
    }

    render();
  }

  function startWorkout() {
    if (!state.startedAt) {
      state.startedAt = Date.now();
    }
    state.screen = allExercisesComplete() ? "complete" : "circuit";
    render();
  }

  function chooseExercise(index) {
    const lockedIdx = lockedExerciseIndex();
    if (lockedIdx !== null && lockedIdx !== index) {
      const lockedName = exerciseByIndex(lockedIdx).name;
      showToast(`Finish ${lockedName} first`);
      return;
    }

    const exercise = exerciseByIndex(index);
    if (!exercise) {
      return;
    }

    if (state.completedSets[index] >= exercise.setCount) {
      showToast(`${exercise.name} complete`);
      return;
    }

    state.selectedExercise = index;
    state.restRemaining = 0;
    state.restTimerStarted = false;
    state.inputSubmitted = false;
    state.currentInput = {
      reps: String(exercise.targetReps),
      weight: String(exercise.defaultWeight)
    };
    state.screen = "progress";
    render();
  }

  function enterResultData() {
    const idx = state.selectedExercise;
    if (idx === null) {
      showToast("Select an exercise first");
      return;
    }

    const exercise = exerciseByIndex(idx);
    if (!state.restTimerStarted) {
      state.restRemaining = exercise.restSeconds;
      state.restTimerStarted = true;
      beginRestTimer();
    }

    state.screen = "input";
    render();
  }

  function submitSet(form) {
    const idx = state.selectedExercise;
    if (idx === null) {
      return;
    }

    if (state.inputSubmitted) {
      showToast("Set already submitted");
      return;
    }

    const reps = Number(form.reps.value);
    const weight = Number(form.weight.value);

    if (!Number.isFinite(reps) || reps <= 0) {
      showToast("Enter valid rep count");
      return;
    }

    if (!Number.isFinite(weight) || weight < 0) {
      showToast("Enter valid weight");
      return;
    }

    const setNumber = state.completedSets[idx] + 1;
    state.entries[idx].push({
      set: setNumber,
      reps,
      weight,
      at: new Date().toLocaleTimeString()
    });

    addRewards(rewards.setPoints, rewards.setCurrency);
    state.inputSubmitted = true;

    if (!state.restTimerStarted) {
      const exercise = exerciseByIndex(idx);
      state.restRemaining = exercise.restSeconds;
      state.restTimerStarted = true;
      beginRestTimer();
    }

    if (state.restRemaining > 0) {
      state.screen = "rest";
      render();
      return;
    }

    advanceAfterSet();
  }

  function restartSession() {
    stopRestTimer();
    state.screen = "main";
    state.startedAt = null;
    state.selectedExercise = null;
    state.completedSets = Array(workout.exercises.length).fill(0);
    state.entries = Array.from({ length: workout.exercises.length }, () => []);
    state.currentInput = { reps: "", weight: "" };
    state.restRemaining = 0;
    state.restTimerStarted = false;
    state.inputSubmitted = false;
    state.sessionPoints = 0;
    state.rank = Number(config.initial?.rank ?? 3);
    state.rankXp = Number(config.initial?.rankXp ?? 45);
    state.streak = Number(config.initial?.streak ?? 7);
    state.currency = Number(config.initial?.currency ?? 250);
    render();
  }

  // Render functions - each design overrides via CSS.
  function renderMain() {
    return `
      <section class="screen screen--main" aria-label="Main page">
        <div class="screen__header">
          <h2 class="screen__title">Ready</h2>
          <p class="screen__subtitle">Your workout is configured and waiting.</p>
        </div>
        <div class="action-stack">
          <button class="btn btn--primary" type="button" data-action="start-workout">
            Start Workout
          </button>
          <button class="btn btn--ghost" type="button" disabled>Log Stretches</button>
          <button class="btn btn--ghost" type="button" disabled>Stats</button>
          <button class="btn btn--ghost" type="button" disabled>Settings</button>
        </div>
      </section>
    `;
  }

  function renderCircuit() {
    const lockedIdx = lockedExerciseIndex();

    return `
      <section class="screen screen--circuit" aria-label="Workout page">
        <div class="screen__header">
          <h2 class="screen__title">Exercises</h2>
          <p class="screen__subtitle">${lockedIdx !== null 
            ? `Locked: ${exerciseByIndex(lockedIdx).name}` 
            : "Select any exercise"}</p>
        </div>
        <div class="exercise-grid">
          ${workout.exercises.map((exercise, idx) => {
            const done = state.completedSets[idx];
            const isDone = done >= exercise.setCount;
            const lockOut = lockedIdx !== null && lockedIdx !== idx;
            const classes = ["exercise-tile"];
            if (isDone) classes.push("exercise-tile--done");
            if (lockOut) classes.push("exercise-tile--locked");

            return `
              <button
                class="${classes.join(" ")}"
                type="button"
                data-action="select-exercise"
                data-index="${idx}"
                ${isDone || lockOut ? "disabled" : ""}
              >
                <span class="exercise-tile__name">${exercise.name}</span>
                <span class="exercise-tile__meta">${done}/${exercise.setCount} sets</span>
                <span class="exercise-tile__reps">${exercise.targetReps} reps</span>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderProgress() {
    const idx = state.selectedExercise;
    const exercise = idx !== null ? exerciseByIndex(idx) : null;
    if (!exercise) {
      return renderCircuit();
    }

    const doneSets = state.completedSets[idx];
    const setNumber = doneSets + 1;
    const last = state.entries[idx][state.entries[idx].length - 1];

    return `
      <section class="screen screen--progress" aria-label="Exercise progress">
        <div class="screen__header">
          <h2 class="screen__title">${exercise.name}</h2>
          <p class="screen__subtitle">Set ${setNumber} of ${exercise.setCount}</p>
        </div>

        <div class="progress-stats">
          <div class="stat-block">
            <span class="stat-block__label">Target Reps</span>
            <span class="stat-block__value">${exercise.targetReps}</span>
          </div>
          <div class="stat-block">
            <span class="stat-block__label">Last Set</span>
            <span class="stat-block__value">${last ? `${last.reps}@${last.weight}` : "---"}</span>
          </div>
        </div>

        <div class="set-indicators">
          ${Array.from({ length: exercise.setCount }, (_, i) => {
            const classes = ["set-dot"];
            if (i < doneSets) classes.push("set-dot--done");
            if (i === doneSets) classes.push("set-dot--current");
            return `<span class="${classes.join(" ")}">${i + 1}</span>`;
          }).join("")}
        </div>

        <div class="timer-display" aria-live="polite">
          <span class="timer-display__label">Rest Timer</span>
          <span class="timer-display__value">${state.restTimerStarted 
            ? formatTime(state.restRemaining) 
            : "Starts on input"}</span>
        </div>

        <button class="btn btn--primary" type="button" data-action="enter-result">
          Enter Result Data
        </button>
      </section>
    `;
  }

  function renderInput() {
    const idx = state.selectedExercise;
    const exercise = idx !== null ? exerciseByIndex(idx) : null;
    if (!exercise) {
      return renderCircuit();
    }

    const setNumber = state.completedSets[idx] + 1;

    return `
      <section class="screen screen--input" aria-label="Result input">
        <div class="screen__header">
          <h2 class="screen__title">${exercise.name}</h2>
          <p class="screen__subtitle">Set ${setNumber} of ${exercise.setCount}</p>
        </div>

        <div class="timer-display timer-display--compact" aria-live="polite">
          <span class="timer-display__label">Rest Remaining</span>
          <span class="timer-display__value">${formatTime(state.restRemaining)}</span>
        </div>

        <form class="input-form" data-action="submit-result">
          <div class="input-field">
            <label for="reps">Reps Completed</label>
            <input 
              id="reps"
              name="reps" 
              type="number" 
              min="1" 
              max="200" 
              required 
              value="${state.currentInput.reps}"
              inputmode="numeric"
            >
          </div>
          <div class="input-field">
            <label for="weight">Weight (lbs)</label>
            <input 
              id="weight"
              name="weight" 
              type="number" 
              min="0" 
              max="2000" 
              required 
              value="${state.currentInput.weight}"
              inputmode="numeric"
            >
          </div>
          <button class="btn btn--primary" type="submit">Done</button>
        </form>
      </section>
    `;
  }

  function renderRest() {
    const idx = state.selectedExercise;
    const exercise = idx !== null ? exerciseByIndex(idx) : null;
    const setNumber = idx !== null ? state.completedSets[idx] + 1 : 0;

    return `
      <section class="screen screen--rest" aria-label="Rest page">
        <div class="rest-display" aria-live="polite">
          <span class="rest-display__label">REST</span>
          <span class="rest-display__timer">${formatTime(state.restRemaining)}</span>
          <span class="rest-display__meta">${exercise ? exercise.name : ""}</span>
          <span class="rest-display__set">Set ${setNumber}</span>
          <span class="rest-display__hint">Auto-returns when complete</span>
        </div>
      </section>
    `;
  }

  function renderComplete() {
    const summaryLines = workout.exercises.map((exercise, idx) => {
      const logs = state.entries[idx];
      const avgReps = logs.length
        ? Math.round(logs.reduce((sum, log) => sum + log.reps, 0) / logs.length)
        : 0;
      return { name: exercise.name, sets: logs.length, total: exercise.setCount, avgReps };
    });

    return `
      <section class="screen screen--complete" aria-label="Workout complete">
        <div class="screen__header">
          <h2 class="screen__title">Complete</h2>
          <p class="screen__subtitle">${labels.points}: ${state.sessionPoints}</p>
        </div>

        <ul class="summary-list">
          ${summaryLines.map(line => `
            <li class="summary-item">
              <span class="summary-item__name">${line.name}</span>
              <span class="summary-item__stats">${line.sets}/${line.total} sets, avg ${line.avgReps} reps</span>
            </li>
          `).join("")}
        </ul>

        <button class="btn btn--primary" type="button" data-action="restart">
          New Session
        </button>
      </section>
    `;
  }

  function renderScreen() {
    switch (state.screen) {
      case "main": return renderMain();
      case "circuit": return renderCircuit();
      case "progress": return renderProgress();
      case "input": return renderInput();
      case "rest": return renderRest();
      case "complete": return renderComplete();
      default: return renderMain();
    }
  }

  function render() {
    const progressPercent = (state.rankXp / 100) * 100;

    root.innerHTML = `
      <div class="app-layout">
        <header class="app-header">
          <div class="app-header__brand">
            <span class="brand-name">${config.brandName || "ODIN"}</span>
            <span class="brand-tag">${config.brandTag || "Workout"}</span>
          </div>
          <div class="app-header__controls">
            <button class="btn btn--small" type="button" data-action="request-notify">
              Notifications
            </button>
            <a class="btn btn--small btn--ghost" href="./index.html">Index</a>
          </div>
        </header>

        <main class="app-main">
          <aside class="sidebar">
            <div class="design-info">
              <h1 class="design-info__title">${config.designTitle || "Design Variant"}</h1>
              <p class="design-info__desc">${config.designDesc || "Prototype exploration"}</p>
              <ul class="design-info__principles">
                ${(config.principles || []).map(p => `<li>${p}</li>`).join("")}
              </ul>
            </div>
          </aside>

          <div class="device-frame">
            <div class="device">
              <div class="device__status">
                <span class="status-badge">${config.shortName || "Prototype"}</span>
                <span class="status-badge status-badge--screen">${state.screen}</span>
              </div>

              <div class="gamification-bar">
                <div class="level-display">
                  <span class="level-display__label">${labels.rank}</span>
                  <span class="level-display__value">${state.rank}</span>
                </div>
                <div class="xp-bar">
                  <div class="xp-bar__fill" style="width: ${progressPercent}%"></div>
                  <span class="xp-bar__text">${state.rankXp}/100</span>
                </div>
                <div class="metrics-row">
                  <div class="metric">
                    <span class="metric__label">${labels.streak}</span>
                    <span class="metric__value">${state.streak}</span>
                  </div>
                  <div class="metric">
                    <span class="metric__label">${labels.currency}</span>
                    <span class="metric__value">${state.currency}</span>
                  </div>
                  <div class="metric">
                    <span class="metric__label">${labels.points}</span>
                    <span class="metric__value">${state.sessionPoints}</span>
                  </div>
                </div>
              </div>

              <div class="objective-bar">
                <span class="objective-bar__label">${labels.objective}</span>
                <span class="objective-bar__text">${objectiveText()}</span>
              </div>

              <div class="device__content">
                ${renderScreen()}
              </div>

              <footer class="device__footer">
                <div class="footer-stat">
                  <span class="footer-stat__label">Elapsed</span>
                  <span class="footer-stat__value">${formatTime(elapsedSeconds())}</span>
                </div>
                <div class="footer-stat">
                  <span class="footer-stat__label">Rest</span>
                  <span class="footer-stat__value">${formatTime(state.restRemaining)}</span>
                </div>
              </footer>
            </div>
          </div>
        </main>
      </div>
    `;
  }

  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
      case "request-notify": requestNotifications(); break;
      case "start-workout": startWorkout(); break;
      case "select-exercise": chooseExercise(Number(target.dataset.index)); break;
      case "enter-result": enterResultData(); break;
      case "restart": restartSession(); break;
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.action !== "submit-result") return;

    event.preventDefault();
    submitSet(form);
  });

  render();
})();
