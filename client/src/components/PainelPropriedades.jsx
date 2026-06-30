// client/src/components/PainelPropriedades.jsx
import React from 'react';

const FONTES_DISPONIVEIS = ['Inter', 'Playfair Display', 'Lora', 'DM Sans', 'Roboto'];

export function PainelPropriedades({ estilo, aoMudar, titulo, aoLimparOverride }) {
  function atualizar(campo, valor) {
    aoMudar({ [campo]: valor });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{titulo}</h3>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Fonte
        </label>
        <select
          value={estilo.fonte}
          onChange={(e) => atualizar('fonte', e.target.value)}
          style={{ width: '100%' }}
        >
          {FONTES_DISPONIVEIS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Espessura (peso da fonte): {estilo.pesoFonte}
        </label>
        <input
          type="range" min="300" max="900" step="100"
          value={estilo.pesoFonte}
          onChange={(e) => atualizar('pesoFonte', Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Tamanho base: {estilo.tamanhoBase}px
        </label>
        <input
          type="range" min="16" max="120" step="1"
          value={estilo.tamanhoBase}
          onChange={(e) => atualizar('tamanhoBase', Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Escala no destaque: {estilo.escalaDestaque}x
        </label>
        <input
          type="range" min="1" max="2.5" step="0.05"
          value={estilo.escalaDestaque}
          onChange={(e) => atualizar('escalaDestaque', Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
            Offset X: {estilo.offsetX}px
          </label>
          <input
            type="range" min="-50" max="50" step="1"
            value={estilo.offsetX}
            onChange={(e) => atualizar('offsetX', Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
            Offset Y: {estilo.offsetY}px
          </label>
          <input
            type="range" min="-50" max="50" step="1"
            value={estilo.offsetY}
            onChange={(e) => atualizar('offsetY', Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
            Cor base
          </label>
          <input
            type="color"
            value={estilo.corBase}
            onChange={(e) => atualizar('corBase', e.target.value)}
            style={{ width: '100%', height: 32 }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
            Cor destaque
          </label>
          <input
            type="color"
            value={estilo.corDestaque}
            onChange={(e) => atualizar('corDestaque', e.target.value)}
            style={{ width: '100%', height: 32 }}
          />
        </div>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Velocidade da transição: {estilo.duracaoTransicaoMs}ms
        </label>
        <input
          type="range" min="20" max="400" step="10"
          value={estilo.duracaoTransicaoMs}
          onChange={(e) => atualizar('duracaoTransicaoMs', Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>

      {aoLimparOverride && (
        <button onClick={aoLimparOverride}>
          Restaurar para o padrão do projeto
        </button>
      )}
    </div>
  );
}
