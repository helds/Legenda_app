// server/waveformRoutes.js
//
// Rotas HTTP relacionadas a waveform:
//   - GET /api/waveform/:idProjeto        → picos [min, max] pré-computados
//   - GET /api/audio-extraido/:idProjeto  → trilha de áudio extraída (mp3),
//     servida com suporte a Range
//
// Ambas espelham o mesmo padrão já usado por /api/video-local: aceitam
// OU um projetoId (resolve o caminhoVideo do projeto salvo) OU um
// caminho de arquivo direto via query string.
//
// Módulo separado (em vez de editar server/index.js direto) para não
// arriscar mexer em rotas existentes sem ver o arquivo real — só
// importar e montar com `montarRotasWaveform(app, { obterProjetoPorId, uploadsDir })`
// dentro do seu server/index.js.

const fs = require('fs');
const path = require('path');
const { obterPicosComCache, obterAudioExtraidoComCache } = require('./waveformService');

/**
 * `projeto.caminhoVideo` vem em dois formatos possíveis (mesmo padrão já
 * usado pelo client em resolverUrlVideo() / App.jsx):
 *   - "/uploads/nome-do-arquivo.mp4"  → upload feito pelo próprio app,
 *     relativo a UPLOADS_DIR.
 *   - um caminho ABSOLUTO no disco    → vídeo local selecionado via
 *     diálogo nativo do Electron (mesmo caso servido por /api/video-local).
 * Aqui resolvemos sempre para um caminho absoluto de disco, porque é o
 * que o ffmpeg (rodando no processo do servidor) precisa para ler o
 * arquivo — diferente do client, que só precisa de uma URL.
 */
function resolverCaminhoArquivoDoProjeto(projeto, uploadsDir) {
  const cv = projeto?.caminhoVideo;
  if (!cv) return null;
  if (cv.startsWith('/uploads/')) {
    return path.join(uploadsDir, cv.replace('/uploads/', ''));
  }
  return cv; // já é um caminho absoluto local
}

/**
 * Resolve o caminho do arquivo de origem (vídeo/áudio) a partir OU de um
 * `?path=` direto na query, OU do projeto salvo — mesma lógica usada
 * pelas duas rotas abaixo, extraída para não duplicar.
 *
 * @returns {Promise<string|null>} caminho absoluto, ou null se não resolveu
 */
async function resolverCaminhoOrigem(req, { obterProjetoPorId, uploadsDir }) {
  const { idProjeto } = req.params;
  const { path: caminhoDireto } = req.query;

  if (caminhoDireto) return caminhoDireto;

  const projeto = await obterProjetoPorId(idProjeto);
  if (!projeto || !projeto.caminhoVideo) return null;
  return resolverCaminhoArquivoDoProjeto(projeto, uploadsDir);
}

/**
 * Serve um arquivo local com suporte a Range (necessário para o
 * WaveSurfer/<audio> conseguirem buscar sem baixar tudo de uma vez) —
 * mesma lógica já usada por /api/video-local em server/index.js, só que
 * fixa em audio/mpeg porque a origem aqui é sempre o .mp3 extraído.
 */
function servirComRange(caminho, req, res) {
  const stat = fs.statSync(caminho);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startRaw, 10);
    const end = endRaw ? parseInt(endRaw, 10) : fileSize - 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'audio/mpeg',
    });
    fs.createReadStream(caminho, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(caminho).pipe(res);
  }
}

/**
 * @param {import('express').Express} app
 * @param {Object} opcoes
 * @param {(id: string) => ({ caminhoVideo?: string } | undefined)} opcoes.obterProjetoPorId
 *   Função (síncrona ou async) que devolve o projeto salvo dado seu id —
 *   em server/index.js, isso é `carregarProjeto`.
 * @param {string} opcoes.uploadsDir - UPLOADS_DIR do server/index.js,
 *   necessário para resolver caminhos "/uploads/..." para um caminho
 *   absoluto de disco que o ffmpeg consiga ler.
 */
function montarRotasWaveform(app, { obterProjetoPorId, uploadsDir }) {
  app.get('/api/waveform/:idProjeto', async (req, res) => {
    try {
      const caminhoArquivo = await resolverCaminhoOrigem(req, { obterProjetoPorId, uploadsDir });
      if (!caminhoArquivo) {
        res.status(404).json({ erro: `Projeto '${req.params.idProjeto}' não encontrado ou sem vídeo associado.` });
        return;
      }

      const resultado = await obterPicosComCache(caminhoArquivo);
      res.json(resultado);
    } catch (erro) {
      console.error('[waveformRoutes] Falha ao gerar/obter picos de waveform:', erro);
      res.status(500).json({ erro: erro.message });
    }
  });

  // Trilha de áudio extraída do vídeo (mp3), servida com Range. É o que
  // o WaveSurfer da Timeline carrega para TOCAR o áudio (mutado: false)
  // — em vez do vídeo original, que em arquivos grandes vindos de disco
  // local o Electron não sustenta ler por inteiro (erro "file could not
  // be read... after a reference was acquired"). O arquivo extraído é
  // muito menor (só a trilha sonora) e cacheado em disco.
  app.get('/api/audio-extraido/:idProjeto', async (req, res) => {
    try {
      const caminhoArquivo = await resolverCaminhoOrigem(req, { obterProjetoPorId, uploadsDir });
      if (!caminhoArquivo) {
        res.status(404).json({ erro: `Projeto '${req.params.idProjeto}' não encontrado ou sem vídeo associado.` });
        return;
      }

      const caminhoMp3 = await obterAudioExtraidoComCache(caminhoArquivo);
      servirComRange(caminhoMp3, req, res);
    } catch (erro) {
      console.error('[waveformRoutes] Falha ao gerar/servir áudio extraído:', erro);
      res.status(500).json({ erro: erro.message });
    }
  });
}

module.exports = { montarRotasWaveform };