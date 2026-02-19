const LEGACY_STORAGE_KEYS = ["habit-momentum-v2", "habit-momentum-v1"];
const DB_NAME = "habit-momentum-db";
const DB_VERSION = 1;
const STORE_NAME = "habit_store";
const STATE_KEY = "current_state";
const MS_IN_DAY = 86400000;
const MILESTONES = [3, 7, 14, 21, 30, 45, 60];

const habitForm = document.getElementById("habitForm");
const habitNameInput = document.getElementById("habitName");
const habitCommitmentInput = document.getElementById("habitCommitment");
const habitDurationInput = document.getElementById("habitDuration");
const setupCard = document.getElementById("setupCard");
const dashboard = document.getElementById("dashboard");

const habitCount = document.getElementById("habitCount");
const overviewText = document.getElementById("overviewText");
const habitsList = document.getElementById("habitsList");

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
const timeline = document.getElementById("timeline");

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

const reminderToast = document.getElementById("reminderToast");

let state = {
  version: 3,
  activeHabitId: null,
  habits: [],
};

let toastTimer = null;
let dbPromise = null;
const reminderTimers = new Map();

habitForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = habitNameInput.value.trim();
  const commitment = habitCommitmentInput.value.trim();
  const duration = Number(habitDurationInput.value);

  if (!name || !commitment || !duration) {
    return;
  }

  const newHabit = createHabit(name, commitment, duration);
  state.habits.unshift(newHabit);
  state.activeHabitId = newHabit.id;

  persistState();
  habitForm.reset();
  habitDurationInput.value = "30";
  render();
});

doneBtn.addEventListener("click", () => {
  submitCheckin("done");
});

missBtn.addEventListener("click", () => {
  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    return;
  }

  const reason = window.prompt(
    "What made you skip today, and what is your fix for tomorrow?",
    ""
  );

  if (reason === null) {
    return;
  }

  submitCheckin("missed", reason.trim());
});

saveReflectionBtn.addEventListener("click", () => {
  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    return;
  }

  const progress = syncCalendarProgress(activeHabit);
  if (!progress.inChallengeWindow) {
    return;
  }

  const day = activeHabit.days[progress.todayIndex];
  if (!day) {
    return;
  }

  day.note = reflectionInput.value.trim();
  persistState();
  reflectionMeta.textContent = `Saved for Day ${progress.todayIndex + 1}.`;
  renderTimeline(activeHabit.days, progress.todayIndex, progress.inChallengeWindow);
  renderHabitList();
});

reminderToggleBtn.addEventListener("click", async () => {
  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    return;
  }

  if (!activeHabit.reminder) {
    activeHabit.reminder = { enabled: false, time: "20:00" };
  }

  if (!activeHabit.reminder.enabled) {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Ignore permission errors and continue with in-app reminder.
      }
    }
    activeHabit.reminder.enabled = true;
  } else {
    activeHabit.reminder.enabled = false;
  }

  persistState();
  render();
});

reminderTimeInput.addEventListener("change", () => {
  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    return;
  }

  if (!activeHabit.reminder) {
    activeHabit.reminder = { enabled: false, time: "20:00" };
  }

  activeHabit.reminder.time = reminderTimeInput.value || "20:00";
  persistState();
  render();
});

exportBtn.addEventListener("click", () => {
  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    return;
  }

  exportProgressCSV(activeHabit);
});

resetBtn.addEventListener("click", () => {
  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    return;
  }

  const ok = window.confirm(`Reset progress for \"${activeHabit.name}\"?`);
  if (!ok) {
    return;
  }

  activeHabit.startDate = todayISO();
  activeHabit.days = Array.from({ length: activeHabit.duration }, () => ({
    status: "pending",
    note: "",
    checkedAt: null,
  }));

  persistState();
  render();
});

deleteHabitBtn.addEventListener("click", () => {
  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    return;
  }

  const ok = window.confirm(`Delete habit \"${activeHabit.name}\" permanently?`);
  if (!ok) {
    return;
  }

  state.habits = state.habits.filter((habit) => habit.id !== activeHabit.id);
  if (state.activeHabitId === activeHabit.id) {
    state.activeHabitId = state.habits[0]?.id || null;
  }

  persistState();
  render();
});

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

  let activeHabit = state.habits.find((habit) => habit.id === state.activeHabitId);
  if (!activeHabit) {
    activeHabit = state.habits[0];
    state.activeHabitId = activeHabit.id;
    persistState();
  }

  return activeHabit;
}

function setActiveHabit(habitId) {
  if (state.activeHabitId === habitId) {
    return;
  }

  state.activeHabitId = habitId;
  persistState();
  render();
}

function submitCheckin(status, missedReason = "") {
  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    return;
  }

  const progress = syncCalendarProgress(activeHabit);
  if (!progress.canCheckinToday) {
    render();
    return;
  }

  const day = activeHabit.days[progress.todayIndex];
  if (!day || day.status !== "pending") {
    return;
  }

  day.status = status;
  day.checkedAt = todayISO();

  if (status === "missed" && missedReason) {
    day.note = `Missed reason: ${missedReason}`.slice(0, 220);
  }

  persistState();
  render();
}

