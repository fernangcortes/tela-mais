/* M8 — o assistente de configuração da mesa (mesa-assistente.js) rodando de verdade num DOM falso, ligado às MESMAS funções
 * do servidor (avaliarMarca, gerarConfig, homeDoPreset): o que a tela mostra é o que o servidor responderia.
 *
 * O que se confere, passo a passo: a prévia e o contraste ao vivo; o que cada passo pede e impede; que NENHUM campo aceita
 * senha ou chave (só o nome das variáveis, o caminho no painel da Cloudflare e o teste); que a home vai ao catálogo pelo
 * caminho validado (rascunho, Publicar, 409) e o resto vira um site.json para baixar; que o assistente só abre para o superadmin
 * e só se conclui quando a pessoa conclui. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { abrirOperacao, resposta } = require('./assistente-ambiente.js');

const ENV = { BUNNY_LIBRARY_ID: '123', BUNNY_API_KEY: 'valor-que-nunca-deve-aparecer' };

async function servidor(opcoes = {}) {
  const lib = await import('../core/worker/_lib/assistente.js');
  const dados = lib.dadosDoAssistente({ config: {}, env: ENV });
  dados.atual = Object.assign({
    preset: null, marca: { nome: 'Minha Escola', nomeCurto: '', slogan: '' },
    tema: { preset: 'institucional', modo: 'claro', cores: { escuro: { marca: '#0b7285' }, claro: { marca: '#0b7285' } } },
    acesso: 'privado', video: { provedor: 'bunny', hlsBaseUrl: '' }, idiomas: { padrao: 'pt-BR', disponiveis: ['pt-BR'] }, modeloDeConteudo: 'seriado'
  }, opcoes.atual || {});
  const salvos = [];
  const catalogo = { rev: 5, itens: [], site: {}, padroes: {}, ajustes: {} };
  const saudeCom = (extra) => Object.assign({
    geradoEm: '2026-10-02T12:00:00.000Z', versao: { core: '0.1.0', ultima: null, nova: false }, modo: 'privado', provedor: 'bunny', segredos: [], armazenamento: {}, backup: { ultimo: null },
    checagens: [
      { id: 'admin-senha', estado: 'ok', codigo: 'admin-senha-ok' }, { id: 'sessao', estado: 'ok', codigo: 'sessao-ok' },
      { id: 'video-credenciais', estado: 'ok', codigo: 'video-credenciais-ok', params: { provedor: 'bunny' } },
      { id: 'video-conexao', estado: 'ok', codigo: 'video-conexao-ok', params: { provedor: 'bunny' } },
      { id: 'video-assinatura', estado: 'erro', codigo: 'video-assinatura-faltam', params: { provedor: 'bunny', nomes: 'BUNNY_TOKEN_KEY' } },
      { id: 'backup', estado: 'aviso', codigo: 'backup-nunca' }
    ],
    resumo: { ok: 4, aviso: 1, erro: 1, pulado: 0 }, assistente: { estado: 'pendente' }
  }, extra || {});
  const rotas = {
    '/api/saude': async (url, init) => {
      const metodo = (init && init.method) || 'GET';
      if (metodo === 'GET' && /assistente=1/.test(url)) return Object.assign({}, dados, { estado: { estado: 'pendente' } });
      if (metodo === 'GET') return opcoes.saude ? opcoes.saude(url) : saudeCom();
      if (metodo === 'PUT') { salvos.push(JSON.parse(init.body)); return { ok: true, assistente: { estado: JSON.parse(init.body).assistente } }; }
      const corpo = JSON.parse(init.body);
      if (corpo.acao === 'marca') {
        const r = lib.avaliarMarca({ cor: corpo.cor, corClara: corpo.corClara, tema: corpo.tema });
        return r.ok ? r : resposta({ codigo: r.codigo, campo: r.campo }, 400);
      }
      if (opcoes.config) { const forcado = opcoes.config(corpo); if (forcado) return forcado; }
      const g = lib.gerarConfig(lib.ARQUIVO_DE_IMPLANTACAO, corpo.escolhas);
      if (!g.ok) return resposta({ codigo: 'config-recusada', params: { n: g.erros.length }, erros: g.erros }, 400);
      return { ok: true, texto: g.texto, mudancas: g.mudancas, precisaRepublicar: g.precisaRepublicar, home: corpo.escolhas.preset ? lib.homeDoPreset(corpo.escolhas.preset) : null };
    },
    '/api/catalogo': (url, init) => {
      if (init && init.method === 'PUT') { const novo = JSON.parse(init.body); salvos.push({ catalogo: novo }); catalogo.rev += 1; catalogo.site = novo.site || {}; return { ok: true, rev: catalogo.rev, total: 0, atualizado_em: 'agora', mudancas: 1, historico: true }; }
      return JSON.parse(JSON.stringify(catalogo));
    }
  };
  return { rotas, salvos, dados, lib, catalogo };
}

async function abrir(opcoes = {}) {
  const s = await servidor(opcoes);
  const t = abrirOperacao(Object.assign({ rotas: s.rotas, servidor: JSON.parse(JSON.stringify(s.catalogo)) }, opcoes.mesa || {}));
  t.s = s;
  t.tela('assistente');
  await t.esperar();
  return t;
}

const avancar = async (t) => { t.clicar('[data-acao="asst-avancar"]'); await t.esperar(); };
const passoAtual = (t) => t.achar('#asst-titulo-passo').textContent;
const posts = (t, acao) => t.pedidosDe('/api/saude', 'POST').map((p) => t.corpoDe(p)).filter((c) => !acao || c.acao === acao);

async function ate(t, passo) {
  const ordem = ['identidade', 'uso', 'acesso', 'video', 'idiomas', 'home', 'pronto'];
  while (t.M.assistente.passo < ordem.indexOf(passo)) {
    const antes = t.M.assistente.passo;
    await avancar(t);
    if (t.M.assistente.passo === antes) throw new Error('o assistente não saiu do passo ' + (antes + 1) + ': ' + t.M.assistente.erros.map((e) => e.codigo).join(', '));
  }
  return t;
}

/* ------------------------------------------------------------------ o começo */

