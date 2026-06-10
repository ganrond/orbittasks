// Generate Unique ID
const generateId = () => '_' + Math.random().toString(36).substr(2, 9);

// Default state if user has none
const defaultProjects = [{ id: 'p_default', name: 'My Tasks' }];
const defaultTemplates = [
    { id: 't_grocery', name: 'Grocery Run', tasks: ['Apples', 'Milk', 'Bread', 'Eggs'] },
    { id: 't_work', name: 'Work Project', tasks: ['Review specs', 'Write code', 'Test feature'] }
];

// State Initialization
let projects = [];
try {
    const parsed = JSON.parse(localStorage.getItem('arcforgeProjects'));
    if (Array.isArray(parsed) && parsed.length > 0) projects = parsed;
} catch(e) {}

let templates = [];
try {
    const parsed = JSON.parse(localStorage.getItem('arcforgeTemplates'));
    if (Array.isArray(parsed)) templates = parsed;
} catch(e) {}

let tasks = [];
try {
    const parsed = JSON.parse(localStorage.getItem('arcforgeTasks'));
    if (Array.isArray(parsed)) tasks = parsed;
} catch(e) {}

if (projects.length === 0) projects = [...defaultProjects];
if (templates.length === 0) templates = [...defaultTemplates];

// Backward compat: ensure all tasks and projects have required fields
tasks    = tasks.map((t, i) => ({
    priority:     null,
    dueDate:      null,
    notes:        '',
    completedAt:  null,
    order:        i,
    recurring:    false,
    recurringDay: null,
    archived:     false,
    energy:       null,
    subtasks:     [],
    ...t,
    projectId: t.projectId || projects[0]?.id
}));
projects = projects.map((p, i) => ({ archived: false, order: i, ...p }));

let currentProjectId = localStorage.getItem('arcforgeCurrentProject') || projects[0]?.id;
let currentFilter = 'all';
let currentContextFilter = null; // null | 'deep-work' | 'quick-win'
let currentRecurringFilter = null; // null | 'recurring' | 'monday' ... 'sunday'
let currentEnergyFilter = null; // null | 'high' | 'low'
let currentSort = 'custom';
let isTodayView = false;

// Weekly Planning state
let weeklyTaskIds = [];
try {
    const parsed = JSON.parse(localStorage.getItem('arcforgeWeeklyTaskIds'));
    if (Array.isArray(parsed)) weeklyTaskIds = parsed;
} catch(e) {}

// Daily Check-In log: [{ date: 'YYYY-MM-DD', topTask: string, completedYesterday: string }]
let checkInLog = [];
try {
    const parsed = JSON.parse(localStorage.getItem('arcforgeCheckInLog'));
    if (Array.isArray(parsed)) checkInLog = parsed;
} catch(e) {}

let currentTheme = localStorage.getItem('arcforgeTheme') || 'default';

// Pomodoro duration (in seconds), default 25 min, persisted
let pomodoroDuration = parseInt(localStorage.getItem('arcforgePomodoroDuration') || '1500', 10);

// Initialize Supabase connection (returns false if credentials not filled)
const dbEnabled = (typeof initDB === 'function') ? initDB() : false;

// Guard: prevent empty local state from overwriting Supabase before cloud data is fetched.
// Set to true (a) when Supabase is disabled, or (b) after init() completes its cloud load.
let _cloudDataReady = !dbEnabled;

let activeTimerTaskId = null;
let timerInterval = null;
let timeRemaining = pomodoroDuration;

// Selected priority / context / energy for new tasks
let selectedPriority = '';
let selectedContext  = '';
let selectedEnergy   = '';

// Drag state
let dragSrcId = null;
let dragSrcProjectId = null;

// DOM Elements
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
const closeSidebarBtn = document.getElementById('close-sidebar');

const projectListEl = document.getElementById('project-list');

const currentProjectTitle = document.getElementById('current-project-title');
const deleteProjectBtn = document.getElementById('delete-project-btn');
const completeAllBtn = document.getElementById('complete-all-btn');
const clearCompletedBtn = document.getElementById('clear-completed-btn');

const taskForm = document.getElementById('task-form');
const taskInput = document.getElementById('task-input');
const taskList = document.getElementById('task-list');
const voiceBtn = document.getElementById('voice-btn');

const pendingCountEl = document.getElementById('pending-count');
const completedCountEl = document.getElementById('completed-count');
const globalTimerEl = document.getElementById('global-timer');
const timerDisplayEl = document.getElementById('timer-display');
const restartTimerBtn = document.getElementById('restart-timer-btn');

const filterBtns = document.querySelectorAll('.filter-btn');
const sortSelect = document.getElementById('sort-select');
const emptyState = document.getElementById('empty-state');

// History View Elements
const workspaceView  = document.getElementById('workspace-view');
const historyView    = document.getElementById('history-view');
const weeklyView     = document.getElementById('weekly-view');
const streaksView    = document.getElementById('streaks-view');
const shelfView      = document.getElementById('shelf-view');
const goalsView      = document.getElementById('goals-view');
const pipelineView   = document.getElementById('pipeline-view');
const navHistoryBtn = document.getElementById('nav-history-btn');
const backToWorkspaceBtn = document.getElementById('back-to-workspace-btn');
const historySearch = document.getElementById('history-search');
const historyListContainer = document.getElementById('history-list-container');
const exportBtn = document.getElementById('export-btn');

// Modals
const modalOverlay = document.getElementById('modal-overlay');
const projectModal = document.getElementById('project-modal');
const projectForm = document.getElementById('project-form');
const addProjectBtn = document.getElementById('add-project-btn');
const closeModals = document.querySelectorAll('.close-modal');

// === TOAST SYSTEM ===
function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const iconMap = {
        success: 'fa-circle-check',
        warning: 'fa-triangle-exclamation',
        info:    'fa-circle-info',
        timer:   'fa-hourglass-end'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fa-solid ${iconMap[type] || 'fa-circle-info'}"></i><span>${message}</span>`;
    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('toast-show'));
    });

    setTimeout(() => {
        toast.classList.remove('toast-show');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, duration);
}

// === DUE DATE HELPERS ===
function getDueBadgeClass(dateStr) {
    if (!dateStr) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'due-overdue';
    if (diffDays === 0) return 'due-today';
    if (diffDays <= 2) return 'due-soon';
    return '';
}

function formatDueDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear().toString().slice(-2);
    return `${day}/${month}/${year}`;
}

function formatShortDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear().toString().slice(-2);
    return `${day}/${month}/${year}`;
}

// --- Core Initialization ---
async function init() {
    applyTheme(currentTheme);
    bindEvents();

    // Se Supabase estiver configurado, carrega dados da nuvem
    if (dbEnabled) {
        try {
            const dbData = await dbLoadAll();

            if (dbData === null) {
                console.warn('[App] Usando localStorage como fallback.');
            } else if (dbData.projects.length > 0) {
                projects   = dbData.projects;
                tasks      = dbData.tasks;
                templates  = dbData.templates.length > 0 ? dbData.templates : templates;
                // Ensure backward compat on cloud data too
                tasks = tasks.map((t, i) => ({
                    priority:     null,
                    dueDate:      null,
                    notes:        '',
                    completedAt:  null,
                    order:        i,
                    recurring:    false,
                    recurringDay: null,
                    archived:     false,
                    energy:       null,
                    subtasks:     [],
                    ...t
                }));
                currentProjectId = projects.find(p => p.id === currentProjectId)
                    ? currentProjectId
                    : projects[0].id;
                // Mirror Supabase data to localStorage so offline reloads stay fresh
                localStorage.setItem('arcforgeTasks',    JSON.stringify(tasks));
                localStorage.setItem('arcforgeProjects', JSON.stringify(projects));
                localStorage.setItem('arcforgeTemplates', JSON.stringify(templates));
                console.log('[App] Dados carregados do Supabase.');
            } else {
                console.log('[App] Supabase vazio. Migrando dados locais para a nuvem...');
                if (projects.length > 0) dbSaveProjects(projects);
                if (tasks.length > 0)    dbSaveTasks(tasks);
                if (templates.length > 0) dbSaveTemplates(templates);
            }
        } catch (e) {
            console.warn('[App] Erro ao carregar do Supabase:', e);
        }

        // Sync MasterPrompt from Supabase (cloud overrides local if present)
        try {
            const cloudPrompt = await dbLoadSetting('masterPrompt');
            if (cloudPrompt) {
                localStorage.setItem('arcforgeMasterPrompt', cloudPrompt);
                if (!localStorage.getItem('arcforgeMasterPromptFile')) {
                    localStorage.setItem('arcforgeMasterPromptFile', JSON.stringify({
                        name: 'synced from cloud',
                        size: new Blob([cloudPrompt]).size,
                        uploadedAt: new Date().toISOString()
                    }));
                }
            }
        } catch (e) {
            console.warn('[App] Erro ao carregar MasterPrompt:', e);
        }

        // Sync user settings: theme, pomodoro, check-in log, weekly task list
        try {
            const [cloudTheme, cloudPomodoro, cloudCheckIn, cloudWeekly] = await Promise.all([
                dbLoadSetting('theme'),
                dbLoadSetting('pomodoroDuration'),
                dbLoadSetting('checkInLog'),
                dbLoadSetting('weeklyTaskIds')
            ]);
            if (cloudTheme) {
                currentTheme = cloudTheme;
                localStorage.setItem('arcforgeTheme', cloudTheme);
                applyTheme(cloudTheme);
            }
            if (cloudPomodoro) {
                pomodoroDuration = parseInt(cloudPomodoro, 10) || 1500;
                timeRemaining = pomodoroDuration;
                localStorage.setItem('arcforgePomodoroDuration', pomodoroDuration.toString());
            }
            if (cloudCheckIn) {
                try {
                    const parsed = JSON.parse(cloudCheckIn);
                    if (Array.isArray(parsed)) {
                        checkInLog = parsed;
                        localStorage.setItem('arcforgeCheckInLog', JSON.stringify(checkInLog));
                    }
                } catch(e) {}
            }
            if (cloudWeekly) {
                try {
                    const parsed = JSON.parse(cloudWeekly);
                    if (Array.isArray(parsed)) {
                        weeklyTaskIds = parsed;
                        localStorage.setItem('arcforgeWeeklyTaskIds', JSON.stringify(weeklyTaskIds));
                    }
                } catch(e) {}
            }
        } catch(e) {
            console.warn('[App] Erro ao carregar settings:', e);
        }
    }

    // Cloud load phase is complete (success or failure). Safe to write to Supabase from here on.
    _cloudDataReady = true;

    checkRecurringTasks();
    initNotifications();
    renderSidebar();
    switchProject(currentProjectId);
    initVoiceControl();
    initThemePicker();
    initDurationPicker();
    initPrioritySelector();
    initAI();
    initCheckIn();
    updateWorkloadMeter();

    // Auto morning brief: 7am–12pm, once per day
    const nowHour = new Date().getHours();
    const todayKey = new Date().toISOString().split('T')[0];
    if (nowHour >= 7 && nowHour < 12 && localStorage.getItem('arcforgeLastMorningBrief') !== todayKey) {
        setTimeout(() => {
            if (aiActions.openAndSend) {
                aiActions.openAndSend('Give me a focused morning briefing based on my tasks. Tell me: (1) the 3 most important things to tackle today and why, (2) anything overdue I should address first, and (3) one thing I should NOT work on today so I stay focused.');
                localStorage.setItem('arcforgeLastMorningBrief', todayKey);
            }
        }, 1500);
    }
}

// --- Recurring Tasks ---
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon ...
    const diff = (day === 0) ? -6 : 1 - day; // shift to Monday
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

function checkRecurringTasks() {
    const today = new Date();
    const weekStart = getWeekStart(today);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const lastCheck = localStorage.getItem('arcforgeRecurringWeek');
    if (lastCheck === weekStartStr) return; // already processed this week

    const dayOffset = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

    const recurringTasks = tasks.filter(t => t.recurring);
    if (recurringTasks.length === 0) {
        localStorage.setItem('arcforgeRecurringWeek', weekStartStr);
        return;
    }

    const newTasks = recurringTasks.map(t => {
        let dueDate = null;
        if (t.recurringDay && dayOffset[t.recurringDay] !== undefined) {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + dayOffset[t.recurringDay]);
            dueDate = d.toISOString().split('T')[0];
        }
        const projectTasks = tasks.filter(task => task.projectId === t.projectId);
        const minOrder = projectTasks.length > 0 ? Math.min(...projectTasks.map(task => task.order ?? 0)) : 0;
        return {
            ...t,
            id:          generateId(),
            completed:   false,
            completedAt: null,
            timeSpent:   0,
            dueDate:     dueDate,
            order:       minOrder - 1,
            createdAt:   new Date().toISOString(),
            energy:      t.energy      || null,
            context:     t.context     || null,
            notes:       t.notes       || '',
            subtasks:    t.subtasks    ? JSON.parse(JSON.stringify(t.subtasks)) : [],
        };
    });

    tasks = [...newTasks, ...tasks];
    saveAll();
    localStorage.setItem('arcforgeRecurringWeek', weekStartStr);
    console.log(`[Recurring] Generated ${newTasks.length} task(s) for week of ${weekStartStr}`);
}

// --- Recurring Streak ---
// Count consecutive weeks the same recurring task text was completed (via archived tasks)
function getRecurringStreak(task) {
    if (!task.recurring) return 0;
    const completed = tasks
        .filter(t => t.archived && t.projectId === task.projectId && t.text === task.text && t.completedAt)
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    if (completed.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < completed.length; i++) {
        const prev = new Date(completed[i - 1].completedAt);
        const curr = new Date(completed[i].completedAt);
        const diffWeeks = Math.round((prev - curr) / (7 * 24 * 60 * 60 * 1000));
        if (diffWeeks === 1) streak++;
        else break;
    }
    return streak;
}

// --- Browser Notifications / Reminders ---
function initNotifications() {
    if (!('Notification' in window)) return;

    const today = new Date().toISOString().split('T')[0];
    const hour  = new Date().getHours();

    const fireWithPermission = (fn) => {
        if (Notification.permission === 'granted') {
            fn();
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(p => { if (p === 'granted') fn(); });
        }
    };

    // Morning reminder (runs once per day)
    if (localStorage.getItem('arcforgeLastNotification') !== today) {
        const pending  = tasks.filter(t => !t.completed && !t.archived && t.dueDate);
        const overdue  = pending.filter(t => t.dueDate < today);
        const dueToday = pending.filter(t => t.dueDate === today);

        if (overdue.length > 0 || dueToday.length > 0) {
            fireWithPermission(() => {
                const parts = [];
                if (overdue.length)  parts.push(`${overdue.length} overdue`);
                if (dueToday.length) parts.push(`${dueToday.length} due today`);
                const preview = [...overdue, ...dueToday].slice(0, 3).map(t => t.text).join(', ');
                new Notification('ArcForge', {
                    body: `${parts.join(' · ')}: ${preview}`,
                    icon: '/favicon.svg',
                    tag:  'arcforge-reminder'
                });
                localStorage.setItem('arcforgeLastNotification', today);
            });
        }
    }

    // End-of-day nudge: after 5pm, if you have pending tasks + completed some today
    if (hour >= 17 && localStorage.getItem('arcforgeLastEodNudge') !== today) {
        const pendingAll   = tasks.filter(t => !t.completed && !t.archived);
        const completedToday = tasks.filter(t => t.completed && t.completedAt && t.completedAt.startsWith(today));
        if (pendingAll.length > 0 && completedToday.length > 0) {
            fireWithPermission(() => {
                new Notification('ArcForge — End of Day', {
                    body: `Great work! ${completedToday.length} task${completedToday.length > 1 ? 's' : ''} done today. ${pendingAll.length} still pending for tomorrow.`,
                    icon: '/favicon.svg',
                    tag:  'arcforge-eod'
                });
                localStorage.setItem('arcforgeLastEodNudge', today);
            });
        }
    }
}

// --- Workload Meter ---
function updateWorkloadMeter() {
    const el = document.getElementById('workload-meter');
    if (!el) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);
    const dueThisWeek = tasks.filter(t => !t.completed && !t.archived && t.dueDate).filter(t => {
        const d = new Date(t.dueDate + 'T00:00:00');
        return d >= today && d < weekEnd;
    }).length;
    const overdue = tasks.filter(t => !t.completed && !t.archived && t.dueDate && new Date(t.dueDate + 'T00:00:00') < today).length;
    const total = dueThisWeek + overdue;
    let level = 'low';
    if (total >= 8) level = 'high';
    else if (total >= 4) level = 'medium';
    el.dataset.level = level;
    el.title = `${total} task${total !== 1 ? 's' : ''} due this week${overdue > 0 ? ` (${overdue} overdue)` : ''}`;
    el.querySelector('.workload-count').textContent = total;
}

// --- Data Persistence ---
function saveAll() {
    localStorage.setItem('arcforgeProjects', JSON.stringify(projects));
    localStorage.setItem('arcforgeTemplates', JSON.stringify(templates));
    localStorage.setItem('arcforgeTasks', JSON.stringify(tasks));
    localStorage.setItem('arcforgeCurrentProject', currentProjectId);
    if (dbEnabled && _cloudDataReady) {
        dbSaveProjects(projects);
        dbSaveTasks(tasks);
        dbSaveTemplates(templates);
    }
}

// --- Duration Picker ---
function initDurationPicker() {
    const durationBtns = document.querySelectorAll('.duration-btn');
    const savedMins = Math.round(pomodoroDuration / 60);

    durationBtns.forEach(btn => {
        const mins = parseInt(btn.dataset.mins, 10);
        if (mins === savedMins) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        btn.addEventListener('click', () => {
            durationBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pomodoroDuration = mins * 60;
            localStorage.setItem('arcforgePomodoroDuration', pomodoroDuration.toString());
            if (dbEnabled) dbSaveSetting('pomodoroDuration', pomodoroDuration.toString());
            // If timer is not running, reset display
            if (!activeTimerTaskId) {
                timeRemaining = pomodoroDuration;
                updateTimerDisplay();
            }
            showToast(`Focus duration: ${mins}m`, 'info');
        });
    });
}

// --- Priority Selector ---
function initPrioritySelector() {
    const prioBtns = document.querySelectorAll('.prio-btn');
    prioBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            prioBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedPriority = btn.dataset.prio;
        });
    });
}

// --- Event Binding ---
function openSidebar() {
    sidebar.classList.add('open');
    const bd = document.getElementById('sidebar-backdrop');
    if (bd) { bd.classList.add('active'); bd.style.display = 'block'; }
}

function closeSidebar() {
    sidebar.classList.remove('open');
    const bd = document.getElementById('sidebar-backdrop');
    if (bd) { bd.classList.remove('active'); setTimeout(() => { bd.style.display = 'none'; }, 300); }
}

function bindEvents() {
    // Sidebar Mobile Toggle
    menuToggle.addEventListener('click', openSidebar);
    closeSidebarBtn.addEventListener('click', closeSidebar);
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    // Bottom Nav (mobile)
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileHistoryBtnNav = document.getElementById('mobile-history-btn-nav');
    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openSidebar);
    if (mobileHistoryBtnNav) mobileHistoryBtnNav.addEventListener('click', showHistory);

    // Task submission
    taskForm.addEventListener('submit', addTask);

    // Filters & Sorting
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderTasks();
        });
    });

    // Filter popover
    const filterMoreBtn = document.getElementById('filter-more-btn');
    const filterPopover = document.getElementById('filter-popover');
    const filterActiveBadge = document.getElementById('filter-active-badge');

    function updateFilterBadge() {
        const count = (currentContextFilter ? 1 : 0) + (currentRecurringFilter ? 1 : 0) + (currentEnergyFilter ? 1 : 0);
        if (filterActiveBadge) {
            filterActiveBadge.textContent = count;
            filterActiveBadge.classList.toggle('hidden', count === 0);
        }
        if (filterMoreBtn) filterMoreBtn.classList.toggle('active', count > 0);
    }

    if (filterMoreBtn && filterPopover) {
        filterMoreBtn.addEventListener('click', e => {
            e.stopPropagation();
            filterPopover.classList.toggle('hidden');
        });
        document.addEventListener('click', e => {
            if (!filterPopover.contains(e.target) && e.target !== filterMoreBtn) {
                filterPopover.classList.add('hidden');
            }
        });
    }

    // Context filter buttons (in task list header)
    document.querySelectorAll('.context-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.context-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentContextFilter = btn.dataset.contextFilter === 'all' ? null : btn.dataset.contextFilter;
            updateFilterBadge();
            renderTasks();
        });
    });

    // Recurring filter buttons
    document.querySelectorAll('.recurring-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.recurring-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRecurringFilter = btn.dataset.recurringFilter === 'all' ? null : btn.dataset.recurringFilter;
            updateFilterBadge();
            renderTasks();
        });
    });

    // Today view toggle
    const todayViewBtn = document.getElementById('nav-today-btn');
    if (todayViewBtn) {
        todayViewBtn.addEventListener('click', () => {
            isTodayView = true;
            closeSidebar();
            if (currentProjectTitle) currentProjectTitle.textContent = 'Today';
            document.querySelector('[data-filter="all"]')?.click();
            renderTasks();
            // Highlight today button in sidebar
            todayViewBtn.classList.add('active');
        });
    }

    // Energy filter buttons (in popover)
    document.querySelectorAll('.energy-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.energy-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentEnergyFilter = btn.dataset.energyFilter === 'all' ? null : btn.dataset.energyFilter;
            updateFilterBadge();
            renderTasks();
        });
    });

    // Energy picker buttons (in composer)
    document.querySelectorAll('.energy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.energy;
            if (selectedEnergy === val) {
                // Toggle off
                document.querySelectorAll('.energy-btn').forEach(b => b.classList.remove('active'));
                selectedEnergy = '';
            } else {
                document.querySelectorAll('.energy-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedEnergy = val;
            }
        });
    });

    // Context picker buttons (in add form)
    document.querySelectorAll('.context-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.context-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedContext = btn.dataset.context;
        });
    });

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            renderTasks();
        });
    }

    // Project Actions
    deleteProjectBtn.addEventListener('click', confirmDeleteProject);
    if (completeAllBtn) completeAllBtn.addEventListener('click', completeAllTasks);
    if (clearCompletedBtn) clearCompletedBtn.addEventListener('click', clearCompletedTasks);

    // Timer controls
    if (restartTimerBtn) restartTimerBtn.addEventListener('click', restartTimer);

    // Sidebar profile button
    const sidebarProfileBtn = document.getElementById('sidebar-profile-btn');
    if (sidebarProfileBtn) sidebarProfileBtn.addEventListener('click', () => {
        closeSidebar();
        if (aiActions.openSettings) aiActions.openSettings();
    });

    // Daily check-in
    const navCheckinBtn = document.getElementById('nav-checkin-btn');
    if (navCheckinBtn) navCheckinBtn.addEventListener('click', () => { closeSidebar(); showCheckIn(); });

    // Streaks
    const navStreaksBtn = document.getElementById('nav-streaks-btn');
    if (navStreaksBtn) navStreaksBtn.addEventListener('click', showStreaks);

    // Shelf
    const navShelfBtn = document.getElementById('nav-shelf-btn');
    if (navShelfBtn) navShelfBtn.addEventListener('click', showShelf);

    // Goals
    const navGoalsBtn = document.getElementById('nav-goals-btn');
    if (navGoalsBtn) navGoalsBtn.addEventListener('click', showGoals);

    // Pipeline
    const navPipelineBtn = document.getElementById('nav-pipeline-btn');
    if (navPipelineBtn) navPipelineBtn.addEventListener('click', showPipeline);

    // Weekly planning
    const navWeeklyBtn = document.getElementById('nav-weekly-btn');
    if (navWeeklyBtn) navWeeklyBtn.addEventListener('click', showWeeklyPlanning);

    // History controls
    if (navHistoryBtn) navHistoryBtn.addEventListener('click', showHistory);
    if (backToWorkspaceBtn) backToWorkspaceBtn.addEventListener('click', showWorkspace);
    if (historySearch) historySearch.addEventListener('input', renderHistory);
    if (exportBtn) exportBtn.addEventListener('click', exportData);

    // Project Button
    addProjectBtn.addEventListener('click', openProjectModal);

    closeModals.forEach(btn => btn.addEventListener('click', closeAllModals));
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeAllModals();
    });

    // Forms inside Modals
    projectForm.addEventListener('submit', handleCreateProject);
}

