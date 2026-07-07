#!/usr/bin/env python3
"""
server/audio_sync/aligner.py

Faz duas coisas, dado um arquivo de áudio/vídeo e o texto já transcrito
(as legendas que o usuário já tem, ex: vindas de um .srt):

1. Forced alignment: descobre o tempo exato (início/fim, em segundos) em
   que cada PALAVRA do texto é falada no áudio. Usa WhisperX, que combina
   o modelo Whisper (para segmentação inicial) com wav2vec2 (para o
   alinhamento fonético fino, palavra a palavra).

2. Análise de volume: para cada palavra, calcula o volume médio (RMS
   convertido para dB) no intervalo de tempo em que ela foi falada, e
   classifica esse volume em uma escala normalizada (0 a 1) relativa ao
   volume mínimo/máximo detectado no áudio inteiro. Essa escala é o que
   permite ao client mapear volume -> tamanho de fonte, seguindo a seção
   2.3.3 "Volume" do design system Caption with Intention.

   NOVO: além de min/max, também calculamos volumeDbMedia — a média de
   volumeDb de todas as palavras, PONDERADA pela duração de cada uma.
   Isso serve como "centro" de referência para o client colorir cada
   palavra (azul = mais baixo que a média, verde = na média, vermelho =
   mais alto que a média — ver client/src/components/TelaTimeline.jsx).
   Ponderar por duração evita que palavras muito curtas (ex: "e", "a"),
   cuja medição de RMS é naturalmente mais ruidosa por causa da janela
   curta, puxem a média de forma desproporcional ao seu peso real no
   áudio.

USO:
    python aligner.py --audio caminho/audio.wav --texto caminho/texto.txt --saida resultado.json

    "texto.txt" deve conter o texto já transcrito, tal como falado
    (pontuação simples é ok; o WhisperX faz a normalização interna).

SAÍDA (JSON):
    {
      "palavras": [
        {"texto": "Olá", "inicio": 0.12, "fim": 0.45, "volumeDb": -18.2, "volumeNormalizado": 0.62},
        ...
      ],
      "volumeDbMin": -42.0,
      "volumeDbMax": -6.0,
      "volumeDbMedia": -19.4
    }

Este script é chamado como subprocesso pelo server Node
(server/audioSyncService.js), que faz o parsing do JSON de saída e o
converte para o formato de "blocos/palavras" usado por
shared/projectModel.js.

IMPORTANTE sobre stdout/stderr: o server Node lê o stdout inteiro do
processo e espera que ele contenha SOMENTE o JSON final — qualquer outra
coisa impressa em stdout (logs de bibliotecas terceiras, warnings, etc.)
quebra o parsing. Por isso, logo no início deste script, reconfiguramos
o logging padrão do Python e de bibliotecas conhecidas (whisperx,
pyannote, speechbrain) para escrever em stderr, não em stdout. Também
forçamos UTF-8 explicitamente na escrita de stdout/stderr para evitar
caracteres acentuados corrompidos no Windows, onde o encoding padrão do
console costuma ser cp1252/cp850 em vez de UTF-8.
"""

import argparse
import io
import json
import logging
import sys

# --- Correção de encoding (Windows corrompe acentos sem isso) ---
# No Windows, sys.stdout/stderr por padrão usam o code page do console
# (ex: cp1252), não UTF-8. Isso corrompe qualquer acento (á, ç, ã, etc.)
# tanto no JSON final quanto nas mensagens de log. Reconfiguramos os dois
# fluxos para UTF-8 explicitamente antes de qualquer output.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# --- Correção de vazamento de logs para stdout ---
# Bibliotecas como whisperx, pyannote.audio e speechbrain usam o módulo
# `logging` do Python internamente, e algumas configuram handlers que
# escrevem em stdout (em vez do padrão, que seria stderr). Isso faz
# mensagens tipo "Performing voice activity detection..." aparecerem
# misturadas ANTES do JSON de saída, quebrando o parsing no lado Node
# (que espera stdout = só JSON). A correção abaixo remove qualquer
# handler pré-existente que aponte para stdout e força um handler root
# único apontando para stderr, cobrindo o logging de qualquer biblioteca
# que seja importada depois.
logging.basicConfig(level=logging.WARNING, stream=sys.stderr, force=True)
for nome_logger in ("whisperx", "pyannote", "speechbrain", "faster_whisper"):
    logger = logging.getLogger(nome_logger)
    logger.handlers = []
    logger.propagate = True

