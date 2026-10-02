/* scripts/lib/setup/agentes.mjs — gera, a partir de AGENTS.md e das skills em .agents/skills/, os arquivos que cada
 * ferramenta de IA lê (CLAUDE.md, GEMINI.md, .cursor/rules/*.mdc, .claude/skills/*). A fonte é uma só; os espelhos
 * levam a marca "GERADO" e `sync-agents --check` falha se algum divergir (ou se sobrar espelho de skill apagada). */
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MARCA_GERADO = 'GERADO por scripts/setup.mjs sync-agents. Não edite este arquivo: edite a fonte (AGENTS.md, .agents/skills, .agents/ferramentas) e rode "node scripts/setup.mjs sync-agents".';
const nl = (t) => String(t).replace(/\r\n/g, '\n');
/* O aviso leva o hash do AGENTS.md: se a fonte muda, todo espelho passa a "diverge" até o próximo sync. */
const aviso = (agents) => `<!-- ${MARCA_GERADO} Fonte: AGENTS.md ${createHash('sha256').update(nl(agents)).digest('hex').slice(0, 12)} -->`;

export const FERRAMENTAS = Object.freeze(['claude', 'gemini', 'cursor']);

export function lerFrontmatter(texto) {
  const t = nl(texto);
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  if (!m) return { meta: {}, corpo: t, bloco: '' };
  const meta = {};
  for (const linha of m[1].split('\n')) {
    const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(linha);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, corpo: t.slice(m[0].length), bloco: m[0] };
}

export async function lerSkills(raiz) {
  const pasta = path.join(raiz, '.agents', 'skills');
  let nomes = [];
  try { nomes = (await readdir(pasta, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
  const skills = [];
  for (const nome of nomes) {
    let texto;
    try { texto = nl(await readFile(path.join(pasta, nome, 'SKILL.md'), 'utf8')); } catch { continue; }
    const { meta, corpo, bloco } = lerFrontmatter(texto);
    skills.push({ nome: meta.name || nome, pasta: nome, descricao: meta.description || '', corpo, bloco, texto });
  }
  return skills;
}

/* Notas que só valem para uma ferramenta: .agents/ferramentas/{claude,gemini,cursor}.md (opcionais, sem frontmatter). */
export async function lerNotas(raiz) {
  const notas = {};
  for (const f of FERRAMENTAS) {
    try { notas[f] = nl(await readFile(path.join(raiz, '.agents', 'ferramentas', `${f}.md`), 'utf8')).trim(); } catch { notas[f] = ''; }
  }
  return notas;
}

const PONTEIRO = 'Leia e siga o `AGENTS.md` na raiz do repositório antes de qualquer alteração: as regras dele valem integralmente.';

/* Mapa caminho-relativo -> conteúdo esperado. */
export function gerarEspelhos({ agentsMd, skills, notas = {} }) {
  const agents = nl(agentsMd);
  const av = aviso(agents);
  const out = new Map();
  out.set('CLAUDE.md', `${av}\n@AGENTS.md\n` + (notas.claude ? `\n${notas.claude}\n` : ''));
  const lista = skills.map((s) => `- \`${s.nome}\`: ${s.descricao || '(sem descrição)'} (\`.agents/skills/${s.pasta}/SKILL.md\`)`).join('\n');
  out.set('GEMINI.md', `${av}\n# GEMINI.md\n\n${PONTEIRO}\n` + (notas.gemini ? `\n${notas.gemini}\n` : '') +
    (skills.length ? `\n## Roteiros (skills)\n\nQuando a tarefa combinar com um destes, leia o arquivo indicado antes de agir:\n\n${lista}\n` : ''));
  out.set('.cursor/rules/00-leia-agents.mdc', `---\ndescription: Regras do projeto tela mAIs; leia AGENTS.md antes de qualquer tarefa\nalwaysApply: true\n---\n${av}\n\n${notas.cursor || PONTEIRO}\n`);
  for (const s of skills) {
    out.set(`.cursor/rules/${s.pasta}.mdc`, `---\ndescription: ${s.descricao.replace(/\n/g, ' ')}\nalwaysApply: false\n---\n${av}\n\n${s.corpo.replace(/^\n+/, '')}`.replace(/\n*$/, '\n'));
    const bloco = s.bloco || `---\nname: ${s.nome}\ndescription: ${s.descricao}\n---\n`;
    out.set(`.claude/skills/${s.pasta}/SKILL.md`, `${bloco.replace(/\n*$/, '\n')}${av}\n\n${s.corpo.replace(/^\n+/, '')}`.replace(/\n*$/, '\n'));
  }
  return out;
}

async function listarGeradosAntigos(raiz) {
  const achados = [];
  const olhar = async (pasta, filtro) => {
    let itens = [];
    try { itens = await readdir(pasta, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const completo = path.join(pasta, it.name);
      if (it.isDirectory()) { await olhar(completo, filtro); continue; }
      if (!filtro(it.name)) continue;
      try { if ((await readFile(completo, 'utf8')).includes('GERADO por scripts/setup.mjs sync-agents.')) achados.push(path.relative(raiz, completo).split(path.sep).join('/')); } catch { /* ilegível */ }
    }
  };
  await olhar(path.join(raiz, '.cursor', 'rules'), (n) => n.endsWith('.mdc'));
  await olhar(path.join(raiz, '.claude', 'skills'), (n) => n === 'SKILL.md');
  return achados;
}

/* Compara com o disco. estado: 'ok' | 'diverge' | 'ausente' | 'obsoleto'. */
export async function compararEspelhos(raiz, esperado) {
  const itens = [];
  for (const [rel, conteudo] of esperado) {
    let atual = null;
    try { atual = nl(await readFile(path.join(raiz, rel), 'utf8')); } catch { /* ausente */ }
    itens.push({ arquivo: rel, estado: atual === null ? 'ausente' : (atual === conteudo ? 'ok' : 'diverge') });
  }
  for (const rel of await listarGeradosAntigos(raiz)) if (!esperado.has(rel)) itens.push({ arquivo: rel, estado: 'obsoleto' });
  return itens;
}

export async function gravarEspelhos(raiz, esperado, itens) {
  for (const it of itens) {
    if (it.estado === 'ok') continue;
    const completo = path.join(raiz, it.arquivo);
    if (it.estado === 'obsoleto') { await rm(completo, { force: true }); continue; }
    await mkdir(path.dirname(completo), { recursive: true });
    await writeFile(completo, esperado.get(it.arquivo), 'utf8');
  }
}