// --- User Interface & Rendering ---

function renderSidebar() {
    // Render Active Projects
    projectListEl.innerHTML = '';
    const activeProjects   = projects.filter(p => !p.archived);
    const archivedProjects = projects.filter(p => p.archived);

    activeProjects.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(p => {
        const projTasks = tasks.filter(t => t.projectId === p.id && !t.archived);
        const total = projTasks.length;
        const done  = projTasks.filter(t => t.completed).length;
        const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
        const stale = isProjectStale(p.id);

        const li = document.createElement('li');
        li.className = `list-item ${p.id === currentProjectId ? 'active' : ''}`;
        li.dataset.projectId = p.id;
        li.draggable = true;

        li.innerHTML = `
            <div class="project-item-inner">
                <span class="project-drag-handle"><i class="fa-solid fa-grip-vertical"></i></span>
                <span class="item-name">${escapeHTML(p.name)}</span>
                <div class="project-item-controls">
                    ${stale ? `<button class="item-stale-btn" title="No progress in 7 days — click to get unstuck"><i class="fa-solid fa-circle-exclamation"></i></button>` : ''}
                    <button class="item-archive" title="Archive project"><i class="fa-solid fa-box-archive"></i></button>
                    <button class="item-rename"  title="Rename"><i class="fa-solid fa-pen"></i></button>
                    <span class="project-count">${done}/${total}</span>
                </div>
            </div>
            ${total > 0 ? `<div class="project-progress-bar"><div class="project-progress-fill" style="width: ${pct}%"></div></div>` : ''}
        `;

        li.querySelector('.project-item-inner').addEventListener('click', (e) => {
            if (!e.target.closest('.item-rename') && !e.target.closest('.item-archive') && !e.target.closest('.project-drag-handle')) {
                switchProject(p.id);
            }
        });
        li.querySelector('.item-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            startRenameProject(p.id, li);
        });
        li.querySelector('.item-archive').addEventListener('click', (e) => {
            e.stopPropagation();
            archiveProject(p.id);
        });
        if (stale) {
            li.querySelector('.item-stale-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const prompt = `You haven't made progress on "${p.name}" in 7 days. I want you to help me figure out what's blocking me — not just remind me about it. Ask me one focused question about what's in the way, then help me find a concrete next step to break through the block.`;
                if (aiActions.openWithPrompt) aiActions.openWithPrompt(prompt);
            });
        }

        li.addEventListener('dragstart', (e) => {
            dragSrcProjectId = p.id;
            li.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        li.addEventListener('dragend', () => {
            li.classList.remove('dragging');
            document.querySelectorAll('.list-item.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        li.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragSrcProjectId !== p.id) li.classList.add('drag-over');
        });
        li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
        li.addEventListener('drop', (e) => {
            e.preventDefault();
            li.classList.remove('drag-over');
            if (dragSrcProjectId && dragSrcProjectId !== p.id) {
                reorderProjects(dragSrcProjectId, p.id);
            }
        });

        projectListEl.appendChild(li);
    });

    // Render Archived section (collapsible)
    const existingArchived = projectListEl.parentElement.querySelector('.archived-section');
    if (existingArchived) existingArchived.remove();

    if (archivedProjects.length > 0) {
        const section = document.createElement('div');
        section.className = 'archived-section';

        const header = document.createElement('button');
        header.className = 'archived-header';
        header.innerHTML = `
            <i class="fa-solid fa-box-archive"></i>
            <span>Archived</span>
            <span class="archived-count">${archivedProjects.length}</span>
            <i class="fa-solid fa-chevron-down archived-chevron"></i>
        `;

        const list = document.createElement('ul');
        list.className = 'archived-list';

        archivedProjects.forEach(p => {
            const projTasks = tasks.filter(t => t.projectId === p.id);
            const li = document.createElement('li');
            li.className = 'list-item archived-item';
            li.innerHTML = `
                <div class="project-item-inner">
                    <span class="item-name">${escapeHTML(p.name)}</span>
                    <div class="project-item-controls">
                        <button class="item-clone" title="Clone as new project"><i class="fa-solid fa-copy"></i></button>
                        <button class="item-restore" title="Restore project"><i class="fa-solid fa-rotate-left"></i></button>
                        <button class="item-delete-archived" title="Delete permanently"><i class="fa-solid fa-trash"></i></button>
                        <span class="project-count">${projTasks.length} tasks</span>
                    </div>
                </div>
            `;
            li.querySelector('.item-clone').addEventListener('click', (e) => {
                e.stopPropagation();
                cloneProject(p.id);
            });
            li.querySelector('.item-restore').addEventListener('click', (e) => {
                e.stopPropagation();
                restoreProject(p.id);
            });
            li.querySelector('.item-delete-archived').addEventListener('click', (e) => {
                e.stopPropagation();
                permanentlyDeleteProject(p.id);
            });
            list.appendChild(li);
        });

        let open = false;
        header.addEventListener('click', () => {
            open = !open;
            list.classList.toggle('hidden', !open);
            header.querySelector('.archived-chevron').style.transform = open ? 'rotate(180deg)' : '';
        });
        list.classList.add('hidden');

        section.appendChild(header);
        section.appendChild(list);
        projectListEl.parentElement.appendChild(section);
    }

}

function startRenameProject(projectId, liEl) {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;

    const inner = liEl.querySelector('.project-item-inner');
    const nameSpan = inner.querySelector('.item-name');
    const currentName = proj.name;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = currentName;

    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
            projects = projects.map(p => p.id === projectId ? { ...p, name: newName } : p);
            saveAll();
            if (projectId === currentProjectId) {
                currentProjectTitle.textContent = newName;
            }
            showToast(`Renamed to "${newName}"`, 'success');
        }
        renderSidebar();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
}

function switchProject(id) {
    const activeProjects = projects.filter(p => !p.archived);
    // Don't switch to an archived project
    if (!activeProjects.find(p => p.id === id)) {
        if (activeProjects.length === 0) {
            projects.push({ id: generateId(), name: 'Main Tasks', archived: false, order: 0 });
        }
        id = activeProjects[0]?.id || projects[0].id;
    }

    currentProjectId = id;
    isTodayView = false;
    saveAll();

    const proj = projects.find(p => p.id === currentProjectId);
    if (currentProjectTitle) currentProjectTitle.textContent = proj?.name ?? '';

    // Remove active state from Today button
    const todayBtn = document.getElementById('nav-today-btn');
    if (todayBtn) todayBtn.classList.remove('active');

    closeSidebar();
    renderSidebar();

    document.querySelector('[data-filter="all"]')?.click();
    currentContextFilter = null;
    document.querySelectorAll('.context-filter-btn').forEach(b => b.classList.remove('active'));
    const allCtxBtn = document.querySelector('.context-filter-btn[data-context-filter="all"]');
    if (allCtxBtn) allCtxBtn.classList.add('active');

    currentRecurringFilter = null;
    document.querySelectorAll('.recurring-filter-btn').forEach(b => b.classList.remove('active'));
    const allRecBtn = document.querySelector('.recurring-filter-btn[data-recurring-filter="all"]');
    if (allRecBtn) allRecBtn.classList.add('active');

    currentEnergyFilter = null;
    document.querySelectorAll('.energy-filter-btn').forEach(b => b.classList.remove('active'));
    const allEnBtn = document.querySelector('.energy-filter-btn[data-energy-filter="all"]');
    if (allEnBtn) allEnBtn.classList.add('active');

    const badge = document.getElementById('filter-active-badge');
    if (badge) badge.classList.add('hidden');
    const fmb = document.getElementById('filter-more-btn');
    if (fmb) fmb.classList.remove('active');

    const canDelete = activeProjects.length > 1;
    deleteProjectBtn.disabled = !canDelete;
    deleteProjectBtn.style.opacity = canDelete ? '1' : '0.5';
    deleteProjectBtn.style.cursor  = canDelete ? 'pointer' : 'not-allowed';
}

function renderTasks() {
    taskList.innerHTML = '';

    let projectTasks;
    if (isTodayView) {
        const todayStr = new Date().toISOString().split('T')[0];
        projectTasks = tasks.filter(t => !t.archived && !t.completed && t.dueDate && t.dueDate <= todayStr);
    } else {
        projectTasks = tasks.filter(t => t.projectId === currentProjectId && !t.archived);
    }

    let filteredTasks = [...projectTasks];

    if (!isTodayView) {
        if (currentFilter === 'pending') {
            filteredTasks = projectTasks.filter(t => !t.completed);
        } else if (currentFilter === 'completed') {
            filteredTasks = projectTasks.filter(t => t.completed);
        }
    }

    if (currentContextFilter) {
        filteredTasks = filteredTasks.filter(t => t.context === currentContextFilter);
    }

    if (currentRecurringFilter === 'recurring') {
        filteredTasks = filteredTasks.filter(t => t.recurring);
    } else if (currentRecurringFilter) {
        filteredTasks = filteredTasks.filter(t => t.recurring && t.recurringDay === currentRecurringFilter);
    }

    if (currentEnergyFilter) {
        filteredTasks = filteredTasks.filter(t => t.energy === currentEnergyFilter);
    }

    // Apply Sorting
    if (currentSort === 'custom') {
        filteredTasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    } else if (currentSort === 'time-desc') {
        filteredTasks.sort((a, b) => (b.timeSpent || 0) - (a.timeSpent || 0));
    } else if (currentSort === 'time-asc') {
        filteredTasks.sort((a, b) => (a.timeSpent || 0) - (b.timeSpent || 0));
    } else if (currentSort === 'newest') {
        filteredTasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (currentSort === 'oldest') {
        filteredTasks.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (currentSort === 'due-date') {
        filteredTasks.sort((a, b) => {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate) - new Date(b.dueDate);
        });
    }

    if (filteredTasks.length === 0) {
        taskList.style.display = 'none';
        emptyState.classList.add('visible');
        if (isTodayView) {
            emptyState.querySelector('h3').textContent = 'All clear for today!';
            emptyState.querySelector('p').textContent = 'No tasks due today or overdue. Great job!';
        } else {
            emptyState.querySelector('h3').textContent = 'No tasks yet';
            emptyState.querySelector('p').textContent = 'Add a task above to get started.';
        }
    } else {
        taskList.style.display = 'flex';
        emptyState.classList.remove('visible');

        filteredTasks.forEach(task => {
            const li = createTaskElement(task);
            taskList.appendChild(li);
        });
    }
    updateStats(projectTasks);
}

function createTaskElement(task) {
    const li = document.createElement('li');
    const isCustomSort = currentSort === 'custom';
    const dueClass = (task.dueDate && !task.completed)
        ? (getDueBadgeClass(task.dueDate) === 'due-overdue' ? 'task-overdue'
         : getDueBadgeClass(task.dueDate) === 'due-today'   ? 'task-due-today' : '')
        : '';
    li.className = `task-item ${task.completed ? 'completed' : ''} ${activeTimerTaskId === task.id ? 'active-timer' : ''} ${dueClass}`.trim();
    li.dataset.id = task.id;
    if (isCustomSort) li.setAttribute('draggable', 'true');

    // Time badge
    let timeBadge = '';
    if (task.timeSpent && task.timeSpent > 0) {
        const totalMins = Math.floor(task.timeSpent / 60);
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        let timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
        if (totalMins === 0) timeStr = '<1m';
        timeBadge = `<span class="task-time-badge"><i class="fa-regular fa-clock"></i> ${timeStr}</span>`;
    }

    // Due date badge
    let dueBadge = '';
    if (task.dueDate) {
        const cls = getDueBadgeClass(task.dueDate);
        dueBadge = `<span class="due-badge ${cls}"><i class="fa-regular fa-calendar"></i> ${formatDueDate(task.dueDate)}</span>`;
    }

    // Context badge
    let contextBadge = '';
    if (task.context === 'deep-work') {
        contextBadge = `<span class="context-badge context-deep-work"><i class="fa-solid fa-brain"></i> Deep Work</span>`;
    } else if (task.context === 'quick-win') {
        contextBadge = `<span class="context-badge context-quick-win"><i class="fa-solid fa-bolt"></i> Quick Win</span>`;
    }

    // Priority dot
    let prioDot = '';
    if (task.priority) {
        prioDot = `<span class="prio-dot prio-dot-${task.priority}"></span>`;
    }

    // Notes indicator
    let notesIcon = '';
    if (task.notes && task.notes.trim()) {
        notesIcon = `<i class="fa-solid fa-note-sticky notes-indicator" title="Has notes"></i>`;
    }

    // Subtask progress badge
    let subtaskBadge = '';
    if (task.subtasks && task.subtasks.length > 0) {
        const done  = task.subtasks.filter(s => s.completed).length;
        const total = task.subtasks.length;
        subtaskBadge = `<span class="subtask-progress-badge" title="${done} of ${total} subtasks done"><i class="fa-solid fa-list-check"></i> ${done}/${total}</span>`;
    }

    // Recurring badge + streak
    let recurringBadge = '';
    if (task.recurring) {
        const dayLabel = task.recurringDay
            ? task.recurringDay.charAt(0).toUpperCase() + task.recurringDay.slice(1)
            : 'Weekly';
        const streak = getRecurringStreak(task);
        const streakHtml = streak >= 2 ? ` <span class="streak-count">${streak}</span>` : '';
        recurringBadge = `<span class="context-badge recurring-badge"><i class="fa-solid fa-rotate"></i> ${dayLabel}${streakHtml}</span>`;
    }

    // Task aging badge
    let agingBadge = '';
    if (!task.completed && task.createdAt) {
        const ageMs = Date.now() - new Date(task.createdAt).getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        if (ageDays >= 14) {
            agingBadge = `<span class="aging-badge aging-stale" title="${ageDays} days old"><i class="fa-solid fa-hourglass-end"></i> ${ageDays}d</span>`;
        } else if (ageDays >= 7) {
            agingBadge = `<span class="aging-badge aging-warn" title="${ageDays} days old"><i class="fa-solid fa-hourglass-half"></i> ${ageDays}d</span>`;
        }
    }

    // Energy badge
    let energyBadge = '';
    if (task.energy === 'high') {
        energyBadge = `<span class="energy-badge energy-high" title="High energy task"><i class="fa-solid fa-bolt"></i></span>`;
    } else if (task.energy === 'low') {
        energyBadge = `<span class="energy-badge energy-low" title="Low energy task"><i class="fa-solid fa-leaf"></i></span>`;
    }

    // Project badge (shown in Today view)
    let projectBadge = '';
    if (isTodayView) {
        const proj = projects.find(p => p.id === task.projectId);
        if (proj) projectBadge = `<span class="project-badge">${escapeHTML(proj.name)}</span>`;
    }

    // Automation badge
    const autoBadge = task.automatable
        ? `<button class="auto-badge" title="This task may be automatable — click for a free setup guide"><i class="fa-solid fa-robot"></i></button>`
        : '';

    // AI Skill badge
    const skillBadge = task.aiSkill
        ? `<button class="ai-skill-badge" title="Claude can help speed this up — click for a ready-to-use prompt"><i class="fa-solid fa-bolt"></i></button>`
        : '';

    // Drag handle (only for custom sort)
    const dragHandleHtml = isCustomSort
        ? `<div class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>`
        : '';

    li.innerHTML = `
        <div class="task-main">
            ${dragHandleHtml}
            <div class="task-content">
                <div class="checkbox-wrapper">
                    <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
                    <div class="custom-checkbox"><i class="fa-solid fa-check"></i></div>
                </div>
                <div class="task-body">
                    <div class="task-header-row">
                        ${prioDot}
                        <span class="task-text">${escapeHTML(task.text)}</span>
                        ${notesIcon}
                        ${subtaskBadge}
                        ${autoBadge}
                        ${skillBadge}
                    </div>
                    <div class="task-badges">
                        ${timeBadge}
                        ${dueBadge}
                        ${contextBadge}
                        ${recurringBadge}
                        ${energyBadge}
                        ${agingBadge}
                        ${projectBadge}
                    </div>
                </div>
            </div>
            <div class="task-actions">
                <button class="action-btn expand-btn" aria-label="Expandir detalhes" title="Expandir">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <button class="action-btn timer-btn ${activeTimerTaskId === task.id ? 'running' : ''}" aria-label="Start timer">
                    <i class="fa-solid ${activeTimerTaskId === task.id ? 'fa-stop' : 'fa-play'}"></i>
                </button>
                <button class="action-btn edit-btn" aria-label="Edit task"><i class="fa-solid fa-pen"></i></button>
                <button class="action-btn delete-btn" aria-label="Delete task"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
        <div class="task-extra hidden">
            <div class="task-extra-fields">
                <div class="task-extra-field">
                    <label class="extra-label"><i class="fa-solid fa-flag"></i> Priority</label>
                    <div class="composer-group task-prio-picker">
                        <button type="button" class="prio-btn task-prio-btn ${!task.priority ? 'active' : ''}" data-prio="">—</button>
                        <button type="button" class="prio-btn prio-high task-prio-btn ${task.priority === 'high' ? 'active' : ''}" data-prio="high">High</button>
                        <button type="button" class="prio-btn prio-medium task-prio-btn ${task.priority === 'medium' ? 'active' : ''}" data-prio="medium">Med</button>
                        <button type="button" class="prio-btn prio-low task-prio-btn ${task.priority === 'low' ? 'active' : ''}" data-prio="low">Low</button>
                    </div>
                </div>
                <div class="task-extra-field">
                    <label class="extra-label"><i class="fa-solid fa-tag"></i> Context</label>
                    <div class="composer-group task-ctx-picker">
                        <button type="button" class="context-btn task-ctx-btn ${!task.context ? 'active' : ''}" data-context=""><i class="fa-solid fa-minus"></i></button>
                        <button type="button" class="context-btn context-btn-deep task-ctx-btn ${task.context === 'deep-work' ? 'active' : ''}" data-context="deep-work"><i class="fa-solid fa-brain"></i> Deep</button>
                        <button type="button" class="context-btn context-btn-quick task-ctx-btn ${task.context === 'quick-win' ? 'active' : ''}" data-context="quick-win"><i class="fa-solid fa-bolt"></i> Quick</button>
                    </div>
                </div>
                <div class="task-extra-field">
                    <label class="extra-label"><i class="fa-regular fa-calendar"></i> Due Date</label>
                    <input type="date" class="task-due-input extra-input" value="${task.dueDate || ''}">
                </div>
                <div class="task-extra-field">
                    <label class="extra-label"><i class="fa-solid fa-rotate"></i> Repeats Weekly</label>
                    <div class="recurring-control">
                        <button class="recurring-toggle-btn ${task.recurring ? 'active' : ''}" title="Toggle weekly repeat">
                            ${task.recurring ? '<i class="fa-solid fa-toggle-on"></i> On' : '<i class="fa-solid fa-toggle-off"></i> Off'}
                        </button>
                        <select class="recurring-day-select extra-input ${task.recurring ? '' : 'hidden'}" title="Day of week">
                            <option value="" ${!task.recurringDay ? 'selected' : ''}>Any day</option>
                            <option value="monday"    ${task.recurringDay === 'monday'    ? 'selected' : ''}>Monday</option>
                            <option value="tuesday"   ${task.recurringDay === 'tuesday'   ? 'selected' : ''}>Tuesday</option>
                            <option value="wednesday" ${task.recurringDay === 'wednesday' ? 'selected' : ''}>Wednesday</option>
                            <option value="thursday"  ${task.recurringDay === 'thursday'  ? 'selected' : ''}>Thursday</option>
                            <option value="friday"    ${task.recurringDay === 'friday'    ? 'selected' : ''}>Friday</option>
                            <option value="saturday"  ${task.recurringDay === 'saturday'  ? 'selected' : ''}>Saturday</option>
                            <option value="sunday"    ${task.recurringDay === 'sunday'    ? 'selected' : ''}>Sunday</option>
                        </select>
                    </div>
                </div>
                <div class="task-extra-field">
                    <label class="extra-label"><i class="fa-regular fa-note-sticky"></i> Notes</label>
                    <textarea class="task-notes-input extra-input" placeholder="Add notes...">${escapeHTML(task.notes || '')}</textarea>
                </div>
                <div class="task-extra-field subtasks-field">
                    <label class="extra-label"><i class="fa-solid fa-list-check"></i> Subtasks</label>
                    <div class="subtasks-list">
                        ${(task.subtasks || []).map(s => `
                        <div class="subtask-item" data-subtask-id="${s.id}">
                            <input type="checkbox" class="subtask-check" ${s.completed ? 'checked' : ''}>
                            <span class="subtask-text${s.completed ? ' done' : ''}">${escapeHTML(s.text)}</span>
                            <button class="subtask-delete-btn" title="Remove"><i class="fa-solid fa-xmark"></i></button>
                        </div>`).join('')}
                    </div>
                    <div class="subtask-add-row">
                        <input class="subtask-add-input" placeholder="Add a subtask…">
                        <button class="subtask-add-btn"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
            </div>
            ${!task.completed ? `<div class="task-ai-bar"><button class="task-ai-btn breakdown-btn"><i class="fa-solid fa-scissors"></i> Break into subtasks with AI</button></div>` : ''}
        </div>
    `;

    // Automation guide button
    if (task.automatable) {
        li.querySelector('.auto-badge').addEventListener('click', (e) => {
            e.stopPropagation();
            if (aiActions.openGuide) aiActions.openGuide(task);
        });
    }

    // AI Skill guide button
    if (task.aiSkill) {
        li.querySelector('.ai-skill-badge').addEventListener('click', (e) => {
            e.stopPropagation();
            if (aiActions.openSkillGuide) aiActions.openSkillGuide(task);
        });
    }

    // Expand button
    const expandBtn = li.querySelector('.expand-btn');
    const taskExtra = li.querySelector('.task-extra');
    expandBtn.addEventListener('click', () => {
        taskExtra.classList.toggle('hidden');
        expandBtn.querySelector('i').style.transform = taskExtra.classList.contains('hidden') ? '' : 'rotate(180deg)';
    });

    // Timer button
    const timerBtn = li.querySelector('.timer-btn');
    timerBtn.addEventListener('click', () => {
        if (activeTimerTaskId === task.id) {
            stopTimer();
        } else {
            startTimer(task.id);
        }
    });

    // Checkbox
    const checkbox = li.querySelector('.task-checkbox');
    checkbox.addEventListener('change', () => toggleTask(task.id));

    // Delete button
    const deleteBtn = li.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', () => deleteTask(task.id, li));

    // Edit button
    const editBtn = li.querySelector('.edit-btn');
    editBtn.addEventListener('click', () => editTask(task.id, li, task.text));

    // Task-level priority picker
    li.querySelectorAll('.task-prio-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            li.querySelectorAll('.task-prio-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateTaskField(task.id, 'priority', btn.dataset.prio || null);
        });
    });

    // Task-level context picker
    li.querySelectorAll('.task-ctx-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            li.querySelectorAll('.task-ctx-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateTaskField(task.id, 'context', btn.dataset.context || null);
        });
    });

    // Due date input
    const dueInput = li.querySelector('.task-due-input');
    dueInput.addEventListener('change', (e) => {
        updateTaskField(task.id, 'dueDate', e.target.value || null);
    });

    // Notes textarea
    const notesInput = li.querySelector('.task-notes-input');
    notesInput.addEventListener('input', (e) => {
        updateTaskField(task.id, 'notes', e.target.value, false);
    });
    notesInput.addEventListener('change', (e) => {
        updateTaskField(task.id, 'notes', e.target.value, false);
    });

    // Recurring toggle
    const recurringToggle = li.querySelector('.recurring-toggle-btn');
    const recurringDaySelect = li.querySelector('.recurring-day-select');
    recurringToggle.addEventListener('click', () => {
        const newVal = !task.recurring;
        task.recurring = newVal;
        recurringToggle.innerHTML = newVal
            ? '<i class="fa-solid fa-toggle-on"></i> On'
            : '<i class="fa-solid fa-toggle-off"></i> Off';
        recurringToggle.classList.toggle('active', newVal);
        recurringDaySelect.classList.toggle('hidden', !newVal);
        updateTaskField(task.id, 'recurring', newVal, false);
    });
    recurringDaySelect.addEventListener('change', (e) => {
        updateTaskField(task.id, 'recurringDay', e.target.value || null, false);
    });

    // AI breakdown button
    const breakdownBtn = li.querySelector('.breakdown-btn');
    if (breakdownBtn) {
        breakdownBtn.addEventListener('click', () => {
            if (aiActions.breakdownTask) aiActions.breakdownTask(task);
        });
    }

    // ---- Subtask helpers ----
    function getTaskIdx() { return tasks.findIndex(t => t.id === task.id); }

    function refreshSubtaskBadge() {
        const subs  = tasks[getTaskIdx()]?.subtasks || [];
        const total = subs.length;
        const done  = subs.filter(s => s.completed).length;
        let badge = li.querySelector('.subtask-progress-badge');
        if (total === 0) { if (badge) badge.remove(); return; }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'subtask-progress-badge';
            li.querySelector('.task-header-row').appendChild(badge);
        }
        badge.title = `${done} of ${total} subtasks done`;
        badge.innerHTML = `<i class="fa-solid fa-list-check"></i> ${done}/${total}`;
    }

    function wireSubtaskItem(itemEl, subId) {
        itemEl.querySelector('.subtask-check').addEventListener('change', (e) => {
            const idx = getTaskIdx(); if (idx === -1) return;
            tasks[idx].subtasks = tasks[idx].subtasks.map(s =>
                s.id === subId ? { ...s, completed: e.target.checked } : s
            );
            itemEl.querySelector('.subtask-text').classList.toggle('done', e.target.checked);
            saveAll(); refreshSubtaskBadge();
        });
        itemEl.querySelector('.subtask-delete-btn').addEventListener('click', () => {
            const idx = getTaskIdx(); if (idx === -1) return;
            tasks[idx].subtasks = tasks[idx].subtasks.filter(s => s.id !== subId);
            itemEl.remove();
            saveAll(); refreshSubtaskBadge();
        });
    }

    // Wire existing subtask items
    li.querySelectorAll('.subtask-item').forEach(itemEl => {
        wireSubtaskItem(itemEl, itemEl.dataset.subtaskId);
    });

    // Add new subtask
    const subtasksList    = li.querySelector('.subtasks-list');
    const subtaskAddInput = li.querySelector('.subtask-add-input');
    const subtaskAddBtn   = li.querySelector('.subtask-add-btn');

    function addSubtask() {
        const text = (subtaskAddInput.value || '').trim();
        if (!text) return;
        const newSub = { id: generateId(), text, completed: false };
        const idx = getTaskIdx(); if (idx === -1) return;
        tasks[idx].subtasks = [...(tasks[idx].subtasks || []), newSub];

        const itemEl = document.createElement('div');
        itemEl.className = 'subtask-item';
        itemEl.dataset.subtaskId = newSub.id;
        itemEl.innerHTML = `
            <input type="checkbox" class="subtask-check">
            <span class="subtask-text">${escapeHTML(newSub.text)}</span>
            <button class="subtask-delete-btn" title="Remove"><i class="fa-solid fa-xmark"></i></button>`;
        wireSubtaskItem(itemEl, newSub.id);
        subtasksList.appendChild(itemEl);
        subtaskAddInput.value = '';
        saveAll(); refreshSubtaskBadge();
    }

    subtaskAddBtn.addEventListener('click', addSubtask);
    subtaskAddInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
    });

    // Drag and drop (custom sort only)
    if (isCustomSort) {
        li.addEventListener('dragstart', (e) => {
            dragSrcId = task.id;
            li.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        li.addEventListener('dragend', () => {
            li.classList.remove('dragging');
            document.querySelectorAll('.task-item.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        li.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragSrcId !== task.id) li.classList.add('drag-over');
        });
        li.addEventListener('dragleave', () => {
            li.classList.remove('drag-over');
        });
        li.addEventListener('drop', (e) => {
            e.preventDefault();
            li.classList.remove('drag-over');
            if (dragSrcId && dragSrcId !== task.id) {
                reorderTasks(dragSrcId, task.id);
            }
        });
    }

    return li;
}

function updateTaskField(id, field, value, rerender = true) {
    tasks = tasks.map(t => t.id === id ? { ...t, [field]: value } : t);
    saveAll();
    if (rerender) {
        renderTasks();
        renderSidebar();
    }
}

function reorderTasks(srcId, targetId) {
    const projectTasks = tasks
        .filter(t => t.projectId === currentProjectId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const srcIdx = projectTasks.findIndex(t => t.id === srcId);
    const tgtIdx = projectTasks.findIndex(t => t.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const [moved] = projectTasks.splice(srcIdx, 1);
    projectTasks.splice(tgtIdx, 0, moved);

    // Reassign order values
    projectTasks.forEach((t, i) => {
        tasks = tasks.map(task => task.id === t.id ? { ...task, order: i } : task);
    });

    saveAll();
    renderTasks();
}

function reorderProjects(srcId, targetId) {
    const active = projects
        .filter(p => !p.archived)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const srcIdx = active.findIndex(p => p.id === srcId);
    const tgtIdx = active.findIndex(p => p.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const [moved] = active.splice(srcIdx, 1);
    active.splice(tgtIdx, 0, moved);

    active.forEach((p, i) => {
        projects = projects.map(proj => proj.id === p.id ? { ...proj, order: i } : proj);
    });

    saveAll();
    renderSidebar();
}

function updateStats(projectTasks) {
    const pendingCount   = projectTasks.filter(t => !t.completed).length;
    const completedCount = projectTasks.filter(t => t.completed).length;

    if (pendingCountEl.textContent !== pendingCount.toString()) {
        animateElement(pendingCountEl);
        pendingCountEl.textContent = pendingCount;
    }

    if (completedCountEl.textContent !== completedCount.toString()) {
        animateElement(completedCountEl);
        completedCountEl.textContent = completedCount;
    }
}

function animateElement(el) {
    el.style.transform = 'scale(1.3)';
    el.style.color = 'var(--accent-secondary)';
    setTimeout(() => {
        el.style.transform = 'scale(1)';
        el.style.color = 'var(--text-main)';
    }, 200);
}

// --- Modals Logic ---
function openModal(modalEl) {
    if (!modalOverlay || !modalEl) return;
    modalOverlay.classList.add('active');
    modalEl.classList.add('active');
}

function closeAllModals() {
    if (modalOverlay) modalOverlay.classList.remove('active');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    if (projectForm) projectForm.reset();
}

function openProjectModal() {
    openModal(projectModal);
    setTimeout(() => document.getElementById('project-name-input').focus(), 100);
}

// --- Project & Template Operations ---

function handleCreateProject(e) {
    e.preventDefault();
    const name = document.getElementById('project-name-input').value.trim();
    if (!name) return;

    const newProjectId = generateId();
    projects.push({ id: newProjectId, name, archived: false, order: projects.filter(p => !p.archived).length });

    saveAll();
    closeAllModals();
    showToast(`Project "${name}" created!`, 'success');
    switchProject(newProjectId);
}

function confirmDeleteProject() {
    const activeProjects = projects.filter(p => !p.archived);
    if (activeProjects.length <= 1) return;
    const proj = projects.find(p => p.id === currentProjectId);
    if (confirm(`Archive "${proj?.name}"? It will be hidden but preserved, or you can delete it permanently from the Archived section.`)) {
        archiveProject(currentProjectId);
    }
}

function archiveProject(id) {
    projects = projects.map(p => p.id === id ? { ...p, archived: true } : p);
    saveAll();
    const proj = projects.find(p => p.id === id);
    showToast(`"${proj?.name}" archived.`, 'info');
    // If we archived the current project, switch to another active one
    if (id === currentProjectId) {
        const nextActive = projects.find(p => !p.archived);
        if (nextActive) switchProject(nextActive.id);
    } else {
        renderSidebar();
    }
}

function restoreProject(id) {
    projects = projects.map(p => p.id === id ? { ...p, archived: false } : p);
    saveAll();
    const proj = projects.find(p => p.id === id);
    showToast(`"${proj?.name}" restored!`, 'success');
    renderSidebar();
}

function permanentlyDeleteProject(id) {
    const proj = projects.find(p => p.id === id);
    if (!confirm(`Permanently delete "${proj?.name}" and all its tasks? This cannot be undone.`)) return;
    if (dbEnabled) dbDeleteProject(id);
    tasks    = tasks.filter(t => t.projectId !== id);
    projects = projects.filter(p => p.id !== id);
    saveAll();
    showToast(`"${proj?.name}" permanently deleted.`, 'warning');
    renderSidebar();
}

function cloneProject(sourceId) {
    const source = projects.find(p => p.id === sourceId);
    if (!source) return;

    const newProjectId = generateId();
    projects.push({ id: newProjectId, name: source.name, archived: false, order: projects.filter(p => !p.archived).length });

    // Clone tasks: keep text, priority, notes — reset progress
    const sourceTasks = tasks.filter(t => t.projectId === sourceId);
    const clonedTasks = sourceTasks.map((t, i) => ({
        id:           generateId(),
        projectId:    newProjectId,
        text:         t.text,
        completed:    false,
        timeSpent:    0,
        priority:     t.priority    || null,
        dueDate:      null,
        context:      t.context     || null,
        energy:       t.energy      || null,
        notes:        t.notes       || '',
        completedAt:  null,
        order:        t.order ?? i,
        createdAt:    new Date().toISOString(),
        recurring:    t.recurring    || false,
        recurringDay: t.recurringDay || null,
        archived:     false,
        automatable:  t.automatable  || false,
        aiSkill:      t.aiSkill      || false
    }));
    tasks.push(...clonedTasks);

    saveAll();
    renderSidebar();
    showToast(`Cloned "${source.name}" as a new project!`, 'success');
    switchProject(newProjectId);
}

// --- Natural Language Task Parsing ---
function parseNLTask(text) {
    let dueDate = null;
    let priority = null;
    let cleanText = text;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dateOf = (d) => d.toISOString().split('T')[0];
    const nextWeekday = (targetDay) => {
        const d = new Date(today);
        const diff = (targetDay - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        return dateOf(d);
    };

    // Due date patterns
    if (/\btomorrow\b/i.test(cleanText)) {
        const t = new Date(today); t.setDate(t.getDate() + 1);
        dueDate = dateOf(t);
        cleanText = cleanText.replace(/\btomorrow\b/i, '').trim();
    } else if (/\btoday\b/i.test(cleanText)) {
        dueDate = dateOf(today);
        cleanText = cleanText.replace(/\btoday\b/i, '').trim();
    } else if (/\bnext week\b/i.test(cleanText)) {
        const t = new Date(today); t.setDate(t.getDate() + 7);
        dueDate = dateOf(t);
        cleanText = cleanText.replace(/\bnext week\b/i, '').trim();
    } else {
        const days = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
        for (const [name, num] of Object.entries(days)) {
            const re = new RegExp(`\\b(on\\s+)?${name}\\b`, 'i');
            if (re.test(cleanText)) {
                dueDate = nextWeekday(num);
                cleanText = cleanText.replace(re, '').trim();
                break;
            }
        }
    }

    // Priority patterns
    if (/\b(urgent|asap|high priority|high prio)\b/i.test(cleanText)) {
        priority = 'high';
        cleanText = cleanText.replace(/\b(urgent|asap|high priority|high prio)\b/i, '').trim();
    } else if (/\bmedium priority\b/i.test(cleanText)) {
        priority = 'medium';
        cleanText = cleanText.replace(/\bmedium priority\b/i, '').trim();
    } else if (/\blow priority\b/i.test(cleanText)) {
        priority = 'low';
        cleanText = cleanText.replace(/\blow priority\b/i, '').trim();
    }

    // Clean up extra commas, multiple spaces
    cleanText = cleanText.replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();

    return { text: cleanText || text, dueDate, priority };
}

// --- Task Operations ---
function addTask(e) {
    e.preventDefault();
    const rawText = taskInput.value.trim();
    if (!rawText) return;

    // Parse natural language
    const parsed = parseNLTask(rawText);
    const taskText = parsed.text;

    // Assign order: new tasks appear at the top (lowest order value)
    const projectTasks = tasks.filter(t => t.projectId === currentProjectId);
    const minOrder = projectTasks.length > 0 ? Math.min(...projectTasks.map(t => t.order ?? 0)) : 0;

    const taskDueInput = document.getElementById('task-due-input');
    const resolvedDueDate = taskDueInput?.value || parsed.dueDate || null;
    const resolvedPriority = selectedPriority || parsed.priority || null;

    // Show toast if NL parsing found something
    if (parsed.dueDate && !taskDueInput?.value) showToast(`Due: ${formatDueDate(parsed.dueDate)}`, 'info');
    if (parsed.priority && !selectedPriority) showToast(`Priority: ${parsed.priority}`, 'info');

    const newTask = {
        id:           generateId(),
        projectId:    currentProjectId,
        text:         taskText,
        completed:    false,
        timeSpent:    0,
        priority:     resolvedPriority,
        dueDate:      resolvedDueDate,
        context:      selectedContext || null,
        energy:       selectedEnergy  || null,
        notes:        '',
        completedAt:  null,
        order:        minOrder - 1,
        createdAt:    new Date().toISOString(),
        recurring:    false,
        recurringDay: null,
        archived:     false
    };

    tasks.unshift(newTask);
    saveAll();
    updateWorkloadMeter();
    taskInput.value = '';
    if (taskDueInput) taskDueInput.value = '';
    // Reset context picker
    document.querySelectorAll('.context-btn').forEach(b => b.classList.remove('active'));
    const noneCtxBtn = document.querySelector('.context-btn[data-context=""]');
    if (noneCtxBtn) noneCtxBtn.classList.add('active');
    selectedContext = '';
    // Reset energy picker
    document.querySelectorAll('.energy-btn').forEach(b => b.classList.remove('active'));
    selectedEnergy = '';
    // Reset priority picker
    document.querySelectorAll('.prio-btn').forEach(b => b.classList.remove('active'));
    const noPrioBtn = document.querySelector('.prio-btn[data-prio=""]');
    if (noPrioBtn) noPrioBtn.classList.add('active');
    selectedPriority = '';

    if (currentFilter === 'completed') {
        document.querySelector('[data-filter="all"]')?.click();
    } else {
        renderTasks();
        renderSidebar();
    }

    // Auto-suggest priority if user didn't pick one and NL didn't detect one
    if (!resolvedPriority && aiActions.autoSuggestPriority) {
        aiActions.autoSuggestPriority(newTask.id, newTask.text);
    }
}

function toggleTask(id) {
    if (activeTimerTaskId === id) stopTimer();

    tasks = tasks.map(task => {
        if (task.id === id) {
            const nowCompleted = !task.completed;
            return {
                ...task,
                completed:   nowCompleted,
                completedAt: nowCompleted ? new Date().toISOString() : null
            };
        }
        return task;
    });
    saveAll();
    // Targeted single-task update so Supabase gets the new completed state
    // immediately, without waiting for the bulk dbSaveTasks to finish.
    if (dbEnabled) {
        const updated = tasks.find(t => t.id === id);
        if (updated) dbUpdateTask(updated);
    }
    renderTasks();
    renderSidebar();
}

function deleteTask(id, element) {
    if (activeTimerTaskId === id) stopTimer();
    if (dbEnabled) dbDeleteTask(id);
    element.classList.add('removing');
    setTimeout(() => {
        tasks = tasks.filter(task => task.id !== id);
        saveAll();
        renderTasks();
        renderSidebar();
    }, 300);
}

function completeAllTasks() {
    let changed = false;
    tasks = tasks.map(task => {
        if (task.projectId === currentProjectId && !task.completed) {
            changed = true;
            return { ...task, completed: true, completedAt: new Date().toISOString() };
        }
        return task;
    });

    if (changed) {
        saveAll();
        renderTasks();
        renderSidebar();
        showToast('All tasks completed!', 'success');
    }
}

function clearCompletedTasks() {
    const completed = tasks.filter(t => t.projectId === currentProjectId && t.completed && !t.archived);
    if (completed.length === 0) {
        showToast('No completed tasks to clear.', 'info');
        return;
    }
    if (confirm(`Clear ${completed.length} completed task(s)? They'll be kept in history for the AI.`)) {
        tasks = tasks.map(t =>
            (t.projectId === currentProjectId && t.completed && !t.archived)
                ? { ...t, archived: true }
                : t
        );
        saveAll();
        renderTasks();
        renderSidebar();
        showToast(`${completed.length} task(s) cleared.`, 'success');
    }
}

// --- Timer Logic ---
function startTimer(taskId) {
    if (activeTimerTaskId) stopTimer();

    activeTimerTaskId = taskId;
    timeRemaining = pomodoroDuration;

    globalTimerEl.classList.remove('hidden');
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();

        tasks = tasks.map(t => {
            if (t.id === activeTimerTaskId) {
                return { ...t, timeSpent: (t.timeSpent || 0) + 1 };
            }
            return t;
        });

        if (timeRemaining % 10 === 0) {
            saveAll();
            if (timeRemaining % 60 === 0) renderTasks();
        }

        if (timeRemaining <= 0) {
            stopTimer();
            showToast('Focus session complete! Great work.', 'timer', 5000);
        }
    }, 1000);

    renderTasks();
}

