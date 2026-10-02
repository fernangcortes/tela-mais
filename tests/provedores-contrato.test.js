/* Suíte de CONTRATO dos adaptadores de vídeo (M4). A MESMA suíte roda para todo
 * adaptador que existe em core/worker/_lib/provedores/ e tenha fixtures em
 * tests/fixtures/provedores/<id>/ (formato em tests/fixtures/provedores/LEIA-ME.md).
 *
 * Sem rede: o `fetch` é um falso que só responde o que a fixture gravou; qualquer
 * chamada não prevista reprova o teste. O `fetch` GLOBAL é trocado por um que
 * lança, para provar que o adaptador usa o injetado (e não vaza chamada real).
 *
 * Um adaptador novo entra na suíte ganhando a pasta de fixtures; nada aqui
 * muda. Adaptador listado no registro SEM fixtures aparece como "pulado", com o
 * motivo: a suíte não finge cobrir o que não viu.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RAIZ_FIXTURES = path.join(__dirname, 'fixtures', 'provedores');
const registro = () => import('../core/worker/_lib/provedores/index.js');
const contrato = () => import('../core/worker/_lib/provedores/contrato.js');

/* ---------------------------------------------------------------- fixtures */

function lerFixtures(id) {
  const dir = path.join(RAIZ_FIXTURES, id);
  const arquivoManifesto = path.join(dir, 'manifesto.json');
  if (!fs.existsSync(arquivoManifesto)) return null;
  const manifesto = JSON.parse(fs.readFileSync(arquivoManifesto, 'utf8'));
  const cenario = (nome) => {
    const arquivo = path.join(dir, nome + '.json');
    return fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : null;
  };
  return { manifesto, cenario };
}

/* Contém tudo o que `esperado` diz (objetos e listas, em profundidade). */
function conferir(real, esperado, caminho) {
  if (esperado !== null && typeof esperado === 'object' && !Array.isArray(esperado)) {
    assert.ok(real !== null && typeof real === 'object', caminho + ': esperado um objeto, veio ' + JSON.stringify(real));
    for (const k of Object.keys(esperado)) conferir(real[k], esperado[k], caminho + '.' + k);
  } else if (Array.isArray(esperado)) {
    assert.ok(Array.isArray(real), caminho + ': esperada uma lista');
    assert.equal(real.length, esperado.length, caminho + ': tamanho da lista');
    esperado.forEach((v, i) => conferir(real[i], v, caminho + '[' + i + ']'));
  } else {
    assert.deepEqual(real, esperado, caminho);
  }
}

/* O fetch falso: resolve pelas rotas do cenário (método + regex da URL), confere
 * cabeçalhos e o trecho do corpo JSON que a rota declara, e registra tudo. */
function fetchFalso(rotas) {
  const chamadas = [];
  const falso = async (url, init = {}) => {
    const metodo = String((init && init.method) || 'GET').toUpperCase();
    const cab = {};
    new Headers((init && init.headers) || {}).forEach((v, k) => { cab[k.toLowerCase()] = v; });
    let corpo = init && init.body !== undefined ? init.body : null;
    let corpoJson = null;
    if (typeof corpo === 'string') { try { corpoJson = JSON.parse(corpo); } catch (e) { /* texto */ } }
    chamadas.push({ metodo, url: String(url), cabecalhos: cab, corpo, corpoJson });

    const rota = (rotas || []).find(r => r.metodo.toUpperCase() === metodo && new RegExp(r.url).test(String(url)));
    assert.ok(rota, 'requisição não prevista pela fixture: ' + metodo + ' ' + url);
    for (const [k, v] of Object.entries(rota.cabecalhos || {})) {
      assert.equal(cab[k.toLowerCase()], v, 'cabeçalho ' + k + ' em ' + metodo + ' ' + url);
    }
    if (rota.corpoContem) conferir(corpoJson, rota.corpoContem, 'corpo de ' + metodo + ' ' + url);
    const r = rota.resposta;
    const texto = r.texto !== undefined ? r.texto : JSON.stringify(r.corpo === undefined ? null : r.corpo);
    return new Response(r.status === 204 ? null : texto, { status: r.status, headers: Object.assign({ 'content-type': r.texto !== undefined ? 'text/plain' : 'application/json' }, r.cabecalhos || {}) });
  };
  return { fetch: falso, chamadas };
}

/* -------------------------------------------------------------- a suíte */

