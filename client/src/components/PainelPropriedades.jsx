// client/src/components/PainelPropriedades.jsx
import React, { useState, useEffect, useMemo } from 'react';

// Fallback usado apenas se a leitura das fontes do sistema falhar (por
// exemplo, rodando fora do Electron, direto no navegador em dev). Nesse
// caso a única fonte "garantida" existir é a que o navegador sempre
// resolve para uma sans-serif genérica — não fingimos ter Bold/Italic
// porque não temos como confirmar.
const FONTE_FALLBACK = {
  familia: 'sans-serif',
  estilos: [{ peso: 400, italico: false, nomeEstilo: 'Regular' }],
};

// Escolhe, dentro dos estilos disponíveis de uma família, o mais
// próximo do peso/itálico atualmente configurado. Evita que trocar de
// fonte deixe o painel com um peso que aquela família não possui (ex:
// vinha de "Roboto" peso 900 e foi para uma fonte que só tem 400/700).
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

// Registra no backend o arquivo de fonte real correspondente a um
// estilo específico (família+peso+itálico), copiando-o para dentro do
// projeto e retornando a URL pela qual a composição do Remotion vai
// carregá-lo via @remotion/fonts. Retorna null silenciosamente em caso
// de falha (ex: fonte "sans-serif" de fallback, que não tem arquivo real
// — ver FONTE_FALLBACK) para não travar a edição de estilo por causa
// disso; o pior caso é o texto cair no fallback genérico do navegador,
// não um erro bloqueante.
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

export function PainelPropriedades({ estilo, aoMudar, titulo, aoLimparOverride }) {
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

  // Estilos (peso/itálico) disponíveis para a família atualmente
  // selecionada no painel. Recalcula só quando a família ou a lista
  // de fontes mudam — não a cada render.
  const estilosDaFamiliaAtual = useMemo(() => {
    const familia = familiasDisponiveis.find((f) => f.familia === estilo.fonte);
    return familia ? familia.estilos : [];
  }, [familiasDisponiveis, estilo.fonte]);

  const italicoAtual = !!estilo.italico;

  function atualizar(campo, valor) {
    aoMudar({ [campo]: valor });
  }

  // Aplica um estilo (peso+itálico) de uma família, registrando o
  // arquivo real no servidor antes de gravar fonteUrl no projeto — sem
  // essa URL, a composição do Remotion não consegue montar o @font-face
  // e cai no fallback genérico tanto no preview quanto no vídeo final.
  async function aplicarEstiloDeFonte(familia, estiloEscolhido) {
    aoMudar({
      fonte: familia,
      pesoFonte: estiloEscolhido.peso,
      italico: estiloEscolhido.italico,
    });

    setRegistrandoFonte(true);
    const url = await registrarFonteNoServidor({
      arquivo: estiloEscolhido.arquivo,
      familia,
      peso: estiloEscolhido.peso,
      italico: estiloEscolhido.italico,
    });
    setRegistrandoFonte(false);

    // Segunda chamada a aoMudar só com a URL — evita atraso perceptível
    // no <select> por causa da requisição de rede (a UI já reflete a
    // troca de fonte imediatamente; fonteUrl chega logo em seguida).
    if (url) {
      aoMudar({ fonteUrl: url });
    }
  }

  function aoTrocarFonte(novaFamilia) {
    const familia = familiasDisponiveis.find((f) => f.familia === novaFamilia);
    const estilosDaNovaFamilia = familia ? familia.estilos : [];

    // Ajusta peso/itálico automaticamente para algo que a nova família
    // realmente possui, em vez de deixar configurado um estilo
    // inexistente (o que faria o navegador cair num fallback silencioso
    // e o preview não bater com o que a interface mostra).
    const estiloEscolhido = encontrarEstiloMaisProximo(
      estilosDaNovaFamilia,
      estilo.pesoFonte,
      italicoAtual
    );

    aplicarEstiloDeFonte(novaFamilia, estiloEscolhido);
  }

  function aoTrocarPeso(novoPeso) {
    const estiloEscolhido = estilosDaFamiliaAtual.find(
      (e) => e.peso === novoPeso && e.italico === italicoAtual
    );
    if (!estiloEscolhido) {
      // Não deveria acontecer (o <select> só lista pesos válidos), mas
      // por segurança evita mandar um registro de fonte incompleto.
      atualizar('pesoFonte', novoPeso);
      return;
    }
    aplicarEstiloDeFonte(estilo.fonte, estiloEscolhido);
  }

  function aoAlternarItalico(novoItalico) {
    // Se a família não tiver uma variante itálica para o peso atual,
    // caímos para o peso mais próximo que tenha itálico disponível.
    const estiloEscolhido = encontrarEstiloMaisProximo(
      estilosDaFamiliaAtual,
      estilo.pesoFonte,
      novoItalico
    );
    aplicarEstiloDeFonte(estilo.fonte, estiloEscolhido);
  }

  const pesosDisponiveis = useMemo(() => {
    const pesosParaItalicoAtual = estilosDaFamiliaAtual
      .filter((e) => e.italico === italicoAtual)
      .map((e) => e.peso);
    // Se não houver nenhum peso para o itálico atual (família sem
    // itálico), caímos para os pesos "normais" só para não deixar o
    // seletor vazio — a troca de itálico em si já cuida de resetar o
    // estado para algo consistente em aoAlternarItalico.
    const base = pesosParaItalicoAtual.length > 0
      ? pesosParaItalicoAtual
      : estilosDaFamiliaAtual.filter((e) => !e.italico).map((e) => e.peso);
    return [...new Set(base)].sort((a, b) => a - b);
  }, [estilosDaFamiliaAtual, italicoAtual]);

  const temVarianteItalica = estilosDaFamiliaAtual.some((e) => e.italico);

  const NOMES_PESO = {
    100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular',
    500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{titulo}</h3>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Fonte {carregandoFontes && '(carregando fontes do sistema...)'}
          {registrandoFonte && ' (sincronizando arquivo da fonte...)'}
        </label>
        <select
          value={estilo.fonte}
          onChange={(e) => aoTrocarFonte(e.target.value)}
          disabled={carregandoFontes}
          style={{ width: '100%', fontFamily: estilo.fonte }}
        >
          {familiasDisponiveis.map((f) => (
            <option key={f.familia} value={f.familia} style={{ fontFamily: f.familia }}>
              {f.familia}
            </option>
          ))}
        </select>
        {erroFontes && (
          <p style={{ fontSize: 11, color: '#c0392b', margin: '4px 0 0' }}>
            Não foi possível ler as fontes do sistema ({erroFontes}). Usando fonte padrão do navegador.
          </p>
        )}
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Espessura (peso da fonte)
        </label>
        <select
          value={estilo.pesoFonte}
          onChange={(e) => aoTrocarPeso(Number(e.target.value))}
          disabled={pesosDisponiveis.length === 0}
          style={{ width: '100%' }}
        >
          {pesosDisponiveis.length === 0 && (
            <option value={estilo.pesoFonte}>Nenhum estilo detectado</option>
          )}
          {pesosDisponiveis.map((peso) => (
            <option key={peso} value={peso}>
              {NOMES_PESO[peso] || peso} ({peso})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: temVarianteItalica ? '#333' : '#bbb' }}>
          <input
            type="checkbox"
            checked={italicoAtual}
            disabled={!temVarianteItalica}
            onChange={(e) => aoAlternarItalico(e.target.checked)}
          />
          Itálico {!temVarianteItalica && '(fonte não possui variante itálica instalada)'}
        </label>
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
