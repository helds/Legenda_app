// client/src/components/PainelExportacao.jsx
import React, { useEffect, useRef, useState } from 'react';

// Intervalo do polling de progresso (ms). Se o backend expuser progresso via
// SSE/WebSocket no futuro, essa função de polling pode ser trocada sem mexer
// no resto do componente — só precisa continuar chamando onProgress(0..1).
const INTERVALO_POLL_MS = 800;

// Tenta buscar o progresso real em /api/projetos/:id/exportar/status.
// Se o endpoint não existir (404) ou o backend ainda não expuser progresso
// numérico, retorna null e o componente cai pro modo "indeterminado".
async function buscarProgresso(projetoId, jobId) {
  const resp = await fetch(`/api/projetos/${projetoId}/exportar/status?jobId=${encodeURIComponent(jobId)}`);
  if (!resp.ok) return null;
  const data = await resp.json();
  // Esperado do backend: { progresso: 0..1, tempoRestanteSegundos?: number, concluido?: bool, erro?: string }
  if (typeof data.progresso !== 'number') return null;
  return data;
}

export function PainelExportacao({ projetoId }) {
  const [formato, setFormato] = useState('mov-alpha');
  const [corFundo, setCorFundo] = useState('#00FF00');
  const [exportando, setExportando] = useState(false);
  const [progresso, setProgresso] = useState(0); // 0..1
  const [progressoIndeterminado, setProgressoIndeterminado] = useState(false);
  const [tempoRestante, setTempoRestante] = useState(null); // segundos
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);

  const pollRef = useRef(null);

  function pararPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  useEffect(() => () => pararPolling(), []);

  function formatarTempoRestante(segundos) {
    if (segundos == null || !isFinite(segundos)) return null;
    const s = Math.max(0, Math.round(segundos));
    if (s < 60) return `~${s}s restantes`;
    const min = Math.floor(s / 60);
    const seg = s % 60;
    return `~${min}min ${seg}s restantes`;
  }

  async function exportar() {
    setExportando(true);
    setErro(null);
    setResultado(null);
    setProgresso(0);
    setTempoRestante(null);
    setProgressoIndeterminado(false);

    try {
      const resp = await fetch(`/api/projetos/${projetoId}/exportar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formato, corFundo }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha na exportação.');

      // Modo A: backend responde imediatamente com { jobId } e processa async.
      // Fazemos polling em /exportar/status até concluido:true.
      if (data.jobId) {
        let tentativasSemProgresso = 0;

        await new Promise((resolve, reject) => {
          pollRef.current = setInterval(async () => {
            try {
              const status = await buscarProgresso(projetoId, data.jobId);

              if (status == null) {
                // Backend ainda não expõe progresso numérico: mostra barra
                // indeterminada em vez de travar em 0%.
                tentativasSemProgresso += 1;
                if (tentativasSemProgresso > 2) setProgressoIndeterminado(true);
                return;
              }

              setProgressoIndeterminado(false);
              setProgresso(Math.min(1, Math.max(0, status.progresso)));
              setTempoRestante(
                typeof status.tempoRestanteSegundos === 'number' ? status.tempoRestanteSegundos : null
              );

              if (status.erro) {
                pararPolling();
                reject(new Error(status.erro));
              } else if (status.concluido) {
                pararPolling();
                setProgresso(1);
                setResultado(status);
                resolve();
              }
            } catch (pollErr) {
              pararPolling();
              reject(pollErr);
            }
          }, INTERVALO_POLL_MS);
        });
      } else {
        // Modo B (comportamento atual): backend responde só quando termina.
        // Sem progresso real disponível — mostramos barra indeterminada.
        setProgressoIndeterminado(true);
        setResultado(data);
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      pararPolling();
      setExportando(false);
      setProgressoIndeterminado(false);
    }
  }

  return (
    <div className="panel panel--flush">
      <h3 className="panel-title panel-title--accent">Exportar</h3>

      <div className="field">
        <label className="field-label">Formato</label>
        <select className="select" value={formato} onChange={(e) => setFormato(e.target.value)}>
          <option value="mov-alpha">.mov com alpha (ProRes 4444)</option>
          <option value="png-sequence">Sequência de PNG com transparência</option>
          <option value="mp4-fundo-solido">.mp4 com fundo de cor sólida</option>
        </select>
      </div>

      {formato === 'mp4-fundo-solido' && (
        <div className="field">
          <label className="field-label">Cor de fundo</label>
          <input type="color" value={corFundo} onChange={(e) => setCorFundo(e.target.value)} />
        </div>
      )}

      <div className="btn-progresso-wrap">
        <button
          className={`btn btn--primary btn--block btn-progresso${exportando ? ' btn-progresso--ativo' : ''}`}
          onClick={exportar}
          disabled={exportando}
        >
          <span
            className={`btn-progresso__fill${progressoIndeterminado ? ' btn-progresso__fill--indeterminado' : ''}`}
            style={!progressoIndeterminado ? { width: `${Math.round(progresso * 100)}%` } : undefined}
          />
          <span className="btn-progresso__conteudo">
            <span className="btn-progresso__label">
              {exportando
                ? (progressoIndeterminado ? 'Exportando…' : `Exportando… ${Math.round(progresso * 100)}%`)
                : 'Exportar vídeo'}
            </span>
            {exportando && !progressoIndeterminado && tempoRestante != null && (
              <span className="btn-progresso__tempo">{formatarTempoRestante(tempoRestante)}</span>
            )}
          </span>
        </button>
      </div>

      {erro && <p className="status-line status-line--error">{erro}</p>}

      {resultado && (
        <div className="callout callout--amber">
          <p style={{ margin: '0 0 6px' }}>Exportado com sucesso.</p>
          <a href={resultado.arquivo} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
            Abrir / baixar arquivo →
          </a>
        </div>
      )}

      {/*
        Estilos da barra de progresso dentro do botão.
        Se o projeto já tem um arquivo CSS global (ex: styles.css), mova este
        bloco pra lá e remova a tag <style> — funciona igual, só evita
        duplicar a tag caso o componente seja usado mais de uma vez na tela.
      */}
      <style>{`
        .btn-progresso-wrap {
          position: relative;
        }

        .btn-progresso {
          position: relative;
          overflow: hidden;
          isolation: isolate;
        }

        .btn-progresso__fill {
          position: absolute;
          inset: 0;
          width: 0%;
          background: #FFD400; /* amarelo mais saturado que o padrão do tema */
          transition: width 0.25s ease-out;
          z-index: 0;
        }

        .btn-progresso--ativo .btn-progresso__fill {
          /* leve textura de "carregando" enquanto preenche */
          background-image: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.18) 25%,
            transparent 25%,
            transparent 50%,
            rgba(255, 255, 255, 0.18) 50%,
            rgba(255, 255, 255, 0.18) 75%,
            transparent 75%,
            transparent
          );
          background-size: 24px 24px;
          animation: btn-progresso-stripes 1s linear infinite;
        }

        .btn-progresso__fill--indeterminado {
          width: 40% !important;
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          right: auto;
          animation: btn-progresso-indeterminado 1.2s ease-in-out infinite;
        }

        .btn-progresso__conteudo {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
        }

        .btn-progresso__tempo {
          font-size: 0.85em;
          opacity: 0.85;
          white-space: nowrap;
        }

        @keyframes btn-progresso-stripes {
          from { background-position: 0 0; }
          to { background-position: 24px 0; }
        }

        @keyframes btn-progresso-indeterminado {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}