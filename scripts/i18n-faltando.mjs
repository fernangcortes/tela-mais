#!/usr/bin/env node
/* scripts/i18n-faltando.mjs — confere se en e es estão completos em relação ao pt-BR.
 *
 *   node scripts/i18n-faltando.mjs            lista os problemas; sai com 1 se houver algum
 *   node scripts/i18n-faltando.mjs --json     o mesmo, para máquina
 *
 * O pt-BR é o catálogo de REFERÊNCIA (core/locales/pt-BR.json): toda chave nasce lá.
 * Para cada outro idioma de fábrica (en, es) e para cada config/locales/<idioma>.json
 * do cliente, confere:
 *   - faltando    chave do pt-BR que o idioma não traduziu (no cliente: só informa, o que
 *                 faltar cai no idioma padrão — é permitido);
 *   - sobrando    chave que o pt-BR não tem (provável erro de digitação);
 *   - parametros  {n}, {titulo}... diferentes dos do pt-BR (a frase quebraria na tela);
 *   - plurais     texto com formas de plural onde o pt-BR tem texto simples, ou o contrário;
 *   - vazios      tradução em branco;
 *   - codigo      chave que o CÓDIGO usa (core/site, core/worker) e o pt-BR não tem.
 * Em en e es, qualquer item acima é falha (código de saída 1). */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizar } from './lib/js-literais.mjs';
import { parametrosDe } from '../core/worker/_lib/i18n-validar.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const IDIOMAS_COMPLETOS = ['en', 'es'];
const CATEGORIAS = new Set(['zero', 'one', 'two', 'few', 'many', 'other', 'um', 'outro']);

function lerJson(arquivo) { return JSON.parse(readFileSync(arquivo, 'utf8')); }

function formaDe(valor) {
  if (typeof valor === 'string') return 'texto';
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) return 'plural';
  return 'invalido';
}

/* Compara uma tabela com a referência. */
export function compararComReferencia(ref, tabela) {
  const r = { faltando: [], sobrando: [], parametros: [], plurais: [], vazios: [] };
  for (const [chave, valorRef] of Object.entries(ref)) {
    if (!(chave in tabela)) { r.faltando.push(chave); continue; }
    const v = tabela[chave];
    const forma = formaDe(v);
    if (forma === 'invalido') { r.plurais.push(`${chave}: o valor precisa ser texto ou um bloco de plural`); continue; }
    if (forma !== formaDe(valorRef)) {
      r.plurais.push(`${chave}: o pt-BR é ${formaDe(valorRef)} e a tradução é ${forma}`);
      continue;
    }
    if (forma === 'plural') {
      const cats = Object.keys(v);
      const ruins = cats.filter((c) => !CATEGORIAS.has(c) && !/^=\d+$/.test(c));
      if (ruins.length) r.plurais.push(`${chave}: forma de plural desconhecida (${ruins.join(', ')})`);
      if (!('other' in v) && !('outro' in v)) r.plurais.push(`${chave}: falta a forma "other"`);
    }
    const textos = forma === 'texto' ? [v] : Object.values(v);
    if (textos.some((t) => typeof t !== 'string' || !t.trim())) { r.vazios.push(chave); continue; }
    const a = [...parametrosDe(valorRef)].sort().join(',');
    const b = [...parametrosDe(v)].sort().join(',');
    if (a !== b) r.parametros.push(`${chave}: o pt-BR usa {${a.split(',').join('}, {')}} e a tradução usa {${b.split(',').join('}, {')}}`);
  }
  for (const chave of Object.keys(tabela)) if (!(chave in ref)) r.sobrando.push(chave);
  return r;
}

