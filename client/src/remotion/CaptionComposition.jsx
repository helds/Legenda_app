// client/src/remotion/CaptionComposition.jsx
import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

// --- Separação silábica (duplicada de shared/silabizador.js) ---
// O Remotion roda em ambiente de browser isolado (sem acesso direto ao
// require do server), então a lógica de separação silábica é duplicada
// aqui em vez de importada. Mantenha sincronizada com
// shared/silabizador.js caso uma seja alterada.
const VOGAIS_SIL = 'aeiouáéíóúàâêôãõü';
const DIGRAFOS_INSEPARAVEIS_SIL = ['lh', 'nh', 'ch'];
const ENCONTROS_INSEPARAVEIS_SIL = [
  'bl', 'br', 'cl', 'cr', 'dl', 'dr', 'fl', 'fr', 'gl', 'gr',
  'pl', 'pr', 'tl', 'tr', 'vl', 'vr',
];

function ehVogalSil(char) {
  return VOGAIS_SIL.includes((char || '').toLowerCase());
}

function ehSemivogalAtonaSil(char) {
  return ['i', 'u'].includes((char || '').toLowerCase());
}

function formaGrupoInseparavelSil(texto, i) {
  if (i + 1 >= texto.length) return false;
  const par = texto.substring(i, i + 2).toLowerCase();
  return DIGRAFOS_INSEPARAVEIS_SIL.includes(par) || ENCONTROS_INSEPARAVEIS_SIL.includes(par);
}

function formaDitongoSil(texto, i) {
  if (i + 1 >= texto.length) return false;
  const a = texto[i].toLowerCase();
  const b = texto[i + 1].toLowerCase();
  if (!ehVogalSil(a) || !ehVogalSil(b)) return false;
  if (ehSemivogalAtonaSil(a) || ehSemivogalAtonaSil(b)) return true;
  return false;
}

// Separa uma palavra em sílabas usando as regras fonéticas clássicas do
// português (núcleo vocálico + ditongos + dígrafos/encontros
// consonantais inseparáveis). Ver shared/silabizador.js para a versão
// comentada e usada pelo restante da aplicação (server/testes).
function separarSilabas(palavra) {
  if (!palavra || typeof palavra !== 'string') return [palavra];
  const texto = palavra;
  const n = texto.length;

  const nucleos = [];
  let i = 0;
  while (i < n) {
    if (ehVogalSil(texto[i])) {
      let fimN = i;
      while (fimN + 1 < n && formaDitongoSil(texto, fimN)) {
        fimN += 1;
      }
      nucleos.push([i, fimN]);
      i = fimN + 1;
    } else {
      i += 1;
    }
  }

  if (nucleos.length === 0) return [texto];

  const silabas = [];
  let inicioSilaba = 0;

  for (let idx = 0; idx < nucleos.length; idx++) {
    const [, fimNucleo] = nucleos[idx];
    const proximoNucleo = nucleos[idx + 1];

    if (!proximoNucleo) {
      silabas.push(texto.substring(inicioSilaba, n));
      break;
    }

    const [proximoInicio] = proximoNucleo;
    const consoantesEntre = proximoInicio - (fimNucleo + 1);

    let pontoDeCorte;
    if (consoantesEntre <= 0) {
      pontoDeCorte = fimNucleo + 1;
    } else if (consoantesEntre === 1) {
      pontoDeCorte = fimNucleo + 1;
    } else {
      const posGrupo = proximoInicio - 2;
      if (formaGrupoInseparavelSil(texto, posGrupo)) {
        pontoDeCorte = posGrupo;
      } else {
        pontoDeCorte = proximoInicio - 1;
      }
    }

    silabas.push(texto.substring(inicioSilaba, pontoDeCorte));
    inicioSilaba = pontoDeCorte;
  }

  return silabas.filter((s) => s.length > 0);
}

// Distribui o intervalo [inicio, fim] de uma palavra entre suas sílabas,
// proporcionalmente ao número de caracteres de cada uma.
function distribuirTempoPorSilabas(palavra) {
  const { texto, inicio, fim } = palavra;
  const silabas = separarSilabas(texto);
  const totalChars = texto.length;
  const duracao = fim - inicio;

  let acumulado = 0;
  return silabas.map((silaba) => {
    const inicioSilaba = inicio + (acumulado / totalChars) * duracao;
    acumulado += silaba.length;
    const fimSilaba = inicio + (acumulado / totalChars) * duracao;
    return { texto: silaba, inicio: inicioSilaba, fim: fimSilaba };
  });
}

