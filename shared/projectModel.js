export function criarEstiloPadrao() {
  return {
    fonte: 'Roboto Flex',
    pesoFonte: 500,
    italico: false,
    fonteUrl: null,
    tamanhoBase: 42,
    corBase: '#FFFFFF',
    corDestaque: '#EF9F27',
    escalaDestaque: 1.3,
    offsetX: 0,
    offsetY: 0,
    duracaoTransicaoMs: 120,
    posicaoY: 0.85,
    modoRevelacao: 'silaba',
    
  };
}

// Mescla o estilo padrão do projeto com o override individual da palavra
// (se houver). Override é parcial — só os campos definidos substituem.
export function resolverEstilo(estiloPadrao, overrideIndividual) {
  if (!overrideIndividual) return { ...estiloPadrao };
  return { ...estiloPadrao, ...overrideIndividual };
}

// Cria um projeto novo a partir dos blocos já parseados do SRT.
export function criarProjeto({ nome, caminhoVideo, blocos }) {
  return {
    nome,
    criadoEm: new Date().toISOString(),
    caminhoVideo,
    estiloPadrao: criarEstiloPadrao(),
    blocos,
    // Presets nomeados que o usuário pode criar e aplicar a grupos de
    // palavras selecionadas (ex: "nomes próprios", "ênfase").
    presets: {},
    // Referência global de volume (min/max/média ponderada por duração),
    // preenchida quando a sincronização automática de áudio roda (ver
    // server/audioSyncService.js). Fica null até lá — projetos criados
    // só a partir de .srt (sem análise de áudio) nunca têm essa métrica,
    // e a timeline deve simplesmente não colorir as palavras nesse caso.
    volumeReferencia: null,
  };
}

// Aplica um preset (objeto parcial de estilo) a uma lista de IDs de
// palavra dentro do projeto. Retorna um novo projeto (imutável).
export function aplicarPresetAPalavras(projeto, presetParcial, idsAlvo) {
  const idsSet = new Set(idsAlvo);
  const blocos = projeto.blocos.map((bloco) => ({
    ...bloco,
    palavras: bloco.palavras.map((palavra) => {
      if (!idsSet.has(palavra.id)) return palavra;
      return {
        ...palavra,
        estilo: { ...(palavra.estilo || {}), ...presetParcial },
      };
    }),
  }));
  return { ...projeto, blocos };
}

// Calcula, para um dado tempo (em segundos), qual é a palavra ativa e o
// progresso de revelação letra-a-letra dentro dela (0 a 1).
export function calcularEstadoNoTempo(projeto, tempoAtual) {
  for (const bloco of projeto.blocos) {
    if (tempoAtual < bloco.inicio || tempoAtual > bloco.fim) continue;

    for (const palavra of bloco.palavras) {
      const ativa = tempoAtual >= palavra.inicio && tempoAtual <= palavra.fim;
      const estiloResolvido = resolverEstilo(
        projeto.estiloPadrao,
        palavra.estilo
      );

      if (ativa) {
        const duracao = palavra.fim - palavra.inicio;
        const progresso =
          duracao > 0 ? (tempoAtual - palavra.inicio) / duracao : 1;
        const totalLetras = palavra.texto.length;
        const letrasReveladas = Math.min(
          totalLetras,
          Math.floor(progresso * totalLetras) + 1
        );

        return {
          blocoId: bloco.id,
          palavraAtivaId: palavra.id,
          progresso: Math.min(1, Math.max(0, progresso)),
          letrasReveladas,
          totalLetras,
          estilo: estiloResolvido,
        };
      }
    }
  }
  return null;
}

// ============================================================
// Cor por volume — usado pela TelaTimeline para pintar cada bloco
// de palavra conforme seu volume relativo à média do áudio.
// ============================================================
//
// Regra pedida pelo usuário:
//   - Palavra na MÉDIA de dB do áudio -> VERDE
//   - Palavra ABAIXO da média -> tons de AZUL (quanto mais baixo, mais
//     azul/saturado)
//   - Palavra ACIMA da média -> tons de VERMELHO (quanto mais alto, mais
//     vermelho/saturado)
//   - Gradiente CONTÍNUO (não faixas fixas): interpola suavemente
//     azul -> verde entre [min, média] e verde -> vermelho entre
//     [média, max].
//
// `media` aqui é a média de volumeDb PONDERADA PELA DURAÇÃO de cada
// palavra (ver aligner.py#calcular_volume_por_palavra e
// audioSyncService.js#calcularReferenciasDeVolume) — isso evita que
// palavras muito curtas (medição de RMS mais instável) puxem o "centro"
// de referência de forma desproporcional.

const COR_AZUL_RGB = [91, 141, 239];   // mesma família do --accent-blue do design system
const COR_VERDE_RGB = [111, 191, 139]; // mesma família do --accent-success
const COR_VERMELHA_RGB = [229, 103, 95]; // mesma família do --accent-danger

