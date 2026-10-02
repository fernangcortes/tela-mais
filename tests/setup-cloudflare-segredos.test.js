// setup.mjs: cloudflare, segredo, video e deploy. O que mais importa aqui: nenhum valor de segredo aparece em
// saída, em argumento de comando ou em arquivo versionado; e tudo é idempotente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { criarProjeto, rodar, criarMundo, criarPerguntas, criarFetch, lerSiteJson, lerArq, nadaVazou, CABECALHOS_SEGUROS } from './setup-falso.js';

const CHAVE_BUNNY = 'bk_9f8e7d6c5b4a3210fedcba9876543210';
const BIBLIOTECA = '123456';

test('cloudflare: sem login sai 3 e manda rodar o wrangler login; nunca pede token', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['cloudflare', '--json'], { raiz, mundo: criarMundo({ logado: false }) });
  assert.equal(r.codigo, 3);
  assert.equal(r.json.pendencias[0].codigo, 'cloudflare-sem-login');
  assert.match(r.json.pendencias[0].comando, /wrangler login/);
  assert.ok(!/token de api|api token/i.test(r.tudo.replace(/CLOUDFLARE_API_TOKEN/g, '')));
});

test('cloudflare: cria KV e D1, grava os ids no wrangler.jsonc e a segunda rodada não cria nada', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo();
  const a = await rodar(['cloudflare', '--json'], { raiz, mundo });
  assert.equal(a.codigo, 0, a.tudo);
  const w = lerArq(raiz, 'wrangler.jsonc');
  assert.match(w, new RegExp(`"binding": "CATALOGO", "id": "${mundo.kv[0].id}"`));
  assert.match(w, new RegExp(`"database_id": "${mundo.d1[0].uuid}"`));
  assert.match(w, /^\/\/ wrangler\.jsonc/m);
  const criacoes = () => mundo.chamadas.filter((c) => c.args.includes('create')).length;
  assert.equal(criacoes(), 2);
  const b = await rodar(['cloudflare', '--json'], { raiz, mundo });
  assert.equal(b.codigo, 0);
  assert.equal(criacoes(), 2);
  assert.ok(b.json.acoes.filter((x) => ['kv', 'd1'].includes(x.id)).every((x) => x.estado === 'ja-estava'));
});

test('cloudflare: reaproveita KV e D1 que já existem com o mesmo nome (instalação refeita)', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ kv: [{ id: 'f'.repeat(32), title: 'plataforma-exemplo-catalogo' }], d1: [{ uuid: '00000000-0000-4000-8000-000000000001', name: 'plataforma-exemplo' }] });
  const r = await rodar(['cloudflare'], { raiz, mundo });
  assert.equal(r.codigo, 0, r.tudo);
  assert.equal(mundo.chamadas.filter((c) => c.args.includes('create')).length, 0);
  assert.match(lerArq(raiz, 'wrangler.jsonc'), /f{32}/);
});

test('cloudflare: várias contas pedem --conta; token global no ambiente gera aviso; verificar não cria nada', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ contas: [{ id: 'a'.repeat(32), name: 'A' }, { id: 'b'.repeat(32), name: 'B' }] });
  const r = await rodar(['cloudflare', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 3);
  assert.equal(r.json.pendencias[0].codigo, 'cloudflare-varias-contas');
  const ok = await rodar(['cloudflare', '--conta', 'b'.repeat(32), '--json'], { raiz, mundo, env: { CLOUDFLARE_API_TOKEN: 'tokenzao-que-nao-pode-aparecer-123456' } });
  assert.equal(ok.codigo, 0, ok.tudo);
  assert.ok(ok.json.mensagens.some((m) => /CLOUDFLARE_API_TOKEN/.test(m)));
  assert.ok(nadaVazou(ok, 'tokenzao-que-nao-pode-aparecer-123456'));
  const m2 = criarMundo();
  const v = await rodar(['cloudflare', 'verificar', '--json'], { raiz: criarProjeto(), mundo: m2 });
  assert.equal(m2.chamadas.filter((c) => c.args.includes('create')).length, 0);
  assert.equal(v.codigo, 0);
});

