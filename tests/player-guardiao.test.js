/* Testes do guardião do player (M6, decisão D-8) e das opções `player.*`.
 *
 *   - a regra estática: `.play()` só em `tocarPorGesto` e `tocarAutomatico`, e
 *     esta COMEÇA pelo guardião; nenhum outro arquivo do site chama play();
 *   - o guardião puro (guardiao.js): `autoplay.modo: 'nunca'` nunca deixa, e
 *     NENHUMA combinação de opções produz som sem gesto;
 *   - o player de verdade, num `vm` com DOM falso (tests/player-dom-falso.js):
 *     com a config padrão nada toca sozinho, e cada opção faz só o que diz;
 *   - mensagem amigável e traduzida quando o vídeo falha ao carregar;
 *   - a config `player.*` no schema e na resposta do catálogo. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Guardiao = require('../core/site/guardiao.js');
const { carregar, SITE } = require('./player-dom-falso.js');

const lerTexto = (c) => fs.readFileSync(c, 'utf8').split('\r\n').join('\n');

/* Tira comentários de bloco sem entrar em texto entre aspas (mesma ideia do
 * catalogo.test.js: citar `play()` num comentário é permitido, usar não). */
const semComentarios = (js) => {
  let fora = '', modo = 'codigo', aspas = '';
  for (let i = 0; i < js.length; i++) {
    const c = js[i], d = js[i + 1];
    if (modo === 'codigo') {
      if (c === '/' && d === '*') { modo = 'bloco'; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { modo = 'texto'; aspas = c; }
      fora += c;
    } else if (modo === 'bloco') {
      if (c === '*' && d === '/') { modo = 'codigo'; i++; }
    } else {
      if (c === '\\') { fora += js.slice(i, i + 2); i++; continue; }
      if (c === aspas) modo = 'codigo';
      fora += c;
    }
  }
  return fora;
};

/* ============================================================ regra estática */

test('play() só em tocarPorGesto e tocarAutomatico, e esta começa pelo guardião', () => {
  const codigo = semComentarios(lerTexto(path.join(SITE, 'player.js')));
  assert.equal((codigo.match(/\.play\s*\(/g) || []).length, 2);
  const corpo = (nome) => codigo.match(new RegExp('function ' + nome + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n    \\}'))[1];
  assert.equal((corpo('tocarPorGesto').match(/\.play\s*\(/g) || []).length, 1);
  const auto = corpo('tocarAutomatico');
  assert.equal((auto.match(/\.play\s*\(/g) || []).length, 1);
  assert.match(auto, /^\s*var contexto = contextoDeInicio\(origem\);\s*if \(!AppPlayerCore\.podeIniciarSozinho\(contexto, config\)\) return false;/);
  /* O <video> nunca recebe o atributo autoplay. */
  assert.ok(!/autoplay\s*=\s*(true|attrs\.autoplay\s*\|\|)/.test(codigo));
  assert.equal(require('../core/site/player-core.js').atributosVideo().autoplay, false);
});

test('nenhum outro arquivo do site chama play() além do player e do fundo do destaque', () => {
  const permitidos = new Set(['player.js', 'destaque-fundo.js']);
  for (const arquivo of fs.readdirSync(SITE).filter((f) => f.endsWith('.js'))) {
    if (permitidos.has(arquivo)) continue;
    const js = semComentarios(lerTexto(path.join(SITE, arquivo)));
    assert.ok(!/\.play\s*\(/.test(js), arquivo + ' chama play()');
  }
  /* Nem as páginas inline. */
  for (const arquivo of fs.readdirSync(SITE).filter((f) => f.endsWith('.html'))) {
    assert.ok(!/\.play\s*\(/.test(lerTexto(path.join(SITE, arquivo))), arquivo + ' chama play()');
  }
});

test('o guardião é UM só: o player-core e o destaque-fundo usam o do guardiao.js', () => {
  const core = require('../core/site/player-core.js');
  assert.equal(core.podeIniciarSozinho, Guardiao.podeIniciarSozinho);
  assert.equal(core.decisaoDeInicio, Guardiao.decisaoDeInicio);
  const fundo = lerTexto(path.join(SITE, 'destaque-fundo.js'));
  assert.match(fundo, /raiz\.AppGuardiao/);
  assert.ok(!/function podeIniciarSozinho/.test(fundo));
});

/* ========================================================= guardião (puro) */

const MODOS = ['nunca', 'mudo', 'com-som-apos-interacao'];
const PROXIMOS = ['nunca', 'perguntar', 'automatico'];

function todosOsContextos() {
  const lista = [];
  for (const origem of ['autoplay', 'proximo-episodio', 'fundo-mudo', 'outra'])
    for (const jaInteragiu of [true, false, undefined])
      for (const telaPequena of [true, false, undefined])
        for (const economiaDeDados of [true, false, undefined])
          for (const movimentoReduzido of [true, false, undefined])
            for (const visivel of [true, false, undefined])
              lista.push({ origem, jaInteragiu, telaPequena, economiaDeDados, movimentoReduzido, visivel });
  return lista;
}
const ABERTO = { jaInteragiu: true, telaPequena: false, economiaDeDados: false, movimentoReduzido: false, visivel: true };

test('config padrão: nada toca, nada avança, nada retoma — é o comportamento de sempre', () => {
  const c = Guardiao.configDoPlayer({});
  assert.equal(c.autoplay.modo, 'nunca');
  assert.equal(c.proximoEpisodio.modo, 'nunca');
  assert.equal(c.retomar.modo, 'nunca');
  assert.equal(c.marcaDagua.ligada, false);
  assert.equal(c.download.ligado, false);
  assert.deepEqual(c.velocidades, [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  assert.deepEqual(c.velocidades, require('../core/site/player-core.js').VELOCIDADES);
  assert.equal(Guardiao.fundoDoDestaque({}).tipo, 'capa');
  /* E o arquivo de exemplo do repositório diz o mesmo. */
  const site = JSON.parse(lerTexto(path.join(__dirname, '..', 'config', 'site.json')));
  assert.deepEqual(Guardiao.configDoPlayer(site), c);
  for (const lixo of [null, undefined, 3, 'x', [], { player: 7 }, { player: { autoplay: { modo: 'sempre' } } }]) {
    assert.equal(Guardiao.configDoPlayer(lixo).autoplay.modo, 'nunca');
  }
});

test('com autoplay.modo "nunca" o guardião nunca deixa, para qualquer origem e contexto', () => {
  for (const proximo of PROXIMOS) {
    const config = { player: { autoplay: { modo: 'nunca' }, proximoEpisodio: { modo: proximo } } };
    for (const contexto of todosOsContextos()) {
      if (contexto.origem === 'fundo-mudo') continue;       /* o fundo tem a sua própria chave (home.destaque.fundo) */
      assert.equal(Guardiao.podeIniciarSozinho(contexto, config), false, JSON.stringify(contexto));
    }
  }
  assert.equal(Guardiao.podeIniciarSozinho({ origem: 'autoplay', ...ABERTO }, undefined), false);
});

test('nenhuma opção produz ÁUDIO sem gesto', () => {
  let liberados = 0;
  for (const modo of MODOS) for (const proximo of PROXIMOS) {
    const config = {
      player: { autoplay: { modo, somenteDesktop: false, respeitarEconomiaDeDados: false }, proximoEpisodio: { modo: proximo } },
      home: { destaque: { fundo: { tipo: 'video-mudo', somenteDesktop: false } } }
    };
    for (const contexto of todosOsContextos()) {
      const d = Guardiao.decisaoDeInicio(contexto, config);
      assert.equal(typeof d.pode, 'boolean');
      assert.equal(Guardiao.podeIniciarSozinho(contexto, config), d.pode);
      if (!d.pode) continue;
      liberados++;
      if (!d.mudo) {
        /* Som só com gesto anterior E no modo que o promete. */
        assert.equal(contexto.jaInteragiu, true, 'som sem interação: ' + JSON.stringify([contexto, config.player]));
        assert.equal(modo, 'com-som-apos-interacao');
        assert.notEqual(contexto.origem, 'fundo-mudo');
      }
      if (contexto.origem === 'fundo-mudo') assert.equal(d.mudo, true);
    }
  }
  assert.ok(liberados > 100, 'o teste não exercitou nenhum caso liberado');
});

test('autoplay mudo: só em desktop, com dados e movimento normais, e sai mudo', () => {
  const config = { player: { autoplay: { modo: 'mudo' } } };
  const base = { origem: 'autoplay', ...ABERTO };
  assert.deepEqual(Guardiao.decisaoDeInicio(base, config), { pode: true, mudo: true, motivo: 'autoplay' });
  assert.equal(Guardiao.podeIniciarSozinho({ ...base, telaPequena: true }, config), false);
  assert.equal(Guardiao.podeIniciarSozinho({ ...base, economiaDeDados: true }, config), false);
  assert.equal(Guardiao.podeIniciarSozinho({ ...base, movimentoReduzido: true }, config), false);
  assert.equal(Guardiao.podeIniciarSozinho({ ...base, visivel: false }, config), false);
  /* Dado ausente = fechado. */
  assert.equal(Guardiao.podeIniciarSozinho({ origem: 'autoplay', visivel: true }, config), false);
});

test('com-som-apos-interacao: sem interação não começa; com interação, começa com som', () => {
  const config = { player: { autoplay: { modo: 'com-som-apos-interacao' } } };
  const base = { origem: 'autoplay', ...ABERTO };
  assert.equal(Guardiao.podeIniciarSozinho({ ...base, jaInteragiu: false }, config), false);
  assert.deepEqual(Guardiao.decisaoDeInicio(base, config), { pode: true, mudo: false, motivo: 'autoplay' });
});

test('próximo episódio automático só vale com autoplay ligado; senão vira "perguntar"', () => {
  const sem = { player: { autoplay: { modo: 'nunca' }, proximoEpisodio: { modo: 'automatico' } } };
  assert.equal(Guardiao.proximoEfetivo(sem), 'perguntar');
  assert.equal(Guardiao.podeIniciarSozinho({ origem: 'proximo-episodio', ...ABERTO }, sem), false);
  const com = { player: { autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'automatico' } } };
  assert.equal(Guardiao.proximoEfetivo(com), 'automatico');
  assert.deepEqual(Guardiao.decisaoDeInicio({ origem: 'proximo-episodio', ...ABERTO }, com),
    { pode: true, mudo: true, motivo: 'proximo-episodio' });
  const perg = { player: { autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'perguntar' } } };
  assert.equal(Guardiao.podeIniciarSozinho({ origem: 'proximo-episodio', ...ABERTO }, perg), false);
});

test('cartão e contagem do próximo episódio, e o ponto de retomada', () => {
  const perg = { player: { autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'perguntar', mostrarCartaoNosUltimosSeg: 20, segundosDeContagem: 8 } } };
  assert.equal(Guardiao.cartaoDoProximoVisivel(70, 100, perg, true), false);
  assert.equal(Guardiao.cartaoDoProximoVisivel(85, 100, perg, true), true);
  assert.equal(Guardiao.cartaoDoProximoVisivel(85, 100, perg, false), false, 'sem próximo não há cartão');
  assert.equal(Guardiao.contagemDoProximo(95, 100, perg), null, 'perguntar não conta');
  const auto = { player: { autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'automatico', segundosDeContagem: 8 } } };
  assert.equal(Guardiao.contagemDoProximo(85, 100, auto), null);
  assert.equal(Guardiao.contagemDoProximo(95, 100, auto), 5);
  assert.equal(Guardiao.contagemDoProximo(100, 100, auto), 0);
  assert.equal(Guardiao.cartaoDoProximoVisivel(95, 100, {}, true), false, 'padrão: nunca');
  /* Retomar */
  const ret = (modo) => ({ player: { retomar: { modo } } });
  assert.equal(Guardiao.pontoParaRetomar({ t: 40 }, ret('nunca'), 0), null);
  assert.equal(Guardiao.pontoParaRetomar({ t: 40 }, ret('perguntar'), 0), 40);
  assert.equal(Guardiao.pontoParaRetomar({ t: 40 }, ret('automatico'), 12), null, 'o ?t= manda mais');
  assert.equal(Guardiao.pontoParaRetomar({ t: 2 }, ret('automatico'), 0), null, 'o começo não conta');
  assert.equal(Guardiao.pontoParaRetomar(null, ret('automatico'), 0), null);
});

test('velocidades e fundo: saneamento e nomes antigos', () => {
  assert.deepEqual(Guardiao.configDoPlayer({ velocidades: [2, 0.5, 1.5] }).velocidades, [0.5, 1, 1.5, 2]);
  assert.deepEqual(Guardiao.configDoPlayer({ velocidades: [9, 'a'] }).velocidades, Guardiao.VELOCIDADES_PADRAO);
  assert.equal(Guardiao.configDoPlayer({ proximoEpisodio: { modo: 'desligado' } }).proximoEpisodio.modo, 'nunca');
  assert.equal(Guardiao.configDoPlayer({ retomar: { modo: 'sempre' } }).retomar.modo, 'automatico');
  assert.equal(Guardiao.fundoDoDestaque({ home: { destaque: { fundo: { tipo: 'imagem' } } } }).tipo, 'capa');
  assert.equal(Guardiao.fundoDoDestaque({ tipo: 'video-mudo' }).tipo, 'video-mudo');
  assert.equal(Guardiao.fundoDoDestaque({ tipo: 'video-mudo' }).somenteDesktop, true, 'desligado no celular por padrão');
  assert.equal(Guardiao.fundoDoDestaque({ tipo: 'video-mudo', atrasoMs: 99999 }).atrasoMs, 10000);
  assert.deepEqual(Guardiao.configDoPlayer({ marcaDagua: { ligada: true, texto: '  Fulano  ' } }).marcaDagua, { ligada: true, texto: 'Fulano' });
  assert.equal(Guardiao.configDoPlayer({ marcaDagua: { ligada: true } }).marcaDagua.ligada, false, 'sem texto não há marca');
});

/* ========================================== o player de verdade (vm + DOM falso) */

const ITEM = { id: 'ep1', titulo: 'Episódio 1', duracao_seg: 100, midia: { mp4: { '360p': 'https://exemplo.test/v.mp4' }, capa: 'https://exemplo.test/c.jpg' } };
const PROX = { id: 'ep2', titulo: 'Episódio 2' };
const DESKTOP = (q) => !/max-width|pointer: coarse|reduced-motion/.test(q) ? false : false;

function montar(player, opcoes = {}, ganchos = {}, item = ITEM) {
  const amb = carregar(['guardiao.js', 'player-core.js', 'player.js'], { matchMedia: DESKTOP, ...opcoes });
  const abertos = [];
  const g = { proximo: PROX, abrirProximo: (alvo, o) => abertos.push({ alvo, ...o }), ...ganchos };
  const p = amb.janela.AppPlayer.criar(item, { player }, g);
  amb.janela.__correr();
  return { ...amb, p, video: p.video, abertos, plays: () => p.video.chamadasDePlay };
}

function cenaFinal(m, t) {
  m.video.duration = 100;
  m.video.currentTime = t;
  m.video.disparar('timeupdate');
}

test('config padrão: criar o player, abrir a ficha e chegar ao fim não dá play nem avança', () => {
  const m = montar({});
  assert.equal(m.plays().length, 0);
  cenaFinal(m, 99.9);
  m.video.ended = true;
  m.video.disparar('timeupdate');
  assert.equal(m.plays().length, 0);
  assert.equal(m.abertos.length, 0);
  assert.equal(m.p.no.querySelectorAll('.pl-cartao').length, 0, 'nenhum cartão com a config padrão');
  m.p.destruir();
});

test('o gesto toca: tocar() e o botão passam por tocarPorGesto', () => {
  const m = montar({});
  m.p.tocar();
  assert.equal(m.plays().length, 1);
  m.video.pause();
  m.p.no.querySelector('.pl-play').click();
  assert.equal(m.plays().length, 2);
  m.p.destruir();
});

test('com autoplay.modo "nunca" NENHUM play() ocorre sem gesto, seja qual for o resto da config', () => {
  const resto = [
    {}, { proximoEpisodio: { modo: 'automatico' } }, { retomar: { modo: 'automatico' } },
    { proximoEpisodio: { modo: 'perguntar' }, retomar: { modo: 'perguntar' } },
    { autoplay: { somenteDesktop: false, respeitarEconomiaDeDados: false } }
  ];
  for (const r of resto) {
    const cfg = { ...r, autoplay: { modo: 'nunca', ...(r.autoplay || {}) } };
    for (const origem of ['', 'proximo-episodio']) {
      const m = montar(cfg, {}, { origemDoInicio: origem });
      /* Passa o tempo, a fonte, a interação e o fim do vídeo. */
      m.janela.document.disparar('pointerdown');
      m.janela.__correr();
      cenaFinal(m, 99.9);
      assert.equal(m.plays().length, 0, JSON.stringify([cfg, origem]));
      m.p.destruir();
    }
  }
});

test('autoplay "mudo": começa sozinho, MUDO, e só em desktop com dados e movimento normais', () => {
  const m = montar({ autoplay: { modo: 'mudo' } });
  assert.equal(m.plays().length, 1);
  assert.equal(m.plays()[0].muted, true, 'o início sem gesto sai mudo');
  m.p.destruir();

  const celular = montar({ autoplay: { modo: 'mudo' } }, { matchMedia: (q) => /max-width|pointer: coarse/.test(q) });
  assert.equal(celular.plays().length, 0, 'celular: desligado por padrão');
  const dados = montar({ autoplay: { modo: 'mudo' } }, { saveData: true });
  assert.equal(dados.plays().length, 0, 'economia de dados');
  const reduz = montar({ autoplay: { modo: 'mudo' } }, { matchMedia: (q) => /reduced-motion/.test(q) });
  assert.equal(reduz.plays().length, 0, 'reduzir movimento');
  const oculta = montar({ autoplay: { modo: 'mudo' } }, { visivel: false });
  assert.equal(oculta.plays().length, 0, 'aba oculta');
  const mesa = montar({ autoplay: { modo: 'mudo' } }, { busca: '?mesa=1' });
  mesa.janela.parent = {};
  assert.equal(montar({ autoplay: { modo: 'mudo' } }, { busca: '?mesa=1' }).plays().length, 1, 'fora de um quadro, ?mesa=1 não vale');
});

test('autoplay "com-som-apos-interacao": sem interação não toca; depois de um gesto real, toca com som', () => {
  const sem = montar({ autoplay: { modo: 'com-som-apos-interacao' } });
  assert.equal(sem.plays().length, 0);
  sem.p.destruir();

  const amb = carregar(['guardiao.js', 'player-core.js', 'player.js'], { matchMedia: DESKTOP });
  /* Evento sintético não conta. */
  amb.doc.disparar('click', { isTrusted: false });
  const p1 = amb.janela.AppPlayer.criar(ITEM, { player: { autoplay: { modo: 'com-som-apos-interacao' } } }, {});
  assert.equal(p1.video.chamadasDePlay.length, 0, 'clique sintético não é gesto');
  p1.destruir();
  amb.doc.disparar('pointerdown');
  const p2 = amb.janela.AppPlayer.criar(ITEM, { player: { autoplay: { modo: 'com-som-apos-interacao' } } }, {});
  assert.equal(p2.video.chamadasDePlay.length, 1);
  assert.equal(p2.video.chamadasDePlay[0].muted, false);
  p2.destruir();
});

test('próximo episódio: padrão não faz nada; perguntar mostra o cartão e espera o clique', () => {
  const nunca = montar({ proximoEpisodio: { modo: 'nunca' } });
  cenaFinal(nunca, 95);
  assert.equal(nunca.p.no.querySelectorAll('.pl-cartao-proximo').length, 0);

  const m = montar({ proximoEpisodio: { modo: 'perguntar', mostrarCartaoNosUltimosSeg: 20 } });
  cenaFinal(m, 50);
  assert.equal(m.p.no.querySelectorAll('.pl-cartao-proximo').length, 0, 'cedo demais');
  cenaFinal(m, 85);
  const cartao = m.p.no.querySelector('.pl-cartao-proximo');
  assert.ok(cartao && cartao.hidden === false);
  assert.match(cartao.textContent, /Episódio 2/);
  cenaFinal(m, 99.9);
  m.video.ended = true;
  m.video.disparar('timeupdate');
  assert.equal(m.abertos.length, 0, 'perguntar não avança sozinho');
  assert.equal(m.plays().length, 0);
  /* O clique em "Assistir agora" abre a próxima COM o pedido de gesto. */
  cartao.querySelector('.pl-cartao-primario').click();
  assert.deepEqual(m.abertos.map((a) => [a.alvo.id, a.automatico]), [['ep2', false]]);
  assert.equal(m.plays().length, 0, 'quem toca é a ficha nova, pelo pedido do gesto');
});

test('próximo episódio "cancelar" fecha o cartão e nada avança', () => {
  const m = montar({ autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'automatico', segundosDeContagem: 8 } });
  m.video.pause();
  cenaFinal(m, 94);
  const cartao = m.p.no.querySelector('.pl-cartao-proximo');
  assert.match(cartao.textContent, /6 segundos/);
  const botoes = cartao.querySelectorAll('button');
  botoes[1].click();
  assert.equal(cartao.hidden, true);
  cenaFinal(m, 100);
  m.video.ended = true;
  m.video.disparar('timeupdate');
  assert.equal(m.abertos.length, 0);
});

test('próximo episódio "automatico": a contagem zera com o vídeo e pede o avanço AUTOMÁTICO ao app', () => {
  const m = montar({ autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'automatico', segundosDeContagem: 8 } });
  assert.equal(m.plays().length, 1, 'autoplay mudo da própria ficha');
  cenaFinal(m, 93);
  assert.match(m.p.no.querySelector('.pl-cartao-proximo').textContent, /7 segundos/);
  assert.equal(m.abertos.length, 0);
  cenaFinal(m, 100);
  assert.deepEqual(m.abertos.map((a) => [a.alvo.id, a.automatico]), [['ep2', true]]);
  /* E só uma vez. */
  m.video.disparar('timeupdate');
  assert.equal(m.abertos.length, 1);
});

test('próximo episódio "automatico" com autoplay "nunca" vira pergunta: não avança sozinho', () => {
  const m = montar({ autoplay: { modo: 'nunca' }, proximoEpisodio: { modo: 'automatico' } });
  cenaFinal(m, 99);
  cenaFinal(m, 100);
  assert.equal(m.abertos.length, 0);
  assert.equal(m.plays().length, 0);
  assert.doesNotMatch(m.p.no.querySelector('.pl-cartao-proximo').textContent, /segundo/, 'sem contagem');
});

test('a ficha aberta pelo avanço automático começa pelo guardião (origem "proximo-episodio")', () => {
  const cfg = { autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'automatico' } };
  const ok = montar(cfg, {}, { origemDoInicio: 'proximo-episodio' });
  assert.equal(ok.plays().length, 1);
  assert.equal(ok.plays()[0].muted, true);
  const so = montar({ autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'perguntar' } }, {}, { origemDoInicio: 'proximo-episodio' });
  /* Com `perguntar`, a origem "próximo" não libera; o autoplay comum da ficha sim. */
  assert.equal(so.plays().length, 0, 'a origem proximo-episodio exige o modo automatico');
});

function guardarPonto(armazenamento, t) {
  const amb = carregar([], {});
  armazenamento[amb.janela.App.CHAVE_ONDE_PAROU] = JSON.stringify(
    vm.runInContext('App.lembrarOndeParou({}, "ep1", ' + t + ', 100, Date.now())', amb.ctx));
}

test('retomar: o padrão nem lê o ponto; perguntar mostra o cartão; automatico posiciona ao dar play', () => {
  const arm = {};
  guardarPonto(arm, 40);
  const padrao = montar({}, { armazenamento: arm });
  assert.equal(padrao.p.no.querySelectorAll('.pl-cartao-retomar').length, 0);
  assert.equal(padrao.video.currentTime, 0);
  padrao.p.tocar();
  assert.equal(padrao.video.currentTime, 0, 'o padrão abre em 0');
  assert.ok(!padrao.janela.__leituras.some((k) => k === padrao.janela.App.CHAVE_ONDE_PAROU),
    'com retomar "nunca" o player não lê onde parou');

  const perg = montar({ retomar: { modo: 'perguntar' } }, { armazenamento: arm });
  const cartao = perg.p.no.querySelector('.pl-cartao-retomar');
  assert.ok(cartao && cartao.hidden === false);
  assert.match(cartao.textContent, /0:40/);
  assert.equal(perg.plays().length, 0, 'a pergunta não toca');
  perg.p.tocar();
  assert.equal(perg.plays().length, 0, 'o "Assistir" não responde pela pessoa: a pergunta continua');
  cartao.querySelector('.pl-cartao-primario').click();
  assert.equal(perg.video.currentTime, 40);
  assert.equal(perg.plays().length, 1);

  const nao = montar({ retomar: { modo: 'perguntar' } }, { armazenamento: arm });
  nao.p.no.querySelector('.pl-cartao-retomar').querySelectorAll('button')[1].click();
  assert.equal(nao.video.currentTime, 0);
  assert.equal(nao.plays().length, 1);

  const auto = montar({ retomar: { modo: 'automatico' } }, { armazenamento: arm });
  assert.equal(auto.plays().length, 0, 'automatico não dá play sozinho');
  assert.equal(auto.video.currentTime, 0);
  auto.p.tocar();
  assert.equal(auto.video.currentTime, 40);
  assert.equal(auto.plays().length, 1);
  assert.equal(auto.plays()[0].t, 40, 'o ponto vale antes do play');

  /* Um momento pedido (?t=) manda mais do que o ponto guardado. */
  const amb = carregar(['guardiao.js', 'player-core.js', 'player.js'], { matchMedia: DESKTOP, armazenamento: arm });
  const comT = amb.janela.AppPlayer.criar(ITEM, { player: { retomar: { modo: 'automatico' } } }, {});
  comT.irPara(12);
  comT.tocar();
  assert.equal(comT.video.currentTime, 12);
});

test('guardarPosicao: false não grava onde parou', () => {
  const arm = {};
  const m = montar({ retomar: { guardarPosicao: false } }, { armazenamento: arm });
  m.p.tocar();
  m.video.currentTime = 30; m.video.duration = 100;
  m.video.pause();
  assert.deepEqual(Object.keys(arm), []);
  const padrao = montar({}, { armazenamento: arm });
  padrao.p.tocar(); padrao.video.currentTime = 30; padrao.video.duration = 100; padrao.video.pause();
  assert.equal(Object.keys(arm).length, 1, 'o padrão continua gravando');
});

test('velocidades, marca d\'água e download vêm da config', () => {
  const m = montar({ velocidades: [0.5, 1, 3], marcaDagua: { ligada: true, texto: 'Confidencial' }, download: { ligado: true } },
    {}, {}, { ...ITEM, midia: { ...ITEM.midia, mp4: { '720p': 'https://exemplo.test/720.mp4' } } });
  assert.equal(m.p.no.querySelector('.pl-marca').textContent, 'Confidencial');
  const baixar = m.p.no.querySelector('.pl-baixar');
  assert.equal(baixar.attrs.href || baixar.href, 'https://exemplo.test/720.mp4');
  const padrao = montar({});
  assert.equal(padrao.p.no.querySelectorAll('.pl-marca').length, 0);
  assert.equal(padrao.p.no.querySelectorAll('.pl-baixar').length, 0);
  /* Download sem MP4 (provedor só HLS): não há link. */
  const hls = montar({ download: { ligado: true } }, {}, {}, { ...ITEM, midia: { hls: 'https://exemplo.test/a.m3u8', capa: 'x' } });
  assert.equal(hls.p.no.querySelectorAll('.pl-baixar').length, 0);
  const lista = vm.runInContext('AppPlayerCore.proximaVelocidade(1, 1, [0.5, 1, 3])', m.ctx);
  assert.equal(lista, 3);
});

test('legenda: o idioma padrão da config escolhe a faixa quando o título a tem', () => {
  const core = require('../core/site/player-core.js');
  const midia = { legendas: [{ idioma: 'pt-BR', url: 'https://x/pt.vtt' }, { idioma: 'en', url: 'https://x/en.vtt' }] };
  assert.equal(core.urlLegenda(midia, 'en'), 'https://x/en.vtt');
  assert.equal(core.urlLegenda(midia, 'es'), null);
  assert.equal(core.urlLegenda(midia), 'https://x/pt.vtt');
  const src = semComentarios(lerTexto(path.join(SITE, 'player.js')));
  assert.match(src, /cfg\.legenda\.idiomaPadrao/);
});

/* ============================================== falha ao carregar o vídeo */

test('vídeo que falha: mensagem amigável e traduzida, com "Tentar de novo"', () => {
  const m = montar({});
  const painel = m.p.no.querySelector('.pl-erro');
  assert.equal(painel.hidden, true, 'sem falha, sem mensagem');
  /* O MP4 também falha: não há mais para onde ir. */
  m.video.error = { code: 4 };
  m.video.disparar('error');
  assert.equal(painel.hidden, false);
  assert.match(painel.textContent, /Não foi possível carregar este vídeo/);
  assert.match(painel.textContent, /Tentar de novo/);
  assert.equal(painel.getAttribute('role'), 'alert');
  assert.equal(m.plays().length, 0, 'falhar não toca nada');
  /* Tentar de novo refaz a fonte e esconde a mensagem. */
  painel.querySelector('button').click();
  assert.equal(painel.hidden, true);
  assert.equal(m.video.src, 'https://exemplo.test/v.mp4');
  m.p.destruir();
});

test('vídeo só com HLS e sem MP4: o erro de reprodução também vira mensagem', () => {
  const m = montar({}, {}, {}, { ...ITEM, midia: { hls: 'https://exemplo.test/a.m3u8', capa: 'x' } });
  /* Sem hls.js nem suporte nativo no ambiente de teste, a fonte não liga. */
  m.janela.__correr();
  const painel = m.p.no.querySelector('.pl-erro');
  m.video.error = { code: 3 };
  m.video.disparar('error');
  assert.equal(painel.hidden, false);
});

/* Falha REAL do hls.js: o evento 'error' do hls.js, e não o do <video>. Antes,
 * o erro fatal de rede só chamava startLoad(), que não refaz o manifesto que
 * falhou: o painel nunca aparecia e a rodinha girava para sempre. */
function montarComHls(item, opcoesHls = {}) {
  const instancias = [];
  class HlsFalso {
    constructor(cfg) { this.cfg = cfg; this.ouvintes = {}; this.destruido = false; this.cargas = 0; instancias.push(this); }
    static isSupported() { return true; }
    on(nome, fn) { (this.ouvintes[nome] = this.ouvintes[nome] || []).push(fn); }
    emitir(nome, dados) { (this.ouvintes[nome] || []).forEach((f) => f(nome, dados)); }
    loadSource() {} attachMedia() {} startLoad() { this.cargas++; } recoverMediaError() {} destroy() { this.destruido = true; }
  }
  HlsFalso.Events = { ERROR: 'hlsError', FRAG_LOADED: 'fragLoaded', MANIFEST_PARSED: 'manifestParsed', MANIFEST_LOADING: 'manifestLoading', LEVEL_LOADING: 'levelLoading', FRAG_LOADING: 'fragLoading', MANIFEST_LOADED: 'manifestLoaded', LEVEL_LOADED: 'levelLoaded' };
  HlsFalso.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  const amb = carregar(['guardiao.js', 'player-core.js', 'player.js'], { matchMedia: DESKTOP, globais: { Hls: HlsFalso, MediaSource: function () {} } });
  const p = amb.janela.AppPlayer.criar(item, { player: {} }, { proximo: PROX, abrirProximo() {} });
  return { ...amb, p, instancias, hls: () => instancias[instancias.length - 1] };
}
const SO_HLS = { ...ITEM, midia: { hls: 'https://exemplo.test/a.m3u8', capa: 'x' } };
const FATAL_REDE = { fatal: true, type: 'networkError', details: 'manifestLoadError' };

test('hls.js: manifesto em 404 (erro fatal de rede) mostra a mensagem na hora', async () => {
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  const painel = m.p.no.querySelector('.pl-erro');
  assert.equal(painel.hidden, true);
  m.hls().emitir('hlsError', FATAL_REDE);
  assert.equal(painel.hidden, false, 'o painel .pl-erro devia aparecer');
  assert.match(painel.textContent, /Não foi possível carregar este vídeo/);
  assert.equal(m.hls().destruido, true, 'o hls.js é desmontado');
  assert.equal(m.p.video.chamadasDePlay.length, 0, 'falhar não toca nada');
  m.p.destruir();
});

test('hls.js: com manifesto bom, rede que não volta vira mensagem na segunda falha fatal', async () => {
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  const painel = m.p.no.querySelector('.pl-erro');
  m.hls().emitir('manifestParsed', {});
  m.hls().emitir('hlsError', FATAL_REDE);
  assert.equal(painel.hidden, true, 'a primeira falha fatal ainda tenta uma vez');
  assert.equal(m.hls().cargas, 1);
  m.hls().emitir('hlsError', FATAL_REDE);
  assert.equal(painel.hidden, false);
  m.p.destruir();
});

test('hls.js: com manifesto bom e um único erro, o tempo limite sem segmento também vira mensagem', async () => {
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  const painel = m.p.no.querySelector('.pl-erro');
  m.hls().emitir('manifestParsed', {});
  m.hls().emitir('hlsError', FATAL_REDE);
  assert.equal(painel.hidden, true);
  assert.equal(m.hls().cargas, 1, 'tenta retomar uma vez');
  m.janela.__correr();   /* o tempo limite */
  assert.equal(painel.hidden, false);
  m.p.destruir();
});

/* PENDÊNCIA DO M6: a mensagem demorava ~52 s (6 tentativas de segmento com
 * espera de até 8 s, 4 reenvios por tempo esgotado, manifesto com 3 x 20 s e três
 * `startLoad()` por cima). A promessa agora é <= 15 s do primeiro erro. */
test('falha de segmento: o relógio da falha começa no primeiro erro de rede (mesmo não fatal) e cabe em 15 s', async () => {
  const Nucleo = require('../core/site/player-core.js');
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  m.hls().emitir('manifestParsed', {});
  const antes = m.janela.__temporizadores.length;
  m.hls().emitir('hlsError', { fatal: false, type: 'networkError', details: 'fragLoadError' });
  const novos = m.janela.__temporizadores.slice(antes);
  assert.equal(novos.length, 1, 'um erro não fatal de rede arma o relógio');
  assert.equal(novos[0].ms, Nucleo.ESPERA_REDE_MS);
  assert.ok(novos[0].ms <= Nucleo.LIMITE_FALHA_MS, 'o relógio sozinho cabe no limite');
  /* Outro erro não arma um segundo relógio (o prazo é do primeiro). */
  m.hls().emitir('hlsError', { fatal: false, type: 'networkError', details: 'fragLoadError' });
  assert.equal(m.janela.__temporizadores.length, antes + 1);
  const painel = m.p.no.querySelector('.pl-erro');
  assert.equal(painel.hidden, true);
  novos[0].fn();
  assert.equal(painel.hidden, false, 'o relógio esgotado mostra a mensagem');
  m.p.destruir();
});

test('o relógio da falha começa quando a carga COMEÇA: segmento lento que nem chega a dar erro também tem prazo', async () => {
  const Nucleo = require('../core/site/player-core.js');
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  m.hls().emitir('manifestParsed', {});
  const antes = m.janela.__temporizadores.length;
  m.hls().emitir('fragLoading', {});
  const novos = m.janela.__temporizadores.slice(antes);
  assert.equal(novos.length, 1, 'iniciar a carga arma o relógio');
  assert.equal(novos[0].ms, Nucleo.ESPERA_REDE_MS);
  /* Prazo total, do início da carga ao painel: um único relógio, sem somar o primeiro erro. */
  assert.ok(Nucleo.ESPERA_REDE_MS <= Nucleo.LIMITE_FALHA_MS - 3000, 'folga de pelo menos 3 s sob o limite de 15 s');
  m.hls().emitir('hlsError', { fatal: false, type: 'networkError', details: 'fragLoadError' });
  assert.equal(m.janela.__temporizadores.length, antes + 1, 'o erro não reinicia o prazo');
  m.hls().emitir('fragLoaded', {});
  m.janela.__correr();
  assert.equal(m.p.no.querySelector('.pl-erro').hidden, true, 'carga concluída zera o relógio');
  m.hls().emitir('fragLoading', {});
  m.janela.__temporizadores[m.janela.__temporizadores.length - 1].fn();
  assert.equal(m.p.no.querySelector('.pl-erro').hidden, false);
  m.p.destruir();
});

test('o fim do LEVEL_LOADED não apaga o relógio do segmento que o hls.js já começou de dentro dele', async () => {
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  m.hls().emitir('manifestLoading', {});
  m.hls().emitir('manifestLoaded', {});
  m.hls().emitir('manifestParsed', {});
  m.janela.__correr();   /* a pré-carga do manifesto (sem play) não deixa relógio nenhum armado */
  assert.equal(m.p.no.querySelector('.pl-erro').hidden, true, 'carregar só o manifesto não vira erro');
  const antes = m.janela.__temporizadores.length;
  m.hls().emitir('levelLoading', {});
  m.hls().emitir('fragLoading', {});     /* o hls.js começa o segmento DENTRO do tratamento do LEVEL_LOADED */
  m.hls().emitir('levelLoaded', {});
  const novos = m.janela.__temporizadores.slice(antes);
  assert.equal(novos.length, 1);
  novos[0].fn();
  assert.equal(m.p.no.querySelector('.pl-erro').hidden, false, 'o relógio do segmento sobreviveu ao fim da etapa anterior');
  m.p.destruir();
});

test('segmento que chega zera o relógio da falha: rede que volta não vira mensagem', async () => {
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  m.hls().emitir('manifestParsed', {});
  m.hls().emitir('hlsError', { fatal: false, type: 'networkError', details: 'fragLoadError' });
  m.hls().emitir('fragLoaded', {});
  m.janela.__correr();   /* o relógio velho, se sobrasse, dispararia aqui */
  assert.equal(m.p.no.querySelector('.pl-erro').hidden, true);
  m.p.destruir();
});

test('o painel de erro tira pl-esperando e pl-tocando', async () => {
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  const caixa = m.p.no;
  caixa.classList.add('pl-esperando');
  caixa.classList.add('pl-tocando');
  m.hls().emitir('hlsError', FATAL_REDE);
  assert.equal(m.p.no.querySelector('.pl-erro').hidden, false);
  assert.equal(caixa.classList.contains('pl-esperando'), false);
  assert.equal(caixa.classList.contains('pl-tocando'), false);
  assert.equal(caixa.classList.contains('pl-falhou'), true);
  m.p.destruir();
});

test('a política de tentativas do hls.js cabe no limite de 15 s (e o padrão do hls.js não cabia)', () => {
  const Nucleo = require('../core/site/player-core.js');
  const cfg = Nucleo.configHls();
  for (const nome of ['fragLoadPolicy', 'manifestLoadPolicy', 'playlistLoadPolicy']) {
    const pol = cfg[nome] && cfg[nome].default;
    assert.ok(pol, nome + ' definido');
    assert.ok(isFinite(pol.maxTimeToFirstByteMs), nome + ': primeiro byte com prazo (o manifesto padrão não tinha)');
  }
  const pior = Nucleo.orcamentoDeFalhaMs(cfg);
  assert.ok(pior <= Nucleo.ESPERA_REDE_MS, `pior caso por política: ${pior} ms`);
  assert.ok(Nucleo.ESPERA_REDE_MS + 4000 <= Nucleo.LIMITE_FALHA_MS, 'folga: o relógio, contado do início da carga, mais 4 s de margem, cabe no limite');
  /* Para a conta provar alguma coisa, ela precisa reprovar o padrão do hls.js 1.6. */
  const padrao = { default: { maxTimeToFirstByteMs: 1e4, maxLoadTimeMs: 12e4,
    timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: 6, retryDelayMs: 1e3, maxRetryDelayMs: 8e3 } } };
  assert.ok(Nucleo.orcamentoDeFalhaMs({ fragLoadPolicy: padrao, manifestLoadPolicy: padrao, playlistLoadPolicy: padrao }) > 45000);
  assert.equal(Nucleo.LIMITE_FALHA_MS, 15000);
});

