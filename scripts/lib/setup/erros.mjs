/* scripts/lib/setup/erros.mjs — códigos de saída e o erro que o setup.mjs entende.
 *
 *   0  deu certo (avisos não mudam isto)
 *   1  falhou: uma checagem reprovou, o config é inválido, achou segredo, um comando externo falhou
 *   2  uso incorreto: subcomando ou flag que não existe, valor inválido, segredo passado na linha de comando
 *   3  falta algo: uma ação da PESSOA (entrar no wrangler, colar uma chave num prompt oculto) ou uma resposta/autorização
 *      que o AGENTE precisa pedir a ela (nome, escolha, "sim" para publicar). Cada pendência diz `quem`.
 */
export const SAIDA = Object.freeze({ OK: 0, FALHA: 1, USO: 2, PENDENTE: 3 });

export class ErroSetup extends Error {
  constructor(codigo, mensagem, { saida = SAIDA.FALHA, dica = null, comando = null, dados = null, quem = 'pessoa' } = {}) {
    super(mensagem);
    this.name = 'ErroSetup';
    this.codigo = codigo;
    this.saida = saida;
    this.dica = dica;
    this.comando = comando;
    this.dados = dados;
    this.quem = quem;
  }
}

export const erroUso = (mensagem, dica = null) => new ErroSetup('uso-invalido', mensagem, { saida: SAIDA.USO, dica });
/* `quem`: 'pessoa' (só ela pode agir: digitar senha, entrar na conta) ou 'agente' (falta uma resposta/autorização:
 * o agente pergunta à pessoa e roda o comando de novo). */
export const pendente = (codigo, mensagem, { dica = null, comando = null, dados = null, quem = 'pessoa' } = {}) =>
  new ErroSetup(codigo, mensagem, { saida: SAIDA.PENDENTE, dica, comando, dados, quem });
export const falha = (codigo, mensagem, { dica = null, comando = null, dados = null } = {}) =>
  new ErroSetup(codigo, mensagem, { saida: SAIDA.FALHA, dica, comando, dados });
