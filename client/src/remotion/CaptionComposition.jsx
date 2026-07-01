// client/src/remotion/CaptionComposition.jsx
import React, { useEffect } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing, delayRender, continueRender, cancelRender } from 'remotion';
import { loadFont as carregarFonteCustomizada } from '@remotion/fonts';

// Resolve o estilo final de uma palavra: estilo padrão do projeto +
// override individual (se houver). Mesma lógica do shared/projectModel.js,
// duplicada aqui em formato de componente porque o Remotion roda em
// ambiente de browser isolado (sem acesso direto ao require do server).
function resolverEstilo(estiloPadrao, overrideIndividual) {
  if (!overrideIndividual) return estiloPadrao;
  return { ...estiloPadrao, ...overrideIndividual };
}

// Calcula quantas letras já devem estar "reveladas" (no estado ativo)
// dado o progresso de tempo dentro da palavra.
function calcularLetrasReveladas(progresso, totalLetras) {
  if (progresso <= 0) return 0;
  if (progresso >= 1) return totalLetras;
  return Math.floor(progresso * totalLetras);
}

// Uma única letra, com sua própria animação de escala/offset/cor baseada
// em estar revelada, em transição, ou ainda não alcançada.
function Letra({ char, estaRevelada, estaEmTransicao, progressoTransicao, estilo }) {
  const {
    corBase,
    corDestaque,
    tamanhoBase,
    escalaDestaque,
    offsetX,
    offsetY,
  } = estilo;

  let escala = 1;
  let dx = 0;
  let dy = 0;
  let cor = corBase;

  if (estaRevelada) {
    cor = corDestaque;
  }

  if (estaEmTransicao) {
    // Easing suave: sobe rápido, desce um pouco mais devagar — sensação
    // de "pulso" natural na letra sendo pronunciada.
    const subida = interpolate(progressoTransicao, [0, 0.4], [1, escalaDestaque], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    });
    const descida = interpolate(progressoTransicao, [0.4, 1], [escalaDestaque, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });
    escala = progressoTransicao < 0.4 ? subida : descida;

    const fatorDeslocamento = progressoTransicao < 0.4
      ? interpolate(progressoTransicao, [0, 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      : interpolate(progressoTransicao, [0.4, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

    dx = offsetX * fatorDeslocamento;
    dy = offsetY * fatorDeslocamento;
    cor = corDestaque;
  }

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: tamanhoBase,
        color: cor,
        transform: `translate(${dx}px, ${dy}px) scale(${escala})`,
        transformOrigin: 'center bottom',
        whiteSpace: 'pre',
      }}
    >
      {char}
    </span>
  );
}

// Renderiza uma palavra inteira, decompondo em letras e calculando o
// estado de revelação de cada uma com base no frame atual.
function Palavra({ palavra, estiloPadrao, tempoAtualSegundos }) {
  const estilo = resolverEstilo(estiloPadrao, palavra.estilo);
  const { texto, inicio, fim } = palavra;
  const totalLetras = texto.length;

  const duracao = fim - inicio;
  const progresso = duracao > 0
    ? Math.min(1, Math.max(0, (tempoAtualSegundos - inicio) / duracao))
    : 1;

  const letrasReveladas = calcularLetrasReveladas(progresso, totalLetras);

  // Janela de transição por letra: cada letra tem uma fatia de tempo
  // dentro da palavra para fazer sua própria animação de pulso.
  const duracaoTransicaoMs = estilo.duracaoTransicaoMs || 120;
  const duracaoTransicaoSeg = duracaoTransicaoMs / 1000;

  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: estilo.fonte,
        fontWeight: estilo.pesoFonte,
        fontStyle: estilo.italico ? 'italic' : 'normal',
      }}
    >
      {[...texto].map((char, idx) => {
        const tempoInicioLetra = inicio + (idx / totalLetras) * duracao;
        const tempoFimTransicao = tempoInicioLetra + duracaoTransicaoSeg;

        const estaRevelada = idx < letrasReveladas;
        const estaEmTransicao =
          tempoAtualSegundos >= tempoInicioLetra &&
          tempoAtualSegundos <= tempoFimTransicao;

        const progressoTransicao = estaEmTransicao
          ? Math.min(1, (tempoAtualSegundos - tempoInicioLetra) / duracaoTransicaoSeg)
          : 0;

        return (
          <Letra
            key={idx}
            char={char}
            estaRevelada={estaRevelada || estaEmTransicao}
            estaEmTransicao={estaEmTransicao}
            progressoTransicao={progressoTransicao}
            estilo={estilo}
          />
        );
      })}
    </span>
  );
}