function restartTimer() {
    if (activeTimerTaskId) {
        timeRemaining = pomodoroDuration;
        updateTimerDisplay();
    }
}

function stopTimer() {
    const sessionDuration = pomodoroDuration - timeRemaining;
    if (activeTimerTaskId) logTimerSession(activeTimerTaskId, sessionDuration);

    clearInterval(timerInterval);
    activeTimerTaskId = null;
    timerInterval = null;
    saveAll();

    updateBudgetWidget();
    globalTimerEl.classList.add('hidden');
    renderTasks();
}

function updateTimerDisplay() {
    if (!timerDisplayEl) return;
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    timerDisplayEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function editTask(id, element, currentText) {
    const taskMain    = element.querySelector('.task-main');
    const contentDiv  = taskMain.querySelector('.task-content');
    const actionsDiv  = taskMain.querySelector('.task-actions');
    const dragHandle  = taskMain.querySelector('.drag-handle');

    if (contentDiv)  contentDiv.style.display = 'none';
    if (actionsDiv)  actionsDiv.style.display  = 'none';
    if (dragHandle)  dragHandle.style.display  = 'none';

    const form = document.createElement('form');
    form.style.width   = '100%';
    form.style.display = 'flex';
    form.style.gap     = '0.5rem';

    const input = document.createElement('input');
    input.type      = 'text';
    input.value     = currentText;
    input.className = 'edit-input';

    const saveBtn = document.createElement('button');
    saveBtn.type      = 'submit';
    saveBtn.className = 'action-btn';
    saveBtn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--accent-success)"></i>';

    form.appendChild(input);
    form.appendChild(saveBtn);
    taskMain.appendChild(form);

    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;

    const saveHandler = (e) => {
        e?.preventDefault();
        const newText = input.value.trim();
        if (newText) {
            tasks = tasks.map(task =>
                task.id === id ? { ...task, text: newText } : task
            );
            saveAll();
        }
        renderTasks();
    };

    form.addEventListener('submit', saveHandler);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') renderTasks();
    });
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Export Data ---
function exportData() {
    const today = new Date();
    const dd = today.getDate().toString().padStart(2, '0');
    const mm = (today.getMonth() + 1).toString().padStart(2, '0');
    const yyyy = today.getFullYear();
    const filename = `arcforge-${yyyy}${mm}${dd}.json`;

    const data = {
        exportedAt: today.toISOString(),
        projects,
        tasks,
        templates
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Data exported successfully!', 'success');
}

// --- View switching — one function hides everything, then shows target ---
const ALL_VIEWS = () => [workspaceView, historyView, weeklyView, streaksView, shelfView, goalsView, pipelineView].filter(Boolean);

function switchToView(target) {
    ALL_VIEWS().forEach(v => {
        if (v === target) {
            v.classList.remove('hidden');
            v.classList.remove('view-enter');
            void v.offsetWidth;
            v.classList.add('view-enter');
        } else {
            v.classList.add('hidden');
        }
    });
}

// --- History View Logic ---
function showHistory() {
    switchToView(historyView);
    closeSidebar();
    document.getElementById('mobile-history-btn-nav')?.classList.add('active');
    document.getElementById('mobile-menu-btn')?.classList.remove('active');
    renderHistory();
}

function showWorkspace() {
    switchToView(workspaceView);
    document.getElementById('mobile-history-btn-nav')?.classList.remove('active');
}

// =====================================================
// STALE PROJECT DETECTION
// =====================================================

function isProjectStale(projectId) {
    const projTasks = tasks.filter(t => t.projectId === projectId);
    if (projTasks.length === 0) return false;
    const pendingTasks = projTasks.filter(t => !t.completed);
    if (pendingTasks.length === 0) return false;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCompletion = projTasks.some(t =>
        t.completed && t.completedAt && new Date(t.completedAt) > sevenDaysAgo
    );
    return !recentCompletion;
}

// =====================================================
// DAILY CHECK-IN
// =====================================================

function todayDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function shouldShowCheckIn() {
    const today = todayDateStr();
    return !checkInLog.some(entry => entry.date === today);
}

function showCheckIn() {
    const overlay = document.getElementById('checkin-overlay');
    if (overlay) overlay.classList.remove('hidden');
    setTimeout(() => {
        const input = document.getElementById('checkin-top-task');
        if (input) input.focus();
    }, 400);
}

function hideCheckIn() {
    const overlay = document.getElementById('checkin-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function submitCheckIn(skipped = false) {
    const topTask  = skipped ? '' : (document.getElementById('checkin-top-task')?.value.trim() || '');
    const completed = skipped ? '' : (document.getElementById('checkin-completed-yesterday')?.value.trim() || '');

    checkInLog.push({
        date:               todayDateStr(),
        topTask:            topTask,
        completedYesterday: completed,
        skipped:            skipped
    });
    // Keep last 30 days
    if (checkInLog.length > 30) checkInLog = checkInLog.slice(-30);
    localStorage.setItem('arcforgeCheckInLog', JSON.stringify(checkInLog));
    if (dbEnabled) dbSaveSetting('checkInLog', JSON.stringify(checkInLog));

    hideCheckIn();

    if (!skipped && topTask) {
        showToast(`Set "${topTask}" as your #1 focus today.`, 'success', 4000);
    }
}

// ================================================================
// GOALS
// ================================================================

let goals = [];

const GOAL_DEFAULTS = [
    {
        id: 'g-agency', name: 'Creative Direction Agency', target: '$300K / year',
        color: 'goal-agency',
        milestones: [
            { id: 'mg-a1', text: 'Land first client', done: false },
            { id: 'mg-a2', text: 'Hire first editor', done: false },
            { id: 'mg-a3', text: 'Build full team', done: false },
            { id: 'mg-a4', text: 'Reach $100K revenue', done: false },
            { id: 'mg-a5', text: 'Reach $300K revenue', done: false },
        ],
        createdAt: new Date().toISOString(),
    },
    {
        id: 'g-youtube', name: 'Brazilian YouTube Channel', target: 'Impact lives in Brazil',
        color: 'goal-youtube',
        milestones: [
            { id: 'mg-y1', text: 'Post first video', done: false },
            { id: 'mg-y2', text: 'Reach 10K subscribers', done: false },
            { id: 'mg-y3', text: 'Reach 100K subscribers', done: false },
            { id: 'mg-y4', text: 'Fund first Brazil project', done: false },
        ],
        createdAt: new Date().toISOString(),
    },
    {
        id: 'g-saas', name: 'SaaS for Video Editors', target: 'Validate & launch',
        color: 'goal-saas',
        milestones: [
            { id: 'mg-s1', text: 'Define core pain point', done: false },
            { id: 'mg-s2', text: 'Interview 10 editors', done: false },
            { id: 'mg-s3', text: 'Build MVP', done: false },
            { id: 'mg-s4', text: 'First paying user', done: false },
        ],
        createdAt: new Date().toISOString(),
    },
];

function loadGoals() {
    try {
        const g = JSON.parse(localStorage.getItem('arcforgeGoals') || 'null');
        if (Array.isArray(g) && g.length > 0) { goals = g; return; }
    } catch(e) {}
    // localStorage empty — seed defaults, no timestamp so cloud can override
    goals = JSON.parse(JSON.stringify(GOAL_DEFAULTS));
    localStorage.setItem('arcforgeGoals', JSON.stringify(goals));
}

function saveGoals() {
    const ts = new Date().toISOString();
    localStorage.setItem('arcforgeGoals', JSON.stringify(goals));
    localStorage.setItem('arcforgeGoalsTs', ts);
    if (dbEnabled) {
        dbSaveSetting('arcforgeGoals', JSON.stringify(goals));
        dbSaveSetting('arcforgeGoalsTs', ts);
    }
}

async function syncGoalsFromCloud() {
    if (!dbEnabled) return;
    try {
        const localTs = localStorage.getItem('arcforgeGoalsTs') || '';
        const [str, cloudTs] = await Promise.all([
            dbLoadSetting('arcforgeGoals'),
            dbLoadSetting('arcforgeGoalsTs'),
        ]);

        if (!str) {
            // Nothing in cloud — push local up
            dbSaveSetting('arcforgeGoals', JSON.stringify(goals));
            if (localTs) dbSaveSetting('arcforgeGoalsTs', localTs);
            return;
        }

        if (cloudTs && cloudTs > localTs) {
            // Cloud is newer (e.g. saved on phone) — use it
            const g = JSON.parse(str);
            if (Array.isArray(g) && g.length > 0) {
                goals = g;
                localStorage.setItem('arcforgeGoals', str);
                localStorage.setItem('arcforgeGoalsTs', cloudTs);
                renderGoals();
            }
        } else {
            // Local is newer or equal — push local to cloud
            dbSaveSetting('arcforgeGoals', JSON.stringify(goals));
            if (localTs) dbSaveSetting('arcforgeGoalsTs', localTs);
        }
    } catch(e) {}
}

function showGoals() {
    switchToView(goalsView);
    closeSidebar();
    renderGoals();
}

function renderGoals() {
    const bodyEl   = document.getElementById('goals-body');
    const summaryEl = document.getElementById('goals-summary-text');
    if (!bodyEl) return;

    const totalMilestones = goals.reduce((s, g) => s + g.milestones.length, 0);
    const doneMilestones  = goals.reduce((s, g) => s + g.milestones.filter(m => m.done).length, 0);
    if (summaryEl) summaryEl.textContent = `${doneMilestones} of ${totalMilestones} milestones complete`;

    bodyEl.innerHTML = goals.map(goal => {
        const done  = goal.milestones.filter(m => m.done).length;
        const total = goal.milestones.length;
        const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
        return `
        <div class="goal-card ${goal.color || ''}">
            <div class="goal-card-header">
                <div class="goal-card-title-wrap">
                    <span class="goal-card-name">${goal.name}</span>
                    <span class="goal-card-target">${goal.target}</span>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem">
                    <div class="goal-progress-wrap">
                        <div class="goal-progress-bar-bg">
                            <div class="goal-progress-bar-fill" style="width:${pct}%"></div>
                        </div>
                        <span class="goal-progress-label">${pct}%</span>
                    </div>
                    <button class="goal-delete-btn" data-goal="${goal.id}" title="Delete goal"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <ul class="goal-milestones">
                ${goal.milestones.map(m => `
                <li class="goal-milestone${m.done ? ' done' : ''}" data-goal="${goal.id}" data-m="${m.id}">
                    <label class="habit-checkbox-wrap" style="width:20px;height:20px">
                        <input type="checkbox" class="habit-checkbox milestone-cb" ${m.done ? 'checked' : ''} data-goal="${goal.id}" data-m="${m.id}">
                        <div class="habit-custom-checkbox"><i class="fa-solid fa-check"></i></div>
                    </label>
                    <span class="goal-milestone-text">${m.text}</span>
                </li>`).join('')}
            </ul>
            <div class="goal-add-milestone">
                <input type="text" class="milestone-new-input" placeholder="Add milestone…" data-goal="${goal.id}" maxlength="80">
                <button class="milestone-add-btn" data-goal="${goal.id}"><i class="fa-solid fa-plus"></i></button>
            </div>
        </div>`;
    }).join('') + `
    <div class="goal-card goal-add-card">
        <span class="goal-add-card-label"><i class="fa-solid fa-plus"></i> New Goal</span>
        <div class="goal-add-form">
            <input type="text" id="new-goal-name" placeholder="Goal name…" maxlength="60">
            <input type="text" id="new-goal-target" placeholder="Target (e.g. $100K / year)…" maxlength="60">
            <div class="goal-color-picker">
                <label title="Amber"><input type="radio" name="goal-color" value="goal-agency" checked><span class="goal-color-dot" style="background:#f59e0b"></span></label>
                <label title="Red"><input type="radio" name="goal-color" value="goal-youtube"><span class="goal-color-dot" style="background:#ef4444"></span></label>
                <label title="Purple"><input type="radio" name="goal-color" value="goal-saas"><span class="goal-color-dot" style="background:#818cf8"></span></label>
                <label title="Green"><input type="radio" name="goal-color" value="goal-green"><span class="goal-color-dot" style="background:#22c55e"></span></label>
                <label title="Blue"><input type="radio" name="goal-color" value="goal-blue"><span class="goal-color-dot" style="background:#38bdf8"></span></label>
                <label title="Pink"><input type="radio" name="goal-color" value="goal-pink"><span class="goal-color-dot" style="background:#f472b6"></span></label>
            </div>
            <button id="add-goal-btn"><i class="fa-solid fa-check"></i> Add Goal</button>
        </div>
    </div>`;

    // Milestone checkbox toggle
    bodyEl.querySelectorAll('.milestone-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const g = goals.find(g => g.id === cb.dataset.goal);
            const m = g?.milestones.find(m => m.id === cb.dataset.m);
            if (m) { m.done = cb.checked; saveGoals(); renderGoals(); }
        });
    });

    // Add milestone
    bodyEl.querySelectorAll('.milestone-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const goalId = btn.dataset.goal;
            const input  = bodyEl.querySelector(`.milestone-new-input[data-goal="${goalId}"]`);
            const text   = (input?.value || '').trim();
            if (!text) return;
            const g = goals.find(g => g.id === goalId);
            if (g) {
                g.milestones.push({ id: `mg-${Date.now()}`, text, done: false });
                saveGoals();
                renderGoals();
            }
        });
    });
    bodyEl.querySelectorAll('.milestone-new-input').forEach(input => {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                bodyEl.querySelector(`.milestone-add-btn[data-goal="${input.dataset.goal}"]`)?.click();
            }
        });
    });

    // Delete goal
    bodyEl.querySelectorAll('.goal-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Delete this goal and all its milestones?')) return;
            goals = goals.filter(g => g.id !== btn.dataset.goal);
            saveGoals();
            renderGoals();
        });
    });

    // Add new goal
    bodyEl.querySelector('#add-goal-btn')?.addEventListener('click', () => {
        const name   = bodyEl.querySelector('#new-goal-name')?.value.trim();
        const target = bodyEl.querySelector('#new-goal-target')?.value.trim();
        const color  = bodyEl.querySelector('input[name="goal-color"]:checked')?.value || 'goal-agency';
        if (!name) return;
        goals.push({ id: `g-${Date.now()}`, name, target: target || '', color, milestones: [], createdAt: new Date().toISOString() });
        saveGoals();
        renderGoals();
    });
    bodyEl.querySelector('#new-goal-name')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') bodyEl.querySelector('#add-goal-btn')?.click();
    });

    // Back button
    document.getElementById('goals-back-btn')?.addEventListener('click', showWorkspace);
}

