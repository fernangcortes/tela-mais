/* M8 — o assistente de configuração, lado do servidor (_lib/assistente.js e POST/GET /api/saude).
 *
 * O que se confere:
 *   - a conta de cor é a MESMA do `setup.mjs marca` e a régua é a do validador (contraste.mjs): o que o assistente aprova, o deploy aprova;
 *   - o config/site.json gerado passa no validador, mantém as referências `{$env}` e NUNCA leva valor de segredo;
 *   - escolha inválida volta como erro com código (o navegador traduz), sem arquivo;
 *   - os presets de uso, a home que eles trazem e a lista de variáveis do provedor batem com o que o setup e o schema dizem. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ambiente, configDe, criarWorker, cliente, tokenDoSuper } = require('./fixtures/contas-ambiente.js');

const RAIZ = path.join(__dirname, '..');
const mod = (nome) => import('../core/worker/' + nome);
const AppHome = require('../core/site/home-blocos.js');

test('cor da marca: a conta do assistente é a do `setup.mjs marca` (mesma paleta, mesmo ajuste)', async () => {
  const { derivarPaleta } = await mod('_lib/assistente.js');
  const { derivarPaleta: doSetup } = await import('../scripts/lib/setup/cmd-marca.mjs');
  const { resolverTema } = await mod('_lib/tema.mjs');
  for (const cor of ['#0b7285', '#e11d48', '#f5d90a', '#ffffff', '#101010', '#7c3aed']) {
    for (const preset of ['cinema', 'claro', 'institucional']) {
      const tema = resolverTema({ tema: { preset, modo: 'auto' } });
      for (const esq of ['escuro', 'claro']) {
        assert.deepEqual(derivarPaleta(cor, esq, tema.cores[esq]), doSetup(cor, esq, tema.cores[esq]), `${cor} ${preset} ${esq}`);
      }
    }
  }
});

test('avaliar a marca: razões que a pessoa entende, cor ajustada quando não se lê, paleta sempre aprovada pelo validador', async () => {
  const { avaliarMarca } = await mod('_lib/assistente.js');
  const { contraste } = await mod('_lib/contraste.mjs');
  /* amarelo vivo sobre fundo claro não tem contraste: o assistente propõe o mais próximo que se lê */
  const claro = avaliarMarca({ cor: '#f5d90a', tema: { preset: 'claro', modo: 'claro' } });
  assert.equal(claro.ok, true);
  assert.deepEqual(Object.keys(claro.esquemas), ['claro']);
  const e = claro.esquemas.claro;
  assert.equal(e.pedida, '#f5d90a');
  assert.equal(e.ajustada, true);
  assert.notEqual(e.usada, e.pedida);
  assert.ok(contraste(e.usada, e.paleta.fundo) >= 4.5, 'a cor usada tem de passar de 4,5:1 sobre o fundo');
  assert.ok(e.razaoDaPedida < 4.5, 'a pedida reprovava');
  assert.deepEqual(e.falhas, [], 'a paleta derivada não tem falha de contraste');
  for (const k of ['texto', 'textoFraco', 'link', 'botao']) assert.ok(e.razoes[k] >= 4.5, k);

  /* cor boa fica como está */
  const boa = avaliarMarca({ cor: '#0b7285', tema: { preset: 'claro', modo: 'claro' } }).esquemas.claro;
  assert.equal(boa.ajustada, false);
  assert.equal(boa.usada, '#0b7285');

  /* modo auto mostra os dois esquemas; sem cor, é o tema como veio */
  const auto = avaliarMarca({ tema: { preset: 'cinema', modo: 'auto' } });
  assert.deepEqual(Object.keys(auto.esquemas).sort(), ['claro', 'escuro']);
  assert.equal(auto.esquemas.escuro.pedida, null);
  assert.equal(auto.esquemas.escuro.razaoDaPedida, null);

  /* tema e modo desconhecidos caem no padrão em vez de quebrar */
  assert.equal(avaliarMarca({ tema: { preset: 'nao-existe', modo: 'nao-existe' } }).ok, true);
});

