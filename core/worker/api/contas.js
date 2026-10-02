/* /api/contas — as contas da mesa. Só o superadmin, em todos os métodos.
 *
 *   GET                                                 -> lista (nunca com a senha)
 *   POST   { usuario, nome, senha, permissoes, limiteEnvio? } -> cria
 *   PUT    { usuario, nome?, permissoes?, ativa?, senha?, limiteEnvio? } -> altera
 *   DELETE ?usuario=…                                   -> apaga
 *
 * Trocar permissões, desativar, trocar a senha ou trocar o limite de envio
 * sobe a `versao` da conta, e isso derruba as sessões abertas dela no pedido
 * seguinte (middleware.js).
 *
 * `limiteEnvio` é { maxVideos, maxDuracaoSeg, autorizacaoManual }, todos
 * opcionais — `null`/ausente em cada campo é "sem limite". Quem confere de
 * verdade é /api/upload-token, no envio; esta rota só guarda a configuração.
 */
import { json, erro, hashSenha, iteracoesDe } from '../_lib/sessao.js';
import { equipeListar, equipeAchar, equipeCriar, equipeSalvar, equipeApagar } from '../_lib/contas.js';
import App from '../../site/catalogo-core.js';

function soSuper(data) {
  return data.conta && data.conta.super === true ? null : erro(403, 'so-superadmin-contas');
}

/* O que vai para a tela: tudo menos a senha. O hash não sai daqui nem para o
 * superadmin — não há para que, e o que não viaja não vaza. */
function paraTela(c) {
  return {
    usuario: c.usuario,
    nome: c.nome || c.usuario,
    permissoes: c.permissoes || [],
    ativa: c.ativa !== false,
    versao: c.versao || 1,
    limiteEnvio: c.limiteEnvio || null,
    enviosContagem: c.enviosContagem || 0,
    criada_em: c.criada_em || null,
    alterada_em: c.alterada_em || null
  };
}

export async function onRequestGet({ env, data }) {
  const barrado = soSuper(data);
  if (barrado) return barrado;
  return json(200, { contas: (await equipeListar(env)).map(paraTela) });
}

export async function onRequestPost({ request, env, data }) {
  const barrado = soSuper(data);
  if (barrado) return barrado;

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return erro(400, 'corpo-invalido');
  }

  const usuario = String((corpo && corpo.usuario) || '').trim().toLowerCase();
  if (!App.usuarioValido(usuario)) {
    return erro(400, 'usuario-invalido');
  }
  if (!App.senhaValida(corpo.senha)) {
    return erro(400, 'senha-curta', { minimo: App.SENHA_MINIMA });
  }
  if (!App.permissoesValidas(corpo.permissoes)) {
    return erro(400, 'permissao-desconhecida', null, { permissoes: App.PERMISSOES });
  }
  if (corpo.limiteEnvio != null && !App.limiteEnvioValido(corpo.limiteEnvio)) {
    return erro(400, 'limite-envio-invalido');
  }

  if (await equipeAchar(env, usuario)) return erro(409, 'conta-ja-existe');

  const conta = {
    usuario,
    nome: String((corpo.nome || usuario)).trim().slice(0, 80),
    permissoes: corpo.permissoes.slice(),
    ativa: true,
    versao: 1,
    limiteEnvio: corpo.limiteEnvio || null,
    enviosContagem: 0,
    senha: await hashSenha(corpo.senha, iteracoesDe(env)),
    criada_em: new Date().toISOString(),
    criada_por: data.conta.usuario
  };
  if (!await equipeCriar(env, conta)) return erro(409, 'conta-ja-existe');
  return json(200, { ok: true, conta: paraTela(conta) });
}

export async function onRequestPut({ request, env, data }) {
  const barrado = soSuper(data);
  if (barrado) return barrado;

  let corpo;
  try {
    corpo = await request.json();
  } catch (e) {
    return erro(400, 'corpo-invalido');
  }

  const conta = await equipeAchar(env, corpo && corpo.usuario);
  if (!conta) return erro(404, 'conta-nao-encontrada');

  let derruba = false;   /* mudança que precisa derrubar as sessões abertas */

  if (corpo.nome != null) conta.nome = String(corpo.nome).trim().slice(0, 80) || conta.usuario;

  if (corpo.permissoes != null) {
    if (!App.permissoesValidas(corpo.permissoes)) {
      return erro(400, 'permissao-desconhecida', null, { permissoes: App.PERMISSOES });
    }
    if (JSON.stringify(conta.permissoes || []) !== JSON.stringify(corpo.permissoes)) derruba = true;
    conta.permissoes = corpo.permissoes.slice();
  }

  if (corpo.ativa != null) {
    const ativa = corpo.ativa === true;
    if ((conta.ativa !== false) !== ativa) derruba = true;
    conta.ativa = ativa;
  }

  if (corpo.senha != null) {
    if (!App.senhaValida(corpo.senha)) {
      return erro(400, 'senha-curta', { minimo: App.SENHA_MINIMA });
    }
    conta.senha = await hashSenha(corpo.senha, iteracoesDe(env));
    derruba = true;
  }

  /* `limiteEnvio: null` explícito apaga o limite (volta a "sem limite"); o
   * campo ausente do corpo não mexe no que já está guardado. */
  if ('limiteEnvio' in corpo) {
    if (corpo.limiteEnvio != null && !App.limiteEnvioValido(corpo.limiteEnvio)) {
      return erro(400, 'limite-envio-invalido');
    }
    if (JSON.stringify(conta.limiteEnvio || null) !== JSON.stringify(corpo.limiteEnvio || null)) derruba = true;
    conta.limiteEnvio = corpo.limiteEnvio || null;
  }

  if (derruba) conta.versao = (conta.versao || 1) + 1;
  conta.alterada_em = new Date().toISOString();
  await equipeSalvar(env, conta);
  return json(200, { ok: true, conta: paraTela(conta), sessoesDerrubadas: derruba });
}

export async function onRequestDelete({ request, env, data }) {
  const barrado = soSuper(data);
  if (barrado) return barrado;

  const usuario = String(new URL(request.url).searchParams.get('usuario') || '').trim().toLowerCase();
  if (!await equipeApagar(env, usuario)) return erro(404, 'conta-nao-encontrada');
  return json(200, { ok: true, usuario });
}
