// client/src/components/TelaImportacao.jsx
import React, { useState } from 'react';

export function TelaImportacao({ aoCriarProjeto }) {
  const [videoPath, setVideoPath] = useState('');
  const [srtFile, setSrtFile] = useState(null);
  const [nome, setNome] = useState('');
  const [offsetSegundos, setOffsetSegundos] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  async function enviar() {
    if (!srtFile) {
      setErro('Selecione um arquivo .srt.');
      return;
    }
    setCarregando(true);
    setErro(null);

    const formData = new FormData();
    if (videoPath) {
    formData.append('videoPath', videoPath);}
    formData.append('srt', srtFile);
    formData.append('nome', nome || srtFile.name.replace('.srt', ''));
    if (offsetSegundos) formData.append('offsetSegundos', String(offsetSegundos));

    try {
      const resp = await fetch('/api/projetos', { method: 'POST', body: formData });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha ao criar projeto.');
      aoCriarProjeto(data.id, data.projeto);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  async function selecionarVideo() {
  const caminho = await window.api.openVideo();

  if (!caminho) return;

  setVideoPath(caminho);
}

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500 }}>Novo projeto</h1>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Nome do projeto
        </label>
        <input
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Documentário pífano — cena 1"
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Vídeo (opcional, só para referência no preview)
        </label>
      </div>

      <div>
    <button onClick={selecionarVideo}>
        Selecionar vídeo
    </button>

    <p style={{
        fontSize:12,
        color:"#777",
        wordBreak:"break-all"
    }}>
        {videoPath || "Nenhum vídeo selecionado"}
    </p>
</div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Arquivo .srt
        </label>
        <input type="file" accept=".srt" onChange={(e) => setSrtFile(e.target.files[0])} />
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 4 }}>
          Offset de tempo (segundos) — corrige .srt exportado de timeline que começa em 01:00:00:00
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            value={offsetSegundos}
            onChange={(e) => setOffsetSegundos(Number(e.target.value))}
            style={{ width: 100, padding: 8 }}
          />
          <button type="button" onClick={() => setOffsetSegundos(-3600)}>
            −1h
          </button>
          <button type="button" onClick={() => setOffsetSegundos(0)}>
            Zerar
          </button>
        </div>
      </div>

      {erro && <p style={{ color: '#c0392b', fontSize: 13 }}>{erro}</p>}

      <button onClick={enviar} disabled={carregando}>
        {carregando ? 'Processando...' : 'Criar projeto'}
      </button>
    </div>
  );
}