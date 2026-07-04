// client/src/components/PainelSincronizacaoAudio.jsx
import React, { useState } from 'react';

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
  const [logs, setLogs] = useState([]);

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
    setLogs([]);

    try {
      const resposta = await fetch(urlEndpointSincronizacao, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projetoId, caminhoAudio, texto, idioma }),
      });

      if (!resposta.ok) {
        const corpoErro = await resposta.text();
        throw new Error(corpoErro || `Erro HTTP ${resposta.status}`);
      }

      const resultado = await resposta.json();
      setStatus('concluido');
      if (aoConcluir) aoConcluir(resultado);
    } catch (err) {
      setStatus('erro');
      setMensagemErro(err.message || 'Falha desconhecida na sincronização.');
    }
  }

  return (
    <div className="panel">
      <h3 className="panel-title panel-title--accent">Sincronização automática</h3>
      <p className="panel-subtext">
        Envie o texto já transcrito. A IA (forced alignment) encontra o instante
        exato em que cada palavra começa e termina de ser falada, além do volume
        relativo de cada uma.
      </p>

      <div className="field">
        <label className="field-label">Texto transcrito</label>
        <textarea
          className="textarea"
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

      {status === 'processando' && (
        <p className="status-line status-line--processing">
          Isso pode levar alguns minutos. Não feche esta janela.
        </p>
      )}

      {status === 'erro' && mensagemErro && (
        <p className="status-line status-line--error">{mensagemErro}</p>
      )}

      {status === 'concluido' && (
        <p className="status-line status-line--success">
          Sincronização concluída. Tempos e volume aplicados ao projeto.
        </p>
      )}

      {logs.length > 0 && <pre className="log-console">{logs.join('\n')}</pre>}
    </div>
  );
}