import numpy as np


def log(msg):
    """Log em stderr para não poluir o JSON de saída (que vai em stdout)."""
    print(msg, file=sys.stderr, flush=True)


def carregar_audio(caminho_audio, sr=16000):
    """Carrega o áudio (qualquer formato suportado por ffmpeg/librosa) e
    devolve o array de amostras (mono) + a taxa de amostragem usada.
    """
    import librosa
    audio, taxa = librosa.load(caminho_audio, sr=sr, mono=True)
    return audio, taxa


def executar_alinhamento(caminho_audio, texto, idioma="pt", device=None):
    """Executa o forced alignment com WhisperX e retorna uma lista de
    palavras com seus timestamps (início/fim em segundos).

    WhisperX opera em duas etapas:
      1. Transcrição/segmentação com o modelo Whisper (aqui usamos o texto
         já fornecido como referência, então pedimos ao Whisper apenas a
         segmentação em frases, sem confiar 100% no texto que ele decodifica).
      2. Alinhamento fonético fino com um modelo wav2vec2 específico do
         idioma, que ancora cada palavra do texto real (o nosso, fornecido)
         no áudio.
    """
    import torch
    import whisperx

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"

    log(f"Carregando modelo Whisper (device={device})...")
    modelo_transcricao = whisperx.load_model(
        "small", device, compute_type=compute_type, language=idioma
    )

    log("Transcrevendo áudio para obter segmentação temporal...")
    audio = whisperx.load_audio(caminho_audio)
    resultado = modelo_transcricao.transcribe(audio, batch_size=16, language=idioma)

    log("Carregando modelo de alinhamento fonético...")
    modelo_align, metadata_align = whisperx.load_align_model(
        language_code=idioma, device=device
    )

    log("Executando forced alignment...")
    resultado_alinhado = whisperx.align(
        resultado["segments"], modelo_align, metadata_align, audio, device,
        return_char_alignments=False,
    )

    palavras = []
    for segmento in resultado_alinhado.get("segments", []):
        for palavra_info in segmento.get("words", []):
            texto_palavra = palavra_info.get("word", "").strip()
            inicio = palavra_info.get("start")
            fim = palavra_info.get("end")
            # WhisperX pode deixar 'start'/'end' ausentes em palavras com
            # baixa confiança de alinhamento (ex: ruído, sobreposição de
            # fala). Nesses casos, pulamos — o server Node trata a lacuna
            # reaproveitando o texto original do usuário e interpolando
            # o tempo entre as palavras vizinhas alinhadas com sucesso.
            if texto_palavra and inicio is not None and fim is not None:
                palavras.append({
                    "texto": texto_palavra,
                    "inicio": round(float(inicio), 3),
                    "fim": round(float(fim), 3),
                })

    return palavras


