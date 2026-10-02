#!/usr/bin/env node
/* scripts/i18n-literais.mjs — conta os textos de interface em português escritos no CÓDIGO.
 *
 *   node scripts/i18n-literais.mjs              conta; sai com 1 se passar do limite
 *   node scripts/i18n-literais.mjs --lista      mostra cada ocorrência (arquivo:linha)
 *   node scripts/i18n-literais.mjs --json       saída para máquina
 *   node scripts/i18n-literais.mjs --limite=40  troca o limite só nesta execução
 *
 * Todo texto que a pessoa lê mora em core/locales/*.json e entra no código por
 * `tr('chave')`. Quem escreve um literal em português na interface faz o texto
 * ficar preso a um idioma: este script é a rede que pega isso. É uma HEURÍSTICA
 * (um léxico de JavaScript, sem parser): acerta o grosso e erra para os dois
 * lados em casos raros — por isso o limite não é zero, e por isso ele só sobe
 * com justificativa no PR.
 *
 * O QUE CONTA como texto de interface em português: literal de string/template
 * com acento, com duas ou mais palavras de função do português, ou que começa por
 * palavra capitalizada (um rótulo). Em HTML: o texto entre tags e os atributos
 * title, alt, placeholder e aria-label — exceto onde há data-i18n / data-i18n-attr
 * (esses são preenchidos do catálogo pelo aplicar-config).
 *
 * O QUE NÃO CONTA:
 *   - a linha que traz o marcador `i18n-ignorar` (com o motivo ao lado): é dado, e não texto
 *     de tela — rótulo de faixa de legenda, valor de enum gravado, lista de palavras da busca;
 *   - os arquivos de EXCECOES abaixo, com o motivo de cada um;
 *   - comentários e as regexes.
 *
 * LIMITE DOCUMENTADO: LIMITE_PADRAO literais. A linha de base hoje está logo abaixo do
 * limite, com folga curta para a margem de erro da heurística. Ao traduzir mais
 * coisa, DIMINUA o limite; subir exige dizer no PR por quê. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizar, ehTextoPt, literaisPtHtml } from './lib/js-literais.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LIMITE_PADRAO = 10;

/* Arquivos inteiros fora da contagem, e por quê. */
export const EXCECOES = new Map([
  ['core/worker/_lib/config-validar.mjs', 'diagnósticos de instalação lidos por quem configura (CLI/validador): pt-BR por decisão, como o restante dos scripts'],
  ['core/worker/_lib/config.js', 'diagnósticos de instalação do Worker (configuração inválida): pt-BR por decisão'],
  ['core/worker/_lib/i18n-validar.mjs', 'diagnósticos de instalação (chaves e idiomas do config): pt-BR por decisão'],
  ['core/worker/_lib/tema.mjs', 'diagnósticos de instalação (tema): pt-BR por decisão'],
  ['core/worker/_lib/contraste.mjs', 'diagnósticos de instalação (contraste de paleta): pt-BR por decisão'],
  ['core/site/indice-core.js', 'validação máquina a máquina do pedido de indexação (volta em `params.detalhe` do erro da API)'],
  ['core/site/busca-core.js', 'linguística da busca em português (palavras vazias, plurais): não é texto de tela']
]);

const SO_CODIGO = /\.(js|mjs)$/;
const SO_HTML = /\.html$/;

