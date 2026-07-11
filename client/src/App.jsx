// client/src/App.jsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Player } from '@remotion/player';
import { CaptionComposition } from './remotion/CaptionComposition';
import { TelaImportacao } from './components/TelaImportacao';
import { ListaPalavras } from './components/ListaPalavras';
import { PainelPropriedades } from './components/PainelPropriedades';
import { PainelMargens } from './components/PainelMargens';
import { PainelExportacao } from './components/PainelExportacao';
import { PainelSincronizacaoAudio } from './components/PainelSincronizacaoAudio';
import { PainelEditorSrt } from './components/PainelEditorSrt';
import { TelaTimeline } from './components/TelaTimeline';

import * as projectModel from '../../shared/projectModel';

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

function redimensionarBlocoEPalavras(bloco, novoInicio, novoFim) {
  const duracaoAntiga = bloco.fim - bloco.inicio;
  const duracaoNova = novoFim - novoInicio;
  const escala = duracaoAntiga > 0 ? duracaoNova / duracaoAntiga : 1;

  const palavras = bloco.palavras.map((p) => ({
    ...p,
    inicio: novoInicio + (p.inicio - bloco.inicio) * escala,
    fim: novoInicio + (p.fim - bloco.inicio) * escala,
  }));

  return { ...bloco, inicio: novoInicio, fim: novoFim, palavras };
}

function aplicarResizeBlocoComAdaptacao(blocos, { blocoId, novoInicio, novoFim }) {
  const indexAlvo = blocos.findIndex((b) => b.id === blocoId);
  if (indexAlvo === -1) return blocos;

  let novosBlocos = [...blocos];
  const GAP = 0;

  const inicioSeguro = Math.min(novoInicio, novoFim - 0.1);
  const fimSeguro = Math.max(novoFim, novoInicio + 0.1);

  novosBlocos[indexAlvo] = redimensionarBlocoEPalavras(novosBlocos[indexAlvo], inicioSeguro, fimSeguro);

  for (let i = indexAlvo - 1; i >= 0; i--) {
    const blocoAnterior = novosBlocos[i];
    const blocoPosterior = novosBlocos[i + 1];

    if (blocoAnterior.fim > blocoPosterior.inicio - GAP) {
      const novoFimAdaptado = blocoPosterior.inicio - GAP;
      const novoInicioAdaptado = Math.min(blocoAnterior.inicio, novoFimAdaptado - 0.1);

      novosBlocos[i] = redimensionarBlocoEPalavras(blocoAnterior, novoInicioAdaptado, novoFimAdaptado);
    } else {
      break;
    }
  }

  for (let i = indexAlvo + 1; i < novosBlocos.length; i++) {
    const blocoProximo = novosBlocos[i];
    const blocoAnterior = novosBlocos[i - 1];

    if (blocoProximo.inicio < blocoAnterior.fim + GAP) {
      const novoInicioAdaptado = blocoAnterior.fim + GAP;
      const novoFimAdaptado = Math.max(blocoProximo.fim, novoInicioAdaptado + 0.1);

      novosBlocos[i] = redimensionarBlocoEPalavras(blocoProximo, novoInicioAdaptado, novoFimAdaptado);
    } else {
      break;
    }
  }

  return novosBlocos;
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

function aplicarResizeIndividual(blocos, { palavraId, lado, novoTempo, duracaoMinima }) {
  const todasPalavras = blocos.flatMap((b) => b.palavras || []);

  return blocos.map((bloco) => {
    const indice = (bloco.palavras || []).findIndex((p) => p.id === palavraId);
    if (indice === -1) return bloco;

    const palavras = bloco.palavras.map((p) => ({ ...p }));
    const alvo = palavras[indice];

    if (lado === 'direita') {
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

    const novoInicioBloco = palavras[0]?.inicio ?? bloco.inicio;
    return { ...bloco, palavras, inicio: novoInicioBloco };
  });
}

const LIMIAR_JUNCAO_SEGUNDOS = 0.02;

function aplicarResizeJuncao(blocos, { palavraEsquerdaId, palavraDireitaId, novoTempo, duracaoMinima }) {
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

    const novoInicioBloco = palavras[0]?.inicio ?? bloco.inicio;
    return { ...bloco, palavras, inicio: novoInicioBloco };
  });
}