test('cloudflare --dry-run: lê mas não cria nem grava', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo();
  const antes = lerArq(raiz, 'wrangler.jsonc');
  const r = await rodar(['cloudflare', '--dry-run', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 0);
  assert.equal(lerArq(raiz, 'wrangler.jsonc'), antes);
  assert.equal(mundo.kv.length + mundo.d1.length, 0);
  assert.ok(r.json.acoes.some((a) => a.estado === 'simulado'));
});

test('segredo: o valor digitado vai por stdin do wrangler, nunca em argumento, e a saída sai mascarada', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ worker: true });
  const valor = 'MinhaSenhaForte-2026-Zeta-9876';
  const perguntas = criarPerguntas({ senha: [valor, valor] });
  const r = await rodar(['segredo', 'ADMIN_PASSWORD', '--json'], { raiz, mundo, perguntas });
  assert.equal(r.codigo, 0, r.tudo);
  assert.equal(mundo.segredos.get('ADMIN_PASSWORD'), valor);
  const put = mundo.chamadas.find((c) => c.args.includes('put'));
  assert.equal(put.input, valor + '\n');
  assert.ok(nadaVazou(r, valor));
  assert.equal(r.json.dados.segredo.valor, '****9876');
  assert.deepEqual(perguntas.feitas.map((f) => f[0]), ['senha', 'senha'], 'pediu e confirmou por prompt oculto');
});

test('segredo: valor na linha de comando é recusado (saída 2) sem repetir o valor', async () => {
  const raiz = criarProjeto();
  const valor = 'senha-que-nao-deveria-estar-aqui-1';
  for (const argv of [['segredo', 'ADMIN_PASSWORD', valor], ['segredo', 'ADMIN_PASSWORD', '--valor', valor], ['segredo', 'ADMIN_PASSWORD', `--senha=${valor}`]]) {
    const r = await rodar(argv, { raiz });
    assert.equal(r.codigo, 2, argv.join(' '));
    assert.ok(!r.tudo.includes(valor));
  }
});

test('segredo: sem terminal sai 3 e manda a PESSOA rodar o comando (o agente não pede segredo no chat)', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['segredo', 'BUNNY_API_KEY', '--json'], { raiz });
  assert.equal(r.codigo, 3);
  assert.equal(r.json.pendencias[0].codigo, 'segredo-precisa-terminal');
  assert.equal(r.json.pendencias[0].comando, 'node scripts/setup.mjs segredo BUNNY_API_KEY');
});

test('segredo --gerar: SESSION_SECRET é gerado, não aparece em lugar nenhum e a segunda vez é "já estava"', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ worker: true });
  const a = await rodar(['segredo', 'SESSION_SECRET', '--gerar', '--json'], { raiz, mundo });
  assert.equal(a.codigo, 0, a.tudo);
  const gerado = mundo.segredos.get('SESSION_SECRET');
  assert.ok(gerado.length >= 32);
  assert.ok(nadaVazou(a, gerado));
  assert.equal(a.json.dados.segredo.valor, '(gerado, não exibido)');
  const b = await rodar(['segredo', 'SESSION_SECRET', '--gerar', '--json'], { raiz, mundo });
  assert.equal(b.json.acoes[0].estado, 'ja-estava');
  assert.equal(mundo.segredos.get('SESSION_SECRET'), gerado, 'não trocou (trocar desloga todo mundo)');
  const c = await rodar(['segredo', 'SESSION_SECRET', '--gerar', '--forcar', '--json'], { raiz, mundo });
  assert.notEqual(mundo.segredos.get('SESSION_SECRET'), gerado);
  assert.equal(c.codigo, 0);
});