export function interpolarRgb(corA, corB, t) {
  const tClamp = Math.min(1, Math.max(0, t));
  return corA.map((canalA, i) => Math.round(canalA + (corB[i] - canalA) * tClamp));
}

export function rgbParaHex([r, g, b]) {
  const paraHex = (n) => n.toString(16).padStart(2, '0');
  return `#${paraHex(r)}${paraHex(g)}${paraHex(b)}`;
}

/**
 * Calcula a cor (hex) correspondente a um volumeDb, dado o range de
 * referência [min, media, max] do áudio inteiro.
 *
 * - volumeDb === media -> verde puro
 * - volumeDb === min -> azul puro
 * - volumeDb === max -> vermelho puro
 * - valores entre os pontos -> gradiente linear contínuo
 *
 * Casos de borda:
 * - Se min === max (áudio com volume constante, ou só 1 palavra), ou se
 *   qualquer um dos três valores for inválido, devolve a cor neutra
 *   (verde) para não gerar NaN/cor quebrada na interface.
 * - Se media coincidir com min (ou com max), o lado sem "espaço" para
 *   interpolar simplesmente não é alcançável e a função ainda assim
 *   produz uma cor válida (evita divisão por zero).
 *
 * @param {number} volumeDb
 * @param {number} volumeDbMin
 * @param {number} volumeDbMedia
 * @param {number} volumeDbMax
 * @returns {string} cor em hex, ex: "#6fbf8b"
 */
export function corPorVolume(volumeDb, volumeDbMin, volumeDbMedia, volumeDbMax) {
  if (
    typeof volumeDb !== 'number' || !Number.isFinite(volumeDb) ||
    typeof volumeDbMin !== 'number' || !Number.isFinite(volumeDbMin) ||
    typeof volumeDbMedia !== 'number' || !Number.isFinite(volumeDbMedia) ||
    typeof volumeDbMax !== 'number' || !Number.isFinite(volumeDbMax) ||
    volumeDbMax <= volumeDbMin
  ) {
    return rgbParaHex(COR_VERDE_RGB);
  }

  // Garante que a média esteja de fato entre min e max (defesa contra
  // dados inconsistentes vindos de fontes externas/antigas).
  const media = Math.min(Math.max(volumeDbMedia, volumeDbMin), volumeDbMax);

  if (volumeDb <= media) {
    const faixaInferior = media - volumeDbMin;
    if (faixaInferior <= 1e-6) return rgbParaHex(COR_VERDE_RGB);
    // t = 0 no mínimo (azul) -> t = 1 na média (verde)
    const t = (volumeDb - volumeDbMin) / faixaInferior;
    return rgbParaHex(interpolarRgb(COR_AZUL_RGB, COR_VERDE_RGB, t));
  }

  const faixaSuperior = volumeDbMax - media;
  if (faixaSuperior <= 1e-6) return rgbParaHex(COR_VERDE_RGB);
  // t = 0 na média (verde) -> t = 1 no máximo (vermelho)
  const t = (volumeDb - media) / faixaSuperior;
  return rgbParaHex(interpolarRgb(COR_VERDE_RGB, COR_VERMELHA_RGB, t));
}

/**
 * Atalho conveniente: recebe a própria palavra e o objeto
 * `volumeReferencia` salvo no projeto (ou undefined/null), e devolve a
 * cor já resolvida — ou `null` se não houver dados de volume suficientes
 * para calcular (palavra sem volumeDb, ou projeto sem volumeReferencia,
 * ex: projetos criados só a partir de .srt sem sincronização de áudio).
 * A TelaTimeline usa esse `null` para cair de volta na cor sólida
 * padrão de antes.
 *
 * @param {{ volumeDb?: number }} palavra
 * @param {{ volumeDbMin: number, volumeDbMedia: number, volumeDbMax: number } | null | undefined} volumeReferencia
 * @returns {string | null}
 */
export function corDaPalavraPorVolume(palavra, volumeReferencia) {
  if (!palavra || typeof palavra.volumeDb !== 'number' || !Number.isFinite(palavra.volumeDb)) {
    return null;
  }
  if (!volumeReferencia) return null;
  const { volumeDbMin, volumeDbMedia, volumeDbMax } = volumeReferencia;
  return corPorVolume(palavra.volumeDb, volumeDbMin, volumeDbMedia, volumeDbMax);
}

// NOTA sobre sistema de módulos: este arquivo é CommonJS puro (usado
// pelo server via `require`). Para o client (Vite/ESM) usar as mesmas
// funções sem duplicar lógica, importe assim (Vite faz a interop de
// CJS -> ESM automaticamente para módulos locais):
//
//   import projectModel from '../../../shared/projectModel';
//   const cor = projectModel.corDaPalavraPorVolume(palavra, projeto.volumeReferencia);
//
// ou, se preferir desestruturar:
//
//   import * as projectModel from '../../../shared/projectModel';
//   const { corDaPalavraPorVolume } = projectModel;
//
// (ver client/src/components/TelaTimeline.jsx, que já faz isso.)

