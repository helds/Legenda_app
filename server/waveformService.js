// server/waveformService.js
//
// Gera os picos [min, max] de uma waveform diretamente no servidor, sem
// depender do binário externo `audiowaveform` — usamos o ffmpeg (que já
// faz parte do projeto, ver server/audioSyncService.js) para extrair PCM
// cru, e computamos os picos nós mesmos em JS puro.
//
// Por que no servidor em vez de no navegador (ver useWaveformPeaks.js):
// - Evita baixar o arquivo de vídeo inteiro para o cliente só para
//   desenhar uma linha.
// - Evita decodificar o PCM completo duas vezes (uma para o waveform,
//   outra dentro do próprio WaveSurfer quando ele carrega o áudio real).
// - ffmpeg decodifica em C, é ordens de magnitude mais rápido que
//   decodeAudioData no browser para arquivos de vários minutos.
//
// O resultado é cacheado em disco, chaveado por caminho do arquivo +
// mtime, então re-abrir o mesmo projeto não recalcula nada.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Quantos pontos de pico gerar no total. Mesmo valor usado antes no
// client (useWaveformPeaks.js) para manter a mesma densidade visual —
// dá pra reamostrar em qualquer nível de zoom sem precisar gerar de novo.
const RESOLUCAO_PICOS = 4000;

// Taxa de amostragem do PCM extraído. 8kHz é bem acima do necessário
// para desenhar um envelope de volume (não precisamos de fidelidade de
// áudio aqui, só da forma da onda), e mantém o buffer pequeno na RAM.
const TAXA_AMOSTRAGEM_PCM = 8000;

const PASTA_CACHE = path.join(__dirname, 'cache', 'waveforms');
const PASTA_CACHE_AUDIO = path.join(__dirname, 'cache', 'audio-extraido');

// Chave de cache compartilhada entre picos e áudio extraído: caminho do
// arquivo + mtime. Trocar/reexportar o vídeo de um projeto muda o mtime
// e invalida os dois caches automaticamente, sem lógica extra.
function chaveCache(caminhoArquivo) {
  const stat = fs.statSync(caminhoArquivo); // deixa lançar se o arquivo não existir
  return crypto.createHash('md5').update(caminhoArquivo + stat.mtimeMs).digest('hex');
}

/**
 * Roda o ffmpeg extraindo o áudio do arquivo (vídeo ou áudio puro) como
 * PCM 16-bit mono cru, e reduz as amostras a pares [min, max] por
 * "balde" — a mesma técnica que antes rodava no navegador.
 *
 * @param {string} caminhoArquivo - Caminho absoluto do arquivo no disco.
 * @param {number} [numeroPicos]
 * @returns {Promise<{ picos: [number, number][], duracaoSegundos: number }>}
 */
function gerarPicosDoAudio(caminhoArquivo, numeroPicos = RESOLUCAO_PICOS) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(caminhoArquivo)) {
      reject(new Error(`Arquivo não encontrado: ${caminhoArquivo}`));
      return;
    }

    const ffmpeg = spawn('ffmpeg', [
      '-i', caminhoArquivo,
      '-f', 's16le',       // PCM 16-bit raw
      '-ac', '1',          // mono
      '-ar', String(TAXA_AMOSTRAGEM_PCM),
      '-acodec', 'pcm_s16le',
      'pipe:1',
    ]);

    const chunks = [];
    let stderrBuffer = '';

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => {
      // ffmpeg escreve logs de progresso/metadata em stderr mesmo em
      // execução bem-sucedida; só guardamos para diagnóstico em caso de
      // falha, não tratamos como erro por si só.
      stderrBuffer += chunk.toString('utf-8');
    });
    ffmpeg.on('error', (err) => {
      reject(new Error(
        `Não foi possível iniciar o ffmpeg. Verifique se está instalado e no PATH. ` +
        `Erro original: ${err.message}`
      ));
    });

    ffmpeg.on('close', (codigo) => {
      if (codigo !== 0) {
        reject(new Error(`ffmpeg saiu com código ${codigo}.\n${stderrBuffer.slice(-500)}`));
        return;
      }

      const pcm = Buffer.concat(chunks);
      const totalAmostras = Math.floor(pcm.length / 2); // 16-bit = 2 bytes/amostra

      if (totalAmostras === 0) {
        reject(new Error('ffmpeg não retornou nenhuma amostra de áudio (arquivo sem trilha de áudio?).'));
        return;
      }

      const amostrasPorPico = Math.max(1, Math.floor(totalAmostras / numeroPicos));
      const picos = [];

      for (let inicio = 0; inicio < totalAmostras; inicio += amostrasPorPico) {
        const fim = Math.min(inicio + amostrasPorPico, totalAmostras);
        let min = 32767;
        let max = -32768;

        for (let i = inicio; i < fim; i++) {
          const amostra = pcm.readInt16LE(i * 2);
          if (amostra < min) min = amostra;
          if (amostra > max) max = amostra;
        }

        // Normaliza pra faixa -1..1, igual ao formato que o hook do
        // client já esperava quando decodificava localmente.
        picos.push([min / 32768, max / 32768]);
      }

      resolve({ picos, duracaoSegundos: totalAmostras / TAXA_AMOSTRAGEM_PCM });
    });
  });
}