function aplicarMoverPalavraComCorte(blocos, { palavraId, novoInicio, novoFim, duracaoMinima }) {
  const inicioAlvo = Math.min(novoInicio, novoFim - duracaoMinima);
  const fimAlvo = Math.max(novoFim, inicioAlvo + duracaoMinima);

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

      if (inicioAlvo <= pInicio && fimAlvo >= pFim) {
        continue;
      }

      if (inicioAlvo <= pInicio && fimAlvo < pFim) {
        const novoInicioPalavra = fimAlvo;
        if (pFim - novoInicioPalavra < duracaoMinima) continue;
        palavrasFiltradas.push({
          ...palavra,
          inicio: Number(novoInicioPalavra.toFixed(3)),
        });
        continue;
      }

      if (fimAlvo >= pFim && inicioAlvo > pInicio) {
        const novoFimPalavra = inicioAlvo;
        if (novoFimPalavra - pInicio < duracaoMinima) continue;
        palavrasFiltradas.push({
          ...palavra,
          fim: Number(novoFimPalavra.toFixed(3)),
        });
        continue;
      }

      const restanteEsquerda = inicioAlvo - pInicio;
      const restanteDireita = pFim - fimAlvo;
      if (restanteEsquerda >= duracaoMinima) {
        palavrasFiltradas.push({ ...palavra, fim: Number(inicioAlvo.toFixed(3)) });
      } else if (restanteDireita >= duracaoMinima) {
        palavrasFiltradas.push({ ...palavra, inicio: Number(fimAlvo.toFixed(3)) });
      }
    }

    palavrasFiltradas.sort((a, b) => a.inicio - b.inicio);

    const novoInicioBloco = palavrasFiltradas[0]?.inicio ?? bloco.inicio;
    return { ...bloco, palavras: palavrasFiltradas, inicio: novoInicioBloco };
  });

  return blocosAtualizados;
}

