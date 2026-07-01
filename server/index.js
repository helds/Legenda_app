// server/index.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { parseSRT, aplicarOffset } = require('../shared/srtParser');
const {
  criarProjeto,
  aplicarPresetAPalavras,
  resolverEstilo,
} = require('../shared/projectModel');

const PORT = process.env.PORT || 4000;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PROJECTS_DIR = path.join(__dirname, '..', 'projects');
const EXPORTS_DIR = path.join(__dirname, '..', 'exports');
const FONTS_DIR = path.join(__dirname, '..', 'fonts');

[UPLOADS_DIR, PROJECTS_DIR, EXPORTS_DIR, FONTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: UPLOADS_DIR });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/exports', express.static(EXPORTS_DIR));
// Fontes copiadas do sistema do usuário ficam acessíveis aqui — tanto o
// preview (@remotion/player no navegador do Electron) quanto o processo
// de renderização (@remotion/renderer, que sobe um servidor local do
// bundle e busca assets via serveUrl) enxergam esse endpoint.
app.use('/fonts', express.static(FONTS_DIR));

// Armazenamento simples em memória + disco. Para uso pessoal local isso
// é suficiente — não precisa de banco de dados.
const projetosEmMemoria = new Map();

function salvarProjetoEmDisco(id, projeto) {
  const filePath = path.join(PROJECTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(projeto, null, 2), 'utf-8');
}

function carregarProjetoDoDisco(id) {
  const filePath = path.join(PROJECTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// Extensões de fonte aceitas para cópia — mesma lista que o scanner do
// processo Electron usa, para não aceitar arbitrariamente qualquer
// arquivo que o renderer mande.
const EXTENSOES_FONTE_VALIDAS = new Set(['.ttf', '.otf', '.ttc', '.otc']);

// Gera um nome de arquivo estável e seguro (sem espaços/acentos/barras)
// a partir de família + peso + itálico, para poder cachear cópias já
// feitas e não duplicar a mesma fonte no disco a cada troca de estilo.
function nomeArquivoFonte(familia, peso, italico, extensaoOriginal) {
  const familiaSegura = familia
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9]/g, '_');
  const sufixoItalico = italico ? '_italic' : '';
  return `${familiaSegura}_${peso}${sufixoItalico}${extensaoOriginal}`;
}

// --- Rotas ---

// Serve um vídeo a partir de um caminho ABSOLUTO no disco local — usado
// quando o vídeo foi selecionado via diálogo nativo do Electron (não é
// um upload, é só referência local para o preview do editor). Suporta
// "Range" para o <video> conseguir avançar/retroceder (seek).
app.get('/api/video-local', (req, res) => {
  const caminho = req.query.path;
  if (!caminho || typeof caminho !== 'string') {
    return res.status(400).json({ erro: 'Parâmetro "path" é obrigatório.' });
  }
  if (!fs.existsSync(caminho)) {
    return res.status(404).json({ erro: 'Arquivo de vídeo não encontrado no caminho informado.' });
  }

  const stat = fs.statSync(caminho);
  const fileSize = stat.size;
  const range = req.headers.range;

  const mimePorExtensao = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
  };
  const contentType = mimePorExtensao[path.extname(caminho).toLowerCase()] || 'application/octet-stream';

  if (range) {
    const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startRaw, 10);
    const end = endRaw ? parseInt(endRaw, 10) : fileSize - 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    fs.createReadStream(caminho, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(caminho).pipe(res);
  }
});

