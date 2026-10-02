/* ia/json.js — tira um JSON da resposta de um modelo de linguagem.
 *
 * Os modelos às vezes embrulham o JSON em ```json ... ``` ou escrevem uma frase antes. Aqui só se aceita o que
 * parseia DE VERDADE: se nada parsear, devolve { ok:false } e quem chamou decide (a retentativa). Nunca "conserta"
 * JSON quebrado: um consertinho esperto pode inventar conteúdo. */

export function extrairJson(texto) {
  const bruto = String(texto == null ? '' : texto).replace(/^﻿/, '').trim();
  if (!bruto) return { ok: false, motivo: 'resposta vazia' };
  const candidatos = [bruto];
  const cerca = bruto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) candidatos.push(cerca[1].trim());
  const ini = bruto.search(/[{[]/);
  if (ini >= 0) {
    const abre = bruto[ini];
    const fecha = abre === '{' ? '}' : ']';
    const fim = bruto.lastIndexOf(fecha);
    if (fim > ini) candidatos.push(bruto.slice(ini, fim + 1));
  }
  for (const c of candidatos) {
    try { return { ok: true, valor: JSON.parse(c) }; } catch (e) { /* tenta o próximo */ }
  }
  return { ok: false, motivo: 'a resposta não é um JSON válido' };
}
