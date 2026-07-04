// client/src/components/TelaImportacao.jsx
import React, { useState, useRef } from 'react';

export function TelaImportacao({ aoCriarProjeto }) {
  const [videoPath, setVideoPath] = useState('');
  const [srtFile, setSrtFile] = useState(null);
  const [nome, setNome] = useState('');
  const [offsetSegundos, setOffsetSegundos] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const srtInputRef = useRef(null);


  async function enviar() {
    if (!srtFile) {
      setErro('Selecione um arquivo .srt.');
      return;
    }
    setCarregando(true);
    setErro(null);

    const formData = new FormData();
    if (videoPath) {
      formData.append('videoPath', videoPath);
    }
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
    if (!window.api?.openVideo) {
      setErro('Seleção de vídeo indisponível (fora do Electron ou preload não carregado).');
      return;
    }
    const caminho = await window.api.openVideo();
    if (!caminho) return;
    setVideoPath(caminho);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse 900px 500px at 50% -10%, rgba(239,159,39,0.08), transparent), var(--bg-void)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
      }}
    >
      <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ textAlign: 'center' }}>
          <p
            style={{
              margin: '0 0 6px',
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--accent-amber)',
            }}
          >
            Karaoke Caption Studio
          </p>
          <h1
            className="app-title"
            style={{ fontSize: 30, letterSpacing: '0.005em' }}
          >
            Novo projeto
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            Envie a legenda e, se quiser, o vídeo de referência —
            o resto você ajusta no editor.
          </p>
        </div>

        <div className="panel" style={{ gap: 20 }}>
          <div className="field">
            <label className="field-label">Nome do projeto</label>
            <input
              type="text"
              className="text-input"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Documentário pífano — cena 1"
            />
          </div>

          <div className="field">
            <label className="field-label">Vídeo de referência (opcional)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" className="btn" onClick={selecionarVideo}>
                Selecionar vídeo
              </button>
              <span
                style={{
                  fontSize: 12,
                  color: videoPath ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                  wordBreak: 'break-all',
                }}
              >
                {videoPath || 'Nenhum vídeo selecionado'}
              </span>
            </div>
          </div>

          <div className="field">
            <label className="field-label">Arquivo .srt</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={() => srtInputRef.current?.click()}
              >
                Selecionar legenda
              </button>
              <span
                style={{
                  fontSize: 12,
                  color: srtFile ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                  wordBreak: 'break-all',
                }}
              >
                {srtFile ? srtFile.name : 'Nenhum arquivo selecionado'}
              </span>
              <input
                ref={srtInputRef}
                type="file"
                accept=".srt"
                onChange={(e) => setSrtFile(e.target.files[0])}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              Offset de tempo <span className="field-label__value">— corrige .srt de timeline 01:00:00:00</span>
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                className="text-input"
                value={offsetSegundos}
                onChange={(e) => setOffsetSegundos(Number(e.target.value))}
                style={{ width: 100 }}
              />
              <button type="button" className="btn" onClick={() => setOffsetSegundos(-3600)}>
                −1h
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setOffsetSegundos(0)}>
                Zerar
              </button>
            </div>
          </div>

          {erro && <p className="status-line status-line--error">{erro}</p>}

          <button className="btn btn--primary btn--block" onClick={enviar} disabled={carregando}>
            {carregando ? 'Processando…' : 'Criar projeto'}
          </button>
        </div>
      </div>
    </div>
  );
}
