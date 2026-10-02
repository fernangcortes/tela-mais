#!/usr/bin/env node
/* scripts/preparar-release.mjs — para QUEM MANTÉM O PRODUTO (não para o cliente): prepara, confere e empacota uma release.
 *
 *   node scripts/preparar-release.mjs --versao 1.0.0 [--data 2027-03-01] [--simular]
 *        muda a versão em .core-version, package.json (que o Worker lê como versão do core) e no LICENSE (Licensed Work e
 *        Change Date = 4 anos depois da data de publicação) e na tradução (LICENCA-PT.md). NÃO toca no texto-base da BSL.
 *        Exige uma seção `## [1.0.0]` no CHANGELOG.md. Não faz commit nem tag.
 *   node scripts/preparar-release.mjs --verificar [--tag v1.0.0]   confere que tudo concorda (CI de release)
 *   node scripts/preparar-release.mjs --notas 1.0.0                 imprime a seção do CHANGELOG daquela versão
 *   node scripts/preparar-release.mjs --empacotar <pasta>           gera core-vX.Y.Z.tar.gz e core-vX.Y.Z.sha256
 *
 * A BSL limita a Change Date a 4 anos da primeira publicação DAQUELA versão: por isso o LICENSE de cada release leva a
 * sua própria data, calculada aqui (e conferida pelo --verificar), nunca copiada da release anterior.
 * Códigos: 0 certo, 1 falhou/incoerente, 2 uso incorreto. */
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { lerVersao } from './lib/semver.mjs';
import { blocosDoChangelog, PRODUTO } from './lib/atualizar-core.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANOS_DA_BSL = 4;

export function somarAnos(dataISO, anos) {
  const [a, m, d] = dataISO.split('-').map(Number);
  const x = new Date(Date.UTC(a + anos, m - 1, d));
  if (x.getUTCMonth() !== m - 1) x.setUTCDate(0);   /* 29/02 num ano não bissexto vira 28/02 */
  return x.toISOString().slice(0, 10);
}