function getGoalsContext() {
    if (!goals.length) return '';
    let text = '\n## Goals & milestones\n';
    goals.forEach(g => {
        const done = g.milestones.filter(m => m.done).length;
        text += `\n### ${g.name} (target: ${g.target}) — ${done}/${g.milestones.length} milestones\n`;
        g.milestones.forEach(m => { text += `- [${m.done ? 'x' : ' '}] ${m.text}\n`; });
    });
    return text;
}

loadGoals();
syncGoalsFromCloud();

// ================================================================
// CLIENT PIPELINE
// ================================================================

let clients = [];

const PIPELINE_STATUSES = {
    pitching:  { label: 'Pitching',   color: 'status-pitching' },
    active:    { label: 'Active',     color: 'status-active' },
    delivered: { label: 'Delivered',  color: 'status-delivered' },
    paid:      { label: 'Paid',       color: 'status-paid' },
};

function loadClients() {
    try {
        const c = JSON.parse(localStorage.getItem('arcforgeClients') || '[]');
        if (Array.isArray(c)) clients = c;
    } catch(e) {}
}

function saveClients() {
    const ts = new Date().toISOString();
    localStorage.setItem('arcforgeClients', JSON.stringify(clients));
    localStorage.setItem('arcforgeClientsTs', ts);
    if (dbEnabled) {
        dbSaveSetting('arcforgeClients', JSON.stringify(clients));
        dbSaveSetting('arcforgeClientsTs', ts);
    }
}

async function syncClientsFromCloud() {
    if (!dbEnabled) return;
    try {
        const localTs = localStorage.getItem('arcforgeClientsTs') || '';
        const [str, cloudTs] = await Promise.all([
            dbLoadSetting('arcforgeClients'),
            dbLoadSetting('arcforgeClientsTs'),
        ]);
        if (!str) {
            if (clients.length) {
                dbSaveSetting('arcforgeClients', JSON.stringify(clients));
                if (localTs) dbSaveSetting('arcforgeClientsTs', localTs);
            }
            return;
        }
        if (cloudTs && cloudTs > localTs) {
            const c = JSON.parse(str);
            if (Array.isArray(c)) {
                clients = c;
                localStorage.setItem('arcforgeClients', str);
                localStorage.setItem('arcforgeClientsTs', cloudTs);
                renderPipeline();
            }
        } else {
            dbSaveSetting('arcforgeClients', JSON.stringify(clients));
            if (localTs) dbSaveSetting('arcforgeClientsTs', localTs);
        }
    } catch(e) {}
}

function showPipeline() {
    switchToView(pipelineView);
    closeSidebar();
    renderPipeline();
}

function renderPipeline() {
    const bodyEl    = document.getElementById('pipeline-body');
    const summaryEl = document.getElementById('pipeline-summary-text');
    if (!bodyEl) return;

    const totalValue    = clients.reduce((s, c) => s + (Number(c.value) || 0), 0);
    const activeValue   = clients.filter(c => c.status === 'active').reduce((s, c) => s + (Number(c.value) || 0), 0);
    const pendingValue  = clients.filter(c => ['pitching','active','delivered'].includes(c.status)).reduce((s, c) => s + (Number(c.value) || 0), 0);
    if (summaryEl) {
        summaryEl.textContent = clients.length
            ? `$${pendingValue.toLocaleString()} pending · $${clients.filter(c=>c.status==='paid').reduce((s,c)=>s+(Number(c.value)||0),0).toLocaleString()} collected`
            : 'Track your client work and revenue.';
    }

    if (!clients.length) {
        bodyEl.innerHTML = `<div class="streaks-empty"><i class="fa-solid fa-briefcase"></i><p>No clients yet. Hit <strong>+</strong> to add one.</p></div>`;
        return;
    }

    const order = ['active','pitching','delivered','paid'];
    let html = '';
    order.forEach(status => {
        const group = clients.filter(c => c.status === status);
        if (!group.length) return;
        const { label, color } = PIPELINE_STATUSES[status];
        const groupValue = group.reduce((s, c) => s + (Number(c.value) || 0), 0);
        html += `
        <div class="pipeline-group">
            <div class="pipeline-group-header">
                <span class="pipeline-status-badge ${color}">${label}</span>
                <span class="pipeline-group-value">$${groupValue.toLocaleString()}</span>
            </div>
            ${group.map(c => `
            <div class="pipeline-card" data-id="${c.id}">
                <div class="pipeline-card-main">
                    <div class="pipeline-card-info">
                        <span class="pipeline-client-name">${c.name}</span>
                        ${c.project ? `<span class="pipeline-project">${c.project}</span>` : ''}
                        ${c.notes ? `<span class="pipeline-notes">${c.notes}</span>` : ''}
                    </div>
                    <div class="pipeline-card-right">
                        <span class="pipeline-value">$${(Number(c.value)||0).toLocaleString()}</span>
                        <select class="book-status-select pipeline-status-select" data-id="${c.id}">
                            ${order.map(s => `<option value="${s}" ${c.status===s?'selected':''}>${PIPELINE_STATUSES[s].label}</option>`).join('')}
                        </select>
                        <button class="book-delete-btn pipeline-delete-btn" data-id="${c.id}" title="Remove"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            </div>`).join('')}
        </div>`;
    });
    bodyEl.innerHTML = html;

    bodyEl.querySelectorAll('.pipeline-status-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const client = clients.find(c => c.id === sel.dataset.id);
            if (client) { client.status = sel.value; saveClients(); renderPipeline(); }
        });
    });
    bodyEl.querySelectorAll('.pipeline-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Remove this client?')) return;
            clients = clients.filter(c => c.id !== btn.dataset.id);
            saveClients(); renderPipeline();
        });
    });
    document.getElementById('pipeline-back-btn')?.addEventListener('click', showWorkspace);
}

function initPipeline() {
    loadClients();
    syncClientsFromCloud();

    const overlay     = document.getElementById('add-client-overlay');
    const addBtn      = document.getElementById('add-client-btn');
    const closeBtn    = document.getElementById('close-client-modal-btn');
    const cancelBtn   = document.getElementById('cancel-client-btn');
    const saveBtn     = document.getElementById('save-client-btn');
    const nameInput   = document.getElementById('client-name-input');
    const projInput   = document.getElementById('client-project-input');
    const valueInput  = document.getElementById('client-value-input');
    const statusInput = document.getElementById('client-status-input');

    function openModal()  { overlay?.classList.remove('hidden'); nameInput?.focus(); }
    function closeModal() {
        overlay?.classList.add('hidden');
        if (nameInput)   nameInput.value  = '';
        if (projInput)   projInput.value  = '';
        if (valueInput)  valueInput.value = '';
        if (statusInput) statusInput.selectedIndex = 0;
    }

    addBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    overlay?.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    saveBtn?.addEventListener('click', () => {
        const name = (nameInput?.value || '').trim();
        if (!name) { nameInput?.focus(); return; }
        clients.push({
            id: `cl-${Date.now()}`,
            name,
            project: (projInput?.value || '').trim(),
            value:   Number(valueInput?.value) || 0,
            status:  statusInput?.value || 'active',
            notes:   '',
            createdAt: new Date().toISOString(),
        });
        saveClients();
        closeModal();
        renderPipeline();
    });
}

function getPipelineContext() {
    if (!clients.length) return '';
    const totalValue   = clients.reduce((s, c) => s + (Number(c.value) || 0), 0);
    const active       = clients.filter(c => c.status === 'active');
    const pitching     = clients.filter(c => c.status === 'pitching');
    const unpaid       = clients.filter(c => ['active','delivered'].includes(c.status));
    let text = '\n## Client pipeline\n';
    text += `Total pipeline value: $${totalValue.toLocaleString()}\n`;
    if (active.length)   text += `Active: ${active.map(c => `${c.name} ($${(Number(c.value)||0).toLocaleString()})`).join(', ')}\n`;
    if (pitching.length) text += `Pitching: ${pitching.map(c => c.name).join(', ')}\n`;
    if (unpaid.length)   text += `Awaiting payment: ${unpaid.map(c => `${c.name} ($${(Number(c.value)||0).toLocaleString()})`).join(', ')}\n`;
    return text;
}

initPipeline();

// ================================================================
// TIME BUDGET — session logging + weekly widget
// ================================================================

let buildHoursGoal = 15; // hours per week — configurable

function loadBuildGoal() {
    try {
        const stored = localStorage.getItem('arcforgeBuildGoal');
        if (stored) buildHoursGoal = Number(stored) || 15;
    } catch(e) {}
}

function saveBuildGoal(hours) {
    buildHoursGoal = hours;
    localStorage.setItem('arcforgeBuildGoal', String(hours));
    if (dbEnabled) dbSaveSetting('arcforgeBuildGoal', String(hours));
    updateBudgetWidget();
}

async function syncBuildGoalFromCloud() {
    if (!dbEnabled) return;
    try {
        const str = await dbLoadSetting('arcforgeBuildGoal');
        if (str) {
            buildHoursGoal = Number(str) || 15;
            localStorage.setItem('arcforgeBuildGoal', str);
            updateBudgetWidget();
        } else {
            dbSaveSetting('arcforgeBuildGoal', String(buildHoursGoal));
        }
    } catch(e) {}
}

function logTimerSession(taskId, durationSeconds) {
    if (durationSeconds < 10) return;
    try {
        const sessions = JSON.parse(localStorage.getItem('arcforgeTimeSessions') || '[]');
        sessions.push({ sid: `ts-${Date.now()}`, taskId, duration: durationSeconds, date: todayStr() });
        // Keep only last 90 days
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = [cutoff.getFullYear(), String(cutoff.getMonth()+1).padStart(2,'0'), String(cutoff.getDate()).padStart(2,'0')].join('-');
        const filtered = sessions.filter(s => s.date >= cutoffStr);
        localStorage.setItem('arcforgeTimeSessions', JSON.stringify(filtered));
        if (dbEnabled) dbSaveSetting('arcforgeTimeSessions', JSON.stringify(filtered));
    } catch(e) {}
}

async function syncTimeSessionsFromCloud() {
    if (!dbEnabled) return;
    try {
        const str = await dbLoadSetting('arcforgeTimeSessions');
        const local = JSON.parse(localStorage.getItem('arcforgeTimeSessions') || '[]');
        if (!str) {
            if (local.length > 0) dbSaveSetting('arcforgeTimeSessions', JSON.stringify(local));
            return;
        }
        const cloud = JSON.parse(str);
        // Merge: union by sid (new sessions) or composite key (legacy sessions without sid)
        const merged = [...local];
        const localKeys = new Set(local.map(s => s.sid || `${s.taskId}|${s.date}|${s.duration}`));
        for (const s of cloud) {
            const key = s.sid || `${s.taskId}|${s.date}|${s.duration}`;
            if (!localKeys.has(key)) { merged.push(s); localKeys.add(key); }
        }
        localStorage.setItem('arcforgeTimeSessions', JSON.stringify(merged));
        if (merged.length > local.length) dbSaveSetting('arcforgeTimeSessions', JSON.stringify(merged));
        updateBudgetWidget();
    } catch(e) {}
}

function getWeeklyTrackedSeconds() {
    try {
        const sessions = JSON.parse(localStorage.getItem('arcforgeTimeSessions') || '[]');
        const today = new Date();
        const dow = today.getDay(); // 0=Sun
        const daysFromMon = dow === 0 ? 6 : dow - 1;
        const mon = new Date(today); mon.setDate(today.getDate() - daysFromMon);
        const monStr = [mon.getFullYear(), String(mon.getMonth()+1).padStart(2,'0'), String(mon.getDate()).padStart(2,'0')].join('-');
        return sessions.filter(s => s.date >= monStr).reduce((sum, s) => sum + s.duration, 0);
    } catch(e) { return 0; }
}

function updateBudgetWidget() {
    const statsEl = document.getElementById('build-budget-stats');
    const barEl   = document.getElementById('build-budget-bar');
    if (!statsEl || !barEl) return;
    const totalSecs  = getWeeklyTrackedSeconds();
    const totalHours = totalSecs / 3600;
    const pct        = Math.min(100, Math.round((totalHours / buildHoursGoal) * 100));
    const hDisplay   = totalHours >= 1 ? `${totalHours.toFixed(1)}h` : `${Math.round(totalSecs / 60)}m`;
    statsEl.textContent = `${hDisplay} / ${buildHoursGoal}h`;
    barEl.style.width   = `${pct}%`;
    barEl.style.background = pct >= 100 ? 'var(--accent-success, #4ade80)' : 'var(--accent-primary)';
}

function getTimeBudgetContext() {
    const secs  = getWeeklyTrackedSeconds();
    const hours = (secs / 3600).toFixed(1);
    return `\n## Build time budget\nWeekly goal: ${buildHoursGoal} hours. This week tracked: ${hours} hours. Remaining: ${Math.max(0, buildHoursGoal - Number(hours)).toFixed(1)} hours.\n`;
}

loadBuildGoal();
updateBudgetWidget();
syncBuildGoalFromCloud();
syncTimeSessionsFromCloud();

// Edit weekly goal button
document.getElementById('build-goal-edit-btn')?.addEventListener('click', () => {
    const current = buildHoursGoal;
    const statsEl = document.getElementById('build-budget-stats');
    const btn = document.getElementById('build-goal-edit-btn');
    if (!statsEl) return;
    const input = document.createElement('input');
    input.type = 'number'; input.min = '1'; input.max = '168';
    input.value = current; input.className = 'build-goal-input';
    statsEl.replaceWith(input);
    btn.style.display = 'none';
    input.focus(); input.select();
    const confirm = () => {
        const val = Math.max(1, Math.min(168, Number(input.value) || current));
        const newStats = document.createElement('div');
        newStats.className = 'build-budget-stats'; newStats.id = 'build-budget-stats';
        input.replaceWith(newStats);
        btn.style.display = '';
        saveBuildGoal(val);
    };
    input.addEventListener('blur', confirm);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = current; input.blur(); } });
});

// ================================================================
// SHIP IT — stale task detection
// ================================================================

