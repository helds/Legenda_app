// client/src/App.jsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Player } from '@remotion/player';
import { CaptionComposition } from './remotion/CaptionComposition';
import { TelaImportacao } from './components/TelaImportacao';
import { ListaPalavras } from './components/ListaPalavras';
import { PainelPropriedades } from './components/PainelPropriedades';
import { PainelExportacao } from './components/PainelExportacao';
import { PainelSincronizacaoAudio } from './components/PainelSincronizacaoAudio';

const FPS = 30;

// Os dois modos de edição do painel de propriedades:
// - 'global': edita o estiloPadrao do projeto (afeta toda palavra sem
//   override próprio).
// - 'selecao': edita o(s) override(s) da palavra/grupo selecionado.
const MODO_GLOBAL = 'global';
const MODO_SELECAO = 'selecao';

// CORREÇÃO (bugfix preview sumindo): Error Boundary ao redor da área de
// preview. Antes, se algo lançasse uma exceção durante o render do
// CaptionComposition/Player (ex: dado malformado vindo da sincronização
// de áudio), o React desmontava a árvore inteira sem aviso nenhum — a
// própria <div> do vídeo desaparecia da tela, sem nenhuma mensagem, e sem
// abrir o DevTools não havia como saber o que tinha acontecido. Com este
// boundary, qualquer erro de render é capturado e mostrado como uma
// mensagem legível no próprio lugar onde o preview ficaria, com a stack
// trace completa — o resto da interface (lista de palavras, painéis,
// exportação) continua funcionando normalmente.
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
            background: '#2a0000',
            color: '#ffb3b3',
            borderRadius: 8,
            fontSize: 13,
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            overflowY: 'auto',
            aspectRatio: '16 / 9',
          }}
        >
          <strong>Erro ao renderizar o preview.</strong>
          {'\n'}
          Isso normalmente acontece quando alguma palavra do projeto tem
          dados de tempo ou texto inválidos (comum logo após uma
          sincronização de áudio malsucedida). O restante da interface
          continua funcionando — você pode tentar sincronizar novamente
          ou restaurar um projeto salvo anteriormente.
          {'\n\n'}
          <strong>Detalhe técnico:</strong>
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