test('segredo: valida nome, tamanho e opções incompatíveis', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ worker: true });
  assert.equal((await rodar(['segredo', 'minusculo'], { raiz, mundo })).codigo, 2);
  assert.equal((await rodar(['segredo'], { raiz, mundo })).codigo, 2);
  assert.equal((await rodar(['segredo', 'ADMIN_PASSWORD', '--gerar'], { raiz, mundo })).codigo, 2);
  assert.equal((await rodar(['segredo', 'X_Y_Z', '--gerar', '--stdin'], { raiz, mundo, stdin: 'a' })).codigo, 2);
  assert.equal((await rodar(['segredo', 'ADMIN_PASSWORD', '--destino', 'nuvem'], { raiz, mundo })).codigo, 2);
  const curta = await rodar(['segredo', 'ADMIN_PASSWORD', '--stdin'], { raiz, mundo, stdin: 'curta' });
  assert.equal(curta.codigo, 1);
  assert.ok(!mundo.segredos.has('ADMIN_PASSWORD'));
  const dif = await rodar(['segredo', 'ADMIN_PASSWORD'], { raiz, mundo, perguntas: criarPerguntas({ senha: ['uma-senha-bem-longa-1', 'outra-senha-bem-longa-2'] }) });
  assert.equal(dif.codigo, 1);
  assert.ok(!mundo.segredos.has('ADMIN_PASSWORD'));
});

test('segredo --destino env: grava no .env com permissão 600 e garante o .gitignore', async () => {
  const raiz = criarProjeto();
  const valor = 'chave-local-0123456789-abcdef-XYZ';
  const r = await rodar(['segredo', 'ANTHROPIC_API_KEY', '--stdin', '--destino', 'env,dev-vars', '--json'], { raiz, stdin: valor });
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(lerArq(raiz, '.env'), new RegExp(`^ANTHROPIC_API_KEY=${valor}$`, 'm'));
  assert.match(lerArq(raiz, '.dev.vars'), /ANTHROPIC_API_KEY=/);
  if (process.platform !== 'win32') assert.equal(statSync(path.join(raiz, '.env')).mode & 0o777, 0o600);
  assert.match(lerArq(raiz, '.gitignore'), /^\.env$/m);
  assert.ok(nadaVazou(r, valor));
  const de = await rodar(['segredo', 'ANTHROPIC_API_KEY', '--stdin', '--destino', 'env', '--json'], { raiz, stdin: valor });
  assert.equal(de.json.acoes.at(-1).estado, 'ja-estava');
  assert.equal(lerArq(raiz, '.env').match(/ANTHROPIC_API_KEY/g).length, 1, 'não duplica a linha');
});

test('segredo --dry-run: não pergunta nem guarda', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ worker: true });
  const r = await rodar(['segredo', 'ADMIN_PASSWORD', '--dry-run', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 0);
  assert.equal(mundo.segredos.size, 0);
  assert.equal(r.json.acoes[0].estado, 'simulado');
});

test('video: sem credenciais e sem terminal sai 3 listando só os NOMES; nada é gravado', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['video', '--provedor', 'bunny', '--json'], { raiz });
  assert.equal(r.codigo, 3);
  assert.deepEqual(r.json.dados.detalhes.faltando, ['BUNNY_LIBRARY_ID', 'BUNNY_API_KEY']);
  assert.ok(!existsSync(path.join(raiz, '.env')));
});

test('video: credenciais por prompt oculto vão para o .env, são testadas com o adaptador e nunca aparecem', async () => {
  const raiz = criarProjeto();
  const perguntas = criarPerguntas({ texto: [BIBLIOTECA], senha: [CHAVE_BUNNY] });
  const fetch = criarFetch({ '/videos': { status: 200, corpo: { items: [] } } }, {});
  const r = await rodar(['video', '--provedor', 'bunny', '--json'], { raiz, perguntas, fetch });
  assert.equal(r.codigo, 0, r.tudo);
  assert.match(lerArq(raiz, '.env'), new RegExp(`^BUNNY_API_KEY=${CHAVE_BUNNY}$`, 'm'));
  assert.ok(nadaVazou(r, CHAVE_BUNNY));
  assert.ok(!lerArq(raiz, 'config/site.json').includes(CHAVE_BUNNY), 'segredo fora do arquivo versionado');
  assert.ok(fetch.chamadas.length >= 1, 'chamou o provedor (falso) para validar');
  assert.ok(r.json.acoes.some((a) => a.id === 'teste' && a.estado === 'feito'));
  assert.deepEqual(perguntas.feitas.map((f) => f[0]), ['texto', 'senha'], 'o número da biblioteca é digitado à vista; só a chave é escondida');
  const de = await rodar(['video', '--provedor', 'bunny', '--json'], { raiz, perguntas: criarPerguntas(), fetch });
  assert.equal(de.codigo, 0, 'segunda vez: as chaves já estão lá, não pergunta de novo');
  assert.ok(de.json.acoes.some((a) => a.estado === 'ja-estava' && a.id.startsWith('cred:')));
});

