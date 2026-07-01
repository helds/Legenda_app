// client/src/components/PainelPropriedades.jsx
import React, { useEffect, useState } from 'react';

// Lista de fallback usada quando não é possível obter as fontes do
// sistema operacional (ex: rodando no navegador em modo dev, sem o
// Electron, ou se a API nativa falhar por qualquer motivo).
const FONTES_FALLBACK = ['Inter', 'Playfair Display', 'Lora', 'DM Sans', 'Roboto'];

const OPCOES_ESTILO_FONTE = [
  { valor: 'normal', label: 'Normal' },
  { valor: 'negrito', label: 'Negrito' },
  { valor: 'italico', label: 'Itálico' },
  { valor: 'negrito-italico', label: 'Negrito + Itálico' },
];

const OPCOES_MODO_REVELACAO = [
  { valor: 'palavra', label: 'Palavra inteira' },
  { valor: 'silaba', label: 'Sílaba por sílaba' },
  { valor: 'letra', label: 'Letra por letra' },
];

// Hook que busca a lista de fontes instaladas no sistema operacional via
// IPC do Electron (window.api.listarFontes, exposto pelo preload.js).
// Se a API não existir (rodando fora do Electron) ou a chamada falhar,
// cai de volta para a lista fixa FONTES_FALLBACK.
function useFontesDoSistema() {
  const [fontes, setFontes] = useState(FONTES_FALLBACK);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;

    async function carregar() {
      if (!window.api?.listarFontes) {
        setCarregando(false);
        return;
      }
      try {
        const listaSistema = await window.api.listarFontes();
        if (cancelado) return;
        if (Array.isArray(listaSistema) && listaSistema.length > 0) {
          // Garante que as fontes web-safe do fallback continuem
          // disponíveis mesmo que não estejam instaladas localmente
          // (importante para preview consistente entre máquinas).
          const combinadas = Array.from(new Set([...FONTES_FALLBACK, ...listaSistema])).sort(
            (a, b) => a.localeCompare(b, 'pt-BR')
          );
          setFontes(combinadas);
        }
      } catch (err) {
        console.error('Falha ao listar fontes do sistema:', err);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }

    carregar();
    return () => { cancelado = true; };
  }, []);

  return { fontes, carregando };
}

export function PainelPropriedades({ estilo, aoMudar, titulo, aoLimparOverride }) {
  const { fontes, carregando: carregandoFontes } = useFontesDoSistema();

  function atualizar(campo, valor) {
    aoMudar({ [campo]: valor });
  }

  function atualizarFundo(campo, valor) {
    aoMudar({ fundo: { ...estilo.fundo, [campo]: valor } });
  }

  const fundo = estilo.fundo || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{titulo}</h3>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Fonte {carregandoFontes && '(carregando fontes do sistema...)'}
        </label>
        <select
          value={estilo.fonte}
          onChange={(e) => atualizar('fonte', e.target.value)}
          style={{ width: '100%' }}
        >
          {fontes.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Estilo da fonte
        </label>
        <select
          value={estilo.estiloFonte}
          onChange={(e) => atualizar('estiloFonte', e.target.value)}
          style={{ width: '100%' }}
        >
          {OPCOES_ESTILO_FONTE.map((op) => (
            <option key={op.valor} value={op.valor}>{op.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Modo de revelação
        </label>
        <select
          value={estilo.modoRevelacao ?? 'palavra'}
          onChange={(e) => atualizar('modoRevelacao', e.target.value)}
          style={{ width: '100%' }}
        >
          {OPCOES_MODO_REVELACAO.map((op) => (
            <option key={op.valor} value={op.valor}>{op.label}</option>
          ))}
        </select>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#444' }}>
        <input
          type="checkbox"
          checked={!!estilo.estiloFonteSoNoDestaque}
          onChange={(e) => atualizar('estiloFonteSoNoDestaque', e.target.checked)}
        />
        Aplicar estilo da fonte só durante o destaque (palavra "falada")
      </label>

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

      {(estilo.modoRevelacao === 'palavra' || estilo.modoRevelacao === 'silaba') && (
        <>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
              Escala do pulo: {Math.round(((estilo.escalaPulo ?? 1.15) - 1) * 100)}%
            </label>
            <input
              type="range" min="1" max="1.6" step="0.01"
              value={estilo.escalaPulo ?? 1.15}
              onChange={(e) => atualizar('escalaPulo', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
              Elevação do pulo: {Math.round((estilo.elevacaoPulo ?? 0.25) * 100)}% da altura da fonte
            </label>
            <input
              type="range" min="0" max="1" step="0.01"
              value={estilo.elevacaoPulo ?? 0.25}
              onChange={(e) => atualizar('elevacaoPulo', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
              Opacidade antes do destaque: {Math.round((estilo.opacidadeAntesDoDestaque ?? 0.9) * 100)}%
            </label>
            <input
              type="range" min="0" max="1" step="0.05"
              value={estilo.opacidadeAntesDoDestaque ?? 0.9}
              onChange={(e) => atualizar('opacidadeAntesDoDestaque', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        </>
      )}

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

      <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '4px 0' }} />

      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={!!fundo.ativo}
            onChange={(e) => atualizarFundo('ativo', e.target.checked)}
          />
          Fundo da legenda
        </label>
      </div>

      {fundo.ativo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 4 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Cor do fundo
              </label>
              <input
                type="color"
                value={fundo.cor}
                onChange={(e) => atualizarFundo('cor', e.target.value)}
                style={{ width: '100%', height: 32 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Opacidade: {Math.round(fundo.opacidade * 100)}%
              </label>
              <input
                type="range" min="0" max="1" step="0.05"
                value={fundo.opacidade}
                onChange={(e) => atualizarFundo('opacidade', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Espaçamento X: {fundo.paddingX}px
              </label>
              <input
                type="range" min="0" max="80" step="1"
                value={fundo.paddingX}
                onChange={(e) => atualizarFundo('paddingX', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Espaçamento Y: {fundo.paddingY}px
              </label>
              <input
                type="range" min="0" max="80" step="1"
                value={fundo.paddingY}
                onChange={(e) => atualizarFundo('paddingY', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
              Raio da borda: {fundo.raioBorda}px
            </label>
            <input
              type="range" min="0" max="60" step="1"
              value={fundo.raioBorda}
              onChange={(e) => atualizarFundo('raioBorda', Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Deslocamento X: {fundo.offsetX}px
              </label>
              <input
                type="range" min="-100" max="100" step="1"
                value={fundo.offsetX}
                onChange={(e) => atualizarFundo('offsetX', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Deslocamento Y: {fundo.offsetY}px
              </label>
              <input
                type="range" min="-100" max="100" step="1"
                value={fundo.offsetY}
                onChange={(e) => atualizarFundo('offsetY', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>
      )}

      {aoLimparOverride && (
        <button onClick={aoLimparOverride}>
          Restaurar para o padrão do projeto
        </button>
      )}
    </div>
  );
}
