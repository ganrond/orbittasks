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

// Backward compat: ensure all tasks have required fields
tasks = tasks.map((t, i) => ({
    priority:    null,
    dueDate:     null,
    notes:       '',
    completedAt: null,
    order:       i,
    ...t,
    projectId: t.projectId || projects[0]?.id
}));

let currentProjectId = localStorage.getItem('orbitCurrentProject') || projects[0]?.id;
let currentFilter = 'all';
let currentSort = 'custom';
let currentTheme = localStorage.getItem('orbitTheme') || 'default';

// Pomodoro duration (in seconds), default 25 min, persisted
let pomodoroDuration = parseInt(localStorage.getItem('orbitPomodoroDuration') || '1500', 10);

// Inicializa conexão com Supabase (retorna false se credenciais não preenchidas)
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
            showToast(`Duração do foco: ${mins}m`, 'info');
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
function bindEvents() {
    // Sidebar Mobile Toggle
    menuToggle.addEventListener('click', () => sidebar.classList.add('open'));
    closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

    // Bottom Nav (mobile)
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileHistoryBtnNav = document.getElementById('mobile-history-btn-nav');
    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', () => sidebar.classList.add('open'));
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
    // Render Projects
    projectListEl.innerHTML = '';
    projects.forEach(p => {
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
                    <button class="item-rename" title="Renomear"><i class="fa-solid fa-pen"></i></button>
                    <span class="project-count">${done}/${total}</span>
                </div>
            </div>
            ${total > 0 ? `<div class="project-progress-bar"><div class="project-progress-fill" style="width: ${pct}%"></div></div>` : ''}
        `;

        // Click on item-inner (not rename btn) → switch project
        li.querySelector('.project-item-inner').addEventListener('click', (e) => {
            if (!e.target.closest('.item-rename')) {
                switchProject(p.id);
            }
        });

        li.querySelector('.item-rename').addEventListener('click', (e) => {
            e.stopPropagation();
            startRenameProject(p.id, li);
        });

        projectListEl.appendChild(li);
    });

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
            showToast(`Projeto renomeado para "${newName}"`, 'success');
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
    if (!projects.find(p => p.id === id)) {
        if (projects.length === 0) {
            projects.push({ id: generateId(), name: 'Main Tasks' });
        }
        id = projects[0].id;
    }

    currentProjectId = id;
    saveAll();

    const proj = projects.find(p => p.id === currentProjectId);
    currentProjectTitle.textContent = proj.name;

    sidebar.classList.remove('open');
    renderSidebar();

    document.querySelector('[data-filter="all"]').click();

    deleteProjectBtn.disabled = projects.length <= 1;
    deleteProjectBtn.style.opacity = projects.length <= 1 ? '0.5' : '1';
    deleteProjectBtn.style.cursor = projects.length <= 1 ? 'not-allowed' : 'pointer';
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
                    <label class="extra-label"><i class="fa-regular fa-calendar"></i> Prazo</label>
                    <input type="date" class="task-due-input extra-input" value="${task.dueDate || ''}">
                </div>
                <div class="task-extra-field">
                    <label class="extra-label"><i class="fa-regular fa-note-sticky"></i> Notas</label>
                    <textarea class="task-notes-input extra-input" placeholder="Adicione notas...">${escapeHTML(task.notes || '')}</textarea>
                </div>
            </div>
        </div>
    `;

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
    showToast(`Projeto "${name}" criado!`, 'success');
    switchProject(newProjectId);
}

function confirmDeleteProject() {
    if (projects.length <= 1) return;
    const proj = projects.find(p => p.id === currentProjectId);
    if (confirm(`Deletar o projeto "${proj?.name}" e todas as suas tarefas?`)) {
        if (dbEnabled) dbDeleteProject(currentProjectId);
        tasks = tasks.filter(t => t.projectId !== currentProjectId);
        projects = projects.filter(p => p.id !== currentProjectId);
        showToast('Projeto deletado.', 'warning');
        switchProject(projects[0].id);
    }
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
    if (confirm('Deletar este template?')) {
        if (dbEnabled) dbDeleteTemplate(id);
        templates = templates.filter(t => t.id !== id);
        saveAll();
        renderSidebar();
        showToast('Template deletado.', 'warning');
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
        showToast('Todas as tarefas concluídas!', 'success');
    }
}

function clearCompletedTasks() {
    const completed = tasks.filter(t => t.projectId === currentProjectId && t.completed);
    if (completed.length === 0) {
        showToast('Nenhuma tarefa concluída para limpar.', 'info');
        return;
    }
    if (confirm(`Remover ${completed.length} tarefa(s) concluída(s)?`)) {
        if (dbEnabled) {
            completed.forEach(t => dbDeleteTask(t.id));
        }
        tasks = tasks.filter(t => !(t.projectId === currentProjectId && t.completed));
        saveAll();
        renderTasks();
        renderSidebar();
        showToast(`${completed.length} tarefa(s) removida(s).`, 'warning');
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
            showToast('Sessão de foco concluída! Ótimo trabalho.', 'timer', 5000);
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
    sidebar.classList.remove('open');
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
            const createdStr = t.createdAt  ? `<span class="history-date">Criada ${formatShortDate(t.createdAt)}</span>` : '';
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
            showToast(`Projeto "${name}" criado por voz!`, 'success');
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
        showToast('Tarefas concluídas removidas.', 'warning');
        return;
    }

    if (command === 'open sidebar') { sidebar.classList.add('open'); return; }
    if (command === 'close sidebar') { sidebar.classList.remove('open'); return; }
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