// Percorre o estilo padrão + todos os overrides de palavras e coleta as
// combinações únicas de (fonteUrl, peso, itálico) que precisam ser
// carregadas via @remotion/fonts. Sem isso, uma palavra com override de
// fonte diferente do padrão do projeto renderizaria com fallback, mesmo
// que o arquivo correto já esteja registrado no servidor.
function coletarFontesUsadas(projeto) {
  const fontesMap = new Map();

  function registrar(estilo) {
    if (!estilo || !estilo.fonteUrl) return;
    const chave = `${estilo.fonteUrl}_${estilo.pesoFonte}_${!!estilo.italico}`;
    if (!fontesMap.has(chave)) {
      fontesMap.set(chave, {
        chave,
        url: estilo.fonteUrl,
        familia: estilo.fonte,
        peso: estilo.pesoFonte,
        italico: !!estilo.italico,
      });
    }
  }

  registrar(projeto.estiloPadrao);
  projeto.blocos.forEach((bloco) => {
    bloco.palavras.forEach((palavra) => {
      if (palavra.estilo) {
        // Overrides são parciais — mescla com o padrão só para ter
        // fonte/peso/itálico completos antes de registrar.
        registrar({ ...projeto.estiloPadrao, ...palavra.estilo });
      }
    });
  });

  return Array.from(fontesMap.values());
}

// Cache module-level (fora do componente) de quais fontes já foram
// carregadas com sucesso nesta sessão do processo — seja o processo do
// Studio/Player no navegador, seja o worker do Chromium headless
// durante renderMedia. Necessário porque CaptionComposition re-renderiza
// a cada frame; sem esse cache, tentaríamos chamar loadFont() (que já
// baixa o arquivo de fonte inteiro) centenas de vezes por segundo.
const fontesJaCarregadas = new Set();

// Dispara o carregamento de todas as fontes ainda não carregadas,
// usando delayRender/continueRender para garantir que o Remotion espere
// os arquivos reais chegarem antes de capturar qualquer frame — tanto
// no preview quanto, principalmente, na exportação final via
// @remotion/renderer, onde não há segunda chance de "recarregar a
// página" se a fonte perder a corrida contra o primeiro frame.
function useCarregarFontesCustomizadas(fontesUsadas) {
  // coletarFontesUsadas() monta um array NOVO a cada render de frame
  // (novas referências de objeto), mesmo quando o conjunto de fontes não
  // mudou. Usar esse array direto como dependência do useEffect faria o
  // efeito — e a tentativa de delayRender — disparar a cada frame.
  // Em vez disso, derivamos uma string estável a partir das chaves, que
  // só muda quando o CONJUNTO de fontes realmente muda.
  const chaveEstavel = fontesUsadas.map((f) => f.chave).sort().join('|');

  useEffect(() => {
    const pendentes = fontesUsadas.filter((f) => !fontesJaCarregadas.has(f.chave));
    if (pendentes.length === 0) return;

    const handle = delayRender(
      `Carregando ${pendentes.length} fonte(s) customizada(s)`
    );

    Promise.all(
      pendentes.map((f) =>
        carregarFonteCustomizada({
          family: f.familia,
          url: f.url,
          weight: String(f.peso),
          style: f.italico ? 'italic' : 'normal',
        }).then(() => {
          fontesJaCarregadas.add(f.chave);
        })
      )
    )
      .then(() => continueRender(handle))
      .catch((err) => cancelRender(err));

    // Sem cleanup de continueRender aqui de propósito: se o efeito for
    // desmontado antes da promise resolver, o handle já vai ter sido
    // consumido pelo continueRender/cancelRender acima; chamar de novo
    // geraria warning do Remotion sobre handle duplicado.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveEstavel]);
}

// Composição principal: recebe o projeto inteiro como prop (vindo do
// arquivo de projeto .json) e renderiza a legenda correspondente ao
// frame atual.
export function CaptionComposition({ projeto, corFundo }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tempoAtualSegundos = frame / fps;

  // Recoleta a cada render de frame (é uma operação barata, só
  // percorrer arrays já em memória) mas o carregamento de fato só
  // dispara para fontes ainda não cacheadas — ver fontesJaCarregadas.
  const fontesUsadas = coletarFontesUsadas(projeto);
  useCarregarFontesCustomizadas(fontesUsadas);

  const blocoAtivo = projeto.blocos.find(
    (b) => tempoAtualSegundos >= b.inicio && tempoAtualSegundos <= b.fim
  );

  // posicaoY: 0 = topo, 1 = base. Com alignItems:'flex-end', o item já
  // fica colado na base por padrão — paddingBottom precisa ser o
  // COMPLEMENTO de posicaoY (não o valor direto), senão o resultado fica
  // invertido (posicaoY alto empurraria o texto pra cima, não pra baixo).
  const posicaoY = projeto.estiloPadrao.posicaoY ?? 0.85;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: corFundo || 'transparent',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: `${(1 - posicaoY) * 100}%`,
      }}
    >
      {blocoAtivo && (
        <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', justifyContent: 'center' }}>
          {blocoAtivo.palavras.map((palavra) => (
            <Palavra
              key={palavra.id}
              palavra={palavra}
              estiloPadrao={projeto.estiloPadrao}
              tempoAtualSegundos={tempoAtualSegundos}
            />
          ))}
        </div>
      )}
    </div>
  );
}
