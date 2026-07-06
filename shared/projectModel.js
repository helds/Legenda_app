function criarEstiloPadrao() {
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
function resolverEstilo(estiloPadrao, overrideIndividual) {
  if (!overrideIndividual) return { ...estiloPadrao };
  return { ...estiloPadrao, ...overrideIndividual };
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

module.exports = {
  criarEstiloPadrao,
  resolverEstilo,
  criarProjeto,
  aplicarPresetAPalavras,
  calcularEstadoNoTempo,
};