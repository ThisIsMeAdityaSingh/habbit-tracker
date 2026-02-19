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
const exportBtn = document.getElementById("exportBtn");

const reminderTimeInput = document.getElementById("reminderTime");
const reminderToggleBtn = document.getElementById("reminderToggleBtn");
const reminderStatus = document.getElementById("reminderStatus");

const reflectionInput = document.getElementById("reflectionInput");
const reflectionMeta = document.getElementById("reflectionMeta");
const saveReflectionBtn = document.getElementById("saveReflectionBtn");

const reminderToast = document.getElementById("reminderToast");

let state = null;
let reminderTimer = null;
let toastTimer = null;
let dbPromise = null;

habitForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = habitNameInput.value.trim();
  const commitment = habitCommitmentInput.value.trim();
  const duration = Number(habitDurationInput.value);

  if (!name || !commitment || !duration) {
    return;
  }

  state = {
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

  persistState();
  render();
});

doneBtn.addEventListener("click", () => {
  submitCheckin("done");
});

missBtn.addEventListener("click", () => {
  if (!state) {
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
  if (!state) {
    return;
  }

  const progress = syncCalendarProgress(state);
  if (!progress.canCheckinToday && !progress.inChallengeWindow) {
    return;
  }

  const day = state.days[progress.todayIndex];
  if (!day) {
    return;
  }

  day.note = reflectionInput.value.trim();
  persistState();
  reflectionMeta.textContent = `Saved for Day ${progress.todayIndex + 1}.`;
  renderTimeline(state.days, progress.todayIndex, progress.inChallengeWindow);
});

reminderToggleBtn.addEventListener("click", async () => {
  if (!state) {
    return;
  }

  if (!state.reminder) {
    state.reminder = { enabled: false, time: "20:00" };
  }

  if (!state.reminder.enabled) {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Ignore permission errors and continue with in-app reminder.
      }
    }
    state.reminder.enabled = true;
  } else {
    state.reminder.enabled = false;
  }

  persistState();
  render();
});

reminderTimeInput.addEventListener("change", () => {
  if (!state) {
    return;
  }

  if (!state.reminder) {
    state.reminder = { enabled: false, time: "20:00" };
  }

  state.reminder.time = reminderTimeInput.value || "20:00";
  persistState();

  const progress = syncCalendarProgress(state);
  renderReminderStatus(progress);
  scheduleReminder(progress);
});

exportBtn.addEventListener("click", () => {
  if (!state) {
    return;
  }
  exportProgressCSV(state);
});

resetBtn.addEventListener("click", () => {
  const ok = window.confirm("Reset your current challenge? This will clear all progress.");
  if (!ok) {
    return;
  }

  state = null;
  persistState();
  clearReminderTimer();
  render();
});