/* Padrões de literal que parecem texto mas são código: seletores, cabeçalhos, teclas. */
const NAO_E_TEXTO = [
  /^(Enter|Escape|Tab|Home|End|Arrow\w+|Bearer\b.*|Content-Type|Authorization|Accept|GET|POST|PUT|DELETE|HEAD|use strict)$/,
  /^[a-z]+(, ?[a-z.#\[\]=" -]+)+$/,        /* "input, label, select" */
  /^[.#a-z][\w.#\[\]="-]*$/,               /* seletor ou classe CSS de uma palavra */
  /^[.#\w][\w.#\[\]="-]* ?[>+~:] ?[\w.#\[\]="():-]+( [\w.#\[\]="():>-]+)*$/   /* seletor com combinador */
];

/* Palavras soltas, em minúsculas, que são texto de tela e não identificador. */
const PALAVRAS_SOLTAS = /^(pronto|nenhum[a]?|sim|não|fim|mudo|vazi[ao]s?|ligad[ao]|desligad[ao]|consultando|carregando|lendo|salvo|erro|tudo|todos?|outros?)…?$/;
/* Multipalavra em minúsculas com palavra de função do português e sem hífen/sublinhado:
 * "no rascunho", "sem limite" — não é lista de classes CSS. */
const FRASE_MINUSCULA = /^[a-záéíóúâêôãõç…,.:;!?·+-]+( [a-záéíóúâêôãõç0-9…,.:;!?·+%-]+)+$/;
const FUNCAO = /(^| )(o|a|os|as|um|uma|no|na|nos|nas|em|de|do|da|para|sem|com|que|vai|ou|e|já|ao)( |$)/;

/* Uma palavra solta só é texto de tela quando quem a recebe é um campo de texto:
 * `text: 'pronto'`, `placeholder = 'nenhuma'`. O mesmo literal em `fase: 'pronto'` é código. */
const CONTEXTO_DE_TEXTO = /\b(text|title|placeholder|alt|label|rotulo|texto|textContent|aria-label)['"]?\s*[:=]\s*(\(?[^;{}]*\?\s*['"][^'"]*['"]\s*:\s*)?$/;

/* Onde o literal é nome de classe, seletor, id ou atributo técnico: nunca é texto de tela. */
const CONTEXTO_TECNICO = /(\bclass['"]?\s*[:=]\s*(?:[^;]*\+\s*)?|className\s*=\s*(?:[^;]*\+\s*)?|classList\.\w+\(\s*|querySelector(?:All)?\(\s*|closest\(\s*|matches\(\s*|getElementById\(\s*|createElement(?:NS)?\([^)]*|setAttribute\(\s*'(?:class|id|role|type|href|src|style|data-[\w-]+|aria-(?!label)[\w-]+)'\s*,\s*|criar\(\s*'[\w-]+'\s*,\s*|addEventListener\(\s*|\.type\s*===?\s*|\.tipo\s*===?\s*|fase\s*[:=]\s*)$/;

export function ehUi(valor, antes = '') {
  if (CONTEXTO_TECNICO.test(antes.slice(-120))) return false;
  if (PALAVRAS_SOLTAS.test(valor.trim())) return CONTEXTO_DE_TEXTO.test(antes.slice(-80));
  if (NAO_E_TEXTO.some((re) => re.test(valor.trim()))) return false;
  if (/Exemplo/.test(valor)) return false;   /* nomes de dados de exemplo ("Série Exemplo 1") */
  if (ehTextoPt(valor)) return true;
  const v = valor.trim();
  if (/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]{2,}( |$|[,.:;!?…—-])/.test(v)) return true;
  if (PALAVRAS_SOLTAS.test(v)) return true;
  if (FRASE_MINUSCULA.test(v) && FUNCAO.test(v) && !/[-_]/.test(v)) return true;
  if (/^[A-Z]( · [A-Z])+$/.test(v)) return true;          /* "T · E" */
  /* Frase curta: capitalizada ("O site agora") ou em minúsculas ("envio pausado"), só letras. */
  if (/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ú]*( [A-Za-zÀ-ú()0-9]+)+[.…!?]?$/.test(v)) return true;
  if (/^[a-záéíóúâêôãõç]{2,}( [a-záéíóúâêôãõç()0-9]+)+[.…!?]?$/.test(v) && !/[-_]/.test(v)) return true;
  return false;
}

function listar(pasta, saida = []) {
  for (const nome of readdirSync(pasta).sort()) {
    const cheio = path.join(pasta, nome);
    const s = statSync(cheio);
    if (s.isDirectory()) {
      if (nome === 'vendor' || nome === 'locales' || nome === 'node_modules' || nome === 'fontes') continue;
      listar(cheio, saida);
    } else if (SO_CODIGO.test(nome) || SO_HTML.test(nome)) saida.push(cheio);
  }
  return saida;
}

export function contarArquivo(arquivo, fonte) {
  const linhas = fonte.split('\n');
  const achados = [];
  if (SO_HTML.test(arquivo)) {
    /* O bloco gerado do <head> (título, descrição) sai do config e do catálogo no aplicar-config. */
    const ini = fonte.indexOf('<!-- config:inicio -->');
    const fim = fonte.indexOf('<!-- config:fim -->');
    for (const x of literaisPtHtml(fonte)) {
      const pos = linhas.slice(0, x.linha - 1).join('\n').length;
      if (ini >= 0 && fim > ini && pos >= ini && pos <= fim) continue;
      const linha = linhas[x.linha - 1] || '';
      if (/data-i18n/.test(linha) || /i18n-ignorar/.test(linha)) continue;
      achados.push({ linha: x.linha, valor: x.valor });
    }
    return achados;
  }
  for (const t of tokenizar(fonte)) {
    if (t.tipo !== 'string' && t.tipo !== 'template') continue;
    const valor = t.valor;
    if (!ehUi(valor, fonte.slice(Math.max(0, t.ini - 80), t.ini))) continue;
    if (/i18n-ignorar/.test(linhas[t.linha - 1] || '')) continue;
    achados.push({ linha: t.linha, valor });
  }
  return achados;
}

export function contarTudo(raiz = RAIZ) {
  const arquivos = [];
  for (const base of ['core/site', 'core/worker']) arquivos.push(...listar(path.join(raiz, base)));
  const porArquivo = {};
  let total = 0;
  for (const arq of arquivos) {
    const rel = path.relative(raiz, arq).split(path.sep).join('/');
    if (EXCECOES.has(rel)) continue;
    const achados = contarArquivo(rel, readFileSync(arq, 'utf8'));
    if (achados.length) { porArquivo[rel] = achados; total += achados.length; }
  }
  return { total, porArquivo };
}

export function principal(argv = process.argv.slice(2), saida = console) {
  const lim = argv.find((a) => a.startsWith('--limite='));
  const limite = lim ? Number(lim.slice(9)) : LIMITE_PADRAO;
  const { total, porArquivo } = contarTudo();
  if (argv.includes('--json')) {
    saida.log(JSON.stringify({ total, limite, porArquivo }, null, 2));
  } else {
    if (argv.includes('--lista')) {
      for (const [arq, achados] of Object.entries(porArquivo)) {
        for (const a of achados) saida.log(`${arq}:${a.linha}: ${JSON.stringify(a.valor).slice(0, 100)}`);
      }
    }
    for (const [arq, achados] of Object.entries(porArquivo)) saida.log(`${String(achados.length).padStart(4)}  ${arq}`);
    saida.log(`${total} literais em português fora de core/locales (limite documentado: ${limite}).`);
  }
  if (total > limite) {
    saida.error(`Passou do limite: ${total} > ${limite}. Mova o texto para core/locales/*.json e use tr('chave'). Veja os casos com --lista.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = principal();
}
