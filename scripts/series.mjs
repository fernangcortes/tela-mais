/* scripts/series.mjs — a apresentação das séries (sobre, começo, momentos e temas).
 *
 *   node scripts/series.mjs --material [--serie <nome>]   mostra o que iria ao modelo, sem chamar nada
 *   node scripts/series.mjs [--serie <nome>] [--refazer]  ENSAIO: chama o modelo e grava em series-ensaio.json
 *   node scripts/series.mjs --gravar [--serie <nome>]     grava no catálogo o que está em series-ensaio.json
 *
 * Três passos de propósito: o modelo custa, e o texto é lido por gente ANTES
 * de ir ao ar. O ensaio fica num arquivo; o `--gravar` lê o arquivo e não chama
 * o modelo de novo — o que foi lido é o que vai.
 *
 * O que ele escreve é `site.series[nome] = { sobre, comeco, momentos, temas,
 * origem: 'auto' }`, uma série por vez sobre o catálogo LIDO NA HORA
 * (`?completo=1`, nunca o arquivo local, que fica defasado), e pelo mesmo PUT da mesa.
 * NUNCA sobrescreve `revisada`; o `auto` só com `--refazer`.
 *
 * DUAS REGRAS DE QUANDO RODAR:
 *   - não enquanto alguém envia pela mesa (a regra do `indice-busca.mjs`): o
 *     PUT tem trava de rev e recusa, mas a recusa no meio de um envio é
 *     trabalho perdido de alguém;
 *   - não antes de o deploy do servidor conhecer `site.series`: o servidor antigo DESCARTA o campo
 *     `series` no saneador, e o próximo Publicar da mesa apagaria tudo. O
 *     script confere isso no GET público e se recusa a gravar.
 *
 * Pré-requisitos, como o `sinopses.mjs`:
 *     npm install @anthropic-ai/sdk
 *     ANTHROPIC_API_KEY=...      (no .env da raiz; ou `ant auth login`)
 * e APP_SITE_URL e ADMIN_PASSWORD no .env da raiz.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentos, erroFatal, agora } from './lib/catalogo.mjs';
import {
  INSTRUCAO, lerFala, seriesComPagina, podeEscrever, materialDaSerie,
  textoDoMaterial, formatoDaResposta, conferirResposta
} from './lib/series.mjs';
import App from '../core/site/catalogo-core.js';

/* O mesmo do `sinopses.mjs`; conferido na referência da API. */
const MODELO = 'claude-opus-5';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENSAIO = path.resolve(AQUI, '..', 'exemplo', 'series-ensaio.json');

const op = argumentos();
const site = (typeof op.site === 'string' ? op.site : process.env.APP_SITE_URL || '').replace(/\/+$/, '');
const senha = process.env.APP_SENHA || process.env.ADMIN_PASSWORD || '';

async function entrar() {
  if (!site) throw new Error('defina APP_SITE_URL');
  if (!senha) throw new Error('defina APP_SENHA ou ADMIN_PASSWORD');
  const r = await fetch(site + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  if (!r.ok) throw new Error(`login recusado (${r.status})`);
  return { Authorization: 'Bearer ' + (await r.json()).token };
}

async function lerCompleto(auth) {
  const r = await fetch(site + '/api/catalogo?completo=1', { headers: auth });
  if (!r.ok) throw new Error(`catálogo respondeu ${r.status}`);
  const catalogo = await r.json();
  delete catalogo.config;
  return catalogo;
}

async function carregarSdk() {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return Anthropic;
  } catch {
    throw new Error('o SDK da Anthropic não está instalado.\n  npm install @anthropic-ai/sdk');
  }
}

function escolhidas(catalogo) {
  const todas = seriesComPagina(catalogo.itens);
  if (typeof op.serie !== 'string') return todas;
  if (!todas.includes(op.serie)) throw new Error(`"${op.serie}" não é uma série com página. As que são: ${todas.join(' · ')}`);
  return [op.serie];
}

async function perguntar(cliente, material) {
  const resposta = await cliente.beta.messages.create({
    model: MODELO,
    max_tokens: 16000,
    system: INSTRUCAO,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: formatoDaResposta(material) },
    /* Se um classificador recusar, a API cai para outro modelo em vez de
     * devolver vazio no meio das onze séries — como no `sinopses.mjs`. */
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: textoDoMaterial(material) }]
  });
  if (resposta.stop_reason === 'refusal') {
    throw new Error('recusado (' + (resposta.stop_details?.category ?? 'sem categoria') + ')');
  }
  if (resposta.stop_reason === 'max_tokens') throw new Error('a resposta foi cortada no limite de tokens');
  const texto = resposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(texto);
}

