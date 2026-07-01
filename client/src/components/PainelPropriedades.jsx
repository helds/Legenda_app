// client/src/components/PainelPropriedades.jsx
import React, { useState, useEffect, useMemo } from 'react';

const OPCOES_MODO_REVELACAO = [
  { valor: 'palavra', rotulo: 'Palavra inteira' },
  { valor: 'letra', rotulo: 'Letra a letra' },
  { valor: 'silaba', rotulo: 'Sílaba a sílaba' },
];

function encontrarEstiloMaisProximo(estilosDisponiveis, pesoAlvo, italicoAlvo) {
  if (estilosDisponiveis.length === 0) return { peso: 400, italico: false };
  const mesmoItalico = estilosDisponiveis.filter((e) => e.italico === italicoAlvo);
  const candidatos = mesmoItalico.length > 0 ? mesmoItalico : estilosDisponiveis;

  return candidatos.reduce((maisProximo, atual) => {
    const distAtual = Math.abs(atual.peso - pesoAlvo);
    const distMaisProximo = Math.abs(maisProximo.peso - pesoAlvo);
    return distAtual < distMaisProximo ? atual : maisProximo;
  });
}

async function registrarFonteNoServidor({ arquivo, familia, peso, italico }) {
  if (!arquivo) return null;
  try {
    const resp = await fetch('/api/fontes/registrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caminhoOrigem: arquivo, familia, peso, italico }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.url;
  } catch {
    return null;
  }
}

export function PainelPropriedades({ estilo = {}, aoMudar, titulo, aoLimparOverride }) {
  const [familiasDisponiveis, setFamiliasDisponiveis] = useState([]);
  const [carregandoFontes, setCarregandoFontes] = useState(true);
  const [erroFontes, setErroFontes] = useState(null);
  const [registrandoFonte, setRegistrandoFonte] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function carregarFontes() {
      setCarregandoFontes(true);
      setErroFontes(null);
      try {
        if (!window.api?.listarFontes) {
          throw new Error('API de fontes indisponível (fora do Electron?)');
        }
        const fontes = await window.api.listarFontes();
        if (!cancelado) {
          setFamiliasDisponiveis(fontes.length > 0 ? fontes : [FONTE_FALLBACK]);
        }
      } catch (e) {
        if (!cancelado) {
          setErroFontes(e.message);
          setFamiliasDisponiveis([FONTE_FALLBACK]);
        }
      } finally {
        if (!cancelado) setCarregandoFontes(false);
      }
    }
    carregarFontes();
    return () => { cancelado = true; };
  }, []);

  function atualizar(campo, valor) {
    aoMudar({ [campo]: valor });
  }

  async function aplicarEstiloDeFonte(familia, estiloEscolhido) {
    aoMudar({ fonte: familia, pesoFonte: estiloEscolhido.peso, italico: estiloEscolhido.italico });
    setRegistrandoFonte(true);
    const url = await registrarFonteNoServidor({
      arquivo: estiloEscolhido.arquivo, familia, peso: estiloEscolhido.peso, italico: estiloEscolhido.italico,
    });
    setRegistrandoFonte(false);
    if (url) aoMudar({ fonteUrl: url });
  }

  function aoTrocarFonte(novaFamilia) {
    const familia = familiasDisponiveis.find((f) => f.familia === novaFamilia);
    const estilosDaNovaFamilia = familia ? familia.estilos : [];
    const estiloEscolhido = encontrarEstiloMaisProximo(estilosDaNovaFamilia, estilo.pesoFonte ?? 400, estilo.italico ?? false);
    aplicarEstiloDeFonte(novaFamilia, estiloEscolhido);
  }

  // VALORES PADRÕES RIGOROSOS DO DESIGN SYSTEM V1.0
  const pesoFonte = estilo.pesoFonte ?? 400;                     // Regular base da Roboto Flex
  const italico = estilo.italico ?? false;                       // Sem itálico por padrão
  const posicaoX = estilo.posicaoX ?? 0.50;                      // Centro horizontal absoluto
  const posicaoY = estilo.posicaoY ?? 0.80;                      // 80% (Topo da Safe Zone de 20%)
  const corBase = estilo.corBase ?? '#FFFFFF';                   // Padrão Read-Ahead: Branco Puro
  const opacidadeAntesDoDestaque = estilo.opacidadeAntesDoDestaque ?? 0.90; // Read-Ahead: 90%
  const corDestaque = estilo.corDestaque ?? '#FFCC00';           // Main Character (Amarelo)
  const duracaoTransicaoMs = estilo.duracaoTransicaoMs ?? 120;   // Resposta do Pop
  const tamanhoBase = estilo.tamanhoBase ?? 42;
  const modoRevelacaoAtual = estilo.modoRevelacao || 'silaba';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{titulo}</h3>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Efeito de revelação
        </label>
        <select
          value={modoRevelacaoAtual}
          onChange={(e) => atualizar('modoRevelacao', e.target.value)}
          style={{ width: '100%' }}
        >
          {OPCOES_MODO_REVELACAO.map((opcao) => (
            <option key={opcao.valor} value={opcao.valor}>
              {opcao.rotulo}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Fonte {carregandoFontes && '(carregando fontes...)'} {registrandoFonte && '(sincronizando...)'}
        </label>
        <select
          value={estilo.fonte}
          onChange={(e) => aoTrocarFonte(e.target.value)}
          disabled={carregandoFontes}
          style={{ width: '100%', fontFamily: estilo.fonte }}
        >
          {familiasDisponiveis.map((f) => (
            <option key={f.familia} value={f.familia} style={{ fontFamily: f.familia }}>{f.familia}</option>
          ))}
        </select>
      </div>

{/* CONTROLE FORÇADO DE ESPESSURA E ESTILO (INCLUI VARIÁVEIS) */}
      <div style={{ border: '1px solid #ddd', padding: '12px', borderRadius: '8px', backgroundColor: '#fafafa', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 'bold', color: '#555', margin: 0 }}>
          ESPESSURA E ESTILO DA FONTE
        </label>
        
        <select
          value={`${estilo.pesoFonte ?? 400}_${estilo.italico || false}`}
          onChange={(e) => {
            const [peso, italicoStr] = e.target.value.split('_');
            // Atualiza os dois valores (peso e itálico) simultaneamente na base de dados/estado
            aoMudar({ 
              pesoFonte: Number(peso), 
              italico: italicoStr === 'true' 
            });
          }}
          style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer' }}
        >
          {/* Opções Regulares */}
          <option value="100_false">Thin (100)</option>
          <option value="200_false">Extra Light (200)</option>
          <option value="300_false">Light (300)</option>
          <option value="400_false">Regular / Normal (400)</option>
          <option value="500_false">Medium (500)</option>
          <option value="600_false">Semi Bold (600)</option>
          <option value="700_false">Bold (700)</option>
          <option value="800_false">Extra Bold (800)</option>
          <option value="900_false">Black (900)</option>

          <option value="100_true">Thin Italic (100)</option>
          <option value="200_true">Extra Light Italic (200)</option>
          <option value="300_true">Light Italic (300)</option>
          <option value="400_true">Regular Italic (400)</option>
          <option value="500_true">Medium Italic (500)</option>     
          <option value="600_true">Semi Bold Italic (600)</option>
          <option value="700_true">Bold Italic (700)</option>
          <option value="800_true">Extra Bold Italic (800)</option>
          <option value="900_true">Black Italic (900)</option>
        </select>
      </div>

      <div style={{ marginTop: 4, marginBottom: 4, padding: '10px', border: '1px solid #10a37f', borderRadius: '6px', backgroundColor: '#f2fcf8' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#10a37f', fontWeight: 'bold' }}>
          <input
            type="checkbox" 
            checked={estilo.estiloSoNoDestaque ?? false} 
            onChange={(e) => atualizar('estiloSoNoDestaque', e.target.checked)}
          />
          Alterar estilo APENAS no destaque
        </label>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Tamanho base: {estilo.tamanhoBase}px
        </label>
        <input type="range" min="16" max="120" step="1" value={estilo.tamanhoBase} onChange={(e) => atualizar('tamanhoBase', Number(e.target.value))} style={{ width: '100%' }} />
      </div>

{/* NOVO: POSIÇÃO DA LEGENDA NO ECRÃ */}
      <div style={{ border: '1px solid #ddd', padding: '12px', borderRadius: '8px', backgroundColor: '#fafafa', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', color: '#555', margin: 0 }}>
            POSIÇÃO DA LEGENDA
          </label>
          <button 
            onClick={(e) => {
              e.preventDefault();
              atualizar('posicaoX', 0.5); 
            }}
            style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', borderRadius: '4px', border: '1px solid #bbb', backgroundColor: '#fff', color: '#333' }}
          >
            Posicionar ao Centro
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>Horizontal (X)</label>
            <input 
              type="range" min="0" max="1" step="0.01" 
              value={estilo.posicaoX ?? 0.5} 
              onChange={(e) => atualizar('posicaoX', Number(e.target.value))} 
              style={{ width: '100%' }} 
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>Vertical (Y)</label>
            <input 
              type="range" min="0" max="1" step="0.01" 
              value={estilo.posicaoY ?? 0.85} 
              onChange={(e) => atualizar('posicaoY', Number(e.target.value))} 
              style={{ width: '100%' }} 
            />
          </div>
        </div>
      </div>

      {/* BLOCO DO FUNDO DA LEGENDA */}
      <div style={{ border: '1px solid #ddd', padding: '12px', borderRadius: '8px', backgroundColor: '#fafafa', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 'bold', color: '#555', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={estilo.comFundo ?? false}
            onChange={(e) => atualizar('comFundo', e.target.checked)}
          />
          ATIVAR FUNDO DA LEGENDA (BOX)
        </label>
        
        {estilo.comFundo && (
          <>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>Cor do fundo</label>
              <input type="color" value={estilo.corFundo ?? '#000000'} onChange={(e) => atualizar('corFundo', e.target.value)} style={{ width: '100%', height: 32, padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Opacidade do fundo: {Math.round((estilo.opacidadeFundo ?? 0.6) * 100)}%
              </label>
              <input type="range" min="0" max="1" step="0.05" value={estilo.opacidadeFundo ?? 0.6} onChange={(e) => atualizar('opacidadeFundo', Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Espaçamento (Padding): {estilo.paddingFundo ?? 10}px
              </label>
              <input type="range" min="0" max="40" step="1" value={estilo.paddingFundo ?? 10} onChange={(e) => atualizar('paddingFundo', Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
                Arredondamento: {estilo.borderRadiusFundo ?? 6}px
              </label>
              <input type="range" min="0" max="30" step="1" value={estilo.borderRadiusFundo ?? 6} onChange={(e) => atualizar('borderRadiusFundo', Number(e.target.value))} style={{ width: '100%' }} />
            </div>
          </>
        )}
      </div>

      {/* BLOCO DE PULO */}
      <div style={{ border: '1px solid #ddd', padding: '12px', borderRadius: '8px', backgroundColor: '#fafafa', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold', color: '#555' }}>
          EFEITO DE PULO (HIGHLIGHT)
        </label>
        <div>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
            Escala do pulo: {Math.round(((estilo.escalaPulo ?? estilo.escalaDestaque ?? 1.3) - 1) * 100)}%
          </label>
          <input type="range" min="1" max="2" step="0.05" value={estilo.escalaPulo ?? estilo.escalaDestaque ?? 1.3} onChange={(e) => { atualizar('escalaPulo', Number(e.target.value)); atualizar('escalaDestaque', Number(e.target.value)); }} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
            Elevação do pulo: {Math.round((estilo.elevacaoPulo ?? 0.25) * 100)}% da altura
          </label>
          <input type="range" min="0" max="1" step="0.05" value={estilo.elevacaoPulo ?? 0.25} onChange={(e) => atualizar('elevacaoPulo', Number(e.target.value))} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
            Opacidade fora do destaque: {Math.round((estilo.opacidadeAntesDoDestaque ?? 0.8) * 100)}%
          </label>
          <input type="range" min="0.1" max="1" step="0.05" value={estilo.opacidadeAntesDoDestaque ?? 0.8} onChange={(e) => atualizar('opacidadeAntesDoDestaque', Number(e.target.value))} style={{ width: '100%' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>Cor base</label>
          <input type="color" value={estilo.corBase} onChange={(e) => atualizar('corBase', e.target.value)} style={{ width: '100%', height: 32 }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>Cor destaque</label>
          <input type="color" value={estilo.corDestaque} onChange={(e) => atualizar('corDestaque', e.target.value)} style={{ width: '100%', height: 32 }} />
        </div>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Velocidade da transição: {estilo.duracaoTransicaoMs}ms
        </label>
        <input type="range" min="20" max="400" step="10" value={estilo.duracaoTransicaoMs} onChange={(e) => atualizar('duracaoTransicaoMs', Number(e.target.value))} style={{ width: '100%' }} />
      </div>

      {aoLimparOverride && (
        <button onClick={aoLimparOverride}>Restaurar para o padrão</button>
      )}
    </div>
  );
}