/* As chaves de texto que o código cita ('namespace.chave'), para achar as que não existem. */
export function chavesUsadasNoCodigo(raiz, ref) {
  const nomes = new Set(Object.keys(ref).map((k) => k.split('.')[0]));
  const re = new RegExp(`^(${[...nomes].join('|')})\\.[\\w-]+$`);
  const achadas = new Map();
  const varrer = (pasta) => {
    for (const nome of readdirSync(pasta)) {
      const cheio = path.join(pasta, nome);
      if (statSync(cheio).isDirectory()) { if (nome !== 'vendor' && nome !== 'locales' && nome !== 'node_modules') varrer(cheio); continue; }
      if (!/\.(js|mjs)$/.test(nome)) continue;
      const fonte = readFileSync(cheio, 'utf8');
      for (const t of tokenizar(fonte)) {
        if (t.tipo === 'string' && re.test(t.valor) && !/\.(js|mjs|css|json|html|svg|png)$/.test(t.valor)) {
          if (!achadas.has(t.valor)) achadas.set(t.valor, `${path.relative(raiz, cheio).split(path.sep).join('/')}:${t.linha}`);
        }
      }
    }
  };
  varrer(path.join(raiz, 'core', 'site'));
  varrer(path.join(raiz, 'core', 'worker'));
  return achadas;
}

export function verificar(raiz = RAIZ) {
  const ref = lerJson(path.join(raiz, 'core', 'locales', 'pt-BR.json'));
  const resultado = { idiomas: {}, cliente: {}, codigo: [] };
  for (const id of IDIOMAS_COMPLETOS) {
    const arq = path.join(raiz, 'core', 'locales', `${id}.json`);
    resultado.idiomas[id] = existsSync(arq)
      ? compararComReferencia(ref, lerJson(arq))
      : { faltando: Object.keys(ref), sobrando: [], parametros: [], plurais: [], vazios: [], ausente: true };
  }
  const pastaCliente = path.join(raiz, 'config', 'locales');
  if (existsSync(pastaCliente)) {
    for (const nome of readdirSync(pastaCliente).filter((n) => n.endsWith('.json'))) {
      resultado.cliente[nome.slice(0, -5)] = compararComReferencia(ref, lerJson(path.join(pastaCliente, nome)));
    }
  }
  for (const [chave, onde] of chavesUsadasNoCodigo(raiz, ref)) {
    if (!(chave in ref)) resultado.codigo.push(`${chave} (${onde})`);
  }
  return resultado;
}

export function totalDeProblemas(resultado) {
  let n = resultado.codigo.length;
  for (const r of Object.values(resultado.idiomas)) n += r.faltando.length + r.sobrando.length + r.parametros.length + r.plurais.length + r.vazios.length;
  /* No cliente, faltar é permitido (cai no padrão); o resto não. */
  for (const r of Object.values(resultado.cliente)) n += r.sobrando.length + r.parametros.length + r.plurais.length + r.vazios.length;
  return n;
}

export function principal(argv = process.argv.slice(2), saida = console, raiz = RAIZ) {
  const r = verificar(raiz);
  const total = totalDeProblemas(r);
  if (argv.includes('--json')) { saida.log(JSON.stringify({ total, ...r }, null, 2)); return total ? 1 : 0; }
  const ref = lerJson(path.join(raiz, 'core', 'locales', 'pt-BR.json'));
  saida.log(`pt-BR (referência): ${Object.keys(ref).length} chaves.`);
  const mostrar = (rotulo, lista) => { if (lista.length) saida.log(`    ${rotulo} (${lista.length}):\n      - ${lista.join('\n      - ')}`); };
  for (const [id, x] of Object.entries(r.idiomas)) {
    const n = x.faltando.length + x.sobrando.length + x.parametros.length + x.plurais.length + x.vazios.length;
    saida.log(`  ${id}: ${n ? n + ' problema(s)' : 'completo'}`);
    mostrar('faltando', x.faltando); mostrar('sobrando', x.sobrando); mostrar('parâmetros', x.parametros);
    mostrar('plurais', x.plurais); mostrar('vazios', x.vazios);
  }
  for (const [id, x] of Object.entries(r.cliente)) {
    saida.log(`  config/locales/${id}.json: ${x.faltando.length} chave(s) caem no idioma padrão${x.sobrando.length + x.parametros.length ? '; há problemas' : ''}`);
    mostrar('sobrando', x.sobrando); mostrar('parâmetros', x.parametros); mostrar('plurais', x.plurais); mostrar('vazios', x.vazios);
  }
  if (r.codigo.length) saida.log(`  o código usa chaves que o pt-BR não tem (${r.codigo.length}):\n      - ${r.codigo.join('\n      - ')}`);
  saida.log(total ? `\n${total} problema(s) nos textos da interface.` : '\nTextos da interface completos: nenhuma chave faltando em en e es.');
  return total ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = principal();
