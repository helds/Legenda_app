// client/src/components/PainelMargens.jsx
//
// Painel de configuração da "guia de margens seguras" — uma camada de
// referência visual (não impressa/não exportada) que ajuda a posicionar
// as legendas dentro de uma área segura do quadro, longe das bordas.
//
// Segue o mesmo padrão de "ativar/desativar + mostrar campos extra" já
// usado pela seção "Ativar fundo da legenda" em PainelPropriedades.jsx.
//
// Fica FORA de PainelPropriedades de propósito: diferente do estilo de
// texto (fonte, cor, etc.), a guia de margens é uma configuração do
// projeto inteiro, não algo que faça sentido por palavra — colocá-la
// dentro de PainelPropriedades faria ela reaparecer (e tentar gravar
// dados) também no modo de edição por palavra/seleção.
//
// Todas as porcentagens abaixo são relativas à ALTURA do vídeo. O
// empilhamento é DE BAIXO PRA CIMA — a margem inferior fica colada na
// borda de baixo, depois a Fala 1, depois o gap, depois a Fala 2 (a mais
// próxima do centro do vídeo).
//
// Margem lateral: por padrão é AUTOMÁTICA (2×X, onde X é a soma dos
// quatro valores abaixo — a altura total da área de trabalho). Em
// vídeos verticais isso pode ultrapassar a largura real do vídeo (as
// duas laterais se encontram/sobrepõem), então também dá pra travar num
// valor MANUAL — % direta da LARGURA do vídeo, de 0% a 50% (50% = as
// duas metades se encontram exatamente no centro). O slider abaixo
// começa no modo automático (extremo esquerdo) e vira manual ao mover.

import React from 'react';

const PADRAO_GUIA_MARGENS = {
  ativo: false,
  espacamentoBordaInferior: 7.5,
  alturaFala1: 5,
  distanciaEntreLinhas: 2.5,
  ativarFala2: false,
  alturaFala2: 5,
  margemLateralPercentual: 'auto',
};

// Valor da posição do slider quando em modo automático — usado só como
// sentinela de UI (nunca é gravado no projeto; o que é gravado é a
// string 'auto').
const SENTINELA_AUTOMATICO = -1;

export function PainelMargens({ guiaMargens = {}, aoMudar }) {
  function atualizar(campo, valor) {
    aoMudar({ [campo]: valor });
  }

  const valores = { ...PADRAO_GUIA_MARGENS, ...guiaMargens };
  const x =
    valores.espacamentoBordaInferior +
    valores.alturaFala1 +
    valores.distanciaEntreLinhas +
    (valores.ativarFala2 ? valores.alturaFala2 : 0);

  const lateralEmModoManual =
    typeof valores.margemLateralPercentual === 'number' && valores.margemLateralPercentual >= 0;
  const valorSliderLateral = lateralEmModoManual ? valores.margemLateralPercentual : SENTINELA_AUTOMATICO;

  function aoMudarSliderLateral(valorBruto) {
    const v = Number(valorBruto);
    atualizar('margemLateralPercentual', v <= SENTINELA_AUTOMATICO ? 'auto' : v);
  }

  return (
    <div className="panel" style={{ gap: 14 }}>
      <label
        className="checkbox-row"
        style={{
          fontWeight: 600,
          textTransform: 'uppercase',
          fontSize: 11.5,
          letterSpacing: '0.04em',
          color: 'var(--text-secondary)',
        }}
      >
        <input
          type="checkbox"
          checked={valores.ativo}
          onChange={(e) => atualizar('ativo', e.target.checked)}
        />
        Guia de margens seguras
      </label>

      {valores.ativo && (
        <>

          <div className="field">
            <label className="field-label">
              Espaçamento da borda inferior <span className="field-label__value">{valores.espacamentoBordaInferior}%</span>
            </label>
            <input
              type="range" min="0" max="30" step="0.5"
              value={valores.espacamentoBordaInferior}
              onChange={(e) => atualizar('espacamentoBordaInferior', Number(e.target.value))}
            />
          </div>

          <div className="field">
            <label className="field-label">
              Tamanho da Fala 1 <span className="field-label__value">{valores.alturaFala1}%</span>
            </label>
            <input
              type="range" min="0" max="30" step="0.5"
              value={valores.alturaFala1}
              onChange={(e) => atualizar('alturaFala1', Number(e.target.value))}
            />
          </div>

          <div className="field">
            <label className="field-label">
              Distância entre linhas <span className="field-label__value">{valores.distanciaEntreLinhas}%</span>
            </label>
            <input
              type="range" min="0" max="20" step="0.5"
              value={valores.distanciaEntreLinhas}
              onChange={(e) => atualizar('distanciaEntreLinhas', Number(e.target.value))}
            />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={valores.ativarFala2}
              onChange={(e) => atualizar('ativarFala2', e.target.checked)}
            />
            Mostrar guia da Fala 2 (segunda linha)
          </label>

          {valores.ativarFala2 && (
            <div className="field">
              <label className="field-label">
                Tamanho da Fala 2 <span className="field-label__value">{valores.alturaFala2}%</span>
              </label>
              <input
                type="range" min="0" max="30" step="0.5"
                value={valores.alturaFala2}
                onChange={(e) => atualizar('alturaFala2', Number(e.target.value))}
              />
            </div>
          )}

          <div className="field">
            <label className="field-label">
              Margem lateral{' '}
              <span className="field-label__value">
                {lateralEmModoManual ? `${valorSliderLateral}% da largura (manual)` : `Automática (2X = ${(2 * x).toFixed(1)}%)`}
              </span>
            </label>
            <input
              type="range"
              min={SENTINELA_AUTOMATICO}
              max="50"
              step="1"
              value={valorSliderLateral}
              onChange={(e) => aoMudarSliderLateral(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  );
}