function submitCheckin(status, missedReason = "") {
  if (!state) {
    return;
  }

  const progress = syncCalendarProgress(state);
  if (!progress.canCheckinToday) {
    render();
    return;
  }

  const day = state.days[progress.todayIndex];
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
  if (!state) {
    setupCard.classList.remove("hidden");
    dashboard.classList.add("hidden");
    habitForm.reset();
    habitDurationInput.value = "30";
    clearReminderTimer();
    return;
  }

  const progress = syncCalendarProgress(state);
  if (progress.changed) {
    persistState();
  }

  setupCard.classList.add("hidden");
  dashboard.classList.remove("hidden");

  const statuses = state.days.map((entry) => entry.status);
  const metrics = calculateMetrics(statuses);
  const finished = metrics.completed + metrics.missed >= state.duration;
  const dayDisplay = progress.inChallengeWindow
    ? progress.todayIndex + 1
    : progress.todayOffset < 0
      ? 1
      : state.duration;

  habitTitle.textContent = state.name;
  commitmentLine.textContent = `Commitment: ${state.commitment}`;
  todayLabel.textContent = `Today: ${formatDate(todayISO())} | Started: ${formatDate(state.startDate)}`;

  dayProgress.textContent = `${dayDisplay}/${state.duration}`;
  currentStreak.textContent = String(metrics.currentStreak);
  bestStreak.textContent = String(metrics.bestStreak);
  consistencyScore.textContent = `${Math.round(metrics.consistency)}%`;
  last7Score.textContent = `${Math.round(metrics.last7Consistency)}%`;
  daysLeft.textContent = String(Math.max(state.duration - (progress.todayOffset + 1), 0));

  const canCheckinToday = progress.canCheckinToday && !finished;
  doneBtn.disabled = !canCheckinToday;
  missBtn.disabled = !canCheckinToday;

  nextMilestone.textContent = buildMilestoneText(metrics.completed, state.duration);
  accountabilityNote.textContent = buildAccountabilityNote(metrics, state, progress, finished);

  renderTimeline(state.days, progress.todayIndex, progress.inChallengeWindow);
  renderReflection(progress);
  renderReminderStatus(progress);
  scheduleReminder(progress);
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

function renderReflection(progress) {
  const validDay = progress.inChallengeWindow && state.days[progress.todayIndex];
  if (!validDay) {
    reflectionInput.value = "";
    reflectionInput.disabled = true;
    saveReflectionBtn.disabled = true;
    reflectionMeta.textContent = "Reflection is available while challenge days are active.";
    return;
  }

  const day = state.days[progress.todayIndex];
  reflectionInput.disabled = false;
  saveReflectionBtn.disabled = false;
  reflectionInput.value = day.note || "";
  reflectionMeta.textContent = `Day ${progress.todayIndex + 1} reflection (${formatDate(addDaysISO(state.startDate, progress.todayIndex))})`;
}

function renderReminderStatus(progress) {
  if (!state.reminder) {
    state.reminder = { enabled: false, time: "20:00" };
  }

  reminderTimeInput.value = state.reminder.time || "20:00";
  reminderToggleBtn.textContent = state.reminder.enabled ? "Disable reminder" : "Enable reminder";

  if (!state.reminder.enabled) {
    reminderStatus.textContent = "Reminder is off.";
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
  reminderStatus.textContent = `Reminder active at ${state.reminder.time} (${mode}).`;
}

function scheduleReminder(progress) {
  clearReminderTimer();

  if (!state || !state.reminder || !state.reminder.enabled) {
    return;
  }

  if (!progress.inChallengeWindow) {
    return;
  }

  const nextReminder = getNextReminderDate(state.reminder.time);
  const delay = Math.max(nextReminder.getTime() - Date.now(), 1000);

  reminderTimer = window.setTimeout(() => {
    fireReminder();
    scheduleReminder(syncCalendarProgress(state));
  }, delay);
}

function fireReminder() {
  if (!state) {
    return;
  }

  const progress = syncCalendarProgress(state);
  if (!progress.canCheckinToday) {
    return;
  }

  const message = `Day ${progress.todayIndex + 1}/${state.duration}: ${state.name}`;

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

function clearReminderTimer() {
  if (reminderTimer) {
    window.clearTimeout(reminderTimer);
    reminderTimer = null;
  }
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
  const recentAttempts = recent.filter((v) => v !== "pending").length;
  const recentDone = recent.filter((v) => v === "done").length;
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

function buildAccountabilityNote(metrics, habitState, progress, finished) {
  if (finished) {
    const verdict =
      metrics.consistency >= 85
        ? "Excellent lock-in. Start your next level challenge immediately."
        : "Decent finish. Tighten your routine and run another cycle.";
    return `Challenge complete: ${metrics.completed}/${habitState.duration} successful days. ${verdict}`;
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

  const todayStatus = habitState.days[progress.todayIndex]?.status;
  if (todayStatus === "done") {
    return "Check-in complete for today. Execute again tomorrow without negotiation.";
  }

  if (todayStatus === "missed") {
    return "Today was missed. Recovery starts tomorrow with a non-negotiable check-in.";
  }

  return "Stay consistent. The next 24 hours decide your trajectory.";
}

function syncCalendarProgress(habitState) {
  const today = todayISO();
  const todayOffset = daysBetweenISO(habitState.startDate, today);
  const todayIndex = Math.min(Math.max(todayOffset, 0), habitState.duration - 1);

  const cutoff = Math.min(Math.max(todayOffset, 0), habitState.duration);
  let changed = false;

  for (let i = 0; i < cutoff; i += 1) {
    if (habitState.days[i].status === "pending") {
      habitState.days[i].status = "missed";
      habitState.days[i].checkedAt = addDaysISO(habitState.startDate, i);
      changed = true;
    }
  }

  return {
    todayOffset,
    todayIndex,
    inChallengeWindow: todayOffset >= 0 && todayOffset < habitState.duration,
    canCheckinToday:
      todayOffset >= 0 &&
      todayOffset < habitState.duration &&
      habitState.days[todayIndex]?.status === "pending",
    changed,
  };
}

function exportProgressCSV(habitState) {
  const rows = ["day,date,status,note,checked_at"];

  habitState.days.forEach((entry, index) => {
    const date = addDaysISO(habitState.startDate, index);
    rows.push(
      [
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
  anchor.download = `${slugify(habitState.name)}-progress.csv`;
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

  return null;
}

function normalizeState(parsed) {
  if (!parsed || !parsed.name || !Array.isArray(parsed.days)) {
    return null;
  }

  const duration = Number(parsed.duration) || parsed.days.length;
  const startDate = parsed.startDate || parsed.createdAt || todayISO();

  const days = parsed.days.map((entry) => {
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
    version: 2,
    name: parsed.name,
    commitment: parsed.commitment || "I will show up daily.",
    duration,
    startDate,
    days: days.slice(0, duration),
    reminder: {
      enabled: Boolean(parsed.reminder?.enabled),
      time: parsed.reminder?.time || "20:00",
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
}

void init();