function suite(id, fx) {
  const { manifesto, cenario } = fx;
  const nome = (t) => '[' + id + '] ' + t;
  const ID = manifesto.idExemplo;
  const segredos = manifesto.segredos || [];

  /* Cria o adaptador pelo REGISTRO (o caminho que o Worker usa), com o fetch do cenário. */
  async function adaptador({ cenarioNome = null, rotas = null, env = manifesto.env, config = { video: { provedor: id } } } = {}) {
    const { criarProvedor } = await registro();
    const c = cenarioNome ? cenario(cenarioNome) : null;
    if (cenarioNome) assert.ok(c, 'a fixture ' + id + '/' + cenarioNome + '.json não existe');
    const falso = fetchFalso(rotas || (c && c.rotas) || []);
    const provedor = criarProvedor(config, env, { provedor: id, fetch: falso.fetch, agora: () => manifesto.agora });
    return { provedor, chamadas: falso.chamadas, c };
  }

  /* O fetch GLOBAL lança durante cada teste da suíte: um adaptador que o usasse em vez do
   * injetado reprovaria (e nenhuma chamada real escaparia). */
  const teste = (titulo, fn) => test(nome(titulo), async (t) => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => { throw new Error('fetch global usado (rede real!): ' + url); };
    try { return await fn(t); } finally { globalThis.fetch = original; }
  });

  teste('cumpre a interface: funções, capacidades coerentes com funções opcionais', async () => {
    const { provedor } = await adaptador();
    const { validarAdaptador } = await registro();
    assert.deepEqual(validarAdaptador(provedor), []);
    assert.equal(provedor.id, id, 'o id do adaptador é o do `video.provedor`');
  });

  teste('hostsMidia: só hosts de formato seguro, por diretiva; os estáticos fazem parte dos dinâmicos', async () => {
    const { provedor } = await adaptador();
    const { hostDeCspValido, DIRETIVAS_DE_HOSTS } = await contrato();
    const dinamicos = provedor.hostsMidia();
    const estaticos = provedor.capacidades().hostsMidia;
    for (const d of DIRETIVAS_DE_HOSTS) {
      assert.ok(Array.isArray(dinamicos[d]) && Array.isArray(estaticos[d]), d + ' ausente');
      for (const h of dinamicos[d].concat(estaticos[d])) assert.ok(hostDeCspValido(h), 'host inválido para a CSP: ' + h);
      for (const h of estaticos[d]) assert.ok(dinamicos[d].includes(h), 'o host estático ' + h + ' sumiu de hostsMidia()');
    }
    /* Nada que quebre a CSP, mesmo com env hostil. */
    const hostil = await adaptador({ env: Object.assign({}, manifesto.env, Object.fromEntries(Object.keys(manifesto.env).map(k => [k, 'x; script-src *']))) });
    for (const d of DIRETIVAS_DE_HOSTS) for (const h of hostil.provedor.hostsMidia()[d]) assert.ok(hostDeCspValido(h), 'env hostil entrou na CSP: ' + h);
  });

  teste('padraoId aceita o id de exemplo e recusa o que muda o caminho da URL; id inválido nem toca a rede', async () => {
    const { provedor, chamadas } = await adaptador();
    const { ErroProvedor } = await registro();
    assert.ok(provedor.padraoId.test(ID), 'o id de exemplo não casa com padraoId');
    for (const ruim of manifesto.idsInvalidos) assert.ok(!provedor.padraoId.test(ruim), 'padraoId aceitou ' + JSON.stringify(ruim));
    const usaId = ['statusEncoding', 'obterVideo', 'excluir', 'retomarUpload'];
    for (const ruim of manifesto.idsInvalidos) {
      for (const fn of usaId) {
        await assert.rejects(() => provedor[fn](ruim), (e) => e instanceof ErroProvedor && e.codigo === 'id-invalido', fn + '(' + JSON.stringify(ruim) + ')');
      }
    }
    assert.equal(chamadas.length, 0, 'id inválido foi ao provedor');
  });

  teste('sem credenciais: não está configurado, validarCredenciais não lança nem usa a rede, criar upload recusa', async () => {
    const vazio = await adaptador({ env: {} });
    const { ErroProvedor } = await registro();
    assert.equal(vazio.provedor.configurado, false);
    const r = await vazio.provedor.validarCredenciais();
    assert.equal(r.ok, false);
    assert.ok(typeof r.mensagem === 'string' && r.mensagem.length > 0, 'a mensagem do teste de conexão está vazia');
    assert.equal(vazio.chamadas.length, 0);
    if (vazio.provedor.capacidades().envio) {
      await assert.rejects(() => vazio.provedor.criarUpload({ titulo: 'x' }), (e) => e instanceof ErroProvedor && e.codigo === 'provedor-nao-configurado');
    }
    assert.ok(Array.isArray(vazio.provedor.faltando) && vazio.provedor.faltando.length > 0, 'o registro não diz quais variáveis faltam');
    const comTudo = await adaptador();
    assert.equal(comTudo.provedor.configurado, true);
    assert.deepEqual(comTudo.provedor.faltando, []);
  });

  teste('validarCredenciais: ok, recusado — e nunca lança', async () => {
    const ok = await adaptador({ cenarioNome: 'validarCredenciais.ok' });
    assert.equal((await ok.provedor.validarCredenciais()).ok, true);
    assert.equal(ok.chamadas.length, 1);
    const recusado = await adaptador({ cenarioNome: 'validarCredenciais.recusado' });
    const r = await recusado.provedor.validarCredenciais();
    assert.equal(r.ok, false);
    assert.ok(r.mensagem);
    const mudo = await adaptador({ rotas: [] });          /* a fixture não prevê a chamada: o fetch falso lança */
    const r2 = await mudo.provedor.validarCredenciais();
    assert.equal(r2.ok, false, 'um erro de rede virou exceção em vez de ok:false');
    for (const s of segredos) assert.ok(!JSON.stringify(r2).includes(s) && !JSON.stringify(r).includes(s), 'segredo na mensagem');
  });

  const capEnvio = () => adaptador().then(({ provedor }) => provedor.capacidades().envio);

  teste('criarUpload: plano de envio completo, coerente com as capacidades, sem a chave de API', async (t) => {
    if (!(await capEnvio())) return t.skip('o adaptador não recebe upload pela mesa');
    const { provedor, chamadas, c } = await adaptador({ cenarioNome: 'criarUpload' });
    const { PROTOCOLOS_UPLOAD } = await contrato();
    const plano = await provedor.criarUpload(Object.assign({ validadeSeg: 3600 }, c.entrada));
    assert.ok(chamadas.length >= 1);
    assert.ok(provedor.padraoId.test(plano.id), 'o id do plano não casa com padraoId');
    assert.ok(PROTOCOLOS_UPLOAD.includes(plano.protocolo) && plano.protocolo !== 'nenhum');
    assert.equal(plano.protocolo, provedor.capacidades().uploadProtocolo);
    assert.ok(['endpoint', 'url-pronta'].includes(plano.modo));
    assert.match(plano.url, /^https:\/\//);
    assert.ok(plano.cabecalhos && Object.values(plano.cabecalhos).every(v => typeof v === 'string'), 'cabeçalhos precisam ser texto');
    assert.ok(plano.metadados && typeof plano.metadados === 'object');
    assert.ok(Number.isInteger(plano.expiraEm) && plano.expiraEm > manifesto.agora / 1000, 'expiraEm é UNIX em SEGUNDOS, no futuro');
    assert.ok(plano.expiraEm < manifesto.agora / 1000 + 24 * 3600 + 1, 'expiraEm em milissegundos?');
    assert.ok(Number.isInteger(plano.pedacoBytes) && plano.pedacoBytes >= 1048576);
    assert.equal(plano.fonte.provedor, id);
    assert.equal(plano.fonte.id, plano.id);
    for (const s of segredos) assert.ok(!JSON.stringify(plano).includes(s), 'a chave de API foi parar no plano de upload');
    conferir(plano, c.esperado, 'plano');
  });

  teste('criarUpload: o provedor recusa, ou não devolve o id — erros de provedor tipados', async (t) => {
    if (!(await capEnvio())) return t.skip('o adaptador não recebe upload pela mesa');
    const { ErroProvedor } = await registro();
    for (const nomeCenario of ['criarUpload.recusado', 'criarUpload.semId']) {
      if (!cenario(nomeCenario)) continue;
      const { provedor, c } = await adaptador({ cenarioNome: nomeCenario });
      await assert.rejects(() => provedor.criarUpload(c.entrada), (e) => {
        assert.ok(e instanceof ErroProvedor, 'não é ErroProvedor: ' + e);
        assert.equal(e.codigo, c.esperado.codigo);
        if (c.esperado.status) assert.equal(e.status, c.esperado.status);
        for (const s of segredos) assert.ok(!JSON.stringify({ m: e.message, d: e.detalhe }).includes(s));
        return true;
      });
    }
    const { provedor } = await adaptador({ rotas: [] });
    await assert.rejects(() => provedor.criarUpload({ titulo: '' }), (e) => e instanceof ErroProvedor && ['parametro-invalido', 'provedor-inacessivel'].includes(e.codigo));
  });

  teste('retomarUpload reassina o MESMO vídeo, no mesmo formato, sem criar outro', async (t) => {
    if (!(await capEnvio())) return t.skip('o adaptador não recebe upload pela mesa');
    const c = cenario('retomarUpload');
    const { provedor, chamadas } = await adaptador({ cenarioNome: 'retomarUpload' });
    const plano = await provedor.retomarUpload(ID, { validadeSeg: 3600 });
    assert.equal(plano.id, ID);
    assert.equal(plano.fonte.id, ID);
    for (const s of segredos) assert.ok(!JSON.stringify(plano).includes(s));
    assert.equal(chamadas.filter(x => x.metodo === 'POST' && /\/videos$/.test(x.url)).length, 0, 'retomar criou um vídeo novo');
    conferir(plano, c.esperado, 'plano');
  });

  teste('statusEncoding: estado normalizado em enviando, processando, pronto e erro', async () => {
    const { ESTADOS } = await contrato();
    for (const estado of ESTADOS) {
      const nomeCenario = 'status.' + estado;
      const c = cenario(nomeCenario);
      if (!c) continue;
      const { provedor } = await adaptador({ cenarioNome: nomeCenario });
      const s = await provedor.statusEncoding(ID);
      assert.ok(ESTADOS.includes(s.estado), 'estado fora do vocabulário: ' + s.estado);
      assert.ok(s.progresso === null || (typeof s.progresso === 'number' && s.progresso >= 0 && s.progresso <= 100));
      assert.ok(s.duracaoSeg === null || typeof s.duracaoSeg === 'number');
      assert.ok('estadoBruto' in s && 'titulo' in s);
      conferir(s, c.esperado, nomeCenario);
    }
    /* A suíte exige os quatro estados: sem eles ninguém prova a normalização. O adaptador que NÃO PODE produzir um
     * (o HLS genérico não tem envio, logo não tem 'enviando') declara no manifesto `estadosInalcancaveis` e o motivo. */
    const inalcancaveis = manifesto.estadosInalcancaveis || [];
    for (const estado of ESTADOS) {
      if (inalcancaveis.includes(estado)) {
        assert.ok(manifesto.motivoDosEstadosInalcancaveis, 'estado inalcançável sem motivo no manifesto');
        assert.ok(!cenario('status.' + estado), 'o estado ' + estado + ' foi declarado inalcançável mas tem fixture');
      } else assert.ok(cenario('status.' + estado), 'falta a fixture status.' + estado + '.json');
    }
  });

  teste('urlReproducao: HLS, MP4 e embed prontos; nenhuma URL liga autoplay; assinar é recusado enquanto não houver assinatura', async () => {
    const { provedor, chamadas } = await adaptador();
    const { ErroProvedor } = await registro();
    const r = await provedor.urlReproducao(ID, {});
    assert.ok(r.hls === null || /^https:\/\//.test(r.hls), 'hls precisa ser https');
    if (r.mp4 !== null) for (const [res, u] of Object.entries(r.mp4)) assert.ok(/^\d+p$/.test(res) && /^https:\/\//.test(u), 'mp4 inválido: ' + res);
    if (r.embed !== null) {
      assert.match(r.embed.url, /^https:\/\//);
      assert.ok(!/autoplay=(true|1)/i.test(r.embed.url), 'o embed liga autoplay');
      assert.ok(!/loop=(true|1)/i.test(r.embed.url), 'o embed liga loop');
      if (r.embed.scriptUrl) assert.match(r.embed.scriptUrl, /^https:\/\//);
    }
    assert.ok('expiraEm' in r);
    assert.equal(r.expiraEm, null, 'URL sem assinatura não expira');
    assert.ok(provedor.configurado ? (r.hls || r.embed || r.mp4) : true, 'configurado e sem nada para tocar');
    const cap = provedor.capacidades();
    if (!cap.assinatura) {
      await assert.rejects(() => provedor.urlReproducao(ID, { assinar: true, validadeSeg: 3600 }),
        (e) => e instanceof ErroProvedor && e.codigo === 'assinatura-indisponivel',
        'pediu assinatura e recebeu URL aberta');
    } else {
      const assinada = await provedor.urlReproducao(ID, { assinar: true, validadeSeg: 3600 });
      assert.ok(Number.isInteger(assinada.expiraEm) && assinada.expiraEm > manifesto.agora / 1000);
      assert.notEqual(assinada.hls, r.hls, 'a URL assinada é igual à aberta');
    }
    assert.equal(chamadas.length, 0, 'montar URL de reprodução foi à rede');
    assert.equal(cap.embed, r.embed !== null, 'capacidades().embed não bate com o que urlReproducao devolve');
    assert.equal(cap.mp4, r.mp4 !== null, 'capacidades().mp4 não bate com o que urlReproducao devolve');
  });

  teste('urlCapa, urlPreview e legendas(idiomas): só montam URL — sem rede, https, com versão e nome seguro', async () => {
    const { provedor, chamadas } = await adaptador();
    const capa = await provedor.urlCapa(ID, {});
    assert.ok(capa === null || /^https:\/\//.test(capa));
    if (capa) {
      const versionada = await provedor.urlCapa(ID, { arquivo: 'thumbnail_ab12.jpg', versao: 1700000000000 });
      assert.match(versionada, /[?&]v=1700000000000$/, 'a versão (contra cache) não entrou na URL');
      /* Um nome de arquivo que mudaria o caminho nunca vira caminho. */
      const hostil = await provedor.urlCapa(ID, { arquivo: '../../etc/passwd', versao: 'a"b' });
      assert.ok(!hostil.includes('..') && !hostil.includes('"'), 'nome ou versão hostil entrou na URL: ' + hostil);
    }
    const previa = await provedor.urlPreview(ID);
    for (const k of ['animada', 'clipeHls', 'sprite']) assert.ok(k in previa && (previa[k] === null || /^https:\/\//.test(previa[k])), 'urlPreview.' + k);
    assert.equal(provedor.capacidades().previa, previa.animada !== null, 'capacidades().previa não bate com urlPreview');
    const legs = await provedor.legendas(ID, { idiomas: ['pt', 'en', 'x"><'] });
    assert.ok(legs.every(l => /^https:\/\//.test(l.url) && l.idioma && l.rotulo), 'faixa de legenda sem url, idioma ou rótulo');
    assert.ok(!legs.some(l => l.idioma.includes('"')), 'idioma hostil virou faixa');
    assert.equal(chamadas.length, 0, 'montar URL foi à rede');
    /* Sem a chave de API em nenhuma URL. */
    for (const s of segredos) assert.ok(![capa, JSON.stringify(previa), JSON.stringify(legs)].join('|').includes(s));
  });

  teste('montarMidia entrega o contrato de `item.midia`, sem rede, e nada para vídeo de outro provedor', async () => {
    const { provedor, chamadas } = await adaptador();
    const { montarMidia } = await registro();
    const midia = await montarMidia(provedor, { fonte: { provedor: id, id: ID, extras: {} }, capa_versao: '5' });
    assert.deepEqual(Object.keys(midia).sort(), ['capa', 'embed', 'expiraEm', 'hls', 'legendas', 'mp4', 'previa']);
    assert.ok(Array.isArray(midia.legendas));
    assert.equal(chamadas.length, 0);
    assert.equal(await montarMidia(provedor, { fonte: { provedor: 'outro-provedor', id: ID, extras: {} } }), null);
    assert.equal(await montarMidia(provedor, { fonte: { provedor: id, id: null, extras: {} } }), null);
    assert.equal(await montarMidia(provedor, {}), null);
    assert.equal(await montarMidia(provedor, { fonte: { provedor: id, id: '../x', extras: {} } }), null);
    /* O JSON da mídia não carrega segredo. */
    for (const s of segredos) assert.ok(!JSON.stringify(midia).includes(s));
  });

  teste('o atalho `midia()` (se existir) dá EXATAMENTE o que a composição das quatro funções dá', async () => {
    const { provedor } = await adaptador();
    const { montarMidia } = await registro();
    if (typeof provedor.midia !== 'function') return;
    const itens = [
      { fonte: { provedor: id, id: ID, extras: {} } },
      { fonte: { provedor: id, id: ID, extras: {} }, capa_arquivo: 'thumbnail_ab12.jpg', capa_versao: 1700000000000 },
      { fonte: { provedor: id, id: ID, extras: {} }, legendas_idiomas: ['pt', 'en', 'x"><'] },
      { fonte: { provedor: id, id: ID, extras: { libraryId: '777' } } }
    ];
    for (const item of itens) {
      const rapida = await montarMidia(provedor, item);
      const composta = await montarMidia(provedor, item, { semAtalho: true });
      assert.deepEqual(rapida, composta, 'o atalho midia() diverge da composição para ' + JSON.stringify(item));
    }
    /* Com assinatura pedida o atalho não vale: a composição decide (e rejeita enquanto não houver). */
    await assert.rejects(() => montarMidia(provedor, itens[0], { assinar: true }), (e) => e.codigo === 'assinatura-indisponivel' || provedor.capacidades().assinatura);
  });

  teste('definirCapa devolve a URL JÁ nova (lição do hash do Bunny), ou recusa se o provedor não troca capa por upload', async (t) => {
    const { ErroProvedor } = await registro();
    const { provedor } = await adaptador();
    if (!provedor.capacidades().capaPorUpload) {
      await assert.rejects(() => provedor.definirCapa(ID, new Uint8Array([1]), 'image/jpeg'), (e) => e instanceof ErroProvedor && e.codigo === 'recurso-indisponivel');
      return;
    }
    for (const nomeCenario of ['definirCapa', 'definirCapa.semNome', 'definirCapa.recusado']) {
      const c = cenario(nomeCenario);
      if (!c) continue;
      const a = await adaptador({ cenarioNome: nomeCenario });
      const bytes = new Uint8Array(c.entrada.bytes);
      if (c.esperado.codigo) {
        await assert.rejects(() => a.provedor.definirCapa(ID, bytes, c.entrada.mime), (e) => e instanceof ErroProvedor && e.codigo === c.esperado.codigo && (!c.esperado.status || e.status === c.esperado.status));
        continue;
      }
      const r = await a.provedor.definirCapa(ID, bytes, c.entrada.mime);
      assert.ok('arquivo' in r && 'urlCapa' in r && 'versao' in r);
      assert.ok(r.urlCapa === null || /^https:\/\//.test(r.urlCapa));
      conferir(r, c.esperado, nomeCenario);
    }
    assert.ok(cenario('definirCapa'), 'o adaptador troca capa por upload e falta a fixture definirCapa.json');
  });

  teste('enviarLegenda manda o arquivo ao provedor; idioma ou arquivo inválido é recusado antes da rede', async (t) => {
    const { ErroProvedor } = await registro();
    const { provedor } = await adaptador();
    if (!provedor.capacidades().legendaPorUpload) {
      await assert.rejects(() => provedor.enviarLegenda(ID, { idioma: 'pt', srt: '1' }), (e) => e instanceof ErroProvedor && e.codigo === 'recurso-indisponivel');
      return;
    }
    const c = cenario('enviarLegenda');
    assert.ok(c, 'falta a fixture enviarLegenda.json');
    const a = await adaptador({ cenarioNome: 'enviarLegenda' });
    conferir(await a.provedor.enviarLegenda(ID, c.entrada), c.esperado, 'enviarLegenda');
    const sem = await adaptador({ rotas: [] });
    for (const ruim of [{ idioma: '../x', srt: 'a' }, { idioma: 'pt', srt: '   ' }, { idioma: '', srt: 'a' }, { idioma: 'pt' }]) {
      await assert.rejects(() => sem.provedor.enviarLegenda(ID, ruim), (e) => e instanceof ErroProvedor && e.codigo === 'parametro-invalido', JSON.stringify(ruim));
    }
    assert.equal(sem.chamadas.length, 0);
  });

  teste('legendas() sem `idiomas` pergunta ao provedor quais faixas existem', async (t) => {
    const c = cenario('legendas.listar');
    if (!c) return t.skip('o adaptador não lista faixas (sem fixture legendas.listar)');
    const { provedor } = await adaptador({ cenarioNome: 'legendas.listar' });
    const legs = await provedor.legendas(ID);
    assert.deepEqual(legs.map(l => l.idioma), c.esperado.idiomas);
    assert.ok(legs[0].url.includes(c.esperado.urlContem));
    assert.ok(legs.every(l => ['ia', 'manual', 'desconhecida'].includes(l.origem)));
  });

  teste('opcionais andam com as capacidades: definirCapitulos, gerarLegendaIA, receberWebhook, uso', async () => {
    const { provedor } = await adaptador();
    const cap = provedor.capacidades();
    if (cap.capitulosNativos) {
      const c = cenario('definirCapitulos');
      assert.ok(c, 'o adaptador tem capítulos nativos e falta a fixture definirCapitulos.json');
      const a = await adaptador({ cenarioNome: 'definirCapitulos' });
      conferir(await a.provedor.definirCapitulos(ID, c.entrada.capitulos), c.esperado, 'definirCapitulos');
    }
    if (cap.legendaIA) assert.equal(typeof provedor.gerarLegendaIA, 'function');
    if (cap.uso) assert.equal(typeof provedor.uso, 'function');
    if (cap.webhooks) assert.equal(typeof provedor.receberWebhook, 'function');
  });

  teste('obterVideo, listar (com paginação) e excluir', async () => {
    const o = cenario('obterVideo');
    const a = await adaptador({ cenarioNome: 'obterVideo' });
    const v = await a.provedor.obterVideo(ID);
    for (const k of ['id', 'titulo', 'duracaoSeg', 'criadoEm', 'tamanhoBytes', 'estado', 'progresso', 'framerate', 'arquivoCapa', 'urlCapa']) assert.ok(k in v, 'obterVideo sem ' + k);
    conferir(v, o.esperado, 'obterVideo');
    for (const nomeCenario of ['listar', 'listar.ultima']) {
      const c = cenario(nomeCenario);
      if (!c) continue;
      const l = await (await adaptador({ cenarioNome: nomeCenario })).provedor.listar(c.entrada);
      assert.equal(l.itens.length, c.esperado.n);
      assert.equal(l.proximo, c.esperado.proximo);
      if (c.esperado.primeiro) conferir(l.itens[0], c.esperado.primeiro, nomeCenario);
    }
    assert.ok(cenario('listar') && cenario('listar.ultima'), 'faltam as fixtures de listagem (com e sem próxima página)');
    const e = cenario('excluir');
    conferir(await (await adaptador({ cenarioNome: 'excluir' })).provedor.excluir(ID), e.esperado, 'excluir');
  });

  teste('falha do provedor vira ErroProvedor com status; o detalhe não vaza a chave de API', async () => {
    const { ErroProvedor } = await registro();
    const nao = cenario('naoEncontrado');
    const a = await adaptador({ cenarioNome: 'naoEncontrado' });
    /* Quem não guarda o arquivo (sem `envio`, como o HLS genérico) não apaga nada: `excluir` não vai à rede. */
    const consultas = ['obterVideo', 'statusEncoding'].concat(a.provedor.capacidades().envio ? ['excluir'] : []);
    for (const fn of consultas) {
      await assert.rejects(() => a.provedor[fn](ID), (e) => e instanceof ErroProvedor && e.status === nao.esperado.status && /^provedor-/.test(e.codigo), fn);
    }
    const c = cenario('erro500');
    const b = await adaptador({ cenarioNome: 'erro500' });
    await assert.rejects(() => b.provedor.obterVideo(ID), (e) => {
      assert.ok(e instanceof ErroProvedor);
      assert.equal(e.status, c.esperado.status);
      for (const s of segredos) assert.ok(!(e.detalhe + e.message).includes(s), 'a chave de API vazou no erro');
      assert.ok(e.detalhe.length <= 400);
      return true;
    });
    /* Rede que cai: provedor-inacessivel, sem a chave. */
    const queda = await adaptador({ rotas: [] });
    await assert.rejects(() => queda.provedor.obterVideo(ID), (e) => e instanceof ErroProvedor && e.codigo === 'provedor-inacessivel');
  });

  teste('receberWebhook normaliza o evento do provedor, e ignora o que não reconhece', async (t) => {
    const { provedor } = await adaptador();
    if (!provedor.capacidades().webhooks) return t.skip('o adaptador não recebe webhook');
    for (const nomeCenario of ['webhook.pronto', 'webhook.erro', 'webhook.processando', 'webhook.outraBiblioteca']) {
      const c = cenario(nomeCenario);
      if (!c) continue;
      const r = await provedor.receberWebhook(new Request('https://exemplo.test/api/webhook', { method: 'POST', body: JSON.stringify(c.pedido), headers: { 'content-type': 'application/json' } }));
      assert.deepEqual(r, c.esperado, nomeCenario);
    }
    for (const lixo of ['isto não é json', '{}', '[]', 'null']) {
      assert.equal(await provedor.receberWebhook(new Request('https://exemplo.test/x', { method: 'POST', body: lixo })), null, JSON.stringify(lixo));
    }
  });

  teste('toda requisição do adaptador é https e a chave de API não vai na URL', async () => {
    const todas = [];
    for (const nomeCenario of ['validarCredenciais.ok', 'criarUpload', 'status.pronto', 'status.processando', 'status.erro', 'obterVideo', 'listar', 'excluir', 'definirCapa', 'enviarLegenda', 'definirCapitulos']) {
      const c = cenario(nomeCenario);
      if (!c) continue;
      const a = await adaptador({ cenarioNome: nomeCenario });
      const { provedor } = a;
      const cap = provedor.capacidades();
      try {
        if (nomeCenario === 'validarCredenciais.ok') await provedor.validarCredenciais();
        else if (nomeCenario === 'criarUpload') { if (cap.envio) await provedor.criarUpload(c.entrada); }
        else if (nomeCenario.startsWith('status.')) await provedor.statusEncoding(ID);
        else if (nomeCenario === 'obterVideo') await provedor.obterVideo(ID);
        else if (nomeCenario === 'listar') await provedor.listar(c.entrada);
        else if (nomeCenario === 'excluir') await provedor.excluir(ID);
        else if (nomeCenario === 'definirCapa') { if (cap.capaPorUpload) await provedor.definirCapa(ID, new Uint8Array(c.entrada.bytes), c.entrada.mime); }
        else if (nomeCenario === 'enviarLegenda') { if (cap.legendaPorUpload) await provedor.enviarLegenda(ID, c.entrada); }
        else if (nomeCenario === 'definirCapitulos') { if (cap.capitulosNativos) await provedor.definirCapitulos(ID, c.entrada.capitulos); }
      } catch (e) { /* o que importa são as chamadas feitas */ }
      todas.push(...a.chamadas);
    }
    assert.ok(todas.length >= 5, 'poucas chamadas conferidas: ' + todas.length);
    for (const ch of todas) {
      assert.match(ch.url, /^https:\/\//, ch.metodo + ' ' + ch.url);
      for (const s of segredos) assert.ok(!ch.url.includes(s), 'a chave de API foi na URL de ' + ch.metodo);
    }
  });
}

const { listarProvedoresSync } = (() => {
  /* `node:test` registra testes de forma síncrona na carga do arquivo; a lista de provedores é
   * estática e pequena, então se lê o diretório em vez de esperar o import dinâmico. */
  const dir = path.join(__dirname, '..', 'core', 'worker', '_lib', 'provedores');
  const ignorados = new Set(['index.js', 'contrato.js']);
  return { listarProvedoresSync: () => fs.readdirSync(dir).filter(f => f.endsWith('.js') && !ignorados.has(f)).map(f => f.replace(/\.js$/, '')) };
})();

/* Suíte 1: cada adaptador com fixtures. Os sem fixtures aparecem como pulados. */
const executados = [];
for (const id of listarProvedoresSync()) {
  const fx = lerFixtures(id);
  if (!fx) {
    test('[' + id + '] suíte de contrato', { skip: 'sem fixtures em tests/fixtures/provedores/' + id + '/ (veja o LEIA-ME.md de lá)' }, () => {});
    continue;
  }
  executados.push(id);
  suite(id, fx);
}

/* Suíte 2: regras do próprio registro e do contrato (não dependem de adaptador). */
test('o registro lista os provedores do enum `video.provedor` do schema, e só eles', async () => {
  const { listarProvedores } = await registro();
  const esquema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'site.schema.json'), 'utf8'));
  assert.deepEqual(listarProvedores().sort(), esquema.properties.video.properties.provedor.enum.slice().sort());
  assert.deepEqual(listarProvedoresSync().sort(), listarProvedores().sort(), 'há módulo em provedores/ que o registro não conhece (ou o contrário)');
});

test('a suíte de contrato rodou para o Bunny (o adaptador de referência)', () => {
  assert.ok(executados.includes('bunny'), 'sem fixtures do bunny a suíte não prova nada');
});

test('cada adaptador declara ID, CHAVE_CONFIG, CREDENCIAIS e criar(), e as chaves de CREDENCIAIS existem no schema', async () => {
  const { listarProvedores, moduloDe } = await registro();
  const esquema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'site.schema.json'), 'utf8'));
  for (const id of listarProvedores()) {
    const m = moduloDe(id);
    assert.equal(m.ID, id);
    assert.equal(typeof m.criar, 'function');
    const bloco = esquema.properties.video.properties[m.CHAVE_CONFIG];
    assert.ok(bloco, id + ': video.' + m.CHAVE_CONFIG + ' não existe no schema');
    for (const [nome, def] of Object.entries(m.CREDENCIAIS)) {
      assert.ok(bloco.properties[nome], id + ': a credencial `' + nome + '` não existe em video.' + m.CHAVE_CONFIG + ' do schema');
      assert.match(def.env, /^[A-Z][A-Z0-9_]{1,63}$/, id + ': nome de variável de ambiente inválido em ' + nome);
    }
  }
});

test('o registro resolve credenciais por {"$env":...} da config, e cai no nome padrão da variável quando a config não diz', async () => {
  const { criarProvedor } = await registro();
  const cfg = { video: { provedor: 'bunny', bunny: { bibliotecaId: { $env: 'MINHA_BIBLIOTECA' }, chaveApi: { $env: 'MINHA_CHAVE' } } } };
  const p = criarProvedor(cfg, { MINHA_BIBLIOTECA: '77', MINHA_CHAVE: 'k-1234', BUNNY_LIBRARY_ID: 'padrao', BUNNY_API_KEY: 'padrao' });
  assert.equal(p.configurado, true);
  const plano = await p.retomarUpload('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', {});
  assert.equal(plano.cabecalhos.LibraryId, '77', 'a variável da config não foi a usada');
  /* Referência que aponta para variável ausente NÃO cai no padrão: erro de configuração fica visível. */
  const ausente = criarProvedor(cfg, { BUNNY_LIBRARY_ID: 'padrao', BUNNY_API_KEY: 'padrao' });
  assert.equal(ausente.configurado, false);
  assert.deepEqual([...ausente.faltando].sort(), ['BUNNY_API_KEY', 'BUNNY_LIBRARY_ID']);
  /* Sem config (falha de configuração) vale o padrão: bunny, nomes padrão. */
  assert.equal(criarProvedor(null, { BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'x' }).configurado, true);
  /* Valor literal no lugar de {"$env"} nunca é aceito como segredo. */
  const literal = criarProvedor({ video: { bunny: { chaveApi: 'segredo-em-texto', bibliotecaId: '1' } } }, {});
  assert.equal(literal.configurado, false);
});

test('o contrato: validarAdaptador acusa o que falta, e o ErroProvedor é curto e sem segredo', async () => {
  const { validarAdaptador, ErroProvedor, mascarar } = await contrato();
  assert.ok(validarAdaptador({}).length > 5);
  assert.ok(validarAdaptador(null).length === 1);
  const e = new ErroProvedor('provedor-recusou-consulta', { status: 502, detalhe: 'x'.repeat(1000) });
  assert.equal(e.detalhe.length, 400);
  assert.equal(e.name, 'ErroProvedor');
  assert.equal(mascarar('a chave k-1234 vazou k-1234', ['k-1234']), 'a chave *** vazou ***');
  assert.equal(mascarar('curto', ['ab']), 'curto', 'segredo curto demais não vira máscara (apagaria o texto)');
});

test('todo código de erro de provedor tem mensagem nos três idiomas', async () => {
  const { CODIGOS_ERRO } = await contrato();
  for (const lingua of ['pt-BR', 'en', 'es']) {
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'core', 'locales', lingua + '.json'), 'utf8'));
    for (const codigo of CODIGOS_ERRO) assert.ok(cat['api.' + codigo], lingua + ': falta api.' + codigo);
  }
});
