// server/index.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { parseSRT, aplicarOffset } = require('../shared/srtParser');
const {
  criarProjeto,
  criarEstiloPadrao,
  aplicarPresetAPalavras,
  atualizarEstiloPadrao: atualizarEstiloPadraoModel,
} = require('../shared/projectModel');

const PORT = process.env.PORT || 4000;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PROJECTS_DIR = path.join(__dirname, '..', 'projects');
const EXPORTS_DIR = path.join(__dirname, '..', 'exports');

[UPLOADS_DIR, PROJECTS_DIR, EXPORTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: UPLOADS_DIR });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/exports', express.static(EXPORTS_DIR));

// Armazenamento simples em memória + disco. Para uso pessoal local isso
// é suficiente — não precisa de banco de dados.
const projetosEmMemoria = new Map();

// Migra projetos salvos antes da introdução dos campos estiloFonte,
// estiloFonteSoNoDestaque e fundo. Projetos antigos têm "pesoFonte"
// (número) em vez de "estiloFonte" (string) e não têm "fundo" nenhum.
// Isso evita que abrir um projeto salvo antes desta atualização quebre
// a interface (que agora espera esses campos existirem).
function migrarProjeto(projeto) {
  if (!projeto || !projeto.estiloPadrao) return projeto;

  const padraoNovo = criarEstiloPadrao();
  const estiloPadrao = { ...projeto.estiloPadrao };

  if (estiloPadrao.estiloFonte === undefined) {
    // pesoFonte >= 600 vira 'negrito' como aproximação razoável;
    // o usuário pode ajustar manualmente depois.
    estiloPadrao.estiloFonte =
      typeof estiloPadrao.pesoFonte === 'number' && estiloPadrao.pesoFonte >= 600
        ? 'negrito'
        : 'normal';
    delete estiloPadrao.pesoFonte;
  }
  if (estiloPadrao.estiloFonteSoNoDestaque === undefined) {
    estiloPadrao.estiloFonteSoNoDestaque = false;
  }
  if (!estiloPadrao.fundo) {
    estiloPadrao.fundo = padraoNovo.fundo;
  }

  return { ...projeto, estiloPadrao };
}

function salvarProjetoEmDisco(id, projeto) {
  const filePath = path.join(PROJECTS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(projeto, null, 2), 'utf-8');
}

function carregarProjetoDoDisco(id) {
  const filePath = path.join(PROJECTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  const bruto = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return migrarProjeto(bruto);
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

// Atualiza o estilo padrão global do projeto. Usa atualizarEstiloPadraoModel
// para garantir que um update parcial do campo "fundo" (ex: só a cor) não
// apague os outros campos do fundo já configurados.
app.patch('/api/projetos/:id/estilo-padrao', (req, res) => {
  const projeto =
    projetosEmMemoria.get(req.params.id) ||
    carregarProjetoDoDisco(req.params.id);
  if (!projeto) return res.status(404).json({ erro: 'Projeto não encontrado.' });

  const atualizado = atualizarEstiloPadraoModel(projeto, req.body);
  projetosEmMemoria.set(req.params.id, atualizado);
  salvarProjetoEmDisco(req.params.id, atualizado);

  res.json({ id: req.params.id, projeto: atualizado });
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
        if (req.body === null) {
          palavra.estilo = null;
        } else {
          const estiloAtual = palavra.estilo || {};
          const novoEstilo = { ...estiloAtual, ...req.body };
          if (req.body.fundo) {
            novoEstilo.fundo = { ...(estiloAtual.fundo || {}), ...req.body.fundo };
          }
          palavra.estilo = novoEstilo;
        }
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
