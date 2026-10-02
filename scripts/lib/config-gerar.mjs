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
import { paraRgb } from '../../core/worker/_lib/contraste.mjs';
import { resolverTema, fundoDaChegada, pilhaDeFontes, fontesDeArquivo } from '../../core/worker/_lib/tema.mjs';
import { textoDeFabrica } from '../../core/worker/_lib/i18n-catalogos.mjs';

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
  /* Sem seo.titulo escrito, o título-base é o texto de fábrica do idioma padrão
   * ("{marca} — catálogo", "{marca} — catalog"...): a página acompanha o idioma. */
  return interpolar(config.seo.titulo, config).trim() ||
    textoDeFabrica('site.tituloBase', config.idiomas.padrao, { marca: config.marca.nome });
}

/* chave do schema -> variável CSS. Os nomes das variáveis são os que o style.css
 * e o mesa.css já usam: renomear aqui é renomear em todo o CSS. */
const TOKENS_DE_COR = [
  ['marca', '--marca'], ['marcaClara', '--marca-clara'], ['marcaFraca', '--marca-fraca'],
  ['marca2', '--marca-alt'], ['marca3', '--marca-destaque'],
  ['textoSobreMarca', '--texto-sobre-marca'], ['textoSobreDestaque', '--texto-sobre-destaque'],
  ['fundo', '--fundo'], ['superficie', '--superficie'],
  ['texto', '--texto'], ['textoFraco', '--texto-fraco'],
  ['borda', '--borda'], ['contorno', '--contorno'],
  ['alerta', '--alerta'], ['alertaFundo', '--alerta-fundo'],
  ['erro', '--erro'], ['erroFundo', '--erro-fundo'],
  ['mesaFundo', '--mesa-fundo'], ['mesaPainel', '--painel'], ['mesaPainelAlto', '--painel-alto']
];

/* Cores com transparência que dependem do tema (esmaecer o fundo na ponta das setas
 * das prateleiras, o brilho do rascunho na mesa): calculadas aqui para o CSS não
 * precisar de `rgba(...)` solto nem de color-mix(). [variável, chave, alfa] */
const TOKENS_DE_ALFA = [
  ['--fundo-96', 'fundo', 0.96], ['--fundo-72', 'fundo', 0.72], ['--marca-destaque-08', 'marca3', 0.08]
];

const ESPACOS = [1, 2, 3, 4, 6, 8, 12, 16];   /* --esp-1..8, em múltiplos da unidade */

function rgbComAlfa(hex, alfa) {
  const [r, g, b] = paraRgb(hex);
  return `rgb(${r} ${g} ${b} / ${alfa})`;
}

function linhasDeCor(paleta, recuo) {
  const linhas = TOKENS_DE_COR.map(([k, v]) => `${recuo}${v}: ${paleta[k]};`);
  for (const [v, k, alfa] of TOKENS_DE_ALFA) linhas.push(`${recuo}${v}: ${rgbComAlfa(paleta[k], alfa)};`);
  return linhas;
}

/* Arquivos de fonte que o tema pede: [{ slot, familia, arquivo, peso }]. */
export function planejarFontes(config) {
  return fontesDeArquivo(resolverTema(config));
}

export const PASTA_FONTES_SITE = 'fontes';   /* dentro de core/site/ */

/* theme.css = TODA a parte do visual que o config controla: paleta (um bloco por
 * modo), formas, escala de tipo, pilhas de fonte e @font-face. É o único arquivo
 * (junto de tokens-fixos.css) onde cor literal pode existir; o resto do CSS só usa
 * var(--...). Determinístico: mesma config, mesmo texto, para o `--verificar`. */