function getStaleTasksContext() {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    const staleTasks = tasks.filter(t => {
        if (t.completed || t.archived) return false;
        const created = t.createdAt ? new Date(t.createdAt) : null;
        return created && created < cutoff;
    });
    if (!staleTasks.length) return '';
    let text = '\n## ⚠️ Stale tasks (pending > 7 days — possible perfectionism or avoidance)\n';
    staleTasks.slice(0, 8).forEach(t => {
        const days = Math.floor((Date.now() - new Date(t.createdAt)) / 86400000);
        text += `- "${t.text}" (${days} days pending${t.priority === 'high' ? ', HIGH PRIORITY' : ''})\n`;
    });
    text += `\nIf any of these are YouTube or creative work, call it out directly — Bruno tends to hold back creative work waiting for it to be "perfect". Push him to ship.\n`;
    return text;
}

// ================================================================
// SHELF — book tracker
// ================================================================

let books = [];
let shelfFilter = 'reading'; // 'reading' | 'done' | 'want-to-read'
// books: [{ id, title, author, category, status, note, createdAt }]

const BOOK_CATEGORIES = {
    business:     { label: 'Business',     css: 'book-cat-business' },
    creativity:   { label: 'Creativity',   css: 'book-cat-creativity' },
    storytelling: { label: 'Storytelling', css: 'book-cat-storytelling' },
    investing:    { label: 'Investing',    css: 'book-cat-investing' },
    other:        { label: 'Other',        css: 'book-cat-other' },
};
const STATUS_LABELS = { reading: 'Reading', done: 'Done', 'want-to-read': 'Want to Read' };

function loadBooksFromStorage() {
    try {
        const b = JSON.parse(localStorage.getItem('arcforgeBooks') || '[]');
        if (Array.isArray(b)) books = b;
    } catch(e) {}
}

function saveBooksToStorage() {
    const ts = new Date().toISOString();
    localStorage.setItem('arcforgeBooks', JSON.stringify(books));
    localStorage.setItem('arcforgeBooksTs', ts);
    if (dbEnabled) {
        dbSaveSetting('arcforgeBooks', JSON.stringify(books));
        dbSaveSetting('arcforgeBooksTs', ts);
    }
}

async function loadBooksFromCloud() {
    if (!dbEnabled) return;
    try {
        const localTs = localStorage.getItem('arcforgeBooksTs') || '';
        const [bStr, cloudTs] = await Promise.all([
            dbLoadSetting('arcforgeBooks'),
            dbLoadSetting('arcforgeBooksTs'),
        ]);
        if (!bStr) {
            if (books.length) {
                dbSaveSetting('arcforgeBooks', JSON.stringify(books));
                if (localTs) dbSaveSetting('arcforgeBooksTs', localTs);
            }
            return;
        }
        if (cloudTs && cloudTs > localTs) {
            const b = JSON.parse(bStr);
            if (Array.isArray(b)) {
                books = b;
                localStorage.setItem('arcforgeBooks', bStr);
                localStorage.setItem('arcforgeBooksTs', cloudTs);
                renderShelf();
            }
        } else {
            dbSaveSetting('arcforgeBooks', JSON.stringify(books));
            if (localTs) dbSaveSetting('arcforgeBooksTs', localTs);
        }
    } catch(e) {}
}

function showShelf() {
    switchToView(shelfView);
    closeSidebar();
    renderShelf();
}

function renderShelf() {
    const listEl   = document.getElementById('book-list');
    const emptyEl  = document.getElementById('shelf-empty');
    const countEl  = document.getElementById('shelf-count-text');
    if (!listEl) return;

    const filtered = books.filter(b => b.status === shelfFilter);

    // Update filter tab labels with counts + active state
    document.querySelectorAll('[data-shelf-filter]').forEach(btn => {
        const f = btn.dataset.shelfFilter;
        const count = books.filter(b => b.status === f).length;
        btn.textContent = count > 0 ? `${STATUS_LABELS[f]} (${count})` : STATUS_LABELS[f];
        btn.classList.toggle('active', f === shelfFilter);
    });

    if (filtered.length === 0) {
        listEl.innerHTML = '';
        emptyEl?.classList.remove('hidden');
        if (countEl) countEl.textContent = `No ${STATUS_LABELS[shelfFilter].toLowerCase()} books yet.`;
        return;
    }
    emptyEl?.classList.add('hidden');
    if (countEl) countEl.textContent = `${filtered.length} book${filtered.length === 1 ? '' : 's'} — ${STATUS_LABELS[shelfFilter]}`;

    listEl.innerHTML = filtered.map(b => {
        const cat = BOOK_CATEGORIES[b.category] || BOOK_CATEGORIES.other;
        return `
        <li class="book-item" data-id="${b.id}">
            <div class="book-main">
                <div class="book-info">
                    <div class="book-header-row">
                        <span class="book-title">${b.title}</span>
                        <span class="context-badge ${cat.css}">${cat.label}</span>
                    </div>
                    <span class="book-author">${b.author || ''}</span>
                    ${b.note ? `<span class="book-note">"${b.note}"</span>` : ''}
                </div>
                <div class="book-actions">
                    <select class="book-status-select" data-id="${b.id}">
                        <option value="reading" ${b.status === 'reading' ? 'selected' : ''}>Reading</option>
                        <option value="done" ${b.status === 'done' ? 'selected' : ''}>Done</option>
                        <option value="want-to-read" ${b.status === 'want-to-read' ? 'selected' : ''}>Want to Read</option>
                    </select>
                    <button class="book-delete-btn" data-id="${b.id}" title="Remove book">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            ${b.status === 'done' && b.note == null ? `
            <div class="book-note-prompt" data-id="${b.id}">
                <input type="text" class="book-note-input" placeholder="One thing you took from this?" maxlength="140">
                <div class="book-note-prompt-actions">
                    <button class="book-note-save-btn btn primary-btn">Save</button>
                    <button class="book-note-dismiss-btn text-btn">Dismiss</button>
                </div>
            </div>` : ''}
        </li>`;
    }).join('');

    // Status change
    listEl.querySelectorAll('.book-status-select').forEach(sel => {
        sel.addEventListener('change', () => {
            const book = books.find(b => b.id === sel.dataset.id);
            if (!book) return;
            book.status = sel.value;
            saveBooksToStorage();
            renderShelf();
        });
    });

    // Note save
    listEl.querySelectorAll('.book-note-save-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.closest('.book-note-prompt');
            const id = prompt.dataset.id;
            const input = prompt.querySelector('.book-note-input');
            const note = (input.value || '').trim();
            if (!note) return;
            const book = books.find(b => b.id === id);
            if (book) { book.note = note; saveBooksToStorage(); renderShelf(); }
        });
    });

    // Note dismiss
    listEl.querySelectorAll('.book-note-dismiss-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.closest('.book-note-prompt');
            const id = prompt.dataset.id;
            // Mark with empty string to prevent re-showing (truthy check distinguishes from null)
            const book = books.find(b => b.id === id);
            if (book) { book.note = ''; saveBooksToStorage(); renderShelf(); }
        });
    });

    // Delete
    listEl.querySelectorAll('.book-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!confirm('Remove this book from your shelf?')) return;
            books = books.filter(b => b.id !== btn.dataset.id);
            saveBooksToStorage();
            renderShelf();
        });
    });
}

function initShelf() {
    loadBooksFromStorage();
    loadBooksFromCloud();

    const addBtn      = document.getElementById('add-book-btn');
    const overlay     = document.getElementById('add-book-overlay');
    const closeBtn    = document.getElementById('close-book-modal-btn');
    const cancelBtn   = document.getElementById('cancel-book-btn');
    const saveBtn     = document.getElementById('save-book-btn');
    const titleInput  = document.getElementById('book-title-input');
    const authorInput = document.getElementById('book-author-input');
    const catInput    = document.getElementById('book-category-input');
    const statusInput = document.getElementById('book-status-input');
    const backBtn     = document.getElementById('shelf-back-btn');

    if (backBtn) backBtn.addEventListener('click', showWorkspace);

    // Filter tabs
    document.querySelectorAll('[data-shelf-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            shelfFilter = btn.dataset.shelfFilter;
            renderShelf();
        });
    });

    function openModal() {
        if (!overlay) return;
        overlay.classList.remove('hidden');
        titleInput?.focus();
    }
    function closeModal() {
        if (!overlay) return;
        overlay.classList.add('hidden');
        if (titleInput)  titleInput.value = '';
        if (authorInput) authorInput.value = '';
        if (catInput)    catInput.selectedIndex = 0;
        if (statusInput) statusInput.selectedIndex = 0;
    }

    if (addBtn) addBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    overlay?.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const title = (titleInput?.value || '').trim();
            if (!title) { titleInput?.focus(); return; }
            const book = {
                id: `bk-${Date.now()}`,
                title,
                author: (authorInput?.value || '').trim(),
                category: catInput?.value || 'other',
                status: statusInput?.value || 'reading',
                note: null,
                createdAt: new Date().toISOString(),
            };
            books.push(book);
            saveBooksToStorage();
            closeModal();
            // Switch filter to match where the new book lands
            shelfFilter = book.status;
            renderShelf();
        });
    }
}

function getShelfContext() {
    if (!books || books.length === 0) return '';
    const reading    = books.filter(b => b.status === 'reading');
    const done       = books.filter(b => b.status === 'done');
    const wantToRead = books.filter(b => b.status === 'want-to-read');
    let text = '\n## Shelf (reading list)\n';
    if (reading.length) {
        text += `Currently reading: ${reading.map(b => `"${b.title}" by ${b.author}${b.category ? ` (${b.category})` : ''}`).join(', ')}\n`;
    }
    if (done.length) {
        const recent = done.slice(-5);
        text += `Recently finished: ${recent.map(b => {
            let s = `"${b.title}" by ${b.author}`;
            if (b.note) s += ` — takeaway: "${b.note}"`;
            return s;
        }).join('; ')}\n`;
    }
    if (wantToRead.length) {
        text += `Want to read: ${wantToRead.map(b => `"${b.title}"`).join(', ')}\n`;
    }
    return text;
}

initShelf();

// ================================================================
// STREAKS — habit tracker
// ================================================================

// ---- State ----
let habits     = [];
let habitLogs  = {}; // { habitId: ["YYYY-MM-DD", ...] }

function loadHabitsFromStorage() {
    try {
        const h = JSON.parse(localStorage.getItem('arcforgeHabits') || '[]');
        if (Array.isArray(h)) habits = h;
    } catch(e) {}
    try {
        const l = JSON.parse(localStorage.getItem('arcforgeHabitLogs') || '{}');
        if (l && typeof l === 'object') habitLogs = l;
    } catch(e) {}
}

function saveHabitsToStorage() {
    const ts = new Date().toISOString();
    localStorage.setItem('arcforgeHabits', JSON.stringify(habits));
    localStorage.setItem('arcforgeHabitLogs', JSON.stringify(habitLogs));
    localStorage.setItem('arcforgeHabitsTs', ts);
    if (dbEnabled) {
        dbSaveSetting('arcforgeHabits', JSON.stringify(habits));
        dbSaveSetting('arcforgeHabitLogs', JSON.stringify(habitLogs));
        dbSaveSetting('arcforgeHabitsTs', ts);
    }
}

async function loadHabitsFromCloud() {
    if (!dbEnabled) return;
    try {
        const localTs = localStorage.getItem('arcforgeHabitsTs') || '';
        const [hStr, lStr, cloudTs] = await Promise.all([
            dbLoadSetting('arcforgeHabits'),
            dbLoadSetting('arcforgeHabitLogs'),
            dbLoadSetting('arcforgeHabitsTs'),
        ]);
        if (!hStr && !lStr) {
            // Nothing in cloud — push local up
            if (habits.length) {
                dbSaveSetting('arcforgeHabits', JSON.stringify(habits));
                dbSaveSetting('arcforgeHabitLogs', JSON.stringify(habitLogs));
                if (localTs) dbSaveSetting('arcforgeHabitsTs', localTs);
            }
            return;
        }
        if (cloudTs && cloudTs > localTs) {
            // Cloud is newer — use it
            if (hStr) {
                const h = JSON.parse(hStr);
                if (Array.isArray(h)) { habits = h; localStorage.setItem('arcforgeHabits', hStr); }
            }
            if (lStr) {
                const l = JSON.parse(lStr);
                if (l && typeof l === 'object') { habitLogs = l; localStorage.setItem('arcforgeHabitLogs', lStr); }
            }
            localStorage.setItem('arcforgeHabitsTs', cloudTs);
            renderStreaks();
        } else {
            // Local is newer — push to cloud
            dbSaveSetting('arcforgeHabits', JSON.stringify(habits));
            dbSaveSetting('arcforgeHabitLogs', JSON.stringify(habitLogs));
            if (localTs) dbSaveSetting('arcforgeHabitsTs', localTs);
        }
    } catch(e) {}
}

// ---- Helpers ----
function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function prevDayStr(dateStr) {
    const [y, m, dy] = dateStr.split('-').map(Number);
    const d = new Date(y, m - 1, dy); // local date — no UTC conversion
    d.setDate(d.getDate() - 1);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}
function calcStreak(completedDates) {
    if (!completedDates || completedDates.length === 0) return 0;
    const today = todayStr();
    const yesterday = prevDayStr(today);
    const sorted = [...new Set(completedDates)].sort().reverse();
    // Streak is still alive if completed today OR yesterday
    const start = sorted[0] === today ? today : (sorted[0] === yesterday ? yesterday : null);
    if (!start) return 0;
    let streak = 0;
    let check = start;
    for (const d of sorted) {
        if (d === check) { streak++; check = prevDayStr(check); }
        else if (d < check) break;
    }
    return streak;
}

// ---- View ----
function showStreaks() {
    switchToView(streaksView);
    closeSidebar();
    renderStreaks();
}

function renderStreaks() {
    const listEl      = document.getElementById('habit-list');
    const emptyEl     = document.getElementById('streaks-empty');
    const progressEl  = document.getElementById('streaks-progress-text');
    const dateEl      = document.getElementById('streaks-date-label');
    if (!listEl) return;

    const today = todayStr();
    const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (dateEl) dateEl.textContent = dateLabel;

    const activeHabits = habits.filter(h => !h.archived);

    if (activeHabits.length === 0) {
        listEl.innerHTML = '';
        emptyEl?.classList.remove('hidden');
        if (progressEl) progressEl.textContent = 'Build your daily habits.';
        return;
    }

    emptyEl?.classList.add('hidden');

    const doneToday = activeHabits.filter(h => (habitLogs[h.id] || []).includes(today)).length;
    if (progressEl) {
        progressEl.textContent = doneToday === activeHabits.length
            ? `All ${activeHabits.length} habits done today. Great work!`
            : `${doneToday} of ${activeHabits.length} habits completed today`;
    }

    listEl.innerHTML = activeHabits.map(h => {
        const logs    = habitLogs[h.id] || [];
        const done    = logs.includes(today);
        const streak  = calcStreak(logs);
        const streakLabel = streak > 0 ? `🔥 ${streak} day${streak === 1 ? '' : 's'}` : '—';
        return `
        <li class="habit-item${done ? ' habit-done' : ''}" data-id="${h.id}">
            <div class="habit-main">
                <div class="habit-info">
                    <span class="habit-name">${h.name}</span>
                    <span class="habit-streak">${streakLabel}</span>
                </div>
                <label class="habit-checkbox-wrap" title="${done ? 'Mark incomplete' : 'Mark done'}">
                    <input type="checkbox" class="habit-checkbox" ${done ? 'checked' : ''} data-id="${h.id}">
                    <div class="habit-custom-checkbox"><i class="fa-solid fa-check"></i></div>
                </label>
            </div>
            <button class="habit-delete-btn" data-id="${h.id}" title="Delete habit">
                <i class="fa-solid fa-trash"></i>
            </button>
        </li>`;
    }).join('');

    // Checkbox toggle
    listEl.querySelectorAll('.habit-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const id = cb.dataset.id;
            const today2 = todayStr();
            if (!habitLogs[id]) habitLogs[id] = [];
            if (cb.checked) {
                if (!habitLogs[id].includes(today2)) habitLogs[id].push(today2);
            } else {
                habitLogs[id] = habitLogs[id].filter(d => d !== today2);
            }
            saveHabitsToStorage();
            renderStreaks();
        });
    });

    // Delete buttons
    listEl.querySelectorAll('.habit-delete-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (!confirm('Delete this habit? Your streak data will be lost.')) return;
            habits = habits.filter(h => h.id !== id);
            delete habitLogs[id];
            saveHabitsToStorage();
            renderStreaks();
        });
    });
}

// ---- Add habit form ----
function initStreaksAddForm() {
    const addBtn    = document.getElementById('add-habit-btn');
    const form      = document.getElementById('add-habit-form');
    const input     = document.getElementById('habit-name-input');
    const saveBtn   = document.getElementById('habit-save-btn');
    const cancelBtn = document.getElementById('habit-cancel-btn');
    const backBtn   = document.getElementById('streaks-back-btn');
    if (!addBtn || !form) return;

    addBtn.addEventListener('click', () => {
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) input.focus();
    });

    function saveHabit() {
        const name = (input.value || '').trim();
        if (!name) return;
        const habit = { id: `h-${Date.now()}`, name, archived: false, createdAt: new Date().toISOString() };
        habits.push(habit);
        habitLogs[habit.id] = [];
        saveHabitsToStorage();
        input.value = '';
        form.classList.add('hidden');
        renderStreaks();
    }

    saveBtn.addEventListener('click', saveHabit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') saveHabit(); });
    cancelBtn.addEventListener('click', () => { input.value = ''; form.classList.add('hidden'); });
    if (backBtn) backBtn.addEventListener('click', showWorkspace);
}

// ---- AI context ----
function getStreaksContext() {
    const active = habits.filter(h => !h.archived);
    if (active.length === 0) return '';
    const today = todayStr();
    let text = '\n## Daily habit streaks\n';
    active.forEach(h => {
        const logs   = habitLogs[h.id] || [];
        const streak = calcStreak(logs);
        const doneToday = logs.includes(today);
        // Count missed days in last 7
        let missed = 0;
        const d = new Date();
        for (let i = 0; i < 7; i++) {
            const ds = d.toISOString().split('T')[0];
            if (!logs.includes(ds)) missed++;
            d.setDate(d.getDate() - 1);
        }
        text += `- id:"${h.id}" name:"${h.name}": streak ${streak} day${streak === 1 ? '' : 's'}, today ${doneToday ? '✅ done' : '❌ not done yet'}`;
        if (missed > 0 && missed < 7) text += `, missed ${missed}/7 days this week`;
        if (missed === 7) text += `, not completed at all this week`;
        text += '\n';
    });
    return text;
}

// ---- Bootstrap ----
loadHabitsFromStorage();
initStreaksAddForm();
loadHabitsFromCloud();

function getCheckInContext() {
    if (checkInLog.length === 0) return '';
    const recent = checkInLog.filter(e => !e.skipped).slice(-7);
    if (recent.length === 0) return '';

    let text = '\n## Daily check-in history (last 7 days)\n';
    recent.forEach(e => {
        text += `- ${e.date}: #1 task → "${e.topTask || '(none)'}". Completed yesterday → "${e.completedYesterday || '(none)'}"\n`;
    });

    const patternNote = getCheckInPatternNote();
    if (patternNote) text += `\n⚠️ ${patternNote}\n`;

    return text;
}

function getCheckInPatternNote() {
    const real = checkInLog.filter(e => !e.skipped && e.topTask);
    if (real.length < 3) return null;

    const recent3 = real.slice(-3);
    const topTask = recent3[0].topTask.toLowerCase().trim();
    const keyWord = topTask.split(' ')[0];

    const allSame = recent3.every(e => e.topTask.toLowerCase().trim() === topTask);
    if (!allSame) return null;

    const everDone = recent3.some(e => (e.completedYesterday || '').toLowerCase().includes(keyWord));
    if (everDone) return null;

    return `The user has listed "${recent3[0].topTask}" as their #1 task for ${recent3.length} days in a row (${recent3.map(e=>e.date).join(', ')}) but hasn't reported completing it. This strongly suggests a block. Proactively acknowledge this pattern and help the user get unstuck — don't just remind them, help them diagnose what's really in the way.`;
}

function initCheckIn() {
    const overlay    = document.getElementById('checkin-overlay');
    const skipBtn    = document.getElementById('checkin-skip-btn');
    const submitBtn  = document.getElementById('checkin-submit-btn');
    const topInput   = document.getElementById('checkin-top-task');
    const doneInput  = document.getElementById('checkin-completed-yesterday');

    if (!overlay) return;

    // Update the date label
    const dateLabel = document.getElementById('checkin-date-label');
    if (dateLabel) {
        const d = new Date();
        dateLabel.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }

    skipBtn?.addEventListener('click', () => submitCheckIn(true));
    submitBtn?.addEventListener('click', () => submitCheckIn(false));

    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target !== doneInput) {
            e.preventDefault();
            if (e.target === topInput) doneInput?.focus();
        }
        if (e.key === 'Enter' && e.target === doneInput) {
            e.preventDefault();
            submitCheckIn(false);
        }
        if (e.key === 'Escape') submitCheckIn(true);
    });

    if (shouldShowCheckIn()) {
        // Small delay so the page loads first
        setTimeout(showCheckIn, 600);
    }
}

// =====================================================
// WEEKLY PLANNING
// =====================================================

function saveWeeklyList() {
    localStorage.setItem('arcforgeWeeklyTaskIds', JSON.stringify(weeklyTaskIds));
    if (dbEnabled) dbSaveSetting('weeklyTaskIds', JSON.stringify(weeklyTaskIds));
}

function formatHoursFromSeconds(secs) {
    if (!secs || secs <= 0) return null;
    const totalMins = Math.floor(secs / 60);
    const hrs  = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (totalMins === 0) return '<1m';
    if (hrs > 0) return `${hrs}h ${mins > 0 ? mins + 'm' : ''}`.trim();
    return `${mins}m`;
}

function showWeeklyPlanning() {
    switchToView(weeklyView);
    closeSidebar();
    renderWeeklyPlanning();
    attachWeeklyEvents();
}

function hideWeeklyPlanning() {
    showWorkspace();
}

function renderWeeklyPlanning() {
    renderWeeklyStats();
    renderWeeklyBacklog();
    renderWeeklyFocusList();
}

function renderWeeklyStats() {
    const statsEl = document.getElementById('wp-stats');
    if (!statsEl) return;

    const activeProjects = projects.filter(p => !p.archived);
    const items = activeProjects
        .map(p => {
            const secs = tasks.filter(t => t.projectId === p.id).reduce((s, t) => s + (t.timeSpent || 0), 0);
            return { name: p.name, secs };
        })
        .filter(x => x.secs > 0)
        .sort((a, b) => b.secs - a.secs);

    if (items.length === 0) {
        statsEl.innerHTML = '<span class="wp-stats-empty">No time tracked yet — start some focus sessions!</span>';
        return;
    }

    statsEl.innerHTML = items.map(x =>
        `<span class="wp-stat-chip"><span class="wp-stat-name">${escapeHTML(x.name)}</span><span class="wp-stat-time">${formatHoursFromSeconds(x.secs)}</span></span>`
    ).join('');
}

function renderWeeklyBacklog() {
    const backlogEl = document.getElementById('wp-backlog');
    if (!backlogEl) return;
    backlogEl.innerHTML = '';

    const activeProjects = projects.filter(p => !p.archived)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    let hasAny = false;

    activeProjects.forEach(p => {
        const pendingTasks = tasks.filter(t =>
            t.projectId === p.id &&
            !t.completed &&
            !weeklyTaskIds.includes(t.id)
        ).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        if (pendingTasks.length === 0) return;
        hasAny = true;

        const group = document.createElement('div');
        group.className = 'wp-group';
        group.innerHTML = `<div class="wp-group-header"><i class="fa-solid fa-folder"></i> ${escapeHTML(p.name)}</div>`;

        pendingTasks.forEach(task => {
            const item = buildWeeklyTaskItem(task, 'backlog');
            group.appendChild(item);
        });

        backlogEl.appendChild(group);
    });

    if (!hasAny) {
        backlogEl.innerHTML = '<div class="wp-empty"><i class="fa-solid fa-check-double"></i><p>All pending tasks are in your focus list!</p></div>';
    }

    // Drag target for backlog (to remove from week list by dragging back)
    backlogEl.addEventListener('dragover', (e) => { e.preventDefault(); });
    backlogEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId && weeklyTaskIds.includes(taskId)) {
            weeklyTaskIds = weeklyTaskIds.filter(id => id !== taskId);
            saveWeeklyList();
            renderWeeklyPlanning();
        }
    });
}

