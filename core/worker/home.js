/* home.js — a página inicial (`/`), e só ela. (Era `functions/index.js` no Pages.)
 *
 * MODO DE ACESSO (D-4). O preload da capa só liga no modo `publico`: nos
 * modos `cadastro` e `privado` a URL da capa é conteúdo do acervo e a página
 * inicial é HTML aberto (o navegador não manda o token na navegação), então
 * ela não pode carregá-la. As outras injeções (og:url, pré-conexão) não são
 * conteúdo e continuam. Falha de config já chega aqui como `privado`.
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
 * absoluta) e a pré-conexão com o host de mídia do provedor, lidos de
 * APP_SITE_URL e do adaptador (`hostsMidia()`, que por sua vez lê o ambiente) —
 * nada disso fica escrito no arquivo estático.
 *
 * TUDO que dá errado devolve a página exatamente como antes: a chave que
 * falta, a que não parece uma capa de um host de mídia do provedor, o KV que falha, a página que
 * não veio com 200, a marca que sumiu do HTML. O pior caso desta função é não
 * ajudar.
 */
import { CHAVE_CAPA_DESTAQUE } from './api/catalogo.js';
import { hostsDeMidia } from './_lib/provedores/index.js';

/* Onde a linha entra. Há teste cobrando que o index.html a tenha, uma vez. */
export const MARCA = '<link rel="stylesheet" href="style.css">';

/* Uma capa de um host de MÍDIA do provedor (os de `hostsMidia().img`, que o
 * adaptador declara), e nada mais: o que vai para dentro do HTML não pode
 * fechar aspas nem abrir marcação, venha de onde vier. */
const CAPA = /^https:\/\/([a-z0-9.-]+)\/[A-Za-z0-9._\/-]+(\?v=[A-Za-z0-9._%-]+)?$/;

function hostPermitido(host, permitidos) {
  return permitidos.some((p) => {
    const alvo = String(p).replace(/^https:\/\//, '').toLowerCase();
    if (alvo.startsWith('*.')) return host.length > alvo.length - 1 && host.endsWith(alvo.slice(1));
    return host === alvo;
  });
}

export function capaValida(url, hostsImg = []) {
  if (typeof url !== 'string' || url.length >= 500) return false;
  const m = CAPA.exec(url);
  return Boolean(m) && hostPermitido(m[1].toLowerCase(), hostsImg);
}

/* O domínio público do site e o host de mídia do provedor vêm do ambiente
 * (APP_SITE_URL e o que o adaptador lê) e entram no HTML nesta função: o arquivo
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
 * og:url e, havendo pull zone, a pré-conexão com o host de mídia. Devolve null se o
 * HTML não tiver a marca. */
export function comEndereco(html, siteUrl, hostMidia) {
  if (html.indexOf(OG_IMAGE_RELATIVA) < 0) return null;
  const base = siteUrl ? siteUrl.replace(/\/+$/, '') : null;
  let saida = html;
  if (base) {
    saida = saida.replace(OG_IMAGE_RELATIVA,
      '<meta property="og:image" content="' + base + '/og-image.png">\n' +
      '<meta property="og:url" content="' + base + '/">');
  }
  if (hostMidia) {
    saida = saida.replace(MARCA,
      '<link rel="preconnect" href="https://' + hostMidia + '">\n' + MARCA);
  }
  return saida;
}

export function comPreload(html, capa) {
  if (html.indexOf(MARCA) < 0) return null;
  return html.replace(MARCA,
    '<link rel="preload" as="image" href="' + capa + '" fetchpriority="high">\n' + MARCA);
}

export async function onRequestGet({ request, env, modo, config }) {
  let capa = null;
  try {
    /* 60 s de cache na borda: a troca do destaque chega em até um minuto, e
     * a página inicial não espera o KV central. */
    capa = (modo === 'publico' && env.CATALOGO) ? await env.CATALOGO.get(CHAVE_CAPA_DESTAQUE, { cacheTtl: 60 }) : null;
  } catch (e) {
    capa = null;
  }
  const siteUrl = siteUrlValida(env.APP_SITE_URL) ? env.APP_SITE_URL : null;
  const hosts = hostsDeMidia(config, env);
  /* A pré-conexão vai ao host PRÓPRIO desta instalação (o curinga do provedor
   * não é um endereço): a pull zone, o subdomínio de clientes... */
  const proprio = hosts.img.find((h) => !h.includes('*'));
  const hostMidia = proprio && hostValido(proprio.replace(/^https:\/\//, '')) ? proprio.replace(/^https:\/\//, '') : null;
  const comCapa = capaValida(capa, hosts.img);
  if (!comCapa && !siteUrl && !hostMidia) return env.ASSETS.fetch(request);

  /* Sem as condições do pedido: um 304 devolveria ao navegador a página que
   * ele guardou, com a capa de ontem. */
  const cabecalhos = new Headers(request.headers);
  cabecalhos.delete('if-none-match');
  cabecalhos.delete('if-modified-since');
  const pagina = await env.ASSETS.fetch(new Request(request.url, { headers: cabecalhos }));
  if (pagina.status !== 200) return pagina;

  const html = await pagina.text();
  let novo = comCapa ? comPreload(html, capa) : html;
  if (novo !== null && (siteUrl || hostMidia)) novo = comEndereco(novo, siteUrl, hostMidia) || novo;
  const saida = new Headers(pagina.headers);
  saida.delete('content-length');
  if (novo === null) return new Response(html, { status: 200, headers: saida });

  /* O ETag do arquivo estático não descreve mais esta página. */
  saida.delete('etag');
  return new Response(novo, { status: 200, headers: saida });
}
