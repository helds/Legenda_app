// client/src/components/PainelEditorSrt.jsx
import React, { useState, useEffect, useRef } from 'react';
// NOTA: shared/srtParser.js é CommonJS (module.exports = { parseSRT,
// secondsToTimecode, ... }). Uma tentativa anterior trocou isto para
// "import srtParser from '...'" (default import), mas nesse ambiente o
// Vite expõe APENAS os named exports deste arquivo para o navegador —
// não existe um "default" — então o default import falhava com
// "does not provide an export named 'default'". O named import direto
// abaixo é o padrão correto aqui, e é o mesmo já usado com sucesso em
// TelaTimeline.jsx para shared/projectModel.js.
import * as srtParser from '../../../shared/srtParser';

function blocosParaSrtTexto(blocos) {
  return (blocos || [])
    .map((bloco, i) => {
      const texto = (bloco.palavras || []).map((p) => p.texto).join(' ');
      return `${i + 1}\n${srtParser.secondsToTimecode(bloco.inicio)} --> ${srtParser.secondsToTimecode(bloco.fim)}\n${texto}\n`;
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
        const novosBlocos = srtParser.parseSRT(novoTexto);
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