test('avaliar a marca: hex inválido volta com o campo, nada de exceção; #rgb curto vale', async () => {
  const { avaliarMarca } = await mod('_lib/assistente.js');
  assert.deepEqual(avaliarMarca({ cor: 'vermelho' }), { ok: false, codigo: 'cor-invalida', campo: 'cor' });
  assert.deepEqual(avaliarMarca({ cor: '#fff', corClara: 'xx' }), { ok: false, codigo: 'cor-invalida', campo: 'corClara' });
  assert.deepEqual(avaliarMarca({ cor: '#12345' }), { ok: false, codigo: 'cor-invalida', campo: 'cor' });
  assert.equal(avaliarMarca({ cor: '#08f', tema: { modo: 'escuro' } }).ok, true);
  assert.equal(avaliarMarca(null).ok, true);
  assert.equal(avaliarMarca('lixo').ok, true);
});

test('o config gerado passa no validador do deploy e só muda o que foi escolhido', async () => {
  const { gerarConfig, ARQUIVO_DE_IMPLANTACAO, ESQUEMA_DA_CONFIG } = await mod('_lib/assistente.js');
  const { validarConfig } = await mod('_lib/config-validar.mjs');
  const r = gerarConfig(ARQUIVO_DE_IMPLANTACAO, {
    preset: 'escola', nome: 'Escola Horizonte', slogan: 'Aprender juntos', cor: '#0b7285',
    tema: { preset: 'institucional', modo: 'auto' }, acesso: 'privado', provedor: 'cloudflare-stream',
    idiomas: { disponiveis: ['pt-BR', 'en'], padrao: 'pt-BR' }
  });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.equal(validarConfig(ESQUEMA_DA_CONFIG, r.config).ok, true);
  assert.deepEqual(JSON.parse(r.texto), r.config, 'o texto baixado é o config');
  assert.ok(r.texto.endsWith('\n'));
  assert.equal(r.config.marca.nome, 'Escola Horizonte');
  assert.equal(r.config.marca.nomeCurto, 'Escola');
  assert.equal(r.config.marca.organizacao, 'Escola Horizonte', 'a organização de exemplo não sobra');
  assert.equal(r.config.preset, 'escola');
  assert.equal(r.config.acesso.modo, 'privado');
  assert.equal(r.config.acesso.privado.assinarMidia, true);
  assert.equal(r.config.video.provedor, 'cloudflare-stream');
  assert.equal(r.config.tema.cores.escuro.marca !== undefined, true);
  assert.deepEqual(r.config.idiomas.disponiveis, ['pt-BR', 'en']);
  assert.ok(r.mudancas.includes('marca.nome'));
  assert.ok(r.mudancas.includes('acesso.modo'));
  assert.equal(r.precisaRepublicar, true);
  assert.ok(!r.texto.includes('Plataforma Exemplo') || r.config.marca.descricao.includes('Plataforma Exemplo'), 'nome do exemplo só onde o arquivo original o trazia');
});

