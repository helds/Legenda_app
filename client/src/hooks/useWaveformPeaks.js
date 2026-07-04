// client/src/hooks/useWaveformPeaks.js
//
// Decodifica o áudio REAL do arquivo de vídeo/áudio do projeto usando a
// Web Audio API do navegador, e reduz as amostras a pares [min, max] por
// "balde" de tempo — a técnica padrão para desenhar waveforms sem ter que
// manter milhões de amostras na memória do React.
//
// Por que no navegador em vez de no servidor:
// - O arquivo já está acessível via URL (mesma que o <video> do preview
//   usa), então não precisa gerar nem servir nenhum arquivo novo.
// - decodeAudioData devolve o PCM completo de uma vez; extrair picos
//   depois é só uma passada linear pelo array, é bem rápido mesmo para
//   vídeos de vários minutos.
// - O resultado é 100% derivado do arquivo real, então nunca pode
//   dessincronizar do que está de fato tocando.
//
// Cache: por resultado ser caro de gerar (decodeAudioData de um vídeo de
// alguns minutos pode levar uns bons milissegundos/segundos), guardamos
// em um Map módulo-level chaveado pela URL. Enquanto o usuário não troca
// de vídeo, a timeline não precisa re-decodificar ao trocar de tela.

import { useEffect, useRef, useState } from 'react';

const cachePorUrl = new Map();

// Quantos pontos de pico manter no total. Mais que isso é desperdício de
// memória (a tela nunca tem pixels suficientes pra mostrar todos), menos
// que isso perde definição ao dar zoom. 4000 é um bom meio-termo — dá
// pra reamostrar em qualquer nível de zoom sem re-decodificar o áudio.
const RESOLUCAO_PICOS = 4000;

async function decodificarParaPicos(url, sinalAbortar) {
  const resposta = await fetch(url, { signal: sinalAbortar });
  if (!resposta.ok) {
    throw new Error(`Falha ao buscar áudio para waveform (HTTP ${resposta.status})`);
  }
  const arrayBuffer = await resposta.arrayBuffer();

  const AudioContextClasse = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClasse) {
    throw new Error('Web Audio API indisponível neste navegador.');
  }
  const contextoAudio = new AudioContextClasse();

  let audioBuffer;
  try {
    // decodeAudioData extrai a trilha de áudio de dentro do container de
    // vídeo (mp4/mov/mkv) automaticamente — não precisamos separar áudio
    // de vídeo manualmente.
    audioBuffer = await contextoAudio.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    // Fecha o contexto para liberar recursos do sistema; não precisamos
    // dele depois de termos o AudioBuffer decodificado.
    contextoAudio.close().catch(() => {});
  }

  // Mixa todos os canais em mono (média simples) — para desenho de
  // waveform não faz sentido mostrar estéreo separado, e simplifica o
  // resto do pipeline.
  const numCanais = audioBuffer.numberOfChannels;
  const totalAmostras = audioBuffer.length;
  const canais = Array.from({ length: numCanais }, (_, i) => audioBuffer.getChannelData(i));

  const amostrasPorPico = Math.max(1, Math.floor(totalAmostras / RESOLUCAO_PICOS));
  const picos = [];

  for (let inicio = 0; inicio < totalAmostras; inicio += amostrasPorPico) {
    const fim = Math.min(inicio + amostrasPorPico, totalAmostras);
    let min = 1;
    let max = -1;

    for (let i = inicio; i < fim; i++) {
      let amostra = 0;
      for (let c = 0; c < numCanais; c++) amostra += canais[c][i];
      amostra /= numCanais;

      if (amostra < min) min = amostra;
      if (amostra > max) max = amostra;
    }

    picos.push([min, max]);
  }

  return {
    picos,
    duracaoSegundos: audioBuffer.duration,
    amostraPorSegundo: totalAmostras / audioBuffer.duration / amostrasPorPico,
  };
}

// Hook principal. Recebe a URL do vídeo/áudio (a mesma que já alimenta o
// <video> do preview) e devolve:
//   { picos, duracaoSegundos, carregando, erro }
//
// `picos` é um array de pares [min, max] (cada valor entre -1 e 1),
// distribuídos uniformemente ao longo da duração do áudio. O componente
// de desenho é responsável por reamostrar isso para a resolução de tela
// disponível, dependendo do zoom atual.
export function useWaveformPeaks(url) {
  const [estado, setEstado] = useState(() => {
    const cacheado = url ? cachePorUrl.get(url) : null;
    return cacheado
      ? { picos: cacheado.picos, duracaoSegundos: cacheado.duracaoSegundos, carregando: false, erro: null }
      : { picos: null, duracaoSegundos: 0, carregando: !!url, erro: null };
  });

  const urlAnteriorRef = useRef(null);

  useEffect(() => {
    if (!url) {
      setEstado({ picos: null, duracaoSegundos: 0, carregando: false, erro: null });
      return;
    }

    const cacheado = cachePorUrl.get(url);
    if (cacheado) {
      setEstado({ picos: cacheado.picos, duracaoSegundos: cacheado.duracaoSegundos, carregando: false, erro: null });
      return;
    }

    urlAnteriorRef.current = url;
    const controlador = new AbortController();
    setEstado((prev) => ({ ...prev, carregando: true, erro: null }));

    decodificarParaPicos(url, controlador.signal)
      .then((resultado) => {
        if (urlAnteriorRef.current !== url) return; // trocou de vídeo no meio do caminho
        cachePorUrl.set(url, resultado);
        setEstado({ picos: resultado.picos, duracaoSegundos: resultado.duracaoSegundos, carregando: false, erro: null });
      })
      .catch((erro) => {
        if (controlador.signal.aborted) return;
        console.error('Falha ao decodificar waveform real, caindo para onda sintética:', erro);
        setEstado({ picos: null, duracaoSegundos: 0, carregando: false, erro });
      });

    return () => controlador.abort();
  }, [url]);

  return estado;
}

// Reamostra o array de picos [min,max] para um número alvo de colunas,
// preservando a característica mais importante de um waveform real: os
// transientes (picos de volume) não podem ser "suavizados para sumir"
// quando o zoom está afastado, senão a onda parece plana mesmo quando o
// áudio já tem um pico ali. Por isso usamos min/max reais do intervalo
// agregado, não uma média.
export function reamostrarPicos(picos, colunasAlvo) {
  if (!picos || picos.length === 0 || colunasAlvo <= 0) return [];
  if (picos.length <= colunasAlvo) return picos;

  const passo = picos.length / colunasAlvo;
  const resultado = new Array(colunasAlvo);

  for (let i = 0; i < colunasAlvo; i++) {
    const inicio = Math.floor(i * passo);
    const fim = Math.max(inicio + 1, Math.floor((i + 1) * passo));
    let min = 1;
    let max = -1;
    for (let j = inicio; j < fim && j < picos.length; j++) {
      const [minJ, maxJ] = picos[j];
      if (minJ < min) min = minJ;
      if (maxJ > max) max = maxJ;
    }
    resultado[i] = [min, max];
  }

  return resultado;
}