// Resolve a URL que o <video> do preview pode usar a partir do caminho
// salvo no projeto: pode ser um upload antigo (/uploads/arquivo, servido
// estaticamente) ou um caminho absoluto local escolhido via diálogo do
// Electron (servido sob demanda pela rota /api/video-local).
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

  const playerRef = useRef(null);
  const videoRef = useRef(null);

  // Mantém o <video> de referência sincronizado com o Player de legendas:
  // toca/pausa junto e corrige o tempo quando o usuário busca (seek) ou
  // quando o frame avança além de uma tolerância pequena.
  useEffect(() => {
    const player = playerRef.current;
    const video = videoRef.current;
    if (!player || !video) return;

    const aoTocar = () => { video.play().catch(() => {}); };
    const aoPausar = () => video.pause();
    const aoAtualizarFrame = (e) => {
      const tempoAlvo = e.detail.frame / FPS;
      if (Math.abs(video.currentTime - tempoAlvo) > 0.15) {
        video.currentTime = tempoAlvo;
      }
    };
    const aoBuscar = (e) => {
      video.currentTime = e.detail.frame / FPS;
    };

    player.addEventListener('play', aoTocar);
    player.addEventListener('pause', aoPausar);
    player.addEventListener('frameupdate', aoAtualizarFrame);
    player.addEventListener('seeked', aoBuscar);

    return () => {
      player.removeEventListener('play', aoTocar);
      player.removeEventListener('pause', aoPausar);
      player.removeEventListener('frameupdate', aoAtualizarFrame);
      player.removeEventListener('seeked', aoBuscar);
    };
  }, [projeto?.caminhoVideo]);

  const aoCriarProjeto = useCallback((id, proj) => {
    setProjetoId(id);
    setProjeto(proj);
  }, []);

  // Clicar numa palavra sempre muda automaticamente para o modo Seleção
  // (item 1, segunda parte do pedido) — além do botão manual de toggle.
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

  // Alterna manualmente entre os dois modos. Ao voltar para Global, limpa
  // a seleção de palavra(s) para deixar claro que o painel passou a
  // editar o padrão do projeto.
  function alternarModoEdicao() {
    setModoEdicao((modoAtual) => {
      const novoModo = modoAtual === MODO_GLOBAL ? MODO_SELECAO : MODO_GLOBAL;
      if (novoModo === MODO_GLOBAL) {
        setPalavraSelecionadaId(null);
        setIdsSelecionados([]);
      }
      return novoModo;
    });
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

  // Chamado pelo PainelSincronizacaoAudio quando o alignment via
  // WhisperX termina com sucesso. Se o server já mesclou o resultado no
  // projeto (quando projetoId foi enviado), `resultado.projeto` vem
  // pronto para substituir o estado local. Caso contrário (sem
  // projetoId), aplicamos os novos blocos no projeto atual em memória.
  function aoConcluirSincronizacaoAudio(resultado) {
    if (resultado.projeto) {
      setProjeto(resultado.projeto);
      return;
    }
    if (resultado.blocos) {
      setProjeto((atual) => ({ ...atual, blocos: resultado.blocos }));
    }
  }

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
  const urlVideo = resolverUrlVideo(projeto.caminhoVideo);

  // O modo Seleção só faz sentido visualmente quando há de fato algo
  // selecionado (palavra única ou grupo). Se o usuário alternar para
  // Seleção sem nada selecionado ainda, mostramos uma dica em vez do
  // painel global ou de um painel "vazio".
  const haSelecao = !!palavraSelecionada || idsSelecionados.length > 0;

  // Texto atual das legendas, usado para pré-preencher o campo de texto
  // transcrito no painel de sincronização de áudio (o usuário pode
  // ajustar antes de disparar o alignment). Blindado contra blocos ou
  // palavras em formato inesperado (ex: undefined) para não derrubar a
  // renderização de todo o App caso algo venha malformado.
  const textoAtualDasLegendas = (projeto.blocos || [])
    .map((bloco) =>
      (bloco?.palavras || []).map((p) => p?.texto || '').join(' ')
    )
    .join(' ');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: '100vh' }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: 20, gap: 16, overflowY: 'auto' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>{projeto.nome}</h2>

        <PreviewErrorBoundary>
          <div style={{ background: '#111', borderRadius: 8, overflow: 'hidden', position: 'relative', aspectRatio: '16 / 9' }}>
            {urlVideo && (
              <video
                ref={videoRef}
                src={urlVideo}
                playsInline
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000',
                }}
              />
            )}
            <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
              <Player
                ref={playerRef}
                component={CaptionComposition}
                durationInFrames={duracaoFrames}
                fps={FPS}
                compositionWidth={1920}
                compositionHeight={1080}
                style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
                controls
                inputProps={{ projeto, corFundo: urlVideo ? 'transparent' : '#1a1a1a' }}
              />
            </div>
          </div>
        </PreviewErrorBoundary>

        {!urlVideo && (
          <p style={{ fontSize: 12, color: '#999', margin: 0 }}>
            Nenhum vídeo de referência selecionado — o preview mostra só a legenda.
          </p>
        )}

        <div>
          <h3 style={{ fontSize: 16, fontWeight: 500 }}>
            Palavras (clique para editar, shift+clique para selecionar em grupo)
          </h3>
          <ListaPalavras
            blocos={projeto.blocos}
            palavraSelecionadaId={palavraSelecionadaId}
            idsSelecionados={idsSelecionados}
            aoSelecionarPalavra={aoSelecionarPalavra}
          />
        </div>

        {idsSelecionados.length > 0 && modoEdicao === MODO_SELECAO && (
          <div style={{ padding: 12, background: '#eef6ff', borderRadius: 8 }}>
            <p style={{ fontSize: 13, margin: '0 0 8px' }}>
              {idsSelecionados.length} palavra(s) selecionada(s) — ajuste abaixo e aplique como preset de grupo.
            </p>
            <PainelPropriedades
              estilo={projeto.estiloPadrao}
              titulo="Aplicar a grupo selecionado"
              aoMudar={aplicarPresetAoGrupo}
            />
          </div>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid #eee' }} />

        <PainelSincronizacaoAudio
          caminhoAudio={projeto.caminhoVideo}
          textoInicial={textoAtualDasLegendas}
          aoConcluir={aoConcluirSincronizacaoAudio}
          urlEndpointSincronizacao="/api/audio/sincronizar"
          projetoId={projetoId}
        />
      </div>

      <div style={{ borderLeft: '1px solid #eee', padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={alternarModoEdicao}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: modoEdicao === MODO_GLOBAL ? '#111' : '#fff',
              color: modoEdicao === MODO_GLOBAL ? '#fff' : '#111',
              cursor: 'pointer',
            }}
          >
            Padrão Global
          </button>
          <button
            onClick={alternarModoEdicao}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: modoEdicao === MODO_SELECAO ? '#111' : '#fff',
              color: modoEdicao === MODO_SELECAO ? '#fff' : '#111',
              cursor: 'pointer',
            }}
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
          <p style={{ fontSize: 13, color: '#888' }}>
            Clique em uma palavra na lista à esquerda (ou shift+clique para um grupo) para editar seu estilo individual.
          </p>
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
          <p style={{ fontSize: 13, color: '#888' }}>
            Use o painel abaixo da lista de palavras para aplicar o estilo ao grupo selecionado.
          </p>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid #eee' }} />

        <PainelExportacao projetoId={projetoId} />
      </div>
    </div>
  );
}