test('o hls.js recebe as políticas de falha ao ser criado', async () => {
  const m = montarComHls(SO_HLS);
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  const cfg = m.hls().cfg;
  assert.equal(cfg.fragLoadPolicy.default.errorRetry.maxNumRetry, 2);
  assert.equal(cfg.manifestLoadPolicy.default.maxTimeToFirstByteMs, 4000);
  assert.equal(cfg.autoStartLoad, false);
  m.p.destruir();
});

test('hls.js: com MP4 de reserva, o erro de rede do manifesto cai para o MP4 (sem painel)', async () => {
  const m = montarComHls({ ...ITEM, midia: { ...ITEM.midia, hls: 'https://exemplo.test/a.m3u8' } });
  m.janela.__correr();
  await new Promise((r) => setImmediate(r));
  m.hls().emitir('hlsError', FATAL_REDE);
  assert.equal(m.p.video.src, 'https://exemplo.test/v.mp4');
  assert.equal(m.p.no.querySelector('.pl-erro').hidden, true);
  m.p.destruir();
});

test('as mensagens novas existem nos três idiomas', () => {
  const chaves = ['player.erroAoCarregar', 'player.tentarDeNovo', 'player.retomarPergunta', 'player.retomarSim', 'player.retomarNao',
    'player.proximoTitulo', 'player.assistirAgora', 'player.cancelar', 'player.proximoEm', 'player.baixar',
    'site.pausarFundo', 'site.reproduzirFundo'];
  for (const idioma of ['pt-BR', 'en', 'es']) {
    const t = JSON.parse(lerTexto(path.join(__dirname, '..', 'core', 'locales', idioma + '.json')));
    for (const c of chaves) assert.ok(t[c], idioma + ' sem ' + c);
  }
});

