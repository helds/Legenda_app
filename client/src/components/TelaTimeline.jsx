// client/src/components/TelaTimeline.jsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useWavesurfer } from '../hooks/useWavesurfer';
import { useWaveformPeaks } from '../hooks/useWaveformPeaks';
import { LegendaFlutuante } from './LegendaFlutuante';
import * as projectModel from '../../../shared/projectModel';

const PX_POR_SEGUNDO_BASE = 72;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 16;
const ALTURA_REGUA = 34;
const ALTURA_LEGENDA_FLUTUANTE = 200;
const LARGURA_ROTULO = 76;

const DURACAO_MINIMA_PALAVRA = 0.08;
const LARGURA_ALCA_PX = 8;
const LARGURA_ALCA_JUNCAO_PX = 10;
const LIMIAR_JUNCAO_SEGUNDOS = 0.02;

const COR_FUNDO = '#101114';
const COR_PAINEL = '#1c1e23';
const COR_HAIRLINE = '#2b2d34';
const COR_TEXTO = '#edece7';
const COR_TEXTO_SEC = '#9a9ca4';
const COR_TEXTO_TERC = '#6b6d76';
const COR_AMBAR = '#ef9f27';
const COR_AZUL = '#5b8def';
const COR_WAVE = '#3d9b8a';
const COR_BLOCO_SEM_VOLUME = '#c9bfa1';

function limitarNumero(valor, fallback = 0) {
  return Number.isFinite(valor) ? valor : fallback;
}

function formatarTempo(segundos) {
  const total = Math.max(0, limitarNumero(segundos));
  const minutos = Math.floor(total / 60);
  const seg = Math.floor(total % 60);
  const centesimos = Math.floor((total - Math.floor(total)) * 100);
  return `${minutos}:${String(seg).padStart(2, '0')}.${String(centesimos).padStart(2, '0')}`;
}

function criarMarcadoresTempo(duracaoSegundos, pxPorSegundo) {
  const duracao = Math.max(1, Math.ceil(duracaoSegundos));
  const candidatos = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const pxMinimoEntreMarcadores = 70;
  const passo =
    candidatos.find((c) => c * pxPorSegundo >= pxMinimoEntreMarcadores) ||
    candidatos[candidatos.length - 1];

  const marcadores = [];
  for (let tempo = 0; tempo <= duracao; tempo += passo) {
    marcadores.push(Number(tempo.toFixed(2)));
  }
  if (marcadores[marcadores.length - 1] !== duracao) marcadores.push(duracao);
  return marcadores;
}

function coletarPalavras(blocos) {
  return (blocos || []).flatMap((bloco) =>
    (bloco?.palavras || []).map((palavra) => ({
      ...palavra,
      blocoId: bloco.id,
    }))
  );
}

function resolverCoresDoBlocoDePalavra(palavra, volumeReferencia) {
  const corVolume = projectModel.corDaPalavraPorVolume(palavra, volumeReferencia);
  if (corVolume) {
    return { fundo: corVolume, texto: '#f5f4f0' };
  }
  return {
    fundo: palavra.estilo ? 'rgba(239,159,39,0.16)' : COR_BLOCO_SEM_VOLUME,
    texto: palavra.estilo ? COR_TEXTO : '#242017',
  };
}

