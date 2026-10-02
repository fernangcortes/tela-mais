/* scripts/lib/prazo-player.mjs — mede, num Chromium de verdade, quanto tempo o player leva para mostrar o painel de erro
 * quando os segmentos de vídeo travam. O teste unitário usa DOM falso e relógio falso: ele prova a conta, esta medição
 * prova o prazo. A promessa do produto: no máximo 15 s (LIMITE_FALHA_MS em core/site/player-core.js).
 *
 * Sobe um servidor HTTP local e mínimo (nada de wrangler, nada de rede): serve core/site/, uma página de ensaio com o player,
 * um manifesto HLS verdadeiro e segmentos que se comportam mal de dois jeitos:
 *   travado    o segmento nunca responde (nem o primeiro byte)
 *   gotejando  o primeiro byte chega antes do limite de primeiro byte (3,5 s) e depois nada: o caso que atrasava o 1º erro */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const TIPOS = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
export const LIMITE_DO_PRAZO_MS = 15000;
export const CENARIOS = Object.freeze(['travado', 'gotejando']);

const PAGINA = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="style.css"><body>
<script src="i18n.js"></script><script src="home-blocos.js"></script><script src="catalogo-core.js"></script>
<script src="guardiao.js"></script><script src="player-core.js"></script><script src="player.js"></script>
<script>
fetch('locales/pt-BR.json').then(function (r) { return r.json(); }).then(function (c) {
  AppI18n.instancia().definirCatalogo('pt-BR', c);
  if (AppI18n.definirGlobais) AppI18n.definirGlobais({ marca: 'Teste', marcaCurta: 'Teste', organizacao: 'Teste' });
  var item = { id: 'prazo', titulo: 'Prazo', midia: { hls: '/v/master.m3u8', capa: '' } };
  window.__p = AppPlayer.criar(item, { player: {} }, { proximo: null, abrirProximo: function () {} });
  document.body.appendChild(window.__p.no);
});
</script>`;

export function criarServidorDeEnsaio({ raizSite, cenario }) {
  const abertos = new Set();
  const servidor = http.createServer(async (q, r) => {
    const u = new URL(q.url, 'http://local');
    const hls = (corpo) => { r.setHeader('content-type', 'application/vnd.apple.mpegurl'); r.end(corpo); };
    if (u.pathname === '/ensaio.html') { r.setHeader('content-type', 'text/html'); return r.end(PAGINA); }
    if (u.pathname === '/v/master.m3u8') return hls('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nbaixa.m3u8\n');
    if (u.pathname === '/v/baixa.m3u8') return hls('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:4,\ns0.ts\n#EXTINF:4,\ns1.ts\n#EXT-X-ENDLIST\n');
    if (u.pathname.endsWith('.ts')) {
      abertos.add(r);
      r.on('close', () => abertos.delete(r));
      if (cenario === 'gotejando') setTimeout(() => { try { r.writeHead(200, { 'content-type': 'video/mp2t' }); r.write(Buffer.alloc(188, 0xff)); } catch { /* conexão já caiu */ } }, 3500);
      return;   /* nunca termina */
    }
    const arquivo = path.join(raizSite, path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
    try { const corpo = await readFile(arquivo); r.setHeader('content-type', TIPOS[path.extname(arquivo)] || 'application/octet-stream'); r.end(corpo); }
    catch { r.statusCode = 404; r.end(); }
  });
  return {
    servidor,
    ouvir: () => new Promise((resolve) => servidor.listen(0, '127.0.0.1', () => resolve(servidor.address().port))),
    fechar: () => { for (const r of abertos) { try { r.destroy(); } catch { /* já fechou */ } } return new Promise((resolve) => { servidor.close(() => resolve()); servidor.closeAllConnections?.(); }); }
  };
}

/* Devolve [{ cenario, ms, ok, erro? }]. `navegador` é o objeto devolvido por chromium.launch(). */
export async function medirPrazoDoPlayer(navegador, { raizSite, cenarios = CENARIOS, limiteMs = LIMITE_DO_PRAZO_MS } = {}) {
  const saida = [];
  for (const cenario of cenarios) {
    const ensaio = criarServidorDeEnsaio({ raizSite, cenario });
    const porta = await ensaio.ouvir();
    const contexto = await navegador.newContext({ serviceWorkers: 'block' });
    try {
      const pagina = await contexto.newPage();
      const erros = [];
      pagina.on('pageerror', (e) => erros.push(e.message));
      await pagina.goto(`http://127.0.0.1:${porta}/ensaio.html`, { waitUntil: 'domcontentloaded' });
      await pagina.waitForSelector('.pl-play', { timeout: 20000 });
      const t0 = Date.now();
      await pagina.click('.pl-play');
      try {
        await pagina.waitForSelector('.pl-erro:not([hidden])', { timeout: limiteMs + 15000 });
        const ms = Date.now() - t0;
        const limpo = await pagina.evaluate(() => { const c = document.querySelector('.pl-erro').parentElement; return !c.classList.contains('pl-esperando') && !c.classList.contains('pl-tocando') && c.classList.contains('pl-falhou'); });
        saida.push({ cenario, ms, ok: ms <= limiteMs && limpo && !erros.length, erro: ms > limiteMs ? `o painel apareceu em ${(ms / 1000).toFixed(1)} s (limite ${limiteMs / 1000} s)` : (!limpo ? 'o painel de erro apareceu com classes de estado (pl-esperando/pl-tocando) ainda ligadas' : (erros.length ? 'exceção na página: ' + erros[0] : undefined)) });
      } catch {
        saida.push({ cenario, ms: Date.now() - t0, ok: false, erro: `o painel de erro NÃO apareceu em ${((limiteMs + 15000) / 1000)} s` });
      }
    } finally {
      await contexto.close().catch(() => {});
      await ensaio.fechar();
    }
  }
  return saida;
}
