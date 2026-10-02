#!/usr/bin/env node
/* scripts/cores-literais.mjs — lista as cores literais (#hex, rgb(), rgba(), hsl(), hsla()
 * e nomes como "white") que sobraram fora dos arquivos de tokens.
 *
 *   node scripts/cores-literais.mjs          imprime arquivo:linha:trecho; sai com 1 se achar
 *   node scripts/cores-literais.mjs --json   o mesmo, como JSON
 *
 * A regra do M3: TODA cor do site vem de variável (var(--...)). Cor literal só pode
 * existir nos arquivos de tokens (EXCECOES). É isso que deixa trocar de tema sem
 * caçar cor espalhada, e é o que tests/tema.test.js cobra.
 *
 * O que é varrido: core/site/*.css, os .js do site (cor dentro de string, ou seja,
 * CSS embutido em JS ou fillStyle), os <style> e style="" dos .html. Comentários
 * são ignorados — explicam o porquê com o valor escrito, e isso é desejável.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Exceções documentadas: caminho relativo -> motivo. */
export const EXCECOES = new Map([
  ['core/site/theme.css', 'GERADO do config: é onde a paleta do tema se materializa'],
  ['core/site/tokens-fixos.css', 'tokens que não mudam com o tema (preto do player, véus, sombras)'],
  ['core/site/vendor', 'código de terceiros, não editado']
]);
/* Imagens vetoriais de marca (logo, ícone, og-image): são ARQUIVOS DE MARCA, gerados por
 * scripts/gerar-marca-neutra.mjs ou fornecidos pelo cliente em marca.arquivos; não são
 * folha de estilo e não acompanham o tema. Não são varridas por serem .svg. */

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const FUNCOES = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;
const NOMES = /(?<![\w-])(?:white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|silver|navy|teal|lime|maroon|aqua|fuchsia|olive|gold|brown|cyan|magenta)(?![\w-])/gi;
const PROPRIEDADE_DE_COR = /(?:^|[;{\s])(?:color|background(?:-color)?|border(?:-[a-z]+)?(?:-color)?|outline(?:-color)?|fill|stroke|accent-color|caret-color|text-decoration-color|box-shadow|text-shadow)\s*:\s*([^;}]*)/gi;

/* Troca o conteúdo de comentários por espaços, mantendo as quebras de linha (a linha
 * reportada continua certa). Para CSS e HTML: só /* *\/ e <!-- -->. Para JS:
 * respeita aspas, crases e regex simples, para um `//` dentro de URL não virar comentário. */
export function semComentariosCss(texto) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

export function semComentariosJs(js) {
  let saida = '';
  let modo = 'codigo';
  let aspas = '';
  for (let i = 0; i < js.length; i++) {
    const c = js[i], d = js[i + 1];
    if (modo === 'codigo') {
      if (c === '/' && d === '*') { modo = 'bloco'; saida += '  '; i++; }
      else if (c === '/' && d === '/') { modo = 'linha'; saida += '  '; i++; }
      else { if (c === '"' || c === "'" || c === '`') { modo = 'texto'; aspas = c; } saida += c; }
    } else if (modo === 'bloco') {
      if (c === '*' && d === '/') { modo = 'codigo'; saida += '  '; i++; } else saida += c === '\n' ? '\n' : ' ';
    } else if (modo === 'linha') {
      if (c === '\n') { modo = 'codigo'; saida += c; } else saida += ' ';
    } else {
      saida += c;
      if (c === '\\') { saida += d ?? ''; i++; } else if (c === aspas) modo = 'codigo';
    }
  }
  return saida;
}

function achados(texto, ehCss) {
  const saida = [];
  const linhas = texto.split('\n');
  linhas.forEach((linha, i) => {
    const vistos = [];
    for (const m of linha.matchAll(HEX)) vistos.push(m[0]);
    for (const m of linha.matchAll(FUNCOES)) vistos.push(m[0] + '…');
    if (ehCss) {
      for (const p of linha.matchAll(PROPRIEDADE_DE_COR)) {
        for (const n of p[1].matchAll(NOMES)) vistos.push(n[0]);
      }
    }
    if (vistos.length) saida.push({ linha: i + 1, trecho: linha.trim().slice(0, 140), cores: vistos });
  });
  return saida;
}

async function arquivosDoSite(raiz) {
  const dir = path.join(raiz, 'core', 'site');
  const nomes = await readdir(dir);
  return nomes.filter((n) => /\.(css|js|html)$/.test(n)).sort();
}

/* Devolve [{ arquivo, linha, trecho, cores }]. Lista vazia = limpo. */
export async function listarCoresLiterais({ raiz = RAIZ } = {}) {
  const todos = [];
  for (const nome of await arquivosDoSite(raiz)) {
    const rel = `core/site/${nome}`;
    if (EXCECOES.has(rel)) continue;
    const texto = (await readFile(path.join(raiz, rel), 'utf8')).split('\r\n').join('\n');
    let achadosDoArquivo;
    if (nome.endsWith('.css')) achadosDoArquivo = achados(semComentariosCss(texto), true);
    else if (nome.endsWith('.js')) achadosDoArquivo = achados(semComentariosJs(texto), false);
    else {
      /* HTML: só o que é estilo. As metas theme-color são geradas do tema. */
      const blocos = [...texto.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
      const inline = [...texto.matchAll(/\sstyle="([^"]*)"/gi)].map((m) => m[1]);
      achadosDoArquivo = achados(semComentariosCss([...blocos, ...inline].join('\n')), true);
    }
    for (const a of achadosDoArquivo) todos.push({ arquivo: rel, ...a });
  }
  return todos;
}

export async function principal(argv = process.argv.slice(2), saida = console) {
  const lista = await listarCoresLiterais();
  if (argv.includes('--json')) saida.log(JSON.stringify(lista, null, 2));
  else if (lista.length) {
    saida.error('Cores literais fora dos arquivos de tokens (use var(--...) e defina a cor no tema):\n');
    for (const a of lista) saida.error(`  ${a.arquivo}:${a.linha}: ${a.cores.join(', ')}   ${a.trecho}`);
    saida.error(`\n${lista.length} ocorrência(s). Exceções documentadas: ${[...EXCECOES.keys()].join(', ')}.`);
  } else saida.log('Nenhuma cor literal fora dos arquivos de tokens.');
  return lista.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().then((c) => { process.exitCode = c; });
}
