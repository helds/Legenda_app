// shared/projectModel.js
// Define a estrutura de um "projeto" (vídeo + legendas + estilos) e a
// lógica de resolução de estilo: cada palavra herda do estilo padrão do
// projeto a menos que tenha overrides próprios.

// Estilo padrão de um projeto novo. Esses valores podem ser editados na
// aba "Padrões" da interface e afetam todas as palavras que não têm
// override individual.
function criarEstiloPadrao() {
  return {
    fonte: 'Inter',
    estiloFonte: 'normal', // 'normal' | 'negrito' | 'italico' | 'negrito-italico'
    tamanhoBase: 42, // px, tamanho da palavra "inativa"
    corBase: '#FFFFFF', // cor antes de ser destacada
    corDestaque: '#EF9F27', // cor quando a palavra está "ativa"
    escalaDestaque: 1.3, // multiplicador de tamanho no pico do destaque
    offsetX: 0, // deslocamento horizontal no pico do destaque, px
    offsetY: -6, // deslocamento vertical no pico do destaque, px
    duracaoTransicaoMs: 120, // tempo de subida/descida da escala
    posicaoY: 0.85, // posição vertical na tela, 0 = topo, 1 = base

    // Quando true, estiloFonte só é aplicado enquanto a palavra está em
    // destaque/transição; fora disso ela renderiza com peso/estilo
    // 'normal'. Quando false, o estilo de fonte é fixo, independente do
    // estado de destaque.
    estiloFonteSoNoDestaque: false,

    // Modo de revelação da legenda, inspirado no design system
    // "Caption with Intention": 'palavra' muda a cor da palavra inteira
    // de uma vez, no instante em que ela começa a ser falada. 'letra'
    // mantém o comportamento legado, revelando letra por letra de forma
    // progressiva. 'silaba' anima cada sílaba da palavra como uma
    // unidade própria (separação automática via shared/silabizador.js),
    // útil para dar ênfase à cadência de palavras faladas de forma
    // silabada (ver seção 2.2.4 "Syllable Variation" do design system).
    modoRevelacao: 'palavra', // 'palavra' | 'letra' | 'silaba'

    // Escala aplicada no efeito "pulo" quando uma palavra inteira é
    // destacada (modoRevelacao === 'palavra'). 1.15 = aumenta 15% do
    // tamanho antes de voltar ao normal.
    escalaPulo: 1.15,

    // Elevação do efeito "pulo", como fração da altura da fonte (não
    // pixels fixos). 0.25 = eleva a palavra em ~25% da altura do tipo
    // no pico da animação, antes de voltar à posição original.
    elevacaoPulo: 0.25,

    // Opacidade do texto em corBase antes da palavra começar a ser
    // falada (fase de "leitura adiantada"/read-ahead). 0.9 = 90%,
    // conforme o design system de referência.
    opacidadeAntesDoDestaque: 0.9,

    // --- Automação por volume (ver server/audioSyncService.js) ---
    // Quando o projeto é sincronizado a partir de áudio (forced
    // alignment), cada palavra pode carregar um campo `volumeNormalizado`
    // (0 a 1) calculado a partir do volume real da fala. Esses limites
    // definem o range de tamanho de fonte (px) usado por
    // aplicarVolumeAoTamanho() para converter esse volume em tamanho
    // visual, seguindo a lógica de 2.3.6 "Type Size Range" do design
    // system (voz mais alta = tipo maior).
    tamanhoMinimoPorVolume: 28, // px, para volumeNormalizado = 0
    tamanhoMaximoPorVolume: 64, // px, para volumeNormalizado = 1

    // --- Fundo da legenda (caixa atrás do texto) ---
    fundo: {
      ativo: false,
      cor: '#000000',
      opacidade: 0.6, // 0 a 1
      paddingX: 16, // px, espaçamento horizontal interno
      paddingY: 8, // px, espaçamento vertical interno
      raioBorda: 8, // px, border-radius
      offsetX: 0, // px, desloca a caixa em relação ao texto
      offsetY: 0, // px
    },
  };
}

// Mescla o estilo padrão do projeto com o override individual da palavra
// (se houver). Override é parcial — só os campos definidos substituem.
// O campo "fundo" é mesclado de forma rasa (shallow) também, então um
// override parcial de fundo (ex: só a cor) não apaga o resto.
function resolverEstilo(estiloPadrao, overrideIndividual) {
  if (!overrideIndividual) return { ...estiloPadrao };
  const mesclado = { ...estiloPadrao, ...overrideIndividual };
  if (overrideIndividual.fundo) {
    mesclado.fundo = { ...estiloPadrao.fundo, ...overrideIndividual.fundo };
  }
  return mesclado;
}

