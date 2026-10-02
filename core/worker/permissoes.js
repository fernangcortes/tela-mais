/* permissoes.js — a tabela rota × método × papel. A ÚNICA fonte de "quem entra".
 *
 * NEGADO POR PADRÃO. O roteador só despacha o que está nesta tabela; caminho
 * ou método sem entrada nunca chega a um handler (sem sessão: 401; com sessão:
 * 404/405). Uma rota nova nasce fechada porque ninguém a escreveu aqui, e
 * `tests/worker-matriz.test.js` falha se uma rota registrada não tiver entrada.
 *
 * PAPÉIS, do mais fraco ao mais forte:
 *   anonimo    ninguém identificado
 *   espectador quem assiste, nos modos `cadastro` e `privado`: conta de
 *              espectador (D1) com sessão por cookie. A equipe e o superadmin
 *              valem como "espectador" por serem papéis mais fortes.
 *   equipe     conta criada pelo superadmin (permissões finas no handler)
 *   super      o superadmin (a senha do ambiente)
 *
 * NÍVEIS DE ACESSO de cada entrada:
 *   'aberto'   qualquer um, em qualquer modo (login, página inicial)
 *   'modo'     depende do modo de acesso: `publico` => anonimo;
 *              `cadastro` e `privado` => espectador (D-4 e tabela 4.5 do plano)
 *   'conta'    precisa de uma sessão de conta (espectador ou mais forte) em QUALQUER
 *              modo: "Minha conta", exportar e excluir dados
 *   'equipe'   conta de equipe ou superadmin; o handler confere a permissão fina
 *   'super'    só o superadmin
 *
 * `modo` ausente, desconhecido ou vindo de config quebrada vale `privado`.
 */
export const PAPEIS = ['anonimo', 'espectador', 'equipe', 'super'];
export const MODOS = ['publico', 'cadastro', 'privado'];
export const MODO_MAIS_FECHADO = 'privado';

export function modoSeguro(modo) {
  return MODOS.indexOf(modo) >= 0 ? modo : MODO_MAIS_FECHADO;
}

/* O papel de uma conta resolvida pelo token. */
export function papelDaConta(conta) {
  if (!conta) return 'anonimo';
  return conta.super === true ? 'super' : 'equipe';
}

/* O papel mínimo que a entrada exige, dado o modo. */
export function papelMinimo(acesso, modo) {
  if (acesso === 'aberto') return 'anonimo';
  if (acesso === 'modo') return modoSeguro(modo) === 'publico' ? 'anonimo' : 'espectador';
  if (acesso === 'conta') return 'espectador';
  if (acesso === 'equipe') return 'equipe';
  if (acesso === 'super') return 'super';
  return 'super';   /* nível desconhecido: o mais fechado */
}

export function papelBasta(papel, minimo) {
  return PAPEIS.indexOf(papel) >= PAPEIS.indexOf(minimo);
}

