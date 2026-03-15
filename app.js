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
    const parsed = JSON.parse(localStorage.getItem('orbitProjects'));
    if (Array.isArray(parsed) && parsed.length > 0) projects = parsed;
} catch(e) {}

let templates = [];
try {
    const parsed = JSON.parse(localStorage.getItem('orbitTemplates'));
    if (Array.isArray(parsed)) templates = parsed;
} catch(e) {}

let tasks = [];
try {
    const parsed = JSON.parse(localStorage.getItem('orbitTasks'));
    if (Array.isArray(parsed)) tasks = parsed;
} catch(e) {}

if (projects.length === 0) projects = [...defaultProjects];
if (templates.length === 0) templates = [...defaultTemplates];

// Backward compat: ensure all tasks and projects have required fields
tasks    = tasks.map((t, i) => ({
    priority:    null,
    dueDate:     null,
    notes:       '',
    completedAt: null,
    order:       i,
    ...t,
    projectId: t.projectId || projects[0]?.id
}));
projects = projects.map(p => ({ archived: false, ...p }));

let currentProjectId = localStorage.getItem('orbitCurrentProject') || projects[0]?.id;
let currentFilter = 'all';
let currentSort = 'custom';
let currentTheme = localStorage.getItem('orbitTheme') || 'default';

// Pomodoro duration (in seconds), default 25 min, persisted
let pomodoroDuration = parseInt(localStorage.getItem('orbitPomodoroDuration') || '1500', 10);

// Initialize Supabase connection (returns false if credentials not filled)
const dbEnabled = (typeof initDB === 'function') ? initDB() : false;

let activeTimerTaskId = null;
let timerInterval = null;
let timeRemaining = pomodoroDuration;

// Selected priority for new tasks
let selectedPriority = '';

// Drag state
let dragSrcId = null;

// DOM Elements
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
const closeSidebarBtn = document.getElementById('close-sidebar');

const projectListEl = document.getElementById('project-list');
const templateListEl = document.getElementById('template-list');

const currentProjectTitle = document.getElementById('current-project-title');
const deleteProjectBtn = document.getElementById('delete-project-btn');
const saveTemplateBtn = document.getElementById('save-template-btn');
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
const workspaceView = document.getElementById('workspace-view');
const historyView = document.getElementById('history-view');
const navHistoryBtn = document.getElementById('nav-history-btn');
const backToWorkspaceBtn = document.getElementById('back-to-workspace-btn');
const historySearch = document.getElementById('history-search');
const historyListContainer = document.getElementById('history-list-container');
const exportBtn = document.getElementById('export-btn');

// Modals
const modalOverlay = document.getElementById('modal-overlay');
const projectModal = document.getElementById('project-modal');
const templateModal = document.getElementById('template-modal');
const projectForm = document.getElementById('project-form');
const templateForm = document.getElementById('template-form');
const addProjectBtn = document.getElementById('add-project-btn');
const addTemplateBtn = document.getElementById('add-template-btn');
const projectTemplateSelect = document.getElementById('project-template-select');
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
                    priority:    null,
                    dueDate:     null,
                    notes:       '',
                    completedAt: null,
                    order:       i,
                    ...t
                }));
                currentProjectId = projects.find(p => p.id === currentProjectId)
                    ? currentProjectId
                    : projects[0].id;
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
    }

    renderSidebar();
    switchProject(currentProjectId);
    initVoiceControl();
    initThemePicker();
    initDurationPicker();
    initPrioritySelector();
    initAI();
}

