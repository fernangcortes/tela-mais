// Correções do ensaio com agente novato (M7): o deploy não quebra num site personalizado, os resumos não mentem,
// pendências dizem QUEM age, mudar a cor da marca pede o "sim", dry-runs não fingem, listas de chaves batem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarProjeto, rodar, criarMundo, criarPerguntas, criarFetch, lerSiteJson, lerArq, existe, CABECALHOS_SEGUROS } from './setup-falso.js';

const CHAVE = 'bk_9f8e7d6c5b4a3210fedcba9876543210';
const BIB = '123456';
const env = { BUNNY_LIBRARY_ID: BIB, BUNNY_API_KEY: CHAVE };
const noAr = () => criarFetch({
  '/': { status: 200, corpo: '<html></html>', cabecalhos: CABECALHOS_SEGUROS },
  '/api/catalogo': { status: 200, corpo: { itens: [] } },
  '/robots.txt': { status: 200, corpo: 'User-agent: *\nDisallow: /\n' },
  '/videos': { status: 200, corpo: {} }
});
const npmChamado = (m) => m.chamadas.some((c) => c.cmd === 'npm');

test('deploy: num site personalizado os testes do produto NÃO rodam (nem bloqueiam); --com-testes os força', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ testesPassam: false });   /* se rodassem, falhariam */
  await rodar(['init', '--nome', 'Escola Som & Arte', '--preset', 'escola', '--acesso', 'publico', '--cloudflare'], { raiz, mundo });
  const r = await rodar(['deploy', '--yes', '--json'], { raiz, mundo, env, fetch: noAr() });
  assert.notEqual(r.json.acoes.at(-1)?.id, 'testes-falharam', r.tudo);
  assert.ok(!npmChamado(mundo), 'não rodou npm test');
  const t = r.json.acoes.find((a) => a.id === 'testes');
  assert.equal(t.estado, 'pulado');
  assert.match(t.descricao, /marca/);
  assert.ok(mundo.chamadas.some((c) => c.args.includes('deploy')), 'publicou');
  const forcado = await rodar(['deploy', '--yes', '--com-testes', '--json'], { raiz, mundo, env, fetch: noAr() });
  assert.equal(forcado.json.acoes.at(-1).id, 'testes-falharam');
});

test('deploy: no repositório do produto (marca neutra) os testes continuam rodando', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo();
  const r = await rodar(['deploy', '--dry-run', '--json'], { raiz, mundo, env, fetch: noAr() });
  assert.ok(r.json.acoes.some((a) => a.id === 'testes' && a.estado === 'simulado'));
});

test('deploy --dry-run: com problemas no doctor ainda mostra o plano, lista o que impede e sai 1', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ logado: false });
  const r = await rodar(['deploy', '--dry-run', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 1);
  const ids = r.json.acoes.map((a) => a.id);
  for (const id of ['doctor', 'aplicar-config', 'testes', 'deploy', 'segredos', 'doctor-remoto']) assert.ok(ids.includes(id), `plano tem ${id}`);
  assert.ok(r.json.dados.bloqueios.length > 0 && r.json.dados.bloqueios[0].mensagem);
  assert.match(r.json.resumo, /NÃO rodaria hoje/);
  assert.ok(!mundo.chamadas.some((c) => c.args.includes('deploy')));
});

test('resumo honesto: status conta as etapas, simulação e falha não dizem "Tudo certo."', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ logado: false });
  const s = await rodar(['status', '--json'], { raiz, mundo });
  assert.doesNotMatch(s.json.resumo, /Tudo certo/);
  assert.match(s.json.resumo, /\d+ de \d+ etapas prontas/);
  const ids = s.json.dados.etapas.map((e) => `${e.numero}:${e.id}`);
  assert.deepEqual(ids, ['0:ambiente', '1:identidade', '2:acesso', '3:cloudflare', '4:recursos', '5:video', '6:segredos', '7:publicacao', '8:primeiro-video', '9:opcionais'], 'a numeração é a do roteiro do AGENTS.md');
  const d = await rodar(['marca', '--nome', 'Rede Sol', '--dry-run', '--json'], { raiz });
  assert.match(d.json.resumo, /Simulação concluída/);
  const nada = await rodar(['marca', '--json'], { raiz });
  assert.doesNotMatch(nada.json.resumo, /Tudo certo/);
  const ruim = await rodar(['acesso', '--modo', 'aberto', '--json'], { raiz });
  assert.doesNotMatch(ruim.json.resumo, /Tudo certo/);
});