const dataValida = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/* Troca SÓ os parâmetros do cabeçalho do LICENSE. Devolve o texto novo (igual, se já estava). */
export function atualizarLicense(texto, versao, changeDate) {
  const a = texto.replace(/^(Licensed Work:\s+tela mAIs, version )\S+/m, `$1${versao}`);
  return a.replace(/^(Change Date:\s+)\d{4}-\d{2}-\d{2}/m, `$1${changeDate}`);
}
export function atualizarTraducao(texto, versao, changeDate) {
  return texto.replace(/\(\d{4}-\d{2}-\d{2} para a versão [^)]+\)/, `(${changeDate} para a versão ${versao})`);
}
export function atualizarPackage(texto, versao) {
  return texto.replace(/("version"\s*:\s*")[^"]*(")/, `$1${versao}$2`);
}

async function ler(raiz, rel) { return readFile(path.join(raiz, rel), 'utf8'); }

/* Lê o que cada arquivo diz de si. */
export async function lerEstado(raiz) {
  const core = (await ler(raiz, '.core-version')).trim();
  const pkg = JSON.parse(await ler(raiz, 'package.json')).version;
  const lic = await ler(raiz, 'LICENSE');
  const trabalho = /^Licensed Work:\s+tela mAIs, version (\S+)/m.exec(lic);
  const data = /^Change Date:\s+(\d{4}-\d{2}-\d{2})/m.exec(lic);
  const cl = blocosDoChangelog(await ler(raiz, 'CHANGELOG.md').catch(() => ''));
  return { core, pacote: pkg, licenca: trabalho && trabalho[1], changeDate: data && data[1], changelog: cl };
}

/* Problemas de coerência (lista vazia = tudo certo). `hoje` = data da publicação (AAAA-MM-DD) para checar a Change Date. */
export async function verificar(raiz, { tag = null, hoje = null } = {}) {
  const e = await lerEstado(raiz);
  const erros = [];
  if (!lerVersao(e.core)) erros.push(`.core-version ("${e.core}") não é X.Y.Z.`);
  if (e.pacote !== e.core) erros.push(`package.json diz ${e.pacote}, mas .core-version diz ${e.core}.`);
  if (e.licenca !== e.core) erros.push(`LICENSE (Licensed Work) diz ${e.licenca}, mas .core-version diz ${e.core}.`);
  if (!e.changelog.some((b) => b.versao === e.core)) erros.push(`CHANGELOG.md não tem a seção "## [${e.core}]".`);
  if (tag && tag.replace(/^v/, '') !== e.core) erros.push(`a tag ${tag} não bate com a versão do repositório (${e.core}).`);
  if (!e.changeDate) erros.push('LICENSE sem Change Date.');
  else if (hoje) {
    if (e.changeDate <= hoje) erros.push(`a Change Date (${e.changeDate}) já passou ou é hoje.`);
    if (e.changeDate > somarAnos(hoje, ANOS_DA_BSL)) erros.push(`a Change Date (${e.changeDate}) passa de ${ANOS_DA_BSL} anos da publicação (${hoje}): a BSL não permite.`);
  }
  return erros;
}

export async function aplicarVersao(raiz, versao, data, { simular = false } = {}) {
  const changeDate = somarAnos(data, ANOS_DA_BSL);
  const mudancas = [
    ['.core-version', () => versao + '\n'],
    ['package.json', (t) => atualizarPackage(t, versao)],
    ['LICENSE', (t) => atualizarLicense(t, versao, changeDate)],
    ['LICENCA-PT.md', (t) => atualizarTraducao(t, versao, changeDate)]
  ];
  const alterados = [];
  for (const [rel, f] of mudancas) {
    const antigo = await ler(raiz, rel);
    const novo = f(antigo);
    if (novo !== antigo) { alterados.push(rel); if (!simular) await writeFile(path.join(raiz, rel), novo, 'utf8'); }
  }
  return { versao, changeDate, alterados };
}

/* Gera o tarball do produto (só as pastas e arquivos de PRODUTO) com uma pasta de topo `tela-mais-X.Y.Z/`. */
export async function empacotar(raiz, destino, { exec } = {}) {
  const e = await lerEstado(raiz);
  const { listarArquivosDoProduto } = await import('./lib/empacotar.mjs');
  const arquivos = await listarArquivosDoProduto(raiz, PRODUTO);
  const tmp = await mkdtemp(path.join(tmpdir(), 'tela-rel-'));
  const topo = `tela-mais-${e.core}`;
  try {
    for (const rel of arquivos) {
      const alvo = path.join(tmp, topo, rel);
      await mkdir(path.dirname(alvo), { recursive: true });
      await copyFile(path.join(raiz, rel), alvo);
    }
    await mkdir(destino, { recursive: true });
    const nome = `core-v${e.core}.tar.gz`;
    const tar = path.join(destino, nome);
    await (exec || execReal)('tar', ['-czf', tar, '-C', tmp, topo]);
    const soma = createHash('sha256').update(await readFile(tar)).digest('hex');
    await writeFile(path.join(destino, `core-v${e.core}.sha256`), `${soma}  ${nome}\n`, 'utf8');
    return { versao: e.core, tar, sha256: soma, arquivos: arquivos.length };
  } finally { await rm(tmp, { recursive: true, force: true }); }
}

async function execReal(cmd, args) {
  const { spawn } = await import('node:child_process');
  await new Promise((ok, erro) => { const f = spawn(cmd, args, { stdio: 'inherit' }); f.on('error', erro); f.on('close', (c) => (c === 0 ? ok() : erro(new Error(`${cmd} saiu com ${c}`)))); });
}

export async function principal(argv = process.argv.slice(2), { raiz = RAIZ, hoje = () => new Date().toISOString().slice(0, 10) } = {}) {
  const f = { versao: null, data: null, simular: false, verificar: false, tag: null, notas: null, empacotar: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => { const x = argv[++i]; if (!x || x.startsWith('--')) throw new Error(`${a} precisa de um valor.`); return x; };
    try {
      if (a === '--versao') f.versao = v();
      else if (a === '--data') f.data = v();
      else if (a === '--simular') f.simular = true;
      else if (a === '--verificar') f.verificar = true;
      else if (a === '--tag') f.tag = v();
      else if (a === '--notas') f.notas = v();
      else if (a === '--empacotar') f.empacotar = v();
      else return { codigo: 2, texto: `Opção desconhecida: ${a}\n` };
    } catch (e) { return { codigo: 2, texto: e.message + '\n' }; }
  }
  if (f.notas) {
    const b = blocosDoChangelog(await ler(raiz, 'CHANGELOG.md')).find((x) => x.versao === f.notas.replace(/^v/, ''));
    return b ? { codigo: 0, texto: b.texto.replace(/^##[^\n]*\n+/, '') + '\n' } : { codigo: 1, texto: `Sem seção ${f.notas} no CHANGELOG.md.\n` };
  }
  if (f.versao) {
    const v = f.versao.replace(/^v/, '');
    if (!lerVersao(v) || v.includes('+')) return { codigo: 2, texto: '--versao precisa ser X.Y.Z (ou X.Y.Z-beta.1).\n' };
    const data = f.data || hoje();
    if (!dataValida(data)) return { codigo: 2, texto: '--data precisa ser AAAA-MM-DD.\n' };
    if (!blocosDoChangelog(await ler(raiz, 'CHANGELOG.md')).some((b) => b.versao === v)) return { codigo: 1, texto: `Escreva primeiro a seção "## [${v}]" no CHANGELOG.md (com Novidades, Correções, Segurança e Precisa de ação sua).\n` };
    const r = await aplicarVersao(raiz, v, data, { simular: f.simular });
    return { codigo: 0, ...r, texto: `${f.simular ? 'Simulação: ' : ''}versão ${v}, Change Date ${r.changeDate}. Arquivos ${f.simular ? 'que mudariam' : 'alterados'}: ${r.alterados.join(', ') || 'nenhum'}.\nConfira com: node scripts/preparar-release.mjs --verificar\n` };
  }
  if (f.empacotar) {
    const erros = await verificar(raiz, { tag: f.tag });
    if (erros.length) return { codigo: 1, texto: 'Não empacoto com a release incoerente:\n- ' + erros.join('\n- ') + '\n' };
    const r = await empacotar(raiz, path.resolve(raiz, f.empacotar));
    return { codigo: 0, ...r, texto: `Gerado ${r.tar} (${r.arquivos} arquivos), sha256 ${r.sha256}\n` };
  }
  if (f.verificar) {
    const erros = await verificar(raiz, { tag: f.tag, hoje: hoje() });
    return erros.length ? { codigo: 1, erros, texto: 'Release incoerente:\n- ' + erros.join('\n- ') + '\n' } : { codigo: 0, erros, texto: 'Versão, LICENSE, CHANGELOG e Change Date concordam.\n' };
  }
  return { codigo: 2, texto: 'Uso: node scripts/preparar-release.mjs (--versao X.Y.Z [--data AAAA-MM-DD] [--simular] | --verificar [--tag vX.Y.Z] | --notas X.Y.Z | --empacotar <pasta>)\n' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await principal();
  (r.codigo === 0 ? process.stdout : process.stderr).write(r.texto);
  process.exitCode = r.codigo;
}
