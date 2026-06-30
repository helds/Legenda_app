// client/src/remotion/CaptionComposition.jsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

// Resolve o estilo final de uma palavra: estilo padrão do projeto +
// override individual (se houver). Mesma lógica do shared/projectModel.js,
// duplicada aqui em formato de componente porque o Remotion roda em
// ambiente de browser isolado (sem acesso direto ao require do server).
function resolverEstilo(estiloPadrao, overrideIndividual) {
  if (!overrideIndividual) return estiloPadrao;
  return { ...estiloPadrao, ...overrideIndividual };
}

// Calcula quantas letras já devem estar "reveladas" (no estado ativo)
// dado o progresso de tempo dentro da palavra.
function calcularLetrasReveladas(progresso, totalLetras) {
  if (progresso <= 0) return 0;
  if (progresso >= 1) return totalLetras;
  return Math.floor(progresso * totalLetras);
}

// Uma única letra, com sua própria animação de escala/offset/cor baseada
// em estar revelada, em transição, ou ainda não alcançada.
function Letra({ char, estaRevelada, estaEmTransicao, progressoTransicao, estilo }) {
  const {
    corBase,
    corDestaque,
    tamanhoBase,
    escalaDestaque,
    offsetX,
    offsetY,
  } = estilo;

  let escala = 1;
  let dx = 0;
  let dy = 0;
  let cor = corBase;

  if (estaRevelada) {
    cor = corDestaque;
  }

  if (estaEmTransicao) {
    // Easing suave: sobe rápido, desce um pouco mais devagar — sensação
    // de "pulso" natural na letra sendo pronunciada.
    const subida = interpolate(progressoTransicao, [0, 0.4], [1, escalaDestaque], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
    const descida = interpolate(progressoTransicao, [0.4, 1], [escalaDestaque, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });
    escala = progressoTransicao < 0.4 ? subida : descida;

    const fatorDeslocamento = progressoTransicao < 0.4
      ? interpolate(progressoTransicao, [0, 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      : interpolate(progressoTransicao, [0.4, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

    dx = offsetX * fatorDeslocamento;
    dy = offsetY * fatorDeslocamento;
    cor = corDestaque;
  }

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: tamanhoBase,
        color: cor,
        transform: `translate(${dx}px, ${dy}px) scale(${escala})`,
        transformOrigin: 'center bottom',
        whiteSpace: 'pre',
      }}
    >
      {char}
    </span>
  );
}

// Renderiza uma palavra inteira, decompondo em letras e calculando o
// estado de revelação de cada uma com base no frame atual.
function Palavra({ palavra, estiloPadrao, tempoAtualSegundos }) {
  const estilo = resolverEstilo(estiloPadrao, palavra.estilo);
  const { texto, inicio, fim } = palavra;
  const totalLetras = texto.length;

  const duracao = fim - inicio;
  const progresso = duracao > 0
    ? Math.min(1, Math.max(0, (tempoAtualSegundos - inicio) / duracao))
    : 1;

  const letrasReveladas = calcularLetrasReveladas(progresso, totalLetras);

  // Janela de transição por letra: cada letra tem uma fatia de tempo
  // dentro da palavra para fazer sua própria animação de pulso.
  const duracaoTransicaoMs = estilo.duracaoTransicaoMs || 120;
  const duracaoTransicaoSeg = duracaoTransicaoMs / 1000;

  return (
    <span style={{ display: 'inline-block', fontFamily: estilo.fonte, fontWeight: estilo.pesoFonte }}>
      {[...texto].map((char, idx) => {
        const tempoInicioLetra = inicio + (idx / totalLetras) * duracao;
        const tempoFimTransicao = tempoInicioLetra + duracaoTransicaoSeg;

        const estaRevelada = idx < letrasReveladas;
        const estaEmTransicao =
          tempoAtualSegundos >= tempoInicioLetra &&
          tempoAtualSegundos <= tempoFimTransicao;

        const progressoTransicao = estaEmTransicao
          ? Math.min(1, (tempoAtualSegundos - tempoInicioLetra) / duracaoTransicaoSeg)
          : 0;

        return (
          <Letra
            key={idx}
            char={char}
            estaRevelada={estaRevelada || estaEmTransicao}
            estaEmTransicao={estaEmTransicao}
            progressoTransicao={progressoTransicao}
            estilo={estilo}
          />
        );
      })}
    </span>
  );
}

// Composição principal: recebe o projeto inteiro como prop (vindo do
// arquivo de projeto .json) e renderiza a legenda correspondente ao
// frame atual.
export function CaptionComposition({ projeto, corFundo }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tempoAtualSegundos = frame / fps;

  const blocoAtivo = projeto.blocos.find(
    (b) => tempoAtualSegundos >= b.inicio && tempoAtualSegundos <= b.fim
  );

  // posicaoY: 0 = topo, 1 = base. Com alignItems:'flex-end', o item já
  // fica colado na base por padrão — paddingBottom precisa ser o
  // COMPLEMENTO de posicaoY (não o valor direto), senão o resultado fica
  // invertido (posicaoY alto empurraria o texto pra cima, não pra baixo).
  const posicaoY = projeto.estiloPadrao.posicaoY ?? 0.85;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: corFundo || 'transparent',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: `${(1 - posicaoY) * 100}%`,
      }}
    >
      {blocoAtivo && (
        <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', justifyContent: 'center' }}>
          {blocoAtivo.palavras.map((palavra) => (
            <Palavra
              key={palavra.id}
              palavra={palavra}
              estiloPadrao={projeto.estiloPadrao}
              tempoAtualSegundos={tempoAtualSegundos}
            />
          ))}
        </div>
      )}
    </div>
  );
}