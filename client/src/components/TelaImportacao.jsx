// client/src/components/TelaImportacao.jsx
import React, { useState, useRef, useEffect } from 'react';

export function TelaImportacao({ aoCriarProjeto }) {
  const [midiaPath, setMidiaPath] = useState('');
  const [tipoMidia, setTipoMidia] = useState(null); // 'video', 'audio' ou 'sem_midia'
  const [semMidia, setSemMidia] = useState(false);
  
  // Estados de resolução (aparecem para áudio ou sem mídia)
  const [larguraVideo, setLarguraVideo] = useState(1080);
  const [alturaVideo, setAlturaVideo] = useState(1920);

  const [srtFile, setSrtFile] = useState(null);
  const [nome, setNome] = useState('');
  const [corrigirTimelineFrames, setCorrigirTimelineFrames] = useState(false);
  
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const srtInputRef = useRef(null);

  // Estados para listar os projetos existentes
  const [projetosExistentes, setProjetosExistentes] = useState([]);
  const [carregandoProjetos, setCarregandoProjetos] = useState(false);

  // Carrega a lista de projetos da pasta 'projects' ao montar o componente
  useEffect(() => {
    async function carregarProjetos() {
      setCarregandoProjetos(true);
      try {
        const resp = await fetch('/api/projetos');
        if (resp.ok) {
          const data = await resp.json();
          setProjetosExistentes(data);
        }
      } catch (e) {
        console.error('Erro ao buscar projetos existentes:', e);
      } finally {
        setCarregandoProjetos(false);
      }
    }
    carregarProjetos();
  }, []);

  // Função para abrir um projeto antigo clicado na lista
  async function abrirProjeto(id) {
    setCarregando(true);
    setErro(null);
    try {
      const resp = await fetch(`/api/projetos/${id}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha ao abrir projeto.');
      aoCriarProjeto(data.id, data.projeto);
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  async function enviar() {
    if (!srtFile) {
      setErro('Selecione um arquivo de legenda.');
      return;
    }
    setCarregando(true);
    setErro(null);

    const formData = new FormData();
    if (midiaPath) {
      formData.append('videoPath', midiaPath);
    }
    formData.append('srt', srtFile);
    formData.append('nome', nome || srtFile.name.replace('.srt', ''));
    
    // Enviando o offset correto de -3600 segundos (1 hora) para o backend
    if (corrigirTimelineFrames) {
      formData.append('offsetSegundos', '-3600');
    }

    if (tipoMidia === 'audio' || semMidia) {
      formData.append('largura', larguraVideo);
      formData.append('altura', alturaVideo);
      if (semMidia) {
        formData.append('semMidia', 'true');
      }
    }

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

  async function selecionarMidia() {
    if (!window.api?.openVideo) {
      setErro('Seleção de mídia indisponível.');
      return;
    }
    const caminho = await window.api.openVideo();
    if (!caminho) return;
    
    setMidiaPath(caminho);
    setSemMidia(false);
    
    const extensao = caminho.split('.').pop().toLowerCase();
    const extensoesAudio = ['mp3', 'wav', 'aac', 'ogg', 'm4a', 'flac', 'wma'];
    
    if (extensoesAudio.includes(extensao)) {
      setTipoMidia('audio');
    } else {
      setTipoMidia('video');
    }
  }

  function removerMidia() {
    setMidiaPath('');
    setTipoMidia(null);
    setSemMidia(false);
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
      {/* CARD CONTÊINER DIVIDIDO EM DUAS COLUNAS */}
      <div 
        style={{ 
          width: '100%', 
          maxWidth: 920, 
          display: 'flex', 
          flexDirection: 'row', 
          flexWrap: 'wrap',
          gap: 48, 
          alignItems: 'flex-start',
          justifyContent: 'center'
        }}
      >
        
        {/* COLUNA ESQUERDA: FORMULÁRIO DE NOVO PROJETO */}
        <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
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
            <h1 className="app-title" style={{ fontSize: 30, letterSpacing: '0.005em', margin: 0 }}>
              Novo projeto
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
              Suba sua legenda e a mídia (vídeo ou áudio) de referência.
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
                placeholder="Ex: Podcast EP 01 - Legenda"
              />
            </div>

            <div className="field">
              <label className="field-label">Mídia de referência (Vídeo ou Áudio)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <button type="button" className="btn" onClick={selecionarMidia} disabled={semMidia}>
                    Selecionar arquivo
                  </button>
                  
                  {!midiaPath && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={semMidia}
                        onChange={(e) => {
                          setSemMidia(e.target.checked);
                          if (e.target.checked) setTipoMidia('sem_midia');
                          else setTipoMidia(null);
                        }}
                        style={{ 
                          width: 16, 
                          height: 16, 
                          accentColor: 'var(--accent-amber)',
                          cursor: 'pointer' 
                        }}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                        Sem mídia de referência
                      </span>
                    </label>
                  )}

                  {midiaPath && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          wordBreak: 'break-all',
                        }}
                      >
                        {midiaPath.split(/[\\/]/).pop()}
                      </span>
                      <button
                        type="button"
                        onClick={removerMidia}
                        title="Remover mídia"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-tertiary)',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          padding: '0 4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'color 0.2s ease',
                        }}
                        onMouseEnter={(e) => e.target.style.color = '#ff4a4a'}
                        onMouseLeave={(e) => e.target.style.color = 'var(--text-tertiary)'}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {(tipoMidia === 'audio' || semMidia) && (
              <div style={{ display: 'flex', gap: 12, marginTop: -8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Largura do Vídeo (px)</label>
                  <input
                    type="number"
                    className="text-input"
                    value={larguraVideo}
                    onChange={(e) => setLarguraVideo(Number(e.target.value))}
                    placeholder="Ex: 1080"
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field-label">Altura do Vídeo (px)</label>
                  <input
                    type="number"
                    className="text-input"
                    value={alturaVideo}
                    onChange={(e) => setAlturaVideo(Number(e.target.value))}
                    placeholder="Ex: 1920"
                  />
                </div>
              </div>
            )}

            <div className="field">
              <label className="field-label">Arquivo de legenda (.srt)</label>
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

            <div className="field" style={{ 
              marginTop: 10, 
              padding: '12px', 
              background: 'rgba(239,159,39,0.05)', 
              borderRadius: 8,
              border: '1px solid rgba(239,159,39,0.1)'
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={corrigirTimelineFrames}
                  onChange={(e) => setCorrigirTimelineFrames(e.target.checked)}
                  style={{ 
                    width: 18, 
                    height: 18, 
                    accentColor: 'var(--accent-amber)',
                    cursor: 'pointer' 
                  }}
                />
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'block' }}>
                    Legenda em formato de edição (Timeline)
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Corrige automaticamente formatos 01:00:00:00 (Frames)
                  </span>
                </div>
              </label>
            </div>

            {erro && <p className="status-line status-line--error">{erro}</p>}

            <button className="btn btn--primary btn--block" onClick={enviar} disabled={carregando}>
              {carregando ? 'Processando…' : 'Criar projeto'}
            </button>
          </div>
        </div>

        {/* COLUNA DIREITA: LISTA DE PROJETOS EXISTENTES */}
        <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Projetos Recentes
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-tertiary)' }}>
              Selecione um projeto salvo para continuar editando.
            </p>
          </div>

          <div 
            className="panel" 
            style={{ 
              padding: 16, 
              gap: 10, 
              maxHeight: 490, 
              overflowY: 'auto',
              background: 'rgba(28, 30, 35, 0.5)'
            }}
          >
            {carregandoProjetos ? (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: '8px 0' }}>
                A carregar histórico...
              </p>
            ) : projetosExistentes.length === 0 ? (
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13, margin: '8px 0', textAlign: 'center' }}>
                Nenhum projeto encontrado na pasta.
              </p>
            ) : (
              projetosExistentes.map((p) => (
                <div
                  key={p.id}
                  onClick={() => abrirProjeto(p.id)}
                  style={{
                    padding: '14px 16px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 159, 39, 0.06)';
                    e.currentTarget.style.borderColor = 'rgba(239, 159, 39, 0.25)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {p.nome}
                  </span>
                  {p.criadoEm && (
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      Criado em: {new Date(p.criadoEm).toLocaleDateString()} às {new Date(p.criadoEm).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}