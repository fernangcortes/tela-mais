/* provedores/cloudflare-stream.js — adaptador do Cloudflare Stream.
 *
 * É AQUI, e só aqui, que moram o host da API (api.cloudflare.com), o subdomínio
 * `customer-<código>.cloudflarestream.com`, a tabela de status (`status.state`),
 * o TUS de uso único e a assinatura de URL. O resto do projeto só conhece
 * contrato.js.
 *
 * CREDENCIAIS (sempre {"$env":"VAR"} na config; nunca valor em arquivo):
 *   accountId             CLOUDFLARE_ACCOUNT_ID             32 hex (painel, barra lateral)
 *   tokenApi              CLOUDFLARE_STREAM_TOKEN           token de API com permissão "Stream: Edit"
 *   subdominioDeClientes  CLOUDFLARE_STREAM_SUBDOMINIO      "customer-xxxx" (ou só "xxxx", ou o host inteiro)
 *   chaveAssinaturaId     CLOUDFLARE_STREAM_KEY_ID          (opcional) id da chave de assinatura (POST /stream/keys)
 *   chaveAssinaturaJwk    CLOUDFLARE_STREAM_KEY_JWK         (opcional) `jwk` da mesma resposta (base64 do JWK, ou o JSON)
 *   segredoDoWebhook      CLOUDFLARE_STREAM_WEBHOOK_SECRET  (opcional) `secret` de PUT /stream/webhook
 * Não-segredo, em `config.video.cloudflareStream`: `exigirAssinatura` (boolean): novos vídeos nascem
 * com requireSignedURLs=true (modo privado).
 *
 * ENVIO. O navegador envia por TUS direto ao Stream: o Worker chama
 * `POST /accounts/{id}/stream?direct_user=true` (Tus-Resumable, Upload-Length, Upload-Metadata) com o token
 * da conta; a resposta 201 traz `Location` (URL TUS de USO ÚNICO, já autorizada) e `stream-media-id` (o uid).
 * O plano sai com `modo: 'url-pronta'` e SEM cabeçalhos: o token da conta nunca sai do Worker. O Upload-Length
 * é obrigatório na criação, então `criarUpload` exige `tamanhoBytes` (a mesa o manda desde o M4). Pedaços de
 * 5 a 200 MiB, múltiplos de 256 KiB. A URL não pode ser reemitida: ver `retomarUpload`.
 *
 * REPRODUÇÃO. HLS em https://customer-<código>.cloudflarestream.com/<uid>/manifest/video.m3u8; capa em
 * .../<uid>/thumbnails/thumbnail.jpg?time=<s>s&width=<px> (a capa é um INSTANTE do vídeo: capaPorTempo; não há
 * upload de capa); prévia animada .../thumbnails/thumbnail.gif; embed .../<uid>/iframe com autoplay=false&loop=false.
 * Não há MP4 sem habilitar "downloads" por vídeo: `mp4` fica `false` e `midia.mp4` nulo.
 *
 * ASSINATURA (modo privado; a implementação ligada ao middleware é do M5). O Stream aceita dois caminhos, e o
 * resultado é o mesmo: um JWT no lugar do uid na URL (.../<token>/manifest/video.m3u8):
 *   (a) POST /accounts/{id}/stream/{uid}/token {exp, accessRules?} -> result.token: uma chamada de rede por
 *       vídeo; NÃO implementado aqui (custo de rede por título e por reprodução);
 *   (b) assinatura LOCAL com a chave de assinatura (RS256, header {alg, kid}, payload {sub: uid, kid, exp, nbf}):
 *       sem rede, ~1 ms. IMPLEMENTADO: com `chaveAssinaturaId` + `chaveAssinaturaJwk` presentes,
 *       `capacidades().assinatura` é true e `urlReproducao(id, { assinar: true, validadeSeg })` devolve URLs
 *       com o token. Sem a chave, `assinar: true` rejeita com `assinatura-indisponivel`.
 *   Um vídeo com requireSignedURLs só toca com token: com `exigirAssinatura` ligado e SEM chave, o catálogo
 *   montaria URLs que o Stream recusa; quem liga o modo privado precisa dos dois.
 *
 * LEGENDAS. PUT /stream/{uid}/captions/{idioma} (multipart, campo `file`, WebVTT: o SRT é convertido aqui);
 * lista GET .../captions ({language, label, generated, status}); IA: POST .../captions/{idioma}/generate.
 * O manifesto HLS já carrega as faixas; a URL em `legendas[]` é a do VTT por idioma (não confirmada: ver relato).
 *
 * WEBHOOK. Corpo = objeto do vídeo (`uid`, `readyToStream`, `status.state`); assinado em `Webhook-Signature:
 * time=<unix>,sig1=<hex>` = HMAC-SHA256(secret, `<time>.<corpo>`). Sem `segredoDoWebhook` não há webhook
 * (nada sem assinatura é aceito).
 */
