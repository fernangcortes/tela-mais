/* functions/index.js — a página inicial (`/`), e só ela.
 *
 * O LCP DA CHEGADA. O elemento é a capa do
 * destaque, e ela só era descoberta depois de o app.js baixar, rodar e ler o
 * catálogo. Esta função serve o MESMO index.html estático, com uma linha a
 * mais antes da folha de estilo:
 *
 *     <link rel="preload" as="image" href="<a capa do destaque>" fetchpriority="high">
 *
 * e o navegador começa a baixar a capa junto com o HTML. No Lighthouse,
 * servidor local com gzip, mediana de 5: −300 ms além dos −450 de tirar o
 * player do caminho. A capa pedida pela PÁGINA, sem o HTML, não valeu nada
 * (−40): o que conta é ela ser descoberta no HTML.
 *
 * A URL vem da chave `capa-destaque` do KV, uma string curta que o
 * `GET /api/catalogo` mantém (ver lá). Esta função NÃO lê o catálogo: um corte
 * por CPU aqui derrubaria o site, e não só uma imagem.
 *
 * A mesma passagem põe no HTML o endereço do site (og:url, og:image
 * absoluta) e a pré-conexão com a pull zone, lidos de APP_SITE_URL e
 * BUNNY_PULLZONE — nada disso fica escrito no arquivo estático.
 *
 * TUDO que dá errado devolve a página exatamente como antes: a chave que
 * falta, a que não parece uma capa da pull zone, o KV que falha, a página que
 * não veio com 200, a marca que sumiu do HTML. O pior caso desta função é não
 * ajudar.
 */
import { CHAVE_CAPA_DESTAQUE } from './api/catalogo.js';

/* Onde a linha entra. Há teste cobrando que o index.html a tenha, uma vez. */
export const MARCA = '<link rel="stylesheet" href="style.css">';

/* Uma capa da pull zone do Bunny, e nada mais: o que vai para dentro do HTML
 * não pode fechar aspas nem abrir marcação, venha de onde vier. */
const CAPA = /^https:\/\/[a-z0-9.-]+\.b-cdn\.net\/[A-Za-z0-9._\/-]+(\?v=[A-Za-z0-9._%-]+)?$/;

export function capaValida(url) {
  return typeof url === 'string' && url.length < 500 && CAPA.test(url);
}

/* O domínio público do site e o host da pull zone vêm do ambiente
 * (APP_SITE_URL e BUNNY_PULLZONE) e entram no HTML nesta função: o arquivo
 * estático não carrega endereço nenhum, para o mesmo código servir a
 * qualquer instalação. Valores que não pareçam endereço são ignorados. */
const SITE_URL = /^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?\/?$/i;
const HOST_PULLZONE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export function siteUrlValida(valor) {
  return typeof valor === 'string' && valor.length < 200 && SITE_URL.test(valor);
}

export function hostValido(valor) {
  return typeof valor === 'string' && valor.length < 200 && HOST_PULLZONE.test(valor);
}

const OG_IMAGE_RELATIVA = '<meta property="og:image" content="og-image.png">';

/* Troca a imagem de compartilhamento relativa por uma absoluta, acrescenta
 * og:url e, havendo pull zone, a pré-conexão com ela. Devolve null se o
 * HTML não tiver a marca. */
export function comEndereco(html, siteUrl, pullzone) {
  if (html.indexOf(OG_IMAGE_RELATIVA) < 0) return null;
  const base = siteUrl ? siteUrl.replace(/\/+$/, '') : null;
  let saida = html;
  if (base) {
    saida = saida.replace(OG_IMAGE_RELATIVA,
      '<meta property="og:image" content="' + base + '/og-image.png">\n' +
      '<meta property="og:url" content="' + base + '/">');
  }
  if (pullzone) {
    saida = saida.replace(MARCA,
      '<link rel="preconnect" href="https://' + pullzone + '">\n' + MARCA);
  }
  return saida;
}

export function comPreload(html, capa) {
  if (html.indexOf(MARCA) < 0) return null;
  return html.replace(MARCA,
    '<link rel="preload" as="image" href="' + capa + '" fetchpriority="high">\n' + MARCA);
}

export async function onRequestGet({ request, env }) {
  let capa = null;
  try {
    /* 60 s de cache na borda: a troca do destaque chega em até um minuto, e
     * a página inicial não espera o KV central. */
    capa = env.CATALOGO ? await env.CATALOGO.get(CHAVE_CAPA_DESTAQUE, { cacheTtl: 60 }) : null;
  } catch (e) {
    capa = null;
  }
  const siteUrl = siteUrlValida(env.APP_SITE_URL) ? env.APP_SITE_URL : null;
  const pullzone = hostValido(env.BUNNY_PULLZONE) ? env.BUNNY_PULLZONE : null;
  const comCapa = capaValida(capa);
  if (!comCapa && !siteUrl && !pullzone) return env.ASSETS.fetch(request);

  /* Sem as condições do pedido: um 304 devolveria ao navegador a página que
   * ele guardou, com a capa de ontem. */
  const cabecalhos = new Headers(request.headers);
  cabecalhos.delete('if-none-match');
  cabecalhos.delete('if-modified-since');
  const pagina = await env.ASSETS.fetch(new Request(request.url, { headers: cabecalhos }));
  if (pagina.status !== 200) return pagina;

  const html = await pagina.text();
  let novo = comCapa ? comPreload(html, capa) : html;
  if (novo !== null && (siteUrl || pullzone)) novo = comEndereco(novo, siteUrl, pullzone) || novo;
  const saida = new Headers(pagina.headers);
  saida.delete('content-length');
  if (novo === null) return new Response(html, { status: 200, headers: saida });

  /* O ETag do arquivo estático não descreve mais esta página. */
  saida.delete('etag');
  return new Response(novo, { status: 200, headers: saida });
}
