const LEGACY_STORAGE_KEYS = ["habit-momentum-v2", "habit-momentum-v1"];
const DB_NAME = "habit-momentum-db";
const DB_VERSION = 1;
const STORE_NAME = "habit_store";
const STATE_KEY = "current_state";
const MS_IN_DAY = 86400000;
const MILESTONES = [3, 7, 14, 21, 30, 45, 60];
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const views = {
  dashboard: document.getElementById("view-dashboard"),
  calendar: document.getElementById("view-calendar"),
  detail: document.getElementById("view-detail"),
  add: document.getElementById("view-add"),
};

const sidebarTotalHabits = document.getElementById("sidebarTotalHabits");
const sidebarPending = document.getElementById("sidebarPending");
const sidebarDone = document.getElementById("sidebarDone");
const sidebarHabits = document.getElementById("sidebarHabits");

const habitForm = document.getElementById("habitForm");
const habitNameInput = document.getElementById("habitName");
const habitCommitmentInput = document.getElementById("habitCommitment");
const habitDurationInput = document.getElementById("habitDuration");

const todayBoardDate = document.getElementById("todayBoardDate");
const completeAllBtn = document.getElementById("completeAllBtn");
const todayChecklist = document.getElementById("todayChecklist");
const todayChecklistMeta = document.getElementById("todayChecklistMeta");

const summaryTotalHabits = document.getElementById("summaryTotalHabits");
const summaryDone = document.getElementById("summaryDone");
const summaryPending = document.getElementById("summaryPending");
const summaryRate = document.getElementById("summaryRate");
const summaryRateBar = document.getElementById("summaryRateBar");

const weekPrevBtn = document.getElementById("weekPrevBtn");
const weekNextBtn = document.getElementById("weekNextBtn");
const weekTodayBtn = document.getElementById("weekTodayBtn");
const weekRangeTitle = document.getElementById("weekRangeTitle");
const weekMatrix = document.getElementById("weekMatrix");

const detailEmpty = document.getElementById("detailEmpty");
const detailContent = document.getElementById("detailContent");
const statusCard = document.querySelector(".status-card");

const habitTitle = document.getElementById("habitTitle");
const commitmentLine = document.getElementById("commitmentLine");
const todayLabel = document.getElementById("todayLabel");
const dayProgress = document.getElementById("dayProgress");
const currentStreak = document.getElementById("currentStreak");
const bestStreak = document.getElementById("bestStreak");
const consistencyScore = document.getElementById("consistencyScore");
const last7Score = document.getElementById("last7Score");
const daysLeft = document.getElementById("daysLeft");
const nextMilestone = document.getElementById("nextMilestone");
const accountabilityNote = document.getElementById("accountabilityNote");

const doneBtn = document.getElementById("doneBtn");
const missBtn = document.getElementById("missBtn");
const resetBtn = document.getElementById("resetBtn");
const deleteHabitBtn = document.getElementById("deleteHabitBtn");
const exportBtn = document.getElementById("exportBtn");

const reminderTimeInput = document.getElementById("reminderTime");
const reminderToggleBtn = document.getElementById("reminderToggleBtn");
const reminderStatus = document.getElementById("reminderStatus");

const reflectionInput = document.getElementById("reflectionInput");
const reflectionMeta = document.getElementById("reflectionMeta");
const saveReflectionBtn = document.getElementById("saveReflectionBtn");

const timeline = document.getElementById("timeline");
const celebrationLayer = document.getElementById("celebrationLayer");
const reminderToast = document.getElementById("reminderToast");
const completionPulseTargets = [
  summaryDone,
  summaryPending,
  summaryRate,
  sidebarDone,
  sidebarPending,
  sidebarTotalHabits,
];
const COMPLETION_HIGHLIGHT_MS = 1800;
const COMPLETION_BURST_PARTICLES = 16;
const COMPLETION_COLORS = ["#14b87c", "#2fc1ff", "#1f7bda", "#1ed39b", "#f3c056"];

let state = {
  version: 3,
  activeHabitId: null,
  habits: [],
};

let currentView = "dashboard";
let calendarWeekOffset = 0;
let toastTimer = null;
let dbPromise = null;
let completionClearTimer = null;
let completionPulseTimer = null;
let completionState = {
  habitId: null,
  timestamp: 0,
};
const reminderTimers = new Map();

initEventListeners();

