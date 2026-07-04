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
  // CORREÇÃO: palavra malformada (sem texto válido) não deve quebrar o
  // resto do bloco — apenas essa palavra simplesmente não renderiza nada.
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

  // VALORES PADRÕES ALINHADOS COM O DESIGN SYSTEM V1.0
  const duracaoTransicaoMs = estilo.duracaoTransicaoMs ?? 120;
  const duracaoTransicaoSeg = duracaoTransicaoMs / 1000;
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
        fontFamily: estilo.fonte || 'sans-serif',
        // Se estiloSoNoDestaque estiver ativo, o estilo base ignora o peso/itálico customizado da palavra
        fontWeight: estiloSoNoDestaque && tempoAtualSegundos < inicioSeguro ? (estiloPadrao.pesoFonte ?? 400) : pesoFonte,
        fontStyle: estiloSoNoDestaque && tempoAtualSegundos < inicioSeguro ? ((estiloPadrao.italico ?? false) ? 'italic' : 'normal') : (italico ? 'italic' : 'normal'),
      }}
    >
      {unidades.map((unidadeChars, indexUnidade) => {
        const textoUnidade = (unidadeChars || []).join('');

        const tempoPorUnidade = duracao / totalUnidades;
        const inicioUnidade = inicioSeguro + indexUnidade * tempoPorUnidade;
        const fimUnidade = inicioUnidade + tempoPorUnidade;

        // Efeito Pop de Pulo e Escala usando Math.sin
        let progressaoPulo = 0;
        if (tempoAtualSegundos >= inicioUnidade && tempoAtualSegundos <= fimUnidade) {
          const tempoDecorrido = tempoAtualSegundos - inicioUnidade;
          if (tempoDecorrido < duracaoTransicaoSeg) {
            progressaoPulo = Math.sin((tempoDecorrido / duracaoTransicaoSeg) * Math.PI);
          }
        }

        const escalaAtual = 1 + (escalaPulo - 1) * progressaoPulo;
        const transladarY = - (tamanhoBase * elevacaoPulo) * progressaoPulo;

        // Interpolação da Cor e Opacidade Dinâmica (Read-Ahead Ativo)
        let corAtual = corBase;
        let opacidadeAtual = opacidadeAntesDoDestaque;

        if (tempoAtualSegundos >= inicioUnidade) {
          corAtual = corDestaque;
          opacidadeAtual = 1.0;
        }

        return (
          <span
            key={indexUnidade}
            style={{
              display: 'inline-block',
              color: corAtual,
              opacity: opacidadeAtual,
              transform: `scale(${escalaAtual}) translateY(${transladarY}px)`,
              transformOrigin: 'center bottom',
              transition: `color ${duracaoTransicaoMs}ms ease, opacity ${duracaoTransicaoMs}ms ease`,
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

export function CaptionComposition({ projeto, corFundo, videoPreviewSrc }) {
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

      <div style={{ ...videoFrameStyle, pointerEvents: 'none' }}>
        {blocoAtivo && (
          <div
            style={{
              position: 'absolute',
              left: `${posicaoX * 100}%`,
              top: `${posicaoY * 100}%`,
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              gap: '0.4em',
              flexWrap: 'wrap',
              justifyContent: 'center',
              maxWidth: '92%',
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
        )}
      </div>
    </div>
  );
}