/* scripts/lib/setup/segredos.mjs — o que o setup faz com segredos: gerar, mascarar, guardar em arquivo ignorado pelo git.
 *
 * REGRAS: o valor nunca vai para a linha de comando de um programa, nunca é impresso e nunca entra em arquivo
 * versionado. Quando precisa aparecer, aparece mascarado (`****abcd`; abaixo de 20 caracteres só o tamanho,
 * porque mostrar o fim de uma senha curta já é mostrar muito dela). */
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { analisar } from '../env.mjs';
import { erroUso } from './erros.mjs';

export const NOME_DE_SEGREDO = /^[A-Z][A-Z0-9_]{1,63}$/;

/* Variáveis que o produto conhece (para avisar de nome estranho, não para recusar). */
export const SEGREDOS_CONHECIDOS = Object.freeze([
  'ADMIN_PASSWORD', 'SESSION_SECRET', 'TURNSTILE_SECRET', 'RESEND_API_KEY',
  'BUNNY_LIBRARY_ID', 'BUNNY_API_KEY', 'BUNNY_PULLZONE', 'BUNNY_TOKEN_KEY', 'BUNNY_EMBED_KEY',
  'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_STREAM_TOKEN', 'CLOUDFLARE_STREAM_SUBDOMINIO', 'CLOUDFLARE_STREAM_KEY_ID',
  'CLOUDFLARE_STREAM_KEY_JWK', 'CLOUDFLARE_STREAM_KEY_PEM', 'CLOUDFLARE_STREAM_WEBHOOK_SECRET',
  'ASSEMBLYAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GITHUB_DISPATCH_TOKEN'
]);

export function mascarar(valor) {
  const v = String(valor ?? '');
  if (!v) return '(vazio)';
  return v.length >= 20 ? '****' + v.slice(-4) : `**** (${v.length} caracteres)`;
}

export function gerarSegredo(bytes = 36) {
  return randomBytes(bytes).toString('base64url');
}

/* Troca, em qualquer texto, o valor dos segredos conhecidos por sua máscara (rede de segurança para mensagens
 * de erro de programas externos). */
export function esconderValores(texto, valores = []) {
  let t = String(texto ?? '');
  for (const v of valores) {
    if (typeof v === 'string' && v.length >= 6) t = t.split(v).join(mascarar(v));
  }
  return t;
}

export function validarValorDeSegredo(nome, valor) {
  if (!valor) return 'o valor está vazio.';
  if (/[\r\n]/.test(valor)) return 'o valor tem quebra de linha; cole só o texto da chave, em uma linha.';
  if (nome === 'SESSION_SECRET' && valor.length < 32) return 'SESSION_SECRET precisa ter pelo menos 32 caracteres (use --gerar).';
  if (nome === 'ADMIN_PASSWORD' && valor.length < 12) return 'a senha do administrador precisa ter pelo menos 12 caracteres.';
  return null;
}

/* ---------------------------------------------------------------- arquivos .env / .dev.vars */

function formatarValorEnv(valor) {
  if (!/[\s#"']/.test(valor)) return valor;
  if (!valor.includes('"')) return `"${valor}"`;
  if (!valor.includes("'")) return `'${valor}'`;
  throw erroUso('o valor mistura aspas simples e duplas e não cabe num arquivo .env.');
}

/* Mantém a linha `NOME=` única: troca se existe, acrescenta se não. Devolve 'criado' | 'atualizado' | 'igual'. */
export async function gravarNoArquivoEnv(arquivo, nome, valor) {
  let texto = '';
  try { texto = await readFile(arquivo, 'utf8'); } catch { /* arquivo novo */ }
  const atual = analisar(texto)[nome];
  if (atual === valor) return 'igual';
  const linha = `${nome}=${formatarValorEnv(valor)}`;
  const re = new RegExp(`^\\s*${nome}\\s*=.*$`, 'm');
  let novo;
  let estado;
  if (re.test(texto)) { novo = texto.replace(re, () => linha); estado = 'atualizado'; }
  else { novo = texto + (texto && !texto.endsWith('\n') ? '\n' : '') + linha + '\n'; estado = 'criado'; }
  await mkdir(path.dirname(arquivo), { recursive: true });
  await writeFile(arquivo, novo, { encoding: 'utf8', mode: 0o600 });
  try { await chmod(arquivo, 0o600); } catch { /* sistemas sem chmod (Windows) */ }
  return estado;
}

export async function lerArquivoEnv(arquivo) {
  try { return analisar(await readFile(arquivo, 'utf8')); } catch { return {}; }
}

/* Garante que o .gitignore cobre `.env`, `.dev.vars` e `.wrangler/`. Devolve as linhas acrescentadas. */
export async function garantirGitignore(raiz, { dryRun = false } = {}) {
  const arquivo = path.join(raiz, '.gitignore');
  let texto = '';
  try { texto = await readFile(arquivo, 'utf8'); } catch { /* sem .gitignore ainda */ }
  const linhas = new Set(texto.split(/\r?\n/).map((l) => l.trim()));
  const faltando = ['.env', '.env.*', '!.env.example', '.dev.vars', '.wrangler/'].filter((l) => !linhas.has(l) && !(l === '.wrangler/' && linhas.has('.wrangler')));
  if (faltando.length && !dryRun) {
    const novo = texto + (texto && !texto.endsWith('\n') ? '\n' : '') + '# segredos e estado local (acrescentado por scripts/setup.mjs)\n' + faltando.join('\n') + '\n';
    await writeFile(arquivo, novo, 'utf8');
  }
  return faltando;
}

/* Valores de segredo que existem NESTE computador (process.env e arquivos ignorados), para procurar vazamento. */
export async function valoresSecretosLocais(raiz, env = process.env) {
  const achados = new Map();
  const ehSecreto = (nome) => /(KEY|SECRET|TOKEN|PASSWORD|SENHA|PEM|JWK)/.test(nome) || SEGREDOS_CONHECIDOS.includes(nome);
  const fontes = [env, await lerArquivoEnv(path.join(raiz, '.env')), await lerArquivoEnv(path.join(raiz, '.dev.vars'))];
  for (const fonte of fontes) {
    for (const [nome, valor] of Object.entries(fonte || {})) {
      if (typeof valor === 'string' && valor.length >= 8 && NOME_DE_SEGREDO.test(nome) && ehSecreto(nome)) achados.set(nome, valor);
    }
  }
  return achados;
}
