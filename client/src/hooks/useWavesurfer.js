// client/src/hooks/useWavesurfer.js
import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { reamostrarPicos } from './useWaveformPeaks';

// O WaveSurfer (Decoder.createBuffer) espera cada canal como um array
// PLANO de amostras de amplitude — o mesmo formato de um AudioBuffer real
// (ex: [0.02, 0.03, 0.21, ...]) — e faz sua PRÓPRIA redução de min/max
// por coluna de pixel em cima disso. Nosso pipeline (server + useWaveformPeaks)
// trabalha com pares [min, max] já agregados por "balde" de tempo, que é
// o formato certo pra desenho no fallback SVG local, mas ERRADO pra
// entregar direto ao WaveSurfer: um array de pares não é um array de
// números, e a matemática interna dele (que espera floats) produzia
// lixo/NaN pra a maior parte das colunas — daí os "pontinhos" esparsos.
//
// A correção é a técnica padrão recomendada pelo próprio wavesurfer.js
// para consumir picos no formato bbc/audiowaveform: intercalar min e max
// como amostras alternadas no mesmo array plano
// ([min0, max0, min1, max1, ...]). Isso preserva a envoltória real (o
// próprio WaveSurfer redescobre o min/max de cada coluna ao agrupar essas
// amostras), em vez de perder informação reduzindo pra um valor só.
function paresParaAmostrasIntercaladas(pares) {
  const amostras = new Array(pares.length * 2);
  for (let i = 0; i < pares.length; i++) {
    amostras[i * 2] = pares[i][0];
    amostras[i * 2 + 1] = pares[i][1];
  }
  return amostras;
}

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
  // NOVO: picos [min, max] já pré-computados no servidor (ver
  // useWaveformPeaks.js + server/waveformService.js). Quando presentes,
  // são repassados como segundo argumento de `wavesurfer.load()`, o que
  // faz o WaveSurfer desenhar a onda direto a partir deles em vez de
  // decodificar o áudio no navegador só para extrair o desenho — ele
  // ainda baixa/decodifica o `url` normalmente para poder REPRODUZIR o
  // áudio (isso é necessário sempre que `mutado` for false), mas não
  // gasta esse trabalho extra apenas para desenhar a waveform.
  picosPreCalculados,
  duracaoSegundosPreCalculada,
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

    // Quando temos picos pré-computados do servidor, passamos eles como
    // segundo/terceiro argumento de load(): o WaveSurfer desenha a onda
    // imediatamente a partir deles em vez de esperar decodificar o
    // áudio primeiro. Sem eles, cai no comportamento original (decode
    // completo no navegador antes de desenhar). Convertidos para o
    // formato de amostras intercaladas que o WaveSurfer realmente espera
    // — ver paresParaAmostrasIntercaladas() acima.
    const argumentosLoad = picosPreCalculados?.length
      ? [url, [paresParaAmostrasIntercaladas(picosPreCalculados)], duracaoSegundosPreCalculada || undefined]
      : [url];

    instancia.load(...argumentosLoad).catch((err) => {
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
    // pxPorSegundo NÃO entra nas deps de propósito: ele já é usado como
    // valor inicial de minPxPerSec na criação, e mudanças de zoom depois
    // disso são tratadas no efeito de zoom abaixo via instancia.zoom() +
    // reamostragem dos picos — recriar a instância inteira a cada zoom
    // reload(ari)a o áudio do zero e interromperia a reprodução.
    // picosPreCalculados/duracaoSegundosPreCalculada também não entram:
    // eles chegam prontos junto do mesmo ciclo de vida da `url` (ambos
    // vêm do useWaveformPeaks, resolvidos antes do WaveSurfer montar) —
    // incluí-los recriaria a instância toda vez que a referência do
    // array de picos mudasse por qualquer motivo alheio à troca de vídeo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, containerRef, altura, corOnda, corProgresso, mutado]);

useEffect(() => {
    const instancia = wavesurferRef.current;
    if (!instancia || !pronto) return;

    if (picosPreCalculados?.length && duracaoSegundos) {
      const larguraAlvoPx = Math.max(1, Math.ceil(duracaoSegundos * pxPorSegundo));
      const colunasAlvo = Math.min(50000, Math.ceil(larguraAlvoPx / 3));
      
      // Mantemos a reamostragem que corrige o bug dos pontinhos
      const picosReamostrados = reamostrarPicos(picosPreCalculados, colunasAlvo);
      
      try {
        // SOLUÇÃO: Injetamos os novos picos diretamente nas opções internas.
        // Isso evita o uso do setOptions(), que quebrava o estado do player,
        // mas garante que o próximo redesenho use a densidade correta.
        instancia.options.peaks = [paresParaAmostrasIntercaladas(picosReamostrados)];
      } catch (err) {
        console.warn('Falha ao injetar novos picos no WaveSurfer:', err);
      }
    }

    try {
      // O zoom agora apenas força o redesenho (lendo os picos que atualizamos acima)
      // sem pausar ou destruir o áudio real!
      instancia.zoom(pxPorSegundo);
    } catch (err) {
      console.warn('Falha ao aplicar zoom no WaveSurfer:', err);
    }
  }, [pxPorSegundo, pronto, picosPreCalculados, duracaoSegundos]);

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