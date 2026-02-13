(function () {
  const DEFAULT_WORKOUT = {
    name: "Upper Push/Pull Circuit",
    exercises: [
      { name: "Lat Pulldown", targetReps: 10, setCount: 4, defaultWeight: 90, restSeconds: 3 },
      { name: "Cable Row", targetReps: 12, setCount: 4, defaultWeight: 80, restSeconds: 3 },
      { name: "Face Pull", targetReps: 15, setCount: 3, defaultWeight: 40, restSeconds: 3 },
      { name: "Chest Press", targetReps: 10, setCount: 4, defaultWeight: 110, restSeconds: 3 },
      { name: "Chest Fly", targetReps: 12, setCount: 3, defaultWeight: 70, restSeconds: 3 }
    ]
  };

  const config = window.DESIGN_CONFIG || {};
  const baseWorkout = config.workout || DEFAULT_WORKOUT;
  const globalRestSeconds = Number(config.globalRestSeconds);
  const workout = {
    ...baseWorkout,
    exercises: (baseWorkout.exercises || []).map((exercise) => ({
      ...exercise,
      restSeconds: Number.isFinite(globalRestSeconds) ? globalRestSeconds : exercise.restSeconds
    }))
  };

  const labelsConfig = config.labels || {};
  const rewardsConfig = config.rewards || {};
  const initialConfig = config.initial || {};

  const labels = {
    rank: labelsConfig.rank || "Rank",
    streak: labelsConfig.streak || "Streak",
    currency: labelsConfig.currency || "Credits",
    objective: labelsConfig.objective || "Objective",
    objectiveDone: labelsConfig.objectiveDone || "Session complete.",
    points: labelsConfig.points || "Session XP"
  };

  const rewards = {
    setPoints: Number(rewardsConfig.setPoints !== undefined ? rewardsConfig.setPoints : 9),
    setCurrency: Number(rewardsConfig.setCurrency !== undefined ? rewardsConfig.setCurrency : 4),
    exercisePoints: Number(rewardsConfig.exercisePoints !== undefined ? rewardsConfig.exercisePoints : 24),
    exerciseCurrency: Number(rewardsConfig.exerciseCurrency !== undefined ? rewardsConfig.exerciseCurrency : 12)
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
    rank: Number(initialConfig.rank !== undefined ? initialConfig.rank : 5),
    rankXp: Number(initialConfig.rankXp !== undefined ? initialConfig.rankXp : 35),
    streak: Number(initialConfig.streak !== undefined ? initialConfig.streak : 4),
    currency: Number(initialConfig.currency !== undefined ? initialConfig.currency : 120),
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

  function formatSeconds(totalSeconds) {
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
    return workout.exercises.every((exercise, idx) => state.completedSets[idx] >= exercise.setCount);
  }

  function objectiveText() {
    if (allExercisesComplete()) {
      return labels.objectiveDone;
    }

    const lockedIdx = lockedExerciseIndex();
    if (lockedIdx !== null) {
      const exercise = exerciseByIndex(lockedIdx);
      const doneSets = state.completedSets[lockedIdx];
      return `Locked on ${exercise.name}: set ${doneSets + 1}/${exercise.setCount}. Finish this chain before selecting another exercise.`;
    }

    return "Select an incomplete exercise to begin the set chain.";
  }

  function addRewards(points, currency) {
    state.sessionPoints += points;
    state.rankXp += points;
    state.currency += currency;

    while (state.rankXp >= 100) {
      state.rankXp -= 100;
      state.rank += 1;
      showToast(`Level up. ${labels.rank} ${state.rank}.`);
    }
  }

  function requestNotifications() {
    const status = document.getElementById("notifStatus");
    if (!("Notification" in window)) {
      if (status) {
        status.textContent = "Notifications unavailable in this browser context.";
      }
      showToast("Notification API unavailable. Using in-page alerts.");
      return;
    }

    Notification.requestPermission().then((permission) => {
      if (status) {
        status.textContent = `Notifications: ${permission}.`;
      }
      if (permission === "granted") {
        showToast("Notifications enabled.");
      } else {
        showToast("Notification permission not granted. Using in-page alerts.");
      }
    });
  }

  function notifyTimerDone() {
    const idx = state.selectedExercise;
    const exercise = idx !== null ? exerciseByIndex(idx) : null;
    const body = exercise
      ? `${exercise.name} rest window completed.`
      : "Rest window completed.";

    showToast(body);

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(config.notificationTitle || "Workout Timer", {
          body,
          tag: "workout-rest"
        });
      } catch (error) {
        showToast("Notification call failed in this context.");
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
    setTimeout(() => {
      node.remove();
    }, 3200);
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
    showToast("Timer ended. Submit your set data to continue.");
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
      showToast(`Flow locked on ${lockedName}.`);
      return;
    }

    const exercise = exerciseByIndex(index);
    if (!exercise) {
      return;
    }

    if (state.completedSets[index] >= exercise.setCount) {
      showToast(`${exercise.name} is already complete.`);
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
      showToast("Select an exercise first.");
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
      showToast("Set already submitted. Awaiting flow transition.");
      return;
    }

    const reps = Number(form.reps.value);
    const weight = Number(form.weight.value);

    if (!Number.isFinite(reps) || reps <= 0) {
      showToast("Enter a valid rep count.");
      return;
    }

    if (!Number.isFinite(weight) || weight < 0) {
      showToast("Enter a valid weight.");
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
    state.rank = Number(initialConfig.rank !== undefined ? initialConfig.rank : 5);
    state.rankXp = Number(initialConfig.rankXp !== undefined ? initialConfig.rankXp : 35);
    state.streak = Number(initialConfig.streak !== undefined ? initialConfig.streak : 4);
    state.currency = Number(initialConfig.currency !== undefined ? initialConfig.currency : 120);
    render();
  }

  function renderMain() {
    return `
      <section class="screen" aria-label="Main page">
        <h3>Main Page</h3>
        <p class="meta">Your plan is preconfigured. Start workout, choose exercise, and follow the locked set chain until completion.</p>
        <div class="stack">
          <button class="cta" type="button" data-action="start-workout">Start Workout</button>
          <button class="ghost" type="button" disabled>Log Stretches (mock)</button>
          <button class="ghost" type="button" disabled>Stats (mock)</button>
          <button class="ghost" type="button" disabled>Settings (mock)</button>
        </div>
      </section>
    `;
  }

  function renderCircuit() {
    const lockedIdx = lockedExerciseIndex();
    const lockText = lockedIdx !== null
      ? `Flow locked on ${exerciseByIndex(lockedIdx).name} until all sets are complete.`
      : "Select any incomplete exercise.";

    return `
      <section class="screen" aria-label="Workout page">
        <h3>Workout Page</h3>
        <p class="meta">${lockText}</p>
        <div class="grid-tiles">
          ${workout.exercises.map((exercise, idx) => {
            const done = state.completedSets[idx];
            const isDone = done >= exercise.setCount;
            const lockOut = lockedIdx !== null && lockedIdx !== idx;
            const classes = ["exercise"];
            if (idx === state.selectedExercise) {
              classes.push("is-selected");
            }
            if (isDone) {
              classes.push("is-done");
            }

            return `
              <button
                class="${classes.join(" ")}"
                type="button"
                data-action="select-exercise"
                data-index="${idx}"
                ${isDone || lockOut ? "disabled" : ""}
              >
                <strong>${exercise.name}</strong>
                <small>${done}/${exercise.setCount} sets • ${exercise.targetReps} reps</small>
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
      <section class="screen" aria-label="Workout progress page">
        <h3>Workout Progress Page</h3>

        <section class="panel">
          <strong>${exercise.name}</strong>
          <p class="meta">Current set: ${setNumber}/${exercise.setCount}</p>
          <p class="meta">Required reps: ${exercise.targetReps}</p>
          <p class="meta">Last set: ${last ? `${last.reps} reps @ ${last.weight} lbs` : "No logged set yet"}</p>
        </section>

        <section class="panel">
          <strong>Set progression</strong>
          <div class="set-track">
            ${Array.from({ length: exercise.setCount }, (_, i) => {
              const classes = ["set-pill"];
              if (i < doneSets) {
                classes.push("is-done");
              }
              if (i === doneSets) {
                classes.push("is-active");
              }
              return `<span class="${classes.join(" ")}">${i + 1}</span>`;
            }).join("")}
          </div>
        </section>

        <section class="timer" aria-live="polite">
          <span>Rest Timer</span>
          <strong>${state.restTimerStarted ? formatSeconds(state.restRemaining) : "Starts on Enter Result Data"}</strong>
        </section>

        <button class="cta" type="button" data-action="enter-result">Enter Result Data</button>
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
      <section class="screen" aria-label="Workout result input page">
        <h3>Workout Result Input Page</h3>
        <p class="meta">${exercise.name} set ${setNumber}/${exercise.setCount}. Timer started when you entered this step.</p>

        <section class="timer" aria-live="polite">
          <span>Rest Time Remaining</span>
          <strong>${formatSeconds(state.restRemaining)}</strong>
        </section>

        <form class="stack" data-action="submit-result">
          <label class="field">
            Rep Count
            <input name="reps" type="number" min="1" max="200" required value="${state.currentInput.reps}">
          </label>
          <label class="field">
            Weight (lbs)
            <input name="weight" type="number" min="0" max="2000" required value="${state.currentInput.weight}">
          </label>
          <button class="cta" type="submit">Done</button>
        </form>
      </section>
    `;
  }

  function renderRest() {
    const idx = state.selectedExercise;
    const exercise = idx !== null ? exerciseByIndex(idx) : null;
    const setNumber = idx !== null ? state.completedSets[idx] + 1 : 0;

    return `
      <section class="screen" aria-label="Rest page">
        <h3>Rest Page</h3>
        <section class="rest-stage" aria-live="polite">
          <h4>Rest</h4>
          <strong>${formatSeconds(state.restRemaining)}</strong>
          <p class="meta">Auto-returns when timer ends.</p>
          <p class="meta">${exercise ? `${exercise.name} • Set ${setNumber}` : ""}</p>
        </section>
      </section>
    `;
  }

  function renderComplete() {
    const lines = workout.exercises.map((exercise, idx) => {
      const logs = state.entries[idx];
      const avgReps = logs.length
        ? Math.round(logs.reduce((sum, log) => sum + log.reps, 0) / logs.length)
        : 0;
      return `${exercise.name}: ${logs.length}/${exercise.setCount} sets, avg reps ${avgReps}`;
    });

    return `
      <section class="screen" aria-label="Workout complete page">
        <h3>Workout Complete</h3>
        <p class="meta">All exercises completed. ${labels.points}: ${state.sessionPoints}</p>
        <ul class="summary">
          ${lines.map((line) => `<li>${line}</li>`).join("")}
        </ul>
        <button class="cta" type="button" data-action="restart">Restart Session</button>
      </section>
    `;
  }

  function renderScreen() {
    switch (state.screen) {
      case "main":
        return renderMain();
      case "circuit":
        return renderCircuit();
      case "progress":
        return renderProgress();
      case "input":
        return renderInput();
      case "rest":
        return renderRest();
      case "complete":
        return renderComplete();
      default:
        return renderMain();
    }
  }

  function render() {
    root.innerHTML = `
      <div class="layout">
        <header class="top-meta">
          <h1>${config.pageTitle || "Workout Interface Exploration"}</h1>
          <p>${config.pageSubtitle || "Flow locked per exercise until set chain completion."}</p>
          <div class="meta-row">
            <span class="meta-chip">Genre: ${config.genre || "Hybrid"}</span>
            <span class="meta-chip">Narrative: ${config.narrative || "Progression-focused"}</span>
            <a class="meta-chip" href="${config.indexHref || "./index.html"}">${config.indexLabel || "V2 index"}</a>
            <a class="meta-chip" href="${config.backHref || "../index.html"}">${config.backLabel || "Previous 5 designs"}</a>
            <button type="button" data-action="request-notify">Enable notifications</button>
            <span id="notifStatus" class="meta-chip">Notifications: not requested.</span>
          </div>
        </header>

        <div class="workspace">
          <aside class="narrative">
            <h2>${config.narrativeTitle || "Design Narrative"}</h2>
            <p class="meta">${config.narrativeSummary || "Designed around fast transitions and clear objective framing."}</p>
            <ul>
              ${(config.designPrinciples || [
                "Clear action hierarchy.",
                "No unnecessary controls.",
                "Timer and objective always visible."
              ]).map((item) => `<li>${item}</li>`).join("")}
            </ul>
          </aside>

          <section class="phone" aria-label="Workout simulator">
            <article class="device">
              <div class="device-top">
                <span class="badge">${config.shortLabel || "Prototype"}</span>
                <span class="badge">${state.screen}</span>
              </div>

              <section class="status-grid" aria-label="Gamification status">
                <div class="xp-row">
                  <strong>${labels.rank} ${state.rank}</strong>
                  <span>${state.rankXp}/100 XP</span>
                </div>
                <div class="xp-bar"><span class="xp-fill" style="width:${state.rankXp}%"></span></div>
                <div class="metrics">
                  <div class="metric">${labels.streak}<strong>${state.streak}</strong></div>
                  <div class="metric">${labels.currency}<strong>${state.currency}</strong></div>
                  <div class="metric">${labels.points}<strong>${state.sessionPoints}</strong></div>
                </div>
              </section>

              <section class="objective" aria-label="Current objective">
                <strong>${labels.objective}</strong>
                <p>${objectiveText()}</p>
              </section>

              ${renderScreen()}

              <footer class="footer">
                <div>
                  Total time taken
                  <strong>${formatSeconds(elapsedSeconds())}</strong>
                </div>
                <div>
                  Rest time remaining
                  <strong>${formatSeconds(state.restRemaining)}</strong>
                </div>
              </footer>
            </article>
          </section>
        </div>
      </div>
    `;
  }

  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;

    switch (action) {
      case "request-notify":
        requestNotifications();
        break;
      case "start-workout":
        startWorkout();
        break;
      case "select-exercise":
        chooseExercise(Number(target.dataset.index));
        break;
      case "enter-result":
        enterResultData();
        break;
      case "restart":
        restartSession();
        break;
      default:
        break;
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    if (form.dataset.action !== "submit-result") {
      return;
    }

    event.preventDefault();
    submitSet(form);
  });

  render();
})();
