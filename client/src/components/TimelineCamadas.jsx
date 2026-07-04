import React, { useMemo } from 'react';

const PX_POR_SEGUNDO = 72;
const LARGURA_MINIMA = 960;

function limitarNumero(valor, fallback = 0) {
  return Number.isFinite(valor) ? valor : fallback;
}

function coletarPalavras(blocos) {
  return (blocos || []).flatMap((bloco) =>
    (bloco?.palavras || []).map((palavra) => ({
      ...palavra,
      blocoId: bloco.id,
      blocoInicio: bloco.inicio,
      blocoFim: bloco.fim,
    }))
  );
}

function amplitudeParaTempo(palavras, tempo, indice) {
  const palavra = palavras.find((p) => tempo >= p.inicio && tempo <= p.fim);
  if (palavra && typeof palavra.volumeNormalizado === 'number') {
    return 0.18 + Math.min(1, Math.max(0, palavra.volumeNormalizado)) * 0.78;
  }

  const ondaBase = Math.sin(indice * 1.71) * 0.5 + Math.sin(indice * 0.37) * 0.35;
  return 0.18 + Math.abs(ondaBase) * 0.52;
}

function formatarTempo(segundos) {
  const total = Math.max(0, limitarNumero(segundos));
  const minutos = Math.floor(total / 60);
  const seg = Math.floor(total % 60);
  return `${minutos}:${String(seg).padStart(2, '0')}`;
}

function criarMarcadoresTempo(duracaoSegundos) {
  const duracao = Math.max(1, Math.ceil(duracaoSegundos));
  const passo = duracao > 180 ? 30 : duracao > 90 ? 15 : 5;
  const marcadores = [];
  for (let tempo = 0; tempo <= duracao; tempo += passo) {
    marcadores.push(tempo);
  }
  if (marcadores[marcadores.length - 1] !== duracao) marcadores.push(duracao);
  return marcadores;
}

export function TimelineCamadas({
  blocos,
  duracaoSegundos,
  palavraSelecionadaId,
  idsSelecionados,
  aoSelecionarPalavra,
}) {
  const palavras = useMemo(() => coletarPalavras(blocos), [blocos]);
  const duracao = Math.max(1, limitarNumero(duracaoSegundos, 1));
  const larguraTimeline = Math.max(LARGURA_MINIMA, Math.ceil(duracao * PX_POR_SEGUNDO));
  const marcadores = useMemo(() => criarMarcadoresTempo(duracao), [duracao]);

  const barrasOnda = useMemo(() => {
    const quantidade = Math.max(180, Math.min(900, Math.floor(larguraTimeline / 5)));
    return Array.from({ length: quantidade }, (_, indice) => {
      const tempo = (indice / Math.max(1, quantidade - 1)) * duracao;
      const amplitude = amplitudeParaTempo(palavras, tempo, indice);
      return { indice, x: (indice / quantidade) * larguraTimeline, amplitude };
    });
  }, [duracao, larguraTimeline, palavras]);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Timeline</h3>

      <div
        style={{
          border: '1px solid #d8d8d8',
          borderRadius: 8,
          background: '#151515',
          color: '#eee',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ padding: '8px 10px', fontSize: 11, color: '#aaa', background: '#202020' }}>TC</div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ position: 'relative', height: 34, width: larguraTimeline }}>
              {marcadores.map((tempo) => (
                <div
                  key={tempo}
                  style={{
                    position: 'absolute',
                    left: `${(tempo / duracao) * 100}%`,
                    top: 0,
                    bottom: 0,
                    borderLeft: '1px solid #333',
                    paddingLeft: 6,
                    fontSize: 11,
                    color: '#b8b8b8',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {formatarTempo(tempo)}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ maxHeight: 270, overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', minWidth: larguraTimeline + 72 }}>
            <div style={{ background: '#202020', borderRight: '1px solid #2a2a2a' }}>
              {['V1', 'A1', 'LEG'].map((rotulo) => (
                <div
                  key={rotulo}
                  style={{
                    height: rotulo === 'A1' ? 82 : 58,
                    borderBottom: '1px solid #2a2a2a',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 12,
                    fontSize: 12,
                    color: '#cfcfcf',
                    fontWeight: 600,
                  }}
                >
                  {rotulo}
                </div>
              ))}
            </div>

            <div style={{ width: larguraTimeline }}>
              <div style={{ position: 'relative', height: 58, borderBottom: '1px solid #2a2a2a', background: '#191919' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 10,
                    height: 38,
                    width: larguraTimeline,
                    borderRadius: 6,
                    background: 'linear-gradient(90deg, #2b2f36, #3a424d)',
                    border: '1px solid #4a5360',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ position: 'relative', height: 82, borderBottom: '1px solid #2a2a2a', background: '#121212' }}>
                <svg width={larguraTimeline} height="82" style={{ display: 'block' }}>
                  <line x1="0" y1="41" x2={larguraTimeline} y2="41" stroke="#2d2d2d" />
                  {barrasOnda.map((barra) => {
                    const altura = Math.max(4, barra.amplitude * 64);
                    return (
                      <rect
                        key={barra.indice}
                        x={barra.x}
                        y={41 - altura / 2}
                        width="3"
                        height={altura}
                        rx="1.5"
                        fill="#43b5a0"
                        opacity="0.88"
                      />
                    );
                  })}
                </svg>
              </div>

              <div style={{ position: 'relative', height: 58, background: '#181818' }}>
                {palavras.map((palavra) => {
                  const inicio = Math.max(0, limitarNumero(palavra.inicio));
                  const fim = Math.max(inicio + 0.04, limitarNumero(palavra.fim, inicio + 0.04));
                  const esquerda = (inicio / duracao) * larguraTimeline;
                  const largura = Math.max(24, ((fim - inicio) / duracao) * larguraTimeline);
                  const selecionada = palavra.id === palavraSelecionadaId;
                  const emGrupo = idsSelecionados?.includes(palavra.id);

                  return (
                    <button
                      key={palavra.id}
                      onClick={(event) => aoSelecionarPalavra(palavra.id, event.shiftKey)}
                      title={`${palavra.texto} - ${inicio.toFixed(2)}s a ${fim.toFixed(2)}s`}
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
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}