test('video: chave recusada pelo provedor sai 1 com mensagem em português e sem vazar a chave', async () => {
  const raiz = criarProjeto();
  const fetch = criarFetch({ '/videos': { status: 401, corpo: {} } });
  const r = await rodar(['video', '--provedor', 'bunny', '--json'], { raiz, perguntas: criarPerguntas({ texto: [BIBLIOTECA], senha: [CHAVE_BUNNY] }), fetch });
  assert.equal(r.codigo, 1);
  assert.equal(r.json.acoes.at(-1).id, 'credenciais-recusadas');
  assert.ok(nadaVazou(r, CHAVE_BUNNY));
});

test('video: com variáveis já no ambiente não pergunta; modo restrito também pede a chave de assinatura', async () => {
  const raiz = criarProjeto();
  await rodar(['acesso', '--modo', 'privado'], { raiz });
  const fetch = criarFetch({ '/videos': { status: 200, corpo: { items: [] } } });
  const env = { BUNNY_LIBRARY_ID: BIBLIOTECA, BUNNY_API_KEY: CHAVE_BUNNY };
  const sem = await rodar(['video', '--json'], { raiz, fetch, env });
  assert.equal(sem.codigo, 3, 'privado: faltam as duas peças da assinatura');
  assert.deepEqual(sem.json.dados.detalhes.faltando, ['BUNNY_PULLZONE', 'BUNNY_TOKEN_KEY'], 'a mesma lista que o doctor exige');
  assert.deepEqual(sem.json.dados.detalhes.naoSecretas, ['BUNNY_PULLZONE'], 'o endereço de entrega não é senha');
  assert.ok(sem.json.dados.detalhes.ondeAchar.BUNNY_TOKEN_KEY, 'diz onde achar cada chave');
  assert.equal(sem.json.pendencias[0].quem, 'pessoa');
  const ok = await rodar(['video', '--json'], { raiz, fetch, env: { ...env, BUNNY_PULLZONE: 'vz-abc123-xyz.b-cdn.net', BUNNY_TOKEN_KEY: 'token-key-0123456789abcdef' } });
  assert.equal(ok.codigo, 0, ok.tudo);
});

test('video: --enviar-segredos manda as chaves ao Worker por stdin; hls-generico pede o endereço base', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ worker: true });
  const fetch = criarFetch({ '/videos': { status: 200, corpo: { items: [] } } });
  const r = await rodar(['video', '--enviar-segredos', '--json'], { raiz, mundo, fetch, env: { BUNNY_LIBRARY_ID: BIBLIOTECA, BUNNY_API_KEY: CHAVE_BUNNY } });
  assert.equal(r.codigo, 0, r.tudo);
  assert.equal(mundo.segredos.get('BUNNY_API_KEY'), CHAVE_BUNNY);
  assert.ok(nadaVazou(r, CHAVE_BUNNY));
  const h = await rodar(['video', '--provedor', 'hls-generico', '--json'], { raiz: criarProjeto() });
  assert.equal(h.codigo, 3);
  assert.equal(h.json.pendencias[0].codigo, 'falta-base-url');
  assert.equal((await rodar(['video', '--provedor', 'hls-generico', '--base-url', 'http://inseguro.test/x'], { raiz: criarProjeto() })).codigo, 2);
});

