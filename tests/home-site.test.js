/* M6 — o site (app.js) rodando DE VERDADE num DOM falso: a chegada por blocos, os blocos de texto, banner e busca, a Minha lista
 * (botão e fileira), o modelo avulso, o "continuar assistindo" e o registro opcional do service worker.
 *
 * O que estes testes protegem e os de texto não alcançam: o app.js é um arquivo de 3 mil linhas que declara tudo com `function`,
 * e uma função nova com o nome de uma que já existe a SUBSTITUI sem aviso (foi o primeiro defeito que este arquivo achou). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { abrirSite, SITE } = require('./home-dom-falso.js');

const itens = [].concat(
  ['a', 'b', 'c', 'd'].map((id, i) => ({ id, titulo: 'Título ' + id, serie: 'Série X', temporada: 1, episodio: i + 1, duracao_seg: 900, publicar: true, midia: { capa: 'https://cdn.exemplo.test/' + id + '.jpg' } })),
  [{ id: 'e', titulo: 'Solto', serie: 'Eventos', duracao_seg: 60, publicar: true, midia: {} }]
);

const catalogo = (extra) => Object.assign({ rev: 1, itens, site: {}, quem: {} }, extra || {});

const secoes = (s) => s.porId['conteudo-grade'].children;
const titulosDasFileiras = (s) => s.porId['conteudo-grade'].querySelectorAll('.prateleira-titulo').map((n) => n.textContent);
const tags = (s, tag) => s.porId['conteudo-grade'].querySelectorAll(tag);
const nenhumPlay = (s) => {
  const videos = s.doc.body.querySelectorAll('video').concat(s.porId['conteudo-grade'].querySelectorAll('video'));
  assert.deepEqual(videos.filter((v) => v.chamadasDePlay.length), [], 'algum <video> recebeu play()');
};

/* ---------------------------------------------------------------------- */