// Cria um projeto novo a partir dos blocos já parseados do SRT.
function criarProjeto({ nome, caminhoVideo, blocos }) {
  return {
    nome,
    criadoEm: new Date().toISOString(),
    caminhoVideo,
    estiloPadrao: criarEstiloPadrao(),
    blocos,
    // Presets nomeados que o usuário pode criar e aplicar a grupos de
    // palavras selecionadas (ex: "nomes próprios", "ênfase").
    presets: {},
  };
}

// Aplica um preset (objeto parcial de estilo) a uma lista de IDs de
// palavra dentro do projeto. Retorna um novo projeto (imutável).
function aplicarPresetAPalavras(projeto, presetParcial, idsAlvo) {
  const idsSet = new Set(idsAlvo);
  const blocos = projeto.blocos.map((bloco) => ({
    ...bloco,
    palavras: bloco.palavras.map((palavra) => {
      if (!idsSet.has(palavra.id)) return palavra;
      const estiloAtual = palavra.estilo || {};
      const novoEstilo = { ...estiloAtual, ...presetParcial };
      if (presetParcial.fundo) {
        novoEstilo.fundo = { ...(estiloAtual.fundo || {}), ...presetParcial.fundo };
      }
      return {
        ...palavra,
        estilo: novoEstilo,
      };
    }),
  }));
  return { ...projeto, blocos };
}

// Aplica um preset de estilo a TODAS as palavras do projeto, sobrescrevendo
// o estilo padrão global. Usado pelo "Modo Global" da interface — em vez
// de criar overrides individuais em cada palavra, atualiza diretamente o
// estiloPadrao do projeto (palavras sem override continuam herdando dele).
function atualizarEstiloPadrao(projeto, parcial) {
  const estiloPadrao = { ...projeto.estiloPadrao, ...parcial };
  if (parcial.fundo) {
    estiloPadrao.fundo = { ...projeto.estiloPadrao.fundo, ...parcial.fundo };
  }
  return { ...projeto, estiloPadrao };
}

// Automação: percorre todas as palavras do projeto e, para cada uma que
// tenha um `volumeNormalizado` (0 a 1, preenchido pelo forced alignment
// em server/audioSyncService.js), cria/atualiza um override individual
// de `tamanhoBase` proporcional ao volume, dentro do range definido por
// estiloPadrao.tamanhoMinimoPorVolume / tamanhoMaximoPorVolume.
//
// Palavras sem `volumeNormalizado` (ex: adicionadas manualmente, ou
// projetos que não passaram por sincronização de áudio) não são
// alteradas. A operação é não-destrutiva quanto a outros campos do
// override: só o campo `tamanhoBase` é escrito/sobrescrito.
//
// Retorna um novo projeto (imutável), assim como as demais funções de
// aplicação de estilo deste módulo.
function aplicarVolumeAoTamanho(projeto) {
  const {
    tamanhoMinimoPorVolume = 28,
    tamanhoMaximoPorVolume = 64,
  } = projeto.estiloPadrao;

  const blocos = projeto.blocos.map((bloco) => ({
    ...bloco,
    palavras: bloco.palavras.map((palavra) => {
      if (typeof palavra.volumeNormalizado !== 'number') return palavra;

      const v = Math.min(1, Math.max(0, palavra.volumeNormalizado));
      const tamanhoBase = Math.round(
        tamanhoMinimoPorVolume + v * (tamanhoMaximoPorVolume - tamanhoMinimoPorVolume)
      );

      const estiloAtual = palavra.estilo || {};
      return {
        ...palavra,
        estilo: { ...estiloAtual, tamanhoBase },
      };
    }),
  }));

  return { ...projeto, blocos };
}

// Calcula, para um dado tempo (em segundos), qual é a palavra ativa e o
// progresso de revelação letra-a-letra dentro dela (0 a 1).
function calcularEstadoNoTempo(projeto, tempoAtual) {
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

// Converte o campo estiloFonte ('normal' | 'negrito' | 'italico' |
// 'negrito-italico') nas propriedades CSS correspondentes de
// font-weight e font-style.
function resolverPropriedadesFonte(estiloFonte) {
  switch (estiloFonte) {
    case 'negrito':
      return { fontWeight: 700, fontStyle: 'normal' };
    case 'italico':
      return { fontWeight: 400, fontStyle: 'italic' };
    case 'negrito-italico':
      return { fontWeight: 700, fontStyle: 'italic' };
    case 'normal':
    default:
      return { fontWeight: 400, fontStyle: 'normal' };
  }
}

module.exports = {
  criarEstiloPadrao,
  resolverEstilo,
  criarProjeto,
  aplicarPresetAPalavras,
  atualizarEstiloPadrao,
  aplicarVolumeAoTamanho,
  calcularEstadoNoTempo,
  resolverPropriedadesFonte,
};