/* ------------------------------------------------------------------ deploy */

function projetoPronto() {
  return criarProjeto();
}
const siteNoAr = (extra = {}) => criarFetch({
  '/': { status: 200, corpo: '<html></html>', cabecalhos: CABECALHOS_SEGUROS },
  '/api/catalogo': { status: 200, corpo: { itens: [] } },
  '/robots.txt': { status: 200, corpo: 'User-agent: *\nDisallow: /\n' },
  ...extra
});

test('deploy: o doctor com erro bloqueia a publicação (nada é publicado)', async () => {
  const raiz = projetoPronto();
  const mundo = criarMundo({ logado: false });
  const r = await rodar(['deploy', '--yes', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 1);
  assert.ok(!mundo.chamadas.some((c) => c.args.includes('deploy')));
  assert.ok(r.json.checagens.some((c) => c.status === 'erro'));
});

test('deploy: sem --yes e sem terminal sai 3 pedindo a autorização; com terminal pergunta', async () => {
  const raiz = projetoPronto();
  const mundo = criarMundo();
  await rodar(['init', '--nome', 'Rede Sol', '--preset', 'criador', '--cloudflare'], { raiz, mundo });
  const r = await rodar(['deploy', '--sem-testes', '--json'], { raiz, mundo, env: { BUNNY_LIBRARY_ID: BIBLIOTECA, BUNNY_API_KEY: CHAVE_BUNNY }, fetch: criarFetch({ '/videos': { status: 200, corpo: {} } }) });
  assert.equal(r.codigo, 3, r.tudo);
  assert.equal(r.json.pendencias[0].codigo, 'autorizar-deploy');
  assert.ok(!mundo.chamadas.some((c) => c.args.includes('deploy')));
  const nao = await rodar(['deploy', '--sem-testes'], { raiz, mundo, env: { BUNNY_LIBRARY_ID: BIBLIOTECA, BUNNY_API_KEY: CHAVE_BUNNY }, fetch: criarFetch({ '/videos': { status: 200, corpo: {} } }), perguntas: criarPerguntas({ confirmar: [false] }) });
  assert.equal(nao.codigo, 3);
  assert.ok(!mundo.chamadas.some((c) => c.args.includes('deploy')), 'a pessoa disse não');
});

test('deploy --dry-run: mostra o plano e não publica', async () => {
  const raiz = projetoPronto();
  const mundo = criarMundo();
  await rodar(['init', '--nome', 'Rede Sol', '--preset', 'criador', '--cloudflare'], { raiz, mundo });
  const r = await rodar(['deploy', '--dry-run', '--json'], { raiz, mundo, env: { BUNNY_LIBRARY_ID: BIBLIOTECA, BUNNY_API_KEY: CHAVE_BUNNY }, fetch: criarFetch({ '/videos': { status: 200, corpo: {} } }) });
  assert.equal(r.codigo, 0, r.tudo);
  assert.ok(r.json.acoes.some((a) => a.id === 'deploy' && a.estado === 'simulado'));
  assert.ok(!mundo.chamadas.some((c) => c.args.includes('deploy')));
  assert.ok(!mundo.chamadas.some((c) => c.cmd === 'npm'));
});

test('deploy --yes: valida, roda os testes, publica, cria SESSION_SECRET, testa o site e pede a senha do admin', async () => {
  const raiz = projetoPronto();
  const mundo = criarMundo({ worker: false, secretCriaWorker: false });
  await rodar(['init', '--nome', 'Rede Sol', '--preset', 'criador', '--cloudflare'], { raiz, mundo });
  const env = { BUNNY_LIBRARY_ID: BIBLIOTECA, BUNNY_API_KEY: CHAVE_BUNNY };
  const fetch = siteNoAr({ '/videos': { status: 200, corpo: {} } });
  const r = await rodar(['deploy', '--yes', '--com-testes', '--json'], { raiz, mundo, env, fetch });
  assert.equal(r.codigo, 3, r.tudo);   /* publicou, mas falta a senha do administrador */
  const ordem = mundo.chamadas.map((c) => (c.cmd === 'npm' ? 'npm-test' : c.args.includes('deploy') ? 'deploy' : c.args.includes('put') ? 'segredo' : null)).filter(Boolean);
  assert.deepEqual(ordem, ['npm-test', 'deploy', 'segredo']);
  assert.ok(mundo.segredos.has('SESSION_SECRET'));
  assert.equal(r.json.pendencias[0].codigo, 'admin-sem-senha');
  assert.match(r.json.pendencias[0].comando, /segredo ADMIN_PASSWORD/);
  assert.equal(r.json.dados.url, 'https://minha-tela.sub.workers.dev');
  assert.ok(existsSync(path.join(raiz, '.wrangler/tela-mais-deploy.json')));
  assert.ok(r.json.checagens.some((c) => c.grupo === 'remoto' && c.id === 'remoto.home' && c.status === 'ok'));
  assert.ok(nadaVazou(r, CHAVE_BUNNY));
  const dados = lerSiteJson(raiz);
  assert.equal(dados.acesso.modo, 'publico');
});

test('deploy: testes que falham impedem a publicação', async () => {
  const raiz = projetoPronto();
  const mundo = criarMundo({ testesPassam: false });
  await rodar(['init', '--nome', 'Rede Sol', '--preset', 'criador', '--cloudflare'], { raiz, mundo });
  const r = await rodar(['deploy', '--yes', '--com-testes', '--json'], { raiz, mundo, env: { BUNNY_LIBRARY_ID: BIBLIOTECA, BUNNY_API_KEY: CHAVE_BUNNY }, fetch: criarFetch({ '/videos': { status: 200, corpo: {} } }) });
  assert.equal(r.codigo, 1);
  assert.equal(r.json.acoes.at(-1).id, 'testes-falharam');
  assert.ok(!mundo.chamadas.some((c) => c.args.includes('deploy')));
});

test('deploy no modo privado: se o site publicado abre o catálogo sem login, sai 1 (e manda não divulgar)', async () => {
  const raiz = projetoPronto();
  const mundo = criarMundo({ worker: true });
  await rodar(['init', '--nome', 'Empresa Alfa', '--preset', 'empresa', '--cloudflare'], { raiz, mundo });
  await rodar(['segredo', 'ADMIN_PASSWORD', '--stdin'], { raiz, mundo, stdin: 'senha-administrador-longa-1' });
  const env = { BUNNY_LIBRARY_ID: BIBLIOTECA, BUNNY_API_KEY: CHAVE_BUNNY, BUNNY_TOKEN_KEY: 'token-key-0123456789abcdef', BUNNY_PULLZONE: 'vz-a.b-cdn.net' };
  const fetch = siteNoAr({ '/videos': { status: 200, corpo: {} } });   /* /api/catalogo responde 200 anônimo: vazamento */
  const r = await rodar(['deploy', '--yes', '--json'], { raiz, mundo, env, fetch });
  assert.equal(r.codigo, 1, r.tudo);
  assert.ok(r.json.checagens.some((c) => c.id === 'remoto.catalogo' && c.status === 'erro'));
  assert.match(r.json.proximoPasso, /NÃO divulgue/);
});

test('segredo: chave colada no lugar do NOME nunca é repetida (texto e JSON)', async () => {
  const raiz = criarProjeto();
  for (const valor of ['ZZSEGREDOFALSO987654321', 'zz-segredo-falso-minusculo-987', 'ZZ_SEGREDO_FALSO_987654321']) {
    for (const extra of [[], ['--json'], ['--stdin'], ['--stdin', '--json'], ['--dry-run', '--json']]) {
      const r = await rodar(['segredo', valor, ...extra], { raiz, stdin: 'valor-qualquer-bem-longo-1' });
      assert.ok(!r.tudo.includes(valor), `vazou (${valor}) em: ${extra.join(" ")}\n${r.tudo}`);
      if (r.json) assert.ok(!JSON.stringify(r.json).includes(valor));
    }
  }
});