test('app.js: nenhuma função declarada duas vezes no mesmo escopo (a segunda substitui a primeira em silêncio)', () => {
  const fonte = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n');
  const vistos = {};
  const repetidas = [];
  fonte.forEach((linha, i) => {
    const m = linha.match(/^  function ([A-Za-z_$][\w$]*)\(/);   /* só as do primeiro nível da IIFE */
    if (!m) return;
    if (vistos[m[1]]) repetidas.push(m[1] + ' (linhas ' + vistos[m[1]] + ' e ' + (i + 1) + ')');
    vistos[m[1]] = i + 1;
  });
  assert.deepEqual(repetidas, []);
});

test('a chegada padrão: o destaque e as fileiras de sempre, com os mesmos títulos que o core calcula, e nada toca', async () => {
  const s = await abrirSite({ rotas: { '/api/catalogo': catalogo() } });
  const filhos = secoes(s);
  assert.equal(filhos[0].className, 'destaque');
  const App = s.ctx.App;
  const esperado = App.prateleirasVisiveis(itens, {}).map((p) => p.titulo);
  assert.deepEqual(Array.from(titulosDasFileiras(s)), Array.from(esperado));
  assert.ok(esperado.length >= 1);
  /* Fundo = capa (o padrão): nenhum <video> nasce na chegada. */
  assert.equal(s.doc.body.querySelectorAll('video').length, 0);
  nenhumPlay(s);
  assert.deepEqual(s.pedidos.filter((p) => /\/api\/minha-lista/.test(p.url)), [], 'a home pediu a lista de quem não tem conta');
});

test('blocos escolhidos: ordem da lista, escondido some, texto entra como TEXTO, banner com link e imagem, e a busca funciona', async () => {
  const blocos = [
    { id: 'aviso', tipo: 'texto', titulo: { 'pt-BR': 'Aviso' }, texto: { 'pt-BR': 'Primeira linha.\n\n<img src=x onerror=alert(1)> Segundo.' } },
    { id: 'faixa', tipo: 'banner', texto: 'Venha conhecer', imagem: 'marca/faixa.jpg', link: 'https://exemplo.com/mais' },
    { id: 'achar', tipo: 'busca', titulo: 'Procure aqui' },
    { id: 'sel', tipo: 'carrossel', titulos: ['b', 'a'], titulo: 'Escolhas' },
    { id: 'fora', tipo: 'carrossel', titulos: ['c'], titulo: 'Escondida', escondido: true },
    { id: 'destaque', tipo: 'destaque' }
  ];
  const s = await abrirSite({ rotas: { '/api/catalogo': catalogo({ site: { blocos } }) } });
  const classes = secoes(s).map((n) => n.className);
  assert.deepEqual(classes, ['bloco-texto bloco-texto-texto', 'bloco-texto bloco-texto-banner', 'bloco-busca', 'prateleira', 'destaque'], 'a ordem da lista não mandou, ou o escondido apareceu');

  /* O bloco de busca tem nome acessível: o <section role=search> aponta para o seu <h2>. */
  const busca = secoes(s)[2];
  const ref = busca.getAttribute('aria-labelledby');
  assert.ok(ref, 'section.bloco-busca sem aria-labelledby');
  assert.equal(busca.querySelector('h2').id, ref);
  assert.match(busca.querySelector('h2').textContent, /Procure aqui/);

  const aviso = secoes(s)[0];
  assert.match(aviso.textContent, /Aviso/);
  assert.match(aviso.textContent, /<img src=x onerror=alert\(1\)> Segundo\./, 'o texto do cliente foi interpretado como marcação');
  assert.equal(aviso.querySelectorAll('img').length, 0, 'texto virou <img>');
  assert.equal(aviso.querySelectorAll('p').length, 2, 'a linha em branco não separou os parágrafos');

  const faixa = secoes(s)[1];
  assert.equal(faixa.querySelector('img').getAttribute('src'), 'marca/faixa.jpg');
  const link = faixa.querySelector('a');
  assert.equal(link.getAttribute('href'), 'https://exemplo.com/mais');
  assert.match(link.getAttribute('rel'), /noopener/);

  assert.deepEqual(titulosDasFileiras(s), ['Escolhas']);
  const hrefs = secoes(s)[3].querySelectorAll('a').map((a) => a.getAttribute('href')).filter((h) => /#\/ep\//.test(h));
  assert.deepEqual(Array.from(hrefs.slice(0, 2)), ['#/ep/b', '#/ep/a'], 'a seleção manual não segue a ordem escolhida');

  /* A busca em destaque usa o mesmo campo do cabeçalho. */
  const form = secoes(s)[2].querySelector('form');
  const campo = form.querySelector('input');
  campo.value = 'Título c';
  const ev = form.disparar('submit');
  assert.equal(ev.padraoEvitado, true);
  assert.equal(s.porId.busca.value, 'Título c', 'a busca em destaque não levou o termo ao campo do cabeçalho');
  nenhumPlay(s);
});

test('visibilidade: bloco "só com conta" só aparece para quem o servidor diz que está logado', async () => {
  const blocos = [
    { id: 'a', tipo: 'carrossel', titulos: ['a'], titulo: 'Para todos' },
    { id: 'b', tipo: 'carrossel', titulos: ['b'], titulo: 'Só com conta', visibilidade: 'logado' },
    { id: 'c', tipo: 'carrossel', titulos: ['c'], titulo: 'Só sem conta', visibilidade: 'anonimo' }
  ];
  const anonimo = await abrirSite({ rotas: { '/api/catalogo': catalogo({ site: { blocos } }) } });
  assert.deepEqual(titulosDasFileiras(anonimo), ['Para todos', 'Só sem conta']);
  const logado = await abrirSite({ rotas: { '/api/catalogo': catalogo({ site: { blocos }, quem: { logado: true, espectador: true, minhaLista: false } }) } });
  assert.deepEqual(titulosDasFileiras(logado), ['Para todos', 'Só com conta']);
});

test('Minha lista: o bloco só aparece com conta, depois de a lista chegar; o botão guarda, tira e desfaz quando o servidor recusa', async () => {
  const blocos = [{ id: 'destaque', tipo: 'destaque' }, { id: 'lista', tipo: 'minha-lista', titulo: 'Minha lista' }];
  const quem = { logado: true, espectador: true, minhaLista: true };
  let listaDoServidor = ['c', 'nao-existe', 'e'];
  let respostaDoPost = { status: 200, corpo: { ok: true } };
  const resposta = (r) => new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
  const s = await abrirSite({
    rotas: {
      '/api/catalogo': catalogo({ site: { blocos }, quem }),
      '/api/minha-lista': (url, init) => (init.method === 'POST' ? resposta(respostaDoPost) : init.method === 'DELETE' ? { ok: true } : { ids: listaDoServidor })
    }
  });
  assert.deepEqual(titulosDasFileiras(s), ['Minha lista'], 'a fileira não entrou depois da lista chegar');
  const fileira = tags(s, 'section').find((n) => n.className === 'prateleira');
  const ordem = fileira.querySelectorAll('a').map((a) => a.getAttribute('href')).filter((h) => /#\/ep\//.test(h));
  assert.deepEqual(ordem.slice(0, 2), ['#/ep/c', '#/ep/e'], 'a lista não seguiu a ordem em que foi guardada (e ignorar o título que saiu do ar)');

  /* O botão do destaque (sem série grande, o destaque é o primeiro da ordem: 'e', que já está na lista). */
  const botao = secoes(s)[0].querySelector('.botao-minha-lista');
  assert.ok(botao, 'o destaque não tem o botão da Minha lista');
  assert.equal(botao.getAttribute('aria-pressed'), 'true');
  assert.equal(botao.textContent, s.ctx.AppI18n.t('home.naMinhaLista'));

  botao.click();
  assert.equal(botao.getAttribute('aria-pressed'), 'false', 'o botão não mudou na hora (otimista)');
  await new Promise((r) => setImmediate(r));
  const del = s.pedidos.filter((p) => p.metodo === 'DELETE');
  assert.equal(del.length, 1);
  assert.match(del[0].url, /\/api\/minha-lista\?id=e$/);

  respostaDoPost = { status: 409, corpo: { codigo: 'minha-lista-cheia', mensagem: 'cheia' } };
  botao.click();
  assert.equal(botao.getAttribute('aria-pressed'), 'true');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const posts = s.pedidos.filter((p) => p.metodo === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].corpo), { id: 'e' });
  assert.equal(botao.getAttribute('aria-pressed'), 'false', 'o servidor recusou e o botão não voltou atrás');
  nenhumPlay(s);
});

test('Minha lista: sem conta ou com o recurso desligado o site nem pergunta pela lista e não mostra o botão', async () => {
  for (const quem of [{}, { logado: true, espectador: false, minhaLista: true }, { logado: true, espectador: true, minhaLista: false }]) {
    const s = await abrirSite({ rotas: { '/api/catalogo': catalogo({ site: { blocos: [{ tipo: 'destaque' }, { tipo: 'minha-lista' }] }, quem }), '/api/minha-lista': { ids: ['a'] } } });
    assert.deepEqual(s.pedidos.filter((p) => /minha-lista/.test(p.url)), [], JSON.stringify(quem));
    assert.equal(s.porId['conteudo-grade'].querySelectorAll('.botao-minha-lista').length, 0, JSON.stringify(quem));
    assert.deepEqual(titulosDasFileiras(s), []);
  }
});

test('continuar assistindo: vem da memória do navegador, sem o título terminado, e só leva à ficha', async () => {
  const guardado = { 'tm:onde-parou': JSON.stringify({ b: { t: 100, d: 900, q: 20 }, c: { t: 200, d: 900, q: 30 }, d: { t: 890, d: 900, q: 40 } }) };
  const s = await abrirSite({
    armazenamento: guardado,
    rotas: { '/api/catalogo': catalogo({ site: { blocos: [{ id: 'continuar', tipo: 'continuar-assistindo' }] } }) }
  });
  assert.deepEqual(titulosDasFileiras(s), [s.ctx.AppI18n.t('home.continuarAssistindo')]);
  const hrefs = secoes(s)[0].querySelectorAll('a').map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('#/ep/c') && hrefs.includes('#/ep/b') && !hrefs.includes('#/ep/d'));
  assert.ok(hrefs.indexOf('#/ep/c') < hrefs.indexOf('#/ep/b'), 'o visto por último não veio primeiro');
  nenhumPlay(s);
});