// --- Data Persistence ---
function saveAll() {
    localStorage.setItem('orbitProjects', JSON.stringify(projects));
    localStorage.setItem('orbitTemplates', JSON.stringify(templates));
    localStorage.setItem('orbitTasks', JSON.stringify(tasks));
    localStorage.setItem('orbitCurrentProject', currentProjectId);
    if (dbEnabled) {
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
            localStorage.setItem('orbitPomodoroDuration', pomodoroDuration.toString());
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

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            renderTasks();
        });
    }

    // Project Actions
    deleteProjectBtn.addEventListener('click', confirmDeleteProject);
    saveTemplateBtn.addEventListener('click', prepSaveAsTemplate);
    if (completeAllBtn) completeAllBtn.addEventListener('click', completeAllTasks);
    if (clearCompletedBtn) clearCompletedBtn.addEventListener('click', clearCompletedTasks);

    // Timer controls
    if (restartTimerBtn) restartTimerBtn.addEventListener('click', restartTimer);

    // History controls
    if (navHistoryBtn) navHistoryBtn.addEventListener('click', showHistory);
    if (backToWorkspaceBtn) backToWorkspaceBtn.addEventListener('click', showWorkspace);
    if (historySearch) historySearch.addEventListener('input', renderHistory);
    if (exportBtn) exportBtn.addEventListener('click', exportData);

    // Project Button
    addProjectBtn.addEventListener('click', openProjectModal);
    addTemplateBtn.addEventListener('click', () => openModal(templateModal));

    closeModals.forEach(btn => btn.addEventListener('click', closeAllModals));
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeAllModals();
    });

    // Forms inside Modals
    projectForm.addEventListener('submit', handleCreateProject);
    templateForm.addEventListener('submit', handleCreateTemplate);
}

// --- User Interface & Rendering ---

