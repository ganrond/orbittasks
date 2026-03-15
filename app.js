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

let currentProjectId = localStorage.getItem('orbitCurrentProject') || projects[0]?.id;
let currentFilter = 'all';
let currentSort = 'custom';
let currentTheme = localStorage.getItem('orbitTheme') || 'default';

// Inicializa conexão com Supabase (retorna false se credenciais não preenchidas)
const dbEnabled = (typeof initDB === 'function') ? initDB() : false;

let activeTimerTaskId = null;
let timerInterval = null;
let timeRemaining = 1500; // 25 mins

// Ensure backward compatibility for users upgrading from v1
if (projects.length === 0) {
    projects = [...defaultProjects];
}
tasks = tasks.map(t => t.projectId ? t : { ...t, projectId: projects[0].id });

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

// --- Core Initialization ---
async function init() {
    applyTheme(currentTheme);
    bindEvents();

    // Se Supabase estiver configurado, carrega dados da nuvem
    if (dbEnabled) {
        try {
            const dbData = await dbLoadAll();

            if (dbData === null) {
                // Supabase inacessível — usa localStorage normalmente
                console.warn('[App] Usando localStorage como fallback.');
            } else if (dbData.projects.length > 0) {
                // Dados encontrados na nuvem — usa eles como fonte principal
                projects   = dbData.projects;
                tasks      = dbData.tasks;
                templates  = dbData.templates.length > 0 ? dbData.templates : templates;
                currentProjectId = projects.find(p => p.id === currentProjectId)
                    ? currentProjectId
                    : projects[0].id;
                console.log('[App] Dados carregados do Supabase.');
            } else {
                // Supabase vazio (primeiro acesso) — migra dados do localStorage para a nuvem
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
}

// --- Data Persistence ---
function saveAll() {
    // Salva localmente para acesso instantâneo
    localStorage.setItem('orbitProjects', JSON.stringify(projects));
    localStorage.setItem('orbitTemplates', JSON.stringify(templates));
    localStorage.setItem('orbitTasks', JSON.stringify(tasks));
    localStorage.setItem('orbitCurrentProject', currentProjectId);
    // Sincroniza com Supabase em segundo plano (não bloqueia a UI)
    if (dbEnabled) {
        dbSaveProjects(projects);
        dbSaveTasks(tasks);
        dbSaveTemplates(templates);
    }
}

// --- Event Binding ---
function bindEvents() {
    // Sidebar Mobile Toggle
    menuToggle.addEventListener('click', () => sidebar.classList.add('open'));
    closeSidebarBtn.addEventListener('click', () => sidebar.classList.remove('open'));

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
    if(completeAllBtn) completeAllBtn.addEventListener('click', completeAllTasks);

    // Timer controls
    if(restartTimerBtn) restartTimerBtn.addEventListener('click', restartTimer);

    // History controls
    if(navHistoryBtn) navHistoryBtn.addEventListener('click', showHistory);
    if(backToWorkspaceBtn) backToWorkspaceBtn.addEventListener('click', showWorkspace);
    if(historySearch) historySearch.addEventListener('input', renderHistory);

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
        const li = document.createElement('li');
        li.className = `list-item ${p.id === currentProjectId ? 'active' : ''}`;
        li.innerHTML = `<span class="item-name">${escapeHTML(p.name)}</span>`;
        li.onclick = () => switchProject(p.id);
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

function switchProject(id) {
    // fallback if deleted
    if (!projects.find(p => p.id === id)) {
        if(projects.length === 0) {
            projects.push({id: generateId(), name: 'Main Tasks'});
        }
        id = projects[0].id;
    }
    
    currentProjectId = id;
    saveAll();
    
    const proj = projects.find(p => p.id === currentProjectId);
    currentProjectTitle.textContent = proj.name;
    
    // UI clean up
    sidebar.classList.remove('open'); // close on mobile
    renderSidebar(); // refresh active state
    
    // Always reset to 'all' filter when switching projects
    document.querySelector('[data-filter="all"]').click();
    
    // Disable delete if it's the only project
    deleteProjectBtn.disabled = projects.length <= 1;
    deleteProjectBtn.style.opacity = projects.length <= 1 ? '0.5' : '1';
    deleteProjectBtn.style.cursor = projects.length <= 1 ? 'not-allowed' : 'pointer';
}

function renderTasks() {
    taskList.innerHTML = '';
    
    const projectTasks = tasks.filter(t => t.projectId === currentProjectId);
    let filteredTasks = projectTasks;
    
    if (currentFilter === 'pending') {
        filteredTasks = projectTasks.filter(t => !t.completed);
    } else if (currentFilter === 'completed') {
        filteredTasks = projectTasks.filter(t => t.completed);
    }
    
    // Apply Sorting
    if (currentSort === 'time-desc') {
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
            const li = document.createElement('li');
            li.className = `task-item ${task.completed ? 'completed' : ''}`;
            li.dataset.id = task.id;
            
            let timeBadge = '';
            if (task.timeSpent && task.timeSpent > 0) {
                const totalMins = Math.floor(task.timeSpent / 60);
                const hrs = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                let timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                if (totalMins === 0) timeStr = '<1m';
                
                timeBadge = `<span class="task-time-badge"><i class="fa-regular fa-clock"></i> ${timeStr}</span>`;
            }

            li.innerHTML = `
                <div class="task-content">
                    <div class="checkbox-wrapper">
                        <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
                        <div class="custom-checkbox"><i class="fa-solid fa-check"></i></div>
                    </div>
                    <span class="task-text">${escapeHTML(task.text)}${timeBadge}</span>
                </div>
                <div class="task-actions">
                    <button class="action-btn timer-btn ${activeTimerTaskId === task.id ? 'running' : ''}" aria-label="Start timer">
                        <i class="fa-solid ${activeTimerTaskId === task.id ? 'fa-stop' : 'fa-play'}"></i>
                    </button>
                    <button class="action-btn edit-btn" aria-label="Edit task"><i class="fa-solid fa-pen"></i></button>
                    <button class="action-btn delete-btn" aria-label="Delete task"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            
            if (activeTimerTaskId === task.id) {
                li.classList.add('active-timer');
            }
            
            const timerBtn = li.querySelector('.timer-btn');
            timerBtn.addEventListener('click', () => {
                if (activeTimerTaskId === task.id) {
                    stopTimer();
                } else {
                    startTimer(task.id);
                }
            });
            
            const checkbox = li.querySelector('.task-checkbox');
            checkbox.addEventListener('change', () => toggleTask(task.id));
            
            const deleteBtn = li.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', () => deleteTask(task.id, li));
            
            const editBtn = li.querySelector('.edit-btn');
            editBtn.addEventListener('click', () => editTask(task.id, li, task.text));
            
            taskList.appendChild(li);
        });
    }
    updateStats(projectTasks);
}

function updateStats(projectTasks) {
    const pendingCount = projectTasks.filter(t => !t.completed).length;
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
    // Populate templates dropdown
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
    
    // Apply template tasks if selected
    if (templateId) {
        const tpl = templates.find(t => t.id === templateId);
        if (tpl && tpl.tasks) {
            const newTasks = tpl.tasks.map(text => ({
                id: generateId(),
                projectId: newProjectId,
                text,
                completed: false,
                createdAt: new Date().toISOString()
            }));
            // add to end of visual list in order they were in template
            tasks.push(...newTasks);
        }
    }
    
    saveAll();
    closeAllModals();
    switchProject(newProjectId); // Will re-render sidebar and tasks automatically
}

function confirmDeleteProject() {
    if (projects.length <= 1) return;
    if (confirm('Are you sure you want to delete this project and all its tasks?')) {
        if (dbEnabled) dbDeleteProject(currentProjectId); // Remove do banco (cascade deleta tarefas)
        tasks = tasks.filter(t => t.projectId !== currentProjectId);
        projects = projects.filter(p => p.id !== currentProjectId);
        switchProject(projects[0].id);
    }
}

function handleCreateTemplate(e) {
    e.preventDefault();
    const name = document.getElementById('template-name-input').value.trim();
    const tasksRaw = document.getElementById('template-tasks-input').value;
    
    if (!name) return;
    
    // Parse tasks list (split by newline, remove empty)
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
}

function prepSaveAsTemplate() {
    // Pre-fill template modal with current project info
    const curProj = projects.find(p => p.id === currentProjectId);
    const curTasks = tasks.filter(t => t.projectId === currentProjectId).map(t => t.text);
    
    document.getElementById('template-name-input').value = `${curProj.name} Template`;
    document.getElementById('template-tasks-input').value = curTasks.join('\n');
    
    openModal(templateModal);
}

function deleteTemplate(id) {
    if (confirm('Delete this template?')) {
        if (dbEnabled) dbDeleteTemplate(id); // Remove do banco
        templates = templates.filter(t => t.id !== id);
        saveAll();
        renderSidebar();
    }
}


// --- Task Operations ---
function addTask(e) {
    e.preventDefault();
    const taskText = taskInput.value.trim();
    if (!taskText) return;
    
    const newTask = {
        id: generateId(),
        projectId: currentProjectId,
        text: taskText,
        completed: false,
        timeSpent: 0,
        createdAt: new Date().toISOString()
    };
    
    tasks.unshift(newTask); // Add to beginning
    saveAll();
    taskInput.value = '';
    
    if (currentFilter === 'completed') {
        document.querySelector('[data-filter="all"]').click();
    } else {
        renderTasks();
    }
}

function toggleTask(id) {
    if (activeTimerTaskId === id) stopTimer(); // Auto stop timer when completing task
    
    tasks = tasks.map(task => {
        if (task.id === id) return { ...task, completed: !task.completed };
        return task;
    });
    saveAll();
    renderTasks();
}

function deleteTask(id, element) {
    if (activeTimerTaskId === id) stopTimer();
    if (dbEnabled) dbDeleteTask(id); // Remove do banco imediatamente
    element.classList.add('removing');
    setTimeout(() => {
        tasks = tasks.filter(task => task.id !== id);
        saveAll();
        renderTasks();
    }, 300);
}

function completeAllTasks() {
    let changed = false;
    tasks = tasks.map(task => {
        if (task.projectId === currentProjectId && !task.completed) {
            changed = true;
            return { ...task, completed: true };
        }
        return task;
    });
    
    if (changed) {
        saveAll();
        renderTasks();
    }
}

// --- Timer Logic ---
function startTimer(taskId, duration = 1500) {
    if (activeTimerTaskId) stopTimer(); // Stop any currently running timer
    
    activeTimerTaskId = taskId;
    timeRemaining = duration;
    
    // Update global UI
    globalTimerEl.classList.remove('hidden');
    updateTimerDisplay();
    
    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        
        // Track time spent on the active task
        tasks = tasks.map(t => {
            if (t.id === activeTimerTaskId) {
                return { ...t, timeSpent: (t.timeSpent || 0) + 1 };
            }
            return t;
        });
        
        // Save periodically (every 10 seconds) to avoid extreme localStorage writes
        if (timeRemaining % 10 === 0) {
            saveAll();
            // Re-render minimally to update the time badge if it crossed a minute threshold
            if (timeRemaining % 60 === 0) renderTasks();
        }
        
        if (timeRemaining <= 0) {
            stopTimer();
            alert("Pomodoro session complete! Great focus.");
        }
    }, 1000);
    
    renderTasks(); // Re-render to show active state on the task item
}

function restartTimer() {
    if (activeTimerTaskId) {
        timeRemaining = 1500; // Reset to 25 mins
        updateTimerDisplay();
    }
}

function stopTimer() {
    clearInterval(timerInterval);
    activeTimerTaskId = null;
    timerInterval = null;
    saveAll(); // Ensure final time is saved
    
    // Hide global UI
    globalTimerEl.classList.add('hidden');
    
    renderTasks(); // Re-render to remove active state from the task item
}

function updateTimerDisplay() {
    if (!timerDisplayEl) return;
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    timerDisplayEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function editTask(id, element, currentText) {
    const contentDiv = element.querySelector('.task-content');
    const actionsDiv = element.querySelector('.task-actions');
    
    contentDiv.style.display = 'none';
    actionsDiv.style.display = 'none';
    
    const form = document.createElement('form');
    form.style.width = '100%';
    form.style.display = 'flex';
    form.style.gap = '0.5rem';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentText;
    input.className = 'edit-input';
    
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'action-btn';
    saveBtn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--accent-success)"></i>';
    
    form.appendChild(input);
    form.appendChild(saveBtn);
    element.appendChild(form);
    
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

// --- History View Logic ---
function showHistory() {
    workspaceView.classList.add('hidden');
    historyView.classList.remove('hidden');
    sidebar.classList.remove('open'); // Close mobile menu if open
    document.querySelectorAll('.app-container > .filters-actions, .app-container > .task-list-container').forEach(el => {
        // Keep the rest of the workspace clean out of the way
    });
    
    renderHistory();
}

function showWorkspace() {
    historyView.classList.add('hidden');
    workspaceView.classList.remove('hidden');
}

function renderHistory() {
    if (!historyListContainer) return;
    historyListContainer.innerHTML = '';
    
    const searchTerm = historySearch.value.toLowerCase();
    
    // Default to 'custom' formatting as empty
    let renderedProjectsCount = 0;
    
    projects.forEach(project => {
        // Find tasks for this project
        const projTasks = tasks.filter(t => t.projectId === project.id);
        const projectNameMatches = project.name.toLowerCase().includes(searchTerm);

        // Filter tasks within this project based on search
        const filteredTasks = projectNameMatches
            ? projTasks
            : projTasks.filter(t => t.text.toLowerCase().includes(searchTerm));
        if (filteredTasks.length === 0 && !projectNameMatches) return;
        
        renderedProjectsCount++;
        
        // Calculate total time spent
        const totalProjectTime = filteredTasks.reduce((acc, t) => acc + (t.timeSpent || 0), 0);
        
        let timeBadgeHtml = '';
        if (totalProjectTime > 0) {
            const hrs = Math.floor((totalProjectTime / 60) / 60);
            const mins = Math.floor(totalProjectTime / 60) % 60;
            let timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            if (totalProjectTime < 60 && totalProjectTime > 0) timeStr = '<1m';
            timeBadgeHtml = `<span class="task-time-badge" style="opacity:1;"><i class="fa-regular fa-clock"></i> ${timeStr} Tracker</span>`;
        }
        
        const projEl = document.createElement('div');
        projEl.className = 'history-project-item';
        
        let taskListHtml = filteredTasks.map(t => {
            let tBadge = '';
            if (t.timeSpent && t.timeSpent > 0) {
                const totalMins = Math.floor(t.timeSpent / 60);
                const hrs = Math.floor(totalMins / 60);
                const mins = totalMins % 60;
                let tStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                if (totalMins === 0) tStr = '<1m';
                tBadge = `<span class="task-time-badge"><i class="fa-regular fa-clock"></i> ${tStr}</span>`;
            }
            return `<div class="history-task-row">
                <span class="history-task-name">${escapeHTML(t.text)}</span>
                ${tBadge}
                <span class="history-status ${t.completed ? 'status-done' : 'status-pending'}">${t.completed ? 'Done' : 'Pending'}</span>
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
        const list = projEl.querySelector('.history-tasks-list');
        const icon = projEl.querySelector('.history-toggle-icon');

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

// // --- Voice Control ---
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

    // Two states: waiting for wake word, or waiting for a command
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

    // Browser sometimes stops automatically — restart if still active
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
        // 'not-allowed': user denied mic — stop everything
        if (event.error === 'not-allowed') {
            isActive = false;
            voiceBtn.classList.remove('recording');
            setStatus('Mic access denied.', 'var(--accent-danger)');
            setTimeout(() => setStatus(''), 3000);
            return;
        }
        // 'aborted': we stopped it on purpose — do nothing
        if (event.error === 'aborted') return;
        // 'no-speech', 'network', etc: non-fatal — let onend restart it
    };

    function isWakeWord(text) {
        // Accept common mishearings of "Hey Orbit"
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

        // "Goodbye Orbit" stops from any state
        if (isGoodbyeWord(transcript)) {
            stopListening();
            return;
        }

        // --- STATE 1: Waiting for wake word ---
        if (!awaitingCommand) {
            if (isWakeWord(transcript)) {
                const commandInSameUtterance = stripWakeWord(transcript);
                if (commandInSameUtterance) {
                    // "Hey Orbit add task X" — wake word + command in one breath
                    executeCommand(commandInSameUtterance);
                } else {
                    // "Hey Orbit" alone — wait for the next utterance
                    awaitingCommand = true;
                    setStatus('Ready! Say a command...', 'var(--accent-primary)');
                    taskInput.placeholder = 'Listening for command...';
                }
            }
            return;
        }

        // --- STATE 2: Wake word already heard, this utterance is the command ---
        awaitingCommand = false;
        executeCommand(stripWakeWord(transcript));
    };
}

function handleVoiceCommand(command) {
    console.log("Voice Command Recognized:", command);

    // 1. "Add task [name]"
    if (command.startsWith('add task ')) {
        const name = command.replace('add task ', '').trim();
        if (name) createTaskFromVoice(name);
        return;
    }

    // 2. "Complete [name]" — marks a matching pending task as done
    if (command.startsWith('complete ')) {
        const title = command.replace('complete ', '').trim();
        if (!title) return;
        let task = tasks.find(t => t.projectId === currentProjectId && t.text.toLowerCase() === title && !t.completed);
        // fuzzy fallback: partial match
        if (!task) task = tasks.find(t => t.projectId === currentProjectId && t.text.toLowerCase().includes(title) && !t.completed);
        if (task) toggleTask(task.id);
        return;
    }

    // 3. "Switch to [project]"
    if (command.startsWith('switch to ')) {
        const title = command.replace('switch to ', '').trim();
        const project = projects.find(p => p.name.toLowerCase() === title);
        if (project) switchProject(project.id);
        return;
    }

    // 4. "New project [name]"
    if (command.startsWith('new project ')) {
        const name = command.replace('new project ', '').trim();
        if (name) {
            const newProjectId = generateId();
            projects.push({ id: newProjectId, name: name.charAt(0).toUpperCase() + name.slice(1) });
            saveAll();
            renderSidebar();
            switchProject(newProjectId);
        }
        return;
    }

    // 5. "Delete task [name]"
    if (command.startsWith('delete task ')) {
        const title = command.replace('delete task ', '').trim();
        if (!title) return;
        let task = tasks.find(t => t.projectId === currentProjectId && t.text.toLowerCase() === title);
        // fuzzy fallback: partial match
        if (!task) task = tasks.find(t => t.projectId === currentProjectId && t.text.toLowerCase().includes(title));
        if (task) {
            const el = document.querySelector(`.task-item[data-id="${task.id}"]`);
            if (el) deleteTask(task.id, el);
            else { tasks = tasks.filter(t2 => t2.id !== task.id); saveAll(); renderTasks(); }
        }
        return;
    }

    // 6. "Clear completed"
    if (command === 'clear completed' || command === 'clear completed tasks') {
        tasks = tasks.filter(t => t.projectId !== currentProjectId || !t.completed);
        saveAll();
        renderTasks();
        return;
    }

    // 7. "Open sidebar" / "Close sidebar"
    if (command === 'open sidebar') {
        sidebar.classList.add('open');
        return;
    }
    if (command === 'close sidebar') {
        sidebar.classList.remove('open');
        return;
    }
}

function createTaskFromVoice(text, projId = currentProjectId) {
    if (!text) return;
    const newTask = {
        id: generateId(),
        projectId: projId,
        text: text.charAt(0).toUpperCase() + text.slice(1),
        completed: false,
        timeSpent: 0,
        createdAt: new Date().toISOString()
    };
    tasks.unshift(newTask);
    saveAll();
    
    if (projId === currentProjectId) {
        if (currentFilter === 'completed') {
            document.querySelector('[data-filter="all"]').click();
        } else {
            renderTasks();
        }
    }
}

// --- Theme Control ---
function initThemePicker() {
    const themeBtn = document.getElementById('theme-toggle-btn');
    const themeDropdown = document.getElementById('theme-dropdown');
    const themeOptions = document.querySelectorAll('.theme-option');

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
        if (btn.dataset.theme === theme) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Start
document.addEventListener('DOMContentLoaded', init);
