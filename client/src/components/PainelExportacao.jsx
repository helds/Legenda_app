// client/src/components/PainelExportacao.jsx
import React, { useState } from 'react';

export function PainelExportacao({ projetoId }) {
  const [formato, setFormato] = useState('mov-alpha');
  const [corFundo, setCorFundo] = useState('#00FF00');
  const [exportando, setExportando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);

  async function exportar() {
    setExportando(true);
    setErro(null);
    setResultado(null);
    try {
      const resp = await fetch(`/api/projetos/${projetoId}/exportar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formato, corFundo }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha na exportação.');
      setResultado(data);
    } catch (e) {
      setErro(e.message);
    } finally {
      setExportando(false);
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

      <button className="btn btn--primary btn--block" onClick={exportar} disabled={exportando}>
        {exportando ? 'Exportando…' : 'Exportar vídeo'}
      </button>

      {erro && <p className="status-line status-line--error">{erro}</p>}

      {resultado && (
        <div className="callout callout--amber">
          <p style={{ margin: '0 0 6px' }}>Exportado com sucesso.</p>
          <a href={resultado.arquivo} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
            Abrir / baixar arquivo →
          </a>
        </div>
      )}
    </div>
  );
}
