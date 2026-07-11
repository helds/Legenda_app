// server/render.js
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { bundle } = require('@remotion/bundler');
const { renderMedia, renderStill, selectComposition } = require('@remotion/renderer');

const ENTRY_POINT = path.join(__dirname, '..', 'client', 'src', 'remotion', 'index.js');

let cachedBundleUrl = null;

// O bundle (build do Webpack que o Remotion usa por baixo dos panos) é
// pesado de gerar — fazemos cache em memória pra não recompilar a cada
// exportação dentro da mesma sessão do servidor.
async function obterBundle() {
  if (cachedBundleUrl) return cachedBundleUrl;
  cachedBundleUrl = await bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride: (config) => config,
  });
  return cachedBundleUrl;
}

// ---------------------------------------------------------------------
// GPU (aceleração de renderização via Chromium)
// ---------------------------------------------------------------------
// Por padrão o Remotion roda o Chromium headless em modo software
// (SwiftShader/"swangle"), que é lento mas funciona em qualquer máquina,
// inclusive servidores sem GPU. 'angle' liga a aceleração real via GPU
// no Windows/Linux com driver disponível — muito mais rápido, mas só
// funciona se existir GPU física acessível ao processo.
//
// Controlado por variável de ambiente pra não quebrar em produção caso
// o servidor final não tenha GPU (ex: VPS comum). Localmente, com GPU
// dedicada, isso já vem ligado por padrão.
//
//   RENDER_GPU=off   -> força modo software (mais seguro em servidores sem GPU)
//   RENDER_GPU=angle -> força ANGLE (Windows/Linux com driver)
//   RENDER_GPU=egl   -> força EGL (Linux com driver NVIDIA/Mesa configurado)
//   (sem variável)   -> usa 'angle' (assume ambiente local com GPU)
const MODO_GPU = process.env.RENDER_GPU || 'angle';

function obterChromiumOptions() {
  if (MODO_GPU === 'off') return {};
  return { gl: MODO_GPU };
}

// ---------------------------------------------------------------------
// Jobs em memória (progresso de exportação)
// ---------------------------------------------------------------------
// Estrutura simples em memória — suficiente pra um único processo Node.
// Se o server rodar com múltiplas instâncias/processos no futuro (PM2
// cluster, múltiplos containers), isso precisa virar Redis ou similar,
// já que cada processo teria seu próprio Map isolado.
const jobs = new Map();

function criarJob() {
  const jobId = crypto.randomUUID();
  jobs.set(jobId, {
    progresso: 0,
    tempoRestanteSegundos: null,
    concluido: false,
    erro: null,
    resultado: null,
    criadoEm: Date.now(),
  });
  return jobId;
}

function atualizarJob(jobId, patch) {
  const atual = jobs.get(jobId);
  if (!atual) return;
  jobs.set(jobId, { ...atual, ...patch });
}

function obterJob(jobId) {
  return jobs.get(jobId) || null;
}

// Limpeza básica: jobs concluídos há mais de 1h saem da memória, pra não
// vazar memória em um server de longa duração.
setInterval(() => {
  const umaHoraAtras = Date.now() - 60 * 60 * 1000;
  for (const [jobId, job] of jobs.entries()) {
    if (job.concluido && job.criadoEm < umaHoraAtras) {
      jobs.delete(jobId);
    }
  }
}, 15 * 60 * 1000).unref();

// Formatos suportados e seus parâmetros de codec correspondentes.
const CONFIG_POR_FORMATO = {
  'mov-alpha': {
    codec: 'prores',
    proResProfile: '4444',
    imageFormat: 'png',
    // CRÍTICO para transparência: sem `pixelFormat: 'yuva444p10le'`, o
    // FFmpeg usa o pixel format padrão do ProRes 4444, que NÃO carrega
    // canal alfa — o vídeo sai com fundo preto opaco mesmo pedindo
    // codec/profile corretos. yuva444p10le é o único pixel format que o
    // Remotion suporta para ProRes com transparência real (ver docs:
    // https://www.remotion.dev/docs/transparent-videos).
    pixelFormat: 'yuva444p10le',
    extensao: 'mov',
  },
  'mp4-fundo-solido': {
    codec: 'h264',
    imageFormat: 'jpeg',
    extensao: 'mp4',
  },
};

