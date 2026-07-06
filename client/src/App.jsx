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

// Redimensiona APENAS a palavra alvo, sem alterar as vizinhas. Ela pode
// crescer livremente pelo espaço vazio da timeline, só é limitada quando
// encosta de fato no início/fim de outra palavra (evita sobrepor).
// Isto é o comportamento "dentro do bloco": cada retângulo se comporta
// como independente dos outros.
function aplicarResizeIndividual(blocos, { palavraId, lado, novoTempo, duracaoMinima }) {
  // Junta todas as palavras (de todos os blocos) para achar corretamente
  // quem é a vizinha mais próxima no tempo, já que a vizinha "de fato" pode
  // estar em outro bloco.
  const todasPalavras = blocos.flatMap((b) => b.palavras || []);

  return blocos.map((bloco) => {
    const indice = (bloco.palavras || []).findIndex((p) => p.id === palavraId);
    if (indice === -1) return bloco;

    const palavras = bloco.palavras.map((p) => ({ ...p }));
    const alvo = palavras[indice];

    if (lado === 'direita') {
      // Vizinha mais próxima à direita (qualquer palavra cujo início seja
      // >= fim atual do alvo), para não invadi-la.
      const vizinhasDepois = todasPalavras
        .filter((p) => p.id !== palavraId && p.inicio >= alvo.fim - 0.0005)
        .sort((a, b) => a.inicio - b.inicio);
      const limiteSuperior = vizinhasDepois.length > 0 ? vizinhasDepois[0].inicio : Infinity;

      const novoFim = Math.max(alvo.inicio + duracaoMinima, Math.min(novoTempo, limiteSuperior));
      alvo.fim = Number(novoFim.toFixed(3));
    } else {
      const vizinhasAntes = todasPalavras
        .filter((p) => p.id !== palavraId && p.fim <= alvo.inicio + 0.0005)
        .sort((a, b) => b.fim - a.fim);
      const limiteInferior = vizinhasAntes.length > 0 ? vizinhasAntes[0].fim : 0;

      const novoInicio = Math.min(alvo.fim - duracaoMinima, Math.max(novoTempo, limiteInferior));
      alvo.inicio = Number(novoInicio.toFixed(3));
    }

    return { ...bloco, palavras };
  });
}

// Limiar de distância (em segundos) abaixo do qual duas palavras vizinhas
// são consideradas "coladas" e, portanto, redimensionáveis em conjunto pela
// alça de junção (comportamento estilo DaVinci Resolve).
const LIMIAR_JUNCAO_SEGUNDOS = 0.02;

// Redimensiona a JUNÇÃO entre duas palavras coladas: arrastar o ponto de
// contato move o fim da palavra da esquerda e o início da palavra da
// direita ao mesmo tempo, como no editor de junções do DaVinci Resolve.
// Só deve ser chamado quando as duas palavras realmente estão encostadas
// (ver LIMIAR_JUNCAO_SEGUNDOS).
function aplicarResizeJuncao(blocos, { palavraEsquerdaId, palavraDireitaId, novoTempo, duracaoMinima }) {
  // Limites: o ponto de junção não pode passar do início da esquerda nem
  // do fim da direita, sempre respeitando a duração mínima de cada uma.
  let limiteInferior = -Infinity;
  let limiteSuperior = Infinity;

  blocos.forEach((bloco) => {
    (bloco.palavras || []).forEach((p) => {
      if (p.id === palavraEsquerdaId) limiteInferior = p.inicio + duracaoMinima;
      if (p.id === palavraDireitaId) limiteSuperior = p.fim - duracaoMinima;
    });
  });

  const novoPonto = Math.max(limiteInferior, Math.min(novoTempo, limiteSuperior));
  const pontoArredondado = Number(novoPonto.toFixed(3));

  return blocos.map((bloco) => {
    const palavras = (bloco.palavras || []).map((p) => {
      if (p.id === palavraEsquerdaId) return { ...p, fim: pontoArredondado };
      if (p.id === palavraDireitaId) return { ...p, inicio: pontoArredondado };
      return p;
    });
    return { ...bloco, palavras };
  });
}

