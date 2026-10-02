/* scripts/gerar-headers.mjs — regenera core/site/_headers a partir de
 * core/worker/_lib/seguranca.js.
 *
 *   node scripts/gerar-headers.mjs            grava o arquivo
 *   node scripts/gerar-headers.mjs --verificar  só confere (sai 1 se estiver diferente)
 *
 * O `_headers` vale para o que o Cloudflare serve SEM passar pelo Worker (JS,
 * CSS, imagens). Ele leva a política de segurança NEUTRA: sem host de provedor
 * de vídeo, que só o adaptador sabe e que muda com `video.provedor`. As páginas
 * que carregam mídia (`/`, `/index.html`, `/admin`) passam sempre pelo Worker
 * (`run_worker_first` no wrangler.jsonc) e levam a política completa. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* O Node avisa (MODULE_TYPELESS_PACKAGE_JSON) ao carregar um .js sem "type" no package.json. Para um leigo parece erro,
 * e pôr "type: module" mexeria no site. Só esse aviso é calado, durante o import. */
const emitirOriginal = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const codigo = typeof resto[0] === 'object' && resto[0] ? resto[0].code : resto[1];
  if (codigo === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  return emitirOriginal.call(process, aviso, ...resto);
};
const { cabecalhosDeSeguranca } = await import('../core/worker/_lib/seguranca.js');
process.emitWarning = emitirOriginal;

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = path.join(RAIZ, 'core', 'site', '_headers');

export function conteudoDoHeaders() {
  const linhas = Object.entries(cabecalhosDeSeguranca({}, { api: false, semProvedor: true })).map(([k, v]) => '  ' + k + ': ' + v);
  return [
    '# Cabeçalhos de segurança dos arquivos estáticos (Static Assets).',
    '# GERADO por scripts/gerar-headers.mjs a partir de core/worker/_lib/seguranca.js (política neutra,',
    '# sem host de provedor de vídeo: as páginas que carregam mídia passam pelo Worker).',
    '# tests/worker-seguranca.test.js confere que este arquivo é essa política.',
    '/*',
    ...linhas,
    ''
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const esperado = conteudoDoHeaders();
  if (process.argv.includes('--verificar')) {
    const atual = await readFile(ARQUIVO, 'utf8').catch(() => '');
    if (atual !== esperado) { console.error('core/site/_headers está diferente de seguranca.js: rode node scripts/gerar-headers.mjs'); process.exit(1); }
    console.log('core/site/_headers confere.');
  } else {
    await writeFile(ARQUIVO, esperado);
    console.log('gravado: core/site/_headers');
  }
}