test('as referências de segredo continuam sendo {$env}; nenhum valor de segredo entra no arquivo gerado', async () => {
  const { gerarConfig, ARQUIVO_DE_IMPLANTACAO } = await mod('_lib/assistente.js');
  const r = gerarConfig(ARQUIVO_DE_IMPLANTACAO, { nome: 'Teste', provedor: 'bunny' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.video.bunny.chaveApi, { $env: 'BUNNY_API_KEY' });
  /* um valor literal no lugar do segredo é recusado pelo validador, nunca gravado */
  const sujo = JSON.parse(JSON.stringify(ARQUIVO_DE_IMPLANTACAO));
  sujo.video.bunny.chaveApi = 'valor-em-texto-puro-1234567890';
  const recusado = gerarConfig(sujo, { nome: 'Teste' });
  assert.equal(recusado.ok, false);
  assert.equal(recusado.erros[0].codigo, 'config-recusada');
  assert.equal(recusado.texto, undefined);
});

test('escolha inválida volta com código e campo, sem arquivo', async () => {
  const { gerarConfig, ARQUIVO_DE_IMPLANTACAO } = await mod('_lib/assistente.js');
  const casos = [
    [{ preset: 'inventado' }, 'preset', 'preset-desconhecido'],
    [{ nome: '' }, 'nome', 'nome-invalido'],
    [{ nome: 'x'.repeat(61) }, 'nome', 'nome-invalido'],
    [{ nomeCurto: 'x'.repeat(13) }, 'nomeCurto', 'nome-curto-invalido'],
    [{ slogan: 'x'.repeat(121) }, 'slogan', 'slogan-longo'],
    [{ tema: { preset: 'neon' } }, 'tema.preset', 'tema-desconhecido'],
    [{ tema: { modo: 'noite' } }, 'tema.modo', 'modo-de-tema-invalido'],
    [{ cor: 'azul' }, 'cor', 'cor-invalida'],
    [{ acesso: 'aberto' }, 'acesso', 'modo-de-acesso-invalido'],
    [{ provedor: 'vimeo' }, 'provedor', 'provedor-desconhecido'],
    [{ hlsBaseUrl: 'http://sem-https.exemplo.test' }, 'hlsBaseUrl', 'endereco-invalido'],
    [{ idiomas: { disponiveis: [] } }, 'idiomas.disponiveis', 'idiomas-invalidos'],
    [{ idiomas: { disponiveis: ['pt-BR', 'pt-BR'] } }, 'idiomas.disponiveis', 'idiomas-invalidos'],
    [{ idiomas: { disponiveis: ['portugues'] } }, 'idiomas.disponiveis', 'idiomas-invalidos'],
    [{ idiomas: { disponiveis: ['pt-BR'], padrao: 'en' } }, 'idiomas.padrao', 'idioma-padrao-fora-da-lista'],
    [{ projeto: 'Nome Com Espaço' }, 'projeto', 'projeto-invalido']
  ];
  for (const [escolhas, campo, codigo] of casos) {
    const r = gerarConfig(ARQUIVO_DE_IMPLANTACAO, escolhas);
    assert.equal(r.ok, false, JSON.stringify(escolhas));
    assert.ok(r.erros.some((e) => e.campo === campo && e.codigo === codigo), `${JSON.stringify(escolhas)} -> ${JSON.stringify(r.erros)}`);
    assert.equal(r.texto, undefined);
  }
  /* escolhas que o validador (e não o assistente) reprova: privado com HLS genérico deixaria o vídeo aberto */
  const r = gerarConfig(ARQUIVO_DE_IMPLANTACAO, { acesso: 'privado', provedor: 'hls-generico', hlsBaseUrl: 'https://v.exemplo.test/acervo' });
  assert.equal(r.ok, false);
  assert.equal(r.erros[0].codigo, 'config-recusada');
  assert.match(r.erros[0].params.detalhe, /hls-generico|assin/);
  assert.equal(gerarConfig(ARQUIVO_DE_IMPLANTACAO, null).ok, true, 'sem escolhas, devolve o arquivo como está');
  assert.deepEqual(gerarConfig(ARQUIVO_DE_IMPLANTACAO, {}).mudancas, []);
  assert.equal(gerarConfig(ARQUIVO_DE_IMPLANTACAO, {}).precisaRepublicar, false);
});

test('cadastro sem e-mail nasce com e-mail e senha (funciona sem serviço de e-mail), como no setup', async () => {
  const { gerarConfig, ARQUIVO_DE_IMPLANTACAO } = await mod('_lib/assistente.js');
  const r = gerarConfig(ARQUIVO_DE_IMPLANTACAO, { acesso: 'cadastro' });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.equal(r.config.acesso.cadastro.metodo, 'email-e-senha');
  assert.equal(r.config.acesso.cadastro.verificarEmail, false);
});

test('todo preset de uso é aplicável, gera config válido e traz uma home que o PUT do catálogo aceita', async () => {
  const { listarPresetsDeUso, gerarConfig, homeDoPreset, ARQUIVO_DE_IMPLANTACAO } = await mod('_lib/assistente.js');
  const presets = listarPresetsDeUso();
  const arquivos = fs.readdirSync(path.join(RAIZ, 'core', 'presets')).filter((n) => n.endsWith('.json'));
  assert.equal(presets.length, arquivos.length, 'um preset novo em core/presets precisa entrar no assistente (assistente.js)');
  for (const p of presets) {
    const r = gerarConfig(ARQUIVO_DE_IMPLANTACAO, { preset: p.id, nome: 'Teste ' + p.id });
    assert.equal(r.ok, true, p.id + ': ' + JSON.stringify(r.erros));
    const home = homeDoPreset(p.id);
    assert.ok(home.blocos.length > 0, p.id + ' sem blocos');
    assert.deepEqual(AppHome.blocosInvalidos(home.blocos), [], p.id);
    assert.ok(['seriado', 'avulso', null].includes(home.modeloDeConteudo));
    assert.ok(p.nome && p.resumo, p.id + ' sem nome ou resumo');
  }
  assert.equal(homeDoPreset('inventado'), null);
});

test('variáveis do provedor: as mesmas do setup (o que é id e o que é senha), e só "presente" sai', async () => {
  const { NAO_SECRETAS, CREDENCIAIS_DE_ASSINATURA, descreverProvedor, listarPresetsDeUso } = await mod('_lib/assistente.js');
  const cred = await import('../scripts/lib/setup/credenciais.mjs');
  assert.deepEqual([...NAO_SECRETAS].sort(), [...cred.NAO_SECRETAS].sort());
  assert.deepEqual(CREDENCIAIS_DE_ASSINATURA, cred.CREDENCIAIS_DE_ASSINATURA);
  const env = { BUNNY_API_KEY: 'valor-que-nao-pode-sair', BUNNY_LIBRARY_ID: '1234' };
  const d = descreverProvedor('bunny', {}, env);
  assert.equal(d.credenciais.find((c) => c.env === 'BUNNY_API_KEY').presente, true);
  assert.equal(d.credenciais.find((c) => c.env === 'BUNNY_API_KEY').secreta, true);
  assert.equal(d.credenciais.find((c) => c.env === 'BUNNY_PULLZONE').presente, false);
  assert.equal(d.credenciais.find((c) => c.env === 'BUNNY_PULLZONE').assinatura, true);
  assert.ok(!JSON.stringify(d).includes('valor-que-nao-pode-sair'));
  assert.equal(d.capacidades.envio, true);
  assert.equal(descreverProvedor('hls-generico', {}, {}).capacidades.assinatura, false);
  assert.equal(d.capacidades.assinatura, true, 'o Bunny SABE assinar, mesmo sem as chaves ainda');
  assert.equal(descreverProvedor('cloudflare-stream', {}, {}).capacidades.assinatura, true);
  assert.equal(descreverProvedor('hls-generico', {}, {}).capacidades.envio, false, 'o HLS genérico não recebe envio pelo painel');
  assert.equal(descreverProvedor('inexistente', {}, {}), null);
  /* variável renomeada na config: o assistente mostra o nome que a config usa */
  const renomeada = descreverProvedor('bunny', { video: { bunny: { chaveApi: { $env: 'MINHA_CHAVE_DO_BUNNY' } } } }, { MINHA_CHAVE_DO_BUNNY: 'x' });
  assert.equal(renomeada.credenciais.find((c) => c.nome === 'chaveApi').env, 'MINHA_CHAVE_DO_BUNNY');
  assert.equal(renomeada.credenciais.find((c) => c.nome === 'chaveApi').presente, true);
  assert.ok(listarPresetsDeUso().every((p) => p.sugere && Array.isArray(p.sugere.blocos)));
});

test('GET /api/saude?assistente=1: o ponto de partida sai do arquivo de implantação e traz o estado, sem segredo', async () => {
  const env = ambiente({ BUNNY_API_KEY: 'chave-que-nao-pode-vazar-9876' });
  const worker = await criarWorker(configDe({ modo: 'privado' }, { video: { provedor: 'bunny' } }));
  const token = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);
  const r = await c.get('/api/saude?assistente=1', { token });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.estado.estado, 'pendente');
  assert.equal(typeof r.json.atual.marca.nome, 'string');
  assert.ok(['publico', 'cadastro', 'privado'].includes(r.json.atual.acesso));
  assert.deepEqual(r.json.provedores.map((p) => p.id).sort(), ['bunny', 'cloudflare-stream', 'hls-generico']);
  assert.equal(r.json.presets.length, 7);
  assert.ok(r.json.temas.some((t) => t.id === 'cinema'));
  assert.deepEqual(r.json.idiomasDoProduto, ['pt-BR', 'en', 'es']);
  assert.ok(!r.texto.includes('chave-que-nao-pode-vazar-9876'));
  assert.ok(!r.texto.includes('senha-do-super'));
});

