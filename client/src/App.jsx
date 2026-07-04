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

// CORREÇÃO (bugfix preview sumindo): Error Boundary ao redor da área de
// preview — ver histórico de comentários da versão anterior.
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
          dados de tempo ou texto inválidos (comum logo após uma
          sincronização de áudio malsucedida). O restante da interface
          continua funcionando — você pode tentar sincronizar novamente
          ou restaurar um projeto salvo anteriormente.
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

export default function App() {
  const [projetoId, setProjetoId] = useState(null);
  const [projeto, setProjeto] = useState(null);
  const [palavraSelecionadaId, setPalavraSelecionadaId] = useState(null);
  const [idsSelecionados, setIdsSelecionados] = useState([]);
  const [modoEdicao, setModoEdicao] = useState(MODO_GLOBAL);
  const [telaAtual, setTelaAtual] = useState(TELA_EDITOR);
  const [tempoAtualSegundos, setTempoAtualSegundos] = useState(0);
  const [estaTocando, setEstaTocando] = useState(false);

  const playerRef = useRef(null);
  // Guardamos os nós dos slots em STATE (não em ref) porque precisamos
  // que o React re-renderize quando eles forem anexados ao DOM pela
  // primeira vez — é isso que permite ao createPortal encontrar um
  // alvo. Usar useState com atualização funcional evita o loop
  // "Maximum update depth exceeded": o setState só de fato dispara
  // trabalho novo quando o nó muda (comparação de identidade), então
  // re-registrar o MESMO nó em renders subsequentes é um no-op.
  const [slotEditor, setSlotEditor] = useState(null);
  const [slotTimeline, setSlotTimeline] = useState(null);

  const aoCriarProjeto = useCallback((id, proj) => {
    setProjetoId(id);
    setProjeto(proj);
  }, []);

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

  // Callback de ref estável (useCallback com deps vazias): o React só
  // invoca isso quando o elemento monta/desmonta, nunca a cada render —
  // e a atualização funcional do setState garante que registrar o MESMO
  // nó novamente não causa um novo render.
  //
  // IMPORTANTE: estes dois hooks precisam ficar ANTES de qualquer early
  // return (como o `if (!projeto)` logo abaixo). Declarar hooks depois
  // de um return condicional viola as Rules of Hooks — no primeiro
  // render sem projeto, esses useCallback nunca rodam; assim que um
  // projeto é criado, o React de repente vê "mais hooks do que no
  // render anterior" e derruba a árvore com o erro
  // "Rendered more hooks than during the previous render".
  const registrarSlotEditor = useCallback((no) => {
    setSlotEditor((atual) => (atual === no ? atual : no));
  }, []);
  const registrarSlotTimeline = useCallback((no) => {
    setSlotTimeline((atual) => (atual === no ? atual : no));
  }, []);

  if (!projeto) {
    return <TelaImportacao aoCriarProjeto={aoCriarProjeto} />;
  }

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
            compositionWidth={1920}
            compositionHeight={1080}
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

      <div style={{ display: telaAtual === TELA_TIMELINE ? 'block' : 'none' }}>
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
        />
      </div>

      <div className="app-shell" style={{ display: telaAtual === TELA_EDITOR ? 'grid' : 'none' }}>
        <div className="app-column">
          <div className="app-header">
            <h2 className="app-title">
              {projeto.nome}
            </h2>
            <button className="btn" onClick={() => setTelaAtual(TELA_TIMELINE)}>
              Abrir Timeline →
            </button>
          </div>

          <div
            ref={registrarSlotEditor}
            style={{
              width: '100%',
              height: 'min(58vh, calc((100vw - 400px) * 9 / 16))',
              minHeight: 360,
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              background: 'var(--bg-void)',
              border: '1px solid var(--hairline)',
              boxShadow: 'var(--shadow-panel)',
            }}
          />

          {!urlVideo && (
            <p className="status-line status-line--info">
              Nenhum vídeo de referência selecionado — o preview mostra só a legenda.
            </p>
          )}

          <div>
            <h3 className="panel-title" style={{ marginBottom: 10, fontSize: 13 }}>
              Palavras <span style={{ textTransform: 'none', color: 'var(--text-tertiary)', fontWeight: 400, letterSpacing: 0 }}>
                — clique para editar, shift+clique para grupo
              </span>
            </h3>
            <ListaPalavras
              blocos={projeto.blocos}
              palavraSelecionadaId={palavraSelecionadaId}
              idsSelecionados={idsSelecionados}
              aoSelecionarPalavra={aoSelecionarPalavra}
            />
          </div>

          {idsSelecionados.length > 0 && modoEdicao === MODO_SELECAO && (
            <div className="callout callout--blue">
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

          <hr className="divider" />

          <PainelSincronizacaoAudio
            caminhoAudio={projeto.caminhoVideo}
            textoInicial={textoAtualDasLegendas}
            aoConcluir={aoConcluirSincronizacaoAudio}
            urlEndpointSincronizacao="/api/audio/sincronizar"
            projetoId={projetoId}
          />
        </div>

        <div className="app-column app-column--rail">
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

          <hr className="divider" />

          <PainelExportacao projetoId={projetoId} />
        </div>
      </div>
    </>
  );
}
