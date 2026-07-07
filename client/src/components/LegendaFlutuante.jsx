// client/src/components/LegendaFlutuante.jsx
//
// Versão "solta" da legenda usada na TelaTimeline: mesma lógica de
// silabização/cor/timing do CaptionComposition.jsx (Remotion), mas
// renderizada como HTML/CSS puro, sem <Video>, sem Player, sem
// composição do Remotion por trás. Existe porque, na Timeline, o
// objetivo é ajustar os tempos de início/fim de cada palavra — não
// visualizar o vídeo final — então mostrar a legenda "flutuando" sobre
// um fundo neutro, mas já com a animação/estilo reais, deixa claro qual
// palavra está ativa em cada instante sem a distração do preview de
// vídeo.
//
// Diferente do CaptionComposition (que usa useCurrentFrame do Remotion),
// aqui o tempo vem via prop simples `tempoAtualSegundos`, já que esta
// tela não roda dentro de uma composição Remotion.
import React from 'react';
import { separarSilabas } from '../../../shared/silabizador';

function resolverEstilo(estiloPadrao, overrideIndividual) {
  if (!overrideIndividual) return estiloPadrao;
  return { ...estiloPadrao, ...overrideIndividual };
}

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

function PalavraFlutuante({ palavra, estiloPadrao, tempoAtualSegundos, ativa }) {
  if (!palavra || typeof palavra.texto !== 'string') return null;

  const estilo = resolverEstilo(estiloPadrao, palavra.estilo);
  const { texto, inicio, fim } = palavra;

  const inicioSeguro = typeof inicio === 'number' ? inicio : 0;
  const fimSeguro = typeof fim === 'number' ? fim : inicioSeguro;

  const dentroDaJanelaAtiva = tempoAtualSegundos >= inicioSeguro && tempoAtualSegundos <= fimSeguro;

  const progressoAtivacao = Math.max(0, Math.min(1, (tempoAtualSegundos - inicioSeguro) / Math.max(0.001, fimSeguro - inicioSeguro)));

  const corTexto = progressoAtivacao > 0 ? estilo.corDestaque : estilo.corBase;
  const pesoFonte = estilo.pesoFonte ?? 400;
  const italico = estilo.italico ?? false;
  const modoRevelacao = estilo.modoRevelacao || 'palavra';
  const unidades = dividirEmUnidades(texto, modoRevelacao);
  const totalUnidades = unidades.length || 1;
  const duracao = fimSeguro - inicioSeguro;

  const duracaoTransicaoMs = estilo.duracaoTransicaoMs ?? 120;
  const duracaoTransicaoSeg = duracaoTransicaoMs / 1000;
  const corBase = estilo.corBase ?? '#FFFFFF';
  const corDestaque = estilo.corDestaque ?? '#FFCC00';
  const opacidadeAntesDoDestaque = estilo.opacidadeAntesDoDestaque ?? 0.9;
  const tamanhoBase = estilo.tamanhoBase ?? 42;

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
        fontWeight: estilo.estiloSoNoDestaque && !dentroDaJanelaAtiva
          ? (estiloPadrao.pesoFonte ?? 400)
          : pesoFonte,

        fontStyle: estilo.estiloSoNoDestaque && !dentroDaJanelaAtiva
          ? ((estiloPadrao.italico ?? false) ? 'italic' : 'normal')
          : (italico ? 'italic' : 'normal'),

        textTransform: estilo.caixaAlta ? 'uppercase' : 'none',
        letterSpacing: `${estilo.espacamentoLetras ?? 0}px`,
        transition: 'color 0.1s ease',
        outline: ativa ? '1px dashed rgba(239,159,39,0.4)' : 'none',
        outlineOffset: 4,
        borderRadius: 4,
      }}
    >
      {unidades.map((unidadeChars, indexUnidade) => {
        const textoUnidade = (unidadeChars || []).join('');
        const tempoPorUnidade = duracao / totalUnidades;
        const inicioUnidade = inicioSeguro + indexUnidade * tempoPorUnidade;
        const fimUnidade = inicioUnidade + tempoPorUnidade;

        let progressaoPulo = 0;
        if (tempoAtualSegundos >= inicioUnidade && tempoAtualSegundos <= fimUnidade) {
          const tempoDecorrido = tempoAtualSegundos - inicioUnidade;
          if (tempoDecorrido < duracaoTransicaoSeg) {
            progressaoPulo = Math.sin((tempoDecorrido / duracaoTransicaoSeg) * Math.PI);
          }
        }

        const escalaAtual = 1 + (escalaPulo - 1) * progressaoPulo;
        const transladarY = -(tamanhoBase * elevacaoPulo) * progressaoPulo;

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

export function LegendaFlutuante({
  projeto,
  tempoAtualSegundos = 0,
  palavraSelecionadaId,
  idsSelecionados,
  altura = 180,
}) {
  const estiloPadrao = projeto?.estiloPadrao || {};
  const blocos = Array.isArray(projeto?.blocos) ? projeto.blocos : [];

  const blocoAtivo = blocos.find(
    (b) =>
      b &&
      typeof b.inicio === 'number' &&
      typeof b.fim === 'number' &&
      tempoAtualSegundos >= b.inicio &&
      tempoAtualSegundos <= b.fim
  );

  const palavrasDoBloco = Array.isArray(blocoAtivo?.palavras) ? blocoAtivo.palavras : [];

  return (
    <div
      style={{
        height: altura,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse 60% 100% at 50% 50%, rgba(255,255,255,0.03), transparent)',
        borderBottom: '1px solid #2b2d34',
        padding: '0 24px',
        overflow: 'hidden',
      }}
    >
      {palavrasDoBloco.length === 0 ? (
        <p style={{ color: '#6b6d76', fontSize: 13, margin: 0 }}>
          Nenhuma legenda ativa neste instante.
        </p>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: `${estiloPadrao.espacamentoPalavras ?? 0.4}em`,
            justifyContent: 'center',
            alignItems: 'center',
            maxWidth: '100%',
            lineHeight: estiloPadrao.espacamentoLinhas ?? 1.2,
          }}
        >
          {palavrasDoBloco.map((palavra) => (
            <PalavraFlutuante
              key={palavra.id}
              palavra={palavra}
              estiloPadrao={estiloPadrao}
              tempoAtualSegundos={tempoAtualSegundos}
              ativa={palavra.id === palavraSelecionadaId || idsSelecionados?.includes(palavra.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
