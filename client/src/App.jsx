// client/src/App.jsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Player } from '@remotion/player';
import { CaptionComposition } from './remotion/CaptionComposition';
import { TelaImportacao } from './components/TelaImportacao';
import { ListaPalavras } from './components/ListaPalavras';
import { PainelPropriedades } from './components/PainelPropriedades';
import { PainelExportacao } from './components/PainelExportacao';
import { PainelSincronizacaoAudio } from './components/PainelSincronizacaoAudio';
import { TelaTimeline } from './components/TelaTimeline';

const FPS = 30;

const MODO_GLOBAL = 'global';
const MODO_SELECAO = 'selecao';

const TELA_EDITOR = 'editor';
const TELA_TIMELINE = 'timeline';

class PreviewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro, info) {
    console.error('Erro ao renderizar o preview:', erro, info);
  }

  render() {
    if (this.state.erro) {
      return (
        <div
          style={{
            padding: 20,
            background: 'rgba(229, 103, 95, 0.08)',
            border: '1px solid var(--accent-danger)',
            color: '#f3c6c2',
            borderRadius: 'var(--radius-lg)',
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap',
            overflowY: 'auto',
            aspectRatio: '16 / 9',
          }}
        >
          <strong style={{ fontFamily: 'var(--font-ui)' }}>Erro ao renderizar o preview.</strong>
          {'\n'}
          Isso normalmente acontece quando alguma palavra do projeto tem
          dados de tempo ou texto inválidos.
          {'\n\n'}
          <strong style={{ fontFamily: 'var(--font-ui)' }}>Detalhe técnico:</strong>
          {'\n'}
          {this.state.erro.message}
          {'\n\n'}
          {this.state.erro.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

function resolverUrlVideo(caminhoVideo) {
  if (!caminhoVideo) return null;
  if (caminhoVideo.startsWith('/uploads/')) return caminhoVideo;
  return `/api/video-local?path=${encodeURIComponent(caminhoVideo)}`;
}

function encontrarPalavra(blocos, id) {
  for (const bloco of blocos || []) {
    const palavra = (bloco?.palavras || []).find((p) => p.id === id);
    if (palavra) return palavra;
  }
  return null;
}

function calcularDuracaoFrames(blocos) {
  let max = 0;
  (blocos || []).forEach((b) => { if (b?.fim > max) max = b.fim; });
  return Math.ceil((max + 0.5) * FPS) || FPS * 5;
}

function aplicarRippleTrim(blocos, { palavraId, lado, novoTempo, duracaoMinima }) {
  return blocos.map((bloco) => {
    const indice = (bloco.palavras || []).findIndex((p) => p.id === palavraId);
    if (indice === -1) return bloco;

    const palavras = bloco.palavras.map((p) => ({ ...p }));
    const alvo = palavras[indice];
    const anterior = indice > 0 ? palavras[indice - 1] : null;
    const proxima = indice < palavras.length - 1 ? palavras[indice + 1] : null;

    if (lado === 'direita') {
      const limiteSuperior = proxima
        ? Math.min(bloco.fim, proxima.fim - duracaoMinima)
        : bloco.fim;
      const novoFim = Math.max(alvo.inicio + duracaoMinima, Math.min(novoTempo, limiteSuperior));

      alvo.fim = Number(novoFim.toFixed(3));
      if (proxima) {
        proxima.inicio = Number(novoFim.toFixed(3));
      }
    } else {
      const limiteInferior = anterior
        ? Math.max(bloco.inicio, anterior.inicio + duracaoMinima)
        : bloco.inicio;
      const novoInicio = Math.min(alvo.fim - duracaoMinima, Math.max(novoTempo, limiteInferior));

      alvo.inicio = Number(novoInicio.toFixed(3));
      if (anterior) {
        anterior.fim = Number(novoInicio.toFixed(3));
      }
    }

    return { ...bloco, palavras };
  });
}

export default function App() {
  const [projetoId, setProjetoId] = useState(null);
  const [projeto, setProjeto] = useState(null);
  const [palavraSelecionadaId, setPalavraSelecionadaId] = useState(null);
  const [idsSelecionados, setIdsSelecionados] = useState([]);
  const [modoEdicao, setModoEdicao] = useState(MODO_GLOBAL);
  const [telaAtual, setTelaAtual] = useState(TELA_EDITOR);
  const [tempoAtualSegundos, setTempoAtualSegundos] = useState(0);
  const [estaTocando, setEstaTocando] = useState(false);

  const [mostrarSincronizacao, setMostrarSincronizacao] = useState(false);
  const [alturaPainelFerramentas, setAlturaPainelFerramentas] = useState(300);
  const [estaArrastandoPainel, setEstaArrastandoPainel] = useState(false);

  const [dimensoesVideo, setDimensoesVideo] = useState({ largura: 1080, altura: 1920 });

  const playerRef = useRef(null);
  const [slotEditor, setSlotEditor] = useState(null);
  const [slotTimeline, setSlotTimeline] = useState(null);
  const debounceResizeRef = useRef(null);

  const aoCriarProjeto = useCallback((id, proj) => {
    setProjetoId(id);
    setProjeto(proj);
  }, []);

  useEffect(() => {
    if (!projeto) return;
    
    if (projeto.largura && projeto.altura) {
      setDimensoesVideo({ largura: projeto.largura, altura: projeto.altura });
      return;
    }

    const url = resolverUrlVideo(projeto.caminhoVideo);
    if (url) {
      const v = document.createElement('video');
      v.src = url;
      v.onloadedmetadata = () => {
        if (v.videoWidth && v.videoHeight) {
          setDimensoesVideo({ largura: v.videoWidth, altura: v.videoHeight });
        }
      };
    } else {
      setDimensoesVideo({ largura: 1080, altura: 1920 }); 
    }
  }, [projeto]);

  useEffect(() => {
    if (!estaArrastandoPainel) return;

    function lidarComArrastar(e) {
      e.preventDefault();
      const paddingDoApp = 24; 
      const novaAltura = window.innerHeight - e.clientY - paddingDoApp;
      const alturaSegura = Math.max(100, Math.min(novaAltura, window.innerHeight * 0.65));
      setAlturaPainelFerramentas(alturaSegura);
    }

    function pararArrastar() {
      setEstaArrastandoPainel(false);
    }

    window.addEventListener('mousemove', lidarComArrastar);
    window.addEventListener('mouseup', pararArrastar);

    return () => {
      window.removeEventListener('mousemove', lidarComArrastar);
      window.removeEventListener('mouseup', pararArrastar);
    };
  }, [estaArrastandoPainel]);

  const aoSelecionarPalavra = useCallback((id, comShift) => {
    setModoEdicao(MODO_SELECAO);
    if (comShift) {
      setIdsSelecionados((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setPalavraSelecionadaId(id);
      setIdsSelecionados([]);
    }
  }, []);

  function alternarModoEdicao(novoModo) {
    setModoEdicao(novoModo);
    if (novoModo === MODO_GLOBAL) {
      setPalavraSelecionadaId(null);
      setIdsSelecionados([]);
    }
  }

  async function atualizarEstiloPadrao(parcial) {
    const resp = await fetch(`/api/projetos/${projetoId}/estilo-padrao`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parcial),
    });
    const data = await resp.json();
    setProjeto(data.projeto);
  }

  async function atualizarEstiloPalavra(palavraId, parcial) {
    const resp = await fetch(`/api/projetos/${projetoId}/palavras/${palavraId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parcial),
    });
    const data = await resp.json();
    setProjeto(data.projeto);
  }

  async function aplicarPresetAoGrupo(parcial) {
    if (idsSelecionados.length === 0) return;
    const resp = await fetch(`/api/projetos/${projetoId}/aplicar-preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetParcial: parcial, idsAlvo: idsSelecionados }),
    });
    const data = await resp.json();
    setProjeto(data.projeto);
  }

  async function limparOverride(palavraId) {
    await fetch(`/api/projetos/${projetoId}/palavras/${palavraId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(null),
    });
    const palavra = encontrarPalavra(projeto.blocos, palavraId);
    if (palavra) palavra.estilo = null;
    setProjeto({ ...projeto });
  }

  function aoConcluirSincronizacaoAudio(resultado) {
    if (resultado.projeto) {
      setProjeto(resultado.projeto);
    }
  }

  const aoRedimensionarPalavra = useCallback(
    ({ palavraId, lado, novoTempo, duracaoMinima }) => {
      setProjeto((projetoAtual) => {
        if (!projetoAtual) return projetoAtual;
        const novosBlocos = aplicarRippleTrim(projetoAtual.blocos, {
          palavraId,
          lado,
          novoTempo,
          duracaoMinima,
        });
        return { ...projetoAtual, blocos: novosBlocos };
      });

      if (debounceResizeRef.current) clearTimeout(debounceResizeRef.current);
      debounceResizeRef.current = setTimeout(() => {
        setProjeto((projetoAtual) => {
          if (!projetoAtual || !projetoId) return projetoAtual;
          fetch(`/api/projetos/${projetoId}/blocos`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocos: projetoAtual.blocos }),
          }).catch((err) => {
            console.error('Falha:', err);
          });
          return projetoAtual;
        });
      }, 250);
    },
    [projetoId]
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return undefined;

    function aoAtualizarFrame(evento) {
      setTempoAtualSegundos(evento.detail.frame / FPS);
    }
    function aoTocar() { setEstaTocando(true); }
    function aoPausar() { setEstaTocando(false); }

    player.addEventListener('frameupdate', aoAtualizarFrame);
    player.addEventListener('play', aoTocar);
    player.addEventListener('pause', aoPausar);
    player.addEventListener('ended', aoPausar);
    return () => {
      player.removeEventListener('frameupdate', aoAtualizarFrame);
      player.removeEventListener('play', aoTocar);
      player.removeEventListener('pause', aoPausar);
      player.removeEventListener('ended', aoPausar);
    };
  }, [projeto]);

  const aoBuscarTempo = useCallback((segundos) => {
    const player = playerRef.current;
    if (!player) return;
    const frame = Math.round(segundos * FPS);
    player.seekTo(frame);
    setTempoAtualSegundos(segundos);
  }, []);

  const aoAlternarPlayPause = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) {
      player.pause();
    } else {
      player.play();
    }
  }, []);

  const registrarSlotEditor = useCallback((no) => {
    setSlotEditor((atual) => (atual === no ? atual : no));
  }, []);
  const registrarSlotTimeline = useCallback((no) => {
    setSlotTimeline((atual) => (atual === no ? atual : no));
  }, []);

  if (!projeto) {
    return <TelaImportacao aoCriarProjeto={aoCriarProjeto} />;
  }

  const larguraProjeto = dimensoesVideo.largura;
  const alturaProjeto = dimensoesVideo.altura;
  
  const videoDeveFicarNaDireita = larguraProjeto > 1080;

  const palavraSelecionada = palavraSelecionadaId
    ? encontrarPalavra(projeto.blocos, palavraSelecionadaId)
    : null;

  const estiloEmEdicao = palavraSelecionada
    ? { ...projeto.estiloPadrao, ...(palavraSelecionada.estilo || {}) }
    : projeto.estiloPadrao;

  const duracaoFrames = calcularDuracaoFrames(projeto.blocos);
  const duracaoSegundos = duracaoFrames / FPS;
  const urlVideo = resolverUrlVideo(projeto.caminhoVideo);

  const haSelecao = !!palavraSelecionada || idsSelecionados.length > 0;

  const textoAtualDasLegendas = (projeto.blocos || [])
    .map((bloco) => (bloco?.palavras || []).map((p) => p?.texto || '').join(' '))
    .join(' ');

  const slotAtivo = telaAtual === TELA_EDITOR ? slotEditor : slotTimeline;

  const playerPortado = slotAtivo
    ? createPortal(
        <PreviewErrorBoundary>
          <Player
            ref={playerRef}
            component={CaptionComposition}
            durationInFrames={duracaoFrames}
            fps={FPS}
            compositionWidth={larguraProjeto} 
            compositionHeight={alturaProjeto}
            style={{ width: '100%', height: '100%' }}
            controls={telaAtual === TELA_EDITOR}
            inputProps={{
              projeto,
              corFundo: urlVideo ? 'transparent' : '#1a1a1a',
              videoPreviewSrc: urlVideo,
            }}
          />
        </PreviewErrorBoundary>,
        slotAtivo
      )
    : null;

  return (
    <>
      {playerPortado}

      <div style={{ display: telaAtual === TELA_TIMELINE ? 'block' : 'none', height: '100vh', width: '100vw' }}>
        <TelaTimeline
          projeto={projeto}
          urlAudio={urlVideo}
          duracaoSegundos={duracaoSegundos}
          tempoAtualSegundos={tempoAtualSegundos}
          aoBuscarTempo={aoBuscarTempo}
          estaTocando={estaTocando}
          aoAlternarPlayPause={aoAlternarPlayPause}
          palavraSelecionadaId={palavraSelecionadaId}
          idsSelecionados={idsSelecionados}
          aoSelecionarPalavra={aoSelecionarPalavra}
          aoVoltarParaEditor={() => setTelaAtual(TELA_EDITOR)}
          registrarSlotDoPlayer={registrarSlotTimeline}
          aoRedimensionarPalavra={aoRedimensionarPalavra}
        />
      </div>

      <div 
        className="app-shell" 
        style={{ 
          display: telaAtual === TELA_EDITOR ? 'flex' : 'none', 
          gap: '24px', 
          flexDirection: 'row',
          height: '100vh',     /* Ocupa exatamente a janela toda */
          width: '100vw',      /* Garante a largura também */
          padding: '24px',     /* Espaço interno seguro */
          boxSizing: 'border-box', /* O SEGREDO: o padding não aumenta o tamanho total de 100vh! */
          overflow: 'hidden'
        }}
      >
        {/* COLUNA ESQUERDA: Sessão Principal de Trabalho */}
        <div style={{ 
          flex: 1, 
          minWidth: 0, 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '20px',
          minHeight: 0 /* Em vez de height: 100%, isto impede overflow */
        }}>
          
          {/* CABEÇALHO */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <h2 className="app-title" style={{ margin: 0 }}>{projeto.nome}</h2>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className={`btn ${mostrarSincronizacao ? 'btn--primary' : ''}`}
                onClick={() => setMostrarSincronizacao(!mostrarSincronizacao)}
                style={{ padding: '8px 16px', fontWeight: 600, borderColor: 'var(--accent-amber)' }}
              >
                {mostrarSincronizacao ? 'Fechar Sincronização' : 'Sincronização Automática'}
              </button>
              
              <button className="btn" onClick={() => setTelaAtual(TELA_TIMELINE)}>
                Abrir Timeline →
              </button>
            </div>
          </div>

          {!urlVideo && (
            <p className="status-line status-line--info" style={{ margin: 0, flexShrink: 0 }}>
              Nenhum vídeo de referência selecionado — o preview mostra só a legenda.
            </p>
          )}

          {/* ÁREA DE CONTEÚDO PRINCIPAL (Video + Lista) */}
          <div style={{
            display: 'flex',
            flexDirection: videoDeveFicarNaDireita ? 'row-reverse' : 'row',
            gap: '24px',
            flex: 1, 
            minHeight: 0, /* ESSENCIAL PARA FLEXBOX NÃO TRANSBORDAR */
            alignItems: 'stretch'
          }}>
            
            {/* VÍDEO PREVIEW */}
            <div style={{
              width: videoDeveFicarNaDireita ? '50%' : '320px', 
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div
                ref={registrarSlotEditor}
                style={{
                  width: '100%',
                  aspectRatio: `${larguraProjeto} / ${alturaProjeto}`,
                  borderRadius: 'var(--radius-lg)',
                  overflow: 'hidden',
                  background: 'var(--bg-void)',
                  border: '1px solid var(--hairline)',
                  boxShadow: 'var(--shadow-panel)',
                }}
              />
            </div>

            {/* LISTA DE PALAVRAS E OPÇÕES (COLUNA FLEXÍVEL) */}
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              minWidth: 0,
              minHeight: 0 /* Substitui height: 100% para evitar "leaking" */
            }}>
              <h3 className="panel-title" style={{ marginBottom: 10, fontSize: 13, flexShrink: 0 }}>
                Palavras <span style={{ textTransform: 'none', color: 'var(--text-tertiary)', fontWeight: 400, letterSpacing: 0 }}>
                  — clique para editar, shift+clique para grupo
                </span>
              </h3>
              
              {/* CONTENTOR DA LISTA DE PALAVRAS */}
              <div style={{ 
                flex: 1, 
                minHeight: 0, 
                overflowY: 'auto', 
                border: '1px solid var(--hairline)',
                borderRadius: '8px',
                background: 'var(--bg-panel)',
                padding: '12px', /* Previne que as palavras colem nos limites do container */
                paddingBottom: '24px' /* Espaço extra no fundo do scroll */
              }}>
                <ListaPalavras
                  blocos={projeto.blocos}
                  palavraSelecionadaId={palavraSelecionadaId}
                  idsSelecionados={idsSelecionados}
                  aoSelecionarPalavra={aoSelecionarPalavra}
                />
              </div>
              
              {/* PAINEL DE PRESETS DE GRUPO */}
              {idsSelecionados.length > 0 && modoEdicao === MODO_SELECAO && (
                <div className="callout callout--blue" style={{ marginTop: '20px', flexShrink: 0 }}>
                  <p style={{ margin: '0 0 10px' }}>
                    {idsSelecionados.length} palavra(s) selecionada(s) — ajuste abaixo e aplique como preset de grupo.
                  </p>
                  <PainelPropriedades
                    estilo={projeto.estiloPadrao}
                    titulo="Aplicar a grupo selecionado"
                    aoMudar={aplicarPresetAoGrupo}
                  />
                </div>
              )}
            </div>

          </div>

          {/* PAINEL INFERIOR TIPO VS CODE */}
          {mostrarSincronizacao && (
            <div 
              style={{
                height: alturaPainelFerramentas,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                background: 'var(--bg-panel)',
                borderRadius: '8px',
                border: '1px solid rgba(239, 159, 39, 0.3)',
                boxShadow: '0 -4px 12px rgba(0,0,0,0.1)'
              }}
            >
              <div 
                onMouseDown={() => setEstaArrastandoPainel(true)}
                style={{
                  height: '8px',
                  width: '100%',
                  cursor: 'row-resize',
                  position: 'absolute',
                  top: '-4px',
                  zIndex: 10,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                <div style={{ width: '40px', height: '4px', background: 'rgba(239, 159, 39, 0.5)', borderRadius: '4px' }} />
              </div>
              
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                <PainelSincronizacaoAudio
                  caminhoAudio={projeto.caminhoVideo}
                  textoInicial={textoAtualDasLegendas}
                  aoConcluir={aoConcluirSincronizacaoAudio}
                  urlEndpointSincronizacao="/api/audio/sincronizar"
                  projetoId={projetoId}
                />
              </div>
            </div>
          )}

        </div>

        {/* COLUNA DIREITA (RAIL) */}
        <div style={{ 
          width: '340px', 
          flexShrink: 0, 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '20px',
          minHeight: 0, /* Substitui height: 100% */
          overflowY: 'auto',
          paddingRight: '10px' 
        }}>
          
          <div className="segmented">
            <button
              className={`btn ${modoEdicao === MODO_GLOBAL ? 'is-active' : ''}`}
              onClick={() => alternarModoEdicao(MODO_GLOBAL)}
            >
              Padrão Global
            </button>
            <button
              className={`btn ${modoEdicao === MODO_SELECAO ? 'is-active' : ''}`}
              onClick={() => alternarModoEdicao(MODO_SELECAO)}
            >
              Seleção
            </button>
          </div>

          {modoEdicao === MODO_GLOBAL && (
            <PainelPropriedades
              estilo={projeto.estiloPadrao}
              titulo="Estilo padrão do projeto"
              aoMudar={atualizarEstiloPadrao}
            />
          )}

          {modoEdicao === MODO_SELECAO && !haSelecao && (
            <div className="hint-box">
              Clique em uma palavra na lista à esquerda (ou shift+clique
              para um grupo) para editar seu estilo individual.
            </div>
          )}

          {modoEdicao === MODO_SELECAO && palavraSelecionada && idsSelecionados.length === 0 && (
            <PainelPropriedades
              estilo={estiloEmEdicao}
              titulo={`Palavra: "${palavraSelecionada.texto}"`}
              aoMudar={(parcial) => atualizarEstiloPalavra(palavraSelecionada.id, parcial)}
              aoLimparOverride={() => limparOverride(palavraSelecionada.id)}
            />
          )}

          {modoEdicao === MODO_SELECAO && idsSelecionados.length > 0 && (
            <div className="hint-box">
              Use o painel abaixo da lista de palavras para aplicar o estilo ao grupo selecionado.
            </div>
          )}

          <hr className="divider" style={{ margin: '10px 0', borderTop: '1px solid var(--hairline)' }} />

          <PainelExportacao projetoId={projetoId} />
        </div>
      </div>
      
      {estaArrastandoPainel && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          cursor: 'row-resize',
          zIndex: 9999
        }} />
      )}
    </>
  );
}