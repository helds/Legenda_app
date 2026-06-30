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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Exportar</h3>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Formato
        </label>
        <select value={formato} onChange={(e) => setFormato(e.target.value)} style={{ width: '100%' }}>
          <option value="mov-alpha">.mov com alpha (ProRes 4444)</option>
          <option value="png-sequence">Sequência de PNG com transparência</option>
          <option value="mp4-fundo-solido">.mp4 com fundo de cor sólida</option>
        </select>
      </div>

      {formato === 'mp4-fundo-solido' && (
        <div>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
            Cor de fundo
          </label>
          <input
            type="color"
            value={corFundo}
            onChange={(e) => setCorFundo(e.target.value)}
            style={{ width: '100%', height: 32 }}
          />
        </div>
      )}

      <button onClick={exportar} disabled={exportando}>
        {exportando ? 'Exportando...' : 'Exportar'}
      </button>

      {erro && <p style={{ color: '#c0392b', fontSize: 13 }}>{erro}</p>}

      {resultado && (
        <div style={{ fontSize: 13 }}>
          <p>Exportado com sucesso.</p>
          <a href={resultado.arquivo} target="_blank" rel="noreferrer">
            Abrir / baixar arquivo
          </a>
        </div>
      )}
    </div>
  );
}
