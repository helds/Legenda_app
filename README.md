# Karaoke Caption Studio

Sistema de legendas estilo karaokê com edição de estilo por palavra (cor,
tamanho, espessura, fonte, offset X/Y) e animação de revelação letra a
letra dentro de cada palavra. Lê arquivos `.srt` padrão e quebra cada
frase em palavras individuais, distribuindo o tempo proporcionalmente.

## Pré-requisitos (Windows)

1. **Node.js** versão 18 ou superior — baixe em https://nodejs.org
   (escolha a versão LTS). Verifique a instalação abrindo o PowerShell
   ou Prompt de Comando e rodando:
   ```
   node --version
   npm --version
   ```

2. O Remotion baixa automaticamente uma versão do Chromium na primeira
   renderização — isso pode demorar alguns minutos na primeira vez que
   você exportar um vídeo. Não precisa instalar nada manualmente.

## Instalação

Abra o PowerShell na pasta do projeto e rode:

```
npm install
cd client
npm install
cd ..
```

Isso instala as dependências do servidor (raiz) e do cliente
(`client/`) separadamente.

## Rodando o sistema

Você precisa de **dois terminais abertos ao mesmo tempo** (ou usar o
script combinado abaixo).

### Opção A — comando único

Na raiz do projeto:
```
npm install -g concurrently
npm run dev
```

### Opção B — dois terminais separados

Terminal 1 (servidor):
```
npm run server
```

Terminal 2 (interface):
```
npm run client
```

Depois, abra o navegador em **http://localhost:5173**

O servidor backend roda em `http://localhost:4000` — a interface se
comunica com ele automaticamente via proxy configurado no Vite.

## Como usar

1. Na tela inicial, envie um arquivo `.srt` (e opcionalmente o vídeo,
   usado só como referência visual no preview).
2. O sistema quebra automaticamente cada frase em palavras, distribuindo
   o tempo de fala proporcionalmente ao tamanho de cada palavra.
3. Clique em qualquer palavra na lista para abrir o painel de
   propriedades à direita — ajuste fonte, tamanho, espessura, cor,
   escala no destaque, e deslocamento X/Y.
4. Para editar várias palavras de uma vez, segure **Ctrl** e clique em
   cada uma — o painel passa a aplicar um preset ao grupo inteiro.
5. O preview ao vivo (player no centro da tela) mostra a animação
   letra a letra em tempo real.
6. Quando estiver satisfeito, use o painel de exportação à direita para
   gerar o arquivo final em um dos três formatos:
   - `.mov` com canal alfa (ProRes 4444) — importação direta no
     DaVinci Resolve como overlay transparente.
   - Sequência de PNG com transparência — uma imagem por frame.
   - `.mp4` com fundo de cor sólida — útil se seu fluxo de trabalho
     prefere chroma key em vez de alpha nativo.

## Estrutura do projeto

```
karaoke-caption-studio/
├── shared/                  # Lógica compartilhada entre servidor e Remotion
│   ├── srtParser.js          # Parser de .srt -> blocos -> palavras com timing
│   └── projectModel.js       # Modelo de dados, resolução de estilo herdado
├── server/
│   ├── index.js              # API Express (CRUD de projeto, upload, etc.)
│   └── render.js             # Orquestra a exportação via Remotion
├── client/
│   └── src/
│       ├── remotion/
│       │   ├── CaptionComposition.jsx  # Componente de animação (usado no preview E na exportação)
│       │   ├── Root.jsx                # Registro da composição Remotion
│       │   └── index.js
│       ├── components/
│       │   ├── TelaImportacao.jsx
│       │   ├── ListaPalavras.jsx
│       │   ├── PainelPropriedades.jsx
│       │   └── PainelExportacao.jsx
│       └── App.jsx
├── uploads/                  # Vídeos e SRTs enviados (criado automaticamente)
├── projects/                 # Projetos salvos em .json (criado automaticamente)
└── exports/                  # Vídeos exportados (criado automaticamente)
```

## Notas técnicas

- O parser de SRT distribui o tempo de cada palavra **proporcionalmente
  ao número de caracteres**. Isso é uma aproximação razoável (igual à
  usada por ferramentas como CapCut/Premiere quando não há timestamp
  por palavra), mas não é tão preciso quanto um timestamp real palavra
  a palavra vindo de uma transcrição tipo Whisper com
  `word_timestamps=True`. Se no futuro você quiser plugar uma fonte de
  timing mais precisa, é só substituir a função `distributeTiming` em
  `shared/srtParser.js`.

- O componente `CaptionComposition.jsx` é usado tanto no preview ao
  vivo (via `@remotion/player`) quanto na exportação final (via
  `@remotion/renderer`) — é exatamente o mesmo código rodando nos dois
  contextos, então o que você vê no preview é fielmente o que sai no
  vídeo exportado.

- Cada palavra no projeto tem um campo `estilo`. Quando `null`, ela usa
  o `estiloPadrao` do projeto. Quando definido (mesmo que parcialmente),
  os campos definidos sobrescrevem o padrão — isso é o que permite o
  fluxo de "estilo padrão + exceções manuais" que você pediu.
