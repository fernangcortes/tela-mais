// Testes da configuração: schema, validador, camadas (KV > arquivo > padrão),
// falha fechada e idempotência do aplicar-config.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync as ler } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validarConfig, validarSchema, acharSegredos, contraste, PALAVRAS_SUPORTADAS
} from '../core/worker/_lib/config-validar.mjs';
import {
  obterConfig, montarConfig, limparCacheConfig, resolverSegredo, CHAVE_OPERACAO, TTL_MS
} from '../core/worker/_lib/config.js';
import { aplicarConfig } from '../scripts/aplicar-config.mjs';
import { principal as validarPrincipal } from '../scripts/validar-config.mjs';
import { gerarPublico, gerarRobots } from '../scripts/lib/config-gerar.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(path.join(RAIZ, 'config/site.schema.json'), 'utf8'));
const exemplo = () => JSON.parse(readFileSync(path.join(RAIZ, 'config/site.json'), 'utf8'));
const com = (mudar) => { const c = exemplo(); mudar(c); return c; };
const paths = (r) => r.erros.map((e) => e.caminho);

beforeEach(() => limparCacheConfig());

test('schema: o exemplo neutro é aceito e traz os padrões combinados', () => {
  const r = validarConfig(schema, exemplo());
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  const c = r.config;
  assert.equal(c.marca.nome, 'Plataforma Exemplo');
  assert.equal(c.video.provedor, 'bunny');
  assert.equal(c.player.autoplay.modo, 'nunca');
  assert.equal(c.acesso.modo, 'publico');
  assert.equal(c.mcp.ligado, false);
});

test('schema: config vazia é válida e o padrão de acesso é o mais fechado', () => {
  const r = validarConfig(schema, {});
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.equal(r.config.acesso.modo, 'privado');
  assert.equal(r.config.player.autoplay.modo, 'nunca');
  assert.equal(r.config.idiomas.padrao, 'pt-BR');
});

test('schema: usa só as palavras que o validador sabe interpretar', () => {
  const usadas = new Set();
  const andar = (n, ehMapaDeNomes = false) => {
    if (Array.isArray(n)) return n.forEach((x) => andar(x));
    if (!n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      if (!ehMapaDeNomes) usadas.add(k);
      /* properties, $defs e patternProperties são mapas de nomes, não de palavras-chave */
      andar(v, ['properties', '$defs', 'patternProperties'].includes(k));
    }
  };
  andar(schema);
  const fora = [...usadas].filter((k) => !PALAVRAS_SUPORTADAS.has(k));
  assert.deepEqual(fora, [], 'palavra de schema que o validador ignora: ' + fora.join(', '));
});

test('validador: recusa paleta, enum, tipo, faixa e campo desconhecido, em português', () => {
  const casos = [
    [(c) => { c.tema.cores = { escuro: { marca: 'azul' } }; }, 'tema.cores.escuro.marca'],
    [(c) => { c.tema.cores = { escuro: { fundo: '#12345' } }; }, 'tema.cores.escuro.fundo'],
    [(c) => { c.acesso.modo = 'aberto'; }, 'acesso.modo'],
    [(c) => { c.player.autoplay.modo = 'sempre'; }, 'player.autoplay.modo'],
    [(c) => { c.player.proximoEpisodio.segundosDeContagem = 0; }, 'player.proximoEpisodio.segundosDeContagem'],
    [(c) => { c.marca.nome = ''; }, 'marca.nome'],
    [(c) => { c.marca.dominio = 'http://inseguro.exemplo.com'; }, 'marca.dominio'],
    [(c) => { c.marca.nomee = 'x'; }, 'marca.nomee'],
    [(c) => { c.recursos.busca.porPalavra = 'sim'; }, 'recursos.busca.porPalavra'],
    [(c) => { c.implantacao.nomeDoProjeto = 'Nome Com Espaço'; }, 'implantacao.nomeDoProjeto']
  ];
  for (const [mudar, caminho] of casos) {
    const r = validarConfig(schema, com(mudar));
    assert.equal(r.ok, false, 'deveria recusar ' + caminho);
    assert.ok(paths(r).includes(caminho), `esperava erro em ${caminho}, veio ${paths(r)}`);
    assert.match(r.erros.find((e) => e.caminho === caminho).mensagem, /[a-zãçé]/);
  }
});

test('validador: contraste insuficiente é recusado; paleta boa passa', () => {
  assert.ok(contraste('#000000', '#ffffff') > 20.9);
  const ruim = validarConfig(schema, com((c) => { c.tema.cores = { escuro: { texto: '#1a1d22' } }; }));
  assert.equal(ruim.ok, false);
  assert.match(ruim.erros[0].mensagem, /contraste insuficiente/);
  const bom = validarConfig(schema, com((c) => { c.tema.cores = { claro: { fundo: '#ffffff', texto: '#14181b', marca: '#0f6b45', superficie: '#f3f5f7' } }; }));
  assert.equal(bom.ok, true, JSON.stringify(bom.erros));
  const claroRuim = validarConfig(schema, com((c) => { c.tema.cores = { claro: { fundo: '#ffffff', texto: '#cccccc' } }; }));
  assert.equal(claroRuim.ok, false);
});

