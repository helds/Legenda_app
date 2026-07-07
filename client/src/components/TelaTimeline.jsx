// client/src/components/TelaTimeline.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useWavesurfer } from '../hooks/useWavesurfer';
import { LegendaFlutuante } from './LegendaFlutuante';
// projectModel.js é CommonJS (module.exports), então o Vite expõe tudo
// agrupado como default export — não dá para desestruturar direto no
// import (`import { corDaPalavraPorVolume } from ...` falha em runtime
// com "does not provide an export named"). Importamos o objeto inteiro
// e pegamos a função dele.
import * as projectModel from '../../../shared/projectModel';

const PX_POR_SEGUNDO_BASE = 72;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ALTURA_ONDA = 96;
const ALTURA_REGUA = 34;
const ALTURA_TRILHA_LEGENDA = 58;
const ALTURA_LEGENDA_FLUTUANTE = 200;
const LARGURA_ROTULO = 76;

const DURACAO_MINIMA_PALAVRA = 0.08;
const LARGURA_ALCA_PX = 8;
const LARGURA_ALCA_JUNCAO_PX = 10;
// Mesmo limiar usado no App.jsx para decidir se duas palavras vizinhas
// estão "coladas" (habilitando a alça de junção estilo DaVinci Resolve).
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

// Cor sólida usada quando a palavra NÃO tem dado de volume (projeto
// criado só a partir de .srt, sem sincronização de áudio) — mesma cor
// que já existia antes desta funcionalidade, para não mudar a aparência
// de projetos que nunca rodaram a análise de volume.
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

// Decide a cor de fundo e a cor de texto do retângulo de uma palavra na
// trilha de legenda da timeline, considerando (em ordem de prioridade):
//   1. Volume (se o projeto tiver `volumeReferencia` e a palavra tiver
//      `volumeDb`) — gradiente contínuo azul (abaixo da média) -> verde
//      (na média) -> vermelho (acima da média). Isso é o sinal mais
//      importante para o usuário identificar variações de volume.
//   2. Fallback: a cor sólida antiga (bege quando sem override de
//      estilo, âmbar-transparente quando com override), usada sempre
//      que não há dado de volume disponível para aquela palavra.
//
// O texto muda para branco sobre fundos coloridos por volume (todos os
// 3 pontos do gradiente — azul, verde, vermelho — são escuros o
// suficiente para contraste com texto claro), e mantém o esquema antigo
// (claro/escuro conforme override) quando cai no fallback.
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

// CORREÇÃO (Timeline sem vídeo/Player): a TelaTimeline não depende mais
// do Remotion Player nem do App.jsx para tempo/play. O WaveSurfer,
// instanciado logo abaixo com `mutado: false`, é agora a ÚNICA fonte de
// verdade de tempo/play/áudio nesta tela — ele toca o áudio de verdade
// (antes ficava mudo, pois o áudio vinha do <Video> dentro do Player).
// `aoAlternarPlayPause` e `aoBuscarTempo` são funções locais definidas
// mais abaixo que chamam os métodos do WaveSurfer. Os atalhos de
// teclado continuam funcionando exatamente igual para o usuário.
function useAtalhosDeTeclado({
  aoAlternarPlayPause,
  aoBuscarTempo,
  tempoAtualSegundosRef,
  duracaoRef,
  setZoom,
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
        case 'End':
          evento.preventDefault();
          aoBuscarTempo?.(duracao);
          break;
        case '+':
        case '=':
          setZoom((z) => Math.min(ZOOM_MAX, Number((z * 1.25).toFixed(3))));
          break;
        case '-':
        case '_':
          setZoom((z) => Math.max(ZOOM_MIN, Number((z / 1.25).toFixed(3))));
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoAlternarPlayPause, aoBuscarTempo, tempoAtualSegundosRef, duracaoRef, setZoom, fps]);
}

