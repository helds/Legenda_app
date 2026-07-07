// client/src/components/PainelEditorSrt.jsx
import React, { useState, useEffect, useRef } from 'react';
import { parseSRT, secondsToTimecode } from '../../../shared/srtParser';

function blocosParaSrtTexto(blocos) {
  return (blocos || [])
    .map((bloco, i) => {
      const texto = (bloco.palavras || []).map((p) => p.texto).join(' ');
      return `${i + 1}\n${secondsToTimecode(bloco.inicio)} --> ${secondsToTimecode(bloco.fim)}\n${texto}\n`;
    })
    .join('\n');
}

export function PainelEditorSrt({ projeto, projetoId, aoAtualizarProjeto }) {
  const [texto, setTexto] = useState(() => blocosParaSrtTexto(projeto.blocos));
  const debounceRef = useRef(null);
  const ultimaOrigemFoiEdicaoLocal = useRef(false);

  // Se o projeto mudar por outra via (ex: sincronização de áudio), atualiza o texto
  useEffect(() => {
    if (ultimaOrigemFoiEdicaoLocal.current) {
      ultimaOrigemFoiEdicaoLocal.current = false;
      return;
    }
    setTexto(blocosParaSrtTexto(projeto.blocos));
  }, [projeto.blocos]);

  function aoEditar(novoTexto) {
    setTexto(novoTexto);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        const novosBlocos = parseSRT(novoTexto);
        // preserva estilo/ids das palavras já existentes por posição, se quiser
        ultimaOrigemFoiEdicaoLocal.current = true;
        fetch(`/api/projetos/${projetoId}/blocos`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocos: novosBlocos }),
        })
          .then((r) => r.json())
          .then((data) => aoAtualizarProjeto(data.projeto));
      } catch (e) {
        console.error('SRT inválido:', e);
      }
    }, 500);
  }

  return (
    <div className="panel" style={{ height: '100%' }}>
      <h3 className="panel-title panel-title--accent">Editor de legenda (SRT)</h3>
      <textarea
        className="textarea"
        value={texto}
        onChange={(e) => aoEditar(e.target.value)}
        style={{ flex: 1, minHeight: 260, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
        spellCheck={false}
      />
    </div>
  );
}