/* M8 — a tela Saúde da mesa (mesa-saude.js) rodando de verdade num DOM falso, e o gancho de entrada da mesa.
 *
 * O que se confere: cada falha aparece com o texto do idioma de quem edita e como corrigir; o que é do superadmin (assistente)
 * não aparece para a equipe; "copiar o pedido para o agente" não leva segredo; o teste do provedor e a busca de versão só
 * rodam quando pedidos; na primeira entrada do superadmin o assistente abre sozinho, e só nela. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrirOperacao, resposta } = require('./assistente-ambiente.js');

const AGORA = '2026-10-02T12:00:00.000Z';

function saude(extra) {
  return Object.assign({
    geradoEm: AGORA, versao: { core: '0.1.0', ultima: null, nova: false }, modo: 'privado', provedor: 'bunny',
    segredos: [
      { nome: 'ADMIN_PASSWORD', presente: true, secreta: true, necessario: true, grupo: 'admin' },
      { nome: 'BUNNY_LIBRARY_ID', presente: true, secreta: false, necessario: true, grupo: 'video' },
      { nome: 'BUNNY_API_KEY', presente: false, secreta: true, necessario: true, grupo: 'video' },
      { nome: 'BUNNY_EMBED_KEY', presente: false, secreta: true, necessario: false, grupo: 'video' }
    ],
    armazenamento: { titulos: 12, noAr: 9, bytesDoCatalogo: 30720, d1: true },
    backup: { ultimo: { em: '2026-10-01T09:00:00.000Z', origem: 'admin' }, horas: 27 },
    checagens: [
      { id: 'kv', estado: 'ok', codigo: 'kv-ok' },
      { id: 'backup', estado: 'aviso', codigo: 'backup-velho', params: { horas: 70 } },
      { id: 'video-credenciais', estado: 'erro', codigo: 'video-credenciais-faltam', params: { provedor: 'bunny', nomes: 'BUNNY_API_KEY' } },
      { id: 'video-conexao', estado: 'pulado', codigo: 'video-conexao-sem-credenciais' }
    ],
    resumo: { ok: 1, aviso: 1, erro: 1, pulado: 1 }, assistente: { estado: 'concluido' }
  }, extra || {});
}

const rotaSaude = (corpo) => ({ '/api/saude': () => corpo });
const ids = (t) => t.todos('.saude-item').map((n) => n.querySelector('b').textContent);

test('a lista mostra primeiro o que é problema, com a mensagem e como corrigir no idioma da mesa', async () => {
  const t = abrirOperacao({ rotas: rotaSaude(saude()) });
  t.tela('saude');
  await t.esperar();
  assert.deepEqual(ids(t), ['Chaves do vídeo', 'Backup', 'Conexão com o provedor de vídeo', 'Armazenamento do catálogo (KV)'], 'erro, aviso, não verificado, ok');
  const texto = t.texto();
  assert.match(texto, /Faltam as chaves de Bunny Stream: BUNNY_API_KEY\./, 'o nome do provedor sai por extenso');
  assert.match(texto, /O último backup tem 70 horas: passou de 2 dias\./);
  assert.match(texto, /Como corrigir: Abra o assistente de configuração, passo "Vídeo"/);
  assert.match(texto, /1 problema/);
  assert.match(texto, /2 itens pedem atenção|2 itens/);
  assert.ok(!/video-credenciais-faltam|saude\.c\./.test(texto), 'nunca o código ou a chave crua na tela');
});

test('em inglês a mesma tela sai em inglês', async () => {
  const t = abrirOperacao({ rotas: rotaSaude(saude()), idioma: 'en' });
  t.tela('saude');
  await t.esperar();
  assert.match(t.texto(), /The keys for Bunny Stream are missing: BUNNY_API_KEY\./);
  assert.match(t.texto(), /Site health/);
});

test('segredos: só o nome e "guardado" ou "falta"; o valor nunca aparece, e a tabela tem legenda e cabeçalho', async () => {
  const t = abrirOperacao({ rotas: rotaSaude(saude()) });
  t.tela('saude');
  await t.esperar();
  const linhas = t.todos('tr').filter((l) => l.querySelector('td'));
  assert.equal(linhas.length, 4);
  const faltando = linhas.find((l) => l.textContent.includes('BUNNY_API_KEY'));
  assert.match(faltando.textContent, /Falta/);
  assert.match(faltando.textContent, /Segredo/);
  const idDaBiblioteca = linhas.find((l) => l.textContent.includes('BUNNY_LIBRARY_ID'));
  assert.match(idDaBiblioteca.textContent, /Variável de texto/, 'o id não é senha');
  assert.equal(t.todos('th[scope="col"]').length, 4);
  assert.equal(t.todos('caption').length, 1);
  assert.equal(t.todos('input').length, 0, 'a tela de saúde não tem campo nenhum: nada para digitar chave');
  assert.match(t.texto(), /Workers e Pages, escolha o seu Worker, Configurações, Variáveis e segredos/);
});

test('"copiar o pedido para o agente" só nos erros, e o texto não leva segredo nem pede um', async () => {
  const t = abrirOperacao({ rotas: rotaSaude(saude()) });
  t.tela('saude');
  await t.esperar();
  const botoes = t.todos('[data-acao="saude-copiar-pedido"]');
  assert.equal(botoes.length, 1, 'só o item vermelho');
  t.clicar(botoes[0]);
  await t.esperar();
  assert.equal(t.copiados.length, 1);
  const pedido = t.copiados[0];
  assert.match(pedido, /AGENTS\.md/);
  assert.match(pedido, /setup\.mjs doctor --json/);
  assert.match(pedido, /Faltam as chaves de Bunny Stream/);
  assert.match(pedido, /video-credenciais:video-credenciais-faltam/);
  assert.match(pedido, /NÃO peça nem imprima nenhuma senha ou chave/);
  assert.match(t.aviso.textContent, /Pedido copiado/);
});

test('"Resolver agora" leva ao assistente só o superadmin; a equipe só vê o que é dela', async () => {
  const comoSuper = abrirOperacao({ rotas: rotaSaude(saude()) });
  comoSuper.tela('saude');
  await comoSuper.esperar();
  const irSuper = comoSuper.todos('[data-acao="saude-ir"]').map((b) => b.getAttribute('data-tela'));
  assert.ok(irSuper.includes('assistente'), 'o botão "Abrir o assistente" e o do vídeo');
  assert.ok(irSuper.includes('backup'));
  comoSuper.clicar(comoSuper.todos('[data-acao="saude-ir"][data-tela="backup"]')[0]);
  assert.equal(comoSuper.M.st.tela, 'backup');

  const comoEquipe = abrirOperacao({ super: false, permissoes: ['conteudo'], rotas: rotaSaude(saude()) });
  comoEquipe.tela('saude');
  await comoEquipe.esperar();
  const irEquipe = comoEquipe.todos('[data-acao="saude-ir"]').map((b) => b.getAttribute('data-tela'));
  assert.ok(!irEquipe.includes('assistente'), 'a equipe não vê atalho para o assistente');
  assert.ok(irEquipe.includes('backup'));
});

test('testar o provedor e procurar versão só vão ao servidor quando a pessoa pede', async () => {
  const t = abrirOperacao({ rotas: rotaSaude(saude()) });
  t.tela('saude');
  await t.esperar();
  const inicial = t.pedidosDe('/api/saude');
  assert.equal(inicial.length, 1, 'abrir a tela é UMA leitura');
  assert.ok(!/testar/.test(inicial[0].url), 'e sem testar o provedor');
  t.clicar('[data-acao="saude-testar"]');
  await t.esperar();
  assert.ok(t.pedidosDe('/api/saude').some((p) => /testar=1/.test(p.url)));
  t.clicar('[data-acao="saude-versao"]');
  await t.esperar();
  assert.ok(t.pedidosDe('/api/saude').some((p) => /versao=1/.test(p.url)));
});

test('versão nova: aviso, link só para o GitHub e como atualizar; sem versão nova, sem aviso', async () => {
  const nova = saude({ versao: { core: '0.1.0', ultima: { versao: '0.2.0', url: 'https://github.com/o/r/releases/tag/v0.2.0', verificadaEm: Date.parse(AGORA) }, nova: true } });
  const t = abrirOperacao({ rotas: rotaSaude(nova) });
  t.tela('saude');
  await t.esperar();
  assert.match(t.texto(), /Há uma versão nova\./);
  assert.match(t.texto(), /A versão 0\.2\.0 já foi publicada/);
  const link = t.achar('a[href^="https://github.com/"]');
  assert.ok(link, 'o link para ver o que mudou');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /noopener/);
  assert.match(t.texto(), /atualização automática/);

  const igual = abrirOperacao({ rotas: rotaSaude(saude()) });
  igual.tela('saude');
  await igual.esperar();
  assert.ok(!/Há uma versão nova/.test(igual.texto()));
});

test('um endereço de versão que não seja https nunca vira link (o navegador não segue javascript: nem data:)', async () => {
  const mau = saude({ versao: { core: '0.1.0', ultima: { versao: '0.2.0', url: 'javascript:alert(1)', verificadaEm: 1 }, nova: true } });
  const t = abrirOperacao({ rotas: rotaSaude(mau) });
  t.tela('saude');
  await t.esperar();
  assert.ok(!t.achar('a[href^="javascript:"]'));
  assert.ok(!t.achar('a[target="_blank"]'), 'sem endereço seguro, sem link');
  assert.match(t.texto(), /Há uma versão nova\./, 'o aviso continua: só o link some');
});

test('o pedido ao servidor falhando mostra o erro e não quebra a tela', async () => {
  const t = abrirOperacao({ rotas: { '/api/saude': () => resposta({ codigo: 'nao-autorizado' }, 500) } });
  t.tela('saude');
  await t.esperar();
  assert.ok(t.achar('[role="alert"]'), 'o erro é anunciado');
  assert.ok(t.achar('h1'), 'a tela continua de pé');
});

test('o painel da direita explica as quatro cores e o que é segredo', async () => {
  const t = abrirOperacao({ rotas: rotaSaude(saude()) });
  t.tela('saude');
  await t.esperar();
  const painel = t.painelDir.textContent;
  for (const palavra of ['Em ordem', 'Atenção', 'Problema', 'Não verificado', 'nunca volta para esta tela']) assert.ok(painel.includes(palavra), palavra);
});

test('na primeira entrada do superadmin, o assistente abre sozinho; depois de concluído ou dispensado, não', async () => {
  const entrar = async (estado, ehSuper) => {
    const t = abrirOperacao({ super: ehSuper, rotas: rotaSaude(saude({ assistente: { estado } })) });
    t.M.st.tela = 'site';
    await t.M.aoAbrirMesa();
    await t.esperar();
    return t;
  };
  assert.equal((await entrar('pendente', true)).M.st.tela, 'assistente');
  assert.equal((await entrar('concluido', true)).M.st.tela, 'site');
  assert.equal((await entrar('dispensado', true)).M.st.tela, 'site');
  assert.equal((await entrar('pendente', false)).M.st.tela, 'site', 'a equipe nunca cai no assistente');
  /* quem já está em outra tela não é arrancado dela */
  const t = abrirOperacao({ rotas: rotaSaude(saude({ assistente: { estado: 'pendente' } })) });
  t.M.st.tela = 'custos';
  await t.M.aoAbrirMesa();
  assert.equal(t.M.st.tela, 'custos');
});

