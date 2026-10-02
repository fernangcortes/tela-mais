#!/usr/bin/env node
// Varredura anti-marca: garante que nada do cliente original (nomes, domínios,
// IDs de recurso, cores, prefixo técnico) volte para o repositório.
// Node puro, sem dependências. Uso: node scripts/anti-marca.mjs
// Saída: arquivo:linha:trecho, e código de saída 1 se achar algo.
//
// Os padrões são montados a partir de fragmentos (j) para que este arquivo
// não se auto-detecte.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const j = (...p) => p.join('');

// [rótulo, regex]. Sem a flag "g": cada linha é testada uma vez por padrão.
const PADROES = [
  ['nome do estado/cliente', new RegExp(j('go', 'i[aá]s'), 'i')],
  ['nome do cliente (junto)', new RegExp(j('go', 'iast', 'ec'), 'i')],
  ['domínio do cliente', new RegExp(j('go', 'ias-t', 'ec-m', 'ais'), 'i')],
  ['sigla do cliente', new RegExp(j('g', 'tm', 'ais'), 'i')],
  ['sigla com mais', new RegExp(j('\\bG', 'T\\+'), 'i')],
  ['produtora anterior', new RegExp(j('cri', 'alab'), 'i')],
  ['universidade (palavra)', new RegExp(j('\\bU', 'EG\\b'), 'i')],
  ['secretaria', new RegExp(j('\\bse', 'duc\\b'), 'i')],
  ['rede pública local', new RegExp(j('rede ', 'estad', 'ual'), 'i')],
  // prefixo técnico antigo, como identificador (com _ - : ou como palavra solta)
  ['prefixo técnico antigo', new RegExp(j('(?:^|[^A-Za-z0-9])', 'g', 'tm', '(?:[-_:]|[PBI]?\\b)'), 'i')],
  // IDs reais de recurso (biblioteca de vídeo, pull zone, conta)
  ['ID de biblioteca', new RegExp(j('73', '3032'))],
  ['ID de pull zone', new RegExp(j('b620', '46eb'), 'i')],
  ['pull zone real', new RegExp(j('vz-', 'b620'), 'i')],
  ['pessoa/lugar do acervo', new RegExp(j('\\b(?:Lu', 'cas|Iv', 'air|Kal', 'unga|Piren', 'ópolis|Piren', 'opolis)\\b'))],
  ['cor da marca antiga', new RegExp(j('#30', '9c47|#ff', 'ca05'), 'i')],
  // GUID de vídeo no formato real (8-4-4-4-12 hexadecimais). Fixtures usam GUIDs
  // evidentemente fictícios (um só dígito repetido por grupo, ex.: aaaaaaaa-bbbb-...).
  ['GUID real de vídeo', /\b(?!(.)\1{7}-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['hash/carimbo de capa real', new RegExp(j('db94', 'da65|1788', '898362784'), 'i')],
  ['caminho local do autor', new RegExp(j('F', ':\\\\', '|~/\\.g', 'tm'))],
];

// Exceções explícitas: caminho (relativo, com /) -> motivo. O arquivo inteiro é ignorado.
const EXCECOES_ARQUIVO = new Map([
  // Código de terceiros (Apache-2.0), não editado. Uma sequência de três letras
  // maiúsculas do H.264 (Exp-Golomb) coincide com uma sigla vigiada.
  ['core/site/vendor/hls.light.min.js', 'terceiro minificado; coincidência de letras (Exp-Golomb)'],
  // Texto-base oficial da BSL e traduções: nenhum termo do cliente, mas
  // mantemos a lista curta e explícita caso precise crescer.
]);

// Extensões binárias que não são varridas.
const BINARIAS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.pdf', '.zip', '.gz']);

function listarArquivos() {
  const saida = execFileSync('git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(saida.split('\0').filter(Boolean))].sort();
}

const achados = [];
let varridos = 0;
for (const rel of listarArquivos()) {
  if (EXCECOES_ARQUIVO.has(rel)) continue;
  if (BINARIAS.has(extname(rel).toLowerCase())) {
    // O próprio nome do arquivo também conta.
    for (const [rotulo, re] of PADROES) if (re.test(rel)) achados.push(`${rel}:0:[${rotulo}] nome do arquivo`);
    continue;
  }
  let texto;
  try {
    if (!statSync(resolve(RAIZ, rel)).isFile()) continue;
    texto = readFileSync(resolve(RAIZ, rel), 'utf8');
  } catch { continue; } // removido da árvore de trabalho ou ilegível
  varridos++;
  for (const [rotulo, re] of PADROES) if (re.test(rel)) achados.push(`${rel}:0:[${rotulo}] nome do arquivo`);
  const linhas = texto.split(/\r?\n/);
  linhas.forEach((linha, i) => {
    for (const [rotulo, re] of PADROES) {
      const m = re.exec(linha);
      if (m) {
        const ini = Math.max(0, m.index - 20);
        achados.push(`${rel}:${i + 1}:[${rotulo}] ${linha.slice(ini, m.index + m[0].length + 20).trim()}`);
      }
    }
  });
}

if (achados.length) {
  console.log(achados.join('\n'));
  console.error(`\nanti-marca: ${achados.length} ocorrência(s) em ${varridos} arquivo(s).`);
  process.exit(1);
}
console.log(`anti-marca: ok (${varridos} arquivos varridos, nenhuma ocorrência).`);
