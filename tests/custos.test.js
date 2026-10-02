/* A calculadora de custo (core/worker/_lib/custos.js): conta pura, sem rede.
 * Os cenários pequeno/médio/grande fecham com a tabela de docs/provedores.md. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const custos = () => import('../core/worker/_lib/custos.js');

test('cenários pequeno, médio e grande reproduzem a tabela de docs/provedores.md', async () => {
  const c = await custos();
  const por = (nome) => c.estimarCusto(c.CENARIOS[nome]);
  const p = por('pequeno'), m = por('medio'), g = por('grande');
  /* Bunny: ~9, ~175, ~3.415. Cloudflare Stream: 25, 290, 4.600. */
  assert.equal(p.provedores.bunny.totalUsd, 9.44);
  assert.equal(m.provedores.bunny.totalUsd, 174.75);
  assert.equal(g.provedores.bunny.totalUsd, 3415);
  assert.equal(p.provedores['cloudflare-stream'].totalUsd, 25);
  assert.equal(m.provedores['cloudflare-stream'].totalUsd, 290);
  assert.equal(g.provedores['cloudflare-stream'].totalUsd, 4600);
  assert.equal(p.maisBarato, 'bunny');
});

test('HLS genérico não tem conta: o custo é de quem hospeda os arquivos', async () => {
  const c = await custos();
  const r = c.estimarProvedor('hls-generico', {});
  assert.equal(r.calculavel, false);
  assert.equal(r.totalUsd, null);
  assert.equal(c.estimarProvedor('nao-existe', {}), null);
  assert.equal(c.estimarCusto({}).totaisComHospedagem['hls-generico'], undefined);
});

test('Bunny: vale o mínimo mensal quando a conta dá menos; entrega global é mais barata que a do Brasil', async () => {
  const c = await custos();
  const quase = c.estimarProvedor('bunny', { videos: 1, visualizacoesMes: 1 });
  assert.equal(quase.totalUsd, 1);
  assert.match(quase.avisos.join(' '), /mínimo/);
  const br = c.estimarProvedor('bunny', { visualizacoesMes: 10000, publico: 'brasil' });
  const gl = c.estimarProvedor('bunny', { visualizacoesMes: 10000, publico: 'global' });
  assert.ok(gl.totalUsd < br.totalUsd);
});

test('toda estimativa vem marcada como estimativa, com data, câmbio e BRL com IOF', async () => {
  const c = await custos();
  const r = c.estimarCusto({});
  assert.equal(r.estimativa, true);
  assert.match(r.dataDosValores, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.aviso, /Reconfira/);
  assert.equal(r.provedores.bunny.confirmado, false);
  assert.equal(r.provedores.bunny.dataDosValores, r.dataDosValores);
  const b = r.provedores.bunny;
  assert.ok(Math.abs(b.totalBrl - b.totalUsd * c.CAMBIO_BRL) < 0.02);
  assert.ok(b.totalBrlComIof > b.totalBrl);
});

test('entrada ruim nunca lança: vira padrão, com aviso', async () => {
  const c = await custos();
  for (const ruim of [undefined, null, 'x', 42, [], { videos: -5 }, { videos: 'abc' }, { videos: NaN }, { visualizacoesMes: Infinity }, { videos: 1e30 }]) {
    const r = c.estimarCusto(ruim);
    for (const prov of Object.values(r.provedores)) if (prov.calculavel) assert.ok(Number.isFinite(prov.totalUsd), JSON.stringify(ruim));
  }
  const { entrada, avisos } = c.normalizarEntrada({ videos: -5, horasPorVideo: '1,5', modoAcesso: 'xyz', publico: 'lua' });
  assert.equal(entrada.videos, 50);
  assert.equal(entrada.horasPorVideo, 1.5, 'vírgula decimal');
  assert.equal(entrada.modoAcesso, 'publico');
  assert.equal(entrada.publico, 'brasil');
  assert.ok(avisos.length >= 1);
  assert.equal(c.estimarCusto({ videos: 0, visualizacoesMes: 0 }).provedores['cloudflare-stream'].totalUsd, 0);
});