// Move uma palavra livremente para um novo intervalo [novoInicio, novoFim],
// sem manter contato obrigatório com as vizinhas (ao contrário do resize por
// alça, que é "ripple"). Qualquer palavra (do mesmo bloco ou de outro) cuja
// janela de tempo seja invadida pelo novo intervalo é recortada
// proporcionalmente à área coberta: se a sobreposição consome a palavra
// inteira, ela é removida; se cobre só uma ponta, essa ponta é cortada.
function aplicarMoverPalavraComCorte(blocos, { palavraId, novoInicio, novoFim, duracaoMinima }) {
  const inicioAlvo = Math.min(novoInicio, novoFim - duracaoMinima);
  const fimAlvo = Math.max(novoFim, inicioAlvo + duracaoMinima);

  // Passo 1: aplica o novo intervalo na palavra movida.
  let blocosAtualizados = blocos.map((bloco) => {
    const indice = (bloco.palavras || []).findIndex((p) => p.id === palavraId);
    if (indice === -1) return bloco;
    const palavras = bloco.palavras.map((p) => ({ ...p }));
    palavras[indice] = {
      ...palavras[indice],
      inicio: Number(inicioAlvo.toFixed(3)),
      fim: Number(fimAlvo.toFixed(3)),
    };
    return { ...bloco, palavras };
  });

  // Passo 2: para cada outra palavra que se sobrepõe ao novo intervalo,
  // recorta a área coberta. Palavras cuja sobra fique menor que a duração
  // mínima são removidas.
  blocosAtualizados = blocosAtualizados.map((bloco) => {
    const palavrasFiltradas = [];

    for (const palavra of bloco.palavras || []) {
      if (palavra.id === palavraId) {
        palavrasFiltradas.push(palavra);
        continue;
      }

      const pInicio = palavra.inicio;
      const pFim = palavra.fim;

      const sobreposicaoInicio = Math.max(pInicio, inicioAlvo);
      const sobreposicaoFim = Math.min(pFim, fimAlvo);
      const haSobreposicao = sobreposicaoFim > sobreposicaoInicio;

      if (!haSobreposicao) {
        palavrasFiltradas.push(palavra);
        continue;
      }

      // Contida inteiramente pelo intervalo movido: apagar.
      if (inicioAlvo <= pInicio && fimAlvo >= pFim) {
        continue; // remove a palavra
      }

      // Sobreposição só na ponta esquerda da palavra existente (o bloco
      // movido cobre o começo dela) -> encurta pela esquerda.
      if (inicioAlvo <= pInicio && fimAlvo < pFim) {
        const novoInicioPalavra = fimAlvo;
        if (pFim - novoInicioPalavra < duracaoMinima) continue; // vira menor que o mínimo -> remove
        palavrasFiltradas.push({
          ...palavra,
          inicio: Number(novoInicioPalavra.toFixed(3)),
        });
        continue;
      }

      // Sobreposição só na ponta direita da palavra existente -> encurta
      // pela direita.
      if (fimAlvo >= pFim && inicioAlvo > pInicio) {
        const novoFimPalavra = inicioAlvo;
        if (novoFimPalavra - pInicio < duracaoMinima) continue;
        palavrasFiltradas.push({
          ...palavra,
          fim: Number(novoFimPalavra.toFixed(3)),
        });
        continue;
      }

      // Sobreposição no meio da palavra existente (o bloco movido "fura" o
      // centro dela): ficamos com a parte esquerda restante, já que não dá
      // para dividir uma única palavra em duas. Se a parte esquerda for
      // menor que o mínimo, ficamos com a direita; se ambas forem menores
      // que o mínimo, a palavra é removida.
      const restanteEsquerda = inicioAlvo - pInicio;
      const restanteDireita = pFim - fimAlvo;
      if (restanteEsquerda >= duracaoMinima) {
        palavrasFiltradas.push({ ...palavra, fim: Number(inicioAlvo.toFixed(3)) });
      } else if (restanteDireita >= duracaoMinima) {
        palavrasFiltradas.push({ ...palavra, inicio: Number(fimAlvo.toFixed(3)) });
      }
      // senão: remove a palavra (sobra em ambos os lados era menor que o mínimo)
    }

    // Reordena por início, já que a palavra movida pode ter mudado de posição
    // relativa às outras.
    palavrasFiltradas.sort((a, b) => a.inicio - b.inicio);

    return { ...bloco, palavras: palavrasFiltradas };
  });

  return blocosAtualizados;
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

  const aoSelecionarPalavra = useCallback((id, comCtrl) => {
    setModoEdicao(MODO_SELECAO);
    if (comCtrl) {
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
        const novosBlocos = aplicarResizeIndividual(projetoAtual.blocos, {
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

  // Redimensiona a JUNÇÃO entre duas palavras coladas (arrasta o ponto de
  // contato, movendo o fim de uma e o início da outra ao mesmo tempo). Só
  // é chamado pela TelaTimeline quando o cursor está sobre a lacuna entre
  // dois blocos adjacentes (gap ~0), nunca dentro de um retângulo.
  const aoRedimensionarJuncao = useCallback(
    ({ palavraEsquerdaId, palavraDireitaId, novoTempo, duracaoMinima }) => {
      setProjeto((projetoAtual) => {
        if (!projetoAtual) return projetoAtual;
        const novosBlocos = aplicarResizeJuncao(projetoAtual.blocos, {
          palavraEsquerdaId,
          palavraDireitaId,
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

  // Move uma palavra inteira (arrastando pelo centro do bloco) para uma
  // nova posição no tempo, preservando sua duração. Ao contrário do
  // redimensionamento por alça (ripple, mantém contato com vizinhas), aqui
  // a palavra pode ser solta em qualquer posição livre da timeline; se ela
  // for solta sobre outra(s) palavra(s), a área sobreposta é recortada das
  // palavras atingidas (ou elas são removidas, se totalmente cobertas).
  const aoMoverPalavra = useCallback(
    ({ palavraId, novoInicio, novoFim, duracaoMinima }) => {
      setProjeto((projetoAtual) => {
        if (!projetoAtual) return projetoAtual;
        const novosBlocos = aplicarMoverPalavraComCorte(projetoAtual.blocos, {
          palavraId,
          novoInicio,
          novoFim,
          duracaoMinima,
        });
        return { ...projetoAtual, blocos: novosBlocos };
      });
    },
    []
  );

  // Persiste no servidor o estado final apos soltar o bloco (evita PATCH a
  // cada pixel de arraste; so grava quando o usuario solta o mouse).
  const aoFinalizarMoverPalavra = useCallback(() => {
    if (!projetoId) return;
    setProjeto((projetoAtual) => {
      if (!projetoAtual) return projetoAtual;
      fetch(`/api/projetos/${projetoId}/blocos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocos: projetoAtual.blocos }),
      }).catch((err) => {
        console.error('Falha:', err);
      });
      return projetoAtual;
    });
  }, [projetoId]);

  // CORREÇÃO (agulha não acompanhava o play): este efeito é o único
  // lugar que escuta os eventos reais do Remotion Player
  // (frameupdate/play/pause/ended). `estaTocando` e `tempoAtualSegundos`
  // vindos daqui são passados tanto para a tela de Editor quanto para a
  // tela de Timeline — nenhuma das duas mais mantém seu próprio estado
  // de "está tocando" ou seu próprio clock.
  //
  // BUG CORRIGIDO: antes este efeito dependia só de `[projeto]`. Como o
  // <Player> do Remotion é montado via createPortal dentro de um slot
  // (`slotEditor`/`slotTimeline`) que só existe DEPOIS do primeiro
  // render, `playerRef.current` ainda era `null` no momento em que este
  // efeito rodava — o efeito então caía no early return e o listener de
  // `frameupdate` NUNCA era registrado. Resultado: o vídeo tocava
  // normalmente (o Player tem seus próprios controles internos), mas
  // `tempoAtualSegundos` no App nunca era atualizado, então a agulha
  // (e o wavesurfer) ficavam parados. Agora o efeito depende também de
  // `slotEditor`/`slotTimeline`, que só passam a existir depois que o
  // portal monta — e ainda assim faz um pequeno polling via
  // requestAnimationFrame como rede de segurança, caso o ref do Player
  // demore um tick extra para ser preenchido.
  useEffect(() => {
    let cancelado = false;
    let tentativaId = null;
    let limpar = null;

    function registrar(player) {
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
    }

    function tentarRegistrar() {
      if (cancelado) return;
      const player = playerRef.current;
      if (player) {
        limpar = registrar(player);
      } else {
        // Ref ainda não disponível neste tick (portal ainda montando) —
        // tenta de novo no próximo frame até conseguir ou desmontar.
        tentativaId = requestAnimationFrame(tentarRegistrar);
      }
    }

    tentarRegistrar();

    return () => {
      cancelado = true;
      if (tentativaId) cancelAnimationFrame(tentativaId);
      if (limpar) limpar();
    };
  }, [projeto, slotEditor]);

  const aoBuscarTempo = useCallback((segundos) => {
    const player = playerRef.current;
    if (!player) return;
    const frame = Math.round(segundos * FPS);
    player.seekTo(frame);
    setTempoAtualSegundos(segundos);
  }, []);

  // CORREÇÃO (sincronia vídeo/áudio): esta função age diretamente sobre
  // o Remotion Player (única fonte de verdade de play/pause). Antes, o
  // botão de play da tela de Timeline não usava esta função — chamava
  // apenas `setTocandoLocal`, que só dava play/pause no WaveSurfer.
  // Agora `TelaTimeline` recebe `aoAlternarPlayPause` como prop e o
  // botão de play de lá comanda o mesmo player que o Editor usa.
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

const slotAtivo = telaAtual === TELA_EDITOR ? slotEditor : null;

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
          palavraSelecionadaId={palavraSelecionadaId}
          idsSelecionados={idsSelecionados}
          aoSelecionarPalavra={aoSelecionarPalavra}
          aoVoltarParaEditor={() => setTelaAtual(TELA_EDITOR)}
          aoRedimensionarPalavra={aoRedimensionarPalavra}
          aoRedimensionarJuncao={aoRedimensionarJuncao}
          aoMoverPalavra={aoMoverPalavra}
          aoFinalizarMoverPalavra={aoFinalizarMoverPalavra}
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
                  — clique para editar, ctrl+clique para grupo
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
              Clique em uma palavra na lista à esquerda (ou ctrl+clique
              para um grupo) para editar seu estilo individual.
            </div>
          )}

          {modoEdicao === MODO_SELECAO && palavraSelecionada && (
            <PainelPropriedades
              estilo={estiloEmEdicao}
              // O título muda de forma inteligente consoante o número de palavras selecionadas
              titulo={idsSelecionados.length > 1
                ? `Múltiplas palavras (${idsSelecionados.length})`
                : `Palavra: "${palavraSelecionada.texto}"`}
              aoMudar={(parcial) => atualizarEstiloPalavra(palavraSelecionada.id, parcial)}
              aoLimparOverride={() => limparOverride(palavraSelecionada.id)}
            />
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