test('ao abrir a mesa, a versão nova vira um aviso (uma vez só) com atalho para a tela Saúde', async () => {
  const nova = saude({ versao: { core: '0.1.0', ultima: { versao: '0.3.0', url: 'https://github.com/o/r/releases/tag/v0.3.0', verificadaEm: 1 }, nova: true }, assistente: { estado: 'concluido' } });
  const t = abrirOperacao({ rotas: rotaSaude(nova) });
  await t.M.aoAbrirMesa();
  assert.match(t.aviso.textContent, /Há uma versão nova: 0\.3\.0\./);
  assert.match(t.aviso.textContent, /Ver o que mudou/);
  t.aviso.textContent = '';
  await t.M.aoAbrirMesa();
  assert.equal(t.aviso.textContent, '', 'não repete o aviso a cada leitura');
  assert.ok(t.pedidosDe('/api/saude').every((p) => /versao=1/.test(p.url)), 'a leitura de entrada pede a versão, e só ela');
});

test('o selo do menu conta erros e avisos', async () => {
  const t = abrirOperacao({ rotas: rotaSaude(saude()) });
  assert.equal(t.M.saude.pendencias(), 0, 'antes de ler, nada a contar');
  await t.M.saude.carregar({});
  assert.equal(t.M.saude.pendencias(), 2);
});
