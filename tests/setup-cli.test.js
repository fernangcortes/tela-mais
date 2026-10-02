// setup.mjs: init, marca, acesso, status, ajuda e códigos de saída. Sem rede: wrangler e fetch são simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { criarProjeto, rodar, criarMundo, criarPerguntas, lerSiteJson, lerArq, existe } from './setup-falso.js';
import { dimensoesDoPng } from '../scripts/lib/setup/marca-icones.mjs';
import { validarConfig } from '../core/worker/_lib/config-validar.mjs';

const schema = () => JSON.parse(readFileSync(new URL('../config/site.schema.json', import.meta.url), 'utf8'));
const valida = (raiz) => validarConfig(schema(), lerSiteJson(raiz));

test('ajuda: sem comando mostra a lista e sai 2; --help sai 0; comando desconhecido sai 2', async () => {
  const raiz = criarProjeto();
  const a = await rodar([], { raiz });
  assert.equal(a.codigo, 2);
  assert.match(a.out, /doctor/);
  assert.equal((await rodar(['--help'], { raiz })).codigo, 0);
  const h = await rodar(['init', '--help'], { raiz });
  assert.equal(h.codigo, 0);
  assert.match(h.out, /--preset/);
  const x = await rodar(['voar', '--json'], { raiz });
  assert.equal(x.codigo, 2);
  assert.equal(x.json.ok, false);
  assert.equal(x.json.codigoDeSaida, 2);
  const y = await rodar(['status', '--nao-existe'], { raiz });
  assert.equal(y.codigo, 2);
});

test('formato --json: um único objeto com os campos combinados', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['status', '--offline', '--json'], { raiz });
  assert.equal(r.codigo, 0);
  for (const k of ['versao', 'comando', 'ok', 'codigoDeSaida', 'dryRun', 'resumo', 'mensagens', 'acoes', 'checagens', 'pendencias', 'dados', 'proximoPasso']) assert.ok(k in r.json, k);
  assert.equal(r.json.versao, 1);
  assert.equal(r.json.comando, 'status');
  assert.ok(Array.isArray(r.json.dados.etapas));
  assert.equal(r.json.dados.proximaEtapa, 'identidade');
});

test('init: por flags monta o config (preset + nome + acesso + vídeo + idiomas) e o config é válido', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['init', '--nome', 'Escola Aurora', '--preset', 'escola', '--acesso', 'privado', '--video', 'cloudflare-stream', '--idiomas', 'pt-BR,en', '--json'], { raiz });
  assert.equal(r.codigo, 0, r.tudo);
  const c = lerSiteJson(raiz);
  assert.equal(c.preset, 'escola');
  assert.equal(c.marca.nome, 'Escola Aurora');
  assert.equal(c.acesso.modo, 'privado');
  assert.equal(c.video.provedor, 'cloudflare-stream');
  assert.deepEqual(c.idiomas.disponiveis, ['pt-BR', 'en']);
  assert.equal(c.implantacao.nomeDoProjeto, 'escola-aurora');
  assert.equal(c.home.blocos[0].tipo, 'destaque');
  assert.equal(valida(raiz).ok, true);
  assert.match(lerArq(raiz, 'wrangler.jsonc'), /"name": "escola-aurora"/);
  assert.match(lerArq(raiz, 'wrangler.jsonc'), /"database_name": "escola-aurora"/);
  assert.match(lerArq(raiz, 'wrangler.jsonc'), /^\/\/ wrangler\.jsonc/m, 'os comentários do wrangler.jsonc continuam lá');
  assert.match(lerArq(raiz, 'core/site/theme.css'), /--/, 'aplicar-config rodou');
  assert.equal(r.json.dados.escolhas.preset, 'escola');
});

test('init é idempotente: a segunda vez não muda arquivo nenhum', async () => {
  const raiz = criarProjeto();
  const args = ['init', '--nome', 'Escola Aurora', '--preset', 'igreja', '--acesso', 'publico', '--json'];
  await rodar(args, { raiz });
  const antes = lerArq(raiz, 'config/site.json');
  const wr = lerArq(raiz, 'wrangler.jsonc');
  const r = await rodar(args, { raiz });
  assert.equal(r.codigo, 0);
  assert.equal(lerArq(raiz, 'config/site.json'), antes);
  assert.equal(lerArq(raiz, 'wrangler.jsonc'), wr);
  assert.ok(r.json.acoes.every((a) => a.estado !== 'feito'), JSON.stringify(r.json.acoes));
});

test('init --cloudflare duas vezes não duplica KV nem D1', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo();
  const args = ['init', '--nome', 'Minha Tela', '--preset', 'criador', '--cloudflare', '--json'];
  const a = await rodar(args, { raiz, mundo });
  assert.equal(a.codigo, 0, a.tudo);
  const b = await rodar(args, { raiz, mundo });
  assert.equal(b.codigo, 0, b.tudo);
  assert.equal(mundo.kv.length, 1);
  assert.equal(mundo.d1.length, 1);
  assert.equal(mundo.chamadas.filter((c) => c.args.includes('create')).length, 2, 'um create de KV e um de D1, só');
  assert.match(lerArq(raiz, 'wrangler.jsonc'), new RegExp(`"id": "${mundo.kv[0].id}"`));
  assert.match(lerArq(raiz, 'wrangler.jsonc'), new RegExp(`"database_id": "${mundo.d1[0].uuid}"`));
});

