#!/usr/bin/env node
/* scripts/provar-assinatura.mjs — a PROVA de que a mídia do modo privado está de fato trancada (critério M0 a/b).
 *
 * Com credenciais REAIS (do .env; nada é gravado em arquivo), pega um vídeo da sua conta e faz três pedidos ao HLS:
 *   1. SEM token                 espera 401/403 (a CDN recusa);
 *   2. com token VÁLIDO          espera 200 (e o corpo é uma playlist #EXTM3U);
 *   3. com token EXPIRADO        espera 401/403 (o token vale só até o `expires`).
 * Também pede a capa assinada (200) e sem token (401/403). Sai 0 só se tudo bater; 1 se algo falhar; 2 se faltar dado.
 * Os "pedidos" são `fetch` do Node (equivalem aos `curl -i` do roteiro; o equivalente em curl é impresso).
 *
 * Uso:
 *   node scripts/provar-assinatura.mjs --video <id> [--provedor bunny|cloudflare-stream] [--validade 300]
 * O id vem de --video, ou de PROVA_VIDEO_ID no ambiente. Variáveis: as do provedor (ver docs/provedores.md),
 * incluindo BUNNY_TOKEN_KEY (Bunny) ou CLOUDFLARE_STREAM_KEY_ID + KEY_PEM/JWK (Stream).
 *
 * Pré-requisitos no provedor (senão o passo 1 devolve 200 e a prova falha, que é o objetivo dela):
 *   Bunny: pull zone com "Token Authentication" LIGADO (Security) e "Directory token" permitido;
 *   Stream: vídeo com requireSignedURLs=true (POST /stream/{id} {"requireSignedURLs": true}).
 * O Bunny também pode servir 200 ao token do Bunny na zona de CAPAS pública: use a mesma zona para a prova. */
import { provedorDoAmbiente } from './lib/provedores/index.mjs';

const args = process.argv.slice(2);
const opc = (nome, padrao) => { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : padrao; };
const id = opc('video', process.env.PROVA_VIDEO_ID);
const validade = Math.max(60, Number(opc('validade', 300)) || 300);

if (!id) {
  console.error('Informe o vídeo: node scripts/provar-assinatura.mjs --video <id>   (ou PROVA_VIDEO_ID)');
  process.exit(2);
}

const mascara = (url) => url.replace(/(bcdn_token=)[^&/]+/, '$1<token>').replace(/(token=)[0-9a-f]{20,}/, '$1<token>')
  .replace(/\/[\w-]{20,}\.[\w-]{20,}\.[\w-]{20,}\//, '/<jwt>/');

async function pedir(url) {
  try {
    const r = await fetch(url, { redirect: 'manual', headers: { range: 'bytes=0-2047' } });
    const texto = r.ok ? (await r.text()).slice(0, 16) : '';
    return { status: r.status, playlist: texto.startsWith('#EXTM3U') };
  } catch (e) {
    return { status: 0, erro: String(e && e.message || e) };
  }
}

const resultados = [];
function conferir(nome, url, esperado) {
  return pedir(url).then((r) => {
    const ok = esperado === 'aberto' ? r.status === 200 || r.status === 206 : r.status === 401 || r.status === 403;
    resultados.push(ok);
    console.log((ok ? 'OK    ' : 'FALHA ') + nome.padEnd(34) + 'HTTP ' + r.status + (r.erro ? ' (' + r.erro + ')' : '') + '   espera ' + (esperado === 'aberto' ? '200' : '401/403'));
    console.log('      curl -s -o /dev/null -w "%{http_code}\\n" "' + mascara(url) + '"');
    return r;
  });
}

const { provedor, config } = await provedorDoAmbiente({ provedor: opc('provedor') });
console.log('provedor: ' + provedor.id + '   vídeo: ' + id + '   validade do token válido: ' + validade + ' s\n');
if (!provedor.capacidades().assinatura) {
  console.error('O provedor "' + provedor.id + '" não assina nesta configuração (faltam as chaves de assinatura no .env). Nada a provar.');
  process.exit(2);
}

const aberta = await provedor.urlReproducao(id);
const valida = await provedor.urlReproducao(id, { assinar: true, validadeSeg: validade });
if (!aberta.hls || !valida.hls) { console.error('Não foi possível montar as URLs (id inválido ou provedor sem host).'); process.exit(2); }

await conferir('1. HLS sem token', aberta.hls, 'fechado');
await conferir('2. HLS com token válido', valida.hls, 'aberto');

/* 3. Expirado: o MESMO adaptador, com o relógio no passado (token com `expires` já vencido). */
const { criarProvedor } = await import('../core/worker/_lib/provedores/index.js');
const velho = criarProvedor(config, process.env, { provedor: provedor.id, agora: () => Date.now() - 2 * 3600 * 1000 });
const expirada = await velho.urlReproducao(id, { assinar: true, validadeSeg: 60 });
await conferir('3. HLS com token expirado', expirada.hls, 'fechado');

const capaAberta = await provedor.urlCapa(id, {});
const capaAssinada = await provedor.urlCapa(id, { assinar: true, validadeSeg: validade });
if (capaAberta && capaAssinada) {
  await conferir('4. capa sem token', capaAberta, 'fechado');
  await conferir('5. capa com token válido', capaAssinada, 'aberto');
}

const falhas = resultados.filter((x) => !x).length;
console.log('\n' + (falhas === 0 ? 'PROVA OK: sem token e com token vencido a CDN recusa; com token válido ela serve.' : 'PROVA FALHOU em ' + falhas + ' verificação(ões): a mídia NÃO está trancada. Confira os pré-requisitos no topo deste script.'));
process.exit(falhas === 0 ? 0 : 1);
