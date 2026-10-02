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
 * Fica barata de propósito: o plano gratuito dá 10 ms de CPU por requisição, e o
 * teste mede. Quem manda token Bearer (equipe) paga um HMAC e uma linha do D1;
 * quem manda o cookie de espectador paga 2 linhas do D1 (sessão + usuário, ambas
 * por índice); anônimo não paga nada. Quem é a pessoa sai de
 * `sessaoDaRequisicao` (_lib/sessoes.js). */
import { json, erro } from './_lib/sessao.js';
import { criarProvedor } from './_lib/provedores/index.js';
import { nivelDe, papelMinimo, papelBasta } from './permissoes.js';
import { sessaoDaRequisicao } from './_lib/sessoes.js';
import { politicaDeAcesso } from './_lib/contas.js';

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
 * `modo` já vem seguro (modoSeguro) de quem chama; `config` (pode ser null) escolhe
 * o provedor de vídeo que vai em `data.provedor`. */
export async function autorizar({ request, env, caminho, metodo, modo, config, waitUntil }) {
  const entrada = nivelDe(caminho, metodo);
  const ehApi = caminho === '/api' || caminho.startsWith('/api/');

  /* Quem é: Bearer da equipe, cookie de espectador ou ninguém. Só olha o que
   * veio na requisição: visita anônima não toca o banco. */
  const politica = politicaDeAcesso(config);
  const sessao = await sessaoDaRequisicao(request, env, { waitUntil, horasEspectador: politica.horasEspectador });
  const conta = sessao.conta || null;
  const papel = sessao.papel;
  /* `sessao` e `politica` são o que o resto do Worker usa para decidir (ex.: assinar
   * a mídia só para quem tem sessão: `data.sessao.papel !== 'anonimo'`). */
  const data = { conta, admin: !!conta, papel, sessao, politica, modo, provedor: criarProvedor(config, env) };

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