function useAtalhosDeTeclado({
  aoAlternarPlayPause,
  aoBuscarTempo,
  tempoAtualSegundosRef,
  duracaoRef,
  aplicarZoom,
  centralizarAgulha,
  fps = 30,
}) {
  useEffect(() => {
    function aoTeclar(evento) {
      const alvoEhCampoDeTexto =
        evento.target &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(evento.target.tagName);
      if (alvoEhCampoDeTexto) return;

      const tempoAtual = tempoAtualSegundosRef.current;
      const duracao = duracaoRef.current;
      const passoFrame = 1 / fps;

      switch (evento.key) {
        case ' ':
          evento.preventDefault();
          aoAlternarPlayPause?.();
          break;
        case 'ArrowLeft':
          evento.preventDefault();
          aoBuscarTempo?.(Math.max(0, tempoAtual - (evento.shiftKey ? 1 : passoFrame)));
          break;
        case 'ArrowRight':
          evento.preventDefault();
          aoBuscarTempo?.(Math.min(duracao, tempoAtual + (evento.shiftKey ? 1 : passoFrame)));
          break;
        case 'j':
        case 'J':
          aoBuscarTempo?.(Math.max(0, tempoAtual - 1));
          break;
        case 'l':
        case 'L':
          aoBuscarTempo?.(Math.min(duracao, tempoAtual + 1));
          break;
        case 'Home':
          evento.preventDefault();
          aoBuscarTempo?.(0);
          break;
        case 'c':
        case 'C':
          evento.preventDefault();
          centralizarAgulha?.();
          break;
        case 'End':
          evento.preventDefault();
          aoBuscarTempo?.(duracao);
          break;
        case '+':
        case '=':
          aplicarZoom((z) => Number((z * 1.25).toFixed(3)));
          break;
        case '-':
        case '_':
          aplicarZoom((z) => Number((z / 1.25).toFixed(3)));
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoAlternarPlayPause, aoBuscarTempo, tempoAtualSegundosRef, duracaoRef, aplicarZoom, centralizarAgulha, fps]);
}

export function TelaTimeline({
  projeto,
  projetoId,
  urlAudio,
  duracaoSegundos,
  palavraSelecionadaId,
  idsSelecionados,
  aoSelecionarPalavra,
  aoVoltarParaEditor,
  aoRedimensionarPalavra,
  aoRedimensionarJuncao,
  aoMoverPalavra,
  aoFinalizarMoverPalavra,
}) {
  const [zoom, setZoom] = useState(1);
  const [seguirPlayhead, setSeguirPlayhead] = useState(true);
  const [zoomNoCursor, setZoomNoCursor] = useState(true);
  const [agulhaCentralizada, setAgulhaCentralizada] = useState(false);
  
  const [alturaOnda, setAlturaOnda] = useState(96);
  const [alturaTrilhaLegenda, setAlturaTrilhaLegenda] = useState(58);

  const [tempoAtualSegundos, setTempoAtualSegundos] = useState(0);
  const [estaTocando, setEstaTocando] = useState(false);

  const containerScrollRef = useRef(null);
  const faixaRef = useRef(null);
  const scrollPosDesejadaRef = useRef(null);
  
  const waveTrackRef = useRef(null);
  const waveHeaderRef = useRef(null);
  const legendaTrackRef = useRef(null);
  const legendaHeaderRef = useRef(null);

  const arrastandoAgulhaRef = useRef(false);
  const pointerIdAgulhaRef = useRef(null);
  const resizeAtivoRef = useRef(null);
  const resizeJuncaoAtivoRef = useRef(null);
  const moverAtivoRef = useRef(null);
  const [arrastoVisual, setArrastoVisual] = useState(null);

  const ignorarScroll = useRef(false);
  const timeoutScroll = useRef(null);

  // Posição de scroll e largura do container, usadas só para calcular
  // quais palavras estão na janela de tempo visível (ver
  // `palavrasVisiveis` abaixo). Sem isso, a track de LEGENDA renderizava
  // TODAS as palavras do projeto inteiro o tempo todo — em projetos
  // longos (dezenas de minutos de fala contínua = milhares de palavras),
  // isso significava milhares de <div> sendo recalculados a cada
  // `timeupdate` do áudio (que dispara várias vezes por segundo durante
  // o play), causando a agulha "travando"/laggando.
  const [scrollLeftAtual, setScrollLeftAtual] = useState(0);
  const [larguraViewportAtual, setLarguraViewportAtual] = useState(0);

  const pxPorSegundo = PX_POR_SEGUNDO_BASE * zoom;
  const aoBuscarTempoRef = useRef(null);
  const wavesurferContainerRef = useRef(null);

  // Picos pré-computados no servidor (ver server/waveformService.js) —
  // chegam prontos em paralelo ao WaveSurfer carregar o áudio para
  // reprodução, e evitam que ele precise decodificar o arquivo inteiro
  // no navegador só para desenhar a onda (ver useWavesurfer.js).
  const { picos: picosServidor, duracaoSegundos: duracaoServidor } = useWaveformPeaks(projetoId);

  // O WaveSurfer aqui é a fonte real de reprodução (mutado: false), e
  // por isso precisa carregar e decodificar essa URL inteira — usar o
  // vídeo original (urlAudio) quebra em arquivos grandes selecionados
  // localmente ("file could not be read... after a reference was
  // acquired", erro do Electron ao sustentar leitura longa de arquivos
  // grandes). Em vez disso, usamos a trilha de áudio já extraída (mp3,
  // bem menor) e cacheada pelo servidor — ver server/waveformService.js
  // (obterAudioExtraidoComCache) e a rota /api/audio-extraido/:idProjeto.
  // Cai de volta para urlAudio só se ainda não temos projetoId (ex:
  // instante inicial de carregamento da tela).
  const urlAudioReproducao = projetoId ? `/api/audio-extraido/${projetoId}` : urlAudio;

  const {
    pronto: temWaveformReal,
    carregando,
    erro,
    duracaoSegundos: duracaoAudioDecodificado,
    seekTo: atualizarProgressoWavesurfer,
    alternarPlayPause: alternarPlayPauseWavesurfer,
  } = useWavesurfer({
    containerRef: wavesurferContainerRef,
    url: urlAudioReproducao,
    pxPorSegundo: pxPorSegundo,
    corOnda: COR_WAVE,
    corProgresso: COR_AMBAR,
    altura: alturaOnda,
    onSeek: (segundos) => aoBuscarTempoRef.current?.(segundos),
    mutado: false,
    onPlay: () => setEstaTocando(true),
    onPause: () => setEstaTocando(false),
    onTempoAtualizado: (segundos) => setTempoAtualSegundos(segundos),
    picosPreCalculados: picosServidor,
    duracaoSegundosPreCalculada: duracaoServidor,
  });

  const aoBuscarTempo = useCallback(
    (segundos) => {
      setTempoAtualSegundos(segundos);
      atualizarProgressoWavesurfer?.(segundos);
    },
    [atualizarProgressoWavesurfer]
  );
  aoBuscarTempoRef.current = aoBuscarTempo;

  const aoAlternarPlayPause = useCallback(() => {
    alternarPlayPauseWavesurfer?.();
  }, [alternarPlayPauseWavesurfer]);

  const duracao = Math.max(1, limitarNumero(duracaoSegundos || duracaoAudioDecodificado, 1));
  const larguraTotal = Math.max(800, Math.ceil(duracao * pxPorSegundo));

  const palavras = useMemo(() => coletarPalavras(projeto?.blocos), [projeto]);
  const volumeReferencia = projeto?.volumeReferencia || null;

  // Janela de tempo (em pixels) atualmente visível na track, com uma
  // margem de segurança pra cada lado — evita que blocos "pisquem" ao
  // entrar/sair da tela durante scroll rápido ou zoom. Usada só para
  // VIRTUALIZAR a renderização da track de LEGENDA (ver
  // `palavrasVisiveis` logo abaixo): em vez de desenhar todas as
  // palavras do projeto inteiro sempre, desenhamos só as que estão
  // (perto de estar) na tela. `juncoesPorPalavraId`/
  // `idsComJuncaoNaEsquerda` abaixo continuam usando `palavras`
  // (lista completa), não `palavrasVisiveis` — a lógica de junção entre
  // palavras vizinhas precisa considerar o projeto inteiro pra ficar
  // correta perto das bordas da janela visível.
  const MARGEM_VIRTUALIZACAO_PX = 800;
  const inicioJanelaVisivelPx = Math.max(0, scrollLeftAtual - MARGEM_VIRTUALIZACAO_PX);
  const fimJanelaVisivelPx = scrollLeftAtual + larguraViewportAtual + MARGEM_VIRTUALIZACAO_PX;

  const palavrasVisiveis = useMemo(() => {
    // Antes da primeira medição do container (larguraViewportAtual
    // ainda 0), não sabemos a janela visível — mostra tudo só nesse
    // instante inicial raríssimo, em vez de esconder a legenda inteira.
    if (!larguraViewportAtual) return palavras;
    return palavras.filter((palavra) => {
      const inicioPx = Math.max(0, limitarNumero(palavra.inicio)) * pxPorSegundo;
      const fimPx = Math.max(inicioPx, limitarNumero(palavra.fim, palavra.inicio)) * pxPorSegundo;
      return fimPx >= inicioJanelaVisivelPx && inicioPx <= fimJanelaVisivelPx;
    });
  }, [palavras, pxPorSegundo, inicioJanelaVisivelPx, fimJanelaVisivelPx, larguraViewportAtual]);

  const juncoesPorPalavraId = useMemo(() => {
    const mapa = new Map();
    const ordenadas = [...palavras].sort((a, b) => limitarNumero(a.inicio) - limitarNumero(b.inicio));
    for (let i = 0; i < ordenadas.length - 1; i++) {
      const atual = ordenadas[i];
      const proxima = ordenadas[i + 1];
      const gap = limitarNumero(proxima.inicio) - limitarNumero(atual.fim);
      if (gap <= LIMIAR_JUNCAO_SEGUNDOS) {
        mapa.set(atual.id, proxima.id);
      }
    }
    return mapa;
  }, [palavras]);

  const idsComJuncaoNaEsquerda = useMemo(() => {
    return new Set(juncoesPorPalavraId.values());
  }, [juncoesPorPalavraId]);

  const marcadores = useMemo(
    () => criarMarcadoresTempo(duracao, pxPorSegundo),
    [duracao, pxPorSegundo]
  );

  const colunasVisiveis = Math.max(100, Math.min(3000, Math.floor(larguraTotal / 2)));
  const picosFallback = useMemo(() => {
    if (temWaveformReal || carregando) return [];
    return Array.from({ length: colunasVisiveis }, (_, i) => {
      const onda = Math.sin(i * 0.15) * 0.5 + Math.sin(i * 0.037) * 0.3;
      const amplitude = 0.15 + Math.abs(onda) * 0.35;
      return [-amplitude, amplitude];
    });
  }, [temWaveformReal, carregando, colunasVisiveis]);

  const posicaoPlayheadPx = tempoAtualSegundos * pxPorSegundo;

  const tempoAtualSegundosRef = useRef(tempoAtualSegundos);
  const duracaoRef = useRef(duracao);
  duracaoRef.current = duracao;

  const centralizarAgulha = useCallback(() => {
    const scrollContainer = containerScrollRef.current;
    if (scrollContainer) {
      const posicaoPx = tempoAtualSegundosRef.current * pxPorSegundo;
      const larguraContainer = scrollContainer.clientWidth;
      
      ignorarScroll.current = true; 
      
      scrollContainer.scrollTo({
        left: Math.max(0, posicaoPx - larguraContainer / 2),
        behavior: 'smooth',
      });
      
      if (timeoutScroll.current) clearTimeout(timeoutScroll.current);
      timeoutScroll.current = setTimeout(() => {
        ignorarScroll.current = false;
      }, 600);
    }
  }, [pxPorSegundo]);

  const aplicarZoom = useCallback((calcularNovoZoom, eventoMouse = null) => {
    setZoom((zoomAntigo) => {
      const novoZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, calcularNovoZoom(zoomAntigo)));
      if (novoZoom === zoomAntigo) return zoomAntigo;

      const pxPorSegundoAntigo = PX_POR_SEGUNDO_BASE * zoomAntigo;
      const novoPxPorSegundo = PX_POR_SEGUNDO_BASE * novoZoom;
      const scrollContainer = containerScrollRef.current;
      const faixa = faixaRef.current;

      if (scrollContainer && faixa) {
        let tempoFocal = tempoAtualSegundosRef.current;
        let offsetPxDaEsquerdaNaTela = 0;

        if (zoomNoCursor && eventoMouse) {
          const rectFaixa = faixa.getBoundingClientRect();
          const rectScroll = scrollContainer.getBoundingClientRect();
          
          const xNaFaixaPx = eventoMouse.clientX - rectFaixa.left;
          tempoFocal = xNaFaixaPx / pxPorSegundoAntigo;
          
          offsetPxDaEsquerdaNaTela = eventoMouse.clientX - rectScroll.left;
        } else {
          const xAgulhaPx = tempoFocal * pxPorSegundoAntigo;
          offsetPxDaEsquerdaNaTela = xAgulhaPx - scrollContainer.scrollLeft;
        }

        scrollPosDesejadaRef.current = (tempoFocal * novoPxPorSegundo) - offsetPxDaEsquerdaNaTela;
      }

      return novoZoom;
    });
  }, [zoomNoCursor]);

  useLayoutEffect(() => {
    if (scrollPosDesejadaRef.current !== null && containerScrollRef.current) {
      containerScrollRef.current.scrollLeft = scrollPosDesejadaRef.current;
      scrollPosDesejadaRef.current = null;
    }
  }, [zoom]);

  useAtalhosDeTeclado({
    aoAlternarPlayPause,
    aoBuscarTempo,
    tempoAtualSegundosRef,
    duracaoRef,
    aplicarZoom,
    centralizarAgulha,
  });

  // Mede a largura visível do container de scroll (necessária pra
  // calcular a janela de tempo visível usada na virtualização da
  // track de LEGENDA — ver `palavrasVisiveis`). Roda uma vez no mount
  // e sempre que o container for redimensionado (ex: usuário
  // redimensiona a janela do app).
  useEffect(() => {
    const scrollContainer = containerScrollRef.current;
    if (!scrollContainer) return undefined;

    const medir = () => {
      setLarguraViewportAtual(scrollContainer.clientWidth);
      setScrollLeftAtual(scrollContainer.scrollLeft);
    };
    medir();

    const observer = new ResizeObserver(medir);
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scrollContainer = containerScrollRef.current;
    if (!scrollContainer) return;

    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        aplicarZoom((z) => {
          const fator = e.deltaY > 0 ? 0.8 : 1.25;
          return Number((z * fator).toFixed(3));
        }, e);
        return;
      }

      if (e.shiftKey) {
        e.preventDefault();
        const incremento = e.deltaY > 0 ? -12 : 12;
        const alvo = e.target;
        const noWaveform = waveTrackRef.current?.contains(alvo) || waveHeaderRef.current?.contains(alvo);
        const naLegenda = legendaTrackRef.current?.contains(alvo) || legendaHeaderRef.current?.contains(alvo);

        if (noWaveform) {
          setAlturaOnda((a) => Math.max(48, Math.min(400, a + incremento)));
        } else if (naLegenda) {
          setAlturaTrilhaLegenda((a) => Math.max(40, Math.min(300, a + incremento)));
        }
      }
    };

    scrollContainer.addEventListener('wheel', onWheel, { passive: false });
    return () => scrollContainer.removeEventListener('wheel', onWheel);
  }, [aplicarZoom]);

  useEffect(() => {
    tempoAtualSegundosRef.current = tempoAtualSegundos;
    const scrollContainer = containerScrollRef.current;
    
    if (!scrollContainer) return;
    if (arrastandoAgulhaRef.current) return;

    const posicaoPx = tempoAtualSegundos * pxPorSegundo;
    const larguraContainer = scrollContainer.clientWidth;

    if (agulhaCentralizada) {
      ignorarScroll.current = true;
      scrollContainer.scrollLeft = Math.max(0, posicaoPx - larguraContainer / 2);
      
      if (timeoutScroll.current) clearTimeout(timeoutScroll.current);
      timeoutScroll.current = setTimeout(() => {
        ignorarScroll.current = false;
      }, 50); 
      
    } else if (seguirPlayhead) {
      const margem = 120;
      const dentroDaVista =
        posicaoPx >= scrollContainer.scrollLeft + margem &&
        posicaoPx <= scrollContainer.scrollLeft + larguraContainer - margem;

      if (!dentroDaVista) {
        ignorarScroll.current = true;
        scrollContainer.scrollTo({
          left: Math.max(0, posicaoPx - larguraContainer / 2),
          behavior: estaTocando ? 'auto' : 'smooth',
        });

        if (timeoutScroll.current) clearTimeout(timeoutScroll.current);
        timeoutScroll.current = setTimeout(() => {
          ignorarScroll.current = false;
        }, estaTocando ? 100 : 600);
      }
    }
  }, [tempoAtualSegundos, pxPorSegundo, seguirPlayhead, agulhaCentralizada, estaTocando]);

  function aoRolarManualmente() {
    // Atualiza a posição rastreada SEMPRE (mesmo durante auto-scroll
    // programático do "Seguir reprodução"/"Sempre no centro"), porque a
    // virtualização da track de legenda precisa saber a posição real de
    // scroll independente de quem causou o scroll.
    const scrollContainer = containerScrollRef.current;
    if (scrollContainer) setScrollLeftAtual(scrollContainer.scrollLeft);

    if (ignorarScroll.current) return;
    if (arrastandoAgulhaRef.current) return;
    setSeguirPlayhead(false);
    setAgulhaCentralizada(false);
  }

  const tempoAPartirDoEventoNaFaixa = useCallback(
    (clientX) => {
      const faixa = faixaRef.current;
      if (!faixa) return 0;
      const rect = faixa.getBoundingClientRect();
      const x = clientX - rect.left;
      const tempo = x / pxPorSegundo;
      return Math.max(0, Math.min(duracao, tempo));
    },
    [pxPorSegundo, duracao]
  );

  function aoIniciarArrasteAgulha(evento) {
    if (resizeAtivoRef.current) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    pointerIdAgulhaRef.current = evento.pointerId;
    arrastandoAgulhaRef.current = true;
    setSeguirPlayhead(false);
    const tempo = tempoAPartirDoEventoNaFaixa(evento.clientX);
    aoBuscarTempo?.(tempo);
  }

  function aoMoverArrasteAgulha(evento) {
    if (!arrastandoAgulhaRef.current) return;
    if (pointerIdAgulhaRef.current !== evento.pointerId) return;
    const tempo = tempoAPartirDoEventoNaFaixa(evento.clientX);
    aoBuscarTempo?.(tempo);
  }

  function aoFinalizarArrasteAgulha(evento) {
    if (pointerIdAgulhaRef.current === evento.pointerId) {
      try {
        evento.currentTarget.releasePointerCapture(evento.pointerId);
      } catch { }
    }
    arrastandoAgulhaRef.current = false;
    pointerIdAgulhaRef.current = null;
    setSeguirPlayhead(true);
  }

  function iniciarResize(evento, palavra, lado) {
    evento.stopPropagation();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    resizeAtivoRef.current = {
      palavraId: palavra.id,
      lado,
      pointerId: evento.pointerId,
    };
  }

  function moverResize(evento) {
    const ativo = resizeAtivoRef.current;
    if (!ativo || ativo.pointerId !== evento.pointerId) return;
    if (!aoRedimensionarPalavra) return;

    const tempo = tempoAPartirDoEventoNaFaixa(evento.clientX);
    aoRedimensionarPalavra({
      palavraId: ativo.palavraId,
      lado: ativo.lado,
      novoTempo: tempo,
      duracaoMinima: DURACAO_MINIMA_PALAVRA,
    });
  }

  function finalizarResize(evento) {
    const ativo = resizeAtivoRef.current;
    if (ativo && ativo.pointerId === evento.pointerId) {
      try {
        evento.currentTarget.releasePointerCapture(evento.pointerId);
      } catch { }
    }
    resizeAtivoRef.current = null;
  }

  function iniciarResizeJuncao(evento, palavraEsquerdaId, palavraDireitaId) {
    evento.stopPropagation();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    resizeJuncaoAtivoRef.current = {
      palavraEsquerdaId,
      palavraDireitaId,
      pointerId: evento.pointerId,
    };
  }

  function moverResizeJuncao(evento) {
    const ativo = resizeJuncaoAtivoRef.current;
    if (!ativo || ativo.pointerId !== evento.pointerId) return;
    if (!aoRedimensionarJuncao) return;

    const tempo = tempoAPartirDoEventoNaFaixa(evento.clientX);
    aoRedimensionarJuncao({
      palavraEsquerdaId: ativo.palavraEsquerdaId,
      palavraDireitaId: ativo.palavraDireitaId,
      novoTempo: tempo,
      duracaoMinima: DURACAO_MINIMA_PALAVRA,
    });
  }

  function finalizarResizeJuncao(evento) {
    const ativo = resizeJuncaoAtivoRef.current;
    if (ativo && ativo.pointerId === evento.pointerId) {
      try {
        evento.currentTarget.releasePointerCapture(evento.pointerId);
      } catch { }
    }
    resizeJuncaoAtivoRef.current = null;
  }

  function iniciarMover(evento, palavra) {
    evento.stopPropagation();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    const duracaoPalavra = Math.max(
      DURACAO_MINIMA_PALAVRA,
      limitarNumero(palavra.fim, 0) - limitarNumero(palavra.inicio, 0)
    );
    moverAtivoRef.current = {
      palavraId: palavra.id,
      pointerId: evento.pointerId,
      duracaoPalavra,
      deslocamentoInicialPx:
        evento.clientX - faixaRef.current.getBoundingClientRect().left - palavra.inicio * pxPorSegundo,
    };
    setArrastoVisual({ palavraId: palavra.id, inicio: palavra.inicio, fim: palavra.fim });
  }

  function moverMover(evento) {
    const ativo = moverAtivoRef.current;
    if (!ativo || ativo.pointerId !== evento.pointerId) return;
    const faixa = faixaRef.current;
    if (!faixa) return;

    const rect = faixa.getBoundingClientRect();
    const xRelativo = evento.clientX - rect.left - ativo.deslocamentoInicialPx;
    const novoInicioBruto = xRelativo / pxPorSegundo;
    const novoInicio = Math.max(0, Math.min(duracao - ativo.duracaoPalavra, novoInicioBruto));
    const novoFim = novoInicio + ativo.duracaoPalavra;

    setArrastoVisual({ palavraId: ativo.palavraId, inicio: novoInicio, fim: novoFim });
  }

  function finalizarMover(evento) {
    const ativo = moverAtivoRef.current;
    if (!ativo || ativo.pointerId !== evento.pointerId) return;

    try {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    } catch { }

    if (arrastoVisual && arrastoVisual.palavraId === ativo.palavraId) {
      aoMoverPalavra?.({
        palavraId: ativo.palavraId,
        novoInicio: arrastoVisual.inicio,
        novoFim: arrastoVisual.fim,
        duracaoMinima: DURACAO_MINIMA_PALAVRA,
      });
      aoFinalizarMoverPalavra?.();
    }

    moverAtivoRef.current = null;
    setArrastoVisual(null);
  }

  // Lógica para controle do resize vertical das trilhas
  const resizeAlturaAtivoRef = useRef(null);

  function iniciarResizeAltura(evento, trilha) {
    evento.preventDefault();
    evento.stopPropagation();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    resizeAlturaAtivoRef.current = {
      trilha,
      pointerId: evento.pointerId,
      startY: evento.clientY,
      alturaInicial: trilha === 'onda' ? alturaOnda : alturaTrilhaLegenda,
    };
  }

  function moverResizeAltura(evento) {
    const ativo = resizeAlturaAtivoRef.current;
    if (!ativo || ativo.pointerId !== evento.pointerId) return;

    const deltaY = evento.clientY - ativo.startY;
    if (ativo.trilha === 'onda') {
      setAlturaOnda(Math.max(48, Math.min(400, ativo.alturaInicial + deltaY)));
    } else if (ativo.trilha === 'legenda') {
      setAlturaTrilhaLegenda(Math.max(40, Math.min(300, ativo.alturaInicial + deltaY)));
    }
  }

  function finalizarResizeAltura(evento) {
    const ativo = resizeAlturaAtivoRef.current;
    if (ativo && ativo.pointerId === evento.pointerId) {
      try {
        evento.currentTarget.releasePointerCapture(evento.pointerId);
      } catch { }
    }
    resizeAlturaAtivoRef.current = null;
  }

