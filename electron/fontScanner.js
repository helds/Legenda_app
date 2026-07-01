// electron/fontScanner.js
//
// Escaneia as pastas de fontes do sistema operacional, abre cada arquivo
// com fontkit e extrai os metadados REAIS (nome de família, peso via
// OS/2.usWeightClass, itálico via italicAngle/subfamilyName). Diferente
// de simplesmente listar nomes de arquivo, isso garante que a interface
// só ofereça estilos (peso/itálico) que a fonte de fato possui — se uma
// família só tem Regular e Bold instalados, não aparece a opção de
// "Light" ou "Black" para ela.
//
// Resultado em cache no processo principal (o disco de fontes não muda
// durante a sessão do app, então não há necessidade de re-escanear a
// cada chamada).

const fs = require("fs");
const path = require("path");
const os = require("os");
const fontkit = require("fontkit");

const EXTENSOES_VALIDAS = new Set([".ttf", ".otf", ".ttc", ".otc"]);

// Pastas onde o Windows guarda fontes: a pasta do sistema (todas as
// contas) e a pasta por-usuário (fontes instaladas "só para mim", sem
// precisar de admin — comum em máquinas corporativas).
function obterPastasDeFontesWindows() {
  const pastas = [];

  if (process.env.WINDIR) {
    pastas.push(path.join(process.env.WINDIR, "Fonts"));
  } else {
    pastas.push("C:\\Windows\\Fonts");
  }

  if (process.env.LOCALAPPDATA) {
    pastas.push(
      path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts")
    );
  }

  return pastas;
}

// macOS e Linux inclusos para o app não quebrar caso alguém rode fora do
// Windows (ex: durante desenvolvimento em outra máquina).
function obterPastasDeFontes() {
  const plataforma = process.platform;

  if (plataforma === "win32") {
    return obterPastasDeFontesWindows();
  }

  if (plataforma === "darwin") {
    return [
      "/System/Library/Fonts",
      "/Library/Fonts",
      path.join(os.homedir(), "Library", "Fonts"),
    ];
  }

  // linux
  return [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    path.join(os.homedir(), ".fonts"),
    path.join(os.homedir(), ".local", "share", "fonts"),
  ];
}

// Percorre recursivamente uma pasta coletando caminhos de arquivos de
// fonte. Ignora silenciosamente pastas sem permissão de leitura em vez
// de derrubar o escaneamento inteiro.
function listarArquivosDeFonteRecursivo(pastaRaiz) {
  const encontrados = [];

  function percorrer(pastaAtual) {
    let entradas;
    try {
      entradas = fs.readdirSync(pastaAtual, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entrada of entradas) {
      const caminhoCompleto = path.join(pastaAtual, entrada.name);

      if (entrada.isDirectory()) {
        percorrer(caminhoCompleto);
        continue;
      }

      const ext = path.extname(entrada.name).toLowerCase();
      if (EXTENSOES_VALIDAS.has(ext)) {
        encontrados.push(caminhoCompleto);
      }
    }
  }

  percorrer(pastaRaiz);
  return encontrados;
}

// Converte o ângulo itálico ou o nome da subfamília em um booleano
// simples. Algumas fontes não preenchem italicAngle corretamente, então
// checamos também palavras-chave no nome do estilo como fallback.
function ehItalico(font) {
  if (typeof font.italicAngle === "number" && font.italicAngle !== 0) {
    return true;
  }
  const subfamilia = (font.subfamilyName || "").toLowerCase();
  return subfamilia.includes("italic") || subfamilia.includes("oblique");
}

// Extrai o peso numérico (100-900) via tabela OS/2. Se a fonte não tiver
// essa tabela (raro, mas acontece em fontes antigas), tenta inferir pelo
// nome do estilo como último recurso.
function obterPeso(font) {
  const os2 = font["OS/2"];
  if (os2 && typeof os2.usWeightClass === "number" && os2.usWeightClass > 0) {
    return os2.usWeightClass;
  }

  const subfamilia = (font.subfamilyName || "").toLowerCase();
  const mapaFallback = [
    [/black|heavy/, 900],
    [/extrabold|ultra ?bold/, 800],
    [/bold/, 700],
    [/semibold|demibold/, 600],
    [/medium/, 500],
    [/regular|normal/, 400],
    [/light/, 300],
    [/extralight|ultra ?light/, 200],
    [/thin/, 100],
  ];
  for (const [regex, peso] of mapaFallback) {
    if (regex.test(subfamilia)) return peso;
  }
  return 400; // assume Regular se nada bater
}

// Abre um único arquivo de fonte (ou font collection) e retorna uma
// lista de "faces" (uma collection pode conter várias famílias/estilos
// dentro do mesmo arquivo .ttc).
function extrairFacesDoArquivo(caminhoArquivo) {
  let fonteAberta;
  try {
    fonteAberta = fontkit.openSync(caminhoArquivo);
  } catch {
    // Arquivo corrompido, protegido por DRM, ou formato não suportado —
    // pulamos em vez de interromper o escaneamento inteiro.
    return [];
  }

  const fontes = fonteAberta.fonts ? fonteAberta.fonts : [fonteAberta];

  return fontes
    .filter((f) => f.familyName)
    .map((f) => ({
      familia: f.familyName.trim(),
      peso: obterPeso(f),
      italico: ehItalico(f),
      nomeEstilo: f.subfamilyName || "Regular",
      arquivo: caminhoArquivo,
    }));
}

// Função principal: escaneia todas as pastas do SO, agrupa por família e
// retorna um array pronto para a interface:
//
// [
//   {
//     familia: "Roboto",
//     estilos: [
//       { peso: 400, italico: false, nomeEstilo: "Regular" },
//       { peso: 700, italico: false, nomeEstilo: "Bold" },
//       { peso: 400, italico: true,  nomeEstilo: "Italic" },
//     ]
//   },
//   ...
// ]
//
// Estilos duplicados (mesmo peso + itálico) são deduplicados — pode
// acontecer de a mesma fonte existir em .ttf e .otf simultaneamente.
function escanearFontesDoSistema() {
  const pastas = obterPastasDeFontes();
  const arquivos = pastas.flatMap((pasta) =>
    fs.existsSync(pasta) ? listarArquivosDeFonteRecursivo(pasta) : []
  );

  const familiasMap = new Map();

  for (const caminhoArquivo of arquivos) {
    const faces = extrairFacesDoArquivo(caminhoArquivo);

    for (const face of faces) {
      if (!familiasMap.has(face.familia)) {
        familiasMap.set(face.familia, new Map());
      }
      const estilosDaFamilia = familiasMap.get(face.familia);
      const chaveEstilo = `${face.peso}_${face.italico}`;

      if (!estilosDaFamilia.has(chaveEstilo)) {
        estilosDaFamilia.set(chaveEstilo, {
          peso: face.peso,
          italico: face.italico,
          nomeEstilo: face.nomeEstilo,
          // Caminho absoluto do arquivo no disco do usuário — necessário
          // para depois copiar/servir o arquivo real e garantir que o
          // preview e o vídeo exportado usem a fonte de verdade, e não
          // um fallback genérico do Chromium headless do Remotion.
          arquivo: face.arquivo,
        });
      }
    }
  }

  const resultado = Array.from(familiasMap.entries())
    .map(([familia, estilosMap]) => ({
      familia,
      estilos: Array.from(estilosMap.values()).sort(
        (a, b) => a.peso - b.peso || a.italico - b.italico
      ),
    }))
    .sort((a, b) => a.familia.localeCompare(b.familia, "pt-BR"));

  return resultado;
}

module.exports = { escanearFontesDoSistema };