test('init --dry-run não escreve nada; sem respostas e sem terminal sai 3 dizendo o que falta', async () => {
  const raiz = criarProjeto();
  const antes = lerArq(raiz, 'config/site.json');
  const d = await rodar(['init', '--nome', 'X Y Z', '--preset', 'escola', '--dry-run', '--json'], { raiz });
  assert.equal(d.codigo, 0);
  assert.equal(d.json.dryRun, true);
  assert.equal(lerArq(raiz, 'config/site.json'), antes);
  assert.ok(d.json.acoes.every((a) => a.estado === 'simulado' || a.estado === 'ja-estava'));
  const p = await rodar(['init', '--json'], { raiz });
  assert.equal(p.codigo, 3);
  assert.equal(p.json.pendencias[0].codigo, 'init-faltam-respostas');
  assert.deepEqual(p.json.dados.detalhes.faltam, ['--nome', '--preset']);
  assert.equal(p.json.dados.detalhes.presets.length, 7);
});

test('init valida as respostas: preset, acesso e provedor inexistentes saem 2', async () => {
  const raiz = criarProjeto();
  assert.equal((await rodar(['init', '--preset', 'academia', '--nome', 'A B C'], { raiz })).codigo, 2);
  assert.equal((await rodar(['init', '--acesso', 'talvez', '--nome', 'A B C', '--preset', 'escola'], { raiz })).codigo, 2);
  assert.equal((await rodar(['init', '--video', 'youtube', '--nome', 'A B C', '--preset', 'escola'], { raiz })).codigo, 2);
});

test('init: provedor que não assina com acesso restrito é recusado pelo validador e nada é gravado', async () => {
  const raiz = criarProjeto();
  const antes = lerArq(raiz, 'config/site.json');
  const r = await rodar(['init', '--nome', 'Empresa Alfa', '--preset', 'empresa', '--video', 'hls-generico', '--json'], { raiz });
  assert.equal(r.codigo, 1);
  assert.match(r.json.acoes.at(-1).descricao, /hls-generico/);
  assert.equal(lerArq(raiz, 'config/site.json'), antes);
});

test('init interativo: pergunta nome, tipo, acesso, vídeo e idiomas', async () => {
  const raiz = criarProjeto();
  const perguntas = criarPerguntas({ texto: ['Festival Lua', 'pt-BR, es'], escolher: ['festival', 'publico', 'bunny'], confirmar: [false] });
  const r = await rodar(['init'], { raiz, perguntas });
  assert.equal(r.codigo, 0, r.tudo);
  const c = lerSiteJson(raiz);
  assert.equal(c.marca.nome, 'Festival Lua');
  assert.equal(c.preset, 'festival');
  assert.equal(c.catalogo.modeloDeConteudo, 'avulso');
  assert.deepEqual(c.idiomas.disponiveis, ['pt-BR', 'es']);
  assert.equal(perguntas.feitas.filter((f) => f[0] === 'escolher').length, 3);
});

test('acesso: cadastro sem e-mail usa senha e sem verificação; voltar para público exige autorização', async () => {
  const raiz = criarProjeto();
  const a = await rodar(['acesso', '--modo', 'signup', '--json'], { raiz });
  assert.equal(a.codigo, 0, a.tudo);
  const c = lerSiteJson(raiz);
  assert.equal(c.acesso.modo, 'cadastro');
  assert.equal(c.acesso.cadastro.metodo, 'email-e-senha');
  assert.equal(valida(raiz).ok, true);
  const b = await rodar(['acesso', '--modo', 'privado', '--json'], { raiz });
  assert.equal(b.codigo, 0);
  assert.equal(lerSiteJson(raiz).acesso.privado.assinarMidia, true);
  const sem = await rodar(['acesso', '--modo', 'publico', '--json'], { raiz });
  assert.equal(sem.codigo, 3);
  assert.equal(sem.json.pendencias[0].codigo, 'confirmar-publico');
  assert.equal(lerSiteJson(raiz).acesso.modo, 'privado', 'nada mudou sem autorização');
  const com = await rodar(['acesso', '--modo', 'publico', '--yes', '--json'], { raiz });
  assert.equal(com.codigo, 0);
  assert.equal(lerSiteJson(raiz).acesso.modo, 'publico');
  assert.equal((await rodar(['acesso', '--modo', 'aberto'], { raiz })).codigo, 2);
});

