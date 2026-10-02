/* scripts/lib/atualizar-core.mjs — a lógica de atualizar o PRODUTO (core) de uma cópia de cliente sem tocar no que é do
 * cliente. Usada por scripts/atualizar-core.mjs e pelo workflow .github/workflows/atualizar-core.yml.
 *
 * O QUE É DO PRODUTO (substituído pela versão nova) e o que é do CLIENTE (nunca tocado) está abaixo, em duas listas.
 * Tudo que não está em PRODUTO fica como está: config/ (menos o esquema), wrangler.jsonc, dados/, .env, README, workflows. */
import { readdir, readFile, writeFile, mkdir, rm, stat, lstat, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compararVersoes, lerVersao } from './semver.mjs';

/* Pastas inteiras e arquivos soltos que a atualização substitui. Caminhos relativos à raiz, com `/`. */
export const PRODUTO = Object.freeze({
  pastas: Object.freeze(['core', 'scripts', 'tests', 'docs', '.agents', '.claude', '.cursor', '.gemini']),
  arquivos: Object.freeze([
    'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'COMECE-AQUI.md', 'LICENSE', 'LICENCA-PT.md', 'NOTICE', 'COMMERCIAL.md',
    'CHANGELOG.md', '.core-version', 'package.json', '.env.example', '.github/copilot-instructions.md',
    /* O ÚNICO arquivo de config/ que é do produto: o esquema que valida o site.json do cliente. */
    'config/site.schema.json'
  ])
});

/* Dentro de uma pasta do produto, o que é do CLIENTE e sobrevive: a marca dele (logo, ícones), as fontes geradas a partir de config/fontes e a configuração local. */
export const PRESERVAR = Object.freeze(['core/site/marca', 'core/site/fontes', '.claude/settings.local.json']);

const norm = (p) => p.split(path.sep).join('/');
const sob = (rel, base) => rel === base || rel.startsWith(base + '/');
export const preservado = (rel) => PRESERVAR.some((p) => sob(rel, p));

async function existe(p) { try { await stat(p); return true; } catch { return false; } }

/* Lista arquivos (caminho relativo com `/`), sem seguir link simbólico. Recusa link: release não tem, e um link
 * apontando para fora seria uma forma de escrever onde não deve. */
async function listar(raiz, rel = '') {
  const abs = path.join(raiz, rel);
  let itens;
  try { itens = await readdir(abs, { withFileTypes: true }); } catch { return []; }
  const saida = [];
  for (const it of itens) {
    const r = rel ? `${rel}/${it.name}` : it.name;
    if (it.isSymbolicLink()) throw new Error(`a versão nova tem um link simbólico (${r}): recusada por segurança.`);
    if (it.isDirectory()) saida.push(...await listar(raiz, r));
    else if (it.isFile()) saida.push(r);
  }
  return saida;
}

const sha = async (arquivo) => createHash('sha256').update(await readFile(arquivo)).digest('hex');

/* Acha a raiz da versão nova: a própria pasta, ou a única pasta dentro dela (tarball com diretório de topo). */
export async function acharRaizDaVersao(pasta) {
  if (await existe(path.join(pasta, '.core-version'))) return pasta;
  const itens = (await readdir(pasta, { withFileTypes: true })).filter((i) => i.isDirectory());
  if (itens.length === 1 && await existe(path.join(pasta, itens[0].name, '.core-version'))) return path.join(pasta, itens[0].name);
  return null;
}

export async function lerCoreVersion(raiz) {
  try { const t = (await readFile(path.join(raiz, '.core-version'), 'utf8')).trim(); return lerVersao(t) ? t.replace(/^v/, '') : null; } catch { return null; }
}

/* O que mudaria: { adicionar[], alterar[], remover[], iguais } — só dentro de PRODUTO e fora de PRESERVAR. */
export async function planejar(origem, destino) {
  const adicionar = [], alterar = [], remover = [];
  let iguais = 0;
  const doNovo = new Set();
  const consideraArquivo = async (rel) => {
    if (preservado(rel)) return;
    doNovo.add(rel);
    const a = path.join(origem, rel), b = path.join(destino, rel);
    if (!(await existe(b))) adicionar.push(rel);
    else if ((await sha(a)) !== (await sha(b))) alterar.push(rel);
    else iguais += 1;
  };
  for (const pasta of PRODUTO.pastas) for (const rel of await listar(origem, pasta)) await consideraArquivo(rel);
  for (const rel of PRODUTO.arquivos) if (await existe(path.join(origem, rel))) await consideraArquivo(rel);
  /* O que existia no produto antigo e não existe mais no novo: sai (menos o que é do cliente). */
  for (const pasta of PRODUTO.pastas) {
    for (const rel of await listar(destino, pasta)) {
      if (preservado(rel) || doNovo.has(rel)) continue;
      remover.push(rel);
    }
  }
  return { adicionar: adicionar.sort(), alterar: alterar.sort(), remover: remover.sort(), iguais };
}

export async function aplicar(origem, destino, plano) {
  for (const rel of [...plano.adicionar, ...plano.alterar]) {
    const alvo = path.join(destino, rel);
    await mkdir(path.dirname(alvo), { recursive: true });
    await copyFile(path.join(origem, rel), alvo);
  }
  for (const rel of plano.remover) await rm(path.join(destino, rel), { force: true });
  /* pastas que ficaram vazias */
  for (const pasta of PRODUTO.pastas) await podarVazias(path.join(destino, pasta));
}

