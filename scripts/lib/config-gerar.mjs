/* scripts/lib/config-gerar.mjs — transforma o config validado nos arquivos do site.
 *
 * Funções puras (config -> texto). Quem escreve em disco é aplicar-config.mjs.
 * M2 gera só o essencial: cores básicas, manifest, metas/título, robots e
 * config.public.json. Tema completo, fontes e i18n são do M3.
 *
 * Tudo que vira HTML passa por `esc`: o nome da marca vem de um arquivo que o
 * cliente edita, e `"` ou `<` ali não podem quebrar a página.
 */
import { ehReferenciaEnv } from '../../core/worker/_lib/config-validar.mjs';

export const MARCADOR_INICIO = '<!-- config:inicio -->';
export const MARCADOR_FIM = '<!-- config:fim -->';

export function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Troca {{marca.nome}} pelo valor; caminho inexistente vira texto vazio. */
export function interpolar(modelo, config) {
  return String(modelo).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, caminho) => {
    let v = config;
    for (const parte of caminho.split('.')) v = v == null ? undefined : v[parte];
    return v == null || typeof v === 'object' ? '' : String(v);
  });
}

/* Buscadores só entram se a pessoa pediu E o catálogo é público. */
export function indexavel(config) {
  return config.acesso.modo === 'publico' && config.seo.indexavel === true;
}

export function tituloBase(config) {
  return interpolar(config.seo.titulo, config).trim() || config.marca.nome;
}

const TOKENS_CSS = [
  ['marca', '--marca'], ['marcaClara', '--marca-clara'], ['marcaFraca', '--marca-fraca'],
  ['marca2', '--marca-alt'], ['marca3', '--marca-destaque'],
  ['fundo', '--fundo'], ['superficie', '--superficie'],
  ['borda', '--borda'], ['contorno', '--contorno'],
  ['texto', '--texto'], ['textoFraco', '--texto-fraco'],
  ['alerta', '--alerta'], ['alertaFundo', '--alerta-fundo'],
  ['erro', '--erro'], ['erroFundo', '--erro-fundo']
];

export function gerarThemeCss(config) {
  const c = config.tema.cores.escuro;
  const linhas = TOKENS_CSS.filter(([k]) => c[k]).map(([k, v]) => `  ${v}: ${c[k].toLowerCase()};`);
  return [
    '/* GERADO por scripts/aplicar-config.mjs a partir de config/site.json. Não edite à mão:',
    ' * mude as cores em tema.cores.escuro e rode `node scripts/aplicar-config.mjs`.',
    ' * Carrega depois do style.css e só troca os valores das variáveis. */',
    ':root {',
    ...linhas,
    '}',
    ''
  ].join('\n');
}

export function gerarManifest(config) {
  const m = config.marca;
  const a = m.arquivos;
  const fundo = config.tema.cores.escuro.fundo.toLowerCase();
  const icones = [
    { src: '/' + a.icone192, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/' + a.icone512, sizes: '512x512', type: 'image/png', purpose: 'any' }
  ];
  if (a.iconeAdaptavel) {
    icones.push({ ...icones[0], purpose: 'maskable' }, { ...icones[1], purpose: 'maskable' });
  }
  return JSON.stringify({
    id: '/',
    name: m.nome,
    short_name: m.nomeCurto || m.nome.slice(0, 12),
    description: m.descricao,
    lang: config.idiomas.padrao,
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: fundo,
    theme_color: fundo,
    icons: icones
  }, null, 2) + '\n';
}

export function gerarRobots(config) {
  if (!indexavel(config)) return 'User-agent: *\nDisallow: /\n';
  return 'User-agent: *\nDisallow: /admin\nDisallow: /api/\n';
}

/* O que o navegador pode ver. Lista branca: seção nova no schema NÃO vira
 * pública sem alguém decidir. Por fim, uma varredura garante que nenhuma
 * referência {"$env"} escapou. */
export function gerarPublico(config) {
  const idioma = config.idiomas.padrao;
  const textos = JSON.parse(JSON.stringify(config.textos || {}));
  textos[idioma] = { rodape: config.marca.nome + '.', ...(textos[idioma] || {}) };
  const m = config.marca;
  const pub = {
    versaoDoEsquema: config.versaoDoEsquema,
    marca: {
      nome: m.nome, nomeCurto: m.nomeCurto, slogan: m.slogan, descricao: m.descricao,
      organizacao: m.organizacao, dominio: m.dominio, contato: m.contato,
      prefixoDeArmazenamento: m.prefixoDeArmazenamento
    },
    tituloBase: tituloBase(config),
    tema: { modo: config.tema.modo },
    idiomas: {
      padrao: idioma, disponiveis: config.idiomas.disponiveis,
      detectarDoNavegador: config.idiomas.detectarDoNavegador, seletorVisivel: config.idiomas.seletorVisivel
    },
    textos,
    acesso: { modo: config.acesso.modo },
    recursos: {
      busca: config.recursos.busca,
      continuarAssistindo: config.recursos.continuarAssistindo,
      pwaInstalavel: config.recursos.pwaInstalavel
    },
    seo: { indexavel: indexavel(config) }
  };
  const limpo = JSON.parse(JSON.stringify(pub));   /* tira os undefined */
  if (contemEnv(limpo)) throw new Error('config.public.json teria uma referência $env; isto é um bug do gerador.');
  return JSON.stringify(limpo, null, 2) + '\n';
}

function contemEnv(v) {
  if (ehReferenciaEnv(v)) return true;
  if (Array.isArray(v)) return v.some(contemEnv);
  if (v && typeof v === 'object') return Object.values(v).some(contemEnv);
  return false;
}

/* O bloco entre os marcadores do <head>. `pagina` = 'index' | 'admin'.
 * A mesa (/admin) nunca é indexável e não carrega o og:*; o og:image fica
 * como caminho relativo porque o Worker o torna absoluto na entrega. */
export function gerarBlocoHead(config, pagina) {
  const robots = pagina === 'index' && indexavel(config) ? 'index, follow' : 'noindex, nofollow, noarchive';
  const fundo = config.tema.cores.escuro.fundo.toLowerCase();
  if (pagina === 'admin') {
    return [
      `<meta name="robots" content="${robots}">`,
      `<title>Mesa de Curadoria — ${esc(config.marca.nome)}</title>`
    ].join('\n');
  }
  const titulo = esc(tituloBase(config));
  const desc = esc(interpolar(config.seo.descricao, config).trim());
  return [
    `<meta name="robots" content="${robots}">`,
    `<title>${titulo}</title>`,
    `<meta name="description" content="${desc}">`,
    `<meta name="theme-color" content="${fundo}">`,
    `<meta property="og:title" content="${titulo}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:image" content="${esc(config.marca.arquivos.imagemDeCompartilhamento)}">`,
    `<meta property="og:type" content="website">`
  ].join('\n');
}

/* Troca o miolo entre os marcadores. Devolve null se os marcadores faltarem. */
export function trocarBloco(html, bloco) {
  const i = html.indexOf(MARCADOR_INICIO);
  const f = html.indexOf(MARCADOR_FIM);
  if (i < 0 || f < i) return null;
  return html.slice(0, i + MARCADOR_INICIO.length) + '\n' + bloco + '\n' + html.slice(f);
}
