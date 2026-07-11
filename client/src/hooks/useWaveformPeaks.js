// client/src/hooks/useWaveformPeaks.js
//
// Busca os picos [min, max] da waveform já pré-computados pelo servidor
// (ver server/waveformService.js) em vez de baixar o arquivo de
// vídeo/áudio inteiro e decodificar o PCM no navegador.
//
// Por que no servidor agora (antes era no navegador):
// - decodeAudioData baixava e decodificava o arquivo inteiro na RAM do
//   cliente — perceptível a partir de uns 3-5 minutos de vídeo, podendo
//   travar a aba em arquivos maiores.
// - O WaveSurfer (useWavesurfer.js) já decodifica o áudio de novo por
//   conta própria como fonte real de reprodução, então o navegador
//   fazia esse trabalho pesado DUAS vezes. Com os picos vindo prontos do
//   servidor, passamos eles direto pro WaveSurfer via
//   `wavesurfer.load(url, picos, duracaoSegundos)`, eliminando também
//   esse segundo decode (ver parâmetro `picosPreCalculados` em
//   useWavesurfer.js).
// - O servidor usa ffmpeg (decode em C), ordens de magnitude mais rápido
//   que decodeAudioData, e o resultado fica cacheado em disco.
//
// Cache: como antes, mantemos um Map módulo-level — agora chaveado pelo
// projetoId — para não rebuscar a cada troca de tela enquanto o projeto
// não muda.

import { useEffect, useRef, useState } from 'react';

const cachePorProjeto = new Map();

async function buscarPicos(projetoId, sinalAbortar) {
  const resposta = await fetch(`/api/waveform/${projetoId}`, { signal: sinalAbortar });
  if (!resposta.ok) {
    throw new Error(`Falha ao buscar waveform (HTTP ${resposta.status})`);
  }
  return resposta.json(); // já vem como { picos, duracaoSegundos }
}

// Hook principal. Recebe o projetoId (não mais a url do vídeo — os
// picos são resolvidos no servidor a partir do caminhoVideo salvo no
// projeto) e devolve:
//   { picos, duracaoSegundos, carregando, erro }
//
// `picos` é um array de pares [min, max] (cada valor entre -1 e 1),
// distribuídos uniformemente ao longo da duração do áudio — mesmo
// formato de antes, então o componente de desenho e reamostrarPicos()
// abaixo não precisam mudar.
export function useWaveformPeaks(projetoId) {
  const [estado, setEstado] = useState(() => {
    const cacheado = projetoId ? cachePorProjeto.get(projetoId) : null;
    return cacheado
      ? { picos: cacheado.picos, duracaoSegundos: cacheado.duracaoSegundos, carregando: false, erro: null }
      : { picos: null, duracaoSegundos: 0, carregando: !!projetoId, erro: null };
  });

  const projetoAnteriorRef = useRef(null);

  useEffect(() => {
    if (!projetoId) {
      setEstado({ picos: null, duracaoSegundos: 0, carregando: false, erro: null });
      return undefined;
    }

    const cacheado = cachePorProjeto.get(projetoId);
    if (cacheado) {
      setEstado({ picos: cacheado.picos, duracaoSegundos: cacheado.duracaoSegundos, carregando: false, erro: null });
      return undefined;
    }

    projetoAnteriorRef.current = projetoId;
    const controlador = new AbortController();
    setEstado((prev) => ({ ...prev, carregando: true, erro: null }));

    buscarPicos(projetoId, controlador.signal)
      .then((resultado) => {
        if (projetoAnteriorRef.current !== projetoId) return; // trocou de projeto no meio do caminho
        cachePorProjeto.set(projetoId, resultado);
        setEstado({ picos: resultado.picos, duracaoSegundos: resultado.duracaoSegundos, carregando: false, erro: null });
      })
      .catch((erro) => {
        if (controlador.signal.aborted) return;
        console.error('Falha ao buscar picos de waveform do servidor:', erro);
        setEstado({ picos: null, duracaoSegundos: 0, carregando: false, erro });
      });

    return () => controlador.abort();
  }, [projetoId]);

  return estado;
}

// Reamostra o array de picos [min,max] para um número alvo de colunas.
//
// Dois casos:
// - REDUÇÃO (colunasAlvo < picos.length): agrega por min/max real do
//   intervalo, não por média — preserva transientes (picos de volume)
//   que não podem "suavizar para sumir" quando o zoom está afastado.
// - AMPLIAÇÃO (colunasAlvo > picos.length): repete o ponto mais próximo
//   (nearest-neighbor) para preencher as colunas extras. Isso é
//   necessário porque o WaveSurfer v7 desenha os picos exatamente como
//   são passados via `peaks`/`setOptions({ peaks })` — ele NÃO
//   interpola sozinho quando o array é mais curto que a largura em
//   pixels. Sem essa ampliação, dar zoom além da resolução original dos
//   picos (RESOLUCAO_PICOS=4000 pontos para o áudio inteiro) faz o
//   WaveSurfer desenhar só os poucos pontos que tem espalhados pela
//   largura, aparecendo como pontinhos isolados em vez de uma onda
//   contínua.
export function reamostrarPicos(picos, colunasAlvo) {
  if (!picos || picos.length === 0 || colunasAlvo <= 0) return [];
  if (picos.length === colunasAlvo) return picos;

  const resultado = new Array(colunasAlvo);

  if (picos.length > colunasAlvo) {
    // Redução: agrega vários picos originais em cada coluna de saída.
    const passo = picos.length / colunasAlvo;
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
  } else {
    // Ampliação: cada pico original é repetido no número de colunas de
    // saída que lhe cabe proporcionalmente (nearest-neighbor). Não
    // inventa detalhe novo — só evita colunas vazias no desenho.
    for (let i = 0; i < colunasAlvo; i++) {
      const indiceOriginal = Math.min(picos.length - 1, Math.floor((i / colunasAlvo) * picos.length));
      resultado[i] = picos[indiceOriginal];
    }
  }

  return resultado;
}