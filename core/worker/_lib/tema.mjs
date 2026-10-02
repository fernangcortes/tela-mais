/* core/worker/_lib/tema.mjs — resolve o tema efetivo: preset + o que o cliente trocou.
 *
 * Funções puras (config -> objeto), ESM sem dependências. Mora em core/worker/_lib/
 * porque o validador (que roda no Worker) precisa do MESMO resultado que o gerador
 * de theme.css e o editor de tema do /admin: uma conta só.
 *
 * Camadas, da mais fraca para a mais forte: padrões embutidos (cinema) < preset
 * escolhido < tema.* do config. Por isso o schema NÃO tem `default` nas cores, na
 * forma nem na tipografia: um padrão ali passaria por cima do preset escolhido.
 */
import { PRESETS, PRESET_PADRAO } from '../../presets/temas/index.mjs';
import { normalizarHex, ehHex } from './contraste.mjs';

export const CHAVES_DE_COR = [
  'marca', 'marcaClara', 'marcaFraca', 'marca2', 'marca3', 'textoSobreMarca', 'textoSobreDestaque',
  'fundo', 'superficie', 'texto', 'textoFraco', 'borda', 'contorno',
  'alerta', 'alertaFundo', 'erro', 'erroFundo', 'mesaFundo', 'mesaPainel', 'mesaPainelAlto'
];

export const RESERVA_CORPO = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const RESERVA_MONO = "ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace";

const FORMA_PADRAO = { raioPx: 10, sombra: 'none', larguraMaximaPx: 1400, espacoBasePx: 4 };
const ESCALA_PADRAO = { micro: 12, menor: 13, corpo: 15, base: 16, maior: 18, titulo: 20, secao: 22 };

function soCores(origem) {
  const saida = {};
  for (const k of CHAVES_DE_COR) if (ehHex(origem?.[k])) saida[k] = normalizarHex(origem[k]);
  return saida;
}

/* Escala de tipo: `tamanhoBasePx` (16 por padrão) leva todos os degraus junto,
 * para quem precisa de letra maior; `escala.*` troca um degrau específico. */
export function resolverEscala(tipografia = {}) {
  const base = tipografia.tamanhoBasePx ?? 16;
  const fator = base / 16;
  const saida = {};
  for (const [k, v] of Object.entries(ESCALA_PADRAO)) {
    saida[k] = tipografia.escala?.[k] ?? Math.round(v * fator * 10) / 10;
  }
  if (tipografia.escala?.base === undefined) saida.base = base;
  return saida;
}

/* `config` pode ser o bruto ou o validado (com padrões): só lê `config.tema`.
 * Devolve:
 *   { preset, modo, modos[], cores:{escuro,claro}, sobrescritas:{escuro:Set,claro:Set},
 *     forma, tipografia, movimento }
 * `modos` são as paletas que PODEM aparecer na tela (auto = as duas). */
export function resolverTema(config) {
  const t = config?.tema || {};
  const nomePreset = PRESETS[t.preset] ? t.preset : PRESET_PADRAO;
  const preset = PRESETS[nomePreset];
  const modo = ['escuro', 'claro', 'auto'].includes(t.modo) ? t.modo : preset.modoPadrao;

  const cores = {};
  const sobrescritas = {};
  for (const esq of ['escuro', 'claro']) {
    const meus = soCores(t.cores?.[esq]);
    cores[esq] = { ...soCores(preset.cores[esq]), ...meus };
    sobrescritas[esq] = new Set(Object.keys(meus));
  }

  const tip = t.tipografia || {};
  const tipPreset = preset.tipografia || {};
  const slot = (nome) => {
    const v = tip[nome] ?? tipPreset[nome];
    return v && v.familia ? { origem: 'sistema', arquivos: [], ...v } : null;
  };
  const tipografia = {
    titulo: slot('titulo'),
    corpo: slot('corpo'),
    mono: slot('mono'),
    reserva: tip.reserva ?? tipPreset.reserva ?? RESERVA_CORPO,
    reservaTitulo: tip.reservaTitulo ?? tipPreset.reservaTitulo ?? null,
    reservaMono: tip.reservaMono ?? tipPreset.reservaMono ?? RESERVA_MONO,
    escala: resolverEscala({ tamanhoBasePx: tip.tamanhoBasePx, escala: { ...(tipPreset.escala || {}), ...(tip.escala || {}) } })
  };

  return {
    preset: nomePreset,
    modo,
    modos: modo === 'auto' ? ['escuro', 'claro'] : [modo],
    cores,
    sobrescritas,
    forma: { ...FORMA_PADRAO, ...(preset.forma || {}), ...(t.forma || {}) },
    tipografia,
    movimento: { curva: 'ease', ...(t.movimento || {}) }
  };
}

/* A cor do fundo que vale "na chegada": a do modo escolhido (em auto, a do escuro,
 * que é o que o :root pinta quando o aparelho não diz nada). Usada no manifest e
 * na meta theme-color, para a barra do celular não piscar outra cor. */
export function fundoDaChegada(tema) {
  return tema.modo === 'claro' ? tema.cores.claro.fundo : tema.cores.escuro.fundo;
}

/* Pilha de fontes pronta para o CSS: "Inter", system-ui, ... A família vem validada
 * (letras, números, espaço, _ e -), então aspas duplas bastam. */
export function pilhaDeFontes(slot, reserva) {
  return slot ? `"${slot.familia}", ${reserva}` : reserva;
}

/* Lista os woff2 que o tema usa: [{ slot, familia, arquivo, peso }]. `peso` é um
 * número ("700") ou a faixa de fonte variável ("100 900"). */
export function fontesDeArquivo(tema) {
  const saida = [];
  for (const nome of ['titulo', 'corpo', 'mono']) {
    const s = tema.tipografia[nome];
    if (!s || s.origem !== 'arquivo') continue;
    (s.arquivos || []).forEach((arquivo, i) => {
      const peso = s.pesos?.[i] ?? (s.arquivos.length === 1 ? '100 900' : 400);
      saida.push({ slot: nome, familia: s.familia, arquivo, peso: String(peso) });
    });
  }
  return saida;
}