export function gerarThemeCss(config) {
  const tema = resolverTema(config);
  const { forma, tipografia: tip, cores } = tema;
  const out = [
    '/* GERADO por scripts/aplicar-config.mjs a partir de config/site.json. Não edite à mão:',
    ` * tema "${tema.preset}", modo "${tema.modo}". Para mudar, troque tema.* no config e rode`,
    ' * `node scripts/aplicar-config.mjs`. Carrega depois do style.css. */'
  ];

  for (const f of fontesDeArquivo(tema)) {
    out.push('@font-face {',
      `  font-family: "${f.familia}";`,
      `  src: url("${PASTA_FONTES_SITE}/${f.arquivo}") format("woff2");`,
      `  font-weight: ${f.peso};`,
      '  font-style: normal;',
      '  font-display: swap;',
      '}');
  }

  const corpo = pilhaDeFontes(tip.corpo, tip.reserva);
  const titulo = tip.titulo ? pilhaDeFontes(tip.titulo, tip.reservaTitulo || tip.reserva) : (tip.reservaTitulo || 'var(--fonte-corpo)');
  const mono = pilhaDeFontes(tip.mono, tip.reservaMono);
  const geometria = [
    `  --raio: ${forma.raioPx}px;`,
    `  --sombra: ${forma.sombra};`,
    `  --largura: ${forma.larguraMaximaPx}px;`,
    ...ESPACOS.map((m, i) => `  --esp-${i + 1}: ${m * forma.espacoBasePx}px;`),
    ...Object.entries(tip.escala).map(([k, v]) => `  --tipo-${k}: ${v}px;`),
    `  --fonte-corpo: ${corpo};`,
    `  --fonte-titulo: ${titulo};`,
    `  --fonte-mono: ${mono};`,
    `  --curva: ${tema.movimento.curva};`
  ];

  /* O :root pinta o modo escolhido; em "auto" pinta o escuro e o claro entra por
   * prefers-color-scheme (ou à força, com data-tema="claro" no <html>, que é o gancho
   * do botão de tema do futuro editor). O escuro volta à força com data-tema="escuro". */
  const principal = tema.modo === 'claro' ? 'claro' : 'escuro';
  /* Qual dos dois logos aparece: o de fundo escuro tem o texto claro e some sobre
   * fundo claro, e vice-versa. O HTML traz os dois; o tema escolhe pelo display. */
  const logos = (modo, ind) => [
    `${ind}--logo-fundo-escuro: ${modo === 'escuro' ? 'inline-block' : 'none'};`,
    `${ind}--logo-fundo-claro: ${modo === 'claro' ? 'inline-block' : 'none'};`
  ];
  out.push(':root {', `  color-scheme: ${principal === 'claro' ? 'light' : 'dark'};`, ...linhasDeCor(cores[principal], '  '), ...logos(principal, '  '), ...geometria, '}');
  if (tema.modo === 'auto') {
    out.push(
      '@media (prefers-color-scheme: light) {',
      '  :root:not([data-tema="escuro"]) {', '    color-scheme: light;', ...linhasDeCor(cores.claro, '    '), ...logos('claro', '    '), '  }',
      '}',
      ':root[data-tema="claro"] {', '  color-scheme: light;', ...linhasDeCor(cores.claro, '  '), ...logos('claro', '  '), '}'
    );
  }
  out.push('');
  return out.join('\n');
}

