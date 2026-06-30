// shared/srtParser.js
// Lê um arquivo .srt padrão e transforma cada bloco de legenda em uma lista
// de palavras individuais, cada uma com seu próprio tempo de início/fim
// calculado proporcionalmente ao número de caracteres.

function timecodeToSeconds(tc) {
  // formato: HH:MM:SS,mmm
  const match = tc.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) throw new Error(`Timecode inválido: "${tc}"`);
  const [, h, m, s, ms] = match;
  return (
    parseInt(h, 10) * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    parseInt(ms, 10) / 1000
  );
}

function secondsToTimecode(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// Remove tags de formatação HTML (ex: <b>, <font color='#ffff00'>, </font>)
// que aparecem em arquivos .srt exportados de editores de legenda. Sem
// isso, pedaços de tag (ex: "<b><font") viram "palavras" e aparecem na
// legenda renderizada.
function removerTagsHtml(text) {
  return text.replace(/<[^>]*>/g, '');
}

// Quebra o bloco de texto em "tokens" de palavra, preservando pontuação
// junto à palavra (ex: "Coruripe," continua um token só).
function splitIntoWords(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned.split(' ');
}

// Distribui o intervalo [inicio, fim] entre as palavras proporcionalmente
// ao número de caracteres de cada uma. Espaços entre palavras não geram
// tempo próprio — são absorvidos nas bordas de cada palavra.
function distributeTiming(words, startSec, endSec) {
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  if (totalChars === 0) return [];

  const totalDuration = endSec - startSec;
  let cursor = startSec;
  const result = [];

  words.forEach((word, idx) => {
    const proportion = word.length / totalChars;
    let duration = totalDuration * proportion;

    // Garante um mínimo de duração perceptível por palavra (evita palavras
    // de 1 caractere ficarem com 5ms de tela).
    const MIN_WORD_DURATION = 0.08;
    if (duration < MIN_WORD_DURATION) duration = MIN_WORD_DURATION;

    const wordStart = cursor;
    let wordEnd = cursor + duration;

    // Última palavra sempre fecha exatamente no fim do bloco, pra não
    // sobrar nem faltar tempo por arredondamento.
    if (idx === words.length - 1) wordEnd = endSec;

    result.push({
      texto: word,
      inicio: Number(wordStart.toFixed(3)),
      fim: Number(wordEnd.toFixed(3)),
    });

    cursor = wordEnd;
  });

  return result;
}

// Parser principal: recebe o conteúdo bruto do .srt (string) e retorna
// um array de blocos, cada um já com suas palavras quebradas e
// temporizadas.
function parseSRT(srtContent) {
  // Normaliza quebras de linha e remove BOM se houver.
  const normalized = srtContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  // Blocos são separados por linha em branco.
  const rawBlocks = normalized.split(/\n\s*\n/).filter((b) => b.trim());

  const blocks = [];
  let wordCounter = 0;

  for (const rawBlock of rawBlocks) {
    const lines = rawBlock.split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;

    // Linha 0 é o índice numérico (ignoramos, geramos o nosso próprio).
    // Linha 1 é o timecode "00:00:01,000 --> 00:00:03,200".
    const timecodeLine = lines.find((l) => l.includes('-->'));
    if (!timecodeLine) continue;

    const [startRaw, endRaw] = timecodeLine.split('-->');
    const startSec = timecodeToSeconds(startRaw);
    const endSec = timecodeToSeconds(endRaw);

    // Todo o texto após a linha de timecode é o conteúdo da legenda
    // (pode ter múltiplas linhas).
    const timecodeIdx = lines.indexOf(timecodeLine);
    const textLines = lines.slice(timecodeIdx + 1);
    const fullTextBruto = textLines.join(' ');
    const fullText = removerTagsHtml(fullTextBruto);

    const wordTokens = splitIntoWords(fullText);
    const timedWords = distributeTiming(wordTokens, startSec, endSec);

    const words = timedWords.map((w) => ({
      id: `w_${String(wordCounter++).padStart(5, '0')}`,
      texto: w.texto,
      inicio: w.inicio,
      fim: w.fim,
      estilo: null, // null = herda do estilo padrão do projeto
    }));

    blocks.push({
      id: `b_${blocks.length}`,
      inicio: startSec,
      fim: endSec,
      textoOriginal: fullText,
      palavras: words,
    });
  }

  return blocks;
}

// Desloca todos os timestamps (blocos e palavras) por um offset fixo, em
// segundos. Usado para corrigir .srt exportados de timelines que começam
// em 01:00:00:00 (convenção comum em Premiere/Resolve/Avid para entrega
// broadcast), onde as legendas saem deslocadas 1h em relação ao vídeo.
// offsetSegundos negativo = subtrai tempo (ex: -3600 = "tira 1 hora").
function aplicarOffset(blocos, offsetSegundos) {
  if (!offsetSegundos) return blocos;
  return blocos.map((bloco) => ({
    ...bloco,
    inicio: Number((bloco.inicio + offsetSegundos).toFixed(3)),
    fim: Number((bloco.fim + offsetSegundos).toFixed(3)),
    palavras: bloco.palavras.map((palavra) => ({
      ...palavra,
      inicio: Number((palavra.inicio + offsetSegundos).toFixed(3)),
      fim: Number((palavra.fim + offsetSegundos).toFixed(3)),
    })),
  }));
}

module.exports = {
  parseSRT,
  timecodeToSeconds,
  secondsToTimecode,
  splitIntoWords,
  distributeTiming,
  removerTagsHtml,
  aplicarOffset,
};