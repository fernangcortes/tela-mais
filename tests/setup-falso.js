// Ajudas dos testes do setup.mjs: um projeto temporário, um wrangler simulado, um fetch falso e perguntas
// respondidas de antemão. Nada aqui usa rede, terminal ou a conta Cloudflare de ninguém.
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { principal } from '../scripts/lib/setup/index.mjs';
import { aplicarConfig } from '../scripts/aplicar-config.mjs';

export const RAIZ_REAL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Um projeto novo: só o que o setup lê e escreve (config, wrangler, site gerado, presets, textos, AGENTS.md). */
export function criarProjeto({ skills = false } = {}) {
  const raiz = mkdtempSync(path.join(tmpdir(), 'tela-setup-'));
  for (const rel of ['config', 'core/site', 'core/locales', 'core/presets']) cpSync(path.join(RAIZ_REAL, rel), path.join(raiz, rel), { recursive: true });
  for (const rel of ['wrangler.jsonc', 'AGENTS.md', '.gitignore']) cpSync(path.join(RAIZ_REAL, rel), path.join(raiz, rel));
  if (skills) {
    mkdirSync(path.join(raiz, '.agents/skills/montar-streaming'), { recursive: true });
    writeFileSync(path.join(raiz, '.agents/skills/montar-streaming/SKILL.md'), '---\nname: montar-streaming\ndescription: Monta o streaming do zero, uma pergunta por vez.\n---\n# Montar\n\n1. Rode setup.mjs status.\n');
  }
  return raiz;
}

export const lerArq = (raiz, rel) => readFileSync(path.join(raiz, rel), 'utf8');
export const lerSiteJson = (raiz) => JSON.parse(lerArq(raiz, 'config/site.json'));
export const escreverSiteJson = (raiz, obj) => writeFileSync(path.join(raiz, 'config/site.json'), JSON.stringify(obj, null, 2) + '\n');
export const existe = (raiz, rel) => existsSync(path.join(raiz, rel));

/* ---------------------------------------------------------------- wrangler simulado */
export function criarMundo(opcoes = {}) {
  const m = {
    logado: true, email: 'dona@exemplo.test', contas: [{ id: 'a'.repeat(32), name: 'Conta' }],
    kv: [], d1: [], segredos: new Map(), worker: false, secretCriaWorker: false, url: 'https://minha-tela.sub.workers.dev',
    testesPassam: true, deployFalha: false, chamadas: [], seq: 0, ...opcoes
  };
  const hex = (n) => (++m.seq).toString(16).padStart(n, '0');
  m.exec = async (cmd, args = [], { input } = {}) => {
    m.chamadas.push({ cmd, args: [...args], input });
    const ok = (saida = '') => ({ codigo: 0, saida, erro: '' });
    const ruim = (erro = 'erro') => ({ codigo: 1, saida: '', erro });
    if (cmd === 'git') {
      if (args[0] === '--version') return ok('git version 2.40.0');
      return { codigo: 128, saida: '', erro: 'fatal: not a git repository' };
    }
    if (cmd === 'npm') return m.testesPassam ? ok('tests 10\npass 10\nfail 0') : ruim('fail 1');
    const i = args.indexOf('wrangler@4');
    const w = i >= 0 ? args.slice(i + 1) : args;
    const j = w.join(' ');
    if (j === '--version') return ok('4.99.0');
    if (j === 'whoami --json') return ok(JSON.stringify(m.logado ? { loggedIn: true, authType: 'OAuth Token', email: m.email, accounts: m.contas } : { loggedIn: false }));
    if (!m.logado) return ruim('Not logged in');
    if (j === 'kv namespace list') return ok(JSON.stringify(m.kv.map((k) => ({ id: k.id, title: k.title }))));
    if (w[0] === 'kv' && w[1] === 'namespace' && w[2] === 'create') {
      const id = hex(32); m.kv.push({ id, title: w[3] });
      return ok(`Resource location: remote\n{\n  "kv_namespaces": [\n    {\n      "binding": "KV",\n      "id": "${id}"\n    }\n  ]\n}`);
    }
    if (j === 'd1 list --json') return ok(JSON.stringify(m.d1.map((d) => ({ uuid: d.uuid, name: d.name }))));
    if (w[0] === 'd1' && w[1] === 'create') {
      const uuid = `${hex(8)}-0000-4000-8000-${hex(12)}`; m.d1.push({ uuid, name: w[2] });
      return ok(`{\n  "d1_databases": [\n    {\n      "binding": "DB",\n      "database_name": "${w[2]}",\n      "database_id": "${uuid}"\n    }\n  ]\n}`);
    }
    if (j === 'secret list --format json') return m.worker ? ok(JSON.stringify([...m.segredos.keys()].map((name) => ({ name, type: 'secret_text' })))) : ruim('Worker not found');
    if (w[0] === 'secret' && w[1] === 'put') {
      if (!m.worker && !m.secretCriaWorker) return ruim('Worker not found');
      m.worker = true; m.segredos.set(w[2], String(input).replace(/\n$/, '')); return ok(`Success! Uploaded secret ${w[2]}`);
    }
    if (w[0] === 'deploy') { if (m.deployFalha) return ruim('deploy falhou'); m.worker = true; return ok(`Uploaded\nDeployed minha-tela triggers\n  ${m.url}`); }
    return ruim('comando desconhecido: ' + j);
  };
  return m;
}