test('abre no passo 1 com o que o arquivo de implantação diz hoje; a trilha marca o passo atual', async () => {
  const t = await abrir();
  assert.match(passoAtual(t), /Passo 1 de 7: Identidade/);
  assert.equal(t.achar('#asst-nome').value, 'Minha Escola');
  assert.deepEqual(t.achar('#asst-tema').children.filter((o) => o.selected).map((o) => o.value), ['institucional']);
  const botoes = t.todos('.asst-trilha-botao');
  assert.equal(botoes.length, 7);
  assert.deepEqual(botoes.filter((b) => b.getAttribute('aria-current') === 'step').map((b) => b.getAttribute('data-passo')), ['0']);
  assert.ok(t.achar('ol[aria-label]'), 'a trilha é uma lista nomeada');
  assert.match(t.painelDir.textContent, /Escreva o nome e escolha uma cor/, 'a ajuda da direita acompanha o passo');
  assert.match(t.painelDir.textContent, /Worker é o programa que roda o seu site/, 'o glossário explica o jargão na primeira vez');
});

test('só o superadmin vê o assistente; a equipe recebe um aviso e nenhuma chamada é feita', async () => {
  const s = await servidor();
  const t = abrirOperacao({ super: false, permissoes: ['conteudo'], rotas: s.rotas });
  t.tela('assistente');
  await t.esperar();
  assert.match(t.texto(), /Só o superadmin usa o assistente/);
  assert.equal(t.pedidos.filter((p) => /\/api\//.test(p.url)).length, 0);
});

test('se a leitura falha, o erro é anunciado e a tela não entra em laço de recarga', async () => {
  const t = abrirOperacao({ rotas: { '/api/saude': () => resposta({ codigo: 'so-superadmin' }, 403) } });
  t.tela('assistente');
  await t.esperar(30);
  assert.ok(t.achar('[role="alert"]'));
  assert.equal(t.pedidosDe('/api/saude').length, 1, 'uma tentativa, e a pessoa decide');
});

/* ------------------------------------------------------------------ identidade: cor, prévia e contraste */

test('a prévia e o contraste vêm do servidor, com a régua do validador, e aparecem logo que a tela abre', async () => {
  const t = await abrir();
  const previas = t.todos('.asst-previa');
  assert.equal(previas.length, 1, 'tema claro: uma prévia');
  assert.equal(previas[0].getAttribute('role'), 'img');
  assert.match(previas[0].getAttribute('aria-label'), /Prévia do site no modo Claro/);
  assert.match(previas[0].textContent, /Minha Escola/);
  const razoes = t.todos('.asst-razao').map((n) => n.textContent);
  assert.equal(razoes.length, 4);
  assert.ok(razoes.every((r) => /Passa/.test(r)), razoes.join(' | '));
  assert.match(razoes[0], /Texto: \d+,\d+ para 1 \(mínimo 4,5\)/, 'vírgula decimal e mínimo explícito');
  assert.match(t.texto(), /norma de acessibilidade WCAG/);
  assert.equal(posts(t, 'marca').length, 1);
  assert.deepEqual(posts(t, 'marca')[0].tema, { preset: 'institucional', modo: 'claro' });
  assert.equal(posts(t, 'marca')[0].cor, undefined, 'cor que a pessoa não mexeu não vai ao servidor');
});

test('digitar a cor: código inválido não pergunta nada; válido pergunta (com espera) e repinta sem redesenhar a tela', async () => {
  const t = await abrir();
  const antes = posts(t, 'marca').length;
  const campoNome = t.achar('#asst-nome');
  t.digitar('#asst-cor-hex', '#12');
  await t.esperar();
  assert.equal(posts(t, 'marca').length, antes, 'meio código não vai ao servidor');
  t.digitar('#asst-cor-hex', '#7c3aed');
  await t.esperar();
  const marcas = posts(t, 'marca');
  assert.equal(marcas.length, antes + 1);
  assert.equal(marcas[marcas.length - 1].cor, '#7c3aed');
  assert.equal(t.achar('#asst-cor').value, '#7c3aed', 'o seletor acompanha o texto');
  assert.equal(t.achar('#asst-nome'), campoNome, 'a tela não foi redesenhada (o cursor de quem digita fica)');
  t.digitar('#asst-cor', '#0b7285');
  assert.equal(t.achar('#asst-cor-hex').value, '#0b7285', 'e o texto acompanha o seletor');
});

test('cor que não se lê: o assistente diz o contraste, propõe a mais próxima e o botão a põe no campo', async () => {
  const t = await abrir();
  t.digitar('#asst-cor-hex', '#f5d90a');
  await t.esperar();
  assert.match(t.texto(), /Essa cor não se lê bem\./);
  assert.match(t.texto(), /A cor #f5d90a tem só \d+,\d+ para 1 de contraste com o fundo\. Vamos usar #[0-9a-f]{6}, a mais parecida que passa\./);
  const botao = t.achar('[data-acao="asst-usar-cor"]');
  assert.ok(botao);
  const sugerida = botao.getAttribute('data-cor');
  assert.match(botao.textContent, new RegExp('Usar ' + sugerida));
  t.clicar(botao);
  await t.esperar();
  assert.equal(t.achar('#asst-cor-hex').value, sugerida);
  assert.ok(!/Essa cor não se lê bem/.test(t.texto()), 'com a sugestão no campo, o aviso some');
  assert.ok(t.todos('.asst-razao').every((r) => /Passa/.test(r.textContent)));
});

test('modo automático mostra as duas prévias, cada uma com o seu contraste; trocar o tema pergunta de novo', async () => {
  const t = await abrir();
  t.clicar('[data-acao="asst-modo-tema"][data-modo="auto"]');
  await t.esperar();
  assert.equal(t.todos('.asst-previa').length, 2);
  assert.equal(t.todos('.asst-razao').length, 8);
  assert.match(t.texto(), /Escuro/);
  const antes = posts(t, 'marca').length;
  t.mudar('#asst-tema', 'cinema');
  await t.esperar();
  assert.equal(posts(t, 'marca').length, antes + 1);
  assert.equal(posts(t, 'marca').pop().tema.preset, 'cinema');
});

test('a prévia acompanha o nome e a frase enquanto se digita, sem redesenhar', async () => {
  const t = await abrir();
  const previa = () => t.achar('.asst-previa').textContent;
  t.digitar('#asst-nome', 'Colégio Horizonte');
  assert.match(previa(), /Colégio Horizonte/);
  t.digitar('#asst-slogan', 'Aprender juntos');
  assert.match(previa(), /Aprender juntos/);
  t.digitar('#asst-nome', '');
  assert.match(previa(), /Seu nome aqui/, 'sem nome, um exemplo');
});

test('o logo é só prévia: lido no navegador, nunca enviado; formato errado é recusado', async () => {
  const t = await abrir();
  const antes = t.pedidos.length;
  const campo = t.achar('#asst-logo');
  campo.files = [{ name: 'logo.png', type: 'image/png', size: 1000 }];
  t.mudar(campo);
  await t.esperar();
  assert.ok(t.achar('img.asst-previa-logo'), 'o logo aparece na prévia');
  assert.equal(t.pedidos.length, antes, 'e não vai a lugar nenhum');
  campo.files = [{ name: 'foto.gif', type: 'image/gif', size: 1000 }];
  t.mudar(campo);
  await t.esperar();
  assert.match(t.texto(), /O logo precisa ser um SVG ou PNG de até 512 KB/);
});

test('sem nome não se avança: o erro é anunciado e o foco vai para o campo', async () => {
  const t = await abrir();
  t.digitar('#asst-nome', '   ');
  t.clicar('[data-acao="asst-avancar"]');
  await t.esperar();
  assert.match(passoAtual(t), /Passo 1/);
  assert.match(t.texto(), /Escreva o nome da plataforma/);
  assert.ok(t.achar('[role="alert"]'));
  assert.equal(t.doc.activeElement && t.doc.activeElement.id, 'asst-nome');
  t.digitar('#asst-cor-hex', 'azul');
  t.digitar('#asst-nome', 'Escola');
  t.clicar('[data-acao="asst-avancar"]');
  await t.esperar();
  assert.match(t.texto(), /A cor precisa estar no formato #rrggbb/);
  assert.match(passoAtual(t), /Passo 1/);
});

/* ------------------------------------------------------------------ modelo de uso */

test('escolher um modelo mostra o que ele escolhe por você e já sugere tema e acesso, sem passar por cima do que a pessoa mexeu', async () => {
  const t = await abrir();
  await avancar(t);
  assert.match(passoAtual(t), /Passo 2 de 7: Para que serve/);
  assert.equal(t.todos('input[name="asst-preset"]').length, 8, 'sete modelos e "nenhum"');
  assert.ok(t.achar('#asst-preset-nenhum').checked);
  t.mudar('#asst-preset-escola', true);
  assert.match(t.texto(), /Tema sugerido: Institucional\./);
  assert.match(t.texto(), /Acesso sugerido: Cadastro aberto\./);
  assert.match(t.texto(), /Vídeos organizados em séries/);
  assert.match(t.texto(), /Continuar de onde parou\./);
  assert.equal(t.M.assistente.e.acesso, 'cadastro');
  assert.equal(t.M.assistente.e.preset, 'escola');

  /* quem já escolheu o acesso não o vê trocado por um modelo */
  const outra = await abrir();
  await ate(outra, 'acesso');
  outra.mudar('#asst-acesso-privado', true);
  outra.clicar('[data-acao="asst-voltar"]');
  outra.mudar('#asst-preset-festival', true);
  assert.equal(outra.M.assistente.e.acesso, 'privado', 'o acesso escolhido à mão não é sobrescrito');
});

test('os sete modelos do produto aparecem, cada um com nome e resumo no idioma', async () => {
  const t = await abrir();
  await avancar(t);
  const nomes = t.todos('b').map((b) => b.textContent);
  for (const nome of ['Criador de conteúdo', 'Empresa', 'Escola ou universidade', 'Festival ou mostra', 'Igreja ou comunidade', 'Curso online (infoprodutor)', 'Prefeitura ou órgão público']) {
    assert.ok(nomes.includes(nome), nome);
  }
  assert.equal(t.todos('legend').length, 1, 'o grupo de opções tem legenda');
});

/* ------------------------------------------------------------------ acesso */

test('acesso: três modos em linguagem simples, o aviso honesto da gravação de tela e a recomendação do modelo', async () => {
  const t = await abrir();
  await avancar(t);
  t.mudar('#asst-preset-infoprodutor', true);
  await avancar(t);
  assert.match(passoAtual(t), /Passo 3 de 7: Quem pode ver/);
  assert.equal(t.todos('input[name="asst-acesso"]').length, 3);
  const texto = t.texto();
  for (const trecho of ['Qualquer pessoa com o endereço assiste.', 'Só entra quem você convidar.', 'Qualquer pessoa cria uma conta e assiste.', 'Turnstile', 'link de convite (vale 7 dias)']) assert.ok(texto.includes(trecho), trecho);
  assert.match(texto, /nenhum modo impede alguém de gravar a tela do vídeo/);
  assert.match(texto, /Privado \(só convidados\) — recomendado para o seu tipo de uso/);
  assert.ok(t.achar('#asst-acesso-privado').checked);
});

test('abrir o acesso (público, vindo de um site restrito) exige marcar que entendeu, e só então avança', async () => {
  const t = await abrir();
  await ate(t, 'acesso');
  t.mudar('#asst-acesso-publico', true);
  assert.ok(t.achar('#asst-confirma-publico'), 'a caixa de confirmação aparece');
  assert.match(t.texto(), /Entendi que o site ficará aberto a todos/);
  t.clicar('[data-acao="asst-avancar"]');
  await t.esperar();
  assert.match(passoAtual(t), /Passo 3/);
  assert.match(t.texto(), /marque que você entendeu que qualquer pessoa com o endereço verá o catálogo/);
  assert.equal(t.doc.activeElement && t.doc.activeElement.id, 'asst-confirma-publico');
  t.mudar('#asst-confirma-publico', true);
  await avancar(t);
  assert.match(passoAtual(t), /Passo 4/);
  /* e quem já era público não é perguntado */
  const publico = await abrir({ atual: { acesso: 'publico' } });
  await ate(publico, 'acesso');
  assert.ok(!publico.achar('#asst-confirma-publico'));
});

test('avançar do acesso confere a combinação no servidor: o que o validador recusa vira erro com texto, e a pessoa fica no passo', async () => {
  const t = await abrir({ atual: { video: { provedor: 'hls-generico', hlsBaseUrl: 'https://v.exemplo.test/acervo' } } });
  await ate(t, 'acesso');
  assert.match(t.texto(), /não protege o vídeo por endereço temporário/, 'o conflito já aparece enquanto escolhe');
  await avancar(t);
  assert.match(passoAtual(t), /Passo 3/, 'privado + HLS genérico: o validador recusa');
  assert.match(t.texto(), /Corrija antes de continuar/);
  assert.match(t.texto(), /Esta combinação não é aceita:/);
  assert.ok(t.achar('[role="alert"]'));
  assert.equal(posts(t, 'config').length, 1);
  t.mudar('#asst-acesso-publico', true);
  t.mudar('#asst-confirma-publico', true);
  await avancar(t);
  assert.match(passoAtual(t), /Passo 4/, 'público com HLS genérico é uma combinação válida');
});

/* ------------------------------------------------------------------ vídeo */

test('vídeo: comparação dos provedores com legenda, e as variáveis por NOME — nenhum campo de senha ou chave', async () => {
  const t = await abrir();
  await ate(t, 'video');
  assert.match(passoAtual(t), /Passo 4 de 7: Vídeo/);
  assert.equal(t.todos('caption').length >= 2, true);
  assert.equal(t.todos('input[name="asst-provedor"]').length, 3);
  assert.match(t.texto(), /Bunny Stream/);
  assert.match(t.texto(), /Cloudflare Stream/);
  assert.match(t.texto(), /HLS genérico/);
  const nomes = t.todos('span.mono').map((n) => n.textContent);
  for (const nome of ['BUNNY_LIBRARY_ID', 'BUNNY_API_KEY', 'BUNNY_PULLZONE', 'BUNNY_TOKEN_KEY']) assert.ok(nomes.includes(nome), 'falta ' + nome);
  assert.equal(t.todos('input[type="password"]').length, 0);
  assert.equal(t.todos('textarea').length, 0);
  assert.equal(t.todos('input[type="text"]').length, 0, 'nenhum campo de texto: não há onde colar chave');
  assert.match(t.texto(), /Workers e Pages, o nome do seu Worker, Configurações, Variáveis e segredos, Adicionar/);
  assert.match(t.texto(), /A chave nunca é digitada aqui\./);
  assert.ok(!t.texto().includes('valor-que-nunca-deve-aparecer'), 'o valor não chega à tela');
  const link = t.achar('a[href="https://bunny.net/"]');
  assert.ok(link && link.getAttribute('target') === '_blank' && /noopener/.test(link.getAttribute('rel')), 'link para criar a conta');
});

test('vídeo: cada variável diz se é segredo, para quê serve, onde achar e se já está guardada', async () => {
  const t = await abrir();
  await ate(t, 'video');
  const linha = (nome) => t.todos('tr').find((l) => l.textContent.includes(nome) && l.querySelector('td'));
  assert.match(linha('BUNNY_API_KEY').textContent, /Segredo/);
  assert.match(linha('BUNNY_API_KEY').textContent, /Obrigatória/);
  assert.match(linha('BUNNY_API_KEY').textContent, /Guardado/, 'a chave está no ambiente de teste');
  assert.match(linha('BUNNY_API_KEY').textContent, /Stream API Key/);
  assert.match(linha('BUNNY_LIBRARY_ID').textContent, /Variável de texto/);
  assert.match(linha('BUNNY_TOKEN_KEY').textContent, /Protege o vídeo \(acesso restrito\)/, 'o site é privado: a chave de proteção conta');
  assert.match(linha('BUNNY_TOKEN_KEY').textContent, /Falta/);
  assert.ok(t.todos('[data-acao="asst-copiar"]').length >= 4, 'cada nome tem botão de copiar');
  const copiar = t.achar('[data-acao="asst-copiar"][data-texto="BUNNY_API_KEY"]');
  assert.match(copiar.getAttribute('aria-label'), /Copiar BUNNY_API_KEY/);
  t.clicar(copiar);
  await t.esperar();
  assert.deepEqual(t.copiados, ['BUNNY_API_KEY'], 'copia só o NOME');
});

test('vídeo: no acesso público, a chave de proteção deixa de ser exigida', async () => {
  const t = await abrir({ atual: { acesso: 'publico' } });
  await ate(t, 'video');
  const linha = (nome) => t.todos('tr').find((l) => l.textContent.includes(nome) && l.querySelector('td'));
  assert.ok(!linha('BUNNY_TOKEN_KEY') || !/Protege o vídeo/.test(linha('BUNNY_TOKEN_KEY').textContent), 'público não precisa assinar');
  assert.match(t.texto(), /Outras variáveis opcionais/);
});

test('vídeo: "Testar agora" consulta o servidor e mostra o resultado em palavras; trocar de provedor limpa o teste', async () => {
  const t = await abrir();
  await ate(t, 'video');
  t.clicar('[data-acao="asst-testar"]');
  await t.esperar();
  assert.ok(t.pedidosDe('/api/saude').some((p) => /testar=1/.test(p.url)));
  assert.match(t.texto(), /Resultado do teste/);
  assert.match(t.texto(), /As chaves de Bunny Stream estão guardadas\./);
  assert.match(t.texto(), /Bunny Stream aceitou as chaves\./);
  assert.match(t.texto(), /Faltam as chaves que protegem o vídeo em Bunny Stream: BUNNY_TOKEN_KEY\./);
  assert.ok(t.achar('[aria-live="polite"]'));
  t.mudar('#asst-provedor-cloudflare-stream', true);
  assert.ok(!/Resultado do teste/.test(t.texto()), 'o resultado era do outro provedor');
  assert.match(t.texto(), /CLOUDFLARE_STREAM_TOKEN/);
});

test('vídeo: testar um provedor diferente do publicado avisa que o teste vale para o de hoje', async () => {
  const t = await abrir();
  await ate(t, 'video');
  t.mudar('#asst-provedor-cloudflare-stream', true);
  t.clicar('[data-acao="asst-testar"]');
  await t.esperar();
  assert.match(t.texto(), /O teste vale para o provedor que está publicado hoje \(Bunny Stream\)/);
});

test('vídeo: o HLS genérico pede só o endereço dos vídeos, e o aviso de que ele não protege o vídeo restrito', async () => {
  const t = await abrir();
  await ate(t, 'video');
  t.mudar('#asst-provedor-hls-generico', true);
  const campos = t.todos('input[type="text"]');
  assert.deepEqual(campos.map((c) => c.id), ['asst-hls']);
  assert.equal(t.achar('#asst-hls').getAttribute('aria-describedby'), 'asst-hls-dica');
  assert.match(t.texto(), /não protege o vídeo por endereço temporário/);
  t.digitar('#asst-hls', 'https://videos.exemplo.test/acervo');
  assert.equal(t.M.assistente.e.hlsBaseUrl, 'https://videos.exemplo.test/acervo');
});

/* ------------------------------------------------------------------ idiomas */

test('idiomas: três, ao menos um marcado, e o principal acompanha quem sai da lista', async () => {
  const t = await abrir();
  await ate(t, 'idiomas');
  assert.match(passoAtual(t), /Passo 5 de 7: Idiomas/);
  assert.equal(t.todos('input[data-idioma]').length, 3);
  t.mudar('#asst-idioma-en', true);
  assert.deepEqual(t.M.assistente.e.idiomas, ['pt-BR', 'en']);
  t.mudar('#asst-idioma-pt-BR', false);
  assert.deepEqual(t.M.assistente.e.idiomas, ['en']);
  assert.equal(t.M.assistente.e.idiomaPadrao, 'en', 'o principal passa para um que sobrou');
  assert.equal(t.achar('#asst-idioma-padrao').children.length, 1);
  t.mudar('#asst-idioma-en', false);
  t.clicar('[data-acao="asst-avancar"]');
  await t.esperar();
  assert.match(t.texto(), /Marque pelo menos um idioma/);
  assert.match(passoAtual(t), /Passo 5/);
});

/* ------------------------------------------------------------------ home */

test('home: sem modelo escolhido, nada a aplicar; com modelo, mostra a lista e a explicação do caminho', async () => {
  const sem = await abrir();
  await ate(sem, 'home');
  assert.match(passoAtual(sem), /Passo 6 de 7: Página inicial/);
  assert.match(sem.texto(), /Você não escolheu um modelo de uso/);
  assert.ok(!sem.achar('[data-acao="asst-aplicar-home"]'));

  const t = await abrir();
  await avancar(t);
  t.mudar('#asst-preset-escola', true);
  await ate(t, 'home');
  assert.match(t.texto(), /Página inicial do modelo "Escola ou universidade"/);
  assert.ok(t.achar('ol.asst-blocos').children.length >= 4);
  assert.match(t.texto(), /mesmo caminho da tela Home: respeita as permissões, entra no histórico/);
});

test('home: aplicar publica pelo caminho da mesa (GET completo, PUT com a rev), e a resposta aparece', async () => {
  const t = await abrir();
  await avancar(t);
  t.mudar('#asst-preset-escola', true);
  await ate(t, 'home');
  const blocosDoModelo = t.M.assistente.dados.presets.find((p) => p.id === 'escola').home.blocos;
  t.clicar('[data-acao="asst-aplicar-home"]');
  await t.esperar(30);
  const puts = t.pedidosDe('/api/catalogo', 'PUT');
  assert.equal(puts.length, 1);
  const enviado = t.corpoDe(puts[0]);
  assert.equal(enviado.rev, 5, 'a rev lida na hora: o 409 de sempre protege');
  assert.deepEqual(enviado.site.blocos.map((b) => b.tipo), blocosDoModelo.map((b) => b.tipo));
  assert.equal(enviado.site.modeloDeConteudo, 'seriado');
  assert.ok(t.pedidosDe('/api/catalogo', 'GET').some((p) => /completo=1/.test(p.url)));
  assert.match(t.texto(), /Pronto: a página inicial foi publicada \(revisão 6\)\./);
  assert.ok(t.achar('[data-acao="asst-aplicar-home"]').disabled, 'não aplica duas vezes');
  assert.equal(t.M.st.rascunho.length, 0, 'o rascunho ficou limpo');
});

test('home: se já havia alterações no rascunho, a home fica no rascunho junto e NADA é publicado por tabela', async () => {
  const t = await abrir();
  t.M.st.servidor.itens = [{ id: 'a', titulo: 'A', serie: 'S', publicar: true }];
  t.M.st.rascunho = [{ alvo: 'item:a', campo: 'titulo', antes: 'A', depois: 'B' }];
  t.M.st.versao++;
  await avancar(t);
  t.mudar('#asst-preset-escola', true);
  await ate(t, 'home');
  t.clicar('[data-acao="asst-aplicar-home"]');
  await t.esperar(20);
  assert.equal(t.pedidosDe('/api/catalogo', 'PUT').length, 0);
  assert.match(t.texto(), /Você já tinha alterações no rascunho\./);
  assert.ok(t.M.st.rascunho.some((m) => m.alvo === 'site' && m.campo === 'blocos'), 'a home entrou no rascunho');
  assert.ok(t.M.st.rascunho.some((m) => m.alvo === 'item:a'), 'e a alteração de antes continua lá');
});

test('home: se o servidor responde 409 (alguém mexeu), o assistente diz que há conflito e não finge que deu certo', async () => {
  const s = await servidor();
  let primeira = true;
  const rotas = Object.assign({}, s.rotas, {
    '/api/catalogo': (url, init) => {
      if (init && init.method === 'PUT') return resposta({ codigo: 'catalogo-mudou', rev_servidor: 9 }, 409);
      const copia = JSON.parse(JSON.stringify(s.catalogo));
      if (!primeira) { copia.rev = 9; copia.site = { blocos: [{ tipo: 'texto', id: 'outro', texto: { 'pt-BR': 'x' } }] }; }
      primeira = false;
      return copia;
    }
  });
  const t = abrirOperacao({ rotas, servidor: JSON.parse(JSON.stringify(s.catalogo)) });
  t.tela('assistente');
  await t.esperar();
  await avancar(t);
  t.mudar('#asst-preset-escola', true);
  await ate(t, 'home');
  t.clicar('[data-acao="asst-aplicar-home"]');
  await t.esperar(40);
  assert.ok(!/Pronto: a página inicial foi publicada/.test(t.texto()));
  assert.match(t.texto(), /Alguém mudou o catálogo ao mesmo tempo|Não foi possível publicar a página inicial/);
});

/* ------------------------------------------------------------------ pronto */

test('pronto: monta o site.json com as escolhas, lista o que muda e baixa um arquivo válido', async () => {
  const t = await abrir();
  t.digitar('#asst-nome', 'Colégio Horizonte');
  t.digitar('#asst-slogan', 'Aprender juntos');
  t.digitar('#asst-cor-hex', '#0b7285');
  await t.esperar();
  await avancar(t);
  t.mudar('#asst-preset-escola', true);
  await ate(t, 'pronto');
  const config = posts(t, 'config').pop().escolhas;
  assert.deepEqual(Object.keys(config).sort(), ['acesso', 'cor', 'idiomas', 'nome', 'nomeCurto', 'preset', 'provedor', 'slogan', 'tema']);
  assert.equal(config.nome, 'Colégio Horizonte');
  assert.equal(config.acesso, 'cadastro');
  assert.equal(config.cor, '#0b7285');
  assert.deepEqual(config.tema, { preset: 'institucional', modo: 'auto' }, 'o modelo escola sugere o modo automático');
  assert.deepEqual(config.idiomas, { disponiveis: ['pt-BR'], padrao: 'pt-BR' });
  assert.match(passoAtual(t), /Passo 7 de 7: Pronto/);
  assert.match(t.texto(), /Falta publicar a configuração do site/);
  const muda = /O que muda: ([^.]*)\./.exec(t.texto())[1];
  for (const area of ['nome e identidade', 'quem pode ver', 'modelo de uso', 'página inicial padrão']) assert.ok(muda.includes(area), area + ' em: ' + muda);
  assert.match(t.texto(), /Baixe o arquivo site\.json/);
  assert.match(t.texto(), /Commit changes/);
  t.clicar('[data-acao="asst-baixar"]');
  await t.esperar();
  assert.equal(t.baixados.length, 1);
  const arquivo = JSON.parse(await t.baixados[0].text());
  assert.equal(arquivo.marca.nome, 'Colégio Horizonte');
  assert.equal(arquivo.preset, 'escola');
  assert.equal(arquivo.acesso.modo, 'cadastro');
  assert.deepEqual(arquivo.video.bunny.chaveApi, { $env: 'BUNNY_API_KEY' }, 'o arquivo guarda a referência, nunca o valor');
  assert.ok(!JSON.stringify(arquivo).includes('valor-que-nunca-deve-aparecer'));
  assert.match(t.achar('#asst-baixar-estado').textContent, /Arquivo baixado/);
  t.clicar('[data-acao="asst-copiar-json"]');
  await t.esperar();
  assert.equal(JSON.parse(t.copiados[0]).marca.nome, 'Colégio Horizonte');
});

test('pronto: a lista mostra o que está feito e o que falta, com atalho para o passo', async () => {
  const t = await abrir();
  await ate(t, 'pronto');
  const itens = t.todos('.asst-check').map((n) => n.textContent);
  assert.ok(itens.some((i) => /Identidade: Minha Escola/.test(i)));
  assert.ok(itens.some((i) => /Acesso: Privado/.test(i)));
  const video = itens.find((i) => /Vídeo:/.test(i));
  assert.match(video, /Falta/, 'a chave de proteção do vídeo não existe no ambiente de teste');
  assert.match(video, /BUNNY_PULLZONE, BUNNY_TOKEN_KEY|BUNNY_TOKEN_KEY, BUNNY_PULLZONE/);
  assert.ok(itens.some((i) => /Senha do administrador e chave das sessões guardadas/.test(i) && /Pronto/.test(i)));
  assert.ok(itens.some((i) => /Backup/.test(i) && /Falta/.test(i)));
  const ir = t.achar('[data-acao="asst-ir-passo"][data-passo="3"]');
  assert.ok(ir, 'atalho do vídeo');
  t.clicar(ir);
  await t.esperar();
  assert.match(passoAtual(t), /Passo 4/);
});

test('pronto: sem diferença para o arquivo, diz que não há nada a republicar e não oferece download', async () => {
  const t = await abrir({ config: () => ({ ok: true, texto: '{}\n', mudancas: [], precisaRepublicar: false, home: null }) });
  await ate(t, 'pronto');
  assert.match(t.texto(), /não há nada a republicar/);
  assert.ok(!t.achar('[data-acao="asst-baixar"]'));
});

test('pronto: erro do servidor aparece com o texto do código, sem botão de baixar', async () => {
  const t = await abrir({ config: () => resposta({ codigo: 'config-recusada', params: { n: 1 }, erros: [{ campo: 'cor', codigo: 'cor-invalida' }] }, 400) });
  await ate(t, 'acesso');
  t.clicar('[data-acao="asst-avancar"]');
  await t.esperar();
  assert.match(t.texto(), /A cor precisa estar no formato #rrggbb/);
  assert.match(passoAtual(t), /Passo 3/);
});

test('concluir grava "concluido" no servidor e leva à tela Saúde; "Agora não" grava "dispensado"', async () => {
  const t = await abrir();
  await ate(t, 'pronto');
  t.clicar('[data-acao="asst-concluir"]');
  await t.esperar();
  assert.deepEqual(t.s.salvos.filter((x) => x.assistente), [{ assistente: 'concluido' }]);
  assert.equal(t.M.st.tela, 'saude');
  assert.match(t.aviso.textContent, /Assistente concluído/);

  const outra = await abrir();
  outra.clicar('[data-acao="asst-dispensar"]');
  await outra.esperar();
  assert.deepEqual(outra.s.salvos.filter((x) => x.assistente), [{ assistente: 'dispensado' }]);
  assert.equal(outra.M.st.tela, 'saude');
  assert.match(outra.aviso.textContent, /Você pode abrir o assistente de novo pelo menu/);
});

test('o assistente não grava nada sozinho: só a home (se pedida), o estado dele e nunca o config', async () => {
  const t = await abrir();
  await ate(t, 'pronto');
  const escritas = t.pedidos.filter((p) => p.metodo !== 'GET' && !(p.metodo === 'POST' && /\/api\/saude$/.test(p.url)));
  assert.deepEqual(escritas, [], 'até aqui, só leituras e contas (POST de cálculo)');
});

/* ------------------------------------------------------------------ segurança e acessibilidade, em todos os passos */

test('em NENHUM passo há campo de senha ou chave, e nenhum pedido leva valor de segredo', async () => {
  const t = await abrir();
  await ate(t, 'pronto');
  for (let passo = 0; passo < 7; passo++) {
    t.clicar('[data-acao="asst-ir-passo"][data-passo="' + passo + '"]');
    await t.esperar();
    assert.equal(t.todos('input[type="password"]').length, 0, 'passo ' + (passo + 1));
    assert.equal(t.todos('textarea').length, 0, 'passo ' + (passo + 1));
    for (const campo of t.todos('input[type="text"]')) assert.ok(['asst-nome', 'asst-nome-curto', 'asst-slogan', 'asst-cor-hex', 'asst-hls'].includes(campo.id), 'campo inesperado: ' + campo.id);
    assert.ok(!t.texto().includes('valor-que-nunca-deve-aparecer'));
  }
  for (const p of t.pedidos) assert.ok(!String(p.corpo || '').includes('valor-que-nunca-deve-aparecer'));
  for (const c of posts(t)) for (const chave of Object.keys(c.escolhas || {})) assert.ok(!/senha|chave|segredo|token|secret|password/i.test(chave), chave);
});

test('acessibilidade: cada campo tem rótulo, cada grupo tem legenda, e o foco vai para o título a cada passo', async () => {
  const t = await abrir();
  for (let passo = 0; passo < 7; passo++) {
    t.clicar('[data-acao="asst-ir-passo"][data-passo="' + passo + '"]');
    await t.esperar();
    assert.equal(t.doc.activeElement && t.doc.activeElement.id, 'asst-titulo-passo', 'o foco segue o passo ' + (passo + 1));
    assert.equal(t.achar('#asst-titulo-passo').getAttribute('tabindex'), '-1');
    assert.equal(t.todos('[aria-current="step"]').length, 1);
    for (const campo of t.todos('input').concat(t.todos('select'))) {
      const rotulado = campo.getAttribute('aria-label') || t.todos('label').some((l) => l.getAttribute('for') === campo.id || l.contains(campo));
      assert.ok(rotulado, 'campo sem rótulo no passo ' + (passo + 1) + ': ' + campo.id);
    }
    for (const botao of t.todos('button')) assert.ok(botao.textContent.trim().length > 0 || botao.getAttribute('aria-label'), 'botão sem nome');
    for (const grupo of t.todos('fieldset')) assert.ok(grupo.querySelector('legend'), 'grupo sem legenda');
  }
});

test('a trilha é navegável por teclado (botões de verdade) e o botão Voltar some no primeiro passo', async () => {
  const t = await abrir();
  assert.ok(t.todos('.asst-trilha-botao').every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button'));
  assert.ok(t.achar('[data-acao="asst-voltar"]').disabled);
  await avancar(t);
  assert.ok(!t.achar('[data-acao="asst-voltar"]').disabled);
  t.clicar('[data-acao="asst-voltar"]');
  await t.esperar();
  assert.match(passoAtual(t), /Passo 1/);
});

test('em inglês e em espanhol o assistente inteiro sai no idioma, sem chave crua', async () => {
  for (const [idioma, titulo] of [['en', /Step 1 of 7: Identity/], ['es', /Paso 1 de 7: Identidad/]]) {
    const t = await abrir({ mesa: { idioma } });
    for (let passo = 0; passo < 7; passo++) {
      t.clicar('[data-acao="asst-ir-passo"][data-passo="' + passo + '"]');
      await t.esperar();
      if (passo === 0) assert.match(passoAtual(t), titulo);
      assert.ok(!/assistente\.|saude\.|backup\.|custos\./.test(t.texto()), idioma + ' passo ' + (passo + 1) + ': chave crua na tela');
      assert.ok(!/assistente\./.test(t.painelDir.textContent), idioma + ': chave crua no painel');
    }
  }
});
