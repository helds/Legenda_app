// client/src/components/PainelSincronizacaoAudio.jsx
import React, { useState } from 'react';

// Painel que dispara a sincronização automática de áudio + texto via IA
// (server/audioSyncService.js -> server/audio_sync/aligner.py). O
// componente não faz nenhum processamento por conta própria: apenas
// chama o endpoint do server que executa o forced alignment (WhisperX)
// e a análise de volume, e repassa o projeto atualizado para quem
// estiver controlando o estado global (via `aoConcluir`).
//
// Fluxo esperado:
//   1. Usuário informa o caminho do áudio/vídeo já carregado no projeto
//      (ou o componente recebe isso via prop, se já vier de um upload).
//   2. Usuário confirma o texto já transcrito (pré-preenchido a partir
//      do projeto atual, se houver).
//   3. Ao clicar em "Sincronizar", o componente chama o endpoint HTTP
//      do server (POST /api/audio/sincronizar). Se `projetoId` for
//      informado, o server já mescla o resultado no projeto salvo em
//      disco e devolve o `projeto` completo pronto para uso.
//   4. Enquanto roda, mostra mensagens de progresso (o server pode
//      transmitir os logs do processo Python via streaming/SSE — aqui
//      tratamos de forma simplificada com resposta única).
//   5. Ao concluir, chama `aoConcluir(resultado)` para que o
//      componente pai atualize o projeto com os novos tempos/volumes.

export function PainelSincronizacaoAudio({
  caminhoAudio,
  textoInicial,
  urlEndpointSincronizacao = '/api/audio/sincronizar',
  projetoId,
  aoConcluir,
}) {
  const [texto, setTexto] = useState(textoInicial || '');
  const [idioma, setIdioma] = useState('pt');
  const [status, setStatus] = useState('ocioso'); // 'ocioso' | 'processando' | 'concluido' | 'erro'
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
      // Esperado: { id, projeto, volumeDbMin, volumeDbMax } quando
      // projetoId foi enviado, ou { blocos, volumeDbMin, volumeDbMax }
      // caso contrário.
      setStatus('concluido');
      if (aoConcluir) aoConcluir(resultado);
    } catch (err) {
      setStatus('erro');
      setMensagemErro(err.message || 'Falha desconhecida na sincronização.');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
        Sincronização automática (áudio → tempo + volume)
      </h3>

      <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
        Envie o texto já transcrito. A IA (forced alignment) encontra o
        instante exato em que cada palavra começa e termina de ser
        falada, além do volume relativo de cada uma — que pode depois
        ser usado para escalar o tamanho da fonte automaticamente.
      </p>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Texto transcrito
        </label>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          placeholder="Cole aqui o texto já transcrito, na ordem em que é falado..."
          style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }}
          disabled={status === 'processando'}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Idioma
        </label>
        <select
          value={idioma}
          onChange={(e) => setIdioma(e.target.value)}
          style={{ width: '100%' }}
          disabled={status === 'processando'}
        >
          <option value="pt">Português</option>
          <option value="en">Inglês</option>
          <option value="es">Espanhol</option>
        </select>
      </div>

      <button
        onClick={iniciarSincronizacao}
        disabled={status === 'processando'}
        style={{ alignSelf: 'flex-start' }}
      >
        {status === 'processando' ? 'Sincronizando...' : 'Sincronizar com áudio'}
      </button>

      {status === 'processando' && (
        <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
          Isso pode levar alguns minutos dependendo da duração do áudio.
          Não feche esta janela.
        </p>
      )}

      {status === 'erro' && mensagemErro && (
        <p style={{ margin: 0, fontSize: 13, color: '#c0392b' }}>
          {mensagemErro}
        </p>
      )}

      {status === 'concluido' && (
        <p style={{ margin: 0, fontSize: 13, color: '#2e7d32' }}>
          Sincronização concluída. Tempos e volume aplicados ao projeto.
        </p>
      )}

      {logs.length > 0 && (
        <pre style={{
          fontSize: 11,
          color: '#888',
          background: '#fafafa',
          padding: 8,
          borderRadius: 4,
          maxHeight: 120,
          overflowY: 'auto',
          margin: 0,
        }}>
          {logs.join('\n')}
        </pre>
      )}
    </div>
  );
}