// Inicia a exportação em background e retorna um jobId imediatamente.
// A rota HTTP deve responder com { jobId } assim que essa função retorna,
// sem esperar a Promise interna de renderização terminar.
function iniciarExportacao({ projeto, formato, corFundo, outputDir }) {
  const jobId = criarJob();

  processarExportacao({ jobId, projeto, formato, corFundo, outputDir }).catch((err) => {
    // Segurança extra: se algo escapar do try/catch interno, ainda assim
    // o job é marcado com erro em vez de ficar "travado" em progresso.
    atualizarJob(jobId, {
      concluido: true,
      erro: err.message || 'Erro desconhecido na exportação.',
    });
  });

  return jobId;
}

async function processarExportacao({ jobId, projeto, formato, corFundo, outputDir }) {
  try {
    const bundleUrl = await obterBundle();

    const inputProps = {
      projeto,
      corFundo: formato === 'mp4-fundo-solido' ? (corFundo || '#00FF00') : 'transparent',
    };

    const composition = await selectComposition({
      serveUrl: bundleUrl,
      id: 'LegendaKaraoke',
      inputProps,
    });

    const timestamp = Date.now();
    const nomeBase = `${projeto.nome.replace(/[^a-zA-Z0-9_-]/g, '_')}_${timestamp}`;

    let resultado;
    if (formato === 'png-sequence') {
      resultado = await exportarSequenciaPNG({
        jobId, bundleUrl, composition, inputProps, outputDir, nomeBase,
      });
    } else {
      const config = CONFIG_POR_FORMATO[formato];
      if (!config) {
        throw new Error(`Formato de exportação desconhecido: "${formato}"`);
      }
      resultado = await exportarVideo({
        jobId, bundleUrl, composition, inputProps, outputDir, nomeBase, config, formato,
      });
    }

    atualizarJob(jobId, {
      progresso: 1,
      tempoRestanteSegundos: 0,
      concluido: true,
      resultado,
    });
  } catch (err) {
    atualizarJob(jobId, {
      concluido: true,
      erro: err.message || 'Erro desconhecido na exportação.',
    });
  }
}

async function exportarVideo({ jobId, bundleUrl, composition, inputProps, outputDir, nomeBase, config, formato }) {
  const outputLocation = path.join(outputDir, `${nomeBase}.${config.extensao}`);

  const inicioRender = Date.now();

  await renderMedia({
    composition,
    serveUrl: bundleUrl,
    codec: config.codec,
    proResProfile: config.proResProfile,
    pixelFormat: config.pixelFormat,
    imageFormat: config.imageFormat,
    outputLocation,
    inputProps,
    chromiumOptions: obterChromiumOptions(),
    onProgress: ({ progress }) => {
      // `progress` do renderMedia já vem normalizado entre 0 e 1.
      const decorridoSegundos = (Date.now() - inicioRender) / 1000;
      const tempoRestanteSegundos = progress > 0.02
        ? (decorridoSegundos / progress) * (1 - progress)
        : null;

      atualizarJob(jobId, {
        progresso: progress,
        tempoRestanteSegundos,
      });
    },
  });

  return {
    formato,
    arquivo: `/exports/${path.basename(outputLocation)}`,
    caminhoAbsoluto: outputLocation,
  };
}

// Renderiza cada frame como um PNG individual com transparência, em vez
// de um vídeo contínuo. Útil para importar como sequência de imagem
// diretamente no Resolve.
//
// renderStill não tem onProgress nativo (é um frame por chamada), então
// o progresso é calculado manualmente: frame atual / total de frames.
async function exportarSequenciaPNG({ jobId, bundleUrl, composition, inputProps, outputDir, nomeBase }) {
  const sequenciaDir = path.join(outputDir, `${nomeBase}_png_sequence`);
  fs.mkdirSync(sequenciaDir, { recursive: true });

  const totalFrames = composition.durationInFrames;
  const digitos = String(totalFrames).length;
  const inicioRender = Date.now();

  for (let frame = 0; frame < totalFrames; frame++) {
    const nomeArquivo = `frame_${String(frame).padStart(digitos, '0')}.png`;
    await renderStill({
      composition,
      serveUrl: bundleUrl,
      output: path.join(sequenciaDir, nomeArquivo),
      frame,
      inputProps,
      imageFormat: 'png',
      chromiumOptions: obterChromiumOptions(),
    });

    const progress = (frame + 1) / totalFrames;
    const decorridoSegundos = (Date.now() - inicioRender) / 1000;
    const tempoRestanteSegundos = progress > 0.02
      ? (decorridoSegundos / progress) * (1 - progress)
      : null;

    atualizarJob(jobId, { progresso: progress, tempoRestanteSegundos });
  }

  return {
    formato: 'png-sequence',
    arquivo: `/exports/${path.basename(sequenciaDir)}/`,
    caminhoAbsoluto: sequenciaDir,
    totalFrames,
  };
}

module.exports = { iniciarExportacao, obterJob };