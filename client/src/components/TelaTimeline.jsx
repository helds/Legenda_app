// client/src/components/TelaTimeline.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useWavesurfer } from '../hooks/useWavesurfer';

const PX_POR_SEGUNDO_BASE = 72;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ALTURA_ONDA = 96;
const ALTURA_REGUA = 34;
const ALTURA_TRILHA_LEGENDA = 58;
const LARGURA_ROTULO = 76;

const DURACAO_MINIMA_PALAVRA = 0.08;
const LARGURA_ALCA_PX = 8;

const COR_FUNDO = '#101114';
const COR_PAINEL = '#1c1e23';
const COR_HAIRLINE = '#2b2d34';
const COR_TEXTO = '#edece7';
const COR_TEXTO_SEC = '#9a9ca4';
const COR_TEXTO_TERC = '#6b6d76';
const COR_AMBAR = '#ef9f27';
const COR_AZUL = '#5b8def';
const COR_WAVE = '#3d9b8a';

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

// CORREÇÃO (sincronia vídeo/áudio): antes este hook chamava
// `aoAlternarPlayPause` (que apenas invertia o estado local
// `tocandoLocal`) e navegava o tempo escrevendo direto num ref próprio.
// Agora `aoAlternarPlayPause` e `aoBuscarTempo` vêm de fora (App.jsx) e
// agem diretamente sobre o Remotion Player — que é a ÚNICA fonte de
// verdade de tempo/play. Os atalhos de teclado continuam funcionando
// exatamente igual para o usuário, só que agora comandam o player real
// em vez de um clock paralelo.
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
  tempoAtualSegundos = 0,
  // CORREÇÃO (sincronia vídeo/áudio): `estaTocando` e `aoAlternarPlayPause`
  // agora vêm do App.jsx, onde já existem ligados de verdade ao Remotion
  // Player (playerRef.current.play()/.pause(), e aos eventos
  // play/pause/ended do próprio player). Isso substitui o antigo estado
  // local `tocandoLocal`, que só dava play/pause no WaveSurfer e nunca
  // no vídeo — motivo pelo qual o vídeo não acompanhava o áudio.
  estaTocando = false,
  aoAlternarPlayPause,
  aoBuscarTempo,
  palavraSelecionadaId,
  idsSelecionados,
  aoSelecionarPalavra,
  aoVoltarParaEditor,
  registrarSlotDoPlayer,
  aoRedimensionarPalavra,
}) {
  const [zoom, setZoom] = useState(1);
  const [seguirPlayhead, setSeguirPlayhead] = useState(true);

  const containerScrollRef = useRef(null);
  const faixaRef = useRef(null);
  const containerPlayerRef = useRef(null);

  const arrastandoAgulhaRef = useRef(false);
  const pointerIdAgulhaRef = useRef(null);
  const resizeAtivoRef = useRef(null);

  // Controla os scrolls feitos automaticamente pelo código (autoscroll ao
  // seguir o playhead), para não confundir com scroll manual do usuário.
  const ignorarScroll = useRef(false);
  const timeoutScroll = useRef(null);

  const pxPorSegundo = PX_POR_SEGUNDO_BASE * zoom;

  const wavesurferContainerRef = useRef(null);
  const {
    pronto: temWaveformReal,
    carregando,
    erro,
    duracaoSegundos: duracaoAudioDecodificado,
    seekTo: atualizarProgressoWavesurfer,
  } = useWavesurfer({
    containerRef: wavesurferContainerRef,
    url: urlAudio,
    pxPorSegundo: pxPorSegundo,
    corOnda: COR_WAVE,
    corProgresso: COR_AMBAR,
    altura: ALTURA_ONDA,
    onSeek: aoBuscarTempo,
  });

  const duracao = Math.max(1, limitarNumero(duracaoSegundos || duracaoAudioDecodificado, 1));
  const larguraTotal = Math.max(800, Math.ceil(duracao * pxPorSegundo));

  const palavras = useMemo(() => coletarPalavras(projeto?.blocos), [projeto]);
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

  // CORREÇÃO (agulha não acompanhava o play): este efeito cuida do
  // autoscroll e do seekTo do WaveSurfer. A posição da agulha e o texto
  // do contador NÃO são mais escritos aqui via DOM direto — eles já são
  // controlados pelo JSX abaixo (`left: posicaoPlayheadPx` e
  // `{formatarTempo(tempoAtualSegundos)}`), que reage a `tempoAtualSegundos`
  // via render normal do React. Antes este efeito também fazia
  // `agulha.style.left = ...` e `contador.innerText = ...` manualmente —
  // isso duplicava a fonte de verdade da posição (React de um lado,
  // manipulação direta de DOM do outro) e podia deixar a agulha um passo
  // atrás do valor real durante a reprodução, dependendo da ordem de
  // commit dos efeitos. Mantendo só o JSX como fonte de verdade, a
  // agulha e o contador sempre refletem exatamente `tempoAtualSegundos`.
  useEffect(() => {
    tempoAtualSegundosRef.current = tempoAtualSegundos;

    const posicaoPx = tempoAtualSegundos * pxPorSegundo;

    if (temWaveformReal && atualizarProgressoWavesurfer) {
      atualizarProgressoWavesurfer(tempoAtualSegundos);
    }

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
  }, [tempoAtualSegundos, pxPorSegundo, temWaveformReal, atualizarProgressoWavesurfer, seguirPlayhead, estaTocando]);

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

      <div
        style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${COR_HAIRLINE}`,
          background: COR_FUNDO,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          ref={(node) => {
            containerPlayerRef.current = node;
            if (registrarSlotDoPlayer) registrarSlotDoPlayer(node);
          }}
          style={{
            width: '100%',
            maxWidth: 720,
            aspectRatio: '16 / 9',
            borderRadius: 10,
            overflow: 'hidden',
            background: '#000',
            border: `1px solid ${COR_HAIRLINE}`,
          }}
        />
      </div>

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
                const inicio = Math.max(0, limitarNumero(palavra.inicio));
                const fim = Math.max(inicio + 0.04, limitarNumero(palavra.fim, inicio + 0.04));
                const esquerda = inicio * pxPorSegundo;
                const largura = Math.max(20, (fim - inicio) * pxPorSegundo);
                const selecionada = palavra.id === palavraSelecionadaId;
                const emGrupo = idsSelecionados?.includes(palavra.id);

                return (
                  <div
                    key={palavra.id}
                    title={`${palavra.texto} — ${inicio.toFixed(2)}s a ${fim.toFixed(2)}s`}
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
                      background: palavra.estilo ? 'rgba(239,159,39,0.16)' : '#c9bfa1',
                      color: palavra.estilo ? COR_TEXTO : '#242017',
                      fontSize: 12,
                      fontWeight: 600,
                      boxSizing: 'border-box',
                      transition: 'border-color 100ms ease',
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      overflow: 'hidden',
                    }}
                  >
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
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <div style={{ width: 3, height: 16, borderRadius: 2, background: 'rgba(255,255,255,0.65)' }} />
                    </div>

                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        padding: `0 ${LARGURA_ALCA_PX + 4}px`,
                        pointerEvents: 'none',
                      }}
                    >
                      {palavra.texto}
                    </span>

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
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <div style={{ width: 3, height: 16, borderRadius: 2, background: 'rgba(255,255,255,0.65)' }} />
                    </div>
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