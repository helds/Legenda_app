// server/audioSyncService.js
//
// Ponte entre o server Node e o script Python de forced alignment
// (server/audio_sync/aligner.py). Responsável por:
//
//   1. Disparar o script Python como subprocesso, passando o áudio e o
//      texto já transcrito pelo usuário.
//   2. Ler o JSON de resultado (palavras com tempo + volume).
//   3. Converter esse resultado para o formato de "blocos/palavras"
//      usado por shared/projectModel.js, agrupando as palavras em blocos
//      de legenda (frases) e preenchendo o campo `volumeNormalizado` de
//      cada palavra — que pode então ser usado para automatizar estilo
//      (ex: escala de tamanho de fonte proporcional ao volume, ver
//      2.3.3 "Volume" e 2.3.6 "Type Size Range" do design system).
//
// Este módulo não faz nenhuma inferência de IA por conta própria — toda
// a parte de machine learning (Whisper + wav2vec2) roda isolada no
// processo Python, mantendo esse arquivo Node simples e testável sem
// precisar de GPU ou dos modelos pesados instalados.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CAMINHO_SCRIPT_ALIGNER = path.join(__dirname, 'audio_sync', 'aligner.py');

// Duração máxima (em segundos) de silêncio/pausa entre duas palavras
// alinhadas para que elas ainda sejam consideradas parte do MESMO bloco
// de legenda. Pausas maiores que isso iniciam um novo bloco. Valor
// escolhido para aproximar o comportamento de corte de frase de
// legendas tradicionais (pausas de respiração/pontuação).
const LIMIAR_NOVO_BLOCO_SEGUNDOS = 0.7;

// Duração máxima de um único bloco de legenda, em segundos, mesmo sem
// pausa longa — evita blocos gigantes quando alguém fala rápido e
// contínuo por muito tempo.
const DURACAO_MAXIMA_BLOCO_SEGUNDOS = 6;

function gerarId(prefixo) {
  return `${prefixo}_${crypto.randomBytes(4).toString('hex')}`;
}

// Extrai apenas o objeto JSON de um texto que pode conter linhas de log
// residuais antes ou depois dele. Isso protege contra bibliotecas
// terceiras (whisperx, pyannote, speechbrain, etc.) que eventualmente
// escrevam algo em stdout antes do JSON final, mesmo com o aligner.py
// silenciando o logging conhecido — é uma defesa extra, não a correção
// primária (que fica no próprio aligner.py).
function extrairJsonDaSaida(stdoutBuffer) {
  const inicio = stdoutBuffer.indexOf('{');
  const fim = stdoutBuffer.lastIndexOf('}');
  if (inicio === -1 || fim === -1 || fim < inicio) {
    throw new Error('Nenhum objeto JSON encontrado na saída do script.');
  }
  const trecho = stdoutBuffer.slice(inicio, fim + 1);
  return JSON.parse(trecho);
}

/**
 * Executa o script Python de alignment como subprocesso.
 *
 * @param {Object} opcoes
 * @param {string} opcoes.caminhoAudio - Caminho do arquivo de áudio/vídeo.
 * @param {string} opcoes.texto - Texto já transcrito (as legendas atuais).
 * @param {string} [opcoes.idioma] - Código do idioma (padrão 'pt').
 * @param {string} [opcoes.pythonBin] - Binário Python a usar (padrão 'python3').
 * @param {(mensagem: string) => void} [opcoes.aoProgredir] - Callback opcional
 *   chamado com cada linha de log emitida pelo script Python (stderr),
 *   útil para mostrar progresso na interface enquanto o alignment roda
 *   (processo pode levar de segundos a minutos, dependendo da duração
 *   do áudio e se há GPU disponível).
 * @returns {Promise<{ palavras: Array, volumeDbMin: number, volumeDbMax: number }>}
 */
function executarAlignmentPython({
  caminhoAudio,
  texto,
  idioma = 'pt',
  pythonBin = process.env.PYTHON_BIN || 'python3',
  aoProgredir,
}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(caminhoAudio)) {
      reject(new Error(`Arquivo de áudio não encontrado: ${caminhoAudio}`));
      return;
    }

    // O texto é escrito em um arquivo temporário porque pode ser longo
    // (uma transcrição inteira) e argumentos de linha de comando têm
    // limite de tamanho no SO.
    const caminhoTextoTemp = path.join(
      os.tmpdir(),
      `caption-sync-texto-${crypto.randomBytes(6).toString('hex')}.txt`
    );
    fs.writeFileSync(caminhoTextoTemp, texto, 'utf-8');

    const argumentos = [
      CAMINHO_SCRIPT_ALIGNER,
      '--audio', caminhoAudio,
      '--texto', caminhoTextoTemp,
      '--idioma', idioma,
    ];

    // PYTHONIOENCODING garante que o processo Python filho escreva
    // stdout/stderr em UTF-8 mesmo que o console do Windows esteja
    // configurado com outro code page — reforça, do lado do processo,
    // a mesma correção já aplicada explicitamente dentro do aligner.py.
    const processo = spawn(pythonBin, argumentos, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';

    processo.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf-8');
    });

    processo.stderr.on('data', (chunk) => {
      const texto = chunk.toString('utf-8');
      stderrBuffer += texto;
      if (aoProgredir) {
        texto.split('\n').filter(Boolean).forEach((linha) => aoProgredir(linha));
      }
    });

    processo.on('error', (err) => {
      limparArquivoTemp(caminhoTextoTemp);
      reject(new Error(
        `Não foi possível iniciar o processo Python ('${pythonBin}'). ` +
        `Verifique se o Python e as dependências de server/audio_sync/requirements.txt ` +
        `estão instalados. Erro original: ${err.message}`
      ));
    });

    processo.on('close', (codigoSaida) => {
      limparArquivoTemp(caminhoTextoTemp);

      if (codigoSaida !== 0) {
        reject(new Error(
          `Script de alignment terminou com erro (código ${codigoSaida}).\n${stderrBuffer}`
        ));
        return;
      }

      try {
        const resultado = extrairJsonDaSaida(stdoutBuffer);
        resolve(resultado);
      } catch (err) {
        reject(new Error(
          `Falha ao interpretar a saída do script de alignment como JSON: ${err.message}\n` +
          `Saída recebida: ${stdoutBuffer.slice(0, 500)}`
        ));
      }
    });
  });
}