function render() {
  setupCard.classList.remove("hidden");

  const changedAny = syncAllHabits();
  if (changedAny) {
    persistState();
  }

  if (!state.habits.length) {
    dashboard.classList.add("hidden");
    clearAllReminderTimers();
    return;
  }

  dashboard.classList.remove("hidden");

  const activeHabit = getActiveHabit();
  if (!activeHabit) {
    dashboard.classList.add("hidden");
    clearAllReminderTimers();
    return;
  }

  const progress = syncCalendarProgress(activeHabit);
  const statuses = activeHabit.days.map((entry) => entry.status);
  const metrics = calculateMetrics(statuses);
  const finished = metrics.completed + metrics.missed >= activeHabit.duration;
  const dayDisplay = progress.inChallengeWindow
    ? progress.todayIndex + 1
    : progress.todayOffset < 0
      ? 1
      : activeHabit.duration;

  habitTitle.textContent = activeHabit.name;
  commitmentLine.textContent = `Commitment: ${activeHabit.commitment}`;
  todayLabel.textContent = `Today: ${formatDate(todayISO())} | Started: ${formatDate(activeHabit.startDate)}`;

  dayProgress.textContent = `${dayDisplay}/${activeHabit.duration}`;
  currentStreak.textContent = String(metrics.currentStreak);
  bestStreak.textContent = String(metrics.bestStreak);
  consistencyScore.textContent = `${Math.round(metrics.consistency)}%`;
  last7Score.textContent = `${Math.round(metrics.last7Consistency)}%`;
  daysLeft.textContent = String(Math.max(activeHabit.duration - (progress.todayOffset + 1), 0));

  const canCheckinToday = progress.canCheckinToday && !finished;
  doneBtn.disabled = !canCheckinToday;
  missBtn.disabled = !canCheckinToday;

  nextMilestone.textContent = buildMilestoneText(metrics.completed, activeHabit.duration);
  accountabilityNote.textContent = buildAccountabilityNote(metrics, activeHabit, progress, finished);

  renderHabitList();
  renderOverview();
  renderTimeline(activeHabit.days, progress.todayIndex, progress.inChallengeWindow);
  renderReflection(activeHabit, progress);
  renderReminderStatus(activeHabit, progress);
  scheduleAllReminders();
}

function renderHabitList() {
  habitsList.innerHTML = "";

  state.habits.forEach((habit) => {
    const progress = syncCalendarProgress(habit);
    const attempts = habit.days.filter((entry) => entry.status !== "pending").length;
    const statusLabel = progress.inChallengeWindow
      ? habit.days[progress.todayIndex]?.status || "pending"
      : progress.todayOffset < 0
        ? "not started"
        : "complete";

    const item = document.createElement("button");
    item.type = "button";
    item.className = `habit-item${habit.id === state.activeHabitId ? " active" : ""}`;

    const title = document.createElement("p");
    title.className = "habit-item-title";
    title.textContent = habit.name;

    const meta = document.createElement("p");
    meta.className = "habit-item-meta";
    meta.textContent = `Progress ${attempts}/${habit.duration} | Today: ${statusLabel}`;

    item.appendChild(title);
    item.appendChild(meta);
    item.addEventListener("click", () => setActiveHabit(habit.id));

    habitsList.appendChild(item);
  });
}

function renderOverview() {
  const total = state.habits.length;
  const todayPending = state.habits.filter((habit) => {
    const progress = syncCalendarProgress(habit);
    return progress.canCheckinToday;
  }).length;

  const todayDone = state.habits.filter((habit) => {
    const progress = syncCalendarProgress(habit);
    if (!progress.inChallengeWindow) {
      return false;
    }
    return habit.days[progress.todayIndex]?.status === "done";
  }).length;

  habitCount.textContent = `${total} habit${total === 1 ? "" : "s"}`;
  overviewText.textContent = `Today: ${todayDone} done, ${todayPending} pending check-ins.`;
}

function renderTimeline(days, todayIndex, inChallengeWindow) {
  timeline.innerHTML = "";

  days.forEach((entry, index) => {
    const dayNode = document.createElement("div");
    dayNode.className = `day-pill ${entry.status}`;

    if (inChallengeWindow && index === todayIndex && entry.status === "pending") {
      dayNode.classList.add("current");
    }

    if (entry.note) {
      dayNode.classList.add("has-note");
    }

    const noteSnippet = entry.note ? ` | Note: ${entry.note.slice(0, 60)}` : "";
    dayNode.title = `Day ${index + 1}: ${entry.status}${noteSnippet}`;
    dayNode.textContent = String(index + 1);
    timeline.appendChild(dayNode);
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

function scheduleAllReminders() {
  clearAllReminderTimers();

  state.habits.forEach((habit) => {
    scheduleReminderForHabit(habit);
  });
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
        // Some environments block notifications silently.
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
  }, 4500);
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
    // Silent fail: UI still works in-memory for this session.
  }
}

async function loadState() {
  try {
    const stored = await idbGet(STATE_KEY);
    if (stored) {
      return normalizeState(stored);
    }
  } catch {
    // Try legacy fallback below.
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
      // App works without offline caching if registration fails.
    });
  });
}
