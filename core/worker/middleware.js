/* middleware.js — antes de qualquer handler: quem é, o que o modo permite, e
 * a decisão da tabela de permissoes.js. NEGADO POR PADRÃO.
 *
 * Substitui o `functions/api/_middleware.js` do Pages. O que mudou:
 *   - a lista de rotas públicas deixou de ser um `if` solto e virou a tabela
 *     rota × método × papel (permissoes.js), com teste de matriz;
 *   - leitura do catálogo e da busca depende do MODO DE ACESSO (D-4);
 *   - falha de configuração => modo `privado` (o mais fechado);
 *   - o token é assinado por SESSION_SECRET, não pela senha do admin.
 *
 * Esta função NÃO chama handler: devolve a decisão. Quem despacha é index.js.
 * Fica barata de propósito (um HMAC e, para conta comum, uma leitura de KV):
 * o plano gratuito dá 10 ms de CPU por requisição, e o teste mede. */
import { json, erro, contaDoToken, criarClienteBunny } from './_lib/sessao.js';
import { nivelDe, papelDaConta, papelMinimo, papelBasta } from './permissoes.js';

export function tokenDe(request) {
  const cabecalho = request.headers.get('authorization') || '';
  return cabecalho.toLowerCase().startsWith('bearer ') ? cabecalho.slice(7).trim() : '';
}

/* `/api/x/` e `/api/x` são a mesma rota; `/` fica `/`. */
export function normalizarCaminho(pathname) {
  const limpo = String(pathname || '/').replace(/\/+$/, '');
  return limpo || '/';
}

/* Devolve { permitido: true, data, nivel } ou { permitido: false, resposta }.
 * `modo` já vem seguro (modoSeguro) de quem chama. */
export async function autorizar({ request, env, caminho, metodo, modo }) {
  const entrada = nivelDe(caminho, metodo);
  const ehApi = caminho === '/api' || caminho.startsWith('/api/');

  /* A conta só é resolvida quando há token: visita anônima não paga HMAC. */
  const token = tokenDe(request);
  const conta = token ? await contaDoToken(token, env) : null;
  const papel = papelDaConta(conta);
  const data = { conta, admin: !!conta, papel, modo, bunny: criarClienteBunny(env) };

  if (!entrada.achou) {
    /* Em /api, quem não tem sessão não aprende o que existe: 401 para tudo.
     * Com sessão, 404 (rota que não existe) ou 405 (método que ela não aceita). */
    if (ehApi && papel === 'anonimo') return { permitido: false, resposta: erro(401, 'nao-autorizado') };
    if (entrada.rota) return { permitido: false, resposta: erro(405, 'metodo-nao-permitido') };
    return { permitido: false, resposta: erro(404, 'nao-encontrado') };
  }

  const minimo = papelMinimo(entrada.nivel, modo);
  if (!papelBasta(papel, minimo)) {
    return {
      permitido: false,
      resposta: papel === 'anonimo'
        ? erro(401, 'nao-autorizado')
        : erro(403, minimo === 'super' ? 'so-superadmin' : 'sem-permissao-rota')
    };
  }
  return { permitido: true, data, nivel: entrada.nivel };
}
