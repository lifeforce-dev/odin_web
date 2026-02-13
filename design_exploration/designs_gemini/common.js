/**
 * WorkoutFlow State Machine
 * Handles the logic for the workout prototype.
 */

const MOCK_WORKOUT = {
    id: 'workout_1',
    name: 'Upper Body Power',
    exercises: [
        { id: 'ex_1', name: 'Lat Pulldown', sets: 3, reps: '8-12', completedSets: 0, isComplete: false },
        { id: 'ex_2', name: 'Cable Row', sets: 3, reps: '10-12', completedSets: 0, isComplete: false },
        { id: 'ex_3', name: 'Face Pull', sets: 3, reps: '15-20', completedSets: 0, isComplete: false },
        { id: 'ex_4', name: 'Chest Press', sets: 3, reps: '6-8', completedSets: 0, isComplete: false },
        { id: 'ex_5', name: 'Chest Fly', sets: 3, reps: '12-15', completedSets: 0, isComplete: false },
    ]
};

const REST_TIME_SECONDS = 3; // Short rest for prototype testing

class WorkoutFlow {
    constructor(uiCallbacks) {
        this.ui = uiCallbacks; // { renderPage(pageIds, state), updateTimer(seconds) }
        this.state = {
            currentPage: 'page-main',
            workout: JSON.parse(JSON.stringify(MOCK_WORKOUT)),
            activeExerciseId: null,
            restTimeRemaining: 0,
            timerInterval: null, 
            backgroundTimerStart: null,
            timerDuration: REST_TIME_SECONDS
        };

        this.init();
    }

    init() {
        this.bindEvents();
        // Check Notification permission
        if ("Notification" in window && Notification.permission !== "granted") {
            Notification.requestPermission();
        }
        this.ui.renderPage('page-main', this.state);
    }

    // --- Actions ---

    startWorkout() {
        this.transition('page-circuit');
    }

    selectExercise(exerciseId) {
        const exercise = this.state.workout.exercises.find(e => e.id === exerciseId);
        if (exercise.isComplete) return; // Can't re-do in this flow
        
        this.state.activeExerciseId = exerciseId;
        this.transition('page-progress');
    }

    enterResultData() {
        // Contract: Rest timer starts WHEN user clicks "Enter Result Data"
        this.startRestTimer();
        this.transition('page-result-input');
    }

    submitResult(reps, weight) {
        // Logic: Save data (mock)
        const exercise = this._getActiveExercise();
        console.log(`Saved Set ${exercise.completedSets + 1}: ${reps} reps @ ${weight}`);
        
        // Don't increment completedSets yet, do it after rest or here?
        // Usually "Done" implies set is finished. Rest is happening in parallel or subsequently.
        // UX Flow says: Result Input -> Done -> Rest Page.
        // But timer started at 'Enter Result Data'. 
        // So hitting 'Done' just shows the Rest Page which is already counting down.
        
        exercise.completedSets++;
        
        if (this.state.restTimeRemaining > 0) {
            this.transition('page-rest');
        } else {
            this.handleRestComplete();
        }
    }

    // --- Timer Logic ---

    startRestTimer() {
        if (this.state.timerInterval) clearInterval(this.state.timerInterval);
        
        this.state.restTimeRemaining = this.state.timerDuration;
        this.state.backgroundTimerStart = Date.now();
        
        this.state.timerInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = Math.floor((now - this.state.backgroundTimerStart) / 1000);
            this.state.restTimeRemaining = this.state.timerDuration - elapsed;

            if (this.state.restTimeRemaining <= 0) {
                this.state.restTimeRemaining = 0;
                clearInterval(this.state.timerInterval);
                this.handleRestComplete();
            }
            
            this.ui.updateTimer(this.state.restTimeRemaining);
        }, 1000);
    }

    handleRestComplete() {
        if (this.state.timerInterval) clearInterval(this.state.timerInterval);
        this.state.timerInterval = null;

        // Notify
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Rest Complete!", { body: "Get ready for the next set." });
        }

        const exercise = this._getActiveExercise();
        
        // Loop Logic
        if (exercise.completedSets < exercise.sets) {
            // Auto-return to progress
            this.transition('page-progress');
        } else {
            // Exercise complete
            exercise.isComplete = true;
            this.state.activeExerciseId = null;
            this.transition('page-circuit');
        }
    }

    // --- Navigation & Helpers ---

    transition(pageId) {
        this.state.currentPage = pageId;
        this.ui.renderPage(pageId, this.getStateForRender());
    }

    _getActiveExercise() {
        return this.state.workout.exercises.find(e => e.id === this.state.activeExerciseId);
    }

    getStateForRender() {
        const exercise = this._getActiveExercise();
        return {
            ...this.state,
            activeExercise: exercise
        };
    }

    // --- Event Binding helper for implementation ---
    bindEvents() {
        // Implementation specific logic should call public methods
    }
}