test('hospedagem: público pequeno fica no grátis; passou de 100 mil chamadas por dia exige o plano pago', async () => {
  const c = await custos();
  const pouco = c.estimarCloudflare({ visitasPorDia: 500 });
  assert.equal(pouco.plano, 'gratis');
  assert.equal(pouco.totalUsd, 0);
  const muito = c.estimarCloudflare({ visitasPorDia: 50000, modoAcesso: 'publico' });
  assert.equal(muito.cabeNoGratis, false);
  assert.equal(muito.plano, 'pago');
  assert.ok(muito.totalUsd >= 5);
  assert.match(muito.avisos.join(' '), /plano pago/);
  /* Cadastro com movimento: o CPU de 10 ms aperta, assume-se o pago. */
  assert.equal(c.estimarCloudflare({ visitasPorDia: 6000, modoAcesso: 'cadastro' }).plano, 'pago');
  assert.ok(c.visitasPorDiaNoGratis('privado') < c.visitasPorDiaNoGratis('publico'));
  assert.equal(c.visitasPorDiaNoGratis('publico'), 33333);
});

test('o total com hospedagem soma o provedor e o Worker', async () => {
  const c = await custos();
  const r = c.estimarCusto({ visitasPorDia: 50000 });
  const esperado = r.provedores.bunny.totalUsd + r.cloudflare.totalUsd;
  assert.ok(Math.abs(r.totaisComHospedagem.bunny.totalUsd - esperado) < 0.01);
});

test('formatarMoeda e as constantes são estáveis; nada de segredo nem rede no módulo', async () => {
  const c = await custos();
  assert.equal(c.formatarMoeda(1234.5), 'US$ 1.234,50');
  assert.equal(c.formatarMoeda(9.69, 'BRL'), 'R$ 9,69');
  assert.equal(c.formatarMoeda(null), '—');
  assert.ok(Object.isFrozen(c.PRECOS) && Object.isFrozen(c.LIMITES));
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'worker', '_lib', 'custos.js'), 'utf8');
  assert.doesNotMatch(src, /\bfetch\(|Date\.now|process\.env/);
});

test('docs/custos.md cita a mesma data dos valores do módulo', async () => {
  const c = await custos();
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'custos.md'), 'utf8');
  assert.ok(doc.includes(c.DATA_DOS_VALORES));
});

test('os números do docs/custos.md são os que o módulo calcula (a tabela dos cenários)', async () => {
  const c = await custos();
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'custos.md'), 'utf8');
  const brl = (n) => Math.round(n).toLocaleString('pt-BR');
  const p = c.estimarCusto(c.CENARIOS.pequeno).provedores;
  assert.ok(doc.includes('US$ 9,44') && doc.includes(`R$ ${brl(p.bunny.totalBrl)}`) && doc.includes(`R$ ${brl(p.bunny.totalBrlComIof)}`));
  assert.ok(doc.includes('US$ 25 ') && doc.includes(`R$ ${brl(p['cloudflare-stream'].totalBrlComIof)}`));
  const m = c.estimarCusto(c.CENARIOS.medio).provedores;
  assert.ok(doc.includes('US$ 175') && doc.includes(`R$ ${brl(m.bunny.totalBrl)}`) && doc.includes('US$ 290'));
  assert.ok(doc.includes('US$ 3.415') && doc.includes('US$ 4.600'));
  /* e os mesmos de docs/provedores.md (a outra tabela de custo do repositório) */
  const prov = fs.readFileSync(path.join(__dirname, '..', 'docs', 'provedores.md'), 'utf8');
  assert.ok(prov.includes('~US$ 9 (R$ 47)') && prov.includes('~US$ 175 (R$ 906)') && prov.includes('~US$ 3.415'));
});