test('marca: cor sem contraste é ajustada para o mesmo tom legível e o config continua válido', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['marca', '--nome', 'Rede Sol', '--cor', '#ffee00', '--yes', '--json'], { raiz });
  assert.equal(r.codigo, 0, r.tudo);
  const c = lerSiteJson(raiz);
  assert.equal(c.marca.nome, 'Rede Sol');
  assert.ok(c.tema.cores.escuro.marca && c.tema.cores.claro.marca);
  assert.notEqual(c.tema.cores.claro.marca, '#ffee00', 'amarelo sobre fundo claro não lê: ajustado');
  assert.ok(r.json.mensagens.some((m) => /contraste/.test(m)));
  assert.equal(valida(raiz).ok, true);
});

test('marca: gera ícones PNG nos tamanhos certos e é idempotente', async () => {
  const raiz = criarProjeto();
  await rodar(['marca', '--nome', 'Rede Sol', '--cor', '#0b7285', '--yes'], { raiz });
  const png = (n) => readFileSync(path.join(raiz, 'core/site/marca', n));
  assert.deepEqual(dimensoesDoPng(png('icone-512.png')), { largura: 512, altura: 512 });
  assert.deepEqual(dimensoesDoPng(png('icone-192.png')), { largura: 192, altura: 192 });
  assert.deepEqual(dimensoesDoPng(png('favicon-32.png')), { largura: 32, altura: 32 });
  assert.deepEqual(dimensoesDoPng(png('og-image.png')), { largura: 1200, altura: 630 });
  assert.match(readFileSync(path.join(raiz, 'core/site/marca/icone.svg'), 'utf8'), /<svg/);
  const c = lerSiteJson(raiz);
  assert.equal(c.marca.arquivos.icone512, 'marca/icone-512.png');
  const antes = lerArq(raiz, 'config/site.json');
  const r = await rodar(['marca', '--nome', 'Rede Sol', '--cor', '#0b7285', '--yes', '--json'], { raiz });
  assert.equal(r.codigo, 0);
  assert.equal(lerArq(raiz, 'config/site.json'), antes);
  assert.ok(r.json.acoes.filter((a) => a.id.startsWith('imagem:')).every((a) => a.estado === 'ja-estava'));
});

test('marca: aceita logo SVG e PNG, recusa SVG com script, arquivo estranho e ícone de tamanho errado', async () => {
  const raiz = criarProjeto();
  const svg = path.join(raiz, 'logo.svg');
  writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#123456"/></svg>');
  const a = await rodar(['marca', '--logo', svg, '--json'], { raiz });
  assert.equal(a.codigo, 0, a.tudo);
  const c = lerSiteJson(raiz);
  assert.equal(c.marca.arquivos.logoParaFundoEscuro, 'marca/logo-escuro.svg');
  assert.deepEqual(c.marca.arquivos.logoTamanho, { largura: 144, altura: 48 });
  assert.ok(existe(raiz, 'core/site/marca/logo-escuro.svg'));

  const ruim = path.join(raiz, 'ruim.svg');
  writeFileSync(ruim, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await rodar(['marca', '--logo', ruim], { raiz })).codigo, 2);
  const gif = path.join(raiz, 'a.gif'); writeFileSync(gif, 'GIF89a');
  assert.equal((await rodar(['marca', '--logo', gif], { raiz })).codigo, 2);
  assert.equal((await rodar(['marca', '--logo', path.join(raiz, 'nao-existe.png')], { raiz })).codigo, 2);

  const png = path.join(raiz, 'p.png');
  await rodar(['marca', '--cor', '#0b7285', '--yes'], { raiz });
  writeFileSync(png, readFileSync(path.join(raiz, 'core/site/marca/icone-192.png')));
  assert.equal((await rodar(['marca', '--icone-512', png], { raiz })).codigo, 2, '192 não serve de 512');
  const b = await rodar(['marca', '--logo', png, '--icone-192', png, '--json'], { raiz });
  assert.equal(b.codigo, 0, b.tudo);
  assert.deepEqual(lerSiteJson(raiz).marca.arquivos.logoTamanho, { largura: 192, altura: 192 });
  assert.equal((await rodar(['marca', '--cor', 'azul'], { raiz })).codigo, 2);
});

test('marca: sem opções e sem terminal não faz nada (sai 0)', async () => {
  const raiz = criarProjeto();
  const r = await rodar(['marca', '--json'], { raiz });
  assert.equal(r.codigo, 0);
  assert.equal(r.json.dados.mudou, false);
});

test('status: indica a próxima etapa conforme o projeto avança', async () => {
  const raiz = criarProjeto();
  const mundo = criarMundo({ logado: false });
  let s = await rodar(['status', '--json'], { raiz, mundo });
  assert.equal(s.json.dados.proximaEtapa, 'identidade');
  await rodar(['init', '--nome', 'Rede Sol', '--preset', 'criador'], { raiz, mundo });
  s = await rodar(['status', '--json'], { raiz, mundo });
  assert.equal(s.json.dados.proximaEtapa, 'cloudflare');
  assert.match(s.json.proximoPasso, /cloudflare/);
  mundo.logado = true;
  await rodar(['cloudflare'], { raiz, mundo });
  s = await rodar(['status', '--json'], { raiz, mundo });
  assert.equal(s.json.dados.etapas.find((e) => e.id === 'cloudflare').estado, 'feito');
});