import {
  ErroProvedor, mensagemDe, hostsLimpos, rotuloDoIdioma, detalheDe, mascarar, PADRAO_IDIOMA
} from './contrato.js';

export const ID = 'cloudflare-stream';
export const CHAVE_CONFIG = 'cloudflareStream';
export const CREDENCIAIS = Object.freeze({
  accountId: { env: 'CLOUDFLARE_ACCOUNT_ID', obrigatoria: true, segredo: true },
  tokenApi: { env: 'CLOUDFLARE_STREAM_TOKEN', obrigatoria: true, segredo: true },
  subdominioDeClientes: { env: 'CLOUDFLARE_STREAM_SUBDOMINIO', obrigatoria: true, segredo: true },
  chaveAssinaturaId: { env: 'CLOUDFLARE_STREAM_KEY_ID', obrigatoria: false, segredo: true },
  chaveAssinaturaJwk: { env: 'CLOUDFLARE_STREAM_KEY_JWK', obrigatoria: false, segredo: true },
  segredoDoWebhook: { env: 'CLOUDFLARE_STREAM_WEBHOOK_SECRET', obrigatoria: false, segredo: true }
});

const HOST_API = 'https://api.cloudflare.com/client/v4';
const DOMINIO = 'cloudflarestream.com';
const PADRAO_ID = /^[a-f0-9]{32}$/;
const PADRAO_CONTA = /^[a-f0-9]{32}$/i;
const PADRAO_CODIGO = /^[a-z0-9]{8,40}$/;
const PADRAO_CHAVE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const PADRAO_CURSOR = /^[0-9T:.+Z-]{10,40}$/;
const HOST_DE_UPLOAD = /^[a-z0-9.-]+\.(cloudflarestream\.com|videodelivery\.net)$/;
const VALIDADE_PADRAO_S = 3600;
const TOLERANCIA_WEBHOOK_S = 300;
const PEDACO_MIN_MB = 5;
const PEDACO_MAX_MB = 200;
const PEDACO_MULTIPLO = 256 * 1024;

/* status.state -> estado normalizado. `ready` só vale se `readyToStream` não for false (a documentação
 * exige os dois para tocar). pendingupload e downloading (cópia por URL) = ainda chegando. */
function normalizarEstado(state, readyToStream) {
  switch (state) {
    case 'pendingupload': case 'downloading': return 'enviando';
    case 'ready': return readyToStream === false ? 'processando' : 'pronto';
    case 'error': return 'erro';
    default: return 'processando';   /* queued, inprogress, live-inprogress */
  }
}

function eventoDoWebhook(video) {
  const e = normalizarEstado(video.status && video.status.state, video.readyToStream);
  return e === 'pronto' ? 'pronto' : e === 'erro' ? 'erro' : 'processando';
}

