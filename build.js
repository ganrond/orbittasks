// Script executado pelo Vercel antes de publicar o site.
// Lê as variáveis de ambiente e gera o config.js com as credenciais.
const fs = require('fs');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';

const content = `const SUPABASE_URL      = '${url}';\nconst SUPABASE_ANON_KEY = '${key}';\n`;

fs.writeFileSync('config.js', content);
console.log('config.js gerado com sucesso.');
