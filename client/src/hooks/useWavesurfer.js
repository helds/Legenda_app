// client/src/hooks/useWavesurfer.js
import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';

export function useWavesurfer({
  containerRef,
  url,
  pxPorSegundo,
  corOnda = '#3d9b8a',
  corProgresso = '#ef9f27',
  altura = 96,
  onSeek,
  // NOVO: se true, o WaveSurfer passa a ser a fonte real de áudio (usado
  // pela TelaTimeline, que não tem mais o Remotion Player por perto).
  // Quando false (padrão, usado pelo Editor), o WaveSurfer continua mudo
  // e é só uma representação visual — o áudio real vem do Player.
  mutado = true,
  onPlay,
  onPause,
  onTempoAtualizado,
}) {
  const wavesurferRef = useRef(null);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;
  const onTempoAtualizadoRef = useRef(onTempoAtualizado);
  onTempoAtualizadoRef.current = onTempoAtualizado;

  const [pronto, setPronto] = useState(false);
  const [carregando, setCarregando] = useState(!!url);
  const [erro, setErro] = useState(null);
  const [duracaoSegundos, setDuracaoSegundos] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !url) {
      setPronto(false);
      setCarregando(false);
      return undefined;
    }

    setCarregando(true);
    setErro(null);
    setPronto(false);

    const instancia = WaveSurfer.create({
      container,
      height: altura,
      waveColor: corOnda,
      progressColor: corProgresso,
      cursorWidth: 0,
      normalize: true,
      minPxPerSec: pxPorSegundo,
      fillParent: false,
      interact: true,
      hideScrollbar: true,
      autoCenter: false,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
    });

    wavesurferRef.current = instancia;

    instancia.on('ready', () => {
      setPronto(true);
      setCarregando(false);
      setDuracaoSegundos(instancia.getDuration());

      // Muta ou desmuta de acordo com o modo de uso deste hook nesta
      // tela — ver comentário no parâmetro `mutado` acima.
      try {
        instancia.setMuted(mutado);
      } catch (err) {
        console.warn('Falha ao aplicar estado de mute do WaveSurfer:', err);
      }
    });

    instancia.on('error', (err) => {
      const errorMessage = String(err).toLowerCase();
      if (errorMessage.includes('aborted') || err?.name === 'AbortError') return;

      console.error('WaveSurfer falhou ao carregar o áudio:', err);
      setErro(err instanceof Error ? err : new Error(String(err)));
      setCarregando(false);
      setPronto(false);
    });

    instancia.on('interaction', (novoTempoSegundos) => {
      onSeekRef.current?.(novoTempoSegundos);
    });

    // Eventos de tempo/play/pause só importam de verdade quando este
    // hook está atuando como fonte real de áudio (mutado = false).
    instancia.on('play', () => onPlayRef.current?.());
    instancia.on('pause', () => onPauseRef.current?.());
    instancia.on('finish', () => onPauseRef.current?.());
    instancia.on('timeupdate', (tempoSegundos) => {
      onTempoAtualizadoRef.current?.(tempoSegundos);
    });

    instancia.load(url).catch((err) => {
      const errorMessage = String(err).toLowerCase();
      if (errorMessage.includes('aborted') || err?.name === 'AbortError') return;

      console.error('Falha ao iniciar carregamento do áudio:', err);
      setErro(err instanceof Error ? err : new Error(String(err)));
      setCarregando(false);
    });

    return () => {
      instancia.destroy();
      wavesurferRef.current = null;
    };
  }, [url, containerRef, pxPorSegundo, altura, corOnda, corProgresso, mutado]);

  useEffect(() => {
    const instancia = wavesurferRef.current;
    if (!instancia || !pronto) return;
    try {
      instancia.zoom(pxPorSegundo);
    } catch (err) {
      console.warn('Falha ao aplicar zoom no WaveSurfer:', err);
    }
  }, [pxPorSegundo, pronto]);

  useEffect(() => {
    const instancia = wavesurferRef.current;
    if (!instancia || !pronto) return;
    try {
      instancia.setMuted(mutado);
    } catch (err) {
      console.warn('Falha ao atualizar mute do WaveSurfer:', err);
    }
  }, [mutado, pronto]);

  function seekTo(segundos) {
    const instancia = wavesurferRef.current;
    if (!instancia || !pronto || !duracaoSegundos) return;
    const fracao = Math.max(0, Math.min(1, segundos / duracaoSegundos));
    instancia.seekTo(fracao);
  }

  function tocar() {
    wavesurferRef.current?.play();
  }

  function pausar() {
    wavesurferRef.current?.pause();
  }

  function alternarPlayPause() {
    const instancia = wavesurferRef.current;
    if (!instancia) return;
    if (instancia.isPlaying()) instancia.pause();
    else instancia.play();
  }

  function estaTocando() {
    return !!wavesurferRef.current?.isPlaying();
  }

  return {
    pronto,
    carregando,
    erro,
    duracaoSegundos,
    seekTo,
    play: tocar,
    pause: pausar,
    alternarPlayPause,
    estaTocando,
  };
}