async function ensaiar(catalogo) {
  const falas = lerFala(await (await fetch(site + '/api/busca/fala')).text());
  const nomes = escolhidas(catalogo);

  if (op.material) {
    for (const nome of nomes) {
      const m = materialDaSerie(catalogo.itens, nome, falas);
      const texto = textoDoMaterial(m);
      const podem = podeEscrever(catalogo.site, nome, op.refazer === true);
      console.log(`${podem ? '·' : '✖'} ${nome} — ${m.titulos.length} títulos, ` +
        `${m.titulos.reduce((n, t) => n + t.capitulos.length, 0)} capítulos, ` +
        `${m.titulos.filter((t) => t.fala).length} com fala, ${texto.length} caracteres` +
        (podem ? '' : ' (já tem apresentação — fica)'));
      if (op.serie) console.log('\n' + texto);
    }
    console.log('\n--material: nenhuma chamada foi feita.');
    return;
  }

  const Anthropic = await carregarSdk();
  const cliente = new Anthropic();
  let ensaio = {};
  try { ensaio = JSON.parse(await readFile(ENSAIO, 'utf8')); } catch (e) { /* primeiro ensaio */ }

  for (const nome of nomes) {
    if (!podeEscrever(catalogo.site, nome, op.refazer === true)) {
      console.log(`${agora()}  ·  ${nome} — já tem apresentação (use --refazer para o automático; o revisado nunca)`);
      continue;
    }
    const material = materialDaSerie(catalogo.itens, nome, falas);
    try {
      const { entrada, avisos } = conferirResposta(catalogo.itens, nome, await perguntar(cliente, material));
      ensaio[nome] = { entrada, avisos, rev: catalogo.rev, quando: new Date().toISOString() };
      await writeFile(ENSAIO, JSON.stringify(ensaio, null, 2) + '\n');
      console.log(`${agora()}  ✔  ${nome}\n     ${entrada.sobre}\n     temas: ${(entrada.temas || []).join(', ')}` +
        `\n     momentos: ${(entrada.momentos || []).length} · começo: ${entrada.comeco || '—'}` +
        (avisos.length ? `\n     ⚠ ${avisos.join(' · ')}` : '') + '\n');
    } catch (e) {
      console.error(`${agora()}  ✖  ${nome}: ${e.message}`);
    }
  }
  console.log(`\nensaio em ${path.relative(process.cwd(), ENSAIO)} — leia antes do --gravar.`);
}

async function gravar(auth) {
  const ensaio = JSON.parse(await readFile(ENSAIO, 'utf8'));

  /* O servidor no ar conhece o campo? O GET público projeta o `site` saneado:
   * sem `series` nele, o saneador antigo está no ar e jogaria tudo fora. */
  const publico = await (await fetch(site + '/api/catalogo')).json();
  if (!publico.site || !('series' in publico.site)) {
    throw new Error('o site no ar ainda não conhece `site.series` — faça o deploy do servidor atualizado antes de gravar');
  }

  const catalogo = await lerCompleto(auth);
  let novoSite = catalogo.site || {};
  const gravadas = [];
  for (const nome of Object.keys(ensaio).sort()) {
    if (typeof op.serie === 'string' && op.serie !== nome) continue;
    if (!podeEscrever(novoSite, nome, op.refazer === true)) {
      console.log(`  ·  ${nome} — já tem apresentação no catálogo, fica`);
      continue;
    }
    /* Conferido de novo contra o catálogo de AGORA: um título pode ter saído
     * do ar desde o ensaio. */
    const { entrada, avisos } = conferirResposta(catalogo.itens, nome, ensaio[nome].entrada);
    if (!entrada.sobre) { console.log(`  ✖  ${nome} — sem texto, não gravo`); continue; }
    if (avisos.length) console.log(`  ⚠  ${nome} — ${avisos.join(' · ')}`);
    novoSite = App.comSerie(novoSite, nome, Object.assign({}, entrada, { origem: 'auto' }));
    gravadas.push(nome);
  }
  if (!gravadas.length) { console.log('nada a gravar.'); return; }

  catalogo.site = novoSite;
  const r = await fetch(site + '/api/catalogo', {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(catalogo)
  });
  const res = await r.json();
  if (!r.ok) throw new Error('gravação recusada: ' + JSON.stringify(res));
  console.log(`\n✔ ${gravadas.length} série(s) gravadas como automáticas  ·  rev ${res.rev}\n  ${gravadas.join(' · ')}`);
}

try {
  const auth = await entrar();
  if (op.gravar) await gravar(auth);
  else await ensaiar(await lerCompleto(auth));
} catch (e) {
  erroFatal(e);
}