// FUNÇÃO DE RENDERIZAÇÃO: Retorna a alça sem causar unmount no React
  const renderAlcaVertical = (trilha) => (
    <div
      onPointerDown={(e) => iniciarResizeAltura(e, trilha)}
      onPointerMove={moverResizeAltura}
      onPointerUp={finalizarResizeAltura}
      onPointerCancel={finalizarResizeAltura}
      style={{
        position: 'absolute',
        bottom: -3,
        left: 0,
        right: 0,
        height: 6,
        cursor: 'row-resize',
        zIndex: 10,
        touchAction: 'none'
      }}
    />
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: COR_FUNDO,
        color: COR_TEXTO,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          borderBottom: `1px solid ${COR_HAIRLINE}`,
          background: COR_PAINEL,
        }}
      >
        <button
          onClick={aoVoltarParaEditor}
          className="btn"
          style={{ whiteSpace: 'nowrap' }}
        >
          ← Voltar ao editor
        </button>

        <h2
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: COR_TEXTO_SEC,
          }}
        >
          Timeline
        </h2>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          {volumeReferencia && (
            <div
              title={`Cor por volume: azul = mais baixo, verde = na média (${volumeReferencia.volumeDbMedia?.toFixed?.(1)} dB), vermelho = mais alto`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11.5,
                color: COR_TEXTO_TERC,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 64,
                  height: 8,
                  borderRadius: 4,
                  background: 'linear-gradient(90deg, #5b8def, #6fbf8b, #e5675f)',
                }}
              />
              <span>Volume (baixo → alto)</span>
            </div>
          )}

          <button
            onClick={() => aoAlternarPlayPause?.()}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: `1px solid ${estaTocando ? COR_AMBAR : '#383b44'}`,
              background: estaTocando ? COR_AMBAR : '#22242b',
              color: estaTocando ? '#1a1400' : COR_TEXTO,
              cursor: 'pointer',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 120ms ease',
            }}
            title={estaTocando ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
          >
            {estaTocando ? '❚❚' : '▶'}
          </button>

          <span
            id="contador-tempo"
            style={{ fontSize: 13, color: COR_TEXTO_SEC, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono, monospace)' }}
          >
            {formatarTempo(tempoAtualSegundos)} / {formatarTempo(duracao)}
          </span>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COR_TEXTO_TERC, cursor: 'pointer' }} title="Trava a agulha no centro da tela (Atalho para centralizar: C)">
            <input
              type="checkbox"
              checked={agulhaCentralizada}
              onChange={(e) => {
                const checado = e.target.checked;
                setAgulhaCentralizada(checado);
                if (checado) {
                  setSeguirPlayhead(false);
                  centralizarAgulha();
                }
              }}
              style={{ accentColor: COR_AMBAR }}
            />
            Sempre no centro
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COR_TEXTO_TERC, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={seguirPlayhead}
              onChange={(e) => {
                const checado = e.target.checked;
                setSeguirPlayhead(checado);
                if (checado) setAgulhaCentralizada(false);
              }}
              style={{ accentColor: COR_AMBAR }}
            />
            Seguir reprodução
          </label>

          <div style={{ width: 1, height: 24, background: COR_HAIRLINE, margin: '0 4px' }} />

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COR_TEXTO_TERC, cursor: 'pointer' }} title="Desmarque para que o zoom sempre ancore na agulha de reprodução">
            <input
              type="checkbox"
              checked={zoomNoCursor}
              onChange={(e) => setZoomNoCursor(e.target.checked)}
              style={{ accentColor: COR_AMBAR }}
            />
            Zoom no cursor
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: COR_TEXTO_TERC }}>Zoom</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              value={zoom}
              onChange={(e) => aplicarZoom(() => Number(e.target.value))}
              style={{ width: 140 }}
              title="Atalhos: + / - ou Ctrl+Scroll"
            />
            <span style={{ fontSize: 12, color: COR_TEXTO_TERC, width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {zoom.toFixed(2)}x
            </span>
          </div>
        </div>
      </header>

      {carregando && (
        <div style={{ padding: '6px 20px', fontSize: 12, color: COR_AZUL, background: 'rgba(91,141,239,0.08)' }}>
          Renderizando engine de áudio profissional...
        </div>
      )}

      {!carregando && erro && (
        <div style={{ padding: '6px 20px', fontSize: 12, color: COR_AMBAR, background: 'rgba(239,159,39,0.08)' }}>
          Não foi possível carregar a engine de áudio. Mostrando timeline de visualização genérica. {erro.message}
        </div>
      )}

      <LegendaFlutuante
        projeto={projeto}
        tempoAtualSegundos={tempoAtualSegundos}
        palavraSelecionadaId={palavraSelecionadaId}
        idsSelecionados={idsSelecionados}
        altura={ALTURA_LEGENDA_FLUTUANTE}
      />

      <div
        ref={containerScrollRef}
        onScroll={aoRolarManualmente}
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: `${LARGURA_ROTULO}px 1fr`, minWidth: larguraTotal + LARGURA_ROTULO }}>
          <div style={{ position: 'sticky', left: 0, zIndex: 2, background: COR_PAINEL }}>
            <div style={{ height: ALTURA_REGUA, borderBottom: `1px solid ${COR_HAIRLINE}` }} />
            
            <div
              ref={waveHeaderRef}
              style={{
                position: 'relative',
                height: alturaOnda,
                borderBottom: `1px solid ${COR_HAIRLINE}`,
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 10,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: COR_TEXTO_TERC,
              }}
            >
              Áudio
              {renderAlcaVertical("onda")}
            </div>

            <div
              ref={legendaHeaderRef}
              style={{
                position: 'relative',
                height: alturaTrilhaLegenda,
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 10,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: COR_TEXTO_TERC,
              }}
            >
              Legenda
              {renderAlcaVertical('legenda')} 
            </div>
          </div>

          <div
            ref={faixaRef}
            style={{ position: 'relative', width: larguraTotal, cursor: 'pointer', userSelect: 'none', touchAction: 'none' }}
            onPointerDown={aoIniciarArrasteAgulha}
            onPointerMove={aoMoverArrasteAgulha}
            onPointerUp={aoFinalizarArrasteAgulha}
            onPointerCancel={aoFinalizarArrasteAgulha}
          >
            <div style={{ position: 'relative', height: ALTURA_REGUA, borderBottom: `1px solid ${COR_HAIRLINE}`, background: '#1a1b20' }}>
              {marcadores.map((tempo) => (
                <div
                  key={tempo}
                  style={{
                    position: 'absolute',
                    left: tempo * pxPorSegundo,
                    top: 0,
                    bottom: 0,
                    borderLeft: `1px solid ${COR_HAIRLINE}`,
                    paddingLeft: 6,
                    fontSize: 11,
                    color: COR_TEXTO_SEC,
                    display: 'flex',
                    alignItems: 'center',
                    fontVariantNumeric: 'tabular-nums',
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  {formatarTempo(tempo)}
                </div>
              ))}
            </div>

            <div 
              ref={waveTrackRef}
              style={{ position: 'relative', height: alturaOnda, borderBottom: `1px solid ${COR_HAIRLINE}`, background: '#131418' }}
            >
              <div
                ref={wavesurferContainerRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  opacity: temWaveformReal ? 1 : 0,
                  pointerEvents: 'none'
                }}
              />

              {!temWaveformReal && !carregando && (
                <svg width={larguraTotal} height={alturaOnda} style={{ display: 'block', position: 'absolute', top: 0, left: 0 }}>
                  <line x1="0" y1={alturaOnda / 2} x2={larguraTotal} y2={alturaOnda / 2} stroke={COR_HAIRLINE} />
                  {picosFallback.map(([min, max], indice) => {
                    const x = (indice / picosFallback.length) * larguraTotal;
                    const largura = Math.max(1, larguraTotal / picosFallback.length);
                    const yTopo = alturaOnda / 2 - max * (alturaOnda / 2 - 4);
                    const yBase = alturaOnda / 2 - min * (alturaOnda / 2 - 4);
                    return (
                      <rect
                        key={indice}
                        x={x}
                        y={yTopo}
                        width={largura}
                        height={Math.max(1, yBase - yTopo)}
                        fill="#454851"
                        opacity={0.6}
                      />
                    );
                  })}
                </svg>
              )}
              
              {renderAlcaVertical('onda')}
            </div>

            <div
              ref={legendaTrackRef}
              style={{ position: 'relative', height: alturaTrilhaLegenda, background: '#16171b' }}
            >
              {palavrasVisiveis.map((palavra) => {
                const emArraste = arrastoVisual?.palavraId === palavra.id;
                const inicio = emArraste
                  ? arrastoVisual.inicio
                  : Math.max(0, limitarNumero(palavra.inicio));
                const fim = emArraste
                  ? arrastoVisual.fim
                  : Math.max(inicio + 0.04, limitarNumero(palavra.fim, inicio + 0.04));
                const esquerda = inicio * pxPorSegundo;
                const largura = Math.max(20, (fim - inicio) * pxPorSegundo);
                const selecionada = palavra.id === palavraSelecionadaId;
                const emGrupo = idsSelecionados?.includes(palavra.id);

                const idVizinhaDireitaColada = juncoesPorPalavraId.get(palavra.id) || null;
                const temJuncaoNaDireita = !!idVizinhaDireitaColada;
                const temJuncaoNaEsquerda = idsComJuncaoNaEsquerda.has(palavra.id);

                const { fundo: corFundoBloco, texto: corTextoBloco } =
                  resolverCoresDoBlocoDePalavra(palavra, volumeReferencia);

                const alturaBloco = Math.max(20, alturaTrilhaLegenda - 20);

                return (
                  <div
                    key={palavra.id}
                    title={
                      typeof palavra.volumeDb === 'number'
                        ? `${palavra.texto} — ${inicio.toFixed(2)}s a ${fim.toFixed(2)}s — ${palavra.volumeDb.toFixed(1)} dB`
                        : `${palavra.texto} — ${inicio.toFixed(2)}s a ${fim.toFixed(2)}s`
                    }
                    onClick={(evento) => {
                      evento.stopPropagation();
                      aoSelecionarPalavra?.(palavra.id, evento.ctrlKey);
                    }}
                    style={{
                      position: 'absolute',
                      left: esquerda,
                      top: 10,
                      width: largura,
                      height: alturaBloco,
                      borderRadius: 6,
                      border: selecionada ? `2px solid ${COR_AMBAR}` : emGrupo ? `2px solid ${COR_AZUL}` : `1px solid ${COR_HAIRLINE}`,
                      background: corFundoBloco,
                      color: corTextoBloco,
                      fontSize: 12,
                      fontWeight: 600,
                      boxSizing: 'border-box',
                      transition: emArraste ? 'none' : 'border-color 100ms ease, background-color 150ms ease',
                      opacity: emArraste ? 0.85 : 1,
                      boxShadow: emArraste ? `0 0 0 1px ${COR_AMBAR}, 0 4px 12px rgba(0,0,0,0.4)` : 'none',
                      zIndex: emArraste ? 4 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      overflow: 'hidden',
                    }}
                  >
                    {!temJuncaoNaEsquerda && (
                      <div
                        onPointerDown={(e) => iniciarResize(e, palavra, 'esquerda')}
                        onPointerMove={moverResize}
                        onPointerUp={finalizarResize}
                        onPointerCancel={finalizarResize}
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: LARGURA_ALCA_PX,
                          cursor: 'ew-resize',
                          touchAction: 'none',
                          zIndex: 2,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <div style={{ width: 3, height: 16, borderRadius: 2, background: 'rgba(255,255,255,0.65)' }} />
                      </div>
                    )}

                    <span
                      onPointerDown={(e) => iniciarMover(e, palavra)}
                      onPointerMove={moverMover}
                      onPointerUp={finalizarMover}
                      onPointerCancel={finalizarMover}
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        padding: `0 ${LARGURA_ALCA_PX + 4}px`,
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        cursor: emArraste ? 'grabbing' : 'grab',
                        touchAction: 'none',
                      }}
                    >
                      {palavra.texto}
                    </span>

                    {!temJuncaoNaDireita && (
                      <div
                        onPointerDown={(e) => iniciarResize(e, palavra, 'direita')}
                        onPointerMove={moverResize}
                        onPointerUp={finalizarResize}
                        onPointerCancel={finalizarResize}
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: LARGURA_ALCA_PX,
                          cursor: 'ew-resize',
                          touchAction: 'none',
                          zIndex: 2,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <div style={{ width: 3, height: 16, borderRadius: 2, background: 'rgba(255,255,255,0.65)' }} />
                      </div>
                    )}
                  </div>
                );
              })}

              {palavrasVisiveis.map((palavra) => {
                const idVizinhaDireitaColada = juncoesPorPalavraId.get(palavra.id);
                if (!idVizinhaDireitaColada) return null;
                if (arrastoVisual?.palavraId === palavra.id) return null;

                const fronteira = limitarNumero(palavra.fim) * pxPorSegundo;
                const alturaBloco = Math.max(20, alturaTrilhaLegenda - 20);

                return (
                  <div
                    key={`juncao-${palavra.id}`}
                    onPointerDown={(e) => iniciarResizeJuncao(e, palavra.id, idVizinhaDireitaColada)}
                    onPointerMove={moverResizeJuncao}
                    onPointerUp={finalizarResizeJuncao}
                    onPointerCancel={finalizarResizeJuncao}
                    title="Arraste para redimensionar as duas palavras coladas"
                    style={{
                      position: 'absolute',
                      left: fronteira - LARGURA_ALCA_JUNCAO_PX / 2,
                      top: 10,
                      width: LARGURA_ALCA_JUNCAO_PX,
                      height: alturaBloco,
                      cursor: 'ew-resize',
                      touchAction: 'none',
                      zIndex: 3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div style={{ width: 3, height: 20, borderRadius: 2, background: COR_AZUL }} />
                  </div>
                );
              })}

              {renderAlcaVertical('legenda')}
            </div>

            <div
              id="agulha-playhead"
              style={{
                position: 'absolute',
                left: posicaoPlayheadPx,
                top: 0,
                bottom: 0,
                width: 2,
                background: COR_AMBAR,
                pointerEvents: 'none',
                zIndex: 3,
                boxShadow: `0 0 8px ${COR_AMBAR}`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: -5,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: COR_AMBAR,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}