function ajustarLimitesEOverlaps(blocos) {
  if (!blocos) return [];

  // 1. Sincroniza o início e o fim de cada bloco com suas próprias palavras internas
  let novosBlocos = blocos.map(bloco => {
    if (!bloco.palavras || bloco.palavras.length === 0) return bloco;

    const palavrasOrdenadas = [...bloco.palavras].sort((a, z) => a.inicio - z.inicio);
    return {
      ...bloco,
      palavras: palavrasOrdenadas,
      inicio: palavrasOrdenadas[0].inicio,
      fim: palavrasOrdenadas[palavrasOrdenadas.length - 1].fim
    };
  });

  // Garante a ordenação cronológica geral antes de calcular colisões
  novosBlocos.sort((a, z) => a.inicio - z.inicio);

  // 2. Corta de forma implacável colisões de tempo (overlap) sequenciais
  for (let i = 1; i < novosBlocos.length; i++) {
    const blocoAnterior = novosBlocos[i - 1];
    const blocoAtual = novosBlocos[i];

    if (blocoAtual.inicio < blocoAnterior.fim) {
      const tetoFim = blocoAtual.inicio;

      // Ajusta as palavras da frase anterior para respeitar o teto de tempo
      const palavrasAjustadas = blocoAnterior.palavras
        .map(p => {
          if (p.fim > tetoFim) {
            const novoFim = Math.max(p.inicio + 0.05, tetoFim);
            return { ...p, fim: Number(novoFim.toFixed(3)) };
          }
          return p;
        })
        .filter(p => p.inicio < tetoFim); // Remove palavras que começarem após o teto

      blocoAnterior.palavras = palavrasAjustadas;

      if (palavrasAjustadas.length > 0) {
        blocoAnterior.inicio = palavrasAjustadas[0].inicio;
        blocoAnterior.fim = palavrasAjustadas[palavrasAjustadas.length - 1].fim;
      } else {
        blocoAnterior.inicio = tetoFim;
        blocoAnterior.fim = tetoFim;
      }
    }
  }

  return novosBlocos;
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

  const aoLimparSelecao = useCallback(() => {
    setPalavraSelecionadaId(null);
    setIdsSelecionados([]);
    setModoEdicao(MODO_GLOBAL);
  }, []);

  const [mostrarSincronizacao, setMostrarSincronizacao] = useState(false);
  const [mostrarEditorSrt, setMostrarEditorSrt] = useState(false);
  const [alturaPainelFerramentas, setAlturaPainelFerramentas] = useState(300);
  const [estaArrastandoPainel, setEstaArrastandoPainel] = useState(false);

  const [dimensoesVideo, setDimensoesVideo] = useState({ largura: 1080, altura: 1920 });

  const playerRef = useRef(null);
  const [slotEditor, setSlotEditor] = useState(null);
  const debounceResizeRef = useRef(null);

  const aoCriarProjeto = useCallback((id, proj) => {
    setProjetoId(id);
    if (proj && proj.blocos) {
      proj.blocos = ajustarLimitesEOverlaps(proj.blocos);
    }
    setProjeto(proj);
  }, []);

  function aoAtualizarProjeto(novoProjeto) {
    if (novoProjeto && novoProjeto.blocos) {
      novoProjeto.blocos = ajustarLimitesEOverlaps(novoProjeto.blocos);
    }
    setProjeto(novoProjeto);
  }

  // RESTAURAÇÃO: useEffect original buscando metadados de vídeo.
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
      setIdsSelecionados((prev) => {
        const base = prev.length === 0 && palavraSelecionadaId && palavraSelecionadaId !== id
          ? [palavraSelecionadaId]
          : prev;

        return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      });
    } else {
      setPalavraSelecionadaId(id);
      setIdsSelecionados([]);
    }
  }, [palavraSelecionadaId]);

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

  async function atualizarGuiaMargens(parcial) {
    const resp = await fetch(`/api/projetos/${projetoId}/guia-margens`, {
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

  function aoAtualizarProjeto(novoProjeto) {
    setProjeto(novoProjeto);
  }

  const alterarTempoDoBloco = useCallback((blocoId, novoInicio, novoFim) => {
    setProjeto((projetoAtual) => {
      if (!projetoAtual) return projetoAtual;
      const novosBlocos = aplicarResizeBlocoComAdaptacao(projetoAtual.blocos, {
        blocoId,
        novoInicio,
        novoFim,
      });
      return { ...projetoAtual, blocos: ajustarLimitesEOverlaps(novosBlocos) };
    });
  }, []);

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
        // Correção: usando novosBlocos e fechando o setProjeto corretamente
        return { ...projetoAtual, blocos: ajustarLimitesEOverlaps(novosBlocos) };
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
        // Correção: usando novosBlocos e removendo o fechamento duplo precoce
        return { ...projetoAtual, blocos: ajustarLimitesEOverlaps(novosBlocos) };
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
        // Correção: usando novosBlocos
        return { ...projetoAtual, blocos: ajustarLimitesEOverlaps(novosBlocos) };
      });
    },
    []
  );

  const aoMoverPalavraEntreBlocos = useCallback((palavraId, blocoDestinoId, indexDestino) => {
    setProjeto((projetoAtual) => {
      if (!projetoAtual) return projetoAtual;

      let palavraMovida = null;
      let blocoOrigemId = null;
      let indexOrigem = -1;

      // 1. Descobre de onde a palavra está vindo antes de retirá-la
      projetoAtual.blocos.forEach(b => {
        const idx = b.palavras.findIndex(p => p.id === palavraId);
        if (idx !== -1) {
          palavraMovida = { ...b.palavras[idx] };
          blocoOrigemId = b.id;
          indexOrigem = idx;
        }
      });

      if (!palavraMovida) return projetoAtual;

      // 2. Corrige o alvo: se a palavra saiu de trás e foi para frente no mesmo bloco,
      // o array encolheu 1 posição, então diminuímos 1 do destino para compensar.
      let indexCorrigido = indexDestino;
      if (blocoOrigemId === blocoDestinoId && indexOrigem < indexDestino) {
        indexCorrigido -= 1;
      }

      // 3. Remove a palavra da lista original
      const blocosSemPalavra = projetoAtual.blocos.map((b) => ({
        ...b,
        palavras: b.palavras.filter((p) => p.id !== palavraId),
      }));

      // 4. Insere no lugar certo cravando o Tempo (em segundos)
      const blocosFinal = blocosSemPalavra.map((b) => {
        if (b.id !== blocoDestinoId) return b;

        let novasPalavras = [...b.palavras];
        let tempoNovo = b.inicio;

        if (novasPalavras.length === 0) {
          // Bloco vazio
          tempoNovo = b.inicio;
        } else if (indexCorrigido <= 0) {
          // Colocando bem no começo
          tempoNovo = Math.max(b.inicio, novasPalavras[0].inicio - 0.02);
        } else if (indexCorrigido >= novasPalavras.length) {
          // Colocando lá no final
          tempoNovo = novasPalavras[novasPalavras.length - 1].fim + 0.02;
        } else {
          // Soltou NO MEIO: calcula o tempo exato (ponto-médio) entre as duas palavras vizinhas
          const pAnterior = novasPalavras[indexCorrigido - 1];
          const pProxima = novasPalavras[indexCorrigido];

          if (pProxima.inicio > pAnterior.inicio) {
            tempoNovo = pAnterior.inicio + ((pProxima.inicio - pAnterior.inicio) / 2);
          } else {
            // Caso excepcional onde duas palavras tenham tempos exatos encavalados
            tempoNovo = pAnterior.inicio + 0.001;
          }
        }

        // Atualiza a palavra para assumir o milissegundo do espaço exato e trava na posição
        palavraMovida.inicio = Number(tempoNovo.toFixed(3));
        palavraMovida.fim = Number((tempoNovo + 0.01).toFixed(3));

        novasPalavras.splice(indexCorrigido, 0, palavraMovida);

        // Agora a ordenação cronológica não vai mais estragar o lugar
        return { ...b, palavras: novasPalavras.sort((a, z) => a.inicio - z.inicio) };
      });

      // 5. Salva na API back-end
      fetch(`/api/projetos/${projetoId}/blocos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocos: blocosFinal }),
      }).catch((err) => console.error('Falha ao salvar blocos:', err));

      return { ...projetoAtual, blocos: blocosFinal };
    });
  }, [projetoId]);

const aoAlterarTempoBloco = useCallback((blocoId, novoInicio, novoFim) => {
    setProjeto((projetoAtual) => {
      if (!projetoAtual) return projetoAtual;

      const blocosAtualizados = projetoAtual.blocos.map((b) => {
        if (b.id === blocoId) {
          const diferencaInicio = novoInicio - b.inicio;

          const palavrasAjustadas = b.palavras.map((p) => ({
            ...p,
            inicio: Number((p.inicio + diferencaInicio).toFixed(3)),
            fim: Number((p.fim + diferencaInicio).toFixed(3))
          }));

          return { 
            ...b, 
            inicio: Number(novoInicio), 
            fim: Number(novoFim),
            palavras: palavrasAjustadas
          };
        }
        return b;
      });

      blocosAtualizados.sort((a, z) => a.inicio - z.inicio);
      const blocosAjustados = ajustarLimitesEOverlaps(blocosAtualizados);

      // Envia a modificação perfeitamente limpa e sem colisão para o Back-end
      fetch(`/api/projetos/${projetoId}/blocos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocos: blocosAjustados }),
      }).catch((err) => console.error('Falha ao salvar tempos do bloco:', err));

      return { ...projetoAtual, blocos: blocosAjustados };
    });
  }, [projetoId]);

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
        tentativaId = requestAnimationFrame(tentarRegistrar);
      }
    }

    tentarRegistrar();

    return () => {
      cancelado = true;
      if (tentativaId) cancelAnimationFrame(tentativaId);
      if (limpar) limpar();
    };
  }, [slotEditor]);

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

  // =========================================================================
  // FIX: Hooks moved safely BEFORE the `if (!projeto)` early return.
  // Optional chaining (?.) is used to prevent errors when projeto is null.
  // =========================================================================
  const urlVideo = resolverUrlVideo(projeto?.caminhoVideo);
  const duracaoFrames = calcularDuracaoFrames(projeto?.blocos);
  const larguraProjeto = dimensoesVideo.largura;
  const alturaProjeto = dimensoesVideo.altura;

  const playerInputProps = useMemo(() => ({
    projeto,
    corFundo: urlVideo ? 'transparent' : '#1a1a1a',
    videoPreviewSrc: urlVideo,
    guiaMargens: projeto?.guiaMargens,
    // modoPreview=true SÓ é passado aqui, pelo <Player> do editor. O
    // pipeline de renderização final (@remotion/renderer, server/index.js)
    // nunca passa essa prop — é o que garante que a guia de margens
    // seguras (ver CaptionComposition.jsx) nunca apareça no vídeo
    // exportado, mesmo que esteja ativada no projeto.
    modoPreview: true,
  }), [projeto, urlVideo]);

  const playerElement = useMemo(() => {
    if (!projeto) return null; // Early return for useMemo if project is missing

    return (
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
          inputProps={playerInputProps}
        />
      </PreviewErrorBoundary>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projeto, duracaoFrames, larguraProjeto, alturaProjeto, telaAtual, playerInputProps]);

  // =========================================================================
  // EARLY RETURN 
  // Ocorre de forma segura APÓS a declaração de todos os hooks do componente.
  // =========================================================================
  if (!projeto) {
    return <TelaImportacao aoCriarProjeto={aoCriarProjeto} />;
  }

  // =========================================================================
  // VARIÁVEIS NORMAIS
  // =========================================================================
  const videoDeveFicarNaDireita = larguraProjeto > 1080;
  const duracaoSegundos = duracaoFrames / FPS;

  const palavraSelecionada = palavraSelecionadaId
    ? encontrarPalavra(projeto.blocos, palavraSelecionadaId)
    : null;

  const estiloEmEdicao = palavraSelecionada
    ? { ...projeto.estiloPadrao, ...(palavraSelecionada.estilo || {}) }
    : projeto.estiloPadrao;

  const haSelecao = !!palavraSelecionada || idsSelecionados.length > 0;

  const textoAtualDasLegendas = (projeto.blocos || [])
    .map((bloco) => (bloco?.palavras || []).map((p) => p?.texto || '').join(' '))
    .join(' ');

  const slotAtivo = telaAtual === TELA_EDITOR ? slotEditor : null;
  const playerPortado = slotAtivo ? createPortal(playerElement, slotAtivo) : null;

  return (
    <>
      {playerPortado}

      <div style={{ display: telaAtual === TELA_TIMELINE ? 'block' : 'none', height: '100vh', width: '100vw' }}>
        <TelaTimeline
          projeto={projeto}
          projetoId={projetoId}
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
          aoAlterarTempoBloco={aoAlterarTempoBloco}
        />
      </div>

      <div
        className="app-shell"
        style={{
          display: telaAtual === TELA_EDITOR ? 'flex' : 'none',
          gap: '24px',
          flexDirection: 'row',
          height: '100vh',
          width: '100vw',
          padding: '24px',
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          minHeight: 0
        }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <h2 className="app-title" style={{ margin: 0 }}>{projeto.nome}</h2>
            <div style={{ display: 'flex', gap: '10px' }}>

              <button
                className={`btn ${mostrarEditorSrt ? 'btn--primary' : ''}`}
                onClick={() => setMostrarEditorSrt(!mostrarEditorSrt)}
                style={{ padding: '8px 16px', fontWeight: 600, borderColor: 'var(--accent-amber)' }}
              >
                {mostrarEditorSrt ? 'Fechar Editor SRT' : 'Editar Legenda'}
              </button>

              <button
                className={`btn ${mostrarSincronizacao ? 'btn--primary' : ''}`}
                onClick={() => setMostrarSincronizacao(!mostrarSincronizacao)}
                style={{ padding: '8px 16px', fontWeight: 600, borderColor: 'var(--accent-amber)' }}
              >
                {mostrarSincronizacao ? 'Fechar Sincronização' : 'Sincronização Automática'}
              </button>

              <button className="btn" onClick={() => setTelaAtual(TELA_TIMELINE)} style={{ padding: '8px 16px', fontWeight: 600, borderColor: 'var(--accent-amber)' }}>
                Abrir Timeline →
              </button>
            </div>
          </div>

          {mostrarEditorSrt && (
            <PainelEditorSrt
              projeto={projeto}
              projetoId={projetoId}
              aoAtualizarProjeto={aoAtualizarProjeto}
            />
          )}

          {!urlVideo && (
            <p className="status-line status-line--info" style={{ margin: 0, flexShrink: 0 }}>
              Nenhum vídeo de referência selecionado — o preview mostra só a legenda.
            </p>
          )}

          <div style={{
            display: 'flex',
            flexDirection: videoDeveFicarNaDireita ? 'row-reverse' : 'row',
            gap: '24px',
            flex: 1,
            minHeight: 0,
            alignItems: 'stretch'
          }}>

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

            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0
            }}>
              <h3 className="panel-title" style={{ marginBottom: 10, fontSize: 13, flexShrink: 0 }}>
                Palavras <span style={{ textTransform: 'none', color: 'var(--text-tertiary)', fontWeight: 400, letterSpacing: 0 }}>
                  — clique para editar, ctrl+clique para grupo
                </span>
              </h3>

              <div style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                border: '1px solid var(--hairline)',
                borderRadius: '8px',
                background: 'var(--bg-panel)',
                padding: '12px',
                paddingBottom: '24px'
              }}>
                <ListaPalavras
                  blocos={projeto.blocos}
                  palavraSelecionadaId={palavraSelecionadaId}
                  idsSelecionados={idsSelecionados}
                  aoSelecionarPalavra={aoSelecionarPalavra}
                  aoLimparSelecao={aoLimparSelecao}
                  aoMoverPalavraEntreBlocos={aoMoverPalavraEntreBlocos}
                />
              </div>
            </div>

          </div>

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

        <div style={{
          width: '340px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          minHeight: 0,
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

          {modoEdicao === MODO_GLOBAL && (
            <PainelMargens
              guiaMargens={projeto.guiaMargens}
              aoMudar={atualizarGuiaMargens}
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