test('modelo avulso: a chegada sem "T1 E3", sem o link Séries, e a lista padrão do avulso', async () => {
  const soSerie = itens.filter((i) => i.serie === 'Série X');
  const seriado = await abrirSite({ rotas: { '/api/catalogo': catalogo({ itens: soSerie }) } });
  const avulso = await abrirSite({ rotas: { '/api/catalogo': catalogo({ itens: soSerie, site: { modeloDeConteudo: 'avulso' } }) } });
  assert.equal(seriado.doc.querySelector('.topo-link[href="#/series"]').hidden, false);
  assert.equal(avulso.doc.querySelector('.topo-link[href="#/series"]').hidden, true);
  const meta = (s) => secoes(s)[0].querySelector('.destaque-serie').textContent;
  assert.match(meta(seriado), /Série X · /, 'o seriado perdeu o rótulo do episódio');
  assert.equal(meta(avulso), 'Série X', 'o avulso mostrou o rótulo do episódio');
  assert.ok(titulosDasFileiras(avulso).includes(avulso.ctx.AppI18n.t('home.novidades')), 'o avulso não começa pelas novidades');
});

test('a home sem nenhum bloco visível mostra o aviso de "nada ainda", e a mesa vê todos os blocos', async () => {
  const vazio = await abrirSite({ rotas: { '/api/catalogo': catalogo({ itens: [] }) } });
  assert.equal(secoes(vazio).length, 1);
  assert.match(secoes(vazio)[0].textContent, new RegExp(vazio.ctx.AppI18n.t('site.nadaAindaTitulo')));
});