/* A tabela. Chave = caminho exato (sem barra no fim); valor = método -> nível. */
export const PERMISSOES = {
  '/': { GET: 'aberto' },

  '/api/login': { POST: 'aberto' },

  /* Contas de espectador (M5). As rotas de ENTRADA são abertas de propósito (quem
   * entra ainda não tem sessão) e cada uma confere o modo, o banco, o limite de
   * tentativas e o Turnstile por dentro: no modo `publico` respondem que o site
   * não usa contas. "Minha conta" exige sessão em qualquer modo. */
  '/api/auth/estado': { GET: 'aberto' },
  '/api/auth/entrar': { POST: 'aberto' },
  '/api/auth/cadastro': { POST: 'aberto' },
  '/api/auth/link': { POST: 'aberto' },
  '/api/auth/convite': { POST: 'aberto' },
  '/api/auth/sair': { POST: 'aberto' },
  '/api/conta/eu': { GET: 'conta', PUT: 'conta' },
  '/api/conta/exportar': { GET: 'conta' },
  '/api/conta/excluir': { POST: 'conta' },
  /* Minha lista (M6): de quem tem conta de espectador; o handler recusa a equipe. */
  '/api/minha-lista': { GET: 'conta', POST: 'conta', DELETE: 'conta' },
  /* Política de privacidade e termos: o texto é público; editar é do superadmin. */
  '/api/legal': { GET: 'aberto', PUT: 'super' },
  /* Convites e espectadores: gestão do superadmin (link copiável, aprovar, bloquear). */
  '/api/convites': { GET: 'super', POST: 'super', DELETE: 'super' },
  '/api/espectadores': { GET: 'super', PUT: 'super', DELETE: 'super' },

  /* Catálogo e busca: abertos só no modo `publico`. O GET com `?completo=1`
   * (o catálogo inteiro, com o que está fora do ar) exige conta no handler. */
  '/api/catalogo': { GET: 'modo', PUT: 'equipe' },
  '/api/busca/fala': { GET: 'modo' },
  '/api/busca/sentido': { GET: 'modo' },

  /* Escrever na busca é da equipe: nada de POST em /fala, nunca. */
  '/api/busca/indexar': { GET: 'equipe', POST: 'equipe' },

  '/api/conta': { GET: 'equipe', PUT: 'equipe' },
  '/api/contas': { GET: 'super', POST: 'super', PUT: 'super', DELETE: 'super' },
  '/api/autorizacoes': { GET: 'equipe', PUT: 'super' },
  '/api/historico': { GET: 'equipe', POST: 'equipe' },
  '/api/midia': { GET: 'equipe', POST: 'equipe' },
  '/api/upload-token': { POST: 'equipe' },

  /* Operação (M8). Saúde: a equipe vê o retrato (só nomes de segredo, nunca valor); o assistente de configuração e as contas
   * que ele faz no servidor são do superadmin. Backup: a equipe baixa o que já enxerga (catálogo e configuração operacional);
   * as CONTAS no arquivo e a importação são do superadmin (o handler confere `?contas=1`). */
  '/api/saude': { GET: 'equipe', POST: 'super', PUT: 'super' },
  '/api/backup': { GET: 'equipe', POST: 'super' },

  /* MCP (M10). Os tokens do MCP e a auditoria são do superadmin. O `/mcp` é 'aberto' PARA O MIDDLEWARE de propósito: quem chama é um
   * agente com token `mcp_…` (nem a sessão da equipe nem o cookie de espectador valem), e o handler confere por dentro, nesta
   * ordem: `mcp.ligado` (senão 404), Origin, token válido (senão 401), limite de taxa e escopo de cada ferramenta. */
  '/api/mcp-tokens': { GET: 'super', POST: 'super', DELETE: 'super' },

  /* IA de conteúdo (M9). O retrato e a estimativa de custo são da equipe; GERAR (gasta dinheiro), registrar gasto e ligar/desligar
   * recurso são do superadmin (o handler confere por ação). A FILA de sugestões: a equipe vê, aceita e descarta (permissão
   * `conteudo`, conferida no handler; o aceite ainda passa pelo `gravarCatalogo`, com permissão por campo); colocar sugestão na fila
   * é do superadmin (os scripts de lote). Nada gerado por IA vai ao ar sem uma pessoa aceitar. */
  '/api/ia': { GET: 'equipe', POST: 'equipe', PUT: 'super' },
  '/api/ia-sugestoes': { GET: 'equipe', POST: 'super', PUT: 'equipe', DELETE: 'equipe' },
  '/mcp': { GET: 'aberto', POST: 'aberto', DELETE: 'aberto' }
};

export function nivelDe(caminho, metodo) {
  const linha = Object.prototype.hasOwnProperty.call(PERMISSOES, caminho) ? PERMISSOES[caminho] : null;
  if (!linha) return { achou: false, rota: false };
  const nivel = Object.prototype.hasOwnProperty.call(linha, metodo) ? linha[metodo] : null;
  return nivel ? { achou: true, rota: true, nivel } : { achou: false, rota: true };
}