// Copia um arquivo de fonte do disco local do usuário para dentro da
// pasta /fonts do projeto e retorna a URL pela qual ele passa a ser
// servido. O caminho de origem vem do renderer, que já sabe onde cada
// fonte está porque leu isso via window.api.listarFontes() (processo
// Electron main, que tem acesso ao sistema de arquivos do SO).
//
// Isso existe porque o Chromium headless usado pelo @remotion/renderer
// na exportação NÃO tem acesso automático às fontes instaladas no
// Windows do usuário — sem copiar o arquivo real para dentro do bundle
// servido, a fonte "some" silenciosamente no vídeo final mesmo que
// apareça certa no preview do editor.
app.post('/api/fontes/registrar', (req, res) => {
  const { caminhoOrigem, familia, peso, italico } = req.body;

  if (!caminhoOrigem || typeof caminhoOrigem !== 'string') {
    return res.status(400).json({ erro: 'Parâmetro "caminhoOrigem" é obrigatório.' });
  }
  if (!familia || typeof peso !== 'number') {
    return res.status(400).json({ erro: 'Parâmetros "familia" e "peso" são obrigatórios.' });
  }

  const extensao = path.extname(caminhoOrigem).toLowerCase();
  if (!EXTENSOES_FONTE_VALIDAS.has(extensao)) {
    return res.status(400).json({ erro: `Extensão de fonte não suportada: "${extensao}".` });
  }
  if (!fs.existsSync(caminhoOrigem)) {
    return res.status(404).json({ erro: 'Arquivo de fonte não encontrado no caminho informado.' });
  }

  try {
    const nomeDestino = nomeArquivoFonte(familia, peso, !!italico, extensao);
    const caminhoDestino = path.join(FONTS_DIR, nomeDestino);

    // Evita recopiar se já existe uma cópia com esse nome — trocar entre
    // as mesmas fontes repetidamente não deve reescrever o arquivo toda
    // vez.
    if (!fs.existsSync(caminhoDestino)) {
      fs.copyFileSync(caminhoOrigem, caminhoDestino);
    }

    // URL ABSOLUTA (não relativa) de propósito: o preview roda dentro do
    // navegador do Electron via proxy do Vite e resolveria uma URL
    // relativa sem problema, mas o processo de RENDER
    // (@remotion/renderer) carrega o bundle isolado do Remotion Bundler
    // em outra porta/contexto — uma URL relativa lá apontaria para o
    // próprio bundle, não para este servidor Express. Com URL absoluta,
    // os dois contextos buscam o mesmo arquivo físico do mesmo lugar.
    res.json({
      url: `http://localhost:${PORT}/fonts/${nomeDestino}`,
      familia,
      peso,
      italico: !!italico,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Falha ao registrar fonte.', detalhe: err.message });
  }
});

// Cria um novo projeto a partir de um vídeo + arquivo .srt enviados.
app.post(
  '/api/projetos',
  upload.fields([{ name: 'video' }, { name: 'srt' }]),
  (req, res) => {
    try {
      const videoFile = req.files?.video?.[0];
      const srtFile = req.files?.srt?.[0];
      // Caminho absoluto local (vem do diálogo nativo do Electron, via
      // TelaImportacao -> window.api.openVideo()). Não é um upload — é
      // só texto mesmo, o multer joga em req.body por não ser um arquivo.
      const videoPathLocal = req.body.videoPath;

      if (!srtFile) {
        return res.status(400).json({ erro: 'Arquivo .srt é obrigatório.' });
      }

      const srtContent = fs.readFileSync(srtFile.path, 'utf-8');
      let blocos = parseSRT(srtContent);

      // Offset opcional (em segundos) pra corrigir .srt exportados de
      // timelines que começam em 01:00:00:00 — ex: -3600 tira 1 hora.
      const offsetSegundos = req.body.offsetSegundos ? parseFloat(req.body.offsetSegundos) : 0;
      if (!Number.isNaN(offsetSegundos) && offsetSegundos !== 0) {
        blocos = aplicarOffset(blocos, offsetSegundos);
      }

      const nomeProjeto = req.body.nome || `projeto_${Date.now()}`;
      const id = `proj_${Date.now()}`;

      let caminhoVideo = null;
      if (videoFile) {
        caminhoVideo = `/uploads/${videoFile.filename}`;
      } else if (videoPathLocal) {
        caminhoVideo = videoPathLocal;
      }

      const projeto = criarProjeto({
        nome: nomeProjeto,
        caminhoVideo,
        blocos,
      });

      projetosEmMemoria.set(id, projeto);
      salvarProjetoEmDisco(id, projeto);

      res.json({ id, projeto });
    } catch (err) {
      console.error(err);
      res.status(500).json({ erro: 'Falha ao processar o SRT.', detalhe: err.message });
    }
  }
);

// Retorna um projeto existente.
app.get('/api/projetos/:id', (req, res) => {
  const projeto =
    projetosEmMemoria.get(req.params.id) ||
    carregarProjetoDoDisco(req.params.id);

  if (!projeto) return res.status(404).json({ erro: 'Projeto não encontrado.' });
  res.json({ id: req.params.id, projeto });
});

// Lista todos os projetos salvos em disco.
app.get('/api/projetos', (req, res) => {
  const arquivos = fs.readdirSync(PROJECTS_DIR).filter((f) => f.endsWith('.json'));
  const lista = arquivos.map((f) => {
    const id = f.replace('.json', '');
    const projeto = carregarProjetoDoDisco(id);
    return { id, nome: projeto.nome, criadoEm: projeto.criadoEm };
  });
  res.json(lista);
});

// Atualiza o estilo padrão global do projeto.
app.patch('/api/projetos/:id/estilo-padrao', (req, res) => {
  const projeto =
    projetosEmMemoria.get(req.params.id) ||
    carregarProjetoDoDisco(req.params.id);
  if (!projeto) return res.status(404).json({ erro: 'Projeto não encontrado.' });

  projeto.estiloPadrao = { ...projeto.estiloPadrao, ...req.body };
  projetosEmMemoria.set(req.params.id, projeto);
  salvarProjetoEmDisco(req.params.id, projeto);

  res.json({ id: req.params.id, projeto });
});

// Atualiza o estilo individual (override) de uma palavra específica.
app.patch('/api/projetos/:id/palavras/:palavraId', (req, res) => {
  const projeto =
    projetosEmMemoria.get(req.params.id) ||
    carregarProjetoDoDisco(req.params.id);
  if (!projeto) return res.status(404).json({ erro: 'Projeto não encontrado.' });

  let encontrada = false;
  projeto.blocos.forEach((bloco) => {
    bloco.palavras.forEach((palavra) => {
      if (palavra.id === req.params.palavraId) {
        palavra.estilo = { ...(palavra.estilo || {}), ...req.body };
        encontrada = true;
      }
    });
  });

  if (!encontrada) {
    return res.status(404).json({ erro: 'Palavra não encontrada no projeto.' });
  }

  projetosEmMemoria.set(req.params.id, projeto);
  salvarProjetoEmDisco(req.params.id, projeto);

  res.json({ id: req.params.id, projeto });
});

// Aplica um preset de estilo a uma lista de palavras (seleção em grupo).
app.post('/api/projetos/:id/aplicar-preset', (req, res) => {
  const projeto =
    projetosEmMemoria.get(req.params.id) ||
    carregarProjetoDoDisco(req.params.id);
  if (!projeto) return res.status(404).json({ erro: 'Projeto não encontrado.' });

  const { presetParcial, idsAlvo } = req.body;
  if (!presetParcial || !Array.isArray(idsAlvo)) {
    return res.status(400).json({ erro: 'Body precisa de presetParcial e idsAlvo[].' });
  }

  const atualizado = aplicarPresetAPalavras(projeto, presetParcial, idsAlvo);
  projetosEmMemoria.set(req.params.id, atualizado);
  salvarProjetoEmDisco(req.params.id, atualizado);

  res.json({ id: req.params.id, projeto: atualizado });
});

// Dispara a exportação (delegado ao módulo Remotion — ver server/render.js)
app.post('/api/projetos/:id/exportar', async (req, res) => {
  const projeto =
    projetosEmMemoria.get(req.params.id) ||
    carregarProjetoDoDisco(req.params.id);
  if (!projeto) return res.status(404).json({ erro: 'Projeto não encontrado.' });

  const { formato, corFundo } = req.body;
  // formato: 'mov-alpha' | 'png-sequence' | 'mp4-fundo-solido'

  try {
    const { exportarProjeto } = require('./render');
    const resultado = await exportarProjeto({
      projeto,
      formato,
      corFundo,
      outputDir: EXPORTS_DIR,
    });
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Falha na exportação.', detalhe: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