function renderWeeklyFocusList() {
    const listEl = document.getElementById('wp-week-list');
    const countEl = document.getElementById('wp-week-count');
    if (!listEl) return;
    listEl.innerHTML = '';

    // Filter out ids of tasks that no longer exist, are completed, or archived
    weeklyTaskIds = weeklyTaskIds.filter(id => {
        const t = tasks.find(t2 => t2.id === id);
        return t && !t.completed && !t.archived;
    });
    saveWeeklyList();

    if (countEl) countEl.textContent = weeklyTaskIds.length;

    if (weeklyTaskIds.length === 0) {
        listEl.innerHTML = '<div class="wp-empty"><i class="fa-solid fa-calendar-plus"></i><p>Drag tasks here or click <i class="fa-solid fa-plus"></i> to plan your week</p></div>';
    } else {
        weeklyTaskIds.forEach(id => {
            const task = tasks.find(t => t.id === id);
            if (!task) return;
            const item = buildWeeklyTaskItem(task, 'focus');
            listEl.appendChild(item);
        });
    }

    // Drop zone for the focus list
    listEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        listEl.classList.add('wp-drop-active');
    });
    listEl.addEventListener('dragleave', () => listEl.classList.remove('wp-drop-active'));
    listEl.addEventListener('drop', (e) => {
        e.preventDefault();
        listEl.classList.remove('wp-drop-active');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId && !weeklyTaskIds.includes(taskId)) {
            weeklyTaskIds.push(taskId);
            saveWeeklyList();
            renderWeeklyPlanning();
        }
    });
}

function buildWeeklyTaskItem(task, side) {
    const item = document.createElement('div');
    item.className = 'wp-task-item';
    item.draggable = true;
    item.dataset.taskId = task.id;

    const proj = projects.find(p => p.id === task.projectId);
    const prioClass = task.priority ? `prio-${task.priority}` : '';
    const dueHtml = task.dueDate ? `<span class="wp-task-due"><i class="fa-regular fa-calendar"></i> ${task.dueDate}</span>` : '';
    const ctxHtml = task.context === 'deep-work'
        ? '<span class="wp-task-ctx wp-ctx-deep"><i class="fa-solid fa-brain"></i></span>'
        : task.context === 'quick-win'
        ? '<span class="wp-task-ctx wp-ctx-quick"><i class="fa-solid fa-bolt"></i></span>'
        : '';
    const timeHtml = task.timeSpent > 0
        ? `<span class="wp-task-time"><i class="fa-regular fa-clock"></i> ${formatHoursFromSeconds(task.timeSpent)}</span>`
        : '';

    item.innerHTML = `
        <div class="wp-task-main">
            ${prioClass ? `<span class="prio-dot prio-dot-${task.priority}"></span>` : ''}
            <span class="wp-task-text">${escapeHTML(task.text)}</span>
            <div class="wp-task-meta">${dueHtml}${ctxHtml}${timeHtml}</div>
        </div>
        <button class="wp-task-action" title="${side === 'backlog' ? 'Add to this week' : 'Remove from this week'}">
            <i class="fa-solid ${side === 'backlog' ? 'fa-plus' : 'fa-minus'}"></i>
        </button>
    `;

    // Drag
    item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        item.classList.add('wp-dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('wp-dragging'));

    // Button click
    item.querySelector('.wp-task-action').addEventListener('click', (e) => {
        e.stopPropagation();
        if (side === 'backlog') {
            if (!weeklyTaskIds.includes(task.id)) {
                weeklyTaskIds.push(task.id);
                saveWeeklyList();
            }
        } else {
            weeklyTaskIds = weeklyTaskIds.filter(id => id !== task.id);
            saveWeeklyList();
        }
        renderWeeklyPlanning();
    });

    return item;
}

function generateWeeklySummary() {
    if (weeklyTaskIds.length === 0) {
        showToast('Add some tasks to your focus list first!', 'info');
        return;
    }

    // Group by project
    const byProject = {};
    weeklyTaskIds.forEach(id => {
        const task = tasks.find(t => t.id === id);
        if (!task) return;
        const proj = projects.find(p => p.id === task.projectId);
        const key  = proj ? proj.name : 'Other';
        if (!byProject[key]) byProject[key] = [];
        byProject[key].push(task);
    });

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    let text = `🗓️ WEEKLY PLAN — ${dateStr}\n`;
    text += '═'.repeat(40) + '\n\n';

    Object.entries(byProject).forEach(([projName, projTasks]) => {
        text += `📁 ${projName}\n`;
        projTasks.forEach(t => {
            let line = `  • ${t.text}`;
            if (t.dueDate) line += ` (due ${t.dueDate})`;
            if (t.context === 'deep-work') line += ' 🧠';
            if (t.context === 'quick-win') line += ' ⚡';
            text += line + '\n';
        });
        text += '\n';
    });

    text += '─'.repeat(40) + '\n';
    text += `Total: ${weeklyTaskIds.length} task${weeklyTaskIds.length !== 1 ? 's' : ''} planned\n`;

    const summaryBox = document.getElementById('wp-summary-box');
    const summaryText = document.getElementById('wp-summary-text');
    if (summaryBox && summaryText) {
        summaryText.value = text;
        summaryBox.classList.remove('hidden');
        summaryBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function attachWeeklyEvents() {
    const backBtn     = document.getElementById('wp-back-btn');
    const clearBtn    = document.getElementById('wp-clear-btn');
    const generateBtn = document.getElementById('wp-generate-btn');
    const copyBtn     = document.getElementById('wp-copy-btn');
    const summaryBox  = document.getElementById('wp-summary-box');

    if (backBtn) backBtn.onclick = hideWeeklyPlanning;

    if (clearBtn) clearBtn.onclick = () => {
        if (weeklyTaskIds.length === 0) return;
        if (confirm('Clear all tasks from this week\'s focus list?')) {
            weeklyTaskIds = [];
            saveWeeklyList();
            if (summaryBox) summaryBox.classList.add('hidden');
            renderWeeklyPlanning();
        }
    };

    if (generateBtn) generateBtn.onclick = generateWeeklySummary;

    if (copyBtn) copyBtn.onclick = () => {
        const summaryText = document.getElementById('wp-summary-text');
        if (!summaryText?.value) return;
        navigator.clipboard.writeText(summaryText.value).then(() => {
            showToast('Plan copied to clipboard!', 'success');
        }).catch(() => {
            summaryText.select();
            document.execCommand('copy');
            showToast('Plan copied!', 'success');
        });
    };
}

function renderHistory() {
    if (!historyListContainer) return;
    historyListContainer.innerHTML = '';

    const searchTerm = historySearch.value.toLowerCase();
    let renderedProjectsCount = 0;

    projects.forEach(project => {
        const projTasks = tasks.filter(t => t.projectId === project.id);
        const projectNameMatches = project.name.toLowerCase().includes(searchTerm);

        const filteredTasks = projectNameMatches
            ? projTasks
            : projTasks.filter(t => t.text.toLowerCase().includes(searchTerm));
        if (filteredTasks.length === 0 && !projectNameMatches) return;

        renderedProjectsCount++;

        const totalProjectTime = filteredTasks.reduce((acc, t) => acc + (t.timeSpent || 0), 0);

        let timeBadgeHtml = '';
        if (totalProjectTime > 0) {
            const hrs     = Math.floor((totalProjectTime / 60) / 60);
            const mins    = Math.floor(totalProjectTime / 60) % 60;
            let timeStr   = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            if (totalProjectTime < 60 && totalProjectTime > 0) timeStr = '<1m';
            timeBadgeHtml = `<span class="task-time-badge" style="opacity:1;"><i class="fa-regular fa-clock"></i> ${timeStr} Tracker</span>`;
        }

        const projEl = document.createElement('div');
        projEl.className = 'history-project-item';

        const taskListHtml = filteredTasks.map(t => {
            let tBadge = '';
            if (t.timeSpent && t.timeSpent > 0) {
                const totalMins = Math.floor(t.timeSpent / 60);
                const hrs  = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                let tStr   = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                if (totalMins === 0) tStr = '<1m';
                tBadge = `<span class="task-time-badge"><i class="fa-regular fa-clock"></i> ${tStr}</span>`;
            }

            const prioDot    = t.priority ? `<span class="prio-dot prio-dot-${t.priority}"></span>` : '';
            const notesIcon  = (t.notes && t.notes.trim()) ? `<i class="fa-solid fa-note-sticky history-notes" title="${escapeHTML(t.notes)}"></i>` : '';
            const createdStr = t.createdAt  ? `<span class="history-date">Created ${formatShortDate(t.createdAt)}</span>` : '';
            const doneStr    = (t.completed && t.completedAt) ? `<span class="history-date done-date">&#10003; ${formatShortDate(t.completedAt)}</span>` : '';

            return `<div class="history-task-row">
                <div class="history-task-info">
                    ${prioDot}
                    <span class="history-task-name">${escapeHTML(t.text)}</span>
                    ${notesIcon}
                </div>
                <div class="history-task-meta">
                    ${tBadge}
                    ${createdStr}
                    ${doneStr}
                    <span class="history-status ${t.completed ? 'status-done' : 'status-pending'}">${t.completed ? 'Done' : 'Pending'}</span>
                </div>
            </div>`;
        }).join('');

        projEl.innerHTML = `
            <div class="history-project-header">
                <span class="history-project-name">
                    <i class="fa-solid fa-folder-open"></i>
                    ${escapeHTML(project.name)}
                </span>
                <div class="history-project-meta">
                    ${timeBadgeHtml}
                    <i class="fa-solid fa-chevron-down history-toggle-icon"></i>
                </div>
            </div>
            <div class="history-tasks-list hidden">
                ${taskListHtml}
            </div>
        `;

        const header = projEl.querySelector('.history-project-header');
        const list   = projEl.querySelector('.history-tasks-list');
        const icon   = projEl.querySelector('.history-toggle-icon');

        header.addEventListener('click', () => {
            list.classList.toggle('hidden');
            icon.style.transform = list.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
        });

        historyListContainer.appendChild(projEl);
    });

    if (renderedProjectsCount === 0) {
        historyListContainer.innerHTML = `
            <div class="empty-state visible">
                <i class="fa-solid fa-search empty-icon"></i>
                <h3>No results</h3>
                <p>Try searching for a different project or task name.</p>
            </div>
        `;
    }
}

// --- Voice Control ---
function initVoiceControl() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const voiceStatusEl = document.getElementById('voice-status');

    const helpToggle = document.getElementById('voice-help-toggle');
    const helpPanel  = document.getElementById('voice-help');

    // Wire toggle button
    if (helpToggle && helpPanel) {
        helpToggle.addEventListener('click', () => {
            const isOpen = helpPanel.classList.toggle('open');
            helpToggle.classList.toggle('active', isOpen);
        });
    }

    if (!SpeechRecognition) {
        console.warn('Speech Recognition API not supported in this browser.');
        if (voiceBtn) voiceBtn.style.display = 'none';
        if (helpToggle) helpToggle.style.display = 'none';
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    let isActive = false;
    let awaitingCommand = false;

    function setStatus(text, color = '') {
        if (!voiceStatusEl) return;
        voiceStatusEl.textContent = text;
        voiceStatusEl.style.color = color;
    }

    function startListening() {
        isActive = true;
        awaitingCommand = false;
        try { recognition.start(); } catch(e) {}
    }

    function stopListening() {
        isActive = false;
        awaitingCommand = false;
        try { recognition.stop(); } catch(e) {}
        if (voiceBtn) voiceBtn.classList.remove('recording');
        setStatus('');
        taskInput.placeholder = "What needs to be done?";
    }

    if (!voiceBtn) return;
    voiceBtn.addEventListener('click', () => {
        if (isActive) stopListening();
        else startListening();
    });

    recognition.onstart = () => {
        if (voiceBtn) voiceBtn.classList.add('recording');
        setStatus('Say "Hey ArcForge"...');
        taskInput.placeholder = 'Say "Hey ArcForge" to start...';
    };

    recognition.onend = () => {
        if (isActive) {
            try { recognition.start(); } catch(e) {}
        } else {
            if (voiceBtn) voiceBtn.classList.remove('recording');
            setStatus('');
            taskInput.placeholder = "What needs to be done?";
        }
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            isActive = false;
            if (voiceBtn) voiceBtn.classList.remove('recording');
            setStatus('Mic access denied.', 'var(--accent-danger)');
            setTimeout(() => setStatus(''), 3000);
            return;
        }
        if (event.error === 'aborted') return;
    };

    function isWakeWord(text) {
        return text.includes('hey arcforge') ||
               text.includes('hey or bit') ||
               text.includes('hey or arcforge') ||
               text.includes('an arcforge') ||
               text.includes('hey arcforges');
    }

    function isGoodbyeWord(text) {
        return text.includes('goodbye arcforge') ||
               text.includes('good bye arcforge') ||
               text.includes('bye arcforge') ||
               text.includes('stop arcforge');
    }

    function stripWakeWord(text) {
        return text
            .replace(/hey arcforge[s]?/g, '')
            .replace(/hey or bits?/g, '')
            .replace(/hey or arcforge/g, '')
            .replace(/an arcforge/g, '')
            .trim();
    }

    function executeCommand(command) {
        if (!command) return;
        handleVoiceCommand(command);
        setStatus(`Done: "${command}"`, 'var(--accent-secondary)');
        setTimeout(() => {
            if (isActive) {
                setStatus('Say "Hey ArcForge"...');
                taskInput.placeholder = 'Say "Hey ArcForge" to start...';
            }
        }, 2500);
    }

    recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        if (!result.isFinal) return;
        const transcript = result[0].transcript.toLowerCase().trim();

        console.log('Heard:', transcript);

        if (isGoodbyeWord(transcript)) {
            stopListening();
            return;
        }

        if (!awaitingCommand) {
            if (isWakeWord(transcript)) {
                const commandInSameUtterance = stripWakeWord(transcript);
                if (commandInSameUtterance) {
                    executeCommand(commandInSameUtterance);
                } else {
                    awaitingCommand = true;
                    setStatus('Ready! Say a command...', 'var(--accent-primary)');
                    taskInput.placeholder = 'Listening for command...';
                }
            }
            return;
        }

        awaitingCommand = false;
        executeCommand(stripWakeWord(transcript));
    };
}

function handleVoiceCommand(command) {
    console.log("Voice Command Recognized:", command);

    if (command.startsWith('add task ')) {
        const name = command.replace('add task ', '').trim();
        if (name) createTaskFromVoice(name);
        return;
    }

    if (command.startsWith('complete ')) {
        const title = command.replace('complete ', '').trim();
        if (!title) return;
        let task = tasks.find(t => t.projectId === currentProjectId && t.text.toLowerCase() === title && !t.completed);
        if (!task) task = tasks.find(t => t.projectId === currentProjectId && t.text.toLowerCase().includes(title) && !t.completed);
        if (task) toggleTask(task.id);
        return;
    }

    if (command.startsWith('switch to ')) {
        const title = command.replace('switch to ', '').trim();
        const project = projects.find(p => p.name.toLowerCase() === title);
        if (project) switchProject(project.id);
        return;
    }

    if (command.startsWith('new project ')) {
        const name = command.replace('new project ', '').trim();
        if (name) {
            const newProjectId = generateId();
            projects.push({ id: newProjectId, name: name.charAt(0).toUpperCase() + name.slice(1), order: projects.filter(p => !p.archived).length });
            saveAll();
            renderSidebar();
            switchProject(newProjectId);
            showToast(`Project "${name}" created!`, 'success');
        }
        return;
    }

    if (command.startsWith('delete task ')) {
        const title = command.replace('delete task ', '').trim();
        if (!title) return;
        let task = tasks.find(t => t.projectId === currentProjectId && t.text.toLowerCase() === title);
        if (!task) task = tasks.find(t => t.projectId === currentProjectId && t.text.toLowerCase().includes(title));
        if (task) {
            const el = document.querySelector(`.task-item[data-id="${task.id}"]`);
            if (el) deleteTask(task.id, el);
            else { tasks = tasks.filter(t2 => t2.id !== task.id); saveAll(); renderTasks(); }
        }
        return;
    }

    if (command === 'clear completed' || command === 'clear completed tasks') {
        const completed = tasks.filter(t => t.projectId === currentProjectId && t.completed && !t.archived);
        if (completed.length === 0) { showToast('No completed tasks to clear.', 'info'); return; }
        tasks = tasks.map(t =>
            (t.projectId === currentProjectId && t.completed && !t.archived)
                ? { ...t, archived: true }
                : t
        );
        saveAll();
        renderTasks();
        renderSidebar();
        showToast(`${completed.length} task(s) cleared.`, 'success');
        return;
    }

    if (command === 'open sidebar') { openSidebar(); return; }
    if (command === 'close sidebar') { closeSidebar(); return; }
}

function createTaskFromVoice(text, projId = currentProjectId) {
    if (!text) return;
    const projectTasks = tasks.filter(t => t.projectId === projId);
    const minOrder     = projectTasks.length > 0 ? Math.min(...projectTasks.map(t => t.order ?? 0)) : 0;

    const newTask = {
        id:          generateId(),
        projectId:   projId,
        text:        text.charAt(0).toUpperCase() + text.slice(1),
        completed:   false,
        timeSpent:   0,
        priority:    null,
        dueDate:     null,
        context:     null,
        energy:      null,
        notes:       '',
        completedAt: null,
        order:       minOrder - 1,
        createdAt:   new Date().toISOString(),
        recurring:    false,
        recurringDay: null,
        archived:     false
    };
    tasks.unshift(newTask);
    saveAll();

    if (projId === currentProjectId) {
        if (currentFilter === 'completed') {
            document.querySelector('[data-filter="all"]')?.click();
        } else {
            renderTasks();
            renderSidebar();
        }
    }
}

// --- Theme Control ---
function initThemePicker() {
    const themeBtn      = document.getElementById('theme-toggle-btn');
    const themeDropdown = document.getElementById('theme-dropdown');
    const themeOptions  = document.querySelectorAll('.theme-option');

    if (!themeBtn || !themeDropdown) return;

    themeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        themeDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!themeDropdown.contains(e.target) && e.target !== themeBtn) {
            themeDropdown.classList.add('hidden');
        }
    });

    themeOptions.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const theme = btn.dataset.theme;
            applyTheme(theme);
            if (dbEnabled) dbSaveSetting('theme', theme);
            themeDropdown.classList.add('hidden');
        });
    });
}

function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('arcforgeTheme', theme);

    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
    });
}

// Start
document.addEventListener('DOMContentLoaded', init);

// =====================================================
// AI ASSISTANT
// =====================================================

// Bridge: lets createTaskElement call functions defined inside initAI
const aiActions = { openGuide: null, openSkillGuide: null, breakdownTask: null, autoSuggestPriority: null, openSettings: null, openWithPrompt: null, openAndSend: null };