function initEventListeners() {
  navLinks.forEach((button) => {
    button.addEventListener("click", () => {
      setView(button.dataset.view || "dashboard");
    });
  });

  habitForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = habitNameInput.value.trim();
    const commitment = habitCommitmentInput.value.trim();
    const duration = Number(habitDurationInput.value);

    if (!name || !commitment || !duration) {
      return;
    }

    const habit = createHabit(name, commitment, duration);
    state.habits.unshift(habit);
    state.activeHabitId = habit.id;

    persistState();
    habitForm.reset();
    habitDurationInput.value = "30";

    setView("dashboard");
    render();
  });

  completeAllBtn.addEventListener("click", () => {
    markAllPendingDone();
  });

  weekPrevBtn.addEventListener("click", () => {
    calendarWeekOffset -= 1;
    renderCalendarBoard();
  });

  weekNextBtn.addEventListener("click", () => {
    calendarWeekOffset += 1;
    renderCalendarBoard();
  });

  weekTodayBtn.addEventListener("click", () => {
    calendarWeekOffset = 0;
    renderCalendarBoard();
  });

  doneBtn.addEventListener("click", (event) => {
    const habit = getActiveHabit();
    if (!habit) {
      return;
    }
    submitCheckinForHabit(habit.id, "done", "", event.currentTarget);
  });

  missBtn.addEventListener("click", () => {
    const habit = getActiveHabit();
    if (!habit) {
      return;
    }

    const reason = window.prompt(
      "What made you skip today, and what is your fix for tomorrow?",
      ""
    );

    if (reason === null) {
      return;
    }

    submitCheckinForHabit(habit.id, "missed", reason.trim());
  });

  saveReflectionBtn.addEventListener("click", () => {
    const habit = getActiveHabit();
    if (!habit) {
      return;
    }

    const progress = syncCalendarProgress(habit);
    if (!progress.inChallengeWindow) {
      return;
    }

    const day = habit.days[progress.todayIndex];
    if (!day) {
      return;
    }

    day.note = reflectionInput.value.trim();
    persistState();
    reflectionMeta.textContent = `Saved for Day ${progress.todayIndex + 1}.`;
    render();
  });

  reminderToggleBtn.addEventListener("click", async () => {
    const habit = getActiveHabit();
    if (!habit) {
      return;
    }

    if (!habit.reminder) {
      habit.reminder = { enabled: false, time: "20:00" };
    }

    if (!habit.reminder.enabled) {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch {
          // Ignore permission errors.
        }
      }
      habit.reminder.enabled = true;
    } else {
      habit.reminder.enabled = false;
    }

    persistState();
    render();
  });

  reminderTimeInput.addEventListener("change", () => {
    const habit = getActiveHabit();
    if (!habit) {
      return;
    }

    if (!habit.reminder) {
      habit.reminder = { enabled: false, time: "20:00" };
    }

    habit.reminder.time = reminderTimeInput.value || "20:00";
    persistState();
    render();
  });

  exportBtn.addEventListener("click", () => {
    const habit = getActiveHabit();
    if (!habit) {
      return;
    }
    exportProgressCSV(habit);
  });

  resetBtn.addEventListener("click", () => {
    const habit = getActiveHabit();
    if (!habit) {
      return;
    }

    const ok = window.confirm(`Reset progress for \"${habit.name}\"?`);
    if (!ok) {
      return;
    }

    habit.startDate = todayISO();
    habit.days = Array.from({ length: habit.duration }, () => ({
      status: "pending",
      note: "",
      checkedAt: null,
    }));

    persistState();
    render();
  });

  deleteHabitBtn.addEventListener("click", () => {
    const habit = getActiveHabit();
    if (!habit) {
      return;
    }

    const ok = window.confirm(`Delete habit \"${habit.name}\" permanently?`);
    if (!ok) {
      return;
    }

    state.habits = state.habits.filter((item) => item.id !== habit.id);
    state.activeHabitId = state.habits[0]?.id || null;

    persistState();
    render();
  });
}

function setView(viewName) {
  if (!views[viewName]) {
    return;
  }

  currentView = viewName;

  navLinks.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });

  Object.entries(views).forEach(([viewKey, node]) => {
    node.classList.toggle("hidden", viewKey !== currentView);
  });
}

function createHabit(name, commitment, duration) {
  return {
    id: createHabitId(),
    version: 2,
    name,
    commitment,
    duration,
    startDate: todayISO(),
    days: Array.from({ length: duration }, () => ({
      status: "pending",
      note: "",
      checkedAt: null,
    })),
    reminder: {
      enabled: false,
      time: "20:00",
    },
  };
}