/**
 * Igual a gerarPicosDoAudio, mas com cache em disco. A chave do cache
 * combina o caminho do arquivo com seu mtime, então trocar/reexportar o
 * áudio de um projeto invalida o cache automaticamente sem precisar de
 * lógica extra de invalidação.
 *
 * @param {string} caminhoArquivo
 * @returns {Promise<{ picos: [number, number][], duracaoSegundos: number }>}
 */
async function obterPicosComCache(caminhoArquivo) {
  const hash = chaveCache(caminhoArquivo);
  const caminhoCache = path.join(PASTA_CACHE, `${hash}.json`);

  if (fs.existsSync(caminhoCache)) {
    try {
      return JSON.parse(fs.readFileSync(caminhoCache, 'utf-8'));
    } catch (err) {
      // Cache corrompido (ex: processo morto no meio da escrita) — ignora
      // e recalcula em vez de propagar o erro pro usuário.
      console.warn(`[waveformService] Cache corrompido, recalculando: ${err.message}`);
    }
  }

  const resultado = await gerarPicosDoAudio(caminhoArquivo);
  fs.mkdirSync(PASTA_CACHE, { recursive: true });
  fs.writeFileSync(caminhoCache, JSON.stringify(resultado));
  return resultado;
}

/**
 * Extrai SÓ a trilha de áudio do arquivo (vídeo ou áudio) como MP3,
 * gravando direto em disco — não passa pela RAM como stream, porque o
 * resultado pode ser servido depois via `Range` (necessário para o
 * WaveSurfer conseguir tocar/buscar sem precisar baixar o arquivo
 * inteiro de uma vez, que era exatamente o problema em vídeos grandes:
 * o WaveSurfer decodificava a URL do VÍDEO original, e o Electron não
 * sustentava essa leitura longa em arquivos grandes vindos de disco
 * local — "file could not be read... after a reference was acquired").
 *
 * @param {string} caminhoArquivo - Caminho absoluto do arquivo de origem.
 * @param {string} caminhoSaida - Caminho absoluto onde gravar o .mp3.
 * @returns {Promise<void>}
 */
function extrairTrilhaDeAudio(caminhoArquivo, caminhoSaida) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(caminhoArquivo)) {
      reject(new Error(`Arquivo não encontrado: ${caminhoArquivo}`));
      return;
    }

    const ffmpeg = spawn('ffmpeg', [
      '-y',                 // sobrescreve se já existir (proteção extra; normalmente não existe por causa do hash de cache)
      '-i', caminhoArquivo,
      '-vn',                 // descarta o vídeo, só processa/emite áudio
      '-acodec', 'libmp3lame',
      '-b:a', '128k',        // qualidade suficiente para preview de edição, arquivo pequeno
      caminhoSaida,
    ]);

    let stderrBuffer = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf-8');
    });
    ffmpeg.on('error', (err) => {
      reject(new Error(
        `Não foi possível iniciar o ffmpeg. Verifique se está instalado e no PATH. ` +
        `Erro original: ${err.message}`
      ));
    });
    ffmpeg.on('close', (codigo) => {
      if (codigo !== 0) {
        // Limpa qualquer arquivo parcial para não deixar um cache corrompido.
        fs.unlink(caminhoSaida, () => {});
        reject(new Error(`ffmpeg (extração de áudio) saiu com código ${codigo}.\n${stderrBuffer.slice(-500)}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Igual a extrairTrilhaDeAudio, mas com cache em disco (mesma chave
 * usada pelos picos, ver chaveCache()). Devolve o CAMINHO do arquivo
 * .mp3 já extraído — quem chama é responsável por servi-lo via HTTP
 * (com suporte a Range, para permitir seek sem baixar tudo).
 *
 * @param {string} caminhoArquivo
 * @returns {Promise<string>} caminho absoluto do .mp3 cacheado
 */
async function obterAudioExtraidoComCache(caminhoArquivo) {
  const hash = chaveCache(caminhoArquivo);
  const caminhoCache = path.join(PASTA_CACHE_AUDIO, `${hash}.mp3`);

  if (fs.existsSync(caminhoCache)) {
    return caminhoCache;
  }

  fs.mkdirSync(PASTA_CACHE_AUDIO, { recursive: true });
  await extrairTrilhaDeAudio(caminhoArquivo, caminhoCache);
  return caminhoCache;
}

module.exports = { gerarPicosDoAudio, obterPicosComCache, obterAudioExtraidoComCache };