def calcular_volume_por_palavra(audio, taxa_amostragem, palavras):
    """Para cada palavra já alinhada no tempo, calcula o volume médio
    (RMS -> dB) da fatia de áudio correspondente, e normaliza esse valor
    para uma escala de 0 a 1 relativa ao volume mínimo/máximo do áudio
    inteiro (útil para o client mapear diretamente para o range de
    tamanho de tipo, ver 2.3.6 "Type Size Range" do design system).

    Além disso, calcula volumeDbMedia: a média de volumeDb entre todas as
    palavras, PONDERADA pela duração de cada uma (fim - inicio). Essa
    média ponderada serve como "centro" de referência (0.5 na escala
    normalizada, na prática) para o client decidir se uma palavra está
    "no volume normal" (verde), "mais baixa" (azul) ou "mais alta"
    (vermelho) que o típico do áudio — ver TelaTimeline.jsx.

    Ponderar por duração evita que palavras muito curtas (que tendem a
    ter uma medição de RMS mais instável/ruidosa, por causa da janela de
    amostras curta) distorçam a média tanto quanto uma palavra longa e
    bem medida.
    """
    duracao_total = len(audio) / taxa_amostragem
    volumes_db = []
    duracoes = []

    for palavra in palavras:
        inicio_amostra = int(max(0, palavra["inicio"]) * taxa_amostragem)
        fim_amostra = int(min(duracao_total, palavra["fim"]) * taxa_amostragem)
        fatia = audio[inicio_amostra:fim_amostra]

        if len(fatia) == 0:
            volume_db = -60.0  # silêncio/piso, evita log(0)
        else:
            rms = np.sqrt(np.mean(np.square(fatia)))
            # Piso de -60dB para evitar -inf em trechos de silêncio total.
            volume_db = 20 * np.log10(max(rms, 1e-3))

        palavra["volumeDb"] = round(float(volume_db), 2)
        volumes_db.append(volume_db)
        duracoes.append(max(0.0, palavra["fim"] - palavra["inicio"]))

    if not volumes_db:
        return palavras, -60.0, 0.0, -60.0

    volume_db_min = min(volumes_db)
    volume_db_max = max(volumes_db)
    faixa = max(volume_db_max - volume_db_min, 1e-6)  # evita divisão por zero

    duracao_total_palavras = sum(duracoes)
    if duracao_total_palavras > 0:
        volume_db_media = sum(
            v * d for v, d in zip(volumes_db, duracoes)
        ) / duracao_total_palavras
    else:
        # Fallback (não deveria acontecer, mas protege contra palavras
        # todas com duração 0): média simples não ponderada.
        volume_db_media = sum(volumes_db) / len(volumes_db)

    for palavra in palavras:
        normalizado = (palavra["volumeDb"] - volume_db_min) / faixa
        palavra["volumeNormalizado"] = round(float(min(1.0, max(0.0, normalizado))), 3)

    return palavras, volume_db_min, volume_db_max, volume_db_media


def main():
    parser = argparse.ArgumentParser(description="Alinhamento forçado + análise de volume por palavra")
    parser.add_argument("--audio", required=True, help="Caminho do arquivo de áudio ou vídeo")
    parser.add_argument("--texto", required=True, help="Caminho do arquivo .txt com o texto já transcrito")
    parser.add_argument("--idioma", default="pt", help="Código do idioma (padrão: pt)")
    parser.add_argument("--saida", default=None, help="Caminho do JSON de saída (padrão: stdout)")
    parser.add_argument("--device", default=None, help="'cuda' ou 'cpu' (padrão: detecta automaticamente)")
    args = parser.parse_args()

    with open(args.texto, "r", encoding="utf-8") as f:
        texto = f.read().strip()

    if not texto:
        log("ERRO: arquivo de texto está vazio.")
        sys.exit(1)

    palavras = executar_alinhamento(args.audio, texto, idioma=args.idioma, device=args.device)

    if not palavras:
        log("ERRO: nenhuma palavra pôde ser alinhada. Verifique o áudio e o texto fornecidos.")
        sys.exit(1)

    log(f"{len(palavras)} palavras alinhadas. Calculando volume...")
    audio, taxa = carregar_audio(args.audio)
    palavras, volume_db_min, volume_db_max, volume_db_media = calcular_volume_por_palavra(
        audio, taxa, palavras
    )

    resultado_final = {
        "palavras": palavras,
        "volumeDbMin": round(float(volume_db_min), 2),
        "volumeDbMax": round(float(volume_db_max), 2),
        "volumeDbMedia": round(float(volume_db_media), 2),
    }

    saida_json = json.dumps(resultado_final, ensure_ascii=False, indent=2)

    if args.saida:
        with open(args.saida, "w", encoding="utf-8") as f:
            f.write(saida_json)
        log(f"Resultado salvo em {args.saida}")
    else:
        print(saida_json)
        sys.stdout.flush()


if __name__ == "__main__":
    main()