function initAI() {
    const fab           = document.getElementById('ai-fab');
    const panel         = document.getElementById('ai-panel');
    const backdrop      = document.getElementById('ai-backdrop');
    const closeBtn      = document.getElementById('ai-close-btn');
    const settingsBtn   = document.getElementById('ai-settings-btn');
    const settingsPanel = document.getElementById('ai-settings-panel');
    const newChatBtn    = document.getElementById('ai-new-chat-btn');
    const messagesEl    = document.getElementById('ai-messages');
    const inputEl       = document.getElementById('ai-input');
    const sendBtn       = document.getElementById('ai-send-btn');
    const contextInfo   = document.getElementById('ai-context-info');

    // MasterPrompt file-manager elements
    const mpFileCard    = document.getElementById('mp-file-card');
    const mpFileNameEl  = document.getElementById('mp-file-name');
    const mpFileMetaEl  = document.getElementById('mp-file-meta');
    const mpReplaceBtn  = document.getElementById('mp-replace-btn');
    const mpEditBtn     = document.getElementById('mp-edit-btn');
    const mpDeleteBtn   = document.getElementById('mp-delete-btn');
    const mpDropzone    = document.getElementById('mp-dropzone');
    const mpBrowseBtn   = document.getElementById('mp-browse-btn');
    const mpFileInput   = document.getElementById('mp-file-input');
    const mpTypeBtn     = document.getElementById('mp-type-instead-btn');
    const mpEditor      = document.getElementById('mp-editor');
    const mpTextarea    = document.getElementById('ai-masterprompt');
    const mpSaveBtn     = document.getElementById('ai-save-masterprompt-btn');
    const mpCancelBtn   = document.getElementById('mp-cancel-edit-btn');

    if (!fab || !panel) return;

    // ---- State ----
    let chatHistory = [];
    try {
        const saved = JSON.parse(localStorage.getItem('arcforgeChatHistory') || '[]');
        if (Array.isArray(saved) && saved.length > 0) chatHistory = saved;
    } catch(e) {}

    function saveChatHistory() {
        localStorage.setItem('arcforgeChatHistory', JSON.stringify(chatHistory));
        if (dbEnabled) dbSaveSetting('chatHistory', JSON.stringify(chatHistory));
    }

    let streaming   = false;

    // ---- Open / Close ----
    function openPanel() {
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        backdrop.classList.add('active');
        updateContextBar();
        inputEl.focus();
    }
    function closePanel() {
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
        backdrop.classList.remove('active');
        settingsPanel.classList.remove('open');
    }

    fab.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    backdrop.addEventListener('click', closePanel);

    // ---- Settings toggle ----
    settingsBtn.addEventListener('click', () => {
        settingsPanel.classList.toggle('open');
    });

    // ================================================================
    // MasterPrompt file manager
    // ================================================================
    function mpRenderState() {
        const meta = (() => {
            try { return JSON.parse(localStorage.getItem('arcforgeMasterPromptFile') || 'null'); }
            catch { return null; }
        })();
        const hasContent = !!(localStorage.getItem('arcforgeMasterPrompt') || '').trim();

        if (hasContent && meta) {
            // Show file card, hide dropzone & editor
            mpFileCard.classList.remove('hidden');
            mpDropzone.classList.add('hidden');
            mpEditor.classList.add('hidden');
            mpFileNameEl.textContent = meta.name;
            const kb = (meta.size / 1024).toFixed(1);
            const date = new Date(meta.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            mpFileMetaEl.textContent = `${kb} KB · saved ${date}`;
        } else if (hasContent && !meta) {
            // Has manually-typed text — show editor with content
            mpFileCard.classList.add('hidden');
            mpDropzone.classList.add('hidden');
            mpEditor.classList.remove('hidden');
            if (mpTextarea) mpTextarea.value = localStorage.getItem('arcforgeMasterPrompt') || '';
        } else {
            // Nothing yet — show dropzone
            mpFileCard.classList.add('hidden');
            mpDropzone.classList.remove('hidden');
            mpEditor.classList.add('hidden');
        }
    }

    function mpLoadFile(file) {
        if (!file) return;
        const allowed = ['text/plain', 'text/markdown', ''];
        const extOk   = /\.(txt|md|markdown)$/i.test(file.name);
        if (!extOk) { showToast('Only .txt or .md files are supported.', 'warning'); return; }

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = (e.target.result || '').trim();
            if (!text) { showToast('The file appears to be empty.', 'warning'); return; }
            localStorage.setItem('arcforgeMasterPrompt', text);
            localStorage.setItem('arcforgeMasterPromptFile', JSON.stringify({
                name: file.name,
                size: file.size,
                uploadedAt: new Date().toISOString()
            }));
            if (dbEnabled) dbSaveSetting('masterPrompt', text);
            mpRenderState();
            showToast(`MasterPrompt loaded from "${file.name}"`, 'success');
        };
        reader.readAsText(file);
    }

    // Browse button
    mpBrowseBtn.addEventListener('click', () => mpFileInput.click());
    mpFileInput.addEventListener('change', (e) => {
        mpLoadFile(e.target.files[0]);
        mpFileInput.value = '';
    });

    // Replace (same as browse)
    mpReplaceBtn.addEventListener('click', () => mpFileInput.click());

    // Delete
    mpDeleteBtn.addEventListener('click', () => {
        if (!confirm('Remove the MasterPrompt? The AI will only have task context.')) return;
        localStorage.removeItem('arcforgeMasterPrompt');
        localStorage.removeItem('arcforgeMasterPromptFile');
        if (dbEnabled) dbDeleteSetting('masterPrompt');
        mpRenderState();
        showToast('MasterPrompt removed.', 'warning');
    });

    // Edit manually (from file card)
    mpEditBtn.addEventListener('click', () => {
        mpFileCard.classList.add('hidden');
        mpDropzone.classList.add('hidden');
        mpEditor.classList.remove('hidden');
        if (mpTextarea) { mpTextarea.value = localStorage.getItem('arcforgeMasterPrompt') || ''; mpTextarea.focus(); }
    });

    // "type manually instead" link
    mpTypeBtn.addEventListener('click', () => {
        mpDropzone.classList.add('hidden');
        mpEditor.classList.remove('hidden');
        if (mpTextarea) mpTextarea.focus();
    });

    // Save from editor
    mpSaveBtn.addEventListener('click', () => {
        const val = (mpTextarea.value || '').trim();
        if (!val) { showToast('Write something first.', 'warning'); return; }
        localStorage.setItem('arcforgeMasterPrompt', val);
        localStorage.removeItem('arcforgeMasterPromptFile');
        localStorage.setItem('arcforgeMasterPromptFile', JSON.stringify({
            name: 'manual entry',
            size: new Blob([val]).size,
            uploadedAt: new Date().toISOString()
        }));
        if (dbEnabled) dbSaveSetting('masterPrompt', val);
        mpRenderState();
        showToast('MasterPrompt saved!', 'success');
    });

    // Cancel edit — go back to previous state
    mpCancelBtn.addEventListener('click', () => {
        mpEditor.classList.add('hidden');
        mpRenderState();
    });

    // Drag & drop on the drop zone
    mpDropzone.addEventListener('dragover', (e) => { e.preventDefault(); mpDropzone.classList.add('drag-over'); });
    mpDropzone.addEventListener('dragleave', ()  => mpDropzone.classList.remove('drag-over'));
    mpDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        mpDropzone.classList.remove('drag-over');
        mpLoadFile(e.dataTransfer.files[0]);
    });

    // Init display
    mpRenderState();

    // ---- New Chat ----
    newChatBtn.addEventListener('click', () => {
        chatHistory = [];
        messagesEl.innerHTML = '';
        messagesEl.appendChild(buildWelcomeEl());
        localStorage.removeItem('arcforgeChatHistory');
        if (dbEnabled) dbDeleteSetting('chatHistory');
        showToast('New conversation started.', 'info');
    });

    // ---- Context bar ----
    function updateContextBar() {
        if (!contextInfo) return;
        const activeProjects = projects.filter(p => !p.archived).length;
        const pendingTasks   = tasks.filter(t => !t.completed).length;
        const totalTasks     = tasks.length;
        const mp = (localStorage.getItem('arcforgeMasterPrompt') || '').trim();
        contextInfo.textContent =
            `${activeProjects} projects · ${pendingTasks} pending / ${totalTasks} tasks` +
            (mp ? ' · MasterPrompt active' : '');
        if (sendBtn) sendBtn.disabled = false;
    }

    // ---- Build system prompt ----
    function buildSystemPrompt() {
        const mp  = (localStorage.getItem('arcforgeMasterPrompt') || '').trim();
        const now = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // Summarise data for context
        const activeProjects = projects.filter(p => !p.archived);
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);
        const projectContext = activeProjects.map(p => {
            const ptasks    = tasks.filter(t => t.projectId === p.id);
            const pending   = ptasks.filter(t => !t.completed && !t.archived);
            const overdue   = pending.filter(t => t.dueDate && new Date(t.dueDate + 'T00:00:00') < new Date());
            const highPrio  = pending.filter(t => t.priority === 'high');
            const recentDone = ptasks.filter(t => t.archived && t.completedAt && new Date(t.completedAt) > cutoff);
            return {
                id:   p.id,
                name: p.name,
                pending: pending.map(t => ({
                    id:           t.id,
                    text:         t.text,
                    priority:     t.priority || null,
                    dueDate:      t.dueDate  || null,
                    timeSpent:    t.timeSpent ? `${Math.round(t.timeSpent/60)}m` : null,
                    notes:        t.notes || null,
                    recurringDay: t.recurringDay || null,
                    energy:       t.energy || null,
                    context:      t.context || null
                })),
                recentlyCompleted: recentDone.map(t => ({
                    text:        t.text,
                    completedAt: t.completedAt ? t.completedAt.split('T')[0] : null,
                    timeSpent:   t.timeSpent ? `${Math.round(t.timeSpent/60)}m` : null
                })),
                overdueCount:  overdue.length,
                highPrioCount: highPrio.length
            };
        });

        const checkInCtx  = getCheckInContext();
        const streaksCtx  = getStreaksContext();
        const shelfCtx    = getShelfContext();
        const goalsCtx    = getGoalsContext();
        const pipelineCtx = getPipelineContext();
        const budgetCtx   = getTimeBudgetContext();
        const staleCtx    = getStaleTasksContext();

        let system = `You are ArcForge AI, an intelligent productivity assistant embedded in ArcForge, a personal task manager.
Today is ${now}.

${mp ? `## About the user\n${mp}\n` : ''}
## Current workspace context
${JSON.stringify(projectContext, null, 2)}
${checkInCtx}${streaksCtx}${shelfCtx}${goalsCtx}${pipelineCtx}${budgetCtx}${staleCtx}

## Instructions
- Be concise, direct, and genuinely helpful.
- Reference specific tasks, projects, or patterns when relevant.
- Format responses clearly: use bullet points for lists, **bold** for emphasis, and short paragraphs.
- Never be generic — ground your advice in the actual tasks and projects provided above.

## Managing tasks through chat
You can create, update, complete, and delete tasks directly. When you do, ALWAYS include both:
1. A clear human-readable explanation of what you're doing and why
2. At the very end of your response, this exact block (no spaces or line breaks inside the markers):
<!--ARCFORGE_UPDATES[...]ARCFORGE_UPDATES-->

Each item in the array must have an "action" field. Supported actions:

**"update"** — change any fields of an existing task:
{"action":"update","id":"task-id","priority":"high","dueDate":"2026-03-25","context":"quick-win","notes":"Step 1: ...\nStep 2: ..."}

**"create"** — add a new task (use the project id from the workspace context above):
{"action":"create","projectId":"project-id","text":"Task name","priority":"medium","dueDate":"2026-03-25"}

**"complete"** — mark an existing task as done:
{"action":"complete","id":"task-id"}

**"delete"** — permanently delete an existing task:
{"action":"delete","id":"task-id"}

**"completeHabit"** — mark a habit as done today (use the habit id from the streaks context above):
{"action":"completeHabit","habitId":"habit-id","habitName":"habit name"}

Rules:
- Valid priorities: "high", "medium", "low", null
- Valid contexts: "quick-win", "deep-work", null
- Date format: YYYY-MM-DD
- Omit optional fields if not changing them
- Use this for ANY task management request: adding, removing, rescheduling, completing tasks
- When creating tasks, always use the correct projectId from the workspace context
- Do NOT invent task IDs — only reference IDs that appear in the workspace context above
- Do NOT invent habit IDs — only use IDs from the streaks context above

## Habit scheduling — how to help
When the user asks you to plan their day or find time for habits, look at the streaks context above for habits not yet done today. Suggest specific time blocks (e.g. "8:00–8:15 AM: morning run"). If the user confirms or asks you to log a habit, use the "completeHabit" action. Always check which habits are already done (✅) before suggesting — never suggest completing something already done.