function limparArquivoTemp(caminho) {
  fs.unlink(caminho, () => {}); // best-effort, ignora erro se já não existir
}

/**
 * Agrupa uma lista plana de palavras alinhadas (com tempo + volume) em
 * blocos de legenda, com base em pausas de silêncio e duração máxima.
 * Cada palavra recebe um id único e o campo `volumeNormalizado` bruto
 * calculado pelo Python é preservado para uso posterior (ex: um preset
 * de estilo que escala o tamanho da fonte pelo volume).
 */
function agruparPalavrasEmBlocos(palavrasAlinhadas) {
  const blocos = [];
  let blocoAtual = null;

  palavrasAlinhadas.forEach((palavraAlinhada, indice) => {
    const anterior = palavrasAlinhadas[indice - 1];
    const pausaDesdeAnterior = anterior ? palavraAlinhada.inicio - anterior.fim : 0;
    const duracaoBlocoAtual = blocoAtual
      ? palavraAlinhada.fim - blocoAtual.inicio
      : 0;

    const devesIniciarNovoBloco =
      !blocoAtual ||
      pausaDesdeAnterior > LIMIAR_NOVO_BLOCO_SEGUNDOS ||
      duracaoBlocoAtual > DURACAO_MAXIMA_BLOCO_SEGUNDOS;

    if (devesIniciarNovoBloco) {
      blocoAtual = {
        id: gerarId('bloco'),
        inicio: palavraAlinhada.inicio,
        fim: palavraAlinhada.fim,
        palavras: [],
      };
      blocos.push(blocoAtual);
    }

    blocoAtual.palavras.push({
      id: gerarId('palavra'),
      texto: palavraAlinhada.texto,
      inicio: palavraAlinhada.inicio,
      fim: palavraAlinhada.fim,
      volumeDb: palavraAlinhada.volumeDb,
      volumeNormalizado: palavraAlinhada.volumeNormalizado,
    });
    blocoAtual.fim = palavraAlinhada.fim;
  });

  return blocos;
}

/**
 * Ponto de entrada principal: recebe caminho do áudio + texto já
 * transcrito, executa o alignment via Python, e devolve os `blocos` já
 * no formato esperado por criarProjeto() em shared/projectModel.js.
 *
 * O chamador (rota HTTP do server, ou um script de importação) é
 * responsável por combinar o resultado com criarProjeto({ blocos, ... }).
 *
 * @returns {Promise<{ blocos: Array, volumeDbMin: number, volumeDbMax: number }>}
 */
async function sincronizarAudioComTexto({ caminhoAudio, texto, idioma, aoProgredir }) {
  const resultado = await executarAlignmentPython({
    caminhoAudio,
    texto,
    idioma,
    aoProgredir,
  });

  const blocos = agruparPalavrasEmBlocos(resultado.palavras);

  return {
    blocos,
    volumeDbMin: resultado.volumeDbMin,
    volumeDbMax: resultado.volumeDbMax,
  };
}

/**
 * Utilitário de automação: dado um `volumeNormalizado` (0 a 1, calculado
 * pelo aligner) e o range de tamanho configurado no estilo padrão do
 * projeto, devolve o tamanhoBase (px) proporcional ao volume da palavra.
 * Não é chamado automaticamente em nenhum fluxo — fica disponível para
 * quem quiser montar um preset/automação de "tamanho segue o volume"
 * (ex: um botão futuro "Aplicar volume ao tamanho" na interface),
 * seguindo a lógica de 2.3.6 "Type Size Range" do design system.
 *
 * @param {number} volumeNormalizado - 0 (mais silencioso) a 1 (mais alto).
 * @param {{ tamanhoMinimoPx?: number, tamanhoMaximoPx?: number }} [opcoes]
 */
function mapearVolumeParaTamanhoFonte(volumeNormalizado, opcoes = {}) {
  const { tamanhoMinimoPx = 24, tamanhoMaximoPx = 72 } = opcoes;
  const v = Math.min(1, Math.max(0, volumeNormalizado));
  return Math.round(tamanhoMinimoPx + v * (tamanhoMaximoPx - tamanhoMinimoPx));
}

module.exports = {
  sincronizarAudioComTexto,
  agruparPalavrasEmBlocos,
  mapearVolumeParaTamanhoFonte,
};