test('pendências dizem QUEM age: o agente pergunta (init, autorização, cor) e a pessoa digita (segredo, login)', async () => {
  const raiz = criarProjeto();
  const init = await rodar(['init', '--json'], { raiz });
  assert.equal(init.codigo, 3);
  assert.equal(init.json.pendencias[0].quem, 'agente');
  const texto = await rodar(['init'], { raiz });
  assert.match(texto.out, /Agente: pergunte à pessoa/);
  assert.doesNotMatch(texto.out, /Rode no seu terminal/);

  const seg = await rodar(['segredo', 'ADMIN_PASSWORD', '--json'], { raiz });
  assert.equal(seg.codigo, 3);
  assert.equal(seg.json.pendencias[0].quem, 'pessoa');
  assert.match(seg.json.mensagens.join(' '), /segundo terminal/);
  assert.match(seg.json.mensagens.join(' '), /12 caracteres/, 'a regra da senha vem antes do prompt');
  const t2 = await rodar(['segredo', 'ADMIN_PASSWORD'], { raiz });
  assert.match(t2.out, /Ela precisa rodar, no terminal dela/);

  const login = await rodar(['cloudflare', 'verificar', '--json'], { raiz, mundo: criarMundo({ logado: false }) });
  assert.equal(login.json.pendencias[0].quem, 'pessoa');
  assert.match(login.json.mensagens.join(' '), /navegador não abrir|Se o navegador/);

  const mundo = criarMundo();
  const deploy = await rodar(['deploy', '--json'], { raiz: await prontoParaDeploy(mundo), mundo, env, fetch: noAr() });
  assert.equal(deploy.json.pendencias[0].codigo, 'autorizar-deploy');
  assert.equal(deploy.json.pendencias[0].quem, 'agente');
});

async function prontoParaDeploy(mundo) {
  const raiz = criarProjeto();
  await rodar(['init', '--nome', 'Rede Sol', '--preset', 'criador', '--acesso', 'publico', '--cloudflare'], { raiz, mundo });
  return raiz;
}

test('marca: a cor da pessoa não é trocada por contraste sem ela saber', async () => {
  const raiz = criarProjeto();
  const antes = lerArq(raiz, 'config/site.json');
  const sem = await rodar(['marca', '--cor', '#ffee00', '--json'], { raiz });
  assert.equal(sem.codigo, 3);
  assert.equal(sem.json.pendencias[0].codigo, 'cor-sem-contraste');
  assert.equal(sem.json.pendencias[0].quem, 'agente');
  assert.match(sem.json.pendencias[0].comando, /--yes/);
  assert.equal(lerArq(raiz, 'config/site.json'), antes, 'nada foi gravado');
  assert.ok(!existe(raiz, 'core/site/marca/icone-512.png'));

  const nao = await rodar(['marca', '--cor', '#ffee00'], { raiz, perguntas: criarPerguntas({ confirmar: [false] }) });
  assert.equal(nao.codigo, 3);
  assert.equal(lerArq(raiz, 'config/site.json'), antes);

  const sim = await rodar(['marca', '--cor', '#ffee00', '--json'], { raiz, perguntas: criarPerguntas({ confirmar: [true] }) });
  assert.equal(sim.codigo, 0, sim.tudo);
  assert.notEqual(lerSiteJson(raiz).tema.cores.claro.marca, '#ffee00');
});

test('marca: avisa que o logo e os ícones gerados são provisórios', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['marca', '--nome', 'Rede Sol', '--json'], { raiz });
  assert.match(r.json.mensagens.join(' '), /PROVISÓRIO/);
  assert.match(r.json.mensagens.join(' '), /--logo/);
});

