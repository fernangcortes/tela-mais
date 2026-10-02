/* Testes das regras que o produto não pode perder. Rodar, da raiz do repositório:
 *     npm test            (ou: node --test, sem argumento; descobre tests/ sozinho)
 * `node --test tests/` também funciona, via tests/index.js.
 * Sem dependências: só o test runner embutido do Node.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const App = require('../core/site/catalogo-core.js');
/* Os textos vêm do catálogo pt-BR; {marca} é o nome do exemplo, como no config/site.json. */
require('../core/site/i18n.js').definirGlobais({ marca: 'Plataforma Exemplo', marcaCurta: 'Exemplo', organizacao: 'Organização Exemplo' });
const SITE = path.join(__dirname, '..', 'core', 'site');
const WORKER = path.join(__dirname, '..', 'core', 'worker');

/* Todo arquivo lido aqui passa por este helper, e o 
 vira 
.
 *
 * NÃO é enfeite, e custou uma investigação: a árvore de trabalho no Windows é
 * CRLF (`core.autocrlf=true`), o repositório guarda LF, e um regex que
 * atravessa uma quebra de linha — `/.pl-b {
/` — casa no blob e FALHA no
 * checkout. O teste "o painel de som encosta no ícone" ficou assim: passava no
 * CI (Linux, LF) e reprovava em qualquer clone Windows, inclusive no
 * repositório ABERTO, onde o README promete que os testes rodam.
 *
 * Normalizar na LEITURA resolve a classe inteira de uma vez, em vez de caçar
 * cada regex. Quem acrescentar um `fs.readFileSync` cru aqui reabre o buraco;
 * há teste varrendo o arquivo atrás disso. */
const lerTexto = (caminho) => fs.readFileSync(caminho, 'utf8').split('\r\n').join('\n');

/* `fonte` no formato de ANTES do M4 ({ tipo, libraryId, videoId }): o catálogo gravado e os
 * scripts ainda o trazem, e tudo tem de continuar funcionando (migrarFonte). */
const fonte = { tipo: 'bunny', libraryId: '123456', videoId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };

/* A `midia` que o servidor entrega, calculada pelo adaptador do Bunny — é o ÚNICO jeito de o
 * navegador chegar ao vídeo (D-2). Sem rede: o adaptador só monta URL. */
const PULLZONE_DE_TESTE = 'vz-abc123-4f5.b-cdn.net';
async function midiaDoBunny(item, env) {
  const registro = await import('../core/worker/_lib/provedores/index.js');
  const provedor = registro.criarProvedor(null, Object.assign({ BUNNY_LIBRARY_ID: '123456', BUNNY_API_KEY: 'chave-de-teste', BUNNY_PULLZONE: PULLZONE_DE_TESTE }, env || {}));
  return registro.montarMidia(provedor, item);
}

/* ============================ as três restrições inegociáveis ============ */

test('o embed desliga autoplay — o padrão do Bunny é true', async () => {
  const p = new URL(App.urlEmbed(await midiaDoBunny({ fonte }))).searchParams;
  assert.equal(p.get('autoplay'), 'false');
});

test('o embed desliga loop, preload e rememberPosition', async () => {
  const p = new URL(App.urlEmbed(await midiaDoBunny({ fonte }))).searchParams;
  assert.equal(p.get('loop'), 'false');
  assert.equal(p.get('preload'), 'false');
  assert.equal(p.get('rememberPosition'), 'false');
});

test('nenhum dos quatro parâmetros pode faltar na URL do player', async () => {
  const url = App.urlEmbed(await midiaDoBunny({ fonte }));
  for (const par of ['autoplay', 'loop', 'preload', 'rememberPosition']) {
    assert.ok(url.includes(par + '=false'), 'faltou ' + par + '=false em ' + url);
  }
});

test('a interface não reage ao fim do vídeo — nada de avanço automático', () => {
  for (const arquivo of ['app.js', 'player.js', 'player-core.js', 'busca-core.js', 'indice-core.js',
    'mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa.js']) {
    const fonteJs = lerTexto(path.join(SITE, arquivo));
    assert.ok(!/['"]ended['"]/.test(fonteJs), arquivo + ' escuta o fim do vídeo');
    assert.ok(!/autoplay\s*[:=]\s*['"]?true/.test(fonteJs), arquivo + ' liga autoplay');
    assert.ok(!/setTimeout[^)]*proximo/i.test(fonteJs), arquivo + ' agenda ir para o próximo');
  }
});

/* Bug real, achado no lote-piloto: `no-referrer` remove o cabeçalho Referer de
 * toda requisição que sai da página — inclusive as capas servidas pela pull zone
 * do Bunny, que é protegida justamente por Allowed Referrers. Resultado: 403 em
 * todas as capas, no próprio site. */
test('a página não usa no-referrer — quebraria as capas servidas pelo Bunny', () => {
  /* A mesa (admin.html) também: as capas do inspetor e o MP4 do seletor de
   * capa vêm da mesma pull zone. */
  for (const pagina of ['index.html', 'admin.html']) {
    const html = lerTexto(path.join(SITE, pagina));
    const m = html.match(/<meta\s+name="referrer"\s+content="([^"]*)"/);
    assert.ok(m, pagina + ' precisa declarar uma política de referrer');
    assert.notEqual(m[1], 'no-referrer', pagina + ': no-referrer faz a pull zone do Bunny responder 403');
    assert.notEqual(m[1], 'same-origin', pagina + ': same-origin também não manda Referer para o Bunny');
  }
});

/* Bug real, achado no piloto: voltar para a grade pelo botão do navegador
 * escondia a ficha com `hidden` mas deixava o iframe no DOM — e o vídeo seguia
 * tocando, com áudio, por cima da grade. Só remover o elemento interrompe. */
test('voltar para a grade destrói o player — esconder não para o vídeo', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei renderGrade em app.js');
  assert.match(corpo[1], /limpar\(el\.ficha\)/,
    'renderGrade precisa esvaziar el.ficha; só `el.ficha.hidden = true` mantém o iframe tocando');
});

/* Bug real: a capa trocada pela tela de admin aparecia na ficha mas não na grade.
 * `urlCapa` depende de `capa_versao` para furar o cache do CDN — e a projeção
 * pública não estava mandando esse campo. */
test('a projeção pública leva capa_versao — sem ela a grade mostra a capa em cache', () => {
  const fn = lerTexto(path.join(WORKER, 'api', 'catalogo.js'));
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em core/worker/api/catalogo.js');
  assert.match(proj[1], /capa_versao/,
    'paraPublico precisa incluir capa_versao, senão a grade nunca vê a capa nova');
});

test('o iframe não recebe permissão de autoplay na permission policy', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const m = app.match(/setAttribute\('allow',\s*'([^']*)'/);
  assert.ok(m, 'não achei o atributo allow do iframe');
  assert.ok(!m[1].includes('autoplay'), 'allow do iframe contém autoplay: ' + m[1]);
});

/* ============================ player e capa ============================== */

test('sem embed na mídia não há URL de player — o navegador só lê `midia.embed`', async () => {
  assert.equal(App.urlEmbed(null), null);
  assert.equal(App.urlEmbed({}), null);
  assert.equal(App.urlEmbed({ embed: null }), null);
  /* Sem videoId não há mídia; sem a library, o Bunny não monta embed (mas monta o HLS). */
  assert.equal(await midiaDoBunny({ fonte: { tipo: 'bunny', libraryId: '1', videoId: null } }), null);
  const semLibrary = await midiaDoBunny({ fonte: { tipo: 'bunny', videoId: fonte.videoId } }, { BUNNY_LIBRARY_ID: '' });
  assert.equal(semLibrary.embed, null);
  assert.ok(semLibrary.hls);
});

test('um vídeo de outro provedor não toca neste: sem `midia`, em vez de URL errada', async () => {
  assert.equal(await midiaDoBunny({ fonte: { provedor: 'cloudflare-stream', id: fonte.videoId, extras: {} } }), null);
  assert.equal(await midiaDoBunny({ fonte: { tipo: 'hls', libraryId: '1', videoId: 'x'.repeat(10) } }), null);
});

test('o libraryId do item manda no embed; o do ambiente é a rede de segurança', async () => {
  const proprio = await midiaDoBunny({ fonte: { tipo: 'bunny', libraryId: '777', videoId: 'abcdefgh-1' } });
  assert.match(proprio.embed.url, /\/embed\/777\/abcdefgh-1\?/);
  const emprestado = await midiaDoBunny({ fonte: { tipo: 'bunny', libraryId: null, videoId: 'abcdefgh-1' } });
  assert.match(emprestado.embed.url, /\/embed\/123456\/abcdefgh-1\?/);
});

test('a capa vem do provedor (URL pronta em midia.capa), não do repositório', async () => {
  const midia = await midiaDoBunny({ fonte });
  assert.equal(App.urlCapa({ midia }), 'https://' + PULLZONE_DE_TESTE + '/' + fonte.videoId + '/thumbnail.jpg');
  assert.equal(App.urlCapa({}), null);
  assert.equal(App.urlCapa({ midia: { capa: null } }), null);
  /* Sem pull zone o Bunny não tem de onde montar a capa. */
  assert.equal((await midiaDoBunny({ fonte }, { BUNNY_PULLZONE: '' })).capa, null);
  /* O nome com hash e a versão (contra o cache do navegador) entram na URL. */
  const trocada = await midiaDoBunny({ fonte, capa_arquivo: 'thumbnail_2c504259.jpg', capa_versao: 1700000000000 });
  assert.equal(trocada.capa, 'https://' + PULLZONE_DE_TESTE + '/' + fonte.videoId + '/thumbnail_2c504259.jpg?v=1700000000000');
  /* Nome de arquivo que mudaria o caminho é ignorado (o dado vem do catálogo). */
  assert.equal((await midiaDoBunny({ fonte, capa_arquivo: '../x.jpg' })).capa, 'https://' + PULLZONE_DE_TESTE + '/' + fonte.videoId + '/thumbnail.jpg');
});

test('o trecho animado do hover vem de midia.previa', async () => {
  const midia = await midiaDoBunny({ fonte });
  assert.equal(App.urlPreview({ midia }), 'https://' + PULLZONE_DE_TESTE + '/' + fonte.videoId + '/preview.webp');
  assert.equal(App.urlPreview({}), null);
  assert.equal(await midiaDoBunny({ fonte: { videoId: null } }), null);
});

/* O preview.webp vai de 454 KB a 3,1 MB, com 1,13 MB de mediana, e os 66 somam
 * 82,2 MB — medidos na pull zone em 14/09. (O "de 779 KB a 2,1 MB" que estava
 * aqui é de outro lote de arquivos e nunca foi reconferido.) Pedir os 66 junto
 * com a chegada mata a tela no celular — por isso o <img> só pode nascer no
 * mouseenter e tem que morrer no mouseleave. */
test('o preview do hover não é carregado junto com a grade', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));

  const feitura = app.match(/function cartao\(item, porSentido\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(feitura, 'não achei cartao() em app.js');
  assert.ok(!/card-previa/.test(feitura[1]),
    'cartao() monta o preview junto com a grade; ele só pode nascer no mouseenter');

  const hover = app.match(/function ligarPreview\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(hover, 'não achei ligarPreview() em app.js');
  assert.match(hover[1], /addEventListener\('mouseenter'/,
    'o preview precisa ser pedido no mouseenter');
  assert.match(hover[1], /addEventListener\('mouseleave', previa\.descartar\)/,
    'o preview precisa ser descartado no mouseleave');
  /* A peça que cria e destrói o <img> saiu para `novaPrevia` (15.2), que o
   * cartão que abre na prateleira também usa. */
  const peca = app.match(/function novaPrevia\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(peca, 'não achei novaPrevia() em app.js');
  assert.match(peca[1], /removeAttribute\('src'\)[\s\S]*removeChild/,
    'sair do cartão tem que abortar e remover o <img>; escondê-lo mantém o megabyte vivo');
});

/* Em tela de toque não existe hover, e quem pediu menos movimento não quer um
 * trecho rodando sozinho: nesses casos o cartão fica só com a capa. */
test('o preview do hover se protege contra toque e prefers-reduced-motion', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/,
    'falta a guarda de hover/pointer antes de carregar o preview');
  assert.match(app, /prefers-reduced-motion:\s*reduce/,
    'falta respeitar prefers-reduced-motion antes de carregar o preview');
});

/* Mesma armadilha do <meta> do index.html, agora dentro do JS: qualquer imagem
 * marcada com referrerpolicy="no-referrer" leva 403 da pull zone. */
test('nenhuma imagem da grade define referrerpolicy por conta própria', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const semComentarios = app.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/referrerpolicy/i.test(semComentarios),
    'app.js define referrerpolicy numa imagem; a política tem que vir do <meta>');
});

/* ============================ mini-sinopse =============================== */

test('a mini-sinopse corta na palavra e marca o corte com reticências', () => {
  const longa = 'palavra '.repeat(50);
  const resumo = App.resumoSinopse({ sinopse: longa });
  assert.ok(resumo.endsWith('…'), 'o corte precisa de reticências: ' + resumo);
  assert.ok(resumo.length <= 191, 'resumo longo demais: ' + resumo.length);
  assert.ok(!/ …$/.test(resumo), 'sobrou espaço antes das reticências');
});

test('a mini-sinopse não corta o que já cabe', () => {
  assert.equal(App.resumoSinopse({ sinopse: 'Curta e direta.' }), 'Curta e direta.');
});

test('a mini-sinopse achata quebras de linha — o cartão é de uma coluna só', () => {
  assert.equal(App.resumoSinopse({ sinopse: ' Uma linha.\n\n  Outra linha. ' }),
    'Uma linha. Outra linha.');
});

/* Há título publicado sem sinopse (`exemplo-institucional-01`, por exemplo):
 * o cartão não pode quebrar nem ganhar um parágrafo vazio por causa disso. */
test('a mini-sinopse some quando não há sinopse, sem quebrar o cartão', () => {
  assert.equal(App.resumoSinopse({ sinopse: '' }), '');
  assert.equal(App.resumoSinopse({ sinopse: '   \n ' }), '');
  assert.equal(App.resumoSinopse({}), '');
  assert.equal(App.resumoSinopse(null), '');

  const app = lerTexto(path.join(SITE, 'app.js'));
  const feitura = app.match(/function cartao\(item, porSentido\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(feitura[1], /if \(resumo\)/,
    'cartao() precisa pular o parágrafo da sinopse quando o resumo vem vazio');
});

/* ============================ grade e ordenação ========================== */

const acervo = [
  { id: 'b', titulo: 'Título Beta', serie: 'Série Alfa', temporada: 1, episodio: 2, publicar: true, fonte },
  { id: 'a', titulo: 'Título Alfa', serie: 'Série Alfa', temporada: 1, episodio: 1, publicar: true, fonte },
  { id: 'c', titulo: 'Título Gama V1', serie: 'Série Alfa', temporada: 2, episodio: 1, publicar: true, fonte },
  { id: 'd', titulo: 'Avulso', serie: 'A classificar', temporada: null, episodio: null, publicar: true, fonte },
  { id: 'e', titulo: 'Escondido', serie: 'Série Alfa', temporada: 1, episodio: 3, publicar: false, fonte }
];

test('a grade só mostra itens com publicar: true', () => {
  const ids = App.publicaveis(acervo).map(i => i.id);
  assert.deepEqual(ids.sort(), ['a', 'b', 'c', 'd']);
});

test('ordena por temporada e episódio, nunca por nome de arquivo', () => {
  const ids = App.ordenar(App.filtrarPorSerie(acervo, 'Série Alfa')).map(i => i.id);
  assert.deepEqual(ids, ['a', 'b', 'e', 'c']);
});

test('séries de triagem vão para o fim da grade', () => {
  const grupos = App.agrupar(App.publicaveis(acervo)).map(g => g.serie);
  assert.equal(grupos[grupos.length - 1], 'A classificar');
});

/* A aba "Todas" virou uma grade única: os blocos por série deixavam um cartão
 * sozinho por faixa e a tela inteira vazia à direita. Filtrar por um chip
 * continua valendo — o que saiu foi só o agrupamento visual. */
test('a aba "Todas" é uma grade única, sem cabeçalho de série', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei renderGrade em app.js');
  assert.ok(!/serie-bloco|serie-titulo/.test(corpo[1]),
    'renderGrade voltou a quebrar a grade em blocos por série');
  /* Desde a fase 1 da busca, a ordem sai do `responder()`: por
   * relevância quando há termo, e a de `ordenar()` no "Ver tudo" e no chip —
   * que é o que esta regra sempre guardou. */
  assert.match(corpo[1], /responder\(/, 'renderGrade não pega a resposta pelo responder()');
  const responder = app.match(/function responder\(base, termo\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(responder, 'não achei responder em app.js');
  assert.match(responder[1], /App\.ordenar\(App\.buscar\(base, termo\)\)/,
    'a grade única ainda precisa da ordem de ordenar(): série, temporada, episódio');

  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.ok(!/\.serie-titulo/.test(css), 'sobrou CSS morto do cabeçalho de série');
});

/* agrupar() saiu da grade mas continua no core, com teste em cima. */
test('agrupar continua exportado mesmo sem a grade por série', () => {
  assert.equal(typeof App.agrupar, 'function');
});

/* ---------------- a ordem da tabela da mesa (bater no cabeçalho) -------- */

/* Quatro títulos que cobrem os quatro buracos de dado que a tabela mostra: um
 * sem duração, um sem vídeo, um fora do ar e dois sem sinopse. A ordem do
 * acervo entre eles é curto, longo, semdur, semvid — "A classificar" é série
 * de triagem, e vai para o fim. */
const paraOrdenar = [
  { id: 'longo', titulo: 'Título Zeta', serie: 'Série Alfa', temporada: 1, episodio: 2, duracao_seg: 1200, publicar: true, sinopse: 'x', sinopse_origem: 'manual', fonte },
  { id: 'curto', titulo: 'Título Eta', serie: 'Série Alfa', temporada: 1, episodio: 1, duracao_seg: 300, publicar: true, sinopse: 'y', sinopse_origem: 'auto', fonte },
  { id: 'semdur', titulo: 'Título Gama', serie: 'Série Alfa', temporada: 1, episodio: 3, publicar: false, pendencia: 'material_bruto', fonte },
  { id: 'semvid', titulo: 'Avulso', serie: 'A classificar', temporada: null, episodio: null, duracao_seg: 700, publicar: true, fonte: { tipo: 'bunny' } }
];
const ordemDe = (coluna, decrescente) => App.ordenarPor(paraOrdenar, coluna, decrescente).map(i => i.id);

test('sem coluna escolhida, a tabela fica na ordem do acervo', () => {
  assert.deepEqual(ordemDe(''), ['curto', 'longo', 'semdur', 'semvid']);
  /* E uma coluna que o core não conhece não pode virar uma ordem qualquer. */
  assert.deepEqual(ordemDe('inventada'), ['curto', 'longo', 'semdur', 'semvid']);
});

/* O empate é o caso comum — três títulos no ar, doze com a mesma pendência —,
 * e sem desempate a tabela ficaria na ordem em que o KV devolveu, que muda
 * sozinha na próxima gravação. */
test('quem empata na coluna continua na ordem do acervo', () => {
  assert.deepEqual(ordemDe('no-ar'), ['curto', 'longo', 'semvid', 'semdur']);
});

/* A regra que mais custa a lembrar: um título sem duração não é o mais curto,
 * e virar a ordem não pode trazer a falta de dado para o alto da tela. */
test('o que está vazio fica no fim nas duas direções', () => {
  assert.deepEqual(ordemDe('duracao'), ['curto', 'semvid', 'longo', 'semdur']);
  assert.deepEqual(ordemDe('duracao', true), ['longo', 'semvid', 'curto', 'semdur']);
  /* O mesmo na coluna T · E, onde o vazio são os dois números faltando. */
  assert.equal(ordemDe('episodio').pop(), 'semvid');
  assert.equal(ordemDe('episodio', true).pop(), 'semvid');
  /* E na Pendência, onde o vazio é justamente quem não tem problema nenhum. */
  assert.deepEqual(ordemDe('pendencia').slice(2), ['curto', 'longo']);
  assert.deepEqual(ordemDe('pendencia', true).slice(2), ['curto', 'longo']);
});

/* As três colunas de estado sobem pelo que pede trabalho: a primeira batida
 * põe no topo as sinopses vazias, as pendências e o que está no ar. Numa mesa
 * de curadoria é para isso que se clica nelas. */
test('a primeira batida põe no alto o que pede trabalho', () => {
  assert.deepEqual(ordemDe('sinopse'), ['semdur', 'semvid', 'curto', 'longo']);
  assert.deepEqual(ordemDe('pendencia'), ['semdur', 'semvid', 'curto', 'longo']);
  assert.deepEqual(ordemDe('no-ar').slice(0, 3).sort(), ['curto', 'longo', 'semvid']);
});

/* A coluna Pendência mostra "sem vídeo" quando não há pendência e falta o
 * vídeo. Ordenar por outra coisa que não o que está escrito na célula faria a
 * tabela mentir. */
test('a coluna Pendência ordena pelo que a célula mostra, "sem vídeo" incluído', () => {
  assert.deepEqual(ordemDe('pendencia', true).slice(0, 2), ['semvid', 'semdur']);
});

test('ordenar pelo cabeçalho não mexe na lista que chegou', () => {
  const antes = paraOrdenar.map(i => i.id);
  App.ordenarPor(paraOrdenar, 'duracao', true);
  assert.deepEqual(paraOrdenar.map(i => i.id), antes);
});

/* ============================ busca ===================================== */

const comAcento = [
  { id: 'x', titulo: 'Título de Exemplo Típico', serie: 'Série Alfa', sinopse: 'Texto de exemplo sobre festas populares da região', tags: ['cultura'], publicar: true },
  { id: 'y', titulo: 'Matemática', serie: 'Curtas', sinopse: '', tags: ['ensino médio'], publicar: true }
];

test('a busca ignora acentos', () => {
  assert.equal(App.buscar(comAcento, 'tipico')[0].id, 'x');
  assert.equal(App.buscar(comAcento, 'TÍPICO')[0].id, 'x');
});

test('a busca exige todos os termos', () => {
  assert.equal(App.buscar(comAcento, 'festas exemplo').length, 1);
  assert.equal(App.buscar(comAcento, 'festas matematica').length, 0);
});

test('a busca alcança sinopse e tags', () => {
  assert.equal(App.buscar(comAcento, 'regiao')[0].id, 'x');
  assert.equal(App.buscar(comAcento, 'ensino')[0].id, 'y');
});

test('busca vazia devolve tudo', () => {
  assert.equal(App.buscar(comAcento, '   ').length, 2);
});

/* ============================ a busca do site ============= */

/* A busca pública ganhou arquivo e função próprios na fase 0 — a `App.buscar`
 * de cima é a da MESA, e fica como está (decisão de 21/09). Os quatro testes
 * dela são repetidos aqui, na função nova: o que a busca de antes garantia, a
 * de agora continua garantindo. */
const AppBusca = require('../core/site/busca-core.js');
const procurar = (itens, termo) => AppBusca.procurar(AppBusca.indice(itens), termo).titulos.map(t => t.item.id);

test('a busca nova ignora acentos, como a de antes', () => {
  assert.deepEqual(procurar(comAcento, 'tipico'), ['x']);
  assert.deepEqual(procurar(comAcento, 'TÍPICO'), ['x']);
});

test('a busca nova exige todos os termos, e cada um pode casar num campo', () => {
  assert.deepEqual(procurar(comAcento, 'festas exemplo'), ['x']);
  assert.deepEqual(procurar(comAcento, 'festas matematica'), []);
});

test('a busca nova alcança sinopse e tags', () => {
  assert.deepEqual(procurar(comAcento, 'regiao'), ['x']);
  assert.deepEqual(procurar(comAcento, 'ensino'), ['y']);
});

test('a busca nova, vazia, devolve tudo', () => {
  assert.equal(procurar(comAcento, '   ').length, 2);
});

/* Relevância, plural e erro de digitação. Os títulos são fictícios;
 * o *Pescador artesanal* é o exemplo da prova. */
const paraRelevancia = [
  { id: 'enfermeiro', titulo: 'Série Exemplo 1: Enfermeiro', serie: 'Série Exemplo 1',
    sinopse: 'O enfermeiro trabalha ao lado dos pescadores no mar.', publicar: true },
  { id: 'pescador', titulo: 'Série Exemplo 1: Pescador artesanal', serie: 'Série Exemplo 1',
    sinopse: 'A rotina de quem sai ao mar e sobe escada.', publicar: true },
  { id: 'aula', titulo: 'Módulo de exemplo', serie: 'Módulos', sinopse: 'Texto de exemplo sobre pressão.', publicar: true },
  { id: 'barcos', titulo: 'Curtas: barcos de água', serie: 'Curtas', sinopse: 'Como a água sobe.', publicar: true }
];

test('título com o termo no nome vem antes de quem só o tem na sinopse', () => {
  assert.deepEqual(procurar(paraRelevancia, 'pescador'), ['pescador', 'enfermeiro']);
  /* E o empate fica na ordem de hoje: os dois têm "sobe" só na sinopse, e
   * "Curtas" vem antes de "Série Exemplo 1" em `App.ordenar`. */
  assert.deepEqual(procurar(paraRelevancia, 'sobe'), ['barcos', 'pescador']);
});

test('"pescador", "pescadores" e "pesvador" acham o Pescador artesanal, o exato na frente', () => {
  const ind = AppBusca.indice(paraRelevancia);
  for (const q of ['pescador', 'pescadores', 'pesvador', 'psecador']) {
    assert.equal(AppBusca.procurar(ind, q).titulos[0].item.id, 'pescador', q + ' não pôs o Pescador artesanal na frente');
  }
  /* A palavra corrigida vale menos que a exata: é o que deixa o exato na
   * frente quando os dois aparecem. */
  const exato = AppBusca.procurar(ind, 'pescador').titulos[0].nota;
  const corrigido = AppBusca.procurar(ind, 'pesvador');
  assert.ok(corrigido.titulos[0].nota < exato, 'a palavra corrigida valeu tanto quanto a exata');
  assert.equal(corrigido.casadas[0].corrigido, true);
  assert.equal(AppBusca.procurar(ind, 'pescador').casadas[0].corrigido, false, 'corrigiu o que existia');
});

test('palavra inteira vale mais que começo de palavra, que vale mais que pedaço', () => {
  /* Na ordem alfabética, que é a do empate, seria Girassol, Sol, Soldado. */
  const itens = [
    { id: 'girassol', titulo: 'Girassol', serie: 'A', publicar: true },
    { id: 'soldado', titulo: 'Soldado', serie: 'A', publicar: true },
    { id: 'sol', titulo: 'Sol', serie: 'A', publicar: true }
  ];
  assert.deepEqual(procurar(itens, 'sol'), ['sol', 'soldado', 'girassol']);
  /* "Guarda-chuva" são DUAS palavras — o hífen corta, dos dois lados —, e
   * "chuva" é palavra inteira lá: não é pedaço. */
  const hifen = AppBusca.procurar(AppBusca.indice([{ id: 'g', titulo: 'Guarda-chuva', serie: 'A', publicar: true },
    { id: 'c', titulo: 'Chuva', serie: 'A', publicar: true }]), 'chuva').titulos;
  assert.equal(hifen[0].nota, hifen[1].nota);
});

/* As palavras do acervo, conferidas em 21/09 contra as 8.253 que existem nas
 * sinopses, nos capítulos e na fala. */
test('a raiz junta plural e singular, com as palavras do acervo', () => {
  const pares = [
    ['jardineiros', 'jardineiro'], ['aulas', 'aula'], ['profissões', 'profissão'], ['capitães', 'capitão'],
    ['animais', 'animal'], ['papéis', 'papel'], ['jovens', 'jovem'], ['imagens', 'imagem'],
    ['pintores', 'pintor'], ['luzes', 'luz'], ['meses', 'mês'], ['países', 'país'],
    ['canções', 'canção'], ['festas', 'festa'], ['mães', 'mãe'], ['fiéis', 'fiel'], ['finais', 'final']
  ];
  const r = (p) => AppBusca.raiz(App.normalizar(p));
  for (const [plural, singular] of pares) assert.equal(r(plural), r(singular), plural + ' e ' + singular);
});

test('a raiz não junta palavras diferentes que as regras confundiriam', () => {
  const r = (p) => AppBusca.raiz(App.normalizar(p));
  for (const [a, b] of [['mães', 'mão'], ['mais', 'mal'], ['seis', 'sei'], ['dois', 'dói'], ['três', 'trê']]) {
    assert.notEqual(r(a), r(b), a + ' caiu em ' + b);
  }
  assert.equal(r('mês'), 'mes', 'palavra de 3 letras não muda');
  assert.equal(r('2024'), '2024', 'número não muda');
});

test('o erro de digitação: de 4 letras para cima, uma letra — duas a partir de 8 —, e nunca número', () => {
  const itens = [
    { id: 'rua', titulo: 'A rua da cidade', serie: 'A', publicar: true },
    { id: 'ano', titulo: 'Formandos do ano de 2024', serie: 'A', publicar: true },
    { id: 'pesc', titulo: 'Pescadores', serie: 'A', publicar: true }
  ];
  assert.deepEqual(procurar(itens, 'rus'), [], 'corrigiu palavra de 3 letras');
  assert.deepEqual(procurar(itens, 'cidaed'), ['rua'], 'a troca de duas vizinhas não contou como uma');
  assert.deepEqual(procurar(itens, 'cidode'), ['rua'], 'não corrigiu uma letra numa palavra de 6');
  assert.deepEqual(procurar(itens, 'cizaxe'), [], 'corrigiu duas letras numa palavra de 6');
  assert.deepEqual(procurar(itens, 'pesvadorez'), ['pesc'], 'não corrigiu duas letras numa palavra de 10');
  assert.deepEqual(procurar(itens, '2025'), [], 'corrigiu um número');
  assert.equal(AppBusca.distancia('psecador', 'pescador', 2), 1, 'Damerau: vizinhas trocadas são uma troca');
  assert.equal(AppBusca.distancia('casa', 'carreta', 1), 2, 'com teto, a conta desiste e devolve teto + 1');
});

/* A palavra de 3 letras com erro (23/09, relatado por quem usa: "carro de boj"
 * vinha vazio, e "carro de boi" respondia). Sozinha ela continua sem correção
 * — no acervo, um erro de uma letra numa palavra de 3 fica a uma letra de 3
 * palavras em média, e só 24% têm candidato único: "boj" está a 1 de "bom",
 * "boa" e "boi". Com um VIZINHO que casou, o candidato tem de aparecer no mesmo
 * trecho que ele — campo, capítulo ou bloco da fala. No acervo, "boi" aparece
 * junto de "carro" em 3 trechos; "bom" e "boa", em nenhum. */
test('a palavra de 3 letras com erro só é corrigida pelo trecho que ela divide com a vizinha', () => {
  const itens = [
    { id: 'boi', titulo: 'O carro de boi na festa', serie: 'A', publicar: true },
    { id: 'bom', titulo: 'Bom começo', serie: 'A', sinopse: 'Uma aula boa.', publicar: true },
    { id: 'velho', titulo: 'Carro velho', serie: 'A', sinopse: 'Um bom conserto.', publicar: true }
  ];
  assert.deepEqual(procurar(itens, 'carro de boj'), ['boi'], 'não corrigiu "boj" pelo vizinho, ou corrigiu para bom/boa');
  assert.deepEqual(procurar(itens, 'boj carro'), ['boi'], 'a ordem dos termos mudou a resposta');
  assert.deepEqual(procurar(itens, 'boj'), [], 'sem vizinho, a palavra de 3 letras não pode ser corrigida');
  assert.deepEqual(procurar(itens, 'carro de bxj'), [], 'corrigiu duas letras numa palavra de 3');
  assert.deepEqual(procurar(itens, 'festa bpi'), ['boi'], 'o vizinho que acha pelo começo da palavra não valeu');
  /* "Carro" está no título do terceiro e "bom" na sinopse dele: campos
   * diferentes não são o mesmo trecho. */
  assert.deepEqual(procurar(itens, 'carro bpm'), [], 'o candidato valeu por estar em outro campo do mesmo título');
  /* E a contraprova: com os dois no MESMO campo, o candidato vale. Aceito, a
   * busca segue como se "bom" tivesse sido digitado — e aí o *Carro velho*,
   * com "bom" na sinopse, entra atrás, como entraria em "carro bom". O trecho
   * decide a PALAVRA; quem responde continua sendo a busca de sempre. */
  const juntos = itens.concat({ id: 'junto', titulo: 'Um carro bom', serie: 'A', publicar: true });
  assert.deepEqual(procurar(juntos, 'carro bpm'), procurar(juntos, 'carro bom'), 'a correção não deu a resposta da palavra certa');
  assert.deepEqual(procurar(juntos, 'carro bpm'), ['junto', 'velho'], 'o candidato no mesmo campo que o vizinho não valeu');
  const r = AppBusca.procurar(AppBusca.indice(itens), 'carro de boj');
  assert.equal(r.casadas[1].corrigido, true, 'a correção pelo vizinho não ficou marcada como corrigida');
  assert.deepEqual(r.casadas[1].lista, ['boi']);
});

/* A regra do projeto: nenhum PEDIDO a mais na chegada. (Ela prometia "0 byte a
 * mais", e os arquivos que já desciam cresceram 7,0 KB comprimidos — medido,
 * o registro de medições de lá.) A busca nova mora num arquivo que a chegada não pede — ele desce
 * no foco do campo, na lupa do celular ou na primeira tecla. Um <script> no
 * index.html, ou uma chamada no `iniciar()`, poria o arquivo em toda visita,
 * e ninguém veria nada de errado na tela. */
test('a chegada não baixa a busca: o busca-core.js só desce quando alguém vai buscar', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.ok(!/busca-core\.js/.test(html), 'o index.html carrega o busca-core.js — a chegada paga pela busca');
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const preparar = app.match(/function prepararBusca\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(preparar && /carregarScript\('busca-core\.js'\)/.test(preparar[1]), 'quem pede o busca-core.js não é o prepararBusca');
  assert.equal((app.match(/busca-core\.js/g) || []).length, 1, 'o busca-core.js é pedido de mais de um lugar');
  assert.match(app, /el\.busca\.addEventListener\('focus', prepararBusca\)/, 'o foco do campo não prepara a busca');
  assert.match(app.match(/function abrirBusca\(\) \{([\s\S]*?)\n  \}/)[1], /prepararBusca\(\)/, 'a lupa do celular não prepara a busca');
  const iniciar = app.match(/function iniciar\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.ok(!/prepararBusca\(\)/.test(iniciar), 'o iniciar() pede a busca na chegada');
});

/* A grade da resposta sai na ordem da RELEVÂNCIA. Um `App.ordenar` por cima
 * dela desfaria a fase 1 inteira, com todos os testes do core verdes. */
test('a grade da busca sai na ordem da resposta, e não reordenada por série', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const grade = app.match(/function renderGrade\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(grade, /responder\(baseDaGrade\(\), estado\.termo\)/);
  assert.ok(!/App\.ordenar\(lista\)/.test(grade), 'a grade reordena a resposta por série');
  assert.ok(!/App\.buscar\(/.test(grade), 'a grade voltou a chamar a App.buscar direto');
});

/* A fase 2: os capítulos na busca, os trechos e o `?t=`. */
test('a rota da ficha leva o momento, e o `t` que não é inteiro é ignorado', () => {
  assert.deepEqual(App.rotaDaFicha('#/ep/exemplo-ep-2024-master'), { id: 'exemplo-ep-2024-master', t: null });
  assert.deepEqual(App.rotaDaFicha('#/ep/exemplo-ep-2024-master?t=399'), { id: 'exemplo-ep-2024-master', t: 399 });
  for (const torto of ['abc', '1.5', '-3', '', '1e3']) {
    assert.equal(App.rotaDaFicha('#/ep/x?t=' + torto).t, null, '?t=' + torto + ' não foi ignorado');
  }
  /* O `?` do id vai codificado, e não separa nada; o `%` solto não derruba. */
  assert.deepEqual(App.rotaDaFicha('#/ep/' + encodeURIComponent('a?b') + '?t=5'), { id: 'a?b', t: 5 });
  assert.equal(App.rotaDaFicha('#/ep/100%-certo').id, '100%-certo');
  assert.equal(App.rotaDaFicha('#/serie/Módulos'), null);
  assert.equal(App.rotaDaFicha(App.linkDaFicha('a?b', 12)).t, 12, 'o link e a rota não se entendem');
});

const comCapitulos = [
  { id: 'pescador', titulo: 'Série Exemplo 1: Pescador artesanal', serie: 'Série Exemplo 1', publicar: true,
    sinopse: 'A rotina do cais.',
    capitulos: [{ inicio: 0, titulo: 'O cais' }, { inicio: 125, titulo: 'Escada do molhe' },
      { inicio: 300, titulo: 'A travessia na maré' }, { inicio: 480, titulo: 'Ganhos e preços' }] },
  { id: 'agro', titulo: 'Série Exemplo 1: Zootecnista rural', serie: 'Série Exemplo 1', publicar: true,
    sinopse: 'O campo e a pesquisa.',
    capitulos: [{ inicio: 60, titulo: 'A escada da cooperativa' }, { inicio: 399, titulo: 'Prazos e preços na área' }] }
];

test('o capítulo que casa vira trecho, com o momento em que começa', () => {
  const r = AppBusca.procurar(AppBusca.indice(comCapitulos), 'preços');
  assert.deepEqual(r.titulos.map(t => t.item.id), ['pescador', 'agro']);
  assert.deepEqual(r.trechos.map(t => [t.item.id, t.tipo, t.inicio, t.texto]), [
    ['pescador', 'capitulo', 480, 'Ganhos e preços'],
    ['agro', 'capitulo', 399, 'Prazos e preços na área']
  ]);
  /* O capítulo pesa mais que a sinopse e menos que o nome. */
  assert.ok(AppBusca.PESOS.titulo > AppBusca.PESOS.capitulo && AppBusca.PESOS.capitulo > AppBusca.PESOS.sinopse);
});

/* A REGRA DO CONTEXTO: um termo no trecho, e os outros no trecho ou no
 * título dele. O contexto é o título, e não o vídeo inteiro. */
test('o trecho responde com o contexto do título, e não com o do vídeo inteiro', () => {
  const ind = AppBusca.indice(comCapitulos);
  const escada = AppBusca.procurar(ind, 'pescador escada');
  assert.deepEqual(escada.trechos.map(t => [t.item.id, t.inicio]), [['pescador', 125]],
    '"pescador" está no nome, "escada" no capítulo: é o Escada do molhe, e só ele');
  const resgate = AppBusca.procurar(ind, 'travessia escada');
  assert.deepEqual(resgate.titulos.map(t => t.item.id), ['pescador'], 'os dois termos estão no vídeo');
  assert.deepEqual(resgate.trechos, [],
    'um termo em outro capítulo virou contexto — assim todo capítulo do vídeo responderia');
});

test('os trechos se agrupam por vídeo, três à mostra, na ordem do vídeo', () => {
  const t = (id, inicio, nota) => ({ item: { id }, tipo: 'capitulo', inicio, texto: '', nota });
  const grupos = AppBusca.agruparTrechos([t('a', 500, 9), t('b', 10, 8), t('a', 30, 7), t('a', 900, 6), t('a', 100, 5)], 3);
  assert.deepEqual(grupos.map(g => g.item.id), ['a', 'b'], 'o grupo sai na ordem do seu melhor trecho');
  assert.deepEqual(grupos[0].visiveis.map(x => x.inicio), [30, 500, 900], 'à mostra: os três melhores, na ordem do vídeo');
  assert.deepEqual(grupos[0].resto.map(x => x.inicio), [100]);
  assert.deepEqual(grupos[0].todos.map(x => x.inicio), [30, 100, 500, 900], 'o "mais N" abre todos, na ordem do vídeo');
  assert.equal(grupos[0].total, 4);
});

/* A MARCA é devolvida em pedaços de texto, e a tela os monta um a um: a fala
 * é ASR, e um "<" dela não pode virar tag. */
test('a marca da busca sai em pedaços de texto, com a palavra como o texto a escreve', () => {
  const r = AppBusca.procurar(AppBusca.indice(comCapitulos), 'preco');
  assert.deepEqual(AppBusca.marcar('Prazos e preços na área', r.casadas),
    [{ texto: 'Prazos e ', marca: false }, { texto: 'preços', marca: true }, { texto: ' na área', marca: false }]);
  assert.deepEqual(AppBusca.marcar('<b>preços</b>', r.casadas).map(p => p.texto).join(''), '<b>preços</b>',
    'a marca mexeu no texto');
  assert.deepEqual(AppBusca.marcar('sem nada', []), [{ texto: 'sem nada', marca: false }]);
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(app), 'o app.js monta HTML de texto — a fala passaria por ali');
  assert.match(app.match(/function comMarcas\(no, pedacos\)\s*\{([\s\S]*?)\n  \}/)[1],
    /p\.marca \? criar\('mark', null, p\.texto\) : document\.createTextNode\(p\.texto\)/);
});

/* A tela da resposta: "N títulos · M trechos", o vazio só quando nada
 * responde, a contagem dita a quem ouve, e 44 px em cada trecho. */
test('a resposta conta os trechos, e o vazio só aparece quando nada responde', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const grade = app.match(/function renderGrade\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(grade, /var vazia = !lista\.length && !trechos\.length;/, 'o vazio aparece com trecho na tela');
  /* D7: com o vazio na tela, a contagem sai — "0 títulos de 69" repetia o
   * título do estado, em língua de programador. */
  assert.match(grade, /if \(!vazia\) el\.grade\.appendChild\(criar\('p', 'contagem', contagem\)\);/);
  assert.match(grade, /' · ' \+ tr\('comum\.trechos', \{ n: trechos\.length \}\)/);
  assert.match(grade, /secaoTrechos\(trechos, resposta\.casadas\)/);
  /* O anúncio: um nó que nasce na partida, antes de haver o que anunciar. */
  const iniciar = app.match(/function iniciar\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(iniciar, /busca\.anuncio\.setAttribute\('aria-live', 'polite'\)/);
  const css = lerTexto(path.join(SITE, 'style.css'));
  const trecho = css.match(/\n\.trecho \{([\s\S]*?)\n\}/);
  assert.ok(trecho, 'não achei .trecho em style.css');
  assert.match(trecho[1], /min-height: 44px/, 'o trecho é alvo de toque, e tem de ter 44 px');
  assert.match(css, /\.trecho:focus-visible \{ outline: 2px solid var\(--marca\)/, 'o trecho perdeu o foco visível');
  assert.match(css, /\.trecho-mais \{[\s\S]*?min-height: 44px/, 'o "mais N" tem de ter 44 px');
});

/* A fase 3: a fala, literal. O índice mora no KV numa linha por vídeo, e o
 * que a escreve (o servidor) e o que a lê (o navegador) são arquivos
 * diferentes — por isso o formato tem teste de ida e volta. */
const blocosDeFala = [[0, 'Bom dia, turma. Hoje o assunto é o mercado de trabalho.'],
  [31, 'Quem faz o técnico entra no mercado de trabalho mais cedo.'], [62, 'E a escada da carreira começa ali.']];

test('a linha da fala vai e volta: o servidor escreve e o navegador lê a mesma coisa', () => {
  const texto = AppIndice.trocarLinha('', 'video-aaaa-1111', blocosDeFala);
  assert.deepEqual(AppBusca.lerFala(texto)['video-aaaa-1111'], blocosDeFala);
  /* Um texto com aspas, tab e quebra de linha dentro não quebra a linha. */
  const torto = [[5, 'ele disse "olá"\te foi\nembora']];
  assert.deepEqual(AppBusca.lerFala(AppIndice.linhaDaFala('video-bbbb-2222', torto))['video-bbbb-2222'], torto);
  assert.equal(AppIndice.linhaDaFala('video-bbbb-2222', torto).split('\n').length, 1);
  /* Linha estragada é pulada, e as outras continuam. */
  const lida = AppBusca.lerFala('lixo\nvideo-cccc-3333\t[[0, "ok"]]\nvideo-dddd\t[[0,');
  assert.deepEqual(Object.keys(lida), ['video-cccc-3333']);
});

test('trocar a linha de um vídeo não mexe nas outras, e vídeo sem fala sai do índice', () => {
  let t = AppIndice.trocarLinha('', 'video-aaaa-1111', blocosDeFala);
  t = AppIndice.trocarLinha(t, 'video-bbbb-2222', [[0, 'outro']]);
  t = AppIndice.trocarLinha(t, 'video-aaaa-1111', [[0, 'novo']]);
  assert.deepEqual(t.split('\n').map(l => l.split('\t')[0]), ['video-aaaa-1111', 'video-bbbb-2222'], 'a troca mudou a ordem');
  assert.deepEqual(AppBusca.lerFala(t)['video-aaaa-1111'], [[0, 'novo']]);
  t = AppIndice.trocarLinha(t, 'video-aaaa-1111', []);
  assert.deepEqual(Object.keys(AppBusca.lerFala(t)), ['video-bbbb-2222']);
});

/* "Título tirado do ar some da fala sem rodar nada" (fase 3): o filtro é
 * do GET, pelo catálogo da hora. */
test('o índice da fala sai só com os vídeos no ar, pelo catálogo da hora', () => {
  let t = AppIndice.trocarLinha('', 'video-no-ar-1', [[0, 'a']]);
  t = AppIndice.trocarLinha(t, 'video-fora-1', [[0, 'b']]);
  const cat = { itens: [{ id: 'a', publicar: true, fonte: { videoId: 'video-no-ar-1' } },
    { id: 'b', publicar: false, fonte: { videoId: 'video-fora-1' } }] };
  assert.deepEqual(AppIndice.linhasNoAr(t, AppIndice.videosNoAr(cat)).split('\n').map(l => l.split('\t')[0]), ['video-no-ar-1']);
  cat.itens[0].publicar = false;
  assert.equal(AppIndice.linhasNoAr(t, AppIndice.videosNoAr(cat)), '');
});

test('o pedido de indexar é conferido na forma, e o torto não chega ao índice', () => {
  const ok = AppIndice.validarPedido({ videoId: 'video-aaaa-1111', fala: blocosDeFala, fim: true });
  assert.equal(ok.erro, undefined);
  assert.deepEqual(ok.fala, blocosDeFala);
  const erros = [
    {},
    { videoId: '../catalogo', fim: true },
    { videoId: 'video-aaaa-1111' },
    { videoId: 'video-aaaa-1111', fala: blocosDeFala },
    { videoId: 'video-aaaa-1111', fala: [[0, 'a'], [0, 'b']], fim: true },
    { videoId: 'video-aaaa-1111', fala: [[1.5, 'a']], fim: true },
    { videoId: 'video-aaaa-1111', fala: [[0, '   ']], fim: true },
    { videoId: 'video-aaaa-1111', vetores: new Array(21).fill(['f', 0, 'x']) },
    { videoId: 'video-aaaa-1111', vetores: [['x', 0, 'texto']] }
  ];
  for (const e of erros) assert.ok(AppIndice.validarPedido(e).erro, 'passou: ' + JSON.stringify(e).slice(0, 80));
});

test('o manifesto guarda o hash e os inícios, e diz quais vetores sumiram', () => {
  const um = AppIndice.manifestoNovo(null, AppIndice.validarPedido({ videoId: 'video-aaaa-1111', fala: blocosDeFala, fim: true }), 'x');
  assert.equal(um.manifesto.versao, 1);
  const v = um.manifesto.videos['video-aaaa-1111'];
  assert.deepEqual(v.fala.inicios, [0, 31, 62]);
  assert.equal(v.fala.hash, AppIndice.hashConjunto(blocosDeFala));
  assert.equal(v.fala.sentido, false);
  assert.deepEqual(um.apagar, []);
  /* A legenda trocada perdeu o bloco de 62 s: o vetor dele tem de sair. */
  const dois = AppIndice.manifestoNovo(um.manifesto,
    AppIndice.validarPedido({ videoId: 'video-aaaa-1111', fala: blocosDeFala.slice(0, 2), fim: true, sentido: true }), 'y');
  assert.equal(dois.manifesto.versao, 2);
  assert.deepEqual(dois.apagar, ['f:video-aaaa-1111:62']);
  assert.equal(dois.manifesto.videos['video-aaaa-1111'].fala.sentido, true);
  assert.equal(um.manifesto.versao, 1, 'o manifesto de antes foi alterado — a função tem de ser pura');
  /* A sinopse que ficou vazia leva o vetor dela. */
  const tres = AppIndice.manifestoNovo(dois.manifesto, AppIndice.validarPedido({ videoId: 'video-aaaa-1111', sinopse: 'Título. Sinopse.', fim: true }), 'z');
  const quatro = AppIndice.manifestoNovo(tres.manifesto, AppIndice.validarPedido({ videoId: 'video-aaaa-1111', sinopse: '', fim: true }), 'w');
  assert.deepEqual(quatro.apagar, ['s:video-aaaa-1111']);
});

test('os conjuntos de um título saem do catálogo, e a sinopse leva o título junto', () => {
  const c = AppIndice.conjuntosDoItem(comCapitulos[0]);
  assert.deepEqual(c.capitulos.slice(0, 2), [[0, 'O cais'], [125, 'Escada do molhe']]);
  assert.equal(c.sinopse, 'Série Exemplo 1: Pescador artesanal. A rotina do cais.');
  assert.equal(AppIndice.textoDaFicha({ titulo: 'Vídeo institucional' }), 'Vídeo institucional', 'título sem sinopse');
  assert.deepEqual(AppIndice.vetoresDosConjuntos({ fala: [[0, 'a']], capitulos: [[5, 'b']], sinopse: 'c' }),
    [['f', 0, 'a'], ['c', 5, 'b'], ['s', 0, 'c']]);
  assert.deepEqual(AppIndice.lotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(AppIndice.idDoVetor('s', 'v', 0), 's:v');
  assert.equal(AppIndice.idDoVetor('f', 'v', 62), 'f:v:62');
});

const comFala = { 'video-pesc-0001': [[0, 'Hoje vamos falar da profissão de pescador artesanal.'], [125, 'A escada do molhe sobe trinta metros.'],
  [300, 'Na travessia da maré a água chegava ao farol.']] };
const comCapitulosEVideo = comCapitulos.map((i, n) => Object.assign({}, i, { fonte: { videoId: n === 0 ? 'video-pesc-0001' : 'video-agro-0002' } }));

test('a fala entra na busca: o bloco que casa vira trecho, com o capítulo em que cai', () => {
  const ind = AppBusca.indice(comCapitulosEVideo, comFala);
  const r = AppBusca.procurar(ind, 'maré farol');
  assert.deepEqual(r.titulos.map(t => t.item.id), ['pescador'], 'o que só a fala diz achou o título');
  assert.deepEqual(r.trechos.map(t => [t.tipo, t.inicio, t.capitulo]), [['fala', 300, 'A travessia na maré']]);
  /* Sem a fala, os capítulos respondem sozinhos. */
  assert.deepEqual(AppBusca.procurar(AppBusca.indice(comCapitulosEVideo), 'maré').trechos.map(t => t.tipo), ['capitulo']);
  /* E a fala é a menor das notas: quem tem o termo no nome continua na frente. */
  assert.ok(AppBusca.PESOS.fala < AppBusca.PESOS.sinopse);
});

/* Os capítulos foram escritos lendo estes mesmos blocos de 30 s: o capítulo e
 * o bloco que começam no mesmo segundo são o mesmo momento, e a lista não
 * pode mostrar a mesma linha duas vezes. */
test('o capítulo e o bloco que começam juntos viram um trecho só, no segundo do capítulo', () => {
  const r = AppBusca.procurar(AppBusca.indice(comCapitulosEVideo, comFala), 'escada');
  const doPescador = r.trechos.filter(t => t.item.id === 'pescador');
  assert.equal(doPescador.length, 1);
  assert.deepEqual([doPescador[0].tipo, doPescador[0].inicio, doPescador[0].capitulo], ['fala', 125, 'Escada do molhe']);

  /* O caso do *Dentista*, no ar em 21/09: o bloco começa em 1:48 e o capítulo
   * "Os 13 vestibulares", em 1:50. Fica um trecho, no segundo do capítulo. */
  const dentista = [{ id: 'dentista', titulo: 'Dentista', serie: 'A', publicar: true, fonte: { videoId: 'video-dent-0001' },
    capitulos: [{ inicio: 0, titulo: 'Como escolheu a odontologia' }, { inicio: 110, titulo: 'Os 13 vestibulares' }] }];
  const fala = { 'video-dent-0001': [[108, 'você tava falando que foram 13 vestibulares'], [400, 'o vestibular de novo, bem depois']] };
  const trechos = AppBusca.procurar(AppBusca.indice(dentista, fala), 'vestibulares').trechos;
  assert.deepEqual(trechos.map(t => [t.tipo, t.inicio, t.capitulo]).sort((a, b) => a[1] - b[1]),
    [['fala', 110, 'Os 13 vestibulares'], ['fala', 400, 'Os 13 vestibulares']],
    'o bloco a 2 s do capítulo virou uma linha à parte — ou o de 400 s foi engolido');
});

/* Achado ao medir a fala em 21/09: "mercado de trabalho" punha na frente o
 * título que tinha "Mercado" no nome — o prédio — e "trabalho" solto na fala,
 * atrás do que tem um capítulo com a expressão inteira. */
test('os termos juntos no mesmo lugar valem mais que espalhados', () => {
  const itens = [
    { id: 'predio', titulo: 'Art déco e Mercado Municipal', serie: 'B', publicar: true, fonte: { videoId: 'video-pred-0001' } },
    { id: 'tecnico', titulo: 'Técnico integrado', serie: 'A', publicar: true, fonte: { videoId: 'video-tecn-0002' },
      capitulos: [{ inicio: 162, titulo: 'O técnico abre as portas do mercado de trabalho' }] }
  ];
  const fala = { 'video-pred-0001': [[0, 'o trabalho de restauro do prédio']] };
  assert.deepEqual(procurarCom(itens, fala, 'mercado de trabalho'), ['tecnico', 'predio']);
});
const procurarCom = (itens, fala, termo) => AppBusca.procurar(AppBusca.indice(itens, fala), termo).titulos.map(t => t.item.id);

test('a frase do trecho: ~120 caracteres em volta da palavra, cortados na palavra', () => {
  const longo = 'Começo de conversa sem nada de importante por aqui, só enchendo a frase para ela ficar comprida. ' +
    'Depois vem a travessia na maré, com a água no farol, e a conversa continua por muito tempo ainda, bem depois do fim.';
  const r = AppBusca.procurar(AppBusca.indice([{ id: 'x', titulo: 'X', serie: 'A', publicar: true, fonte: { videoId: 'video-xxxx-0001' } }],
    { 'video-xxxx-0001': [[0, longo]] }), 'maré');
  const pedacos = AppBusca.frase(longo, r.casadas, 120);
  const texto = pedacos.map(p => p.texto).join('');
  assert.ok(texto.startsWith('…') && texto.endsWith('…'), 'o corte não foi marcado: ' + texto);
  assert.ok(texto.length <= 125, 'a frase passou do tamanho: ' + texto.length);
  assert.deepEqual(pedacos.filter(p => p.marca).map(p => p.texto), ['maré']);
  /* O miolo é um pedaço do texto que começa e termina em fronteira de
   * palavra: antes dele e depois dele, no original, há um espaço. */
  const miolo = texto.slice(1, -1);
  const onde = longo.indexOf(miolo);
  assert.ok(onde > 0, 'o miolo não é um pedaço do texto: ' + miolo);
  assert.equal(longo[onde - 1], ' ', 'começou no meio de uma palavra');
  assert.equal(longo[onde + miolo.length], ' ', 'terminou no meio de uma palavra');
  /* Sem marca — o trecho do sentido, na fase 4 —, o começo do bloco. */
  assert.ok(AppBusca.frase(longo, [], 120).map(p => p.texto).join('').startsWith('Começo de conversa'));
  /* O que já cabe, cabe inteiro. */
  assert.equal(AppBusca.frase('curto', [], 120).map(p => p.texto).join(''), 'curto');
});

test('as palavras vazias não viram termo — a não ser que a consulta seja só delas', () => {
  const itens = [
    { id: 'fracao', titulo: 'Frações na cozinha', serie: 'A', sinopse: 'Medidas de receita.', publicar: true },
    { id: 'de', titulo: 'Título de Exemplo Dois', serie: 'B', sinopse: 'Sobre a língua.', publicar: true }
  ];
  assert.deepEqual(AppBusca.termos('o que é fração'), ['fracao']);
  assert.deepEqual(procurar(itens, 'o que é fração'), ['fracao'], 'o "que" que falta na sinopse tirou o título da resposta');
  assert.deepEqual(procurar(itens, 'de'), ['de', 'fracao'], 'uma consulta só de palavra vazia deixou de valer');
});

/* ============================ navegação ================================= */

test('os vizinhos ficam dentro da própria série e param nas pontas', () => {
  const publicados = App.publicaveis(acervo);
  const meio = App.vizinhos(publicados, 'b');
  assert.equal(meio.anterior.id, 'a');
  assert.equal(meio.proximo.id, 'c');

  const primeiro = App.vizinhos(publicados, 'a');
  assert.equal(primeiro.anterior, null);

  const sozinho = App.vizinhos(publicados, 'd');
  assert.equal(sozinho.anterior, null);
  assert.equal(sozinho.proximo, null);
});

/* ============================ admin ===================================== */

test('o id sai do título, sem acento e sem colidir', () => {
  assert.equal(App.slug('Série Exemplo — Título Comum'), 'serie-exemplo-titulo-comum');
  const itens = [{ id: 'titulo-comum' }, { id: 'titulo-comum-2' }];
  assert.equal(App.idUnico(itens, 'Título Comum'), 'titulo-comum-3');
  assert.equal(App.idUnico(itens, 'Cânone'), 'canone');
});

test('sinopse automática nasce marcada como não revisada', () => {
  assert.equal(App.precisaRevisao({ sinopse_origem: 'auto' }), true);
  assert.equal(App.precisaRevisao({ sinopse_origem: 'revisada' }), false);
  assert.equal(App.precisaRevisao({ sinopse_origem: '' }), false);
});

test('as três filas da M3 pegam só quem precisa, na mesma ordem de sempre', () => {
  const itens = [
    { id: 'b', serie: 'B', titulo: 'B', publicar: true, sinopse: 'x', sinopse_origem: 'auto' },
    { id: 'a', serie: 'A', titulo: 'A', publicar: true, sinopse: '', sinopse_origem: '' },
    { id: 'c', serie: 'C', titulo: 'C', publicar: true, sinopse: 'ok', sinopse_origem: 'revisada' },
    { id: 'd', serie: 'D', titulo: 'D', publicar: false, sinopse: '', sinopse_origem: '' },
    { id: 'e', serie: 'E', titulo: 'E', publicar: true, sinopse: 'ok', sinopse_origem: 'auto', pendencia: 'audio_sem_trilha' }
  ];

  assert.deepEqual(App.filaSinopses(itens).map(i => i.id), ['b', 'e'], 'só sinopse_origem === auto, sinopse vazia não conta aqui');
  assert.deepEqual(App.filaSemSinopse(itens).map(i => i.id), ['a'], 'só título NO AR com a ficha de sinopse vazia');
  assert.deepEqual(App.filaPendencias(itens).map(i => i.id), ['e'], 'pendência independe de estar no ar');

  /* A ordem é sempre a de `ordenar` (por série), nunca a do array de entrada —
   * senão "3 de 56" mudaria de sentido a cada redesenho da mesa. */
  assert.deepEqual(App.filaSinopses(itens.slice().reverse()).map(i => i.id), ['b', 'e']);
});

test('a "outra versão" de uma duplicata é achada pelo sufixo do id, não por um vínculo gravado', () => {
  assert.equal(App.baseIdSemVersao('curta-exemplo-2024-v1'), 'curta-exemplo-2024');
  assert.equal(App.baseIdSemVersao('curta-exemplo-2024-master'), 'curta-exemplo-2024');
  assert.equal(App.baseIdSemVersao('curta-exemplo-2024'), 'curta-exemplo-2024', 'sem sufixo de versão, o id não muda');

  const itens = [
    { id: 'curta-exemplo-2024-v1', duracao_seg: 141 },
    { id: 'curta-exemplo-2024-master', duracao_seg: 103, pendencia: 'versao_duplicada' },
    { id: 'outra-coisa', duracao_seg: 10 }
  ];
  const par = App.outraVersaoDuplicada(itens, itens[1]);
  assert.equal(par && par.id, 'curta-exemplo-2024-v1');

  /* Sem par no catálogo — como é o caso real de hoje (16/09): a outra versão
   * já foi apagada, e a fila tem de continuar funcionando sem comparação. */
  const sozinho = { id: 'exemplo-ep02-2024-master', pendencia: 'versao_duplicada' };
  assert.equal(App.outraVersaoDuplicada([sozinho], sozinho), null);
});

test('item novo nasce não publicado e no esquema do catálogo', () => {
  const item = App.itemNovo({ titulo: 'Teste', videoId: 'abc', libraryId: '1' });
  assert.equal(item.publicar, false);
  /* O formato de antes do M4 (videoId/libraryId) ainda entra, e sai migrado. */
  assert.deepEqual(item.fonte, { provedor: 'bunny', id: 'abc', extras: { libraryId: '1' } });
  /* O que o servidor devolve no upload-token (`fonte`) entra como veio. */
  const novo = App.itemNovo({ titulo: 'Teste', fonte: { provedor: 'cloudflare-stream', id: 'f'.repeat(32), extras: {} } });
  assert.deepEqual(novo.fonte, { provedor: 'cloudflare-stream', id: 'f'.repeat(32), extras: {} });
  for (const campo of ['id', 'titulo', 'serie', 'temporada', 'episodio', 'sinopse',
    'tema', 'publico_alvo', 'tags', 'titularidade', 'nivel_evidencia', 'pendencia',
    'publicar', 'sinopse_origem', 'fonte']) {
    assert.ok(campo in item, 'faltou o campo ' + campo);
  }
});

/* ---------------------- o rascunho da mesa (15/09) ---------------------- */

/* O rascunho da mesa é uma lista de mudanças campo a campo.
 * Cada regra abaixo é um jeito de o Publicar gravar o que ninguém pediu:
 *   1. mudar o mesmo campo duas vezes guarda o `antes` da PRIMEIRA — é contra
 *      ele que o Publicar confere se outra tela mexeu no meio;
 *   2. voltar ao valor original tira a mudança da lista — senão o Publicar
 *      grava um campo igual, e o histórico registra um nada;
 *   3. aplicar não altera o catálogo recebido: a mesa guarda o original para
 *      mostrar o "antes" e o site no ar. */
test('o rascunho guarda o antes da primeira mudança e esquece a que voltou atrás', () => {
  let r = [];
  r = App.registrarMudanca(r, { alvo: 'a', campo: 'titulo', antes: 'Velho', depois: 'Novo' });
  r = App.registrarMudanca(r, { alvo: 'a', campo: 'titulo', antes: 'Novo', depois: 'Novíssimo' });
  assert.equal(r.length, 1);
  assert.equal(r[0].antes, 'Velho', 'a segunda mudança apagou o antes da primeira');
  assert.equal(r[0].depois, 'Novíssimo');

  r = App.registrarMudanca(r, { alvo: 'a', campo: 'titulo', antes: 'Novíssimo', depois: 'Velho' });
  assert.equal(r.length, 0, 'voltar ao original tem de tirar a mudança do rascunho');

  /* `tags` é lista: igual é por valor, não por referência. */
  assert.equal(App.registrarMudanca([], { alvo: 'a', campo: 'tags', antes: ['x'], depois: ['x'] }).length, 0);
});

test('aplicar o rascunho não mexe no catálogo recebido, nem no rev', () => {
  const cat = { rev: 3, ajustes: { arrastoTeto: 0.6 }, itens: [{ id: 'a', titulo: 'Velho', tags: [] }] };
  const novo = App.aplicarRascunho(cat, [
    { alvo: 'a', campo: 'titulo', antes: 'Velho', depois: 'Novo' },
    { alvo: 'ajustes', campo: 'arrastoTeto', antes: 0.6, depois: 0.5 }
  ]);
  assert.equal(novo.itens[0].titulo, 'Novo');
  assert.equal(novo.ajustes.arrastoTeto, 0.5);
  assert.equal(cat.itens[0].titulo, 'Velho', 'aplicar alterou o catálogo original');
  assert.equal(cat.ajustes.arrastoTeto, 0.6, 'aplicar alterou os ajustes originais');
  assert.equal(novo.rev, 3, 'o rev é do servidor: aplicar não mexe nele');
});

/* A mesa edita o que uma pessoa edita. `id`, `fonte` e `rev` não passam por ela:
 * um `fonte` trocado aponta a ficha para outro vídeo, e o `rev` é a trava de
 * concorrência. Esta é a trava do navegador; a do servidor é da M2. */
test('o rascunho não grava campo fora da lista da mesa', () => {
  const cat = { rev: 1, ajustes: {}, itens: [{ id: 'a', fonte: { videoId: 'v' } }] };
  const novo = App.aplicarRascunho(cat, [
    { alvo: 'a', campo: 'id', antes: 'a', depois: 'b' },
    { alvo: 'a', campo: 'fonte', antes: { videoId: 'v' }, depois: { videoId: 'outro' } },
    { alvo: 'ajustes', campo: 'qualquer', antes: null, depois: 1 }
  ]);
  assert.equal(novo.itens[0].id, 'a');
  assert.equal(novo.itens[0].fonte.videoId, 'v');
  assert.ok(!('qualquer' in novo.ajustes), 'um ajuste desconhecido entrou pelo rascunho');
  for (const campo of ['titulo', 'sinopse', 'sinopse_origem', 'publicar', 'pendencia',
    'titularidade', 'nivel_evidencia', 'capa_arquivo', 'capa_versao']) {
    assert.ok(App.CAMPOS_ITEM_MESA.includes(campo), campo + ' saiu da lista da mesa');
  }
});

/* O conflito que o 409 não sabe explicar: outra tela mudou o MESMO campo entre
 * o começo do rascunho e o Publicar. Outro campo, ou outro título, é o caso
 * normal de duas pessoas trabalhando — e a mesma mudança feita pelas duas
 * também não é conflito: o servidor já está onde o rascunho queria. */
test('conflito é o mesmo campo mudado por outra tela, e só ele', () => {
  const agora = {
    ajustes: {},
    itens: [
      { id: 'a', titulo: 'Mudado por outra tela', sinopse: 'S', serie: 'Nova' },
      { id: 'b', titulo: 'B' }
    ]
  };
  const c = App.conflitosRascunho(agora, [
    { alvo: 'a', campo: 'titulo', antes: 'Velho', depois: 'Meu' },
    { alvo: 'a', campo: 'sinopse', antes: 'S', depois: 'S2' },
    { alvo: 'b', campo: 'titulo', antes: 'B', depois: 'B2' },
    { alvo: 'a', campo: 'serie', antes: 'Antiga', depois: 'Nova' }
  ]);
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.equal(c[0].alvo, 'a');
  assert.equal(c[0].campo, 'titulo');
  assert.equal(c[0].noServidor, 'Mudado por outra tela');

  const sumiu = App.conflitosRascunho({ ajustes: {}, itens: [] },
    [{ alvo: 'x', campo: 'titulo', antes: 'T', depois: 'U' }]);
  assert.equal(sumiu.length, 1);
  assert.equal(sumiu[0].sumiu, true, 'título que sumiu do catálogo tem de parar o Publicar');
});

/* O DESTAQUE É UM (D4), e a regra mora no aplicarRascunho — não no rascunho —
 * porque tem de valer sobre a leitura fresca do Publicar. Se outra tela marcou
 * um terceiro título no meio, a conferência campo a campo não vê: são campos
 * de títulos diferentes. */
test('o rascunho que destaca um título apaga a marca dos outros, até a de outra tela', () => {
  const agora = {
    itens: [
      { id: 'a', publicar: true },
      { id: 'b', publicar: true, destaque: true },
      { id: 'c', publicar: true, destaque: true }
    ]
  };
  const novo = App.aplicarRascunho(agora, [
    { alvo: 'c', campo: 'destaque', antes: true, depois: null },
    { alvo: 'a', campo: 'destaque', antes: null, depois: true }
  ]);
  assert.deepEqual(novo.itens.filter(i => i.destaque === true).map(i => i.id), ['a'],
    'sobrou mais de um destaque — a marca que outra tela pôs em b ficou');
  assert.ok(!('destaque' in novo.itens[2]), 'desmarcar tem de APAGAR o campo, como o /admin fazia');
  assert.equal(agora.itens[1].destaque, true, 'aplicar mexeu no catálogo recebido');
});

/* ------------------- contas e permissões (M2, 16/09) -------------------- */

/* A permissão de cada campo. O que não está em lista nenhuma é do superadmin
 * de propósito: `fonte` aponta a ficha para outro vídeo, `capitulos` e
 * `framerate` vêm de script, e um título removido não existe pela mesa. */
test('cada campo tem a sua permissão, e o resto é só do superadmin', () => {
  assert.deepEqual(App.PERMISSOES, ['conteudo', 'no-ar', 'enviar', 'estrutura', 'player', 'historico']);
  assert.equal(App.permissaoDoCampo('x', 'titulo'), 'conteudo');
  assert.equal(App.permissaoDoCampo('x', 'sinopse_origem'), 'conteudo');
  assert.equal(App.permissaoDoCampo('x', 'capa_arquivo'), 'conteudo');
  assert.equal(App.permissaoDoCampo('x', 'publicar'), 'no-ar');
  assert.equal(App.permissaoDoCampo('x', 'destaque'), 'estrutura');
  assert.equal(App.permissaoDoCampo('ajustes', 'arrastoTeto'), 'player');
  assert.equal(App.permissaoDoCampo('x', 'fonte'), null);
  assert.equal(App.permissaoDoCampo('x', 'capitulos'), null);
  assert.equal(App.permissaoDoCampo('x', 'framerate'), null);
  for (const p of App.PERMISSOES) {
    assert.ok(App.ROTULO_PERMISSAO[p], 'falta o rótulo de ' + p);
    assert.ok(App.AJUDA_PERMISSAO[p], 'falta a explicação de ' + p);
  }
});

test('a comparação de dois catálogos diz o que mudou e o que cada mudança exige', () => {
  const antes = {
    rev: 5, total: 2, atualizado_em: 'ontem', ajustes: { arrastoTeto: 0.6, controlesEspera: 3 },
    itens: [
      { id: 'a', titulo: 'A', publicar: true, framerate: 30 },
      { id: 'b', titulo: 'B', publicar: false }
    ]
  };
  const depois = JSON.parse(JSON.stringify(antes));
  depois.rev = 6;
  depois.total = 3;
  depois.atualizado_em = 'hoje';
  depois.itens[0].titulo = 'A!';
  depois.itens[0].destaque = true;
  depois.itens[1].publicar = true;
  depois.itens[1].framerate = 24;
  depois.ajustes.arrastoTeto = 0.5;
  depois.itens.push({ id: 'c', titulo: 'C', publicar: true });

  const difs = App.diferencasDoCatalogo(antes, depois);
  const chave = (d) => d.alvo + '.' + d.campo + ':' + d.permissao;
  const vistas = difs.map(chave).sort();
  assert.deepEqual(vistas, [
    'a.destaque:estrutura', 'a.titulo:conteudo', 'ajustes.arrastoTeto:player',
    'b.framerate:null', 'b.publicar:no-ar', 'c.*:enviar', 'c.publicar:no-ar'
  ].sort(), JSON.stringify(vistas));

  /* rev, total e atualizado_em são do servidor: mudam em toda gravação e não
   * são mudança de ninguém. */
  assert.ok(!difs.some(d => ['rev', 'total', 'atualizado_em'].includes(d.campo)));

  const semNada = App.diferencasDoCatalogo(antes, JSON.parse(JSON.stringify(antes)));
  assert.deepEqual(semNada, [], 'catálogo igual não pode ter diferença');

  /* Campo ausente e campo nulo são o mesmo nada. */
  const comNulo = JSON.parse(JSON.stringify(antes));
  comNulo.itens[0].tema = null;
  assert.deepEqual(App.diferencasDoCatalogo(antes, comNulo), []);

  /* Tirar um título do catálogo não é da mesa: fica sem permissão, e só o
   * superadmin passa. */
  const semB = JSON.parse(JSON.stringify(antes));
  semB.itens.pop();
  const removido = App.diferencasDoCatalogo(antes, semB);
  assert.equal(removido.length, 1);
  assert.equal(removido[0].tipo, 'removido');
  assert.equal(removido[0].permissao, null);
});

test('o que cada conta não pode gravar', () => {
  const difs = [
    { alvo: 'a', campo: 'titulo', permissao: 'conteudo' },
    { alvo: 'a', campo: 'publicar', permissao: 'no-ar' },
    { alvo: 'ajustes', campo: 'arrastoTeto', permissao: 'player' },
    { alvo: 'b', campo: 'fonte', permissao: null }
  ];
  const so = (conta) => App.proibidas(conta, difs).map(d => d.campo);

  assert.deepEqual(App.proibidas({ super: true }, difs), [], 'o superadmin não é barrado');
  assert.deepEqual(so({ usuario: 'maria', permissoes: ['conteudo'] }), ['publicar', 'arrastoTeto', 'fonte']);
  assert.deepEqual(so({ usuario: 'joao', permissoes: ['conteudo', 'no-ar', 'player'] }), ['fonte'],
    'campo sem permissão é do superadmin, mesmo com todas as permissões da mesa');
  assert.deepEqual(so({ usuario: 'lia', permissoes: [] }), ['titulo', 'publicar', 'arrastoTeto', 'fonte']);
  assert.deepEqual(so(null), ['titulo', 'publicar', 'arrastoTeto', 'fonte'], 'sem conta, nada passa');
  assert.equal(App.contaPode({ permissoes: ['conteudo'] }, 'conteudo'), true);
  assert.equal(App.contaPode({ permissoes: ['conteudo'] }, 'no-ar'), false);
});

test('usuário e senha têm forma, e `superadmin` é reservado', () => {
  assert.equal(App.usuarioValido('maria'), true);
  assert.equal(App.usuarioValido('maria_silva-2'), true);
  assert.equal(App.usuarioValido('Maria'), false, 'maiúscula muda o token');
  assert.equal(App.usuarioValido('ma'), false);
  assert.equal(App.usuarioValido('maria.silva'), false, 'o ponto é o separador do token');
  assert.equal(App.usuarioValido('superadmin'), false);
  assert.equal(App.usuarioValido('admin'), false);
  assert.equal(App.senhaValida('12345678901'), false);
  assert.equal(App.senhaValida('123456789012'), true);
  assert.equal(App.permissoesValidas(['conteudo', 'no-ar']), true);
  assert.equal(App.permissoesValidas(['tudo']), false);
  assert.equal(App.permissoesValidas([]), true, 'conta só de leitura é válida');
});

test('limite de envio: null é "sem limite", e os números não podem ser negativos ou fracionados', () => {
  assert.equal(App.limiteEnvioValido(null), true, 'conta nova, sem nenhum limite');
  assert.equal(App.limiteEnvioValido({}), true, 'campos ausentes valem null');
  assert.equal(App.limiteEnvioValido({ maxVideos: 5, maxDuracaoSeg: 1800, autorizacaoManual: true }), true);
  assert.equal(App.limiteEnvioValido({ maxVideos: 0 }), true, 'zero é um limite válido, ainda que bloqueie tudo');
  assert.equal(App.limiteEnvioValido({ maxVideos: -1 }), false);
  assert.equal(App.limiteEnvioValido({ maxVideos: 1.5 }), false);
  assert.equal(App.limiteEnvioValido({ maxDuracaoSeg: 'muito' }), false);
  assert.equal(App.limiteEnvioValido({ autorizacaoManual: 'sim' }), false, 'não é booleano');
  assert.equal(App.limiteEnvioValido('sem limite'), false, 'não é objeto');
});

test('título fora do ar não recebe o destaque, e o destaque de hoje fica', () => {
  const novo = App.aplicarRascunho(
    { itens: [{ id: 'a', publicar: false }, { id: 'b', publicar: true, destaque: true }] },
    [{ alvo: 'a', campo: 'destaque', antes: null, depois: true }]);
  assert.ok(!novo.itens[0].destaque, 'o rascunho destacou um título fora do ar');
  assert.equal(novo.itens[1].destaque, true, 'um pedido que não vale tirou o destaque da chegada');
});

test('duração legível', () => {
  assert.equal(App.formatarDuracao({ duracao_seg: 614 }), '10:14');
  assert.equal(App.formatarDuracao({ duracao_seg: 3723 }), '1:02:03');
  assert.equal(App.formatarDuracao({ duracao_seg: 9 }), '0:09');
});

/* ============================ capítulos ================================= */

const LIB = path.join(__dirname, '..', 'scripts', 'lib');
const CAP = require(path.join(LIB, 'capitulos.mjs'));
const LEG = require(path.join(LIB, 'legenda.mjs'));

/* A legenda do Bunny começa com BOM (`EF BB BF`) antes do `WEBVTT`. Conferido
 * na pull zone em 31/08/2026. Sem cortar isso, `startsWith('WEBVTT')` é falso e
 * o parser morre na primeira linha — nenhum capítulo sairia de lugar nenhum. */
test('o parser de legenda aguenta o BOM que o Bunny põe antes do WEBVTT', () => {
  const comBom = '﻿WEBVTT\n\n1\n00:00:02.930 --> 00:00:05.958\nVai logo!\n';
  const cues = LEG.analisarVtt(comBom);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].texto, 'Vai logo!');
  assert.equal(cues[0].inicio, 2.93);
});

test('o parser aceita carimbo com e sem hora, e ignora NOTE e cue torta', () => {
  assert.equal(LEG.paraSegundos('00:01:02.930'), 62.93);
  assert.equal(LEG.paraSegundos('01:02.930'), 62.93);
  assert.equal(LEG.paraSegundos('sem tempo'), null);
  const vtt = 'WEBVTT\n\nNOTE isto não é fala\n\n1\nsem seta aqui\ntexto solto\n\n2\n00:00:10.000 --> 00:00:12.000\nvale\n';
  assert.deepEqual(LEG.analisarVtt(vtt).map(c => c.texto), ['vale']);
});

/* ARMADILHA achada em 31/08/2026: metade das legendas é ROLANTE — cada cue
 * repete o fim da anterior. Concatenar na marra triplica o texto e o
 * transcrito fica ilegível (foi o que aconteceu no Série Exemplo 5, 836 cues, e
 * no Pescador, 856). O merge tem que descontar a sobreposição. */
test('a junção de cues desconta o texto repetido das legendas rolantes', () => {
  const junto = LEG.juntarSemRepetir(
    'Esse aí sou eu e dá para notar que eu me',
    'Esse aí sou eu e dá para notar que eu me envolvi numa aventura');
  assert.equal(junto, 'Esse aí sou eu e dá para notar que eu me envolvi numa aventura');

  /* pontuação e acento não podem impedir o encaixe */
  assert.equal(
    LEG.juntarSemRepetir('o apresentador Fulano de Tal,', 'Fulano de Tal, explica'),
    'o apresentador Fulano de Tal, explica');

  /* sem sobreposição, junta inteiro — não pode comer palavra */
  assert.equal(LEG.juntarSemRepetir('nada em comum', 'texto novo'), 'nada em comum texto novo');
});

/* A leitura saiu de scripts/lib/legenda.mjs para site/indice-core.js na fase
 * 0 da busca: a mesa, as funções, o script e estes testes
 * usam UM código. O módulo de lá reexporta — não pode ter virado cópia. */
const AppIndice = require('../core/site/indice-core.js');

test('a leitura da legenda é uma só: o módulo dos scripts reexporta a de site/', () => {
  for (const nome of ['paraSegundos', 'paraCarimbo', 'analisarVtt', 'juntarSemRepetir', 'condensar']) {
    assert.equal(LEG[nome], AppIndice[nome], nome + ' virou cópia em scripts/lib/legenda.mjs');
  }
  const lib = lerTexto(path.join(LIB, 'legenda.mjs'));
  assert.ok(!/function\s+analisarVtt/.test(lib), 'a leitura voltou a ser escrita em scripts/lib/legenda.mjs');
});

/* A mesa manda o .srt que a pessoa escolheu — com vírgula no carimbo, número
 * de cue, e o CRLF do Windows onde ele foi salvo. O parser do player recusaria
 * (ele exige `WEBVTT`), e é por isso que a busca não usa o dele. */
test('a leitura aceita o .srt da mesa, com vírgula no carimbo e CRLF', () => {
  const srt = '1\r\n00:00:01,500 --> 00:00:03,000\r\nOlá, turma!\r\n\r\n' +
    '2\r\n00:00:03,100 --> 00:00:05,000\r\n<i>Hoje:</i> frações.\r\n';
  assert.deepEqual(AppIndice.analisarVtt(srt), [
    { inicio: 1.5, fim: 3, texto: 'Olá, turma!' },
    { inicio: 3.1, fim: 5, texto: 'Hoje: frações.' }
  ]);
  assert.deepEqual(AppIndice.analisarVtt('﻿' + srt).map(c => c.texto), ['Olá, turma!', 'Hoje: frações.'],
    'o BOM derrubou o .srt');
});

test('condensar não repete o texto das legendas rolantes', () => {
  const cues = [
    { inicio: 0, fim: 3, texto: 'as aves podem voar porque' },
    { inicio: 3, fim: 6, texto: 'as aves podem voar porque toda sua estrutura' },
    { inicio: 6, fim: 9, texto: 'toda sua estrutura foi feita para isso' }
  ];
  const blocos = LEG.condensar(cues, 30);
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].texto, 'as aves podem voar porque toda sua estrutura foi feita para isso');
});

/* O Bunny exige `end` em cada capítulo. Guardamos só `inicio` em
 * capitulos.json: com dois campos por capítulo, mover um corte obriga a mexer
 * no vizinho, e um esquecido deixa buraco na linha do tempo. */
test('cada capítulo fecha onde o seguinte começa, e o último na duração', () => {
  const fechados = CAP.fecharCapitulos(
    [{ inicio: 0, titulo: 'Abertura' }, { inicio: 67, titulo: 'A aula' }, { inicio: 109, titulo: 'O que é' }],
    1626);
  assert.deepEqual(fechados, [
    { titulo: 'Abertura', inicio: 0, fim: 67 },
    { titulo: 'A aula', inicio: 67, fim: 109 },
    { titulo: 'O que é', inicio: 109, fim: 1626 }
  ]);
});

test('a linha do tempo fica contígua: sem buraco e sem sobreposição', () => {
  const fechados = CAP.fecharCapitulos(
    [{ inicio: 300, titulo: 'c' }, { inicio: 0, titulo: 'a' }, { inicio: 90, titulo: 'b' }], 400);
  assert.deepEqual(fechados.map(c => c.titulo), ['a', 'b', 'c'], 'fora de ordem no arquivo deve sair ordenado');
  for (let i = 1; i < fechados.length; i++) assert.equal(fechados[i - 1].fim, fechados[i].inicio);
  assert.equal(fechados[fechados.length - 1].fim, 400);
});

/* Lança em vez de consertar: isto grava no player de um vídeo que está no ar. */
test('capítulo depois do fim do vídeo é erro, não é para ser consertado calado', () => {
  assert.throws(() => CAP.fecharCapitulos([{ inicio: 0, titulo: 'a' }, { inicio: 900, titulo: 'b' }], 600),
    /depois do fim/);
  assert.throws(() => CAP.fecharCapitulos([{ inicio: 10, titulo: 'a' }, { inicio: 10, titulo: 'b' }], 600),
    /mesmo segundo/);
  assert.throws(() => CAP.fecharCapitulos([{ inicio: 0, titulo: 'a' }], 0), /duração inválida/);
  assert.throws(() => CAP.fecharCapitulos([], 600), /nenhum capítulo/);
});

/* Sem isto o script reescreveria os 11 títulos a cada execução: requisição à
 * toa no Bunny e `rev` subindo no KV sem nada ter mudado. */
test('o script reconhece o que já está gravado — rodar de novo não escreve nada', () => {
  const meus = CAP.fecharCapitulos([{ inicio: 0, titulo: 'Abertura' }, { inicio: 67, titulo: 'A aula' }], 200);
  assert.equal(CAP.iguaisNoBunny(meus, [
    { title: 'Abertura', start: 0, end: 67 },
    { title: 'A aula', start: 67, end: 200 }
  ]), true);
  assert.equal(CAP.iguaisNoBunny(meus, [{ title: 'Abertura', start: 0, end: 67 }]), false);
  assert.equal(CAP.iguaisNoBunny(meus, []), false);

  assert.deepEqual(CAP.paraCatalogo(meus), [{ inicio: 0, titulo: 'Abertura' }, { inicio: 67, titulo: 'A aula' }]);
  assert.equal(CAP.iguaisNoCatalogo(meus, CAP.paraCatalogo(meus)), true);
  assert.equal(CAP.iguaisNoCatalogo(meus, [{ inicio: 0, titulo: 'Outro' }]), false);
});

/* O KV é editado pela tela de admin e por script. Capítulo torto não pode
 * derrubar a ficha: ela tem que abrir com o vídeo de qualquer jeito. */
test('a ficha sobrevive a capítulo torto vindo do catálogo', () => {
  const caps = App.capitulos({ capitulos: [
    { inicio: '109', titulo: '  O que  é\nfutebol ' },   /* texto e quebra de linha */
    { inicio: 0, titulo: 'Abertura' },                   /* fora de ordem */
    { inicio: 5, titulo: '   ' },                        /* título vazio */
    { inicio: 0, titulo: 'Repetido' },                   /* mesmo segundo */
    { inicio: -3, titulo: 'negativo' },
    null,
    { inicio: 'abc', titulo: 'sem número' }
  ] });
  assert.deepEqual(caps, [{ inicio: 0, titulo: 'Abertura' }, { inicio: 109, titulo: 'O que é futebol' }]);

  /* 27 dos 66 no ar não têm capítulo nenhum: [] é o caminho normal, não erro. */
  assert.deepEqual(App.capitulos({}), []);
  assert.deepEqual(App.capitulos(null), []);
  assert.deepEqual(App.capitulos({ capitulos: 'nada disso' }), []);
});

test('capituloEm acha o capítulo que está tocando', () => {
  const caps = [{ inicio: 0, titulo: 'a' }, { inicio: 67, titulo: 'b' }, { inicio: 109, titulo: 'c' }];
  assert.equal(App.capituloEm(caps, 0), 0);
  assert.equal(App.capituloEm(caps, 66.9), 0);
  assert.equal(App.capituloEm(caps, 67), 1);
  assert.equal(App.capituloEm(caps, 5000), 2);
  /* antes do primeiro capítulo é caso real: um vídeo institucional longo só tem fala em 1:58 */
  assert.equal(App.capituloEm([{ inicio: 119, titulo: 'a' }], 10), -1);
  assert.equal(App.capituloEm(caps, NaN), -1);
});

test('o tempo do capítulo é escrito como o resto do site', () => {
  assert.equal(App.formatarTempo(0), '0:00');
  assert.equal(App.formatarTempo(67), '1:07');
  assert.equal(App.formatarTempo(3723), '1:02:03');
});

/* A lista clicável fala com DOIS alvos desde a fase 0: o embed do Bunny, do
 * outro lado de uma fronteira de domínio (só o Player.js atravessa), e o
 * player nosso, que está do lado e responde direto.
 *
 * O que não muda em nenhum dos dois: ela NÃO pode chamar play(). Pular para um
 * capítulo posiciona o vídeo; quem decide tocar é quem aperta o play. */
test('a lista de capítulos só posiciona o vídeo — nunca manda tocar', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function listaCapitulos\(item, alvo\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei listaCapitulos em app.js');
  assert.match(corpo[1], /setCurrentTime/,
    'o caminho do embed precisa posicionar o vídeo pelo Player.js');
  assert.match(corpo[1], /irPara/,
    'o caminho do player nosso precisa posicionar o vídeo por irPara()');
  assert.ok(!/\.play\s*\(/.test(corpo[1]), 'listaCapitulos manda o vídeo tocar');
});

/* ACHADO NO DEDO em 03/09, num aparelho de verdade, e as duas metades do
 * mesmo estrago: **a página não rolava em cima da lista de capítulos**, e às
 * vezes o arrasto virava seleção de texto, com as alças de copiar.
 *
 * 1. `max-height: none` no celular tirava o TETO da lista mas deixava o
 *    `overflow-y: auto`. Um contêiner de rolagem que não rola engole o dedo e
 *    não passa a rolagem adiante — medido em 375 px: `scrollHeight` e
 *    `clientHeight` iguais em 624 px, com `overscroll-behavior: contain` por
 *    cima. E a lista é o pedaço mais alto da ficha no celular.
 * 2. A linha do capítulo é um `<button>` com texto selecionável. Arrastar o
 *    dedo por cima dele seleciona, e a seleção come a rolagem.
 *
 * Nada disso aparece com mouse, e nada disso apareceu em cinco fases de
 * emulação de toque. Por isso tem teste. */
test('a lista de capítulos não engole o dedo de quem está rolando a página', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));

  /* Onde o teto sai, o contêiner de rolagem sai junto. Há mais de um bloco de
   * 900 px na folha — o que importa é o que fala da lista. */
  const blocos = css.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/g) || [];
  const daLista = blocos.find((b) => b.includes('.capitulos-lista'));
  assert.ok(daLista, 'não achei a regra de celular da lista de capítulos');
  assert.match(daLista, /\.capitulos-lista \{[^}]*max-height: none/);
  assert.match(daLista, /\.capitulos-lista \{[^}]*overflow-y: visible/,
    'sobrou um overflow-y: auto que não rola nada e trava a página');

  /* A linha é alvo de toque, não texto para copiar. */
  const linha = css.match(/\n\.capitulo \{([\s\S]*?)\n\}/);
  assert.ok(linha, 'não achei .capitulo em style.css');
  assert.match(linha[1], /user-select: none/);
  assert.match(linha[1], /-webkit-touch-callout: none/,
    'sem isto o iOS abre a lupa e o menu de copiar em cima do arrasto');
});

/* O Player.js é externo. Carregá-lo na tela inicial custaria um script a quem
 * só está olhando a grade — e ele só serve na ficha de quem tem capítulos. */
test('o Player.js é carregado sob demanda, não junto com a página', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.ok(!/playerjs/i.test(html), 'index.html carrega o Player.js de saída');
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /function carregarPlayerjs\(url\)/);
  assert.ok(!/mediadelivery/.test(app), 'o endereço do Player.js voltou para o navegador: ele vem de `midia.embed.scriptUrl`');
  assert.match(app, /iframe\.isConnected/,
    'voltar para a grade destrói a ficha; o Player.js só pode se ligar a um iframe ainda vivo');
});

/* Mesmo bug da capa: campo que não sai por paraPublico não existe para a
 * grade, e a lista de capítulos sumiria da ficha sem ninguém entender por quê. */
test('a projeção pública leva os capítulos — sem eles a lista some da ficha', () => {
  const fn = lerTexto(path.join(WORKER, 'api', 'catalogo.js'));
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em core/worker/api/catalogo.js');
  assert.match(proj[1], /capitulos/, 'paraPublico precisa incluir capitulos');
});

/* Terceira vez que este mesmo bug é guardado — capa, capítulos e agora o
 * framerate. O passo de quadro da fase 9 faz `currentTime += 1/framerate`, e o
 * acervo é MISTO (23,976 ×39 · 29,97 ×19 · 30 ×17 · 24 ×4 · 25 ×3, medido
 * contra a library em 09/09/2026): um passo fixo de 1/30 erraria em 65 dos 82.
 * Sem esta linha o número chega ao KV por `scripts/framerate.mjs` e nunca
 * chega ao navegador — e o sintoma seria o atalho simplesmente não existir. */
test('a projeção pública leva o framerate — sem ele o passo de quadro não tem régua', () => {
  const fn = lerTexto(path.join(WORKER, 'api', 'catalogo.js'));
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em core/worker/api/catalogo.js');
  assert.match(proj[1], /framerate/, 'paraPublico precisa incluir framerate');
});

/* O script que colhe o número tem que sair do KV e voltar para o KV. O arquivo local
 * costuma ficar defasado e não sabe da curadoria feita
 * pela tela de admin — é a mesma disciplina do capas-menores, e é o que impede
 * a próxima passada de acervo de reverter títulos como o semear reverteria.
 *
 * O teste cobra o CAMINHO (ler por `?completo=1`, gravar por PUT), e não a
 * ausência da palavra "semear": ela aparece no arquivo de propósito, num
 * comentário que explica justamente por que não se usa aquele script aqui. Um
 * teste que reprovasse a palavra puniria a explicação. */
test('o framerate.mjs lê o KV e grava no KV — nunca no arquivo local como fonte', () => {
  const src = lerTexto(path.join(__dirname, '..', 'scripts', 'framerate.mjs'));
  assert.match(src, /completo=1/, 'framerate.mjs precisa ler o KV por ?completo=1');
  assert.match(src, /method:\s*'PUT'/, 'framerate.mjs precisa gravar o KV por PUT');
  assert.doesNotMatch(src, /^\s*import[^\n]*semear/m,
    'framerate.mjs não pode importar o semear: ele reverteria a curadoria da tela de admin');
});

/* CUSTOU CARO EM 09/09/2026, e no site no ar. A primeira versão do
 * `framerate.mjs` fazia `delete kv.ajustes` antes do PUT, com um comentário
 * afirmando que `config` e `ajustes` eram os dois "campo derivado".
 *
 * **Só o `config` é.** Ele vem do ambiente e o PUT o descarta sozinho. O
 * `ajustes` MORA no documento do catálogo, e foi posto lá exatamente porque
 * `config` se apaga a cada gravação.
 * Apagá-lo num PUT não dá erro: o GET seguinte devolve `null` nos
 * dois campos e o player cai nos padrões do código. O teto do arrasto ajustado
 * para 60% pela tela virou os 40% do código, no ar, até a gravação seguinte.
 *
 * A regra, para qualquer script que grave o catálogo: **o que veio no GET
 * volta no PUT, menos o `config`.** Este teste varre TODOS os scripts que
 * fazem PUT — não só os dois de hoje —, porque o próximo a ser escrito vai ser
 * copiado de um destes. */
test('nenhum script que grava o catálogo apaga os `ajustes` antes do PUT', () => {
  const pasta = path.join(__dirname, '..', 'scripts');
  const gravam = fs.readdirSync(pasta)
    .filter(n => n.endsWith('.mjs'))
    .map(n => ({ nome: n, src: lerTexto(path.join(pasta, n)) }))
    .filter(a => /method:\s*'PUT'/.test(a.src));

  assert.ok(gravam.length >= 2,
    'esperava pelo menos capas-menores.mjs e framerate.mjs gravando o KV por PUT');

  for (const { nome, src } of gravam) {
    assert.doesNotMatch(src, /^\s*delete\s+\w+\.ajustes\s*;/m,
      nome + ' apaga os `ajustes` antes do PUT — isso zera o teto do arrasto e o ' +
      'tempo dos controles no KV, em silêncio. Só o `config` pode sair.');
  }
});

/* O corte NÃO é por duração: é decisão de conteúdo, vídeo a vídeo. Um vídeo
 * curto que é uma lista de itens pode ganhar capítulo; um longo de depoimentos
 * sobre o mesmo assunto pode não ganhar — qualquer corte seria arbitrário. O
 * que este teste guarda é a disciplina do arquivo (aqui, o de exemplo). */
test('capitulos.json: todo título é decidido, e nenhum está nas duas listas', () => {
  const definidos = JSON.parse(lerTexto(path.join(__dirname, '..', 'exemplo', 'capitulos.json')));
  const catalogoExemplo = JSON.parse(lerTexto(path.join(__dirname, '..', 'exemplo', 'catalogo.json')));
  const comCapitulo = Object.keys(definidos.titulos);
  const semCapitulo = Object.keys(definidos.sem_capitulos).filter(k => k !== 'observacao');

  /* Todo título PUBLICADO do catálogo tem que estar em exatamente uma das duas
   * listas, e nenhuma lista pode citar id que não existe no catálogo. Se este
   * teste falhar depois de publicar algo, falta decidir o capítulo do que
   * entrou — que é exatamente o que ele guarda. */
  const publicados = catalogoExemplo.itens.filter(i => i.publicar === true).map(i => i.id).sort();
  assert.deepEqual([...comCapitulo, ...semCapitulo].sort(), publicados,
    'as duas listas juntas têm que cobrir exatamente os publicados — sobrou ou faltou título');
  assert.ok(comCapitulo.length >= 1, 'o exemplo precisa mostrar pelo menos um título com capítulos');

  for (const id of comCapitulo) {
    assert.ok(!semCapitulo.includes(id), id + ' está nas duas listas ao mesmo tempo');
  }

  for (const id of comCapitulo) {
    const caps = definidos.titulos[id].capitulos;
    assert.ok(Array.isArray(caps) && caps.length >= 3, id + ' tem capítulos de menos');
    for (let i = 1; i < caps.length; i++) {
      assert.ok(caps[i].inicio > caps[i - 1].inicio, id + ' tem capítulo fora de ordem em ' + caps[i].inicio);
    }
    for (const c of caps) {
      assert.equal(typeof c.titulo, 'string');
      assert.ok(c.titulo.trim().length >= 3, id + ' tem título de capítulo vazio ou curto demais');
      assert.ok(Number.isInteger(c.inicio) && c.inicio >= 0, id + ' tem início inválido: ' + c.inicio);
    }

    /* A linha do tempo tem que fechar contígua com a duração real. */
    const fechados = CAP.fecharCapitulos(caps, caps[caps.length - 1].inicio + 30);
    assert.equal(fechados.length, caps.length);
    for (let i = 1; i < fechados.length; i++) assert.equal(fechados[i - 1].fim, fechados[i].inicio);
  }

  /* Todo motivo de exclusão é escrito, não é lista muda. */
  for (const id of semCapitulo) {
    assert.ok(String(definidos.sem_capitulos[id]).length > 20, id + ' está fora sem motivo escrito');
  }
});

/* A armadilha que custa dinheiro: um vídeo institucional SEM legenda
 * (`captions: []` na API, 404 em captions/pt.vtt na pull zone — o áudio é só
 * trilha e o provedor de transcrição devolve zero palavras). Gerar capítulo
 * para ele exigiria transcrição paga de um vídeo sem fala. Ele tem que ficar do
 * lado de fora, com o motivo escrito. */
test('o vídeo institucional, que não tem legenda, fica fora e com o motivo escrito', () => {
  const definidos = JSON.parse(lerTexto(path.join(__dirname, '..', 'exemplo', 'capitulos.json')));
  const id = 'exemplo-institucional-01';
  assert.ok(!(id in definidos.titulos), id + ' ganhou capítulos, mas não tem legenda de onde tirá-los');
  assert.match(definidos.sem_capitulos[id], /LEGENDA/,
    'o motivo do institucional precisa dizer que não há legenda, senão alguém o manda para a transcrição paga');
});

/* ================= o player nosso — fase 0 ============
 *
 * Estes testes são a contrapartida dos que guardam `urlEmbed()`. Enquanto o
 * embed for o padrão os dois conjuntos convivem; na fase 10, quando o player
 * novo assumir, os do embed saem e ESTES ficam sendo a única garantia das três
 * regras. Por isso eles existem AGORA, na primeira fase, e não no fim.
 */

const AppPlayerCore = require('../core/site/player-core.js');
const PLAYER_JS = lerTexto(path.join(SITE, 'player.js'));

/* Este arquivo é comentado de propósito, e os comentários FALAM das regras —
 * "o único lugar que chama video.play()". Contar ocorrências no texto cru
 * confundiria a menção com o uso. Mesma distinção que o teste da AccessKey faz
 * lá embaixo: citar é permitido, usar não. */
/* ARMADILHA PAGA EM 16/09. Isto era `js.replace(/\/\*[\s\S]*?\*\//g, '')`, e
 * um `/*` DENTRO DE UM TEXTO abre um comentário que nunca começou: o
 * `accept: 'video/*'` do seletor de arquivo da mesa engolia o código daí até o
 * próximo `*​/` de verdade — 20 linhas, incluindo a definição de uma função.
 * Quem varre o arquivo atrás de um `play()`, de um ouvinte de scroll ou de uma
 * regra qualquer estava lendo menos código do que pensava, e passando por
 * isso. Este tira comentário de bloco sem entrar em texto entre aspas. */
const semComentarios = (js) => {
  let fora = '';
  let modo = 'codigo';
  let aspas = '';
  for (let i = 0; i < js.length; i++) {
    const c = js[i];
    const d = js[i + 1];
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
const PLAYER_CODIGO = semComentarios(PLAYER_JS);

/* A REGRA DO GUARDIÃO (decisão D-8, M6). Antes: UMA chamada de `play()` no
 * projeto, em `alternarPlay`. Agora: DUAS, e cada uma tem dono e condição —
 *   - `tocarPorGesto`: o play de quem apertou o botão, a tecla, o toque;
 *   - `tocarAutomatico`: o único que pode começar SEM gesto, e a sua primeira
 *     instrução é perguntar ao guardião (`podeIniciarSozinho`, guardiao.js), que
 *     com a config padrão (`autoplay.modo: 'nunca'`) sempre diz não.
 * Um terceiro `.play(` em qualquer lugar do player quebra aqui. O vídeo de fundo
 * do destaque tem o seu (destaque-fundo.js), conferido em
 * tests/player-fundo.test.js. */
function corpoDaFuncao(codigo, nome) {
  const m = codigo.match(new RegExp('function ' + nome + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n    \\}'));
  return m ? m[1] : null;
}
function conferirPlaySoNoGuardiao(porque) {
  const chamadas = PLAYER_CODIGO.match(/\.play\s*\(/g) || [];
  assert.equal(chamadas.length, 2,
    porque + ': player.js tem ' + chamadas.length + ' chamadas de play(); a regra são duas, em tocarPorGesto e tocarAutomatico');
  const gesto = corpoDaFuncao(PLAYER_CODIGO, 'tocarPorGesto');
  const auto = corpoDaFuncao(PLAYER_CODIGO, 'tocarAutomatico');
  assert.ok(gesto && auto, 'faltam tocarPorGesto/tocarAutomatico em player.js');
  assert.equal((gesto.match(/\.play\s*\(/g) || []).length, 1, 'tocarPorGesto deve ter o play do gesto');
  assert.equal((auto.match(/\.play\s*\(/g) || []).length, 1, 'tocarAutomatico deve ter o play sem gesto');
  /* O guardião vem ANTES de qualquer outra coisa, inclusive do play. */
  assert.ok(auto.indexOf('podeIniciarSozinho(') >= 0 && auto.indexOf('podeIniciarSozinho(') < auto.indexOf('.play('),
    'tocarAutomatico dá o play sem perguntar ao guardião');
  assert.match(auto, /^\s*var contexto = contextoDeInicio\(origem\);\s*if \(!AppPlayerCore\.podeIniciarSozinho\(contexto, config\)\) return false;/,
    'tocarAutomatico deve COMEÇAR pelo guardião');
}

test('REGRA 1 — o player nosso não toca sozinho', () => {
  assert.equal(AppPlayerCore.REGRAS.autoplay, false);
  assert.equal(AppPlayerCore.atributosVideo().autoplay, false);

  /* Duas chamadas de play() no player: `tocarPorGesto` (só por gesto de quem
   * está assistindo) e `tocarAutomatico` (que começa pelo guardião). Se este
   * número subir, alguém arrumou um terceiro lugar de onde o vídeo pode começar
   * sozinho — e é exatamente isso que não pode existir. */
  conferirPlaySoNoGuardiao('REGRA 1');
});

/* A VIRADA DE 03/09: o player nosso deixou de estar atrás de uma chave.
 *
 * O que este teste guarda não é a virada em si — é o que a torna barata de
 * desfazer. Enquanto as duas redes abaixo estiverem armadas, um problema numa
 * situação urgente se resolve com uma URL, e não com um deploy. */
test('o player nosso é o padrão, e o embed continua a uma URL de distância', () => {
  const pedido = PLAYER_JS.match(/function playerNovoPedido\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(pedido, 'não achei playerNovoPedido em player.js');

  /* A chave virou uma SAÍDA: só `?player=embed` devolve o iframe. */
  assert.match(pedido[1], /get\('player'\) !== 'embed'/,
    'o player nosso precisa ser o padrão, com o embed como exceção');
  /* E o navegador velho demais para `URLSearchParams` cai no embed, que é a
   * resposta certa: ele provavelmente também não daria conta do player novo. */
  assert.match(pedido[1], /catch \(e\) \{\s*\n\s*return false;/);

  /* A segunda rede: se `criar()` devolver null — ou se o player.js nem tiver
   * carregado, e `AppPlayer` for undefined — o iframe assume sozinho, e o
   * `urlEmbed()` continua existindo para isso. */
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /typeof AppPlayer !== 'undefined' && AppPlayer\.pedido\(\)/);
  assert.match(app, /if \(midia && !alvoCapitulos && App\.urlEmbed\(midia\)\) \{/,
    'sem este bloco, quem cair fora do player novo fica sem vídeo nenhum');
  assert.match(app, /iframe\.src = App\.urlEmbed\(midia\)/);
  assert.equal(typeof App.urlEmbed, 'function',
    'urlEmbed é o plano B: ele não sai enquanto for a rede de segurança');
});

test('REGRA 2 — o player nosso não repete', () => {
  assert.equal(AppPlayerCore.REGRAS.loop, false);
  assert.equal(AppPlayerCore.atributosVideo().loop, false);
  assert.ok(!/loop\s*=\s*true/.test(PLAYER_JS), 'player.js liga loop em algum lugar');
});

/* REGRA 3 está no teste "a interface não reage ao fim do vídeo", lá em cima,
 * que agora varre também player.js e player-core.js atrás da string 'ended'.
 * A garantia é a AUSÊNCIA do listener: sem ele não existe lugar conveniente
 * para pendurar um "próximo episódio" automático. */

test('as regras ficam num objeto congelado — ninguém as relaxa em tempo de execução', () => {
  assert.ok(Object.isFrozen(AppPlayerCore.REGRAS));
});

/* O `preload=false` do embed traduzido para o player nosso são DUAS travas, e
 * as duas precisam existir: o atributo do <video> e o autoStartLoad do hls.js.
 * Só a primeira deixaria o hls.js puxando segmentos assim que a ficha abre —
 * quem só queria ler a sinopse pagaria a banda do vídeo inteiro. */
test('nada é baixado antes do play — nem pelo <video>, nem pelo hls.js', () => {
  assert.equal(AppPlayerCore.atributosVideo().preload, 'none');
  assert.equal(AppPlayerCore.configHls().autoStartLoad, false);
  /* Quem libera é o `liberarDownload`, desde a fase 2 da busca — e só o
   * primeiro play o chama (o teste de baixo cobre o outro caminho). */
  const liberar = PLAYER_CODIGO.match(/function liberarDownload\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(liberar, 'não achei liberarDownload em player.js');
  assert.match(liberar[1], /if \(!hls \|\| carregouAlgo\) return;/, 'o download pode ser liberado duas vezes');
  assert.match(liberar[1], /hls\.startLoad\(inicio\)/, 'alguém tem que liberar o download no primeiro play');
  const alternar = PLAYER_CODIGO.match(/function alternarPlay\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(alternar[1], /if \(video\.paused\) tocarPorGesto\(\);/, 'o botão deixou de passar por tocarPorGesto');
  assert.match(corpoDaFuncao(PLAYER_CODIGO, 'tocarPorGesto'), /liberarDownload\(\);/,
    'o play do botão deixou de liberar o download');
  assert.match(corpoDaFuncao(PLAYER_CODIGO, 'tocarAutomatico'), /liberarDownload\(\);/,
    'o início sem gesto deixou de liberar o download');
});

/* O MOMENTO ANTES DO PLAY (fase 2 da busca, 21/09). O clique num trecho abre
 * a ficha em `?t=` e dá o play; o vídeo abria no lugar certo, mas o hls.js
 * baixava do segmento 0 antes de saltar — medido: `video0.ts` em 240p e 480p
 * antes do segmento 99. O `startLoad(posição)` do 1.6 descarta a posição
 * antes do manifesto e o refaz com o `config.startPosition`, por isso os
 * dois. Vale também para o capítulo clicado com o vídeo parado. */
test('o momento pedido antes do play é de onde o download começa', () => {
  const ir = PLAYER_CODIGO.match(/function irPara\(segundos\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(ir, 'não achei irPara em player.js');
  assert.match(ir[1], /if \(!carregouAlgo\) momentoAntesDoPlay = alvo;/,
    'o irPara antes do play não guarda o momento — o hls.js volta a baixar do zero');
  const liberar = PLAYER_CODIGO.match(/function liberarDownload\(\)\s*\{([\s\S]*?)\n    \}/)[1];
  assert.match(liberar, /hls\.config\.startPosition = inicio;\s*hls\.startLoad\(inicio\);/,
    'a posição vai só ao startLoad, que a descarta antes de o manifesto chegar');
});

/* O PLAY QUE CHEGA ANTES DO hls.js (21/09). `alternarPlay` só libera o
 * download se o hls.js já existe, e ele nasce depois que o arquivo da
 * biblioteca chega. Um play pedido antes deixava o vídeo "tocando" sem nenhum
 * segmento pedido, para sempre — medido: cinco segundos, `readyState` 0, só o
 * playlist mestre na rede. Com o "Assistir" da D6, é o caso comum.
 *
 * A liberação que existe aqui é a do MESMO pedido: ela só acontece com o vídeo
 * já querendo tocar. Sem o `!video.paused`, toda ficha aberta baixaria vídeo
 * — o teste de cima continuaria verde, e a regra, quebrada. */
test('o play pedido antes de o hls.js chegar libera o download quando ele chega', () => {
  const ligar = PLAYER_CODIGO.match(/function ligarFonte\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(ligar, 'não achei ligarFonte em player.js');
  assert.match(ligar[1],
    /hls\.attachMedia\(video\);\s*if \(!video\.paused\) liberarDownload\(\);/,
    'o play que chega antes do hls.js voltou a ficar preso — ou o download passou a sair sem play nenhum');
});

/* A ENTRADA DO "ASSISTIR" (D6). O player ganhou uma entrada e nenhum
 * comportamento: `tocar()` é o mesmo `alternarPlay` do botão, e só com o vídeo
 * parado — pedir para tocar o que já toca não pode virar pausa. */
test('o "Assistir" entra pelo mesmo alternarPlay, e só com o vídeo parado', () => {
  const tocar = PLAYER_CODIGO.match(/function tocar\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(tocar, 'não achei tocar em player.js');
  assert.match(tocar[1], /^\s*if \(!video\.paused\) return;/,
    'tocar() deixou de sair quando o vídeo já toca — pedir de novo viraria pausa');
  assert.ok(!/\.play\s*\(/.test(tocar[1]), 'tocar() virou um segundo caminho para o play()');
  assert.match(PLAYER_CODIGO, /aoTempo: aoTempo, tocar: tocar/,
    'o player deixou de oferecer a entrada tocar()');
  conferirPlaySoNoGuardiao('a D6');
});

/* O "ASSISTIR" QUE SÓ TOCAVA UMA VEZ (21/09, visto no ar logo depois do deploy
 * da D6). Com o hls.js já em cache, o `tocar()` dava o play num <video> SEM
 * FONTE, e a biblioteca, que liga a fonte na microtarefa seguinte, cancelava o
 * play com a carga nova — `AbortError`. O "Assistir" só tocava na primeira
 * ficha de cada visita. O pedido agora espera a fonte, e todo caminho que liga
 * uma — HLS nativo, MP4, hls.js — passa por quem o atende. Um caminho novo que
 * esqueça a chamada deixa o "Assistir" parado nele, em silêncio. */
test('o pedido do "Assistir" espera a fonte, e todo caminho que liga a fonte o atende', () => {
  const tocar = PLAYER_CODIGO.match(/function tocar\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(tocar[1], /if \(!temFonte\) \{ tocarQuandoLigar = true; return; \}\s*alternarPlay\(\);/,
    'tocar() dá o play sem fonte — com a biblioteca em cache, a troca de fonte o cancela');

  const atende = PLAYER_CODIGO.match(/function aoLigarFonte\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(atende, 'não achei aoLigarFonte em player.js');
  assert.match(atende[1], /temFonte = true;/);
  assert.match(atende[1], /tocarQuandoLigar = false;\s*if \(video\.paused\) alternarPlay\(\);/,
    'o pedido guardado é atendido mesmo com o vídeo já tocando — e aí vira pausa');

  /* Cada `video.src = …` é seguido de quem atende o pedido, e o hls.js o chama
   * depois do `attachMedia`. */
  const fontes = [...PLAYER_CODIGO.matchAll(/video\.src = url\w+;([^}]*)/g)];
  assert.equal(fontes.length, 3, 'mudou o número de lugares que dão fonte ao <video> — confira cada um');
  for (const f of fontes) {
    assert.match(f[1], /aoLigarFonte\(\)/, 'um caminho liga a fonte sem atender o pedido: ' + f[0].trim());
  }
  assert.match(PLAYER_CODIGO, /hls\.attachMedia\(video\);[\s\S]{0,200}?aoLigarFonte\(\);\s*\}\)\.catch/,
    'o hls.js liga a fonte e o pedido do "Assistir" fica esperando para sempre');
});

/* `rememberPosition=false` do embed, e o que mudou nele em 23/09.
 *
 * A fase 2 abriu UMA exceção ao "nada guardado no navegador": a preferência de
 * legenda. A fase 4 abriu a SEGUNDA, a de som. E a fase 6
 * abriu a TERCEIRA, por decisão de quem usa o site: onde o vídeo parou, para o "Continuar" da página da série.
 *
 * O que NÃO mudou, e é o que este teste guarda agora: nada retoma sozinho. O
 * player GRAVA a posição e nunca a LÊ — a única leitura é da página da série,
 * e ela vira um link que a pessoa clica. Cada chave nova continua tendo de
 * passar por aqui de propósito. */
test('o player grava onde parou, e nunca lê nem retoma sozinho', () => {
  assert.equal(AppPlayerCore.REGRAS.retomarSozinho, false);
  assert.ok(!('lembrarPosicao' in AppPlayerCore.REGRAS), 'a regra velha voltou com outro sentido');

  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(PLAYER_CODIGO),
    'player.js usa um armazenamento fora do previsto');

  const usos = PLAYER_CODIGO.match(/localStorage\.\w+\([^)]*\)/g) || [];
  assert.ok(usos.length > 0, 'a preferência de legenda deveria estar sendo guardada');
  for (const uso of usos) {
    assert.match(uso, /CHAVE_LEGENDA|CHAVE_SOM|App\.CHAVE_ONDE_PAROU/,
      'só legenda, som e onde parou podem ser guardados; apareceu: ' + uso);
  }

  /* A preferência de som continua sem esconder posição dentro dela. */
  const gravaSom = PLAYER_CODIGO.match(/CHAVE_SOM,[\s\S]{0,200}?\)\)/);
  assert.ok(gravaSom, 'a preferência de som deveria estar sendo guardada');
  assert.ok(!/tempo|currentTime|posicao/i.test(gravaSom[0]),
    'a preferência de som virou esconderijo da posição: ' + gravaSom[0]);

  /* A posição só vai ao armazenamento pela função que a grava, e só pela
   * forma que o core monta (o começo e o fim não ficam). */
  const gravacoes = PLAYER_CODIGO.match(/setItem\([\s\S]{0,200}?\)/g) || [];
  for (const g of gravacoes) {
    if (/CHAVE_ONDE_PAROU/.test(g)) { assert.match(g, /JSON\.stringify\(mapa\)/); continue; }
    assert.ok(!/currentTime|duration|posicao/i.test(g), 'a posição do vídeo está indo para o armazenamento: ' + g);
  }
  const grava = PLAYER_CODIGO.match(/function gravarOndeParou\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(grava, 'não achei gravarOndeParou');
  assert.match(grava[1], /App\.lembrarOndeParou\(/);
  assert.match(grava[1], /try\s*\{/, 'gravar onde parou sem try/catch derruba o player na aba anônima');

  /* A TRAVA de verdade: o player não lê a chave. Ler é o primeiro passo de
   * retomar sozinho. A única `getItem` dela é a de dentro da gravação, que
   * lê o mapa para acrescentar. */
  /* M6: duas leituras, a da gravação e a de `lerOndeParou`, e esta só é
   * chamada por `pontoSalvo`, que devolve null já na primeira linha com
   * `player.retomar.modo: 'nunca'` (o padrão). */
  const leituras = PLAYER_CODIGO.match(/getItem\(App\.CHAVE_ONDE_PAROU\)/g) || [];
  assert.equal(leituras.length, 2, 'o player lê onde parou fora da gravação e do lerOndeParou');
  const lendo = PLAYER_CODIGO.match(/lerOndeParou\(/g) || [];
  assert.equal(lendo.length, 2, 'declaração + um uso (pontoSalvo): ninguém mais lê onde parou');
  assert.match(corpoDaFuncao(PLAYER_CODIGO, 'pontoSalvo'), /^\s*if \(cfg\.retomar\.modo === 'nunca'\) return null;/,
    'com retomar nunca, o player não pode nem ler a chave');
  assert.ok(!/currentTime\s*=\s*[^=;]*(OndeParou|ONDE_PAROU|mapa)/.test(PLAYER_CODIGO), 'o player retoma onde parou');
});

/* As regras do mapa, no core: o começo e o fim não ficam, o mais recente vence,
 * e só 50 títulos. E o "Continuar" da série é o último visto DELA, no ar. */
test('onde parou: sem começo, sem fim, os 50 mais recentes, e o Continuar da série', () => {
  let m = {};
  m = App.lembrarOndeParou(m, 'sx1-2', 5, 600, 1);
  assert.deepEqual(m, {}, 'os primeiros segundos viraram "parou no meio"');
  m = App.lembrarOndeParou(m, 'sx1-2', 372.8, 600, 2);
  assert.deepEqual(m['sx1-2'], { t: 372, d: 600, q: 2 });
  m = App.lembrarOndeParou(m, 'sx1-2', 580, 600, 3);
  assert.ok(!('sx1-2' in m), 'quem chegou aos créditos continua com "Continuar"');
  m = App.lembrarOndeParou(m, 'sx1-2', 2 * 3600 - 200, 2 * 3600, 4);
  assert.ok(!('sx1-2' in m), 'nos vídeos longos, os últimos 5% são o fim');

  let cheio = {};
  for (let k = 0; k < 60; k++) cheio = App.lembrarOndeParou(cheio, 'x' + k, 100, 600, k);
  assert.equal(Object.keys(cheio).length, 50);
  assert.ok(!('x0' in cheio) && 'x59' in cheio, 'saiu o mais novo em vez do mais velho');
  assert.deepEqual(App.lembrarOndeParou('lixo', 'a', 100, 600, 1), { a: { t: 100, d: 600, q: 1 } });

  const mapa = {
    'sx1-1': { t: 100, d: 420, q: 10 },
    'sx1-3': { t: 200, d: 440, q: 20 },
    'oculto': { t: 50, d: 400, q: 99 },     /* fora do ar */
    'enq-1': { t: 30, d: 200, q: 50 }       /* outra série */
  };
  const c = App.continuarDaSerie(itensApresentacao, 'Série Exemplo 1', mapa);
  assert.equal(c.item.id, 'sx1-3', 'o Continuar não levou ao último visto da série');
  assert.equal(c.t, 200);
  assert.equal(c.link, '#/ep/sx1-3?t=200');
  assert.equal(App.continuarDaSerie(itensApresentacao, 'Eventos', mapa), null);
  assert.equal(App.continuarDaSerie(itensApresentacao, 'Série Exemplo 1', 'lixo'), null);
});

test('o Continuar mora na página da série, lê com try/catch, e o clique é o pedido de tocar', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const ler = app.match(/function lerOndeParou\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(ler, 'não achei lerOndeParou');
  assert.match(ler[1], /try\s*\{/);
  /* Quatro: a definição, a página da série, a ficha (24/09) e o contexto da home por blocos (M6: o bloco
   * "continuar assistindo" lê a mesma memória, para listar). Uma quinta é alguém lendo a memória num lugar
   * novo — que passe por aqui de propósito. */
  assert.equal((app.match(/lerOndeParou\(\)/g) || []).length, 4, 'onde parou é lido fora da série, da ficha e da home');
  const i = app.indexOf('function cabecaDaSerie(');
  const cab = app.slice(i, app.indexOf('\n  }\n', i));
  assert.match(cab, /App\.continuarDaSerie\(estado\.itens, s\.nome, lerOndeParou\(\)\)/);
  assert.match(cab, /ligarAssistir\(continuar, cont\.item\.id\)/);
  assert.match(cab, /continuar\.href = cont\.link/);
});

/* Sem o try/catch, `localStorage` LANÇA em aba anônima, com armazenamento
 * bloqueado por política de rede ou com a cota estourada — e o player inteiro
 * morre antes de desenhar o primeiro quadro, por causa de uma preferência. */
test('ler e gravar a preferência nunca derruba o player', () => {
  for (const fn of ['lerPreferenciaLegenda', 'gravarPreferenciaLegenda']) {
    const corpo = PLAYER_JS.match(new RegExp('function ' + fn + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}'));
    assert.ok(corpo, 'não achei ' + fn + ' em player.js');
    assert.match(corpo[1], /try\s*\{/, fn + ' precisa de try/catch: localStorage lança em aba anônima');
    assert.match(corpo[1], /catch/, fn + ' precisa tratar a exceção');
  }
});

/* Bug que o iframe não tinha: remover o <video> do DOM para o elemento, mas a
 * instância do hls.js sobrevive com os carregadores dela e segue puxando
 * segmentos da pull zone para um vídeo que ninguém está vendo. */
test('sair da ficha destrói o hls.js, não só o elemento', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(destruir, 'não achei destruir() em player.js');
  assert.match(destruir[1], /hls\.destroy\(\)/, 'destruir() não desmonta o hls.js');
  assert.match(destruir[1], /removeAttribute\('src'\)/,
    'sem tirar o src, o download em andamento continua até o fim');

  const app = lerTexto(path.join(SITE, 'app.js'));
  for (const fn of ['renderGrade', 'renderFicha']) {
    const corpo = app.match(new RegExp('function ' + fn + '\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}'));
    assert.ok(corpo, 'não achei ' + fn + ' em app.js');
    assert.match(corpo[1], /destruirPlayer\(\)/,
      fn + ' não destrói o player ao sair — o hls.js continuaria baixando');
  }
});

test('o HLS vem pronto em midia.hls — o navegador só o lê', async () => {
  const midia = await midiaDoBunny({ fonte });
  assert.equal(AppPlayerCore.urlHls(midia),
    'https://' + PULLZONE_DE_TESTE + '/' + fonte.videoId + '/playlist.m3u8');
  assert.equal(AppPlayerCore.urlHls({}), null, 'sem midia.hls não há URL');
  assert.equal(AppPlayerCore.urlHls(null), null);
  assert.equal(AppPlayerCore.urlHls({ hls: 42 }), null);
  /* `https://` na frente do host é erro de digitação frequente no .env: o adaptador normaliza. */
  const digitado = await midiaDoBunny({ fonte }, { BUNNY_PULLZONE: 'https://vz-teste.b-cdn.net/' });
  assert.match(AppPlayerCore.urlHls(digitado), /^https:\/\/vz-teste\.b-cdn\.net\/aaaaaaaa/);
});

/* O MP4 é rede de segurança, não caminho principal: sem qualidade adaptativa,
 * o 720p de um vídeo de 10 minutos tem 130 MB . Numa rede
 * limitada o padrão TEM que ser modesto. */
test('o fallback de MP4 é 360p por padrão, não a melhor resolução', async () => {
  const midia = await midiaDoBunny({ fonte });
  assert.match(AppPlayerCore.urlMp4(midia), /play_360p\.mp4$/);
  assert.match(PLAYER_JS, /urlMp4\(midia, '360p'\)/,
    'player.js pediu outra resolução de fallback');
  /* Sem a resolução pedida, a mais próxima que o provedor oferece. */
  assert.equal(AppPlayerCore.urlMp4({ mp4: { '720p': 'https://x/720.mp4' } }, '240p'), 'https://x/720.mp4');
  assert.equal(AppPlayerCore.urlMp4({ mp4: null }), null);
  assert.equal(App.urlMp4({ midia }, '720p'), 'https://' + PULLZONE_DE_TESTE + '/' + fonte.videoId + '/play_720p.mp4');
});

/* ARMADILHA medida em 01/09, num Chromium 148 no Windows: `canPlayType(
 * 'application/vnd.apple.mpegurl')` responde **"maybe"** e o navegador NÃO
 * toca HLS — o vídeo fica em readyState 0 para sempre. O Chrome do Android faz
 * o mesmo há anos.
 *
 * Este teste existe para impedir que alguém "conserte" a ordem de volta para a
 * intuitiva (nativo primeiro), que é justamente a que quebra. */
test('o hls.js ganha do HLS nativo — canPlayType mente no Chromium', () => {
  assert.equal(AppPlayerCore.estrategia({ hlsNativo: true, mseDisponivel: true }), 'hlsjs',
    'com MSE presente, o hls.js manda: o "maybe" do Chromium não é confiável');
  assert.equal(AppPlayerCore.estrategia({ hlsNativo: false, mseDisponivel: true }), 'hlsjs');
  /* Sem MSE é o iPhone, onde o HLS nativo do Safari é de verdade. */
  assert.equal(AppPlayerCore.estrategia({ hlsNativo: true, mseDisponivel: false }), 'nativo');
  assert.equal(AppPlayerCore.estrategia({ hlsNativo: false, mseDisponivel: false }), 'mp4');
  assert.equal(AppPlayerCore.estrategia({}), 'mp4');
  assert.equal(AppPlayerCore.estrategia(), 'mp4');
});

/* Todo pulo do player passa por limitarTempo — teclado, gesto, capítulo,
 * barra. A duração NaN é caso real e não teórico: antes do `loadedmetadata` o
 * <video> devolve NaN, e é nesse instante que um clique na lista de capítulos
 * chega. */
test('nenhum pulo sai das pontas do vídeo', () => {
  assert.equal(AppPlayerCore.limitarTempo(-5, 100), 0);
  assert.equal(AppPlayerCore.limitarTempo(50, 100), 50);
  assert.equal(AppPlayerCore.limitarTempo(500, 100), 100);
  assert.equal(AppPlayerCore.limitarTempo(NaN, 100), 0);
  assert.equal(AppPlayerCore.limitarTempo('30', 100), 30);
  assert.equal(AppPlayerCore.limitarTempo(500, NaN), 500, 'sem duração conhecida, só o chão de 0 vale');
  assert.equal(AppPlayerCore.limitarTempo(500, Infinity), 500);
  assert.equal(AppPlayerCore.limitarTempo(-5, NaN), 0);
});

test('os pulos relativos do teclado respeitam as pontas', () => {
  assert.equal(AppPlayerCore.tempoRelativo(50, 10, 100), 60);
  assert.equal(AppPlayerCore.tempoRelativo(95, 10, 100), 100);
  assert.equal(AppPlayerCore.tempoRelativo(3, -5, 100), 0);
  assert.equal(AppPlayerCore.tempoRelativo(NaN, 10, 100), 10);
});

/* As teclas 0–9 do YouTube. Sem duração não dá para calcular porcentagem, e
 * pular para "30% de NaN" mandaria o vídeo para 0 sem ninguém entender. */
test('as teclas 0–9 pulam para a porcentagem certa, e desistem sem duração', () => {
  assert.equal(AppPlayerCore.tempoPorDecimo(0, 600), 0);
  assert.equal(AppPlayerCore.tempoPorDecimo(3, 600), 180);
  assert.equal(AppPlayerCore.tempoPorDecimo(9, 600), 540);
  assert.equal(AppPlayerCore.tempoPorDecimo(5, NaN), null);
  assert.equal(AppPlayerCore.tempoPorDecimo(5, 0), null);
  assert.equal(AppPlayerCore.tempoPorDecimo(10, 600), null);
  assert.equal(AppPlayerCore.tempoPorDecimo('x', 600), null);
});

/* Sem `playsinline` o iPhone abre o vídeo em tela cheia nativa ao dar play e
 * engole a barra, os capítulos e todos os gestos das fases seguintes.
 * Sem `crossorigin` o Safari tocando HLS nativo entrega mídia "suja" e o
 * Web Audio da fase 4 devolve silêncio. */
test('o <video> nasce com playsinline e crossorigin — as duas travas do iOS', () => {
  const a = AppPlayerCore.atributosVideo();
  assert.equal(a.playsInline, true);
  assert.equal(a.crossOrigin, 'anonymous');
  assert.equal(a.controls, false, 'os controles nativos ficam desligados: a barra é nossa');
  assert.match(PLAYER_JS, /setAttribute\('playsinline', ''\)/,
    'iOS antigo lê o atributo, não a propriedade');
});

/* Mesma disciplina do Player.js dos capítulos: quem abre a grade não paga por
 * uma biblioteca que a grade não usa. São 353 KB. */
test('o hls.js é carregado sob demanda, nunca junto com a página', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.ok(!/<script[^>]+hls/i.test(html), 'index.html carrega o hls.js de saída');
  assert.match(PLAYER_JS, /function carregarHls\(\)/);
});

/* O PLAYER FORA DO CAMINHO DA CHEGADA (o LCP).
 * O player-core.js e o player.js eram <script> do index.html, e baixavam antes
 * do app.js, na frente da capa do destaque. Tirá-los valeu −450 ms de LCP.
 *
 * O que NÃO pode se perder no caminho é a queda automática para o iframe, e
 * ela tem quatro peças. Cada uma é cobrada aqui. */
test('o player desce depois da chegada, e a queda para o iframe continua', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.ok(!/<script src="player(-core)?\.js"/.test(html),
    'o player voltou ao index.html — 77 KB na frente da capa do destaque, que é o LCP');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['i18n.js', 'home-blocos.js', 'catalogo-core.js', 'app.js']);   /* guardiao.js e destaque-fundo.js também descem sob demanda */

  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));

  /* 1. Os dois descem juntos e rodam NA ORDEM, e a falha não rejeita: a
   *    ficha precisa ver `AppPlayer` indefinido, e não uma promessa quebrada. */
  const carregar = app.match(/function carregarPlayer\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(carregar, 'não achei carregarPlayer em app.js');
  assert.match(carregar[1], /\['guardiao\.js', 'player-core\.js', 'player\.js'\]/, 'a ordem dos arquivos mudou (o guardião vem antes do core)');
  assert.match(carregar[1], /tag\.async = false/, 'sem async = false o player.js pode rodar antes do core');
  assert.ok(!/reject/.test(carregar[1]), 'o carregamento do player rejeita — a ficha não cai no iframe');
  assert.match(carregar[1], /carregandoPlayer = null/, 'uma falha de rede prende o player fora para sempre');

  /* 2. A espera tem PRAZO, e `?player=embed` não espera nada. */
  const aTempo = app.match(/function playerATempo\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(aTempo, 'não achei playerATempo em app.js');
  assert.match(aTempo[1], /Promise\.race/, 'a ficha espera o player sem prazo');
  assert.match(aTempo[1], /setTimeout\(resolve, ESPERA_PLAYER_MS\)/);
  assert.match(aTempo[1], /get\('player'\) === 'embed'/, 'o ?player=embed passou a esperar o player');
  const prazo = Number(app.match(/var ESPERA_PLAYER_MS = (\d+);/)[1]);
  assert.ok(prazo >= 3000 && prazo <= 10000, 'o prazo do player saiu de 3 a 10 s: ' + prazo);

  /* 3. A ficha que esperou se desenha uma vez, sem esperar de novo, e só se
   *    ainda for a ficha do endereço. */
  const ficha = app.match(/function renderFicha\(id, tocar, momento, jaEsperou\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(ficha[1], /var espera = jaEsperou \? null : playerATempo\(\);/,
    'a ficha que já esperou espera outro prazo inteiro');
  assert.match(ficha[1], /vez === vezDaFicha && rota && rota\.id === id/,
    'a ficha atrasada cai por cima de outra tela');
  assert.ok(ficha[1].indexOf('playerATempo') < ficha[1].indexOf('playerNovoLigado'),
    'a ficha decide entre player e iframe antes de esperar o player');

  /* 4. Os gatilhos: link de ficha pede já; o resto, depois da capa principal
   *    da primeira tela. NÃO no `load` da janela: ele sai antes de o app.js
   *    pôr a capa na página, e o player voltava a disputar a banda com ela
   *    (medido: −150 ms em vez de −450). */
  const iniciar = app.match(/function iniciar\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(iniciar[1], /var comecaNaFicha = !!App\.rotaDaFicha\(hash \|\| ''\);\s*if \(comecaNaFicha\) carregarPlayer\(\);/,
    'o link direto de uma ficha deixou de pedir o player junto com o catálogo');
  assert.match(iniciar[1], /if \(!comecaNaFicha\) depoisDaCapaPrincipal\(carregarPlayer\);/,
    'a chegada deixou de pedir o player depois da capa do destaque');
  assert.ok(!/addEventListener\('load'/.test(iniciar[1]),
    'o player voltou a ser pedido no load da janela — antes da capa do destaque');
  const capa = app.match(/function depoisDaCapaPrincipal\(fn\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(capa, 'não achei depoisDaCapaPrincipal em app.js');
  assert.match(capa[1], /\.destaque-capa img/);
  assert.match(capa[1], /addEventListener\('error', depois\)/, 'a capa que falha prende o player fora');
  assert.match(capa[1], /setTimeout\(fn, ESPERA_DEPOIS_DA_CAPA_MS\)/,
    'o player voltou a ser pedido logo no load da capa — antes de ela ser pintada');
  const folga = Number(app.match(/var ESPERA_DEPOIS_DA_CAPA_MS = (\d+);/)[1]);
  assert.ok(folga >= 500 && folga <= 3000, 'a folga depois da capa saiu de 0,5 a 3 s: ' + folga);
});

/* A única dependência de terceiros do projeto. Se a versão do arquivo e a do
 * LEIA-ME divergirem, ninguém mais sabe o que está no ar. */
test('a versão do hls.js vendorizada é a que o LEIA-ME declara', () => {
  const leiaMe = lerTexto(path.join(SITE, 'vendor', 'LEIA-ME.md'));
  const declarada = leiaMe.match(/hls\.js\s+(\d+\.\d+\.\d+)/);
  assert.ok(declarada, 'o LEIA-ME do vendor precisa declarar a versão do hls.js');

  const bundle = lerTexto(path.join(SITE, 'vendor', 'hls.light.min.js'));
  assert.ok(bundle.includes('"' + declarada[1] + '"'),
    'o arquivo vendorizado não é a versão ' + declarada[1] + ' que o LEIA-ME declara');
  assert.ok(!/sourceMappingURL/.test(bundle),
    'o sourceMappingURL faz o navegador pedir um .map que não é servido');
  assert.match(bundle, /\.Hls\s*=/, 'o bundle precisa expor Hls no escopo global');
});

test('o tus-js-client é vendorizado e o admin não carrega script de CDN', () => {
  const leiaMe = lerTexto(path.join(SITE, 'vendor', 'LEIA-ME.md'));
  assert.match(leiaMe, /tus-js-client\s+\d+\.\d+\.\d+/, 'o LEIA-ME precisa declarar a versão do tus');
  const bundle = lerTexto(path.join(SITE, 'vendor', 'tus.min.js'));
  assert.match(bundle, /\.tus\s*=/, 'o bundle precisa expor tus no escopo global');
  assert.ok(!/sourceMappingURL/.test(bundle));
  assert.ok(fs.existsSync(path.join(SITE, 'vendor', 'tus-LICENSE.txt')));
  const admin = lerTexto(path.join(SITE, 'admin.html'));
  assert.ok(!/<script[^>]+src="https?:/i.test(admin), 'o admin não pode carregar script de terceiros por CDN');
  /* O admin só carrega i18n.js e mesa-inicio.js; este é quem põe o resto, em ordem, depois do idioma. */
  assert.match(lerTexto(path.join(SITE, 'mesa-inicio.js')), /'vendor\/tus\.min\.js'/);
  assert.ok(!/<script[^>]+src="https?:/i.test(lerTexto(path.join(SITE, 'mesa-inicio.js'))));
});

/* ================= teclado do player — fase 1 ===========================
 *
 * Toda a decisão "que tecla virou que ação" mora numa função pura, e é por
 * isso que ela pode ser testada aqui, sem navegador. É a promessa da seção 5
 * sendo cobrada.
 */

const tecla = (key, extra) => AppPlayerCore.acaoDeTecla(Object.assign({ key }, extra || {}));

/* A TRAVA MAIS IMPORTANTE DA FASE. O site tem um campo de busca no topo de
 * TODAS as telas. Sem ela, digitar "futebol" com a ficha aberta silencia o
 * vídeo (m), pula para 60% (6), muda a velocidade e entra em tela cheia. */
test('nenhuma tecla age enquanto alguém está digitando na busca', () => {
  for (const k of [' ', 'k', 'j', 'l', 'm', 'f', 't', '6', 'ArrowLeft', 'ArrowUp', 'Home', 'End']) {
    assert.equal(tecla(k, { digitando: true }), null, 'a tecla ' + k + ' agiu durante a digitação');
  }
  assert.equal(tecla('>', { digitando: true, shiftKey: true }), null);
  assert.equal(tecla('n', { digitando: true, shiftKey: true }), null);
});

/* Com o foco num botão, o navegador já dispara o clique dele no espaço e no
 * Enter. Sem esta regra, apertar espaço com o foco no play alterna DUAS vezes
 * e nada parece acontecer. */
test('espaço e Enter num botão focado pertencem ao botão', () => {
  assert.equal(tecla(' ', { emBotao: true }), null);
  assert.equal(tecla('Enter', { emBotao: true }), null);
  /* As outras teclas continuam valendo mesmo com o foco num botão. */
  assert.deepEqual(tecla('l', { emBotao: true }), { acao: 'pular', segundos: 10 });
});

test('reprodução básica: K e espaço', () => {
  assert.deepEqual(tecla('k'), { acao: 'alternarPlay' });
  assert.deepEqual(tecla(' '), { acao: 'alternarPlay' });
  /* CapsLock ligado não pode desligar o atalho. */
  assert.deepEqual(tecla('K'), { acao: 'alternarPlay' });
});

test('J e L pulam 10 s; as setas, 5 s', () => {
  assert.deepEqual(tecla('j'), { acao: 'pular', segundos: -10 });
  assert.deepEqual(tecla('l'), { acao: 'pular', segundos: 10 });
  assert.deepEqual(tecla('ArrowLeft'), { acao: 'pular', segundos: -5 });
  assert.deepEqual(tecla('ArrowRight'), { acao: 'pular', segundos: 5 });
});

test('Home, End e os dígitos 0–9', () => {
  assert.deepEqual(tecla('Home'), { acao: 'irPara', segundos: 0 });
  assert.deepEqual(tecla('End'), { acao: 'irParaFim' });
  assert.deepEqual(tecla('0'), { acao: 'irParaDecimo', digito: 0 });
  assert.deepEqual(tecla('7'), { acao: 'irParaDecimo', digito: 7 });
  /* 'F1' passa numa comparação ingênua de string com '0' e '9'. */
  assert.equal(tecla('F1'), null);
  assert.equal(tecla('F12'), null);
});

/* Em ABNT2 e US, Shift+. dá ">" e Shift+, dá "<". Aceitamos as duas leituras
 * porque nem todo layout produz o caractere. */
test('Shift + > e Shift + < mudam a velocidade, nos dois jeitos de ler a tecla', () => {
  assert.deepEqual(tecla('>', { shiftKey: true }), { acao: 'velocidade', passo: 1 });
  assert.deepEqual(tecla('<', { shiftKey: true }), { acao: 'velocidade', passo: -1 });
  assert.deepEqual(tecla('.', { shiftKey: true }), { acao: 'velocidade', passo: 1 });
  assert.deepEqual(tecla(',', { shiftKey: true }), { acao: 'velocidade', passo: -1 });
});

test('M silencia, as setas verticais mexem no volume', () => {
  assert.deepEqual(tecla('m'), { acao: 'alternarMudo' });
  assert.deepEqual(tecla('ArrowUp'), { acao: 'volume', passo: 0.05 });
  assert.deepEqual(tecla('ArrowDown'), { acao: 'volume', passo: -0.05 });
});

test('F é tela cheia e T é modo teatro', () => {
  assert.deepEqual(tecla('f'), { acao: 'alternarTelaCheia' });
  assert.deepEqual(tecla('t'), { acao: 'alternarTeatro' });
});

/* Navegação EXPLÍCITA por tecla — o mesmo gesto deliberado de clicar nos
 * botões da série. Não tem nada a ver com avanço automático, que continua
 * proibido: nada disto é disparado pelo fim do vídeo. */
test('Shift+N e Shift+P trocam de episódio', () => {
  assert.deepEqual(tecla('n', { shiftKey: true }), { acao: 'episodio', direcao: 1 });
  assert.deepEqual(tecla('p', { shiftKey: true }), { acao: 'episodio', direcao: -1 });
});

/* Ctrl+Shift+N abre janela anônima no Chrome. Se o modificador não fosse
 * checado ANTES do Shift, a tecla também trocaria de episódio pelas costas. */
test('Ctrl, Alt e Meta não são nossos — nem combinados com Shift', () => {
  for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    assert.equal(tecla('n', Object.assign({ shiftKey: true }, mod)), null);
    assert.equal(tecla('k', mod), null);
    assert.equal(tecla('f', mod), null);
  }
  /* A ÚNICA exceção, aberta pela fase 3: Ctrl + setas são os capítulos. As
   * setas com Alt e com Meta continuam fora — Alt+seta é voltar e avançar no
   * histórico do navegador, e Cmd+seta é o mesmo no Mac. */
  assert.equal(tecla('ArrowRight', { altKey: true }), null);
  assert.equal(tecla('ArrowLeft', { altKey: true }), null);
  assert.equal(tecla('ArrowRight', { metaKey: true }), null);
  assert.equal(tecla('ArrowLeft', { metaKey: true }), null);
});

/* Uma tecla que ainda não é nossa tem que voltar null — o player não chama
 * preventDefault e ela continua com o navegador, que é o certo. */
test('as teclas das fases seguintes ainda não respondem', () => {
  assert.equal(tecla(','), null, 'quadro a quadro é a fase 9');
  assert.equal(tecla('.'), null, 'quadro a quadro é a fase 9');
  assert.equal(tecla('i'), null, 'miniplayer é a fase 7');
  assert.equal(tecla('Tab'), null, 'Tab é da navegação por teclado, não nossa');
  assert.equal(tecla('Escape'), null);
});

test('acaoDeTecla aguenta entrada torta sem lançar', () => {
  assert.equal(AppPlayerCore.acaoDeTecla(), null);
  assert.equal(AppPlayerCore.acaoDeTecla({}), null);
  assert.equal(AppPlayerCore.acaoDeTecla({ key: null }), null);
  assert.equal(AppPlayerCore.acaoDeTecla({ key: '' }), null);
  assert.equal(AppPlayerCore.acaoDeTecla({ key: 7 }), null);
});

/* Degraus, e não escala contínua: 1,25 e 1,5 são o que a pessoa procura, e um
 * passo de 0,1 exigiria cinco toques para chegar em 1,5. */
test('a velocidade anda pelos degraus do YouTube e para nas pontas', () => {
  assert.equal(AppPlayerCore.proximaVelocidade(1, 1), 1.25);
  assert.equal(AppPlayerCore.proximaVelocidade(1, -1), 0.75);
  assert.equal(AppPlayerCore.proximaVelocidade(2, 1), 2, 'não passa de 2x');
  assert.equal(AppPlayerCore.proximaVelocidade(0.25, -1), 0.25, 'não desce de 0,25x');
  /* O 2x temporário do gesto da fase 5 pode deixar uma velocidade fora da
   * lista; daí ela cai no degrau mais próximo antes de andar. */
  assert.equal(AppPlayerCore.proximaVelocidade(1.4, 1), 1.75);
  assert.equal(AppPlayerCore.proximaVelocidade(1.4, -1), 1.25);
});

test('o volume fica entre 0 e 1, sem lixo de ponto flutuante', () => {
  assert.equal(AppPlayerCore.proximoVolume(0.5, 0.05), 0.55);
  assert.equal(AppPlayerCore.proximoVolume(1, 0.05), 1, 'não passa de 100%');
  assert.equal(AppPlayerCore.proximoVolume(0, -0.05), 0, 'não desce de 0');
  assert.equal(AppPlayerCore.proximoVolume(NaN, -0.05), 0.95, 'sem valor conhecido, parte de 100%');
  /* Somar 0,05 oito vezes daria 0.4000000000000001 e o selo mostraria
   * "Volume 40.00000000000001%". */
  let v = 0;
  for (let i = 0; i < 8; i++) v = AppPlayerCore.proximoVolume(v, 0.05);
  assert.equal(v, 0.4);
});


/* ================================= fase 4 — o som ========================
 *
 * O grafo `<video>` → ganho → compressor → saída resolve quatro itens de uma
 * vez, e o que está testado aqui é a parte que DECIDE: o teto do volume, por
 * onde ele passa, o que o compressor vira em cada caso e o que o selo diz.
 * A montagem do grafo é DOM e vive no player.js — dela, o que dá para provar
 * sem navegador é a forma, e é o que os testes de código-fonte fazem no fim.
 */

test('sem grafo o volume para em 100% — prometer reforço ali seria mentira', () => {
  /* `video.volume` não passa de 1 em navegador nenhum. O teto padrão continua
   * sendo 1 justamente para que quem não montou grafo não veja "150%". */
  assert.equal(AppPlayerCore.proximoVolume(1, 0.05), 1);
  assert.equal(AppPlayerCore.proximoVolume(0.98, 0.05), 1);
});

test('com grafo o volume vai até 200% e para lá (item 12)', () => {
  const M = AppPlayerCore.VOLUME_MAX_GANHO;
  assert.equal(M, 2);
  assert.equal(AppPlayerCore.proximoVolume(1, 0.05, M), 1.05);
  assert.equal(AppPlayerCore.proximoVolume(2, 0.05, M), 2, 'não passa de 200%');
  assert.equal(AppPlayerCore.proximoVolume(0, -0.05, M), 0, 'o piso continua sendo 0');
  /* Um teto torto não pode virar volume infinito nem abaixar o teto normal. */
  assert.equal(AppPlayerCore.proximoVolume(1, 0.05, NaN), 1);
  assert.equal(AppPlayerCore.proximoVolume(1, 0.05, 0.5), 1, 'teto abaixo de 1 é ignorado');
});

/* A regra mais importante da fase, e a razão de `viaDoVolume` existir:
 * `createMediaElementSource` NÃO TEM VOLTA. Depois dele o áudio do vídeo só
 * sai pelo grafo, e um grafo que falhe deixa o vídeo mudo. Montar por precaução
 * é trocar um risco zero por um risco real. */
test('o grafo não é montado para quem não precisa dele', () => {
  const via = AppPlayerCore.viaDoVolume({ pedido: 0.8, grafoAtivo: false, elementoObedece: true });
  assert.equal(via, 'elemento', 'desktop em 80%: video.volume dá conta sozinho');
});

test('as duas — e só as duas — razões para montar o grafo', () => {
  /* 1. passar de 100%, que o elemento não faz */
  assert.equal(
    AppPlayerCore.viaDoVolume({ pedido: 1.5, grafoAtivo: false, elementoObedece: true }),
    'montar');
  /* 2. o elemento não obedecer, que é o iPhone (item 22) */
  assert.equal(
    AppPlayerCore.viaDoVolume({ pedido: 0.4, grafoAtivo: false, elementoObedece: false }),
    'montar');
});

test('com o grafo montado tudo passa pelo ganho', () => {
  assert.equal(AppPlayerCore.viaDoVolume({ pedido: 0.3, grafoAtivo: true, elementoObedece: true }), 'ganho');
  assert.equal(AppPlayerCore.viaDoVolume({ pedido: 1.8, grafoAtivo: true, elementoObedece: false }), 'ganho');
});

/* O plano B do projeto, escrito como código: se o grafo não for
 * possível — navegador sem Web Audio, ou uma tentativa que já falhou — e o
 * elemento não obedecer, não há o que fazer, e o certo é DIZER isso. */
test('sem grafo possível e sem elemento que obedeça, a via é nenhuma', () => {
  assert.equal(
    AppPlayerCore.viaDoVolume({ pedido: 0.4, grafoAtivo: false, elementoObedece: false, grafoPossivel: false }),
    'nenhuma');
  assert.equal(
    AppPlayerCore.viaDoVolume({ pedido: 1.5, grafoAtivo: false, elementoObedece: true, grafoPossivel: false }),
    'nenhuma');
});

test('viaDoVolume aguenta entrada torta sem lançar', () => {
  assert.equal(AppPlayerCore.viaDoVolume(), 'elemento');
  assert.equal(AppPlayerCore.viaDoVolume({}), 'elemento');
  assert.equal(AppPlayerCore.viaDoVolume({ pedido: NaN, elementoObedece: true }), 'elemento');
});

/* DOIS nós, e não um — e a razão é uma MEDIDA, não uma preferência.
 *
 * Com um compressor só, 200% + Volume Estável dava pico 1,846 no analisador,
 * contra o player rodando: clipe puro. O nivelador não segurava porque o
 * ataque de 20 ms deixa o transiente passar inteiro, e num ganho de 3,8× o
 * transiente é justamente o que estoura. Nivelar é sobre a MÉDIA; limitar é
 * sobre o TRANSIENTE. Um nó não faz as duas coisas. */
test('sem estável e sem reforço, os dois nós são transparentes', () => {
  const n = AppPlayerCore.ajusteNivelador({ estavel: false });
  const l = AppPlayerCore.ajusteLimitador({ ganho: 1 });
  assert.equal(n.ratio, 1, 'razão 1 é ausência de compressão');
  assert.equal(l.ratio, 1);
  assert.equal(n.threshold, 0);
  assert.equal(l.threshold, 0);
});

test('o Volume Estável é o nivelador, e só ele (item 8)', () => {
  const n = AppPlayerCore.ajusteNivelador({ estavel: true });
  assert.ok(n.threshold <= -20, 'pega bem antes do pico, senão não nivela nada');
  assert.ok(n.ratio > 1 && n.ratio < 10, 'razão de nivelar, não de limitar');
  assert.ok(n.knee >= 12, 'joelho macio: um compressor duro em aula gravada bombeia');
});

test('o limitador é quem segura o reforço, e olha o ganho de SAÍDA', () => {
  const l = AppPlayerCore.ajusteLimitador({ ganho: 3.8 });
  assert.ok(l.ratio >= 20, 'razão de limitador, não de compressor');
  assert.ok(l.attack <= 0.005,
    'ataque rápido: com 20 ms o transiente passa antes de ele agir — foi o bug');
  assert.ok(l.threshold > -10, 'teto alto: ele pega o pico, não o corpo do som');
});

/* A regressão que a medida de 02/09 pegou: o estável NÃO pode desligar o
 * limitador. Foi exatamente isso que deixou 200% + estável clipar em 1,846. */
test('o Volume Estável não desliga o limitador', () => {
  const ganho = AppPlayerCore.ganhoDeSaida({ volume: 2, estavel: true });
  assert.ok(AppPlayerCore.ajusteLimitador({ ganho: ganho }).ratio >= 20,
    'com o estável ligado o limitador continua limitando');

  /* E o estável SOZINHO, sem Boost nenhum, já leva o ganho a 1,9 — o limitador
   * tem que entrar aí também, senão o item 8 clipa por conta própria. */
  const soEstavel = AppPlayerCore.ganhoDeSaida({ volume: 1, estavel: true });
  assert.ok(soEstavel > 1);
  assert.ok(AppPlayerCore.ajusteLimitador({ ganho: soEstavel }).ratio >= 20);
});

/* O iPhone monta o grafo só para TER volume (item 22), em volume normal. Ali
 * ele não pode ganhar um limitador que ninguém pediu: um vídeo masterizado
 * perto de 0 dBFS soaria diferente no iPhone e no desktop. */
test('volume normal não ganha limitador só porque o grafo existe', () => {
  assert.equal(AppPlayerCore.ajusteLimitador({ ganho: 1 }).ratio, 1);
  assert.equal(AppPlayerCore.ajusteLimitador({ ganho: 0.4 }).ratio, 1);
});

test('os ajustes aguentam entrada torta sem lançar', () => {
  assert.equal(AppPlayerCore.ajusteNivelador().ratio, 1);
  assert.equal(AppPlayerCore.ajusteLimitador().ratio, 1);
  assert.equal(AppPlayerCore.ajusteLimitador({ ganho: NaN }).ratio, 1);
});

/* `DynamicsCompressorNode` não tem makeup gain — ele só abaixa. Sem a
 * compensação, LIGAR o Volume Estável deixaria o vídeo mais baixo, que é o
 * oposto do que a pessoa pediu ao ligar. */
test('o Volume Estável devolve o que o compressor tirou', () => {
  const semEstavel = AppPlayerCore.ganhoDeSaida({ volume: 1, estavel: false });
  const comEstavel = AppPlayerCore.ganhoDeSaida({ volume: 1, estavel: true });
  assert.equal(semEstavel, 1);
  assert.ok(comEstavel > semEstavel, 'ligar o estável não pode abaixar o som');
});

test('o ganho tem teto — ninguém precisa de 400%', () => {
  const g = AppPlayerCore.ganhoDeSaida({ volume: 2, estavel: true });
  assert.ok(g <= AppPlayerCore.GANHO_MAX);
  assert.equal(AppPlayerCore.ganhoDeSaida({ volume: -3, estavel: false }), 0, 'ganho negativo é 0');
  assert.equal(AppPlayerCore.ganhoDeSaida({ volume: NaN, estavel: false }), 0);
});

/* O selo diz a verdade — é promessa do projeto desde a fase 1, e promessa do
 * projeto tem teste. Mostrar "Volume 40%" com o som parado no mesmo lugar é
 * exatamente o que o iPhone faria sem isto. */
test('o selo do volume não mente no iPhone', () => {
  assert.equal(
    AppPlayerCore.rotuloVolume({ via: 'nenhuma', volume: 0.4 }),
    'Volume: use os botões do aparelho');
});

test('o selo mostra o reforço em vez de escondê-lo', () => {
  assert.equal(AppPlayerCore.rotuloVolume({ via: 'elemento', volume: 0.4 }), 'Volume 40%');
  assert.equal(AppPlayerCore.rotuloVolume({ via: 'ganho', volume: 1 }), 'Volume 100%');
  assert.match(AppPlayerCore.rotuloVolume({ via: 'ganho', volume: 1.5 }), /150%.*reforço/);
});

/* ---------------------------------- o moldador: o teto que é aritmética ---
 *
 * Toda a seção acima é ajuste medido — números escolhidos porque o analisador
 * disse. O moldador é de outra natureza: ele NÃO PODE deixar passar de 0,881,
 * e isso é uma propriedade da curva, não uma medição de sorte. É por isso que
 * ele existe; foi tuning demais até aqui. */
test('a curva do moldador não deixa passar de 1, por construção', () => {
  const c = AppPlayerCore.curvaSuave();
  const maior = Math.max(...[...c].map(Math.abs));
  assert.ok(maior < 1, 'nenhuma casa da curva chega a 1');
  assert.equal(Math.round(maior * 10000) / 10000, Math.round(AppPlayerCore.tetoMoldador() * 10000) / 10000);
  /* -1,1 dBFS: folga de verdade, não os 0,45 dB que o limitador sozinho dava. */
  assert.ok(AppPlayerCore.tetoMoldador() > 0.85 && AppPlayerCore.tetoMoldador() < 0.9);
});

/* O que impede o moldador de colorir o áudio normal. Sem isto ele seria um
 * distorcedor ligado o tempo todo — inclusive no iPhone, que monta o grafo só
 * para ter volume (item 22), em volume normal. */
test('abaixo do joelho a curva é a identidade', () => {
  const c = AppPlayerCore.curvaSuave();
  const J = AppPlayerCore.JOELHO_MOLDADOR;
  let desvio = 0;
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    if (Math.abs(x) <= J) desvio = Math.max(desvio, Math.abs(c[i] - x));
  }
  assert.ok(desvio < 1e-6, 'a amostra sai como entrou; desvio medido: ' + desvio);
});

/* Uma quina na emenda seria distorção audível bem ANTES do pico — o ponto de
 * usar tanh nesta forma é a inclinação valer exatamente 1 no joelho. */
test('a curva encosta na identidade sem quina, e só sobe', () => {
  const c = AppPlayerCore.curvaSuave();
  assert.ok(c.every((v, i) => i === 0 || v >= c[i - 1]), 'monotônica');
  assert.ok(Math.abs(c[0] + c[c.length - 1]) < 1e-6, 'simétrica em torno de zero');

  /* A inclinação na emenda não pode dar salto: comparo o passo logo antes e
   * logo depois do joelho. */
  const J = AppPlayerCore.JOELHO_MOLDADOR;
  const iJ = Math.round(((J + 1) / 2) * (c.length - 1));
  const antes = c[iJ] - c[iJ - 1];
  const depois = c[iJ + 1] - c[iJ];
  assert.ok(Math.abs(depois - antes) < antes * 0.05,
    'a inclinação muda menos de 5% na emenda');
});

test('o moldador fica FORA em volume normal', () => {
  assert.equal(AppPlayerCore.precisaMoldador({ ganho: 1 }), false);
  assert.equal(AppPlayerCore.precisaMoldador({ ganho: 0.4 }), false);
  assert.equal(AppPlayerCore.precisaMoldador({ ganho: 1.5 }), true);
  assert.equal(AppPlayerCore.precisaMoldador(), false, 'entrada torta não liga o nó');
});

/* `curve = null` é o desligamento de verdade do WaveShaperNode: a amostra
 * passa adiante intocada. Trocar por uma curva-identidade seria pior — 2048
 * arredondamentos de float32 em cima de todo o áudio, de graça. */
test('em volume normal o moldador é desligado, não neutralizado', () => {
  assert.match(PLAYER_CODIGO, /som\.molde\.curve = AppPlayerCore\.precisaMoldador/);
  assert.match(PLAYER_CODIGO, /:\s*null;/);
});

/* ------------------- a forma do grafo, lida no código-fonte -------------- */

/* A ORDEM é o que faz o compressor virar o limitador do Boost. Invertida —
 * compressor antes do ganho — o reforço multiplicaria a saída do compressor e
 * clipparia, e o item 12 entregaria distorção em vez de volume. */
test('a ordem do grafo: ganho, nivelador, limitador, saída', () => {
  const i = PLAYER_CODIGO.indexOf('som.fonte.connect(som.ganho)');
  const j = PLAYER_CODIGO.indexOf('som.ganho.connect(som.nivel)');
  const k = PLAYER_CODIGO.indexOf('som.nivel.connect(som.limite)');
  const l = PLAYER_CODIGO.indexOf('som.limite.connect(som.molde)');
  const m = PLAYER_CODIGO.indexOf('som.molde.connect(som.ctx.destination)');
  assert.ok(i >= 0 && j > i && k > j && l > k && m > l,
    'ganho → nivelador → limitador → moldador → saída, e o moldador é o último');
});

/* `createMediaElementSource` é o passo sem volta. Se um `createGain()` fosse
 * lançar, tem que lançar com o vídeo ainda ligado na saída normal do
 * navegador — depois da captura, um erro deixaria o vídeo mudo. */
test('nada que possa lançar vem depois da captura do elemento', () => {
  const i = PLAYER_CODIGO.indexOf('som.ctx.createGain()');
  const j = PLAYER_CODIGO.indexOf('som.limite = som.ctx.createDynamicsCompressor()');
  const k = PLAYER_CODIGO.indexOf('createMediaElementSource');
  assert.ok(i >= 0 && j > i && k > j, 'os três nós são criados antes da fonte');
});

/* Mesmo motivo do `hls.destroy()`: o navegador limita quantos AudioContext uma
 * página pode ter — a ordem de meia dúzia —, e um por ficha visitada esgota a
 * conta em seis idas e voltas entre a grade e a ficha. */
test('o AudioContext é fechado ao sair da ficha', () => {
  const destruir = PLAYER_CODIGO.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(destruir, 'destruir() encontrada');
  assert.match(destruir[1], /som\.ctx\.close\(\)/);
  assert.match(destruir[1], /ultimoSom\s*=\s*null/, 'a referência de módulo também sai');
});

/* O AudioContext exige um gesto para ligar. Montar no carregamento produziria
 * um contexto suspenso com o áudio JÁ capturado — ou seja, um vídeo mudo até
 * alguém tocar em alguma coisa. */
test('o grafo só é montado a partir de um gesto', () => {
  /* Todas as chamadas de montarGrafo() saem de um caminho de gesto:
   * somDaPreferencia (o primeiro play), definirVolume (tecla, arrasto) e
   * definirEstavel (clique na caixinha). Nenhuma no corpo de criarPlayer.
   *
   * Eram 4 até 04/09. A quarta era a do iPhone — o elemento recusava a escrita
   * e o grafo entrava no lugar dele (item 22) —, e ela saiu quando a medida no
   * aparelho mostrou que ali o grafo não entrega nada. */
  const chamadas = (PLAYER_CODIGO.match(/montarGrafo\(\)/g) || []).length;
  assert.equal(chamadas, 4, 'declaração + 3 chamadas, todas dentro de gesto');
  /* somDaPreferencia é chamada de dentro do play, e não solta no corpo. */
  assert.match(corpoDaFuncao(PLAYER_CODIGO, 'tocarPorGesto'), /somDaPreferencia\(\)/);
  assert.ok(!/somDaPreferencia\(\)/.test(corpoDaFuncao(PLAYER_CODIGO, 'tocarAutomatico')),
    'o início sem gesto não monta o grafo de áudio: o contexto nasceria suspenso');
});

/* ---------- o iPhone não tem controle de volume nosso (04/09) ------------ */

/* MEDIDO NUM IPHONE 11, e é o que derrubou a premissa do item 22. Com o grafo
 * montado, mexer no volume e ligar o Volume Estável não mudam nada que se
 * ouça; `AppPlayer.medir()` devolveu `estado: 'suspended'` e pico 0. Um grafo
 * parado não processa — e, com o elemento já capturado, um grafo parado é um
 * vídeo MUDO, sem aviso e sem volta.
 *
 * Então lá o volume é o do aparelho, e o painel diz isso. */
test('o elemento que recusa o volume fecha o grafo, em vez de montá-lo', () => {
  const probe = PLAYER_CODIGO.match(
    /function elementoAceitaVolume\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(probe, 'não achei o probe do volume em player.js');

  /* A pergunta tem que ser INAUDÍVEL: escreve uma diferença de 1%, confere se
   * pegou e devolve o valor que estava. Um probe que esquece de devolver muda
   * o volume de quem abriu a ficha. */
  assert.match(probe[1], /var antes = video\.volume/);
  assert.match(probe[1], /video\.volume = antes/, 'o probe tem que devolver o volume');
  assert.match(probe[1], /catch/, 'escrever pode lançar, e lançar também é "não obedece"');

  /* E a recusa fecha as duas portas — o elemento E o grafo. */
  const fecha = PLAYER_CODIGO.match(
    /if \(!elementoAceitaVolume\(\)\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(fecha, 'não achei o que acontece quando o elemento recusa');
  assert.match(fecha[1], /som\.obedece = false/);
  assert.match(fecha[1], /som\.possivel = false/,
    'sem isto o grafo ainda seria montado, e é ele que arrisca o vídeo mudo');
  assert.match(fecha[1], /som\.estavel = false/,
    'caixinha marcada e inerte seria mentira');
  assert.ok(!/montarGrafo/.test(fecha[1]), 'o iPhone não pode montar o grafo');
});

/* A mesma decisão no caminho de execução: o elemento que aceitava e parou de
 * aceitar não pode cair no grafo. */
test('a recusa em tempo de execução também não monta o grafo', () => {
  const definir = PLAYER_CODIGO.match(
    /function definirVolume\(pedido\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(definir, 'não achei definirVolume em player.js');
  const recusa = definir[1].match(
    /if \(Math\.round\(video\.volume \* 100\)[\s\S]*?\n        \} else \{/);
  assert.ok(recusa, 'não achei a releitura do volume');
  assert.match(recusa[0], /som\.possivel = false/);
  assert.ok(!/montarGrafo/.test(recusa[0]),
    'voltou a montar o grafo quando o elemento recusa: é o caminho do vídeo mudo no iOS');
});

/* Quem decide é o RECURSO, não o nome do navegador. O projeto inteiro é assim
 * — `matchMedia('(hover: none)')` para o painel, `MediaSource` para o HLS —, e
 * farejar `userAgent` seria a primeira exceção. */
test('nada neste player pergunta qual é o navegador', () => {
  /* Sem os comentários, pela mesma razão do teste da AccessKey: CITAR o
   * `userAgent` para dizer que não se fareja é justamente o que o comentário
   * do probe faz. Citar é permitido; usar, não. */
  for (const arquivo of ['player.js', 'player-core.js', 'app.js', 'catalogo-core.js']) {
    const codigo = semComentarios(lerTexto(path.join(SITE, arquivo)));
    assert.ok(!/userAgent|navigator\.platform|navigator\.vendor/.test(codigo),
      arquivo + ' fareja o navegador em vez de perguntar pelo recurso');
  }
});

/* O CONTEXTO QUE SUSPENDE E NÃO VOLTA (04/09) — achado medindo o iPhone, e o
 * conserto vale para Android e desktop, que são onde o grafo continua
 * existindo. Com o elemento já capturado, contexto suspenso é vídeo MUDO, sem
 * aviso e sem volta: até aqui o `resume()` só era chamado ao montar o grafo e
 * uma vez, 500 ms depois, no vigia. */
test('todo sinal de vida acorda o som, não só os 500 ms do vigia', () => {
  const acordar = PLAYER_CODIGO.match(
    /function acordarControles\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(acordar, 'não achei acordarControles em player.js');
  assert.match(acordar[1], /acordarSom\(\)/,
    'sem isto o contexto suspenso nunca mais volta, e o vídeo fica mudo');

  /* Pendurar AQUI é pendurar nos seis lugares de uma vez — é esta função que
   * já é chamada por tecla, ponteiro, play, pause e foco. */
  const chamadas = (PLAYER_CODIGO.match(/acordarControles\(\)/g) || []).length;
  assert.ok(chamadas >= 6, 'acordarControles deixou de ser o gancho de todo sinal de vida');
});

/* A aba que volta é justamente quando o contexto está suspenso. Voltar não é
 * um gesto, então o `resume()` pode não pegar — por isso o vigia é rearmado
 * junto: ele tenta de novo e, se não conseguir, põe o recado no painel em vez
 * de deixar o vídeo mudo em silêncio. */
test('a aba que volta tenta acordar o som e rearma o vigia', () => {
  assert.match(PLAYER_CODIGO,
    /document\.addEventListener\('visibilitychange', aoVoltarVisivel\)/);
  const voltar = PLAYER_CODIGO.match(
    /function aoVoltarVisivel\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(voltar, 'não achei aoVoltarVisivel em player.js');
  assert.match(voltar[1], /acordarSom\(\)/);
  assert.match(voltar[1], /vigiarContexto\(\)/,
    'sem rearmar o vigia, um resume que falha fica sem recado');
  assert.match(voltar[1], /!som\.ativo\) return/, 'sem grafo não há nada para acordar');

  /* E ele sai em destruir(), como os outros dois ouvintes de document: um por
   * ficha visitada se acumularia. */
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1],
    /removeEventListener\('visibilitychange', aoVoltarVisivel\)/);
});

/* E o painel diz a verdade quando não sobrou caminho: é a única coisa que
 * separa "não dá para mexer aqui" de "o site está quebrado". */
test('sem caminho para o volume, o painel manda usar os botões do aparelho', () => {
  const sincronizar = PLAYER_CODIGO.match(
    /function sincronizarSom\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(sincronizar, 'não achei sincronizarSom em player.js');
  assert.match(sincronizar[1], /var semSaida = !som\.obedece && !som\.ativo && !som\.possivel/);
  assert.match(sincronizar[1], /faixaVol\.disabled = semSaida/);
  assert.match(sincronizar[1], /caixaEstavel\.disabled = !som\.ativo && !som\.possivel/);
  assert.match(sincronizar[1], /dizerNoPainel\(tr\('player\.useBotoesDoAparelho'\)\)/);
});

/* Medir o som no aparelho não pode ser um jeito de silenciá-lo: `disconnect()`
 * sem argumento faria o compressor largar TAMBÉM a saída. */
test('a torneira de medição solta só o que ligou', () => {
  assert.match(PLAYER_CODIGO, /s\.molde\.disconnect\(an\)/);
  assert.doesNotMatch(PLAYER_CODIGO, /molde\.disconnect\(\)/);
});

/* O listener é global no `document` — ninguém deveria precisar clicar no vídeo
 * antes de o teclado funcionar. E por ser global, TEM que sair: a ficha é
 * destruída a cada troca de rota, e um listener por ficha visitada se
 * acumularia, todos mexendo em <video> que já saíram do DOM. */
test('o teclado é global e sai junto com a ficha', () => {
  assert.match(PLAYER_CODIGO, /document\.addEventListener\('keydown', aoTeclar\)/);
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /removeEventListener\('keydown', aoTeclar\)/,
    'o listener de teclado fica vivo depois de sair da ficha');
  assert.match(destruir[1], /classList\.remove\('app-teatro'\)/,
    'sair da ficha em modo teatro deixaria a grade estreita');
});

/* `preventDefault` cancela a rolagem da página no espaço, nas setas, no Home e
 * no End. Chamá-lo ANTES de saber se a tecla é nossa quebraria o Tab, o F5 e a
 * navegação por teclado do site inteiro. */
test('preventDefault só depois de a tecla ser reconhecida como nossa', () => {
  const corpo = PLAYER_JS.match(/function aoTeclar\(ev\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei aoTeclar em player.js');
  const semComent = semComentarios(corpo[1]);
  const posSaida = semComent.indexOf('if (!acao) return');
  const posPrevent = semComent.indexOf('ev.preventDefault()');
  assert.ok(posSaida >= 0 && posPrevent > posSaida,
    'preventDefault precisa vir depois do "if (!acao) return"');
});

/* O teclado não pode ser um segundo lugar de onde o vídeo começa sozinho: ele
 * passa pelo mesmo alternarPlay do botão, que é o único dono do play(). */
test('o teclado usa o mesmo caminho de play do botão', () => {
  assert.match(PLAYER_CODIGO, /case 'alternarPlay':\s*\n\s*alternarPlay\(\);/);
  conferirPlaySoNoGuardiao('a fase 1 abriu um segundo caminho para o play()');
});

/* ================= legenda do player — fase 2 ===========================
 *
 * As duas armadilhas destes arquivos já tinham derrubado o lado do Node em
 * 31/08 (scripts/lib/legenda.mjs). Aqui elas são cobradas de novo, no parser
 * do navegador, porque armadilha sem teste volta.
 */

/* Amostra fiel ao que a pull zone entrega: BOM, WEBVTT, cues numeradas,
 * `HH:MM:SS.mmm`, e o padrão ROLANTE — cue de 10 ms repetindo a linha
 * anterior, depois cue longa com duas linhas. Medido em 01/09 no
 * Série Exemplo 5 (836 cues, 418 delas com menos de 50 ms). */
const VTT_ROLANTE = '﻿WEBVTT\n\n' +
  '1\n00:00:14.990 --> 00:00:15.000\nEsse aí sou eu e dá para notar que eu me\n\n' +
  '2\n00:00:15.000 --> 00:00:17.390\nEsse aí sou eu e dá para notar que eu me\nenvolvi numa aventura das grandes. Mas\n\n' +
  '3\n00:00:17.390 --> 00:00:17.400\nenvolvi numa aventura das grandes. Mas\n';

test('ARMADILHA 1 — o BOM não pode matar o arquivo inteiro', () => {
  /* Os bytes são EF BB BF antes do "WEBVTT". Em texto isso é U+FEFF, e um
   * `startsWith('WEBVTT')` ingênuo devolve false: o parser desiste na
   * primeira linha e o título fica sem legenda nenhuma, sem erro visível. */
  assert.equal(VTT_ROLANTE.charCodeAt(0), 0xFEFF, 'a amostra tem que ter BOM');
  const cues = AppPlayerCore.analisarVtt(VTT_ROLANTE);
  assert.equal(cues.length, 3, 'o BOM derrubou o parser');
  assert.equal(cues[0].texto, 'Esse aí sou eu e dá para notar que eu me');
});

/* O PARSER é fiel ao arquivo: entrega a legenda rolante como ela está,
 * inclusive as cues-ponte de 10 ms. Quem converte é `desenrolarLegenda`, num
 * passo separado — assim dá para ver no player.js que a conversão acontece. */
test('ARMADILHA 2 — o parser entrega a legenda rolante como ela é', () => {
  const cues = AppPlayerCore.analisarVtt(VTT_ROLANTE);
  assert.equal(cues[1].texto, 'Esse aí sou eu e dá para notar que eu me\nenvolvi numa aventura das grandes. Mas',
    'as duas linhas da cue rolante têm que chegar inteiras, com a quebra');
  assert.equal(+(cues[2].fim - cues[2].inicio).toFixed(3), 0.010, 'a cue-ponte de 10 ms');
});

/* ---- de rolante para pop-on ----
 *
 * Exibida como vem, a legenda rolante ROLA: a linha de baixo sobe para o lugar
 * da de cima e uma nova entra embaixo. É a convenção de transmissão AO VIVO,
 * onde não se sabe o que vem depois. Em vídeo gravado ela confunde, porque
 * metade do que está na tela já foi lida — e o padrão é POP-ON: o bloco
 * aparece inteiro e é SUBSTITUÍDO pelo próximo. */
test('a legenda rolante vira pop-on sem perder texto nem atrasar a fala', () => {
  const blocos = AppPlayerCore.desenrolarLegenda(AppPlayerCore.analisarVtt(VTT_ROLANTE));

  /* As 3 cues da amostra só carregam DUAS linhas de texto — a terceira é pura
   * repetição. Viram um bloco só, com as duas linhas, em vez de três telas
   * onde a de baixo sobe empurrando a de cima. */
  assert.equal(blocos.length, 1);
  assert.equal(blocos[0].texto,
    'Esse aí sou eu e dá para notar que eu me\nenvolvi numa aventura das grandes. Mas');

  /* Herda o começo da cue-ponte de 10 ms: sem essa fusão a primeira linha do
   * vídeo teria 10 ms de tela e ninguém a leria. */
  assert.equal(blocos[0].inicio, 14.99, 'o bloco tem que herdar o início da ponte');
  /* E herda o fim da cue que virou repetição pura, em vez de piscar. */
  assert.equal(blocos[0].fim, 17.4);
});

test('nenhuma linha do arquivo se perde na conversão', () => {
  /* Três pares ponte+cue, no formato exato do Série Exemplo 5. */
  const vtt = 'WEBVTT\n\n' +
    '1\n00:00:14.990 --> 00:00:15.000\nA\n\n' +
    '2\n00:00:15.000 --> 00:00:17.390\nA\nB\n\n' +
    '3\n00:00:17.390 --> 00:00:17.400\nB\n\n' +
    '4\n00:00:17.400 --> 00:00:19.189\nB\nC\n\n' +
    '5\n00:00:19.189 --> 00:00:19.199\nC\n\n' +
    '6\n00:00:19.199 --> 00:00:21.390\nC\nD\n';
  const blocos = AppPlayerCore.desenrolarLegenda(AppPlayerCore.analisarVtt(vtt));
  const tudo = blocos.map(b => b.texto).join('\n').split('\n');
  assert.deepEqual(tudo, ['A', 'B', 'C', 'D'], 'sumiu ou repetiu linha na conversão');

  /* Nenhuma linha pode aparecer antes de ser falada. A única antecipação é a
   * ponte de 10 ms que foi absorvida — C entra em 17,390 em vez de 17,400.
   * Dez milissegundos é menos de um quadro; é o preço de não perder a ponte,
   * e o ganho é a primeira linha do vídeo não ficar com 10 ms de tela. */
  const blocoDoC = blocos.find(b => b.texto.indexOf('C') >= 0);
  assert.equal(blocoDoC.inicio, 17.39, 'C apareceu fora da hora');
  assert.ok(blocoDoC.inicio >= 17.39 - 0.001, 'C não pode adiantar mais que a ponte');

  /* Cada bloco começa quando o anterior acaba: sem buracos, sem piscada. */
  for (let i = 1; i < blocos.length; i++) {
    assert.equal(blocos[i].inicio, blocos[i - 1].fim, 'buraco entre os blocos ' + i);
  }
});

/* Metade do acervo tem legenda NORMAL. A conversão não pode encostar nela. */
test('legenda normal atravessa a conversão intacta', () => {
  const vtt = 'WEBVTT\n\n' +
    '1\n00:00:01.000 --> 00:00:03.000\nprimeira frase\n\n' +
    '2\n00:00:03.500 --> 00:00:06.000\nsegunda frase\n\n' +
    '3\n00:00:06.500 --> 00:00:09.000\nterceira frase\n';
  const cues = AppPlayerCore.analisarVtt(vtt);
  assert.deepEqual(AppPlayerCore.desenrolarLegenda(cues), cues,
    'a conversão mexeu numa legenda que não é rolante');
});

test('a conversão aguenta entrada torta e casos de borda', () => {
  assert.deepEqual(AppPlayerCore.desenrolarLegenda([]), []);
  assert.deepEqual(AppPlayerCore.desenrolarLegenda(null), []);
  assert.deepEqual(AppPlayerCore.desenrolarLegenda(undefined), []);

  const uma = AppPlayerCore.analisarVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\núnica\n');
  assert.deepEqual(AppPlayerCore.desenrolarLegenda(uma), uma, 'uma cue só não tem o que fundir');

  /* Cue curta que repete a seguinte mas NÃO encosta nela: não é ponte, e
   * fundir seria inventar tempo que o arquivo não tem. */
  const solta = AppPlayerCore.analisarVtt('WEBVTT\n\n' +
    '1\n00:00:01.000 --> 00:00:01.010\nX\n\n' +
    '2\n00:00:09.000 --> 00:00:11.000\nX\nY\n');
  const b = AppPlayerCore.desenrolarLegenda(solta);
  assert.equal(b.length, 2, 'cue distante não pode ser fundida');
  assert.equal(b[0].inicio, 1);
  assert.equal(b[1].inicio, 9);
  assert.equal(b[1].texto, 'Y');
});

test('o player converte a legenda antes de montar as cues', () => {
  assert.match(PLAYER_CODIGO, /AppPlayerCore\.desenrolarLegenda\(AppPlayerCore\.analisarVtt\(/,
    'sem a conversão a legenda rolante volta a empurrar linha para cima');
});

/* Ligar a legenda a cada vídeo é o atrito que faz alguém desistir dela. */
test('a preferência de legenda é lembrada entre vídeos', () => {
  assert.match(PLAYER_CODIGO, /function lerPreferenciaLegenda\(\)/);
  assert.match(PLAYER_CODIGO, /function gravarPreferenciaLegenda\(/);
  const alternar = PLAYER_JS.match(/function alternarLegenda\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(alternar[1], /gravarPreferenciaLegenda\(/, 'ligar/desligar tem que ser gravado');
  const corpo = PLAYER_JS.match(/function ajustarCorpoLegenda\(passo\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(corpo[1], /gravarPreferenciaLegenda\(/, 'o corpo da letra também');
  assert.match(PLAYER_CODIGO, /if \(pref && pref\.ligada\) ligarLegendaBaixando\(true\)/,
    'a preferência guardada tem que ligar a legenda sozinha ao abrir a ficha');
});

/* Uma escala gravada por outra versão do site não pode virar legenda de 400 px
 * na tela de ninguém. */
test('a escala guardada só vale se estiver na lista de degraus de hoje', () => {
  const ler = PLAYER_JS.match(/function lerPreferenciaLegenda\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(ler, 'não achei lerPreferenciaLegenda');
  assert.match(ler[1], /TAMANHOS_LEGENDA\.indexOf\(/,
    'a escala vinda do armazenamento precisa ser conferida contra a lista');
});

test('os tempos do VTT viram segundos, com e sem a hora', () => {
  assert.equal(AppPlayerCore.tempoVtt('00:01:58.606'), 118.606);
  assert.equal(AppPlayerCore.tempoVtt('01:02:03.000'), 3723);
  assert.equal(AppPlayerCore.tempoVtt('01:58.606'), 118.606, 'VTT permite omitir a hora');
  assert.equal(AppPlayerCore.tempoVtt('00:00:01,500'), 1.5, 'vírgula decimal (estilo SRT)');
  /* ".6" é 600 ms, não 6 ms: o campo dos milissegundos preenche à direita. */
  assert.equal(AppPlayerCore.tempoVtt('00:00:01.6'), 1.6);
  assert.equal(AppPlayerCore.tempoVtt('bobagem'), null);
  assert.equal(AppPlayerCore.tempoVtt(''), null);
});

test('o parser descarta o que não presta sem derrubar o resto', () => {
  const vtt = 'WEBVTT\n\n' +
    'NOTE isto é um comentário e não é cue\n\n' +
    'STYLE\n::cue { color: red }\n\n' +
    '1\n00:00:01.000 --> 00:00:03.000 align:start position:10%\nCom ajustes na linha do tempo\n\n' +
    '2\n00:00:05.000 --> 00:00:05.000\nDuração zero, nunca apareceria\n\n' +
    '3\nhorário quebrado --> nada\nTempo ilegível\n\n' +
    '4\n00:00:07.000 --> 00:00:09.000\n\n\n' +
    '5\n00:00:11.000 --> 00:00:13.000\n<v Locutor>Com tag &amp; entidade</v>\n';
  const cues = AppPlayerCore.analisarVtt(vtt);
  assert.equal(cues.length, 2, 'sobraram: a com ajustes e a com tag');
  assert.equal(cues[0].texto, 'Com ajustes na linha do tempo');
  assert.equal(cues[0].fim, 3, 'os ajustes depois do tempo não podem virar parte dele');
  assert.equal(cues[1].texto, 'Com tag & entidade');
});

test('o parser aguenta entrada torta sem lançar', () => {
  assert.deepEqual(AppPlayerCore.analisarVtt(''), []);
  assert.deepEqual(AppPlayerCore.analisarVtt(null), []);
  assert.deepEqual(AppPlayerCore.analisarVtt(undefined), []);
  assert.deepEqual(AppPlayerCore.analisarVtt('isto não é um VTT'), [], 'sem cabeçalho WEBVTT, nada');
  assert.deepEqual(AppPlayerCore.analisarVtt('WEBVTT'), []);
  assert.deepEqual(AppPlayerCore.analisarVtt(123), []);
});

test('o parser aceita fim de linha do Windows e ordena as cues', () => {
  const vtt = 'WEBVTT\r\n\r\n1\r\n00:00:09.000 --> 00:00:11.000\r\nsegunda\r\n\r\n' +
    '2\r\n00:00:01.000 --> 00:00:03.000\r\nprimeira\r\n';
  const cues = AppPlayerCore.analisarVtt(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].texto, 'primeira', 'as cues têm que sair em ordem de tempo');
  assert.ok(!/\r/.test(cues[0].texto), 'sobrou \\r no texto');
});

test('cueEm acha a legenda que está no ar', () => {
  const cues = AppPlayerCore.analisarVtt(VTT_ROLANTE);
  assert.equal(AppPlayerCore.cueEm(cues, 14.995), 0);
  assert.equal(AppPlayerCore.cueEm(cues, 16), 1);
  assert.equal(AppPlayerCore.cueEm(cues, 17.395), 2);
  assert.equal(AppPlayerCore.cueEm(cues, 5), -1, 'antes da primeira cue não há legenda');
  assert.equal(AppPlayerCore.cueEm(cues, 999), -1, 'depois da última também não');
  assert.equal(AppPlayerCore.cueEm(cues, NaN), -1);
  assert.equal(AppPlayerCore.cueEm([], 10), -1);
  /* Com sobreposição, ganha a última que começou: em legenda rolante é a mais
   * recente que interessa, e texto dobrado na tela é ilegível. */
  const sobrepostas = [
    { inicio: 0, fim: 10, texto: 'a' },
    { inicio: 5, fim: 10, texto: 'b' }
  ];
  assert.equal(AppPlayerCore.cueEm(sobrepostas, 7), 1);
});

test('o corpo da legenda anda pelos degraus e para nas pontas', () => {
  assert.equal(AppPlayerCore.proximoTamanhoLegenda(1, 1), 1.25);
  assert.equal(AppPlayerCore.proximoTamanhoLegenda(1, -1), 0.875);
  assert.equal(AppPlayerCore.proximoTamanhoLegenda(2, 1), 2, 'não passa do maior');
  assert.equal(AppPlayerCore.proximoTamanhoLegenda(0.75, -1), 0.75, 'não desce do menor');
});

test('a legenda vem de midia.legendas, na URL que o provedor serve', async () => {
  const midia = await midiaDoBunny({ fonte });
  assert.equal(AppPlayerCore.urlLegenda(midia),
    'https://' + PULLZONE_DE_TESTE + '/' + fonte.videoId + '/captions/pt.vtt');
  assert.equal(AppPlayerCore.urlLegenda(midia, 'pt'), AppPlayerCore.urlLegenda(midia));
  assert.equal(AppPlayerCore.urlLegenda(midia, 'en'), null, 'um idioma que o título não tem não vira URL');
  assert.equal(AppPlayerCore.urlLegenda({ legendas: [] }), null);
  assert.equal(AppPlayerCore.urlLegenda(null), null);
  assert.equal(App.urlLegenda({ midia }), AppPlayerCore.urlLegenda(midia));
  /* Os idiomas que o título declara viram uma faixa cada. */
  const duas = await midiaDoBunny({ fonte, legendas_idiomas: ['pt', 'en'] });
  assert.deepEqual(duas.legendas.map(l => l.idioma), ['pt', 'en']);
  assert.equal(AppPlayerCore.faixaDeLegenda(duas, 'en').rotulo, 'English');
});

/* A ARMADILHA QUE OBRIGOU O PARSER A EXISTIR: a pull zone serve o .vtt com
 * `Content-Type: application/octet-stream` . O navegador
 * exige `text/vtt` e recusa o arquivo EM SILÊNCIO — o <track> fica no DOM sem
 * cue nenhuma e sem erro no console. Se alguém "simplificar" isto para um
 * <track>, a legenda some sem ninguém perceber. */
test('a legenda não usa <track> — a pull zone serve o .vtt com o tipo errado', () => {
  assert.ok(!/createElement\(\s*['"]track['"]/.test(PLAYER_CODIGO),
    'player.js cria um <track>; a pull zone serve o .vtt como octet-stream e ele será recusado');
  assert.match(PLAYER_CODIGO, /AppPlayerCore\.analisarVtt\(/, 'o VTT tem que passar pelo nosso parser');
  assert.match(PLAYER_CODIGO, /addTextTrack\(/,
    'a régua de tempo é a do navegador: TextTrack em mode hidden');
  assert.match(PLAYER_CODIGO, /faixa\.mode\s*=\s*'hidden'/,
    "mode 'showing' faria o navegador desenhar por cima da nossa camada");
});

/* Mesma disciplina do vídeo: abrir a ficha para ler a sinopse não pode baixar
 * 73 KB de legenda que ninguém pediu. */
test('a legenda só é buscada quando a legenda está ligada', () => {
  const alternar = PLAYER_JS.match(/function alternarLegenda\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(alternar, 'não achei alternarLegenda em player.js');
  assert.match(alternar[1], /ligarLegendaBaixando\(/);

  const baixando = PLAYER_JS.match(/function ligarLegendaBaixando\(calada\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(baixando, 'não achei ligarLegendaBaixando em player.js');
  assert.match(baixando[1], /carregarLegenda\(\)/);

  /* O fetch não pode estar solto no corpo de criarPlayer: ele rodaria em toda
   * ficha aberta, inclusive na de quem só queria ler a sinopse. Os dois únicos
   * gatilhos são a tecla/botão e a preferência guardada. */
  const antesDosControles = PLAYER_CODIGO.split('function carregarLegenda')[0];
  assert.ok(!/fetch\(/.test(antesDosControles),
    'há um fetch de legenda fora de carregarLegenda');
  const gatilhos = PLAYER_CODIGO.match(/ligarLegendaBaixando\((?!calada)/g) || [];
  assert.equal(gatilhos.length, 2,
    'só dois gatilhos são previstos: a tecla/botão e a preferência guardada');
});

/* 404 em captions/pt.vtt é caso REAL e esperado, não erro: o institucional
 * não tem legenda nenhuma (o áudio é só trilha), e ele está entre os 66 no ar. */
test('título sem legenda desliga o botão em vez de quebrar', () => {
  const corpo = PLAYER_JS.match(/function ligarLegendaBaixando\(calada\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei ligarLegendaBaixando em player.js');
  assert.match(corpo[1], /\.catch\(/, 'o 404 tem que ser tratado');
  assert.match(corpo[1], /bCC\.disabled = true/, 'o botão tem que sair de circulação');
  assert.match(corpo[1], /indisponivel = true/);
  /* Aberto pela preferência guardada, um título sem legenda não pode xingar
   * quem só abriu a ficha: o aviso é só quando alguém apertou C. */
  assert.match(corpo[1], /if \(!calada\) mostrarSelo\(tr\('player\.semLegenda'\)\)/);
});

test('a faixa de legenda é desmontada ao sair da ficha', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /removeEventListener\('cuechange', pintarLegenda\)/);
});

test('C liga a legenda; + e - mudam o corpo, com ou sem Shift', () => {
  assert.deepEqual(tecla('c'), { acao: 'alternarLegenda' });
  assert.deepEqual(tecla('C'), { acao: 'alternarLegenda' });
  /* Em teclado US e ABNT2, `+` É Shift+`=`. Se a checagem viesse depois do
   * ramo de Shift, a tecla mais óbvia da fase não funcionaria. */
  assert.deepEqual(tecla('+', { shiftKey: true }), { acao: 'corpoLegenda', passo: 1 });
  assert.deepEqual(tecla('+'), { acao: 'corpoLegenda', passo: 1 }, 'o + do teclado numérico');
  assert.deepEqual(tecla('='), { acao: 'corpoLegenda', passo: 1 });
  assert.deepEqual(tecla('-'), { acao: 'corpoLegenda', passo: -1 });
  assert.deepEqual(tecla('_', { shiftKey: true }), { acao: 'corpoLegenda', passo: -1 });
  /* Continua valendo a trava geral. */
  assert.equal(tecla('c', { digitando: true }), null);
  assert.equal(tecla('+', { digitando: true, shiftKey: true }), null);
  assert.equal(tecla('c', { ctrlKey: true }), null);
});


/* ================= capítulos no player — fase 3 =========================
 *
 * Os 238 capítulos já tinham teste desde 31/08 — do lado do CATÁLOGO
 * (`App.capitulos`, `App.capituloEm`) e do lado do SCRIPT que grava no Bunny
 * (`fecharCapitulos`). O que a fase 3 acrescenta é o lado do PLAYER: os
 * segmentos desenhados na linha do tempo, a dica sob o ponteiro e o Ctrl+seta.
 *
 * Com o embed, essas três coisas vinham prontas de dentro do iframe. Trocado o
 * player, elas passam a ser código nosso — e é isso que estes testes cobram.
 */

const capsTeste = [
  { inicio: 0, titulo: 'Abertura' },
  { inicio: 100, titulo: 'O treinador' },
  { inicio: 250, titulo: 'A torcida' }
];

/* A barra é sempre feita de segmentos. Um título sem capítulos — 27 dos 66 no
 * ar — tem que continuar com a barra de antes da fase 3, e a forma de garantir
 * isso é o segmento único cobrindo 100%. */
test('sem capítulos, a barra é um segmento só — a mesma barra de sempre', () => {
  const segs = AppPlayerCore.segmentosCapitulos([], 600);
  assert.equal(segs.length, 1);
  assert.deepEqual(
    { esquerda: segs[0].esquerda, largura: segs[0].largura, titulo: segs[0].titulo },
    { esquerda: 0, largura: 100, titulo: null });

  assert.deepEqual(AppPlayerCore.segmentosCapitulos(null, 600), segs);
  assert.deepEqual(AppPlayerCore.segmentosCapitulos(undefined, 600), segs);
});

/* Sem duração não dá para saber ONDE cortar — e a resposta certa é a barra
 * inteira, não a barra vazia. Some o corte, nunca a barra. É caso real: um
 * item sem `duracao_seg` no catálogo, antes do `loadedmetadata`, com
 * `preload: none` segurando a rede. */
test('sem duração conhecida, a barra continua inteira em vez de sumir', () => {
  for (const d of [NaN, 0, -1, undefined, 'x', Infinity]) {
    const segs = AppPlayerCore.segmentosCapitulos(capsTeste, d);
    assert.equal(segs.length, 1, 'duração ' + d + ' deveria dar a barra inteira');
    assert.equal(segs[0].largura, 100);
  }
});

test('cada capítulo fecha onde o seguinte começa; o último, na duração', () => {
  const segs = AppPlayerCore.segmentosCapitulos(capsTeste, 500);
  assert.deepEqual(segs.map((s) => [s.inicio, s.fim]), [[0, 100], [100, 250], [250, 500]]);
  assert.deepEqual(segs.map((s) => s.titulo), ['Abertura', 'O treinador', 'A torcida']);
  assert.deepEqual(segs.map((s) => s.indice), [0, 1, 2]);

  /* Em porcentagem, que é o que o player.js escreve como estilo sem fazer
   * conta nenhuma. E a soma fecha em 100: a linha do tempo é contígua por
   * construção, como do lado do Node. */
  assert.deepEqual(segs.map((s) => s.esquerda), [0, 20, 50]);
  assert.deepEqual(segs.map((s) => s.largura), [20, 30, 50]);
  assert.equal(segs.reduce((soma, s) => soma + s.largura, 0), 100);
});

/* Um institucional longo só tem fala a partir de 1:58 e o primeiro capítulo dele começa
 * lá. Sem um segmento para o trecho anterior, a barra abriria com um buraco
 * bem onde todo mundo olha primeiro. */
test('o trecho antes do primeiro capítulo vira um segmento sem título', () => {
  const segs = AppPlayerCore.segmentosCapitulos([{ inicio: 118, titulo: 'A fala' }], 600);
  assert.equal(segs.length, 2);
  assert.deepEqual(
    { inicio: segs[0].inicio, fim: segs[0].fim, titulo: segs[0].titulo, indice: segs[0].indice },
    { inicio: 0, fim: 118, titulo: null, indice: -1 },
    'o trecho mudo é um segmento de verdade, só que sem nome');
  assert.equal(segs[1].titulo, 'A fala');
  assert.equal(segs[1].indice, 0, 'o índice do capítulo é o da lista do catálogo, não o do desenho');
  assert.equal(segs[0].largura + segs[1].largura, 100);
});

/* Do lado do Node, capítulo depois do fim do vídeo é ERRO e o script se
 * recusa a gravar (há teste desde 31/08). Aqui é o contrário e de propósito:
 * a ficha tem que abrir com o vídeo mesmo com o catálogo torto. */
test('a barra sobrevive a capítulo torto, como a ficha já sobrevivia', () => {
  const tortos = [
    { inicio: 0, titulo: 'Abertura' },
    { inicio: 100, titulo: 'Vale' },
    { inicio: 900, titulo: 'Depois do fim' }
  ];
  const segs = AppPlayerCore.segmentosCapitulos(tortos, 500);
  assert.deepEqual(segs.map((s) => s.titulo), ['Abertura', 'Vale']);
  assert.equal(segs[segs.length - 1].fim, 500, 'o último desenhável fecha na duração');
  assert.equal(segs.reduce((soma, s) => soma + s.largura, 0), 100);

  /* Descartar só do FIM é o que mantém os índices alinhados com a lista que
   * `App.capitulos` devolveu — e é dela que sai o índice de `capituloEm`. */
  assert.deepEqual(segs.map((s) => s.indice), [0, 1]);

  assert.doesNotThrow(() => AppPlayerCore.segmentosCapitulos([null, {}, { inicio: 'x' }], 500));
  assert.equal(AppPlayerCore.segmentosCapitulos([{ inicio: -5, titulo: 'Negativo' }], 500).length, 1,
    'início negativo é descartado e sobra a barra inteira');
});

/* Com a barra em pedaços, o preenchimento deixa de ser uma largura só: os
 * segmentos para trás ficam cheios, o de agora pela metade, os da frente
 * vazios. */
test('cada segmento se preenche sozinho conforme o vídeo passa por ele', () => {
  const segs = AppPlayerCore.segmentosCapitulos(capsTeste, 500);
  assert.deepEqual(segs.map((s) => AppPlayerCore.fracaoNoSegmento(s, 175)), [100, 50, 0]);
  assert.deepEqual(segs.map((s) => AppPlayerCore.fracaoNoSegmento(s, 0)), [0, 0, 0]);
  assert.deepEqual(segs.map((s) => AppPlayerCore.fracaoNoSegmento(s, 500)), [100, 100, 100]);

  assert.equal(AppPlayerCore.fracaoNoSegmento(null, 10), 0);
  assert.equal(AppPlayerCore.fracaoNoSegmento({ inicio: 5, fim: 5 }, 10), 0, 'segmento de largura zero');
  assert.equal(AppPlayerCore.fracaoNoSegmento(segs[0], NaN), 0);
});

/* Não é a mesma pergunta de `App.capituloEm`: os segmentos incluem o trecho
 * sem título antes do primeiro capítulo, e o último vale até a duração
 * INCLUSIVE — parar o vídeo no último quadro não pode apagar o realce. */
test('o segmento sob o ponteiro inclui o trecho sem título e o último quadro', () => {
  const segs = AppPlayerCore.segmentosCapitulos([{ inicio: 100, titulo: 'Só um' }], 500);
  assert.equal(AppPlayerCore.segmentoEm(segs, 0), 0, 'o trecho antes do primeiro capítulo');
  assert.equal(AppPlayerCore.segmentoEm(segs, 99.9), 0);
  assert.equal(AppPlayerCore.segmentoEm(segs, 100), 1);
  assert.equal(AppPlayerCore.segmentoEm(segs, 500), 1, 'o fim do vídeo ainda é o último capítulo');
  assert.equal(AppPlayerCore.segmentoEm(segs, 9999), 1);
  assert.equal(AppPlayerCore.segmentoEm(segs, -1), -1);
  assert.equal(AppPlayerCore.segmentoEm(segs, NaN), -1);
  assert.equal(AppPlayerCore.segmentoEm([], 10), -1);
  assert.equal(AppPlayerCore.segmentoEm(null, 10), -1);
});

/* ---------------------------------------------------- Ctrl + seta (item 28) */

test('Ctrl + setas viram capítulo — e só Ctrl, sem os outros modificadores', () => {
  assert.deepEqual(tecla('ArrowRight', { ctrlKey: true }), { acao: 'capitulo', direcao: 1 });
  assert.deepEqual(tecla('ArrowLeft', { ctrlKey: true }), { acao: 'capitulo', direcao: -1 });

  /* Ctrl+Shift+seta é seleção por palavra e Ctrl+Alt+seta gira a tela em
   * alguns drivers de vídeo. Nenhum dos dois pode virar pulo de capítulo. */
  assert.equal(tecla('ArrowRight', { ctrlKey: true, shiftKey: true }), null);
  assert.equal(tecla('ArrowRight', { ctrlKey: true, altKey: true }), null);
  assert.equal(tecla('ArrowRight', { ctrlKey: true, metaKey: true }), null);

  /* E a trava da busca continua acima de tudo. */
  assert.equal(tecla('ArrowRight', { ctrlKey: true, digitando: true }), null);

  /* Sem Ctrl as setas continuam sendo o pulo de 5 s da fase 1. */
  assert.deepEqual(tecla('ArrowRight'), { acao: 'pular', segundos: 5 });
});

/* O `->` é o capítulo seguinte. O `<-` NÃO é o espelho: é a convenção do botão
 * "faixa anterior" de qualquer tocador — no meio da faixa, ele volta para o
 * começo DELA. Sem isso, quem perdeu o fio no meio de um capítulo de quatro
 * minutos é jogado para o capítulo anterior inteiro. */
test('a seta da esquerda recomeça o capítulo antes de ir para o anterior', () => {
  const noMeio = AppPlayerCore.alvoDeCapitulo(capsTeste, 1, 200, -1);
  assert.deepEqual(noMeio, { indice: 1, inicio: 100, titulo: 'O treinador' },
    'no meio do capítulo, o <- volta para o começo dele');

  const pertoDoInicio = AppPlayerCore.alvoDeCapitulo(capsTeste, 1, 101, -1);
  assert.deepEqual(pertoDoInicio, { indice: 0, inicio: 0, titulo: 'Abertura' },
    'perto do começo, aí sim vai para o capítulo anterior');

  /* A fronteira é declarada, não adivinhada. */
  assert.equal(AppPlayerCore.alvoDeCapitulo(capsTeste, 1, 100 + AppPlayerCore.RECOMECO_CAPITULO_S, -1).indice, 0);
  assert.equal(AppPlayerCore.alvoDeCapitulo(capsTeste, 1, 100 + AppPlayerCore.RECOMECO_CAPITULO_S + 0.1, -1).indice, 1);
});

test('a seta da direita vai para o começo do capítulo seguinte', () => {
  assert.deepEqual(AppPlayerCore.alvoDeCapitulo(capsTeste, 0, 50, 1),
    { indice: 1, inicio: 100, titulo: 'O treinador' });
  assert.deepEqual(AppPlayerCore.alvoDeCapitulo(capsTeste, 1, 249, 1),
    { indice: 2, inicio: 250, titulo: 'A torcida' });
});

/* Devolver null é o que faz o player dizer "Último capítulo" em vez de pular
 * em silêncio para lugar nenhum — o mesmo que Shift+N já fazia no fim da
 * série. */
test('nas pontas não há para onde ir, e isso é dito e não escondido', () => {
  assert.equal(AppPlayerCore.alvoDeCapitulo(capsTeste, 2, 300, 1), null, 'último capítulo');
  assert.equal(AppPlayerCore.alvoDeCapitulo(capsTeste, 0, 1, -1), null, 'começo do primeiro capítulo');
  assert.equal(AppPlayerCore.alvoDeCapitulo([], 0, 10, 1), null, 'título sem capítulos');
  assert.equal(AppPlayerCore.alvoDeCapitulo(null, 0, 10, 1), null);
});

/* O trecho antes do primeiro capítulo é caso real (um institucional longo, que só tem fala
 * a partir de 1:58): de lá a seta da direita vai para o primeiro e a da
 * esquerda não tem para onde ir. */
test('antes do primeiro capítulo, o -> entra no primeiro e o <- não tem alvo', () => {
  const caps = [{ inicio: 118, titulo: 'A fala' }, { inicio: 300, titulo: 'Depois' }];
  assert.deepEqual(AppPlayerCore.alvoDeCapitulo(caps, -1, 30, 1),
    { indice: 0, inicio: 118, titulo: 'A fala' });
  assert.equal(AppPlayerCore.alvoDeCapitulo(caps, -1, 30, -1), null);
});

test('alvoDeCapitulo aguenta índice torto sem lançar', () => {
  assert.doesNotThrow(() => AppPlayerCore.alvoDeCapitulo(capsTeste, NaN, 10, 1));
  assert.deepEqual(AppPlayerCore.alvoDeCapitulo(capsTeste, NaN, 10, 1).indice, 0,
    'índice ilegível é tratado como "antes do primeiro"');
  assert.equal(AppPlayerCore.alvoDeCapitulo(capsTeste, 99, 10, 1), null, 'índice além do fim da lista');
  assert.equal(AppPlayerCore.alvoDeCapitulo(capsTeste, -7, 10, -1), null);
});

/* ------------------------------------------------------------ a dica */

/* Sem o limite, quem é cortado é o título do PRIMEIRO capítulo (pela
 * esquerda) e o do ÚLTIMO (pela direita) — os dois que mais se procuram. */
test('a dica não sai pela borda do player', () => {
  /* No meio, ela é centrada no ponteiro. */
  assert.equal(AppPlayerCore.posicaoDica(350, 700, 120, 4), 290);
  /* Nas pontas, encosta e para. */
  assert.equal(AppPlayerCore.posicaoDica(0, 700, 120, 4), 4);
  assert.equal(AppPlayerCore.posicaoDica(700, 700, 120, 4), 576);
  assert.equal(AppPlayerCore.posicaoDica(350, 700, 120, 0), 290, 'sem margem, o cálculo é o mesmo');

  /* Dica mais larga que a barra: um título comprido num celular estreito.
   * Sobra encostar na esquerda — a margem ganha do limite de cima. */
  assert.equal(AppPlayerCore.posicaoDica(150, 300, 400, 4), 4);

  assert.doesNotThrow(() => AppPlayerCore.posicaoDica(NaN, NaN, NaN, NaN));
});

/* ------------------------------------------- o que o player.js faz com isso */

/* A barra tem que ser desenhada ANTES do primeiro `pintar()`: sem os
 * segmentos montados não existe onde pintar o primeiro quadro dela. */
test('os segmentos são montados no início e refeitos quando a duração chega', () => {
  const pos = PLAYER_CODIGO.indexOf('montarSegmentos();');
  assert.ok(pos > 0, 'player.js não monta os segmentos');
  assert.ok(pos < PLAYER_CODIGO.indexOf('\n    pintar();'),
    'montarSegmentos() precisa vir antes do primeiro pintar()');

  /* Há dois `loadedmetadata` no arquivo desde a fase 6 — o do <video> e o da
   * prévia do arrasto. O que importa aqui é o do vídeo. */
  const meta = PLAYER_CODIGO.match(
    /video\.addEventListener\('loadedmetadata', function \(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(meta, 'não achei o listener de loadedmetadata do <video>');
  assert.match(meta[1], /montarSegmentos\(\)/,
    'a duração do Bunny diverge da do catálogo: os segmentos têm que ser refeitos');
});

/* A mesma leitura dos capítulos nos dois lugares. Se o player lesse o
 * `item.capitulos` cru e a lista lesse o saneado, os dois discordariam sobre
 * onde um capítulo começa — e ninguém entenderia por quê. */
test('o player e a lista leem os capítulos pela mesma função', () => {
  assert.match(PLAYER_CODIGO, /var caps = App\.capitulos\(item\)/);
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /var caps = App\.capitulos\(item\)/);
});

/* A parte NÃO óbvia da fase: com `preload: none` e nada carregado, escrever em
 * `currentTime` não dispara evento nenhum. Se a lista ouvisse só o
 * `timeupdate` do <video>, um pulo por Ctrl+seta antes do primeiro play
 * deixaria o destaque no capítulo anterior, como se a tecla não funcionasse. */
test('a lista de capítulos ouve o player, não o <video>', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const lista = app.match(/function listaCapitulos\(item, alvo\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(lista, 'não achei listaCapitulos em app.js');
  assert.match(lista[1], /alvo\.aoTempo\(/, 'a lista precisa se inscrever no player');
  assert.ok(!/alvo\.video\.addEventListener/.test(lista[1]),
    'ouvir o <video> direto perde os pulos feitos com a mídia ainda não carregada');

  /* E o player avisa nos DOIS caminhos: no relógio andando e no pulo. */
  const irPara = PLAYER_CODIGO.match(/function irPara\(segundos\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(irPara, 'não achei irPara em player.js');
  assert.match(irPara[1], /avisarTempo\(\)/, 'um pulo tem que avisar quem acompanha');
  assert.match(PLAYER_CODIGO, /'timeupdate', function \(\) \{ pintar\(\); avisarTempo\(\); \}/);
});

/* Os inscritos são funções da FICHA. Sem soltá-los, o player continuaria
 * chamando código de uma tela que já foi destruída. */
test('os inscritos no tempo são soltos ao sair da ficha', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /ouvintesTempo\.length = 0/);
});

/* A MESMA regra de produto da lista clicável, agora pelo teclado: pular de
 * capítulo POSICIONA, nunca manda tocar. Um vídeo pausado continua pausado no
 * capítulo novo. */
test('o Ctrl+seta posiciona o vídeo — nunca manda tocar', () => {
  const fn = PLAYER_CODIGO.match(/function irParaCapitulo\(direcao\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(fn, 'não achei irParaCapitulo em player.js');
  assert.ok(!/\.play\s*\(/.test(fn[1]), 'irParaCapitulo chama play()');
  assert.match(fn[1], /irPara\(alvo\.inicio\)/);

  /* E o total do arquivo continua sendo um: a fase 3 não abriu um segundo
   * lugar de onde o vídeo pode começar sozinho. */
  conferirPlaySoNoGuardiao('a fase 3 abriu um segundo caminho para o play()');
});

/* Um título sem capítulos não pode virar uma tecla morta: `preventDefault` já
 * foi chamado, então a tecla precisa dizer alguma coisa. */
test('Ctrl+seta num título sem capítulos avisa em vez de não fazer nada', () => {
  const fn = PLAYER_CODIGO.match(/function irParaCapitulo\(direcao\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(fn[1], /if \(!caps\.length\) \{ mostrarSelo\(/);
  assert.match(fn[1], /player\.ultimoCapitulo/);
  assert.match(fn[1], /player\.primeiroCapitulo/);
});
/* ================= gestos do player — fase 5 =============================
 *
 * A fase que o projeto chamou de "o maior risco escondido":
 * um player é DOM puro, e gesto é a parte mais DOM de todas. A saída
 * decidida lá — e cobrada aqui — é que a DECISÃO do gesto não é DOM. A
 * máquina recebe pontos e devolve ações; o player.js só executa.
 *
 * O que estes testes provam é a SEQUÊNCIA, que é onde moram os erros de
 * gesto: o toque duplo que também dá play, o arrasto que começa parecendo
 * toque, o segundo dedo que chega no meio. Nada disso aparece olhando um
 * evento de cada vez, e nada disso precisa de dedo nem de navegador.
 */

const QUADRO_TELEFONE = { largura: 375, altura: 211 };   /* 16:9 em 375 px */
const QUADRO_CHEIO = { largura: 812, altura: 375 };      /* o mesmo, deitado */
/* Tela cheia com o aparelho EM PÉ: a tela toda, não o 16:9. É o quadro em que
 * o deslize ↑ da fase 7 tem o que fazer — há altura sobrando para ganhar. */
const QUADRO_CHEIO_EM_PE = { largura: 375, altura: 812 };

const gestosDe = (medidas) => {
  const g = AppPlayerCore.criarGestos();
  g.medir(medidas || QUADRO_TELEFONE);
  return g;
};
const dedo = (id, x, y, t, tipo) => ({ id, x, y, t, tipo });

/* ---------------------------------------------------------- as três faixas */

test('as três faixas do quadro: 30% de cada lado, 40% de centro', () => {
  assert.equal(AppPlayerCore.ZONA_LADO, 0.3);
  assert.equal(AppPlayerCore.zonaDoToque(10, 375), 'esquerda');
  assert.equal(AppPlayerCore.zonaDoToque(112, 375), 'esquerda');
  assert.equal(AppPlayerCore.zonaDoToque(113, 375), 'centro');
  assert.equal(AppPlayerCore.zonaDoToque(187, 375), 'centro');
  assert.equal(AppPlayerCore.zonaDoToque(263, 375), 'direita');
  assert.equal(AppPlayerCore.zonaDoToque(374, 375), 'direita');
});

/* Sem medida não há como saber onde o dedo caiu. A resposta segura é o
 * centro: play/pause, o gesto que não estraga nada — e não um pulo de 5 s
 * para um lado escolhido no chute. */
test('sem medida do quadro, todo toque é do centro', () => {
  for (const L of [0, -1, NaN, undefined, 'x']) {
    assert.equal(AppPlayerCore.zonaDoToque(10, L), 'centro', 'largura ' + L);
  }
});

/* A borda é do navegador: é ali que mora o "voltar" do celular, e no iOS não
 * há como disputar. Um arrasto que começa ali não pode virar linha do tempo —
 * o gesto seria interrompido no meio, com o vídeo já deslocado. */
test('os 24 px da borda não são nossos — é onde mora o "voltar"', () => {
  assert.equal(AppPlayerCore.MARGEM_BORDA_PX, 24);
  assert.equal(AppPlayerCore.naBordaLateral(10, 375), true);
  assert.equal(AppPlayerCore.naBordaLateral(370, 375), true);
  assert.equal(AppPlayerCore.naBordaLateral(30, 375), false);
  assert.equal(AppPlayerCore.naBordaLateral(200, 375), false);

  const g = gestosDe();
  g.descer(dedo(1, 8, 100, 0));
  assert.equal(g.mover(dedo(1, 60, 100, 40)), null,
    'um arrasto que começa na borda não vira linha do tempo');
  assert.equal(g.estado().eixo, 'morto');
});

/* ------------------------------------------------- item 1 — toque duplo */

test('dois toques na esquerda voltam 5 s; na direita, avançam', () => {
  assert.equal(AppPlayerCore.PULO_TOQUE_S, 5, 'o mesmo passo das setas do teclado');

  const esq = gestosDe();
  esq.descer(dedo(1, 40, 100, 0));
  esq.subir(dedo(1, 40, 100, 60));
  assert.deepEqual(esq.descer(dedo(2, 44, 104, 200)), { acao: 'pular', segundos: -5 });

  const dir = gestosDe();
  dir.descer(dedo(1, 330, 100, 0));
  dir.subir(dedo(1, 330, 100, 60));
  assert.deepEqual(dir.descer(dedo(2, 332, 98, 200)), { acao: 'pular', segundos: 5 });
});

/* O pulo dispara no SEGUNDO toque, e o `subir` dele não pode dar play/pause
 * por cima: era exatamente isso que o `click` do <video> fazia antes desta
 * fase — dois play/pause além do pulo, e a tela piscando a cada gesto. */
test('o toque que pulou não dá play/pause de brinde', () => {
  const g = gestosDe();
  g.descer(dedo(1, 40, 100, 0));
  g.subir(dedo(1, 40, 100, 60));
  g.descer(dedo(2, 40, 100, 200));
  assert.equal(g.subir(dedo(2, 40, 100, 260)), null);
});

test('no centro, dois toques são dois play/pause — e não um pulo', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  assert.deepEqual(g.subir(dedo(1, 180, 100, 60)), { acao: 'alternarPlay' });
  assert.equal(g.descer(dedo(2, 182, 102, 200)), null, 'o centro não pula');
  assert.deepEqual(g.subir(dedo(2, 182, 102, 260)), { acao: 'alternarPlay' },
    'o segundo toque desfaz o primeiro, que é o que se espera');
});

test('dois toques devagar, ou longe um do outro, são dois toques', () => {
  const devagar = gestosDe();
  devagar.descer(dedo(1, 40, 100, 0));
  devagar.subir(dedo(1, 40, 100, 60));
  assert.equal(devagar.descer(dedo(2, 40, 100, 0 + AppPlayerCore.TOQUE_DUPLO_MS + 1)), null);

  const longe = gestosDe();
  longe.descer(dedo(1, 20, 100, 0));
  longe.subir(dedo(1, 20, 100, 60));
  assert.equal(longe.descer(dedo(2, 20 + AppPlayerCore.TOQUE_DUPLO_PX + 1, 100, 150)), null);
});

/* Como no YouTube: quem quer 15 s dá três toques, não espera e recomeça. */
test('o terceiro toque continua pulando', () => {
  const g = gestosDe();
  g.descer(dedo(1, 40, 100, 0));
  g.subir(dedo(1, 40, 100, 60));
  assert.deepEqual(g.descer(dedo(2, 40, 100, 200)), { acao: 'pular', segundos: -5 });
  g.subir(dedo(2, 40, 100, 260));
  assert.deepEqual(g.descer(dedo(3, 40, 100, 400)), { acao: 'pular', segundos: -5 });
});

/* Nas laterais, um toque sozinho não faz NADA de propósito: elas são a área
 * do toque duplo. Um play/pause que dispara e é desfeito 200 ms depois pisca
 * a tela inteira a cada pulo de 5 s — e o botão de play está a 44 px dali. */
test('toque simples: play/pause só no centro', () => {
  const meio = gestosDe();
  meio.descer(dedo(1, 180, 100, 0));
  assert.deepEqual(meio.subir(dedo(1, 180, 100, 60)), { acao: 'alternarPlay' });

  const lado = gestosDe();
  assert.equal(lado.descer(dedo(1, 40, 100, 0)), null);
  assert.equal(lado.subir(dedo(1, 40, 100, 60)), null);
});

/* ------------------------------------------------------------------ mouse */

test('com o mouse, clique em qualquer lugar do quadro é play/pause', () => {
  for (const x of [40, 180, 340]) {
    const g = gestosDe();
    g.descer(dedo(1, x, 100, 0, 'mouse'));
    assert.deepEqual(g.subir(dedo(1, x, 100, 60, 'mouse')), { acao: 'alternarPlay' },
      'x = ' + x);
  }
});

test('arrastar com o mouse e soltar não é clique', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 100, 0, 'mouse'));
  assert.equal(g.mover(dedo(1, 260, 100, 90, 'mouse')), null,
    'o mouse não arrasta o quadro — a barra está a 20 px dali');
  assert.equal(g.subir(dedo(1, 260, 100, 120, 'mouse')), null);
});

/* O toque duplo do DEDO é ±5 s; o do mouse é tela cheia (04/09, a pedido).
 * Até então o mouse não tinha duplo nenhum — o comentário do player-core dizia
 * que duplo clique não estava entre os 29 itens da matriz, o que era verdade e
 * deixou de ser razão no dia em que foi pedido. */
test('dois cliques rápidos com o mouse são tela cheia', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  assert.deepEqual(g.subir(dedo(1, 180, 100, 60, 'mouse')), { acao: 'alternarPlay' },
    'o primeiro clique continua dando play/pause na hora, sem esperar o segundo');
  assert.deepEqual(g.descer(dedo(2, 180, 100, 200, 'mouse')),
    { acao: 'telaCheiaNoDuploClique' });
});

/* O vídeo tem que ficar COMO ESTAVA, e quem garante isso é a AÇÃO, não um
 * segundo evento: `telaCheiaNoDuploClique` desfaz o play/pause do primeiro
 * clique e alterna a tela, tudo no `pointerdown` do segundo. O ponteiro sai
 * consumido, e o `subir` que vem depois não faz mais nada.
 *
 * ISTO JÁ FOI ERRADO E O SITE NO AR MOSTROU (04/09): antes, quem desfazia era
 * o `subir` do segundo clique — duas alternâncias, saldo zero no papel. Só que
 * entrar em tela cheia remexe a página e um `pointercancel` engole o
 * `pointerup`; sobrava UMA alternância, e a tela cheia entrava com o vídeo
 * pausado. */
test('o duplo clique não mexe no play, e não depende do pointerup para isso', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  assert.deepEqual(g.subir(dedo(1, 180, 100, 60, 'mouse')), { acao: 'alternarPlay' });
  assert.deepEqual(g.descer(dedo(2, 180, 100, 200, 'mouse')),
    { acao: 'telaCheiaNoDuploClique' });
  assert.equal(g.subir(dedo(2, 180, 100, 240, 'mouse')), null,
    'o segundo clique já foi consumido: alternar de novo aqui dobraria o efeito');
});

/* A prova de que o defeito não pode voltar: com o ponteiro CANCELADO entre o
 * segundo `pointerdown` e o `pointerup` — que é exatamente o que a entrada em
 * tela cheia faz —, nada se perde, porque não havia nada pendente. */
test('tela cheia que cancela o ponteiro não deixa o vídeo trocado', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  g.subir(dedo(1, 180, 100, 60, 'mouse'));
  assert.deepEqual(g.descer(dedo(2, 180, 100, 200, 'mouse')),
    { acao: 'telaCheiaNoDuploClique' });
  assert.equal(g.cancelar(), null, 'o cancelamento não pode ter sobra para entregar');
  assert.equal(g.subir(dedo(2, 180, 100, 260, 'mouse')), null);
});

/* E o desfazer mora no player.js, no MESMO `alternarPlay` de sempre: a REGRA 1
 * tem um dono só para o `play()`, e há teste contando as chamadas. */
test('o duplo clique desfaz o play pelo caminho de sempre, e não por um novo', () => {
  const gesto = PLAYER_CODIGO.match(/function aoGesto\(acao\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(gesto, 'não achei aoGesto em player.js');
  const caso = gesto[1].match(/case 'telaCheiaNoDuploClique':([\s\S]*?)break;/);
  assert.ok(caso, 'não achei o caso do duplo clique em aoGesto');
  assert.match(caso[1], /alternarPlay\(\)/, 'sem isto o duplo clique troca o estado do vídeo');
  assert.match(caso[1], /telaCheia\(\)/);
  assert.ok(!/\.play\s*\(/.test(caso[1]), 'o duplo clique virou um segundo caminho para o play()');
});

/* O par se fecha no segundo clique, como o `dblclick` do navegador: o terceiro
 * começa outro duplo em vez de desmaximizar sozinho. Sem isto, uma mão que
 * clica três vezes entra e sai da tela cheia no mesmo gesto. */
test('o terceiro clique seguido não desmaximiza sozinho', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  g.subir(dedo(1, 180, 100, 40, 'mouse'));
  g.descer(dedo(2, 180, 100, 150, 'mouse'));
  g.subir(dedo(2, 180, 100, 190, 'mouse'));
  assert.equal(g.descer(dedo(3, 180, 100, 300, 'mouse')), null);
});

/* A janela é a MESMA do dedo, e não foi alargada para o ponteiro de propósito:
 * com o mesmo clique dando play/pause, uma janela larga transformaria "pausei
 * e voltei a tocar logo em seguida" em tela cheia sem querer. */
test('clique lento, ou longe, não é duplo clique', () => {
  const lento = gestosDe();
  lento.descer(dedo(1, 180, 100, 0, 'mouse'));
  lento.subir(dedo(1, 180, 100, 60, 'mouse'));
  assert.equal(lento.descer(dedo(2, 180, 100, AppPlayerCore.TOQUE_DUPLO_MS + 1, 'mouse')), null,
    'passou da janela: são dois cliques, não um gesto');

  const longe = gestosDe();
  longe.descer(dedo(1, 100, 100, 0, 'mouse'));
  longe.subir(dedo(1, 100, 100, 60, 'mouse'));
  assert.equal(longe.descer(dedo(2, 100 + AppPlayerCore.TOQUE_DUPLO_PX + 1, 100, 200, 'mouse')), null);
});

/* Em tela cheia o cadeado existe também no computador, e destravar é o único
 * gesto que a tela bloqueada aceita. Antes de hoje, com o mouse, não havia
 * nenhum: só o Esc tirava de lá. */
test('com a tela travada, o duplo clique destrava em vez de maximizar', () => {
  const g = gestosDe();
  g.travar(true);
  g.descer(dedo(1, 180, 100, 0, 'mouse'));
  g.subir(dedo(1, 180, 100, 40, 'mouse'));
  assert.deepEqual(g.descer(dedo(2, 180, 100, 200, 'mouse')), { acao: 'destravar' });
});

/* E o dedo não mudou: nas laterais continua sendo ±5 s, não tela cheia. */
test('o toque duplo do dedo continua sendo o pulo de 5 s', () => {
  const g = gestosDe();
  g.descer(dedo(1, 40, 100, 0));
  g.subir(dedo(1, 40, 100, 60));
  assert.deepEqual(g.descer(dedo(2, 40, 100, 200)),
    { acao: 'pular', segundos: -AppPlayerCore.PULO_TOQUE_S });
});

/* -------------------------------------------- item 3 — pressionar e segurar */

test('meio segundo com o dedo parado liga o 2×; soltar devolve', () => {
  assert.equal(AppPlayerCore.SEGURAR_MS, 500);
  assert.equal(AppPlayerCore.VELOCIDADE_SEGURAR, 2);

  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  assert.deepEqual(g.aoSegurar(), { acao: 'velocidadeTemporaria', ligada: true });
  assert.equal(g.estado().segurando, true);
  /* E o soltar devolve a velocidade em vez de dar play/pause: quem segurou
   * meio segundo não pediu para pausar. */
  assert.deepEqual(g.subir(dedo(1, 180, 100, 900)),
    { acao: 'velocidadeTemporaria', ligada: false });
});

test('dedo que andou não é segurar — era um arrasto começando devagar', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  g.mover(dedo(1, 180 + AppPlayerCore.MOVER_MIN_PX + 5, 100, 60));
  assert.equal(g.aoSegurar(), null);
});

test('o mouse não segura, e a tela travada também não', () => {
  const rato = gestosDe();
  rato.descer(dedo(1, 180, 100, 0, 'mouse'));
  assert.equal(rato.aoSegurar(), null);

  const preso = gestosDe();
  preso.travar(true);
  preso.descer(dedo(1, 180, 100, 0));
  assert.equal(preso.aoSegurar(), null);
});

/* O navegador toma o gesto para si o tempo todo — a rolagem da página, o
 * "voltar" da borda, uma chamada entrando. Sem devolver a velocidade aqui, o
 * vídeo ficaria em 2× para sempre, sem nenhum dedo na tela para soltar. */
test('o cancelamento do navegador devolve a velocidade', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  g.aoSegurar();
  assert.deepEqual(g.cancelar(), { acao: 'velocidadeTemporaria', ligada: false });
  assert.deepEqual(g.estado().dedos, 0);
});

/* ------------------------------------------ item 11 — a linha do tempo */

test('o arrasto começa valendo zero, depois dos 10 px de zona morta', () => {
  assert.equal(AppPlayerCore.ARRASTO_TEMPO_S, 120);
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));

  /* Antes do limiar, nada. É o que impede o vídeo de saltar no primeiro pixel
   * de tremor da mão. */
  assert.equal(g.mover(dedo(1, 185, 101, 30)), null);

  assert.deepEqual(g.mover(dedo(1, 195, 101, 60)),
    { acao: 'arrastar', alvo: 'tempo', fase: 'inicio', valor: 0 },
    'a origem do arrasto é onde o limiar foi vencido, não onde o dedo desceu');
});

/* A ACELERAÇÃO, pedida em 03/09 depois do primeiro teste no dedo.
 *
 * O ganho é a velocidade do pedaço dividida pela de referência, aparado nas
 * duas pontas. Sem os limites, um dedo quase parado não andaria nada e um
 * espasmo de pulso jogaria o vídeo para o fim. */
test('o ganho do arrasto é a velocidade, e ele tem piso e teto', () => {
  assert.equal(AppPlayerCore.VELOCIDADE_REF_PX_MS, 1);
  assert.equal(AppPlayerCore.GANHO_ARRASTO_MIN, 0.25);
  assert.equal(AppPlayerCore.GANHO_ARRASTO_MAX, 6);

  assert.equal(AppPlayerCore.ganhoDoArrasto(10, 10), 1, '1 px/ms é o ritmo de referência');
  assert.equal(AppPlayerCore.ganhoDoArrasto(30, 10), 3);
  assert.equal(AppPlayerCore.ganhoDoArrasto(1, 100), AppPlayerCore.GANHO_ARRASTO_MIN, 'dedo quase parado');
  assert.equal(AppPlayerCore.ganhoDoArrasto(1000, 10), AppPlayerCore.GANHO_ARRASTO_MAX, 'arranco');
  assert.equal(AppPlayerCore.ganhoDoArrasto(-30, 10), 3, 'a direção não muda o ganho');

  /* Dois eventos no mesmo milissegundo dariam velocidade infinita. */
  assert.equal(AppPlayerCore.ganhoDoArrasto(50, 0), AppPlayerCore.GANHO_ARRASTO_MAX);
  assert.equal(AppPlayerCore.ganhoDoArrasto(0, 0), AppPlayerCore.GANHO_ARRASTO_MIN);
});

/* Um arrasto de velocidade constante, em passos iguais: vence o limiar e
 * depois anda `px` em `ms`. É a forma de cobrar o gesto inteiro, e não a
 * função solta — a soma dos pedaços é o que a pessoa sente. */
const arrastarHorizontal = (px, ms, x0) => {
  const g = gestosDe();
  const inicio = x0 == null ? 180 : x0;
  g.descer(dedo(1, inicio, 60, 0));
  g.mover(dedo(1, inicio + 15, 60, 10));   /* vence os 10 px; a origem passa a ser aqui */
  let r = null;
  for (let i = 1; i <= 8; i++) {
    r = g.mover(dedo(1, inicio + 15 + px * i / 8, 60, 10 + ms * i / 8));
  }
  return r.valor;
};

test('a MESMA distância vale tempos diferentes conforme a pressa da mão', () => {
  /* 150 px de 375 = 40% da largura = os 48 s de sempre, no ritmo de
   * referência. É o tato da versão de 03/09, preservado no meio da escala. */
  assert.equal(arrastarHorizontal(150, 150), 48);

  /* Devagar: quatro vezes mais fino, para achar a frase que passou. */
  assert.equal(arrastarHorizontal(150, 3000), 12);

  /* Arranco: cinco vezes mais longe, para atravessar o vídeo. */
  assert.equal(arrastarHorizontal(150, 30), 240);

  /* E nem o arranco mais violento passa do teto de 6×. */
  assert.equal(arrastarHorizontal(150, 5), 288);
});

test('para trás é negativo, e o arrasto horizontal vale fora da tela cheia', () => {
  assert.equal(arrastarHorizontal(-150, 150, 300), -48);
});

/* O TETO SAI DO TAMANHO DO VÍDEO (pedido em 03/09).
 *
 * "Seis vezes" não quer dizer a mesma coisa num vídeo de dois minutos e num de
 * uma hora: no curto, um arranco atravessava o título inteiro; no longo, mal
 * saía do lugar. A regra passou a ser uma só — um arranco de ponta a ponta do
 * quadro anda no máximo esta fração do vídeo. */
test('um arranco anda no máximo a fração escolhida do vídeo', () => {
  /* Os dois exemplos que motivaram o pedido, na conta que o player faz: o
   * arranco máximo é `teto × ARRASTO_TEMPO_S`, porque o teto é o ganho de uma
   * travessia completa do quadro. */
  const arrancoMaximo = (duracao, fracao) =>
    Math.round(AppPlayerCore.tetoDoGanho(duracao, fracao) * AppPlayerCore.ARRASTO_TEMPO_S);

  assert.equal(arrancoMaximo(3600, 1 / 3), 1200, 'uma hora a 1/3 são 20 minutos');
  assert.equal(arrancoMaximo(120, 1 / 2), 60, 'dois minutos a 1/2 é um minuto');

  /* E o padrão de 0,4 dá a mesma fração em qualquer duração — é o que faz o
   * gesto ter o mesmo significado no título de 2:50 e no de 27 minutos. */
  assert.equal(AppPlayerCore.FRACAO_TETO_PADRAO, 0.4);
  for (const d of [170, 1152, 1620, 3600]) {
    assert.equal(Math.round(arrancoMaximo(d) / d * 100), 40, 'duração ' + d);
  }
});

test('o teto nunca cai abaixo do piso, nem sobe sem duração conhecida', () => {
  /* Vídeo curtíssimo: sem esta trava o teto ficaria abaixo do ganho mínimo e
   * congelaria o arrasto inteiro, inclusive o lento. */
  assert.equal(AppPlayerCore.tetoDoGanho(10, 0.4), AppPlayerCore.GANHO_ARRASTO_MIN);
  /* Sem duração vale o teto fixo de antes de 03/09. */
  for (const d of [0, -1, NaN, undefined, 'x']) {
    assert.equal(AppPlayerCore.tetoDoGanho(d, 0.4), AppPlayerCore.GANHO_ARRASTO_MAX, 'duração ' + d);
  }
});

test('a fração vinda do /admin é aparada, nunca aceita crua', () => {
  assert.equal(AppPlayerCore.fracaoDoTeto(undefined), AppPlayerCore.FRACAO_TETO_PADRAO);
  assert.equal(AppPlayerCore.fracaoDoTeto(null), AppPlayerCore.FRACAO_TETO_PADRAO);
  assert.equal(AppPlayerCore.fracaoDoTeto('meio'), AppPlayerCore.FRACAO_TETO_PADRAO);
  assert.equal(AppPlayerCore.fracaoDoTeto(0), AppPlayerCore.FRACAO_TETO_PADRAO, 'zero congelaria o gesto');
  assert.equal(AppPlayerCore.fracaoDoTeto(-1), AppPlayerCore.FRACAO_TETO_PADRAO);
  assert.equal(AppPlayerCore.fracaoDoTeto(0.001), AppPlayerCore.FRACAO_TETO_MIN);
  assert.equal(AppPlayerCore.fracaoDoTeto(9), AppPlayerCore.FRACAO_TETO_MAX,
    'acima de 100% um arranco atravessaria o vídeo inteiro');
  assert.equal(AppPlayerCore.fracaoDoTeto(0.5), 0.5, 'o que está na faixa passa intacto');
});

/* O gesto inteiro, com a duração na mão: num título curto o teto fica ABAIXO
 * do ganho de referência, e é o certo — uma travessia do quadro no ritmo
 * normal já valeria 120 s, quase o vídeo todo. */
test('num vídeo curto o arranco é contido; num longo, generoso', () => {
  /* Um arranco atravessando o quadro inteiro (375 px) em 40 ms — quase
   * 10 px/ms, bem acima de qualquer teto. Começa em 40 px e não em 20: os
   * 24 px da borda são do "voltar" do navegador e matariam o arrasto. */
  const arrancoDePontaAPonta = (duracao) => {
    const g = AppPlayerCore.criarGestos();
    g.medir({ largura: 375, altura: 211, duracao: duracao });
    g.descer(dedo(1, 40, 60, 0));
    g.mover(dedo(1, 55, 60, 5));
    let r = null;
    for (let i = 1; i <= 8; i++) r = g.mover(dedo(1, 55 + 375 * i / 8, 60, 5 + 40 * i / 8));
    return r.valor;
  };
  assert.equal(arrancoDePontaAPonta(170), 68,
    'no Férias Exemplo (2:50), 40% são 68 s');
  assert.equal(arrancoDePontaAPonta(1152), 460.8,
    'no Pescador (19:12), 40% são 7:41');
});

/* CANCELAR SEM SOLTAR O DEDO (pedido em 03/09).
 *
 * A aceleração cobra um preço — o arrasto depende do caminho, e ir rápido e
 * voltar devagar não devolve o vídeo ao ponto de partida. Jogar o dedo para
 * baixo é a porta de saída, e ela vale COM O DEDO AINDA NA TELA: soltar já
 * confirma. */
test('jogar o dedo para baixo desfaz o arrasto na hora', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 40, 0));
  g.mover(dedo(1, 115, 40, 10));
  const andou = g.mover(dedo(1, 250, 42, 150));
  assert.ok(andou.valor > 10, 'o arrasto tem que ter andado antes de ser desfeito');

  /* Ainda dentro do limiar: só o aviso, o arrasto continua valendo. */
  const limiar = AppPlayerCore.limiarDeCancelar(211);
  const quase = g.mover(dedo(1, 250, 40 + limiar * 0.6, 200));
  assert.equal(quase.fase, 'mover');
  assert.equal(quase.descarte, 0.6, 'a tela precisa saber que o cancelamento está perto');

  /* Atravessou: acaba aqui, sem esperar o dedo sair. */
  const fim = g.mover(dedo(1, 250, 40 + limiar + 1, 260));
  assert.deepEqual(fim,
    { acao: 'arrastar', alvo: 'tempo', fase: 'fim', valor: 0, cancelado: true },
    'valor 0 é o que devolve o vídeo para onde o movimento começou');

  /* E o resto do gesto é inerte: nem continua arrastando, nem vira play/pause
   * ao soltar. */
  assert.equal(g.mover(dedo(1, 300, 300, 320)), null);
  assert.equal(g.subir(dedo(1, 300, 300, 400)), null);
});

test('o limiar de cancelar acompanha a altura do quadro, com piso em px', () => {
  assert.equal(AppPlayerCore.CANCELAR_MIN_PX, 56);
  assert.equal(Math.round(AppPlayerCore.limiarDeCancelar(195)), 66, 'quadro embutido');
  assert.equal(Math.round(AppPlayerCore.limiarDeCancelar(375)), 128, 'tela cheia deitada');
  assert.equal(AppPlayerCore.limiarDeCancelar(100), 56, 'num quadro baixinho vale o piso');
  assert.equal(AppPlayerCore.limiarDeCancelar(0), 56, 'sem medida, o piso');
});

/* Descer o dedo um pouco é coisa de quem arrasta na horizontal com o polegar.
 * Se isso cancelasse, o gesto principal ficaria impossível. */
test('a mão trêmula não cancela o arrasto', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 40, 0));
  g.mover(dedo(1, 115, 40, 10));
  for (let i = 1; i <= 6; i++) {
    const r = g.mover(dedo(1, 115 + 20 * i, 40 + i * 4, 10 + i * 20));
    assert.equal(r.fase, 'mover', 'passo ' + i + ' não podia cancelar');
  }
});

/* Só o arrasto de TEMPO tem cancelamento. No volume e no brilho descer o dedo
 * É o gesto — cancelar ali seria desligar o próprio controle. */
test('descer o dedo no arrasto de volume não cancela nada: é o gesto', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 750, 40, 0));
  g.mover(dedo(1, 750, 60, 20));
  const r = g.mover(dedo(1, 750, 340, 200));
  assert.equal(r.alvo, 'volume');
  assert.equal(r.fase, 'mover');
  assert.ok(r.valor < 0, 'descer abaixa o volume, como sempre');
});

/* O volume e o brilho NÃO são acelerados, e é de propósito: ali a régua fixa é
 * a qualidade, não o defeito. A altura toda percorre a faixa toda, sempre — um
 * volume que dependesse da pressa da mão seria uma armadilha. */
test('o deslizar vertical não tem aceleração — a altura toda é a faixa toda', () => {
  const medir = (ms) => {
    const g = gestosDe(QUADRO_CHEIO);
    g.permitirVertical(true);
    g.descer(dedo(1, 750, 300, 0));
    g.mover(dedo(1, 750, 280, 10));
    let r = null;
    for (let i = 1; i <= 8; i++) r = g.mover(dedo(1, 750, 280 - 187.5 * i / 8, 10 + ms * i / 8));
    return r.valor;
  };
  assert.equal(medir(2000), 0.5, 'devagar');
  assert.equal(medir(40), 0.5, 'depressa — o mesmo meio caminho, o mesmo 50%');
});

/* --------------------------------------- itens 10a e 10b — o deslizar ↕ */

/* Fora da tela cheia o quadro ocupa 211 px de uma tela de 812 e a ficha
 * continua embaixo: roubar o arrasto vertical ali entrega uma página que não
 * rola quando o polegar cai no vídeo. Trocar a rolagem da página pelo brilho
 * da imagem seria um péssimo negócio. */
test('fora da tela cheia não existe arrasto vertical — a página rola', () => {
  const g = gestosDe();
  g.descer(dedo(1, 40, 150, 0));
  assert.equal(g.mover(dedo(1, 40, 100, 60)), null);
  assert.equal(g.estado().eixo, 'morto');
});

/* O BRILHO SAIU em 09/09/2026, e este teste é o que sobrou daquele — ele
 * cobrava "à esquerda o brilho, à direita o volume" e agora cobra que a
 * esquerda esteja MORTA.
 *
 * A razão da saída não foi espaço, foi honestidade: `filter: brightness()`
 * mexe na IMAGEM, e o controle se anunciava como brilho de tela — que
 * navegador nenhum alcança. Um controle que promete o que não entrega é pior
 * do que não ter.
 *
 * A zona esquerda fica RESERVADA, não livre: é onde entram os dois gestos da
 * fase 7 (arrastar ↑ e ↓). Enquanto eles não existirem, `morto` é a resposta
 * certa — um arrasto que não faz nada é melhor do que um que faz a coisa
 * errada, e é assim que o centro sempre se comportou. */
/* O BRILHO SAIU em 09/09/2026, e este teste é o que sobrou daquele — ele
 * cobrava "à esquerda o brilho, à direita o volume".
 *
 * A esquerda não ficou morta: virou o DESLIZE da fase 7, junto com o centro.
 * São 70% da largura para um gesto e 30% para o outro, e a diferença é
 * deliberada — o volume tem o painel e as setas do teclado como outros
 * caminhos, o deslize não tem nenhum. */
test('em tela cheia: à direita o volume, no resto o deslize', () => {
  const dir = gestosDe(QUADRO_CHEIO);
  dir.permitirVertical(true);
  dir.descer(dedo(1, 750, 300, 0));
  assert.deepEqual(dir.mover(dedo(1, 750, 280, 40)),
    { acao: 'arrastar', alvo: 'volume', fase: 'inicio', valor: 0 });
  /* Metade da altura × a faixa de 1 do volume = 0,5, ou 50 pontos. */
  assert.deepEqual(dir.mover(dedo(1, 750, 92.5, 200)),
    { acao: 'arrastar', alvo: 'volume', fase: 'mover', valor: 0.5 });

  for (const [zona, x] of [['esquerda', 60], ['centro', 400]]) {
    const g = gestosDe(QUADRO_CHEIO);
    g.permitirVertical(true);
    g.descer(dedo(1, x, 300, 0));
    const inicio = g.mover(dedo(1, x, 320, 40));
    assert.equal(inicio.acao, 'deslize', zona + ' precisa abrir o deslize');
    assert.equal(g.estado().deslize, true);
    assert.equal(g.estado().arrasto, null, zona + ' não pode virar volume');
  }
});

/* O `filter: brightness()` era a única coisa que obrigava o navegador a compor
 * o vídeo numa camada própria fora do zoom. Ele tem que ter sumido do CSS
 * junto com o gesto — regra órfã não dá erro, só fica lá esperando alguém
 * reintroduzir a classe e achar que funciona de novo. */
test('o filtro de brilho saiu do CSS junto com o gesto', () => {
  /* Os comentários TÊM que sair antes da busca, e não é zelo: o comentário
   * que registra a remoção cita a regra removida por extenso, para quem vier
   * depois saber o que existia. Procurar no arquivo cru acharia a citação e
   * daria o teste por reprovado — que é a mesma armadilha do `semear` no
   * teste do framerate.mjs: um teste que reprova a EXPLICAÇÃO da remoção. */
  const css = lerTexto(path.join(SITE, 'style.css'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /\.pl-brilho\s+\.pl-video/,
    'a regra do brilho continua no CSS — o gesto saiu e ela ficou órfã');
  assert.doesNotMatch(PLAYER_CODIGO, /classList\.toggle\(\s*'pl-brilho'/,
    'o player.js ainda liga a classe do brilho');
  assert.equal(AppPlayerCore.proximoBrilho, undefined,
    'o player-core ainda exporta proximoBrilho — o item 10a não existe mais');
});

test('para cima é MAIS: o eixo da tela cresce para baixo, o volume não', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 750, 100, 0));
  g.mover(dedo(1, 750, 120, 40));
  const desceu = g.mover(dedo(1, 750, 307.5, 200));
  assert.equal(desceu.valor, -0.5, 'descer o dedo abaixa o volume');
});

/* O centro não tem arrasto VERTICAL de valor — nada ali segue o dedo ponto a
 * ponto. Ele é do arrasto horizontal, do play/pause e, desde 09/09, do
 * deslize da fase 7, que é discreto: decide no fim, não no caminho. */
test('no centro não existe arrasto de valor — o vertical ali é o deslize', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 400, 300, 0));
  const a = g.mover(dedo(1, 400, 200, 60));
  assert.equal(a.acao, 'deslize');
  assert.equal(g.estado().arrasto, null, 'nada no centro pode virar arrasto de valor');
});

/* ------------- os dois deslizes da fase 7 (itens 4 e 5, 09/09) ----------- */

/* A ORIENTAÇÃO é o desempate, e sai das medidas que já existem — `largura >
 * altura` —, não de `screen.orientation`. Em tela cheia o quadro É a tela, e é
 * a geometria que decide se ainda há tela a ganhar. */
test('a orientação decide qual dos dois deslizes existe', () => {
  const emPe = QUADRO_CHEIO_EM_PE, deitado = QUADRO_CHEIO;
  assert.equal(AppPlayerCore.alvoDoDeslize(-100, emPe), 'deitar', 'em pé, ↑ deita a imagem');
  assert.equal(AppPlayerCore.alvoDoDeslize(100, emPe), null, 'em pé, ↓ não fecha nada');
  assert.equal(AppPlayerCore.alvoDoDeslize(100, deitado), 'fechar', 'deitado, ↓ fecha');
  assert.equal(AppPlayerCore.alvoDoDeslize(-100, deitado), null, 'deitado, ↑ não tem tela a ganhar');
  /* Sem medida não há orientação, e inventar uma fecharia players por engano. */
  assert.equal(AppPlayerCore.alvoDoDeslize(100, { largura: 0, altura: 0 }), null);
});

/* O limiar é fração da altura com piso em px: em tela cheia deitada a altura é
 * menos da metade da de pé, e uma distância fixa seria fácil demais num modo e
 * exaustiva no outro. */
test('o limiar do deslize acompanha a altura, e tem piso', () => {
  assert.equal(AppPlayerCore.limiarDeDeslize(812), 203);
  assert.equal(AppPlayerCore.limiarDeDeslize(375), 93.75);
  /* O piso só assume abaixo de 256 px — janela pequena de computador, nunca
   * telefone. Sem ele, fechar o player viraria um gesto de dez pixels. */
  assert.equal(AppPlayerCore.limiarDeDeslize(120), AppPlayerCore.DESLIZE_MIN_PX);
  assert.equal(AppPlayerCore.limiarDeDeslize(0), AppPlayerCore.DESLIZE_MIN_PX);
  assert.equal(AppPlayerCore.limiarDeDeslize(NaN), AppPlayerCore.DESLIZE_MIN_PX);
});

test('deitado, o deslize ↓ completo fecha o player', () => {
  const g = gestosDe(QUADRO_CHEIO);           /* 812 × 375 → limiar 93,75 */
  g.permitirVertical(true);
  g.descer(dedo(1, 200, 100, 0));
  const meio = g.mover(dedo(1, 200, 150, 40));
  assert.equal(meio.alvo, 'fechar');
  assert.equal(meio.feito, false, 'no meio do caminho NADA pode acontecer');
  assert.equal(meio.progresso, 0.53, '50 de 93,75');

  const fim = g.subir(dedo(1, 200, 250, 300));   /* 150 px, acima do limiar */
  assert.deepEqual(fim, { acao: 'deslize', alvo: 'fechar', fase: 'fim', progresso: 1, feito: true });
});

test('em pé, o deslize ↑ completo deita a imagem', () => {
  const g = gestosDe(QUADRO_CHEIO_EM_PE);    /* 375 × 812 → limiar 203 */
  g.permitirVertical(true);
  g.descer(dedo(1, 100, 600, 0));
  assert.equal(g.mover(dedo(1, 100, 560, 40)).alvo, 'deitar');
  const fim = g.subir(dedo(1, 100, 350, 300));   /* 250 px para cima */
  assert.equal(fim.feito, true);
  assert.equal(fim.alvo, 'deitar');
});

/* Curto demais NÃO faz nada, e é o que deixa desistir no meio: o dedo volta e
 * o gesto morre. Vale principalmente para o `fechar`, que é destrutivo. */
test('o deslize curto não faz nada — dá para desistir no meio', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 200, 100, 0));
  g.mover(dedo(1, 200, 170, 40));
  const fim = g.subir(dedo(1, 200, 130, 300));   /* voltou: só 30 px */
  assert.equal(fim.feito, false, 'faltou distância — não pode fechar');
  assert.ok(fim.progresso < 1);
});

/* A direção errada devolve ação, com alvo nulo e progresso zero. NÃO devolve
 * `null`: quem executa precisa saber que o gesto acabou para tirar o aviso da
 * tela, senão o selo fica pendurado. */
test('a direção sem função devolve o fim, para a tela poder se limpar', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 200, 300, 0));
  g.mover(dedo(1, 200, 200, 40));
  const fim = g.subir(dedo(1, 200, 60, 300));    /* ↑ deitado: não faz nada */
  assert.deepEqual(fim, { acao: 'deslize', alvo: null, fase: 'fim', progresso: 0, feito: false });
});

/* Fora da tela cheia o vertical é do NAVEGADOR — a página rola com o dedo no
 * vídeo. O deslize não pode existir ali, nem em pé nem deitado. */
test('fora da tela cheia não há deslize nenhum', () => {
  const g = gestosDe(QUADRO_TELEFONE);
  g.descer(dedo(1, 100, 150, 0));
  assert.equal(g.mover(dedo(1, 100, 40, 60)), null);
  assert.equal(g.estado().eixo, 'morto');
  assert.equal(g.estado().deslize, false);
});

/* Um segundo dedo é o começo de OUTRO gesto — pinça ou capítulo. Fechar o
 * player no meio dele seria o pior desfecho possível: destrutivo e não pedido. */
test('um segundo dedo mata o deslize sem executá-lo', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 200, 100, 0));
  g.mover(dedo(1, 200, 260, 40));            /* 160 px: já passou do limiar */
  const morte = g.descer(dedo(2, 400, 120, 60));
  assert.equal(morte.acao, 'deslize');
  assert.equal(morte.feito, false, 'a distância bastava, e mesmo assim não pode fechar');
  assert.equal(g.estado().deslize, false);
});

/* Com a tela BLOQUEADA (item 9) nada responde ao dedo — é o ponto inteiro do
 * cadeado, e fechar o player seria o pior a escapar dele. */
test('a tela bloqueada não deixa o deslize começar', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.travar(true);
  g.descer(dedo(1, 200, 100, 0));
  assert.equal(g.mover(dedo(1, 200, 260, 40)), null);
  assert.equal(g.estado().deslize, false);
});

/* `screen.orientation.lock()` REJEITA por motivos normais — o navegador não
 * permitir, a tela cheia ter acabado no meio. Rejeitar não é erro, e sem o
 * `catch` a página registra exceção não tratada por uma coisa que só não
 * aconteceu. E `lock` não existe no iOS, o que precisa ser CHECADO antes de
 * chamar: lá o acesso direto lançaria. */
test('o deitar trata a ausência e a recusa do lock — no iOS ele nem existe', () => {
  const corpo = PLAYER_CODIGO.match(/function deitarImagem\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei deitarImagem em player.js');
  assert.match(corpo[1], /typeof o\.lock !== 'function'/,
    'precisa checar se o lock existe: no iOS ele não existe');
  assert.match(corpo[1], /\.catch\(/, 'a promessa do lock rejeita, e rejeitar é normal');
  assert.match(corpo[1], /try\s*\{/, 'o lock também lança de forma síncrona em alguns navegadores');
});

/* A ORDEM importa: sair da tela cheia ANTES de redesenhar. Destruir o elemento
 * que está em tela cheia deixa o navegador saindo dela sozinho depois, com a
 * página já trocada embaixo — e o `fullscreenchange` do próprio player
 * disparando sobre um player que não existe mais. */
test('o fechar sai da tela cheia antes de devolver a ficha', () => {
  const corpo = PLAYER_CODIGO.match(/function fecharPlayer\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei fecharPlayer em player.js');
  const saida = corpo[1].search(/exitFullscreen/);
  const gancho = corpo[1].search(/g\.aoFechar\(\)/);
  assert.ok(saida > -1 && gancho > -1, 'os dois passos precisam existir');
  assert.ok(saida < gancho, 'a saída da tela cheia vem ANTES de redesenhar a ficha');
  assert.match(corpo[1], /typeof g\.aoFechar === 'function'/,
    'sem o gancho o gesto não faz nada — um player não se arranca do DOM alheio');
  /* ACHADO NA CONFERÊNCIA, no navegador: `exitFullscreen()` devolve uma
   * PROMESSA e ela rejeita quando o navegador acha que já não está em tela
   * cheia. Um `try/catch` sozinho pega o lançamento síncrono e deixa a
   * rejeição virar promessa não tratada, registrada no console de quem está
   * assistindo. Os dois são necessários, e é por isso que o teste cobra os
   * dois. */
  assert.match(corpo[1], /try\s*\{/, 'o exitFullscreen também lança de forma síncrona');
  assert.match(corpo[1], /pedido\.catch\(/,
    'a promessa do exitFullscreen rejeita — sem o catch vira promessa não tratada');
});

/* Quem redesenha é o app.js, e tem que ser `renderFicha` do MESMO id — não um
 * `location.hash`. Já estamos nessa rota: trocar o hash para ele não dispara
 * `hashchange`, e o gesto não faria nada. */
test('o app.js fecha o player redesenhando a ficha, não trocando o hash', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const gancho = app.match(/aoFechar: function \(\) \{([^}]*)\}/);
  assert.ok(gancho, 'não achei o aoFechar no app.js');
  assert.match(gancho[1], /renderFicha\(item\.id\)/);
  assert.doesNotMatch(gancho[1], /location\.hash/,
    'o hash já é este: trocá-lo não dispara hashchange e o gesto morreria em silêncio');
});

/* REGRA 1 cobrada mais uma vez, no gesto novo: fechar o player e deitar a
 * imagem não podem tocar nada. O `renderFicha` remonta a ficha com a capa, e
 * é ali que um `play()` distraído poria o vídeo tocando sem ninguém pedir. */
test('nem o deitar nem o fechar chamam play()', () => {
  for (const nome of ['deitarImagem', 'fecharPlayer', 'aplicarDeslize']) {
    const corpo = PLAYER_CODIGO.match(
      new RegExp('function ' + nome + '\\(a?\\)\\s*\\{([\\s\\S]*?)\\n    \\}'));
    assert.ok(corpo, 'não achei ' + nome + ' em player.js');
    assert.doesNotMatch(corpo[1], /\bplay\(\)/, nome + ' não pode tocar nada');
  }
});

/* A altura toda percorre 100 pontos de volume, não os 200 do reforço: quem
 * quer reforço passa pelo painel, onde ele está escrito e marcado em amarelo.
 * Um deslize distraído não pode dobrar o volume de ninguém. */
test('o deslizar não alcança o reforço sozinho', () => {
  assert.equal(AppPlayerCore.ARRASTO_VOLUME, 1);
});

/* O ímã dos 100%: com o reforço disponível, o dedo que sobe passava de
 * "normal" para "reforço" sem nada que avisasse. */
test('o arrasto segura em 100% antes de entrar no reforço', () => {
  const M = AppPlayerCore.VOLUME_MAX_GANHO;
  const I = AppPlayerCore.IMA_VOLUME;
  assert.equal(AppPlayerCore.volumeDoArrasto(0.5, 0.5, M), 1, 'chega em 100% e para');
  assert.equal(AppPlayerCore.volumeDoArrasto(0.5, 0.5 + I / 2, M), 1, 'dentro do ímã continua 100%');
  assert.equal(AppPlayerCore.volumeDoArrasto(0.5, 0.5 + I, M), 1, 'a borda do ímã ainda é 100%');
  /* Passada a faixa o reforço começa, e SEM salto: 1 + 0,05, não 1 + 0,15. */
  assert.equal(AppPlayerCore.volumeDoArrasto(0.5, 0.5 + I + 0.05, M), 1.05);
  assert.equal(AppPlayerCore.volumeDoArrasto(1, 0.05, M), 1, 'quem está em 100% não vai para 105% num toque de dedo');
  assert.equal(AppPlayerCore.volumeDoArrasto(1, I + 0.2, M), 1.2);
});

test('o ímã vale na volta: descendo do reforço, o dedo para em 100%', () => {
  const M = AppPlayerCore.VOLUME_MAX_GANHO;
  const I = AppPlayerCore.IMA_VOLUME;
  /* Partir de 150% não pode saltar: o degrau só é encontrado ao descer. */
  assert.equal(AppPlayerCore.volumeDoArrasto(1.5, 0, M), 1.5, 'sem movimento, sem salto');
  assert.equal(AppPlayerCore.volumeDoArrasto(1.5, -0.2, M), 1.3);
  assert.equal(AppPlayerCore.volumeDoArrasto(1.5, -0.5, M), 1, 'chegou em 100%');
  assert.equal(AppPlayerCore.volumeDoArrasto(1.5, -0.5 - I, M), 1, 'e segura ali');
  assert.ok(AppPlayerCore.volumeDoArrasto(1.5, -0.5 - I - 0.1, M) < 1, 'passado o ímã, abaixa');
});

test('o ímã é de um lado só: abaixo de 100% não há zona morta', () => {
  const M = AppPlayerCore.VOLUME_MAX_GANHO;
  assert.equal(AppPlayerCore.volumeDoArrasto(1, -0.01, M), 0.99, 'em 100%, descer responde no primeiro pixel');
  assert.equal(AppPlayerCore.volumeDoArrasto(0.6, -0.1, M), 0.5);
  assert.equal(AppPlayerCore.volumeDoArrasto(0.6, 0.1, M), 0.7);
  assert.equal(AppPlayerCore.volumeDoArrasto(0.1, -0.5, M), 0, 'o piso continua 0');
});

test('o ímã não muda os extremos nem o caso sem reforço', () => {
  const M = AppPlayerCore.VOLUME_MAX_GANHO;
  assert.equal(AppPlayerCore.volumeDoArrasto(1, 5, M), M, 'o teto do reforço continua 200%');
  /* Sem grafo (teto 1) é o `proximoVolume` de sempre. */
  assert.equal(AppPlayerCore.volumeDoArrasto(0.5, 0.3, 1), 0.8);
  assert.equal(AppPlayerCore.volumeDoArrasto(0.5, 0.9, 1), 1);
  assert.equal(AppPlayerCore.volumeDoArrasto(0.95, 0.03, 1), 0.98, 'sem reforço o ímã não come o caminho até 100%');
  /* Entradas tortas não viram volume torto. */
  assert.equal(AppPlayerCore.volumeDoArrasto(NaN, 0, M), 1);
  assert.equal(AppPlayerCore.volumeDoArrasto(0.5, NaN, M), 0.5);
  assert.equal(AppPlayerCore.volumeDoArrasto(1, 0.5, NaN), 1, 'teto torto vale 1');
});

/* Da ponta do dedo até o volume: o mesmo ímã, pelo gesto de verdade. */
test('o gesto de volume para em 100% e só depois entra no reforço', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.descer(dedo(1, 750, 300, 0));
  g.mover(dedo(1, 750, 280, 10));
  /* QUADRO_CHEIO tem 375 px de altura: 37,5 px é o ímã inteiro. */
  const r = g.mover(dedo(1, 750, 200, 200));
  assert.equal(r.alvo, 'volume');
  const alvo = AppPlayerCore.volumeDoArrasto(0.8, r.valor, AppPlayerCore.VOLUME_MAX_GANHO);
  assert.equal(alvo, 1, '0,8 + ~21% da altura ainda cai no ímã');
});

/* Os testes acima provam a conta do ímã; este prova que o player a USA. Com a
 * chamada do arrasto de volta no `proximoVolume`, os cinco de cima seguiriam
 * verdes e o ímã estaria fora do ar. E ele é só do gesto: as setas andam em
 * passos de 5% pelo `proximoVolume`, e a faixa do painel põe o valor dela
 * direto — nos dois o ímã seria um passo que não anda. */
test('o ímã mora só no arrasto: as setas e o painel não passam por ele', () => {
  assert.match(PLAYER_CODIGO,
    /definirVolume\(AppPlayerCore\.volumeDoArrasto\(arrastoBase\.volume, a\.valor, teto\)\)/,
    'o arrasto do volume tem que passar pelo ímã');
  assert.equal((PLAYER_CODIGO.match(/volumeDoArrasto\(/g) || []).length, 1,
    'o ímã é chamado num lugar só: o gesto');
  const setas = PLAYER_CODIGO.match(/function ajustarVolume\(passo\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(setas, 'não achei ajustarVolume em player.js');
  assert.match(setas[1], /AppPlayerCore\.proximoVolume\(som\.volume, passo, teto\)/,
    'as setas continuam em passos de 5%, sem o ímã');
});

/* O teto e o piso do brilho (0,25 e 1,75) e o `proximoBrilho` foram testados
 * aqui de 03/09 a 09/09. Saíram com o gesto — o que restou é a asserção de
 * ausência, no teste do CSS acima. */

/* --------------------------------------------- item 2 — dois dedos */

test('dois dedos que encostam e saem pulam de capítulo', () => {
  const dir = gestosDe();
  dir.descer(dedo(1, 300, 100, 0));
  dir.descer(dedo(2, 340, 120, 20));
  assert.deepEqual(dir.subir(dedo(1, 300, 100, 150)), { acao: 'capitulo', direcao: 1 });
  assert.equal(dir.subir(dedo(2, 340, 120, 160)), null, 'o segundo dedo não repete o pulo');

  const esq = gestosDe();
  esq.descer(dedo(1, 40, 100, 0));
  esq.descer(dedo(2, 80, 120, 20));
  assert.deepEqual(esq.subir(dedo(1, 40, 100, 150)), { acao: 'capitulo', direcao: -1 });
});

/* O desempate, escrito como teste: dois dedos que MUDAM a
 * distância entre si são pinça (item 7, fase 8), não toque. Sem isto, toda
 * pinça começando viraria pulo de capítulo. */
test('a pinça não vira capítulo — o desempate é a distância entre os dedos', () => {
  assert.equal(AppPlayerCore.DOIS_DEDOS_PX, 10);
  const g = gestosDe();
  g.descer(dedo(1, 150, 100, 0));
  g.descer(dedo(2, 200, 100, 20));
  g.mover(dedo(2, 200 + AppPlayerCore.DOIS_DEDOS_PX + 1, 100, 80));
  assert.equal(g.subir(dedo(1, 150, 100, 150)), null);
});

test('dois dedos demorados não são toque — 250 ms e acabou', () => {
  assert.equal(AppPlayerCore.DOIS_DEDOS_MS, 250);
  const g = gestosDe();
  g.descer(dedo(1, 300, 100, 0));
  g.descer(dedo(2, 340, 100, 20));
  assert.equal(g.subir(dedo(1, 300, 100, 20 + AppPlayerCore.DOIS_DEDOS_MS + 1)), null);
});

/* O segundo dedo chegando no meio de um arrasto: o gesto de um dedo acaba
 * ali, e quem está executando precisa saber para desfazer o que está na tela
 * — o selo do volume, a linha do tempo em movimento. */
test('o segundo dedo encerra o arrasto do primeiro', () => {
  const g = gestosDe();
  g.descer(dedo(1, 180, 100, 0));
  g.mover(dedo(1, 200, 100, 40));
  g.mover(dedo(1, 260, 100, 90));
  const fim = g.descer(dedo(2, 100, 100, 120));
  assert.equal(fim.acao, 'arrastar');
  assert.equal(fim.fase, 'fim');
  assert.equal(g.estado().arrasto, null);
});

/* Achado no navegador, em 03/09, e o estrago é grande: um `pointerup` que se
 * perde deixa um dedo na lista para sempre, e a partir dali TODO toque vira
 * "dois dedos". O player para de responder ao dedo e só volta quando alguém
 * sai da ficha — sem erro no console, sem nada na tela. */
test('um dedo que nunca subiu não pode matar os gestos seguintes', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 100, 0));      /* e o pointerup se perde no caminho */

  /* Cinco segundos depois, um toque novo. Sem a limpeza, este seria o segundo
   * dedo de um gesto de dois. */
  g.descer(dedo(2, 180, 100, 6000));
  assert.equal(g.estado().dedos, 1, 'o fantasma tinha que ter saído da lista');
  assert.deepEqual(g.subir(dedo(2, 180, 100, 6060)), { acao: 'alternarPlay' });

  /* Perto no tempo, os dois dedos continuam valendo como dois dedos: a
   * limpeza não pode comer o gesto do item 2. */
  const dois = gestosDe();
  dois.descer(dedo(1, 300, 100, 0));
  dois.descer(dedo(2, 340, 100, 20));
  assert.equal(dois.estado().dedos, 2);
});

test('o mesmo dedo descendo duas vezes não é contado em dobro', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 100, 0));
  g.descer(dedo(1, 180, 100, 50));
  assert.equal(g.estado().dedos, 1);
  assert.deepEqual(g.subir(dedo(1, 180, 100, 100)), { acao: 'alternarPlay' },
    'com o dedo contado em dobro isto viraria um toque de dois dedos');
});

test('três dedos não são gesto nenhum', () => {
  const g = gestosDe();
  g.descer(dedo(1, 100, 100, 0));
  g.descer(dedo(2, 200, 100, 20));
  g.descer(dedo(3, 300, 100, 40));
  assert.equal(g.subir(dedo(1, 100, 100, 120)), null);
  assert.equal(g.subir(dedo(2, 200, 100, 130)), null);
  assert.equal(g.subir(dedo(3, 300, 100, 140)), null);
});

/* ------------------------------------------- item 7 — a pinça (fase 8) ---
 *
 * A pinça é a outra metade do desempate do desempate, e a que faltava desde a
 * fase 5: o teste que provava que dois dedos se afastando NÃO pulam capítulo
 * já existia; o que eles fazem em vez disso é o que entra agora.
 *
 * A decisão que atravessa a fase inteira: a pinça SÓ existe em tela cheia.
 * Fora dela o `touch-action` do quadro entrega o gesto ao navegador, que o usa
 * para ampliar a página — e esse zoom é acessibilidade. Disputá-lo custaria
 * tirar de quem precisa de letra maior a única forma de conseguir letra maior
 * em cima do vídeo, em troca de um recurso que a tela cheia já dá inteiro. É a
 * mesma forma da decisão do deslizar ↕ da fase 5.
 */

/* Um quadro de tela cheia com um vídeo que o preenche sem faixa preta, que é
 * onde as contas são legíveis: centro em (400, 200), e a imagem podendo andar
 * 400 px na horizontal e 200 na vertical quando ampliada 2×. */
const QUADRO_ZOOM = {
  largura: 800, altura: 400, duracao: 600,
  videoLargura: 800, videoAltura: 400
};

const comPinca = (medidas) => {
  const g = AppPlayerCore.criarGestos();
  g.medir(medidas || QUADRO_ZOOM);
  g.permitirVertical(true);
  g.permitirPinca(true);
  return g;
};

test('o retângulo da imagem não é o quadro — é o que sobra do contain', () => {
  /* 16:9 num quadro de telefone deitado: a imagem toma a altura toda e sobra
   * faixa preta dos dois lados. */
  const pilar = AppPlayerCore.retanguloDaImagem(812, 375, 1920, 1080);
  assert.equal(Math.round(pilar.largura), 667);
  assert.equal(Math.round(pilar.altura), 375);

  /* E o contrário: um vídeo mais largo que o quadro deixa faixa em cima e
   * embaixo. */
  assert.deepEqual(AppPlayerCore.retanguloDaImagem(800, 400, 1600, 400),
    { largura: 800, altura: 200 });

  /* Antes do `loadedmetadata` não existe proporção nenhuma, e o palpite seguro
   * é o quadro: ele deixa arrastar de menos, nunca de mais. */
  assert.deepEqual(AppPlayerCore.retanguloDaImagem(800, 400, 0, 0), { largura: 800, altura: 400 });
});

test('o zoom vai de 1× a 4×, e nada além disso', () => {
  assert.equal(AppPlayerCore.ZOOM_MIN, 1);
  assert.equal(AppPlayerCore.ZOOM_MAX, 4);
  assert.equal(AppPlayerCore.limitarZoom(9), 4, 'o teto da matriz é 4×');
  assert.equal(AppPlayerCore.limitarZoom(0.2), 1, 'encolher o vídeo dentro do quadro não existe');
  assert.equal(AppPlayerCore.limitarZoom(NaN), 1);
  /* Duas casas, como o volume e o brilho: sem isto o selo diria
   * "Zoom 2,4000000000000004×". */
  assert.equal(AppPlayerCore.limitarZoom(2.4000000000000004), 2.4);
});

test('o selo diz o tamanho com vírgula, e em 1× diz que voltou ao normal', () => {
  assert.equal(AppPlayerCore.rotuloZoom(2.4), 'Zoom 2,4×');
  assert.equal(AppPlayerCore.rotuloZoom(4), 'Zoom 4×', 'inteiro não ganha ",0"');
  assert.equal(AppPlayerCore.rotuloZoom(1), 'Tamanho normal');
});

/* O limite do arrasto sai da IMAGEM, e é aqui que a diferença aparece: num
 * vídeo com faixa preta em cima e embaixo, ampliar 2× deixa a imagem do
 * tamanho exato do quadro na vertical — não há para onde arrastar, e medir
 * pelo quadro deixaria a faixa preta subir até ocupar meia tela. */
test('a imagem para na borda dela, não na do quadro', () => {
  const quadro = { largura: 800, altura: 400 };
  const cheio = { largura: 800, altura: 400 };
  assert.deepEqual(AppPlayerCore.limitarDeslocamentoZoom({ x: 9999, y: 9999 }, 2, quadro, cheio),
    { x: 400, y: 200 });

  const comFaixa = { largura: 800, altura: 200 };
  assert.deepEqual(AppPlayerCore.limitarDeslocamentoZoom({ x: 9999, y: 9999 }, 2, quadro, comFaixa),
    { x: 400, y: 0 }, 'na vertical a imagem ampliada só preenche o quadro');

  /* Em 1× nunca sobra nada: é isto que faz a pinça de volta recentrar o vídeo
   * sozinha, sem nenhum caso especial no código. */
  assert.deepEqual(AppPlayerCore.limitarDeslocamentoZoom({ x: 50, y: 50 }, 1, quadro, cheio),
    { x: 0, y: 0 });
});

/* A decisão da fase, escrita como teste: fora da tela cheia NADA muda em
 * relação ao que o acervo inteiro foi varrido usando. */
test('fora da tela cheia a pinça é do navegador, e o player não a disputa', () => {
  const g = AppPlayerCore.criarGestos();
  g.medir(QUADRO_ZOOM);                      /* sem permitirPinca */
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  assert.equal(g.mover(dedo(2, 700, 200, 60)), null, 'não pode nascer zoom nenhum aqui');
  assert.equal(g.estado().zoom, 1);
  /* E o efeito que a distância JÁ tinha continua o mesmo: deixou de ser um
   * toque de capítulo. */
  assert.equal(g.subir(dedo(1, 300, 200, 100)), null);
});

test('dois dedos que se afastam ampliam, e param em 4×', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));           /* 200 px entre os dedos */
  assert.deepEqual(g.mover(dedo(2, 700, 200, 60)),
    { acao: 'zoom', fase: 'inicio', escala: 2, x: 100, y: 0 });
  /* 200 → 1000 px seriam 5×; o teto da matriz corta em 4. */
  assert.equal(g.mover(dedo(2, 1300, 200, 100)).escala, 4);
  const fim = g.subir(dedo(1, 300, 200, 140));
  assert.equal(fim.acao, 'zoom');
  assert.equal(fim.fase, 'fim');
  assert.equal(fim.escala, 4);
});

/* O que separa uma pinça boa de uma ruim: o pedaço do vídeo que está debaixo
 * dos dedos não pode escorregar enquanto se amplia. Sem a âncora, o detalhe
 * que se quer ver foge da tela justamente quando se aproxima dele. */
test('a pinça amplia em volta dos dedos, não do meio do quadro', () => {
  const g = comPinca();
  /* Os dedos abrem em torno de (300, 100) — acima e à esquerda do centro. */
  g.descer(dedo(1, 200, 100, 0));
  g.descer(dedo(2, 400, 100, 20));
  g.mover(dedo(1, 100, 100, 60));
  const z = g.mover(dedo(2, 500, 100, 70));
  assert.deepEqual(z, { acao: 'zoom', fase: 'mover', escala: 2, x: 100, y: 100 });

  /* A prova, refeita à mão com a mesma transformação que o CSS aplica:
   * `tela = escala × (conteúdo − centro) + centro + deslocamento`. O ponto
   * (300, 100) do vídeo tem que continuar caindo em (300, 100) da tela. */
  const naTela = (p) => ({
    x: z.escala * (p.x - 400) + 400 + z.x,
    y: z.escala * (p.y - 200) + 200 + z.y
  });
  assert.deepEqual(naTela({ x: 300, y: 100 }), { x: 300, y: 100 });
});

test('a pinça de volta ao 1× recentra o vídeo sozinha', () => {
  const g = comPinca();
  g.descer(dedo(1, 200, 100, 0));
  g.descer(dedo(2, 400, 100, 20));
  g.mover(dedo(2, 800, 100, 60));                    /* amplia, e desloca */
  assert.ok(g.estado().zoomX !== 0, 'a imagem tinha que estar deslocada aqui');
  g.mover(dedo(2, 400, 100, 120));                   /* fecha de volta */
  const fim = g.subir(dedo(1, 200, 100, 160));
  assert.deepEqual(fim, { acao: 'zoom', fase: 'fim', escala: 1, x: 0, y: 0 });
});

/* Regressão do item 2: a pinça não pode ter comido o toque de dois dedos.
 * Eles moram no mesmo gesto, e o desempate é o mesmo número do desempate. */
test('em tela cheia o toque de dois dedos continua pulando capítulo', () => {
  const g = comPinca();
  g.descer(dedo(1, 500, 200, 0));
  g.descer(dedo(2, 540, 200, 20));
  assert.deepEqual(g.subir(dedo(1, 500, 200, 150)), { acao: 'capitulo', direcao: 1 });
  assert.equal(g.estado().zoom, 1, 'um toque não amplia nada');
});

/* A inversão que o zoom traz, e ela se explica sozinha: só há o que arrastar
 * quando há mais imagem do que quadro. */
test('em 1× o dedo arrasta a linha do tempo; ampliado, arrasta a imagem', () => {
  const normal = comPinca();
  normal.descer(dedo(1, 400, 200, 0));
  const t = normal.mover(dedo(1, 440, 200, 40));
  assert.equal(t.acao, 'arrastar');
  assert.equal(t.alvo, 'tempo');

  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));                    /* 2× */
  g.subir(dedo(1, 300, 200, 100));
  g.subir(dedo(2, 700, 200, 110));
  assert.equal(g.estado().zoom, 2, 'o zoom sobrevive aos dedos saírem');

  g.descer(dedo(3, 400, 200, 200));
  const p = g.mover(dedo(3, 360, 200, 240));
  assert.equal(p.acao, 'zoom', 'com a imagem ampliada, o dedo move a imagem');
  assert.equal(p.fase, 'inicio');
  /* Anda o que o dedo andou DEPOIS da zona morta, e não a partir de onde ele
   * desceu — senão a imagem daria um salto de 10 px no primeiro quadro. */
  assert.deepEqual(g.mover(dedo(3, 360, 200, 280)),
    { acao: 'zoom', fase: 'mover', escala: 2, x: 100, y: 0 });
  assert.equal(g.mover(dedo(3, 260, 200, 320)).x, 0);
  /* E ela para na borda: 2× num quadro de 800 dá 400 px de folga para cada
   * lado, e nem o dedo que sai do quadro passa disso. */
  assert.equal(g.mover(dedo(3, -9999, 200, 360)).x, -400);
  assert.equal(g.subir(dedo(3, -9999, 200, 400)).fase, 'fim');
});

/* O dedo que sobra de uma pinça está CONSUMIDO, e é justamente com ele que a
 * mão continua arrastando depois de tirar o outro. */
test('o dedo que sobra da pinça continua arrastando a imagem', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));
  g.subir(dedo(1, 300, 200, 100));                   /* um sai, o outro fica */
  const p = g.mover(dedo(2, 660, 200, 140));
  assert.equal(p && p.acao, 'zoom');
  assert.equal(p.fase, 'inicio');
});

test('segurar para 2× não vale no meio de um arrasto da imagem', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));
  g.subir(dedo(1, 300, 200, 100));
  g.subir(dedo(2, 700, 200, 110));
  g.descer(dedo(3, 400, 200, 200));
  g.mover(dedo(3, 360, 200, 240));                   /* arrastando a imagem */
  assert.equal(g.aoSegurar(), null);
});

/* O navegador tomar o dedo para si — uma chamada que entra, o gesto do
 * sistema — não pode desfazer a ampliação na cara de quem estava lendo. */
test('o pointercancel acaba com o gesto, não com a ampliação', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));
  const fim = g.cancelar();
  assert.equal(fim.acao, 'zoom');
  assert.equal(fim.fase, 'fim');
  assert.equal(g.estado().zoom, 2, 'a ampliação fica');
  assert.equal(g.estado().zoomAtivo, null, 'o gesto não');
});

/* Sair da tela cheia com o vídeo ampliado deixaria a ficha com um pedaço de
 * imagem dentro de uma caixa de 211 px — e nenhum gesto à mão para desfazer,
 * porque fora da tela cheia a pinça é do navegador. */
test('sair da tela cheia zera a ampliação', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));
  g.subir(dedo(1, 300, 200, 100));
  g.subir(dedo(2, 700, 200, 110));
  assert.equal(g.estado().zoom, 2);
  g.permitirPinca(false);
  assert.equal(g.estado().zoom, 1);
  assert.equal(g.estado().zoomX, 0);
});

/* A tela bloqueada (item 9) deixa os gestos inertes, e a pinça entra nessa
 * conta: o bloqueio existe para o aparelho na mão, e ampliar sem querer é
 * exatamente o tipo de coisa de que ele protege. */
test('a tela bloqueada não amplia', () => {
  const g = comPinca();
  g.travar(true);
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  assert.equal(g.mover(dedo(2, 700, 200, 60)), null);
  assert.equal(g.estado().zoom, 1);
});

/* Girar o aparelho em tela cheia é a única coisa que muda o quadro sem passar
 * por um dedo. Com a imagem ampliada e encostada na borda, o quadro novo é
 * menor de um lado — e o deslocamento de antes passaria a mostrar faixa
 * preta. Quem repara é a própria remedida. */
test('girar o aparelho reapara a imagem ampliada contra o quadro novo', () => {
  const g = comPinca();
  g.descer(dedo(1, 300, 200, 0));
  g.descer(dedo(2, 500, 200, 20));
  g.mover(dedo(2, 700, 200, 60));                    /* 2× */
  g.subir(dedo(1, 300, 200, 100));
  g.subir(dedo(2, 700, 200, 110));
  g.descer(dedo(3, 400, 200, 200));
  g.mover(dedo(3, 380, 200, 240));
  g.mover(dedo(3, -9999, 200, 280));                 /* até a borda */
  g.subir(dedo(3, -9999, 200, 320));
  assert.equal(g.estado().zoomX, -400, 'a folga do quadro deitado é 400 px');

  /* O aparelho girou: 400 × 800 com o mesmo vídeo. A imagem passa a medir
   * 400 × 200, e em 2× a folga cai para 200 px de cada lado. */
  g.medir({ largura: 400, altura: 800, duracao: 600, videoLargura: 800, videoAltura: 400 });
  assert.equal(g.estado().zoom, 2, 'girar não desfaz a ampliação');
  assert.equal(g.estado().zoomX, -200, 'o deslocamento velho mostraria faixa preta');
});

test('a remedida chega à tela, e o ouvinte da janela sai na saída da ficha', () => {
  assert.match(PLAYER_CODIGO, /raiz\.addEventListener\('resize', aoRedimensionar\)/);
  /* Um ouvinte por ficha visitada se acumularia, cada um remedindo o quadro de
   * uma ficha que não existe mais — a mesma lição dos ouvintes de tela cheia. */
  const destruir = PLAYER_CODIGO.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /raiz\.removeEventListener\('resize', aoRedimensionar\)/);
});

/* ------------------------------------- o lado DOM da pinça, no arquivo --- */

test('quem liga a pinça é a tela cheia, e o navegador fica com o zoom da página', () => {
  assert.match(PLAYER_CODIGO, /gestos\.permitirPinca\(cheia\)/);
  /* Sair da tela cheia limpa a transformação na TELA, e não só na máquina. */
  assert.match(PLAYER_CODIGO, /if \(!cheia\) \{ definirZoom\(AppPlayerCore\.ZOOM_MIN, 0, 0\)/);

  const css = lerTexto(path.join(SITE, 'style.css'));
  /* A linha que ENTREGA a pinça ao navegador fora da tela cheia. Tirar
   * `pinch-zoom` daqui é tirar o zoom da página de cima do vídeo, e isso é
   * acessibilidade: quem precisa de letra maior no site inteiro perderia o
   * único jeito de conseguir. */
  assert.match(css, /\.pl \{[\s\S]{0,600}?touch-action: pan-y pinch-zoom;/);
  assert.match(css, /\.pl-cheia \{ touch-action: none; \}/);
});

test('a transformação do zoom escala primeiro e desloca depois', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const regra = css.match(/\.pl-zoom \.pl-video \{([\s\S]*?)\}/);
  assert.ok(regra, 'não achei .pl-zoom .pl-video em style.css');
  /* A ordem não é gosto: `translate` por fora deixa o deslocamento em pixels
   * de TELA, que é a unidade em que o player-core faz a conta e limita o
   * arrasto. Invertida, a folga calculada lá viraria outro número aqui. */
  assert.match(regra[1], /transform:\s*translate\([^;]*?\)\s*scale\(var\(--pl-zoom/);
  assert.match(regra[1], /transform-origin: 50% 50%/);
  /* Compor uma camada nova custa, e quem nunca ampliou não paga — a mesma
   * disciplina do filtro de brilho e do grafo de som. */
  assert.match(PLAYER_CODIGO, /classList\.toggle\('pl-zoom', e !== AppPlayerCore\.ZOOM_MIN\)/);
});

/* ------------------------------------------------ item 9 — bloqueio de tela */

test('travado, nenhum gesto passa', () => {
  const g = gestosDe(QUADRO_CHEIO);
  g.permitirVertical(true);
  g.travar(true);

  g.descer(dedo(1, 60, 300, 0));
  assert.equal(g.mover(dedo(1, 60, 100, 60)), null, 'nem o brilho');
  assert.equal(g.mover(dedo(1, 400, 100, 90)), null, 'nem a linha do tempo');
  assert.deepEqual(g.subir(dedo(1, 400, 100, 120)), { acao: 'avisoTravado' },
    'o toque só avisa que está travado');

  const dois = gestosDe();
  dois.travar(true);
  dois.descer(dedo(1, 300, 100, 0));
  dois.descer(dedo(2, 340, 100, 20));
  assert.equal(dois.subir(dedo(1, 300, 100, 150)), null, 'nem o capítulo');
});

test('o toque duplo é a única saída da tela travada', () => {
  const g = gestosDe();
  g.travar(true);
  g.descer(dedo(1, 180, 100, 1000));
  g.subir(dedo(1, 180, 100, 1060));
  assert.deepEqual(g.descer(dedo(2, 182, 102, 1200)), { acao: 'destravar' });
  /* E o `subir` desse toque não dá play/pause por cima do destravar. */
  assert.equal(g.subir(dedo(2, 182, 102, 1260)), null);
});

/* ------------------------------------------- o lado DOM, varrido no arquivo */

/* A promessa da fase, e a razão de a máquina existir: um gesto que pula 5 s
 * tem que pular pelo MESMO caminho que a seta pula. Sem isto o toque duplo
 * viraria um segundo lugar de onde o vídeo se move, com as próprias regras de
 * limite — e a REGRA 1 teria um segundo esconderijo. */
test('o gesto executa pelo mesmo caminho do teclado', () => {
  assert.match(PLAYER_CODIGO, /default: executar\(acao\); break;/,
    'as ações comuns do gesto precisam cair no executar() do teclado');
  conferirPlaySoNoGuardiao('a fase 5 abriu um segundo caminho para o play()');
});

/* Antes desta fase, play/pause no toque era um `click` no <video> — e com ele
 * um toque duplo na lateral disparava DOIS play/pause além do pulo de 5 s. */
test('play/pause no quadro é decisão da máquina, não um click no <video>', () => {
  assert.doesNotMatch(PLAYER_CODIGO, /video\.addEventListener\('click'/,
    'o click do <video> voltou e vai brigar com o toque duplo');
  assert.match(PLAYER_CODIGO, /caixa\.addEventListener\('pointerdown', function/);
});

/* O cuidado que a fase 4 deixou escrito para esta: o painel de som abre no
 * toque em aparelho sem ponteiro e ocupa o canto do quadro. `somCaixa` vive
 * dentro de `controles`, então a checagem de um cobre os dois. */
test('o gesto não dispara em cima dos controles nem do painel de som', () => {
  assert.match(PLAYER_CODIGO,
    /function foraDosControles\(ev\)[\s\S]{0,200}controles\.contains/);
  /* Há DOIS `pointerdown` no `caixa`: o que fecha o painel de som, da fase 4,
   * e o dos gestos. O da fase 4 vem primeiro no arquivo — pegar só o primeiro
   * daria um teste que passa sem provar nada. */
  const baixas = PLAYER_CODIGO.match(
    /caixa\.addEventListener\('pointerdown', function \(ev\) \{[\s\S]*?\n    \}\);/g) || [];
  assert.equal(baixas.length, 2, 'os dois pointerdown do quadro deveriam estar aqui');
  assert.ok(baixas.some((b) => /!foraDosControles\(ev\)\) return/.test(b)),
    'o pointerdown dos gestos precisa recusar o que começa nos controles');
});

test('os ouvintes de tela cheia e o relógio do segurar saem ao sair da ficha', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(destruir, 'não achei destruir() em player.js');
  assert.match(destruir[1], /removeEventListener\('fullscreenchange', aoTrocarTelaCheia\)/);
  assert.match(destruir[1], /removeEventListener\('webkitfullscreenchange', aoTrocarTelaCheia\)/);
  assert.match(destruir[1], /cancelarSegurar\(\)/,
    'um setTimeout de meio segundo sobreviveria à saída da ficha');
});

test('quem liga o arrasto vertical é a tela cheia, e só ela', () => {
  assert.match(PLAYER_CODIGO, /gestos\.permitirVertical\(cheia\)/);
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pl \{[\s\S]{0,600}?touch-action: pan-y/,
    'sem pan-y a ficha não rola com o dedo no vídeo');
  assert.match(css, /\.pl-cheia \{ touch-action: none; \}/);
});

/* Aqui havia o teste de que o `filter` do brilho só entrava para quem tinha
 * mexido nele — a mesma disciplina do grafo de som da fase 4. O gesto saiu em
 * 09/09 e o teste foi com ele. O que guarda a AUSÊNCIA agora é "o filtro de
 * brilho saiu do CSS junto com o gesto", ao lado do teste das zonas de
 * arrasto vertical, que é onde o buraco que ele deixou está descrito. */

/* A lição de largura da fase 3, cobrada de novo: em 375 px os quatro botões e
 * o relógio comem 317 dos 349 px da linha. Um quinto botão a quebraria em
 * três — então ele só existe onde há largura, que é a tela cheia. */
test('o botão de bloqueio só aparece em tela cheia', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pl-trava \{ display: none; \}/);
  assert.match(css, /\.pl-cheia \.pl-trava \{ display: inline-flex; \}/);
  /* A lição do `hidden` da fase 3: `display` do autor ganha do `hidden` do
   * navegador, e o cadeado nasce escondido. */
  assert.match(css, /\.pl-cadeado\[hidden\] \{ display: none; \}/);
});

/* ------------------------- as setas de capítulo (08/09) -------------------
 *
 * Uma decisão de projeto: o gesto de dois dedos e o
 * `Ctrl`+seta pulam capítulo desde as fases 3 e 5, e o projeto já
 * avisava que ninguém descobre nenhum dos dois sozinho. O que faltava era o
 * caminho VISÍVEL, e é ele. */

test('as setas de capítulo só nascem para quem tem capítulo', () => {
  assert.match(PLAYER_JS, /var bCapAnt = caps\.length \? botao\('pl-b pl-cap-ant'/,
    'a seta da esquerda deveria depender de caps.length');
  assert.match(PLAYER_JS, /var bCapProx = caps\.length \? botao\('pl-b pl-cap-prox'/,
    'a seta da direita deveria depender de caps.length');

  /* Sem capítulo o DOM continua sendo o de antes desta entrega — relógio e
     barra soltos na linha, sem contêiner nenhum. É a promessa feita aos 27
     títulos sem capítulo, e ela vale para a ÁRVORE, não só para o desenho. */
  const montagem = PLAYER_JS.match(
    /if \(bCapAnt\) \{[\s\S]*?\} else \{([\s\S]*?)\n    \}/);
  assert.ok(montagem, 'não achei a montagem das setas em player.js');
  assert.match(montagem[1], /controles\.appendChild\(tempo\);/,
    'sem capítulo o relógio tem que entrar solto, como antes');
  assert.match(montagem[1], /controles\.appendChild\(barra\);/,
    'sem capítulo a barra tem que entrar solta, como antes');
});

/* O valor de ligar o botão na função que já existe: o recomeço do capítulo, os
 * recados de ponta ("Primeiro capítulo") e o "nunca chama play()" vêm de
 * graça. Um caminho próprio teria que reconquistar os três, e é assim que dois
 * botões passam a divergir do atalho de teclado que deveriam espelhar. */
test('as setas caem na mesma função do Ctrl+seta e do gesto', () => {
  assert.match(PLAYER_CODIGO, /bCapAnt\.addEventListener\('click', function \(\) \{ irParaCapitulo\(-1\); \}\)/);
  assert.match(PLAYER_CODIGO, /bCapProx\.addEventListener\('click', function \(\) \{ irParaCapitulo\(1\); \}\)/);

  /* E `irParaCapitulo` continua sendo quem NÃO liga o play: pular de capítulo
     num vídeo pausado deixa o vídeo pausado, como a lista clicável da ficha. */
  const corpo = PLAYER_JS.match(/function irParaCapitulo\(direcao\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei irParaCapitulo em player.js');
  assert.ok(!/[^a-zA-Z]play\(\)/.test(corpo[1]), 'irParaCapitulo passou a ligar o play');
});

/* A lição de largura da fase 3, cobrada pela terceira vez — e agora com a
 * conta escrita, porque foi ela que decidiu o desenho.
 *
 * Em 375 px a linha do player tem 349 px, e com os 12 px de padding de cada
 * lado sobram 325 de conteúdo. As duas setas pediam 108 px onde havia 42,1
 * livres, e uma linha com sete botões soma 330,9 só de itens — mais do que a
 * linha inteira. A largura saiu do RELÓGIO, que sobe para a linha da barra. */
/* "Pular capítulo é uma função só, com duas direções" — o pedido de quem usa o
 * site, depois de ver as setas num Android (08/09). Duas setas separadas pelo
 * mesmo vão de todo o resto leem como dois botões sem parentesco.
 *
 * O contêiner não é enfeite: no celular a linha distribui a sobra ENTRE os
 * itens, e sem o par ser UM item as duas setas se afastariam exatamente onde
 * deviam se juntar. */
test('as duas setas são um item só da linha, e não dois', () => {
  const montagem = PLAYER_CODIGO.match(/if \(bCapAnt\) \{([\s\S]*?)\n      var tempoBarra/);
  assert.ok(montagem, 'não achei a montagem do par em player.js');
  assert.match(montagem[1], /criar\('div', 'pl-cap-par'\)/,
    'as setas deveriam entrar num contêiner delas');
  assert.match(montagem[1], /capPar\.appendChild\(bCapAnt\)/);
  assert.match(montagem[1], /capPar\.appendChild\(bCapProx\)/);
  assert.ok(!/controles\.appendChild\(bCapAnt\)/.test(montagem[1]),
    'a seta da esquerda ainda entra solta na linha — o par se desfaz no space-between');
  assert.ok(!/controles\.appendChild\(bCapProx\)/.test(montagem[1]),
    'a seta da direita ainda entra solta na linha — o par se desfaz no space-between');
});


test('a linha de 375 px cabe, com as setas e sem o relógio', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const alvo = css.match(/\.pl-b \{[^}]*?width: (\d+)px/);
  assert.ok(alvo, 'não achei a largura do botão em .pl-b');
  const botao = Number(alvo[1]);
  assert.equal(botao, 44, 'o alvo de toque de 44 px é a medida de que a conta depende');

  const vao = css.match(/\.pl-controles \{[\s\S]*?gap: (\d+)px/);
  assert.ok(vao, 'não achei o vão de .pl-controles');
  const normal = Number(vao[1]);

  /* As duas setas são UM item da linha, não dois: elas moram num contêiner com
     o vão delas. Quem conta itens tem que contar assim, senão a conta abaixo
     descreve uma linha que não existe. */
  const vaoPar = css.match(/\.pl-cap-par \{[^}]*?gap: (\d+)px/);
  assert.ok(vaoPar, 'não achei o vão de dentro do par de capítulo');
  const par = 2 * botao + Number(vaoPar[1]);

  /* O par tem que ser MAIS APERTADO que a linha, senão ele não é um par — é
     isso que faz duas setas lerem como uma função só com duas direções. */
  assert.ok(Number(vaoPar[1]) < normal,
    'o vão de dentro do par (' + vaoPar[1] + ') não é menor que o da linha (' + normal + ')');

  const CONTEUDO = 349 - 12 - 12;          /* a linha em 375 px, menos o padding */
  const soma = (itens, largura, g) => largura + (itens - 1) * g;

  /* Fora da tela cheia, com capítulo: play, o PAR, CC, som e cheia — cinco
     itens, seis botões. */
  const fora = soma(5, botao * 4 + par, normal);
  assert.ok(fora <= CONTEUDO,
    'a linha de fora da tela cheia não cabe em ' + CONTEUDO + ' px: ' + fora);

  /* Dentro dela entra o cadeado: seis itens, sete botões. Em pé não há 10 px
     de vão para eles — e não havia antes desta entrega tampouco: a linha já
     quebrava em três, com a tela cheia sozinha no terceiro andar (medido em
     08/09: os controles iam de 88 px de altura para 134). */
  const vaoCheia = css.match(/\.pl-cheia \.pl-controles \{ column-gap: (\d+)px; \}/);
  assert.ok(vaoCheia, 'não achei o piso do vão da tela cheia em retrato');
  const cheia = soma(6, botao * 5 + par, Number(vaoCheia[1]));
  assert.ok(cheia <= CONTEUDO,
    'a linha da tela cheia não cabe em ' + CONTEUDO + ' px: ' + cheia);

  /* E a prova de que o piso apertado é NECESSÁRIO: com o vão normal, a linha
     da tela cheia não caberia. Se um dia couber, ele virou enfeite e sai. */
  assert.ok(soma(6, botao * 5 + par, normal) > CONTEUDO,
    'a tela cheia passou a caber com o vão normal — o column-gap de 2 px não serve mais para nada');

  /* O 2 px é PISO, não medida final. Sem isto a sobra de um aparelho mais
     largo — 68 px num Android de 412 px em tela cheia — ia toda para um vazio
     à direita, do tamanho de um botão. Foi o que se viu no aparelho em 08/09. */
  const blocos = css.match(/@media \(max-width: 700px\) \{[\s\S]*?\n\}/g) || [];
  const celular = blocos.find((b) => b.includes('.pl-controles {'));
  assert.ok(celular, 'não achei o bloco de celular dos controles');
  assert.match(celular, /\.pl-controles \{ justify-content: space-between; \}/,
    'sem distribuir a sobra, a linha amontoa os botões à esquerda em toda tela maior que 375 px');
});

/* O contêiner do relógio + barra é o que faz os dois subirem JUNTOS no
 * celular. Sem a segunda regra, o `flex-basis: 100%` que a fase 3 pôs na barra
 * é herdado dentro dele, o relógio vai para uma linha e a barra para outra —
 * três linhas, que é exatamente o que a fase 3 evitou. */
test('no celular o relógio sobe junto com a barra, e não sozinho', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  /* Há mais de um `@media (max-width: 700px)` no arquivo — a legenda tem o
     dela. O que interessa é o bloco em que os CONTROLES moram. */
  const blocos = css.match(/@media \(max-width: 700px\) \{[\s\S]*?\n\}/g) || [];
  const celular = blocos.find((b) => b.includes('.pl-controles {'));
  assert.ok(celular, 'não achei o bloco de celular dos controles');
  assert.match(celular, /\.pl-tempo-barra \{ order: -1; flex-basis: 100%; \}/);
  assert.match(celular, /\.pl-tempo-barra \.pl-barra \{ order: 0; flex-basis: auto; \}/,
    'sem devolver a barra ao normal dentro do contêiner, ela empurra o relógio para outra linha');

  /* E o contêiner precisa poder encolher: um filho de flex não vai abaixo do
     conteúdo sem `min-width: 0`, e a barra não tem largura de conteúdo. */
  assert.match(css, /\.pl-tempo-barra \{[\s\S]*?min-width: 0;/);
});

/* ---------------------------------- item 6, o scrubber (fase 6, 03/09) ---
 *
 * Não existe storyboard no Bunny — são 5 quadros por vídeo, tanto num de 10
 * minutos quanto num de 27. O quadro sai de um SEGUNDO <video> apontando para
 * o `play_240p.mp4` que já está no ar, com `Accept-Ranges` e CORS: o caminho
 * "barato", zero infraestrutura nova. */
test('a prévia do arrasto sai do 240p, e nada é baixado antes de alguém arrastar', () => {
  assert.match(PLAYER_CODIGO, /AppPlayerCore\.urlMp4\(midia, '240p'\)/,
    'a prévia tem que sair da menor resolução — o arquivo inteiro tem 51 MB');

  /* O `src` só entra em `ligarPrevia`, e `ligarPrevia` só é chamada de
   * `pedirQuadro`, que só roda dentro de um arrasto. Quem abre a ficha para
   * ler a sinopse não baixa quadro nenhum — a mesma disciplina do vídeo
   * principal e da legenda. */
  const ligar = PLAYER_CODIGO.match(/function ligarPrevia\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(ligar, 'não achei ligarPrevia em player.js');
  assert.match(ligar[1], /previaQuadro\.src = urlPrevia/);
  const usosDoSrc = PLAYER_CODIGO.match(/previaQuadro\.src\s*=/g) || [];
  assert.equal(usosDoSrc.length, 1, 'o src da prévia é posto num lugar só, no primeiro arrasto');

  /* `metadata`, não `auto`: o que se quer é a régua do tempo. Os bytes de cada
   * quadro vêm por faixa, quando o dedo pede. */
  assert.match(PLAYER_CODIGO, /previaQuadro\.preload = 'metadata'/);

  /* E ela nunca toca — a REGRA 1 continua com um dono só. */
  conferirPlaySoNoGuardiao('a prévia virou um segundo caminho para o play()');
});

/* A fila tem UM lugar. O dedo pede um segundo diferente a cada quadro da tela,
 * e enfileirar isso faria a prévia correr atrás do dedo, cada vez mais
 * atrasada — em vez de mostrar o quadro mais recente que deu tempo de buscar. */
test('a prévia guarda só o último pedido, nunca uma fila', () => {
  const pedir = PLAYER_CODIGO.match(/function pedirQuadro\(segundos\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(pedir, 'não achei pedirQuadro em player.js');
  assert.match(pedir[1], /previa\.pedido = AppPlayerCore\.limitarTempo/,
    'o pedido é substituído, não empilhado');
  assert.match(pedir[1], /if \(!previa\.ocupado\) servirQuadro\(\)/);
  assert.ok(!/push|shift|concat/.test(pedir[1]), 'apareceu uma fila onde só cabe um pedido');
});

/* Um SEGUNDO elemento de mídia por ficha. Ele morre com o mesmo rigor do
 * primeiro: sem tirar o src e chamar load(), a faixa de bytes em andamento
 * continuaria vindo da pull zone para uma ficha que já saiu da tela. */
test('a prévia é destruída ao sair da ficha, como o hls.js e o AudioContext', () => {
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(destruir, 'não achei destruir() em player.js');
  assert.match(destruir[1], /previaQuadro\.removeAttribute\('src'\)/);
  assert.match(destruir[1], /previaQuadro\.load\(\)/);
  assert.match(destruir[1], /previa\.morto = true/);
});

/* Pedido depois do teste no dedo, em 03/09: arrastando na horizontal a mão
 * cobre o meio e a metade de baixo do quadro, e na barra ela cobre justamente
 * a dica que a fase 3 desenhou logo acima dela. */
test('a prévia fica no canto superior esquerdo, onde a mão não cobre', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const caixa = css.match(/\n\.pl-previa \{([\s\S]*?)\n\}/);
  assert.ok(caixa, 'não achei .pl-previa em style.css');
  assert.match(caixa[1], /left: 12px; top: 12px/,
    'a prévia saiu do canto de cima e vai ficar embaixo do dedo');
  /* O mesmo canto do selo, e é de propósito: durante o arrasto quem fala é a
   * moldura, que já mostra o relógio. Por isso ela apaga o selo ao aparecer. */
  const selo = css.match(/\n\.pl-selo \{([\s\S]*?)\n\}/);
  assert.match(selo[1], /left: 12px; top: 12px/);
  const mostrar = PLAYER_CODIGO.match(/function mostrarPrevia\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(mostrar, 'não achei mostrarPrevia em player.js');
  assert.match(mostrar[1], /esconderSelo\(\)/, 'a moldura e o selo apareceriam um por cima do outro');
  assert.match(css, /\.pl-previa\[hidden\] \{ display: none; \}/);

  /* A moldura cresceu em 03/09 e passou a encostar na linha de controles: num
   * quadro embutido de 195 px de altura ela ocupa 152. Em vez de encolher de
   * novo, os BOTÕES desbotam enquanto se procura — mas a BARRA não, porque ela
   * é a única coisa que mostra para onde o ponteiro do vídeo está indo. */
  assert.match(css, /\.pl-procurando \.pl-b,/);
  const procurando = css.match(/\.pl-procurando[\s\S]*?\n\}/);
  assert.ok(procurando, 'não achei a regra de .pl-procurando');
  assert.ok(!/\.pl-procurando \.pl-barra/.test(css),
    'a barra não pode desbotar durante a busca: é o único retorno de posição');
  assert.match(mostrar[1], /classList\.add\('pl-procurando'\)/);
  const esconder = PLAYER_CODIGO.match(/function esconderPrevia\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(esconder, 'não achei esconderPrevia em player.js');
  assert.match(esconder[1], /classList\.remove\('pl-procurando'\)/,
    'sem isto os botões ficariam apagados depois do arrasto');
});

/* Os DOIS arrastos horizontais mostram o quadro: o do quadro (item 11) e o da
 * barra. A moldura do CANTO é a do dedo, e ela continua vindo só no arrasto. */
test('a prévia do canto aparece nos dois arrastos, nunca ao passar o ponteiro', () => {
  const mover = PLAYER_CODIGO.match(/function aoMover\(ev\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(mover, 'não achei aoMover em player.js');
  const posGuarda = mover[1].indexOf("pl-barra-ativa'))");
  const posPrevia = mover[1].indexOf('mostrarPrevia');
  assert.ok(posGuarda >= 0 && posPrevia > posGuarda,
    'a moldura do canto precisa vir DEPOIS da guarda de arrasto ativo');

  const arrasto = PLAYER_CODIGO.match(/function aplicarArrasto\(a\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(arrasto, 'não achei aplicarArrasto em player.js');
  assert.match(arrasto[1], /mostrarPrevia\(alvo, delta, a\.descarte\)/);
  assert.match(arrasto[1], /esconderPrevia\(\)/, 'a moldura tem que sair quando o dedo solta');
});

/* ------------- o quadro ao passar o ponteiro na barra (04/09) ----------- */

/* O que segurava o hover fora da fase 6 era o mouse a CAMINHO do botão de
 * play, que fica a 20 px da barra: um MP4 baixado por engano a cada vez que
 * alguém vai apertar play. Quem resolve isso é a espera, não uma proibição —
 * o primeiro quadro só é pedido depois dela, e atravessar a barra não custa
 * byte nenhum. */
test('o quadro no hover só é pedido depois da espera, e nunca de imediato', () => {
  assert.match(PLAYER_CODIGO, /var QUADRO_HOVER_MS = 300;/);
  const agendar = PLAYER_CODIGO.match(/function agendarQuadroHover\(t\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(agendar, 'não achei agendarQuadroHover em player.js');
  const posTimeout = agendar[1].indexOf('setTimeout');
  const posPedido = agendar[1].indexOf('pedirQuadro');
  assert.ok(posTimeout >= 0 && posPedido > posTimeout,
    'o primeiro quadro do hover não pode sair antes da espera');
  assert.match(agendar[1], /QUADRO_HOVER_MS/);
  /* Um relógio por vez: o segundo pedido dentro da janela só troca o alvo. É a
   * mesma disciplina da fila da prévia, que também guarda um lugar só. */
  assert.match(agendar[1], /if \(quadroHover\.espera\) return;/);
  assert.match(agendar[1], /quadroHover\.alvo = t;/);
  assert.ok(!/push|concat/.test(agendar[1]), 'apareceu fila onde só cabe o último alvo');

  const mover = PLAYER_CODIGO.match(/function aoMover\(ev\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(mover[1], /if \(mouse\) agendarQuadroHover\(/,
    'sem isto o hover não pede quadro nenhum');
});

/* O relógio tem que morrer duas vezes: quando o ponteiro sai da barra e quando
 * a ficha sai da tela. O segundo é a armadilha conhecida — um `setTimeout` que
 * acorda depois da saída pediria quadro a um <video> já destruído. */
test('o relógio do hover morre com o ponteiro e com a ficha', () => {
  const esconder = PLAYER_CODIGO.match(/function esconderDica\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(esconder, 'não achei esconderDica em player.js');
  assert.match(esconder[1], /cancelarQuadroHover\(\)/);
  /* E a moldura sai junto — menos no meio de um arrasto, quando o ponteiro
   * sai da barra o tempo todo por causa do `setPointerCapture`. */
  assert.match(esconder[1],
    /if \(!barra\.classList\.contains\('pl-barra-ativa'\)\) esconderPrevia\(\)/);

  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /cancelarQuadroHover\(\)/);

  const agendar = PLAYER_CODIGO.match(/function agendarQuadroHover\(t\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(agendar[1], /if \(destruido \|\| !sobreABarra\) return;/,
    'o relógio precisa conferir, ao acordar, se ainda faz sentido pedir');
});

/* A moldura tem DOIS lugares, e cada um tem o seu motivo: o canto é do DEDO,
 * porque a mão cobre a barra; em cima da barra é do MOUSE, que não cobre nada.
 * Trocar de lugar tem que desfazer o outro — o `left`/`bottom` em linha são do
 * modo sobre a barra, e um resto deles deslocaria a moldura do canto. */
test('a moldura volta para o canto quando o dedo assume', () => {
  const canto = PLAYER_CODIGO.match(/function previaNoCanto\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(canto, 'não achei previaNoCanto em player.js');
  assert.match(canto[1], /classList\.remove\('pl-previa-barra'\)/);
  assert.match(canto[1], /style\.left = ''/);
  assert.match(canto[1], /style\.bottom = ''/);

  const mostrar = PLAYER_CODIGO.match(/function mostrarPrevia\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(mostrar[1], /previaNoCanto\(\)/, 'o arrasto do dedo tem que trazer a moldura de volta');
  const esconderP = PLAYER_CODIGO.match(/function esconderPrevia\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(esconderP[1], /previaNoCanto\(\)/);

  /* E o CSS desfaz a âncora do canto: sem `top: auto` o `top: 12px` da regra
   * de cima ganharia do `bottom` em linha, e a moldura ficaria no alto. */
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pl-previa-barra \{ top: auto; \}/);
});

/* Com o mouse a moldura já diz capítulo e relógio: deixar a dica de texto
 * junto seria a mesma informação duas vezes, uma por cima da outra. E sem o
 * 240p — ou depois de ele falhar — a dica volta a ser o caminho, e o hover
 * fica igual ao de antes de hoje. */
test('a moldura sobre a barra substitui a dica, e a dica é a reserva', () => {
  const sobre = PLAYER_CODIGO.match(/function previaSobreBarra\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(sobre, 'não achei previaSobreBarra em player.js');
  assert.match(sobre[1], /dica\.hidden = true/);
  assert.match(sobre[1], /AppPlayerCore\.posicaoDica\(/, 'a moldura é aparada pela borda da barra, como a dica');

  const mDica = PLAYER_CODIGO.match(/function moverDica\(clientX, mouse\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(mDica, 'não achei moverDica em player.js');
  assert.match(mDica[1], /if \(mouse && urlPrevia && !previa\.morto\)/,
    'no dedo, e sem o 240p, quem aparece é a dica de texto');
});

/* O ajuste do /admin tem um caminho inteiro para percorrer — KV, API, grade,
 * player — e ele quebra em silêncio em qualquer um dos elos. O elo mais fácil
 * de errar é o primeiro: `config` vem do AMBIENTE e o PUT o descarta, então um
 * ajuste guardado ali se apagaria na gravação seguinte, sem erro nenhum. */
test('o ajuste do player mora no catálogo, não no config do ambiente', () => {
  const api = lerTexto(path.join(WORKER, 'api', 'catalogo.js'));

  /* O PUT continua apagando o config — e não pode apagar os ajustes. */
  assert.match(api, /delete novo\.config;/);
  assert.ok(!/delete novo\.ajustes/.test(api),
    'o PUT está apagando os ajustes: eles não sobreviveriam a uma gravação');

  /* E a resposta pública leva os ajustes: campo que não sai por aqui não
   * existe para o navegador. É a mesma armadilha que já tinha sumido com a
   * lista de capítulos uma vez. */
  const get = api.match(/export async function onRequestGet[\s\S]*?\n\}/);
  assert.ok(get, 'não achei o GET em catalogo.js');
  assert.match(get[0], /ajustes: ajustes\(guardado\)/);

  /* A grade repassa ao player. */
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /ajustes: dados\.ajustes \|\| \{\}/);
  assert.match(PLAYER_CODIGO, /config\.ajustes\) \? config\.ajustes\.arrastoTeto/);

  /* E o player entrega a duração junto — sem ela o teto não tem de onde sair. */
  const medir = PLAYER_CODIGO.match(/function medirQuadro\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(medir, 'não achei medirQuadro em player.js');
  assert.match(medir[1], /duracao: duracao\(\)/);
  assert.match(medir[1], /fracaoTeto: fracaoTeto/);
});

/* Desde a mesa (15/09) o ajuste passa pelo rascunho, como qualquer mudança. A
 * regra da fração e da faixa é a mesma; o caminho até o KV é o Publicar, que
 * relê o catálogo, confere e grava com o `rev` — o teste logo abaixo. */
test('a mesa tem onde ajustar o teto, e só grava o que está na faixa', () => {
  const painel = lerTexto(path.join(SITE, 'mesa-painel.js'));
  assert.match(painel, /id: 'a-teto'/);
  assert.match(painel, /id: 'a-sumico'/);

  const mesa = lerTexto(path.join(SITE, 'mesa.js'));
  /* Grava a FRAÇÃO, não a porcentagem: a tela fala em % porque é o que se lê,
   * e o player-core trabalha em fração. Trocar isso silenciosamente faria o
   * teto valer 40 vezes o vídeo. */
  assert.match(mesa, /'arrastoTeto', Math\.round\(pct\) \/ 100/);
  assert.match(mesa, /pct < 5 \|\| pct > 100/);
  /* E vai para o rascunho: nenhum campo do catálogo grava por fora do Publicar.
   * O mesa.js FAZ PUT desde a M2 — em `/api/contas` e `/api/conta`, que são
   * as contas da equipe e não o catálogo. O que não pode é ele tocar o
   * catálogo: isso é do Publicar, em mesa-base.js. */
  assert.match(mesa, /M\.mudar\('ajustes', 'arrastoTeto'/);
  assert.ok(!/\/api\/catalogo/.test(mesa), 'mesa.js grava o catálogo por fora do Publicar');
});

/* O Publicar é o caminho da mesa até o KV para tudo o que já está no catálogo
 * — o título novo, que nasce fora do ar, é a exceção escrita em mesa-telas.js.
 * Ele relê, confere campo a campo e, do que veio no GET, só tira o `config`:
 * a regra que a rev 85 ensinou aos scripts vale para a tela também. */
test('o Publicar da mesa relê, confere o conflito e só tira o config', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  const publicar = base.match(/M\.publicar = function \(\) \{([\s\S]*?)\n  \};/);
  assert.ok(publicar, 'não achei M.publicar em mesa-base.js');
  assert.match(publicar[1], /\/api\/catalogo\?completo=1/);
  assert.match(publicar[1], /App\.conflitosRascunho\(atual, M\.st\.rascunho\)/);
  assert.match(publicar[1], /App\.aplicarRascunho\(atual, M\.st\.rascunho\)/);
  assert.match(publicar[1], /delete novo\.config;/);
  assert.ok(!/delete novo\.ajustes/.test(publicar[1]), 'o Publicar apaga os ajustes — a rev 85 de novo');
  assert.match(publicar[1], /method: 'PUT'/);
});

/* ------------------- o sumiço dos controles (03/09) --------------------- */

/* Cada recusa aqui é um jeito de o player parecer quebrado. Elas moram no
 * core, e não no player.js, exatamente porque são fáceis de esquecer uma. */
test('os controles não somem quando sumir seria um defeito', () => {
  const base = { tocando: true, painelAberto: false, arrastando: false, focoDentro: false };
  assert.equal(AppPlayerCore.podeEsconderControles(base), true, 'tocando e quieto: somem');

  assert.equal(AppPlayerCore.podeEsconderControles({ ...base, tocando: false }), false,
    'vídeo parado com controle sumido é a tela morta — e quem pausou pausou para mexer');
  assert.equal(AppPlayerCore.podeEsconderControles({ ...base, painelAberto: true }), false,
    'o painel de som pendura no botão de mudo: sumir levaria o painel junto');
  assert.equal(AppPlayerCore.podeEsconderControles({ ...base, arrastando: true }), false,
    'a barra é o retorno de posição no meio do arrasto');
  assert.equal(AppPlayerCore.podeEsconderControles({ ...base, focoDentro: true }), false,
    'foco preso num controle invisível é o pior resultado para quem usa teclado');

  assert.equal(AppPlayerCore.podeEsconderControles(), false, 'sem estado, não some');
});

/* A armadilha desta entrega, e ela é silenciosa: `Number(null)` é ZERO, e zero
 * aqui quer dizer "nunca some". Um catálogo sem o ajuste — o estado de todo
 * catálogo até alguém abrir o /admin — desligaria o sumiço, e o padrão de 3 s
 * nunca valeria para ninguém. */
test('"não configurado" não pode virar "nunca some"', () => {
  assert.equal(AppPlayerCore.SUMICO_PADRAO_S, 3);
  for (const vazio of [null, undefined, '']) {
    assert.equal(AppPlayerCore.segundosDeSumico(vazio), 3, 'valor vazio: ' + JSON.stringify(vazio));
  }
  /* Mas o zero escrito de propósito continua valendo. */
  assert.equal(AppPlayerCore.segundosDeSumico(0), 0);
  assert.equal(AppPlayerCore.segundosDeSumico('0'), 0);

  assert.equal(AppPlayerCore.segundosDeSumico(5), 5);
  assert.equal(AppPlayerCore.segundosDeSumico(-2), 3, 'negativo não é escolha');
  assert.equal(AppPlayerCore.segundosDeSumico('tarde'), 3);
  assert.equal(AppPlayerCore.segundosDeSumico(9000), AppPlayerCore.SUMICO_MAX_S);
});

test('o sumiço volta ao primeiro sinal de vida, e o teclado é um deles', () => {
  /* `opacity` e não `display: none`: o Tab ainda chega aos controles, e o
   * `focusin` os traz de volta antes de o foco pousar num botão invisível. */
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pl-sem-controles \.pl-controles \{ opacity: 0; pointer-events: none; \}/);
  assert.ok(!/\.pl-sem-controles \.pl-controles \{[^}]*display: none/.test(css),
    'display:none tiraria os controles do alcance do Tab');

  assert.match(PLAYER_CODIGO, /controles\.addEventListener\('focusin', acordarControles\)/);
  const teclar = PLAYER_CODIGO.match(/function aoTeclar\(ev\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(teclar, 'não achei aoTeclar em player.js');
  assert.match(teclar[1], /acordarControles\(\)/, 'apertar L sem ver a barra andar parece tecla morta');

  /* E o relógio morre com a ficha, como todos os outros. */
  const destruir = PLAYER_JS.match(/function destruir\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.match(destruir[1], /cancelarSumico\(\)/);
});

test('soltar o dedo devolve a velocidade que estava, não 1×', () => {
  const corpo = PLAYER_JS.match(/function velocidadeTemporaria\(ligada\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(corpo, 'não achei velocidadeTemporaria em player.js');
  assert.match(corpo[1], /velocidadeAntes = video\.playbackRate \|\| 1/,
    'quem estava em 1,5× pelo Shift+> tem que voltar para 1,5×');
  assert.match(corpo[1], /video\.playbackRate = velocidadeAntes/);
  assert.match(corpo[1], /video\.paused\) return/,
    'segurar num vídeo parado não é 2× de nada');
});

/* O item 3 depende de o navegador não roubar o gesto: no Android o menu de
 * contexto, no iOS a lupa e o "copiar". E o menu nativo do <video> oferece
 * "repetir" e "baixar" — a REGRA 2 e a pull zone. */
test('o menu de contexto do vídeo fica fora do caminho do segurar', () => {
  assert.match(PLAYER_CODIGO, /addEventListener\('contextmenu'/);
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /-webkit-touch-callout: none/);
  assert.match(css, /user-select: none/);
});

/* --------------- o painel de som encostado no ícone (04/09) ------------- */

/* Defeito relatado no uso: o painel fechava na cara de quem ia mexer no
 * volume. A causa era geometria — ele nascia ACIMA do botão, com 8 px de
 * respiro entre os dois, e esses 8 px não pertencem a `somCaixa` nem a filho
 * nenhum dela: o ponteiro que subisse do alto-falante até o controle
 * deslizante atravessava um vão que dispara `pointerleave`.
 *
 * Agora ele cresce para a ESQUERDA a partir da borda do botão, com o controle
 * deitado na mesma altura do ícone: o caminho do ponteiro é uma reta de 0 px
 * de espaço vazio. */
test('o painel de som encosta no ícone — vão nenhum entre os dois', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const painel = css.match(/\n\.pl-som \{([\s\S]*?)\n\}/);
  assert.ok(painel, 'não achei .pl-som em style.css');
  assert.match(painel[1], /right: 100%/,
    'o painel precisa encostar na borda do botão, sem vão');
  assert.ok(!/bottom: calc\(100% \+ \d+px\)/.test(painel[1]),
    'voltou o respiro entre o botão e o painel: é por ali que o ponteiro escapa');

  /* Os 9 px de baixo são medida, não gosto: o botão tem 44 px de altura e a
   * linha do volume, 26. (44 − 26) / 2 = 9 é o que põe o controle deslizante
   * no meio do ícone. Mexer num dos três números sem os outros desalinha. */
  assert.match(painel[1], /padding: 10px 12px 9px/);
  assert.match(css, /\.pl-b \{\n\s*flex: none; width: 44px; height: 44px;/);
  assert.match(css, /\.pl-som-faixa \{[^}]*height: 26px/);
});

/* E a ORDEM das linhas é geometria também: o CSS ancora o painel pelo pé, e
 * por isso a linha do volume é a ÚLTIMA — é ela que fica ao lado do ícone. O
 * "Volume estável" empilha logo ACIMA dela, que é onde foi pedido. */
test('o Volume estável fica acima do controle deslizante', () => {
  const pos = (nome) => PLAYER_CODIGO.indexOf('painel.appendChild(' + nome + ')');
  assert.ok(pos('linhaVol') > 0 && pos('rotEstavel') > 0 && pos('recadoSom') > 0,
    'não achei as três linhas do painel em player.js');
  assert.ok(pos('rotEstavel') < pos('linhaVol'),
    'o Volume estável tem que ser desenhado ANTES da linha do volume, para ficar acima dela');
  assert.ok(pos('recadoSom') < pos('rotEstavel'),
    'o recado sobe para o topo: a linha do volume é a que se alinha ao ícone');
});

/* Defeito relatado no uso, um dia depois: hover no alto-falante abre o painel,
 * um CLIQUE dentro dele (a caixinha, o Mudo, o controle deslizante) e o painel
 * não fechava mais ao tirar o mouse. Sem clique fechava; com clique, não.
 *
 * A causa era a guarda do teclado: `document.activeElement` fica no controle
 * clicado, e a linha que protegia quem chega pelo Tab passou a proteger também
 * quem só clicou. `:focus-visible` separa os dois — é o próprio navegador
 * dizendo se aquele foco merece anel, e ele responde `false` para o clique.
 * Conferido no navegador em 04/09, nos dois sentidos. */
test('o painel de som fecha ao sair, mesmo depois de um clique dentro dele', () => {
  const sai = PLAYER_CODIGO.match(
    /somCaixa\.addEventListener\('pointerleave'[\s\S]*?\n    \}\);/);
  assert.ok(sai, 'não achei o pointerleave do painel de som');
  assert.ok(!/painel\.contains\(document\.activeElement\)\) return/.test(sai[0]),
    'a guarda voltou a segurar QUALQUER foco: um clique no controle deixa o painel aberto');
  assert.match(sai[0], /focoDeTecladoNoPainel\(\)\) return/);

  /* Botão apertado é arrasto em curso. O `pointerleave` chega mesmo com
   * `buttons: 1` — medido —, e sem esta guarda o arrasto do volume morreria
   * pela metade toda vez que a mão transbordasse os 26 px da linha. */
  assert.match(sai[0], /if \(ev\.buttons\) return/,
    'sem isto o arrasto do volume morre ao transbordar o painel');

  const foco = PLAYER_CODIGO.match(
    /function focoDeTecladoNoPainel\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(foco, 'não achei focoDeTecladoNoPainel em player.js');
  assert.match(foco[1], /querySelector\(':focus-visible'\)/);
  /* E a reserva é a linha antiga, para navegador sem `:focus-visible`: ela erra
   * para o lado de não arrancar o painel de quem está no teclado. */
  assert.match(foco[1], /catch[\s\S]*painel\.contains\(document\.activeElement\)/);
});

/* ---------- titularidade e evidência saem da ficha (04/09) -------------- */

/* São classificação interna — quem responde pela obra e o quanto a origem foi
 * conferida —, e servem a quem cataloga, não a quem vai assistir. Saíram
 * também da projeção pública: campo que o site não desenha não precisa
 * viajar. O /admin continua com as duas, lendo o item cru por `?completo=1`. */
test('titularidade e evidência só existem no /admin', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.ok(!/linhaDados\(dl, 'Titularidade'/.test(app), 'a ficha voltou a mostrar titularidade');
  assert.ok(!/linhaDados\(dl, 'Evid/.test(app), 'a ficha voltou a mostrar o nível de evidência');

  const api = semComentarios(
    lerTexto(path.join(WORKER, 'api', 'catalogo.js')));
  const publico = api.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(publico, 'não achei paraPublico em catalogo.js');
  assert.ok(!/titularidade|nivel_evidencia/.test(publico[1]),
    'os dois campos voltaram para a resposta pública');

  /* E o /admin não perdeu nada: desde 15/09 os dois campos moram no inspetor
   * da mesa, que lê o catálogo inteiro, não a projeção. */
  const painel = lerTexto(path.join(SITE, 'mesa-painel.js'));
  assert.match(painel, /id: 'm-titularidade'/);
  assert.match(painel, /id: 'm-evidencia'/);
  assert.match(lerTexto(path.join(SITE, 'mesa-base.js')), /\/api\/catalogo\?completo=1/);
});

/* ============================ segredos ================================== */

/* O DIRETÓRIO INTEIRO DE `site/` VAI PARA O AR: `wrangler pages deploy .` sobe
 * todo arquivo que estiver lá, e é por isso que `scripts/` e `tests/` moram
 * fora. Em 16/09 um `wrangler pages dev` deixou dentro de `site/` a pasta
 * `.wrangler/`, com o KV local — catálogo e hash de senha — e ela chegou a
 * entrar num commit. Este teste é a rede: arquivo estranho aqui reprova antes
 * de virar ativo público. */
test('em site/ só mora o que pode ir para o ar', () => {
  const pastas = ['vendor', 'fontes', 'locales'];   /* locales: catálogos de texto gerados por idioma; fontes: woff2 do cliente, copiados de config/fontes/ pelo aplicar-config */
  const extensoes = ['.html', '.js', '.css', '.svg', '.png', '.ico', '.txt', '.webmanifest', '.woff2'];
  const especiais = ['_headers', 'config.public.json'];   /* config.public.json: gerado por scripts/aplicar-config.mjs, sem segredos */   /* cabeçalhos de segurança do Static Assets: não é servido como arquivo */
  const estranhos = fs.readdirSync(SITE).filter((nome) => {
    if (nome.startsWith('.') || nome === 'node_modules') return true;
    if (fs.statSync(path.join(SITE, nome)).isDirectory()) return !pastas.includes(nome);
    return !especiais.includes(nome) && !extensoes.includes(path.extname(nome).toLowerCase());
  });
  assert.deepEqual(estranhos, [],
    'isto iria para o ar no próximo deploy: ' + estranhos.join(', '));

  /* E nada de estado local escondido mais fundo. */
  const fundo = [];
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const cheio = path.join(dir, nome);
      if (!fs.statSync(cheio).isDirectory()) continue;
      if (nome === '.wrangler' || nome === 'node_modules') fundo.push(path.relative(SITE, cheio));
      else varrer(cheio);
    }
  };
  varrer(SITE);
  assert.deepEqual(fundo, [], 'estado local dentro de site/: ' + fundo.join(', '));
});

test('a AccessKey do Bunny não aparece em nenhum arquivo servido ao navegador', () => {
  /* A lista sai da PASTA, não de uma lista escrita à mão: a mesa trouxe quatro
   * arquivos novos de uma vez, e o próximo servido nasce coberto. */
  const servidos = fs.readdirSync(SITE).filter(n => /\.(js|html)$/.test(n));
  for (const esperado of ['app.js', 'catalogo-core.js', 'player.js', 'player-core.js', 'mesa-base.js',
    'mesa-painel.js', 'mesa-telas.js', 'mesa.js', 'index.html', 'admin.html']) {
    assert.ok(servidos.includes(esperado), 'a varredura perdeu ' + esperado);
  }
  const guid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  for (const arquivo of servidos) {
    const conteudo = lerTexto(path.join(SITE, arquivo));
    /* Citar a AccessKey num comentário é permitido; usá-la como header ou
     * variável, não. O que a busca procura é o uso, e a chave literal. */
    assert.ok(!/AccessKey\s*[:=]/.test(conteudo), arquivo + ' usa AccessKey como header/variável');
    assert.ok(!/BUNNY_API_KEY/.test(conteudo), arquivo + ' menciona BUNNY_API_KEY');
    assert.ok(!guid.test(conteudo), arquivo + ' contém um literal com cara de chave do Bunny');
  }
});

/* ============================ capa: um arquivo, dois fregueses ========== */

/* Armadilha de 08/09, ao encolher as capas: uma medição mediu a caixa do CARTÃO
 * (180 px no celular, 321 no computador) e concluiu que 360-400 px bastavam.
 * A mesma URL é o `poster` do player, num quadro de 881 px — a 400 px ele
 * subiria 2,2x. Este teste existe para que a próxima pessoa que for mexer no
 * tamanho da capa ESBARRE no segundo freguês antes de escolher o número. */
test('a capa também é o poster do player — quem encolher a capa mexe nos dois', () => {
  const player = lerTexto(path.join(SITE, 'player.js'));
  assert.match(player, /\.poster\s*=/,
    'player.js não define poster nenhum — se isso saiu de propósito, tire este teste junto');
  assert.match(player, /App\.urlCapa\(/,
    'o poster do player tem que sair de App.urlCapa, o mesmo lugar que a grade usa');

  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /App\.urlCapa\(/, 'a grade também tem que passar por urlCapa');
});

/* ============================ prateleiras e título curto (D2) =========== */

/* Um catálogo de MENTIRA com as armadilhas do de verdade. Não dá para usar o
 * `exemplo/catalogo.json` como base: o estado de publicação mora no KV, e o
 * arquivo local não é a fonte da verdade do que está no ar. E os testes rodam sem rede.
 *
 * O que este fixture reproduz, item por item:
 *   - uma série grande (3+), que vira linha própria;
 *   - duas séries pequenas, que caem em "Mais séries";
 *   - três curtas de séries diferentes, que viram a prateleira "Curtas";
 *   - institucionais CURTOS, que não podem entrar em "Até 5 minutos";
 *   - os prefixos e sufixos que o `tituloCurto` tem que podar — e os dois que
 *     ele tem que deixar em paz. */
const catalogoPrateleiras = [
  { id: 'sx1-1', titulo: 'Série Exemplo 1: Pescador artesanal', serie: 'Série Exemplo 1', episodio: 1, duracao_seg: 420, publicar: true },
  { id: 'sx1-2', titulo: 'Série Exemplo 1: Dentista', serie: 'Série Exemplo 1', episodio: 2, duracao_seg: 430, publicar: true },
  { id: 'sx1-3', titulo: 'Série Exemplo 1: Advogada', serie: 'Série Exemplo 1', episodio: 3, duracao_seg: 440, publicar: true },

  { id: 'enq-1', titulo: 'Série Exemplo 2: Tema Um (Episódio 1)', serie: 'Série Exemplo 2', episodio: 1, duracao_seg: 200, publicar: true },
  { id: 'enq-2', titulo: 'Série Exemplo 2: Tema Um (Episódio 2)', serie: 'Série Exemplo 2', episodio: 2, duracao_seg: 210, publicar: true },
  { id: 'enq-3', titulo: 'Série Exemplo 2: Tema Um (Episódio 3)', serie: 'Série Exemplo 2', episodio: 3, duracao_seg: 220, publicar: true },

  { id: 'mat-2', titulo: 'Série Exemplo 3: Tema Um (Episódio 2)', serie: 'Série Exemplo 3', episodio: 2, duracao_seg: 700, publicar: true },
  { id: 'mat-3', titulo: 'Série Exemplo 3: Tema Dois (Episódio 3)', serie: 'Série Exemplo 3', episodio: 3, duracao_seg: 710, publicar: true },
  { id: 'par-1', titulo: 'Série Exemplo 5: Tema Um (Episódio 1)', serie: 'Série Exemplo 5', episodio: 1, duracao_seg: 600, publicar: true },

  { id: 'cur-k', titulo: 'Curta A1', serie: 'Curtas — Exemplo A', duracao_seg: 120, publicar: true },
  { id: 'cur-l', titulo: 'Curta B1', serie: 'Curtas — Exemplo B', duracao_seg: 120, publicar: true },
  { id: 'cur-t', titulo: 'Curta A2', serie: 'Curtas — Exemplo A', duracao_seg: 120, publicar: true },

  { id: 'cam-1', titulo: 'Chamada Um', serie: 'Eventos', duracao_seg: 60, publicar: true },
  { id: 'cam-2', titulo: 'Chamada Dois', serie: 'Eventos', duracao_seg: 70, publicar: true },
  { id: 'cam-3', titulo: 'Chamada Três', serie: 'Eventos', duracao_seg: 80, publicar: true },
  { id: 'jor-1', titulo: 'Apresentação Exemplo: Visão Geral', serie: 'A classificar', duracao_seg: 3000, publicar: true },

  /* Não publicado: nenhuma prateleira pode mostrá-lo. */
  { id: 'oculto', titulo: 'Série Exemplo 1: Piloto', serie: 'Série Exemplo 1', episodio: 9, duracao_seg: 400, publicar: false }
];

/* A regra central, e a primeira que o projeto pede para conferir: a
 * chegada nova não pode ENGOLIR título. Uma prateleira esquecida não aparece
 * na tela como erro — aparece como um vídeo que ninguém acha mais. */
test('toda peça publicada entra em pelo menos uma prateleira', () => {
  const ps = App.prateleiras(catalogoPrateleiras);
  const vistos = new Set();
  for (const p of ps) for (const i of p.itens) vistos.add(i.id);

  const publicados = App.publicaveis(catalogoPrateleiras).map(i => i.id);
  for (const id of publicados) {
    assert.ok(vistos.has(id), id + ' publicado e fora de todas as prateleiras');
  }
  assert.ok(!vistos.has('oculto'), 'uma prateleira mostrou um título não publicado');
  assert.equal(vistos.size, publicados.length);
});

/* Herda a decisão do teste "a aba Todas é uma grade única": nada de linha com
 * um cartão só e a tela vazia à direita. Rolar de lado resolve a SOBRA das
 * séries grandes; não salva uma linha de uma capa só. */
test('nenhuma prateleira de série fica abaixo do mínimo de 3', () => {
  const ps = App.prateleiras(catalogoPrateleiras);
  const series = ps.filter(p => p.id.indexOf('serie:') === 0);
  assert.ok(series.length, 'nenhuma prateleira de série foi montada');
  for (const p of series) {
    assert.ok(p.itens.length >= App.MINIMO_PRATELEIRA,
      p.id + ' tem ' + p.itens.length + ' título(s) — abaixo do mínimo, devia ter caído em "Mais séries"');
  }
  /* E a série pequena tem que estar em "Mais séries", não sumida. */
  const mais = ps.find(p => p.id === 'mais-series');
  assert.ok(mais, 'sem "Mais séries" as séries de 1 e 2 títulos não têm onde cair');
  assert.deepEqual(mais.itens.map(i => i.id).sort(), ['mat-2', 'mat-3', 'par-1']);
});

/* Os agrupamentos são a rede que segura o resto: se um deles encolher abaixo
 * do mínimo, ele continua na tela. Sumir com ele para respeitar o mínimo
 * esconderia título — e esconder é pior do que uma linha curta. Quem decide o
 * que fazer nesse dia é uma pessoa, avisada por este teste. */
test('um agrupamento pequeno continua na tela em vez de engolir os títulos', () => {
  const magro = [
    { id: 'a', titulo: 'A', serie: 'Série Exemplo 3', duracao_seg: 900, publicar: true },
    { id: 'b', titulo: 'B', serie: 'Eventos', duracao_seg: 900, publicar: true }
  ];
  const ps = App.prateleiras(magro);
  const vistos = new Set();
  for (const p of ps) for (const i of p.itens) vistos.add(i.id);
  assert.deepEqual([...vistos].sort(), ['a', 'b'],
    'com pouco material as prateleiras sumiram e levaram os títulos junto');
});

/* "Até 5 minutos" é para quem quer ver algo rápido: uma chamada institucional
 * de 60 segundos cabe no tempo, mas não é o que alguém procura ali. */
test('a prateleira de até 5 minutos não recolhe institucional curto', () => {
  const curtos = App.prateleiras(catalogoPrateleiras).find(p => p.id === 'curtos');
  assert.ok(curtos, 'a prateleira de duração sumiu');
  for (const i of curtos.itens) {
    assert.notEqual(App.classeDaSerie(i.serie), 'institucional',
      i.id + ' é institucional e entrou na prateleira de curtos');
    assert.ok(i.duracao_seg <= 300, i.id + ' passa de 5 minutos');
  }
  assert.deepEqual(curtos.itens.map(i => i.id).sort(),
    ['cur-k', 'cur-l', 'cur-t', 'enq-1', 'enq-2', 'enq-3']);
});

/* A TRAVA: "pedagógico" e "institucional" não existem como dado, e uma lista
 * escrita à mão esquece série nova. Em produção a desconhecida é tratada como
 * pedagógica e aparece em "Mais séries" — o site não esconde título por lista
 * desatualizada. Quem garante que as listas do código são coerentes é este
 * teste: nenhuma série em duas listas, e toda série do catálogo de exemplo
 * cai numa classe válida. (Cada instalação troca as listas pelas suas, ou usa
 * `site.classes`; o invariante continua o mesmo.) */
test('toda série está em exatamente uma coleção e tem uma classe válida', () => {
  /* As coleções de sempre (curtas e institucional) listam séries de exemplo; nenhuma série pode estar
   * em duas delas, e toda série do catálogo de exemplo cai numa classe válida. */
  const colecoes = App.colecoesEfetivas(null);
  const conta = Object.create(null);
  for (const c of colecoes) {
    assert.ok(Array.isArray(c.series) && c.series.length > 0, 'a coleção ' + c.id + ' ficou sem séries');
    for (const serie of c.series) conta[serie] = (conta[serie] || 0) + 1;
  }
  for (const serie of Object.keys(conta)) {
    assert.equal(conta[serie], 1, '"' + serie + '" está em mais de uma coleção');
  }

  /* Toda série do catálogo de exemplo tem classe, listada ou pelo padrão. */
  const exemplo = JSON.parse(lerTexto(path.join(__dirname, '..', 'exemplo', 'catalogo.json')));
  for (const serie of new Set(exemplo.itens.map(i => i.serie))) {
    assert.ok(App.CLASSES_SERIE.includes(App.classeDaSerie(serie)),
      '"' + serie + '" não tem classe válida');
  }
});

/* O "Ver tudo" tem que cair na MESMA regra que desenhou a linha, e não numa
 * cópia dela do lado do app.js. Uma regra escrita duas vezes vira duas regras
 * no dia em que alguém mexer numa delas. */
test('o "Ver tudo" acha a prateleira pelo mesmo id que a chegada desenhou', () => {
  for (const p of App.prateleiras(catalogoPrateleiras)) {
    const achada = App.prateleiraPorId(catalogoPrateleiras, p.id);
    assert.ok(achada, 'prateleiraPorId não achou ' + p.id);
    assert.deepEqual(achada.itens.map(i => i.id), p.itens.map(i => i.id));
    assert.equal(achada.titulo, p.titulo);
  }
  assert.equal(App.prateleiraPorId(catalogoPrateleiras, 'serie:Não Existe'), null);
});

/* Os casos vieram dos dados de 10/09, e cada linha aqui é uma armadilha que
 * uma regra ingênua cairia. */
test('o prefixo do título só sai quando bate com a série', () => {
  const curto = (titulo, serie) => App.tituloCurto({ titulo, serie });

  /* o prefixo É a série */
  assert.equal(curto('Série Exemplo 1: Pescador artesanal', 'Série Exemplo 1'), 'Pescador artesanal');
  /* o prefixo COMEÇA a série */
  assert.equal(curto('Série Exemplo 4: Assunto Um', 'Série Exemplo 4'), 'Assunto Um');
  /* singular e plural: "Módulo" começa "Módulos" */
  assert.equal(curto('Módulo: Assunto Três', 'Módulos'), 'Assunto Três');

  /* NÃO bate: o prefixo é outro assunto, e cortá-lo apagaria informação que a
   * linha da prateleira não mostra. */
  assert.equal(curto('Programa Externo: Série Exemplo 5', 'Série Exemplo 5'), 'Programa Externo: Série Exemplo 5');
  assert.equal(curto('Apresentação Exemplo: Visão Geral', 'A classificar'), 'Apresentação Exemplo: Visão Geral');

  /* sem dois-pontos não há o que podar */
  assert.equal(curto('Curta A2', 'Curtas — Exemplo A'), 'Curta A2');
  /* poda que comeria o título inteiro devolve o original */
  assert.equal(curto('Série Exemplo 2:', 'Série Exemplo 2'), 'Série Exemplo 2:');
  assert.equal(curto('', 'Série Exemplo 2'), '');
});

/* Tirar o sufixo CRIA COLISÃO, e isso foi aceito de olhos abertos: sobram
 * cinco "Literatura e cidadania" e três "Português". O que desfaz a colisão é
 * a linha de baixo do cartão — e ela tem que dizer a mesma palavra que o vídeo
 * diz. A Série Exemplo 4 é numerado em "Parte"; mostrar "E3" ali troca o nome das
 * coisas para quem procura o episódio certo. */
test('o número do episódio sai do nome e reaparece na linha de baixo', () => {
  const it = { titulo: 'Série Exemplo 4: Assunto Um (Parte 3)', serie: 'Série Exemplo 4', episodio: 3 };
  assert.equal(App.tituloCurto(it), 'Assunto Um');
  assert.equal(App.rotuloNumero(it), 'Parte 3');

  const ep = { titulo: 'Série Exemplo 2: Tema Um (Episódio 2)', serie: 'Série Exemplo 2', episodio: 2 };
  assert.equal(App.tituloCurto(ep), 'Tema Um');
  assert.equal(App.rotuloNumero(ep), 'Episódio 2');

  /* sem sufixo no nome, o número vem do campo */
  assert.equal(App.rotuloNumero({ titulo: 'Dentista', serie: 'Série Exemplo 1', episodio: 2 }), 'Episódio 2');
  /* sem campo e sem sufixo, não inventa número */
  assert.equal(App.rotuloNumero({ titulo: 'Podcast', serie: 'Podcast / Bate-papo' }), '');

  /* A colisão é real, e o teste a fixa: se um dia ela for resolvida por outro
   * caminho, é aqui que a decisão aparece. */
  const partes = [1, 2, 3, 4, 5].map(n => App.tituloCurto({
    titulo: 'Série Exemplo 4: Assunto Um (Parte ' + n + ')',
    serie: 'Série Exemplo 4'
  }));
  assert.equal(new Set(partes).size, 1, 'os cinco deviam colidir — quem os separa é rotuloNumero');
});

/* ---------------------------- a chegada desenhada ----------------------- */

/* A grade NÃO morreu: ela é a resposta da busca, do chip de série e do "Ver
 * tudo". O que mudou foi a chegada. Se este desvio sumir, o site volta a abrir
 * numa grade de 66 cartões e a fase D2 desaparece sem ninguém notar — a tela
 * continua funcionando, só deixa de ser a que foi decidida. */
test('a chegada é prateleira, e a grade é a resposta a uma pergunta', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei renderGrade em app.js');
  assert.match(corpo[1], /renderChegada\(\)/,
    'renderGrade não desvia mais para as prateleiras — a chegada virou grade de novo');
  assert.match(corpo[1], /estado\.termo[\s\S]*estado\.serie[\s\S]*estado\.prateleira/,
    'o desvio para a chegada tem que olhar termo, série E prateleira');
  assert.match(app, /function renderChegada\(\)/, 'renderChegada sumiu');
  /* A regra é a mesma; o nome da função mudou na M4, quando a prateleira
   * escondida passou a existir: a chegada desenha as VISÍVEIS, e a lista
   * inteira continua saindo de `prateleiras()` para o "Ver tudo" e a mesa. */
  /* Desde a M6 a chegada vem dos blocos: `App.home` devolve a sequência (destaque, fileiras, textos), e a
   * escondida continua fora da tela (renderChegada pula `escondida`). */
  assert.match(app, /App\.home\(/, 'a chegada não monta mais as prateleiras pelo core');
});

/* O leitor de tela precisa ouvir "Até 5 minutos — lista, 17
 * itens", e não dezessete links soltos no meio da página. */
test('cada prateleira é uma seção rotulada, com os cartões numa lista', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function prateleira\(p\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei a função prateleira em app.js');
  assert.match(corpo[1], /criar\('section'/, 'a prateleira deixou de ser uma <section>');
  assert.match(corpo[1], /aria-labelledby/, 'a <section> perdeu o rótulo — o leitor não sabe que linha é essa');
  assert.match(corpo[1], /criar\('ul'/, 'os cartões saíram da <ul> — o leitor deixa de anunciar quantos são');
});

/* As setas repetem um caminho que o Tab já oferece. Deixá-las tabuláveis põe
 * duas paradas a mais entre cada prateleira e a seguinte — dez prateleiras
 * viram vinte paradas inúteis para quem atravessa a página pelo teclado. */
test('as setas da prateleira ficam fora do caminho do teclado', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/var faz = function \(dir, rotulo\) \{([\s\S]*?)\n    \};/);
  assert.ok(corpo, 'não achei a fábrica de setas em app.js');
  assert.match(corpo[1], /tabIndex = -1/, 'a seta entrou na ordem do Tab');
  assert.match(corpo[1], /aria-hidden['"]?,\s*['"]true/, 'a seta não está escondida do leitor de tela');
});

/* Quem tem dedo arrasta — e o pedaço do próximo cartão é o convite. A seta é
 * para quem tem ponteiro fino, e é o CSS que decide, pela mesma pergunta que
 * `podePreview()` faz no app.js. */
test('as setas da prateleira só aparecem onde há ponteiro fino', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.prateleira-seta\s*\{\s*display:\s*none/,
    'a seta não nasce escondida — em toque ela ocuparia a linha sem servir para nada');
  /* TODAS as consultas de ponteiro fino, e não a primeira: na D4 a reserva de
   * altura dos chips ganhou uma consulta igual, mais acima no arquivo, e o
   * teste passou a ler a errada e reprovar com as setas no lugar. */
  const consultas = [...css.matchAll(/@media \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n\}/g)]
    .map(m => m[1]).join('\n');
  assert.ok(consultas, 'sumiu a consulta de ponteiro fino que liga as setas');
  assert.match(consultas, /\.prateleira-seta/, 'as setas saíram da consulta de ponteiro fino');
});

/* ---------------------------------------------------------------------------
 * O conserto de 17/09, e os três testes que impedem a volta dele. O defeito
 * chegou por relato de quem usava no desktop, e foi medido na página no ar.
 * ------------------------------------------------------------------------- */

/* A RAIZ: as setas moravam DENTRO da pista, e uma caixa `position: absolute`
 * dentro de um `overflow-x: auto` se prende ao conteúdo QUE ROLA, não à
 * moldura que o mostra. Medido com a pista em 1368 px: um clique na seta
 * direita levava o scrollLeft a 84 e arrastava as DUAS setas 84 px para a
 * esquerda junto — a da esquerda parava em x = -55, fora da tela, bem no
 * instante em que passava a ter serventia, e a da direita descolava da borda e
 * ia caminhando para o meio da linha. */
test('as setas da prateleira se penduram no palco, que não rola', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function prateleira\(p\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei a função prateleira em app.js');
  assert.match(corpo[1], /criar\('div', 'prateleira-palco'\)/, 'sumiu o palco da prateleira');
  assert.match(corpo[1], /palco\.appendChild\(faz\('esq'/, 'a seta da esquerda saiu do palco');
  assert.match(corpo[1], /palco\.appendChild\(faz\('dir'/, 'a seta da direita saiu do palco');
  assert.ok(!/pista\.appendChild\(faz\(/.test(corpo[1]),
    'uma seta voltou para dentro da pista — é a pista que rola, e ela leva a seta junto');

  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.prateleira-palco\s*\{[^}]*position:\s*relative/,
    'o palco deixou de ser a moldura parada das setas');
  /* A regra da pista, e só ela: o `m` amarra a busca ao começo da LINHA, então
   * a palavra dentro do comentário que explica a ausência não conta como
   * declaração. */
  const pista = css.match(/\.prateleira-pista\s*\{([\s\S]*?)\n\}/);
  assert.ok(pista, 'não achei a regra da pista');
  assert.ok(!/^\s*position:\s*relative/m.test(pista[1]),
    'a pista voltou a ser `position: relative` — e volta a arrastar a seta com o conteúdo');
});

/* A seta que chegou ao fim não fica no canto pedindo um clique que não leva a
 * lugar nenhum — e a que nunca teve para onde ir não nasce. São cinco das onze
 * prateleiras da chegada que cabem inteiras em 1440 px. */
test('a seta da prateleira sai da tela quando não tem para onde levar', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function ajustarSetas\(pista\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei ajustarSetas em app.js');
  assert.match(corpo[1], /prateleira-seta-quieta/, 'sumiu a classe que apaga a seta sem serventia');
  assert.match(corpo[1], /scrollLeft <= 2/, 'a seta da esquerda não sai mais no começo da pista');
  assert.match(corpo[1], /scrollLeft \+ pista\.clientWidth >= pista\.scrollWidth - 2/,
    'a seta da direita não sai mais no fim da pista');

  const css = lerTexto(path.join(SITE, 'style.css'));
  const quieta = css.match(/\.prateleira-seta-quieta[^{}]*\{([^}]*)\}/);
  assert.ok(quieta, 'não achei a regra da seta quieta');
  assert.match(quieta[1], /opacity:\s*0/, 'a seta sem serventia continua aparecendo');
  assert.match(quieta[1], /pointer-events:\s*none/,
    'a seta sem serventia continua engolindo, de invisível, o clique no cartão embaixo dela');
});

/* Três gatilhos, porque são três maneiras de a resposta mudar: a pessoa rola,
 * a janela muda de largura, e a página acaba de ser desenhada. Faltando o
 * primeiro, a seta só se acerta no clique e não no arrasto do trackpad;
 * faltando o segundo, a linha que cabia inteira em 1440 px continua sem seta
 * em 1100. */
/* O clique do mouse dá foco ao botão, e o `:focus-within` do palco mantinha as
 * DUAS setas acesas depois que o ponteiro ia embora — a linha ficava piscada
 * sozinha. Só se via nas prateleiras compridas: na curta o mesmo clique chega
 * ao fim, a seta vira `quieta` e o defeito ficava escondido por baixo.
 *
 * Medido na página: com foco na própria seta, a opacidade casada dela é 1; sem
 * foco, 0. O foco num CARTÃO da pista continua acendendo — esse é o caso
 * legítimo, e é dele que a regra do `:focus-within` trata. */
test('a seta da prateleira não fica acesa depois do clique', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/var faz = function \(dir, rotulo\) \{([\s\S]*?)\n    \};/);
  assert.ok(corpo, 'não achei a fábrica de setas em app.js');
  assert.match(corpo[1], /addEventListener\('mousedown', function \(e\) \{ e\.preventDefault\(\); \}\)/,
    'a seta voltou a pegar foco no clique — e o `:focus-within` do palco a deixa acesa sozinha');

  /* A regra que acende continua sendo a do palco: é ela que o foco na seta
   * disparava, e é por isso que o `mousedown` barrado é a guarda dela. */
  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.prateleira-palco:focus-within \.prateleira-seta \{[^}]*opacity:\s*1/,
    'sumiu a regra que acende a seta quando um cartão da pista tem foco');
});

test('as setas se ajustam à rolagem, à largura e à primeira pintura', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function prateleira\(p\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei a função prateleira em app.js');
  assert.match(corpo[1], /addEventListener\('scroll'[\s\S]{0,80}?passive: true/,
    'a prateleira não ouve mais a própria rolagem — a seta fica com o estado velho');
  assert.match(corpo[1], /observadorDePista\.observe\(pista\)/,
    'a pista saiu do observador de largura');

  assert.match(semComentarios(app), /typeof ResizeObserver === 'undefined'/,
    'o observador de largura entrou sem a guarda de quem não o tem');

  const chegada = app.match(/function renderChegada\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(chegada, 'não achei renderChegada em app.js');
  assert.match(chegada[1], /ajustarSetas\(pistas\[i\]\)/,
    'a chegada não ajusta as setas depois de pôr as prateleiras na página');
});

/* A mesma regra das três: nada desliza, nada cresce, nada anima para quem
 * pediu menos movimento. A prévia já está barrada no app.js. */
test('a prateleira não desliza nem cresce com movimento reduzido', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const blocos = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
    .map(m => m[1]).join('\n');
  assert.ok(blocos, 'sumiu o bloco de movimento reduzido');
  assert.match(blocos, /\.prateleira-pista[^}]*scroll-behavior:\s*auto/,
    'a rolagem suave continua ligada para quem pediu menos movimento');
  assert.match(blocos, /\.pcard[^{]*\{[^}]*transform:\s*none|\.pcard:hover[^{]*\{[^}]*transform:\s*none/,
    'o cartão da prateleira continua crescendo com movimento reduzido');
});

/* A caixa da capa guardada DOS DOIS LADOS: o `aspect-ratio` na folha, e o
 * `width`/`height` no <img>, que vale mesmo antes de a folha aplicar.
 *
 * Este comentário dizia, na D2, que a capa era a dona do CLS de 0,0985 e que a
 * chegada nova tinha medido 0. As duas coisas estavam erradas, e foram
 * desfeitas na D4: o dono era o rodapé (ver o teste logo abaixo), e o "0" era
 * uma medida que não enxergava o salto. O teste fica, pela razão verdadeira. */
test('a capa do cartão da prateleira reserva a caixa antes de chegar', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function cartaoPrateleira\(item, mostrarSerie\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei cartaoPrateleira em app.js');
  assert.match(corpo[1], /img\.width = 640/, 'a capa perdeu a largura declarada');
  assert.match(corpo[1], /img\.height = 360/, 'a capa perdeu a altura declarada');
  assert.match(corpo[1], /loading = ['"]lazy/, 'a capa da prateleira deixou de ser preguiçosa');

  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.pcard-capa\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/,
    'a caixa da capa perdeu a proporção 16/9');
});

/* O CLS DA CHEGADA, com o dono certo. Medido em 14/09 em 375×812, com a API
 * atrasada e os dois quadros forçados a desenhar — e com CONTRAPROVA: tirando
 * as três regras abaixo, o mesmo método volta a dar 0,0985, dono o rodapé.
 *
 *   1. o RODAPÉ: com o <main> vazio ele ficava em y=108, dentro da tela, e ia
 *      para y=2850 quando o catálogo chegava. `min-height: 100vh` o faz nascer
 *      abaixo da dobra;
 *   2. os CHIPS: a linha nascia vazia e empurrava a página ao ganhar os chips
 *      (0,0395 depois do conserto 1). Reserva medida: 41 px, e 51 com a barra
 *      de rolagem clássica. SAIU NA D5, junto com os chips, que foram para a
 *      grade e são desenhados no mesmo quadro que os cartões. Quem guarda a
 *      porta agora é "o cabeçalho tem o logo, dois links e a busca": nenhuma
 *      caixa vazia no <header>;
 *   3. a MARGEM do primeiro filho colapsava através do <main> e o deslocava
 *      8 px (0,0082 depois dos consertos 1 e 2). O destaque usa padding, e o
 *      `flow-root` fecha a porta para os filhos que vierem.
 *
 * Nenhuma dessas três quebraria teste nenhum ao sair — a página continua
 * idêntica depois de carregada. É por isso que existe este. */
test('a chegada não salta quando o catálogo chega', () => {
  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));

  const main = css.match(/#conteudo\s*\{([^}]*)\}/);
  assert.ok(main, 'sumiu a regra de #conteudo — o rodapé volta a saltar');
  assert.match(main[1], /min-height:\s*100vh/, 'o <main> perdeu a altura mínima — o rodapé nasce dentro da tela');
  assert.match(main[1], /display:\s*flow-root/, 'o <main> voltou a deixar a margem do primeiro filho colapsar');

  /* Uma reserva de altura sobrando, sem os chips no cabeçalho, seria só um
   * buraco de 41 px na grade. */
  const chips = css.match(/\n\.chips\s*\{([^}]*)\}/);
  assert.ok(!chips || !/min-height/.test(chips[1]),
    'sobrou a reserva de altura da linha de chips, que saiu do cabeçalho na D5');

  /* Todas as regras de `.destaque` — a base e a do celular. Nenhuma pode pôr
   * margem em cima: nem `margin-top`, nem um `margin:` cujo primeiro valor
   * (o de cima) não seja 0. */
  const regrasDestaque = [...css.matchAll(/(?:^|\n)\s*\.destaque\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(regrasDestaque.length >= 2, 'esperava a regra base de .destaque e a do celular');
  for (const corpo of regrasDestaque) {
    assert.ok(!/margin-top\s*:/.test(corpo),
      'o destaque voltou a ter margin-top — ela colapsa através do <main>: ' + corpo.trim());
    const atalho = corpo.match(/(?:^|;)\s*margin\s*:\s*([^;]+)/);
    if (atalho) {
      assert.equal(atalho[1].trim().split(/\s+/)[0], '0',
        'o `margin` do destaque tem valor em cima — ele colapsa através do <main>');
    }
  }
  assert.ok(regrasDestaque.some(c => /padding-top/.test(c)), 'o destaque perdeu o respiro de cima');
});

/* Na linha da série, o nome dela já está escrito acima em letra grande. Foi o
 * que a conferência de 14/09 em 375 px mostrou: o cartão dizia "Advogada" e,
 * logo abaixo, "Série Exemplo 1" — a repetição que o `tituloCurto` tinha
 * acabado de tirar do título. */
test('o cartão só repete a série quando a prateleira mistura séries', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function cartaoPrateleira\(item, mostrarSerie\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei cartaoPrateleira em app.js');
  assert.match(corpo[1], /if \(mostrarSerie && item\.serie\)/,
    'o cartão voltou a imprimir a série sem perguntar em que prateleira está');

  const linha = app.match(/var misturaSeries = ([^;]+);/);
  assert.ok(linha, 'sumiu a decisão de quando mostrar a série');
  assert.match(linha[1], /serie:/, 'a decisão deixou de olhar o id da prateleira de série');

  /* E a sinopse não entra no cartão da prateleira: ela fica no destaque, na
   * ficha e na grade da busca, onde alguém está escolhendo entre parecidos. */
  assert.ok(!/resumoSinopse/.test(corpo[1]),
    'a sinopse voltou ao cartão da prateleira — ali a capa é quem fala');
});

/* ============================ o destaque (D4) =========================== */

/* QUARTA vez que este bug é guardado — capa, capítulos, framerate e agora o
 * destaque. Sem esta linha a escolha feita no /admin chega ao KV e nunca chega
 * ao navegador, e o sintoma é o pior possível: nenhum. A chegada mostra o
 * destaque PADRÃO, que é um título de verdade, e ninguém desconfia que o
 * botão do /admin não faz nada. */
test('a projeção pública leva o destaque — sem ele a escolha do /admin some', () => {
  const fn = lerTexto(path.join(WORKER, 'api', 'catalogo.js'));
  const proj = fn.match(/function paraPublico\(item\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(proj, 'não achei paraPublico em core/worker/api/catalogo.js');
  assert.match(proj[1], /destaque:\s*item\.destaque === true/,
    'paraPublico precisa incluir destaque, e só como true');
});

const catalogoDestaque = () => catalogoPrateleiras.map(i => Object.assign({}, i));

test('sem marca, o destaque é o primeiro título da maior série pedagógica', () => {
  const d = App.destaque(catalogoDestaque());
  /* A maior série do fixture é Série Exemplo 1 (3) — Série Exemplo 2 também tem 3,
   * e o desempate por nome põe Série Exemplo 1 na frente. O primeiro dela pela ordem
   * de `ordenar()` é o episódio 1. */
  assert.equal(d.id, 'sx1-1');
  /* E sai da MESMA prateleira que a chegada desenha: a regra não é escrita
   * duas vezes. */
  const primeiraDeSerie = App.prateleiras(catalogoDestaque()).find(p => p.id.indexOf('serie:') === 0);
  assert.equal(d.id, primeiraDeSerie.itens[0].id);
});

test('o título marcado no /admin vence o padrão', () => {
  const itens = catalogoDestaque();
  itens.find(i => i.id === 'cam-2').destaque = true;
  assert.equal(App.destaque(itens).id, 'cam-2');
});

/* O destaque é a primeira coisa que a chegada mostra. Destacar um título
 * despublicado seria VAZÁ-LO — e o KV é escrito por script além da tela, então
 * a marca pode sobrar num item que foi despublicado depois. */
test('marca num título não publicado não vale', () => {
  const itens = catalogoDestaque();
  itens.find(i => i.id === 'oculto').destaque = true;
  const d = App.destaque(itens);
  assert.notEqual(d.id, 'oculto', 'o destaque mostrou um título não publicado');
  assert.equal(d.id, 'sx1-1', 'com a única marca inválida, o padrão tinha que valer');
});

/* Dois marcados não é estado que a tela produz — ela desmarca os outros na
 * mesma gravação —, mas o KV não tem só a tela escrevendo nele. O que não
 * pode acontecer é o destaque depender da ORDEM dos itens no KV: aí ele
 * mudaria sozinho na próxima gravação de qualquer outro título. */
test('dois títulos marcados não quebram, e o escolhido não depende da ordem do KV', () => {
  const itens = catalogoDestaque();
  itens.find(i => i.id === 'enq-3').destaque = true;
  itens.find(i => i.id === 'sx1-2').destaque = true;
  const umaOrdem = App.destaque(itens).id;
  const outraOrdem = App.destaque(itens.slice().reverse()).id;
  assert.equal(umaOrdem, outraOrdem, 'o destaque mudou só porque a lista veio em outra ordem');
  assert.equal(umaOrdem, 'sx1-2', 'entre dois marcados fica o primeiro pela ordem de ordenar()');
});

test('catálogo vazio não tem destaque, e não lança', () => {
  assert.equal(App.destaque([]), null);
  assert.equal(App.destaque(null), null);
  assert.equal(App.destaque([{ id: 'x', titulo: 'X', serie: 'Série Exemplo 2', publicar: false }]), null);
});

/* A imagem do destaque é o LCP da chegada, e as duas escolhas abaixo são o
 * que a põe na frente: prioridade alta, e NUNCA preguiçosa — uma imagem
 * `lazy` no topo espera o layout para começar a baixar. E nenhuma prévia:
 * um preview.webp é 1,13 MB na mediana, mais do que as 66 capas juntas. */
test('a capa do destaque é o LCP: prioridade alta, sem lazy, sem prévia', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const corpo = app.match(/function destaqueHtml\(item\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei destaqueHtml em app.js');
  const codigo = semComentarios(corpo[1]);
  assert.match(codigo, /setAttribute\('fetchpriority', 'high'\)/,
    'a imagem do destaque perdeu a prioridade alta');
  assert.ok(!/loading\s*=/.test(codigo), 'a imagem do destaque ficou preguiçosa — o LCP espera o layout');
  assert.ok(!/ligarPreview\(/.test(codigo), 'o destaque ganhou prévia animada');
  assert.ok(!/urlPreview\(/.test(codigo), 'o destaque pede o preview.webp');
  assert.match(codigo, /img\.width = 640/, 'a capa do destaque perdeu o tamanho reservado');
});

/* O ACHADO DA D4. A D5 decidiu que "Assistir" dá o play, e a D4 tentou ligar
 * isso daqui — e não dá: a REGRA 1 do player admite UMA chamada de play(), em
 * `alternarPlay`, que é também quem libera o download (`hls.startLoad()`). Um
 * `.play()` neste arquivo abriria um segundo lugar de onde o vídeo começa, e
 * nem tocaria. O caminho foi o player oferecer uma entrada que passa por
 * `alternarPlay` — o `tocar()` da D6. Este teste é o que impede o atalho. */
test('o app.js não chama play() — quem começa o vídeo é o player', () => {
  const codigo = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  assert.ok(!/\.play\s*\(/.test(codigo),
    'app.js chama play() — isso é um segundo lugar de onde o vídeo começa, fora de alternarPlay');
});

/* O "ASSISTIR" DÁ O PLAY (D6), e as portas que o pedido não pode abrir: viajar
 * na URL (um link que tocasse sozinho tocaria para quem só o abriu), ligar por
 * Ctrl+clique (a outra aba não passa por aqui, e o pedido sobraria) e sobrar de
 * uma tela para a outra. */
test('o "Assistir" pede o play por clique, e o pedido não viaja na URL nem sobra', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const ligar = app.match(/function ligarAssistir\(link, id\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(ligar, 'não achei ligarAssistir em app.js');
  assert.match(ligar[1], /ev\.button !== 0 \|\| ev\.ctrlKey \|\| ev\.metaKey \|\| ev\.shiftKey \|\| ev\.altKey\) return;/,
    'o pedido de tocar liga com Ctrl+clique — a outra aba não passa por aqui, e ele sobraria');
  assert.match(ligar[1], /pedidoDeTocar = id/);

  const destaque = app.match(/function destaqueHtml\(item\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(destaque[1], /ligarAssistir\(assistir, item\.id\)/, 'o "Assistir" do destaque não pede mais o play');
  assert.match(destaque[1], /assistir\.href = '#\/ep\/' \+ encodeURIComponent\(item\.id\);/,
    'o link do "Assistir" mudou — o pedido de tocar não pode viajar na URL');

  /* O roteador gasta o pedido em TODA troca de tela, antes de qualquer desvio. */
  const rotear = app.match(/function rotear\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(rotear[1], /var pedido = pedidoDeTocar;\s*pedidoDeTocar = '';/,
    'o roteador deixou de consumir o pedido — um clique perdido tocaria na próxima visita');
  assert.ok(rotear[1].indexOf("pedidoDeTocar = ''") >= 0 &&
    rotear[1].indexOf("pedidoDeTocar = ''") < rotear[1].indexOf('if (ficha)'),
    'o pedido só é gasto em parte das telas');
  assert.match(rotear[1], /renderFicha\(ficha\.id, pedido === ficha\.id, ficha\.t\)/,
    'a ficha toca um título que não foi o pedido');

  /* Quem toca é o player, uma vez, no fim da ficha montada — e só o roteador
   * passa o pedido: o deslize ↓ e a mesa remontam a ficha com o vídeo parado. */
  const ficha = app.match(/function renderFicha\(id, tocar, momento, jaEsperou\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(ficha[1], /if \(tocar && playerAtivo\) playerAtivo\.tocar\(\);\s*$/,
    'o play do "Assistir" saiu do fim da ficha, ou deixou de depender do pedido');
  assert.equal((app.match(/\.tocar\(\)/g) || []).length, 1, 'apareceu outro lugar que manda o player tocar');
  /* A segunda chamada é a própria ficha voltando da espera pelo player (LCP,
   * 23/09): ela repassa o MESMO pedido que o roteador lhe deu, não cria um. */
  const chamadas = [...app.matchAll(/(?<!function )renderFicha\(([^)]*)\)/g)].map(m => m[1]);
  assert.deepEqual(chamadas.filter(a => a.includes(',')),
    ['id, tocar, momento, true', 'ficha.id, pedido === ficha.id, ficha.t'],
    'outro caminho passou a remontar a ficha tocando');

  /* O TRECHO DA BUSCA pede o play pelo mesmo caminho:
   * o MOMENTO viaja na URL (`?t=`), e o pedido de tocar, não. */
  const trecho = app.match(/function linkDoTrecho\(t, casadasDaBusca\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(trecho, 'não achei linkDoTrecho em app.js');
  assert.match(trecho[1], /a\.href = App\.linkDaFicha\(t\.item\.id, t\.inicio\);/);
  assert.match(trecho[1], /ligarAssistir\(a, t\.item\.id\)/, 'o clique no trecho não pede o play');
  assert.equal(App.linkDaFicha('exemplo-ep-2024-master', 399.8), '#/ep/exemplo-ep-2024-master?t=399');
});

/* O destaque é UM. Escolher um título tem que apagar a marca dos outros NA
 * MESMA gravação: em duas — desmarca, depois marca — uma falha de rede no meio
 * deixaria a chegada sem marca nenhuma, e duas telas abertas deixariam duas.
 *
 * Desde a mesa (15/09) a troca é um rascunho, e o Publicar grava tudo num PUT
 * só. Desde a M4 o que se grava é o ID em `site.destaque`, e a marca antiga
 * nos títulos é apagada junto: enquanto uma sobrar no KV, ela é quem vale para
 * quem não escolheu nada, e duas fontes para a mesma coisa envelhecem
 * separadas. A regra mora em dois lugares, e os dois são cobrados aqui e no
 * bloco do rascunho, no core. */
test('destacar na mesa grava o id e apaga as marcas antigas, num rascunho só', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  const corpo = base.match(/M\.destacar = function \(id, ligar\) \{([\s\S]*?)\n  \};/);
  assert.ok(corpo, 'não achei M.destacar em mesa-base.js');
  assert.match(corpo[1], /i\.destaque === true\) registrar\(i\.id, 'destaque', null\)/,
    'destacar deixou de apagar a marca antiga dos títulos');
  assert.match(corpo[1], /registrar\('site', 'destaque', ligar \? id : null\)/,
    'a escolha do destaque saiu do rascunho, ou deixou de ser o id em site.destaque');
  assert.equal((corpo[1].match(/aoMudar\(/g) || []).length, 1,
    'a troca de destaque virou mais de uma mudança — deixou de ser uma coisa só');

  /* E o botão só existe para título no ar: destacar um fora do ar o vazaria. */
  const painel = semComentarios(lerTexto(path.join(SITE, 'mesa-painel.js')));
  assert.match(painel, /if \(it\.publicar === true\) \{[\s\S]{0,1400}'f-destaque'/,
    'o botão de destacar aparece para título fora do ar');
});

/* ============================ o tema vem do config (M3) ================= */

/* Era "um tema só, e escuro" (D1). Desde o M3 o tema é escolha do cliente — preset,
 * modo claro/escuro/auto, cores —, e quem DECIDE é o theme.css, gerado do config.
 * O que o teste protege agora é a divisão de trabalho: a folha do catálogo e a da
 * mesa não decidem tema (nada de `color-scheme` nem de `prefers-color-scheme` fora
 * do theme.css), senão o config deixa de mandar; e o padrão do repositório continua
 * sendo o cinema escuro. A varredura de cor literal e o contraste de cada preset
 * moram em tests/tema.test.js. */
test('o tema vem do theme.css gerado; as folhas do site e da mesa não escolhem tema', () => {
  const tema = lerTexto(path.join(SITE, 'theme.css'));
  const html = lerTexto(path.join(SITE, 'index.html'));

  assert.match(tema, /--fundo:\s*#0f1115/, 'o padrão do repositório deixou de ser o cinema escuro');
  assert.match(tema, /color-scheme:\s*dark/,
    'sem `color-scheme` o navegador pinta de branco a barra de rolagem e os controles nativos');

  for (const arquivo of ['style.css', 'mesa.css']) {
    const css = semComentarios(lerTexto(path.join(SITE, arquivo)));
    assert.ok(!/@media[^{]*prefers-color-scheme/.test(css), arquivo + ' escolhe tema por conta própria — isso é do theme.css');
    assert.ok(!/color-scheme\s*:/.test(css), arquivo + ' define color-scheme — isso é do theme.css');
  }
  assert.ok(!/media\s*=\s*"[^"]*prefers-color-scheme/.test(html.replace(/<meta name="theme-color"[^>]*>/g, '')),
    'index.html voltou a escolher recurso por tema (era o <picture> do logo)');
});

/* O CONTRASTE É RECALCULADO AQUI, dos valores que estão no arquivo — não
 * conferido contra uma tabela escrita à mão. É a diferença entre um teste que
 * envelhece e um que não envelhece: trocar um token roda a conta de novo.
 *
 * A régua é a WCAG 2.x: 4,5:1 para texto, 3:1 para o que desenha um controle.
 *
 * O `--contorno` é o token que só existe por causa desta conta. `--fundo` e
 * `--superficie` estão a 1,08:1 um do outro, então o preenchimento de um campo
 * não o distingue do que está atrás: a LINHA é o único sinal de que ali há um
 * controle, e por isso ela deve os 3:1 da 1.4.11. O `--borda`, que é divisória
 * decorativa, não deve nada a ninguém — e não passaria (1,40:1). */
const canalWcag = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const luminancia = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return 0.2126 * canalWcag((n >> 16) & 255) + 0.7152 * canalWcag((n >> 8) & 255) + 0.0722 * canalWcag(n & 255);
};
const contraste = (a, b) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('todo token de cor passa o contraste da WCAG sobre o fundo em que é usado', () => {
  const css = lerTexto(path.join(SITE, 'theme.css'));
  const raiz = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  const cor = (nome) => {
    const m = raiz.match(new RegExp('--' + nome + ':\\s*(#[0-9a-fA-F]{3,8})'));
    assert.ok(m, 'o :root perdeu o token --' + nome);
    return m[1];
  };

  /* [ o que pinta, sobre o quê, o mínimo, por que esse mínimo ] */
  const pares = [
    ['texto', 'fundo', 4.5], ['texto', 'superficie', 4.5],
    ['texto-fraco', 'fundo', 4.5], ['texto-fraco', 'superficie', 4.5],
    ['marca', 'fundo', 4.5], ['marca', 'superficie', 4.5],
    ['marca-alt', 'superficie', 4.5], ['marca-destaque', 'superficie', 4.5],
    /* A série do destaque é escrita em amarelo direto sobre o fundo da
     * página, não sobre um cartão (D4). */
    ['marca-destaque', 'fundo', 4.5],
    /* A linha do título que está na tela, na lista de episódios (D6): o
     * fundo é o verde fraco, e sobre ele vão o título, a sinopse e o "Você
     * está aqui" na cor da marca. */
    ['texto', 'marca-fraca', 4.5], ['texto-fraco', 'marca-fraca', 4.5], ['marca', 'marca-fraca', 4.5],
    ['alerta', 'alerta-fundo', 4.5], ['erro', 'erro-fundo', 4.5],
    ['contorno', 'fundo', 3], ['contorno', 'superficie', 3]
  ];

  for (const [frente, atras, minimo] of pares) {
    const r = contraste(cor(frente), cor(atras));
    assert.ok(r >= minimo,
      '--' + frente + ' (' + cor(frente) + ') sobre --' + atras + ' (' + cor(atras) + ') dá ' +
      r.toFixed(2) + ':1, abaixo dos ' + minimo + ':1 que a WCAG cobra');
  }

  /* O chip ligado pinta texto ESCURO sobre a cor da marca: branco ali dá contraste insuficiente. */
  assert.ok(contraste(cor('texto-sobre-marca'), cor('marca')) >= 4.5,
    'o texto do chip ligado não contrasta com a cor da marca');
});

/* A SEGUNDA METADE DA CONTA, e ela existe porque a primeira deixou passar.
 *
 * O teste acima mede pares de TOKENS. O `.botao-primario` pintava `#fff`
 * escrito direto na regra, sobre `var(--marca)`: 2,32:1 em repouso e 1,90:1 no
 * hover. No tema claro de antes da D1 isso passava (o verde era #0f6b45); a
 * D1 fez do escuro o único tema, a falha passou a ser de todo mundo, e o teste
 * de tokens ficou verde. Achado em 14/09, na D4, porque o "Assistir" do
 * destaque é esse botão.
 *
 * Esta varredura lê TODA regra que tem uma cor de texto fixa e um fundo que dá
 * para resolver sem navegador — um hex, ou um `var(--token)` do :root — e roda
 * a conta. Fundo translúcido, degradê ou herdado fica de fora, porque aí a cor
 * final depende do que está atrás; são os selos do player sobre o vídeo, que é
 * preto. */
test('toda cor de texto fixa numa regra contrasta com o fundo da mesma regra', () => {
  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));
  /* Desde o M3 a cor vem de var(--token): os valores estão no theme.css (paleta)
   * e no tokens-fixos.css (player). */
  const tokens = Object.create(null);
  for (const arquivo of ['tokens-fixos.css', 'theme.css']) {
    const t = semComentarios(lerTexto(path.join(SITE, arquivo)));
    const raiz = t.slice(t.indexOf(':root'), t.indexOf('}', t.indexOf(':root')));
    for (const m of raiz.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) tokens[m[1]] = m[2];
  }
  const resolver = (valor) => {
    const token = valor.match(/^var\(--([\w-]+)\)$/);
    if (token) return tokens[token[1]] || null;
    return /^#[0-9a-fA-F]{3,6}$/.test(valor) ? valor : null;
  };

  let medidas = 0;
  for (const [, seletor, corpo] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const cor = corpo.match(/(?:^|[;\s])color:\s*([^;]+)/);
    const fundo = corpo.match(/background(?:-color)?:\s*([^;]+)/);
    if (!cor || !fundo) continue;

    const hexFundo = resolver(fundo[1].trim());
    const hexCor = resolver(cor[1].trim());
    if (!hexFundo || !hexCor) continue;

    const r = contraste(hexCor, hexFundo);
    assert.ok(r >= 4.5,
      seletor.trim() + ' pinta ' + cor[1].trim() + ' (' + hexCor + ') sobre ' + fundo[1].trim() + ' (' + hexFundo + '): ' +
      r.toFixed(2) + ':1, abaixo dos 4,5:1 de texto');
    medidas++;
  }

  /* Uma varredura que não mede nada passa sempre. Hoje ela mede o chip ligado,
   * o botão primário e o hover dele, e os dois botões brancos do player. */
  assert.ok(medidas >= 5, 'a varredura mediu só ' + medidas + ' regra(s) — o regex parou de achar as regras');
});

/* A outra metade da conta acima: o token forte tem que estar LIGADO nos
 * controles. Medir uma cor que ninguém usa não protege ninguém. */
test('o contorno dos controles usa --contorno, não a divisória', () => {
  /* Cada um destes é um controle cujo contorno é o único sinal de que ele
   * existe. No site: o campo de busca, o chip e o botão. Na mesa (15/09 — até
   * então os controles do /admin moravam no style.css): os campos, o seletor
   * segmentado, o botão, o interruptor e o trilho da barra de progresso. */
  const porArquivo = {
    'style.css': ['.busca input', '.chip', '.botao'],
    'mesa.css': ['.campo input[type="text"]', '.seg', '.botao', '.trilho', '.progresso']
  };
  /* Acha a REGRA de um seletor, e não a primeira vez que o texto aparece.
   * `.chip` casaria dentro de `.chips`, que é o contêiner rolante e não tem
   * borda nenhuma — o teste reprovava apontando para a regra errada. O que
   * fecha um seletor é `{` (regra de um só) ou `,` (lista); daí anda até a
   * abertura da regra e devolve o corpo dela. */
  const regraDe = (css, seletor) => {
    for (let i = css.indexOf(seletor); i >= 0; i = css.indexOf(seletor, i + 1)) {
      const depois = css[i + seletor.length];
      if (!/[ ,{\n]/.test(depois || '')) continue;
      /* E tem que COMEÇAR a linha. Na D4 o destaque trouxe
       * `.destaque-botoes .botao`, que aparece antes da regra base e não tem
       * borda nenhuma: um seletor descendente não é a regra do controle, e o
       * teste reprovava apontando para ela. As regras base dos cinco
       * controles começam na coluna zero. */
      if (i > 0 && css[i - 1] !== '\n') continue;
      const abre = css.indexOf('{', i);
      if (abre < 0) continue;
      /* Um `{` longe demais quer dizer que o casamento foi dentro de outra
       * coisa, não num seletor. */
      if (css.slice(i, abre).includes('}')) continue;
      return css.slice(abre, css.indexOf('}', abre));
    }
    return null;
  };

  for (const [arquivo, controles] of Object.entries(porArquivo)) {
    const css = lerTexto(path.join(SITE, arquivo));
    for (const seletor of controles) {
      const regra = regraDe(css, seletor);
      assert.ok(regra, 'não achei a regra de ' + seletor + ' em ' + arquivo);
      assert.match(regra, /border[^;]*var\(--contorno\)/,
        seletor + ' em ' + arquivo + ' desenha o contorno com --borda; a divisória não passa os 3:1 da WCAG');
    }
  }
});

/* ================= contas e permissões, no servidor (M2) ================ */

/* Estes testes EXECUTAM o Worker — o roteador, o middleware, o login e as
 * rotas —, com um KV de mentira na memória. É a diferença entre cobrar que o
 * código diz "403" e cobrar que ele RESPONDE 403. Rodam no Node sem rede:
 * `crypto.subtle` é o mesmo dos dois lados. */
const kvDeMentira = (inicial) => {
  const dados = Object.assign({}, inicial);
  /* Os metadados da chave são um lugar à parte no KV de verdade, e o histórico
   * (M5) depende disso: é deles que a linha do tempo sai, sem abrir registro. */
  const metas = Object.create(null);
  return {
    dados,
    metas,
    get: async (chave, tipo) => (dados[chave] == null ? null : (tipo === 'json' ? JSON.parse(dados[chave]) : dados[chave])),
    /* O índice da fala guarda a versão nos metadados, e o GET
     * dele lê os dois numa leitura só. */
    getWithMetadata: async (chave, tipo) => ({
      value: dados[chave] == null ? null : (tipo === 'json' ? JSON.parse(dados[chave]) : dados[chave]),
      metadata: metas[chave] || null
    }),
    put: async (chave, valor, opcoes) => {
      dados[chave] = String(valor);
      if (opcoes && opcoes.metadata) metas[chave] = JSON.parse(JSON.stringify(opcoes.metadata));
    },
    delete: async (chave) => { delete dados[chave]; delete metas[chave]; },
    /* A listagem do KV é ASCENDENTE por chave e paginada — nunca ao contrário.
     * A imitação aqui é fiel nisso de propósito: é o que obriga a chave do
     * histórico a guardar a rev invertida. */
    list: async ({ prefix = '', limit = 1000, cursor = '' } = {}) => {
      const todas = Object.keys(dados).filter(k => k.startsWith(prefix)).sort();
      const inicio = cursor ? todas.indexOf(cursor) + 1 : 0;
      const fatia = todas.slice(inicio, inicio + limit);
      const completa = inicio + fatia.length >= todas.length;
      return {
        keys: fatia.map(name => ({ name, metadata: metas[name] })),
        list_complete: completa,
        cursor: completa ? undefined : fatia[fatia.length - 1]
      };
    }
  };
};
const ambiente = (kv) => ({ ADMIN_PASSWORD: 'senha-do-super', SESSION_SECRET: 'segredo-de-sessao-com-mais-de-32-caracteres', CATALOGO: kv, BUNNY_LIBRARY_ID: '1', BUNNY_API_KEY: 'x' });

/* Troca o fetch global por um que responde à criação de vídeo sem rede — só os
 * testes de limite de envio chegam a este ponto; o resto do arquivo nunca cria
 * vídeo de verdade, então nunca precisou disto. Devolve a função que desfaz. */
function bunnyDeMentira() {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/videos') && init && init.method === 'POST') {
      n++;
      return new Response(JSON.stringify({ guid: 'video-de-mentira-' + n }), { status: 200 });
    }
    return original(url, init);
  };
  return () => { globalThis.fetch = original; };
}

/* Sobe o pedido pela porta de verdade do Worker (`core/worker/index.js`):
 * roteador, middleware e handler. `modo` é o modo de acesso da config; aqui o
 * padrão é `publico` porque estes testes cobrem os handlers, e a matriz por
 * modo mora em tests/worker-matriz.test.js. `bruto` é o corpo que não é JSON —
 * a capa que a mesa manda à /api/midia. */
async function pedir(env, { metodo = 'GET', caminho, corpo, bruto, token, cabecalhos, modo = 'publico' }) {
  const { criarWorker } = await import('../core/worker/index.js');
  const worker = criarWorker({ obterConfig: async () => ({ acesso: { modo } }) });
  const request = new Request('https://exemplo.test' + caminho, {
    method: metodo,
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, cabecalhos || {}),
    body: bruto !== undefined ? bruto : (corpo === undefined ? undefined : JSON.stringify(corpo))
  });
  const promessas = [];
  const resposta = await worker.fetch(request, env, { waitUntil: (p) => promessas.push(p) });
  await Promise.all(promessas);
  const texto = await resposta.clone().text();
  let corpoResposta = null;
  try { corpoResposta = JSON.parse(texto); } catch (e) { /* resposta sem JSON */ }
  return { status: resposta.status, corpo: corpoResposta, texto, cabecalhos: resposta.headers };
}

const entrar = async (env, usuario, senha) =>
  (await pedir(env, { metodo: 'POST', caminho: '/api/login', corpo: { usuario, senha } })).corpo;

test('o superadmin entra com a senha do ambiente, e o token de antes continua valendo', async () => {
  const env = ambiente(kvDeMentira());
  const entrada = await entrar(env, '', 'senha-do-super');
  assert.equal(entrada.super, true);
  assert.deepEqual(entrada.permissoes, App.PERMISSOES, 'o superadmin tem todas as permissões');

  const errada = await pedir(env, { metodo: 'POST', caminho: '/api/login', corpo: { senha: 'chutando' } });
  assert.equal(errada.status, 401);

  /* O TOKEN DO FORMATO ANTIGO (`expira.assinatura`, assinado com a SENHA do
   * admin) deixou de valer: a chave de sessão é outra (SESSION_SECRET). Os
   * scripts de carga não são afetados, eles entram por /api/login. */
  const enc = new TextEncoder();
  const expira = Math.floor(Date.now() / 1000) + 600;
  const chave = await crypto.subtle.importKey('raw', enc.encode('senha-do-super'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = [...new Uint8Array(await crypto.subtle.sign('HMAC', chave, enc.encode('tm-admin:' + expira)))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const antigo = await pedir(env, { caminho: '/api/conta', token: expira + '.' + assinatura });
  assert.equal(antigo.status, 401, 'o token assinado com a senha do admin ainda vale');

  /* Sem SESSION_SECRET não há login nem sessão: falha fechada. */
  const semChave = Object.assign({}, env, { SESSION_SECRET: undefined });
  const recusado = await pedir(semChave, { metodo: 'POST', caminho: '/api/login', corpo: { senha: 'senha-do-super' } });
  assert.equal(recusado.status, 503);
  assert.equal((await pedir(semChave, { caminho: '/api/conta', token: entrada.token })).status, 401);
});

test('só o superadmin cria conta, e a senha nunca sai na listagem', async () => {
  const env = ambiente(kvDeMentira());
  const super1 = await entrar(env, '', 'senha-do-super');

  const curta = await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'maria', senha: 'curta', permissoes: ['conteudo'] } });
  assert.equal(curta.status, 400);

  const reservado = await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'superadmin', senha: 'senha-bem-comprida', permissoes: [] } });
  assert.equal(reservado.status, 400);

  const criada = await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'maria', nome: 'Maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] } });
  assert.equal(criada.status, 200);
  assert.deepEqual(criada.corpo.conta.permissoes, ['conteudo']);
  assert.ok(!('senha' in criada.corpo.conta), 'a senha voltou na resposta');

  const lista = await pedir(env, { caminho: '/api/contas', token: super1.token });
  assert.equal(lista.corpo.contas.length, 1);
  assert.ok(!JSON.stringify(lista.corpo).includes('hash'), 'o hash da senha saiu na listagem');

  /* E a conta comum não gerencia contas — nem a dela. */
  const maria = await entrar(env, 'maria', 'senha-bem-comprida');
  assert.equal(maria.super, false);
  const tentativa = await pedir(env, { caminho: '/api/contas', token: maria.token });
  assert.equal(tentativa.status, 403);
});

test('usuário que não existe e senha errada dão a mesma resposta', async () => {
  const env = ambiente(kvDeMentira());
  const super1 = await entrar(env, '', 'senha-do-super');
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: [] } });

  const semConta = await pedir(env, { metodo: 'POST', caminho: '/api/login', corpo: { usuario: 'joao', senha: 'senha-bem-comprida' } });
  const senhaErrada = await pedir(env, { metodo: 'POST', caminho: '/api/login', corpo: { usuario: 'maria', senha: 'outra-senha-longa' } });
  assert.equal(semConta.status, 401);
  assert.equal(senhaErrada.status, 401);
  assert.equal(semConta.corpo.erro, senhaErrada.corpo.erro,
    'a mensagem diz qual dos dois errou — isso entrega quais usuários existem');
});

test('o PUT do catálogo recusa campo por campo o que a conta não pode mudar', async () => {
  const kv = kvDeMentira({
    catalogo: JSON.stringify({ rev: 1, itens: [{ id: 'a', titulo: 'A', publicar: false, fonte: { videoId: 'v' } }], ajustes: {} })
  });
  const env = ambiente(kv);
  const super1 = await entrar(env, '', 'senha-do-super');
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] } });
  const maria = await entrar(env, 'maria', 'senha-bem-comprida');

  const doc = (mudar) => {
    const base = JSON.parse(kv.dados.catalogo);
    mudar(base);
    return base;
  };

  const titulo = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: maria.token,
    corpo: doc(c => { c.itens[0].titulo = 'A com outro nome'; }) });
  assert.equal(titulo.status, 200, JSON.stringify(titulo.corpo));

  const noAr = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: maria.token,
    corpo: doc(c => { c.itens[0].publicar = true; }) });
  assert.equal(noAr.status, 403);
  assert.equal(noAr.corpo.barradas[0].campo, 'publicar');
  assert.equal(noAr.corpo.barradas[0].permissao, 'no-ar');

  const fonte = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: maria.token,
    corpo: doc(c => { c.itens[0].fonte = { videoId: 'outro' }; }) });
  assert.equal(fonte.status, 403, 'trocar a fonte do vídeo não é da mesa');

  /* O superadmin passa por tudo — é dele que vêm as gravações dos scripts. */
  const peloSuper = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: super1.token,
    corpo: doc(c => { c.itens[0].fonte = { videoId: 'outro' }; c.itens[0].publicar = true; }) });
  assert.equal(peloSuper.status, 200);
});

test('tirar uma permissão derruba a sessão aberta no pedido seguinte', async () => {
  const env = ambiente(kvDeMentira());
  const super1 = await entrar(env, '', 'senha-do-super');
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo', 'enviar'] } });
  const maria = await entrar(env, 'maria', 'senha-bem-comprida');
  assert.equal((await pedir(env, { caminho: '/api/conta', token: maria.token })).status, 200);

  const mudanca = await pedir(env, { metodo: 'PUT', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'maria', permissoes: ['conteudo'] } });
  assert.equal(mudanca.corpo.sessoesDerrubadas, true);
  assert.equal((await pedir(env, { caminho: '/api/conta', token: maria.token })).status, 401,
    'o token de antes continuou valendo depois de a permissão sair');

  /* Desativar também derruba, e o login para de funcionar. */
  const maria2 = await entrar(env, 'maria', 'senha-bem-comprida');
  await pedir(env, { metodo: 'PUT', caminho: '/api/contas', token: super1.token, corpo: { usuario: 'maria', ativa: false } });
  assert.equal((await pedir(env, { caminho: '/api/conta', token: maria2.token })).status, 401);
  const barrada = await pedir(env, { metodo: 'POST', caminho: '/api/login', corpo: { usuario: 'maria', senha: 'senha-bem-comprida' } });
  assert.equal(barrada.status, 401);
});

test('enviar vídeo é permissão à parte — é o que ocupa armazenamento pago', async () => {
  const env = ambiente(kvDeMentira());
  const super1 = await entrar(env, '', 'senha-do-super');
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] } });
  const maria = await entrar(env, 'maria', 'senha-bem-comprida');
  const r = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token, corpo: { titulo: 'Novo' } });
  assert.equal(r.status, 403);
  assert.equal(r.corpo.permissao, 'enviar');
});

/* =============== limite de envio por conta, no servidor (M2+) ============ */

test('o limite de vídeos é do superadmin, e recusa quando a conta já atingiu o limite', async () => {
  const desfazerBunny = bunnyDeMentira();
  try {
    const env = ambiente(kvDeMentira());
    const super1 = await entrar(env, '', 'senha-do-super');
    await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
      corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['enviar'], limiteEnvio: { maxVideos: 1 } } });

    /* Conta comum não gerencia o próprio limite — só o superadmin. */
    const maria = await entrar(env, 'maria', 'senha-bem-comprida');
    const tentativa = await pedir(env, { metodo: 'PUT', caminho: '/api/contas', token: maria.token,
      corpo: { usuario: 'maria', limiteEnvio: { maxVideos: 999 } } });
    assert.equal(tentativa.status, 403);

    const primeiro = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token, corpo: { titulo: 'Um' } });
    assert.equal(primeiro.status, 200, JSON.stringify(primeiro.corpo));

    const segundo = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token, corpo: { titulo: 'Dois' } });
    assert.equal(segundo.status, 403);
    assert.equal(segundo.corpo.motivo, 'limite-videos');

    /* Retomar o envio do primeiro vídeo não é vídeo novo — não esbarra no limite. */
    const retomada = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token,
      corpo: { videoId: primeiro.corpo.videoId } });
    assert.equal(retomada.status, 200);
  } finally { desfazerBunny(); }
});

test('o limite de duração recusa pela estimativa do navegador, antes de gastar no Bunny', async () => {
  const desfazerBunny = bunnyDeMentira();
  try {
    const env = ambiente(kvDeMentira());
    const super1 = await entrar(env, '', 'senha-do-super');
    await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
      corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['enviar'], limiteEnvio: { maxDuracaoSeg: 600 } } });
    const maria = await entrar(env, 'maria', 'senha-bem-comprida');

    const longo = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token,
      corpo: { titulo: 'Filmão', duracaoEstimadaSeg: 900 } });
    assert.equal(longo.status, 403);
    assert.equal(longo.corpo.motivo, 'limite-duracao');

    const curto = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token,
      corpo: { titulo: 'Curta', duracaoEstimadaSeg: 300 } });
    assert.equal(curto.status, 200);
  } finally { desfazerBunny(); }
});

test('autorização manual: o vídeo só nasce no Bunny depois que o superadmin aprova o pedido', async () => {
  const desfazerBunny = bunnyDeMentira();
  try {
    const env = ambiente(kvDeMentira());
    const super1 = await entrar(env, '', 'senha-do-super');
    await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
      corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['enviar'], limiteEnvio: { autorizacaoManual: true } } });
    const maria = await entrar(env, 'maria', 'senha-bem-comprida');

    const pedido = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token, corpo: { titulo: 'Aguardando' } });
    assert.equal(pedido.status, 202);
    assert.equal(pedido.corpo.aguardando, true);
    assert.ok(pedido.corpo.pedidoId);

    /* Uma conta comum não vê a lista inteira, só o próprio pedido. */
    const listaBarrada = await pedir(env, { caminho: '/api/autorizacoes', token: maria.token });
    assert.equal(listaBarrada.status, 403);
    const proprio = await pedir(env, { caminho: '/api/autorizacoes?id=' + pedido.corpo.pedidoId, token: maria.token });
    assert.equal(proprio.corpo.pedido.status, 'aguardando');

    /* Sem aprovação, o pedidoId não libera vídeo nenhum. */
    const semAprovar = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token,
      corpo: { pedidoId: pedido.corpo.pedidoId } });
    assert.equal(semAprovar.status, 403);
    assert.equal(semAprovar.corpo.motivo, 'pedido-invalido');

    const lista = await pedir(env, { caminho: '/api/autorizacoes', token: super1.token });
    assert.equal(lista.corpo.pedidos.length, 1);
    const aprovacao = await pedir(env, { metodo: 'PUT', caminho: '/api/autorizacoes', token: super1.token,
      corpo: { id: pedido.corpo.pedidoId, aprovado: true } });
    assert.equal(aprovacao.status, 200);

    const depoisDeAprovado = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token,
      corpo: { pedidoId: pedido.corpo.pedidoId } });
    assert.equal(depoisDeAprovado.status, 200, JSON.stringify(depoisDeAprovado.corpo));
    assert.ok(depoisDeAprovado.corpo.videoId);

    /* O mesmo pedido não dá para usar de novo, uma vez consumido. */
    const denovo = await pedir(env, { metodo: 'POST', caminho: '/api/upload-token', token: maria.token,
      corpo: { pedidoId: pedido.corpo.pedidoId } });
    assert.equal(denovo.status, 403);
  } finally { desfazerBunny(); }
});

test('cada conta troca a própria senha; a do superadmin é a do ambiente', async () => {
  const env = ambiente(kvDeMentira());
  const super1 = await entrar(env, '', 'senha-do-super');
  assert.equal((await pedir(env, { metodo: 'PUT', caminho: '/api/conta', token: super1.token,
    corpo: { senhaAtual: 'senha-do-super', senhaNova: 'outra-senha-longa' } })).status, 400);

  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: super1.token,
    corpo: { usuario: 'maria', senha: 'senha-bem-comprida', permissoes: ['conteudo'] } });
  const maria = await entrar(env, 'maria', 'senha-bem-comprida');

  const erradaAtual = await pedir(env, { metodo: 'PUT', caminho: '/api/conta', token: maria.token,
    corpo: { senhaAtual: 'chutando-aqui', senhaNova: 'senha-nova-longa' } });
  assert.equal(erradaAtual.status, 401);

  const trocou = await pedir(env, { metodo: 'PUT', caminho: '/api/conta', token: maria.token,
    corpo: { senhaAtual: 'senha-bem-comprida', senhaNova: 'senha-nova-longa' } });
  assert.equal(trocou.status, 200);
  assert.ok(trocou.corpo.token, 'a troca de senha tem de devolver um token novo, senão derruba quem trocou');
  assert.equal((await pedir(env, { caminho: '/api/conta', token: trocou.corpo.token })).status, 200);
  assert.equal((await pedir(env, { caminho: '/api/conta', token: maria.token })).status, 401, 'o token velho sobreviveu à troca de senha');
  assert.equal((await entrar(env, 'maria', 'senha-nova-longa')).super, false);
});

/* A mesa (15/09) usa os MESMOS tokens do site e acrescenta só as superfícies
 * dela, mais escuras. A conta é a mesma do site, recalculada dos valores do
 * arquivo, sobre as superfícies onde a mesa pinta cada cor. */
test('os tokens da mesa passam o contraste, e são os mesmos do site', () => {
  const css = semComentarios(lerTexto(path.join(SITE, 'mesa.css')));
  assert.ok(!/color-scheme\s*:/.test(css), 'a mesa define color-scheme — isso é do theme.css');
  assert.ok(!/@media[^{]*prefers-color-scheme/.test(css), 'a mesa decide tema por conta própria');
  /* Um token com o mesmo nome e outro valor seriam dois sistemas de cor fingindo
   * ser um: a mesa NÃO redeclara cor, ela usa a do theme.css. */
  assert.ok(!/--(texto|texto-fraco|borda|contorno|marca|marca-fraca|marca-destaque|alerta|erro|painel|painel-alto|mesa-fundo)\s*:/.test(css),
    'mesa.css redeclarou um token de cor do tema');

  const tema = semComentarios(lerTexto(path.join(SITE, 'theme.css')));
  const raiz = tema.slice(tema.indexOf(':root'), tema.indexOf('}', tema.indexOf(':root')));
  const cor = (nome) => {
    const m = raiz.match(new RegExp('--' + nome + ':\\s*(#[0-9a-fA-F]{3,8})'));
    assert.ok(m, 'o theme.css perdeu o token --' + nome);
    return m[1].toLowerCase();
  };

  const pares = [
    ['texto', 'painel', 4.5], ['texto', 'painel-alto', 4.5],
    ['texto-fraco', 'painel', 4.5], ['texto-fraco', 'painel-alto', 4.5], ['texto-fraco', 'mesa-fundo', 4.5],
    ['marca', 'painel', 4.5], ['marca', 'marca-fraca', 4.5], ['marca-destaque', 'painel', 4.5],
    ['alerta', 'alerta-fundo', 4.5], ['erro', 'erro-fundo', 4.5],
    ['contorno', 'painel', 3], ['contorno', 'painel-alto', 3]
  ];
  for (const [frente, atras, minimo] of pares) {
    const r = contraste(cor(frente), cor(atras));
    assert.ok(r >= minimo, '--' + frente + ' sobre --' + atras + ' na mesa dá ' + r.toFixed(2) + ':1, abaixo de ' + minimo + ':1');
  }
});

/* O seletor de capa da mesa tem um <video> com os controles do navegador, e é
 * quem aperta o play que toca. Nenhum arquivo da mesa chama play(). */
test('a mesa não dá play em nada, nem no seletor de capa', () => {
  for (const arquivo of ['mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa.js']) {
    const js = semComentarios(lerTexto(path.join(SITE, arquivo)));
    assert.ok(!/\.play\s*\(/.test(js), arquivo + ' chama play()');
  }
});

/* ============================ o cabeçalho de streaming (D5) ============= */

/* O CABEÇALHO FLUTUANTE: sem fundo com a página no alto, sólido assim que
 * alguma coisa passa por baixo dele. A regra da fase é "sem ouvinte de scroll",
 * e ela vale para o site inteiro: um ouvinte de rolagem roda dezenas de vezes
 * por segundo, na mesma linha de execução que desenha a página, e num celular
 * modesto é o que faz a rolagem engasgar. Quem avisa é o navegador, uma vez
 * por travessia.
 *
 * O alvo é uma SENTINELA de 1 px no alto do documento, e não o destaque, como a
 * o projeto sugeria. Medido em 15/09: no celular deitado, 812×375, o
 * destaque tem 602 px de altura para 302 livres abaixo do cabeçalho novo (251
 * com o de antes) — um limiar de 100% nele nunca dispara. E ele não existe na
 * ficha, na grade nem na página Séries. */
test('o cabeçalho não ouve scroll — quem pinta o fundo é um IntersectionObserver', () => {
  for (const arquivo of ['app.js', 'catalogo-core.js', 'busca-core.js', 'indice-core.js', 'player.js', 'player-core.js',
    'mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa.js']) {
    const codigo = semComentarios(lerTexto(path.join(SITE, arquivo)));
    /* O alvo proibido é a PÁGINA — `window` e `document` —, que é de onde viria
     * o scroll capaz de redesenhar o cabeçalho a cada quadro, e é esse o
     * defeito que este teste guarda desde que nasceu.
     *
     * A proibição era de QUALQUER `addEventListener('scroll')`, e em 17/09 ela
     * passou a barrar coisa legítima: a prateleira ouve a rolagem DELA — de
     * lado, dentro da própria caixa — para saber quando a seta chegou ao fim e
     * pode sair da tela. Nada disso encosta no cabeçalho. O que a regra
     * guardava continua guardado, e o que sobra ganhou a exigência de
     * `passive`, que é a outra metade do motivo pelo qual ouvir rolagem sai
     * caro: sem ela o navegador segura o quadro esperando um `preventDefault`
     * que não vem. */
    assert.ok(!/(window|document)\s*\.\s*addEventListener\(\s*['"]scroll['"]/.test(codigo),
      arquivo + ' ouve o scroll da PÁGINA — a troca de fundo do cabeçalho é do IntersectionObserver');
    assert.ok(!/\.onscroll\s*=/.test(codigo), arquivo + ' pendura um onscroll');
    for (const o of codigo.matchAll(/addEventListener\(\s*['"]scroll['"]/g)) {
      assert.match(codigo.slice(o.index, o.index + 220), /passive:\s*true/,
        arquivo + ' ouve rolagem sem `passive: true`');
    }
  }

  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const ligar = app.match(/function ligarTopo\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(ligar, 'não achei ligarTopo em app.js');
  assert.match(ligar[1], /new IntersectionObserver\(/,
    'o cabeçalho deixou de ser avisado pelo IntersectionObserver');
  assert.match(ligar[1], /classList\.toggle\('topo-solido'/,
    'o observador não liga mais a classe do fundo sólido');
  assert.match(ligar[1], /observe\(el\.sentinela\)/,
    'o observador não olha mais a sentinela do alto da página');
  /* Sem IntersectionObserver o cabeçalho fica SÓLIDO: é o estado que nunca
   * deixa conteúdo passar por baixo de um cabeçalho sem fundo. */
  assert.match(ligar[1], /IntersectionObserver === 'undefined'[\s\S]*add\('topo-solido'\)/,
    'sem IntersectionObserver o cabeçalho tem que ficar sólido');

  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.match(html, /<div class="topo-sentinela" id="topo-sentinela" aria-hidden="true"><\/div>/,
    'sumiu a sentinela do alto da página');
  assert.match(html, /<header class="topo topo-flutuante" id="topo">/,
    'o cabeçalho do catálogo perdeu a classe que o deixa sem fundo no alto');
});

/* O fundo liga e desliga, e a ALTURA não se mexe: um cabeçalho sticky que
 * ganhasse 1 px de borda ao ficar sólido empurraria a página inteira a cada
 * travessia. Por isso a borda existe nos dois estados — transparente num,
 * visível no outro. E o `.topo` puro continua sólido: o /admin usa a mesma
 * classe, sem sentinela e sem observador. */
test('o cabeçalho sólido só troca cor, e não esmaece para quem pediu menos movimento', () => {
  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));
  const base = css.match(/\n\.topo\s*\{([^}]*)\}/);
  assert.ok(base, 'não achei a regra base de .topo');
  assert.match(base[1], /background:\s*var\(--superficie\)/, 'o .topo do /admin perdeu o fundo');
  assert.match(base[1], /border-bottom:\s*1px solid/, 'o cabeçalho perdeu a borda de baixo');
  assert.match(base[1], /position:\s*sticky/, 'o cabeçalho deixou de ser sticky');

  const flutuante = css.match(/\n\.topo-flutuante\s*\{([^}]*)\}/);
  assert.ok(flutuante, 'não achei a regra de .topo-flutuante');
  assert.match(flutuante[1], /background-color:\s*transparent/);
  assert.match(flutuante[1], /border-bottom-color:\s*transparent/,
    'a borda tem que continuar existindo, transparente — tirá-la muda a altura');

  const solido = css.match(/\n\.topo-flutuante\.topo-solido\s*\{([^}]*)\}/);
  assert.ok(solido, 'não achei a regra do cabeçalho sólido');
  assert.match(solido[1], /background-color:\s*var\(--superficie\)/);
  assert.match(solido[1], /border-bottom-color:\s*var\(--borda\)/);
  assert.ok(!/(?:^|;)\s*(?:padding|margin|height|min-height|border|border-bottom|border-bottom-width)\s*:/.test(solido[1]),
    'o cabeçalho sólido mexe em medida, e desloca a página a cada travessia: ' + solido[1].trim());
  /* Sólido NA HORA. A transição é a do estado de chegada: com ela aqui, o
   * fundo esmaecia por 0,2 s enquanto o destaque já passava por baixo do logo
   * (15/09, na primeira versão). A volta ao transparente pode esmaecer — no
   * alto da página não há nada embaixo. */
  assert.match(solido[1], /transition:\s*none/,
    'o cabeçalho esmaece ao ficar sólido — e o conteúdo aparece por baixo do logo enquanto isso');
  assert.match(flutuante[1], /transition:\s*background-color/,
    'a volta ao cabeçalho sem fundo deixou de esmaecer');

  const reduzido = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
    .map(m => m[1]).join('\n');
  assert.match(reduzido, /\.topo-flutuante\s*\{[^}]*transition:\s*none/,
    'o fundo do cabeçalho continua esmaecendo para quem pediu menos movimento');
});

/* O cabeçalho: o logo, NO MÁXIMO dois links — Início e Séries — e a
 * busca. E nada que o catálogo encha depois de chegar: a linha dos chips nascia
 * vazia dentro dele e empurrava a página inteira ao ganhar os botões (0,0395 de
 * CLS, 14/09). Caixa vazia no <header> é caixa que o JS vai encher. */
test('o cabeçalho tem o logo, dois links e a busca — e nenhuma caixa vazia', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  const topo = html.match(/<header class="topo topo-flutuante" id="topo">([\s\S]*?)<\/header>/);
  assert.ok(topo, 'não achei o <header> do catálogo');

  const links = [...topo[1].matchAll(/<a class="topo-link" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(m => [m[1], m[2].trim()]);
  assert.deepEqual(links, [['#/', 'Início'], ['#/series', 'Séries']],
    'o cabeçalho tem que ter exatamente Início e Séries');
  assert.match(topo[1], /<nav class="topo-nav" aria-label="[^"]+"[^>]*>/, 'os links saíram de um <nav> rotulado');
  assert.match(topo[1], /<a class="marca" href="#\/" data-inicio>/, 'o logo deixou de levar ao início');
  assert.match(topo[1], /<label class="pular" for="busca"[^>]*>/, 'a busca perdeu o rótulo do leitor de tela');
  assert.match(topo[1], /<input id="busca" type="search"/, 'a busca saiu do cabeçalho');

  assert.ok(!/<(div|nav|ul|span|section)\b[^>]*>\s*<\/\1>/.test(topo[1]),
    'há caixa vazia no cabeçalho — o que o JS encher nela desloca a página quando o catálogo chega');
  assert.ok(!/id="chips"/.test(html), 'a linha de chips voltou ao index.html — ela mora na grade desde a D5');
});

/* D8: os chips SAÍRAM DA CHEGADA e viraram o filtro da resposta. Como filtro,
 * só oferecem o que existe na resposta — os 23 botões de antes, sobre uma
 * busca de 3 resultados, eram 21 caminhos para "Nada encontrado". */
test('o filtro por série só oferece série que está na resposta', () => {
  const itens = [
    { id: 'e1', titulo: 'Português', serie: 'Série Exemplo 2', episodio: 1, publicar: true },
    { id: 'e2', titulo: 'Matemática', serie: 'Série Exemplo 2', episodio: 2, publicar: true },
    { id: 'c1', titulo: 'Chamada', serie: 'Eventos', publicar: true },
    { id: 'd1', titulo: 'Dentista', serie: 'Série Exemplo 1', episodio: 2, publicar: true }
  ];
  assert.deepEqual(App.seriesDoFiltro(itens, ''), ['Eventos', 'Série Exemplo 1', 'Série Exemplo 2']);
  /* Uma série só não pede filtro: não há o que escolher. */
  assert.deepEqual(App.seriesDoFiltro(itens.filter(i => i.serie === 'Série Exemplo 2'), ''), []);
  assert.deepEqual(App.seriesDoFiltro([], ''), []);
  /* A série LIGADA fica, mesmo sem resultado: é o botão que desfaz o filtro. */
  assert.deepEqual(App.seriesDoFiltro([], 'Série Exemplo 2'), ['Série Exemplo 2']);
  assert.deepEqual(App.seriesDoFiltro(itens.filter(i => i.serie === 'Eventos'), 'Série Exemplo 2'),
    ['Eventos', 'Série Exemplo 2']);

  const app = lerTexto(path.join(SITE, 'app.js'));
  const grade = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(grade[1], /App\.seriesDoFiltro\(/, 'a grade não desenha mais o filtro pelo core');
  assert.ok(!/renderChips/.test(app), 'sobrou a linha de chips do cabeçalho em app.js');
});

/* Apertar um chip redesenha a grade, e o botão apertado é recriado. Sem
 * devolver o foco, quem usa teclado caía no <body> e voltava ao começo da
 * página a cada filtro — conferido em 15/09, antes da D5, com a linha ainda no
 * cabeçalho. */
test('o chip apertado continua com o foco depois de a grade ser redesenhada', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const filtro = app.match(/function filtroSeries\(opcoes\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(filtro, 'não achei filtroSeries em app.js');
  assert.match(filtro[1], /renderGrade\(\)[\s\S]*\.focus\(/,
    'o chip redesenha a grade e não devolve o foco a quem o apertou');
  /* A linha recriada nascia rolada até o começo: o chip apertado no fim dela
   * ficava fora da tela, com o foco nele (15 de 78 px, em 375 px). */
  assert.match(filtro[1], /var rolagem = caixa\.scrollLeft[\s\S]*renderGrade\(\)[\s\S]*scrollLeft = rolagem/,
    'a linha de chips volta ao começo a cada filtro — o chip apertado some da tela');
  assert.match(filtro[1], /aria-pressed/, 'o chip deixou de dizer se está ligado');
  assert.match(filtro[1], /'role', 'group'/, 'a linha de chips deixou de ser um grupo rotulado');
});

/* A página Séries, que é para onde os chips foram. Os grupos seguem as mesmas
 * listas da chegada — o que é série de um lado, o que é institucional do
 * outro —, e a regra que vale é a das prateleiras: nenhuma série publicada
 * some. */
test('a página Séries agrupa como a chegada, e nenhuma série publicada some', () => {
  const grupos = App.gruposDeSeries(catalogoPrateleiras);
  assert.deepEqual(grupos.map(g => g.id), ['series', 'institucional']);

  const vistas = grupos.flatMap(g => g.series.map(s => s.nome));
  const publicadas = App.series(App.publicaveis(catalogoPrateleiras));
  assert.equal(new Set(vistas).size, vistas.length, 'série repetida na página Séries');
  assert.deepEqual([...vistas].sort(), [...publicadas].sort(),
    'há série publicada fora da página Séries, ou série que não devia estar lá');

  const inst = grupos.find(g => g.id === 'institucional').series.map(s => s.nome);
  assert.deepEqual(inst, ['Eventos', 'A classificar'], 'as institucionais, com a triagem no fim');
  const dasSeries = grupos.find(g => g.id === 'series').series.map(s => s.nome);
  assert.ok(dasSeries.includes('Curtas — Exemplo A'), 'as curtas ficam do lado das séries');

  const sx1 = grupos[0].series.find(s => s.nome === 'Série Exemplo 1');
  assert.equal(sx1.itens.length, 3, 'o título não publicado entrou na conta da série');
  assert.equal(sx1.segundos, 420 + 430 + 440);
  assert.equal(sx1.itens[0].id, 'sx1-1',
    'o primeiro da série tem que ser o de ordenar() — é a capa do cartão dela');

  /* Série que não está em lista nenhuma cai do lado das séries, como na chegada:
   * o site não esconde título por lista desatualizada. */
  const nova = App.gruposDeSeries([{ id: 'x', titulo: 'X', serie: 'Série Nova', publicar: true }]);
  assert.deepEqual(nova.map(g => g.id), ['series']);
  assert.deepEqual(App.gruposDeSeries([]), []);
  assert.deepEqual(App.gruposDeSeries(null), []);
});

/* O tamanho de uma série, dito para gente: "2 h 10 min", e não "130 min" nem
 * "7800 s". */
test('os minutos somados de uma série são escritos para gente', () => {
  assert.equal(App.formatarMinutos(7800), '2 h 10 min');
  assert.equal(App.formatarMinutos(3600), '1 h');
  assert.equal(App.formatarMinutos(300), '5 min');
  assert.equal(App.formatarMinutos(89), '1 min');
  /* Um vídeo de 20 s não é "0 min". */
  assert.equal(App.formatarMinutos(20), '1 min');
  assert.equal(App.formatarMinutos(0), '');
  assert.equal(App.formatarMinutos(null), '');
  assert.equal(App.formatarMinutos('abc'), '');
});

/* A PÁGINA DE UMA SÉRIE (D6). A lista dela é a mesma da "Episódios da série"
 * da ficha, e é por ela que o Shift+N / Shift+P anda: a tecla não pode levar a
 * um episódio que a tela mostra em outro lugar. */
test('a página da série anda na mesma ordem do Shift+N', () => {
  const pag = App.paginaDaSerie(catalogoPrateleiras, 'Série Exemplo 1');
  assert.deepEqual(pag.itens.map(i => i.id), ['sx1-1', 'sx1-2', 'sx1-3'],
    'a página tem de vir na ordem de ordenar(), e sem o título fora do ar');
  assert.equal(pag.segundos, 420 + 430 + 440, 'o título fora do ar entrou na conta dos minutos');

  const andado = [pag.itens[0].id];
  let v = App.vizinhos(catalogoPrateleiras, andado[0]);
  while (v.proximo) {
    andado.push(v.proximo.id);
    v = App.vizinhos(catalogoPrateleiras, v.proximo.id);
  }
  assert.deepEqual(andado, pag.itens.map(i => i.id),
    'o Shift+N percorre a série numa ordem diferente da que a página mostra');

  assert.equal(pag.grupo.id, 'series');
  assert.equal(App.paginaDaSerie(catalogoPrateleiras, 'Eventos').grupo.titulo, 'Institucional',
    'a página e a página Séries discordam sobre o lado da série');
});

/* A D7: página própria só para a série de 3 ou mais títulos. A ROTA vale para
 * todas — um link guardado não quebra —, mas o cartão da série pequena leva
 * direto à ficha, que já traz a série inteira embaixo do vídeo. */
test('só a série de 3 ou mais títulos é oferecida como página — a rota vale para todas', () => {
  assert.equal(App.MINIMO_PAGINA_SERIE, 3);
  assert.equal(App.paginaDaSerie(catalogoPrateleiras, 'Série Exemplo 2').temPagina, true);
  const mat = App.paginaDaSerie(catalogoPrateleiras, 'Série Exemplo 3');
  assert.equal(mat.temPagina, false, 'duas linhas não fazem uma página — a D7');
  assert.equal(mat.itens.length, 2, 'a rota deixou de responder pela série pequena');

  /* O título fora do ar não conta para chegar aos três. */
  const quase = [
    { id: 'p1', titulo: 'A', serie: 'Nova', publicar: true },
    { id: 'p2', titulo: 'B', serie: 'Nova', publicar: true },
    { id: 'p3', titulo: 'C', serie: 'Nova', publicar: false }
  ];
  assert.equal(App.paginaDaSerie(quase, 'Nova').temPagina, false);

  /* O cartão da página Séries faz a mesma pergunta, e tem de ouvir a mesma
   * resposta. */
  const temPagina = Object.fromEntries(App.gruposDeSeries(catalogoPrateleiras)
    .flatMap(g => g.series).map(s => [s.nome, s.temPagina]));
  assert.equal(temPagina['Série Exemplo 1'], true);
  assert.equal(temPagina['Série Exemplo 3'], false);
  assert.equal(temPagina['Curtas — Exemplo A'], false);
});

/* A Série Exemplo 4 tem as cinco partes da T1 e um episódio da T2 — é a única
 * série com duas temporadas no ar (17/09). Título de temporada só aparece
 * quando há mais de uma; senão seria um "Temporada 1" em cima de toda lista. */
test('a página só separa temporada quando há mais de uma', () => {
  const bla = [
    { id: 't2e1', titulo: 'Série Exemplo 4: Assunto Dois', serie: 'Série Exemplo 4', temporada: 2, episodio: 1, publicar: true },
    { id: 't1e2', titulo: 'Série Exemplo 4: Assunto Um (Parte 2)', serie: 'Série Exemplo 4', temporada: 1, episodio: 2, publicar: true },
    { id: 't1e1', titulo: 'Série Exemplo 4: Assunto Um (Parte 1)', serie: 'Série Exemplo 4', temporada: 1, episodio: 1, publicar: true }
  ];
  const pag = App.paginaDaSerie(bla, 'Série Exemplo 4');
  assert.deepEqual(pag.temporadas.map(t => [t.temporada, t.itens.map(i => i.id)]),
    [[1, ['t1e1', 't1e2']], [2, ['t2e1']]]);
  assert.equal(App.rotuloTemporada(2), 'Temporada 2');

  assert.equal(App.paginaDaSerie(catalogoPrateleiras, 'Série Exemplo 2').temporadas.length, 1);
  assert.equal(App.paginaDaSerie(catalogoPrateleiras, 'Série Exemplo 1').temporadas[0].temporada, null);

  /* Misturada: o grupo sem número vem por último, com nome, e sem um número
   * inventado para ele. */
  const mista = App.paginaDaSerie([
    { id: 'x', titulo: 'X', serie: 'S', publicar: true },
    { id: 'y', titulo: 'Y', serie: 'S', temporada: 1, episodio: 1, publicar: true }
  ], 'S');
  assert.deepEqual(mista.temporadas.map(t => t.temporada), [1, null]);
  assert.equal(App.rotuloTemporada(null), 'Sem temporada');
});

test('os anos da série vão do primeiro ao último, e o vazio não vira ano zero', () => {
  const pag = App.paginaDaSerie([
    { id: 'a', titulo: 'A', serie: 'S', ano: 2025, publicar: true },
    { id: 'b', titulo: 'B', serie: 'S', ano: '2023', publicar: true },
    { id: 'c', titulo: 'C', serie: 'S', ano: '', publicar: true },
    { id: 'd', titulo: 'D', serie: 'S', publicar: true }
  ], 'S');
  assert.deepEqual(pag.anos, { de: 2023, ate: 2025 });
  assert.equal(App.formatarAnos(pag.anos), '2023 a 2025');
  assert.equal(App.formatarAnos({ de: 2024, ate: 2024 }), '2024');
  assert.equal(App.formatarAnos(null), '');
  assert.equal(App.paginaDaSerie([{ id: 'a', titulo: 'A', serie: 'S', publicar: true }], 'S').anos, null);
});

/* O nome vazio chega ao `filtrarPorSerie` como "sem filtro" — era assim que
 * os vizinhos de um título sem série viravam o catálogo inteiro. */
test('série sem título publicado não tem página, e o título sem série só tem vizinho sem série', () => {
  assert.equal(App.paginaDaSerie(catalogoPrateleiras, 'Não existe'), null);
  assert.equal(App.paginaDaSerie(catalogoPrateleiras, ''), null, 'nome vazio devolveria o catálogo inteiro');
  assert.equal(App.paginaDaSerie([{ id: 'o', titulo: 'O', serie: 'S', publicar: false }], 'S'), null);
  assert.equal(App.paginaDaSerie(null, 'S'), null);

  const soltos = [
    { id: 'a', titulo: 'A', publicar: true },
    { id: 'b', titulo: 'B', publicar: true },
    { id: 'c', titulo: 'C', serie: 'Outra', publicar: true }
  ];
  assert.equal(App.vizinhos(soltos, 'a').anterior, null, 'o vizinho do título sem série era outra série');
  assert.equal(App.vizinhos(soltos, 'a').proximo.id, 'b');
});

/* As duas rotas da D5. `#/serie/<nome>` nasceu como a grade da série e a D6 a
 * fez página — a MESMA rota, para o link guardado continuar valendo. O
 * nome passa por encodeURIComponent na ida e por uma decodificação protegida na
 * volta — "Podcast / Bate-papo" tem uma barra, e um endereço torto não
 * pode derrubar o roteador. */
test('#/series abre o índice, e #/serie/<nome> abre a página daquela série', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const rotear = app.match(/function rotear\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(rotear, 'não achei rotear em app.js');
  assert.match(rotear[1], /hash === '#\/series'/, 'o roteador não conhece mais o índice de séries');
  assert.match(rotear[1], /\^#\\\/serie\\\/\(\.\+\)\$/, 'o roteador não conhece mais a rota de uma série');
  assert.match(app, /'#\/serie\/' \+ encodeURIComponent\(/, 'o cartão da série monta a rota sem codificar o nome');

  const decodificar = app.match(/function decodificar\(texto\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(decodificar, 'não achei decodificar em app.js');
  assert.match(decodificar[1], /try[\s\S]*decodeURIComponent[\s\S]*catch/,
    'a decodificação da rota não se protege de endereço torto');
  assert.ok(!/decodeURIComponent\(/.test(rotear[1]), 'o roteador voltou a decodificar sem proteção');

  /* O índice e a página da série são ramos de renderGrade, DEPOIS da limpeza:
   * é ela que destrói o player de quem chega da ficha. */
  const grade = app.match(/function renderGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(grade[1], /limpar\(el\.ficha\)[\s\S]*renderIndiceSeries\(\)/,
    'o índice de séries não passa pela limpeza que destrói o player');
  assert.match(grade[1], /limpar\(el\.ficha\)[\s\S]*renderSerie\(estado\.serieRota\)/,
    'a página da série não passa pela limpeza que destrói o player');

  /* E a série deixou de ser uma grade: a rota não filtra mais a lista de onde
   * a busca e o "Ver tudo" partem. */
  const base = app.match(/function baseDaGrade\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(base, 'não achei baseDaGrade em app.js');
  assert.ok(!/serieRota/.test(base[1]), 'a rota da série voltou a ser uma grade filtrada');

  /* E o link da seção em que a pessoa está diz isso ao leitor de tela. */
  assert.match(app, /setAttribute\('aria-current', 'page'\)/, 'o cabeçalho não marca mais onde a pessoa está');
});

/* A PÁGINA DA SÉRIE (D6) é o alto e a lista — sem grade, sem chip e sem
 * contagem "de 69", que eram coisa de resposta de busca. */
test('a página da série é o alto e a lista de episódios, e não uma grade', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const pagina = app.match(/function renderSerie\(nome\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(pagina, 'não achei renderSerie em app.js');
  assert.match(pagina[1], /App\.paginaDaSerie\(/, 'a página não monta a série pelo core');
  assert.match(pagina[1], /cabecaDaSerie\(s, a\)[\s\S]*secaoEpisodios\(s, ''\)/, 'faltou o alto ou a lista');
  assert.ok(!/filtroSeries\(|'grade'|contagem/.test(pagina[1]), 'a página da série voltou a ser grade');
  /* Série que não existe diz isso, e oferece o caminho de volta. */
  assert.match(pagina[1], /if \(!s\)[\s\S]*'#\/series'/, 'a série que sumiu deixa a tela vazia');
});

/* A lista serve à página e à ficha. Numa <ol> rotulada, porque é sequência e o
 * leitor anuncia quantos são; a linha do título que está na tela NÃO é link —
 * na ficha ela levaria ao mesmo endereço, e sem troca de hash nada acontece. */
test('a lista de episódios é uma <ol> rotulada, e o título na tela não é link', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const secao = app.match(/function secaoEpisodios\(s, atualId\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(secao, 'não achei secaoEpisodios em app.js');
  assert.match(secao[1], /criar\('section'/, 'a lista saiu da <section>');
  assert.match(secao[1], /aria-labelledby/, 'a <section> perdeu o rótulo');
  assert.match(secao[1], /criar\('ol'/, 'os episódios saíram da <ol> — o leitor não anuncia quantos são');
  assert.match(secao[1], /s\.temporadas\.length > 1/, 'o título de temporada aparece mesmo com uma só');

  const linha = app.match(/function linhaEpisodio\(item, atual, nivel\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(linha, 'não achei linhaEpisodio em app.js');
  assert.match(linha[1], /criar\(atual \? 'div' : 'a'/, 'a linha do título na tela voltou a ser link');
  assert.match(linha[1], /setAttribute\('aria-current', 'true'\)/, 'a linha atual não diz que é a atual');
  assert.match(linha[1], /App\.tituloCurto\(item\)/, 'a linha repete o nome da série no título');
  assert.match(linha[1], /App\.rotuloNumero\(item\)/,
    'a linha perdeu o número — as cinco "Literatura e cidadania" ficam iguais');
  /* Onze capas numa lista que desce da tela: só as que aparecem são pedidas,
   * e nenhuma prévia, porque na ficha a lista mora embaixo de um vídeo. */
  assert.match(linha[1], /img\.loading = 'lazy'/, 'as capas da lista são pedidas todas de uma vez');
  assert.match(linha[1], /img\.width = 640/, 'a capa da lista não reserva a caixa');
  assert.ok(!/ligarPreview\(|urlPreview\(/.test(linha[1]), 'a lista de episódios ganhou prévia animada');

  /* Na mesa, a linha é um cartão: um clique escolhe, e o duplo abre a ficha. */
  assert.match(app, /closest\('a\.card, a\.pcard, a\.ep'\)/, 'o duplo clique da mesa não abre a linha de episódio');
});

/* O alto da página é o destaque — as mesmas regras de LCP e de CLS. */
test('o alto da série veste o destaque: capa com prioridade alta, sem lazy, sem prévia', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const cabeca = app.match(/function cabecaDaSerie\(s, a\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(cabeca, 'não achei cabecaDaSerie em app.js');
  assert.match(cabeca[1], /criar\('section', 'destaque serie-cabeca'( \+|\))/,
    'o alto da série deixou de vestir o .destaque — e com ele o padding que segura o CLS');
  assert.match(cabeca[1], /setAttribute\('fetchpriority', 'high'\)/, 'a capa do alto perdeu a prioridade');
  assert.ok(!/loading\s*=/.test(cabeca[1]), 'a capa do alto ficou preguiçosa — ela é o LCP da página');
  assert.ok(!/ligarPreview\(|urlPreview\(/.test(cabeca[1]), 'o alto da série ganhou prévia animada');
  assert.match(cabeca[1], /img\.width = 640/);
  assert.ok(!/'Assistir'/.test(cabeca[1]),
    'o alto da série ganhou "Assistir" — numa série sem número, o primeiro é só o primeiro do alfabeto');

  /* A margem que ele ganhou é de BAIXO: margem em cima colapsaria através do
   * <main> e empurraria a página quando o catálogo chega. */
  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));
  const regra = css.match(/\n\.serie-cabeca\s*\{([^}]*)\}/);
  assert.ok(regra, 'não achei a regra de .serie-cabeca');
  assert.ok(!/margin-top|margin:/.test(regra[1]), 'o alto da série ganhou margem em cima');
});

/* A FICHA DA D6. Os dois botões ← → embaixo do player saíram, e no lugar deles
 * entrou a lista da série — a mesma da página, com o título na tela marcado. O
 * portão da fase é "capítulos e Shift+N/P intactos": o Shift+N continua vindo
 * dos vizinhos, e a lista de capítulos continua sendo montada pela mesma
 * função, com o mesmo alvo — só mudou de coluna. */
test('a ficha troca os botões ← → pela lista da série, e o Shift+N continua', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const ficha = app.match(/function renderFicha\(id, tocar, momento, jaEsperou\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(ficha, 'não achei renderFicha em app.js');
  assert.ok(!/navegacao|viz\.anterior\.titulo|viz\.proximo\.titulo/.test(ficha[1]),
    'os botões ← → voltaram para a ficha');
  assert.match(ficha[1], /anterior: viz\.anterior, proximo: viz\.proximo/,
    'o player perdeu os vizinhos — o Shift+N / Shift+P deixa de andar');
  assert.match(ficha[1], /App\.paginaDaSerie\(/, 'a lista da ficha não sai da mesma função da página');
  assert.match(ficha[1], /grade\.appendChild\(secaoEpisodios\(daSerie, item\.id\)\)/,
    'a lista da série saiu da grade da ficha, ou deixou de marcar o título na tela');
  /* Série de um título só não ganha uma lista com uma linha, que seria ela
   * mesma. */
  assert.match(ficha[1], /i\.id !== item\.id/, 'a lista aparece mesmo sem outro título para onde ir');
  assert.match(ficha[1], /listaCapitulos\(item, alvoCapitulos\)[\s\S]*lado\.appendChild\(caps\)/,
    'a lista de capítulos saiu da coluna do lado');

  /* A grade de três áreas: no computador a série fica embaixo do vídeo, e o
   * lado desce pelas duas linhas; numa coluna, a ordem é a do HTML — e o modo
   * teatro tem de descer as ÁREAS junto, senão "lado" recria a segunda coluna. */
  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));
  const grade = css.match(/\n\.ficha\s*\{([^}]*)\}/);
  assert.ok(grade, 'não achei a regra de .ficha');
  assert.match(grade[1], /grid-template-areas:\s*"video lado" "serie lado"/,
    'a lista da série deixou de ficar embaixo do vídeo no computador');
  assert.match(grade[1], /align-items:\s*start/, 'a linha do vídeo estica até a altura do lado');
  assert.match(css, /\.ficha \{ grid-template-columns: 1fr; grid-template-areas: "video" "lado" "serie"; \}/,
    'no celular a ordem deixou de ser vídeo, texto, série');
  assert.match(css, /body\.app-teatro \.ficha \{ grid-template-columns: 1fr; grid-template-areas: "video" "lado" "serie"; \}/,
    'o modo teatro não desce as áreas — a segunda coluna volta');
});

/* 44 px — os três alvos da ficha que a D5 mediu abaixo disso em 375 px, em
 * 15/09: o "← Voltar ao catálogo" (22), os botões de episódio (40, e eles
 * saíram) e o "Administração" do rodapé (16). */
test('44 px no "Voltar" e no "Administração" — e o rodapé não cresce por isso', () => {
  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));
  const regra = (seletor) => {
    const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp('\\n' + escapado + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, 'não achei a regra base de ' + seletor);
    return m[1];
  };
  assert.match(regra('.voltar'), /min-height:\s*44px/, 'o "Voltar" da ficha ficou abaixo de 44 px');

  /* O alvo do rodapé é a linha mais o padding de cima e de baixo, e a margem
   * negativa devolve os dois: o alvo cresce, a linha não. A conta usa a letra
   * do rodapé e a entrelinha do <body>, lidas do arquivo. */
  const link = regra('.rodape a');
  const pad = link.match(/padding:\s*(\d+)px/);
  const marg = link.match(/margin:\s*-(\d+)px/);
  assert.ok(pad && marg, 'o "Administração" perdeu o padding ou a margem que o compensa');
  assert.equal(pad[1], marg[1], 'a margem não devolve o padding inteiro — o rodapé muda de altura');
  const letra = Number(regra('.rodape').match(/font-size:\s*([\d.]+)px/)[1]);
  const entrelinha = Number(regra('body').match(/line-height:\s*([\d.]+)/)[1]);
  assert.ok(letra * entrelinha + 2 * Number(pad[1]) >= 44,
    'o "Administração" tem ' + (letra * entrelinha + 2 * Number(pad[1])).toFixed(1) + ' px de alvo');
  assert.match(link, /display:\s*inline-block/, 'padding vertical em elemento inline não cresce o alvo de todo navegador');
});

/* Na mesa, o rascunho troca os textos da ficha no lugar. A série em cima do
 * título é um campo novo (D6), e mudar a série de um título no inspetor tem de
 * aparecer ali sem derrubar o player. */
test('na mesa, a série em cima do título também muda no lugar', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  assert.match(app, /campoDaFicha\(criar\('p', 'destaque-serie ficha-serie', serieDaFicha\(item\)\), item, 'serie'\)/,
    'a série em cima do título não está marcada para a mesa');
  const noLugar = app.match(/function atualizarFichaNoLugar\(id\) \{([\s\S]*?)\n  \}/);
  assert.match(noLugar[1], /\[data-mesa-campo="serie"\]'\)\.textContent = serieDaFicha\(item\)/,
    'a mesa muda a série e a ficha continua mostrando a antiga');
  assert.match(noLugar[1], /\.ep-atual \.ep-titulo/, 'o título digitado na mesa fica velho na lista da série');
});

/* A D7 no cartão e no destaque: a série pequena não tem página, e ninguém é
 * mandado para uma. */
test('o cartão e o "Ver a série" só levam à página quando a série tem uma', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const cartao = app.match(/function cartaoSerie\(s\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(cartao, 'não achei cartaoSerie em app.js');
  assert.match(cartao[1], /s\.temPagina\s*\?\s*'#\/serie\/' \+ encodeURIComponent\(s\.nome\)\s*:\s*'#\/ep\/' \+ encodeURIComponent\(s\.itens\[0\]\.id\)/,
    'o cartão da série pequena não leva mais direto à ficha');

  const destaque = app.match(/function destaqueHtml\(item\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(destaque[1], /daSerie && daSerie\.temPagina/, '"Ver a série" aparece para série sem página');
  assert.match(destaque[1], /'#\/serie\/' \+ encodeURIComponent\(daSerie\.nome\)/,
    '"Ver a série" não leva à página da série');
  assert.ok(!/'#\/tudo\/'/.test(destaque[1]), '"Ver a série" voltou para a grade da prateleira');
});

/* "Início" é um link para #/ — e com uma busca digitada o endereço JÁ É #/,
 * então o clique não dispara hashchange e nada acontecia. Conferido em 15/09 no
 * logo, que tem o mesmo href: com "português" na busca, o clique deixava a
 * grade onde estava. Com um "Início" escrito no cabeçalho, seria um botão morto
 * à vista de todos. */
test('Início volta para a chegada mesmo quando o endereço já é #/', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const fn = app.match(/function irAoInicio\(ev\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'não achei irAoInicio em app.js');
  assert.match(fn[1], /ctrlKey/, 'Ctrl+clique abre outra aba — não pode apagar a busca desta');
  assert.match(fn[1], /esquecerBusca\(\)/, 'o Início não esquece mais a busca');
  assert.match(fn[1], /preventDefault\(\)/, 'no mesmo endereço, o Início precisa desenhar a chegada ele mesmo');
  assert.match(app, /querySelectorAll\('\[data-inicio\]'\)/, 'o Início não está ligado aos links que levam ao começo');

  /* Esquecer é o termo, o campo E o chip: sobrando o chip, `renderGrade` não
   * desenharia a chegada. */
  const esquecer = app.match(/function esquecerBusca\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(esquecer, 'não achei esquecerBusca em app.js');
  assert.match(esquecer[1], /estado\.termo = ''/, 'esquecer a busca não apaga o termo');
  assert.match(esquecer[1], /estado\.serie = ''/, 'esquecer a busca deixa o chip ligado — e a chegada não volta');
  assert.match(esquecer[1], /el\.busca\.value = ''/, 'esquecer a busca apaga o termo e deixa o campo escrito');

  /* E ir para Séries ou para um "Ver tudo" também deixa a busca para trás: um
   * termo esquecido filtraria a grade da série sem nada na tela dizendo. */
  const rotear = app.match(/function rotear\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.match(rotear[1], /if \(indice \|\| serie \|\| tudo\) esquecerBusca\(\)/,
    'chegar em Séries ou num "Ver tudo" não esquece mais a busca');

  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.equal((html.match(/href="#\/" data-inicio/g) || []).length, 2,
    'o logo e o link Início têm que passar os dois por irAoInicio');
});

/* O ATALHO QUE DESTRUÍA O PLAYER (15/09). "Pular para o conteúdo" era um link
 * para #conteudo — e #conteudo é um hash, e o roteador escuta hash. Numa ficha,
 * o atalho trocava o endereço, o roteador lia a chegada, e o vídeo ia embora
 * com o foco no <body>. O briefing diz que o atalho é uma das quatro coisas que
 * não podem regredir; ele já tinha regredido, e ninguém tinha apertado. */
test('o atalho de pular leva o foco ao conteúdo sem passar pelo roteador', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.match(html, /<a class="pular" href="#conteudo" id="pular"[^>]*>/, 'sumiu o atalho de pular');
  assert.match(html, /<main id="conteudo" class="limite" tabindex="-1">/,
    'o <main> não aceita foco — o atalho não tem onde pousar');

  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const liga = app.match(/el\.pular\.addEventListener\('click', function \(ev\) \{([\s\S]*?)\n    \}\);/);
  assert.ok(liga, 'o atalho de pular não tem mais o ouvinte próprio');
  assert.match(liga[1], /ev\.preventDefault\(\)/, 'o atalho volta a trocar o hash — e o roteador leva à chegada');
  assert.match(liga[1], /el\.conteudo\.focus\(\)/, 'o atalho não leva mais o foco ao conteúdo');
});

/* 44 px — a primeira das quatro regras. O campo de busca tinha 37,
 * medido em 15/09 em 375 e em 1400, e os chips, 29: nenhum dos dois tinha sido
 * medido quando entrou. */
test('44 px em todo alvo de toque do cabeçalho, e no chip', () => {
  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));
  const regra = (seletor) => {
    const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp('\\n' + escapado + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, 'não achei a regra base de ' + seletor);
    return m[1];
  };
  assert.match(regra('.topo-link'), /min-height:\s*44px/, 'o link do cabeçalho ficou abaixo de 44 px');
  assert.match(regra('.busca input'), /min-height:\s*44px/, 'o campo de busca ficou abaixo de 44 px');
  assert.match(regra('.chip'), /min-height:\s*44px/, 'o chip ficou abaixo de 44 px');
  const botao = regra('.topo-botao');
  assert.match(botao, /width:\s*44px/, 'o botão da busca ficou mais estreito que 44 px');
  assert.match(botao, /height:\s*44px/, 'o botão da busca ficou mais baixo que 44 px');
  assert.match(regra('.marca-logo'), /height:\s*48px/, 'o logo mudou de altura — e ele é o alvo do Início');
});

/* A segunda regra: foco visível. Cada controle do cabeçalho — e o chip, que
 * saiu dele — tem o anel na cor da marca, que dá 8,03:1 sobre --fundo. */
test('foco visível em todo controle do cabeçalho, e no chip', () => {
  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));
  const regras = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ seletor: m[1], corpo: m[2] }));
  for (const alvo of ['.marca:focus-visible', '.topo-link:focus-visible', '.topo-botao:focus-visible', '.chip:focus-visible']) {
    const achada = regras.find(r => r.seletor.split(',').some(s => s.trim() === alvo));
    assert.ok(achada, 'sem regra de foco para ' + alvo);
    assert.match(achada.corpo, /outline:\s*2px solid var\(--marca\)/, alvo + ' não desenha o anel de foco');
  }
});

/* A busca no celular: um botão que abre o campo no lugar do logo. Com o campo
 * sempre à mostra, o cabeçalho de 375 px tinha 137 px de altura, preso no alto
 * da tela — 17% dela, o tempo todo (medido em 15/09). */
test('a busca do celular abre pelo botão, diz que abriu e fecha com Esc', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.match(html, /<div class="busca" id="busca-caixa">/, 'a caixa da busca perdeu o id que o botão controla');
  assert.match(html,
    /<button type="button" class="topo-botao busca-abrir" id="busca-abrir" aria-controls="busca-caixa" aria-expanded="false" aria-label="[^"]+"[^>]*>/,
    'o botão de abrir a busca perdeu o estado ou o rótulo');
  assert.match(html, /<button type="button" class="topo-botao busca-fechar" id="busca-fechar" aria-label="[^"]+"[^>]*>/,
    'o botão de fechar a busca perdeu o rótulo');

  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const marcar = app.match(/function marcarBusca\(aberta\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(marcar, 'não achei marcarBusca em app.js');
  assert.match(marcar[1], /classList\.toggle\('topo-buscando', aberta\)/);
  assert.match(marcar[1], /setAttribute\('aria-expanded', String\(aberta\)\)/,
    'o botão não diz mais se a busca está aberta');
  const abrir = app.match(/function abrirBusca\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(abrir, 'não achei abrirBusca em app.js');
  assert.match(abrir[1], /el\.busca\.focus\(\)/, 'abrir a busca não põe o foco no campo');
  assert.match(app, /ev\.key === 'Escape'/, 'Esc não fecha mais a busca');

  const css = semComentarios(lerTexto(path.join(SITE, 'style.css')));
  const celular = [...css.matchAll(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.match(celular, /\.topo-flutuante \.busca\s*\{[^}]*display:\s*none/, 'no celular o campo não recolhe mais');
  assert.match(celular, /\.busca-abrir\s*\{[^}]*display:\s*inline-flex/, 'no celular o botão da busca não aparece');
  assert.match(celular, /\.topo-flutuante\.topo-buscando \.busca\s*\{[^}]*display:\s*flex/,
    'aberta, a busca não aparece no celular');

  /* E a linha não muda de altura ao abrir. Quem dá a altura dela é o logo, de
   * 48 px; com a busca aberta ele some, o mais alto passa a ser o campo, de
   * 44, e a linha encolhia de 64 para 60 — a página subia 4 px (medido na
   * primeira versão desta fase, em 15/09). A altura é fixada nos dois tamanhos
   * de tela. */
  const base = css.match(/\n\.topo-flutuante \.topo-linha\s*\{([^}]*)\}/);
  assert.ok(base, 'não achei a regra da linha do cabeçalho');
  assert.match(base[1], /min-height:\s*72px/, 'a linha do cabeçalho do computador perdeu a altura fixa');
  assert.match(celular, /\.topo-flutuante \.topo-linha\s*\{[^}]*min-height:\s*64px/,
    'a linha do cabeçalho do celular perdeu a altura fixa — abrir a busca volta a deslocar a página');
});

/* ============================ a marca: ícones e compartilhamento ========= */

/* As medidas visual (B2 e B3), guardadas onde a próxima exportação
 * esbarra nelas. A primeira entrega de um designer externo trouxe o PNG "64×64"
 * com 65×64 e a imagem de compartilhamento com 1201×631 — artboard fora da
 * grade de pixels no Illustrator. Ninguém reclama: o navegador estica. */
const tamanhoPng = (arquivo) => {
  /* Leitura BINÁRIA dos 24 primeiros bytes: não é texto, e por isso não passa
   * pelo lerTexto. */
  const cabeca = Buffer.alloc(24);
  const fd = fs.openSync(arquivo, 'r');
  try { fs.readSync(fd, cabeca, 0, 24, 0); } finally { fs.closeSync(fd); }
  assert.equal(cabeca.toString('latin1', 1, 4), 'PNG', path.basename(arquivo) + ' não é PNG');
  return [cabeca.readUInt32BE(16), cabeca.readUInt32BE(20)];
};

test('todo ícone PNG do index.html tem o tamanho que declara', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  const icones = [...html.matchAll(/<link rel="icon" type="image\/png" sizes="(\d+)x(\d+)" href="([^"]+)">/g)];
  assert.ok(icones.length >= 2, 'o index.html perdeu os ícones PNG');
  for (const [, largura, altura, href] of icones) {
    assert.deepEqual(tamanhoPng(path.join(SITE, href)), [Number(largura), Number(altura)],
      href + ' não tem o tamanho que o <link> declara');
  }
});

test('a imagem de compartilhamento tem 1200×630 e até 100 KB', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  /* no HTML estático a imagem é relativa; a função `core/worker/home.js` a torna absoluta */
  const og = html.match(/<meta property="og:image" content="(?:[^"]*\/)?([^"/]+)">/);
  assert.ok(og, 'o index.html perdeu o og:image');
  const arquivo = path.join(SITE, og[1]);
  assert.deepEqual(tamanhoPng(arquivo), [1200, 630]);
  assert.ok(fs.statSync(arquivo).size <= 100 * 1024, og[1] + ' passou de 100 KB');
});

/* A TELA INICIAL (D8, e o E8). O manifest é o que faz o Android
 * oferecer "Instalar"; os ícones, o que aparece na tela do celular. */
const lerManifest = () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  const link = html.match(/<link rel="manifest" href="([^"]+)">/);
  assert.ok(link, 'o index.html perdeu o <link rel="manifest">');
  return JSON.parse(lerTexto(path.join(SITE, link[1])));
};

test('o manifest abre a chegada, sozinho, na cor do --fundo', () => {
  const m = lerManifest();
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.ok(m.short_name && m.short_name.length <= 12,
    'o short_name passou de 12 letras — o Android corta o nome embaixo do ícone');

  /* A cor da barra e da tela de abertura é a do fundo da chegada: outra cor
   * pisca antes do primeiro quadro. */
  const css = semComentarios(lerTexto(path.join(SITE, 'theme.css')));
  const fundo = css.match(/--fundo:\s*(#[0-9a-f]{6})/i)[1].toLowerCase();
  assert.equal(m.background_color.toLowerCase(), fundo, 'background_color não é o --fundo');
  assert.equal(m.theme_color.toLowerCase(), fundo, 'theme_color não é o --fundo');
  const html = lerTexto(path.join(SITE, 'index.html'));
  const meta = html.match(/<meta name="theme-color" content="([^"]+)">/);
  assert.ok(meta, 'o index.html perdeu o <meta name="theme-color">');
  assert.equal(meta[1].toLowerCase(), fundo, 'o <meta name="theme-color"> não é o --fundo');
});

test('o manifest tem os ícones de 192 e 512, "any" e "maskable", do tamanho que declaram', () => {
  const { icons } = lerManifest();
  for (const lado of [192, 512]) {
    for (const uso of ['any', 'maskable']) {
      assert.ok(icons.some(i => i.sizes === lado + 'x' + lado && i.purpose === uso),
        'falta o ícone ' + lado + ' com purpose ' + uso);
    }
  }
  for (const i of icons) {
    const [l, a] = i.sizes.split('x').map(Number);
    assert.deepEqual(tamanhoPng(path.join(SITE, i.src.replace(/^\//, ''))), [l, a],
      i.src + ' não tem o tamanho que o manifest declara');
  }
});

/* A D8 era SEM offline: um service worker guardaria catálogo e site velhos no aparelho, e o deploy deixaria de
 * chegar a quem instalou. Na M6 ele passou a ser OPCIONAL e MÍNIMO (`recursos.pwaCacheDoShell`, desligado por
 * padrão; guarda só a casca e nunca API, conta ou mídia — tests/home-pwa.test.js confere o sw.js). O que continua
 * valendo daqui: nenhum arquivo do site mexe com service worker, a não ser o app.js, e ele só REGISTRA quando o
 * config pediu. */
test('service worker só no app.js, e só registrado quando o config liga', () => {
  for (const nome of fs.readdirSync(SITE).filter(n => /\.(js|html)$/.test(n) && n !== 'sw.js')) {
    const fonte = semComentarios(lerTexto(path.join(SITE, nome)));
    if (nome === 'app.js') continue;
    assert.ok(!/serviceWorker/.test(fonte), nome + ' registra um service worker');
  }
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const corpo = app.match(/function cuidarDoServiceWorker\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei cuidarDoServiceWorker');
  assert.match(corpo[1], /pwaCacheDoShell === true/, 'o registro não olha o config');
  assert.match(corpo[1], /if \(ligado\)[\s\S]*register\(/, 'o register saiu de trás do config');
  assert.equal((app.match(/serviceWorker\.register\(/g) || []).length, 1, 'há mais de um lugar registrando service worker');
});

/* "Margem interna maior que a do favicon — o Android recorta em círculo" (E8).
 * O recorte só garante o círculo de 40% do lado a partir do centro, e o
 * favicon vai a 41%: posto como está, o Android corta a ponta das ondas. O
 * teste LÊ o PNG e confere que todo pixel fora desse círculo é a cor de
 * fundo — é a próxima exportação que esquece a margem que ele pega. */
const pixelsPng = (arquivo) => {
  const zlib = require('node:zlib');
  /* Binário, como o tamanhoPng: não é texto e não passa pelo lerTexto. */
  const buf = Buffer.alloc(fs.statSync(arquivo).size);
  const fd = fs.openSync(arquivo, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
  let pos = 8, largura, altura, profundidade, tipo, entrelacado;
  const dados = [];
  while (pos < buf.length) {
    const tam = buf.readUInt32BE(pos);
    const nome = buf.toString('latin1', pos + 4, pos + 8);
    const corpo = buf.subarray(pos + 8, pos + 8 + tam);
    if (nome === 'IHDR') {
      largura = corpo.readUInt32BE(0); altura = corpo.readUInt32BE(4);
      profundidade = corpo[8]; tipo = corpo[9]; entrelacado = corpo[12];
    } else if (nome === 'IDAT') dados.push(corpo);
    pos += 12 + tam;
  }
  assert.equal(profundidade, 8, path.basename(arquivo) + ': só sei ler 8 bits por canal');
  assert.ok(tipo === 2 || tipo === 6, path.basename(arquivo) + ': só sei ler RGB e RGBA (PNG24/PNG32)');
  assert.equal(entrelacado, 0, path.basename(arquivo) + ': entrelaçado');
  const bpp = tipo === 6 ? 4 : 3, linha = largura * bpp;
  const cru = zlib.inflateSync(Buffer.concat(dados));
  const px = Buffer.alloc(linha * altura);
  for (let y = 0; y < altura; y++) {
    const filtro = cru[y * (linha + 1)];
    for (let x = 0; x < linha; x++) {
      const v = cru[y * (linha + 1) + 1 + x];
      const a = x >= bpp ? px[y * linha + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * linha + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * linha + x - bpp] : 0;
      let p = 0;
      if (filtro === 1) p = a;
      else if (filtro === 2) p = b;
      else if (filtro === 3) p = (a + b) >> 1;
      else if (filtro === 4) {
        const t = a + b - c, pa = Math.abs(t - a), pb = Math.abs(t - b), pc = Math.abs(t - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * linha + x] = (v + p) & 255;
    }
  }
  return { largura, altura, bpp, px };
};

test('o ícone de tela inicial cabe no círculo que o Android recorta', () => {
  for (const nome of ['icone-192.png', 'icone-512.png']) {
    const { largura, altura, bpp, px } = pixelsPng(path.join(SITE, nome));
    /* a cor de fundo é a do canto: o ícone sangra a cor da marca até a borda */
    const verde = [px[0], px[1], px[2]];
    const r = 0.40 * largura, cx = largura / 2, cy = altura / 2;
    let fora = 0, dentroNaoVerde = 0;
    for (let y = 0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {
        const i = (y * largura + x) * bpp;
        const eVerde = [0, 1, 2].every(k => Math.abs(px[i + k] - verde[k]) <= 2) && (bpp === 3 || px[i + 3] === 255);
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) { if (!eVerde) fora++; }
        else if (!eVerde) dentroNaoVerde++;
      }
    }
    assert.equal(fora, 0, nome + ': ' + fora + ' pixels do desenho fora do círculo de 40% — o Android corta');
    assert.ok(dentroNaoVerde > largura * altura * 0.05, nome + ': o desenho sumiu');
  }
});

/* Texto de SVG vira contorno, e não é capricho: o "Cabeçalho" da
 * mesma entrega trazia o "Catálogo Interno" em Calibri VIVA. No Windows fica
 * perfeito, porque a Calibri está instalada — e é por isso que ninguém vê. No
 * celular, que é onde o catálogo é aberto, o navegador põe outra fonte no
 * lugar. */
test('nenhum SVG do site depende de fonte instalada', () => {
  const svgs = fs.readdirSync(SITE).filter(n => n.endsWith('.svg'));
  assert.ok(svgs.includes('favicon.svg'), 'o favicon.svg sumiu');
  for (const nome of svgs) {
    assert.ok(!/<text[\s>]|font-family/.test(lerTexto(path.join(SITE, nome))),
      nome + ' tem texto vivo — converta em contorno antes de pôr no site');
  }
});

/* ------------------- a trava do CRLF (09/09) ---------------------------- */

/* CUSTOU UMA INVESTIGAÇÃO, e o defeito estava no ar no repositório ABERTO.
 *
 * A árvore de trabalho no Windows é CRLF (`core.autocrlf=true`) e o
 * repositório guarda LF. Um regex que atravessa uma quebra de linha —
 * `/\.pl-b \{\n\s*flex: none/` — casa contra o blob e FALHA contra o arquivo
 * do disco, onde há um `\r` antes do `\n`. O teste do painel de som estava
 * assim: **verde no CI (Linux, LF) e vermelho em todo clone Windows**, do lado
 * de cá e do lado de lá, onde o README promete que os testes rodam.
 *
 * Ele nunca apareceu aqui porque as leituras dos arquivos servidos vinham de
 * uma árvore que, por acaso, estava em LF. É a armadilha clássica desta
 * plataforma vista pelo avesso: em vez de acusar formatação onde não há, ela
 * ESCONDE um teste quebrado.
 *
 * O conserto foi normalizar na LEITURA (`lerTexto`), o que mata a classe
 * inteira em vez de cada regex. Este teste guarda a porta: um
 * `fs.readFileSync` cru reabre o buraco, e a próxima pessoa que precisar ler
 * um arquivo vai copiar a linha de cima. */
test('todo arquivo lido nos testes passa pelo lerTexto — CRLF não pode decidir nada', () => {
  const eu = lerTexto(__filename);
  /* A definição do helper e a menção dele nos comentários são as únicas
   * ocorrências permitidas: uma é o próprio conserto, a outra o explica. */
  const crus = eu.split('\n')
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => /fs\.readFileSync\(/.test(linha))
    .filter(({ linha }) => !/^const lerTexto =/.test(linha.trim()))
    .filter(({ linha }) => !/^\s*\*/.test(linha));

  assert.deepEqual(crus, [],
    'leitura crua de arquivo nos testes: use lerTexto(), senão um regex com \\n ' +
    'passa no CI em Linux e reprova em qualquer clone Windows');
});

/* ============================ a mesa (15/09) ============================= */

/* O /admin novo mostra o site de verdade num <iframe>. O que
 * este teste guarda são as duas travas do modo mesa: ele só liga dentro de um
 * quadro, e só obedece a mensagem que vem da própria origem E da janela de
 * cima. Sem a segunda, qualquer página que emoldurasse o site poderia pôr
 * outro catálogo na tela de quem está olhando. */
test('o modo mesa só liga num quadro, e só ouve a própria origem', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  assert.match(app, /ligada: window\.parent !== window && \/\[\?&\]mesa=1/,
    'o modo mesa liga fora de um quadro');
  const ouvinte = app.match(/addEventListener\('message', function \(ev\) \{([\s\S]*?)\n    \}\);/);
  assert.ok(ouvinte, 'não achei o ouvinte de mensagens do modo mesa');
  assert.match(ouvinte[1], /ev\.origin !== window\.location\.origin \|\| ev\.source !== window\.parent/,
    'o ouvinte da mesa aceita mensagem de outra origem ou de outra janela');
  /* E quem fala com a mesa diz para quem: nunca para qualquer origem. */
  assert.ok(!/postMessage\([^)]*['"]\*['"]\s*\)/.test(app), 'o app.js manda mensagem para qualquer origem');
});

/* Redesenhar a ficha passa por destruirPlayer(): o vídeo pararia a cada tecla
 * digitada na mesa. Com a ficha aberta, o rascunho troca os textos no lugar. */
test('na mesa, o rascunho não derruba o player da ficha aberta', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const noLugar = app.match(/function atualizarFichaNoLugar\(id\) \{([\s\S]*?)\n  \}/);
  assert.ok(noLugar, 'não achei atualizarFichaNoLugar em app.js');
  assert.ok(!/destruirPlayer\(/.test(noLugar[1]), 'atualizar a ficha no lugar destrói o player');
  const pelaMesa = app.match(/function redesenharPelaMesa\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(pelaMesa, 'não achei redesenharPelaMesa em app.js');
  assert.match(pelaMesa[1], /if \(ficha && !el\.ficha\.hidden\) \{ atualizarFichaNoLugar\(/,
    'com a ficha aberta, a mesa tem de atualizar no lugar e não redesenhar');
});

/* ACHADO NA M2 (16/09), e é o mesmo tipo de erro do renderChips: um
 * `M.painelTela.contas = …` copiado do protótipo, onde esse objeto existia.
 * No código de verdade ele não existe, e a atribuição LANÇA — o que abortava o
 * resto do arquivo: a tela "Minha conta" e o seletor de capa inteiro deixavam
 * de ser definidos, sem nenhum teste reclamar. Este cobra que tudo o que a
 * mesa chama de si mesma exista em algum arquivo dela. */
test('a mesa não chama nem escreve em nada que ela não define', () => {
  const arquivos = ['mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa-home.js', 'mesa-acesso.js', 'mesa-mcp.js', 'mesa-saude.js', 'mesa-backup.js', 'mesa-custos.js', 'mesa-assistente.js', 'mesa.js'];
  const juntos = arquivos.map(a => semComentarios(lerTexto(path.join(SITE, a)))).join('\n');
  const definidos = new Set([...juntos.matchAll(/\bM\.([A-Za-z_]\w*)\s*=[^=]/g)].map(m => m[1]));
  /* O estado e os poucos objetos que a mesa preenche por dentro. */
  ['st', 'sessao', 'envio', 'contas'].forEach(n => definidos.add(n));

  const usados = new Set([...juntos.matchAll(/\bM\.([A-Za-z_]\w*)/g)].map(m => m[1]));
  const faltando = [...usados].filter(n => !definidos.has(n));
  assert.deepEqual(faltando, [], 'a mesa usa M.' + faltando.join(', M.') + ', que nenhum arquivo dela define');

  /* E o que a mesa usa do site tem de existir no core. */
  const doCore = new Set([...juntos.matchAll(/\bApp\.([A-Za-z_]\w*)/g)].map(m => m[1]));
  const core = require('../core/site/catalogo-core.js');
  const semCore = [...doCore].filter(n => !(n in core));
  assert.deepEqual(semCore, [], 'a mesa usa App.' + semCore.join(', App.') + ', que o catalogo-core.js não exporta');

  /* O mesmo para o indice-core.js, de onde vêm a leitura da legenda e as
   * contas da busca. */
  const doIndice = new Set([...juntos.matchAll(/\bAppIndice\.([A-Za-z_]\w*)/g)].map(m => m[1]));
  const semIndice = [...doIndice].filter(n => !(n in AppIndice));
  assert.deepEqual(semIndice, [], 'a mesa usa AppIndice.' + semIndice.join(', AppIndice.') + ', que o indice-core.js não exporta');
});

/* Achado ao juntar a mesa com a D5 (15/09): a D5 tirou os chips e, com eles,
 * `renderChips` — e o modo mesa ainda a chamava ao redesenhar. Nenhum teste
 * de texto reclamou; o erro só apareceria no primeiro rascunho, dentro do
 * quadro. Este teste cobra que toda função chamada pelo modo mesa existe. */
test('o modo mesa só chama funções que existem no app.js', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const daLinguagem = ['function', 'if', 'for', 'while', 'return', 'switch', 'catch', 'typeof',
    'String', 'Number', 'Boolean', 'Object', 'Array', 'Promise', 'JSON', 'Math',
    'setTimeout', 'clearTimeout', 'decodeURIComponent', 'encodeURIComponent'];
  for (const nome of ['ligarMesa', 'redesenharPelaMesa', 'atualizarFichaNoLugar', 'campoDaFicha',
    'pintarSelecao', 'rolarAteMesa', 'marcarMesa', 'avisarMesa']) {
    const corpo = app.match(new RegExp('function ' + nome + '\\([^)]*\\) \\{([\\s\\S]*?)\\n  \\}'));
    assert.ok(corpo, 'não achei ' + nome + ' em app.js');
    const chamadas = new Set([...corpo[1].matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]));
    for (const f of chamadas) {
      if (daLinguagem.includes(f)) continue;
      if (new RegExp('var ' + f + '\\s*=').test(corpo[1])) continue;
      assert.match(app, new RegExp('function ' + f + '\\('),
        nome + ' chama ' + f + '(), que não existe no app.js');
    }
  }
});

/* ACHADO NA FASE 5 DA BUSCA (22/09). A seção nova da visão geral chamava
 * `fatia`, que é uma função LOCAL de `visao()`: a chamada lançava
 * `ReferenceError`, o `desenharPainel` parava no meio e a coluna da direita
 * ficava congelada no que já estava na tela — com a mesa de pé, sem erro
 * visível e sem teste nenhum reclamando. Os testes de texto olhavam `M.*`,
 * `App.*` e `AppIndice.*`; função de arquivo, ninguém olhava.
 *
 * Esta varredura cobra, para CADA função de nível de arquivo do site e da
 * mesa, que tudo o que ela chama exista no arquivo dela — ou seja da
 * linguagem. É o `--check` que o Node não faz: ele lê a sintaxe, não os
 * nomes. */
test('cada função do site e da mesa só chama o que existe no arquivo dela', () => {
  const daLinguagem = new Set(['function', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'delete',
    'String', 'Number', 'Boolean', 'Object', 'Array', 'Promise', 'JSON', 'Math', 'Date', 'RegExp', 'Set', 'Map', 'WeakMap',
    'Error', 'URL', 'URLSearchParams', 'AbortController', 'FileReader', 'Blob', 'Image', 'Event', 'CustomEvent',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
    'decodeURIComponent', 'encodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'fetch', 'confirm',
    'alert', 'btoa', 'atob', 'require', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'AudioContext']);

  /* O que está entre aspas não é código: `'(hover: hover) and (pointer:
   * fine)'` tem um `and (` que não chama nada. */
  const semTextos = (js) => js.replace(/'(\\.|[^'\\])*'|"(\\.|[^"\\])*"/g, "''");

  for (const arquivo of ['app.js', 'mesa-base.js', 'mesa-painel.js', 'mesa-telas.js', 'mesa.js']) {
    const codigo = semTextos(semComentarios(lerTexto(path.join(SITE, arquivo))));
    /* As funções de nível de arquivo: dentro do IIFE, com dois espaços. */
    const nomes = [...codigo.matchAll(/\n  function ([A-Za-z_]\w*)\(/g)].map((m) => m[1]);
    assert.ok(nomes.length > 3, 'não achei as funções de ' + arquivo);
    for (const nome of nomes) {
      const corpo = codigo.match(new RegExp('\\n  function ' + nome + '\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}'));
      if (!corpo) continue;
      /* O que chega pronto: os parâmetros da função e os das funções de
       * dentro dela — `resolve` e `reject` de uma promessa, o `fn` de um
       * `forEach`. */
      const parametros = new Set(corpo[1].split(',').map((p) => p.trim()).filter(Boolean));
      [...corpo[2].matchAll(/function\s*[A-Za-z_]*\s*\(([^)]*)\)/g)].forEach((m) => {
        m[1].split(',').map((p) => p.trim()).filter(Boolean).forEach((p) => parametros.add(p));
      });
      const chamadas = new Set([...corpo[2].matchAll(/(?<![.\w$])([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]));
      for (const chamada of chamadas) {
        if (daLinguagem.has(chamada) || parametros.has(chamada)) continue;
        /* Declarada DENTRO da própria função (em qualquer profundidade)…
         *
         * O `=` da declaração não é enfeite no regex: com `[=(]` no lugar
         * dele, um `, fatia(` numa lista de argumentos passava por
         * "declaração com vírgula" e o teste dava o erro por bom. */
        if (new RegExp('(?:var|,)\\s*' + chamada + '\\s*=|function\\s+' + chamada + '\\s*\\(').test(corpo[2])) continue;
        /* …ou no NÍVEL DO ARQUIVO, que é a indentação de dois espaços dentro
         * do IIFE — inclusive num `var M = window.MESA, h = M.h;`. O nível é
         * o que importa: uma função declarada dentro de OUTRA função não se
         * alcança daqui, e era exatamente esse o erro de 22/09. */
        if (new RegExp('\\n  var\\s+' + chamada + '\\s*=|\\n  function\\s+' + chamada + '\\s*\\(|\\n  var [^\\n]*,\\s*' + chamada + '\\s*=').test(codigo)) continue;
        assert.fail(arquivo + ': ' + nome + '() chama ' + chamada + '(), que não existe no arquivo');
      }
    }
  }
});

/* O cartão da prateleira NÃO vira texto editável: ele mostra o título curto
 * ("Pescador artesanal"), que não existe no catálogo, e digitar ali editaria
 * outro texto. Só o título e a sinopse da ficha são editáveis no lugar. */
test('na mesa, só o título e a sinopse da ficha são editáveis no lugar', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const campo = app.match(/function campoDaFicha\(no, item, campo\) \{([\s\S]*?)\n  \}/);
  assert.ok(campo, 'não achei campoDaFicha em app.js');
  assert.match(campo[1], /if \(!mesa\.ligada\) return no;/, 'a ficha do site virou editável fora da mesa');
  assert.match(campo[1], /campo === 'titulo' \|\| campo === 'sinopse'/);
  for (const nome of ['cartao\\(item, porSentido\\)', 'cartaoPrateleira\\(item, mostrarSerie\\)']) {
    const fn = app.match(new RegExp('function ' + nome + ' \\{([\\s\\S]*?)\\n  \\}'));
    assert.ok(fn, 'não achei ' + nome);
    assert.ok(!/contentEditable/.test(fn[1]), nome + ' virou editável');
  }
});

/* A TABELA ORDENA PELO CABEÇALHO. O que estes quatro testes guardam é o que
 * some sem fazer barulho: o botão, o `aria-sort`, a terceira batida e o lugar
 * onde a ordem escolhida mora. */

/* Quem ordena é um BOTÃO dentro do <th> — não um <th> com ouvinte de clique em
 * cima. O botão é o que tem foco, tecla e nome; ao <th> cabe o `aria-sort`,
 * que é onde o leitor de tela procura a ordem. Um <th> clicável passa no olho
 * e some no teclado. */
test('o cabeçalho que ordena é botão, e a ordem vive no aria-sort do <th>', () => {
  const telas = semComentarios(lerTexto(path.join(SITE, 'mesa-telas.js')));
  const corpo = telas.match(/function cabecalho\(c\) \{([\s\S]*?)\n  \}/);
  assert.ok(corpo, 'não achei o cabeçalho da tabela em mesa-telas.js');
  assert.match(corpo[1], /h\('button', \{/, 'o rótulo do cabeçalho deixou de ser um botão');
  assert.match(corpo[1], /'aria-sort': ativa \? \(st\.ordemDesc \? 'descending' : 'ascending'\) : 'none'/,
    'o <th> deixou de dizer a ordem em aria-sort');
  /* `redesenhar()` devolve o foco pelo id do elemento: sem id, a batida no
   * cabeçalho joga quem usa teclado de volta para o começo da tela. */
  assert.match(corpo[1], /id: 'co-' \+ c\.ordem/, 'o botão do cabeçalho perdeu o id, e com ele o foco');
});

/* Uma coluna com chave que o core não conhece desenha um botão que não ordena
 * nada, e não avisa ninguém — nem em cima, nem no console. */
test('toda coluna que oferece ordem tem chave no core', () => {
  const bloco = lerTexto(path.join(SITE, 'mesa-telas.js')).match(/var COLUNAS = \[([\s\S]*?)\n  \];/);
  assert.ok(bloco, 'não achei a lista de colunas da tabela');
  const chaves = [...bloco[1].matchAll(/ordem: '([^']*)'/g)].map(m => m[1]).filter(Boolean);
  assert.equal(chaves.length, 6, 'a tabela deixou de oferecer as seis colunas que ordenam');
  for (const c of chaves) {
    assert.ok(App.COLUNAS_ORDENAVEIS.includes(c), 'a coluna ' + c + ' não tem chave no catalogo-core.js');
  }
});

/* Três batidas: ordena, inverte, e devolve a ordem do acervo — a única que
 * agrupa por série, e a que a tela abre. Sem a terceira, quem ordenasse por
 * duração não teria como voltar a enxergar as séries inteiras. */
test('bater três vezes no cabeçalho devolve a ordem do acervo', () => {
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  const corpo = mesa.match(/if \(a === 'ordenar'\) \{([\s\S]*?)\n      \}/);
  assert.ok(corpo, 'não achei a ação de ordenar em mesa.js');
  assert.match(corpo[1], /st\.ordem = coluna; st\.ordemDesc = false;/, 'a primeira batida não escolhe a coluna');
  assert.match(corpo[1], /st\.ordemDesc = true;/, 'a segunda batida não inverte');
  assert.match(corpo[1], /st\.ordem = ''; st\.ordemDesc = false;/, 'a terceira batida não volta à ordem do acervo');
});

/* Digitar na busca troca só o <tbody>, sem redesenhar a tela — é o caminho
 * rápido de quem está procurando. Se a ordem escolhida morasse no cabeçalho em
 * vez de no estado, cada letra digitada desfaria a ordem, com a seta
 * continuando na tela dizendo o contrário. */
test('a ordem escolhida mora no estado, e a busca não a desfaz', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  assert.match(base, /ordem: ''/, 'o estado da mesa não guarda a coluna escolhida');
  assert.match(base, /ordemDesc: false/, 'o estado da mesa não guarda a direção');

  const telas = semComentarios(lerTexto(path.join(SITE, 'mesa-telas.js')));
  assert.match(telas, /App\.ordenarPor\(App\.buscar\(cat\.itens, st\.busca\)\.filter\(regra\), st\.ordem, st\.ordemDesc\)/,
    'as linhas da tabela deixaram de sair da ordem que está no estado');

  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  const busca = mesa.match(/t\.id === 'cat-busca'\) \{([\s\S]*?)\n      return;/);
  assert.ok(busca, 'não achei o caminho rápido da busca em mesa.js');
  assert.match(busca[1], /M\.linhasCatalogo\(/, 'a busca deixou de refazer as linhas pela mesma função');
});

/* ============================ a estrutura vira dado (M4) ================= */

/* A M4: o que hoje é regra escrita no código — o nome e a
 * ordem das prateleiras, de que lado cada série cai, o título em destaque e os
 * textos fixos — passa a caber num campo de topo do catálogo, `site`, editável
 * pela mesa. O padrão continua NO CÓDIGO: catálogo sem `site` desenha
 * exatamente a chegada de hoje, e é o primeiro teste desta seção.
 *
 * O campo é um só de propósito, e não quatro campos de topo: o PUT já preserva
 * o documento inteiro, e `permissaoDoCampo('site', …)` já devolve "estrutura"
 * desde a M2 — a M4 não abre porta nova no servidor. */

test('sem o campo site, a chegada é exatamente a de hoje', () => {
  const semNada = App.prateleiras(catalogoPrateleiras);
  for (const site of [null, undefined, {}, { prateleiras: {} }]) {
    const com = App.prateleiras(catalogoPrateleiras, site);
    assert.deepEqual(com.map(p => p.id), semNada.map(p => p.id));
    assert.deepEqual(com.map(p => p.titulo), semNada.map(p => p.titulo));
    assert.deepEqual(com.map(p => p.itens.map(i => i.id)), semNada.map(p => p.itens.map(i => i.id)));
    assert.ok(com.every(p => !p.escondida), 'prateleira nasceu escondida sem ninguém mandar');
  }
});

/* O critério de aceite da fase, escrito no projeto: "cada prateleira
 * renomeada, reordenada e escondida na mesa aparece igual no site". */
test('a prateleira renomeada, reordenada e escondida vale no site', () => {
  const site = {
    prateleiras: {
      'institucional': { titulo: 'Da rede', ordem: 0 },
      'curtos': { ordem: 1 },
      'serie:Série Exemplo 1': { ordem: 2 },
      'mais-series': { escondida: true }
    }
  };
  const ps = App.prateleiras(catalogoPrateleiras, site);

  assert.deepEqual(ps.slice(0, 3).map(p => p.id), ['institucional', 'curtos', 'serie:Série Exemplo 1'],
    'a ordem escolhida não veio na frente');
  assert.equal(ps[0].titulo, 'Da rede', 'o nome escolhido não substituiu o do código');
  assert.equal(App.prateleiras(catalogoPrateleiras).find(p => p.id === 'institucional').titulo, 'Institucional',
    'renomear na mesa mudou o padrão do código, que é de onde parte quem não escolheu nada');

  const escondida = ps.find(p => p.id === 'mais-series');
  assert.equal(escondida.escondida, true);
  assert.ok(!App.prateleirasVisiveis(catalogoPrateleiras, site).some(p => p.id === 'mais-series'),
    'a prateleira escondida continuou na chegada');
});

/* Esconder prateleira é ESCONDER, nunca despublicar: o título continua na
 * busca, na página da série e no link direto. A mesa tem de saber dizer
 * QUANTOS títulos saem da chegada antes de alguém apertar o botão — "Mais
 * séries" sozinha leva 18 em produção. */
test('esconder prateleira tira da chegada, não do catálogo', () => {
  const site = { prateleiras: { 'mais-series': { escondida: true } } };
  const todas = App.prateleiras(catalogoPrateleiras, site);
  const escondida = todas.find(p => p.id === 'mais-series');

  assert.ok(escondida.itens.length, 'a prateleira escondida veio vazia — ela é a lista, só não é desenhada');
  assert.ok(App.prateleiraPorId(catalogoPrateleiras, 'mais-series', site),
    'o "Ver tudo" da prateleira escondida deixou de achar a prateleira');

  const somem = App.titulosSoEmEscondidas(catalogoPrateleiras, site).map(i => i.id).sort();
  assert.deepEqual(somem, ['mat-2', 'mat-3', 'par-1'],
    'o aviso da mesa não é a lista de quem some da chegada');

  /* Quem está em duas prateleiras não some por causa de uma. */
  const soCurtos = { prateleiras: { curtos: { escondida: true } } };
  assert.deepEqual(App.titulosSoEmEscondidas(catalogoPrateleiras, soCurtos), [],
    'títulos que aparecem noutra prateleira foram contados como perdidos');
});

/* Uma série nova que cruza os 3 títulos vira prateleira do nada, meses depois
 * de alguém ter arrumado a ordem. Ela entra no FIM — previsível — e não no
 * meio da ordem escolhida, que é o que aconteceria se a ordem fosse só o
 * índice do padrão. */
test('prateleira que não estava na ordem escolhida entra no fim', () => {
  const site = { prateleiras: { 'mais-series': { ordem: 0 }, 'curtos': { ordem: 1 } } };
  const ps = App.prateleiras(catalogoPrateleiras, site);
  assert.deepEqual(ps.slice(0, 2).map(p => p.id), ['mais-series', 'curtos']);
  assert.ok(ps.slice(2).every(p => p.id !== 'mais-series' && p.id !== 'curtos'));
  /* E o resto mantém a ordem relativa do padrão, sem embaralhar. */
  const padrao = App.prateleiras(catalogoPrateleiras).map(p => p.id)
    .filter(id => id !== 'mais-series' && id !== 'curtos');
  assert.deepEqual(ps.slice(2).map(p => p.id), padrao);
});

test('a classe da série sai do dado; sem dado, das três listas', () => {
  assert.equal(App.classeDaSerie('Eventos'), 'institucional');
  assert.equal(App.classeDaSerie('Curtas — Exemplo A'), 'curta');
  assert.equal(App.classeDaSerie('Série Exemplo 1'), 'pedagogica');
  /* A série que ninguém classificou continua pedagógica e aparece em "Mais
   * séries": o site não esconde título por lista desatualizada. */
  assert.equal(App.classeDaSerie('Série que ninguém viu'), 'pedagogica');

  const site = { classes: { 'Eventos': 'pedagogica', 'Série que ninguém viu': 'institucional' } };
  assert.equal(App.classeDaSerie('Eventos', site), 'pedagogica', 'o dado não venceu a lista do código');
  assert.equal(App.classeDaSerie('Série que ninguém viu', site), 'institucional');
  assert.equal(App.classeDaSerie('Eventos', { classes: { 'Eventos': 'inventada' } }), 'institucional',
    'uma classe que não existe passou por cima da lista');
});

/* E a classe do dado tem de mover o título de prateleira de verdade — a lista
 * do código é só o padrão dela. */
test('reclassificar uma série muda a prateleira em que o título cai', () => {
  const site = { classes: { 'Eventos': 'pedagogica' } };
  const ps = App.prateleiras(catalogoPrateleiras, site);
  const inst = ps.find(p => p.id === 'institucional');
  assert.ok(!inst || !inst.itens.some(i => i.serie === 'Eventos'),
    'Eventos continuou institucional depois de reclassificada');
  const serie = ps.find(p => p.id === 'serie:Eventos');
  assert.ok(serie && serie.itens.length === 3, 'Eventos virou pedagógica e não formou a própria prateleira');
  /* E, pedagógica, os três de menos de 5 min entram em "Até 5 minutos" — que é
   * justamente o que `ehInstitucional` barrava. */
  assert.ok(ps.find(p => p.id === 'curtos').itens.some(i => i.serie === 'Eventos'));
});

/* O destaque (D4) passa a ser o ID no `site`. O campo `destaque` do título é o
 * LEGADO: é o que está gravado no KV desde 14/09, e continua valendo enquanto
 * ninguém escolher pela mesa — a mesa apaga as marcas velhas ao gravar a
 * escolha nova, e aí sobra uma fonte só. */
test('o destaque sai do id no site; a marca no título é o legado', () => {
  const comMarca = catalogoPrateleiras.map(i => i.id === 'enq-1' ? Object.assign({}, i, { destaque: true }) : i);

  assert.equal(App.destaque(comMarca).id, 'enq-1', 'a marca velha deixou de valer sem ninguém ter escolhido nada');
  assert.equal(App.destaque(comMarca, { destaque: 'mat-2' }).id, 'mat-2', 'o id do site não venceu a marca velha');

  /* Um id que aponta para título fora do ar não vale — mostrar despublicado na
   * chegada é vazá-lo, e é a mesma defesa de antes. */
  assert.equal(App.destaque(comMarca, { destaque: 'oculto' }).id, 'enq-1');
  assert.equal(App.destaque(catalogoPrateleiras, { destaque: 'nao-existe' }).id,
    App.destaque(catalogoPrateleiras).id, 'id apagado do catálogo não caiu no padrão');

  /* Sem escolha nenhuma, o padrão de hoje: o primeiro da maior série. */
  assert.equal(App.destaque(catalogoPrateleiras, {}).id, App.destaque(catalogoPrateleiras).id);
  /* E o padrão não vai buscar destaque em prateleira escondida. */
  const escondendo = { prateleiras: { 'serie:Série Exemplo 1': { escondida: true }, 'curtos': { escondida: true } } };
  assert.notEqual(App.destaque(catalogoPrateleiras, escondendo).serie, 'Série Exemplo 1');
});

test('os textos do site têm padrão no código, e o dado só troca o que preencheu', () => {
  assert.equal(App.textoDoSite(null, 'semCapa'), App.TEXTOS_PADRAO.semCapa);
  assert.equal(App.textoDoSite({ textos: { semCapa: 'capa a caminho' } }, 'semCapa'), 'capa a caminho');
  assert.equal(App.textoDoSite({ textos: { semCapa: 'capa a caminho' } }, 'buscaVazia'), App.TEXTOS_PADRAO.buscaVazia,
    'trocar um texto apagou o padrão dos outros');
  /* Texto vazio é o padrão, não o silêncio: um campo limpo sem querer não pode
   * apagar da tela o aviso que explica o que houve. Quem quiser nada na tela
   * muda o desenho, não o texto. */
  assert.equal(App.textoDoSite({ textos: { semCapa: '   ' } }, 'semCapa'), App.TEXTOS_PADRAO.semCapa);
  assert.equal(App.textoDoSite(null, 'chave-que-nao-existe'), '');

  /* Os seis estados: o rodapé e os cinco estados do B8 — três
   * deles com título e ajuda, que é o que faz nove chaves (a ajuda da ficha
   * ausente entrou na D7). */
  assert.deepEqual(Object.keys(App.TEXTOS_PADRAO).sort(), [
    'buscaVazia', 'buscaVaziaAjuda', 'erroCatalogo', 'erroCatalogoAjuda',
    'fichaAusente', 'fichaAusenteAjuda', 'rodape', 'semCapa', 'videoIndisponivel'
  ]);
});

/* O saneador é a mesma ideia do `ajustes()` da API: o que sai daqui é forma
 * conferida, para o navegador não receber uma string onde espera número nem
 * uma classe inventada. Roda no servidor (o GET público) e na mesa. */
test('o site saneado descarta o que não é da forma, e não lança com dado torto', () => {
  const s = App.siteSaneado({
    destaque: 42,
    prateleiras: {
      curtos: { titulo: '  Na correria  ', ordem: 2, escondida: true },
      'mais-series': { ordem: '3', escondida: 'sim' },
      vazia: {},
      torta: 7
    },
    classes: { 'Eventos': 'pedagogica', 'Outra': 'inventada' },
    textos: { rodape: ' Uso interno ', semCapa: '', naoExiste: 'x' },
    lixo: { qualquer: 1 }
  });

  assert.equal(s.destaque, null, 'destaque que não é texto virou id');
  assert.equal(s.prateleiras.curtos.titulo, 'Na correria', 'o nome não foi aparado');
  assert.equal(s.prateleiras.curtos.ordem, 2);
  assert.equal(s.prateleiras.curtos.escondida, true);
  /* O saneador confere a FORMA, não adivinha a intenção: `'3'` não é número e
   * `'sim'` não é um sim. Coerção aqui é como um `escondida: 'nao'` sumiria com
   * uma prateleira — e ninguém saberia de onde veio. */
  assert.ok(!('mais-series' in s.prateleiras), 'número em texto e sim em texto viraram dado');
  assert.ok(!('vazia' in s.prateleiras) && !('torta' in s.prateleiras), 'entrada sem nada virou prateleira');
  assert.deepEqual(s.classes, { 'Eventos': 'pedagogica' });
  assert.deepEqual(s.textos, { rodape: 'Uso interno' });
  assert.ok(!('lixo' in s), 'campo desconhecido atravessou o saneador');

  for (const torto of [null, undefined, 'texto', 7, [], { prateleiras: 'x', classes: 3, textos: null }]) {
    assert.deepEqual(App.siteSaneado(torto), { destaque: null, prateleiras: {}, classes: {}, textos: {}, series: {} });
  }

  /* Determinístico: o rascunho compara por JSON.stringify, e mapa com chave em
   * ordem diferente contaria como mudança que ninguém fez. */
  const a = App.siteSaneado({ classes: { 'B': 'curta', 'A': 'pedagogica' } });
  const b = App.siteSaneado({ classes: { 'A': 'pedagogica', 'B': 'curta' } });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

/* As escritas puras que a mesa usa. Elas devolvem um `site` NOVO — o rascunho
 * guarda o valor inteiro do campo, e mexer no objeto que a tela está mostrando
 * apagaria o "antes" da comparação do Publicar. */
test('as escritas do site são puras e devolvem o mapa em ordem fixa', () => {
  const zero = App.siteSaneado(null);

  const comNome = App.comPrateleira(zero, 'curtos', { titulo: 'Na correria' });
  assert.equal(comNome.prateleiras.curtos.titulo, 'Na correria');
  assert.deepEqual(zero.prateleiras, {}, 'a escrita mexeu no objeto que recebeu');

  /* Voltar ao padrão é APAGAR a entrada, não gravar o nome do código: se o
   * padrão mudar um dia, quem não escolheu nada anda junto. */
  assert.deepEqual(App.comPrateleira(comNome, 'curtos', { titulo: '' }).prateleiras, {});

  const escondida = App.comPrateleira(zero, 'mais-series', { escondida: true });
  assert.equal(escondida.prateleiras['mais-series'].escondida, true);
  assert.deepEqual(App.comPrateleira(escondida, 'mais-series', { escondida: false }).prateleiras, {});

  const ordenado = App.comOrdemPrateleiras(zero, ['b', 'a', 'c']);
  assert.deepEqual(Object.keys(ordenado.prateleiras), ['a', 'b', 'c'], 'o mapa saiu fora da ordem das chaves');
  assert.deepEqual(['a', 'b', 'c'].map(id => ordenado.prateleiras[id].ordem), [1, 0, 2]);

  const classificado = App.comClasse(zero, 'Eventos', 'pedagogica');
  assert.deepEqual(classificado.classes, { 'Eventos': 'pedagogica' });
  assert.deepEqual(App.comClasse(classificado, 'Eventos', '').classes, {}, 'voltar ao padrão não apagou a entrada');

  const texto = App.comTexto(zero, 'rodape', 'Uso interno da rede.');
  assert.deepEqual(texto.textos, { rodape: 'Uso interno da rede.' });
  assert.deepEqual(App.comTexto(texto, 'rodape', '  ').textos, {});
  assert.deepEqual(App.comTexto(zero, 'naoExiste', 'x').textos, {}, 'texto fora dos seis entrou no dado');
});

/* O rascunho da mesa ganha um alvo novo. Os quatro campos são objetos
 * inteiros — e não "a prateleira X", "o texto Y" — porque é assim que o
 * Publicar confere campo a campo contra a leitura fresca do servidor: duas
 * pessoas arrumando prateleira ao mesmo tempo têm de brigar, não de gravar uma
 * por cima da outra em silêncio. */
test('o rascunho aceita o alvo site, e a permissão dele é estrutura', () => {
  const cat = { itens: catalogoPrateleiras, site: { destaque: 'enq-1' } };

  assert.equal(App.permissaoDoCampo('site', 'prateleiras'), 'estrutura');
  assert.equal(App.permissaoDoCampo('site', 'destaque'), 'estrutura');
  assert.equal(App.permissaoDoCampo('site', 'inventado'), null, 'campo desconhecido do site virou editável');

  /* O Publicar relê o catálogo e confere o "antes" campo a campo. Um catálogo
   * que nunca teve estrutura escolhida não é um campo que SUMIU: o valor de
   * antes é a ausência, e escrever por cima dela não é conflito. */
  const lista = App.registrarMudanca([], { alvo: 'site', campo: 'destaque', antes: 'enq-1', depois: 'mat-2' });
  assert.deepEqual(App.conflitosRascunho(cat, lista), []);
  assert.deepEqual(App.conflitosRascunho({ itens: [] },
    [{ alvo: 'site', campo: 'textos', antes: undefined, depois: { rodape: 'x' } }]), []);
  assert.deepEqual(App.conflitosRascunho({ itens: [], site: { destaque: 'outro' } }, lista),
    [{ alvo: 'site', campo: 'destaque', antes: 'enq-1', depois: 'mat-2', noServidor: 'outro' }],
    'outra tela mudou o destaque e o Publicar não viu');

  const aplicado = App.aplicarRascunho(cat, lista);
  assert.equal(aplicado.site.destaque, 'mat-2');
  assert.equal(cat.site.destaque, 'enq-1', 'o rascunho mexeu no catálogo original');
  assert.equal(App.destaque(aplicado.itens, aplicado.site).id, 'mat-2', 'a prévia da mesa não veria a mudança');

  /* Campo fora dos quatro é ignorado, como já era para o item e os ajustes. */
  const torto = App.aplicarRascunho(cat, [{ alvo: 'site', campo: 'inventado', antes: null, depois: 'x' }]);
  assert.ok(!('inventado' in (torto.site || {})));
});

/* A conferência de permissão do PUT (M2) já tratava `site` como estrutura, mas
 * nunca tinha tido dado de verdade para comparar. Agora tem. */
test('mudar a estrutura pede a permissão estrutura, no servidor', () => {
  const antes = { itens: [], site: { destaque: 'a', prateleiras: {} } };
  const depois = { itens: [], site: { destaque: 'b', prateleiras: {} } };
  const difs = App.diferencasDoCatalogo(antes, depois);
  /* A diferença da estrutura sai CAMPO A CAMPO desde a M5 — a regra é a mesma
   * (mexer na chegada pede "estrutura"), mas uma linha só dizendo "o campo
   * `site` mudou" não conta o que aconteceu nem deixa desfazer uma parte. Os
   * nomes são os do rascunho, e é isso que faz a mudança contrária caber nele
   * sem tradução. */
  const doSite = difs.filter(d => d.alvo === 'site');
  assert.deepEqual(doSite, [{ alvo: 'site', campo: 'destaque', antes: 'a', depois: 'b', permissao: 'estrutura' }]);
  assert.ok(!difs.some(d => d.alvo === 'catalogo'), 'a estrutura ainda aparece como um campo de topo cru');

  const conteudista = { usuario: 'ana', permissoes: ['conteudo'] };
  assert.equal(App.proibidas(conteudista, difs).length, 1, 'quem só tem conteúdo conseguiu mexer na chegada');
  const estruturista = { usuario: 'rui', permissoes: ['estrutura'] };
  assert.deepEqual(App.proibidas(estruturista, difs), []);
});

/* E o caminho inteiro, no runtime: o que a mesa grava tem de chegar ao
 * navegador de quem visita o site. A M1 aprendeu isso do jeito caro com o
 * `paraPublico` — campo que não sai na projeção não existe para o navegador,
 * e a escolha feita no /admin não tem efeito nenhum, sem erro e sem aviso. */
test('a estrutura escolhida atravessa o PUT e sai no GET público', async () => {
  const env = ambiente(kvDeMentira());
  const sup = await entrar(env, '', 'senha-do-super');

  const itens = catalogoPrateleiras.map(i => Object.assign({}, i, {
    fonte: { tipo: 'bunny', libraryId: '1', videoId: 'v-' + i.id }
  }));

  const gravado = await pedir(env, {
    metodo: 'PUT', caminho: '/api/catalogo', token: sup.token,
    corpo: {
      rev: 0, itens,
      site: {
        destaque: 'mat-2',
        prateleiras: { institucional: { titulo: 'Da rede', ordem: 0 }, 'mais-series': { escondida: true } },
        classes: { 'Eventos': 'pedagogica' },
        textos: { rodape: 'Uso interno da rede.' },
        lixo: 'isto não é campo'
      }
    }
  });
  assert.equal(gravado.status, 200);

  const publico = await pedir(env, { caminho: '/api/catalogo' });
  assert.equal(publico.status, 200);
  assert.equal(publico.corpo.site.destaque, 'mat-2', 'a escolha do destaque não chegou ao site');
  assert.equal(publico.corpo.site.prateleiras.institucional.titulo, 'Da rede');
  assert.equal(publico.corpo.site.prateleiras['mais-series'].escondida, true);
  assert.deepEqual(publico.corpo.site.classes, { 'Eventos': 'pedagogica' });
  assert.deepEqual(publico.corpo.site.textos, { rodape: 'Uso interno da rede.' });
  assert.ok(!('lixo' in publico.corpo.site), 'o GET público não saneou a estrutura');

  /* O que o site desenha com o que recebeu: é a prova de ponta a ponta. */
  const ps = App.prateleirasVisiveis(publico.corpo.itens, publico.corpo.site);
  assert.equal(ps[0].titulo, 'Da rede');
  assert.ok(!ps.some(p => p.id === 'mais-series'));
  assert.equal(App.destaque(publico.corpo.itens, publico.corpo.site).id, 'mat-2');

  /* O `?completo=1` devolve o documento COMO ESTÁ no KV, e o que está no KV é
   * a estrutura SANEADA: desde a M5 o PUT guarda a forma conferida, com as
   * chaves em ordem estável, porque é contra esse valor que o Publicar confere
   * o "antes" na próxima vez — e dois mapas iguais em ordem diferente contariam
   * como mudança que ninguém fez. O campo inventado não sobreviveu à gravação. */
  const completo = await pedir(env, { caminho: '/api/catalogo?completo=1', token: sup.token });
  assert.ok(!('lixo' in completo.corpo.site), 'o PUT guardou um campo que o saneador descarta');
  assert.deepEqual(completo.corpo.site, publico.corpo.site,
    'o que está guardado e o que sai para o site deixaram de ser a mesma coisa');

  /* E a permissão, no servidor: quem só tem "conteúdo" não arruma a chegada. */
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: sup.token,
    corpo: { usuario: 'ana', senha: 'senha-bem-comprida', permissoes: ['conteudo'] } });
  const ana = await entrar(env, 'ana', 'senha-bem-comprida');
  const recusa = await pedir(env, {
    metodo: 'PUT', caminho: '/api/catalogo', token: ana.token,
    corpo: Object.assign({}, completo.corpo, { site: { destaque: 'enq-1' } })
  });
  assert.equal(recusa.status, 403);
  assert.equal(recusa.corpo.barradas[0].permissao, 'estrutura');
});

/* ======================= a apresentação da série ====== */

/* O dado da fase 1: `site.series[nome] = { sobre, origem, comeco,
 * momentos, temas }`. A forma é conferida sem o catálogo (o saneador roda no
 * GET e no PUT); o sentido, com ele (`apresentacaoDaSerie`). */

const itensApresentacao = catalogoPrateleiras.map(i => i.id === 'sx1-2'
  ? Object.assign({}, i, { capitulos: [{ inicio: 0, titulo: 'Abertura' }, { inicio: 95, titulo: 'O consultório' }] })
  : i.id === 'oculto'
    ? Object.assign({}, i, { capitulos: [{ inicio: 30, titulo: 'Bastidor' }] })
    : i);

test('a apresentação da série é saneada na forma, e o que não tem forma cai', () => {
  const s = App.siteSaneado({
    series: {
      'Série Exemplo 1': {
        sobre: '  Profissionais contam o dia a dia.  ',
        origem: 'revisada',
        comeco: 'sx1-1',
        momentos: [
          { id: 'sx1-2', inicio: 95 },
          { id: 'sx1-2', inicio: 95 },          /* repetido */
          { id: 'sx1-2', inicio: '95' },        /* texto não é segundo */
          { id: 'sx1-2', inicio: 1.5 },         /* nem fração */
          { id: 'sx1-2', inicio: -3 },
          { inicio: 10 },
          'lixo'
        ],
        temas: ['Vocação', ' vocação ', 'Saúde', 7, '', 'x'.repeat(80)],
        lixo: true
      },
      'Série Exemplo 2': { origem: 'revisada' },    /* só a origem não é dado */
      '   ': { sobre: 'sem nome' },
      'Eventos': 'texto',
      'Curtas': { sobre: 'Curtas.', origem: 'inventada' }
    }
  });

  assert.deepEqual(Object.keys(s.series), ['Curtas', 'Série Exemplo 1']);
  const d = s.series['Série Exemplo 1'];
  assert.equal(d.sobre, 'Profissionais contam o dia a dia.');
  assert.equal(d.origem, 'revisada');
  assert.equal(d.comeco, 'sx1-1');
  assert.deepEqual(d.momentos, [{ id: 'sx1-2', inicio: 95 }]);
  assert.deepEqual(d.temas.slice(0, 2), ['Vocação', 'Saúde'], 'o tema repetido em outra grafia ficou duas vezes');
  assert.equal(d.temas[2].length, 40, 'o tema comprido não foi cortado');
  assert.ok(!('lixo' in d), 'campo desconhecido atravessou o saneador');

  /* O desconhecido vira `auto`, nunca `revisada`: o script não sobrescreve o
   * revisado, e um revisado inventado trancaria o texto sem ninguém ter lido. */
  assert.equal(s.series['Curtas'].origem, 'auto');

  /* Os tetos: cinco momentos, cinco temas, e o texto não carrega uma página. */
  const muito = App.siteSaneado({ series: { X: {
    sobre: 'a'.repeat(5000),
    momentos: Array.from({ length: 9 }, (_, i) => ({ id: 'sx1-2', inicio: i })),
    temas: Array.from({ length: 9 }, (_, i) => 'tema ' + i)
  } } }).series.X;
  assert.equal(muito.momentos.length, 5);
  assert.equal(muito.temas.length, 5);
  assert.ok(muito.sobre.length <= 1500);

  /* E a estrutura que só tem séries NÃO é vazia: o PUT não pode apagá-la. */
  assert.equal(App.siteVazio({ series: { X: { sobre: 'Texto.' } } }), false);
  assert.equal(App.siteVazio({ series: { X: { origem: 'auto' } } }), true);
});

test('a página da série só mostra o que existe: o momento cujo capítulo sumiu cai sozinho', () => {
  const site = { series: { 'Série Exemplo 1': {
    sobre: 'Profissionais contam o dia a dia.',
    comeco: 'sx1-3',
    momentos: [
      { id: 'sx1-2', inicio: 95 },     /* vale */
      { id: 'sx1-2', inicio: 96 },     /* dentro do capítulo, mas não no começo */
      { id: 'sx1-1', inicio: 0 },      /* título sem capítulo */
      { id: 'enq-1', inicio: 0 },      /* de outra série */
      { id: 'oculto', inicio: 30 },    /* fora do ar */
      { id: 'sumiu', inicio: 0 }
    ],
    temas: ['Vocação']
  } } };

  const a = App.apresentacaoDaSerie(itensApresentacao, 'Série Exemplo 1', site);
  assert.equal(a.sobre, 'Profissionais contam o dia a dia.');
  assert.equal(a.origem, 'auto');
  assert.equal(a.comeco.id, 'sx1-3');
  assert.equal(a.momentos.length, 1, 'momento sem capítulo, fora do ar ou de outra série chegou à página');
  assert.equal(a.momentos[0].item.id, 'sx1-2');
  assert.equal(a.momentos[0].capitulo, 'O consultório');
  /* O mesmo caminho do trecho da busca: a ficha abre PARADA no minuto. */
  assert.equal(a.momentos[0].link, '#/ep/sx1-2?t=95');
  assert.equal(a.momentos[0].link, App.linkDaFicha('sx1-2', 95));
  assert.deepEqual(a.temas, ['Vocação']);

  /* O começo tem de ser desta série e estar no ar. */
  for (const comeco of ['enq-1', 'oculto', 'sumiu']) {
    const s = { series: { 'Série Exemplo 1': { sobre: 'x', comeco } } };
    assert.equal(App.apresentacaoDaSerie(itensApresentacao, 'Série Exemplo 1', s).comeco, null,
      'o "Comece por aqui" apontou para ' + comeco);
  }

  /* Sem dado, sem série no ar, ou só com o que caiu: nada, e a página de hoje. */
  assert.equal(App.apresentacaoDaSerie(itensApresentacao, 'Série Exemplo 1', null), null);
  assert.equal(App.apresentacaoDaSerie(itensApresentacao, 'Série que não existe',
    { series: { 'Série que não existe': { sobre: 'x' } } }), null);
  assert.equal(App.apresentacaoDaSerie(itensApresentacao, 'Série Exemplo 1',
    { series: { 'Série Exemplo 1': { momentos: [{ id: 'sumiu', inicio: 0 }] } } }), null);
});

test('a escrita da série é pura, e voltar ao gerado é apagar a entrada', () => {
  const zero = App.siteSaneado(null);
  const gerado = App.comSerie(zero, 'Série Exemplo 2', { sobre: 'Texto do script.', temas: ['Língua'], origem: 'auto' });
  assert.deepEqual(zero.series, {}, 'a escrita mexeu no objeto que recebeu');
  assert.deepEqual(gerado.series['Série Exemplo 2'], { sobre: 'Texto do script.', temas: ['Língua'], origem: 'auto' });

  /* Editar um campo não leva os outros embora. */
  const revisado = App.comSerie(gerado, 'Série Exemplo 2', { sobre: 'Texto lido por gente.', origem: 'revisada' });
  assert.deepEqual(revisado.series['Série Exemplo 2'], { sobre: 'Texto lido por gente.', temas: ['Língua'], origem: 'revisada' });

  /* "Voltar ao gerado" apaga — o script escreve de novo, e não um valor
   * copiado do código ou do script de ontem. */
  assert.deepEqual(App.comSerie(revisado, 'Série Exemplo 2', null).series, {});
  assert.deepEqual(App.comSerie(revisado, 'Outra', null).series, revisado.series);
});

/* A permissão é campo a campo no servidor (M2), e o "Sobre" é CONTEÚDO — é
 * texto sobre os vídeos, como a sinopse. Quem arruma prateleira não reescreve
 * a apresentação, e quem revisa sinopse não precisa de "estrutura" para isso. */
test('a apresentação da série atravessa o PUT, sai no GET, e é da permissão conteúdo', async () => {
  assert.equal(App.permissaoDoCampo('site', 'series'), 'conteudo');
  assert.deepEqual(App.aplicarRascunho({ itens: [] }, [{ alvo: 'site', campo: 'series', antes: undefined, depois: { X: { sobre: 'y' } } }]).site,
    { series: { X: { sobre: 'y' } } }, 'o rascunho da mesa não aceita o campo');

  const env = ambiente(kvDeMentira());
  const sup = await entrar(env, '', 'senha-do-super');
  const itens = itensApresentacao.map(i => Object.assign({}, i, {
    fonte: { tipo: 'bunny', libraryId: '1', videoId: 'v-' + i.id }
  }));
  const series = { 'Série Exemplo 1': { sobre: 'Texto de exemplo.', momentos: [{ id: 'sx1-2', inicio: 95 }], temas: ['Vocação'] } };

  const gravado = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: sup.token,
    corpo: { rev: 0, itens, site: { series } } });
  assert.equal(gravado.status, 200);

  const publico = await pedir(env, { caminho: '/api/catalogo' });
  assert.deepEqual(publico.corpo.site.series['Série Exemplo 1'],
    { sobre: 'Texto de exemplo.', momentos: [{ id: 'sx1-2', inicio: 95 }], temas: ['Vocação'], origem: 'auto' });
  const a = App.apresentacaoDaSerie(publico.corpo.itens, 'Série Exemplo 1', publico.corpo.site);
  assert.equal(a.momentos[0].capitulo, 'O consultório', 'o momento não sobreviveu à projeção pública');

  const completo = await pedir(env, { caminho: '/api/catalogo?completo=1', token: sup.token });

  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: sup.token,
    corpo: { usuario: 'rui', senha: 'senha-bem-comprida', permissoes: ['estrutura'] } });
  const rui = await entrar(env, 'rui', 'senha-bem-comprida');
  const novo = { series: { 'Série Exemplo 1': Object.assign({}, series['Série Exemplo 1'], { sobre: 'Outro.', origem: 'revisada' }) } };
  const recusa = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: rui.token,
    corpo: Object.assign({}, completo.corpo, { site: novo }) });
  assert.equal(recusa.status, 403, 'quem só arruma a chegada reescreveu a apresentação');
  assert.equal(recusa.corpo.barradas[0].permissao, 'conteudo');

  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: sup.token,
    corpo: { usuario: 'ana', senha: 'senha-bem-comprida', permissoes: ['conteudo'] } });
  const ana = await entrar(env, 'ana', 'senha-bem-comprida');
  const aceita = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: ana.token,
    corpo: Object.assign({}, completo.corpo, { site: novo }) });
  assert.equal(aceita.status, 200, 'quem cuida do conteúdo não pôde revisar a apresentação');
});

/* O rodapé é o único dos seis textos que já existe no HTML — ele é desenhado
 * com a página, antes de o catálogo responder. O `app.js` escreve o texto do
 * dado por cima, e só quando é diferente: se o padrão do código e a frase do
 * `index.html` separarem, o rodapé passa a piscar em TODA visita, e ninguém
 * ligaria uma coisa à outra meses depois. */
test('o rodapé do HTML e o padrão do código são a mesma frase', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  const rodape = html.match(/<footer class="rodape">([\s\S]*?)<\/footer>/);
  assert.ok(rodape, 'não achei o rodapé no index.html');
  const doHtml = rodape[1].replace(/<[^>]*>/g, ' ').replace(/·[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  assert.equal(doHtml, App.TEXTOS_PADRAO.rodape);
});

/* Os cinco estados do B8 saem do dado, com padrão no código. Escrever a frase
 * de novo dentro do `app.js` seria um texto que a mesa não alcança — e é o
 * tipo de coisa que só aparece quando alguém edita e "não muda nada". */
test('os textos fixos do site saem do dado, e não de uma frase solta no app.js', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  for (const chave of Object.keys(App.TEXTOS_PADRAO)) {
    assert.ok(app.includes("frase('" + chave + "')"), 'o app.js não desenha o texto ' + chave);
    assert.ok(!app.includes("'" + App.TEXTOS_PADRAO[chave] + "'"),
      'a frase de ' + chave + ' está escrita à mão no app.js, fora do alcance da mesa');
  }
  /* A frase ainda cai em App.textoDoSite (o padrão do código); antes dele, só entra o config.public.json. */
  assert.match(app, /function frase\(chave\) \{[\s\S]*?return App\.textoDoSite\(estado\.site, chave\);/);
});

/* A chegada desenha o que a mesa escolheu: as prateleiras VISÍVEIS, na ordem
 * e com os nomes do dado, e o destaque pelo id. */
test('a chegada do site lê a estrutura, e a prévia da mesa recebe a mesma', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  assert.match(app, /App\.home\(estado\.itens, estado\.site, contextoDaHome\(\)\)/,
    'a chegada continua montando a lista sem a estrutura');
  assert.match(app, /!e\.prateleira\.escondida/, 'a chegada não tira as prateleiras escondidas');
  assert.match(app, /App\.destaque\(estado\.itens, estado\.site\)/);
  for (const chamada of app.split('App.prateleiraPorId(').slice(1)) {
    assert.match(chamada.slice(0, 120), /estado\.site, contextoDaHome\(\)\)/,
      'um "Ver tudo" ainda acha a prateleira pelo padrão, e não pela estrutura escolhida');
  }
  assert.match(app, /estado\.site = dados\.site \|\| \{\};/, 'o site não guarda a estrutura que a API mandou');

  /* E dentro da mesa o catálogo não vem da API: vem por postMessage. Sem o
   * `site` nessa mensagem, a prévia mostraria a chegada padrão enquanto o
   * site no ar mostra outra — a mesa mentiria sobre o próprio efeito. */
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  const carga = mesa.match(/tipo: 'catalogo',[\s\S]*?\n(.*dados: \{.*)/);
  assert.ok(carga, 'não achei a mensagem do catálogo em mesa.js');
  assert.match(carga[1], /site: siteDaPrevia/);
  assert.match(mesa, /var siteDaPrevia = App\.siteComPadroes\(App\.siteSaneado\(cat\.site\), st\.servidor\.padroes\);/,
    'a prévia da mesa não leva os padrões do config por baixo da estrutura, como o site no ar');
});

/* A mesa da M4: a tela Estrutura e a prateleira do painel editam A MESMA
 * coisa, e a única forma de as duas discordarem com o tempo é cada uma montar
 * o mapa do seu jeito. Elas chamam as funções de `mesa-base.js`, que chamam as
 * puras do core — e é isso que este teste cobra. */
test('as duas telas da estrutura escrevem pelas mesmas funções', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  const telas = semComentarios(lerTexto(path.join(SITE, 'mesa-telas.js')));
  const painel = semComentarios(lerTexto(path.join(SITE, 'mesa-painel.js')));
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));

  for (const nome of ['renomearPrateleira', 'esconderPrateleira', 'moverPrateleira',
    'padraoDaPrateleira', 'mudarClasseDaSerie', 'mudarTextoDoSite']) {
    assert.ok(base.includes('M.' + nome + ' = function'), 'mesa-base.js não define ' + nome);
  }
  /* Quem desenha não monta mapa: `comPrateleira` e companhia só aparecem no
   * mesa-base.js, e nas telas só para LER o que já está escolhido. */
  for (const escrita of ['App.comPrateleira(', 'App.comClasse(', 'App.comTexto(', 'App.comOrdemPrateleiras(']) {
    assert.ok(base.includes(escrita), 'mesa-base.js deixou de usar ' + escrita);
    assert.ok(!telas.includes(escrita), 'a tela Estrutura monta o mapa por fora: ' + escrita);
    assert.ok(!mesa.includes(escrita), 'mesa.js monta o mapa por fora: ' + escrita);
  }
  /* A exceção documentada: o painel usa `comPrateleira` para PERGUNTAR quantos
   * títulos sairiam da chegada se esta prateleira fosse escondida — não grava
   * nada, e é a conta feita antes do clique. */
  const usosNoPainel = (painel.match(/App\.comPrateleira\(/g) || []).length;
  assert.equal(usosNoPainel, 1, 'o painel passou a montar mapa da estrutura em mais de um lugar');
  assert.match(painel, /titulosSoEmEscondidas\(cat\.itens, App\.comPrateleira\(/,
    'o único uso de comPrateleira no painel deixou de ser o aviso do que some');
});

/* Reordenar grava a ordem de TODAS as prateleiras. Meia ordem — só as duas que
 * trocaram — poria as duas na frente de todas as outras, porque quem tem ordem
 * escolhida vem antes de quem não tem. */
test('mover prateleira grava a ordem inteira, e não só as duas que trocaram', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  const corpo = base.match(/M\.moverPrateleira = function \(id, passo\) \{([\s\S]*?)\n  \};/);
  assert.ok(corpo, 'não achei M.moverPrateleira');
  assert.match(corpo[1], /App\.prateleiras\(M\.efetivo\(\)\.itens, M\.site\(\), M\.CTX\)\.map/,
    'a ordem nova não parte da ordem que está na tela');
  assert.match(corpo[1], /App\.comOrdemPrateleiras\(M\.site\(\), ids\)/);

  /* E a função pura faz o que ele espera: a lista inteira, numerada de 0. */
  const site = App.comOrdemPrateleiras(null, ['curtos', 'mais-series', 'institucional']);
  assert.deepEqual(Object.keys(site.prateleiras).map(id => site.prateleiras[id].ordem).sort(), [0, 1, 2]);
  assert.equal(site.prateleiras['curtos'].ordem, 0);
});

/* Os campos da estrutura vivem em dois lugares — o painel da direita e a tela
 * do meio —, e cada um só pode redesenhar o OUTRO: redesenhar o lado onde o
 * cursor está tira o campo debaixo de quem digita. Foi o defeito 1 da M1, e
 * ele volta toda vez que alguém acrescenta um campo. */
test('o campo da estrutura não redesenha o lado em que está', () => {
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  const daTela = mesa.match(/data-texto-prateleira'\)[^;]*;/);
  assert.ok(daTela, 'não achei o campo de nome da tela Estrutura em mesa.js');
  assert.match(daTela[0], /semCentro: true/, 'o campo da tela Estrutura redesenha o próprio centro');
  const doPainel = mesa.match(/t\.id === 'pr-nome'[\s\S]{0,200}?;/);
  assert.ok(doPainel, 'não achei o campo de nome do painel em mesa.js');
  assert.match(doPainel[0], /semPainel: true/, 'o campo do painel redesenha o próprio painel');
});

/* A conta sem "estrutura" não arruma a chegada: os campos vêm desligados. Quem
 * recusa continua sendo o servidor (M2) — isto é conveniência, e a tela não
 * pode oferecer o que o PUT vai negar. */
test('sem a permissão estrutura, a tela não oferece o que o servidor recusa', () => {
  const telas = semComentarios(lerTexto(path.join(SITE, 'mesa-telas.js')));
  const tela = telas.match(/M\.telaEstrutura = function \(cat\) \{([\s\S]*?)\n  \};/);
  assert.ok(tela, 'não achei a tela Estrutura');
  assert.match(tela[1], /var pode = M\.pode\('estrutura'\)/);
  /* Os dois controles do corpo da tela — a classe da série e os textos fixos.
   * Os quatro da linha da prateleira (nome, subir, descer, esconder) estão em
   * `linhaPrateleira`, e vêm contados logo abaixo. */
  assert.equal((tela[1].match(/disabled: !pode/g) || []).length, 2,
    'a tela Estrutura tem controle sem `disabled: !pode`');
  const linha = telas.match(/function linhaPrateleira\([^)]*\) \{([\s\S]*?)\n  \}/);
  assert.ok(linha, 'não achei a linha da prateleira');
  assert.equal((linha[1].match(/disabled: !pode/g) || []).length, 4,
    'a linha da prateleira tem controle que não olha a permissão');

  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  assert.match(mesa, /M\.pode\('estrutura'\) \? itemMenu\('estrutura'/,
    'a tela Estrutura aparece no menu de quem não pode mexer nela');
});

/* O menu e o centro têm de conhecer a tela nova: sem uma das duas pontas, o
 * item existe e abre o vazio, ou a tela existe e ninguém chega nela. */
test('a tela Estrutura está no menu, na trilha e no centro', () => {
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  assert.match(mesa, /itemMenu\('estrutura', 'estrutura', tr\('mesa\.estrutura'\)\)/);
  assert.match(mesa, /st\.tela === 'estrutura' \? \[tr\('mesa\.ajustes'\), tr\('mesa\.estrutura'\)\]/);
  assert.match(mesa, /st\.tela === 'estrutura' \? M\.telaEstrutura\(cat\)/);
  /* E ela NÃO é uma tela do quadro: o centro dela é a lista, não o site. */
  const noQuadro = mesa.match(/var NO_QUADRO = \{([^}]*)\}/);
  assert.ok(noQuadro && !noQuadro[1].includes('estrutura'), 'a Estrutura entrou nas telas que mostram o site no quadro');
});

/* OS DOIS DEFEITOS QUE A CONFERÊNCIA NO RUNTIME ACHOU, e que 378 testes de
 * texto e de função pura não achariam. Ficam aqui para não voltarem.
 *
 * 1. As funções do core recebem e devolvem o `site` INTEIRO, para se compor
 *    umas com as outras; o rascunho guarda UM CAMPO. Sem o `.prateleiras` no
 *    fim da linha, o campo `prateleiras` guardava um `site` dentro dele, o
 *    `aplicarRascunho` montava `site.prateleiras.prateleiras`, e a prévia não
 *    mudava — sem erro nenhum na tela, e com o rascunho dizendo "1 alteração". */
test('o rascunho da estrutura guarda o campo, e não o site inteiro', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  const chamadas = [...base.matchAll(/M\.mudarSite\('(\w+)',([^;]*);/g)];
  assert.ok(chamadas.length >= 6, 'sumiram escritas da estrutura de mesa-base.js');
  for (const [, campo, resto] of chamadas) {
    if (campo === 'destaque') continue;   /* o destaque é um id, não um mapa */
    assert.ok(resto.includes('.' + campo), 'M.mudarSite(\'' + campo + '\', …) guarda o site inteiro no campo ' + campo);
  }

  /* E a regra do outro lado: aplicar um rascunho assim tem de montar o mapa no
   * lugar certo, e o site tem de enxergar a mudança. */
  const cat = { itens: catalogoPrateleiras };
  const mapa = App.comPrateleira(App.siteSaneado(null), 'curtos', { titulo: 'Na correria' }).prateleiras;
  const efetivo = App.aplicarRascunho(cat, [{ alvo: 'site', campo: 'prateleiras', antes: undefined, depois: mapa }]);
  assert.equal(App.prateleiras(efetivo.itens, efetivo.site)[0].titulo, 'Na correria',
    'o rascunho da estrutura não chega à chegada');
});

/* 2. Redesenhar no `change` mata o clique que vem logo depois: o `mousedown` no
 *    botão tira o foco do campo, o `change` dispara ANTES do clique, o
 *    redesenho troca os nós — e o botão em que a pessoa clicou já não está no
 *    documento quando o `click` sobe até `el.mesa`. Era um esconder de
 *    prateleira que simplesmente não acontecia. É primo do defeito 2 da M3: o
 *    ouvinte está no alto, e quem sai do documento nunca chega lá. */
test('o campo de texto da estrutura não redesenha ao sair do campo', () => {
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  const change = mesa.match(/addEventListener\('change', function \(ev\) \{([\s\S]*?)\n  \}\);/);
  assert.ok(change, 'não achei o ouvinte de change em mesa.js');
  for (const campo of ["'pr-nome'", "'tx-rodape'", "data-texto'", "data-texto-prateleira'"]) {
    assert.ok(!change[1].includes(campo),
      'o campo ' + campo + ' voltou a redesenhar no change, e o clique seguinte morre com o nó');
  }
});

/* ============================ o histórico (M5) =========================== */

/* A última fase: cada publicação deixa um registro do que
 * mudou e uma cópia inteira do catálogo, e desfazer é um rascunho novo — não um
 * caminho de gravação à parte. */

/* A ordem das chaves é a fase inteira em miniatura. A listagem do KV é sempre
 * ASCENDENTE e não tem ordem inversa: com a rev crua na chave, mostrar as 20
 * publicações mais novas exigiria percorrer todas as páginas até o fim, e o
 * histórico cresce para sempre. */
test('a chave do histórico ordena ao contrário; a da versão, em ordem', () => {
  const revs = [1, 2, 10, 108, 999];
  const hist = revs.map(App.chaveHistorico);
  assert.deepEqual(hist.slice().sort(), hist.slice().reverse(),
    'a listagem ascendente do KV não devolveria a rev mais nova primeiro');
  assert.deepEqual(hist.map(App.revDaChaveHistorico), revs, 'a chave não volta a ser rev');

  const ver = revs.map(App.chaveVersao);
  assert.deepEqual(ver.slice().sort(), ver, 'a mais velha não vem primeiro — é ela que sai na retenção');
  assert.deepEqual(ver.map(App.revDaChaveVersao), revs);

  /* Chave estranha na listagem não vira rev zero: vira nada, e quem lê decide. */
  assert.equal(App.revDaChaveHistorico('historico:abc'), null);
  assert.equal(App.revDaChaveVersao('catalogo'), null);
});

test('o resumo diz o que mudou por tipo, e some com o que é zero', () => {
  const difs = [
    { alvo: 'a', campo: 'sinopse' }, { alvo: 'a', campo: 'tema' },
    { alvo: 'b', campo: 'publicar' },
    { alvo: 'site', campo: 'prateleiras' },
    { alvo: 'c', campo: '*', tipo: 'novo' }
  ];
  const conta = App.contarMudancasPorAlvo(difs);
  assert.equal(conta.total, 5);
  assert.equal(conta.titulos, 3, 'dois campos do mesmo título são um título só');
  assert.equal(conta.estrutura, 1);
  assert.equal(conta.novos, 1);
  assert.equal(conta.ajustes, 0);
  assert.equal(App.resumoDeMudancas(conta), '3 títulos · 1 novo · estrutura');
  assert.equal(App.resumoDeMudancas(App.contarMudancasPorAlvo([])), 'nada mudou');
  assert.equal(App.resumoDeMudancas(App.contarMudancasPorAlvo([{ alvo: 'ajustes', campo: 'arrastoTeto' }])), 'player');
});

/* Desfazer é um RASCUNHO NOVO: a mudança contrária passa pelo mesmo Publicar,
 * pela mesma conferência de conflito e pela mesma permissão. O que não cabe no
 * rascunho — título criado ou removido, campo que a mesa não edita — recebe um
 * não, em vez de virar uma gravação que ninguém confere. */
test('desfazer devolve a mudança contrária, e diz não ao que não cabe', () => {
  assert.deepEqual(App.desfazerMudanca({ alvo: 'sx1-1', campo: 'sinopse', antes: 'velha', depois: 'nova' }),
    { alvo: 'sx1-1', campo: 'sinopse', valor: 'velha' });
  assert.deepEqual(App.desfazerMudanca({ alvo: 'site', campo: 'destaque', antes: 'enq-1', depois: 'mat-2' }),
    { alvo: 'site', campo: 'destaque', valor: 'enq-1' });
  assert.deepEqual(App.desfazerMudanca({ alvo: 'ajustes', campo: 'arrastoTeto', antes: 0.4, depois: 0.6 }),
    { alvo: 'ajustes', campo: 'arrastoTeto', valor: 0.4 });

  /* Campo que não existia antes volta a não existir. */
  assert.deepEqual(App.desfazerMudanca({ alvo: 'sx1-1', campo: 'tema', depois: 'novo' }),
    { alvo: 'sx1-1', campo: 'tema', valor: null });

  assert.equal(App.desfazerMudanca({ alvo: 'x', campo: '*', tipo: 'novo' }), null, 'título novo não se desfaz por rascunho');
  assert.equal(App.desfazerMudanca({ alvo: 'x', campo: '*', tipo: 'removido' }), null);
  assert.equal(App.desfazerMudanca({ alvo: 'sx1-1', campo: 'fonte', antes: {} }), null, 'campo fora da mesa virou desfazível');
  assert.equal(App.desfazerMudanca(null), null);
});

/* E a mudança contrária entra no rascunho como qualquer outra: mesmo formato,
 * mesma aplicação, mesmo Publicar. */
test('a mudança contrária cabe no rascunho sem tradução nenhuma', () => {
  const cat = { itens: [{ id: 'a', titulo: 'Depois', publicar: true }], site: { destaque: 'a' } };
  const difs = App.diferencasDoCatalogo(
    { itens: [{ id: 'a', titulo: 'Antes', publicar: true }], site: {} }, cat);

  /* O "antes" da mudança contrária é o que a publicação DEIXOU — `d.depois` —,
   * e é contra ele que o Publicar confere se outra tela mexeu no meio. */
  let rascunho = [];
  for (const d of difs) {
    const m = App.desfazerMudanca(d);
    if (!m) continue;
    rascunho = App.registrarMudanca(rascunho, { alvo: m.alvo, campo: m.campo, antes: d.depois, depois: m.valor });
  }

  const voltou = App.aplicarRascunho(cat, rascunho);
  assert.equal(voltou.itens[0].titulo, 'Antes', 'desfazer não devolveu o título de antes');
  assert.equal(voltou.site.destaque, null, 'desfazer não tirou o destaque que a publicação pôs');
});

/* Os testes do histórico NO RUNTIME: sobem o PUT e o /api/historico de verdade,
 * com o KV de mentira que agora tem listagem, metadados e apagamento. */

const catalogoDeTeste = (n) => ({
  rev: n, versao: 1, itens: [
    { id: 'a', titulo: 'Um', serie: 'Série Exemplo 2', publicar: true, sinopse: 'Primeira', fonte },
    { id: 'b', titulo: 'Dois', serie: 'Série Exemplo 2', publicar: true, fonte }
  ]
});

async function publicar(env, token, mudar) {
  const atual = (await pedir(env, { caminho: '/api/catalogo?completo=1', token })).corpo;
  const novo = JSON.parse(JSON.stringify(atual));
  delete novo.config;
  mudar(novo);
  return pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token, corpo: novo });
}

test('cada publicação deixa registro e cópia, e o resumo vem dos metadados', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) }));
  const sup = await entrar(env, '', 'senha-do-super');

  const r1 = await publicar(env, sup.token, (c) => { c.itens[0].sinopse = 'Segunda'; });
  assert.equal(r1.status, 200);
  assert.equal(r1.corpo.historico, true, 'a publicação não conseguiu gravar o histórico');
  assert.equal(r1.corpo.mudancas, 1, 'um campo mudou, e o registro contou outra coisa');

  const chave = App.chaveHistorico(r1.corpo.rev);
  const registro = JSON.parse(env.CATALOGO.dados[chave]);
  assert.equal(registro.rev, r1.corpo.rev);
  assert.equal(registro.quem, 'superadmin');
  assert.ok(registro.mudancas.some(m => m.alvo === 'a' && m.campo === 'sinopse' && m.antes === 'Primeira' && m.depois === 'Segunda'),
    'o registro não guarda o antes e o depois do campo');

  /* O resumo mora nos METADADOS: é o que faz a linha do tempo custar uma
   * listagem só, sem abrir registro nenhum. */
  const meta = env.CATALOGO.metas[chave];
  assert.equal(meta.rev, r1.corpo.rev);
  assert.equal(meta.quem, 'superadmin');
  assert.equal(meta.resumo, '1 título');
  assert.ok(meta.bytes > 0, 'a medida do documento não foi guardada');
  assert.ok(JSON.stringify(meta).length < 1024, 'os metadados passaram do 1 KB que o KV dá');

  /* A cópia da rev nova E a do estado que acabou de sair — a segunda uma vez
   * só, na virada, senão o primeiro "ver como estava" não teria o que mostrar. */
  assert.ok(env.CATALOGO.dados[App.chaveVersao(r1.corpo.rev)], 'não guardou a cópia da rev nova');
  assert.ok(env.CATALOGO.dados[App.chaveVersao(0)], 'não guardou a cópia do estado anterior na virada');

  /* E o `catalogo_anterior` aposentou: quem guarda o passado agora são as 30. */
  assert.ok(!env.CATALOGO.dados['catalogo_anterior'], 'o catalogo_anterior continua sendo escrito');
});

test('a linha do tempo vem da mais nova para a mais velha, numa listagem só', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) }));
  const sup = await entrar(env, '', 'senha-do-super');
  for (const t of ['Um', 'Dois', 'Três']) await publicar(env, sup.token, (c) => { c.itens[0].tema = t; });

  const r = await pedir(env, { caminho: '/api/historico', token: sup.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.linha.map(x => x.rev), [3, 2, 1],
    'a linha do tempo não começa pela publicação mais nova');
  assert.equal(r.corpo.linha[0].resumo, '1 título');
  assert.ok(r.corpo.fim, 'a listagem de três publicações veio paginada');

  const um = await pedir(env, { caminho: '/api/historico?rev=2', token: sup.token });
  assert.equal(um.corpo.registro.rev, 2);
  assert.equal(um.corpo.temCopia, true);
  assert.ok(um.corpo.registro.mudancas.some(m => m.campo === 'tema' && m.depois === 'Dois'));

  const copia = await pedir(env, { caminho: '/api/historico?versao=2', token: sup.token });
  assert.equal(copia.corpo.catalogo.itens[0].tema, 'Dois', 'a cópia não é o catálogo daquela rev');

  const nao = await pedir(env, { caminho: '/api/historico?rev=999', token: sup.token });
  assert.equal(nao.status, 404);
  assert.equal((await pedir(env, { caminho: '/api/historico' })).status, 401, 'o histórico abriu sem token');
});

/* A comparação é no SERVIDOR, e por isso gravação de script entra também — foi
 * a rev 85 apagando os ajustes do player em silêncio que pediu esta fase. */
test('gravação que não veio da mesa também deixa rastro', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(Object.assign(catalogoDeTeste(0), { ajustes: { arrastoTeto: 0.6 } })) }));
  const sup = await entrar(env, '', 'senha-do-super');

  /* Um script que reescreve o catálogo inteiro sem os ajustes. */
  const r = await pedir(env, {
    metodo: 'PUT', caminho: '/api/catalogo', token: sup.token,
    corpo: { rev: 0, versao: 1, itens: catalogoDeTeste(0).itens }
  });
  assert.equal(r.status, 200);
  const registro = JSON.parse(env.CATALOGO.dados[App.chaveHistorico(r.corpo.rev)]);
  const some = registro.mudancas.find(m => m.alvo === 'ajustes' && m.campo === 'arrastoTeto');
  assert.ok(some, 'o apagamento dos ajustes por script não apareceu no histórico');
  assert.equal(some.antes, 0.6);
  assert.equal(some.depois, undefined);
});

test('passadas as 30, a cópia mais velha sai — e o registro dela fica', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) }));
  const sup = await entrar(env, '', 'senha-do-super');
  for (let i = 1; i <= 32; i++) await publicar(env, sup.token, (c) => { c.itens[0].tema = 'tema ' + i; });

  const copias = Object.keys(env.CATALOGO.dados).filter(k => k.startsWith('versao:')).sort();
  assert.equal(copias.length, 30, 'guardou ' + copias.length + ' cópias, e a conta é de 30');
  assert.equal(App.revDaChaveVersao(copias[0]), 3, 'as cópias que saíram não foram as mais velhas');
  assert.equal(App.revDaChaveVersao(copias[29]), 32);

  const registros = Object.keys(env.CATALOGO.dados).filter(k => k.startsWith('historico:'));
  assert.equal(registros.length, 32, 'o registro do que mudou some junto com a cópia');

  const antiga = await pedir(env, { caminho: '/api/historico?rev=1', token: sup.token });
  assert.equal(antiga.status, 200, 'o registro antigo sumiu');
  assert.equal(antiga.corpo.temCopia, false, 'a tela não saberia que não dá para ver como estava');
});

test('restaurar pede a permissão histórico, e as de cada campo que a volta muda', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) }));
  const sup = await entrar(env, '', 'senha-do-super');
  await publicar(env, sup.token, (c) => { c.itens[0].sinopse = 'Escrita à mão'; });
  await publicar(env, sup.token, (c) => { c.itens[0].publicar = false; });

  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: sup.token,
    corpo: { usuario: 'ana', senha: 'senha-bem-comprida', permissoes: ['conteudo'] } });
  const ana = await entrar(env, 'ana', 'senha-bem-comprida');

  const semPermissao = await pedir(env, { metodo: 'POST', caminho: '/api/historico', token: ana.token, corpo: { restaurar: 1 } });
  assert.equal(semPermissao.status, 403);
  assert.equal(semPermissao.corpo.permissao, 'historico');

  /* Com `historico` mas sem `no-ar`, restaurar uma versão que põe título de
   * volta no ar continua barrado — e o servidor diz qual campo. */
  const mudou = await pedir(env, { metodo: 'PUT', caminho: '/api/contas', token: sup.token,
    corpo: { usuario: 'ana', permissoes: ['conteudo', 'historico'] } });
  assert.equal(mudou.status, 200, 'não consegui dar a permissão de histórico para a conta');
  const ana2 = await entrar(env, 'ana', 'senha-bem-comprida');
  const barrada = await pedir(env, { metodo: 'POST', caminho: '/api/historico', token: ana2.token, corpo: { restaurar: 1 } });
  assert.equal(barrada.status, 403);
  assert.equal(barrada.corpo.barradas[0].campo, 'publicar');

  const feita = await pedir(env, { metodo: 'POST', caminho: '/api/historico', token: sup.token, corpo: { restaurar: 1 } });
  assert.equal(feita.status, 200);
  assert.equal(feita.corpo.rev, 3, 'restaurar tem de andar a rev para a frente, não voltar');
  assert.equal(feita.corpo.restaurou, 1);

  const agora = (await pedir(env, { caminho: '/api/catalogo?completo=1', token: sup.token })).corpo;
  assert.equal(agora.itens[0].publicar, true, 'a volta não devolveu o título ao ar');
  assert.equal(agora.itens[0].sinopse, 'Escrita à mão');

  /* A volta é uma publicação como qualquer outra, e entra no histórico dizendo
   * de onde veio. */
  const meta = env.CATALOGO.metas[App.chaveHistorico(3)];
  assert.equal(meta.restaurou, 1);
  assert.equal((await pedir(env, { caminho: '/api/historico', token: sup.token })).corpo.linha[0].restaurou, 1);
});

/* O histórico é memória: um erro nele não pode derrubar a publicação que ele
 * descreve. A resposta diz que o buraco existe, e a tela avisa. */
test('se o histórico falhar, a publicação continua valendo', async () => {
  const kv = kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) });
  kv.list = async () => { throw new Error('KV fora do ar'); };
  const env = ambiente(kv);
  const sup = await entrar(env, '', 'senha-do-super');

  const r = await publicar(env, sup.token, (c) => { c.itens[0].tema = 'Assim mesmo'; });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.historico, false, 'a publicação não avisou que o histórico ficou para trás');
  assert.equal(JSON.parse(kv.dados.catalogo).itens[0].tema, 'Assim mesmo', 'a publicação se perdeu junto com o histórico');
});

/* A tela do histórico. As regras que ela não pode perder são três, e as três
 * são de PERMISSÃO ou de caminho de gravação — o resto é desenho. */
test('a tela do histórico desfaz pelo rascunho, e restaura pelo servidor', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  const telas = semComentarios(lerTexto(path.join(SITE, 'mesa-telas.js')));
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));

  /* 1. Desfazer é um rascunho novo. Se isto virar uma chamada de API,
   *    nasce um segundo caminho de gravação — e uma segunda conferência de
   *    permissão para manter. */
  const desfazer = base.match(/M\.desfazerDoHistorico = function \(dif\) \{([\s\S]*?)\n  \};/);
  assert.ok(desfazer, 'não achei M.desfazerDoHistorico');
  assert.match(desfazer[1], /App\.desfazerMudanca\(dif\)/);
  assert.match(desfazer[1], /M\.mudar\(m\.alvo, m\.campo, m\.valor\)/, 'desfazer deixou de entrar no rascunho');
  assert.ok(!/fetch|M\.api\(/.test(desfazer[1]), 'desfazer virou uma gravação própria, fora do Publicar');

  /* 2. Restaurar é do servidor, e passa a rev que a tela leu — duas telas
   *    abertas não se atropelam mais aqui do que no Publicar. */
  const restaurar = base.match(/M\.restaurarVersao = function \(rev\) \{([\s\S]*?)\n  \};/);
  assert.ok(restaurar, 'não achei M.restaurarVersao');
  assert.match(restaurar[1], /method: 'POST'/);
  assert.match(restaurar[1], /restaurar: rev, rev: M\.st\.servidor\.rev/, 'a restauração não leva a rev que a tela leu');
  assert.match(restaurar[1], /M\.st\.rascunho\.length/, 'restaurar por cima de um rascunho aberto não avisa nada');

  /* 3. O botão de desfazer só aparece para quem pode mudar AQUELE campo, e o
   *    de restaurar só para quem tem `historico`. A recusa de verdade é do
   *    servidor; isto é para não oferecer o que vai ser negado. */
  assert.match(telas, /var podeDesfazer = !!App\.desfazerMudanca\(dif\) && M\.pode\(dif\.permissao\)/);
  assert.match(telas, /'data-acao': 'hist-restaurar'[\s\S]{0,120}disabled: !M\.pode\('historico'\)/);

  /* E a tela existe nas três pontas: menu, trilha e centro. */
  assert.match(mesa, /itemMenu\('historico', 'desfazer', tr\('mesa\.historico'\)\)/);
  assert.match(mesa, /st\.tela === 'historico' \? \[tr\('mesa\.catalogo'\), tr\('mesa\.historico'\)\]/);
  assert.match(mesa, /st\.tela === 'historico' \? M\.telaHistorico\(cat\)/);
  const noQuadro = mesa.match(/var NO_QUADRO = \{([^}]*)\}/);
  assert.ok(noQuadro && !noQuadro[1].includes('historico'));
});

/* Ver o histórico é de TODO admin (todo admin vê tudo). Só a restauração
 * pede permissão — e quem a nega é o servidor, no POST. */
test('ver o histórico é de todo admin; restaurar é que pede permissão', () => {
  const rota = semComentarios(lerTexto(path.join(WORKER, 'api', 'historico.js')));
  const get = rota.match(/export async function onRequestGet\(([\s\S]*?)\n\}/);
  assert.ok(get, 'não achei o GET do histórico');
  assert.ok(!/contaPode/.test(get[1]), 'o GET do histórico passou a exigir permissão, e todo admin vê tudo');
  assert.match(get[1], /if \(!data\.admin\) return erro\(401/);

  const post = rota.match(/export async function onRequestPost\(([\s\S]*?)\n\}/);
  assert.ok(post, 'não achei o POST do histórico');
  assert.match(post[1], /App\.contaPode\(data\.conta, 'historico'\)/);
  assert.match(post[1], /App\.proibidas\(data\.conta, difs\)/,
    'restaurar deixou de conferir campo a campo: `historico` abriria a porta E daria poderes');

  /* O menu não esconde o histórico de ninguém. */
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  assert.ok(!/M\.pode\('historico'\) \? itemMenu\('historico'/.test(mesa),
    'a tela do histórico sumiu do menu de quem não restaura — mas ver é de todo admin');
});

/* O registro é gravado DEPOIS do catálogo e dentro de um try: histórico é
 * memória, e memória que impede de trabalhar é pior do que memória com buraco.
 * O teste de runtime prova o comportamento; este cobra a ordem no código, que é
 * o que garante que a publicação já está gravada quando o rastro falha. */
test('o histórico é gravado depois do catálogo, e o erro dele fica contido', () => {
  const api = semComentarios(lerTexto(path.join(WORKER, 'api', 'catalogo.js')));
  const put = api.match(/export async function gravarCatalogo\(([\s\S]*?)\n\}/);
  assert.ok(put, 'não achei o caminho de gravação (gravarCatalogo, usado pelo PUT e pelo MCP)');
  const posGravacao = put[1].indexOf("env.CATALOGO.put(CHAVE, gravado)");
  const posRegistro = put[1].indexOf('registrarPublicacao(');
  assert.ok(posGravacao > 0 && posRegistro > posGravacao, 'o histórico passou a ser gravado antes do catálogo');
  assert.match(put[1].slice(posGravacao), /try \{[\s\S]*registrarPublicacao\([\s\S]*catch/,
    'um erro do histórico voltou a derrubar a publicação');
  assert.ok(!/CHAVE_BACKUP/.test(api), 'o catalogo_anterior voltou a ser escrito');
});

/* O PRIMEIRO DEFEITO QUE O HISTÓRICO ACHOU, no primeiro ensaio dele (M5), e
 * que estava no ar desde que os ajustes existem.
 *
 * `Number(null)` é `0`, e `0` é uma escolha VÁLIDA em `controlesEspera` — quer
 * dizer "os controles nunca somem". Então um ajuste NÃO ESCOLHIDO (null no
 * documento) voltava como `0` no GET; a tela devolvia esse `0` no PUT
 * seguinte, e o padrão do player virava "nunca some", sem ninguém pedir.
 *
 * Só apareceu porque a linha do tempo mostrou "player" numa publicação que
 * mexeu numa sinopse — que é exatamente o que o projeto prometia: a comparação
 * está no servidor, e mudança que ninguém fez fica visível. */
test('ajuste não escolhido volta como nada, e não como zero', async () => {
  const env = ambiente(kvDeMentira({
    catalogo: JSON.stringify({ rev: 7, versao: 1, itens: [], ajustes: { arrastoTeto: null, controlesEspera: null } })
  }));

  const publico = await pedir(env, { caminho: '/api/catalogo' });
  assert.equal(publico.corpo.ajustes.controlesEspera, null,
    'o ajuste vazio voltou como 0 — e 0 quer dizer "os controles nunca somem"');
  assert.equal(publico.corpo.ajustes.arrastoTeto, null);

  /* E o round-trip não inventa mudança: publicar o que o GET devolveu não pode
   * aparecer no histórico como uma mexida no player. */
  const sup = await entrar(env, '', 'senha-do-super');
  const completo = (await pedir(env, { caminho: '/api/catalogo?completo=1', token: sup.token })).corpo;
  delete completo.config;
  const r = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: sup.token, corpo: completo });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.mudancas, 0, 'publicar sem mexer em nada gravou uma mudança fantasma');

  /* O zero de verdade continua atravessando: ele é uma escolha. */
  const comZero = ambiente(kvDeMentira({
    catalogo: JSON.stringify({ rev: 1, versao: 1, itens: [], ajustes: { arrastoTeto: 0.4, controlesEspera: 0 } })
  }));
  const r2 = await pedir(comZero, { caminho: '/api/catalogo' });
  assert.equal(r2.corpo.ajustes.controlesEspera, 0, 'o "nunca some" escolhido de propósito foi apagado');
});

/* AS DUAS ARESTAS QUE O PRIMEIRO ENSAIO DO HISTÓRICO MOSTROU. As duas são da
 * mesma família: um valor que a resposta do GET inventa, a tela devolve no PUT
 * e o servidor guarda — e que, sem histórico, ninguém veria. */

/* 1. Estrutura vazia não é dado. O GET projeta `site` mesmo sem nada escolhido
 *    (é o que dá forma ao cliente), a tela devolve essa projeção no PUT, e sem
 *    a limpeza toda primeira publicação inventava o campo e uma linha de
 *    histórico dizendo "estrutura" numa publicação que mexeu numa sinopse. */
test('publicar sem escolher estrutura não inventa o campo site', async () => {
  const env = ambiente(kvDeMentira());
  const sup = await entrar(env, '', 'senha-do-super');

  const vazio = (await pedir(env, { caminho: '/api/catalogo' })).corpo;
  assert.deepEqual(vazio.site, { destaque: null, prateleiras: {}, classes: {}, textos: {}, series: {} },
    'o catálogo vazio deixou de projetar a estrutura');

  /* Devolver ao PUT exatamente o que o GET deu não pode gravar nada novo. */
  const r = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: sup.token,
    corpo: { rev: 0, versao: 1, itens: [], site: vazio.site } });
  assert.equal(r.status, 200);
  const guardado = JSON.parse(env.CATALOGO.dados.catalogo);
  assert.ok(!('site' in guardado), 'a estrutura vazia virou campo no KV');
  assert.equal(r.corpo.mudancas, 0, 'a estrutura vazia entrou no histórico como mudança');

  /* E a escolhida é guardada SANEADA, com as chaves em ordem estável — é
   * contra esse valor que o Publicar confere o "antes" na próxima vez. */
  const r2 = await pedir(env, { metodo: 'PUT', caminho: '/api/catalogo', token: sup.token,
    corpo: { rev: 1, versao: 1, itens: [], site: { classes: { B: 'curta', A: 'pedagogica' }, lixo: 1 } } });
  assert.equal(r2.status, 200);
  const comEstrutura = JSON.parse(env.CATALOGO.dados.catalogo);
  assert.deepEqual(Object.keys(comEstrutura.site.classes), ['A', 'B'], 'a estrutura foi guardada fora de ordem');
  assert.ok(!('lixo' in comEstrutura.site));
});

/* 2. De onde a volta veio é assunto do histórico, não do catálogo. Um campo
 *    `restaurou` guardado no documento viajaria em toda gravação seguinte,
 *    apareceria como diferença na publicação seguinte e voltaria junto na
 *    próxima restauração. */
test('restaurar não deixa marca no catálogo — a marca fica no histórico', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) }));
  const sup = await entrar(env, '', 'senha-do-super');
  await publicar(env, sup.token, (c) => { c.itens[0].tema = 'Depois'; });

  const volta = await pedir(env, { metodo: 'POST', caminho: '/api/historico', token: sup.token, corpo: { restaurar: 0 } });
  assert.equal(volta.status, 200);

  const guardado = JSON.parse(env.CATALOGO.dados.catalogo);
  assert.ok(!('restaurou' in guardado), 'a marca da restauração ficou no catálogo');
  assert.equal(guardado.itens[0].tema, undefined, 'a volta não desfez o que a publicação tinha feito');

  const registro = JSON.parse(env.CATALOGO.dados[App.chaveHistorico(volta.corpo.rev)]);
  assert.equal(registro.restaurou, 0, 'o histórico não guardou de onde a volta veio');
  assert.ok(!registro.mudancas.some(m => m.campo === 'restaurou'), 'a marca virou uma diferença fantasma');

  /* E a publicação seguinte não carrega marca nenhuma. */
  const depois = await publicar(env, sup.token, (c) => { c.itens[0].tema = 'De novo'; });
  const seguinte = JSON.parse(env.CATALOGO.dados[App.chaveHistorico(depois.corpo.rev)]);
  assert.equal(seguinte.restaurou, undefined);
  assert.equal(seguinte.total, 1, 'a publicação depois da volta trouxe diferença de brinde');
});

/* ============================ as rotas da busca =========== */

/* Um catálogo com um título no ar e um fora, cada um com o seu vídeo. */
const catalogoDaBusca = () => ({
  rev: 7,
  itens: [
    { id: 'no-ar', titulo: 'No ar', publicar: true, fonte: { videoId: 'video-no-ar-0001' } },
    { id: 'fora', titulo: 'Fora', publicar: false, fonte: { videoId: 'video-fora-0002' } }
  ]
});

/* A regra da fase 3: "o middleware abre só os GET novos, com teste" (hoje a tabela de permissoes.js). */
test('o middleware abre só o GET da fala; escrever na busca exige conta', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) }));
  assert.equal((await pedir(env, { caminho: '/api/busca/fala' })).status, 200, 'o GET da fala não abriu');
  assert.equal((await pedir(env, { metodo: 'POST', caminho: '/api/busca/fala', corpo: {} })).status, 401,
    'abriu mais que o GET da fala');
  assert.equal((await pedir(env, { caminho: '/api/busca/indexar' })).status, 401, 'o manifesto ficou público');
  assert.equal((await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar',
    corpo: { videoId: 'video-no-ar-0001', fim: true, fala: [] } })).status, 401, 'a escrita no índice ficou pública');
  assert.equal((await pedir(env, { caminho: '/api/busca/outra' })).status, 401,
    'uma rota nova em /api/busca nasceu aberta — a lista pública é escrita à mão');
});

test('a fala sai só dos vídeos no ar, com ETag, e o 304 não baixa de novo', async () => {
  const kv = kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) });
  const env = ambiente(kv);
  const sup = await entrar(env, '', 'senha-do-super');
  for (const [videoId, texto] of [['video-no-ar-0001', 'fala do que está no ar'], ['video-fora-0002', 'fala do que está fora']]) {
    const r = await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token,
      corpo: { videoId, fala: [[0, texto]], fim: true } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
  }

  const um = await pedir(env, { caminho: '/api/busca/fala' });
  assert.deepEqual(Object.keys(AppBusca.lerFala(um.texto)), ['video-no-ar-0001'], 'o fora do ar vazou pela fala');
  assert.equal(um.cabecalhos.get('cache-control'), 'no-cache', 'o middleware pôs no-store por cima — adeus 304');
  const etag = um.cabecalhos.get('etag');
  assert.ok(etag, 'a fala saiu sem ETag');

  const dois = await pedir(env, { caminho: '/api/busca/fala', cabecalhos: { 'if-none-match': etag } });
  assert.equal(dois.status, 304);
  assert.equal(dois.texto, '');

  /* O título que vai ao ar leva a fala junto, SEM RODAR NADA: a rev do
   * catálogo muda, o ETag muda, e a linha que estava guardada aparece. */
  const cat = catalogoDaBusca();
  cat.rev = 8;
  cat.itens[1].publicar = true;
  kv.dados.catalogo = JSON.stringify(cat);
  const tres = await pedir(env, { caminho: '/api/busca/fala', cabecalhos: { 'if-none-match': etag } });
  assert.equal(tres.status, 200, 'o ETag não mudou com o catálogo');
  assert.deepEqual(Object.keys(AppBusca.lerFala(tres.texto)).sort(), ['video-fora-0002', 'video-no-ar-0001']);

  /* As outras rotas continuam no-store. */
  assert.equal((await pedir(env, { caminho: '/api/catalogo' })).cabecalhos.get('cache-control'), 'no-store');
});

/* O CPU MEDIDO NO AR (22/09, fase 5): a primeira versão da rota lia a fala
 * inteira e o catálogo antes de tudo, até para o 304, e mediu 6, 13 e 16 ms
 * — numa conta de 10 ms, numa rota pública. O ETag passou a sair do
 * manifesto, com a versão DA FALA, e a resposta montada vai para o cache. */
test('a fala responde 304 sem ler a fala, e do cache sem remontar; a sinopse não muda o ETag', async () => {
  const kv = kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) });
  const env = ambiente(kv);
  const sup = await entrar(env, '', 'senha-do-super');
  await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token,
    corpo: { videoId: 'video-no-ar-0001', fala: [[0, 'a fala']], fim: true } });
  const etag = (await pedir(env, { caminho: '/api/busca/fala' })).cabecalhos.get('etag');

  await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token,
    corpo: { videoId: 'video-no-ar-0001', sinopse: 'Título. Sinopse revisada.', fim: true } });
  assert.equal((await pedir(env, { caminho: '/api/busca/fala' })).cabecalhos.get('etag'), etag,
    'uma sinopse revisada mudou o ETag da fala — toda visita baixaria os 430 KB de novo');

  const lidas = [];
  const get = kv.get;
  kv.get = async (chave, tipo) => { lidas.push(chave); return get(chave, tipo); };
  const guardado = new Map();
  const antes = globalThis.caches;
  globalThis.caches = { default: {
    match: async (req) => (guardado.has(req.url) ? new Response(guardado.get(req.url)) : undefined),
    put: async (req, res) => { guardado.set(req.url, await res.text()); }
  } };
  try {
    const nao = await pedir(env, { caminho: '/api/busca/fala', cabecalhos: { 'if-none-match': etag } });
    assert.equal(nao.status, 304);
    assert.ok(!lidas.includes(AppIndice.CHAVES.fala), 'o 304 leu a fala inteira');

    const primeira = await pedir(env, { caminho: '/api/busca/fala' });
    lidas.length = 0;
    const segunda = await pedir(env, { caminho: '/api/busca/fala' });
    assert.equal(segunda.texto, primeira.texto);
    assert.ok(!lidas.includes(AppIndice.CHAVES.fala), 'a segunda leitura remontou a fala em vez de vir do cache');
  } finally {
    kv.get = get;
    if (antes === undefined) delete globalThis.caches; else globalThis.caches = antes;
  }
});

/* A chamada que fecha o vídeo mediu 8 a 17 ms com a fala reescrita (22/09).
 * Reindexar a MESMA legenda não tem o que mudar nela — e não a reescreve. */
test('a mesma fala mandada de novo não reescreve a chave, nem muda a versão da fala', async () => {
  const kv = kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) });
  const env = ambiente(kv);
  const sup = await entrar(env, '', 'senha-do-super');
  const corpo = { videoId: 'video-no-ar-0001', fala: [[0, 'a mesma fala']], fim: true };
  await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token, corpo });
  const antes = JSON.parse(kv.dados[AppIndice.CHAVES.estado]).versaoDaFala;

  const escritas = [];
  const put = kv.put;
  kv.put = async (chave, valor, opcoes) => { escritas.push(chave); return put(chave, valor, opcoes); };
  try {
    await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token, corpo });
    assert.deepEqual(escritas, [AppIndice.CHAVES.estado], 'a mesma fala reescreveu os ~500 KB do índice');
    assert.equal(JSON.parse(kv.dados[AppIndice.CHAVES.estado]).versaoDaFala, antes, 'a versão da fala andou sem a fala mudar');

    escritas.length = 0;
    await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token,
      corpo: { videoId: 'video-no-ar-0001', fala: [[0, 'a fala nova']], fim: true } });
    assert.deepEqual(escritas, [AppIndice.CHAVES.fala, AppIndice.CHAVES.estado], 'a fala nova não foi gravada');
  } finally {
    kv.put = put;
  }
});

test('indexar grava a linha e o manifesto, pede a permissão da legenda, e recusa vetor sem o sentido', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) }));
  const sup = await entrar(env, '', 'senha-do-super');
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: sup.token,
    corpo: { usuario: 'ana', nome: 'Ana', senha: 'senha-bem-comprida', permissoes: ['no-ar'] } });
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: sup.token,
    corpo: { usuario: 'bia', nome: 'Bia', senha: 'senha-bem-comprida', permissoes: ['enviar'] } });
  const ana = await entrar(env, 'ana', 'senha-bem-comprida');
  const bia = await entrar(env, 'bia', 'senha-bem-comprida');
  const pedido = { videoId: 'video-no-ar-0001', fala: [[0, 'um'], [31, 'dois']], fim: true };

  assert.equal((await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: ana.token, corpo: pedido })).status, 403,
    'quem só põe no ar escreveu no índice');
  const r = await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: bia.token, corpo: pedido });
  assert.equal(r.status, 200, 'quem envia vídeo manda a legenda — e a fala dela');
  assert.equal(r.corpo.sentido, false);

  const manifesto = (await pedir(env, { caminho: '/api/busca/indexar', token: ana.token })).corpo;
  assert.deepEqual(manifesto.videos['video-no-ar-0001'].fala.inicios, [0, 31], 'todo admin vê o manifesto');
  assert.equal(manifesto.sentido, false);
  assert.equal(env.CATALOGO.metas[AppIndice.CHAVES.fala].versao, manifesto.versao, 'a versão da fala não acompanhou o manifesto');

  const torto = await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token, corpo: { videoId: 'x', fim: true } });
  assert.equal(torto.status, 400);
  const vetor = await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token,
    corpo: { videoId: 'video-no-ar-0001', vetores: [['f', 0, 'um']] } });
  assert.equal(vetor.status, 503, 'sem Workers AI e Vectorize, o pedido de vetor tem de ser recusado');
});

/* O script é a reserva da mesa, e escreve pela mesma rota: um vídeo por vez,
 * com um segundo entre um e o seguinte — cada chave do KV aceita uma escrita
 * por segundo. */
test('o script da busca usa o código do site e espera um segundo entre os vídeos', () => {
  const script = semComentarios(lerTexto(path.join(__dirname, '..', 'scripts', 'indice-busca.mjs')));
  assert.match(script, /import AppIndice from '\.\.\/core\/site\/indice-core\.js'/);
  assert.match(script, /AppIndice\.blocosDaLegenda\(/, 'o script condensa de outro jeito que a mesa');
  assert.match(script, /await esperar\(1[0-9]{3}\)/, 'sem a espera, o KV recusa a segunda escrita na mesma chave');
  assert.match(script, /'\/api\/busca\/indexar'/);
  assert.ok(!/gravarCatalogo/.test(script), 'o script da busca não escreve no catálogo');
});

/* ---------------------------------------------- o sentido (fase 4) */

/* O Workers AI e o Vectorize de mentira. O modelo devolve um vetor de 1.024
 * por texto, como o `bge-m3` (conferido num `pages dev` em 21/09); o índice
 * guarda o que recebe e responde com o que o teste manda. */
const aiDeMentira = (chamadas) => ({
  run: async (modelo, entrada) => {
    chamadas.push({ modelo, textos: entrada.text });
    return { shape: [entrada.text.length, 1024], data: entrada.text.map(() => new Array(1024).fill(0.01)), pooling: 'cls' };
  }
});
const vectorizeDeMentira = (resposta) => {
  const estado = { upserts: [], apagados: [], consultas: [] };
  return {
    estado,
    upsert: async (vetores) => { estado.upserts.push(...vetores); return { mutationId: 'm1' }; },
    deleteByIds: async (ids) => { estado.apagados.push(...ids); return { mutationId: 'm2' }; },
    query: async (vetor, opcoes) => { estado.consultas.push(opcoes); return { count: resposta.length, matches: resposta }; }
  };
};
const casa = (videoId, tipo, inicio, score) => ({ id: tipo + ':' + videoId + ':' + inicio, score, metadata: { videoId, tipo, inicio } });

test('o sentido sem Workers AI e Vectorize responde vazio, em 200, e a pergunta curta nem chega ao modelo', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) }));
  const sem = await pedir(env, { caminho: '/api/busca/sentido?q=' + encodeURIComponent('fração') });
  assert.equal(sem.status, 200, 'sem o binding a busca por sentido derrubou a resposta');
  assert.deepEqual(sem.corpo, { resultados: [], indisponivel: true });

  const chamadas = [];
  env.AI = aiDeMentira(chamadas);
  env.VETORES = vectorizeDeMentira([]);
  assert.deepEqual((await pedir(env, { caminho: '/api/busca/sentido?q=ab' })).corpo, { resultados: [] });
  assert.equal(chamadas.length, 0, 'duas letras foram ao modelo');
  assert.equal((await pedir(env, { metodo: 'POST', caminho: '/api/busca/sentido?q=fracao', corpo: {} })).status, 401,
    'o sentido abriu mais que o GET');
});

test('o sentido devolve só o que está no ar e acima do corte, sem texto, e a pergunta repetida vem do cache', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) }));
  const chamadas = [];
  env.AI = aiDeMentira(chamadas);
  /* As notas saem arredondadas em 4 casas pela rota — o `0,52 + 0,05` do
   * ponto flutuante não bate com o que ela devolve. */
  const nota = (d) => Number((AppIndice.CORTE + d).toFixed(4));
  env.VETORES = vectorizeDeMentira([
    casa('video-fora-0002', 'f', 30, 0.9),
    casa('video-no-ar-0001', 'f', 60, nota(0.1)),
    casa('video-no-ar-0001', 's', 0, nota(0.05)),
    casa('video-no-ar-0001', 'c', 120, nota(-0.01))
  ]);
  const guardado = new Map();
  const antes = globalThis.caches;
  globalThis.caches = { default: {
    match: async (req) => (guardado.has(req.url) ? new Response(guardado.get(req.url)) : undefined),
    put: async (req, res) => { guardado.set(req.url, await res.text()); }
  } };
  try {
    const um = await pedir(env, { caminho: '/api/busca/sentido?q=' + encodeURIComponent('Profissão de risco') });
    assert.equal(um.status, 200);
    assert.deepEqual(um.corpo.resultados, [
      { videoId: 'video-no-ar-0001', tipo: 'f', inicio: 60, nota: nota(0.1) },
      { videoId: 'video-no-ar-0001', tipo: 's', inicio: 0, nota: nota(0.05) }
    ], 'vazou o fora do ar, ou passou o que ficou abaixo do corte');
    assert.ok(!('texto' in um.corpo.resultados[0]), 'o sentido mandou texto — o navegador já o tem');
    assert.equal(chamadas[0].modelo, AppIndice.MODELO);
    assert.deepEqual(chamadas[0].textos, ['profissão de risco'], 'a pergunta foi ao modelo sem a forma do servidor');

    await pedir(env, { caminho: '/api/busca/sentido?q=' + encodeURIComponent('profissão  de risco ') });
    assert.equal(chamadas.length, 1, 'a mesma pergunta passou de novo pelo modelo');

    /* O título que sai do ar some da resposta que veio do cache. */
    const cat = catalogoDaBusca();
    cat.itens[0].publicar = false;
    env.CATALOGO.dados.catalogo = JSON.stringify(cat);
    const tres = await pedir(env, { caminho: '/api/busca/sentido?q=' + encodeURIComponent('profissão de risco') });
    assert.deepEqual(tres.corpo.resultados, [], 'o cache devolveu título tirado do ar');
  } finally {
    if (antes === undefined) delete globalThis.caches; else globalThis.caches = antes;
  }
});

test('o sentido cru — o da prova — é só de quem tem conta, e filtra pelo tipo', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) }));
  env.AI = aiDeMentira([]);
  env.VETORES = vectorizeDeMentira([casa('video-fora-0002', 'f', 30, 0.2)]);
  assert.equal((await pedir(env, { caminho: '/api/busca/sentido?cru=1&q=pescador' })).status, 401,
    'o modo cru mostra o que está fora do ar, e ficou público');
  const sup = await entrar(env, '', 'senha-do-super');
  const cru = await pedir(env, { caminho: '/api/busca/sentido?cru=1&tipo=f&k=5&q=pescador', token: sup.token });
  assert.deepEqual(cru.corpo.brutos, [['video-fora-0002', 'f', 30, 0.2]], 'o cru passou pelo corte ou pelo no ar');
  assert.deepEqual(env.VETORES.estado.consultas[0], { topK: 5, returnMetadata: 'all', filter: { tipo: 'f' } });
});

test('indexar grava os vetores com id e metadado, e apaga os que sumiram', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDaBusca()) }));
  const chamadas = [];
  env.AI = aiDeMentira(chamadas);
  env.VETORES = vectorizeDeMentira([]);
  const sup = await entrar(env, '', 'senha-do-super');
  const vetores = await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token,
    corpo: { videoId: 'video-no-ar-0001', vetores: [['f', 0, 'um'], ['f', 31, 'dois'], ['s', 0, 'Título. Sinopse.']] } });
  assert.equal(vetores.status, 200, JSON.stringify(vetores.corpo));
  assert.equal(vetores.corpo.vetores, 3);
  assert.deepEqual(chamadas[0].textos, ['um', 'dois', 'Título. Sinopse.'], 'os textos foram ao modelo num lote só');
  assert.deepEqual(env.VETORES.estado.upserts.map(v => [v.id, v.metadata.tipo, v.metadata.inicio, v.values.length]),
    [['f:video-no-ar-0001:0', 'f', 0, 1024], ['f:video-no-ar-0001:31', 'f', 31, 1024], ['s:video-no-ar-0001', 's', 0, 1024]]);

  await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token,
    corpo: { videoId: 'video-no-ar-0001', fala: [[0, 'um'], [31, 'dois']], fim: true, sentido: true } });
  const troca = await pedir(env, { metodo: 'POST', caminho: '/api/busca/indexar', token: sup.token,
    corpo: { videoId: 'video-no-ar-0001', fala: [[0, 'um']], fim: true, sentido: true } });
  assert.equal(troca.corpo.apagados, 1);
  assert.deepEqual(env.VETORES.estado.apagados, ['f:video-no-ar-0001:31'], 'o bloco que sumiu da legenda ficou no índice');
  assert.throws(() => AppIndice.vetoresDaResposta({ data: [[1, 2, 3]] }, 1), /dimensões/, 'um vetor de tamanho errado seria gravado');
});

/* A JUNÇÃO: o que casou por palavra vem primeiro; o que só casou por
 * sentido, depois, marcado; e sem sentido a resposta é a de palavra, igual. */
test('a junção: palavra primeiro, sentido depois, e sem sentido a busca literal é idêntica', () => {
  const ind = AppBusca.indice(comCapitulosEVideo, comFala);
  const literal = AppBusca.procurar(ind, 'escada');
  assert.equal(AppBusca.juntar(ind, literal, []), literal, 'sem sentido a resposta mudou — o binding desligado mexeria na busca');
  assert.equal(AppBusca.juntar(ind, literal, null), literal);

  const sentido = [
    { videoId: 'video-agro-0002', tipo: 's', inicio: 0, nota: 0.7 },
    { videoId: 'video-pesc-0001', tipo: 'f', inicio: 300, nota: 0.65 },
    { videoId: 'video-pesc-0001', tipo: 'c', inicio: 125, nota: 0.6 }
  ];
  const junto = AppBusca.juntar(ind, literal, sentido);
  assert.deepEqual(junto.titulos.map(t => [t.item.id, !!t.porSentido]),
    literal.titulos.map(t => [t.item.id, false]).concat(
      literal.titulos.some(t => t.item.id === 'agro') ? [] : [['agro', true]]),
    'o que casou por palavra não veio primeiro');
  const doSentido = junto.trechos.filter(t => t.porSentido);
  assert.deepEqual(doSentido.map(t => [t.item.id, t.tipo, t.inicio]), [['pescador', 'fala', 300]],
    'o trecho do sentido no mesmo momento de um por palavra virou outra linha — ou o novo não entrou');
  assert.ok(junto.trechos.indexOf(doSentido[0]) >= literal.trechos.length, 'o do sentido passou na frente do de palavra');

  /* Sem a fala carregada o bloco do sentido não tem texto, e fica de fora. */
  const semFala = AppBusca.indice(comCapitulosEVideo);
  assert.equal(AppBusca.juntar(semFala, AppBusca.procurar(semFala, 'escada'), sentido).trechos.filter(t => t.porSentido).length, 0);
});

/* "previsão do tempo para amanhã" passou do corte com 0,583 num bloco que
 * dizia só "no futuro." (22/09). O bloco curto demais não diz assunto. */
test('o sentido ignora o bloco curto demais, que não diz assunto', () => {
  const itens = [{ id: 'q', titulo: 'Engenheiro de Som', serie: 'A', publicar: true, fonte: { videoId: 'video-som-0001' } }];
  const fala = { 'video-som-0001': [[480, 'A acústica estuda como as ondas se propagam dentro de uma sala.'], [510, 'no futuro.']] };
  const ind = AppBusca.indice(itens, fala);
  const literal = AppBusca.procurar(ind, 'previsão do tempo');
  const junto = AppBusca.juntar(ind, literal, [{ videoId: 'video-som-0001', tipo: 'f', inicio: 510, nota: 0.583 }]);
  assert.deepEqual(junto.titulos, [], 'o bloco "no futuro." pôs o título na resposta');
  assert.deepEqual(junto.trechos, []);
  const comConteudo = AppBusca.juntar(ind, literal, [{ videoId: 'video-som-0001', tipo: 'f', inicio: 480, nota: 0.6 }]);
  assert.equal(comConteudo.trechos.length, 1, 'o bloco de verdade deixou de valer');
});

test('a pergunta ao sentido é a mesma no navegador e no servidor', () => {
  for (const q of ['Fração', '  mercado   de TRABALHO ', 'Profissão de risco', 'x'.repeat(200)]) {
    assert.equal(AppBusca.perguntaDoSentido(q), AppIndice.consultaDoSentido(q), q.slice(0, 20));
  }
  assert.equal(AppBusca.perguntaDoSentido('ab'), null, 'duas letras foram perguntadas');
  assert.equal(AppIndice.consultaValida('ab'), false);
  /* 400 ms depois da última tecla, só a última vale, e a falha fica calada. */
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const pedir = app.match(/function pedirSentidoDepois\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(pedir, /clearTimeout\(busca\.esperaSentido\)/);
  assert.match(pedir, /\}, 400\);/);
  assert.match(pedir, /busca\.pedidoSentido\.abort\(\)/, 'a pergunta anterior não é cancelada');
  assert.match(pedir, /q in busca\.sentido/, 'a pergunta repetida volta ao servidor');
  assert.match(pedir, /\.catch\(function \(\) \{\s*\}\)/, 'a falha do sentido aparece na tela');
});

/* ---------------------------------------------- a mesa e a busca (fase 5) */

test('a conta de quem ficou fora da busca olha o no ar, a fala e o texto dos vetores', () => {
  const itens = [
    { id: 'dentro', titulo: 'Dentro', sinopse: 'Uma sinopse.', publicar: true, fonte: { videoId: 'video-dentro-001' } },
    { id: 'semfala', titulo: 'Sem fala', publicar: true, fonte: { videoId: 'video-semfala-02' } },
    { id: 'fora', titulo: 'Fora do ar', publicar: false, fonte: { videoId: 'video-fora-000003' } },
    { id: 'semvideo', titulo: 'Sem vídeo', publicar: true, fonte: { videoId: null } }
  ];
  const conj = AppIndice.conjuntosDoItem(itens[0]);
  const manifesto = { versao: 3, videos: { 'video-dentro-001': {
    fala: { hash: 'x', n: 0, inicios: [], sentido: true },
    capitulos: { hash: AppIndice.hashConjunto(conj.capitulos), n: 0, inicios: [], sentido: true },
    sinopse: { hash: AppIndice.hash(conj.sinopse), sentido: true }
  } } };
  let conta = AppIndice.foraDaBusca(itens, manifesto, true);
  assert.deepEqual(conta.semFala.map(i => i.id), ['semfala'], 'o fora do ar ou o sem vídeo entrou na conta');
  assert.deepEqual(conta.desatualizados.map(i => i.id), []);

  /* A sinopse revisada deixa o vetor da ficha velho. */
  const revisado = itens.map(i => (i.id === 'dentro' ? Object.assign({}, i, { sinopse: 'Outra sinopse, revisada.' }) : i));
  assert.deepEqual(AppIndice.foraDaBusca(revisado, manifesto, true).desatualizados.map(i => i.id), ['dentro']);
  /* Sem o sentido ligado, o que conta é só a fala. */
  assert.deepEqual(AppIndice.foraDaBusca(revisado, manifesto, false).desatualizados, []);
  /* Vídeo sem legenda tem linha com zero bloco, e está DENTRO da busca. */
  assert.equal(manifesto.videos['video-dentro-001'].fala.n, 0);
  assert.ok(!conta.semFala.some(i => i.id === 'dentro'));
});

test('a mesa põe na busca no envio, depois do Publicar, e pelo botão da visão geral', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  const telas = semComentarios(lerTexto(path.join(SITE, 'mesa-telas.js')));
  const painel = semComentarios(lerTexto(path.join(SITE, 'mesa-painel.js')));
  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));

  /* O ENVIO: a legenda que a mesa leu vira a fala do título, condensada aqui
   * — a função tem 10 ms de CPU. */
  assert.match(telas, /blocosDaFala = AppIndice\.blocosDaLegenda\(srt\)/, 'a mesa parou de condensar a legenda do envio');
  assert.match(telas, /M\.indexarBusca\(videoId, \{/, 'o envio não põe o título na busca');
  assert.match(telas, /fala: blocosDaFala \|\| \[\]/);

  /* O PUBLICAR: só o texto que o sentido compara — título e sinopse. */
  const publicado = base.match(/function atualizarBuscaDoPublicado\(mexidos\) \{([\s\S]*?)\n  \}/);
  assert.ok(publicado, 'não achei atualizarBuscaDoPublicado em mesa-base.js');
  assert.match(publicado[1], /M\.indexarBusca\(App\.idDoVideo\(item\), \{ capitulos: conj\.capitulos, sinopse: conj\.sinopse \}\)/,
    'o Publicar passou a mandar a fala também — ela vem da legenda, que ele não toca');
  assert.match(base, /m\.campo !== 'titulo' && m\.campo !== 'sinopse'/, 'o Publicar deixou de olhar quem mudou de texto');

  /* A FILA: um vídeo por vez, com um segundo entre eles (o KV). */
  const fila = base.match(/M\.indexarBusca = function \(videoId, conjuntos\) \{([\s\S]*?)\n  \};/);
  assert.match(fila[1], /AppIndice\.lotes\(AppIndice\.vetoresDosConjuntos\(conjuntos\), AppIndice\.LIMITES\.vetores\)/,
    'os vetores deixaram de ir no lote que a medida decidiu');
  /* O lote é a alavanca do CPU, e o número é MEDIDO: 4 a 12 ms por
   * chamada de 20 vetores no ar, 4 a 7 com 10, contra os 10 ms do gratuito.
   * Subir o lote sem medir de novo é voltar a estourar. */
  assert.equal(AppIndice.LIMITES.vetores, 10, 'o lote mudou sem medida nova — meça de novo');
  assert.match(fila[1], /setTimeout\(pronto, 1100\)/, 'a fila não espera o segundo entre um vídeo e o seguinte');

  /* A LEGENDA VEM DO PROVEDOR (a URL é a de `midia.legendas`, que responde a qualquer origem). */
  assert.match(base, /App\.urlLegenda\(item\)/);
  assert.doesNotMatch(base, /captions/, 'a mesa voltou a montar URL de legenda de provedor');
  assert.match(base, /if \(r\.status === 404\) return null;/, 'vídeo sem legenda tem de ser caso previsto');

  /* A VISÃO GERAL mostra quem ficou fora, e o botão só aparece para quem pode. */
  assert.match(painel, /AppIndice\.foraDaBusca\(cat\.itens, b\.manifesto, b\.sentido\)/);
  assert.match(painel, /M\.pode\('conteudo'\) \|\| M\.pode\('enviar'\)/, 'o botão de pôr na busca ignorou a permissão');
  assert.match(mesa, /if \(a === 'busca-por'\) return M\.porNaBusca\(\)/, 'o botão da visão geral não está ligado');
  assert.match(mesa, /M\.carregarBusca\(\)/, 'a mesa não lê o índice da busca ao abrir');

  /* E a mesa carrega o mesmo indice-core.js do script. */
  assert.match(lerTexto(path.join(SITE, 'mesa-inicio.js')), /'indice-core\.js'/);
  assert.match(lerTexto(path.join(SITE, 'admin.html')), /<script src="mesa-inicio\.js"><\/script>/);
});

/* A fala desce na primeira busca, e nunca na chegada. */
test('a chegada não pede a fala: ela desce junto com o arquivo da busca', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const preparar = app.match(/function prepararBusca\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(preparar, /fetch\('\/api\/busca\/fala'/, 'quem pede a fala não é o prepararBusca');
  assert.equal((app.match(/\/api\/busca\/fala/g) || []).length, 1, 'a fala é pedida de mais de um lugar');
  const carregar = app.match(/function carregar\(espera\) \{([\s\S]*?)\n  \}/)[1];
  assert.ok(!/busca/.test(carregar), 'a carga do catálogo pede a busca junto');
});

/* ================= o orçamento da chegada (22/09) ================= */

/* O `loading="lazy"` antecipa pela distância que o navegador escolhe, e ela
 * cresce com a rede ruim: num Chrome sem janela em 412×823, com o catálogo de
 * produção, a chegada pedia 34 capas numa rede rápida e 61 numa lenta. Com o
 * observador do site, 12 nas duas. */
test('as capas da prateleira descem pelo observador do site, e a janela anda com o dedo', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const corpo = app.match(/function cartaoPrateleira\(item, mostrarSerie\)\s*\{([\s\S]*?)\n  \}/)[1];
  assert.match(corpo, /capaPerto\(img, url\)/, 'a capa da prateleira voltou a ser pedida na hora');
  assert.ok(!/img\.src = url/.test(corpo), 'a capa da prateleira voltou a ter src na criação');

  const perto = app.match(/function capaPerto\(img, url\) \{([\s\S]*?)\n  \}/);
  assert.ok(perto, 'não achei capaPerto em app.js');
  assert.match(perto[1], /rootMargin: '0px 0px 50% 0px'/, 'a distância da chegada mudou sem medida nova');
  /* Só sai da observação quem APARECEU: o vizinho pedido adiantado continua
   * observado, senão a janela para no primeiro passo do arrasto. */
  assert.match(perto[1], /capasPendentes\.unobserve\(e\.target\)/);
  const pedir = app.match(/function pedirCapa\(img\) \{([\s\S]*?)\n  \}/)[1];
  assert.ok(!/unobserve/.test(pedir), 'pedirCapa solta o vizinho adiantado da observação');

  const grade = app.match(/function renderGrade\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.ok(grade.indexOf('soltarCapas()') >= 0 && grade.indexOf('soltarCapas()') < grade.indexOf('limpar(el.grade)'),
    'trocar de tela não solta as capas da tela de antes');
});

/* O LCP é a capa do destaque, e duas esperas iam em fila: a conexão com a pull
 * zone e o catálogo, pedido só depois de o app.js baixar e rodar. */
test('a chegada abre a pull zone e pede o catálogo já no HTML', async () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  /* O endereço da pull zone NÃO mora no HTML estático (o mesmo arquivo serve
   * qualquer instalação): a função `core/worker/home.js` põe a pré-conexão a
   * partir de BUNNY_PULLZONE. */
  assert.doesNotMatch(html, /b-cdn\.net/, 'o HTML estático carrega o endereço de uma pull zone');
  assert.doesNotMatch(html, /rel="preconnect"/, 'a pré-conexão tem que vir da function, não do arquivo');
  const fn = await import('../core/worker/home.js');
  const comPz = fn.comEndereco(html, 'https://exemplo.example.com', 'vz-exemplo.b-cdn.net');
  assert.ok(comPz.includes('<link rel="preconnect" href="https://vz-exemplo.b-cdn.net">\n' + fn.MARCA),
    'a pré-conexão não entrou antes da folha de estilo');
  assert.ok(comPz.includes('<meta property="og:url" content="https://exemplo.example.com/">'));
  assert.ok(comPz.includes('content="https://exemplo.example.com/og-image.png"'), 'og:image não ficou absoluta');
  assert.ok(!/preconnect/.test(fn.comEndereco(html, 'https://exemplo.example.com', null)),
    'sem pull zone configurada não pode haver pré-conexão');
  assert.equal(fn.comEndereco('<html></html>', 'https://exemplo.example.com', null), null);
  assert.equal(fn.hostValido('vz-exemplo.b-cdn.net'), true);
  assert.equal(fn.hostValido('x"><script>'), false);
  assert.equal(fn.siteUrlValida('https://exemplo.example.com'), true);
  assert.equal(fn.siteUrlValida('javascript:alert(1)'), false);

  /* `crossorigin` é o que faz o fetch do app.js reaproveitar o pedido: sem
   * ele o modo não bate, e o catálogo seria baixado duas vezes. */
  assert.match(html, /<link rel="preload" href="\/api\/catalogo" as="fetch" crossorigin>/);
  const app = lerTexto(path.join(SITE, 'app.js'));
  assert.match(app, /fetch\('\/api\/catalogo', \{ headers: \{ Accept: 'application\/json' \} \}\)/,
    'o pedido do app.js mudou, e o preload pode ter deixado de valer');
});

/* ================= a capa não é rascunho (22/09) ================= */

/* O Bunny apaga a capa anterior quando recebe uma nova, e o catálogo que
 * continua apontando para ela mostra o cartão SEM capa. Um teste feito pela
 * mesa, sem publicar, deixou o título assim no site no ar. A capa
 * de um título que já está no catálogo passou a ser gravada na mesma chamada
 * que a manda ao Bunny. */
test('comCapa troca os dois campos de todo título do vídeo, e só deles', () => {
  const cat = { rev: 3, site: { destaque: 'a' }, itens: [
    { id: 'a', capa_arquivo: 'x.jpg', capa_versao: '1', fonte: { videoId: 'v1' } },
    { id: 'b', capa_arquivo: 'y.jpg', fonte: { videoId: 'v2' } },
    { id: 'c', fonte: { videoId: 'v1' } }
  ] };
  const novo = App.comCapa(cat, 'v1', 'thumbnail_novo.jpg', '99');
  assert.equal(novo.rev, 3, 'a rev é do PUT, não daqui');
  assert.deepEqual(novo.site, cat.site, 'o resto do documento não voltou como veio');
  assert.deepEqual(novo.itens.map(i => i.capa_arquivo), ['thumbnail_novo.jpg', 'y.jpg', 'thumbnail_novo.jpg'],
    'todo título daquele vídeo leva a capa — e só ele');
  assert.deepEqual(novo.itens.map(i => i.capa_versao), ['99', undefined, '99']);
  assert.equal(novo.itens[1], cat.itens[1], 'o título de outro vídeo foi copiado à toa');
  assert.equal(cat.itens[0].capa_arquivo, 'x.jpg', 'comCapa mexeu no catálogo que recebeu');
  assert.equal(App.comCapa(cat, 'v9', 'z.jpg', '1'), null, 'vídeo sem título no catálogo não é gravação');
  assert.equal(App.comCapa(null, 'v1', 'z.jpg', '1'), null);
});

/* Troca o fetch global por um Bunny que recebe capa e diz o nome dela. Guarda
 * as capas recebidas: é por elas que se confere se a capa foi ao Bunny ANTES
 * de uma recusa. */
function bunnyDeCapas(nome) {
  const original = globalThis.fetch;
  const capas = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (/\/videos\/[^/]+\/thumbnail$/.test(u) && init && init.method === 'POST') {
      capas.push(u);
      return new Response('{}', { status: 200 });
    }
    if (/\/videos\/[^/?]+$/.test(u) && !(init && init.method)) {
      return new Response(JSON.stringify({ thumbnailFileName: nome }), { status: 200 });
    }
    return original(url, init);
  };
  return { capas, desfazer: () => { globalThis.fetch = original; } };
}

const enviarCapa = (env, token, videoId) => pedir(env, {
  metodo: 'POST', caminho: '/api/midia?tipo=capa&videoId=' + videoId, token,
  bruto: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), cabecalhos: { 'content-type': 'application/octet-stream' }
});

test('a capa de um título do catálogo vai para o catálogo na mesma chamada, com rastro', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) }));
  const sup = await entrar(env, '', 'senha-do-super');
  const bunny = bunnyDeCapas('thumbnail_novo.jpg');
  try {
    const r = await enviarCapa(env, sup.token, fonte.videoId);
    assert.equal(r.status, 200, r.texto);
    assert.equal(bunny.capas.length, 1, 'a capa não foi ao Bunny');
    assert.equal(r.corpo.capa_arquivo, 'thumbnail_novo.jpg');
    assert.equal(r.corpo.rev, 1, 'a capa não foi gravada no catálogo');
    assert.equal(r.corpo.historico, true);

    const gravado = JSON.parse(env.CATALOGO.dados.catalogo);
    assert.equal(gravado.rev, 1);
    /* Os dois títulos de teste usam o MESMO vídeo: os dois levam a capa. */
    assert.ok(gravado.itens.every(i => i.capa_arquivo === 'thumbnail_novo.jpg' && i.capa_versao),
      'um título do vídeo ficou com a capa de antes');
    assert.equal(gravado.itens[0].sinopse, 'Primeira', 'a gravação da capa mexeu em outro campo');

    /* Pela porta do PUT: o histórico diz exatamente o que mudou. */
    const registro = JSON.parse(env.CATALOGO.dados[App.chaveHistorico(1)]);
    assert.deepEqual([...new Set(registro.mudancas.map(m => m.campo))].sort(), ['capa_arquivo', 'capa_versao']);
    assert.equal(registro.quem, 'superadmin');
  } finally {
    bunny.desfazer();
  }
});

/* A ORDEM É A COISA TODA: recusar DEPOIS do Bunny deixaria o título sem capa,
 * com o catálogo apontando para o arquivo que acabou de sumir. */
test('quem só envia vídeo não troca a capa de título do catálogo — e o Bunny nem é tocado', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) }));
  const sup = await entrar(env, '', 'senha-do-super');
  await pedir(env, { metodo: 'POST', caminho: '/api/contas', token: sup.token,
    corpo: { usuario: 'joao', senha: 'senha-bem-comprida', permissoes: ['enviar'] } });
  const joao = await entrar(env, 'joao', 'senha-bem-comprida');
  const bunny = bunnyDeCapas('thumbnail_novo.jpg');
  try {
    const recusa = await enviarCapa(env, joao.token, fonte.videoId);
    assert.equal(recusa.status, 403, recusa.texto);
    assert.equal(recusa.corpo.barradas[0].campo, 'capa_arquivo');
    assert.equal(bunny.capas.length, 0, 'a capa foi ao Bunny ANTES da recusa: o site ficaria sem ela');
    assert.equal(JSON.parse(env.CATALOGO.dados.catalogo).rev, 0);

    /* O TÍTULO NOVO, que ainda não está no catálogo: quem envia vídeo manda a
     * capa dele, e ela segue pelo rascunho — não há o que gravar. */
    const novo = await enviarCapa(env, joao.token, 'ffffffff-0000-1111-2222-333333333333');
    assert.equal(novo.status, 200, novo.texto);
    assert.equal(bunny.capas.length, 1);
    assert.equal(novo.corpo.capa_arquivo, 'thumbnail_novo.jpg');
    assert.equal(novo.corpo.rev, undefined, 'título fora do catálogo não é gravação');
    assert.equal(novo.corpo.pendente, false);
    assert.equal(JSON.parse(env.CATALOGO.dados.catalogo).rev, 0);
  } finally {
    bunny.desfazer();
  }
});

test('o Bunny que não diz o nome deixa a capa pendente, e o catálogo como estava', async () => {
  const env = ambiente(kvDeMentira({ catalogo: JSON.stringify(catalogoDeTeste(0)) }));
  const sup = await entrar(env, '', 'senha-do-super');
  const bunny = bunnyDeCapas(null);
  try {
    const r = await enviarCapa(env, sup.token, fonte.videoId);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.corpo.pendente, true, 'o site ficou sem a capa, e a resposta não avisa');
    assert.equal(r.corpo.rev, undefined);
    assert.equal(JSON.parse(env.CATALOGO.dados.catalogo).rev, 0);
  } finally {
    bunny.desfazer();
  }
});

/* A mesa respeita a resposta: com `rev`, a capa está no site, e ela não pode
 * voltar ao rascunho — senão o Publicar gravaria de novo um nome que o Bunny
 * pode já ter apagado. E toda capa passa pela redução a 640 px. */
test('a mesa reduz a capa a 640 px, e não guarda no rascunho a capa que o servidor gravou', () => {
  const telas = semComentarios(lerTexto(path.join(SITE, 'mesa-telas.js')));
  assert.match(telas, /var LARGURA_CAPA = 640;/, 'a largura da capa não é a do capas-menores.mjs');

  const enviar = telas.match(/M\.enviarCapa = function \(item, arquivo\) \{([\s\S]*?)\n  \};/);
  assert.ok(enviar, 'não achei M.enviarCapa em mesa-telas.js');
  assert.match(enviar[1], /M\.capaParaEnvio\(arquivo\)/, 'a capa sobe sem passar pela redução');
  const comRev = enviar[1].indexOf('if (resposta.rev)');
  const rascunho = enviar[1].indexOf('M.mudarVarios(');
  assert.ok(comRev > 0 && rascunho > comRev, 'a capa vai para o rascunho antes de olhar se o servidor já gravou');
  assert.match(enviar[1].slice(comRev, rascunho), /M\.desfazerMudanca\(item\.id, 'capa_arquivo'\)/,
    'a capa gravada pelo servidor deixa para trás a do rascunho');
  assert.match(enviar[1], /resposta\.pendente/, 'a capa que não entrou no catálogo não avisa ninguém');

  /* O título novo também passa pela redução. */
  const novo = telas.match(/M\.salvarTituloNovo = function \(\) \{([\s\S]*?)\n  \};/);
  assert.match(novo[1], /M\.capaParaEnvio\(capa\)/, 'a capa do título novo sobe sem redução');
  /* E o quadro capturado já sai na largura da capa. */
  assert.match(telas, /function capturarQuadro\(video\) \{[\s\S]*?desenharCapa\(video,/);
});

/* O script que conserta a capa trocada no Bunny tem de ler e gravar o KV. Um
 * script que gravasse só no arquivo local e mandasse levar o valor ao KV "pela
 * tela de admin" seria, para a falha que ele existe para consertar, o caminho
 * errado. */
test('o sincronizar-capas.mjs lê o KV e grava no KV, e só grava capa que a pull zone serve', () => {
  const src = lerTexto(path.join(__dirname, '..', 'scripts', 'sincronizar-capas.mjs'));
  assert.match(src, /completo=1/, 'sincronizar-capas.mjs precisa ler o KV por ?completo=1');
  assert.match(src, /method:\s*'PUT'/, 'sincronizar-capas.mjs precisa gravar o KV por PUT');
  assert.doesNotMatch(src, /^\s*import[^\n]*semear/m);
  assert.match(src, /if \(depois !== 200\) \{/, 'o script grava um nome sem conferir que a pull zone o serve');
});

/* O capas-menores gravava o KV uma vez, no fim do lote — com o Bunny guardando
 * a capa anterior, era seguro. Ele apaga: entre o envio e a gravação, o
 * cartão fica sem capa, e com o lote inteiro no meio eram minutos. */
test('o capas-menores.mjs grava o KV depois de CADA envio, e guarda o original antes', () => {
  const src = lerTexto(path.join(__dirname, '..', 'scripts', 'capas-menores.mjs'));
  assert.equal((src.match(/method:\s*'PUT'/g) || []).length, 1, 'uma gravação só no arquivo, a do gravarKV');
  const laco = src.slice(src.indexOf('for (const item of alvos)'), src.indexOf('} finally {'));
  const envio = laco.indexOf('provedor.definirCapa(');   /* o adaptador troca a capa (M4); antes era o cliente do Bunny */
  assert.ok(envio > 0, 'não achei o envio da capa dentro do laço');
  assert.ok(laco.indexOf('await gravarKV()', envio) > envio, 'o KV não é gravado logo depois de cada envio');
  assert.ok(laco.indexOf('writeFile(original, antes)') < envio, 'o original não é guardado antes do envio');
  const conferencia = laco.indexOf("!== (item.capa_arquivo || 'thumbnail.jpg')");
  assert.ok(conferencia > 0 && conferencia < laco.indexOf('baixar('),
    'o script reduz uma capa que o Bunny já trocou — e a devolveria POR CIMA da escolha nova');
});

/* O esqueleto da chegada. Ele mora no HTML para ser
 * pintado antes de qualquer script, e é por isso que o teste lê o index.html.
 * Três regras: quem ouve a tela sabe que está carregando (e não ouve vinte
 * retângulos), quem pediu menos movimento o vê PARADO, e uma rota que não é a
 * chegada não o mostra — ele prometeria uma tela que não vem. */
test('o esqueleto da chegada está no HTML, fala uma frase só e para com menos movimento', () => {
  const html = lerTexto(path.join(SITE, 'index.html'));
  const grade = html.match(/<div id="conteudo-grade">([\s\S]*?)<\/main>/);
  assert.ok(grade, 'não achei o #conteudo-grade no index.html');
  assert.match(grade[1], /class="esqueleto" role="status"/, 'o esqueleto saiu do #conteudo-grade, ou perdeu o role="status"');
  assert.match(grade[1], /<span class="pular"[^>]*>Carregando[^<]*<\/span><div aria-hidden="true">/,
    'o esqueleto não diz "carregando" a quem ouve, ou os retângulos deixaram de ser escondidos do leitor de tela');
  assert.ok(!/<img\b/.test(grade[1]), 'o esqueleto ganhou imagem — ela viraria o LCP e um pedido a mais');

  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.esq-destaque, \.esq-prateleira \{ animation: esq-pulsar/);
  const reduzido = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.match(reduzido, /\.esq-destaque, \.esq-prateleira \{ animation: none; \}/,
    'o esqueleto continua pulsando para quem pediu menos movimento');

  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const iniciar = app.slice(app.indexOf('function iniciar()'));
  assert.match(iniciar, /if \(hash && hash !== '#\/' && hash !== '#'\) limpar\(el\.grade\);/,
    'o esqueleto da chegada aparece também na ficha e nas outras rotas');
  assert.ok(iniciar.indexOf('limpar(el.grade)') < iniciar.indexOf('carregar(idiomaPronto)'),
    'o esqueleto só é tirado depois de o catálogo chegar — tarde demais para a rota errada');
});

/* D7: os cinco estados do B8 são UM desenho — ícone, título, ajuda, ação —, e
 * não mais a faixa vermelha do `.aviso` num caso e o `.vazio` cinza no outro. */
test('os estados vazios e de erro passam todos pela mesma peça, com saída à mão', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  for (const chave of ['buscaVazia', 'fichaAusente', 'erroCatalogo']) {
    assert.ok(app.includes("titulo: frase('" + chave + "')"),
      'o estado ' + chave + ' não passa pelo estadoVazio');
  }
  assert.ok(!/aviso\([^)]*,\s*true\)/.test(app), 'um estado voltou a ser a faixa vermelha do aviso');
  assert.ok(!/criar\('div', 'card-capa-vazia', /.test(app), 'uma capa vazia foi desenhada fora do capaVazia()');

  /* Toda saída de estado tem para onde ir. */
  const fatia = (marca) => {
    const i = app.indexOf(marca);
    return app.slice(app.lastIndexOf('estadoVazio({', i), app.indexOf('}));', i));
  };
  assert.match(fatia("titulo: frase('buscaVazia')"), /rotulo: tr\('site\.limparBusca'\)/);
  assert.match(fatia("titulo: frase('fichaAusente')"), /rotulo: tr\('comum\.voltarAoInicio'\)/);
  const erro = fatia("titulo: frase('erroCatalogo')");
  assert.match(erro, /rotulo: tr\('site\.tentarDeNovo'\)[\s\S]*window\.location\.reload\(\)/);
  assert.match(erro, /erro: true/, 'a falha de rede deixou de ser role="alert"');
  assert.match(erro, /detalhe: tr\('site\.detalheTecnico', \{ mensagem: erro\.message \}\)/,
    'a mensagem técnica sumiu, ou voltou para dentro da frase editável');

  /* O filtro de série só oferece série que está na resposta (D8): com ele
   * ligado, a busca nunca fica vazia. Mandar "remover o filtro" é mandar fazer
   * o que não existe. */
  assert.ok(!/filtro/i.test(App.TEXTOS_PADRAO.buscaVaziaAjuda), 'a ajuda da busca vazia voltou a falar do filtro');
  /* Nenhum padrão com buraco: o termo, o detalhe e os botões vêm em linha própria. */
  for (const [chave, texto] of Object.entries(App.TEXTOS_PADRAO)) {
    assert.ok(!/[{}%]|\(\s*\)/.test(texto), 'o texto ' + chave + ' tem um buraco para preencher');
  }
});

/* ======================= o LCP: a capa do destaque no HTML ================ */

/* A parte 2 do LCP. O `GET /api/catalogo` guarda a
 * URL da capa do destaque numa chave curta, e o `core/worker/home.js` a põe
 * num <link rel="preload"> do HTML. Estes testes RODAM as duas funções, com o
 * KV de mentira. */
const ambienteComPullzone = (kv) => Object.assign(ambiente(kv), { BUNNY_PULLZONE: 'vz-teste.b-cdn.net' });

test('o GET do catálogo guarda a capa do destaque, e só regrava quando ela muda', async () => {
  const cat = catalogoDeTeste(3);
  cat.itens[1].capa_arquivo = 'thumbnail_ab12.jpg';
  cat.itens[1].capa_versao = 1700000000000;
  cat.site = { destaque: 'b' };
  const kv = kvDeMentira({ catalogo: JSON.stringify(cat) });
  const env = ambienteComPullzone(kv);
  let escritas = 0;
  const put = kv.put;
  kv.put = async (...a) => { if (a[0] === 'capa-destaque') escritas++; return put(...a); };

  const r = await pedir(env, { caminho: '/api/catalogo' });
  assert.equal(r.status, 200);
  const esperada = App.urlCapa(App.destaque(r.corpo.itens, r.corpo.site));
  assert.equal(esperada, 'https://vz-teste.b-cdn.net/' + fonte.videoId + '/thumbnail_ab12.jpg?v=1700000000000');
  assert.equal(kv.dados['capa-destaque'], esperada, 'a chave não é a capa que a chegada vai pedir');
  assert.equal(escritas, 1);

  await pedir(env, { caminho: '/api/catalogo' });
  assert.equal(escritas, 1, 'o GET regrava a chave a cada visita — o KV gratuito tem 1.000 escritas por dia');

  /* Qualquer caminho que grave o catálogo é corrigido na visita seguinte —
   * aqui, um script que escreveu direto no KV e tirou o destaque do ar. */
  cat.itens[1].publicar = false;
  kv.dados.catalogo = JSON.stringify(cat);
  await pedir(env, { caminho: '/api/catalogo' });
  const agora = App.urlCapa({ midia: await midiaDoBunny(cat.itens[0], { BUNNY_PULLZONE: 'vz-teste.b-cdn.net' }) });
  assert.equal(kv.dados['capa-destaque'], agora, 'a chave não acompanhou o catálogo gravado por fora');
  assert.equal(escritas, 2);

  /* O GET completo, da mesa, não mexe na chave: ele devolve o que não está no ar. */
  const get = semComentarios(lerTexto(path.join(WORKER, 'api', 'catalogo.js')))
    .match(/export async function onRequestGet[\s\S]*?\n\}/)[0];
  assert.ok(get.indexOf('guardarCapaDoDestaque(') > get.indexOf('if (completo)'),
    'a chave é gravada antes de separar o pedido da mesa — sairia a capa de um título fora do ar');
});

test('a página inicial ganha o preload da capa, e sai intacta em todo erro', async () => {
  const idx = await import('../core/worker/home.js');
  const html = lerTexto(path.join(SITE, 'index.html'));
  assert.equal(html.split(idx.MARCA).length - 1, 1, 'o index.html perdeu a linha da folha de estilo onde o preload entra');

  const capa = 'https://vz-teste.b-cdn.net/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/thumbnail_ab12cd34.jpg?v=1700000000000';
  const pedidos = [];
  const assets = (status = 200) => ({
    fetch: async (req) => {
      pedidos.push(req);
      return new Response(status === 200 ? html : null, { status, headers: { etag: '"estatico"', 'content-type': 'text/html' } });
    }
  });
  const chamar = (valor, opcoes = {}) => idx.onRequestGet({
    modo: opcoes.modo || 'publico',
    request: new Request('https://exemplo.test/', { headers: { 'if-none-match': '"estatico"' } }),
    /* Sem BUNNY_PULLZONE no ambiente: os hosts de imagem que valem são os que o ADAPTADOR declara. */
    env: {
      ASSETS: assets(opcoes.status),
      CATALOGO: { get: async () => { if (opcoes.falha) throw new Error('KV fora'); return valor; } }
    }
  });

  const r = await chamar(capa);
  const corpo = await r.text();
  assert.equal(r.status, 200);
  assert.ok(corpo.includes('<link rel="preload" as="image" href="' + capa + '" fetchpriority="high">\n' + idx.MARCA),
    'o preload não entrou logo antes da folha de estilo');
  assert.equal(r.headers.get('etag'), null, 'a página com a capa do dia saiu com o ETag do arquivo estático');
  assert.equal(pedidos[pedidos.length - 1].headers.get('if-none-match'), null,
    'o pedido ao arquivo estático levou a condição — um 304 devolveria a página com a capa velha');
  assert.equal(corpo.replace(/<link rel="preload" as="image"[^>]*>\n/, ''), html, 'a função mudou mais que uma linha');

  /* O pior caso é não ajudar: a página sai como o arquivo estático. */
  for (const [caso, valor, opcoes] of [
    ['sem chave', null, {}],
    ['chave vazia', '', {}],
    ['KV fora', capa, { falha: true }],
    ['aspas', 'https://vz-teste.b-cdn.net/x.jpg"><script>alert(1)</script>', {}],
    ['outro domínio', 'https://exemplo.com/x.jpg', {}],
    ['http', capa.replace('https', 'http'), {}]
  ]) {
    const s = await chamar(valor, opcoes);
    assert.equal(await s.text(), html, caso + ': a página não saiu intacta');
    assert.equal(s.headers.get('etag'), '"estatico"', caso + ': a página intacta perdeu o ETag');
  }
  const naoOk = await chamar(capa, { status: 304 });
  assert.equal(naoOk.status, 304, 'uma resposta que não é 200 deve passar como veio');
  assert.equal(idx.comPreload('<html></html>', capa), null);
});

/* Nenhuma barra de rolagem nas pistas, nunca. O `thin`
 * que havia não segurava o Android, cuja barra sobreposta só obedece ao
 * `none`; e o Safari só obedece ao pseudo-elemento. Toda caixa que rola de
 * lado no site entra na conta — uma pista nova que nascer com `thin` cai
 * aqui. */
test('as pistas que rolam de lado não mostram barra de rolagem', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  for (const sel of ['.prateleira-pista', '.chips']) {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regra = css.match(new RegExp('\\n' + esc + '\\s*\\{([^}]*)\\}'));
    assert.ok(regra, 'não achei a regra de ' + sel);
    assert.match(regra[1], /overflow-x:\s*auto/, sel + ' deixou de rolar de lado');
    assert.match(regra[1], /scrollbar-width:\s*none/, sel + ' voltou a mostrar a barra no Chrome e no Firefox');
    assert.match(css, new RegExp(esc + '::-webkit-scrollbar\\s*\\{[^}]*display:\\s*none'),
      sel + ' voltou a mostrar a barra no Safari e nos Chrome antigos');
  }
  const rolantes = [...css.matchAll(/\n([^{}\n]+)\{([^}]*overflow-x:\s*auto[^}]*)\}/g)];
  assert.ok(rolantes.length >= 2, 'esperava ao menos as duas pistas');
  for (const [, sel, corpo] of rolantes) {
    assert.ok(!/scrollbar-width:\s*thin/.test(corpo), sel.trim() + ' rola de lado com barra fina');
  }
});

/* A abertura. O script do <head> é quem decide, e ele
 * roda aqui DE VERDADE, num contexto com sessionStorage, endereço e
 * preferência de movimento de mentira — cada caso é uma visita. */
function scriptDaAbertura() {
  const html = lerTexto(path.join(SITE, 'index.html'));
  const m = html.match(/<script>\n([\s\S]*?tm-abertura[\s\S]*?)<\/script>/);
  assert.ok(m, 'não achei o script da abertura no <head> do index.html');
  return { html, codigo: m[1] };
}

function visitar(codigo, { hash = '', search = '', guardado = null, reduzido = false, semStorage = false, instalado = false, iphone = false, dedo = false } = {}) {
  const guardados = {};
  if (guardado) guardados['tm-abertura'] = guardado;
  const storage = {
    getItem: (k) => { if (semStorage) throw new Error('SecurityError'); return k in guardados ? guardados[k] : null; },
    setItem: (k, v) => { if (semStorage) throw new Error('SecurityError'); guardados[k] = String(v); }
  };
  const raiz = { className: '' };
  const ctx = {
    sessionStorage: storage,
    location: { hash, search },
    matchMedia: (q) => ({ matches: (reduzido && /reduce/.test(q)) || (instalado && /standalone/.test(q)) ||
      (dedo && /coarse/.test(q)) }),
    navigator: { standalone: iphone },
    document: { documentElement: raiz }
  };
  ctx.window = ctx;
  vm.runInNewContext(codigo, ctx);
  return { abriu: /\babrindo\b/.test(raiz.className), semMarca: /\bsem-marca\b/.test(raiz.className), guardados };
}

test('a abertura roda uma vez por sessão, só na chegada, e nunca sem sessionStorage', () => {
  const { codigo } = scriptDaAbertura();
  const primeira = visitar(codigo);
  assert.equal(primeira.abriu, true, 'a primeira chegada da sessão não abriu');
  assert.equal(primeira.guardados['tm-abertura'], '1', 'a abertura não se marcou como vista');
  assert.equal(visitar(codigo, { hash: '#/' }).abriu, true, '#/ também é a chegada');
  assert.equal(visitar(codigo, { guardado: '1' }).abriu, false, 'a abertura repetiu na mesma sessão');
  for (const hash of ['#/ep/abc', '#/serie/Exemplo', '#/busca/boi', '#/series']) {
    assert.equal(visitar(codigo, { hash }).abriu, false, hash + ' passou pela abertura — ela é da chegada');
  }
  assert.equal(visitar(codigo, { search: '?mesa=1' }).abriu, false, 'a abertura rodou dentro da mesa');
  assert.equal(visitar(codigo, { reduzido: true }).abriu, false, 'a abertura rodou com movimento reduzido');
  /* No APP INSTALADO a abertura roda SEM A MARCA: o sistema já mostra o
   * ícone ao abrir (pedido de 23/09). No navegador — do computador ou do
   * celular — não há ícone, e a marca fica. */
  assert.equal(primeira.semMarca, false, 'o computador perdeu a marca da abertura');
  assert.equal(visitar(codigo, { dedo: true }).semMarca, false,
    'o navegador do celular perdeu a marca — lá não há ícone de abertura');
  for (const [caso, opcoes] of [['o app instalado', { instalado: true }],
    ['o app instalado no iPhone', { iphone: true }]]) {
    const v = visitar(codigo, opcoes);
    assert.equal(v.abriu, true, caso + ' perdeu a abertura — só a marca sai');
    assert.equal(v.semMarca, true, caso + ' mostra a marca depois do ícone do sistema');
  }
  assert.equal(visitar(codigo, { semStorage: true }).abriu, false,
    'sem sessionStorage a abertura NÃO roda — senão ela viria em toda visita');
});

test('a camada da abertura cobre a página, e a capa do destaque nunca fica invisível', () => {
  const { html } = scriptDaAbertura();
  /* Antes da folha de estilo: a decisão tem de valer para o primeiro quadro,
   * e um script depois do <link> esperaria o CSS baixar. */
  assert.ok(html.indexOf('tm-abertura') < html.indexOf('<link rel="stylesheet" href="style.css">'),
    'o script da abertura foi para depois da folha de estilo');
  assert.match(html, /<div class="abertura" id="abertura" aria-hidden="true">/, 'sumiu a camada, ou ela ficou audível');

  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\n\.abertura\s*\{\s*display:\s*none;?\s*\}/, 'a camada existe fora da abertura');
  const camada = css.match(/\n\.abrindo \.abertura\s*\{([^}]*)\}/);
  assert.ok(camada, 'não achei a regra da camada');
  assert.match(camada[1], /position:\s*fixed/);
  assert.match(camada[1], /animation:\s*abertura-sai\s+[\d.]+s\s+\S+\s+3\.6s/,
    'a camada perdeu a saída sozinha aos 3,6 s — sem o app.js ela ficaria para sempre');
  /* A saída pedida pelo app.js tem de ser OUTRA animação: trocar só a espera
   * da que já corre não a reinicia, e a camada sumia sem esmaecer (o defeito
   * do primeiro deploy). */
  const saindo = css.match(/\n\.abrindo \.abertura\.abertura-saindo\s*\{\s*animation:\s*([\w-]+)/);
  assert.ok(saindo, 'não achei a saída da camada');
  assert.notEqual(saindo[1], camada[1].match(/animation:\s*([\w-]+)/)[1],
    'a saída reusa o nome da animação da rede de segurança — ela nasce terminada');
  assert.match(css, /\.abrindo\.sem-marca \.abertura\s*\{\s*display:\s*none/, 'o celular voltou a mostrar a marca');

  /* O LCP: a capa entra só por transform. Nenhuma regra que alcance a imagem
   * da capa pode mexer na opacidade, nem o quadro da animação dela. */
  const quadros = css.match(/@keyframes cinema-capa\s*\{([\s\S]*?)\n\}/);
  assert.ok(quadros, 'não achei a animação da capa');
  assert.ok(!/opacity|visibility/.test(quadros[1]), 'a capa do destaque ganhou opacidade na entrada — ela é o LCP');
  for (const [, sel, corpo] of css.matchAll(/\n([^{}\n@]*destaque-capa[^{}\n]*)\{([^}]*)\}/g)) {
    assert.ok(!/opacity|visibility:\s*hidden/.test(corpo), sel.trim() + ' esconde a capa do destaque, que é o LCP');
  }

  const reduzido = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.match(reduzido, /\.abrindo \.abertura\s*\{\s*display:\s*none/, 'movimento reduzido não apaga a camada');
  assert.match(reduzido, /\.cinema \.destaque-capa img/, 'movimento reduzido não para a entrada do destaque');
});

test('o app.js tira a camada: com o cinema depois da capa, sem ele em todo o resto', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const ligar = app.match(/function ligarAbertura\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(ligar, 'não achei ligarAbertura');
  for (const ev of ['click', 'keydown', 'hashchange']) {
    assert.match(ligar[1], new RegExp("'" + ev + "', semCinema"), 'um ' + ev + ' deixou de pular a abertura');
  }
  assert.match(ligar[1], /setTimeout\(semCinema/, 'a abertura perdeu o teto');
  const abrir = app.match(/function abrirChegada\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(abrir, 'não achei abrirChegada');
  assert.match(abrir[1], /addEventListener\('error', pronto\)/, 'a capa que falha prenderia a camada até o teto');
  const iniciar = app.match(/function iniciar\(\)\s*\{([\s\S]*?)\n  \}/)[1];
  assert.match(iniciar, /rotear\(\);\s*abrirChegada\(\);/, 'a chegada desenhada não chama a abertura');
  assert.match(iniciar, /\.then\(function \(erro\) \{\s*if \(!erro\) return;\s*soltarAbertura\(false\);/,
    'o catálogo que falha deixa a camada por cima da mensagem de erro');
  assert.ok(!/abertura[\s\S]{0,80}\.style\.opacity/.test(app), 'o app.js mexe na opacidade pela abertura');
});

/* O cartão que abre. A armadilha que decide o
 * desenho é a do projeto — a pista corta o que passa da borda dela nos DOIS
 * eixos —, e por isso quem cresce é uma cópia posta no palco. */
test('o cartão que abre mora no palco, fora da pista, e é só vista', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const abrir = app.match(/function abrirPop\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(abrir, 'não achei abrirPop');
  assert.match(abrir[1], /a\.closest\('\.prateleira-palco'\)/, 'a cópia deixou de ir para o palco');
  assert.match(abrir[1], /palco\.appendChild\(no\)/, 'a cópia deixou de ir para o palco');
  assert.ok(!/pista\.appendChild|closest\('\.prateleira-pista'\)/.test(abrir[1]),
    'a cópia foi para dentro da pista — lá ela é cortada em cima e embaixo');
  assert.match(abrir[1], /setAttribute\('aria-hidden', 'true'\)/, 'a cópia ficou audível — o cartão focado já é o link');
  assert.equal((abrir[1].match(/tabIndex = -1/g) || []).length, 2,
    'um link da cópia entrou no Tab — ela repete o caminho que o cartão já oferece');
  assert.match(abrir[1], /ligarAssistir\(assistir, item\.id\)/, 'o "Assistir" da cópia não dá o play');

  /* Só com ponteiro fino, e fora da mesa — lá o clique escolhe. */
  const pode = app.match(/function podePop\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(pode, 'não achei podePop');
  assert.match(pode[1], /\(hover: hover\) and \(pointer: fine\)/, 'a cópia abre sem ponteiro fino');
  const cartao = app.match(/function cartaoPrateleira\([^)]*\)\s*\{([\s\S]*?)\n  \}/)[1];
  assert.match(cartao, /if \(mesa\.ligada\) ligarPreview\(a, capa, item\);\s*else ligarPop\(a, item\);/,
    'o cartão da prateleira pede a prévia duas vezes, ou abre dentro da mesa');
});

test('a prévia do cartão que abre é só do ponteiro, e morre com ele', () => {
  const app = lerTexto(path.join(SITE, 'app.js'));
  const ligar = app.match(/function ligarPop\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(ligar, 'não achei ligarPop');
  assert.match(ligar[1], /setTimeout\(function \(\) \{ abrirPop\(a, item, true\); \}, ESPERA_POP_MS\)/,
    'o ponteiro deixou de esperar parado antes de abrir — atravessar a linha abriria cada cartão');
  assert.match(ligar[1], /':focus-visible'\)\) abrirPop\(a, item, false\)/,
    'o foco pelo teclado pede a prévia — a regra é prévia só no hover');
  const abrir = app.match(/function abrirPop\([^)]*\)\s*\{([\s\S]*?)\n  \}/)[1];
  assert.match(abrir, /peloPonteiro \? novaPrevia\(capaLink, item\) : null/);
  const fechar = app.match(/function fecharPop\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(fechar, 'não achei fecharPop');
  assert.match(fechar[1], /pop\.previa\.descartar\(\)/, 'fechar a cópia deixa a prévia baixando');
  /* A ficha esconde a grade sem redesenhá-la: sem o fechamento no roteador,
   * a cópia ficaria escondida lá dentro, com a prévia viva. */
  for (const fn of ['rotear', 'renderGrade']) {
    const corpo = app.match(new RegExp('function ' + fn + '\\(\\)\\s*\\{([\\s\\S]*?)\\n  \\}'))[1];
    assert.match(corpo, /fecharPop\(\);/, fn + ' não fecha o cartão aberto');
  }
});

test('o cartão que abre passa por cima sem deslocar nada, e o celular ganha a borda que esmaece', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const regra = css.match(/\n\.pop\s*\{([^}]*)\}/);
  assert.ok(regra, 'não achei a regra do .pop');
  assert.match(regra[1], /position:\s*absolute/, 'a cópia entrou no fluxo — ela empurraria a prateleira de baixo');
  const z = +regra[1].match(/z-index:\s*(\d+)/)[1];
  assert.ok(z > 3 && z < 20, 'a cópia tem de ficar acima das setas (3) e abaixo do cabeçalho (20): ' + z);
  assert.match(css, /\.pop\s*\{\s*transition:\s*none;?\s*\}/, 'movimento reduzido ainda anima a cópia');

  const toque = css.match(/@media \(hover: none\), \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(toque, 'não achei a borda que esmaece do celular');
  assert.match(toque[1], /\.prateleira-pista:not\(\.pista-no-fim\)/, 'a borda esmaece também no fim da pista');
  assert.match(toque[1], /-webkit-mask-image/, 'o Safari ficou sem a borda que esmaece');
  const app = lerTexto(path.join(SITE, 'app.js'));
  const setas = app.match(/function ajustarSetas\(pista\)\s*\{([\s\S]*?)\n  \}/)[1];
  assert.match(setas, /classList\.toggle\('pista-no-fim', noFim\)/, 'ninguém marca o fim da pista');
});

/* ===================== o script das séries == */

/* O `series.mjs` só é útil se o que ele manda gravar passa pela mesma
 * conferência da página: um momento que o modelo inventou fora do começo de
 * um capítulo cai ANTES de ir ao catálogo, e fica anotado no ensaio. */
test('o script das séries confere a resposta do modelo contra a série, e nunca escreve o revisado', async () => {
  const S = await import('../scripts/lib/series.mjs');

  assert.deepEqual(S.seriesComPagina(itensApresentacao), ['Série Exemplo 1', 'Série Exemplo 2', 'Eventos'].filter(n =>
    App.gruposDeSeries(itensApresentacao).some(g => g.series.some(s => s.nome === n && s.temPagina))));

  const falas = S.lerFala('sx1-2\t[[0,"Bom dia."],[95,"A rotina começa cedo."]]\nlinha torta\nx\tnão é json');
  assert.equal(falas.size, 1);
  const m = S.materialDaSerie(itensApresentacao, 'Série Exemplo 1', falas);
  assert.deepEqual(m.titulos.map(t => t.id), ['sx1-1', 'sx1-2', 'sx1-3'], 'o material levou título fora do ar ou fora de ordem');
  assert.equal(m.titulos[1].fala, 'Bom dia. A rotina começa cedo.');
  assert.match(S.textoDoMaterial(m), /inicio 95: O consultório/);
  assert.deepEqual(S.formatoDaResposta(m).schema.properties.comeco.enum, ['sx1-1', 'sx1-2', 'sx1-3']);

  const { entrada, avisos } = S.conferirResposta(itensApresentacao, 'Série Exemplo 1', {
    sobre: 'Nesta série, profissionais contam o dia a dia.',
    comeco: 'sx1-1',
    momentos: [{ id: 'sx1-2', inicio: 95 }, { id: 'sx1-2', inicio: 100 }],
    temas: ['Vocação']
  });
  assert.equal(entrada.origem, 'auto', 'o que o modelo escreve nasceu revisado');
  assert.deepEqual(entrada.momentos, [{ id: 'sx1-2', inicio: 95 }]);
  assert.ok(avisos.some(a => /fora de capítulo/.test(a)));
  assert.ok(avisos.some(a => /fórmula proibida/.test(a)), 'o "Nesta série" passou sem aviso');

  const revisado = { series: { 'Série Exemplo 2': { sobre: 'Lido por gente.', origem: 'revisada' } } };
  assert.equal(S.podeEscrever(revisado, 'Série Exemplo 2', true), false, 'o --refazer sobrescreve o revisado');
  const auto = { series: { 'Série Exemplo 2': { sobre: 'Do script.' } } };
  assert.equal(S.podeEscrever(auto, 'Série Exemplo 2', false), false);
  assert.equal(S.podeEscrever(auto, 'Série Exemplo 2', true), true);
  assert.equal(S.podeEscrever(null, 'Série Exemplo 2', false), true);
});

test('o series.mjs ensaia por padrão, lê o KV, e recusa gravar antes do servidor conhecer o campo', () => {
  const src = semComentarios(lerTexto(path.join(__dirname, '..', 'scripts', 'series.mjs')));
  assert.match(src, /api\/catalogo\?completo=1/, 'o script leu o arquivo local em vez do KV');
  assert.match(src, /if \(op\.gravar\)/, 'gravar deixou de exigir --gravar');
  assert.match(src, /'series' in publico\.site/, 'o script grava sem conferir que o servidor guarda o campo');
  assert.match(src, /podeEscrever\(novoSite/, 'a gravação não confere o revisado no catálogo lido na hora');
  assert.ok(!/origem: 'revisada'/.test(src), 'o script marca revisado');
});

/* ===================== a página da série com a apresentação (fase 3) */

test('os temas da série entram na busca numa cópia, e sem tema a lista é a mesma', () => {
  const site = { series: { 'Série Exemplo 1': { sobre: 'x', temas: ['Vocação'] } } };
  const com = App.comTemasDasSeries(itensApresentacao, site);
  const sx1 = com.find(i => i.id === 'sx1-2');
  assert.deepEqual(sx1.tags, ['Vocação']);
  assert.ok(!('tags' in itensApresentacao.find(i => i.id === 'sx1-2')), 'o dado do título mudou');
  assert.equal(com.find(i => i.id === 'enq-1'), itensApresentacao.find(i => i.id === 'enq-1'), 'título de outra série foi copiado à toa');
  assert.deepEqual(App.buscar(App.publicaveis(com), 'vocacao').map(i => i.id).sort(), ['sx1-1', 'sx1-2', 'sx1-3']);
  assert.equal(App.comTemasDasSeries(itensApresentacao, {}), itensApresentacao,
    'sem tema nenhum a lista mudou de identidade — e o índice da busca seria refeito a cada desenho');
});

test('a página da série desenha a apresentação só com texto, e o momento é o caminho do trecho', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const corpo = (nome) => {
    const i = app.indexOf('function ' + nome + '(');
    assert.ok(i >= 0, 'não achei ' + nome);
    return app.slice(i, app.indexOf('\n  }\n', i));
  };
  const render = corpo('renderSerie');
  assert.match(render, /App\.apresentacaoDaSerie\(estado\.itens, s\.nome, estado\.site\)/);
  /* Desde 24/09 o "Sobre" mora na coluna do título, dentro do alto — com a
   * capa ao lado dos dois no computador. */
  assert.ok(render.indexOf('cabecaDaSerie(s, a)') < render.indexOf('secaoEpisodios'), 'o alto saiu embaixo da lista');
  assert.match(corpo('cabecaDaSerie'), /if \(a && a\.sobre\) texto\.appendChild\(sobreDaSerie\(a, s\.nome\)\);/,
    'o Sobre saiu da coluna do título');
  /* E no celular: sem "Comece por aqui", e os temas no fim da página. */
  assert.ok(render.indexOf("'serie-temas serie-temas-fim'") > render.indexOf('secaoEpisodios'), 'os temas do celular não estão depois da lista');
  const css560 = lerTexto(path.join(SITE, 'style.css')).match(/@media \(max-width: 560px\) \{\s*\.serie-comeco,[\s\S]*?\n\}/);
  assert.ok(css560, 'o celular ainda mostra o Comece por aqui');
  assert.match(css560[0], /\.serie-destaques \.serie-temas \{ display: none; \}|\.serie-destaques \.serie-temas[^{]*\{ display: none; \}/);
  assert.match(css560[0], /\.serie-temas-fim \{ display: block;/);

  /* Nenhuma capa a mais na carga: os destaques são texto. */
  for (const f of ['sobreDaSerie', 'destaquesDaSerie']) {
    assert.ok(!/'img'|urlCapa|urlPreview/.test(corpo(f)), f + ' pede imagem');
    assert.ok(!/innerHTML/.test(corpo(f)), f + ' põe texto do dado por innerHTML');
  }
  const destaques = corpo('destaquesDaSerie');
  /* O clique dá o play, o link colado abre parado — a REGRA 1 continua no
   * `ligarAssistir`, que só guarda o pedido de um clique primário. */
  assert.equal((destaques.match(/ligarAssistir\(/g) || []).length, 2, 'o começo ou o momento não pedem o play pelo clique');
  assert.match(destaques, /l\.href = mo\.link/);
  assert.match(destaques, /chipsDeTemas\(a\.temas\)/);
  assert.match(corpo('chipsDeTemas'), /buscarPor\(tema\)/);
  assert.match(corpo('buscarPor'), /aoDigitar\(\)/, 'o tema abre a busca por outro caminho que não o de quem digita');

  /* E a busca responde pelo tema: os dois caminhos passam pela cópia com os temas. */
  assert.match(corpo('indiceDaBusca'), /App\.comTemasDasSeries\(App\.publicaveis\(estado\.itens\), estado\.site\)/);
  assert.match(corpo('indiceDaBusca'), /busca\.indiceSite !== estado\.site/, 'o índice não se refaz quando os temas mudam');
  assert.match(corpo('responder'), /base = App\.comTemasDasSeries\(base, estado\.site\);/);

  const css = lerTexto(path.join(SITE, 'style.css'));
  assert.match(css, /\.serie-destaques \{[^}]*repeat\(auto-fit, minmax\(min\(280px, 100%\), 1fr\)\)/,
    'a faixa dos destaques não se ajeita sozinha — a série sem capítulo deixaria buraco');
});

/* ============================= a entrada da série (fase 4) ========= */

test('a entrada da série roda uma vez por série na sessão, e nunca sem memória, com menos movimento ou na mesa', () => {
  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const i = app.indexOf('function entradaDaSerie(');
  const f = app.slice(i, app.indexOf('\n  }\n', i));
  assert.match(f, /if \(mesa\.ligada\) return;/, 'a entrada roda dentro da mesa, que redesenha a cada tecla');
  assert.match(f, /prefers-reduced-motion: reduce/);
  assert.match(f, /vistas\.indexOf\(nome\) >= 0\) return;/, 'a entrada não é uma vez por série');
  /* Sem sessionStorage, NÃO roda — seria a animação a cada visita. O
   * `return` está dentro do catch, antes de ligar a classe. */
  assert.ok(/catch \(e\) \{\s*return;\s*\}/.test(f) && f.indexOf('catch') < f.indexOf("classList.add('cinema-serie')"),
    'sem sessionStorage a entrada roda do mesmo jeito');
  assert.match(app, /entradaDaSerie\(s\.nome\);/);
  /* Sem camada e sem marca: a abertura é da chegada. */
  assert.ok(!/abertura/.test(f), 'a entrada da série mexe na abertura da chegada');
});

test('na entrada da série a capa só se move: nunca opacidade, e nada com movimento reduzido', () => {
  const css = lerTexto(path.join(SITE, 'style.css'));
  const regra = css.match(/\.cinema-serie \.serie-cabeca \.destaque-capa img \{([^}]*)\}/);
  assert.ok(regra, 'não achei a regra da capa na entrada da série');
  assert.match(regra[1], /animation: cinema-capa /, 'a capa da série ganhou outra animação');
  const kf = css.match(/@keyframes cinema-capa \{([\s\S]*?)\n\}/);
  assert.ok(!/opacity/.test(kf[1]), 'a animação da capa mexe na opacidade — a capa é o LCP');
  const reduzido = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g).join('\n');
  for (const sel of ['.cinema-serie .serie-cabeca .destaque-capa img', '.cinema-serie .serie-sobre', '.cinema-serie .serie-caixa', '.cinema-serie .episodios']) {
    assert.ok(reduzido.includes(sel), sel + ' continua animado com movimento reduzido');
  }
});

/* ============================ a mesa da apresentação (fase 5) ====== */

test('a mesa edita a apresentação da série: mexer é revisar, e voltar ao gerado apaga', () => {
  const base = semComentarios(lerTexto(path.join(SITE, 'mesa-base.js')));
  const i = base.indexOf('M.mudarSerie = function');
  const f = base.slice(i, base.indexOf('\n  };\n', i));
  assert.match(f, /m\.origem = voltou && noServidor\.origem \? noServidor\.origem : 'revisada';/,
    'editar na mesa não marca revisado — o script escreveria por cima');
  assert.match(f, /M\.mudarSite\('series', App\.comSerie\(M\.site\(\), nome, m\)\.series/,
    'o rascunho não guarda o mapa inteiro das séries pela escrita do core');
  assert.match(base, /M\.voltarSerieAoGerado = function \(nome\) \{\s*M\.mudarSite\('series', App\.comSerie\(M\.site\(\), nome, null\)\.series\);/);

  const painel = semComentarios(lerTexto(path.join(SITE, 'mesa-painel.js')));
  assert.match(painel, /if \(s\.indexOf\('serie:'\) === 0\) \{ var se = inspSerie\(cat, s\.slice\(6\)\);/);
  for (const id of ['s-sobre', 's-origem', 's-revisar', 's-comeco', 's-temas', 's-gerado', 'data-momento']) {
    assert.ok(painel.includes(id), 'o inspetor da série perdeu ' + id);
  }
  assert.match(painel, /var pode = M\.pode\('conteudo'\);/, 'o inspetor da série pede outra permissão que não a do servidor');
  assert.match(painel, /cheio && !escolhidos\[chave\]/, 'dá para marcar mais de cinco momentos');

  const mesa = semComentarios(lerTexto(path.join(SITE, 'mesa.js')));
  assert.match(mesa, /'s-gerado': function \(\) \{[\s\S]*?window\.confirm\(/, 'voltar ao gerado apaga sem perguntar');
  assert.match(mesa, /irNoSite\('#\/serie\/' \+ encodeURIComponent\(alvo\.slice\(6\)\)\)/, 'escolher a série não abre a página dela no quadro');

  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  assert.match(app, /marcarMesa\(caixa, 'serie:' \+ s\.nome\)/, 'o alto da série não escolhe a apresentação na mesa');
});

/* A decisão de 24/09 sobre a pergunta da fase 6: a ficha aberta por outro
 * caminho OFERECE continuar, sem mostrar o tempo — e não retoma sozinha. */
test('a ficha oferece Continuar sem o tempo, e só quando nada foi pedido', () => {
  const mapa = { 'sx1-2': { t: 372, d: 600, q: 5 }, 'sx1-3': { t: 590, d: 600, q: 6 } };
  assert.deepEqual(App.ondeParouDe(mapa, 'sx1-2'), { t: 372, link: '#/ep/sx1-2?t=372' });
  assert.equal(App.ondeParouDe(mapa, 'sx1-3'), null, 'quem chegou ao fim ganhou Continuar');
  assert.equal(App.ondeParouDe(mapa, 'nada'), null);
  assert.equal(App.ondeParouDe('lixo', 'sx1-2'), null);

  const app = semComentarios(lerTexto(path.join(SITE, 'app.js')));
  const i = app.indexOf('function renderFicha(');
  const f = app.slice(i, app.indexOf('\n  }\n', i));
  assert.match(f, /momento == null && !tocar && !mesa\.ligada/, 'o Continuar aparece com ?t=, com o Assistir ou na mesa');
  assert.match(f, /alvoCapitulos === playerAtivo/, 'o Continuar aparece no iframe, que não grava onde parou');
  assert.match(f, /App\.ondeParouDe\(lerOndeParou\(\), item\.id\)/);
  assert.match(f, /continuar\.href = ponto\.link/);
  assert.match(f, /ligarAssistir\(continuar, item\.id\)/);
  assert.match(f, /addEventListener\('play'[\s\S]{0,120}removeChild\(continuar\)/, 'o Continuar fica na tela depois do play');
  /* Sem o tempo escrito, como pedido: nenhum formatarTempo(ponto…). */
  assert.ok(!/formatarTempo\(ponto/.test(f), 'a ficha mostra o tempo do Continuar');
  /* E sem retomar: nada da memória chega ao currentTime nem ao player. */
  assert.ok(!/currentTime|irPara\(ponto|tocar\(ponto/.test(f.slice(f.indexOf('var ponto'), f.indexOf('var ponto') + 1500)),
    'a ficha retoma sozinha');
});
