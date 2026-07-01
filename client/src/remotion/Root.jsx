// client/src/remotion/Root.jsx
import React from 'react';
import { Composition } from 'remotion';
import { CaptionComposition } from './CaptionComposition';

// Calcula a duração total em frames a partir do último timestamp de
// palavra no projeto, com uma pequena margem de segurança no final.
function calcularDuracaoEmFrames(projeto, fps) {
  let ultimoTempo = 0;
  projeto.blocos.forEach((bloco) => {
    if (bloco.fim > ultimoTempo) ultimoTempo = bloco.fim;
  });
  const margemSegundos = 0.5;
  return Math.ceil((ultimoTempo + margemSegundos) * fps);
}

// O projeto é injetado via defaultProps no momento do render (ver
// server/render.js), então aqui usamos um projeto vazio só como
// fallback para o Remotion Studio não quebrar ao abrir sem dados.
const projetoVazio = {
  blocos: [],
  estiloPadrao: {
    fonte: 'Inter',
    estiloFonte: 'normal',
    estiloFonteSoNoDestaque: false,
    tamanhoBase: 42,
    corBase: '#FFFFFF',
    corDestaque: '#EF9F27',
    escalaDestaque: 1.3,
    offsetX: 0,
    offsetY: -6,
    duracaoTransicaoMs: 120,
    posicaoY: 0.85,
    fundo: {
      ativo: false,
      cor: '#000000',
      opacidade: 0.6,
      paddingX: 16,
      paddingY: 8,
      raioBorda: 8,
      offsetX: 0,
      offsetY: 0,
    },
  },
};

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

export function RemotionRoot() {
  return (
    <Composition
      id="LegendaKaraoke"
      component={CaptionComposition}
      durationInFrames={calcularDuracaoEmFrames(projetoVazio, FPS) || FPS * 5}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{
        projeto: projetoVazio,
        corFundo: 'transparent',
      }}
      calculateMetadata={async ({ props }) => {
        return {
          durationInFrames: calcularDuracaoEmFrames(props.projeto, FPS) || FPS * 5,
        };
      }}
    />
  );
}
