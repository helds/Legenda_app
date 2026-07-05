// client/src/components/PainelSincronizacaoAudio.jsx
import React, { useState, useRef } from 'react';

export function PainelSincronizacaoAudio({
  caminhoAudio,
  textoInicial,
  urlEndpointSincronizacao = '/api/audio/sincronizar',
  projetoId,
  aoConcluir,
}) {
  const [texto, setTexto] = useState(textoInicial || '');
  const [idioma, setIdioma] = useState('pt');
  const [status, setStatus] = useState('ocioso');
  const [mensagemErro, setMensagemErro] = useState(null);
  
  // NOVOS ESTADOS: Controlo da Barra de Progresso
  const [progresso, setProgresso] = useState(0);
  const intervalRef = useRef(null);

  async function iniciarSincronizacao() {
    if (!caminhoAudio) {
      setMensagemErro('Nenhum arquivo de áudio/vídeo associado a este projeto ainda.');
      setStatus('erro');
      return;
    }
    if (!texto.trim()) {
      setMensagemErro('Cole ou confirme o texto já transcrito antes de sincronizar.');
      setStatus('erro');
      return;
    }

    setStatus('processando');
    setMensagemErro(null);
    setProgresso(0);

    // Lógica da Barra de Progresso Inteligente (Simulada para UX)
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setProgresso((p) => {
        // Avança rápido no início, depois abranda e segura nos 95% até o backend terminar
        if (p < 50) return p + 3;
        if (p < 80) return p + 1.5;
        if (p < 95) return p + 0.3;
        return p; 
      });
    }, 500);

    try {
      const resposta = await fetch(urlEndpointSincronizacao, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projetoId, caminhoAudio, texto, idioma }),
      });

      clearInterval(intervalRef.current);

      if (!resposta.ok) {
        const corpoErro = await resposta.text();
        throw new Error(corpoErro || `Erro HTTP ${resposta.status}`);
      }

      const dados = await resposta.json();
      
      // Quando termina, forçamos os 100%
      setProgresso(100);
      setStatus('concluido');
      
      // Pequeno atraso (400ms) para o utilizador ver a barra a chegar ao fim antes de fechar a tarefa
      setTimeout(() => {
        if (aoConcluir) aoConcluir(dados);
      }, 400);

    } catch (erro) {
      clearInterval(intervalRef.current);
      setProgresso(0);
      console.error(erro);
      setStatus('erro');
      setMensagemErro(erro.message || 'Falha na sincronização.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="field">
        <label className="field-label">Texto da Legenda</label>
        <textarea
          className="text-input"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          placeholder="Cole aqui o texto já transcrito, na ordem em que é falado…"
          disabled={status === 'processando'}
        />
      </div>

      <div className="field">
        <label className="field-label">Idioma</label>
        <select
          className="select"
          value={idioma}
          onChange={(e) => setIdioma(e.target.value)}
          disabled={status === 'processando'}
        >
          <option value="pt">Português</option>
          <option value="en">Inglês</option>
          <option value="es">Espanhol</option>
        </select>
      </div>

      <button
        className="btn btn--primary"
        onClick={iniciarSincronizacao}
        disabled={status === 'processando'}
        style={{ alignSelf: 'flex-start' }}
      >
        {status === 'processando' ? 'Sincronizando…' : 'Sincronizar com áudio'}
      </button>

      {/* --- NOVA INTERFACE DA BARRA DE PROGRESSO --- */}
      {status === 'processando' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          <div 
            style={{ 
              width: '100%', 
              height: '8px', 
              background: 'rgba(255, 255, 255, 0.05)', 
              borderRadius: '4px', 
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}
          >
            <div 
              style={{
                width: `${progresso}%`,
                height: '100%',
                background: 'var(--accent-amber, #ef9f27)',
                transition: 'width 0.5s ease',
                boxShadow: '0 0 10px rgba(239, 159, 39, 0.6)'
              }} 
            />
          </div>
          <p className="status-line status-line--processing" style={{ margin: 0, fontSize: '12px' }}>
            A analisar o áudio e a sincronizar os tempos (IA)... {Math.floor(progresso)}%
            <br />
            <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }}>
              Isto pode demorar alguns minutos. Não feche a janela.
            </span>
          </p>
        </div>
      )}

      {status === 'erro' && mensagemErro && (
        <p className="status-line status-line--error">{mensagemErro}</p>
      )}

      {status === 'concluido' && (
        <p className="status-line status-line--success">
          Sincronização concluída! Tempos aplicados ao projeto com sucesso.
        </p>
      )}
    </div>
  );
}