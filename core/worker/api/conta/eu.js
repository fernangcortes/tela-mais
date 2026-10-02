/* GET /api/conta/eu   -> "Minha conta": quem sou, o que aceitei, o que falta aceitar
 * PUT /api/conta/eu   { nome?, aceite?, versoes? } -> muda o nome e/ou aceita os textos vigentes
 *
 * Espectador: dados da conta no banco. Equipe e superadmin (que entram por /api/login
 * e têm a própria tela em /api/conta) recebem só quem são: não têm conta de espectador.
 *
 * `pendentes` lista os textos (privacidade, termos) cuja versão em vigor a pessoa
 * ainda não aceitou: o site mostra o aviso e a pessoa aceita aqui (PUT com
 * `aceite: true` e as `versoes` que ela viu). */
import { json, erro } from '../../_lib/sessao.js';
import {
  usuarioPorId, consentimentosDe, consentimentosPendentes, mudarEspectador
} from '../../_lib/contas.js';
import { contarSessoes } from '../../_lib/sessoes.js';
import { versoesVigentes } from '../../_lib/contas-legal.js';
import { abrirBanco, lerCorpo, conferirAceite, gravarAceite } from '../../_lib/contas-fluxo.js';

function ehEspectador(data) {
  return data.sessao && data.sessao.papel === 'espectador';
}

export async function onRequestGet({ env, data }) {
  if (!ehEspectador(data)) {
    const c = data.conta || {};
    return json(200, { papel: data.sessao.papel, usuario: c.usuario, nome: c.nome || c.usuario, permissoes: c.permissoes || [] });
  }
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const { db } = aberto;
  const u = await usuarioPorId(db, data.sessao.usuarioId);
  if (!u) return erro(404, 'espectador-nao-encontrado');
  const [consentimentos, vigentes, sessoesAtivas] = await Promise.all([
    consentimentosDe(db, u.id), versoesVigentes(env), contarSessoes(db, u.id)
  ]);
  return json(200, {
    papel: 'espectador',
    email: u.email,
    nome: u.nome,
    status: u.status,
    criadoEm: u.criadoEm,
    consentimentos,
    pendentes: consentimentosPendentes(consentimentos, vigentes),
    versoes: vigentes,
    sessoesAtivas
  });
}

export async function onRequestPut({ request, env, data }) {
  if (!ehEspectador(data)) return erro(403, 'conta-de-equipe');
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const { db } = aberto;
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');

  if (corpo.nome != null) {
    if (typeof corpo.nome !== 'string') return erro(400, 'corpo-invalido');
    await mudarEspectador(db, data.sessao.usuarioId, { nome: corpo.nome.trim() });
  }
  if (corpo.aceite === true) {
    const conferido = await conferirAceite(env, db, data.sessao.usuarioId, corpo);
    if (conferido.falha) return conferido.falha;
    await gravarAceite(env, db, data.sessao.usuarioId, request, conferido);
  }
  return json(200, { ok: true });
}
