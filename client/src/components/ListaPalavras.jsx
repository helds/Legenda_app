import React, { useState, useRef } from 'react';

export function ListaPalavras({ 
  blocos, 
  palavraSelecionadaId, 
  idsSelecionados, 
  aoSelecionarPalavra, 
  aoLimparSelecao,
  aoMoverPalavraEntreBlocos,
  aoAlterarTempoBloco
}) {
  const [idArrastado, setIdArrastado] = useState(null);
  const [zonaAtiva, setZonaAtiva] = useState(null);
  
  // Estados para edição de tempo
  const [blocoEditandoId, setBlocoEditandoId] = useState(null);
  const [inputInicio, setInputInicio] = useState('');
  const [inputFim, setInputFim] = useState('');

  const timerRef = useRef(null);
  const dragOverRef = useRef(null);

  // --- FUNÇÕES DE ARRASTAR E SOLTAR ---
  function handleDragStart(e, palavraId) {
    setIdArrastado(palavraId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnter(e, blocoId, index) {
    e.preventDefault();
    const zonaId = `${blocoId}-${index}`;

    if (dragOverRef.current === zonaId) return;
    dragOverRef.current = zonaId;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setZonaAtiva(zonaId);
    }, 500); // 0.5s para revelar a linha indicadora
  }

  function handleDragLeave(e, blocoId, index) {
    const zonaId = `${blocoId}-${index}`;
    if (dragOverRef.current === zonaId) {
      dragOverRef.current = null;
      clearTimeout(timerRef.current);
      setZonaAtiva(null);
    }
  }

  function handleDrop(e, blocoId, index) {
    e.preventDefault();
    clearTimeout(timerRef.current);
    setZonaAtiva(null);
    dragOverRef.current = null;

    if (idArrastado && aoMoverPalavraEntreBlocos) {
      aoMoverPalavraEntreBlocos(idArrastado, blocoId, index);
    }
    setIdArrastado(null);
  }

  // --- FUNÇÕES DE EDIÇÃO DE TEMPO ---
  function iniciarEdicaoTempo(bloco) {
    setBlocoEditandoId(bloco.id);
    setInputInicio(bloco.inicio.toFixed(2));
    setInputFim(bloco.fim.toFixed(2));
  }

  function salvarEdicaoTempo(blocoId) {
    if (aoAlterarTempoBloco) {
      aoAlterarTempoBloco(blocoId, parseFloat(inputInicio), parseFloat(inputFim));
    }
    setBlocoEditandoId(null);
  }

  return (
    <div
      onClick={() => aoLimparSelecao?.()}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}
    >
      {blocos.map((bloco) => (
        <div key={bloco.id} className="word-block">
          
          {/* CABEÇALHO DO BLOCO: EXIBIÇÃO OU EDIÇÃO DO TEMPO */}
          <div className="word-block__time">
            {blocoEditandoId === bloco.id ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: '#333', padding: '2px 8px', borderRadius: '4px' }}>
                <input 
                  type="number" 
                  step="0.01" 
                  value={inputInicio} 
                  onChange={(e) => setInputInicio(e.target.value)} 
                  style={{ width: '60px', fontSize: '12px', padding: '2px' }}
                  onClick={(e) => e.stopPropagation()}
                />
                <span style={{ color: '#aaa' }}>s —</span>
                <input 
                  type="number" 
                  step="0.01" 
                  value={inputFim} 
                  onChange={(e) => setInputFim(e.target.value)} 
                  style={{ width: '60px', fontSize: '12px', padding: '2px' }}
                  onClick={(e) => e.stopPropagation()}
                />
                <span style={{ color: '#aaa' }}>s</span>
                
                <button 
                  onClick={(e) => { e.stopPropagation(); salvarEdicaoTempo(bloco.id); }}
                  style={{ marginLeft: '8px', cursor: 'pointer', padding: '2px 6px', fontSize: '12px', background: 'var(--accent-amber)', border: 'none', borderRadius: '3px', color: '#000' }}
                >
                  Ok
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); setBlocoEditandoId(null); }}
                  style={{ cursor: 'pointer', padding: '2px 6px', fontSize: '12px', background: '#555', border: 'none', borderRadius: '3px', color: '#fff' }}
                >
                  X
                </button>
              </div>
            ) : (
              <span 
                onDoubleClick={(e) => { e.stopPropagation(); iniciarEdicaoTempo(bloco); }} 
                style={{ cursor: 'text' }} 
                title="Dê um duplo clique para editar os tempos"
              >
                {bloco.inicio.toFixed(2)}s — {bloco.fim.toFixed(2)}s
              </span>
            )}
          </div>

          {/* LINHA DAS PALAVRAS */}
          <div className="word-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
            
            {/* Espaço de soltura no Início do bloco */}
            <DropZone
              ativo={zonaAtiva === `${bloco.id}-0`}
              onDragEnter={(e) => handleDragEnter(e, bloco.id, 0)}
              onDragLeave={(e) => handleDragLeave(e, bloco.id, 0)}
              onDrop={(e) => handleDrop(e, bloco.id, 0)}
            />

            {bloco.palavras.map((palavra, index) => {
              const selecionada = palavra.id === palavraSelecionadaId;
              const emGrupo = idsSelecionados?.includes(palavra.id);
              const temOverride = !!palavra.estilo;

              const classes = ['word-chip'];
              if (temOverride) classes.push('has-override');
              if (selecionada) classes.push('is-selected');
              else if (emGrupo) classes.push('is-grouped');

              return (
                <React.Fragment key={palavra.id}>
                  <button
                    draggable
                    onDragStart={(e) => handleDragStart(e, palavra.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      aoSelecionarPalavra(palavra.id, e.ctrlKey);
                    }}
                    className={classes.join(' ')}
                    title={temOverride ? 'Tem estilo customizado' : 'Usando estilo padrão'}
                    style={{ cursor: 'grab', margin: 0 }}
                  >
                    {palavra.texto}
                  </button>

                  {/* Espaço de soltura à direita de cada palavra */}
                  <DropZone
                    ativo={zonaAtiva === `${bloco.id}-${index + 1}`}
                    onDragEnter={(e) => handleDragEnter(e, bloco.id, index + 1)}
                    onDragLeave={(e) => handleDragLeave(e, bloco.id, index + 1)}
                    onDrop={(e) => handleDrop(e, bloco.id, index + 1)}
                  />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Subcomponente: Linha indicadora sutil para arrastar e soltar
function DropZone({ ativo, onDragEnter, onDragLeave, onDrop }) {
  return (
    <div
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{
        height: '24px',
        width: '10px',
        margin: '0 -3px',
        backgroundColor: ativo ? '#f59e0b' : 'transparent', // Linha âmbar apenas quando o mouse pausa em cima
        borderRadius: '2px',
        transition: 'background-color 0.2s',
        zIndex: 10
      }}
    />
  );
}