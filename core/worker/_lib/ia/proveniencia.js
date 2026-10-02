/* ia/proveniencia.js — o carimbo de tudo que a IA gera: { origem:'ia', modelo, provedor, tarefa, data, revisado:false }.
 *
 * `origem:'ia'` e `revisado:false` NASCEM juntos e só uma pessoa troca o `revisado` (editando e aceitando na tela de
 * sugestões). O carimbo viaja com a sugestão e, quando a pessoa aceita, vai para `item.ia[campo]` ao lado do valor. */

export function proveniencia({ modelo, provedor, tarefa, agora = Date.now }) {
  const ms = typeof agora === 'function' ? agora() : Number(agora);
  return { origem: 'ia', modelo: modelo || null, provedor: provedor || null, tarefa: tarefa || null, data: new Date(ms).toISOString(), revisado: false };
}

/* O carimbo depois da decisão da pessoa. Aceitar sem mexer NÃO é revisar (o texto continua "sugerido por IA, não revisado",
 * como a `sinopse_origem: 'auto'` de sempre); editar antes de aceitar é revisar. */
export function carimboAceito(carimbo, { editado, quem, agora = Date.now }) {
  const ms = typeof agora === 'function' ? agora() : Number(agora);
  return Object.assign({}, carimbo, { revisado: editado === true, editado: editado === true, aceitoPor: quem || null, aceitoEm: new Date(ms).toISOString() });
}
