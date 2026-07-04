// client/src/components/TelaTimeline.jsx
//
// Página dedicada da Timeline — antes isso vivia espremido dentro do
// editor (TimelineCamadas.jsx), com uma onda sonora totalmente sintética
// (gerada por Math.sin, sem nenhuma relação com o áudio real). Esta tela
// substitui aquilo por:
//
//   1. Uma waveform desenhada a partir do áudio REAL do vídeo/arquivo do
//      projeto (via hook useWaveformPeaks, que decodifica com a Web
//      Audio API).
//   2. Zoom (a régua de tempo e as trilhas escalam juntas).
//   3. Scroll automático para acompanhar o playhead durante a reprodução
//      do player (recebido via prop, controlado pelo App).
//   4. Clique em qualquer ponto da timeline reposiciona o player
//      (seek), tanto na régua quanto nas trilhas.
//
// Este componente não sabe nada sobre a existência do Player do Remotion
// além da pequena interface que o App.jsx repassa: tempoAtualSegundos
// (número, atualizado a cada frame) e aoBuscarTempo(segundos) (callback
// de seek). Isso mantém a tela desacoplada e reaproveitável.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useWaveformPeaks, reamostrarPicos } from '../hooks/useWaveformPeaks';

const PX_POR_SEGUNDO_BASE = 72;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ALTURA_ONDA = 96;
const ALTURA_REGUA = 34;
const ALTURA_TRILHA_LEGENDA = 58;
const LARGURA_ROTULO = 76;

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
  // Escolhe o passo dos marcadores dependendo do zoom, pra nunca ficar
  // nem lotado de números nem vazio demais.
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