// Resolve o estilo final de uma palavra: estilo padrão do projeto +
// override individual (se houver). Mesma lógica do shared/projectModel.js,
// duplicada aqui em formato de componente porque o Remotion roda em
// ambiente de browser isolado (sem acesso direto ao require do server).
function resolverEstiloComposicao(estiloPadrao, overrideIndividual) {
  if (!overrideIndividual) return estiloPadrao;
  const mesclado = { ...estiloPadrao, ...overrideIndividual };
  if (overrideIndividual.fundo) {
    mesclado.fundo = { ...estiloPadrao.fundo, ...overrideIndividual.fundo };
  }
  return mesclado;
}

// Converte o campo estiloFonte ('normal' | 'negrito' | 'italico' |
// 'negrito-italico') em font-weight/font-style CSS.
function resolverPropriedadesFonte(estiloFonte) {
  switch (estiloFonte) {
    case 'negrito':
      return { fontWeight: 700, fontStyle: 'normal' };
    case 'italico':
      return { fontWeight: 400, fontStyle: 'italic' };
    case 'negrito-italico':
      return { fontWeight: 700, fontStyle: 'italic' };
    case 'normal':
    default:
      return { fontWeight: 400, fontStyle: 'normal' };
  }
}

// Calcula quantas letras já devem estar "reveladas" (no estado ativo)
// dado o progresso de tempo dentro da palavra.
function calcularLetrasReveladas(progresso, totalLetras) {
  if (progresso <= 0) return 0;
  if (progresso >= 1) return totalLetras;
  return Math.floor(progresso * totalLetras);
}

