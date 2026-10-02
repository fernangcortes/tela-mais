/* GET /api/legal   -> { documentos: { privacidade, termos }, padroes }   (aberto)
 * PUT /api/legal   { tipo, campos?, textos? }                            (superadmin)
 *
 * Política de privacidade e termos de uso. O texto MODELO vem dos catálogos de idioma
 * (`legal.*`); aqui só vão os campos do cliente (controlador, contato, retenção), o
 * texto próprio por idioma (que substitui o modelo) e a VERSÃO, que sobe a cada
 * alteração: o consentimento registra a versão aceita, e mudou o texto, pede de novo.
 *
 * `padroes` traz o nome da organização e da marca para o modelo usar quando o cliente
 * ainda não preencheu o controlador. Sem D1, vale o modelo, versão 1 (e o PUT responde
 * 503). O cliente é o controlador dos dados: o modelo é um ponto de partida, não parecer
 * jurídico. */
import { json, erro } from '../_lib/sessao.js';
import { lerDocumentos, salvarDocumento, TIPOS_LEGAIS } from '../_lib/contas-legal.js';
import { abrirBanco, lerCorpo } from '../_lib/contas-fluxo.js';

export async function onRequestGet({ env, config }) {
  const marca = (config && config.marca) || {};
  return json(200, {
    documentos: await lerDocumentos(env),
    padroes: { controlador: marca.organizacao || marca.nome || '' }
  });
}

export async function onRequestPut({ request, env, data }) {
  const aberto = await abrirBanco(env);
  if (aberto.falha) return aberto.falha;
  const corpo = await lerCorpo(request);
  if (!corpo) return erro(400, 'corpo-invalido');
  if (TIPOS_LEGAIS.indexOf(corpo.tipo) < 0) return erro(400, 'documento-invalido');
  const salvo = await salvarDocumento(aberto.db, corpo.tipo, corpo, data.conta && data.conta.usuario);
  return json(200, { ok: true, documento: salvo });
}
