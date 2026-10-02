/* permissoes.js — a tabela rota × método × papel. A ÚNICA fonte de "quem entra".
 *
 * NEGADO POR PADRÃO. O roteador só despacha o que está nesta tabela; caminho
 * ou método sem entrada nunca chega a um handler (sem sessão: 401; com sessão:
 * 404/405). Uma rota nova nasce fechada porque ninguém a escreveu aqui, e
 * `tests/worker-matriz.test.js` falha se uma rota registrada não tiver entrada.
 *
 * PAPÉIS, do mais fraco ao mais forte:
 *   anonimo    ninguém identificado
 *   espectador quem assiste, nos modos `cadastro` e `privado`. NÃO EXISTE AINDA:
 *              contas de espectador (D1, link mágico) são do M5. Até lá a
 *              única sessão válida é a da equipe/admin, e ela vale como
 *              "espectador" por ser mais forte.
 *   equipe     conta criada pelo superadmin (permissões finas no handler)
 *   super      o superadmin (a senha do ambiente)
 *
 * NÍVEIS DE ACESSO de cada entrada:
 *   'aberto'   qualquer um, em qualquer modo (login, página inicial)
 *   'modo'     depende do modo de acesso: `publico` => anonimo;
 *              `cadastro` e `privado` => espectador (D-4 e tabela 4.5 do plano)
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
  '/api/upload-token': { POST: 'equipe' }
};

export function nivelDe(caminho, metodo) {
  const linha = Object.prototype.hasOwnProperty.call(PERMISSOES, caminho) ? PERMISSOES[caminho] : null;
  if (!linha) return { achou: false, rota: false };
  const nivel = Object.prototype.hasOwnProperty.call(linha, metodo) ? linha[metodo] : null;
  return nivel ? { achou: true, rota: true, nivel } : { achou: false, rota: true };
}
