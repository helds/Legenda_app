// client/src/components/TelaTimeline.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useWaveformPeaks, reamostrarPicos } from '../hooks/useWaveformPeaks';

const PX_POR_SEGUNDO_BASE = 72;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
const ALTURA_ONDA = 96;
const ALTURA_REGUA = 34;
const ALTURA_TRILHA_LEGENDA = 58;
const LARGURA_ROTULO = 76;

const COR_FUNDO = '#101114';
const COR_PAINEL = '#1c1e23';
const COR_CONTAINER = '#17181c';
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

  const colunasVisiveis = Math.max(100, Math.min(3000, Math.floor(larguraTotal / 2)));
  const picosReamostrados = useMemo(
    () => reamostrarPicos(picos, colunasVisiveis),
    [picos, colunasVisiveis]
  );

  const temWaveformReal = !!picos && !erro;

  const picosFallback = useMemo(() => {
    if (temWaveformReal || carregando) return [];
    return Array.from({ length: colunasVisiveis }, (_, i) => {
      const onda = Math.sin(i * 0.15) * 0.5 + Math.sin(i * 0.037) * 0.3;
      const amplitude = 0.15 + Math.abs(onda) * 0.35;
      return [-amplitude, amplitude];
    });
  }, [temWaveformReal, carregando, colunasVisiveis]);

  const picosParaDesenhar = temWaveformReal ? picosReamostrados : picosFallback;

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
            onClick={aoAlternarPlayPause}
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
            title={estaTocando ? 'Pausar' : 'Reproduzir'}
          >
            {estaTocando ? '❚❚' : '▶'}
          </button>

          <span style={{ fontSize: 13, color: COR_TEXTO_SEC, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono, monospace)' }}>
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
            />
            <span style={{ fontSize: 12, color: COR_TEXTO_TERC, width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {zoom.toFixed(2)}x
            </span>
          </div>
        </div>
      </header>

      {carregando && (
        <div style={{ padding: '6px 20px', fontSize: 12, color: COR_AZUL, background: 'rgba(91,141,239,0.08)' }}>
          Decodificando áudio real para a waveform…
        </div>
      )}

      {!carregando && !temWaveformReal && (
        <div style={{ padding: '6px 20px', fontSize: 12, color: COR_AMBAR, background: 'rgba(239,159,39,0.08)' }}>
          Não foi possível decodificar o áudio real deste arquivo — mostrando um
          placeholder. {erro ? `Detalhe: ${erro.message}` : 'Verifique se o arquivo tem trilha de áudio.'}
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
          ref={registrarSlotDoPlayer}
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
            style={{ position: 'relative', width: larguraTotal, cursor: 'pointer', userSelect: 'none' }}
            onMouseDown={aoIniciarArraste}
            onMouseMove={aoMoverDuranteArraste}
            onMouseUp={aoFinalizarArraste}
            onMouseLeave={aoFinalizarArraste}
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
              <svg width={larguraTotal} height={ALTURA_ONDA} style={{ display: 'block' }}>
                <line x1="0" y1={ALTURA_ONDA / 2} x2={larguraTotal} y2={ALTURA_ONDA / 2} stroke={COR_HAIRLINE} />
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
                      fill={temWaveformReal ? COR_WAVE : '#454851'}
                      opacity={temWaveformReal ? 0.92 : 0.6}
                    />
                  );
                })}
              </svg>
            </div>

            <div style={{ position: 'relative', height: ALTURA_TRILHA_LEGENDA, background: '#16171b' }}>
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
                      border: selecionada ? `2px solid ${COR_AMBAR}` : emGrupo ? `2px solid ${COR_AZUL}` : `1px solid ${COR_HAIRLINE}`,
                      background: palavra.estilo ? 'rgba(239,159,39,0.16)' : '#1e2028',
                      color: COR_TEXTO,
                      fontSize: 12,
                      padding: '0 8px',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                      transition: 'border-color 100ms ease',
                    }}
                  >
                    {palavra.texto}
                  </button>
                );
              })}
            </div>

            <div
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
