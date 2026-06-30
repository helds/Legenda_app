// client/src/App.jsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Player } from '@remotion/player';
import { CaptionComposition } from './remotion/CaptionComposition';
import { TelaImportacao } from './components/TelaImportacao';
import { ListaPalavras } from './components/ListaPalavras';
import { PainelPropriedades } from './components/PainelPropriedades';
import { PainelExportacao } from './components/PainelExportacao';

const FPS = 30;

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
  for (const bloco of blocos) {
    const palavra = bloco.palavras.find((p) => p.id === id);
    if (palavra) return palavra;
  }
  return null;
}

function calcularDuracaoFrames(blocos) {
  let max = 0;
  blocos.forEach((b) => { if (b.fim > max) max = b.fim; });
  return Math.ceil((max + 0.5) * FPS) || FPS * 5;
}

export default function App() {
  const [projetoId, setProjetoId] = useState(null);
  const [projeto, setProjeto] = useState(null);
  const [palavraSelecionadaId, setPalavraSelecionadaId] = useState(null);
  const [idsSelecionados, setIdsSelecionados] = useState([]);

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

  const aoSelecionarPalavra = useCallback((id, comShift) => {
    if (comShift) {
      setIdsSelecionados((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    } else {
      setPalavraSelecionadaId(id);
      setIdsSelecionados([]);
    }
  }, []);

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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: '100vh' }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: 20, gap: 16, overflowY: 'auto' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>{projeto.nome}</h2>

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

        {idsSelecionados.length > 0 && (
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
      </div>

      <div style={{ borderLeft: '1px solid #eee', padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {palavraSelecionada ? (
          <PainelPropriedades
            estilo={estiloEmEdicao}
            titulo={`Palavra: "${palavraSelecionada.texto}"`}
            aoMudar={(parcial) => atualizarEstiloPalavra(palavraSelecionada.id, parcial)}
            aoLimparOverride={() => limparOverride(palavraSelecionada.id)}
          />
        ) : (
          <PainelPropriedades
            estilo={projeto.estiloPadrao}
            titulo="Estilo padrão do projeto"
            aoMudar={atualizarEstiloPadrao}
          />
        )}

        <hr style={{ border: 'none', borderTop: '1px solid #eee' }} />

        <PainelExportacao projetoId={projetoId} />
      </div>
    </div>
  );
}