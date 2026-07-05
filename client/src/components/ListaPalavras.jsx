// client/src/components/ListaPalavras.jsx
import React from 'react';

export function ListaPalavras({ blocos, palavraSelecionadaId, idsSelecionados, aoSelecionarPalavra }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4,overflowY: 'auto' }}>
      {blocos.map((bloco) => (
        <div key={bloco.id} className="word-block">
          <div className="word-block__time">
            {bloco.inicio.toFixed(2)}s — {bloco.fim.toFixed(2)}s
          </div>
          <div className="word-row">
            {bloco.palavras.map((palavra) => {
              const selecionada = palavra.id === palavraSelecionadaId;
              const emGrupo = idsSelecionados?.includes(palavra.id);
              const temOverride = !!palavra.estilo;

              const classes = ['word-chip'];
              if (temOverride) classes.push('has-override');
              if (selecionada) classes.push('is-selected');
              else if (emGrupo) classes.push('is-grouped');

              return (
                <button
                  key={palavra.id}
                  onClick={(e) => aoSelecionarPalavra(palavra.id, e.ctrlKey)}
                  className={classes.join(' ')}
                  title={temOverride ? 'Tem estilo customizado' : 'Usando estilo padrão'}
                >
                  {palavra.texto}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