export function TelaTimeline({
  projeto,
  urlAudio,
  duracaoSegundos,
  tempoAtualSegundos = 0,
  aoBuscarTempo,
  estaTocando = false,
  aoAlternarPlayPause,
  palavraSelecionadaId,
  idsSelecionados,
  aoSelecionarPalavra,
  aoVoltarParaEditor,
  registrarSlotDoPlayer,
}) {
  const [zoom, setZoom] = useState(1);
  const [seguirPlayhead, setSeguirPlayhead] = useState(true);
  const containerScrollRef = useRef(null);
  const arrastandoRef = useRef(false);

  const { picos, duracaoSegundos: duracaoAudioDecodificado, carregando, erro } =
    useWaveformPeaks(urlAudio);

  const duracao = Math.max(1, limitarNumero(duracaoSegundos || duracaoAudioDecodificado, 1));
  const pxPorSegundo = PX_POR_SEGUNDO_BASE * zoom;
  const larguraTotal = Math.max(800, Math.ceil(duracao * pxPorSegundo));

  const palavras = useMemo(() => coletarPalavras(projeto?.blocos), [projeto]);
  const marcadores = useMemo(
    () => criarMarcadoresTempo(duracao, pxPorSegundo),
    [duracao, pxPorSegundo]
  );

  // Reamostra os picos reais para o número de colunas que cabem na
  // largura atual — refeito sempre que o zoom muda, sem re-decodificar
  // o áudio (o hook já guardou os picos originais em alta resolução).
  const colunasVisiveis = Math.max(100, Math.min(3000, Math.floor(larguraTotal / 2)));
  const picosReamostrados = useMemo(
    () => reamostrarPicos(picos, colunasVisiveis),
    [picos, colunasVisiveis]
  );

  const temWaveformReal = !!picos && !erro;

  // Fallback: se a decodificação real falhar (ex: arquivo sem trilha de
  // áudio, ou navegador sem suporte), ainda mostramos alguma coisa em
  // vez de uma trilha vazia — deixando claro que é um placeholder.
  const picosFallback = useMemo(() => {
    if (temWaveformReal || carregando) return [];
    return Array.from({ length: colunasVisiveis }, (_, i) => {
      const onda = Math.sin(i * 0.15) * 0.5 + Math.sin(i * 0.037) * 0.3;
      const amplitude = 0.15 + Math.abs(onda) * 0.35;
      return [-amplitude, amplitude];
    });
  }, [temWaveformReal, carregando, colunasVisiveis]);

  const picosParaDesenhar = temWaveformReal ? picosReamostrados : picosFallback;

  // --- Sincronização de scroll com o playhead ---
  const posicaoPlayheadPx = (tempoAtualSegundos / duracao) * larguraTotal;

  useEffect(() => {
    if (!seguirPlayhead) return;
    const container = containerScrollRef.current;
    if (!container) return;

    const margem = 120;
    const alvo = posicaoPlayheadPx - container.clientWidth / 2;
    const dentroDaVista =
      posicaoPlayheadPx >= container.scrollLeft + margem &&
      posicaoPlayheadPx <= container.scrollLeft + container.clientWidth - margem;

    if (!dentroDaVista) {
      container.scrollTo({ left: Math.max(0, alvo), behavior: 'smooth' });
    }
  }, [posicaoPlayheadPx, seguirPlayhead]);

  // Se o usuário rolar manualmente, para de perseguir o playhead até que
  // ele clique em "seguir" de novo — evita a timeline "brigar" com o
  // usuário tentando olhar outra parte da edição enquanto o vídeo toca.
  function aoRolarManualmente() {
    setSeguirPlayhead(false);
  }

  const tempoAPartirDoClique = useCallback(
    (evento, elementoRef) => {
      const rect = elementoRef.getBoundingClientRect();
      const x = evento.clientX - rect.left + elementoRef.scrollLeft;
      const tempo = (x / larguraTotal) * duracao;
      return Math.max(0, Math.min(duracao, tempo));
    },
    [larguraTotal, duracao]
  );

  function aoClicarNaFaixaDeTempo(evento) {
    if (!aoBuscarTempo) return;
    const container = containerScrollRef.current;
    if (!container) return;
    const tempo = tempoAPartirDoClique(evento, container);
    aoBuscarTempo(tempo);
    setSeguirPlayhead(true);
  }

  function aoIniciarArraste(evento) {
    arrastandoRef.current = true;
    aoClicarNaFaixaDeTempo(evento);
  }

  function aoMoverDuranteArraste(evento) {
    if (!arrastandoRef.current) return;
    aoClicarNaFaixaDeTempo(evento);
  }

  function aoFinalizarArraste() {
    arrastandoRef.current = false;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#101010',
        color: '#eaeaea',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid #262626',
          background: '#151515',
        }}
      >
        <button
          onClick={aoVoltarParaEditor}
          style={{
            padding: '8px 14px',
            borderRadius: 6,
            border: '1px solid #3a3a3a',
            background: '#1c1c1c',
            color: '#eaeaea',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          ← Voltar ao editor
        </button>

        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Timeline</h2>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={aoAlternarPlayPause}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid #3a3a3a',
              background: estaTocando ? '#EF9F27' : '#1c1c1c',
              color: estaTocando ? '#111' : '#eaeaea',
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={estaTocando ? 'Pausar' : 'Reproduzir'}
          >
            {estaTocando ? '❚❚' : '▶'}
          </button>

          <span style={{ fontSize: 13, color: '#999', fontVariantNumeric: 'tabular-nums' }}>
            {formatarTempo(tempoAtualSegundos)} / {formatarTempo(duracao)}
          </span>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#999' }}>
            <input
              type="checkbox"
              checked={seguirPlayhead}
              onChange={(e) => setSeguirPlayhead(e.target.checked)}
            />
            Seguir reprodução
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#999' }}>Zoom</span>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ width: 140 }}
            />
            <span style={{ fontSize: 12, color: '#999', width: 34, textAlign: 'right' }}>
              {zoom.toFixed(2)}x
            </span>
          </div>
        </div>
      </header>

      {carregando && (
        <div style={{ padding: '6px 20px', fontSize: 12, color: '#8ab4f8', background: '#12203a' }}>
          Decodificando áudio real para a waveform...
        </div>
      )}

      {!carregando && !temWaveformReal && (
        <div style={{ padding: '6px 20px', fontSize: 12, color: '#e0b34d', background: '#2a2210' }}>
          Não foi possível decodificar o áudio real deste arquivo — mostrando um
          placeholder. {erro ? `Detalhe: ${erro.message}` : 'Verifique se o arquivo tem trilha de áudio.'}
        </div>
      )}

      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #262626',
          background: '#0c0c0c',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          ref={registrarSlotDoPlayer}
          style={{ width: '100%', maxWidth: 720, aspectRatio: '16 / 9', borderRadius: 8, overflow: 'hidden', background: '#111' }}
        />
      </div>

      <div
        ref={containerScrollRef}
        onScroll={aoRolarManualmente}
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: `${LARGURA_ROTULO}px 1fr`, minWidth: larguraTotal + LARGURA_ROTULO }}>
          {/* Coluna de rótulos das trilhas, fixa à esquerda visualmente
              via grid (rola junto verticalmente, mas o conteúdo da régua
              e das trilhas é que rola horizontalmente por estarem dentro
              do mesmo scroll container). */}
          <div style={{ position: 'sticky', left: 0, zIndex: 2, background: '#151515' }}>
            <div style={{ height: ALTURA_REGUA, borderBottom: '1px solid #262626' }} />
            <div
              style={{
                height: ALTURA_ONDA,
                borderBottom: '1px solid #262626',
                display: 'flex',
                alignItems: 'center',
                paddingLeft: 10,
                fontSize: 12,
                fontWeight: 600,
                color: '#cfcfcf',
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
                fontSize: 12,
                fontWeight: 600,
                color: '#cfcfcf',
              }}
            >
              Legenda
            </div>
          </div>

          {/* Régua de tempo + trilhas, largura = larguraTotal, clicável
              em toda a extensão vertical para buscar tempo. */}
          <div
            style={{ position: 'relative', width: larguraTotal, cursor: 'pointer', userSelect: 'none' }}
            onMouseDown={aoIniciarArraste}
            onMouseMove={aoMoverDuranteArraste}
            onMouseUp={aoFinalizarArraste}
            onMouseLeave={aoFinalizarArraste}
          >
            {/* Régua */}
            <div style={{ position: 'relative', height: ALTURA_REGUA, borderBottom: '1px solid #262626', background: '#1a1a1a' }}>
              {marcadores.map((tempo) => (
                <div
                  key={tempo}
                  style={{
                    position: 'absolute',
                    left: tempo * pxPorSegundo,
                    top: 0,
                    bottom: 0,
                    borderLeft: '1px solid #333',
                    paddingLeft: 6,
                    fontSize: 11,
                    color: '#b8b8b8',
                    display: 'flex',
                    alignItems: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatarTempo(tempo)}
                </div>
              ))}
            </div>

            {/* Waveform real */}
            <div style={{ position: 'relative', height: ALTURA_ONDA, borderBottom: '1px solid #262626', background: '#121212' }}>
              <svg width={larguraTotal} height={ALTURA_ONDA} style={{ display: 'block' }}>
                <line x1="0" y1={ALTURA_ONDA / 2} x2={larguraTotal} y2={ALTURA_ONDA / 2} stroke="#2d2d2d" />
                {picosParaDesenhar.map(([min, max], indice) => {
                  const x = (indice / picosParaDesenhar.length) * larguraTotal;
                  const largura = Math.max(1, larguraTotal / picosParaDesenhar.length);
                  const yTopo = ALTURA_ONDA / 2 - max * (ALTURA_ONDA / 2 - 4);
                  const yBase = ALTURA_ONDA / 2 - min * (ALTURA_ONDA / 2 - 4);
                  return (
                    <rect
                      key={indice}
                      x={x}
                      y={yTopo}
                      width={largura}
                      height={Math.max(1, yBase - yTopo)}
                      fill={temWaveformReal ? '#43b5a0' : '#5c5c5c'}
                      opacity={temWaveformReal ? 0.92 : 0.6}
                    />
                  );
                })}
              </svg>
            </div>

            {/* Trilha de legendas */}
            <div style={{ position: 'relative', height: ALTURA_TRILHA_LEGENDA, background: '#181818' }}>
              {palavras.map((palavra) => {
                const inicio = Math.max(0, limitarNumero(palavra.inicio));
                const fim = Math.max(inicio + 0.04, limitarNumero(palavra.fim, inicio + 0.04));
                const esquerda = inicio * pxPorSegundo;
                const largura = Math.max(20, (fim - inicio) * pxPorSegundo);
                const selecionada = palavra.id === palavraSelecionadaId;
                const emGrupo = idsSelecionados?.includes(palavra.id);

                return (
                  <button
                    key={palavra.id}
                    onClick={(evento) => {
                      evento.stopPropagation();
                      aoSelecionarPalavra?.(palavra.id, evento.shiftKey);
                    }}
                    title={`${palavra.texto} — ${inicio.toFixed(2)}s a ${fim.toFixed(2)}s`}
                    style={{
                      position: 'absolute',
                      left: esquerda,
                      top: 10,
                      width: largura,
                      height: 36,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      borderRadius: 6,
                      border: selecionada ? '2px solid #EF9F27' : emGrupo ? '2px solid #378ADD' : '1px solid #5c6470',
                      background: palavra.estilo ? '#593d1f' : '#293241',
                      color: '#fff',
                      fontSize: 12,
                      padding: '0 8px',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                    }}
                  >
                    {palavra.texto}
                  </button>
                );
              })}
            </div>

            {/* Playhead — atravessa régua + trilhas */}
            <div
              style={{
                position: 'absolute',
                left: posicaoPlayheadPx,
                top: 0,
                bottom: 0,
                width: 2,
                background: '#ff4d4d',
                pointerEvents: 'none',
                zIndex: 3,
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
                  background: '#ff4d4d',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}