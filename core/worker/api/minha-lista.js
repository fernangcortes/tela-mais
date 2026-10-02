/* /api/minha-lista — os títulos que a pessoa guardou para ver depois (M6).
 *
 *   GET                   -> { ids: [...] }  do guardado mais recente ao mais antigo
 *   POST   { id }         -> guarda o título (de novo, só o põe na frente); 409 `minha-lista-cheia` no teto
 *   DELETE ?id=<título>   -> tira da lista (ou { id } no corpo)
 *
 * SÓ PARA QUEM TEM CONTA DE ESPECTADOR (D1). A equipe e o superadmin não têm "pessoa" a que a lista pertença
 * e recebem 403 `conta-de-equipe`; sem banco, 503 como o resto das contas; com `recursos.minhaLista` desligado,
 * 404. A lista é sempre a DE QUEM FAZ O PEDIDO: não existe parâmetro de pessoa, então não há como ler ou mexer na
 * lista de outra. O id do título não é conferido contra o catálogo (seria ler o catálogo inteiro a cada toque):
 * quem lê a lista é a home, que só mostra o que está no ar.
 *
 * Alterar exige origem confiável (o mesmo teste do login): o cookie é SameSite=Lax, e este cabeçalho é a segunda
 * trava contra um site de fora mexer na lista de alguém. */
import { json, erro } from '../_lib/sessao.js';
import { abrirBanco, lerCorpo } from '../_lib/contas-fluxo.js';
import { minhaListaDe, guardarNaMinhaLista, tirarDaMinhaLista } from '../_lib/contas.js';
import { origemConfiavel } from '../_lib/sessoes.js';

const ID_VALIDO = /^[^\u0000-\u001f\u007f]{1,200}$/;

function ligada(config) {
  return !config || !config.recursos || config.recursos.minhaLista !== false;
}

async function preparar({ env, data, config }) {
  if (!ligada(config)) return { falha: erro(404, 'recurso-indisponivel') };
  if (!data.sessao || data.sessao.papel !== 'espectador') return { falha: erro(403, 'conta-de-equipe') };
  return abrirBanco(env);
}

export async function onRequestGet(ctx) {
  const p = await preparar(ctx);
  if (p.falha) return p.falha;
  return json(200, { ids: await minhaListaDe(p.db, ctx.data.sessao.usuarioId) });
}

export async function onRequestPost(ctx) {
  if (!origemConfiavel(ctx.request)) return erro(403, 'origem-invalida');
  const p = await preparar(ctx);
  if (p.falha) return p.falha;
  const corpo = await lerCorpo(ctx.request);
  if (!corpo || typeof corpo.id !== 'string' || !ID_VALIDO.test(corpo.id)) return erro(400, 'id-invalido');
  const r = await guardarNaMinhaLista(p.db, ctx.data.sessao.usuarioId, corpo.id);
  if (r === 'cheia') return erro(409, 'minha-lista-cheia');
  return json(200, { ok: true });
}

export async function onRequestDelete(ctx) {
  if (!origemConfiavel(ctx.request)) return erro(403, 'origem-invalida');
  const p = await preparar(ctx);
  if (p.falha) return p.falha;
  let id = new URL(ctx.request.url).searchParams.get('id');
  if (!id) {
    const corpo = await lerCorpo(ctx.request);
    id = corpo && typeof corpo.id === 'string' ? corpo.id : '';
  }
  if (!id || !ID_VALIDO.test(id)) return erro(400, 'id-invalido');
  await tirarDaMinhaLista(p.db, ctx.data.sessao.usuarioId, id);
  return json(200, { ok: true });
}
