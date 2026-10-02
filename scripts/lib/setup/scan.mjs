/* scripts/lib/setup/scan.mjs — procura segredos em arquivos e em transcritos de conversa.
 *
 * Nunca devolve o segredo: cada achado traz arquivo, linha, tipo e um trecho MASCARADO. Dois métodos:
 *   1. padrões de formato conhecido (chave privada, AWS, GitHub, Slack, Anthropic, JWT...) e atribuição suspeita
 *      (`SENHA=...`, `"apiKey": "..."`) com valor que não é exemplo;
 *   2. valores EXATOS dos segredos que existem neste computador (.env, .dev.vars, ambiente), no que se passar em
 *      `valores` (usado nos transcritos: qualquer aparição do valor é vazamento).
 * Uma linha com `scan-secrets-ignorar` é pulada (para exemplos e testes). */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { mascarar } from './segredos.mjs';

export const PADROES = Object.freeze([
  { tipo: 'chave-privada', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { tipo: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { tipo: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { tipo: 'openai', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { tipo: 'github', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { tipo: 'slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { tipo: 'google-api', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { tipo: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { tipo: 'cloudflare-token', re: /\bCLOUDFLARE_(?:API_TOKEN|STREAM_TOKEN|API_KEY)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{30,})/, grupo: 1 },
  /* Atribuição de valor LITERAL a um nome de segredo: `apiKey: "abc..."`, `SENHA = '...'` (entre aspas, 16+ caracteres) ... */
  { tipo: 'atribuicao-suspeita', re: /\b[A-Za-z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|SENHA|PRIVATE_?KEY|chaveApi|tokenApi|apiKey|secretKey|senha|password)[A-Za-z0-9_]*["']?\s*[:=]\s*(["'])([A-Za-z0-9_+\/=.-]{16,})\1/i, grupo: 2, valor: true },
  /* ... e linha de .env sem aspas (`BUNNY_API_KEY=abc...`). */
  { tipo: 'atribuicao-suspeita', re: /^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|SENHA)[A-Z0-9_]*\s*=\s*["']?([^\s"'#]{12,})/, grupo: 1, valor: true }
]);

/* Valores que são marcador de lugar, referência a variável ou exemplo: não são segredo. */
const EXEMPLO = /^(?:\$\{?[A-Za-z_]|\$env|process\.env|env\.|<|\{\{|%|troque|seu[-_]|sua[-_]|exemplo|example|changeme|xxx|\*{3,}|\.{3}|null|true|false|undefined|vazio|abc|senha|password|secret|token|chave|valor|nome|\(|\[)/i;
const SO_LETRAS_E_PONTO = /^[A-Za-z_.]+$/;

function ehValorReal(v) {
  if (!v || v.length < 8) return false;
  if (EXEMPLO.test(v)) return false;
  if (/^(.)\1+$/.test(v)) return false;
  if (SO_LETRAS_E_PONTO.test(v) && !/[A-Z].*[a-z]|[a-z].*[A-Z]/.test(v)) return false;   /* nome de variável ou palavra comum */
  if (/^[A-Za-z]+[._-][A-Za-z_.-]+$/.test(v) && !/\d/.test(v)) return false;                     /* process.env.NOME, nome-de-coisa */
  if (/^https?:\/\//i.test(v) || /^[./~]/.test(v)) return false;
  return /\d/.test(v) || v.length >= 20;
}

export function varrerTexto(texto, { rotulo = '(texto)', valores = new Map() } = {}) {
  const achados = [];
  const linhas = String(texto).split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (linha.includes('scan-secrets-ignorar')) continue;
    if (linha.length > 4000) continue;                 /* linha gigante (minificado, base64): não vale o ruído */
    const vistos = new Set();
    for (const p of PADROES) {
      const m = p.re.exec(linha);
      if (!m) continue;
      const trecho = p.grupo ? m[p.grupo] : m[0];
      if (p.valor && !ehValorReal(trecho)) continue;
      if (vistos.has(p.tipo === 'atribuicao-suspeita' ? trecho : p.tipo)) continue;
      vistos.add(p.tipo === 'atribuicao-suspeita' ? trecho : p.tipo);
      achados.push({ arquivo: rotulo, linha: i + 1, tipo: p.tipo, trecho: mascarar(trecho) });
    }
    for (const [nome, valor] of valores) {
      if (linha.includes(valor)) achados.push({ arquivo: rotulo, linha: i + 1, tipo: 'valor-de-segredo-local', trecho: `valor de ${nome} ${mascarar(valor)}` });
    }
  }
  return achados;
}

const PASTAS_IGNORADAS = new Set(['.git', 'node_modules', '.wrangler', 'dados', 'data', 'tmp', 'segredos', 'secrets']);
const TAMANHO_MAXIMO = 2 * 1024 * 1024;

async function caminhar(raiz, pasta = raiz, saida = []) {
  let itens = [];
  try { itens = await readdir(pasta, { withFileTypes: true }); } catch { return saida; }
  for (const it of itens) {
    const completo = path.join(pasta, it.name);
    if (it.isDirectory()) { if (!PASTAS_IGNORADAS.has(it.name)) await caminhar(raiz, completo, saida); }
    else if (it.isFile()) {
      if (it.name === '.dev.vars' || (it.name.startsWith('.env') && it.name !== '.env.example')) continue;
      saida.push(path.relative(raiz, completo));
    }
  }
  return saida;
}

/* A lista de arquivos a varrer: o que o git conhece (versionado + novo não ignorado), ou, sem git, uma caminhada. */
export async function arquivosParaVarrer(ctx, { staged = false, incluirTestes = false } = {}) {
  /* tests/ guarda chaves FALSAS de propósito (fixtures): fora da varredura, salvo --incluir-testes. */
  const semTestes = (lista) => (incluirTestes ? lista : lista.filter((a) => !a.split(path.sep).join('/').startsWith('tests/')));
  const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files', '-co', '--exclude-standard'];
  const r = await ctx.exec('git', args, { cwd: ctx.raiz });
  if (r.codigo === 0) return { origem: 'git', arquivos: semTestes(String(r.saida).split(/\r?\n/).filter(Boolean)) };
  return { origem: 'pasta', arquivos: semTestes(await caminhar(ctx.raiz)) };
}

export async function varrerArquivos(raiz, arquivos, { valores } = {}) {
  const achados = [];
  let varridos = 0;
  for (const rel of arquivos) {
    const completo = path.resolve(raiz, rel);
    let info;
    try { info = await stat(completo); } catch { continue; }
    if (!info.isFile() || info.size > TAMANHO_MAXIMO) continue;
    let buf;
    try { buf = await readFile(completo); } catch { continue; }
    if (buf.includes(0)) continue;                      /* binário */
    varridos++;
    achados.push(...varrerTexto(buf.toString('utf8'), { rotulo: rel.split(path.sep).join('/'), valores }));
  }
  return { achados, varridos };
}
