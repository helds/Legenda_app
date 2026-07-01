// client/src/remotion/CaptionComposition.jsx
import React, { useEffect } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing, delayRender, continueRender, cancelRender } from 'remotion';
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

function dividirEmUnidades(texto, modoRevelacao) {
  if (modoRevelacao === 'silaba') {
    return separarSilabas(texto).map((silaba) => [...silaba]);
  }
  if (modoRevelacao === 'palavra') {
    return [[...texto]];
  }
  return [...texto].map((char) => [char]);
}

function Palavra({ palavra, estiloPadrao, tempoAtualSegundos }) {
  const estilo = resolverEstilo(estiloPadrao, palavra.estilo);
  const { texto, inicio, fim } = palavra;

  const modoRevelacao = estilo.modoRevelacao || 'palavra';
  const unidades = dividirEmUnidades(texto, modoRevelacao);
  const totalUnidades = unidades.length;

  const duracao = fim - inicio;
  
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
        fontWeight: estiloSoNoDestaque && tempoAtualSegundos < inicio ? (estiloPadrao.pesoFonte ?? 400) : pesoFonte,
        fontStyle: estiloSoNoDestaque && tempoAtualSegundos < inicio ? ((estiloPadrao.italico ?? false) ? 'italic' : 'normal') : (italico ? 'italic' : 'normal'),
      }}
    >
      {unidades.map((unidadeChars, indexUnidade) => {
        const textoUnidade = unidadeChars.join('');
        
        const tempoPorUnidade = duracao / totalUnidades;
        const inicioUnidade = inicio + indexUnidade * tempoPorUnidade;
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
function coletarFontesUsadas(projeto) {
  const fontes = new Map();
  const padrao = projeto.estiloPadrao || {};
  
  if (padrao.fonte && padrao.fonteUrl) {
    const chave = `${padrao.fonte}_${padrao.pesoFonte ?? 400}_${padrao.italico ? 'italic' : 'normal'}`;
    fontes.set(chave, { familia: padrao.fonte, url: padrao.fonteUrl, peso: padrao.pesoFonte ?? 400, italico: padrao.italico ?? false, chave });
  }

  if (projeto.blocos) {
    for (const bloco of projeto.blocos) {
      if (bloco.palavras) {
        for (const pal of bloco.palavras) {
          if (pal.estilo?.fonte && pal.estilo?.fonteUrl) {
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
      .catch((err) => cancelRender(err));
  }, [chaveEstavel]);
}

export function CaptionComposition({ projeto, corFundo }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tempoAtualSegundos = frame / fps;

  const fontesUsadas = coletarFontesUsadas(projeto);
  useCarregarFontesCustomizadas(fontesUsadas);

  const blocoAtivo = projeto.blocos.find(
    (b) => tempoAtualSegundos >= b.inicio && tempoAtualSegundos <= b.fim
  );

  // UNIFICAÇÃO DOS DEFAULTS DE POSICIONAMENTO E BOX DO DESIGN SYSTEM
  const estiloPadrao = projeto.estiloPadrao || {};
  const posicaoX = estiloPadrao.posicaoX ?? 0.50;
  const posicaoY = estiloPadrao.posicaoY ?? 0.80; // Agora inicia perfeitamente em 80%

  const comFundo = estiloPadrao.comFundo ?? false;
  const corFundoBox = comFundo 
    ? obterCorFundoRgba(estiloPadrao.corFundo ?? '#000000', estiloPadrao.opacidadeFundo ?? 0.6) 
    : 'transparent';
  const paddingFundo = comFundo ? `${estiloPadrao.paddingFundo ?? 10}px` : '0px';
  const borderRadiusFundo = comFundo ? `${estiloPadrao.borderRadiusFundo ?? 6}px` : '0px';

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
        <div 
          style={{ 
            display: 'flex', 
            gap: '0.4em', 
            flexWrap: 'wrap', 
            justifyContent: 'center',
            backgroundColor: corFundoBox,
            padding: paddingFundo,
            borderRadius: borderRadiusFundo,
            transition: 'background-color 0.15s ease'
          }}
        >
          {blocoAtivo.palavras.map((palavra, i) => (
            <Palavra
              key={i}
              palavra={palavra}
              estiloPadrao={estiloPadrao}
              tempoAtualSegundos={tempoAtualSegundos}
            />
          ))}
        </div>
      )}
    </div>
  );
}