test('service worker: ligado no config, registra /sw.js uma vez; desligado, só pede que o antigo se atualize e se desinstale', async () => {
  const publica = JSON.parse(fs.readFileSync(path.join(SITE, 'config.public.json'), 'utf8'));
  const chamadas = { registrar: [], atualizar: 0 };
  const sw = {
    register: (url, opcoes) => { chamadas.registrar.push([url, opcoes]); return Promise.resolve({}); },
    getRegistrations: () => Promise.resolve([{ active: { scriptURL: 'https://exemplo.test/sw.js' }, update: () => { chamadas.atualizar++; return Promise.resolve(); } },
      { active: { scriptURL: 'https://exemplo.test/outro-app/sw.js' }, update: () => { chamadas.atualizar += 100; return Promise.resolve(); } }])
  };
  const ligado = Object.assign({}, publica, { recursos: Object.assign({}, publica.recursos, { pwaCacheDoShell: true }) });
  await abrirSite({ rotas: { '/api/catalogo': catalogo(), '/config.public.json': ligado }, antes(janela) { janela.navigator.serviceWorker = sw; } });
  assert.deepEqual(JSON.parse(JSON.stringify(chamadas.registrar)), [['/sw.js', { scope: '/' }]], 'ligado: o site não registrou o sw.js uma vez');
  assert.equal(chamadas.atualizar, 0);

  chamadas.registrar.length = 0;
  await abrirSite({ rotas: { '/api/catalogo': catalogo() }, antes(janela) { janela.navigator.serviceWorker = sw; } });
  assert.deepEqual(JSON.parse(JSON.stringify(chamadas.registrar)), [], 'o padrão (desligado) registrou um service worker');
  assert.equal(chamadas.atualizar, 1, 'desligado: só o sw.js desta instalação deve ser relido (e nunca o de outro app)');

  /* Sem suporte do navegador, nada acontece nem quebra. */
  await abrirSite({ rotas: { '/api/catalogo': catalogo(), '/config.public.json': ligado } });
});