test('video e doctor falam das MESMAS chaves; o endereço de entrega e o número da biblioteca não são pedidos às escuras', async () => {
  const raiz = criarProjeto();
  await rodar(['acesso', '--modo', 'privado'], { raiz });
  const d = await rodar(['doctor', '--only', 'video', '--json'], { raiz, mundo: criarMundo({ logado: false }) });
  const cred = d.json.checagens.find((c) => c.id === 'video.credenciais');
  assert.equal(cred.status, 'erro');
  for (const n of ['BUNNY_LIBRARY_ID', 'BUNNY_API_KEY', 'BUNNY_PULLZONE', 'BUNNY_TOKEN_KEY']) assert.ok(cred.mensagem.includes(n), `${n} na mensagem do doctor`);

  const perguntas = criarPerguntas({ texto: [BIB, 'vz-abc123-xyz.b-cdn.net'], senha: [CHAVE, 'token-key-0123456789abcdef'] });
  const r = await rodar(['video', '--provedor', 'bunny', '--sem-teste', '--json'], { raiz, perguntas });
  assert.equal(r.codigo, 0, r.tudo);
  assert.deepEqual(perguntas.feitas.map((f) => f[0]), ['texto', 'senha', 'texto', 'senha']);
  assert.match(r.json.mensagens.join(' '), /Library ID/);
});

test('cloudflare provisionar --dry-run sem login mostra o plano e o custo, sem criar nada', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ logado: false });
  const r = await rodar(['cloudflare', 'provisionar', '--dry-run', '--json'], { raiz, mundo });
  assert.equal(r.codigo, 3, 'ainda falta o login para valer');
  const ids = r.json.acoes.map((a) => a.id);
  assert.ok(ids.includes('kv') && ids.includes('d1') && ids.includes('session-secret'));
  assert.ok(r.json.acoes.filter((a) => a.id !== 'login').every((a) => a.estado === 'simulado'));
  assert.match(r.json.mensagens.join(' '), /Custo desta etapa: grátis/);
  assert.match(r.json.mensagens.join(' '), /vídeo é cobrado à parte/);
  assert.equal(mundo.kv.length + mundo.d1.length, 0);
});

test('segredo --dry-run: sem login não finge; sem Worker diz que ainda não dá', async () => {
  const raiz = criarProjeto();
  const sem = await rodar(['segredo', 'ADMIN_PASSWORD', '--dry-run', '--json'], { raiz, mundo: criarMundo({ logado: false }) });
  assert.equal(sem.codigo, 3);
  assert.ok(!sem.json.acoes.some((a) => a.estado === 'simulado'), 'nada de "guardaria" sem login');
  const semWorker = await rodar(['segredo', 'ADMIN_PASSWORD', '--dry-run', '--json'], { raiz, mundo: criarMundo({ worker: false }) });
  assert.equal(semWorker.json.acoes[0].estado, 'pendente');
  assert.match(semWorker.json.acoes[0].descricao, /primeira publicação/);
});

test('segredo com nome desconhecido não diz que guardou', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['segredo', 'SENHA_QUALQUER', '--json'], { raiz });
  assert.doesNotMatch(r.json.mensagens.join(' '), /guardei mesmo assim/);
});

test('acesso: explica na prática, lembra que nenhum modo impede gravar a tela e avisa do Turnstile no cadastro', async () => {
  const raiz = criarProjeto();
  const p = await rodar(['acesso', '--modo', 'privado', '--json'], { raiz });
  const m = p.json.mensagens.join(' ');
  assert.match(m, /gravar a tela/);
  assert.match(m, /copia o link de convite/);
  const c = await rodar(['acesso', '--modo', 'cadastro', '--json'], { raiz });
  assert.match(c.json.proximoPasso, /Turnstile/);
});

test('init: diz o que o modelo escolheu e quando o acesso pedido difere do sugerido', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['init', '--nome', 'Escola Som & Arte', '--preset', 'escola', '--acesso', 'privado', '--json'], { raiz });
  const m = r.json.mensagens.join(' ');
  assert.match(m, /O modelo ajustou o visual e os recursos/);
  assert.match(m, /sugeria "cadastro".*"privado"/);
});

test('doctor --only env não manda "depois de publicar"; o doctor completo aponta para o status', async () => {
  const raiz = criarProjeto();
  const e = await rodar(['doctor', '--only', 'env', '--json'], { raiz });
  assert.doesNotMatch(e.json.proximoPasso || '', /publicar/);
  assert.match(e.json.proximoPasso, /status/);
});