const b64 = (texto) => {
  const bytes = new TextEncoder().encode(String(texto));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** `customer-abc`, `abc` ou `https://customer-abc.cloudflarestream.com/` -> `abc` (ou null). */
function codigoDoCliente(valor) {
  if (typeof valor !== 'string') return null;
  let v = valor.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  v = v.replace(new RegExp('\\.' + DOMINIO.replace('.', '\\.') + '$'), '').replace(/^customer-/, '');
  return PADRAO_CODIGO.test(v) ? v : null;
}

/** SRT -> WebVTT (o Stream só recebe VTT): cabeçalho, vírgula do milissegundo vira ponto. */
export function srtParaVtt(texto) {
  const t = String(texto).replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (/^WEBVTT/.test(t)) return t + '\n';
  return 'WEBVTT\n\n' + t.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2') + '\n';
}

export function criar({ credenciais = {}, config = {}, fetch: fetchInjetado, agora = Date.now } = {}) {
  const contaId = PADRAO_CONTA.test(String(credenciais.accountId || '')) ? String(credenciais.accountId).toLowerCase() : '';
  const token = String(credenciais.tokenApi || '');
  const codigo = codigoDoCliente(credenciais.subdominioDeClientes);
  const host = codigo ? 'customer-' + codigo + '.' + DOMINIO : null;
  const chaveId = PADRAO_CHAVE_ID.test(String(credenciais.chaveAssinaturaId || '')) ? String(credenciais.chaveAssinaturaId) : '';
  const jwkBruta = String(credenciais.chaveAssinaturaJwk || '');
  const segredoWebhook = String(credenciais.segredoDoWebhook || '');
  const configurado = Boolean(contaId && token && host);
  const podeAssinar = Boolean(chaveId && jwkBruta);
  const bloco = (config && config[CHAVE_CONFIG]) || {};
  const exigirAssinatura = bloco.exigirAssinatura === true;
  const mb = Math.min(PEDACO_MAX_MB, Math.max(PEDACO_MIN_MB, Number(config && config.envio && config.envio.tamanhoDoPedacoMb) || 50));
  const pedacoBytes = Math.ceil(mb * 1024 * 1024 / PEDACO_MULTIPLO) * PEDACO_MULTIPLO;
  const segredos = [token, jwkBruta, segredoWebhook];

  const buscar = (...a) => (fetchInjetado || globalThis.fetch)(...a);
  const base = HOST_API + '/accounts/' + contaId;

  async function chamar(caminho, init = {}) {
    if (!configurado) throw new ErroProvedor('provedor-nao-configurado');
    try {
      return await buscar(base + caminho, Object.assign({}, init, {
        headers: Object.assign({ Authorization: 'Bearer ' + token, accept: 'application/json' }, init.headers || {})
      }));
    } catch (e) {
      throw new ErroProvedor('provedor-inacessivel', { detalhe: mascarar(e && e.message, segredos) });
    }
  }

  async function exigir(resposta, cod) {
    if (!resposta.ok) throw new ErroProvedor(cod, { status: resposta.status, detalhe: await detalheDe(resposta, segredos) });
    return resposta;
  }

  /* Corpo do Cloudflare: { success, errors, result }. `success:false` com HTTP 200 também é falha. */
  async function lerResultado(resposta, cod) {
    let corpo;
    try { corpo = await resposta.json(); } catch (e) {
      throw new ErroProvedor(cod, { status: resposta.status, detalhe: 'resposta sem JSON' }); /* i18n-ignorar: detalhe técnico do erro */
    }
    if (!corpo || corpo.success === false) {
      throw new ErroProvedor(cod, { status: resposta.status, detalhe: mascarar(JSON.stringify((corpo && corpo.errors) || []).slice(0, 300), segredos) });
    }
    return corpo.result;
  }

  function validarId(id) {
    if (typeof id !== 'string' || !PADRAO_ID.test(id)) throw new ErroProvedor('id-invalido');
    return id;
  }

  /* ----------------------------------------------------------- assinatura local */

  let chavePrivada = null;
  async function importarChave() {
    if (chavePrivada) return chavePrivada;
    let jwk;
    try {
      jwk = JSON.parse(jwkBruta.trim().startsWith('{') ? jwkBruta : atob(jwkBruta.trim()));
    } catch (e) { throw new ErroProvedor('provedor-nao-configurado', { detalhe: 'CLOUDFLARE_STREAM_KEY_JWK ilegível' }); /* i18n-ignorar: detalhe técnico do erro */ }
    try {
      chavePrivada = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    } catch (e) { throw new ErroProvedor('provedor-nao-configurado', { detalhe: 'CLOUDFLARE_STREAM_KEY_JWK inválida' }); /* i18n-ignorar: detalhe técnico do erro */ }
    return chavePrivada;
  }

  /** JWT do Stream: header {alg:RS256, kid}, payload {sub: uid, kid, exp, nbf} (segundos UNIX). */
  async function assinarToken(id, validadeSeg) {
    const chave = await importarChave();
    const agoraS = Math.floor(agora() / 1000);
    const exp = agoraS + (Number(validadeSeg) > 0 ? Math.floor(Number(validadeSeg)) : VALIDADE_PADRAO_S);
    const enc = new TextEncoder();
    const cabeca = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid: chaveId })));
    const corpo = b64url(enc.encode(JSON.stringify({ sub: id, kid: chaveId, exp, nbf: agoraS - 30 })));
    const assinatura = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, enc.encode(cabeca + '.' + corpo));
    return { token: cabeca + '.' + corpo + '.' + b64url(new Uint8Array(assinatura)), exp };
  }

  /* O "id" que vai na URL: o uid, ou o token que o substitui no modo assinado. */
  async function segmentoDaUrl(id, assinar, validadeSeg) {
    if (!assinar) return { seg: id, exp: null };
    const t = await assinarToken(id, validadeSeg);
    return { seg: t.token, exp: t.exp };
  }

  /* ------------------------------------------------------------------- URLs */

  function urlCapaCom(seg, { versao, tempoSeg, largura } = {}) {
    if (!host) return null;
    const q = [];
    if (tempoSeg !== null && tempoSeg !== undefined && tempoSeg !== '' && Number.isFinite(Number(tempoSeg)) && Number(tempoSeg) >= 0) q.push('time=' + Math.floor(Number(tempoSeg)) + 's');
    if (Number.isFinite(Number(largura)) && Number(largura) > 0) q.push('width=' + Math.min(3840, Math.floor(Number(largura))));
    if (versao != null && versao !== '') q.push('v=' + encodeURIComponent(versao));
    return 'https://' + host + '/' + seg + '/thumbnails/thumbnail.jpg' + (q.length ? '?' + q.join('&') : '');
  }

  function embedCom(seg) {
    /* Sem autoplay e sem loop: o padrão do player já é falso, mas o parâmetro explícito protege de mudança. */
    return { url: 'https://' + host + '/' + seg + '/iframe?autoplay=false&loop=false&preload=metadata' };
  }

  function legendasPorIdioma(seg, idiomas) {
    if (!host) return [];
    return idiomas.filter(i => typeof i === 'string' && PADRAO_IDIOMA.test(i)).map(idioma => ({
      idioma, rotulo: rotuloDoIdioma(idioma),
      url: 'https://' + host + '/' + seg + '/captions/' + idioma + '/vtt', origem: 'desconhecida'
    }));
  }

  async function reproducao(id, { assinar = false, validadeSeg } = {}) {
    const saida = { hls: null, mp4: null, embed: null, expiraEm: null };
    if (typeof id !== 'string' || !PADRAO_ID.test(id) || !host) return saida;
    const { seg, exp } = await segmentoDaUrl(id, assinar, validadeSeg);
    saida.hls = 'https://' + host + '/' + seg + '/manifest/video.m3u8';
    saida.embed = embedCom(seg);
    saida.expiraEm = exp;
    return saida;
  }

  /* ----------------------------------------------------------------- vídeos */

  function estadoDe(v) {
    const s = v.status || {};
    const estado = normalizarEstado(s.state, v.readyToStream);
    const pct = s.pctComplete !== undefined && s.pctComplete !== null && s.pctComplete !== '' ? Number(s.pctComplete) : null;
    return {
      estado,
      progresso: estado === 'pronto' ? 100 : (Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null),
      duracaoSeg: typeof v.duration === 'number' && v.duration >= 0 ? v.duration : null,
      titulo: v.meta && v.meta.name != null ? String(v.meta.name) : null,
      estadoBruto: s.state != null ? s.state : null,
      qualidades: []
    };
  }

  function resumoDe(v) {
    const e = estadoDe(v);
    return {
      id: v.uid,
      titulo: e.titulo,
      duracaoSeg: e.duracaoSeg,
      criadoEm: v.created || null,
      tamanhoBytes: typeof v.size === 'number' ? v.size : null,
      estado: e.estado,
      progresso: e.progresso,
      framerate: null,
      arquivoCapa: null,
      urlCapa: PADRAO_ID.test(String(v.uid)) ? urlCapaCom(v.uid, {}) : null
    };
  }

  const planoSemUrl = (id, expiraEm) => ({
    id, protocolo: 'tus', modo: 'url-pronta', url: null, cabecalhos: {}, metadados: {}, expiraEm, pedacoBytes,
    fonte: { provedor: ID, id, extras: {} }
  });

  const adaptador = {
    id: ID,
    configurado,
    padraoId: PADRAO_ID,

    capacidades() {
      const caminhos = ['https://*.' + DOMINIO, 'https://*.videodelivery.net'];
      const c = {
        uploadProtocolo: 'tus',
        envio: true,
        assinatura: podeAssinar,
        drm: 'nenhum',               /* o DRM do Stream não é ligado por aqui */
        embed: true,
        mp4: false,                  /* exige habilitar "downloads" por vídeo */
        previa: true,                /* thumbnail.gif */
        sprites: false,
        clipe: false,                /* POST /stream/clip cria OUTRO vídeo (cobrado): fora do M4 */
        capaPorUpload: false,
        capaPorTempo: true,
        legendaPorUpload: true,
        legendaIA: true,
        capitulosNativos: false,
        webhooks: Boolean(segredoWebhook),
        uso: true,
        hostsMidia: hostsLimpos({ img: caminhos, media: caminhos, connect: caminhos, frame: caminhos, script: [] })
      };
      return c;
    },

    hostsMidia() {
      const e = adaptador.capacidades().hostsMidia;
      return hostsLimpos({
        img: e.img, media: e.media, connect: e.connect, frame: e.frame,
        script: e.script
      });
    },

    async validarCredenciais() {
      if (!configurado) {
        return { ok: false, codigo: 'provedor-nao-configurado', mensagem: mensagemDe('provedor-nao-configurado', { provedor: ID, faltando: 'CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_TOKEN, CLOUDFLARE_STREAM_SUBDOMINIO' }) };
      }
      try {
        const r = await chamar('/stream?limit=1');
        if (r.ok) return { ok: true, mensagem: '' };
        const cod = r.status === 401 || r.status === 403 ? 'credenciais-recusadas' : 'provedor-recusou-consulta';
        return { ok: false, codigo: cod, mensagem: mensagemDe(cod) };
      } catch (e) {
        const cod = e instanceof ErroProvedor ? e.codigo : 'provedor-inacessivel';
        return { ok: false, codigo: cod, mensagem: mensagemDe(cod) };
      }
    },

    async criarUpload({ titulo, tamanhoBytes, validadeSeg } = {}) {
      if (!configurado) throw new ErroProvedor('provedor-nao-configurado');
      if (typeof titulo !== 'string' || !titulo.trim()) throw new ErroProvedor('parametro-invalido', { detalhe: 'titulo' });
      const tamanho = Math.floor(Number(tamanhoBytes));
      if (!Number.isFinite(tamanho) || tamanho <= 0) throw new ErroProvedor('parametro-invalido', { detalhe: 'tamanhoBytes' });
      const validade = Number(validadeSeg) > 0 ? Math.floor(Number(validadeSeg)) : VALIDADE_PADRAO_S;
      const expiraEm = Math.floor(agora() / 1000) + validade;
      const metadados = ['name ' + b64(titulo.trim().slice(0, 200)), 'expiry ' + b64(new Date(expiraEm * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'))];
      if (exigirAssinatura) metadados.push('requiresignedurls');
      const r = await exigir(await chamar('/stream?direct_user=true', {
        method: 'POST',
        headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(tamanho), 'Upload-Metadata': metadados.join(',') } /* i18n-ignorar: cabeçalhos HTTP do TUS */
      }), 'provedor-recusou-criacao');
      const uid = r.headers.get('stream-media-id');
      const local = r.headers.get('location');
      if (!uid || !local) throw new ErroProvedor('provedor-sem-guid');
      const id = validarId(uid);
      let url;
      try { url = new URL(local, HOST_API); } catch (e) { throw new ErroProvedor('provedor-recusou-criacao', { detalhe: 'Location inválido' }); /* i18n-ignorar: detalhe técnico do erro */ }
      if (url.protocol !== 'https:' || !HOST_DE_UPLOAD.test(url.hostname)) {
        throw new ErroProvedor('provedor-recusou-criacao', { detalhe: 'Location fora do Stream' }); /* i18n-ignorar: detalhe técnico do erro */
      }
      return Object.assign(planoSemUrl(id, expiraEm), { url: url.toString() });
    },

    /* A URL TUS do Stream é de uso único e NÃO pode ser reemitida para um vídeo que já existe. Quem retoma
     * é o cliente, com a `url` que guardou do plano original (tus-js-client guarda por impressão digital
     * do arquivo e consulta o offset por HEAD). Aqui só se confirma que o vídeo existe (404 vira erro de
     * provedor) e devolve um plano SEM `url` (`retomavel: false`): o handler/front que não tem a URL
     * guardada precisa enviar de novo. */
    async retomarUpload(id) {
      validarId(id);
      if (!configurado) throw new ErroProvedor('provedor-nao-configurado');
      await exigir(await chamar('/stream/' + id), 'provedor-recusou-consulta');
      return Object.assign(planoSemUrl(id, Math.floor(agora() / 1000) + VALIDADE_PADRAO_S), { retomavel: false });
    },

    async statusEncoding(id) {
      validarId(id);
      const r = await exigir(await chamar('/stream/' + id), 'provedor-recusou-consulta');
      return estadoDe(await lerResultado(r, 'provedor-recusou-consulta'));
    },

    async urlReproducao(id, { assinar = false, validadeSeg } = {}) {
      if (assinar && !podeAssinar) throw new ErroProvedor('assinatura-indisponivel', { status: 501 });
      return reproducao(id, { assinar, validadeSeg });
    },

    /* Atalho do catálogo: a `Midia` inteira, sem rede e sem assinatura (igual à composição). */
    async midia(id, { arquivo, versao, idiomas } = {}) {
      void arquivo;
      const rep = await reproducao(id, {});
      return {
        hls: rep.hls,
        mp4: rep.mp4,
        capa: urlCapaCom(id, { versao }),
        previa: host ? 'https://' + host + '/' + id + '/thumbnails/thumbnail.gif' : null,
        legendas: legendasPorIdioma(id, idiomas || []),
        embed: rep.embed,
        expiraEm: null
      };
    },

    /* `arquivo` não existe no Stream (a capa é um instante); `versao` é só cache. Extensão ao contrato:
     * `assinar` (token no lugar do uid; vídeo com requireSignedURLs também assina a capa). */
    async urlCapa(id, { versao, tempoSeg, largura, assinar = false, validadeSeg } = {}) {
      if (typeof id !== 'string' || !PADRAO_ID.test(id) || !host) return null;
      if (assinar && !podeAssinar) throw new ErroProvedor('assinatura-indisponivel', { status: 501 });
      return urlCapaCom((await segmentoDaUrl(id, assinar, validadeSeg)).seg, { versao, tempoSeg, largura });
    },

    async definirCapa() {
      throw new ErroProvedor('recurso-indisponivel', { detalhe: 'capa por instante: use definirTempoDaCapa' }); /* i18n-ignorar: detalhe técnico do erro */
    },

    /* Extensão (capaPorTempo): fixa o instante da capa padrão (thumbnailTimestampPct = tempo / duração). */
    async definirTempoDaCapa(id, tempoSeg) {
      validarId(id);
      const t = Number(tempoSeg);
      if (!Number.isFinite(t) || t < 0) throw new ErroProvedor('parametro-invalido', { detalhe: 'tempoSeg' });
      const v = estadoDe(await lerResultado(await exigir(await chamar('/stream/' + id), 'provedor-recusou-consulta'), 'provedor-recusou-consulta'));
      if (!v.duracaoSeg) throw new ErroProvedor('provedor-recusou-capa', { detalhe: 'duração desconhecida' }); /* i18n-ignorar: detalhe técnico do erro */
      const pct = Math.min(1, t / v.duracaoSeg);
      await exigir(await chamar('/stream/' + id, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ thumbnailTimestampPct: pct })
      }), 'provedor-recusou-capa');
      return { tempoSeg: t, pct, urlCapa: urlCapaCom(id, { tempoSeg: t }) };
    },

    async urlPreview(id) {
      if (!host || typeof id !== 'string' || !PADRAO_ID.test(id)) return { animada: null, clipeHls: null, sprite: null };
      /* GIF animado: pesado; quem usa a URL só a pede no hover. */
      return { animada: 'https://' + host + '/' + id + '/thumbnails/thumbnail.gif', clipeHls: null, sprite: null };
    },

    async legendas(id, { idiomas } = {}) {
      validarId(id);
      if (Array.isArray(idiomas)) return legendasPorIdioma(id, idiomas);
      const r = await exigir(await chamar('/stream/' + id + '/captions'), 'provedor-recusou-consulta');
      const lista = await lerResultado(r, 'provedor-recusou-consulta');
      return (Array.isArray(lista) ? lista : []).filter(c => c && PADRAO_IDIOMA.test(String(c.language)) && (!c.status || c.status === 'ready')).map(c => ({
        idioma: String(c.language), rotulo: c.label ? String(c.label) : rotuloDoIdioma(String(c.language)),
        url: host ? 'https://' + host + '/' + id + '/captions/' + c.language + '/vtt' : '',
        origem: c.generated === true ? 'ia' : 'manual'
      }));
    },

    async enviarLegenda(id, { idioma, rotulo, srt, vtt } = {}) {
      validarId(id);
      if (typeof idioma !== 'string' || !PADRAO_IDIOMA.test(idioma)) throw new ErroProvedor('parametro-invalido', { detalhe: 'idioma' });
      const texto = typeof srt === 'string' && srt.trim() ? srt : (typeof vtt === 'string' ? vtt : '');
      if (!texto.trim()) throw new ErroProvedor('parametro-invalido', { detalhe: 'legenda vazia' }); /* i18n-ignorar: detalhe técnico do erro */
      const form = new FormData();
      form.append('file', new Blob([srtParaVtt(texto)], { type: 'text/vtt' }), idioma + '.vtt');
      const r = await exigir(await chamar('/stream/' + id + '/captions/' + idioma, { method: 'PUT', body: form }), 'provedor-recusou-legenda');
      const res = await lerResultado(r, 'provedor-recusou-legenda');
      return { idioma, rotulo: rotulo || (res && res.label) || rotuloDoIdioma(idioma) };
    },

    /* Legenda por IA (Workers AI): assíncrona; o status sai em `legendas(id)` (`generated`, `status`). */
    async gerarLegendaIA(id, { idioma } = {}) {
      validarId(id);
      if (typeof idioma !== 'string' || !PADRAO_IDIOMA.test(idioma)) throw new ErroProvedor('parametro-invalido', { detalhe: 'idioma' });
      const r = await exigir(await chamar('/stream/' + id + '/captions/' + idioma + '/generate', { method: 'POST' }), 'provedor-recusou-legenda');
      await lerResultado(r, 'provedor-recusou-legenda');
      return { iniciado: true };
    },

    async obterVideo(id) {
      validarId(id);
      const r = await exigir(await chamar('/stream/' + id), 'provedor-recusou-consulta');
      return resumoDe(await lerResultado(r, 'provedor-recusou-consulta'));
    },

    /* Paginação por `before` (created do último item, mais novo primeiro): `proximo` é esse instante, ou null. */
    async listar({ cursor, limite } = {}) {
      const porPagina = Math.min(100, Math.max(1, Math.floor(Number(limite)) || 50));
      let q = 'limit=' + porPagina;
      if (cursor != null && cursor !== '') {
        if (typeof cursor !== 'string' || !PADRAO_CURSOR.test(cursor)) throw new ErroProvedor('parametro-invalido', { detalhe: 'cursor' });
        q += '&before=' + encodeURIComponent(cursor);
      }
      const r = await exigir(await chamar('/stream?' + q), 'provedor-recusou-consulta');
      const lista = await lerResultado(r, 'provedor-recusou-consulta');
      const itens = (Array.isArray(lista) ? lista : []).filter(v => v && PADRAO_ID.test(String(v.uid))).map(resumoDe);
      const ultimo = itens.length === porPagina ? itens[itens.length - 1].criadoEm : null;
      return { itens, proximo: ultimo && PADRAO_CURSOR.test(ultimo) ? ultimo : null };
    },

    async excluir(id) {
      validarId(id);
      await exigir(await chamar('/stream/' + id, { method: 'DELETE' }), 'provedor-recusou-exclusao');
      return { ok: true };
    },

    async uso() {
      const r = await exigir(await chamar('/stream/storage-usage'), 'provedor-recusou-consulta');
      const u = await lerResultado(r, 'provedor-recusou-consulta');
      return { minutosArmazenados: typeof u.totalStorageMinutes === 'number' ? u.totalStorageMinutes : undefined };
    }
  };

  /* Só existe com o segredo: webhook sem assinatura nunca é aceito. */
  if (segredoWebhook) {
    adaptador.receberWebhook = async function receberWebhook(request) {
      let texto;
      try { texto = await request.text(); } catch (e) { return null; }
      const cab = String(request.headers.get('Webhook-Signature') || ''); /* i18n-ignorar: cabeçalho HTTP */
      const partes = {};
      for (const p of cab.split(',')) { const i = p.indexOf('='); if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
      const tempo = Number(partes.time);
      if (!Number.isFinite(tempo) || !/^[0-9a-f]{64}$/i.test(partes.sig1 || '')) return null;
      if (Math.abs(Math.floor(agora() / 1000) - tempo) > TOLERANCIA_WEBHOOK_S) return null;
      const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredoWebhook), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const esperado = hex(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(partes.time + '.' + texto)));
      /* Comparação em tempo constante (sem retorno antecipado por conteúdo). */
      const recebido = partes.sig1.toLowerCase();
      let dif = esperado.length ^ recebido.length;
      for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ (recebido.charCodeAt(i) || 0);
      if (dif !== 0) return null;
      let corpo;
      try { corpo = JSON.parse(texto); } catch (e) { return null; }
      if (!corpo || typeof corpo.uid !== 'string' || !PADRAO_ID.test(corpo.uid)) return null;
      return { id: corpo.uid, evento: eventoDoWebhook(corpo) };
    };
  }
  return adaptador;
}
