/* scripts/lib/legenda.mjs — a legenda WebVTT servida pela pull zone, do lado
 * dos scripts.
 *
 * A LEITURA MORA em `core/site/indice-core.js`: a busca pela fala precisa do
 * MESMO `condensar()` na mesa, no script e nos testes, e só um arquivo de
 * `core/site/` chega aos três. Este módulo reexporta de lá, com os nomes de
 * sempre. As
 * quatro armadilhas da leitura — o BOM, as legendas rolantes, o ASR cru —
 * estão escritas lá, junto do código que as trata.
 *
 * O que fica aqui é o que só um script faz: baixar da pull zone.
 *
 * ARMADILHA 2 — o caminho é `captions/pt.vtt`, e só ele: `pt-br.vtt` e
 * `por.vtt` respondem 404. E ele vem com `content-type:
 * application/octet-stream`, não `text/vtt` — dá para `fetch()` e parsear,
 * mas um `<track>` do navegador pode recusar.
 *
 * Sem top-level await de propósito: assim `require()` do teste em CommonJS
 * consegue carregar este módulo ESM (Node 22.12+).
 */
import AppIndice from '../../core/site/indice-core.js';

export const { BOM, paraSegundos, paraCarimbo, analisarVtt, juntarSemRepetir, condensar } = AppIndice;

/* O texto cru, sem ler: é o que a busca pela fala condensa e compara. `null`
 * quando o título não tem legenda — é caso previsto (o institucional não tem
 * narração, e o ASR devolveu zero palavra). */
export async function baixarTextoDaLegenda(url, referer) {
  /* O provedor pode proteger a mídia por Allowed Referrers: sem este cabeçalho
   * ele responde 403. Não é opcional. A URL vem do adaptador
   * (`urlDaLegenda` em scripts/lib/provedores): o script não monta URL de provedor. */
  const r = await fetch(url, referer ? { headers: { Referer: referer } } : undefined);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`legenda ${r.status} em ${url}`);
  return r.text();
}

export async function baixarLegenda(url, referer) {
  const texto = await baixarTextoDaLegenda(url, referer);
  return texto == null ? null : analisarVtt(texto);
}