// Calcula a escala e a elevação (translateY negativo) do efeito "pulo"
// para uma palavra inteira, com base no progresso da transição (0 a 1).
// Sobe rápido até a metade, depois desce de volta ao estado normal —
// mesma sensação de "pop" já usada na animação letra a letra.
function calcularPuloPalavra(progressoTransicao, escalaPulo, elevacaoPulo, tamanhoBase) {
  const subidaEscala = interpolate(progressoTransicao, [0, 0.4], [1, escalaPulo], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const descidaEscala = interpolate(progressoTransicao, [0.4, 1], [escalaPulo, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const escala = progressoTransicao < 0.4 ? subidaEscala : descidaEscala;

  const fatorElevacao = progressoTransicao < 0.4
    ? interpolate(progressoTransicao, [0, 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : interpolate(progressoTransicao, [0.4, 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // elevacaoPulo é uma fração da altura da fonte (ex: 0.25 = 25% do
  // tamanhoBase), não um valor fixo em px — assim o efeito escala junto
  // com o tamanho do texto.
  const dy = -(elevacaoPulo * tamanhoBase) * fatorElevacao;

  return { escala, dy };
}

// Renderiza uma palavra inteira como uma única unidade animada: a cor
// muda de corBase para corDestaque no instante em que a palavra começa
// a ser falada, e a palavra inteira sobe e aumenta de tamanho (efeito
// "pulo"), em vez de animar letra por letra. Antes de a palavra ser
// falada, ela é exibida em corBase com a opacidade de
// opacidadeAntesDoDestaque (efeito "read-ahead").
function PalavraComoUnidade({ palavra, estiloPadrao, tempoAtualSegundos }) {
  const estilo = resolverEstiloComposicao(estiloPadrao, palavra.estilo);
  const { texto, inicio, fim } = palavra;
  const {
    corBase,
    corDestaque,
    tamanhoBase,
    estiloFonte,
    estiloFonteSoNoDestaque,
    escalaPulo,
    elevacaoPulo,
    opacidadeAntesDoDestaque,
  } = estilo;

  const duracaoTransicaoMs = estilo.duracaoTransicaoMs || 120;
  const duracaoTransicaoSeg = duracaoTransicaoMs / 1000;
  const fimTransicao = inicio + duracaoTransicaoSeg;

  const jaComecou = tempoAtualSegundos >= inicio;
  const emTransicao = tempoAtualSegundos >= inicio && tempoAtualSegundos <= fimTransicao;

  const progressoTransicao = emTransicao
    ? Math.min(1, Math.max(0, (tempoAtualSegundos - inicio) / duracaoTransicaoSeg))
    : (jaComecou ? 1 : 0);

  const { escala, dy } = emTransicao
    ? calcularPuloPalavra(progressoTransicao, escalaPulo ?? 1.15, elevacaoPulo ?? 0.25, tamanhoBase)
    : { escala: 1, dy: 0 };

  const cor = jaComecou ? corDestaque : corBase;
  const opacidade = jaComecou ? 1 : (opacidadeAntesDoDestaque ?? 0.9);

  const destacada = jaComecou;
  const estiloFonteAplicado = estiloFonteSoNoDestaque
    ? (destacada ? estiloFonte : 'normal')
    : estiloFonte;
  const { fontWeight, fontStyle } = resolverPropriedadesFonte(estiloFonteAplicado);

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: tamanhoBase,
        fontFamily: estilo.fonte,
        fontWeight,
        fontStyle,
        color: cor,
        opacity: opacidade,
        transform: `translateY(${dy}px) scale(${escala})`,
        transformOrigin: 'center bottom',
        whiteSpace: 'pre',
      }}
    >
      {texto}
    </span>
  );
}

// Calcula as propriedades visuais (cor, opacidade, escala, elevação,
// peso/estilo de fonte) de uma sílaba em um dado instante de tempo.
// Mesmo comportamento de "pulo" usado em PalavraComoUnidade, mas
// aplicado à sílaba isoladamente em vez da palavra inteira. Cobre o
// caso descrito na seção 2.2.4 do design system ("Syllable Variation"):
// palavras faladas de forma silabada podem ser melhor comunicadas
// destacando uma sílaba de cada vez.
function calcularEstadoSilaba({ inicio, estilo, tempoAtualSegundos }) {
  const {
    corBase,
    corDestaque,
    tamanhoBase,
    estiloFonte,
    estiloFonteSoNoDestaque,
    escalaPulo,
    elevacaoPulo,
    opacidadeAntesDoDestaque,
  } = estilo;

  const duracaoTransicaoMs = estilo.duracaoTransicaoMs || 120;
  const duracaoTransicaoSeg = duracaoTransicaoMs / 1000;
  const fimTransicao = inicio + duracaoTransicaoSeg;

  const jaComecou = tempoAtualSegundos >= inicio;
  const emTransicao = tempoAtualSegundos >= inicio && tempoAtualSegundos <= fimTransicao;

  const progressoTransicao = emTransicao
    ? Math.min(1, Math.max(0, (tempoAtualSegundos - inicio) / duracaoTransicaoSeg))
    : (jaComecou ? 1 : 0);

  const { escala, dy } = emTransicao
    ? calcularPuloPalavra(progressoTransicao, escalaPulo ?? 1.15, elevacaoPulo ?? 0.25, tamanhoBase)
    : { escala: 1, dy: 0 };

  const cor = jaComecou ? corDestaque : corBase;
  const opacidade = jaComecou ? 1 : (opacidadeAntesDoDestaque ?? 0.9);

  const estiloFonteAplicado = estiloFonteSoNoDestaque
    ? (jaComecou ? estiloFonte : 'normal')
    : estiloFonte;
  const { fontWeight, fontStyle } = resolverPropriedadesFonte(estiloFonteAplicado);

  return { cor, opacidade, escala, dy, fontWeight, fontStyle };
}

// Renderiza uma palavra dividida em sílabas (separação automática via
// separarSilabas), animando cada sílaba como uma unidade independente —
// cor muda e a sílaba "pula" no instante em que começa a ser
// pronunciada, com o tempo da palavra distribuído proporcionalmente
// entre as sílabas conforme o número de caracteres de cada uma.
function PalavraPorSilabas({ palavra, estiloPadrao, tempoAtualSegundos }) {
  const estilo = resolverEstiloComposicao(estiloPadrao, palavra.estilo);
  const { tamanhoBase } = estilo;
  const silabasComTempo = distribuirTempoPorSilabas(palavra);

  return (
    <span style={{ display: 'inline-block', fontFamily: estilo.fonte }}>
      {silabasComTempo.map((silaba, idx) => {
        const { cor, opacidade, escala, dy, fontWeight, fontStyle } = calcularEstadoSilaba({
          inicio: silaba.inicio,
          estilo,
          tempoAtualSegundos,
        });

        return (
          <span
            key={idx}
            style={{
              display: 'inline-block',
              fontSize: tamanhoBase,
              fontWeight,
              fontStyle,
              color: cor,
              opacity: opacidade,
              transform: `translateY(${dy}px) scale(${escala})`,
              transformOrigin: 'center bottom',
              whiteSpace: 'pre',
            }}
          >
            {silaba.texto}
          </span>
        );
      })}
    </span>
  );
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
    estiloFonte,
    estiloFonteSoNoDestaque,
  } = estilo;

  let escala = 1;
  let dx = 0;
  let dy = 0;
  let cor = corBase;

  // Quando "só no destaque" está ativo, a letra usa estilo de fonte
  // 'normal' fora do destaque e o estiloFonte configurado só durante a
  // revelação/transição. Caso contrário, o estilo de fonte é fixo.
  const destacada = estaRevelada || estaEmTransicao;
  const estiloFonteAplicado = estiloFonteSoNoDestaque
    ? (destacada ? estiloFonte : 'normal')
    : estiloFonte;
  const { fontWeight, fontStyle } = resolverPropriedadesFonte(estiloFonteAplicado);

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
        fontWeight,
        fontStyle,
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
  const estilo = resolverEstiloComposicao(estiloPadrao, palavra.estilo);
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
    <span style={{ display: 'inline-block', fontFamily: estilo.fonte }}>
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

// Caixa de fundo atrás do bloco de legenda. Renderizada como um elemento
// próprio por trás do texto (não usa box-shadow/background no container
// de texto porque precisamos de padding e offset independentes).
function FundoLegenda({ fundo }) {
  if (!fundo || !fundo.ativo) return null;

  const corRgba = hexParaRgba(fundo.cor, fundo.opacidade);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transform: `translate(${fundo.offsetX || 0}px, ${fundo.offsetY || 0}px)`,
        backgroundColor: corRgba,
        borderRadius: fundo.raioBorda || 0,
      }}
    />
  );
}

// Converte uma cor hex (#RRGGBB) + opacidade (0-1) para rgba(). Aceita
// também formatos de 3 dígitos (#RGB).
function hexParaRgba(hex, opacidade) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  const a = Math.min(1, Math.max(0, opacidade ?? 1));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Composição principal: recebe o projeto inteiro como prop (vindo do
// arquivo de projeto .json) e renderiza a legenda correspondente ao
// frame atual.
export function CaptionComposition({ projeto, corFundo }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tempoAtualSegundos = frame / fps;

  const blocoAtivo = projeto.blocos.find(
    (b) => tempoAtualSegundos >= b.inicio && tempoAtualSegundos <= b.fim
  );

  // posicaoY: 0 = topo, 1 = base. Com alignItems:'flex-end', o item já
  // fica colado na base por padrão — paddingBottom precisa ser o
  // COMPLEMENTO de posicaoY (não o valor direto), senão o resultado fica
  // invertido (posicaoY alto empurraria o texto pra cima, não pra baixo).
  const posicaoY = projeto.estiloPadrao.posicaoY ?? 0.85;
  const fundoLegenda = projeto.estiloPadrao.fundo;

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
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <FundoLegenda fundo={fundoLegenda} />
          <div
            style={{
              position: 'relative',
              display: 'flex',
              gap: '0.4em',
              flexWrap: 'wrap',
              justifyContent: 'center',
              padding: fundoLegenda?.ativo
                ? `${fundoLegenda.paddingY}px ${fundoLegenda.paddingX}px`
                : 0,
            }}
          >
            {blocoAtivo.palavras.map((palavra) => {
              const modoRevelacao = projeto.estiloPadrao.modoRevelacao || 'palavra';
              if (modoRevelacao === 'palavra') {
                return (
                  <PalavraComoUnidade
                    key={palavra.id}
                    palavra={palavra}
                    estiloPadrao={projeto.estiloPadrao}
                    tempoAtualSegundos={tempoAtualSegundos}
                  />
                );
              }
              if (modoRevelacao === 'silaba') {
                return (
                  <PalavraPorSilabas
                    key={palavra.id}
                    palavra={palavra}
                    estiloPadrao={projeto.estiloPadrao}
                    tempoAtualSegundos={tempoAtualSegundos}
                  />
                );
              }
              return (
                <Palavra
                  key={palavra.id}
                  palavra={palavra}
                  estiloPadrao={projeto.estiloPadrao}
                  tempoAtualSegundos={tempoAtualSegundos}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