export function TelaTimeline({
  projeto,
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

  // CORREÇÃO (Timeline sem vídeo/Player): tempo e play/pause nascem
  // AQUI, a partir do WaveSurfer — não vêm mais do App/Remotion Player.
  // Isso é intencional: nesta tela o WaveSurfer é a única fonte de
  // áudio (ver `mutado: false` logo abaixo).
  const [tempoAtualSegundos, setTempoAtualSegundos] = useState(0);
  const [estaTocando, setEstaTocando] = useState(false);

  const containerScrollRef = useRef(null);
  const faixaRef = useRef(null);

  const arrastandoAgulhaRef = useRef(false);
  const pointerIdAgulhaRef = useRef(null);
  const resizeAtivoRef = useRef(null);
  const resizeJuncaoAtivoRef = useRef(null);
  const moverAtivoRef = useRef(null);
  // Estado visual (nao vem do projeto) so para a palavra sendo arrastada,
  // atualizado a cada pointermove; o valor definitivo eh sempre recalculado
  // a partir do que ja esta no estado do componente pai - este estado so
  // existe para o preview fluido de arraste sem esperar o round-trip do
  // estado do React.
  const [arrastoVisual, setArrastoVisual] = useState(null); // { palavraId, inicio, fim }

  // Controla os scrolls feitos automaticamente pelo código (autoscroll ao
  // seguir o playhead), para não confundir com scroll manual do usuário.
  const ignorarScroll = useRef(false);
  const timeoutScroll = useRef(null);

  const pxPorSegundo = PX_POR_SEGUNDO_BASE * zoom;

  // Ref estável para `aoBuscarTempo`, usado dentro do callback `onSeek`
  // passado ao useWavesurfer logo abaixo. Como `aoBuscarTempo` só é
  // definida via useCallback depois (pois depende de
  // `atualizarProgressoWavesurfer`, retornado pelo próprio hook), usamos
  // um ref para quebrar essa dependência circular sem arriscar closures
  // desatualizadas.
  const aoBuscarTempoRef = useRef(null);

  const wavesurferContainerRef = useRef(null);
  const {
    pronto: temWaveformReal,
    carregando,
    erro,
    duracaoSegundos: duracaoAudioDecodificado,
    seekTo: atualizarProgressoWavesurfer,
    alternarPlayPause: alternarPlayPauseWavesurfer,
  } = useWavesurfer({
    containerRef: wavesurferContainerRef,
    url: urlAudio,
    pxPorSegundo: pxPorSegundo,
    corOnda: COR_WAVE,
    corProgresso: COR_AMBAR,
    altura: ALTURA_ONDA,
    onSeek: (segundos) => aoBuscarTempoRef.current?.(segundos),
    // A Timeline não mostra mais vídeo — o áudio real sai daqui, então
    // o WaveSurfer deixa de ficar mudo.
    mutado: false,
    onPlay: () => setEstaTocando(true),
    onPause: () => setEstaTocando(false),
    onTempoAtualizado: (segundos) => setTempoAtualSegundos(segundos),
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

  // Referência global de volume do projeto (min/média ponderada/max),
  // preenchida pela sincronização automática de áudio (ver
  // server/audioSyncService.js e shared/projectModel.js#criarProjeto).
  // Pode ser null/undefined em projetos sem análise de áudio — nesse
  // caso resolverCoresDoBlocoDePalavra cai de volta na cor sólida antiga.
  const volumeReferencia = projeto?.volumeReferencia || null;

  // Para cada palavra, identifica se há uma vizinha colada imediatamente à
  // direita (gap <= LIMIAR_JUNCAO_SEGUNDOS). Quando há, a fronteira entre
  // as duas ganha uma alça de JUNÇÃO (redimensiona as duas ao mesmo tempo,
  // estilo DaVinci Resolve); quando não há, a borda direita da própria
  // palavra funciona como resize individual e livre.
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

  // Mapa reverso: dado o id de uma palavra, diz se ela é a "da direita" em
  // alguma junção (ou seja, tem uma vizinha colada imediatamente à
  // esquerda). Usado para não desenhar a alça individual esquerda quando
  // essa fronteira já é coberta pela alça de junção compartilhada.
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

  useAtalhosDeTeclado({
    aoAlternarPlayPause,
    aoBuscarTempo,
    tempoAtualSegundosRef,
    duracaoRef,
    setZoom,
  });

  // CORREÇÃO (Timeline sem vídeo/Player): este efeito agora cuida só do
  // autoscroll. Não chamamos mais `atualizarProgressoWavesurfer` (seekTo)
  // aqui a cada mudança de `tempoAtualSegundos` — durante a reprodução
  // normal é o PRÓPRIO WaveSurfer quem gera esse valor via evento
  // `timeupdate` (ver `onTempoAtualizado` passado ao useWavesurfer). Se
  // chamássemos seekTo aqui também, cada frame de reprodução brigaria
  // com a posição real de playback do WaveSurfer, travando o áudio. O
  // seekTo só é chamado explicitamente dentro de `aoBuscarTempo`, usado
  // pelos controles manuais (arrastar agulha, clicar na régua, atalhos
  // de teclado) — nunca durante o timeupdate automático.
  //
  // A posição da agulha e o texto do contador continuam vindo só do
  // JSX abaixo (`left: posicaoPlayheadPx` e
  // `{formatarTempo(tempoAtualSegundos)}`), que reage a
  // `tempoAtualSegundos` via render normal do React.
  useEffect(() => {
    tempoAtualSegundosRef.current = tempoAtualSegundos;

    const posicaoPx = tempoAtualSegundos * pxPorSegundo;

    if (seguirPlayhead && !arrastandoAgulhaRef.current) {
      const scrollContainer = containerScrollRef.current;
      if (scrollContainer) {
        const margem = 120;
        const dentroDaVista =
          posicaoPx >= scrollContainer.scrollLeft + margem &&
          posicaoPx <= scrollContainer.scrollLeft + scrollContainer.clientWidth - margem;

        if (!dentroDaVista) {
          // AVISAMOS QUE O SCROLL É AUTOMÁTICO
          ignorarScroll.current = true;
          scrollContainer.scrollTo({
            left: Math.max(0, posicaoPx - scrollContainer.clientWidth / 2),
            behavior: estaTocando ? 'auto' : 'smooth',
          });

          if (timeoutScroll.current) clearTimeout(timeoutScroll.current);
          timeoutScroll.current = setTimeout(() => {
            ignorarScroll.current = false;
          }, estaTocando ? 100 : 600);
        }
      }
    }
  }, [tempoAtualSegundos, pxPorSegundo, seguirPlayhead, estaTocando]);

  function aoRolarManualmente() {
    // SE FOR O CÓDIGO A ROLAR A BARRA, IGNORAR (NÃO DESLIGAR O BOTÃO)
    if (ignorarScroll.current) return;

    if (arrastandoAgulhaRef.current) return;
    setSeguirPlayhead(false);
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

  // Alça de JUNÇÃO: fica na fronteira entre duas palavras coladas. Arrastar
  // move o fim da palavra da esquerda e o início da da direita ao mesmo
  // tempo (como no editor de junções do DaVinci Resolve). Só existe quando
  // as duas palavras estão de fato encostadas — ver juncoesPorPalavraId.
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

  // Arrastar pelo CENTRO do bloco: move a palavra inteira (mantendo sua
  // duração) para qualquer posição livre da timeline. Diferente das alças
  // de borda (resize com ripple), aqui não há vínculo com as vizinhas — ao
  // soltar, se o novo intervalo cair em cima de outra(s) palavra(s), a área
  // coberta é recortada delas (ver aplicarMoverPalavraComCorte no App.jsx).
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
      // deslocamento entre o ponto do clique e o início do bloco, para que
      // o bloco não "salte" para debaixo do cursor ao começar o arraste.
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
              title={
                `Cor por volume: azul = mais baixo, verde = na média (${volumeReferencia.volumeDbMedia?.toFixed?.(1)} dB), vermelho = mais alto`
              }
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

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: COR_TEXTO_TERC, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={seguirPlayhead}
              onChange={(e) => setSeguirPlayhead(e.target.checked)}
              style={{ accentColor: COR_AMBAR }}
            />
            Seguir reprodução
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: COR_TEXTO_TERC }}>Zoom</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: 140 }}
              title="Atalhos: + / -"
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
              style={{
                height: ALTURA_ONDA,
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
            </div>
            <div
              style={{
                height: ALTURA_TRILHA_LEGENDA,
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

            <div style={{ position: 'relative', height: ALTURA_ONDA, borderBottom: `1px solid ${COR_HAIRLINE}`, background: '#131418' }}>

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
                <svg width={larguraTotal} height={ALTURA_ONDA} style={{ display: 'block', position: 'absolute', top: 0, left: 0 }}>
                  <line x1="0" y1={ALTURA_ONDA / 2} x2={larguraTotal} y2={ALTURA_ONDA / 2} stroke={COR_HAIRLINE} />
                  {picosFallback.map(([min, max], indice) => {
                    const x = (indice / picosFallback.length) * larguraTotal;
                    const largura = Math.max(1, larguraTotal / picosFallback.length);
                    const yTopo = ALTURA_ONDA / 2 - max * (ALTURA_ONDA / 2 - 4);
                    const yBase = ALTURA_ONDA / 2 - min * (ALTURA_ONDA / 2 - 4);
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
            </div>

            <div
              style={{ position: 'relative', height: ALTURA_TRILHA_LEGENDA, background: '#16171b' }}
            >
              {palavras.map((palavra) => {
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

                // Se esta palavra tem uma vizinha colada à direita, a
                // borda direita dela NÃO é resize individual — vira parte
                // da alça de junção compartilhada (desenhada separadamente
                // logo abaixo, centrada na fronteira). O mesmo vale para a
                // borda esquerda quando a vizinha da ESQUERDA está colada
                // nela.
                const idVizinhaDireitaColada = juncoesPorPalavraId.get(palavra.id) || null;
                const temJuncaoNaDireita = !!idVizinhaDireitaColada;
                const temJuncaoNaEsquerda = idsComJuncaoNaEsquerda.has(palavra.id);

                // Cor do bloco: por volume (gradiente azul/verde/vermelho)
                // quando o projeto tem dados de sincronização de áudio,
                // ou a cor sólida antiga como fallback.
                const { fundo: corFundoBloco, texto: corTextoBloco } =
                  resolverCoresDoBlocoDePalavra(palavra, volumeReferencia);

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
                      height: 38,
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
                    {/* Alça de resize individual da borda ESQUERDA — só
                        ativa quando não há junção com a vizinha da
                        esquerda (senão a alça de junção cuida disso). */}
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

                    {/* Alça de resize individual da borda DIREITA — só
                        ativa quando não há junção com a vizinha da
                        direita. */}
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

              {/* Alças de JUNÇÃO: uma por par de palavras coladas,
                  desenhada por cima, centrada exatamente na fronteira
                  entre as duas. Arrastar move o fim da esquerda e o
                  início da direita ao mesmo tempo (estilo DaVinci
                  Resolve). Só existe quando o espaço entre elas é ~0 —
                  quando há espaço livre, cada palavra é redimensionada
                  individualmente pela sua própria alça de borda. */}
              {palavras.map((palavra) => {
                const idVizinhaDireitaColada = juncoesPorPalavraId.get(palavra.id);
                if (!idVizinhaDireitaColada) return null;
                if (arrastoVisual?.palavraId === palavra.id) return null; // some durante arraste de mover

                const fronteira = limitarNumero(palavra.fim) * pxPorSegundo;

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
                      height: 38,
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