/* ============================================== schema e resposta da API */

test('o schema aceita as opções novas e recusa as inseguras', async () => {
  const { validarConfig } = await import('../core/worker/_lib/config-validar.mjs');
  const esquema = JSON.parse(lerTexto(path.join(__dirname, '..', 'config', 'site.schema.json')));
  const base = JSON.parse(lerTexto(path.join(__dirname, '..', 'config', 'site.json')));
  const com = (mut) => { const c = JSON.parse(JSON.stringify(base)); mut(c); return c; };
  const ok = (c) => { const r = validarConfig(esquema, c); return (r.erros ? r.erros : r).length === 0; };
  assert.ok(ok(base));
  assert.ok(ok(com((c) => { c.player.autoplay.modo = 'mudo'; c.player.proximoEpisodio.modo = 'automatico'; c.player.retomar.modo = 'automatico'; })));
  assert.ok(ok(com((c) => { c.player.velocidades = [0.5, 1, 2]; c.player.legenda = { idiomaPadrao: 'pt-BR' }; c.player.download = { ligado: true }; })));
  assert.ok(ok(com((c) => { c.home = { destaque: { fundo: { tipo: 'video-mudo', somenteDesktop: true } } }; })));
  assert.ok(!ok(com((c) => { c.player.autoplay.modo = 'sempre'; })));
  assert.ok(!ok(com((c) => { c.player.proximoEpisodio.modo = 'desligado'; })));
  assert.ok(!ok(com((c) => { c.home = { destaque: { fundo: { tipo: 'video-com-som' } } }; })));
  assert.ok(!ok(com((c) => { c.home = { destaque: { fundo: { tipo: 'video-mudo', respeitarMovimentoReduzido: false } } }; })), 'reduzir movimento é sempre respeitado');
  assert.ok(!ok(com((c) => { c.home = { destaque: { fundo: { tipo: 'video-mudo', respeitarEconomiaDeDados: false } } }; })), 'economia de dados é sempre respeitada');
});

