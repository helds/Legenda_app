// client/src/components/PainelPropriedades.jsx
import React, { useState, useEffect } from 'react';

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

// Usado quando o escaneamento de fontes do sistema falha ou não
// encontra nenhuma família (ex: fora do Electron, ou erro de leitura de
// disco) — garante que o seletor de fonte sempre tenha ao menos uma
// opção válida em vez de ficar vazio ou referenciar uma variável
// inexistente.
const FONTE_FALLBACK = {
  familia: 'sans-serif',
  estilos: [{ peso: 400, italico: false, nomeEstilo: 'Regular', arquivo: null }],
};

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

  const modoRevelacaoAtual = estilo.modoRevelacao || 'silaba';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 className="panel-title panel-title--accent" style={{ fontSize: 14 }}>{titulo}</h3>

      <div className="panel" style={{ gap: 14 }}>
        <div className="field">
          <label className="field-label">Efeito de revelação</label>
          <select
            className="select"
            value={modoRevelacaoAtual}
            onChange={(e) => atualizar('modoRevelacao', e.target.value)}
          >
            {OPCOES_MODO_REVELACAO.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label">
            Fonte
            {carregandoFontes && <span className="field-label__value"> · carregando…</span>}
            {registrandoFonte && <span className="field-label__value"> · sincronizando…</span>}
          </label>
          <select
            className="select"
            value={estilo.fonte}
            onChange={(e) => aoTrocarFonte(e.target.value)}
            disabled={carregandoFontes}
            style={{ fontFamily: estilo.fonte }}
          >
            {familiasDisponiveis.map((f) => (
              <option key={f.familia} value={f.familia} style={{ fontFamily: f.familia }}>{f.familia}</option>
            ))}
          </select>
          {erroFontes && <p className="status-line status-line--error" style={{ margin: 0 }}>{erroFontes}</p>}
        </div>
      </div>

      <div className="panel" style={{ gap: 12 }}>
        <label className="panel-title" style={{ fontSize: 11.5 }}>Espessura e estilo</label>
        <select
          className="select"
          value={`${estilo.pesoFonte ?? 400}_${estilo.italico || false}`}
          onChange={(e) => {
            const [peso, italicoStr] = e.target.value.split('_');
            aoMudar({ pesoFonte: Number(peso), italico: italicoStr === 'true' });
          }}
        >
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

        <label className="checkbox-row" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={estilo.estiloSoNoDestaque ?? false}
            onChange={(e) => atualizar('estiloSoNoDestaque', e.target.checked)}
          />
          Alterar estilo apenas no destaque
        </label>
      </div>

      <div className="field">
        <label className="field-label">
          Tamanho base <span className="field-label__value">{estilo.tamanhoBase}px</span>
        </label>
        <input type="range" min="16" max="120" step="1" value={estilo.tamanhoBase} onChange={(e) => atualizar('tamanhoBase', Number(e.target.value))} />
      </div>

      <div className="panel" style={{ gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label className="panel-title" style={{ fontSize: 11.5 }}>Posição da legenda</label>
          <button
            className="btn btn--ghost"
            style={{ padding: '4px 10px', fontSize: 11.5 }}
            onClick={(e) => { e.preventDefault(); atualizar('posicaoX', 0.5); }}
          >
            Centralizar
          </button>
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <div className="field" style={{ flex: 1 }}>
            <label className="field-label">Horizontal</label>
            <input type="range" min="0" max="1" step="0.01" value={estilo.posicaoX ?? 0.5} onChange={(e) => atualizar('posicaoX', Number(e.target.value))} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="field-label">Vertical</label>
            <input type="range" min="0" max="1" step="0.01" value={estilo.posicaoY ?? 0.85} onChange={(e) => atualizar('posicaoY', Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ gap: 14 }}>
        <label className="checkbox-row" style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 11.5, letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
          <input
            type="checkbox"
            checked={estilo.comFundo ?? false}
            onChange={(e) => atualizar('comFundo', e.target.checked)}
          />
          Ativar fundo da legenda
        </label>

        {estilo.comFundo && (
          <>
            <div className="field">
              <label className="field-label">Cor do fundo</label>
              <input type="color" value={estilo.corFundo ?? '#000000'} onChange={(e) => atualizar('corFundo', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">
                Opacidade <span className="field-label__value">{Math.round((estilo.opacidadeFundo ?? 0.6) * 100)}%</span>
              </label>
              <input type="range" min="0" max="1" step="0.05" value={estilo.opacidadeFundo ?? 0.6} onChange={(e) => atualizar('opacidadeFundo', Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="field-label">
                Espaçamento <span className="field-label__value">{estilo.paddingFundo ?? 10}px</span>
              </label>
              <input type="range" min="0" max="40" step="1" value={estilo.paddingFundo ?? 10} onChange={(e) => atualizar('paddingFundo', Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="field-label">
                Arredondamento <span className="field-label__value">{estilo.borderRadiusFundo ?? 6}px</span>
              </label>
              <input type="range" min="0" max="30" step="1" value={estilo.borderRadiusFundo ?? 6} onChange={(e) => atualizar('borderRadiusFundo', Number(e.target.value))} />
            </div>
          </>
        )}
      </div>

      <div className="panel" style={{ gap: 14 }}>
        <label className="panel-title" style={{ fontSize: 11.5 }}>Efeito de pulo (highlight)</label>
        <div className="field">
          <label className="field-label">
            Escala do pulo <span className="field-label__value">{Math.round(((estilo.escalaPulo ?? estilo.escalaDestaque ?? 1.3) - 1) * 100)}%</span>
          </label>
          <input type="range" min="1" max="2" step="0.05" value={estilo.escalaPulo ?? estilo.escalaDestaque ?? 1.3} onChange={(e) => { atualizar('escalaPulo', Number(e.target.value)); atualizar('escalaDestaque', Number(e.target.value)); }} />
        </div>
        <div className="field">
          <label className="field-label">
            Elevação do pulo <span className="field-label__value">{Math.round((estilo.elevacaoPulo ?? 0.25) * 100)}%</span>
          </label>
          <input type="range" min="0" max="1" step="0.05" value={estilo.elevacaoPulo ?? 0.25} onChange={(e) => atualizar('elevacaoPulo', Number(e.target.value))} />
        </div>
        <div className="field">
          <label className="field-label">
            Opacidade fora do destaque <span className="field-label__value">{Math.round((estilo.opacidadeAntesDoDestaque ?? 0.8) * 100)}%</span>
          </label>
          <input type="range" min="0.1" max="1" step="0.05" value={estilo.opacidadeAntesDoDestaque ?? 0.8} onChange={(e) => atualizar('opacidadeAntesDoDestaque', Number(e.target.value))} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">Cor base</label>
          <input type="color" value={estilo.corBase} onChange={(e) => atualizar('corBase', e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">Cor destaque</label>
          <input type="color" value={estilo.corDestaque} onChange={(e) => atualizar('corDestaque', e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label className="field-label">
          Velocidade da transição <span className="field-label__value">{estilo.duracaoTransicaoMs}ms</span>
        </label>
        <input type="range" min="20" max="400" step="10" value={estilo.duracaoTransicaoMs} onChange={(e) => atualizar('duracaoTransicaoMs', Number(e.target.value))} />
      </div>

      {aoLimparOverride && (
        <button className="btn btn--ghost btn--block" onClick={aoLimparOverride}>
          Restaurar para o padrão
        </button>
      )}
    </div>
  );
}