test('validador: idioma padrão precisa estar entre os disponíveis', () => {
  const r = validarConfig(schema, com((c) => { c.idiomas = { padrao: 'en', disponiveis: ['pt-BR'] }; }));
  assert.equal(r.ok, false);
  assert.ok(paths(r).includes('idiomas.padrao'));
});

test('segredo literal é recusado em qualquer lugar; {"$env"} é aceito', () => {
  const literais = [
    [(c) => { c.video.bunny.chaveApi = 'minha-chave-123'; }, 'video.bunny.chaveApi'],
    [(c) => { c.video.bunny.chaveDeToken = 'abc'; }, 'video.bunny.chaveDeToken'],
    [(c) => { c.marca.slogan = 'sk-ant-api03-abcdefghijklmnopqrstuvwx'; }, 'marca.slogan'],
    [(c) => { c.marca.descricao = '0123456789abcdef0123456789abcdef'; }, 'marca.descricao'],
    [(c) => { c.ia = { textos: { chave: { $env: 'minuscula' } } }; }, 'ia.textos.chave'],
    [(c) => { c.marca.organizacao = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'; }, 'marca.organizacao']
  ];
  for (const [mudar, caminho] of literais) {
    const r = validarConfig(schema, com(mudar));
    assert.equal(r.ok, false, 'deveria recusar em ' + caminho);
    assert.ok(paths(r).includes(caminho), `esperava ${caminho}, veio ${paths(r)}`);
  }
  assert.deepEqual(acharSegredos({ video: { bunny: { chaveApi: { $env: 'BUNNY_API_KEY' } } } }), []);
  /* texto longo só de letras (slug) não é segredo */
  assert.deepEqual(acharSegredos({ a: 'organizacao-exemplo-videos-institucionais-do-ano' }), []);
});

test('config inválida, ausente ou sem schema => modo privado e erro marcado', async () => {
  const invalidos = [
    { arquivo: com((c) => { c.tema.cores = { escuro: { marca: 'azul' } }; }) },
    { arquivo: com((c) => { c.acesso.modo = 'aberto'; }) },
    { arquivo: com((c) => { c.video.bunny.chaveApi = 'segredo-em-texto'; }) },
    { arquivo: null },
    { arquivo: 'não é objeto' },
    { arquivo: exemplo(), schema: null }
  ];
  for (const op of invalidos) {
    const c = await obterConfig({}, { ...op, semCache: true });
    assert.equal(c.acesso.modo, 'privado', 'falha deveria fechar: ' + JSON.stringify(op).slice(0, 60));
    assert.equal(c._estado.valido, false);
    assert.ok(c._estado.erros.length > 0);
    if (op.schema !== null) assert.equal(c.player.autoplay.modo, 'nunca');   /* sem schema não há padrões */
  }
  /* a config inválida não vaza os valores dela */
  const c = await obterConfig({}, { arquivo: com((x) => { x.marca.nome = 'Nome Que Nao Vale'; x.acesso.modo = 'aberto'; }), semCache: true });
  assert.notEqual(c.marca.nome, 'Nome Que Nao Vale');
});

test('config válida: usa o arquivo e marca _estado.valido', async () => {
  const c = await obterConfig({}, { arquivo: exemplo(), semCache: true });
  assert.equal(c._estado.valido, true);
  assert.equal(c.acesso.modo, 'publico');
  const real = await obterConfig({}, { semCache: true });   /* o arquivo empacotado */
  assert.equal(real._estado.valido, true);
});

function kvCom(valor, falha) {
  return { CATALOGO: { get: async (k) => { if (falha) throw new Error('kv fora'); return k === CHAVE_OPERACAO ? valor : null; } } };
}

test('precedência: KV > arquivo > padrão do código', async () => {
  const p = (c) => c.player.proximoEpisodio.segundosDeContagem;
  const base = exemplo();
  delete base.player.proximoEpisodio.segundosDeContagem;
  const soPadrao = await obterConfig(kvCom(null), { arquivo: base, semCache: true });
  assert.equal(p(soPadrao), 8, 'padrão do schema');

  const comArquivo = com((c) => { c.player.proximoEpisodio.segundosDeContagem = 12; });
  const doArquivo = await obterConfig(kvCom(null), { arquivo: comArquivo, semCache: true });
  assert.equal(p(doArquivo), 12, 'o arquivo ganha do padrão');

  const doKv = await obterConfig(kvCom(JSON.stringify({ player: { proximoEpisodio: { segundosDeContagem: 20 } } })),
    { arquivo: comArquivo, semCache: true });
  assert.equal(p(doKv), 20, 'o KV ganha do arquivo');
  assert.equal(doKv.player.proximoEpisodio.modo, 'nunca', 'o KV parcial não apaga o resto do arquivo');
  assert.equal(doKv._estado.operacaoAplicada, true);
});

test('KV só mexe em home, textos, player e recursos; o resto é ignorado com aviso', async () => {
  const kv = kvCom({ acesso: { modo: 'publico' }, video: { provedor: 'hls-generico' }, textos: { 'pt-BR': { rodape: 'Do KV' } } });
  const c = await obterConfig(kv, { arquivo: com((x) => { x.acesso.modo = 'privado'; }), semCache: true });
  assert.equal(c.acesso.modo, 'privado', 'a operação não abre o acesso');
  assert.equal(c.video.provedor, 'bunny');
  assert.equal(c.textos['pt-BR'].rodape, 'Do KV');
  assert.ok(c._estado.avisos.some((a) => /acesso, video/.test(a)));
});

test('KV inválido ou fora do ar é descartado (aviso), sem trancar quem lê o arquivo bom', async () => {
  const ruim = await obterConfig(kvCom({ player: { autoplay: { modo: 'sempre' } } }), { arquivo: exemplo(), semCache: true });
  assert.equal(ruim.player.autoplay.modo, 'nunca');
  assert.equal(ruim._estado.valido, true);
  assert.ok(ruim._estado.avisos.length === 1);
  const torto = await obterConfig(kvCom('{não é json'), { arquivo: exemplo(), semCache: true });
  assert.equal(torto._estado.valido, true);
  assert.ok(torto._estado.avisos.length === 1);
  const fora = await obterConfig(kvCom(null, true), { arquivo: exemplo(), semCache: true });
  assert.equal(fora._estado.valido, true);
  assert.match(fora._estado.avisos[0], /KV/);
});

test('cache por isolate com TTL curto', async () => {
  let leituras = 0;
  const env = { CATALOGO: { get: async () => { leituras++; return null; } } };
  const t0 = 1_000_000;
  const a = await obterConfig(env, { arquivo: exemplo(), agora: t0 });
  const b = await obterConfig(env, { arquivo: exemplo(), agora: t0 + TTL_MS - 1 });
  assert.equal(a, b);
  assert.equal(leituras, 1);
  await obterConfig(env, { arquivo: exemplo(), agora: t0 + TTL_MS + 1 });
  assert.equal(leituras, 2);
});

test('montarConfig não lança com lixo', () => {
  for (const lixo of [undefined, null, 5, [], 'x']) {
    const c = montarConfig(schema, lixo);
    assert.equal(c.acesso.modo, 'privado');
  }
});

test('resolverSegredo só lê {"$env"} do ambiente', () => {
  assert.equal(resolverSegredo({ $env: 'X_Y' }, { X_Y: 'valor' }), 'valor');
  assert.equal(resolverSegredo('literal', { literal: 'v' }), undefined);
  assert.equal(resolverSegredo({ $env: 'AUSENTE' }, {}), undefined);
});

/* ---------------------------------------------------------------- aplicar-config */

function raizTemporaria(mudarConfig) {
  const raiz = mkdtempSync(path.join(tmpdir(), 'tm-config-'));
  mkdirSync(path.join(raiz, 'config'));
  mkdirSync(path.join(raiz, 'core', 'site'), { recursive: true });
  cpSync(path.join(RAIZ, 'config/site.schema.json'), path.join(raiz, 'config/site.schema.json'));
  for (const f of ['index.html', 'admin.html']) cpSync(path.join(RAIZ, 'core/site', f), path.join(raiz, 'core/site', f));
  const c = exemplo();
  if (mudarConfig) mudarConfig(c);
  writeFileSync(path.join(raiz, 'config/site.json'), JSON.stringify(c, null, 2));
  return raiz;
}
const lerSite = (raiz, f) => ler(path.join(raiz, 'core/site', f), 'utf8');

test('aplicar-config: idempotente (rodar 2x dá diff vazio)', async () => {
  const raiz = raizTemporaria((c) => { c.marca.nome = 'Outra "Marca" <b>'; c.acesso.modo = 'privado'; });
  const um = await aplicarConfig({ raiz });
  assert.equal(um.ok, true, JSON.stringify(um.erros));
  assert.ok(um.alterados.length >= 4);
  const antes = ['index.html', 'admin.html', 'theme.css', 'manifest.webmanifest', 'robots.txt', 'config.public.json'].map((f) => lerSite(raiz, f));
  const dois = await aplicarConfig({ raiz });
  assert.deepEqual(dois.alterados, []);
  const depois = ['index.html', 'admin.html', 'theme.css', 'manifest.webmanifest', 'robots.txt', 'config.public.json'].map((f) => lerSite(raiz, f));
  assert.deepEqual(depois, antes);
  const verifica = await aplicarConfig({ raiz, verificar: true });
  assert.deepEqual(verifica.alterados, []);
});

test('aplicar-config: o repositório está em dia com o config/site.json', async () => {
  const r = await aplicarConfig({ raiz: RAIZ, verificar: true });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.deepEqual(r.alterados, [], 'rode: node scripts/aplicar-config.mjs');
});

test('aplicar-config: escapa a marca no HTML e põe nome, cores e manifest', async () => {
  const raiz = raizTemporaria((c) => { c.marca.nome = 'A&B "C" <i>'; c.marca.nomeCurto = 'AB'; c.tema.cores = { escuro: { marca: '#FFAA00' } }; });
  await aplicarConfig({ raiz });
  const html = lerSite(raiz, 'index.html');
  assert.ok(html.includes('<title>A&amp;B &quot;C&quot; &lt;i&gt; — catálogo</title>'));
  assert.ok(!html.includes('<i> —'));
  assert.ok(html.includes('<!-- config:inicio -->') && html.includes('<!-- config:fim -->'));
  assert.ok(html.includes('<meta property="og:image" content="og-image.png">'), 'o Worker procura esta linha');
  assert.match(lerSite(raiz, 'theme.css'), /--marca: #ffaa00;/);
  const m = JSON.parse(lerSite(raiz, 'manifest.webmanifest'));
  assert.equal(m.short_name, 'AB');
  assert.equal(m.name, 'A&B "C" <i>');
  assert.match(lerSite(raiz, 'admin.html'), /<title>Mesa de Curadoria — A&amp;B/);
});

test('aplicar-config: robots e meta seguem o modo de acesso e seo.indexavel', async () => {
  const casos = [
    ['publico', true, true], ['publico', false, false], ['privado', true, false], ['cadastro', true, false]
  ];
  for (const [modo, indexavel, esperaAberto] of casos) {
    const raiz = raizTemporaria((c) => {
      c.acesso.modo = modo;
      if (modo === 'cadastro') c.acesso.cadastro = { turnstile: true };
      c.seo = { indexavel };
    });
    const r = await aplicarConfig({ raiz });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    const robots = lerSite(raiz, 'robots.txt');
    assert.equal(/Disallow: \/\n/.test(robots), !esperaAberto, `${modo}/${indexavel}`);
    assert.equal(/content="index, follow"/.test(lerSite(raiz, 'index.html')), esperaAberto);
    assert.match(lerSite(raiz, 'admin.html'), /noindex/);
  }
});

test('aplicar-config: config inválida não escreve nada e reporta', async () => {
  const raiz = raizTemporaria((c) => { c.video.bunny.chaveApi = 'chave-em-texto'; });
  const htmlAntes = lerSite(raiz, 'index.html');
  const r = await aplicarConfig({ raiz });
  assert.equal(r.ok, false);
  assert.equal(lerSite(raiz, 'index.html'), htmlAntes);
  assert.throws(() => lerSite(raiz, 'theme.css'));
});

test('config.public.json: sem segredos nem $env, e só o que o navegador pode ver', async () => {
  const r = await validarConfig(schema, exemplo());
  const pub = gerarPublico(r.config);
  assert.ok(!pub.includes('$env'));
  assert.ok(!/bunny|chaveApi|BUNNY/i.test(pub));
  const j = JSON.parse(pub);
  assert.equal(j.acesso.modo, 'publico');
  assert.deepEqual(Object.keys(j.acesso), ['modo']);
  for (const proibida of ['video', 'ia', 'mcp', 'implantacao', 'player', 'home']) assert.ok(!(proibida in j), proibida);
  assert.equal(gerarRobots(r.config), 'User-agent: *\nDisallow: /\n');
});

test('validar-config: sai com 0 no exemplo e com 1 num arquivo ruim, com mensagem clara', async () => {
  const saida = (acc) => ({ log: (t) => acc.push(t), error: (t) => acc.push(t) });
  const ok = []; assert.equal(await validarPrincipal([], saida(ok)), 0);
  assert.match(ok.join('\n'), /Configuração válida/);
  const raiz = raizTemporaria((c) => { c.tema.cores = { escuro: { marca: 'azul' } }; });
  const ruim = []; assert.equal(await validarPrincipal([path.join(raiz, 'config/site.json')], saida(ruim)), 1);
  assert.match(ruim.join('\n'), /tema\.cores\.escuro\.marca/);
  const sumiu = []; assert.equal(await validarPrincipal([path.join(raiz, 'nao-existe.json')], saida(sumiu)), 1);
  assert.match(sumiu.join('\n'), /não encontrei/);
});