/* ---------------------------------------------------------------- fetch falso */
/* rotas: { '/caminho': { status, corpo, cabecalhos } | (url) => ... }; o que não está na tabela devolve 404. */
export function criarFetch(rotas, { base = 'https://minha-tela.sub.workers.dev', chamadas = [] } = {}) {
  const f = async (url, opcoes = {}) => {
    const u = new URL(url);
    chamadas.push({ url: String(url), metodo: opcoes.method || 'GET', opcoes });
    let rota = rotas[u.origin + u.pathname] ?? rotas[u.pathname];
    if (!rota) { const k = Object.keys(rotas).find((c) => c.length > 1 && u.pathname.endsWith(c)); if (k) rota = rotas[k]; }
    if (typeof rota === 'function') rota = await rota(u, opcoes);
    if (!rota) return new Response('nao achei', { status: 404 });
    const corpo = typeof rota.corpo === 'string' || rota.corpo === undefined ? (rota.corpo ?? '') : JSON.stringify(rota.corpo);
    return new Response(rota.status === 204 || (rota.status >= 300 && rota.status < 400) ? null : corpo, { status: rota.status ?? 200, headers: rota.cabecalhos || {} });
  };
  f.chamadas = chamadas;
  f.base = base;
  return f;
}
export const CABECALHOS_SEGUROS = { 'content-security-policy': "default-src 'self'", 'x-content-type-options': 'nosniff' };

/* ---------------------------------------------------------------- perguntas respondidas de antemão */
export function criarPerguntas(respostas = {}) {
  const fila = { texto: [...(respostas.texto || [])], senha: [...(respostas.senha || [])], confirmar: [...(respostas.confirmar || [])], escolher: [...(respostas.escolher || [])] };
  const p = {
    interativo: true, feitas: [],
    async texto(q, padrao = '') { p.feitas.push(['texto', q]); return fila.texto.length ? fila.texto.shift() : padrao; },
    async senha(q) { p.feitas.push(['senha', q]); if (!fila.senha.length) throw new Error('senha não prevista no teste: ' + q); return fila.senha.shift(); },
    async confirmar(q, padrao = false) { p.feitas.push(['confirmar', q]); return fila.confirmar.length ? fila.confirmar.shift() : padrao; },
    async escolher(q, opcoes, padrao) { p.feitas.push(['escolher', q]); return fila.escolher.length ? fila.escolher.shift() : padrao; }
  };
  return p;
}

/* ---------------------------------------------------------------- rodar um comando */
export async function rodar(argv, { raiz, mundo = criarMundo(), fetch = criarFetch({}), perguntas = null, env = {}, stdin = null, aplicar = aplicarConfig } = {}) {
  let out = '';
  let err = '';
  const ctx = {
    raiz, env: { ...env }, exec: mundo.exec, fetch,
    perguntar: perguntas || criarPerguntas(), interativo: Boolean(perguntas),
    aplicarConfig: aplicar, lerStdin: async () => { if (stdin === null) throw new Error('sem stdin no teste'); return stdin; },
    agora: () => new Date('2026-10-02T12:00:00Z')
  };
  const { codigo, relatorio } = await principal(argv, { ctx, interativo: Boolean(perguntas), out: (t) => { out += t; }, err: (t) => { err += t; } });
  let json = null;
  if (argv.includes('--json')) { try { json = JSON.parse(out); } catch { json = null; } }
  return { codigo, out, err, json, relatorio, tudo: out + err, mundo, ctx };
}

/* O texto que o teste NUNCA pode achar em saída, argumentos de comando ou arquivos versionados. */
export function nadaVazou(resultado, valor) {
  const argumentos = resultado.mundo.chamadas.map((c) => c.args.join(' ')).join('\n');
  return !resultado.tudo.includes(valor) && !argumentos.includes(valor);
}
