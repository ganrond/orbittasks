// =====================================================
// Orbit Tasks - Camada de Banco de Dados (Supabase)
// =====================================================

let _supabase = null;

// Inicializa o cliente Supabase se as credenciais estiverem preenchidas
function initDB() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
    try {
        _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[DB] Supabase conectado.');
        return true;
    } catch (e) {
        console.warn('[DB] Falha ao conectar ao Supabase:', e);
        return false;
    }
}

// Carrega todos os dados do banco de uma vez
async function dbLoadAll() {
    if (!_supabase) return null;
    try {
        const [projRes, taskRes, templRes] = await Promise.all([
            _supabase.from('projects').select('*').order('created_at'),
            _supabase.from('tasks').select('*').order('created_at', { ascending: false }),
            _supabase.from('templates').select('*').order('created_at')
        ]);

        if (projRes.error || taskRes.error || templRes.error) {
            console.warn('[DB] Erro ao carregar dados:', projRes.error || taskRes.error || templRes.error);
            return null;
        }

        return {
            projects: projRes.data.map(p => ({ ...p, archived: p.archived ?? false })),
            // Converte snake_case do banco para camelCase do app
            tasks: taskRes.data.map(t => ({
                id:          t.id,
                projectId:   t.project_id,
                text:        t.text,
                completed:   t.completed,
                timeSpent:   t.time_spent,
                priority:    t.priority || null,
                dueDate:     t.due_date || null,
                notes:       t.notes || '',
                completedAt: t.completed_at || null,
                order:       t.task_order ?? 0,
                createdAt:   t.created_at,
                automatable:  t.automatable   || false,
                aiSkill:      t.ai_skill      || false,
                recurring:    t.recurring     || false,
                recurringDay: t.recurring_day  || null,
                archived:     t.archived       || false,
                energy:       t.energy         || null
            })),
            templates: templRes.data
        };
    } catch (e) {
        console.warn('[DB] Erro inesperado ao carregar:', e);
        return null;
    }
}

// Salva/atualiza projetos no banco (upsert = cria se não existe, atualiza se existe)
async function dbSaveProjects(projectsArr) {
    if (!_supabase || !projectsArr.length) return;
    try {
        const { error } = await _supabase.from('projects').upsert(
            projectsArr.map(p => ({ id: p.id, name: p.name, archived: p.archived ?? false, created_at: p.created_at || new Date().toISOString() }))
        );
        if (error) console.warn('[DB] Erro ao salvar projetos:', error);
    } catch (e) { console.warn('[DB] dbSaveProjects:', e); }
}

// Salva/atualiza tarefas no banco
async function dbSaveTasks(tasksArr) {
    if (!_supabase || !tasksArr.length) return;
    try {
        const rows = tasksArr.map(t => ({
            id:           t.id,
            project_id:   t.projectId,
            text:         t.text,
            completed:    t.completed,
            time_spent:   t.timeSpent || 0,
            priority:     t.priority || null,
            due_date:     t.dueDate || null,
            notes:        t.notes || '',
            completed_at: t.completedAt || null,
            task_order:   t.order ?? 0,
            created_at:   t.createdAt || new Date().toISOString(),
            automatable:   t.automatable  || false,
            ai_skill:      t.aiSkill      || false,
            recurring:     t.recurring    || false,
            recurring_day: t.recurringDay || null,
            archived:      t.archived     || false,
            energy:        t.energy       || null
        }));
        const { error } = await _supabase.from('tasks').upsert(rows);
        if (error) console.warn('[DB] Erro ao salvar tarefas:', error);
    } catch (e) { console.warn('[DB] dbSaveTasks:', e); }
}

// Salva/atualiza templates no banco
async function dbSaveTemplates(templatesArr) {
    if (!_supabase || !templatesArr.length) return;
    try {
        const { error } = await _supabase.from('templates').upsert(
            templatesArr.map(t => ({ id: t.id, name: t.name, tasks: t.tasks || [] }))
        );
        if (error) console.warn('[DB] Erro ao salvar templates:', error);
    } catch (e) { console.warn('[DB] dbSaveTemplates:', e); }
}

// Remove uma tarefa do banco
async function dbDeleteTask(id) {
    if (!_supabase) return;
    try {
        const { error } = await _supabase.from('tasks').delete().eq('id', id);
        if (error) console.warn('[DB] Erro ao deletar tarefa:', error);
    } catch (e) { console.warn('[DB] dbDeleteTask:', e); }
}

// Remove um projeto do banco (as tarefas são deletadas em cascata)
async function dbDeleteProject(id) {
    if (!_supabase) return;
    try {
        const { error } = await _supabase.from('projects').delete().eq('id', id);
        if (error) console.warn('[DB] Erro ao deletar projeto:', error);
    } catch (e) { console.warn('[DB] dbDeleteProject:', e); }
}

// Remove um template do banco
async function dbDeleteTemplate(id) {
    if (!_supabase) return;
    try {
        const { error } = await _supabase.from('templates').delete().eq('id', id);
        if (error) console.warn('[DB] Erro ao deletar template:', error);
    } catch (e) { console.warn('[DB] dbDeleteTemplate:', e); }
}
