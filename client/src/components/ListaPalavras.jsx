// client/src/components/ListaPalavras.jsx
import React from 'react';

export function ListaPalavras({ blocos, palavraSelecionadaId, idsSelecionados, aoSelecionarPalavra }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
      {blocos.map((bloco) => (
        <div key={bloco.id} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>
            {bloco.inicio.toFixed(2)}s — {bloco.fim.toFixed(2)}s
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {bloco.palavras.map((palavra) => {
              const selecionada = palavra.id === palavraSelecionadaId;
              const emGrupo = idsSelecionados?.includes(palavra.id);
              const temOverride = !!palavra.estilo;

              return (
                <button
                  key={palavra.id}
                  onClick={(e) => aoSelecionarPalavra(palavra.id, e.shiftKey)}
                  style={{
                    padding: '4px 8px',
                    fontSize: 13,
                    border: selecionada ? '2px solid #EF9F27' : emGrupo ? '2px solid #378ADD' : '1px solid #ccc',
                    borderRadius: 6,
                    background: temOverride ? '#fff7ed' : '#fff',
                    cursor: 'pointer',
                  }}
                  title={temOverride ? 'Tem estilo customizado' : 'Usando estilo padrão'}
                >
                  {palavra.texto}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