export function gerarManifest(config) {
  const m = config.marca;
  const a = m.arquivos;
  const fundo = fundoDaChegada(resolverTema(config));
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

/* O service worker (core/site/sw.js). MÍNIMO E OPCIONAL: só guarda a CASCA do site (a página inicial, os
 * estilos, os scripts, as fontes, os textos por idioma, o manifest e os ícones) para o site abrir com a rede
 * ruim ou fora do ar. Ele NUNCA toca em:
 *   - /api/* (catálogo, conta, minha lista, mídia assinada: dado de quem está logado);
 *   - /admin, entrar, cadastro e conta;
 *   - mídia (vídeo, áudio, capas): vem de outro endereço (o do provedor) e, quando vem do próprio, é pedido
 *     com Range, que ele ignora;
 *   - qualquer pedido que não seja GET, ou que leve Authorization.
 * Fora dessa lista o navegador faz o de sempre, como se o service worker não existisse.
 *
 * `recursos.pwaCacheDoShell` desligado (o padrão) gera o sw.js "de desligar": quem já o tinha instalado o vê
 * apagar os próprios caches e se desinstalar na visita seguinte. Por isso o arquivo existe nos dois casos. */
export function gerarServiceWorker(config) {
  const prefixo = String((config.marca && config.marca.prefixoDeArmazenamento) || 'tm').replace(/[^A-Za-z0-9_-]/g, '') || 'tm';
  const ligado = config.recursos && config.recursos.pwaCacheDoShell === true;
  const cabeca = [
    '/* sw.js — GERADO por scripts/aplicar-config.mjs a partir de config/site.json (recursos.pwaCacheDoShell).',
    ' * Não edite à mão. Leia docs/home-e-colecoes.md antes de ligar. */',
    "'use strict';",
    `var PREFIXO_DO_CACHE = '${prefixo}-casca-';`
  ];
  if (!ligado) {
    return cabeca.concat([
      '/* Desligado: apaga o que este service worker guardou e se desinstala. */',
      "self.addEventListener('install', function () { self.skipWaiting(); });",
      "self.addEventListener('activate', function (e) {",
      '  e.waitUntil(caches.keys().then(function (nomes) {',
      '    return Promise.all(nomes.filter(function (n) { return n.indexOf(PREFIXO_DO_CACHE) === 0; }).map(function (n) { return caches.delete(n); }));',
      '  }).then(function () { return self.registration.unregister(); }));',
      '});',
      ''
    ]).join('\n');
  }
  return cabeca.concat([
    "var CACHE = PREFIXO_DO_CACHE + 'v1';",
    '/* Nunca guardar: a API, a mesa (admin e mesa*.js) e as páginas da conta. */',
    'var PROIBIDO = /^\\/(api|admin|mcp)(\\/|\\.|$)|^\\/(entrar|cadastro|conta)(\\.html)?$|^\\/mesa[^/]*$/;',
    '/* O que é "casca": arquivos do próprio site, por tipo e por nome. */',
    'var ARQUIVO_DA_CASCA = /^\\/(locales\\/[A-Za-z-]+\\.json|config\\.public\\.json|manifest\\.webmanifest|(icone|favicon|logo|og-image)[A-Za-z0-9._-]*\\.(png|svg|ico|webp))$/;',
    '',
    'function daCasca(req, url) {',
    "  if (req.method !== 'GET' || url.origin !== self.location.origin) return false;",
    "  if (req.headers.has('range') || req.headers.has('authorization')) return false;",
    '  if (PROIBIDO.test(url.pathname)) return false;',
    "  if (req.mode === 'navigate') return url.pathname === '/' || url.pathname === '/index.html';",
    "  var d = req.destination;",
    "  return d === 'style' || d === 'script' || d === 'font' || ARQUIVO_DA_CASCA.test(url.pathname);",
    '}',
    '',
    '/* Resposta que pode ir para o cache: inteira, do próprio site, e que ninguém pediu para não guardar. */',
    'function guardavel(resp) {',
    "  if (!resp || resp.status !== 200 || resp.type !== 'basic') return false;",
    "  var cc = resp.headers.get('cache-control') || '';",
    "  return !/no-store|private/i.test(cc) && !resp.headers.has('set-cookie');",
    '}',
    '',
    "self.addEventListener('install', function () { self.skipWaiting(); });",
    "self.addEventListener('activate', function (e) {",
    '  e.waitUntil(caches.keys().then(function (nomes) {',
    '    return Promise.all(nomes.filter(function (n) { return n.indexOf(PREFIXO_DO_CACHE) === 0 && n !== CACHE; }).map(function (n) { return caches.delete(n); }));',
    '  }).then(function () { return self.clients.claim(); }));',
    '});',
    '',
    "self.addEventListener('fetch', function (ev) {",
    '  var req = ev.request;',
    '  var url = new URL(req.url);',
    '  if (!daCasca(req, url)) return;   /* o navegador faz o de sempre */',
    "  if (req.mode === 'navigate') {",
    '    /* A página: a rede primeiro; sem rede, a última que deu certo. */',
    '    ev.respondWith(fetch(req).then(function (resp) {',
    '      if (guardavel(resp)) { var c = resp.clone(); caches.open(CACHE).then(function (k) { k.put(req, c); }); }',
    '      return resp;',
    '    }).catch(function () { return caches.match(req).then(function (r) { return r || Response.error(); }); }));',
    '    return;',
    '  }',
    '  /* Estilo, script, fonte, textos: o guardado já, e o novo para a próxima vez. */',
    '  ev.respondWith(caches.open(CACHE).then(function (k) {',
    '    return k.match(req).then(function (guardado) {',
    '      var rede = fetch(req).then(function (resp) { if (guardavel(resp)) k.put(req, resp.clone()); return resp; });',
    '      rede.catch(function () { /* sem rede: vale o guardado */ });',
    '      return guardado || rede;',
    '    });',
    '  }));',
    '});',
    ''
  ]).join('\n');
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
  const m = config.marca;
  const pub = {
    versaoDoEsquema: config.versaoDoEsquema,
    marca: {
      nome: m.nome, nomeCurto: m.nomeCurto, slogan: m.slogan, descricao: m.descricao,
      organizacao: m.organizacao, dominio: m.dominio, contato: m.contato,
      prefixoDeArmazenamento: m.prefixoDeArmazenamento
    },
    tituloBase: tituloBase(config),
    tema: { preset: resolverTema(config).preset, modo: resolverTema(config).modo },
    idiomas: {
      padrao: idioma, disponiveis: config.idiomas.disponiveis,
      detectarDoNavegador: config.idiomas.detectarDoNavegador, seletorVisivel: config.idiomas.seletorVisivel
    },
    /* Os textos do cliente (config.textos) não vão aqui: entram, já mesclados, em
     * locales/<idioma>.json (scripts/lib/i18n-gerar.mjs). */
    acesso: { modo: config.acesso.modo },
    recursos: {
      busca: config.recursos.busca,
      continuarAssistindo: config.recursos.continuarAssistindo,
      pwaInstalavel: config.recursos.pwaInstalavel,
      pwaCacheDoShell: config.recursos.pwaCacheDoShell === true,
      minhaLista: config.recursos.minhaLista !== false
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

/* A cor da barra do navegador. Em "auto" são duas metas com media, para o
 * celular em tema claro não ganhar uma barra escura (e vice-versa). */
function metasThemeColor(tema) {
  if (tema.modo !== 'auto') return [`<meta name="theme-color" content="${fundoDaChegada(tema)}">`];
  return [
    `<meta name="theme-color" content="${tema.cores.escuro.fundo}" media="(prefers-color-scheme: dark)">`,
    `<meta name="theme-color" content="${tema.cores.claro.fundo}" media="(prefers-color-scheme: light)">`
  ];
}

/* O bloco entre os marcadores do <head>. `pagina` = 'index' | 'admin'.
 * A mesa (/admin) nunca é indexável e não carrega o og:*; o og:image fica
 * como caminho relativo porque o Worker o torna absoluto na entrega. */
export function gerarBlocoHead(config, pagina) {
  const robots = pagina === 'index' && indexavel(config) ? 'index, follow' : 'noindex, nofollow, noarchive';
  const tema = resolverTema(config);
  if (pagina === 'admin') {
    return [
      `<meta name="robots" content="${robots}">`,
      `<title>${esc(textoDeFabrica('mesa.tituloDaMesa', config.idiomas.padrao))} — ${esc(config.marca.nome)}</title>`
    ].join('\n');
  }
  const titulo = esc(tituloBase(config));
  const desc = esc(interpolar(config.seo.descricao, config).trim());
  return [
    `<meta name="robots" content="${robots}">`,
    `<title>${titulo}</title>`,
    `<meta name="description" content="${desc}">`,
    ...metasThemeColor(tema),
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