async function podarVazias(dir) {
  let itens;
  try { itens = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  for (const it of itens) if (it.isDirectory()) await podarVazias(path.join(dir, it.name));
  const resto = await readdir(dir).catch(() => ['x']);
  if (resto.length === 0) { await rm(dir, { recursive: true, force: true }); return true; }
  return false;
}

/* ------------------------------------------------------------------ CHANGELOG */

const CABECALHO = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?[^\n]*$/gm;

/* Os itens da seção `### <titulo>` (sem o "- " e sem "Nenhuma."). Seção ausente = lista vazia. */
function itensDaSecao(corpo, titulo) {
  const m = new RegExp('^###\\s+' + titulo + '[^\\n]*\\n([\\s\\S]*?)(?=^###\\s|(?![\\s\\S]))', 'im').exec(corpo);
  if (!m) return [];
  return m[1].split('\n').map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter((l) => l && !/^(nenhuma|nada)\b/i.test(l));
}

/* Divide o CHANGELOG em blocos por versão: [{ versao, texto, precisaDeAcao, seguranca, acoes[] }]. */
export function blocosDoChangelog(texto) {
  const t = String(texto || '').replace(/\r\n/g, '\n');
  const marcas = [...t.matchAll(CABECALHO)];
  return marcas.map((m, i) => {
    const corpo = t.slice(m.index, i + 1 < marcas.length ? marcas[i + 1].index : t.length).trimEnd();
    const acoes = itensDaSecao(corpo, 'Precisa de a[çc][ãa]o sua');
    return { versao: m[1], texto: corpo, acoes, precisaDeAcao: acoes.length > 0, seguranca: itensDaSecao(corpo, 'Seguran[çc]a').length > 0 };
  });
}

/* Os blocos das versões ENTRE `de` (exclusive) e `ate` (inclusive), da mais nova para a mais velha. */
export function mudancasEntre(changelog, de, ate) {
  return blocosDoChangelog(changelog)
    .filter((b) => compararVersoes(b.versao, de) > 0 && compararVersoes(b.versao, ate) <= 0)
    .sort((a, b) => compararVersoes(b.versao, a.versao));
}

/* Texto do PR: 3 linhas de resumo (o leigo não lê changelog), depois o que ele precisa fazer, depois o changelog. */
export function corpoDoPr({ de, ate, blocos, plano }) {
  const acoes = blocos.flatMap((b) => b.acoes.map((a) => `- (${b.versao}) ${a}`));
  const seguranca = blocos.some((b) => b.seguranca);
  const linhas = [
    `## Atualização do produto: ${de} para ${ate}`, '',
    seguranca ? '**Esta atualização inclui correção de SEGURANÇA. Publique logo depois de conferir.**' : 'Atualização do produto (a pasta `core/` e as ferramentas). A sua configuração (`config/`) não foi alterada.',
    plano ? `${plano.adicionar.length} arquivos novos, ${plano.alterar.length} alterados, ${plano.remover.length} removidos do produto.` : '',
    acoes.length ? 'Tem coisa que precisa de uma ação sua (veja abaixo).' : 'Não precisa de nenhuma ação sua além de conferir e fazer o merge.', '',
    '### Precisa de ação sua', acoes.length ? acoes.join('\n') : 'Nada.', '',
    '### O que mudou', ...blocos.map((b) => b.texto + '\n'), '',
    '### Como conferir',
    '1. Os testes rodaram neste PR: precisam estar verdes.',
    '2. Se o merge for feito, o site é publicado pelo fluxo `deploy` (se estiver ligado) ou com `node scripts/setup.mjs deploy`.',
    '3. Para voltar atrás: botão "Revert" deste PR depois do merge.'
  ];
  return linhas.filter((l) => l !== undefined).join('\n') + '\n';
}

/* ------------------------------------------------------------------ release do GitHub */

export function nomeDoAsset(versao) { return `core-v${versao}.tar.gz`; }

/* Escolhe a release e os dois assets. `fetchJson(url)` e `baixar(url, destino)` são injetados. */
export async function acharRelease({ repo, versao = 'latest', fetchJson }) {
  const url = versao === 'latest' ? `https://api.github.com/repos/${repo}/releases/latest` : `https://api.github.com/repos/${repo}/releases/tags/v${String(versao).replace(/^v/, '')}`;
  const j = await fetchJson(url);
  const tag = j && typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : null;
  if (!tag || !lerVersao(tag)) throw new Error('a release não tem uma versão legível.');
  const assets = Array.isArray(j.assets) ? j.assets : [];
  const tar = assets.find((a) => a.name === nomeDoAsset(tag));
  const soma = assets.find((a) => a.name === nomeDoAsset(tag).replace(/\.tar\.gz$/, '.sha256'));
  if (!tar || !soma) throw new Error(`a release v${tag} não traz ${nomeDoAsset(tag)} e o arquivo .sha256.`);
  return { versao: tag, urlTar: tar.browser_download_url, urlSoma: soma.browser_download_url, corpo: j.body || '' };
}

export const sha256Do = sha;
export function somaDeclarada(texto) {
  const m = /\b([0-9a-f]{64})\b/i.exec(String(texto));
  return m ? m[1].toLowerCase() : null;
}