function renderSidebar() {
    // Render Active Projects
    projectListEl.innerHTML = '';
    const activeProjects   = projects.filter(p => !p.archived);
    const archivedProjects = projects.filter(p => p.archived);

    activeProjects.forEach(p => {
        const projTasks = tasks.filter(t => t.projectId === p.id);
        const total = projTasks.length;
        const done  = projTasks.filter(t => t.completed).length;
        const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

        const li = document.createElement('li');
        li.className = `list-item ${p.id === currentProjectId ? 'active' : ''}`;
        li.dataset.projectId = p.id;

        li.innerHTML = `
            <div class="project-item-inner">
                <span class="item-name">${escapeHTML(p.name)}</span>
                <div class="project-item-controls">
                    <button class="item-archive" title="Archive project"><i class="fa-solid fa-box-archive"></i></button>
                    <button class="item-rename"  title="Rename"><i class="fa-solid fa-pen"></i></button>
                    <span class="project-count">${done}/${total}</span>
                </div>
            </div>
            ${total > 0 ? `<div class="project-progress-bar"><div class="project-progress-fill" style="width: ${pct}%"></div></div>` : ''}
        `;

        li.querySelector('.project-item-inner').addEventListener('click', (e) => {
            if (!e.target.closest('.item-rename') && !e.target.closest('.item-archive')) {
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
                        <button class="item-restore" title="Restore project"><i class="fa-solid fa-rotate-left"></i></button>
                        <button class="item-delete-archived" title="Delete permanently"><i class="fa-solid fa-trash"></i></button>
                        <span class="project-count">${projTasks.length} tasks</span>
                    </div>
                </div>
            `;
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

    // Render Templates
    templateListEl.innerHTML = '';
    templates.forEach(t => {
        const li = document.createElement('li');
        li.className = 'list-item';
        li.innerHTML = `
            <span class="item-name"><i class="fa-solid fa-layer-group" style="margin-right:8px; font-size: 0.8em;"></i> ${escapeHTML(t.name)}</span>
            <button class="item-delete" title="Delete Template"><i class="fa-solid fa-trash"></i></button>
        `;

        li.querySelector('.item-delete').onclick = (e) => {
            e.stopPropagation();
            deleteTemplate(t.id);
        };

        li.onclick = () => {
            openProjectModal();
            projectTemplateSelect.value = t.id;
            document.getElementById('project-name-input').value = t.name;
        };

        templateListEl.appendChild(li);
    });
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
            projects.push({ id: generateId(), name: 'Main Tasks', archived: false });
        }
        id = activeProjects[0]?.id || projects[0].id;
    }

    currentProjectId = id;
    saveAll();

    const proj = projects.find(p => p.id === currentProjectId);
    currentProjectTitle.textContent = proj.name;

    closeSidebar();
    renderSidebar();

    document.querySelector('[data-filter="all"]').click();

    const canDelete = activeProjects.length > 1;
    deleteProjectBtn.disabled = !canDelete;
    deleteProjectBtn.style.opacity = canDelete ? '1' : '0.5';
    deleteProjectBtn.style.cursor  = canDelete ? 'pointer' : 'not-allowed';
}

function renderTasks() {
    taskList.innerHTML = '';

    const projectTasks = tasks.filter(t => t.projectId === currentProjectId);
    let filteredTasks = [...projectTasks];

    if (currentFilter === 'pending') {
        filteredTasks = projectTasks.filter(t => !t.completed);
    } else if (currentFilter === 'completed') {
        filteredTasks = projectTasks.filter(t => t.completed);
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
    }

    if (filteredTasks.length === 0) {
        taskList.style.display = 'none';
        emptyState.classList.add('visible');
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
    li.className = `task-item ${task.completed ? 'completed' : ''} ${activeTimerTaskId === task.id ? 'active-timer' : ''}`;
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

    // Priority dot
    let prioDot = '';
    if (task.priority) {
        prioDot = `<span class="prio-dot prio-dot-${task.priority}"></span>`;
    }

    // Notes indicator
    let notesIcon = '';
    if (task.notes && task.notes.trim()) {
        notesIcon = `<i class="fa-solid fa-note-sticky notes-indicator" title="Tem notas"></i>`;
    }

    // Automation badge
    const autoBadge = task.automatable
        ? `<button class="auto-badge" title="This task may be automatable — click for a free setup guide"><i class="fa-solid fa-robot"></i></button>`
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
                        ${autoBadge}
                    </div>
                    <div class="task-badges">
                        ${timeBadge}
                        ${dueBadge}
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
                    <label class="extra-label"><i class="fa-regular fa-calendar"></i> Due Date</label>
                    <input type="date" class="task-due-input extra-input" value="${task.dueDate || ''}">
                </div>
                <div class="task-extra-field">
                    <label class="extra-label"><i class="fa-regular fa-note-sticky"></i> Notes</label>
                    <textarea class="task-notes-input extra-input" placeholder="Add notes...">${escapeHTML(task.notes || '')}</textarea>
                </div>
            </div>
        </div>
    `;

    // Automation guide button
    if (task.automatable) {
        li.querySelector('.auto-badge').addEventListener('click', (e) => {
            e.stopPropagation();
            if (aiActions.openGuide) aiActions.openGuide(task);
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
    if (templateForm) templateForm.reset();
}

function openProjectModal() {
    projectTemplateSelect.innerHTML = '<option value="">-- Blank Project --</option>';
    templates.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.name;
        projectTemplateSelect.appendChild(option);
    });

    openModal(projectModal);
    setTimeout(() => document.getElementById('project-name-input').focus(), 100);
}

// --- Project & Template Operations ---

function handleCreateProject(e) {
    e.preventDefault();
    const name = document.getElementById('project-name-input').value.trim();
    const templateId = projectTemplateSelect.value;

    if (!name) return;

    const newProjectId = generateId();
    projects.push({ id: newProjectId, name });

    if (templateId) {
        const tpl = templates.find(t => t.id === templateId);
        if (tpl && tpl.tasks) {
            const newTasks = tpl.tasks.map((text, i) => ({
                id:          generateId(),
                projectId:   newProjectId,
                text,
                completed:   false,
                timeSpent:   0,
                priority:    null,
                dueDate:     null,
                notes:       '',
                completedAt: null,
                order:       i,
                createdAt:   new Date().toISOString()
            }));
            tasks.push(...newTasks);
        }
    }

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

function handleCreateTemplate(e) {
    e.preventDefault();
    const name = document.getElementById('template-name-input').value.trim();
    const tasksRaw = document.getElementById('template-tasks-input').value;

    if (!name) return;

    const templateTasks = tasksRaw.split('\n')
                                  .map(t => t.trim())
                                  .filter(t => t.length > 0);

    templates.push({
        id: generateId(),
        name,
        tasks: templateTasks.length > 0 ? templateTasks : []
    });

    saveAll();
    closeAllModals();
    renderSidebar();
    showToast(`Template "${name}" salvo!`, 'success');
}

function prepSaveAsTemplate() {
    const curProj  = projects.find(p => p.id === currentProjectId);
    const curTasks = tasks.filter(t => t.projectId === currentProjectId).map(t => t.text);

    document.getElementById('template-name-input').value = `${curProj.name} Template`;
    document.getElementById('template-tasks-input').value = curTasks.join('\n');

    openModal(templateModal);
}

function deleteTemplate(id) {
    if (confirm('Delete this template?')) {
        if (dbEnabled) dbDeleteTemplate(id);
        templates = templates.filter(t => t.id !== id);
        saveAll();
        renderSidebar();
        showToast('Template deleted.', 'warning');
    }
}

// --- Task Operations ---
function addTask(e) {
    e.preventDefault();
    const taskText = taskInput.value.trim();
    if (!taskText) return;

    // Assign order: new tasks appear at the top (lowest order value)
    const projectTasks = tasks.filter(t => t.projectId === currentProjectId);
    const minOrder = projectTasks.length > 0 ? Math.min(...projectTasks.map(t => t.order ?? 0)) : 0;

    const newTask = {
        id:          generateId(),
        projectId:   currentProjectId,
        text:        taskText,
        completed:   false,
        timeSpent:   0,
        priority:    selectedPriority || null,
        dueDate:     null,
        notes:       '',
        completedAt: null,
        order:       minOrder - 1,
        createdAt:   new Date().toISOString()
    };

    tasks.unshift(newTask);
    saveAll();
    taskInput.value = '';

    if (currentFilter === 'completed') {
        document.querySelector('[data-filter="all"]').click();
    } else {
        renderTasks();
        renderSidebar();
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
    const completed = tasks.filter(t => t.projectId === currentProjectId && t.completed);
    if (completed.length === 0) {
        showToast('No completed tasks to clear.', 'info');
        return;
    }
    if (confirm(`Remove ${completed.length} completed task(s)?`)) {
        if (dbEnabled) {
            completed.forEach(t => dbDeleteTask(t.id));
        }
        tasks = tasks.filter(t => !(t.projectId === currentProjectId && t.completed));
        saveAll();
        renderTasks();
        renderSidebar();
        showToast(`${completed.length} task(s) removed.`, 'warning');
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
    clearInterval(timerInterval);
    activeTimerTaskId = null;
    timerInterval = null;
    saveAll();

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
    const filename = `orbit-tasks-${yyyy}${mm}${dd}.json`;

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

    showToast('Dados exportados com sucesso!', 'success');
}

// --- History View Logic ---
function showHistory() {
    workspaceView.classList.add('hidden');
    historyView.classList.remove('hidden');
    closeSidebar();
    document.getElementById('mobile-history-btn-nav')?.classList.add('active');
    document.getElementById('mobile-menu-btn')?.classList.remove('active');

    renderHistory();
}

function showWorkspace() {
    historyView.classList.add('hidden');
    workspaceView.classList.remove('hidden');
    document.getElementById('mobile-history-btn-nav')?.classList.remove('active');
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

    if (!SpeechRecognition) {
        console.warn('Speech Recognition API not supported in this browser.');
        if (voiceBtn) voiceBtn.style.display = 'none';
        const help = document.getElementById('voice-help');
        if (help) help.style.display = 'none';
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
        voiceBtn.classList.remove('recording');
        setStatus('');
        taskInput.placeholder = "What needs to be done?";
    }

    voiceBtn.addEventListener('click', () => {
        if (isActive) stopListening();
        else startListening();
    });

    recognition.onstart = () => {
        voiceBtn.classList.add('recording');
        setStatus('Say "Hey Orbit"...');
        taskInput.placeholder = 'Say "Hey Orbit" to start...';
    };

    recognition.onend = () => {
        if (isActive) {
            try { recognition.start(); } catch(e) {}
        } else {
            voiceBtn.classList.remove('recording');
            setStatus('');
            taskInput.placeholder = "What needs to be done?";
        }
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            isActive = false;
            voiceBtn.classList.remove('recording');
            setStatus('Mic access denied.', 'var(--accent-danger)');
            setTimeout(() => setStatus(''), 3000);
            return;
        }
        if (event.error === 'aborted') return;
    };

    function isWakeWord(text) {
        return text.includes('hey orbit') ||
               text.includes('hey or bit') ||
               text.includes('hey or orbit') ||
               text.includes('a orbit') ||
               text.includes('hey orbits');
    }

    function isGoodbyeWord(text) {
        return text.includes('goodbye orbit') ||
               text.includes('good bye orbit') ||
               text.includes('bye orbit') ||
               text.includes('stop orbit');
    }

    function stripWakeWord(text) {
        return text
            .replace(/hey orbit[s]?/g, '')
            .replace(/hey or bits?/g, '')
            .replace(/hey or orbit/g, '')
            .replace(/a orbit/g, '')
            .trim();
    }

    function executeCommand(command) {
        if (!command) return;
        handleVoiceCommand(command);
        setStatus(`Done: "${command}"`, 'var(--accent-secondary)');
        setTimeout(() => {
            if (isActive) {
                setStatus('Say "Hey Orbit"...');
                taskInput.placeholder = 'Say "Hey Orbit" to start...';
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
            projects.push({ id: newProjectId, name: name.charAt(0).toUpperCase() + name.slice(1) });
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
        const completed = tasks.filter(t => t.projectId === currentProjectId && t.completed);
        if (dbEnabled) completed.forEach(t => dbDeleteTask(t.id));
        tasks = tasks.filter(t => t.projectId !== currentProjectId || !t.completed);
        saveAll();
        renderTasks();
        renderSidebar();
        showToast('Completed tasks removed.', 'warning');
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
        notes:       '',
        completedAt: null,
        order:       minOrder - 1,
        createdAt:   new Date().toISOString()
    };
    tasks.unshift(newTask);
    saveAll();

    if (projId === currentProjectId) {
        if (currentFilter === 'completed') {
            document.querySelector('[data-filter="all"]').click();
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
            themeDropdown.classList.add('hidden');
        });
    });
}

function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('orbitTheme', theme);

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
const aiActions = { openGuide: null };

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
            try { return JSON.parse(localStorage.getItem('orbitMasterPromptFile') || 'null'); }
            catch { return null; }
        })();
        const hasContent = !!(localStorage.getItem('orbitMasterPrompt') || '').trim();

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
            if (mpTextarea) mpTextarea.value = localStorage.getItem('orbitMasterPrompt') || '';
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
            localStorage.setItem('orbitMasterPrompt', text);
            localStorage.setItem('orbitMasterPromptFile', JSON.stringify({
                name: file.name,
                size: file.size,
                uploadedAt: new Date().toISOString()
            }));
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
        localStorage.removeItem('orbitMasterPrompt');
        localStorage.removeItem('orbitMasterPromptFile');
        mpRenderState();
        showToast('MasterPrompt removed.', 'warning');
    });

    // Edit manually (from file card)
    mpEditBtn.addEventListener('click', () => {
        mpFileCard.classList.add('hidden');
        mpDropzone.classList.add('hidden');
        mpEditor.classList.remove('hidden');
        if (mpTextarea) mpTextarea.value = localStorage.getItem('orbitMasterPrompt') || '';
        mpTextarea.focus();
    });

    // "type manually instead" link
    mpTypeBtn.addEventListener('click', () => {
        mpDropzone.classList.add('hidden');
        mpEditor.classList.remove('hidden');
        mpTextarea.focus();
    });

    // Save from editor
    mpSaveBtn.addEventListener('click', () => {
        const val = (mpTextarea.value || '').trim();
        if (!val) { showToast('Write something first.', 'warning'); return; }
        localStorage.setItem('orbitMasterPrompt', val);
        // If saving manually, clear file metadata so UI shows editor, not card
        localStorage.removeItem('orbitMasterPromptFile');
        // Store as a virtual "manual" file for display purposes
        localStorage.setItem('orbitMasterPromptFile', JSON.stringify({
            name: 'manual entry',
            size: new Blob([val]).size,
            uploadedAt: new Date().toISOString()
        }));
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
        showToast('New conversation started.', 'info');
    });

    // ---- Context bar ----
    function updateContextBar() {
        if (!contextInfo) return;
        const activeProjects = projects.filter(p => !p.archived).length;
        const pendingTasks   = tasks.filter(t => !t.completed).length;
        const totalTasks     = tasks.length;
        const mp = (localStorage.getItem('orbitMasterPrompt') || '').trim();
        contextInfo.textContent =
            `${activeProjects} projects · ${pendingTasks} pending / ${totalTasks} tasks` +
            (mp ? ' · MasterPrompt active' : '');
        if (sendBtn) sendBtn.disabled = false;
    }

    // ---- Build system prompt ----
    function buildSystemPrompt() {
        const mp  = (localStorage.getItem('orbitMasterPrompt') || '').trim();
        const now = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // Summarise data for context
        const activeProjects = projects.filter(p => !p.archived);
        const projectContext = activeProjects.map(p => {
            const ptasks = tasks.filter(t => t.projectId === p.id);
            const pending   = ptasks.filter(t => !t.completed);
            const completed = ptasks.filter(t => t.completed);
            const overdue   = pending.filter(t => t.dueDate && new Date(t.dueDate + 'T00:00:00') < new Date());
            const highPrio  = pending.filter(t => t.priority === 'high');
            return {
                name: p.name,
                pending:   pending.map(t => ({
                    id:       t.id,
                    text:     t.text,
                    priority: t.priority || null,
                    dueDate:  t.dueDate  || null,
                    timeSpent: t.timeSpent ? `${Math.round(t.timeSpent/60)}m` : null,
                    notes:    t.notes || null
                })),
                completedCount: completed.length,
                overdueCount:   overdue.length,
                highPrioCount:  highPrio.length
            };
        });

        let system = `You are Orbit AI, an intelligent productivity assistant embedded in Orbit Tasks, a personal task manager.
Today is ${now}.

${mp ? `## About the user\n${mp}\n` : ''}
## Current workspace context
${JSON.stringify(projectContext, null, 2)}

## Instructions
- Be concise, direct, and genuinely helpful.
- Reference specific tasks, projects, or patterns when relevant.
- Format responses clearly: use bullet points for lists, **bold** for emphasis, and short paragraphs.
- Never be generic — ground your advice in the actual tasks and projects provided above.

## Reorganizing & prioritizing tasks
When the user asks you to reorganize, reprioritize, or set deadlines for their tasks, include BOTH:
1. A clear, human-readable explanation of your reasoning
2. At the very end of your response, this exact block (no spaces or line breaks inside the markers):
<!--ORBIT_UPDATES[{"id":"task-id","priority":"high","dueDate":"2026-03-25"}]ORBIT_UPDATES-->

Rules for the ORBIT_UPDATES block:
- Only include tasks you are actually changing
- Valid priorities: "high", "medium", "low", null
- Date format: YYYY-MM-DD, or null to clear a due date
- Omit a field entirely if you are not changing it
- Do NOT include this block unless the user explicitly asked for reorganization or prioritization`;

        return system;
    }

    // ---- Render welcome screen ----
    function buildWelcomeEl() {
        const el = document.createElement('div');
        el.className = 'ai-welcome';
        el.id = 'ai-welcome';
        el.innerHTML = `
            <div class="ai-welcome-icon"><i class="fa-solid fa-robot"></i></div>
            <p class="ai-welcome-title">Hey, I'm Orbit AI</p>
            <p class="ai-welcome-sub">I have full context of your projects and tasks. Ask me to analyze your workload, find bottlenecks, suggest what to tackle next, or anything else.</p>
            <div class="ai-starters">
                <button class="ai-starter-btn ai-starter-featured" data-prompt="I want you to reorganize and prioritize all my tasks for me. First, ask me about my main goal or deadline so your recommendations are on point.">Help me prioritize</button>
                <button class="ai-starter-btn" data-prompt="What should I focus on today based on my tasks?">What to focus on today?</button>
                <button class="ai-starter-btn" data-prompt="Which tasks are overdue or at risk? Give me a quick summary.">Any overdue tasks?</button>
                <button class="ai-starter-btn" data-prompt="Give me a brief analysis of my current workload across all projects.">Analyze my workload</button>
                <button class="ai-starter-btn" data-prompt="What tasks have I been spending the most time on?">Where is my time going?</button>
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
                return `<pre style="background:rgba(255,255,255,0.05);padding:0.6rem 0.75rem;border-radius:6px;overflow-x:auto;font-size:0.8em;font-family:'JetBrains Mono',monospace;margin:0.4rem 0"><code>${escapeHtml(code)}</code></pre>`;
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
            // unordered lists
            .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
            // numbered lists
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            // line breaks → paragraphs
            .split(/\n{2,}/)
            .map(p => p.trim() ? (p.startsWith('<') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`) : '')
            .join('');
    }

    function escapeHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

            // Parse SSE stream
            const reader  = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer    = '';
            let fullText  = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // keep incomplete line

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    try {
                        const evt = JSON.parse(data);
                        if (evt.type === 'content_block_delta' &&
                            evt.delta?.type === 'text_delta') {
                            fullText += evt.delta.text;
                            bubble.innerHTML = renderMarkdown(fullText) + '<span class="ai-cursor"></span>';
                            messagesEl.scrollTop = messagesEl.scrollHeight;
                        }
                        if (evt.type === 'message_stop') {
                            bubble.innerHTML = renderMarkdown(fullText);
                        }
                    } catch {}
                }
            }

            // Finalise
            if (fullText) {
                // Check for task update block before rendering
                const updatesMatch = fullText.match(/<!--ORBIT_UPDATES(\[[\s\S]*?\])ORBIT_UPDATES-->/);
                if (updatesMatch) {
                    try {
                        const updates = JSON.parse(updatesMatch[1]);
                        const cleanText = fullText.replace(/<!--ORBIT_UPDATES[\s\S]*?ORBIT_UPDATES-->/, '').trim();
                        bubble.innerHTML = renderMarkdown(cleanText);
                        showApplyCard(wrapper, updates);
                    } catch {
                        bubble.innerHTML = renderMarkdown(fullText);
                    }
                } else {
                    bubble.innerHTML = renderMarkdown(fullText);
                }
                chatHistory.push({ role: 'assistant', content: fullText });
            }

        } catch (err) {
            console.error('[AI] Stream error:', err);
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
            const idx = tasks.findIndex(t => t.id === u.id);
            if (idx === -1) return;
            if (u.priority !== undefined) tasks[idx] = { ...tasks[idx], priority: u.priority };
            if (u.dueDate  !== undefined) tasks[idx] = { ...tasks[idx], dueDate:  u.dueDate  };
        });
        saveAll();
        renderTasks();
        renderSidebar();
    }

    function showApplyCard(msgWrapper, updates) {
        const validUpdates = updates.filter(u => tasks.find(t => t.id === u.id));
        if (!validUpdates.length) return;

        const prioLabel = { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low', null: 'None' };

        const lines = validUpdates.map(u => {
            const task = tasks.find(t => t.id === u.id);
            const parts = [];
            if (u.priority !== undefined) parts.push(`priority → <strong>${prioLabel[u.priority] || u.priority || 'None'}</strong>`);
            if (u.dueDate  !== undefined) parts.push(`due → <strong>${u.dueDate || 'cleared'}</strong>`);
            return `<li>${escapeHtml(task.text)}<span class="ai-apply-change">${parts.join(' · ')}</span></li>`;
        }).join('');

        const card = document.createElement('div');
        card.className = 'ai-apply-card';
        card.innerHTML = `
            <div class="ai-apply-header">
                <i class="fa-solid fa-list-check"></i>
                <span>${validUpdates.length} task${validUpdates.length > 1 ? 's' : ''} will be updated</span>
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
        scanBubble.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Scanning your tasks for automation opportunities… <span class="ai-cursor"></span>`;
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
                    messages: [{ role: 'user', content: `Analyze these tasks and identify which ones could realistically be automated using free tools (Zapier free tier, Make free tier, Google Apps Script, iOS Shortcuts, browser extensions).\n\nTasks:\n${taskList}\n\nRespond ONLY with a raw JSON array — no markdown, no explanation:\n[{"id":"task-id","reason":"one sentence why"}]\n\nIf none are automatable, respond with: []` }],
                    system: 'You are a task automation analyzer. You ONLY respond with a raw JSON array. No markdown fences, no explanation — just the JSON.'
                })
            });

            if (!response.ok) {
                let errDetail = `HTTP ${response.status}`;
                try { const j = await response.json(); errDetail = j.error || errDetail; } catch {}
                throw new Error(errDetail);
            }

            const reader  = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    try {
                        const evt = JSON.parse(data);
                        if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                            fullText += evt.delta.text;
                        }
                    } catch {}
                }
            }
        } catch (err) {
            console.error('[Scan error]', err);
            scanWrapper.remove();
            const errBubble = appendBubble('assistant', '');
            errBubble.innerHTML = `<span class="ai-error"><i class="fa-solid fa-triangle-exclamation"></i> Scan failed: ${escapeHtml(err.message)}</span>`;
            streaming = false;
            sendBtn.disabled = false;
            return;
        }

        streaming = false;
        sendBtn.disabled = false;

        // Parse JSON result
        let found = [];
        try {
            const match = fullText.match(/\[[\s\S]*\]/);
            if (match) found = JSON.parse(match[0]);
        } catch {}

        // Update automatable flags for this project
        const foundIds = new Set(found.map(f => f.id));
        tasks = tasks.map(t => {
            if (t.projectId !== currentProjectId) return t;
            return { ...t, automatable: foundIds.has(t.id) };
        });
        saveAll();
        renderTasks();

        // Replace scanning bubble with result card
        scanWrapper.remove();
        const resultBubble = appendBubble('assistant', '');
        if (found.length === 0) {
            resultBubble.innerHTML = `<strong>Scan complete.</strong> No clear automation opportunities found in your current tasks. Try adding more specific, repetitive tasks and scan again.`;
        } else {
            const taskLines = found.map(f => {
                const t = tasks.find(t => t.id === f.id);
                return `• <strong>${t ? escapeHtml(t.text) : f.id}</strong> — ${escapeHtml(f.reason)}`;
            }).join('<br>');
            resultBubble.innerHTML = `<strong>Found ${found.length} task${found.length > 1 ? 's' : ''} that could be automated!</strong><br><br>
Look for the <i class="fa-solid fa-robot" style="color:var(--accent-primary);margin:0 2px"></i> icon next to them — click it to get a free, step-by-step setup guide for each one.<br><br>${taskLines}`;
        }
    }

    // Expose to createTaskElement via bridge
    aiActions.openGuide = openAutomationGuide;

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
}
