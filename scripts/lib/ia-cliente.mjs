/* scripts/lib/ia-cliente.mjs — o cliente HTTP da IA de conteúdo (M9) para os scripts de lote.
 *
 * Os scripts rodam FORA do Worker (sua máquina ou GitHub Actions), então não têm o KV: tudo que é do site — o orçamento do mês,
 * a fila de sugestões, o catálogo — passa pela API (`/api/ia`, `/api/ia-sugestoes`, `/api/catalogo`), com o login do superadmin
 * (`APP_SITE_URL` e `APP_SENHA`/`ADMIN_PASSWORD`, como os outros scripts). A senha só sai daqui para o /api/login do próprio site.
 *
 * `orcamentoRemoto` tem a MESMA interface do orçamento do Worker (core/worker/_lib/ia/orcamento.js): `gerarTexto` e `transcrever`
 * não sabem a diferença. Cada gasto vai ao site na hora (POST /api/ia { acao:'gasto' }), então o teto do mês vale para todos. */

export async function entrar({ site, senha, fetch = globalThis.fetch }) {
  if (!site) throw new Error('defina APP_SITE_URL (ou passe --site https://seu-site)');
  if (!senha) throw new Error('defina APP_SENHA ou ADMIN_PASSWORD no ambiente (ou no .env)');
  const base = String(site).replace(/\/+$/, '');
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ senha }) });
  if (!r.ok) throw new Error('login recusado (' + r.status + '): confira a senha do superadmin');
  const { token } = await r.json();
  if (!token) throw new Error('o login não devolveu sessão');
  return criarCliente({ site: base, token, fetch });
}

export function criarCliente({ site, token, fetch = globalThis.fetch }) {
  const base = String(site).replace(/\/+$/, '');
  async function pedir(metodo, caminho, corpo) {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: Object.assign({ authorization: 'Bearer ' + token }, corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch (e) { json = null; }
    return { status: r.status, ok: r.ok, json };
  }
  const ou = (r, o) => { if (!r.ok) { const e = new Error((r.json && (r.json.mensagem || r.json.erro)) || ('o site respondeu ' + r.status)); e.status = r.status; e.codigo = r.json && r.json.codigo; e.corpo = r.json; throw e; } return r.json; };
  return {
    site: base,
    estado: async () => ou(await pedir('GET', '/api/ia')),
    estimar: async ({ tarefas, ids, idiomasDestino }) => ou(await pedir('POST', '/api/ia', { acao: 'estimar', tarefas, ids, idiomasDestino })),
    gasto: async (g) => ou(await pedir('POST', '/api/ia', Object.assign({ acao: 'gasto' }, g))),
    catalogo: async () => ou(await pedir('GET', '/api/catalogo?completo=1')),
    fila: async () => ou(await pedir('GET', '/api/ia-sugestoes')).sugestoes,
    entregar: async (s) => pedir('POST', '/api/ia-sugestoes', s)
  };
}

/* O orçamento do mês visto de fora. `inicial` = o bloco `orcamento` do GET /api/ia. */
export function orcamentoRemoto(cliente, inicial) {
  let gasto = Number(inicial && inicial.gastoUSD) || 0;
  const limiteUSD = Number(inicial && inicial.limiteUSD) || 0;
  return {
    limiteUSD, temArmazenamento: true,
    gastoDoMes: async () => gasto,
    restanteUSD: async () => Math.max(0, Math.round((limiteUSD - gasto) * 1e6) / 1e6),
    podeGastar: async (usd) => gasto + usd <= limiteUSD + 1e-9,
    async registrar({ usd, provedor, modelo, tarefa, entradaTokens, saidaTokens, minutos }) {
      const r = await cliente.gasto({ usd, provedor, modelo, tarefa, entradaTokens, saidaTokens, minutos });
      gasto = typeof r.gastoUSD === 'number' ? r.gastoUSD : Math.round((gasto + usd) * 1e6) / 1e6;
      return r;
    }
  };
}