function createHabitId() {
  return `habit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getActiveHabit() {
  if (!state.habits.length) {
    return null;
  }

  let habit = state.habits.find((item) => item.id === state.activeHabitId);
  if (!habit) {
    habit = state.habits[0];
    state.activeHabitId = habit.id;
    persistState();
  }

  return habit;
}

function setActiveHabit(habitId, goToDetail = false) {
  if (!state.habits.some((habit) => habit.id === habitId)) {
    return;
  }

  state.activeHabitId = habitId;
  persistState();

  if (goToDetail) {
    setView("detail");
  }

  render();
}

function submitCheckinForHabit(habitId, status, missedReason = "", triggerNode = null) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }

  const progress = syncCalendarProgress(habit);
  if (!progress.canCheckinToday) {
    render();
    return;
  }

  const day = habit.days[progress.todayIndex];
  if (!day || day.status !== "pending") {
    return;
  }

  day.status = status;
  day.checkedAt = todayISO();

  if (status === "missed" && missedReason) {
    day.note = `Missed reason: ${missedReason}`.slice(0, 220);
  }

  if (status === "done") {
    triggerCompletionFeedback(habit, triggerNode);
  }

  persistState();
  render();
}

function markAllPendingDone() {
  let changed = 0;

  state.habits.forEach((habit) => {
    const progress = syncCalendarProgress(habit);
    if (!progress.canCheckinToday) {
      return;
    }

    const day = habit.days[progress.todayIndex];
    if (!day || day.status !== "pending") {
      return;
    }

    day.status = "done";
    day.checkedAt = todayISO();
    changed += 1;
  });

  if (!changed) {
    return;
  }

  showToast(`${changed} habit${changed === 1 ? "" : "s"} marked done for today.`);
  persistState();
  render();
}

function render() {
  const changed = syncAllHabits();
  if (changed) {
    persistState();
  }

  renderSidebar();
  renderDashboard();
  renderCalendarBoard();
  renderDetailView();
  scheduleAllReminders();
}

function renderSidebar() {
  const summary = getTodaySummary();

  sidebarTotalHabits.textContent = String(state.habits.length);
  sidebarPending.textContent = String(summary.pending);
  sidebarDone.textContent = String(summary.done);

  sidebarHabits.innerHTML = "";

  if (!state.habits.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No habits yet.";
    sidebarHabits.appendChild(empty);
    return;
  }

  state.habits.forEach((habit) => {
    const progress = syncCalendarProgress(habit);
    const todayStatus = getTodayStatusLabel(habit, progress);
    const freshCompletion = isFreshCompletion(habit.id);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `side-habit${habit.id === state.activeHabitId ? " active" : ""}${freshCompletion ? " completion-flash" : ""}`;

    const name = document.createElement("p");
    name.className = "side-habit-name";
    name.textContent = habit.name;

    const meta = document.createElement("p");
    meta.className = "side-habit-meta";
    meta.textContent = `Today: ${todayStatus}`;

    button.appendChild(name);
    button.appendChild(meta);
    button.addEventListener("click", () => setActiveHabit(habit.id, true));

    sidebarHabits.appendChild(button);
  });
}

function renderDashboard() {
  todayBoardDate.textContent = `Today: ${formatDate(todayISO())}`;

  todayChecklist.innerHTML = "";

  const summary = getTodaySummary();
  summaryTotalHabits.textContent = String(summary.total);
  summaryDone.textContent = String(summary.done);
  summaryPending.textContent = String(summary.pending);

  const actionable = summary.done + summary.pending + summary.missed;
  const score = actionable === 0 ? 0 : Math.round((summary.done / actionable) * 100);
  summaryRate.textContent = `${score}%`;
  if (summaryRateBar) {
    summaryRateBar.style.width = `${score}%`;
  }

  completeAllBtn.disabled = summary.pending === 0;
  todayChecklistMeta.textContent = `${summary.done} done, ${summary.pending} pending, ${summary.missed} missed.`;

  if (!state.habits.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Add your first habit from the Add Habit tab.";
    todayChecklist.appendChild(empty);
    return;
  }

  state.habits.forEach((habit) => {
    const progress = syncCalendarProgress(habit);
    const attempts = habit.days.filter((entry) => entry.status !== "pending").length;
    const statusLabel = getTodayStatusLabel(habit, progress);
    const freshCompletion = isFreshCompletion(habit.id);

    const row = document.createElement("div");
    row.className = `today-row${freshCompletion ? " completion-flash" : ""}`;

    const main = document.createElement("div");
    main.className = "today-row-main";

    const title = document.createElement("h4");
    title.textContent = habit.name;

    const meta = document.createElement("p");
    meta.textContent = `Progress ${attempts}/${habit.duration} | ${statusLabel}`;

    main.appendChild(title);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "today-actions";

    if (progress.canCheckinToday) {
      const doneButton = document.createElement("button");
      doneButton.className = "mini-btn";
      doneButton.textContent = "Done";
      doneButton.addEventListener("click", (event) =>
        submitCheckinForHabit(habit.id, "done", "", event.currentTarget)
      );

      const missButton = document.createElement("button");
      missButton.className = "mini-btn";
      missButton.textContent = "Missed";
      missButton.addEventListener("click", () => {
        const reason = window.prompt(
          "What made you skip today, and what is your fix for tomorrow?",
          ""
        );

        if (reason === null) {
          return;
        }

        submitCheckinForHabit(habit.id, "missed", reason.trim());
      });

      actions.appendChild(doneButton);
      actions.appendChild(missButton);
    } else {
      const chip = document.createElement("span");
      chip.className = `status-chip ${toStatusClass(statusLabel)}`;
      chip.textContent = statusLabel;
      actions.appendChild(chip);
    }

    const detailButton = document.createElement("button");
    detailButton.className = "mini-btn";
    detailButton.textContent = "Open";
    detailButton.addEventListener("click", () => setActiveHabit(habit.id, true));
    actions.appendChild(detailButton);

    row.appendChild(main);
    row.appendChild(actions);
    todayChecklist.appendChild(row);
  });
}

function renderCalendarBoard() {
  weekMatrix.innerHTML = "";

  const weekDates = getWeekDates(calendarWeekOffset);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  weekRangeTitle.textContent = `${formatDate(weekStart)} - ${formatDate(weekEnd)}`;

  if (!state.habits.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No habits yet. Add one to see the calendar board.";
    weekMatrix.appendChild(empty);
    return;
  }

  const table = document.createElement("div");
  table.className = "week-table";

  const corner = document.createElement("div");
  corner.className = "week-cell header";
  corner.textContent = "Habit";
  table.appendChild(corner);

  weekDates.forEach((dateISO, idx) => {
    const head = document.createElement("div");
    head.className = "week-cell header";
    head.textContent = `${WEEKDAY_NAMES[idx]} ${shortDateNumber(dateISO)}`;
    table.appendChild(head);
  });

  state.habits.forEach((habit) => {
    const attempts = habit.days.filter((entry) => entry.status !== "pending").length;

    const habitCell = document.createElement("div");
    habitCell.className = "week-cell habit-name";

    const title = document.createElement("p");
    title.className = "week-habit-title";
    title.textContent = habit.name;

    const meta = document.createElement("p");
    meta.className = "week-habit-meta";
    meta.textContent = `${attempts}/${habit.duration} days`;

    habitCell.appendChild(title);
    habitCell.appendChild(meta);
    table.appendChild(habitCell);

    weekDates.forEach((dateISO) => {
      const day = getHabitDayOnDate(habit, dateISO);
      const cell = document.createElement("div");
      cell.className = "week-cell";

      const label = document.createElement("p");
      label.className = `week-status ${day.className}`;
      label.textContent = day.label;
      cell.appendChild(label);

      if (day.canActToday) {
        const actions = document.createElement("div");
        actions.className = "week-inline-actions";

        const doneButton = document.createElement("button");
        doneButton.className = "done";
        doneButton.textContent = "Done";
        doneButton.addEventListener("click", (event) =>
          submitCheckinForHabit(habit.id, "done", "", event.currentTarget)
        );

        const missButton = document.createElement("button");
        missButton.className = "miss";
        missButton.textContent = "Miss";
        missButton.addEventListener("click", () => {
          const reason = window.prompt(
            "What made you skip today, and what is your fix for tomorrow?",
            ""
          );

          if (reason === null) {
            return;
          }

          submitCheckinForHabit(habit.id, "missed", reason.trim());
        });

        actions.appendChild(doneButton);
        actions.appendChild(missButton);
        cell.appendChild(actions);
      }

      table.appendChild(cell);
    });
  });

  weekMatrix.appendChild(table);
}

function getHabitDayOnDate(habit, dateISO) {
  const offset = daysBetweenISO(habit.startDate, dateISO);
  const today = todayISO();

  if (offset < 0 || offset >= habit.duration) {
    return {
      label: "Out",
      className: "outside",
      canActToday: false,
    };
  }

  const status = habit.days[offset]?.status || "pending";
  const map = {
    done: "Done",
    missed: "Missed",
    pending: "Pending",
  };

  const canActToday = dateISO === today && status === "pending";

  return {
    label: map[status] || "Pending",
    className: status,
    canActToday,
  };
}

function renderDetailView() {
  const habit = getActiveHabit();
  if (!habit) {
    detailEmpty.classList.remove("hidden");
    detailContent.classList.add("hidden");
    if (statusCard) {
      statusCard.classList.remove("completion-flash");
    }
    return;
  }

  detailEmpty.classList.add("hidden");
  detailContent.classList.remove("hidden");

  const progress = syncCalendarProgress(habit);
  const statuses = habit.days.map((entry) => entry.status);
  const metrics = calculateMetrics(statuses);
  const finished = metrics.completed + metrics.missed >= habit.duration;
  const dayDisplay = progress.inChallengeWindow
    ? progress.todayIndex + 1
    : progress.todayOffset < 0
      ? 1
      : habit.duration;

  habitTitle.textContent = habit.name;
  commitmentLine.textContent = `Commitment: ${habit.commitment}`;
  todayLabel.textContent = `Today: ${formatDate(todayISO())} | Started: ${formatDate(habit.startDate)}`;

  dayProgress.textContent = `${dayDisplay}/${habit.duration}`;
  currentStreak.textContent = String(metrics.currentStreak);
  bestStreak.textContent = String(metrics.bestStreak);
  consistencyScore.textContent = `${Math.round(metrics.consistency)}%`;
  last7Score.textContent = `${Math.round(metrics.last7Consistency)}%`;
  daysLeft.textContent = String(Math.max(habit.duration - (progress.todayOffset + 1), 0));

  const canCheckin = progress.canCheckinToday && !finished;
  doneBtn.disabled = !canCheckin;
  missBtn.disabled = !canCheckin;
  if (statusCard) {
    statusCard.classList.toggle("completion-flash", isFreshCompletion(habit.id));
  }

  nextMilestone.textContent = buildMilestoneText(metrics.completed, habit.duration);
  accountabilityNote.textContent = buildAccountabilityNote(metrics, habit, progress, finished);

  renderReflection(habit, progress);
  renderReminderStatus(habit, progress);
  renderTimeline(habit.days, progress.todayIndex, progress.inChallengeWindow, habit.id);
}

function renderTimeline(days, todayIndex, inChallengeWindow, habitId) {
  timeline.innerHTML = "";

  days.forEach((entry, idx) => {
    const node = document.createElement("div");
    node.className = `day-pill ${entry.status}`;
    node.style.setProperty("--i", String(idx));

    if (inChallengeWindow && idx === todayIndex && entry.status === "pending") {
      node.classList.add("current");
    }
    if (inChallengeWindow && idx === todayIndex && entry.status === "done" && isFreshCompletion(habitId)) {
      node.classList.add("just-done");
    }

    if (entry.note) {
      node.classList.add("has-note");
    }

    node.title = `Day ${idx + 1}: ${entry.status}`;
    node.textContent = String(idx + 1);
    timeline.appendChild(node);
  });
}

function renderReflection(habit, progress) {
  const validDay = progress.inChallengeWindow && habit.days[progress.todayIndex];
  if (!validDay) {
    reflectionInput.value = "";
    reflectionInput.disabled = true;
    saveReflectionBtn.disabled = true;
    reflectionMeta.textContent = "Reflection is available while challenge days are active.";
    return;
  }

  const day = habit.days[progress.todayIndex];
  reflectionInput.disabled = false;
  saveReflectionBtn.disabled = false;
  reflectionInput.value = day.note || "";
  reflectionMeta.textContent = `Day ${progress.todayIndex + 1} reflection (${formatDate(addDaysISO(habit.startDate, progress.todayIndex))})`;
}

function renderReminderStatus(habit, progress) {
  if (!habit.reminder) {
    habit.reminder = { enabled: false, time: "20:00" };
  }

  reminderTimeInput.value = habit.reminder.time || "20:00";
  reminderToggleBtn.textContent = habit.reminder.enabled ? "Disable reminder" : "Enable reminder";

  if (!habit.reminder.enabled) {
    reminderStatus.textContent = "Reminder is off for this habit.";
    return;
  }

  if (!progress.inChallengeWindow) {
    reminderStatus.textContent = "Challenge window closed. Reminder paused.";
    return;
  }

  const mode =
    typeof Notification === "undefined" || Notification.permission !== "granted"
      ? "in-app reminder"
      : "browser notification";
  reminderStatus.textContent = `Reminder active at ${habit.reminder.time} (${mode}).`;
}

function triggerCompletionFeedback(habit, triggerNode) {
  completionState = {
    habitId: habit.id,
    timestamp: Date.now(),
  };

  if (completionClearTimer) {
    window.clearTimeout(completionClearTimer);
  }
  completionClearTimer = window.setTimeout(() => {
    completionState = { habitId: null, timestamp: 0 };
    render();
  }, COMPLETION_HIGHLIGHT_MS);

  const statuses = habit.days.map((entry) => entry.status);
  const metrics = calculateMetrics(statuses);
  const streak = metrics.currentStreak;
  showToast(
    `${habit.name} completed for today. ${streak > 0 ? `Streak: ${streak} day${streak === 1 ? "" : "s"}.` : ""}`
  );

  pulseSummaryMetrics();
  burstCelebration(triggerNode);
  tapPulse(triggerNode);

  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate([12, 34, 18]);
    } catch {
      // Ignore haptic failures.
    }
  }
}

function isFreshCompletion(habitId) {
  if (!habitId || completionState.habitId !== habitId) {
    return false;
  }
  return Date.now() - completionState.timestamp <= COMPLETION_HIGHLIGHT_MS;
}

function pulseSummaryMetrics() {
  completionPulseTargets.forEach((node) => {
    if (node) {
      node.classList.remove("metric-pulse");
      node.classList.add("metric-pulse");
    }
  });

  if (completionPulseTimer) {
    window.clearTimeout(completionPulseTimer);
  }
  completionPulseTimer = window.setTimeout(() => {
    completionPulseTargets.forEach((node) => node?.classList.remove("metric-pulse"));
  }, 760);
}

function tapPulse(node) {
  if (!(node instanceof HTMLElement)) {
    return;
  }
  node.classList.remove("tap-pulse");
  node.classList.add("tap-pulse");
  window.setTimeout(() => node.classList.remove("tap-pulse"), 420);
}

function burstCelebration(triggerNode) {
  if (!(triggerNode instanceof HTMLElement) || !celebrationLayer) {
    return;
  }

  const rect = triggerNode.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;

  for (let i = 0; i < COMPLETION_BURST_PARTICLES; i += 1) {
    const particle = document.createElement("span");
    const angle = (Math.PI * 2 * i) / COMPLETION_BURST_PARTICLES + Math.random() * 0.45;
    const distance = 30 + Math.random() * 58;
    const driftX = Math.cos(angle) * distance;
    const driftY = Math.sin(angle) * distance - (16 + Math.random() * 10);

    particle.className = "celebration-particle";
    particle.style.left = `${originX}px`;
    particle.style.top = `${originY}px`;
    particle.style.setProperty("--dx", `${driftX}px`);
    particle.style.setProperty("--dy", `${driftY}px`);
    particle.style.background = COMPLETION_COLORS[i % COMPLETION_COLORS.length];

    celebrationLayer.appendChild(particle);
    window.setTimeout(() => particle.remove(), 800);
  }
}

function getTodaySummary() {
  const summary = {
    total: state.habits.length,
    done: 0,
    pending: 0,
    missed: 0,
  };

  state.habits.forEach((habit) => {
    const progress = syncCalendarProgress(habit);
    if (!progress.inChallengeWindow) {
      return;
    }

    const status = habit.days[progress.todayIndex]?.status;
    if (status === "done") {
      summary.done += 1;
    } else if (status === "pending") {
      summary.pending += 1;
    } else if (status === "missed") {
      summary.missed += 1;
    }
  });

  return summary;
}

function getTodayStatusLabel(habit, progress) {
  if (!progress.inChallengeWindow) {
    return progress.todayOffset < 0 ? "not started" : "out of range";
  }

  const status = habit.days[progress.todayIndex]?.status || "pending";
  return status;
}

function toStatusClass(statusLabel) {
  if (statusLabel === "done") {
    return "done";
  }
  if (statusLabel === "missed") {
    return "missed";
  }
  if (statusLabel === "pending") {
    return "pending";
  }
  return "outside";
}

function scheduleAllReminders() {
  clearAllReminderTimers();
  state.habits.forEach((habit) => scheduleReminderForHabit(habit));
}

function scheduleReminderForHabit(habit) {
  if (!habit || !habit.id) {
    return;
  }

  clearReminderTimer(habit.id);

  if (!habit.reminder?.enabled) {
    return;
  }

  const progress = syncCalendarProgress(habit);
  if (progress.changed) {
    persistState();
  }

  if (!progress.inChallengeWindow) {
    return;
  }

  const nextReminder = getNextReminderDate(habit.reminder.time);
  const delay = Math.max(nextReminder.getTime() - Date.now(), 1000);

  const timerId = window.setTimeout(() => {
    fireReminder(habit.id);
  }, delay);

  reminderTimers.set(habit.id, timerId);
}

function clearReminderTimer(habitId) {
  const timerId = reminderTimers.get(habitId);
  if (timerId) {
    window.clearTimeout(timerId);
    reminderTimers.delete(habitId);
  }
}

function clearAllReminderTimers() {
  for (const timerId of reminderTimers.values()) {
    window.clearTimeout(timerId);
  }
  reminderTimers.clear();
}

function fireReminder(habitId) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }

  const progress = syncCalendarProgress(habit);
  if (progress.changed) {
    persistState();
  }

  if (progress.canCheckinToday) {
    const message = `${habit.name} | Day ${progress.todayIndex + 1}/${habit.duration}`;
    showToast(`Check-in due: ${message}`);

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Habit check-in reminder", {
          body: message,
        });
      } catch {
        // Ignore blocked notification errors.
      }
    }
  }

  scheduleReminderForHabit(habit);
}

function showToast(message) {
  reminderToast.textContent = message;
  reminderToast.classList.remove("hidden");
  reminderToast.classList.add("show");

  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    reminderToast.classList.remove("show");
    reminderToast.classList.add("hidden");
  }, 4300);
}

function calculateMetrics(statuses) {
  let completed = 0;
  let missed = 0;
  let current = 0;
  let best = 0;

  for (let i = 0; i < statuses.length; i += 1) {
    if (statuses[i] === "done") {
      completed += 1;
    }
    if (statuses[i] === "missed") {
      missed += 1;
    }
  }

  for (let i = statuses.length - 1; i >= 0; i -= 1) {
    if (statuses[i] === "done") {
      current += 1;
      continue;
    }
    if (statuses[i] === "pending") {
      continue;
    }
    break;
  }

  let streak = 0;
  for (let i = 0; i < statuses.length; i += 1) {
    if (statuses[i] === "done") {
      streak += 1;
      best = Math.max(best, streak);
    } else if (statuses[i] === "missed") {
      streak = 0;
    }
  }

  const attempts = completed + missed;
  const consistency = attempts === 0 ? 0 : (completed / attempts) * 100;

  const recent = statuses.slice(-7);
  const recentAttempts = recent.filter((value) => value !== "pending").length;
  const recentDone = recent.filter((value) => value === "done").length;
  const last7Consistency = recentAttempts === 0 ? 0 : (recentDone / recentAttempts) * 100;

  return {
    completed,
    missed,
    currentStreak: current,
    bestStreak: best,
    consistency,
    last7Consistency,
  };
}

function buildMilestoneText(completed, duration) {
  const nextMilestone = MILESTONES.find((target) => target > completed && target <= duration);
  if (!nextMilestone) {
    return `Milestone complete: ${completed}/${duration} successful days.`;
  }

  const remaining = nextMilestone - completed;
  return `Next milestone: ${nextMilestone} successful days (${remaining} to go).`;
}

function buildAccountabilityNote(metrics, habit, progress, finished) {
  if (finished) {
    const verdict =
      metrics.consistency >= 85
        ? "Excellent lock-in. Start your next level challenge immediately."
        : "Decent finish. Tighten your routine and run another cycle.";
    return `Challenge complete: ${metrics.completed}/${habit.duration} successful days. ${verdict}`;
  }

  if (!progress.inChallengeWindow) {
    return "Challenge has not started yet. Prepare your environment and remove friction today.";
  }

  if (progress.canCheckinToday) {
    if (metrics.missed === 0 && metrics.completed > 0) {
      return `Strong run. Protect your ${metrics.currentStreak}-day streak today.`;
    }
    return "Today is still open. One decision now keeps momentum alive.";
  }

  const todayStatus = habit.days[progress.todayIndex]?.status;
  if (todayStatus === "done") {
    return "Check-in complete for today. Execute again tomorrow without negotiation.";
  }

  if (todayStatus === "missed") {
    return "Today was missed. Recovery starts tomorrow with a non-negotiable check-in.";
  }

  return "Stay consistent. The next 24 hours decide your trajectory.";
}

function syncAllHabits() {
  let changedAny = false;

  state.habits.forEach((habit) => {
    const progress = syncCalendarProgress(habit);
    if (progress.changed) {
      changedAny = true;
    }
  });

  return changedAny;
}

function syncCalendarProgress(habit) {
  const today = todayISO();
  const todayOffset = daysBetweenISO(habit.startDate, today);
  const todayIndex = Math.min(Math.max(todayOffset, 0), habit.duration - 1);

  const cutoff = Math.min(Math.max(todayOffset, 0), habit.duration);
  let changed = false;

  for (let i = 0; i < cutoff; i += 1) {
    if (habit.days[i].status === "pending") {
      habit.days[i].status = "missed";
      habit.days[i].checkedAt = addDaysISO(habit.startDate, i);
      changed = true;
    }
  }

  return {
    todayOffset,
    todayIndex,
    inChallengeWindow: todayOffset >= 0 && todayOffset < habit.duration,
    canCheckinToday:
      todayOffset >= 0 &&
      todayOffset < habit.duration &&
      habit.days[todayIndex]?.status === "pending",
    changed,
  };
}

function exportProgressCSV(habit) {
  const rows = ["habit,day,date,status,note,checked_at"];

  habit.days.forEach((entry, index) => {
    const date = addDaysISO(habit.startDate, index);
    rows.push(
      [
        escapeCSV(habit.name),
        index + 1,
        date,
        entry.status,
        escapeCSV(entry.note || ""),
        entry.checkedAt || "",
      ].join(",")
    );
  });

  const csv = rows.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(habit.name)}-progress.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getWeekDates(weekOffset) {
  const base = startOfWeek(todayISO());
  const shifted = addDaysISO(base, weekOffset * 7);
  const dates = [];

  for (let i = 0; i < 7; i += 1) {
    dates.push(addDaysISO(shifted, i));
  }

  return dates;
}

function startOfWeek(dateISO) {
  const [year, month, day] = dateISO.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const current = date.getDay();
  const mondayOffset = (current + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function shortDateNumber(dateISO) {
  const [, , day] = dateISO.split("-").map(Number);
  return String(day);
}

function getNextReminderDate(timeValue) {
  const [rawHour, rawMinute] = (timeValue || "20:00").split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);

  const now = new Date();
  const next = new Date();
  next.setHours(Number.isFinite(hour) ? hour : 20, Number.isFinite(minute) ? minute : 0, 0, 0);

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

function daysBetweenISO(startISO, endISO) {
  const start = isoToUTC(startISO);
  const end = isoToUTC(endISO);
  return Math.floor((end - start) / MS_IN_DAY);
}

function addDaysISO(dateISO, days) {
  const base = isoToUTC(dateISO);
  const next = new Date(base + days * MS_IN_DAY);
  return toISODateUTC(next);
}

function isoToUTC(dateISO) {
  const [year, month, day] = dateISO.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function toISODateUTC(dateObj) {
  return dateObj.toISOString().split("T")[0];
}

function formatDate(dateISO) {
  const [year, month, day] = dateISO.split("-").map(Number);
  const localDate = new Date(year, month - 1, day);
  return localDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function escapeCSV(value) {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function persistState() {
  void saveState(state);
}

async function saveState(newState) {
  try {
    if (!newState) {
      await idbDelete(STATE_KEY);
      clearLegacyState();
      return;
    }

    await idbSet(STATE_KEY, newState);
    clearLegacyState();
  } catch {
    // Ignore persistence errors for this session.
  }
}

async function loadState() {
  try {
    const stored = await idbGet(STATE_KEY);
    if (stored) {
      return normalizeState(stored);
    }
  } catch {
    // Fallback below.
  }

  const legacyState = readLegacyState();
  if (legacyState) {
    const normalizedLegacy = normalizeState(legacyState);
    if (normalizedLegacy) {
      await saveState(normalizedLegacy);
      return normalizedLegacy;
    }
  }

  return {
    version: 3,
    activeHabitId: null,
    habits: [],
  };
}

function normalizeState(parsed) {
  if (!parsed) {
    return {
      version: 3,
      activeHabitId: null,
      habits: [],
    };
  }

  if (Array.isArray(parsed.habits)) {
    const habits = parsed.habits
      .map((habit) => normalizeHabit(habit))
      .filter((habit) => Boolean(habit));

    const activeHabitId = habits.some((habit) => habit.id === parsed.activeHabitId)
      ? parsed.activeHabitId
      : habits[0]?.id || null;

    return {
      version: 3,
      activeHabitId,
      habits,
    };
  }

  const singleHabit = normalizeHabit(parsed);
  if (!singleHabit) {
    return {
      version: 3,
      activeHabitId: null,
      habits: [],
    };
  }

  return {
    version: 3,
    activeHabitId: singleHabit.id,
    habits: [singleHabit],
  };
}

function normalizeHabit(rawHabit) {
  if (!rawHabit || !rawHabit.name || !Array.isArray(rawHabit.days)) {
    return null;
  }

  const duration = Number(rawHabit.duration) || rawHabit.days.length;
  const startDate = rawHabit.startDate || rawHabit.createdAt || todayISO();

  const days = rawHabit.days.map((entry) => {
    if (typeof entry === "string") {
      return {
        status: entry,
        note: "",
        checkedAt: null,
      };
    }

    return {
      status: entry.status || "pending",
      note: entry.note || "",
      checkedAt: entry.checkedAt || null,
    };
  });

  while (days.length < duration) {
    days.push({ status: "pending", note: "", checkedAt: null });
  }

  return {
    id: rawHabit.id || createHabitId(),
    version: 2,
    name: rawHabit.name,
    commitment: rawHabit.commitment || "I will show up daily.",
    duration,
    startDate,
    days: days.slice(0, duration),
    reminder: {
      enabled: Boolean(rawHabit.reminder?.enabled),
      time: rawHabit.reminder?.time || "20:00",
    },
  };
}

function readLegacyState() {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch {
    return null;
  }

  return null;
}

function clearLegacyState() {
  try {
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore localStorage access issues.
  }
}

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB();
  }
  return dbPromise;
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error("Failed to open IndexedDB."));
    };
  });
}

async function idbGet(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Failed to read from IndexedDB."));
  });
}

async function idbSet(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to write to IndexedDB."));

    store.put(value, key);
  });
}

async function idbDelete(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to delete from IndexedDB."));

    store.delete(key);
  });
}

async function init() {
  state = await loadState();
  setView(currentView);
  render();
  registerServiceWorker();
}

void init();

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // App works without offline cache if registration fails.
    });
  });
}
