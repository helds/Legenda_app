// client/src/remotion/CaptionComposition.jsx
import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Video, useCurrentFrame, useVideoConfig, interpolate, Easing, delayRender, continueRender, cancelRender } from 'remotion';
import { loadFont as carregarFonteCustomizada } from '@remotion/fonts';
import { separarSilabas } from '../../../shared/silabizador';

// Função auxiliar para converter Hexadecimal + Opacidade em RGBA para o fundo do box
function obterCorFundoRgba(hex, opacidade) {
  if (!hex) return 'transparent';
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacidade})`;
}

function resolverEstilo(estiloPadrao, overrideIndividual) {
  if (!overrideIndividual) return estiloPadrao;
  return { ...estiloPadrao, ...overrideIndividual };
}

// Guia de margens seguras — camada de referência visual (não impressa)
// que ajuda a posicionar legendas dentro de uma área segura do quadro.
// Todas as porcentagens de `guiaMargens` são relativas à ALTURA do
// vídeo, inclusive a margem lateral (`margemLateral`) — decisão
// deliberada pra manter a proporção da guia estável independente do
// aspect ratio do projeto, em vez de usar % de largura pra margens
// horizontais.
//
// IMPORTANTE (segurança contra vazar pro export): este componente só é
// chamado quando `modoPreview` é true, e `modoPreview` só é passado pelo
// <Player> do editor em App.jsx. O pipeline de renderização final
// (@remotion/renderer, ver server/index.js) nunca passa essa prop, então
// mesmo com `guiaMargens.ativo` salvo como true no projeto, a guia nunca
// aparece no vídeo exportado — ela depende de DUAS condições, não só do
// estado salvo no projeto.
//
// Empilhamento vertical, DE BAIXO PRA CIMA (colado na borda inferior do
// vídeo, subindo em direção ao centro):
//   1. espacamentoBordaInferior — encostado na borda inferior (roxo)
//   2. alturaFala1              — logo acima da margem (VAZADO)
//   3. distanciaEntreLinhas     — gap entre as duas falas (roxo)
//   4. alturaFala2              — a mais próxima do centro (VAZADO, só se ativarFala2)
//
// X = soma dos quatro valores acima (a altura TOTAL da área de
// trabalho, em %). Cada margem lateral tem largura igual a 2×X — ou
// seja, se a área de trabalho ocupa 20% da altura do vídeo, cada
// lateral (esquerda e direita) ocupa 40% da altura do vídeo, aplicado
// horizontalmente como largura.
function GuiaMargensSeguras({ guiaMargens }) {
  // 1. Extraímos também o 'width' para poder calcular o modo manual da margem lateral
  const { height, width } = useVideoConfig(); 

  if (!guiaMargens?.ativo) return null;

  const paraPx = (valorPercentual) => ((Number(valorPercentual) || 0) / 100) * height;

  const espacamentoBordaInferiorPx = paraPx(guiaMargens.espacamentoBordaInferior ?? 7.5);
  const alturaFala1Px = paraPx(guiaMargens.alturaFala1 ?? 5);
  const distanciaEntreLinhasPx = paraPx(guiaMargens.distanciaEntreLinhas ?? 2.5);
  const ativarFala2 = guiaMargens.ativarFala2 ?? true;
  const alturaFala2Px = ativarFala2 ? paraPx(guiaMargens.alturaFala2 ?? 5) : 0;

  const xPx = espacamentoBordaInferiorPx + alturaFala1Px + distanciaEntreLinhasPx + alturaFala2Px;
  
  // 2. Lógica corrigida do Slider:
  // Verifica se o usuário tirou do modo "auto" e puxou o slider manual (valor >= 0)
  const lateralEmModoManual = typeof guiaMargens.margemLateralPercentual === 'number' && guiaMargens.margemLateralPercentual >= 0;
  
  const margemLateralPx = lateralEmModoManual 
    ? (guiaMargens.margemLateralPercentual / 100) * width // Usa a % da LARGURA definida no slider manual
    : 2 * xPx; // Fallback para a Lógica Automática (2x Altura da área de trabalho)

  const corPreenchimentoRoxo = 'rgba(140, 40, 220, 0.55)';
  const corContorno = 'rgba(180, 60, 255, 0.9)';

  let acumuladoDesdeAbaixo = 0;
  const segmentoBordaInferior = { bottom: acumuladoDesdeAbaixo, altura: espacamentoBordaInferiorPx };
  acumuladoDesdeAbaixo += espacamentoBordaInferiorPx;
  const segmentoFala1 = { bottom: acumuladoDesdeAbaixo, altura: alturaFala1Px };
  acumuladoDesdeAbaixo += alturaFala1Px;
  const segmentoGap = { bottom: acumuladoDesdeAbaixo, altura: distanciaEntreLinhasPx };
  acumuladoDesdeAbaixo += distanciaEntreLinhasPx;
  const segmentoFala2 = { bottom: acumuladoDesdeAbaixo, altura: alturaFala2Px };

  const estiloFaixaRoxa = ({ bottom, altura }) => ({
    position: 'absolute',
    left: margemLateralPx,
    right: margemLateralPx,
    bottom,
    height: Math.max(0, altura),
    backgroundColor: corPreenchimentoRoxo,
    boxSizing: 'border-box',
  });

  const estiloFaixaVazada = ({ bottom, altura }) => ({
    position: 'absolute',
    left: margemLateralPx,
    right: margemLateralPx,
    bottom,
    height: Math.max(0, altura),
    border: `1px dashed ${corContorno}`,
    boxSizing: 'border-box',
  });

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {margemLateralPx > 0 && (
        <>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: margemLateralPx, backgroundColor: corPreenchimentoRoxo }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: margemLateralPx, backgroundColor: corPreenchimentoRoxo }} />
        </>
      )}

      {espacamentoBordaInferiorPx > 0 && <div style={estiloFaixaRoxa(segmentoBordaInferior)} />}
      {alturaFala1Px > 0 && <div style={estiloFaixaVazada(segmentoFala1)} />}
      {distanciaEntreLinhasPx > 0 && <div style={estiloFaixaRoxa(segmentoGap)} />}
      {ativarFala2 && alturaFala2Px > 0 && <div style={estiloFaixaVazada(segmentoFala2)} />}
    </div>
  );
}

// CORREÇÃO (bugfix preview sumindo): `texto` pode chegar undefined/null/
// não-string vindo de blocos gerados pela sincronização de áudio
// (WhisperX), caso alguma entrada do alignment não traga o campo `texto`
// preenchido corretamente. Antes, `[...texto]` com texto undefined lançava
// "TypeError: undefined is not iterable" DENTRO do render do Player — sem
// Error Boundary, isso derruba a árvore React inteira (por isso a própria
// div do preview sumia por completo, não só a legenda).
function dividirEmUnidades(texto, modoRevelacao) {
  const textoSeguro = typeof texto === 'string' ? texto : '';

  if (modoRevelacao === 'silaba') {
    return separarSilabas(textoSeguro).map((silaba) => [...(typeof silaba === 'string' ? silaba : '')]);
  }
  if (modoRevelacao === 'palavra') {
    return [[...textoSeguro]];
  }
  return [...textoSeguro].map((char) => [char]);
}

function Palavra({ palavra, estiloPadrao, tempoAtualSegundos }) {
  if (!palavra || typeof palavra.texto !== 'string') {
    return null;
  }

  const estilo = resolverEstilo(estiloPadrao, palavra.estilo);
  const { texto, inicio, fim } = palavra;

  const inicioSeguro = typeof inicio === 'number' ? inicio : 0;
  const fimSeguro = typeof fim === 'number' ? fim : inicioSeguro;

  const modoRevelacao = estilo.modoRevelacao || 'palavra';
  const unidades = dividirEmUnidades(texto, modoRevelacao);
  const totalUnidades = unidades.length || 1;

  const duracao = fimSeguro - inicioSeguro;

  // Tempo do "pulo" físico da letra
  const duracaoTransicaoMs = estilo.duracaoTransicaoMs ?? 120;
  const duracaoTransicaoSeg = duracaoTransicaoMs / 1000;
  
  // NOVO: Garantimos que o "fade" da cor demore no mínimo 250ms (0.25s) 
  // para ser visualmente mais suave, independente de quão rápido é o pulo.
  const duracaoFadeCorSeg = Math.max(duracaoTransicaoSeg, 0.25);

  const corBase = estilo.corBase ?? '#FFFFFF';
  const corDestaque = estilo.corDestaque ?? '#FFCC00';
  const opacidadeAntesDoDestaque = estilo.opacidadeAntesDoDestaque ?? 0.90;
  const tamanhoBase = estilo.tamanhoBase ?? 42;
  const pesoFonte = estilo.pesoFonte ?? 400;
  const italico = estilo.italico ?? false;
  const estiloSoNoDestaque = estilo.estiloSoNoDestaque ?? false;

  const escalaPulo = estilo.escalaPulo ?? estilo.escalaDestaque ?? 1.3;
  const elevacaoPulo = estilo.elevacaoPulo ?? 0.25;

  return (
    <span
      style={{
        display: 'inline-flex',
        flexWrap: 'nowrap',
        whiteSpace: 'pre',
        fontSize: `${tamanhoBase}px`,
        textTransform: estilo.caixaAlta ? 'uppercase' : 'none',
        letterSpacing: `${estilo.espacamentoLetras ?? 0}px`,
      }}
    >
      {unidades.map((unidadeChars, indexUnidade) => {
        const textoUnidade = (unidadeChars || []).join('');

        const tempoPorUnidade = duracao / totalUnidades;
        const inicioUnidade = inicioSeguro + indexUnidade * tempoPorUnidade;
        const fimUnidade = inicioUnidade + tempoPorUnidade;

        const estaDestacada = tempoAtualSegundos >= inicioUnidade && tempoAtualSegundos <= fimUnidade;
        const jaChegou = tempoAtualSegundos >= inicioUnidade;

        // 1. CÁLCULO DO PULO (Tamanho e Altura) - Continua rápido
        let progressaoPulo = 0;
        if (estaDestacada) {
          const tempoDecorrido = tempoAtualSegundos - inicioUnidade;
          if (tempoDecorrido < duracaoTransicaoSeg) {
            progressaoPulo = Math.sin((tempoDecorrido / duracaoTransicaoSeg) * Math.PI);
          }
        }

        const escalaAtual = 1 + (escalaPulo - 1) * progressaoPulo;
        const transladarY = - (tamanhoBase * elevacaoPulo) * progressaoPulo;

        // 2. CÁLCULO DA COR (Fade Suave) - Calculado perfeitamente frame a frame
        let progressoCor = 0;
        if (jaChegou) {
          const tempoDecorridoCor = tempoAtualSegundos - inicioUnidade;
          if (tempoDecorridoCor < duracaoFadeCorSeg) {
            // Curva ease-out matemática (desacelera no final da transição)
            const t = tempoDecorridoCor / duracaoFadeCorSeg;
            progressoCor = t * (2 - t); 
          } else {
            progressoCor = 1;
          }
        }

        const fonteAtual = (estiloSoNoDestaque && !jaChegou)
          ? (estiloPadrao.fonte || 'sans-serif')
          : (estilo.fonte || 'sans-serif');

        const pesoAtual = (estiloSoNoDestaque && !jaChegou)
          ? (estiloPadrao.pesoFonte ?? 400)
          : pesoFonte;

        const italicoAtual = (estiloSoNoDestaque && !jaChegou)
          ? ((estiloPadrao.italico ?? false) ? 'italic' : 'normal')
          : (italico ? 'italic' : 'normal');

        // MISTURA DE CORES: Interpola o laranja claro pro laranja forte
        const corAtual = jaChegou ? corDestaque : corBase;
    
        const opacidadeAtual = jaChegou ? 1.0 : opacidadeAntesDoDestaque;

        return (
          <span
            key={indexUnidade}
            style={{
              display: 'inline-block',
              fontFamily: fonteAtual,
              fontWeight: pesoAtual,
              fontStyle: italicoAtual,
              color: corAtual,
              opacity: opacidadeAtual,
              transform: `scale(${escalaAtual}) translateY(${transladarY}px)`,
              transformOrigin: 'center bottom',
            }}
          >
            {textoUnidade}
          </span>
        );
      })}
    </span>
  );
}

// COLETOR DE FONTES CUSTOMIZADAS
// CORREÇÃO: `projeto` pode chegar undefined no primeiro frame de render
// do Player, e `bloco`/`palavras` podem vir malformados dependendo da
// origem dos dados (import .srt vs. sincronização de áudio) — todos os
// acessos abaixo agora usam optional chaining para nunca lançar.
function coletarFontesUsadas(projeto) {
  const fontes = new Map();
  const padrao = projeto?.estiloPadrao || {};

  if (padrao.fonte && padrao.fonteUrl) {
    const chave = `${padrao.fonte}_${padrao.pesoFonte ?? 400}_${padrao.italico ? 'italic' : 'normal'}`;
    fontes.set(chave, { familia: padrao.fonte, url: padrao.fonteUrl, peso: padrao.pesoFonte ?? 400, italico: padrao.italico ?? false, chave });
  }

  if (Array.isArray(projeto?.blocos)) {
    for (const bloco of projeto.blocos) {
      if (Array.isArray(bloco?.palavras)) {
        for (const pal of bloco.palavras) {
          if (pal?.estilo?.fonte && pal?.estilo?.fonteUrl) {
            const f = pal.estilo;
            const chave = `${f.fonte}_${f.pesoFonte ?? 400}_${f.italico ? 'italic' : 'normal'}`;
            fontes.set(chave, { familia: f.fonte, url: f.fonteUrl, peso: f.pesoFonte ?? 400, italico: f.italico ?? false, chave });
          }
        }
      }
    }
  }
  return Array.from(fontes.values());
}

const fontesJaCarregadas = new Set();

function useCarregarFontesCustomizadas(fontes) {
  const chaveEstavel = JSON.stringify(fontes);
  useEffect(() => {
    const fontesParaCarregar = fontes.filter(f => !fontesJaCarregadas.has(f.chave));
    if (fontesParaCarregar.length === 0) return;

    const handle = delayRender('Carregando fontes customizadas das legendas');
    Promise.all(
      fontesParaCarregar.map(f =>
        carregarFonteCustomizada({
          family: f.familia, url: f.url, weight: String(f.peso), style: f.italico ? 'italic' : 'normal',
        }).then(() => { fontesJaCarregadas.add(f.chave); })
      )
    )
      .then(() => continueRender(handle))
      // CORREÇÃO: se o carregamento de uma fonte falhar (ex: fonteUrl
      // apontando para um arquivo que não existe mais, servidor local
      // fora do ar, ou 404), usar cancelRender(err) travava o render do
      // Remotion. No Player isso deixa a composição presa e a UI pode
      // parecer "sumida" mesmo sem exceção React. Preferimos logar o erro
      // e liberar o render assim mesmo — a fonte cai no fallback
      // (sans-serif) em vez de travar o preview inteiro.
      .catch((err) => {
        console.error('Falha ao carregar fonte customizada, seguindo com fallback:', err);
        continueRender(handle);
      });
  }, [chaveEstavel]);
}

export function CaptionComposition({ projeto, corFundo, videoPreviewSrc, guiaMargens, modoPreview = false }) {
  const [videoPreviewAspectRatio, setVideoPreviewAspectRatio] = useState(null);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tempoAtualSegundos = frame / fps;

  // CORREÇÃO: `projeto` pode ainda não ter chegado (primeiro frame do
  // Player, ou props temporariamente indefinidas). Sem isso, qualquer
  // acesso abaixo a projeto.blocos/projeto.estiloPadrao lançava e
  // derrubava a árvore React inteira.
  const projetoSeguro = projeto || { blocos: [], estiloPadrao: {} };

  const fontesUsadas = coletarFontesUsadas(projetoSeguro);
  useCarregarFontesCustomizadas(fontesUsadas);

  const blocos = Array.isArray(projetoSeguro.blocos) ? projetoSeguro.blocos : [];
  const blocoAtivo = blocos.find(
    (b) => b && typeof b.inicio === 'number' && typeof b.fim === 'number' &&
      tempoAtualSegundos >= b.inicio && tempoAtualSegundos <= b.fim
  );

  // UNIFICAÇÃO DOS DEFAULTS DE POSICIONAMENTO E BOX DO DESIGN SYSTEM
  const estiloPadrao = projetoSeguro.estiloPadrao || {};
  const posicaoX = estiloPadrao.posicaoX ?? 0.50;
  const posicaoY = estiloPadrao.posicaoY ?? 0.80; // Agora inicia perfeitamente em 80%

  const comFundo = estiloPadrao.comFundo ?? false;
  const corFundoBox = comFundo
    ? obterCorFundoRgba(estiloPadrao.corFundo ?? '#000000', estiloPadrao.opacidadeFundo ?? 0.6)
    : 'transparent';
  const paddingFundo = comFundo ? `${estiloPadrao.paddingFundo ?? 10}px` : '0px';
  const borderRadiusFundo = comFundo ? `${estiloPadrao.borderRadiusFundo ?? 6}px` : '0px';

  const palavrasDoBloco = Array.isArray(blocoAtivo?.palavras) ? blocoAtivo.palavras : [];

  const videoFrameStyle = (() => {
    if (!videoPreviewSrc || !videoPreviewAspectRatio) {
      return { position: 'absolute', inset: 0 };
    }

    const composicaoAspectRatio = 16 / 9;
    if (videoPreviewAspectRatio < composicaoAspectRatio) {
      return {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '50%',
        width: `${(videoPreviewAspectRatio / composicaoAspectRatio) * 100}%`,
        transform: 'translateX(-50%)',
      };
    }

    return {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '50%',
      height: `${(composicaoAspectRatio / videoPreviewAspectRatio) * 100}%`,
      transform: 'translateY(-50%)',
    };
  })();
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: videoPreviewSrc ? '#000000' : (corFundo || 'transparent'),
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {videoPreviewSrc && (
        <AbsoluteFill>
          <Video
            src={videoPreviewSrc}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (video.videoWidth && video.videoHeight) {
                setVideoPreviewAspectRatio(video.videoWidth / video.videoHeight);
              }
            }}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        </AbsoluteFill>
      )}

<div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {blocoAtivo && (
          // CORREÇÃO (largura máxima presa mesmo em 100%):
          // Antes, um único <div> tinha `width: 'fit-content'` +
          // `maxWidth: '<slider>%'` ao mesmo tempo. Com `width: fit-content`,
          // o navegador calcula a largura INTRÍNSECA do texto primeiro — se
          // essa largura já é menor que o teto do `maxWidth` (o que é comum
          // com blocos curtos de karaokê), o `maxWidth` nunca chega a ser
          // acionado, e o texto nunca quebra linha, não importa o valor do
          // slider. Por isso 100% "não fazia diferença": o texto raramente
          // era largo o bastante pra esbarrar no teto.
          //
          // A correção usa DOIS containers:
          // - `containerLargura` (externo): tem uma `width` REAL igual ao
          //   valor do slider (não `fit-content`). É esse elemento que
          //   define contra o que o texto deve quebrar linha — agora o
          //   slider sempre tem efeito, inclusive em 100%.
          // - `containerFundo` (interno): continua `width: fit-content`,
          //   então o retângulo colorido do fundo (`comFundo`) abraça
          //   apenas as linhas de texto realmente ocupadas, exatamente
          //   como antes — um texto curto não "estica" o fundo até 100%.
          <div
            style={{
              position: 'absolute',
              left: `${posicaoX * 100}%`,
              top: `${posicaoY * 100}%`,
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: `${estiloPadrao.larguraContainer ?? 45}%`,
              height: estiloPadrao.alturaContainer ? `${estiloPadrao.alturaContainer}%` : 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: `${estiloPadrao.espacamentoPalavras ?? 0.4}em`,
                justifyContent: 'center',
                width: 'fit-content',
                maxWidth: '100%',
                lineHeight: estiloPadrao.espacamentoLinhas ?? 1.2,
                paddingTop: `${estiloPadrao.margemCima ?? 0}px`,
                paddingBottom: `${estiloPadrao.margemBaixo ?? 0}px`,
                backgroundColor: corFundoBox,
                padding: paddingFundo,
                borderRadius: borderRadiusFundo,
                transition: 'background-color 0.15s ease'
              }}
            >
              {palavrasDoBloco.map((palavra, i) => (
                <Palavra
                  key={palavra?.id ?? i}
                  palavra={palavra}
                  estiloPadrao={estiloPadrao}
                  tempoAtualSegundos={tempoAtualSegundos}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {modoPreview && <GuiaMargensSeguras guiaMargens={guiaMargens} />}
    </div>
  );
}