// server/render.js
const path = require('path');
const fs = require('fs');
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

// Formatos suportados e seus parâmetros de codec correspondentes.
const CONFIG_POR_FORMATO = {
  'mov-alpha': {
    codec: 'prores',
    proResProfile: '4444',
    imageFormat: 'png',
    extensao: 'mov',
  },
  'mp4-fundo-solido': {
    codec: 'h264',
    imageFormat: 'jpeg',
    extensao: 'mp4',
  },
};

async function exportarProjeto({ projeto, formato, corFundo, outputDir }) {
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

  if (formato === 'png-sequence') {
    return await exportarSequenciaPNG({ bundleUrl, composition, inputProps, outputDir, nomeBase });
  }

  const config = CONFIG_POR_FORMATO[formato];
  if (!config) {
    throw new Error(`Formato de exportação desconhecido: "${formato}"`);
  }

  const outputLocation = path.join(outputDir, `${nomeBase}.${config.extensao}`);

  await renderMedia({
    composition,
    serveUrl: bundleUrl,
    codec: config.codec,
    proResProfile: config.proResProfile,
    outputLocation,
    inputProps,
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
async function exportarSequenciaPNG({ bundleUrl, composition, inputProps, outputDir, nomeBase }) {
  const sequenciaDir = path.join(outputDir, `${nomeBase}_png_sequence`);
  fs.mkdirSync(sequenciaDir, { recursive: true });

  const totalFrames = composition.durationInFrames;
  const digitos = String(totalFrames).length;

  for (let frame = 0; frame < totalFrames; frame++) {
    const nomeArquivo = `frame_${String(frame).padStart(digitos, '0')}.png`;
    await renderStill({
      composition,
      serveUrl: bundleUrl,
      output: path.join(sequenciaDir, nomeArquivo),
      frame,
      inputProps,
      imageFormat: 'png',
    });
  }

  return {
    formato: 'png-sequence',
    arquivo: `/exports/${path.basename(sequenciaDir)}/`,
    caminhoAbsoluto: sequenciaDir,
    totalFrames,
  };
}

module.exports = { exportarProjeto };
