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
}) {
  const wavesurferRef = useRef(null);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

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

      // CORREÇÃO (áudio duplicado): o WaveSurfer aqui é usado só como
      // representação VISUAL da forma de onda — o áudio que de fato
      // deve ser ouvido é o embutido no <video>/Remotion Player, que já
      // toca em sincronia com a imagem. Sem mutar o WaveSurfer, ligar o
      // play tocaria DUAS fontes de áudio ao mesmo tempo (a do vídeo e a
      // decodificada aqui), sobrepostas. O WaveSurfer nunca chama
      // play()/pause() por conta própria neste fluxo (ver
      // TelaTimeline.jsx) — ele só é reposicionado via seekTo() a cada
      // frame do player real — mas mutamos aqui como garantia extra,
      // caso algum código futuro chame play() nele.
      try {
        instancia.setMuted(true);
      } catch (err) {
        console.warn('Falha ao mutar o WaveSurfer:', err);
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
  }, [url, containerRef, pxPorSegundo, altura, corOnda, corProgresso]);

  useEffect(() => {
    const instancia = wavesurferRef.current;
    if (!instancia || !pronto) return;
    try {
      instancia.zoom(pxPorSegundo);
    } catch (err) {
      console.warn('Falha ao aplicar zoom no WaveSurfer:', err);
    }
  }, [pxPorSegundo, pronto]);

  function seekTo(segundos) {
    const instancia = wavesurferRef.current;
    if (!instancia || !pronto || !duracaoSegundos) return;
    const fracao = Math.max(0, Math.min(1, segundos / duracaoSegundos));
    instancia.seekTo(fracao);
  }

  return {
    pronto,
    carregando,
    erro,
    duracaoSegundos,
    seekTo,
    // NOTA: play/pause do WaveSurfer permanecem expostos por
    // compatibilidade, mas TelaTimeline.jsx não deve mais chamá-los —
    // o Remotion Player é a única fonte de verdade de play/pause e de
    // tempo. Ver comentários em TelaTimeline.jsx.
    play: () => wavesurferRef.current?.play(),
    pause: () => wavesurferRef.current?.pause(),
  };
}