test('a API do catálogo entrega o comportamento (player.* e fundo) já saneado — e nenhum dado do ambiente', async () => {
  const { criarWorker } = await import('../core/worker/index.js');
  const kv = (dados) => ({
    get: async (k, tipo) => (k in dados ? (tipo === 'json' ? JSON.parse(dados[k]) : dados[k]) : null),
    getWithMetadata: async (k, tipo) => ({ value: k in dados ? (tipo === 'json' ? JSON.parse(dados[k]) : dados[k]) : null, metadata: null }),
    put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true })
  });
  const config = {
    acesso: { modo: 'publico' },
    player: { autoplay: { modo: 'mudo' }, proximoEpisodio: { modo: 'automatico', segundosDeContagem: 99 }, segredo: 'nao-sai' },
    home: { destaque: { fundo: { tipo: 'video-mudo', atrasoMs: 50000, chaveDeApi: 'nao-sai' } } }
  };
  const ler = async (catalogo) => {
    const env = { ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres', CATALOGO: kv(catalogo) };
    const worker = criarWorker({ obterConfig: async () => config });
    const r = await worker.fetch(new Request('https://exemplo.test/api/catalogo'), env, { waitUntil: () => {} });
    return { status: r.status, texto: await r.clone().text(), corpo: await r.json() };
  };
  for (const catalogo of [{}, { catalogo: JSON.stringify({ rev: 1, itens: [] }) }]) {
    const r = await ler(catalogo);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.corpo.comportamento.player.autoplay.modo, 'mudo');
    assert.equal(r.corpo.comportamento.player.proximoEpisodio.segundosDeContagem, 60, 'saneado');
    assert.equal(r.corpo.comportamento.home.destaque.fundo.tipo, 'video-mudo');
    assert.equal(r.corpo.comportamento.home.destaque.fundo.atrasoMs, 10000, 'saneado');
    assert.ok(!r.texto.includes('nao-sai'), 'o que o guardião não conhece não sai');
    assert.ok(!('config' in r.corpo), '`config` (ambiente) continua fora da resposta');
  }
  /* Sem nada na config: o padrão de sempre. */
  const env = { ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres', CATALOGO: kv({}) };
  const w = criarWorker({ obterConfig: async () => ({ acesso: { modo: 'publico' } }) });
  const padrao = await (await w.fetch(new Request('https://exemplo.test/api/catalogo'), env, { waitUntil: () => {} })).json();
  assert.equal(padrao.comportamento.player.autoplay.modo, 'nunca');
  assert.equal(padrao.comportamento.home.destaque.fundo.tipo, 'capa');
});