## Notes field — how to use it
The \`notes\` field is a plain-text area visible inside each task. Use it to store rich context that makes the task actionable:
- **Sub-steps**: numbered steps for the day or session (e.g. "1. Review Frame notes\n2. VFX pass\n3. Sound design")
- **Time allocation**: how long each part should take (e.g. "Music discovery: 4h\nMusic placement: 1h")
- **Process reminders**: anything the user needs to remember when they sit down to do it (e.g. "Upload VOs to Google Doc before 6pm")
- **Dependencies or blockers**: what needs to happen first

When a user asks you to plan a task, break it down, or add detail — write structured notes directly to that task using the update action. Use \\n for line breaks. Be specific and practical, not generic.

## Due dates — personal assistant rules
You are a real personal assistant. Treat due dates like commitments.

**Never clear an existing due date.** If a task already has a due date, never send \`"dueDate": null\` or omit the field to remove it. The user set that date for a reason. Only change an existing due date if the user explicitly says something like "move this to next week" or "reschedule task X".

**When reorganizing or prioritizing**, preserve every existing due date exactly. Do not include \`dueDate\` in the update at all unless you are intentionally changing it at the user's request.

**You MAY assign a due date to tasks that have none**, when it adds clear value. Use this guidance:
- High priority, no date → suggest within 1–3 days
- Medium priority, no date → suggest within the current week
- Low priority, no date → suggest within 2 weeks
- Don't pile everything on the same day — spread the load
- Recurring tasks already have their own rhythm; don't interfere
- When assigning dates proactively, always explain your reasoning to the user`;

        return system;
    }

    // ---- Render welcome screen ----
    function buildWelcomeEl() {
        const el = document.createElement('div');
        el.className = 'ai-welcome';
        el.id = 'ai-welcome';
        el.innerHTML = `
            <div class="ai-welcome-icon"><i class="fa-solid fa-robot"></i></div>
            <p class="ai-welcome-title">Hey, I'm ArcForge AI</p>
            <p class="ai-welcome-sub">I have full context of your projects and tasks. Ask me to analyze your workload, find bottlenecks, suggest what to tackle next, or anything else.</p>
            <div class="ai-starters">
                <button class="ai-starter-btn ai-starter-featured" data-prompt="Give me a focused morning briefing based on my tasks. Tell me: (1) the 3 most important things to tackle today and why, (2) anything overdue I should address first, and (3) one thing I should NOT work on today so I stay focused.">📋 Daily briefing</button>
                <button class="ai-starter-btn ai-starter-featured" data-prompt="I want you to reorganize and prioritize all my tasks for me. First, ask me about my main goal or deadline so your recommendations are on point.">⚡ Help me prioritize</button>
                <button class="ai-starter-btn" data-prompt="What should I focus on today based on my tasks?">What to focus on today?</button>
                <button class="ai-starter-btn" data-prompt="Which tasks are overdue or at risk? Mark them high priority and set due dates where missing. Apply the changes directly.">Fix overdue tasks</button>
                <button class="ai-starter-btn" data-prompt="Give me a brief analysis of my current workload across all projects.">Analyze my workload</button>
                <button class="ai-starter-btn" data-prompt="What tasks have I been spending the most time on?">Where is my time going?</button>
                <button class="ai-starter-btn" data-prompt="Give me a summary of my week. Look at my completed tasks and tell me: (1) what I accomplished, (2) any patterns in where I spent time, and (3) 2-3 clear priorities I should carry into next week.">Week in review</button>
                <button class="ai-starter-btn" data-prompt="Look at all my pending tasks and clean them up: mark any that are clearly done as complete, delete any that are obviously redundant or outdated, and suggest due dates for any high-priority tasks missing them. Show me what you plan to do before applying.">Clean up my tasks</button>
            </div>`;
        el.querySelectorAll('.ai-starter-btn').forEach(btn => {
            btn.addEventListener('click', () => sendMessage(btn.dataset.prompt));
        });
        return el;
    }

    // Wire up starter buttons already in the DOM
    messagesEl.querySelectorAll('.ai-starter-btn').forEach(btn => {
        btn.addEventListener('click', () => sendMessage(btn.dataset.prompt));
    });

    // ---- Append a message bubble ----
    function appendBubble(role, text) {
        // Remove welcome screen on first message
        const welcome = document.getElementById('ai-welcome');
        if (welcome) welcome.remove();

        const wrapper = document.createElement('div');
        wrapper.className = `ai-msg ai-msg-${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'ai-bubble';
        if (role === 'assistant') {
            bubble.innerHTML = renderMarkdown(text);
        } else {
            bubble.textContent = text;
        }
        wrapper.appendChild(bubble);
        messagesEl.appendChild(wrapper);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return bubble;
    }

    // ---- Simple markdown renderer ----
    function renderMarkdown(text) {
        return text
            // code blocks (``` ... ```)
            .replace(/```[\s\S]*?```/g, m => {
                const code = m.replace(/^```\w*\n?/, '').replace(/```$/, '');
                return `<pre style="background:rgba(255,255,255,0.05);padding:0.6rem 0.75rem;border-radius:6px;overflow-x:auto;font-size:0.8em;font-family:'JetBrains Mono',monospace;margin:0.4rem 0"><code>${escapeHTML(code)}</code></pre>`;
            })
            // headings
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            // bold
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // italic
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            // inline code
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // unordered and numbered list items → group consecutive <li> into one <ul>
            .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*?<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
            // line breaks → paragraphs
            .split(/\n{2,}/)
            .map(p => p.trim() ? (p.startsWith('<') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`) : '')
            .join('');
    }

    // ---- Send message ----
    async function sendMessage(text) {
        text = (text || inputEl.value).trim();
        if (!text || streaming) return;

        inputEl.value = '';
        inputEl.style.height = 'auto';
        streaming = true;
        sendBtn.disabled = true;
        sendBtn.classList.add('loading');
        sendBtn.innerHTML = '<i class="fa-solid fa-circle-notch"></i>';

        // Show user bubble
        appendBubble('user', text);
        chatHistory.push({ role: 'user', content: text });
        saveChatHistory();

        // Show assistant bubble with cursor
        const welcome = document.getElementById('ai-welcome');
        if (welcome) welcome.remove();

        const wrapper = document.createElement('div');
        wrapper.className = 'ai-msg ai-msg-assistant';
        const bubble = document.createElement('div');
        bubble.className = 'ai-bubble';
        bubble.innerHTML = '<span class="ai-cursor"></span>';
        wrapper.appendChild(bubble);
        messagesEl.appendChild(wrapper);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: chatHistory,
                    system: buildSystemPrompt()
                })
            });

            if (!response.ok) {
                let errMsg = `Error ${response.status}`;
                try { const j = await response.json(); errMsg = j.error || errMsg; } catch {}
                bubble.innerHTML = `<span class="ai-error"><i class="fa-solid fa-triangle-exclamation"></i>${errMsg}</span>`;
                throw new Error(errMsg);
            }

            const { reply: fullText } = await response.json();

            if (fullText) {
                const updatesMatch = fullText.match(/<!--ARCFORGE_UPDATES(\[[\s\S]*?\])ARCFORGE_UPDATES-->/);
                if (updatesMatch) {
                    try {
                        const updates = JSON.parse(updatesMatch[1]);
                        const cleanText = fullText.replace(/<!--ARCFORGE_UPDATES[\s\S]*?ARCFORGE_UPDATES-->/, '').trim();
                        bubble.innerHTML = renderMarkdown(cleanText);
                        showApplyCard(wrapper, updates);
                    } catch {
                        bubble.innerHTML = renderMarkdown(fullText);
                    }
                } else {
                    bubble.innerHTML = renderMarkdown(fullText);
                }
                chatHistory.push({ role: 'assistant', content: fullText });
                saveChatHistory();
            } else {
                bubble.innerHTML = '<span class="ai-error"><i class="fa-solid fa-triangle-exclamation"></i> No response from AI.</span>';
            }

        } catch (err) {
            console.error('[AI] Error:', err);
            if (!bubble.querySelector('.ai-error')) {
                bubble.innerHTML = `<span class="ai-error"><i class="fa-solid fa-triangle-exclamation"></i> Something went wrong. Please try again.</span>`;
            }
        } finally {
            streaming = false;
            sendBtn.disabled = false;
            sendBtn.classList.remove('loading');
            sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    }

    // ---- Task update apply card ----
    function applyTaskUpdates(updates) {
        updates.forEach(u => {
            if (u.action === 'create') {
                const proj = projects.find(p => p.id === u.projectId && !p.archived)
                          || projects.find(p => !p.archived);
                if (!proj) return;
                const projectTasks = tasks.filter(t => t.projectId === proj.id);
                const minOrder = projectTasks.length > 0 ? Math.min(...projectTasks.map(t => t.order ?? 0)) : 0;
                tasks.unshift({
                    id:           generateId(),
                    projectId:    proj.id,
                    text:         u.text,
                    completed:    false,
                    timeSpent:    0,
                    priority:     u.priority     || null,
                    dueDate:      u.dueDate      || null,
                    context:      u.context      || null,
                    notes:        '',
                    completedAt:  null,
                    order:        minOrder - 1,
                    createdAt:    new Date().toISOString(),
                    recurring:    false,
                    recurringDay: null
                });
            } else if (u.action === 'completeHabit') {
                const id = u.habitId;
                if (id) {
                    if (!habitLogs[id]) habitLogs[id] = [];
                    const td = todayStr();
                    if (!habitLogs[id].includes(td)) habitLogs[id].push(td);
                    saveHabitsToStorage();
                    renderStreaks();
                }
            } else if (u.action === 'complete') {
                const idx = tasks.findIndex(t => t.id === u.id);
                if (idx !== -1) tasks[idx] = { ...tasks[idx], completed: true, completedAt: new Date().toISOString() };
            } else if (u.action === 'delete') {
                tasks = tasks.filter(t => t.id !== u.id);
            } else {
                // update (default)
                const idx = tasks.findIndex(t => t.id === u.id);
                if (idx === -1) return;
                if (u.priority !== undefined) tasks[idx] = { ...tasks[idx], priority: u.priority };
                if (u.dueDate  !== undefined) {
                    // Never silently wipe an existing due date — only apply if setting a real
                    // date, or if the task has no date yet (null is a no-op in that case).
                    if (u.dueDate !== null || !tasks[idx].dueDate) {
                        tasks[idx] = { ...tasks[idx], dueDate: u.dueDate };
                    }
                }
                if (u.text     !== undefined) tasks[idx] = { ...tasks[idx], text:     u.text     };
                if (u.context  !== undefined) tasks[idx] = { ...tasks[idx], context:  u.context  };
                if (u.notes    !== undefined) tasks[idx] = { ...tasks[idx], notes:    u.notes    };
            }
        });
        saveAll();
        renderTasks();
        renderSidebar();
        updateWorkloadMeter();
    }

    function showApplyCard(msgWrapper, updates) {
        const validUpdates = updates.filter(u => {
            if (u.action === 'create') return u.text && projects.find(p => !p.archived);
            if (u.action === 'completeHabit') return u.habitId && habits.find(h => h.id === u.habitId);
            return tasks.find(t => t.id === u.id);
        });
        if (!validUpdates.length) return;

        const prioLabel = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };

        const lines = validUpdates.map(u => {
            if (u.action === 'create') {
                const proj = projects.find(p => p.id === u.projectId) || projects.find(p => !p.archived);
                const meta = [u.priority ? prioLabel[u.priority] : null, u.dueDate ? `due ${u.dueDate}` : null].filter(Boolean).join(' · ');
                return `<li><i class="fa-solid fa-plus" style="color:#4ade80;margin-right:0.35rem"></i><strong>${escapeHTML(u.text)}</strong> → ${escapeHTML(proj?.name || 'Tasks')}${meta ? `<span class="ai-apply-change">${meta}</span>` : ''}</li>`;
            }
            const task = tasks.find(t => t.id === u.id);
            if (u.action === 'completeHabit') {
                return `<li><i class="fa-solid fa-fire" style="color:#f59e0b;margin-right:0.35rem"></i>Log habit done: <strong>${escapeHTML(u.habitName || u.habitId)}</strong></li>`;
            }
            if (u.action === 'complete') {
                return `<li><i class="fa-solid fa-check" style="color:#4ade80;margin-right:0.35rem"></i>Complete: ${escapeHTML(task.text)}</li>`;
            }
            if (u.action === 'delete') {
                return `<li><i class="fa-solid fa-trash" style="color:#ff4466;margin-right:0.35rem"></i>Delete: ${escapeHTML(task.text)}</li>`;
            }
            // update
            const parts = [];
            if (u.priority !== undefined) parts.push(`priority → <strong>${prioLabel[u.priority] || 'None'}</strong>`);
            if (u.dueDate  !== undefined) parts.push(`due → <strong>${u.dueDate || 'cleared'}</strong>`);
            if (u.text     !== undefined) parts.push(`renamed → <strong>${escapeHTML(u.text)}</strong>`);
            if (u.context  !== undefined) parts.push(`context → <strong>${u.context === 'quick-win' ? '⚡ Quick Win' : u.context === 'deep-work' ? '🧠 Deep Work' : 'None'}</strong>`);
            if (u.notes    !== undefined) parts.push(`notes updated`);
            return `<li>${escapeHTML(task.text)}<span class="ai-apply-change">${parts.join(' · ')}</span></li>`;
        }).join('');

        const card = document.createElement('div');
        card.className = 'ai-apply-card';
        card.innerHTML = `
            <div class="ai-apply-header">
                <i class="fa-solid fa-list-check"></i>
                <span>${validUpdates.length} change${validUpdates.length > 1 ? 's' : ''} ready to apply</span>
            </div>
            <ul class="ai-apply-list">${lines}</ul>
            <div class="ai-apply-actions">
                <button class="ai-apply-btn"><i class="fa-solid fa-check"></i> Apply changes</button>
                <button class="ai-dismiss-btn">Dismiss</button>
            </div>`;

        card.querySelector('.ai-apply-btn').addEventListener('click', () => {
            applyTaskUpdates(validUpdates);
            card.innerHTML = `<div class="ai-apply-done"><i class="fa-solid fa-check-circle"></i> Changes applied!</div>`;
            setTimeout(() => card.remove(), 2500);
        });
        card.querySelector('.ai-dismiss-btn').addEventListener('click', () => card.remove());

        msgWrapper.appendChild(card);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ---- AI Skill: open guide for a specific task ----
    function openAISkillGuide(task) {
        openPanel();
        const prompt = `I need your help speeding up this task: "${task.text}"

Tell me exactly how Claude AI can help — whether that's generating content, writing code, doing analysis, creating a draft, or building a reusable prompt I can save and use again.

Structure your response:
**What Claude can do:** (one clear, specific description)
**Ready-to-use prompt:** (a complete prompt I can copy and run right now, tailored to this task)
**Variation:** (a follow-up or alternative prompt for a related angle)`;
        sendMessage(prompt);
    }

    // ---- Automation: open guide for a specific task ----
    function openAutomationGuide(task) {
        openPanel();
        const prompt = `Generate a practical automation guide for this task: "${task.text}"

Prioritize free tools with the simplest possible setup. Consider in this order:
1. **Zapier** (free tier — 100 tasks/month)
2. **Make** (free tier — 1000 operations/month)
3. **Google Sheets + Apps Script** (completely free)
4. **iOS Shortcuts / Android Tasker** (free, built-in)
5. **Browser bookmarklet or extension** (free)

Structure your response:
**Recommended tool:** [tool name and why it fits]
**Setup steps:** (numbered, beginner-friendly — assume zero technical knowledge)
**What to watch out for:** (limits, gotchas, anything that could trip them up)`;
        sendMessage(prompt);
    }

    // ---- Automation: scan all pending tasks ----
    async function runAutomationScan() {
        if (streaming) return;

        const projectTasks = tasks.filter(t => t.projectId === currentProjectId && !t.completed);
        if (projectTasks.length === 0) {
            openPanel();
            appendBubble('assistant', 'No pending tasks to scan. Add some tasks first!');
            return;
        }

        openPanel();

        // Show scanning indicator
        const welcome = document.getElementById('ai-welcome');
        if (welcome) welcome.remove();
        const scanWrapper = document.createElement('div');
        scanWrapper.className = 'ai-msg ai-msg-assistant';
        const scanBubble = document.createElement('div');
        scanBubble.className = 'ai-bubble ai-scan-indicator';
        scanBubble.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Scanning your tasks for automation & AI skill opportunities… <span class="ai-cursor"></span>`;
        scanWrapper.appendChild(scanBubble);
        messagesEl.appendChild(scanWrapper);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        streaming = true;
        sendBtn.disabled = true;

        const taskList = projectTasks.map(t => `{"id":"${t.id}","text":${JSON.stringify(t.text)}}`).join('\n');

        let fullText = '';
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: `Analyze these tasks and identify two things:\n1. Tasks that could be AUTOMATED with free tools (Zapier, Make, Google Apps Script, iOS Shortcuts, browser extensions)\n2. Tasks where Claude AI could directly SPEED UP the work (writing, coding, analysis, drafting, research, planning, generating content)\n\nTasks:\n${taskList}\n\nRespond ONLY with a raw JSON object — no markdown, no explanation:\n{"automatable":[{"id":"task-id","reason":"one sentence"}],"aiSkill":[{"id":"task-id","reason":"one sentence"}]}\n\nUse empty arrays if nothing qualifies for a category.` }],
                    system: 'You are a task analyzer. You ONLY respond with a raw JSON object matching the exact schema requested. No markdown fences, no explanation — just the JSON.'
                })
            });

            if (!response.ok) {
                let errDetail = `HTTP ${response.status}`;
                try { const j = await response.json(); errDetail = j.error || errDetail; } catch {}
                throw new Error(errDetail);
            }

            const scanData = await response.json();
            fullText = scanData.reply || '';
        } catch (err) {
            console.error('[Scan error]', err);
            scanWrapper.remove();
            const errBubble = appendBubble('assistant', '');
            errBubble.innerHTML = `<span class="ai-error"><i class="fa-solid fa-triangle-exclamation"></i> Scan failed: ${escapeHTML(err.message)}</span>`;
            streaming = false;
            sendBtn.disabled = false;
            return;
        }

        streaming = false;
        sendBtn.disabled = false;

        // Parse JSON result
        let automatable = [], aiSkill = [];
        try {
            const match = fullText.match(/\{[\s\S]*\}/);
            if (match) {
                const parsed = JSON.parse(match[0]);
                automatable = parsed.automatable || [];
                aiSkill     = parsed.aiSkill     || [];
            }
        } catch {}

        // Update flags for this project
        const autoIds  = new Set(automatable.map(f => f.id));
        const skillIds = new Set(aiSkill.map(f => f.id));
        tasks = tasks.map(t => {
            if (t.projectId !== currentProjectId) return t;
            return { ...t, automatable: autoIds.has(t.id), aiSkill: skillIds.has(t.id) };
        });
        saveAll();
        renderTasks();

        // Replace scanning bubble with result card
        scanWrapper.remove();
        const resultBubble = appendBubble('assistant', '');
        const total = autoIds.size + skillIds.size;

        if (total === 0) {
            resultBubble.innerHTML = `<strong>Scan complete.</strong> No automation or AI skill opportunities found. Try adding more specific tasks and scan again.`;
        } else {
            let html = `<strong>Scan complete — found ${total} opportunit${total > 1 ? 'ies' : 'y'}!</strong><br><br>`;

            if (automatable.length > 0) {
                html += `<i class="fa-solid fa-robot" style="color:var(--accent-primary);margin-right:4px"></i><strong>Automatable with free tools (${automatable.length})</strong><br>`;
                html += automatable.map(f => {
                    const t = tasks.find(t => t.id === f.id);
                    return `• <strong>${t ? escapeHTML(t.text) : f.id}</strong> — ${escapeHTML(f.reason)}`;
                }).join('<br>');
                html += '<br><br>';
            }

            if (aiSkill.length > 0) {
                html += `<i class="fa-solid fa-bolt" style="color:var(--accent-secondary);margin-right:4px"></i><strong>Claude can speed these up (${aiSkill.length})</strong><br>`;
                html += aiSkill.map(f => {
                    const t = tasks.find(t => t.id === f.id);
                    return `• <strong>${t ? escapeHTML(t.text) : f.id}</strong> — ${escapeHTML(f.reason)}`;
                }).join('<br>');
                html += '<br><br>';
            }

            html += `Click the icons next to each task to get a step-by-step guide.`;
            resultBubble.innerHTML = html;
        }
    }

    // ---- Smart Task Breakdown ----
    async function breakdownTask(task) {
        if (streaming) { showToast('AI is busy — wait for it to finish first.', 'info'); return; }
        openPanel();

        const scanWrapper = document.createElement('div');
        scanWrapper.className = 'ai-msg ai-msg-assistant';
        const scanBubble = document.createElement('div');
        scanBubble.className = 'ai-bubble ai-scan-indicator';
        scanBubble.innerHTML = `<i class="fa-solid fa-scissors"></i> Breaking down <strong>${escapeHTML(task.text)}</strong>… <span class="ai-cursor"></span>`;
        scanWrapper.appendChild(scanBubble);
        const welcome = document.getElementById('ai-welcome');
        if (welcome) welcome.remove();
        messagesEl.appendChild(scanWrapper);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        streaming = true;
        sendBtn.disabled = true;

        let fullText = '';
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: `Break down this task into 3–5 concrete, actionable subtasks: "${task.text}"\n\nRespond with ONLY a raw JSON array of subtask name strings, no explanation:\n["subtask 1", "subtask 2", "subtask 3"]` }],
                    system: 'You are a task decomposition assistant. Respond ONLY with a raw JSON array of short subtask name strings. No markdown fences, no explanation — just the JSON array.'
                })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const breakdownData = await response.json();
            fullText = breakdownData.reply || '';
        } catch (err) {
            scanBubble.innerHTML = `<span class="ai-error"><i class="fa-solid fa-triangle-exclamation"></i> Breakdown failed: ${escapeHTML(err.message)}</span>`;
            streaming = false;
            sendBtn.disabled = false;
            return;
        }

        streaming = false;
        sendBtn.disabled = false;

        let subtasks = [];
        try {
            const match = fullText.match(/\[[\s\S]*\]/);
            if (match) subtasks = JSON.parse(match[0]).filter(s => typeof s === 'string' && s.trim());
        } catch {}

        if (!subtasks.length) {
            scanBubble.innerHTML = `<span class="ai-error"><i class="fa-solid fa-triangle-exclamation"></i> Couldn't parse subtasks. Try again.</span>`;
            return;
        }

        // Store subtasks inline on the parent task
        const taskIdx = tasks.findIndex(t => t.id === task.id);
        if (taskIdx !== -1) {
            tasks[taskIdx].subtasks = subtasks.map(text => ({
                id: generateId(), text, completed: false
            }));
            saveAll();
            renderTasks();
        }

        scanWrapper.remove();
        const resultBubble = appendBubble('assistant', '');
        resultBubble.innerHTML =
            `<strong><i class="fa-solid fa-scissors"></i> Broke "${escapeHTML(task.text)}" into ${subtasks.length} subtasks:</strong><br><br>` +
            subtasks.map((s, i) => `${i + 1}. ${escapeHTML(s)}`).join('<br>') +
            `<br><br><span style="opacity:0.6;font-size:0.85em">Subtasks saved inside the task — expand it to see them.</span>`;
    }

    // ---- Auto-suggest priority (silent background call) ----
    async function autoSuggestPriority(taskId, taskText) {
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: `Task: "${taskText}"\n\nRespond with ONLY a JSON object: {"priority":"high"|"medium"|"low"}` }],
                    system: 'You are a task priority classifier. Respond ONLY with a raw JSON object like {"priority":"medium"}. No markdown, no explanation.'
                })
            });
            if (!response.ok) return;
            const priorityData = await response.json();
            const fullText = priorityData.reply || '';

            const match = fullText.match(/\{[\s\S]*\}/);
            if (!match) return;
            const { priority } = JSON.parse(match[0]);
            if (!['high', 'medium', 'low'].includes(priority)) return;

            const taskIdx = tasks.findIndex(t => t.id === taskId);
            if (taskIdx === -1 || tasks[taskIdx].priority) return; // don't overwrite if user already set one
            tasks[taskIdx] = { ...tasks[taskIdx], priority };
            saveAll();
            renderTasks();
            renderSidebar();

            const labels = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' };
            const preview = taskText.length > 35 ? taskText.slice(0, 35) + '…' : taskText;
            showToast(`AI set priority to ${labels[priority]} — "${preview}"`, 'info', 4000);
        } catch {}
    }

    // Expose to createTaskElement via bridge
    aiActions.openGuide           = openAutomationGuide;
    aiActions.openSkillGuide      = openAISkillGuide;
    aiActions.breakdownTask       = breakdownTask;
    aiActions.autoSuggestPriority = autoSuggestPriority;
    aiActions.openSettings        = () => { openPanel(); settingsPanel.classList.add('open'); };
    aiActions.openWithPrompt      = (prompt) => {
        openPanel();
        setTimeout(() => sendMessage(prompt), 120);
    };
    aiActions.openAndSend         = (prompt) => {
        openPanel();
        setTimeout(() => sendMessage(prompt), 400);
    };

    // Wire reorganize button
    const reorganizeBtn = document.getElementById('ai-reorganize-btn');
    if (reorganizeBtn) reorganizeBtn.addEventListener('click', () => {
        if (streaming) return;
        openPanel();
        setTimeout(() => sendMessage(
            `Look at ALL my pending tasks across every project. For each task, do three things:\n\n` +
            `1. Set the right **priority**: "high" (urgent or high-impact), "medium" (important but not urgent), or "low" (nice to have someday)\n` +
            `2. Classify it as **"quick-win"** (can be done in ~30 min or less, low effort) or **"deep-work"** (requires focus, concentration, or significant time)\n` +
            `3. If the task has NO due date, assign a realistic one based on its priority, complexity, and the overall workload — spread them out, don't pile everything on the same day. Never touch tasks that already have a due date.\n\n` +
            `First give me a short summary of your reasoning — what drove your priority decisions, how you split quick wins vs deep work, and which tasks you gave due dates to and why.\n` +
            `Then apply ALL the changes at once using ARCFORGE_UPDATES.`
        ), 200);
    });

    // Wire scan button
    const scanBtn = document.getElementById('ai-scan-btn');
    if (scanBtn) scanBtn.addEventListener('click', runAutomationScan);

    // ---- Input events ----
    sendBtn.addEventListener('click', () => sendMessage());

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    // ---- Restore chat history ----
    function renderChatHistory(history) {
        messagesEl.innerHTML = '';
        history.forEach(m => {
            // Strip ARCFORGE_UPDATES block from display (keep it in chatHistory for AI context)
            const displayText = m.role === 'assistant'
                ? m.content.replace(/<!--ARCFORGE_UPDATES[\s\S]*?ARCFORGE_UPDATES-->/, '').trim()
                : m.content;
            appendBubble(m.role, displayText);
        });
    }

    if (chatHistory.length > 0) {
        renderChatHistory(chatHistory);
    }

    // Sync from Supabase: if cloud has more messages, it's the most up-to-date version
    if (dbEnabled) {
        (async () => {
            try {
                const cloudStr = await dbLoadSetting('chatHistory');
                if (!cloudStr) return;
                const cloud = JSON.parse(cloudStr);
                if (!Array.isArray(cloud) || cloud.length <= chatHistory.length) return;
                chatHistory = cloud;
                localStorage.setItem('arcforgeChatHistory', JSON.stringify(chatHistory));
                renderChatHistory(chatHistory);
            } catch(e) {}
        })();
    }

    // ================================================================
    // EXPLORE MODE
    // ================================================================
    const modeBtns       = document.querySelectorAll('.ai-mode-btn');
    const exploreModeEl  = document.getElementById('ai-explore-mode');
    const exploreInputEl = document.getElementById('explore-input');
    const exploreBtnEl   = document.getElementById('explore-btn');
    const exploreRecentEl= document.getElementById('explore-recent');
    const exploreResultsEl = document.getElementById('explore-results');
    const filterPills    = document.querySelectorAll('.explore-filter-pill');
    const aiInputArea    = panel.querySelector('.ai-input-area');

    if (!exploreModeEl || !exploreInputEl) return; // safety guard

    let currentMode    = 'tasks';
    let exploreFilter  = 'all';
    let recentSearches = [];
    try {
        const saved = JSON.parse(localStorage.getItem('arcforgeExploreRecent') || '[]');
        if (Array.isArray(saved)) recentSearches = saved;
    } catch(e) {}

    // Switch between Tasks and Explore modes
    function setMode(mode) {
        currentMode = mode;
        modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        if (mode === 'explore') {
            messagesEl.classList.add('mode-hidden');
            if (aiInputArea) aiInputArea.classList.add('mode-hidden');
            exploreModeEl.classList.remove('mode-hidden');
            renderRecentSearches();
            exploreInputEl.focus();
        } else {
            messagesEl.classList.remove('mode-hidden');
            if (aiInputArea) aiInputArea.classList.remove('mode-hidden');
            exploreModeEl.classList.add('mode-hidden');
            inputEl.focus();
        }
    }

    modeBtns.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

    // Filter pill selection
    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            exploreFilter = pill.dataset.filter;
        });
    });

    // Recent searches
    function renderRecentSearches() {
        if (!recentSearches.length) { exploreRecentEl.innerHTML = ''; return; }
        exploreRecentEl.innerHTML = recentSearches.slice(0, 3).map(s =>
            `<button class="explore-recent-chip" title="${s}">${s}</button>`
        ).join('');
        exploreRecentEl.querySelectorAll('.explore-recent-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                exploreInputEl.value = chip.title;
                doExplore();
            });
        });
    }

    function saveRecentSearch(topic) {
        recentSearches = [topic, ...recentSearches.filter(s => s !== topic)].slice(0, 3);
        localStorage.setItem('arcforgeExploreRecent', JSON.stringify(recentSearches));
        renderRecentSearches();
    }

    // Main search function
    async function doExplore() {
        const topic = (exploreInputEl.value || '').trim();
        if (!topic || exploreBtnEl.disabled) return;

        exploreBtnEl.disabled = true;
        exploreResultsEl.innerHTML = `
            <div class="explore-loading">
                <div class="explore-loading-dots">
                    <span class="explore-loading-dot"></span>
                    <span class="explore-loading-dot"></span>
                    <span class="explore-loading-dot"></span>
                </div>
                <span>Searching for resources…</span>
            </div>`;

        const masterPrompt = localStorage.getItem('arcforgeMasterPrompt') || '';

        try {
            const res = await fetch('/api/explore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, filter: exploreFilter, masterPrompt }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                exploreResultsEl.innerHTML = `<p class="explore-error">${err.error || 'Something went wrong. Try again.'}</p>`;
                return;
            }

            const data = await res.json();
            saveRecentSearch(topic);
            renderExploreResults(data);
        } catch(err) {
            exploreResultsEl.innerHTML = `<p class="explore-error">Connection error. Check your network and try again.</p>`;
        } finally {
            exploreBtnEl.disabled = false;
        }
    }

    function renderExploreResults(data) {
        const { summary, resource } = data;
        let html = '';

        if (summary) {
            html += `
                <div class="explore-summary-block">
                    <div class="explore-section-label">Summary</div>
                    <p class="explore-summary">${summary}</p>
                </div>`;
        }

        if (resource && resource.url) {
            html += `
                <div class="explore-resource-card">
                    <div class="explore-section-label">Best Resource</div>
                    <div class="explore-resource-title">${resource.title || 'Resource'}</div>
                    ${resource.source ? `<div class="explore-resource-source">${resource.source}</div>` : ''}
                    ${resource.relevance ? `<div class="explore-resource-relevance">${resource.relevance}</div>` : ''}
                    <a class="explore-resource-link" href="${resource.url}" target="_blank" rel="noopener noreferrer">
                        <i class="fa-solid fa-arrow-up-right-from-square"></i> Open resource
                    </a>
                </div>`;
        }

        exploreResultsEl.innerHTML = html || '<p class="explore-error">No results found. Try rephrasing your topic.</p>';
    }

    exploreBtnEl.addEventListener('click', doExplore);
    exploreInputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doExplore(); }
    });
}

/* ============================================================
   PAGE HELP MODAL
   ============================================================ */
(function initHelpModal() {
    const HELP = {
        workspace: {
            icon: 'fa-solid fa-clipboard-list',
            title: 'Workspace — Your Command Center',
            body: `<p>This is where you manage everything day-to-day.</p>
<ul>
    <li><strong>Add tasks</strong> in the input bar — press Enter or click +</li>
    <li><strong>Priority / Context / Energy</strong> labels appear when you click the input — use them to tag your tasks</li>
    <li><strong>Focus timer</strong> — click the clock icon on any task to start a Pomodoro session</li>
    <li><strong>Filter bar</strong> — switch between All / Pending / Done, or use the sliders for deep-work and energy filters</li>
    <li><strong>AI button</strong> (bottom right) — ask ArcForge AI to prioritize, coach, or plan your day</li>
</ul>
<div class="help-tip">💡 Tip: Ask the AI "What should I focus on right now?" for a personalized recommendation.</div>`
        },
        history: {
            icon: 'fa-solid fa-clock-rotate-left',
            title: 'Activity History',
            body: `<p>A log of every work session you've completed, organized by project.</p>
<ul>
    <li>See <strong>total time tracked</strong> per project at a glance</li>
    <li>Drill into individual task sessions — when they started and how long they ran</li>
    <li>Use <strong>Export</strong> to download a CSV of your history</li>
</ul>
<div class="help-tip">💡 Tip: Use this to spot which projects are getting the most (or least) of your time.</div>`
        },
        weekly: {
            icon: 'fa-solid fa-calendar-week',
            title: 'Weekly Planning',
            body: `<p>A drag-and-drop tool to set your intention for the week ahead.</p>
<ul>
    <li><strong>Left panel</strong> — all your pending tasks across every project</li>
    <li><strong>Right panel</strong> — drag tasks here to commit to them this week</li>
    <li>Click <strong>Generate Summary</strong> to get a shareable week plan with AI commentary</li>
    <li>Copy the plan to paste into Notion, Slack, or your notes</li>
</ul>
<div class="help-tip">💡 Tip: Do this every Sunday evening to start Monday with clarity.</div>`
        },
        streaks: {
            icon: 'fa-solid fa-fire',
            title: 'Streaks — Daily Habits',
            body: `<p>Track the habits that keep you sharp — checked off each day to build your streak.</p>
<ul>
    <li>Hit <strong>+</strong> to add a new habit (gym, deep work block, reading, etc.)</li>
    <li>Check off habits each day — the flame icon shows your current streak</li>
    <li>Missing a day resets the streak — it's meant to sting a little</li>
    <li>The AI knows your habit data and will call you out if you're slipping</li>
</ul>
<div class="help-tip">💡 Tip: Keep it to 3–5 habits max. More than that and none of them stick.</div>`
        },
        shelf: {
            icon: 'fa-solid fa-book-open',
            title: 'Shelf — Reading List',
            body: `<p>Your personal library. Track what you're reading, what's next, and what you've finished.</p>
<ul>
    <li>Hit <strong>+</strong> to add a book with title, author, category, and status</li>
    <li>Switch between <strong>Reading / Done / Want to Read</strong> tabs</li>
    <li>Add a note to any finished book to capture your key takeaway</li>
    <li>The AI can recommend your next read based on your goals and current shelf</li>
</ul>
<div class="help-tip">💡 Tip: Add a one-line note to every book you finish — future you will thank you.</div>`
        },
        goals: {
            icon: 'fa-solid fa-bullseye',
            title: 'Goals — Your 3 Big Bets',
            body: `<p>Where you define what you're actually building. Not a to-do list — a north star.</p>
<ul>
    <li>Each goal has a <strong>name, description, and target date</strong></li>
    <li>Add <strong>milestones</strong> to break each goal into checkpoints</li>
    <li>Track <strong>% progress</strong> — update it manually as you move forward</li>
    <li>The AI uses your goals to give you context-aware coaching across the whole app</li>
</ul>
<div class="help-tip">💡 Tip: Limit yourself to 3 goals. More than that means none of them are real priorities.</div>`
        },
        pipeline: {
            icon: 'fa-solid fa-briefcase',
            title: 'Pipeline — Client Tracker',
            body: `<p>Track potential and active clients from first contact all the way to paid.</p>
<ul>
    <li>Hit <strong>+</strong> to add a client with name, project description, deal value, and status</li>
    <li>Statuses: <strong>Pitching → Active → Delivered → Paid</strong></li>
    <li>The header shows your total pipeline value and active revenue at a glance</li>
    <li>The AI knows your pipeline and can help you think through next steps</li>
</ul>
<div class="help-tip">💡 Tip: Update statuses regularly — seeing money move through stages is motivating.</div>`
        },
    };

    const modal    = document.getElementById('help-modal');
    const titleEl  = document.getElementById('help-modal-title');
    const bodyEl   = document.getElementById('help-modal-body');
    const closeBtn = document.getElementById('close-help-modal');

    function openHelp(page) {
        const data = HELP[page];
        if (!data) return;
        titleEl.innerHTML = `<i class="${data.icon}"></i> ${data.title}`;
        bodyEl.innerHTML = data.body;
        modal.classList.remove('hidden');
    }

    document.querySelectorAll('.page-help-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            openHelp(btn.dataset.helpPage);
        });
    });

    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.add('hidden');
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') modal.classList.add('hidden');
    });
})();

/* ============================================================
   COMPOSER TOOLBAR — show on input focus, hide when empty+blur
   ============================================================ */
(function initComposerCollapse() {
    const priorityRow = document.getElementById('priority-row');
    if (!taskInput || !priorityRow) return;

    function openComposer() {
        priorityRow.classList.add('composer-open');
    }
    function tryCloseComposer() {
        const inputHasFocus   = document.activeElement === taskInput;
        const toolbarHasFocus = priorityRow.contains(document.activeElement);
        const inputHasText    = taskInput.value.trim() !== '';
        if (!inputHasFocus && !toolbarHasFocus && !inputHasText) {
            priorityRow.classList.remove('composer-open');
        }
    }

    taskInput.addEventListener('focus', openComposer);
    taskInput.addEventListener('blur', () => setTimeout(tryCloseComposer, 200));

    // Also open when the toolbar itself is focused (buttons inside it)
    priorityRow.addEventListener('focusin', openComposer);
    priorityRow.addEventListener('focusout', () => setTimeout(tryCloseComposer, 200));
})();