test('POST /api/saude: marca e config só pelo superadmin; erro vira código traduzível', async () => {
  const env = ambiente();
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const token = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);

  const ok = await c.post('/api/saude', { acao: 'marca', cor: '#0b7285', tema: { preset: 'claro', modo: 'claro' } }, { token });
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(ok.json.esquemas.claro.usada, '#0b7285');

  const ruim = await c.post('/api/saude', { acao: 'marca', cor: 'azul' }, { token });
  assert.equal(ruim.status, 400);
  assert.equal(ruim.json.codigo, 'cor-invalida');
  assert.equal(ruim.json.campo, 'cor');

  const cfg = await c.post('/api/saude', { acao: 'config', escolhas: { preset: 'igreja', nome: 'Igreja Central' } }, { token });
  assert.equal(cfg.status, 200, cfg.texto);
  assert.equal(JSON.parse(cfg.json.texto).marca.nome, 'Igreja Central');
  assert.ok(cfg.json.home.blocos.length > 0, 'a home do preset vai junto, para o assistente gravar no catálogo');
  assert.equal(cfg.json.precisaRepublicar, true);

  const negado = await c.post('/api/saude', { acao: 'config', escolhas: { acesso: 'aberto' } }, { token });
  assert.equal(negado.status, 400);
  assert.equal(negado.json.codigo, 'config-recusada');
  assert.equal(negado.json.erros[0].campo, 'acesso');
  assert.equal(negado.json.erros[0].codigo, 'modo-de-acesso-invalido');
});

test('o assistente não grava config/site.json nem mexe no catálogo: gerar é só calcular', async () => {
  const env = ambiente();
  const worker = await criarWorker(configDe({ modo: 'privado' }));
  const token = await tokenDoSuper(worker, env);
  const c = cliente(worker, env);
  const antes = JSON.stringify(env.CATALOGO.dados);
  const arquivo = fs.readFileSync(path.join(RAIZ, 'config', 'site.json'), 'utf8');
  await c.post('/api/saude', { acao: 'config', escolhas: { preset: 'empresa', nome: 'Empresa X', acesso: 'publico' } }, { token });
  await c.post('/api/saude', { acao: 'marca', cor: '#112233' }, { token });
  assert.equal(JSON.stringify(env.CATALOGO.dados), antes);
  assert.equal(fs.readFileSync(path.join(RAIZ, 'config', 'site.json'), 'utf8'), arquivo);
});
